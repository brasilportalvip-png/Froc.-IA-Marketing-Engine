import { config } from '../config/index.js';
import { generateAutopilotPost, generatePlatformArticle, generatePost, processPendingVideoJobs } from './ai.js';
import { cleanupStaleReservations, getEffectiveWallet, getWallet } from './credits.js';
import { getPlanEntitlements } from './plans.js';
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

export interface AutopilotScheduleConfig {
  enabled?: boolean;
  frequency?: 'daily' | '3_times_week' | 'weekly';
  timezone?: string;
  preferredDays?: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
  preferredHours?: number[]; // 0..23
  lastRunAt?: string | null;
  lastRunSlot?: string | null;
}

export function getLocalDateAndHour(date: Date, timezone: string): { dayOfWeek: number; hour: number; dateStr: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    for (const p of parts) {
      partMap[p.type] = p.value;
    }
    const weekdayMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    const dayOfWeek = weekdayMap[partMap.weekday] ?? date.getUTCDay();
    const hour = parseInt(partMap.hour, 10) % 24;
    const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;
    return { dayOfWeek, hour, dateStr };
  } catch {
    // Fallback seguro em caso de timezone não reconhecida
    const dayOfWeek = date.getUTCDay();
    const hour = date.getUTCHours();
    const dateStr = date.toISOString().slice(0, 10);
    return { dayOfWeek, hour, dateStr };
  }
}

export function isAutopilotDue(config: AutopilotScheduleConfig, referenceDate: Date = new Date()): boolean {
  if (!config.enabled) return false;

  const tz = config.timezone || 'America/Sao_Paulo';
  const { dayOfWeek, hour, dateStr } = getLocalDateAndHour(referenceDate, tz);

  // Validação de dias permitidos (default: Segunda a Sexta [1,2,3,4,5])
  const preferredDays = Array.isArray(config.preferredDays) && config.preferredDays.length > 0
    ? config.preferredDays
    : [1, 2, 3, 4, 5];
  if (!preferredDays.includes(dayOfWeek)) {
    return false;
  }

  // Validação de horários permitidos (default: 10h)
  const preferredHours = Array.isArray(config.preferredHours) && config.preferredHours.length > 0
    ? config.preferredHours
    : [10];
  if (!preferredHours.includes(hour)) {
    return false;
  }

  // Prevenção de execuções duplicadas no mesmo slot
  const currentSlot = `${dateStr}_h${hour}`;
  if (config.lastRunSlot === currentSlot) {
    return false;
  }

  // Verificação de intervalo mínimo por frequência
  if (config.lastRunAt) {
    const lastRunMs = new Date(config.lastRunAt).getTime();
    const elapsedHours = (referenceDate.getTime() - lastRunMs) / 3_600_000;

    if (config.frequency === 'weekly' && elapsedHours < 140) {
      return false; // ~6 dias
    }
    if (config.frequency === '3_times_week' && elapsedHours < 44) {
      return false; // ~2 dias
    }
    if ((config.frequency === 'daily' || !config.frequency) && elapsedHours < 20) {
      return false; // ~1 dia
    }
  }

  return true;
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

export async function processScheduledPosts(): Promise<number> {
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
      // 1. Revalidação de usuário
      const userSnap = await db.collection(COLLECTIONS.users).doc(post.userId).get();
      if (!userSnap.exists) {
        throw new Error('Inconsistência de segurança: Usuário associado ao agendamento não encontrado.');
      }

      // 2. Revalidação de empresa e titularidade multi-tenant
      const companySnap = await db.collection(COLLECTIONS.companies).doc(post.companyId).get();
      if (!companySnap.exists) {
        throw new Error('Inconsistência de segurança: Empresa associada ao agendamento não encontrada.');
      }
      const company = { id: companySnap.id, ...companySnap.data() } as any;
      if (company.userId !== post.userId) {
        throw new Error('Violação de isolamento multi-tenant: Empresa não pertence ao usuário do agendamento.');
      }

      // 3. Revalidação de conteúdo e titularidade
      const contentSnap = await db.collection(COLLECTIONS.contentItems).doc(post.contentItemId).get();
      if (!contentSnap.exists) {
        throw new Error('Inconsistência de segurança: Conteúdo associado não encontrado.');
      }
      const content = { id: contentSnap.id, ...contentSnap.data() } as any;
      if (content.userId !== post.userId || content.companyId !== post.companyId) {
        throw new Error('Violação de isolamento multi-tenant: Conteúdo não pertence ao usuário ou empresa do agendamento.');
      }

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
      const errorMsg = error instanceof Error ? error.message : String(error);
      await doc.ref.update({ status: 'failed', errorMessage: errorMsg, processedAt: nowIso() });
      processed += 1;
    }
  }
  return processed;
}

