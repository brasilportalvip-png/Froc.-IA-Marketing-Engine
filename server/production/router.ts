import { Router, type Request, type Response } from 'express';
import { getAdminAuth, getAdminStorage } from '../providers/firebaseAdmin.js';
import { config } from '../config/index.js';
import { AuthenticatedRequest, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, ensureUserProfile, requireAdmin, requireAuth } from './auth.js';
import { addCredits, getWallet, listCreditTransactions } from './credits.js';
import { evaluateSignupBonusEligibility } from './antiAbuse.js';
import { generateArticle, generateCarousel, generateCopy, generateImagePrompt, generateMarketingImage, generatePlatformArticle, generatePost, generateStrategy, generateVideoScript } from './ai.js';
import { analyzeSeo } from './seo.js';
import { cancelSubscription, createCheckout, listUserSubscriptions, mercadoPagoConfigured, processMercadoPagoWebhook } from './payments.js';
import { createOAuthUrl, disconnectSocial, handleOAuthCallback, listConnections, type SocialProvider } from './social.js';
import { processSchedulerTick, triggerUserAutopilot } from './scheduler.js';
import { COLLECTIONS, checkDatabaseHealth, cleanObject, createNotification, firestore, newId, nowIso, queryData, slugify, writeAdminLog } from './store.js';

const router = Router();

type AsyncHandler = (req: any, res: Response) => Promise<any>;
const asyncRoute = (handler: AsyncHandler) => async (req: Request, res: Response) => {
  try {
    await handler(req, res);
  } catch (error: any) {
    const status = Number(error?.statusCode || error?.status || (error instanceof RangeError ? 400 : 500));
    if (status >= 500) console.error('[Froc API]', error);
    res.status(status).json({ error: error?.message || 'Erro interno no Froc.IA.' });
  }
};

function safeString(value: any, max = 5000): string {
  return String(value ?? '').trim().slice(0, max);
}

function stringArray(value: any, max = 50): string[] {
  if (!Array.isArray(value)) return value ? [safeString(value)] : [];
  return value.slice(0, max).map((item) => safeString(item, 300)).filter(Boolean);
}

function safeHttpUrl(value: any, max = 1500): string {
  const raw = safeString(value, max);
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function safeEmail(value: any): string {
  const raw = safeString(value, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : '';
}

function sanitizedSocialLinks(value: any): Record<string, string> {
  const allowed = ['instagram','facebook','tiktok','youtube','linkedin','pinterest','x'];
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const url = safeHttpUrl(value[key], 1000);
    if (url) out[key] = url;
  }
  return out;
}

function normalizeCompanyField(key: string, value: any): any {
  if (['website','androidApp','iosApp','logoUrl'].includes(key)) return safeHttpUrl(value);
  if (key === 'email') return safeEmail(value);
  if (key === 'businessType') {
    const raw = safeString(value, 30).toLowerCase();
    return ['online', 'physical', 'hybrid'].includes(raw) ? raw : 'online';
  }
  if (key === 'onlineChannels') return stringArray(value);
  if (key === 'socialLinks') return sanitizedSocialLinks(value);
  if (['products','services','competitors','keywords'].includes(key)) return stringArray(value);
  if (key === 'isPublicInVitrine') return Boolean(value);
  if (key === 'marketingProfile') return value && typeof value === 'object' ? cleanObject(value) : undefined;
  const limits: Record<string, number> = { name:120, description:5000, phone:80, whatsapp:80, address:500, city:150, state:100, country:100, category:150, segment:200, targetAudience:3000, coverageRegion:500, differentials:3000, brandTone:500, goals:2000 };
  return safeString(value, limits[key] || 1000);
}

export async function ownedCompany(userId: string, companyId?: string): Promise<any | undefined> {
  if (!companyId) return undefined;
  const snap = await firestore().collection(COLLECTIONS.companies).doc(companyId).get();
  if (!snap.exists) return undefined;
  const data = { id: snap.id, ...snap.data() } as any;
  return data.userId === userId ? data : undefined;
}

export async function requireOwnedCompany(userId: string, companyId: string): Promise<any> {
  const company = await ownedCompany(userId, companyId);
  if (!company) {
    const error: any = new Error('Empresa não encontrada ou sem permissão.');
    error.statusCode = 404;
    throw error;
  }
  return company;
}

async function deleteCompanyData(userId: string, companyId: string): Promise<void> {
  const db = firestore();
  const collections = [COLLECTIONS.contentItems, COLLECTIONS.campaigns, COLLECTIONS.scheduledPosts, COLLECTIONS.socialConnections, COLLECTIONS.seoReports, COLLECTIONS.autopilotConfigs];
  for (const collection of collections) {
    while (true) {
      const snap = await db.collection(collection).where('userId', '==', userId).where('companyId', '==', companyId).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const doc of snap.docs) {
        const data = doc.data() as any;
        if (collection === COLLECTIONS.contentItems && data?.metadata?.storagePath) {
          await getAdminStorage().bucket().file(String(data.metadata.storagePath)).delete({ ignoreNotFound: true }).catch(() => undefined);
        }
        batch.delete(doc.ref);
      }
      await batch.commit();
      if (snap.size < 400) break;
    }
  }
}

function planCompanyLimit(planId: string): number {
  if (planId === 'plan_free' || !planId) return 1;
  if (planId === 'plan_start') return 2;
  if (planId === 'plan_pro') return 5;
  if (planId === 'plan_business') return 15;
  if (planId === 'plan_agency') return 50;
  return 1;
}

function contentBodyFromArticle(article: any): string {
  const parts = [`# ${article.title || ''}`, article.introduction || ''];
  for (const section of article.sections || []) {
    parts.push(`## ${section.h2 || ''}`, section.content || '');
    for (const sub of section.h3s || []) parts.push(`### ${sub.h3 || ''}`, sub.content || '');
  }
  if (article.faqSection?.length) {
    parts.push('## Perguntas Frequentes');
    for (const faq of article.faqSection) parts.push(`### ${faq.question || ''}`, faq.answer || '');
  }
  parts.push('## Conclusão', article.conclusion || '', article.callToAction || '');
  return parts.filter(Boolean).join('\n\n');
}

// Health
router.get('/health', asyncRoute(async (_req, res) => {
  const dbHealth = checkDatabaseHealth();
  const statusCode = dbHealth.status === 'healthy' ? 200 : dbHealth.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json({
    status: dbHealth.status === 'healthy' ? 'ok' : dbHealth.status,
    service: 'Froc.IA API',
    database: dbHealth,
    environment: config.nodeEnv,
    timestamp: nowIso()
  });
}));

