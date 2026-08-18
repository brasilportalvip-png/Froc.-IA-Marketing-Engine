import { config } from '../config/index.js';
import { generatePlatformArticle, generatePost } from './ai.js';
import { cleanupStaleReservations } from './credits.js';
import { COLLECTIONS, createNotification, firestore, newId, nowIso } from './store.js';
import { publishText, type SocialProvider } from './social.js';

function normalizeProvider(value: string): SocialProvider | null {
  const v = value.toLowerCase().trim();
  if (v.includes('instagram')) return 'instagram';
  if (v.includes('facebook')) return 'facebook';
  if (v.includes('tiktok')) return 'tiktok';
  if (v.includes('youtube')) return 'youtube';
  if (v.includes('linkedin')) return 'linkedin';
  if (v === 'x' || v.includes('twitter')) return 'x';
  if (v.includes('pinterest')) return 'pinterest';
  return null;
}

async function acquireLock(): Promise<boolean> {
  const db = firestore();
  const ref = db.collection(COLLECTIONS.schedulerLocks).doc('process');
  const now = Date.now();
  const leaseMs = 12 * 60 * 1000;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data() as any;
    if (current?.lockedUntil && Number(current.lockedUntil) > now) return false;
    tx.set(ref, { lockedAt: now, lockedUntil: now + leaseMs, owner: newId('cron') }, { merge: true });
    return true;
  });
}

async function releaseLock(): Promise<void> {
  await firestore().collection(COLLECTIONS.schedulerLocks).doc('process').set({ lockedUntil: 0, releasedAt: Date.now() }, { merge: true });
}