export async function processAutopilot(): Promise<number> {
  const db = firestore();
  const snap = await db.collection(COLLECTIONS.autopilotConfigs).where('enabled', '==', true).limit(25).get();
  let processed = 0;
  const now = new Date();

  for (const doc of snap.docs) {
    const ap = { id: doc.id, ...doc.data() } as any;
    if (!isAutopilotDue(ap, now)) continue;

    // Validação estrita de entitlements do plano no backend usando plano efetivo fail-closed
    let entitlements = getPlanEntitlements('plan_free');
    try {
      const wallet = await getEffectiveWallet(ap.userId, { failClosed: true });
      entitlements = getPlanEntitlements(wallet.planId);
    } catch (err) {
      console.warn(`[Froc Autopilot] Falha ao obter plano efetivo para usuário ${ap.userId}, cancelando execução:`, err);
      continue;
    }

    if (!entitlements.autopilotManual && !entitlements.autopilotAutomatic) {
      continue;
    }
    if (ap.mode === 'automatic' && !entitlements.autopilotAutomatic) {
      continue;
    }

    const tz = ap.timezone || 'America/Sao_Paulo';
    const { hour, dateStr } = getLocalDateAndHour(now, tz);
    const currentSlot = `${dateStr}_h${hour}`;

    const monthKey = now.toISOString().slice(0, 7);
    const used = ap.usageMonth === monthKey ? Number(ap.usedCreditsThisMonth || 0) : 0;
    if (used + config.creditCosts.autopilot_cycle > Number(ap.maxMonthlyCredits || 0)) {
      await doc.ref.set({ usageMonth: monthKey, usedCreditsThisMonth: used, lastBudgetWarningAt: nowIso() }, { merge: true });
      await createNotification({ userId: ap.userId, title: 'Limite do Autopilot atingido', message: 'O Froc Autopilot pausou novas gerações porque o limite mensal de créditos foi alcançado.', type: 'credit_low' });
      continue;
    }

    const companySnap = await db.collection(COLLECTIONS.companies).doc(ap.companyId).get();
    if (!companySnap.exists) continue;
    const company = { id: companySnap.id, ...companySnap.data() } as any;
    if (company.userId !== ap.userId) {
      console.warn(`[Froc Autopilot] Isolamento violado para config ${doc.id}: empresa ${ap.companyId} não pertence ao usuário ${ap.userId}`);
      continue;
    }

    try {
      const generated = await generateAutopilotPost({ userId: ap.userId, company, topic: `Conteúdo estratégico atual para ${company.name}`, platform: ap.targetPlatforms?.[0] || 'Instagram', goal: ap.primaryGoal || 'Atrair clientes e gerar autoridade' });
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
      await doc.ref.set({
        lastRunAt: nowIso(),
        lastRunSlot: currentSlot,
        usageMonth: monthKey,
        usedCreditsThisMonth: used + generated.creditsUsed,
        updatedAt: nowIso()
      }, { merge: true });
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

export async function triggerUserAutopilot(userId: string, companyId: string): Promise<{
  success: boolean;
  contentId?: string;
  scheduleId?: string;
  mode?: string;
  creditsUsed: number;
  message: string;
}> {
  const db = firestore();
  const companySnap = await db.collection(COLLECTIONS.companies).doc(companyId).get();
  if (!companySnap.exists) {
    throw new Error('Empresa não encontrada.');
  }
  const company = { id: companySnap.id, ...companySnap.data() } as any;
  if (company.userId !== userId) {
    throw new Error('Você não tem permissão para gerenciar esta empresa.');
  }

  const wallet = await getWallet(userId);
  const entitlements = getPlanEntitlements(wallet.planId);
  if (!entitlements.autopilotManual && !entitlements.autopilotAutomatic) {
    const error: any = new Error('O recurso Autopilot não está disponível no seu plano atual. Faça upgrade para o plano PRO ou superior.');
    error.statusCode = 403;
    throw error;
  }

  // Obter ou criar configuração de Autopilot para a empresa usando ID padronizado ${userId}_${companyId}
  const canonicalId = `${userId}_${companyId}`;
  let apConfigSnap = await db.collection(COLLECTIONS.autopilotConfigs).doc(canonicalId).get();
  if (!apConfigSnap.exists) {
    // Tenta carregar fallback legado por companyId se existir
    const legacySnap = await db.collection(COLLECTIONS.autopilotConfigs).doc(companyId).get();
    if (legacySnap.exists && legacySnap.data()?.userId === userId) {
      apConfigSnap = legacySnap;
    }
  }

  const ap = apConfigSnap.exists ? ({ id: apConfigSnap.id, ...apConfigSnap.data() } as any) : {
    id: canonicalId,
    userId,
    companyId,
    enabled: true,
    mode: 'manual_approval',
    frequency: 'daily',
    timezone: 'America/Sao_Paulo',
    preferredDays: [1, 2, 3, 4, 5],
    preferredHours: [10, 15, 19],
    maxMonthlyCredits: 500,
    targetPlatforms: ['Instagram'],
    primaryGoal: 'Atrair clientes e gerar autoridade'
  };

  if (ap.mode === 'automatic' && !entitlements.autopilotAutomatic) {
    const error: any = new Error('Modo automático do Autopilot exclusivo para os planos BUSINESS e AGENCY. Altere para aprovação manual ou faça upgrade.');
    error.statusCode = 403;
    throw error;
  }

  const monthKey = new Date().toISOString().slice(0, 7);
  const used = ap.usageMonth === monthKey ? Number(ap.usedCreditsThisMonth || 0) : 0;
  if (used + config.creditCosts.autopilot_cycle > Number(ap.maxMonthlyCredits || 500)) {
    throw new Error('Limite mensal de créditos do Autopilot atingido para esta empresa. Aumente o teto de créditos nas configurações.');
  }

  const generated = await generateAutopilotPost({
    userId,
    company,
    topic: `Conteúdo estratégico prioritário para ${company.name}`,
    platform: ap.targetPlatforms?.[0] || 'Instagram',
    goal: ap.primaryGoal || 'Atrair clientes e gerar autoridade'
  });

  const contentId = newId('content');
  const content = {
    id: contentId,
    userId,
    companyId,
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

  let scheduleId: string | undefined;
  if (ap.mode === 'automatic') {
    scheduleId = newId('sched');
    const scheduledFor = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await db.collection(COLLECTIONS.scheduledPosts).doc(scheduleId).set({
      id: scheduleId,
      userId,
      companyId,
      contentItemId: contentId,
      platforms: ap.targetPlatforms || ['Instagram'],
      scheduledFor,
      status: 'scheduled',
      autopilotGenerated: true,
      createdAt: nowIso()
    });
  }

  const tz = ap.timezone || 'America/Sao_Paulo';
  const { hour, dateStr } = getLocalDateAndHour(new Date(), tz);
  const currentSlot = `${dateStr}_h${hour}`;

  await db.collection(COLLECTIONS.autopilotConfigs).doc(canonicalId).set({
    ...ap,
    id: canonicalId,
    userId,
    companyId,
    lastRunAt: nowIso(),
    lastRunSlot: currentSlot,
    usageMonth: monthKey,
    usedCreditsThisMonth: used + generated.creditsUsed,
    lastGeneratedContentId: contentId,
    lastError: null,
    updatedAt: nowIso()
  }, { merge: true });

  await createNotification({
    userId,
    title: 'Froc Autopilot executado',
    message: `Conteúdo gerado com sucesso para ${company.name}${ap.mode === 'automatic' ? ' e agendado.' : ' e pronto para revisão.'}`,
    type: 'autopilot_ready'
  });

  return {
    success: true,
    contentId,
    scheduleId,
    mode: ap.mode || 'review',
    creditsUsed: generated.creditsUsed,
    message: ap.mode === 'automatic' ? 'Conteúdo gerado e agendado automaticamente.' : 'Conteúdo gerado com sucesso e salvo para aprovação.'
  };
}

export async function processSchedulerTick() {
  if (!(await acquireLock())) return { skipped: true, reason: 'Outro ciclo já está em execução.' };
  try {
    const releasedReservations = await cleanupStaleReservations(30);
    const videoJobs = await processPendingVideoJobs();
    const scheduledPosts = await processScheduledPosts();
    const autopilot = await processAutopilot();
    const autoBlog = await processAutoBlog();
    return { skipped: false, releasedReservations, videoJobs, scheduledPosts, autopilot, autoBlog, processedAt: nowIso() };
  } finally {
    await releaseLock();
  }
}