// Authentication/profile. Password lifecycle remains in Firebase Auth client.
router.post('/auth/sync-profile', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const now = nowIso();
  const name = safeString(req.body?.name, 120);
  const hasTerms = Boolean(req.user?.termsAcceptedAt || req.body?.termsAccepted);
  const hasPrivacy = Boolean(req.user?.privacyAcceptedAt || req.body?.privacyAccepted);
  if (!hasTerms || !hasPrivacy) {
    return res.status(428).json({
      error: 'Para ativar sua conta, aceite os Termos de Uso e a Política de Privacidade no cadastro.'
    });
  }

  // O servidor é a autoridade máxima sobre a versão legal vigente
  const termsAcceptedAt = req.user?.termsAcceptedAt || now;
  const privacyAcceptedAt = req.user?.privacyAcceptedAt || now;
  const termsVersion = req.user?.termsVersion === CURRENT_TERMS_VERSION ? CURRENT_TERMS_VERSION : CURRENT_TERMS_VERSION;
  const privacyVersion = req.user?.privacyVersion === CURRENT_PRIVACY_VERSION ? CURRENT_PRIVACY_VERSION : CURRENT_PRIVACY_VERSION;

  const profile = await ensureUserProfile(req.firebaseUser!, {
    name: name || req.user?.name,
    termsAcceptedAt,
    privacyAcceptedAt,
    termsVersion,
    privacyVersion,
    avatarUrl: safeString(req.body?.avatarUrl, 1000) || req.user?.avatarUrl
  });

  const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = safeString(req.headers['user-agent'], 300);

  // Avaliação rigorosa anti-abuso e anti-multicontas para concessão de bônus
  const outcome = await evaluateSignupBonusEligibility({
    userId: profile.id,
    email: profile.email,
    ip: clientIp,
    userAgent,
    securityPayload: req.body?.securityPayload
  });

  let wallet;
  if (outcome.eligibleForBonus && outcome.bonusAmount > 0) {
    try {
      wallet = await addCredits({
        userId: profile.id,
        amount: outcome.bonusAmount,
        type: 'bonus',
        source: 'Bônus de Primeiro Cadastro Froc.IA',
        idempotencyKey: `welcome:${profile.id}`,
        metadata: { reason: outcome.reason, detail: outcome.detail, claimId: outcome.claimId }
      });
    } catch (err) {
      console.error('[AuthSync] Erro ao conceder bônus de boas-vindas:', err);
      wallet = await getWallet(profile.id);
    }
  } else {
    // Conta criada sem bônus (0 créditos) por detecção de duplicidade/multiconta/e-mail temporário
    wallet = await getWallet(profile.id);
  }

  res.json({
    user: profile,
    wallet,
    security: {
      bonusEligible: outcome.eligibleForBonus,
      bonusAmount: outcome.bonusAmount,
      reason: outcome.reason,
      message: outcome.detail
    }
  });
}));

router.post('/auth/accept-terms', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const termsAccepted = Boolean(req.body?.termsAccepted);
  const privacyAccepted = Boolean(req.body?.privacyAccepted);
  if (!termsAccepted || !privacyAccepted) {
    return res.status(400).json({ error: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade.' });
  }

  // O backend é a fonte de verdade para as versões legais vigentes (não aceita versão inventada/falsificada pelo cliente)
  const now = nowIso();

  const profile = await ensureUserProfile(req.firebaseUser!, {
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });

  res.json({
    message: 'Termos de Uso e Política de Privacidade aceitos com sucesso.',
    user: profile,
    wallet: await getWallet(profile.id)
  });
}));

router.get('/auth/me', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user, wallet: await getWallet(req.user!.id) });
}));

router.patch('/auth/profile', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const name = safeString(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  await firestore().collection(COLLECTIONS.users).doc(req.user!.id).set({ name, updatedAt: nowIso() }, { merge: true });
  await getAdminAuth().updateUser(req.user!.id, { displayName: name });
  const fresh = await firestore().collection(COLLECTIONS.users).doc(req.user!.id).get();
  res.json({ message: 'Perfil atualizado com sucesso.', user: { id: fresh.id, ...fresh.data() } });
}));

router.post('/auth/bootstrap-admin', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!config.adminBootstrapKey || safeString(req.body?.secretKey, 500) !== config.adminBootstrapKey) return res.status(403).json({ error: 'Chave de bootstrap inválida.' });
  await getAdminAuth().setCustomUserClaims(req.user!.id, { role: 'admin', frocRole: 'admin' });
  await firestore().collection(COLLECTIONS.users).doc(req.user!.id).set({ role: 'admin', updatedAt: nowIso() }, { merge: true });
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'bootstrap_admin', targetUserId: req.user!.id });
  res.json({ message: 'Administrador configurado. Renove a sessão para atualizar as permissões.', role: 'admin' });
}));

// Dashboard status
router.get('/dashboard/status', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.query.companyId, 200);
  const [seoSnap, socialSnap] = await Promise.all([
    firestore().collection(COLLECTIONS.seoReports).where('userId','==',req.user!.id).get(),
    firestore().collection(COLLECTIONS.socialConnections).where('userId','==',req.user!.id).get()
  ]);
  const seoReports = queryData<any>(seoSnap).filter(x=>!companyId||x.companyId===companyId);
  const socialConnections = queryData<any>(socialSnap).filter(x=>(!companyId||x.companyId===companyId)&&x.status==='connected');
  res.json({ hasSeoAudit:seoReports.length>0, connectedSocialCount:socialConnections.length, seoReportsCount:seoReports.length });
}));

// Companies
router.get('/companies', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const snap = await firestore().collection(COLLECTIONS.companies).where('userId', '==', req.user!.id).get();
  const companies = queryData<any>(snap).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ companies });
}));