async function processScheduledPosts(): Promise<number> {
  const db = firestore();
  const snap = await db.collection(COLLECTIONS.scheduledPosts)
    .where('status', '==', 'scheduled')
    .where('scheduledFor', '<=', nowIso())
    .limit(25)
    .get();
  let processed = 0;

  for (const doc of snap.docs) {
    const post = { id: doc.id, ...doc.data() } as any;
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.data()?.status !== 'scheduled') return false;
      tx.update(doc.ref, { status: 'publishing', processingAt: nowIso() });
      return true;
    });
    if (!claimed) continue;

    try {
      const contentSnap = await db.collection(COLLECTIONS.contentItems).doc(post.contentItemId).get();
      if (!contentSnap.exists) throw new Error('Conteúdo associado não encontrado.');
      const content = { id: contentSnap.id, ...contentSnap.data() } as any;
      const platforms = Array.isArray(post.platforms) ? post.platforms : [];
      if (!platforms.length) throw new Error('Nenhuma rede social selecionada para publicação.');

      const publicationResults: any[] = [];
      for (const platform of platforms) {
        const provider = normalizeProvider(String(platform));
        if (!provider) {
          publicationResults.push({ platform, success: false, error: 'Plataforma não reconhecida.' });
          continue;
        }
        try {
          const text = [content.headline, content.body, content.cta, ...(content.hashtags || [])].filter(Boolean).join('\n\n');
          const result = await publishText({ userId: post.userId, companyId: post.companyId, provider, text });
          publicationResults.push({ platform, success: true, ...result });
        } catch (error) {
          publicationResults.push({ platform, success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const successful = publicationResults.filter((item) => item.success);
      const allSucceeded = successful.length === publicationResults.length && publicationResults.length > 0;
      const anySucceeded = successful.length > 0;
      const status = allSucceeded ? 'published' : 'failed';
      const errorMessage = allSucceeded ? null : anySucceeded ? 'Publicação parcial: uma ou mais plataformas falharam.' : publicationResults.map((item) => item.error).filter(Boolean).join(' | ').slice(0, 1000);
      await doc.ref.update({ status, publishedAt: allSucceeded ? nowIso() : null, publicationResults, errorMessage, processedAt: nowIso() });
      if (allSucceeded) await contentSnap.ref.update({ status: 'published', updatedAt: nowIso() });
      await createNotification({
        userId: post.userId,
        title: allSucceeded ? 'Publicação concluída' : 'Publicação requer atenção',
        message: allSucceeded ? `"${content.title || content.headline}" foi publicado nas redes selecionadas.` : `A publicação de "${content.title || content.headline}" não foi concluída em todas as redes. Consulte o calendário para detalhes.`,
        type: allSucceeded ? 'publication_success' : 'publication_failed'
      });
      processed += 1;
    } catch (error) {
      await doc.ref.update({ status: 'failed', errorMessage: error instanceof Error ? error.message : String(error), processedAt: nowIso() });
      processed += 1;
    }
  }
  return processed;
}

function autopilotDue(item: any): boolean {
  if (!item.enabled) return false;
  const last = item.lastRunAt ? new Date(item.lastRunAt).getTime() : 0;
  const elapsedHours = (Date.now() - last) / 3_600_000;
  if (item.frequency === 'weekly') return elapsedHours >= 7 * 24 - 1;
  if (item.frequency === '3_times_week') return elapsedHours >= 48 - 1;
  return elapsedHours >= 24 - 1;
}

async function processAutopilot(): Promise<number> {
  const db = firestore();
  const snap = await db.collection(COLLECTIONS.autopilotConfigs).where('enabled', '==', true).limit(25).get();
  let processed = 0;
  for (const doc of snap.docs) {
    const ap = { id: doc.id, ...doc.data() } as any;
    if (!autopilotDue(ap)) continue;
    const monthKey = new Date().toISOString().slice(0, 7);
    const used = ap.usageMonth === monthKey ? Number(ap.usedCreditsThisMonth || 0) : 0;
    if (used + config.creditCosts.full_post > Number(ap.maxMonthlyCredits || 0)) {
      await doc.ref.set({ usageMonth: monthKey, usedCreditsThisMonth: used, lastBudgetWarningAt: nowIso() }, { merge: true });
      await createNotification({ userId: ap.userId, title: 'Limite do Autopilot atingido', message: 'O Froc Autopilot pausou novas gerações porque o limite mensal de créditos foi alcançado.', type: 'credit_low' });
      continue;
    }
    const companySnap = await db.collection(COLLECTIONS.companies).doc(ap.companyId).get();
    if (!companySnap.exists) continue;
    const company = { id: companySnap.id, ...companySnap.data() } as any;
    try {
      const generated = await generatePost({ userId: ap.userId, company, topic: `Conteúdo estratégico atual para ${company.name}`, platform: ap.targetPlatforms?.[0] || 'Instagram', goal: ap.primaryGoal || 'Atrair clientes e gerar autoridade' });
      const contentId = newId('content');
      const content = {
        id: contentId,
        userId: ap.userId,
        companyId: ap.companyId,
        type: 'post',
        title: `[Autopilot] ${generated.result.headline}`,
        headline: generated.result.headline,
        body: generated.result.body,
        cta: generated.result.cta,
        hashtags: generated.result.hashtags || [],
        keywords: generated.result.keywords || [],
        visualPrompt: generated.result.visualPrompt || '',
        targetPlatform: ap.targetPlatforms?.[0] || 'Instagram',
        creditsUsed: generated.creditsUsed,
        status: ap.mode === 'automatic' ? 'scheduled' : 'saved',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await db.collection(COLLECTIONS.contentItems).doc(contentId).set(content);
      if (ap.mode === 'automatic') {
        const scheduleId = newId('sched');
        const scheduledFor = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await db.collection(COLLECTIONS.scheduledPosts).doc(scheduleId).set({
          id: scheduleId,
          userId: ap.userId,
          companyId: ap.companyId,
          contentItemId: contentId,
          platforms: ap.targetPlatforms || [],
          scheduledFor,
          status: 'scheduled',
          autopilotGenerated: true,
          createdAt: nowIso()
        });
      }
      await doc.ref.set({ lastRunAt: nowIso(), usageMonth: monthKey, usedCreditsThisMonth: used + generated.creditsUsed, updatedAt: nowIso() }, { merge: true });
      await createNotification({ userId: ap.userId, title: 'Froc Autopilot criou novo conteúdo', message: `Novo conteúdo criado para ${company.name}${ap.mode === 'automatic' ? ' e agendado para publicação.' : ' e salvo para sua aprovação.'}`, type: 'autopilot_ready' });
      processed += 1;
    } catch (error) {
      console.warn('[Froc Autopilot]', error instanceof Error ? error.message : String(error));
    }
  }
  return processed;
}

async function processAutoBlog(): Promise<number> {
  if (!config.blog.autoEnabled) return 0;
  const db = firestore();
  const today = new Date().toISOString().slice(0, 10);
  const settingsRef = db.collection(COLLECTIONS.systemSettings).doc('autoBlog');
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(settingsRef);
    if (snap.data()?.lastPublishedDate === today) return false;
    tx.set(settingsRef, { lastAttemptDate: today, processingAt: nowIso() }, { merge: true });
    return true;
  });
  if (!claimed) return 0;

  const topics = [
    'como estruturar um calendário editorial que realmente ajuda a vender',
    'como usar inteligência artificial no marketing sem perder a identidade da marca',
    'SEO para pequenas empresas: fundamentos que continuam importantes',
    'como transformar diferenciais da empresa em conteúdo persuasivo',
    'automação de marketing com aprovação humana: quando usar cada modo',
    'como medir se uma campanha de conteúdo está ajudando o negócio',
    'boas práticas para reutilizar conteúdo entre redes sociais sem parecer repetitivo'
  ];
  const index = Math.floor(Date.now() / 86_400_000) % topics.length;
  try {
    const generated = await generatePlatformArticle(topics[index]);
    const article = generated.article || {};
    const id = newId('blog');
    const slugBase = String(article.suggestedSlug || article.title || topics[index]);
    const slug = `${slugBase.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)}-${today.replace(/-/g,'')}`;
    const post = {
      id, title: String(article.title || 'Froc Magazine').slice(0, 180), slug,
      summary: String(article.summary || article.metaDescription || '').slice(0, 500),
      content: String(article.content || '').slice(0, 120_000), featuredImageUrl: '', author: config.blog.author,
      category: String(article.category || 'Marketing & IA').slice(0, 100),
      tags: Array.isArray(article.tags) ? article.tags.slice(0, 12).map((x:any)=>String(x).slice(0,80)) : ['Marketing','IA'],
      seoTitle: String(article.title || '').slice(0, 70), seoDescription: String(article.metaDescription || article.summary || '').slice(0, 180),
      status: 'published', publishedAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso(), generatedBy: 'froc_auto_blog', modelUsed: generated.modelUsed
    };
    if (!post.title || !post.content) throw new Error('A IA não retornou artigo completo.');
    await db.collection(COLLECTIONS.blogPosts).doc(id).set(post);
    await settingsRef.set({ lastPublishedDate: today, lastPublishedPostId: id, completedAt: nowIso(), lastError: null }, { merge: true });
    return 1;
  } catch (error) {
    await settingsRef.set({ lastError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), failedAt: nowIso() }, { merge: true });
    return 0;
  }
}

export async function processSchedulerTick() {
  if (!(await acquireLock())) return { skipped: true, reason: 'Outro ciclo já está em execução.' };
  try {
    const releasedReservations = await cleanupStaleReservations(30);
    const scheduledPosts = await processScheduledPosts();
    const autopilot = await processAutopilot();
    const autoBlog = await processAutoBlog();
    return { skipped: false, releasedReservations, scheduledPosts, autopilot, autoBlog, processedAt: nowIso() };
  } finally {
    await releaseLock();
  }
}