router.post('/companies', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const name = safeString(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: 'O nome da empresa é obrigatório.' });
  const current = await firestore().collection(COLLECTIONS.companies).where('userId', '==', req.user!.id).get();
  const wallet = await getWallet(req.user!.id);
  if (current.size >= planCompanyLimit(wallet.planId)) return res.status(403).json({ error: 'Seu plano atingiu o limite de empresas. Faça upgrade para cadastrar outra marca.' });
  const id = newId('company');
  const baseSlug = slugify(name);
  const slug = `${baseSlug}-${id.slice(-6)}`;
  const company = cleanObject({
    id,
    userId: req.user!.id,
    name,
    slug,
    businessType: normalizeCompanyField('businessType', req.body?.businessType || 'online'),
    onlineChannels: stringArray(req.body?.onlineChannels),
    logoUrl: safeHttpUrl(req.body?.logoUrl, 1500),
    description: safeString(req.body?.description, 5000),
    website: safeHttpUrl(req.body?.website, 1000),
    androidApp: safeHttpUrl(req.body?.androidApp, 1000),
    iosApp: safeHttpUrl(req.body?.iosApp, 1000),
    phone: safeString(req.body?.phone, 80),
    whatsapp: safeString(req.body?.whatsapp, 80),
    email: safeEmail(req.body?.email),
    address: safeString(req.body?.address, 500),
    city: safeString(req.body?.city, 150),
    state: safeString(req.body?.state, 100),
    country: safeString(req.body?.country, 100) || 'Brasil',
    category: safeString(req.body?.category, 150) || 'Comércio & Serviços',
    segment: safeString(req.body?.segment, 200),
    products: stringArray(req.body?.products),
    services: stringArray(req.body?.services),
    targetAudience: safeString(req.body?.targetAudience, 3000),
    coverageRegion: safeString(req.body?.coverageRegion, 500),
    differentials: safeString(req.body?.differentials, 3000),
    brandTone: safeString(req.body?.brandTone, 500),
    goals: safeString(req.body?.goals, 2000),
    competitors: stringArray(req.body?.competitors),
    keywords: stringArray(req.body?.keywords),
    socialLinks: sanitizedSocialLinks(req.body?.socialLinks),
    isPublicInVitrine: Boolean(req.body?.isPublicInVitrine),
    marketingProfile: req.body?.marketingProfile && typeof req.body.marketingProfile === 'object' ? req.body.marketingProfile : undefined,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  await firestore().collection(COLLECTIONS.companies).doc(id).set(company);
  res.status(201).json({ message: 'Empresa cadastrada com sucesso.', company });
}));

router.get('/companies/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  res.json({ company: await requireOwnedCompany(req.user!.id, req.params.id) });
}));

router.patch('/companies/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const current = await requireOwnedCompany(req.user!.id, req.params.id);
  const allowed = ['name','businessType','onlineChannels','logoUrl','description','website','androidApp','iosApp','phone','whatsapp','email','address','city','state','country','category','segment','products','services','targetAudience','coverageRegion','differentials','brandTone','goals','competitors','keywords','socialLinks','isPublicInVitrine','marketingProfile'];
  const patch: Record<string, any> = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = normalizeCompanyField(key, req.body[key]);
  if (patch.name && patch.name !== current.name) patch.slug = `${slugify(safeString(patch.name, 120))}-${req.params.id.slice(-6)}`;
  patch.updatedAt = nowIso();
  await firestore().collection(COLLECTIONS.companies).doc(req.params.id).set(cleanObject(patch), { merge: true });
  const snap = await firestore().collection(COLLECTIONS.companies).doc(req.params.id).get();
  res.json({ message: 'Empresa atualizada com sucesso.', company: { id: snap.id, ...snap.data() } });
}));

router.post('/companies/:id/logo', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const company = await requireOwnedCompany(req.user!.id, req.params.id);
  const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ error: 'Envie uma imagem PNG, JPG ou WEBP válida.' });
  if (dataUrl.length > 1_900_000) return res.status(413).json({ error: 'A logo deve ter no máximo aproximadamente 1,3 MB.' });
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 1_400_000) return res.status(413).json({ error: 'A logo é muito grande.' });
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `companies/${req.user!.id}/${req.params.id}/logo.${ext}`;
  const token = newId('download');
  const bucket = getAdminStorage().bucket();
  const file = bucket.file(storagePath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      cacheControl: 'public,max-age=86400',
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  if (company.logoStoragePath && company.logoStoragePath !== storagePath) {
    await bucket.file(String(company.logoStoragePath)).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
  const logoUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
  await firestore().collection(COLLECTIONS.companies).doc(req.params.id).set({ logoUrl, logoStoragePath: storagePath, updatedAt: nowIso() }, { merge: true });
  res.json({ message: 'Logo atualizada.', logoUrl, logoStoragePath: storagePath });
}));

router.delete('/companies/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const company = await requireOwnedCompany(req.user!.id, req.params.id);
  if (company.logoStoragePath) await getAdminStorage().bucket().file(String(company.logoStoragePath)).delete({ ignoreNotFound: true }).catch(() => undefined);
  await deleteCompanyData(req.user!.id, req.params.id);
  await firestore().collection(COLLECTIONS.companies).doc(req.params.id).delete();
  res.json({ message: 'Empresa removida com sucesso.' });
}));

// Credits
router.get('/credits/balance', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => res.json({ wallet: await getWallet(req.user!.id) })));
router.get('/credits/transactions', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => res.json({ transactions: await listCreditTransactions(req.user!.id, Number(req.query.limit || 50)) })));
router.get('/credits/history', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => res.json({ transactions: await listCreditTransactions(req.user!.id, Number(req.query.limit || 50)) })));

// AI
router.get('/ai/costs', (_req, res) => res.json({ costs: config.creditCosts }));

router.post('/ai/generate-post', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const topic = safeString(req.body?.topic, 5000);
  if (!topic) return res.status(400).json({ error: 'O tema do post é obrigatório.' });
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  const generated = await generatePost({ userId: req.user!.id, company, topic, platform: safeString(req.body?.platform, 100), goal: safeString(req.body?.goal, 1000), tone: safeString(req.body?.tone, 500) });
  const id = newId('content');
  const contentItem = { id, userId: req.user!.id, companyId: company?.id || 'default', type: 'post', title: generated.result.headline, headline: generated.result.headline, body: generated.result.body, cta: generated.result.cta, hashtags: generated.result.hashtags || [], keywords: generated.result.keywords || [], visualPrompt: generated.result.visualPrompt || '', targetPlatform: safeString(req.body?.platform, 100) || 'Instagram', tone: safeString(req.body?.tone, 500), creditsUsed: generated.creditsUsed, status: 'saved', createdAt: nowIso(), updatedAt: nowIso() };
  await firestore().collection(COLLECTIONS.contentItems).doc(id).set(contentItem);
  res.json({ post: generated.result, contentItem, creditsUsed: generated.creditsUsed, modelUsed: generated.modelUsed });
}));

router.post('/ai/generate-strategy', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'Selecione uma empresa.' });
  const company = await requireOwnedCompany(req.user!.id, companyId);
  const generated = await generateStrategy({ userId: req.user!.id, company, timeframe: req.body?.timeframe === 'mes' ? 'mes' : 'semana', goal: safeString(req.body?.goal, 5000) });
  res.json({ strategy: generated.result, creditsUsed: generated.creditsUsed, modelUsed: generated.modelUsed });
}));

router.post('/ai/generate-copy', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const prompt = safeString(req.body?.prompt, 5000);
  if (!prompt) return res.status(400).json({ error: 'A instrução é obrigatória.' });
  const type = ['cta','headline','caption','variations'].includes(req.body?.type) ? req.body.type : 'caption';
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  const generated = await generateCopy({ userId: req.user!.id, company, type, prompt });
  res.json({ text: generated.result, creditsUsed: generated.creditsUsed, modelUsed: generated.modelUsed });
}));

router.post('/ai/generate-carousel', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const topic = safeString(req.body?.topic, 5000);
  if (!topic) return res.status(400).json({ error: 'O tema é obrigatório.' });
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  const generated = await generateCarousel({ userId: req.user!.id, company, topic, slidesCount: Number(req.body?.slidesCount || 5), goal: safeString(req.body?.goal, 2000) });
  const id = newId('content');
  const item = { id, userId: req.user!.id, companyId: company?.id || 'default', type: 'carousel', title: generated.result.carouselTitle || `Carrossel: ${topic}`, headline: generated.result.carouselTitle || '', body: generated.result.caption || '', carouselSlides: generated.result.slides || [], hashtags: generated.result.hashtags || [], keywords: [], creditsUsed: generated.creditsUsed, status: 'saved', targetPlatform: 'Instagram', createdAt: nowIso(), updatedAt: nowIso() };
  await firestore().collection(COLLECTIONS.contentItems).doc(id).set(item);
  res.json({ carousel: generated.result, contentItem: item, creditsUsed: generated.creditsUsed });
}));

router.post('/ai/generate-video-script', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const topic = safeString(req.body?.topic, 5000);
  if (!topic) return res.status(400).json({ error: 'O tema do vídeo é obrigatório.' });
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  const generated = await generateVideoScript({ userId: req.user!.id, company, topic, durationSeconds: Number(req.body?.durationSeconds || 60), format: safeString(req.body?.format, 200) });
  const id = newId('content');
  const item = { id, userId: req.user!.id, companyId: company?.id || 'default', type: 'video_script', title: generated.result.scriptTitle || `Roteiro: ${topic}`, headline: generated.result.scriptTitle || '', body: generated.result.caption || '', videoScript: JSON.stringify(generated.result.scenes || []), cta: generated.result.callToAction || '', hashtags: generated.result.hashtags || [], keywords: [], creditsUsed: generated.creditsUsed, status: 'saved', targetPlatform: 'Reels / TikTok / Shorts', createdAt: nowIso(), updatedAt: nowIso() };
  await firestore().collection(COLLECTIONS.contentItems).doc(id).set(item);
  res.json({ videoScript: generated.result, script: generated.result, contentItem: item, creditsUsed: generated.creditsUsed });
}));

router.post('/ai/generate-image-prompt', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const theme = safeString(req.body?.theme, 5000);
  if (!theme) return res.status(400).json({ error: 'A ideia ou tema da imagem é obrigatório.' });
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  const generated = await generateImagePrompt({ userId: req.user!.id, company, theme, style: safeString(req.body?.style, 2000) });
  res.json({ imagePrompt: generated.result, creditsUsed: generated.creditsUsed });
}));

router.post('/ai/generate-image', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const theme = safeString(req.body?.theme, 5000);
  if (!theme) return res.status(400).json({ error: 'A ideia ou tema da imagem é obrigatório.' });
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  const generated = await generateMarketingImage({
    userId: req.user!.id,
    company,
    theme,
    style: safeString(req.body?.style, 3000),
    aspectRatio: safeString(req.body?.aspectRatio, 20)
  });
  const id = newId('content');
  const item = {
    id, userId: req.user!.id, companyId: company?.id || 'default', type: 'image',
    title: safeString(req.body?.title, 300) || `Imagem IA - ${theme.slice(0, 80)}`,
    body: theme, hashtags: [], keywords: [], imageUrl: generated.imageUrl,
    visualPrompt: safeString(req.body?.style, 3000), creditsUsed: generated.creditsUsed,
    status: 'saved', createdAt: nowIso(), updatedAt: nowIso(),
    metadata: { storagePath: generated.storagePath, mimeType: generated.mimeType, modelUsed: generated.modelUsed }
  };
  await firestore().collection(COLLECTIONS.contentItems).doc(id).set(cleanObject(item));
  res.json({ image: generated, imageUrl: generated.imageUrl, contentItem: item, creditsUsed: generated.creditsUsed });
}));

router.post('/ai/generate-article', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const topic = safeString(req.body?.topic, 5000);
  if (!topic) return res.status(400).json({ error: 'O tema do artigo é obrigatório.' });
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  const generated = await generateArticle({ userId: req.user!.id, company, topic, primaryKeyword: safeString(req.body?.primaryKeyword, 500), targetAudience: safeString(req.body?.targetAudience, 1000), tone: safeString(req.body?.tone, 500) });
  const id = newId('content');
  const item = { id, userId: req.user!.id, companyId: company?.id || 'default', type: 'article', title: generated.result.title || topic, headline: generated.result.title || topic, body: contentBodyFromArticle(generated.result), cta: generated.result.callToAction || '', hashtags: [], keywords: [safeString(req.body?.primaryKeyword, 500) || topic], creditsUsed: generated.creditsUsed, status: 'saved', createdAt: nowIso(), updatedAt: nowIso(), metadata: { metaDescription: generated.result.metaDescription, suggestedSlug: generated.result.suggestedSlug } };
  await firestore().collection(COLLECTIONS.contentItems).doc(id).set(item);
  res.json({ article: generated.result, contentItem: item, creditsUsed: generated.creditsUsed });
}));

// SEO
router.post('/seo/analyze', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const url = safeString(req.body?.url, 2000);
  if (!url) return res.status(400).json({ error: 'Informe a URL.' });
  const company = await ownedCompany(req.user!.id, safeString(req.body?.companyId, 200));
  res.json({ report: await analyzeSeo({ userId: req.user!.id, rawUrl: url, company }) });
}));

// Content library + calendar
router.get('/content', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  let query: any = firestore().collection(COLLECTIONS.contentItems).where('userId', '==', req.user!.id);
  if (req.query.companyId) query = query.where('companyId', '==', String(req.query.companyId));
  const items = queryData<any>(await query.get()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ contents: items, items });
}));

router.post('/content', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const title = safeString(req.body?.title, 500);
  const body = safeString(req.body?.body, 100_000);
  if (!title || !body) return res.status(400).json({ error: 'Título e conteúdo são obrigatórios.' });
  const companyId = safeString(req.body?.companyId, 200) || 'default';
  if (companyId !== 'default') await requireOwnedCompany(req.user!.id, companyId);
  const id = newId('content');
  const item = cleanObject({ id, userId: req.user!.id, companyId, type: safeString(req.body?.type, 50) || 'post', title, headline: safeString(req.body?.headline, 1000), body, cta: safeString(req.body?.cta, 2000), hashtags: stringArray(req.body?.hashtags), keywords: stringArray(req.body?.keywords), targetPlatform: safeString(req.body?.targetPlatform, 100), visualPrompt: safeString(req.body?.visualPrompt, 5000), imageUrl: safeString(req.body?.imageUrl, 1500), creditsUsed: 0, status: 'saved', createdAt: nowIso(), updatedAt: nowIso() });
  await firestore().collection(COLLECTIONS.contentItems).doc(id).set(item);
  res.status(201).json({ item, contentItem: item });
}));

router.post('/content/schedule', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const contentItemId = safeString(req.body?.contentItemId, 200);
  const scheduledFor = safeString(req.body?.scheduledFor, 100);
  const companyId = safeString(req.body?.companyId, 200);
  if (!contentItemId || !scheduledFor || !companyId) return res.status(400).json({ error: 'Empresa, conteúdo e data são obrigatórios.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const itemSnap = await firestore().collection(COLLECTIONS.contentItems).doc(contentItemId).get();
  if (!itemSnap.exists || itemSnap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Conteúdo não encontrado.' });
  if (Number.isNaN(new Date(scheduledFor).getTime())) return res.status(400).json({ error: 'Data de agendamento inválida.' });
  const id = newId('sched');
  const scheduled = { id, userId: req.user!.id, companyId, contentItemId, platforms: stringArray(req.body?.platforms, 10), scheduledFor: new Date(scheduledFor).toISOString(), status: 'scheduled', autopilotGenerated: Boolean(req.body?.autopilotGenerated), createdAt: nowIso() };
  await firestore().collection(COLLECTIONS.scheduledPosts).doc(id).set(scheduled);
  await itemSnap.ref.set({ status: 'scheduled', updatedAt: nowIso() }, { merge: true });
  res.status(201).json({ message: 'Publicação agendada.', scheduled });
}));

async function scheduledForUser(userId: string, companyId?: string) {
  let query: any = firestore().collection(COLLECTIONS.scheduledPosts).where('userId', '==', userId);
  if (companyId) query = query.where('companyId', '==', companyId);
  return queryData<any>(await query.get()).sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
}

router.get('/content/scheduled', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const scheduledPosts = await scheduledForUser(req.user!.id, req.query.companyId ? String(req.query.companyId) : undefined);
  res.json({ scheduledPosts, scheduled: scheduledPosts });
}));

router.get('/content/calendar', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
  const scheduled = await scheduledForUser(req.user!.id, companyId);
  let query: any = firestore().collection(COLLECTIONS.contentItems).where('userId', '==', req.user!.id);
  if (companyId) query = query.where('companyId', '==', companyId);
  const items = queryData<any>(await query.get());
  res.json({ scheduled, scheduledPosts: scheduled, items, contents: items });
}));

router.post('/content/scheduled/:id/retry', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.scheduledPosts).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  const current = snap.data() as any;
  if (!['failed', 'cancelled'].includes(current.status)) return res.status(409).json({ error: 'Somente publicações com falha ou canceladas podem ser reenviadas.' });
  const when = req.body?.scheduledFor ? new Date(String(req.body.scheduledFor)) : new Date(Date.now() + 60_000);
  if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Data de reenvio inválida.' });
  await ref.set({ status: 'scheduled', scheduledFor: when.toISOString(), errorMessage: null, publicationResults: [], retryCount: Number(current.retryCount || 0) + 1, updatedAt: nowIso() }, { merge: true });
  res.json({ message: 'Publicação reagendada para nova tentativa.' });
}));

router.post('/content/scheduled/:id/cancel', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.scheduledPosts).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (!['scheduled', 'failed'].includes(String(snap.data()?.status))) return res.status(409).json({ error: 'Este agendamento não pode mais ser cancelado.' });
  await ref.set({ status: 'cancelled', cancelledAt: nowIso(), updatedAt: nowIso() }, { merge: true });
  res.json({ message: 'Agendamento cancelado.' });
}));

router.delete('/content/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.contentItems).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Conteúdo não encontrado.' });
  const item = snap.data() as any;
  if (item?.metadata?.storagePath) await getAdminStorage().bucket().file(String(item.metadata.storagePath)).delete({ ignoreNotFound: true }).catch(() => undefined);
  await ref.delete();
  res.json({ message: 'Conteúdo removido.' });
}));

// Campaigns
router.get('/campaigns', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  let query: any = firestore().collection(COLLECTIONS.campaigns).where('userId', '==', req.user!.id);
  if (req.query.companyId) query = query.where('companyId', '==', String(req.query.companyId));
  const campaigns = queryData<any>(await query.get()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ campaigns });
}));

router.post('/campaigns', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const name = safeString(req.body?.name, 300);
  const companyId = safeString(req.body?.companyId, 200);
  if (!name || !companyId) return res.status(400).json({ error: 'Nome e empresa são obrigatórios.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const id = newId('campaign');
  const campaign = { id, userId: req.user!.id, companyId, name, objective: safeString(req.body?.objective, 3000) || 'Reconhecimento e Conversão', targetPlatforms: stringArray(req.body?.targetPlatforms, 10), targetAudience: safeString(req.body?.targetAudience, 3000), budgetCredits: Math.max(0, Number(req.body?.budgetCredits || 0)), startDate: req.body?.startDate ? new Date(req.body.startDate).toISOString() : nowIso(), endDate: req.body?.endDate ? new Date(req.body.endDate).toISOString() : undefined, status: ['draft','pending','scheduled','active','paused','completed','failed'].includes(req.body?.status) ? req.body.status : 'draft', contentItemIds: stringArray(req.body?.contentItemIds, 200), metrics: { reach: 0, clicks: 0, leads: 0, conversions: 0, shares: 0, comments: 0 }, createdAt: nowIso(), updatedAt: nowIso() };
  await firestore().collection(COLLECTIONS.campaigns).doc(id).set(cleanObject(campaign));
  res.status(201).json({ message: 'Campanha criada.', campaign });
}));

router.patch('/campaigns/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.campaigns).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const patch: Record<string, any> = {};
  if (req.body?.name !== undefined) patch.name = safeString(req.body.name, 300);
  if (req.body?.objective !== undefined) patch.objective = safeString(req.body.objective, 3000);
  if (req.body?.targetPlatforms !== undefined) patch.targetPlatforms = stringArray(req.body.targetPlatforms, 10);
  if (req.body?.targetAudience !== undefined) patch.targetAudience = safeString(req.body.targetAudience, 3000);
  if (req.body?.budgetCredits !== undefined) patch.budgetCredits = Math.max(0, Number(req.body.budgetCredits || 0));
  if (req.body?.startDate !== undefined) patch.startDate = new Date(req.body.startDate).toISOString();
  if (req.body?.endDate !== undefined) patch.endDate = req.body.endDate ? new Date(req.body.endDate).toISOString() : null;
  if (req.body?.status !== undefined) {
    if (!['draft','pending','scheduled','active','paused','completed','failed'].includes(req.body.status)) return res.status(400).json({ error: 'Status de campanha inválido.' });
    patch.status = req.body.status;
  }
  if (req.body?.contentItemIds !== undefined) patch.contentItemIds = stringArray(req.body.contentItemIds, 200);
  patch.updatedAt = nowIso();
  await ref.set(cleanObject(patch), { merge: true });
  const fresh = await ref.get();
  res.json({ message: 'Campanha atualizada.', campaign: { id: fresh.id, ...fresh.data() } });
}));

router.delete('/campaigns/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.campaigns).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Campanha não encontrada.' });
  await ref.delete();
  res.json({ message: 'Campanha removida.' });
}));

// Payments
router.get('/payments/plans', (_req, res) => res.json({ plans: config.plans, gatewayConfigured: mercadoPagoConfigured() }));
router.post('/payments/checkout', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const planId = safeString(req.body?.planId, 100);
  if (!planId) return res.status(400).json({ error: 'Selecione um plano.' });
  res.json(await createCheckout({ userId: req.user!.id, userEmail: req.user!.email, userName: req.user!.name, planId }));
}));
router.get('/payments/orders', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const snap = await firestore().collection(COLLECTIONS.payments).where('userId', '==', req.user!.id).get();
  res.json({ orders: queryData<any>(snap).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}));
router.get('/payments/subscriptions', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  res.json({ subscriptions: await listUserSubscriptions(req.user!.id), billingMode: config.mercadoPago.billingMode });
}));
router.post('/payments/subscription/cancel', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  res.json({ message: 'Renovação automática cancelada.', subscription: await cancelSubscription(req.user!.id, safeString(req.body?.orderId, 200) || undefined) });
}));
router.post('/webhooks/mercadopago', asyncRoute(async (req, res) => {
  const result = await processMercadoPagoWebhook({ body: req.body, query: req.query, headers: req.headers as any });
  res.status(200).json(result);
}));

// Autopilot
router.get('/autopilot/config', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const id = `${req.user!.id}_${companyId}`;
  const ref = firestore().collection(COLLECTIONS.autopilotConfigs).doc(id);
  let snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      id,
      userId: req.user!.id,
      companyId,
      enabled: false,
      mode: 'manual_approval',
      frequency: 'daily',
      timezone: 'America/Sao_Paulo',
      preferredDays: [1, 2, 3, 4, 5],
      preferredHours: [10, 15, 19],
      targetPlatforms: ['Instagram', 'Facebook'],
      primaryGoal: 'Atrair clientes e gerar autoridade',
      maxMonthlyCredits: 100,
      usedCreditsThisMonth: 0,
      usageMonth: new Date().toISOString().slice(0, 7),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    snap = await ref.get();
  }
  res.json({ config: { id: snap.id, ...snap.data() } });
}));

router.post('/autopilot/config', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const id = `${req.user!.id}_${companyId}`;
  const ref = firestore().collection(COLLECTIONS.autopilotConfigs).doc(id);
  const current = await ref.get();

  const rawDays = Array.isArray(req.body?.preferredDays) ? req.body.preferredDays : undefined;
  const preferredDays = rawDays ? rawDays.filter((d: any) => typeof d === 'number' && d >= 0 && d <= 6) : undefined;
  const rawHours = Array.isArray(req.body?.preferredHours) ? req.body.preferredHours : undefined;
  const preferredHours = rawHours ? rawHours.filter((h: any) => typeof h === 'number' && h >= 0 && h <= 23) : undefined;
  const timezone = safeString(req.body?.timezone, 80) || 'America/Sao_Paulo';

  const update = cleanObject({
    id,
    userId: req.user!.id,
    companyId,
    enabled: Boolean(req.body?.enabled),
    mode: req.body?.mode === 'automatic' ? 'automatic' : 'manual_approval',
    frequency: ['daily', '3_times_week', 'weekly'].includes(req.body?.frequency) ? req.body.frequency : 'daily',
    timezone,
    preferredDays,
    preferredHours,
    targetPlatforms: stringArray(req.body?.targetPlatforms, 10),
    primaryGoal: safeString(req.body?.primaryGoal, 2000) || 'Engajamento e Vendas',
    maxMonthlyCredits: Math.max(5, Number(req.body?.maxMonthlyCredits || 100)),
    updatedAt: nowIso(),
    createdAt: current.exists ? undefined : nowIso()
  });
  await ref.set(update, { merge: true });
  const fresh = await ref.get();
  res.json({ message: 'Configuração do Autopilot salva.', config: { id: fresh.id, ...fresh.data() } });
}));
router.post('/autopilot/trigger-now', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200) || safeString(req.query?.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório para acionar o Autopilot.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const result = await triggerUserAutopilot(req.user!.id, companyId);
  res.json({ message: 'Autopilot executado para sua empresa.', result });
}));

// Social OAuth
router.get('/social/connections', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  res.json({ connections: await listConnections(req.user!.id, companyId) });
}));
router.get('/social/:provider/connect', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const provider = req.params.provider as SocialProvider;
  if (!['instagram','facebook','tiktok','youtube','linkedin','pinterest','x'].includes(provider)) return res.status(400).json({ error: 'Provedor social inválido.' });
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  res.json(await createOAuthUrl({ provider, userId: req.user!.id, companyId }));
}));
router.get('/social/:provider/callback', asyncRoute(async (req, res) => {
  const provider = req.params.provider as SocialProvider;
  const errorParam = safeString(req.query.error, 500);
  if (errorParam) return res.redirect(`${config.appUrl}/redes-sociais?error=${encodeURIComponent(errorParam)}`);
  const code = safeString(req.query.code, 3000);
  const state = safeString(req.query.state, 3000);
  if (!code || !state) return res.redirect(`${config.appUrl}/redes-sociais?error=${encodeURIComponent('Autorização OAuth incompleta')}`);
  const result = await handleOAuthCallback({ provider, code, state });
  res.redirect(`${config.appUrl}/redes-sociais?connected=${encodeURIComponent(provider)}&companyId=${encodeURIComponent(result.companyId)}`);
}));
router.delete('/social/:provider/disconnect', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const success = await disconnectSocial(req.user!.id, companyId, req.params.provider);
  res.json({ success, message: success ? 'Conta desconectada.' : 'Conexão não encontrada.' });
}));

// Legacy-compatible social routes used by the existing UI
router.get('/social/connections/:companyId', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  await requireOwnedCompany(req.user!.id, req.params.companyId);
  res.json({ connections: await listConnections(req.user!.id, req.params.companyId) });
}));
router.get('/social/oauth/:provider/start', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const provider = req.params.provider as SocialProvider;
  const companyId = safeString(req.query.companyId, 200);
  if (!['instagram','facebook','tiktok','youtube','linkedin','pinterest','x'].includes(provider)) return res.status(400).json({ error: 'Provedor social inválido.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const oauth = await createOAuthUrl({ provider, userId: req.user!.id, companyId });
  res.json({ ...oauth, authUrl: oauth.url });
}));
router.delete('/social/connections/:connectionId', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.socialConnections).doc(req.params.connectionId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Conexão não encontrada.' });
  await ref.delete();
  res.json({ success: true, message: 'Conta desconectada.' });
}));

// Support
router.post('/support/tickets', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const subject = safeString(req.body?.subject, 300);
  const message = safeString(req.body?.message, 10_000);
  if (!subject || !message) return res.status(400).json({ error: 'Assunto e descrição são obrigatórios.' });
  const id = newId('ticket');
  const ticket = { id, userId: req.user!.id, userEmail: req.user!.email, subject, message, status: 'open', priority: 'normal', createdAt: nowIso(), updatedAt: nowIso() };
  await firestore().collection(COLLECTIONS.supportTickets).doc(id).set(ticket);
  res.status(201).json({ message: 'Chamado aberto com sucesso.', ticket: { ...ticket, message: undefined } });
}));
router.get('/support/contact', (_req, res) => res.json({ email: config.support.email, whatsapp: config.support.whatsapp || null }));

// Blog + showcase public
router.get('/blog', asyncRoute(async (_req, res) => {
  const snap = await firestore().collection(COLLECTIONS.blogPosts).where('status', '==', 'published').get();
  res.json({ posts: queryData<any>(snap).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))) });
}));
router.get('/blog/:slug', asyncRoute(async (req, res) => {
  const snap = await firestore().collection(COLLECTIONS.blogPosts).where('slug', '==', req.params.slug).where('status', '==', 'published').limit(1).get();
  if (snap.empty) return res.status(404).json({ error: 'Artigo não encontrado.' });
  res.json({ post: { id: snap.docs[0].id, ...snap.docs[0].data() } });
}));
router.get('/vitrine', asyncRoute(async (_req, res) => {
  const snap = await firestore().collection(COLLECTIONS.companies).where('isPublicInVitrine', '==', true).get();
  const companies = queryData<any>(snap).map(({ userId, ...company }) => company);
  res.json({ companies });
}));
router.get('/vitrine/:slug', asyncRoute(async (req, res) => {
  const snap = await firestore().collection(COLLECTIONS.companies).where('slug', '==', req.params.slug).where('isPublicInVitrine', '==', true).limit(1).get();
  if (snap.empty) return res.status(404).json({ error: 'Empresa não encontrada.' });
  const { userId, ...company } = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
  res.json({ company });
}));

// Admin
router.get('/admin/overview', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const db = firestore();
  const [usersSnap, companiesSnap, txSnap, contentsSnap] = await Promise.all([
    db.collection(COLLECTIONS.users).get(),
    db.collection(COLLECTIONS.companies).get(),
    db.collection(COLLECTIONS.creditTransactions).get(),
    db.collection(COLLECTIONS.contentItems).get()
  ]);
  const users = queryData<any>(usersSnap).map(({ passwordHash, ...user }) => user);
  const totalCreditsIssued = txSnap.docs.reduce((sum, doc) => { const d = doc.data() as any; return sum + (Number(d.amount) > 0 ? Number(d.amount) : 0); }, 0);
  res.json({ stats: { totalUsers: usersSnap.size, totalCompanies: companiesSnap.size, totalCreditsIssued, totalContentsGenerated: contentsSnap.size }, users });
}));
router.post('/admin/grant-credits', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const userId = safeString(req.body?.userId, 200);
  const amount = Number(req.body?.amount || 0);
  const reason = safeString(req.body?.reason, 500) || 'Ajuste administrativo';
  if (!userId || !Number.isFinite(amount) || amount <= 0 || amount > 100_000) return res.status(400).json({ error: 'Usuário ou quantidade inválidos.' });
  const wallet = await addCredits({ userId, amount, type: 'admin_adjustment', source: reason, idempotencyKey: `admin:${req.user!.id}:${newId('grant')}`, metadata: { operatorId: req.user!.id } });
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'grant_credits', targetUserId: userId, details: { amount, reason } });
  await createNotification({ userId, title: 'Créditos adicionados', message: `${amount} créditos foram adicionados à sua carteira.`, type: 'system' });
  res.json({ message: 'Créditos concedidos.', wallet });
}));

router.get('/admin/support/tickets', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const snap = await firestore().collection(COLLECTIONS.supportTickets).get();
  const tickets = queryData<any>(snap).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,200);
  res.json({ tickets });
}));
router.patch('/admin/support/tickets/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.supportTickets).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const status = safeString(req.body?.status, 30);
  if (!['open','in_progress','resolved','closed'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  await ref.set({ status, updatedAt: nowIso(), updatedBy: req.user!.id }, { merge: true });
  await writeAdminLog({ operatorId:req.user!.id, operatorEmail:req.user!.email, action:'support_status', details:{ ticketId:req.params.id, status } });
  res.json({ message: 'Chamado atualizado.' });
}));

router.get('/admin/blog', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const snap = await firestore().collection(COLLECTIONS.blogPosts).get();
  res.json({ posts: queryData<any>(snap).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))) });
}));
router.post('/admin/blog/generate-now', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const topic = safeString(req.body?.topic, 1000) || 'como usar inteligência artificial de forma prática e responsável no marketing de pequenas empresas';
  const generated = await generatePlatformArticle(topic);
  const article = generated.article || {};
  const id = newId('blog');
  const slug = `${slugify(article.suggestedSlug || article.title || topic)}-${id.slice(-6)}`;
  const post = { id, title:safeString(article.title,180), slug, summary:safeString(article.summary || article.metaDescription,500), content:safeString(article.content,120000), featuredImageUrl:'', author:config.blog.author, category:safeString(article.category,100)||'Marketing & IA', tags:stringArray(article.tags,12), seoTitle:safeString(article.title,70), seoDescription:safeString(article.metaDescription || article.summary,180), status:'draft', createdAt:nowIso(), updatedAt:nowIso(), generatedBy:'admin_ai', modelUsed:generated.modelUsed };
  if (!post.title || !post.content) throw new Error('A IA não retornou artigo completo.');
  await firestore().collection(COLLECTIONS.blogPosts).doc(id).set(post);
  await writeAdminLog({ operatorId:req.user!.id, operatorEmail:req.user!.email, action:'generate_blog', details:{ postId:id, topic } });
  res.status(201).json({ message:'Rascunho gerado. Revise antes de publicar.', post });
}));
router.post('/admin/blog', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const id = newId('blog');
  const title = safeString(req.body?.title,180); const content = safeString(req.body?.content,120000);
  if (!title || !content) return res.status(400).json({ error:'Título e conteúdo são obrigatórios.' });
  const status = req.body?.status === 'published' ? 'published' : 'draft';
  const post = { id, title, slug:`${slugify(req.body?.slug || title)}-${id.slice(-6)}`, summary:safeString(req.body?.summary,500), content, featuredImageUrl:safeHttpUrl(req.body?.featuredImageUrl), author:safeString(req.body?.author,120)||config.blog.author, category:safeString(req.body?.category,100)||'Marketing & IA', tags:stringArray(req.body?.tags,12), seoTitle:safeString(req.body?.seoTitle || title,70), seoDescription:safeString(req.body?.seoDescription || req.body?.summary,180), status, publishedAt:status==='published'?nowIso():undefined, createdAt:nowIso(), updatedAt:nowIso() };
  await firestore().collection(COLLECTIONS.blogPosts).doc(id).set(cleanObject(post));
  res.status(201).json({ post });
}));
router.patch('/admin/blog/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.blogPosts).doc(req.params.id); const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error:'Artigo não encontrado.' });
  const current = snap.data() as any; const patch:any = { updatedAt:nowIso() };
  for (const key of ['title','summary','content','author','category','seoTitle','seoDescription']) if (req.body?.[key] !== undefined) patch[key]=safeString(req.body[key], key==='content'?120000:key==='summary'?500:180);
  if (req.body?.featuredImageUrl !== undefined) patch.featuredImageUrl=safeHttpUrl(req.body.featuredImageUrl);
  if (req.body?.tags !== undefined) patch.tags=stringArray(req.body.tags,12);
  if (req.body?.slug !== undefined) patch.slug=slugify(req.body.slug);
  if (req.body?.status !== undefined) { if (!['draft','published','archived'].includes(req.body.status)) return res.status(400).json({ error:'Status inválido.' }); patch.status=req.body.status; if (req.body.status==='published'&&!current.publishedAt) patch.publishedAt=nowIso(); }
  await ref.set(patch,{merge:true}); const fresh=await ref.get(); res.json({ post:{id:fresh.id,...fresh.data()} });
}));
router.delete('/admin/blog/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref=firestore().collection(COLLECTIONS.blogPosts).doc(req.params.id); const snap=await ref.get(); if(!snap.exists)return res.status(404).json({error:'Artigo não encontrado.'}); await ref.delete(); await writeAdminLog({operatorId:req.user!.id,operatorEmail:req.user!.email,action:'delete_blog',details:{postId:req.params.id}}); res.json({message:'Artigo removido.'});
}));

// Scheduler. No secret in query string.
router.get('/cron/process', asyncRoute(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  if (!config.cronSecret || auth !== `Bearer ${config.cronSecret}`) return res.status(401).json({ error: 'Cron não autorizado.' });
  res.json(await processSchedulerTick());
}));

// Plans public catalog alias
router.get('/plans', (_req, res) => res.json({ plans: config.plans, gatewayConfigured: mercadoPagoConfigured() }));

// Technical SEO endpoints
router.get('/sitemap.xml', asyncRoute(async (_req, res) => res.type('application/xml').send(await buildSitemapXml())));
router.get('/robots.txt', (_req, res) => res.type('text/plain').send(buildRobotsTxt()));

export async function buildSitemapXml(): Promise<string> {
  const base = config.appUrl.replace(/\/$/, '');
  const urls: Array<{ loc: string; lastmod?: string }> = [
    { loc: `${base}/` },
    { loc: `${base}/vitrine` },
    { loc: `${base}/blog` },
    { loc: `${base}/planos` },
    { loc: `${base}/termos` },
    { loc: `${base}/privacidade` }
  ];
  try {
    const [blogSnap, companiesSnap] = await Promise.all([
      firestore().collection(COLLECTIONS.blogPosts).where('status', '==', 'published').get(),
      firestore().collection(COLLECTIONS.companies).where('isPublicInVitrine', '==', true).get()
    ]);
    for (const doc of blogSnap.docs) {
      const item = doc.data() as any;
      if (item.slug) urls.push({ loc: `${base}/blog/${encodeURIComponent(item.slug)}`, lastmod: item.updatedAt || item.publishedAt });
    }
    for (const doc of companiesSnap.docs) {
      const item = doc.data() as any;
      if (item.slug) urls.push({ loc: `${base}/vitrine/${encodeURIComponent(item.slug)}`, lastmod: item.updatedAt });
    }
  } catch (error) {
    console.warn('[Froc Sitemap] Não foi possível carregar dados dinâmicos do Firestore, usando páginas base:', error);
  }
  const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const safeLastmod = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  };
  const body = urls.map((item) => { const lastmod = safeLastmod(item.lastmod); return `  <url>\n    <loc>${escapeXml(item.loc)}</loc>${lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : ''}\n  </url>`; }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function buildRobotsTxt(): string {
  const blocked = ['/api/','/admin','/dashboard','/empresa','/froc-ia','/autopilot','/criar-conteudo','/criar-imagem','/criar-video','/criar-artigo','/seo','/campanhas','/calendario','/redes-sociais','/conteudos','/analytics','/creditos','/perfil','/configuracoes','/suporte'];
  return `User-agent: *
Allow: /
Allow: /blog
Allow: /vitrine
Allow: /planos
Allow: /termos
Allow: /privacidade
${blocked.map((path) => `Disallow: ${path}`).join('\n')}

Sitemap: ${config.appUrl.replace(/\/$/, '')}/sitemap.xml
`;
}

export default router;
