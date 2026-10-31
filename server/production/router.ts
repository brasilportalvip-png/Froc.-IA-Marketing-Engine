import { Router, type Request, type Response } from 'express';
import { getAdminAuth, getAdminStorage } from '../providers/firebaseAdmin.js';
import { config } from '../config/index.js';
import { AuthenticatedRequest, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, ensureUserProfile, hasAcceptedLatestTerms, requireAdmin, requireAuth } from './auth.js';
import { addCredits, commitReservation, getWallet, listCreditTransactions, removeCreditsAdmin, reserveCredits, rollbackReservation } from './credits.js';
import { getPlanEntitlements } from './plans.js';
import { evaluateSignupBonusEligibility } from './antiAbuse.js';
import { generatePlatformArticle } from './ai.js';

import { cancelSubscription, createCheckout, listUserSubscriptions, mercadoPagoConfigured, processMercadoPagoWebhook } from './payments.js';
import { createOAuthUrl, createPinterestPin, disconnectSocial, getFacebookPageSelectionCandidates, getPinterestBoards, getProviderAutoPublishReason, getSocialReadiness, getTikTokUploadStatus, handleOAuthCallback, initTikTokDraftUpload, initYouTubeResumableUpload, isTextAutoPublishSupported, listConnections, MAX_TIKTOK_SANDBOX_VIDEO_SIZE, normalizeProvider, publishInstagramMedia, sanitizeOAuthPublicError, selectFacebookPage, TEXT_AUTO_PUBLISH_PROVIDERS, uploadTikTokDraftVideo, type SocialProvider } from './social.js';
import { getSchedulerHealth, processSchedulerTick } from './scheduler.js';
import multer from 'multer';
import { allIndexableUrls, buildRobotsTxt, buildSitemapIndexXml, getSeoEngineStatus, pingIndexNow } from './seoEngine.js';
import { conciergeChat, conciergeChatStream, executeConciergePlan, sanitizeMessages } from './concierge.js';
import { getSiteSettings, isPaidPlan, setSiteDailyPosts, vitrineBlockMessage, vitrineDailyCost, vitrineEligibility } from './vitrineBilling.js';
import { closeConversation, deleteConversation, getConversation, listConversations, saveConversationTurn } from './conversations.js';
import { cleanSpeechText, createLiveTranscriptionToken, diagnoseVoice, NEURAL_SPEECH_CHANNELS, NEURAL_SPEECH_SAMPLE_RATE, synthesizeSpeech, synthesizeSpeechStream } from './speech.js';
import { enterVitrine, processVitrineDailyPosts, sanitizePublicVitrinePost } from './vitrineDaily.js';
import { listAllPublicPosts } from './posts.js';
import { appLinksOf } from './appLinks.js';
import { backfillPostImages, createPostImage, resetFailedPostImages } from './postImages.js';
import { FROC_AGENTS, FROC_SQUADS } from '../../shared/agents.js';
import { COLLECTIONS, cleanObject, consumeRateLimit, createNotification, firestore, newId, nowIso, probeDatabaseHealth, queryData, slugify, writeAdminLog } from './store.js';

const router = Router();

type AsyncHandler = (req: any, res: Response) => Promise<any>;
const asyncRoute = (handler: AsyncHandler) => async (req: Request, res: Response) => {
  try {
    await handler(req, res);
  } catch (error: any) {
    const requestedStatus = Number(error?.statusCode || error?.status || (error instanceof RangeError ? 400 : 500));
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500;
    if (status >= 500) console.error('[Froc API]', error);
    const publicMessage = status >= 500
      ? 'Erro interno no Froc.IA.'
      : String(error?.message || 'Requisição inválida.').slice(0, 500);
    res.status(status).json({ error: publicMessage });
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

export function parseStrictBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
  }
  return false;
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
  if (key === 'isPublicInVitrine' || key === 'dailyPostsEnabled' || key === 'vitrineBillingExempt') {
    return parseStrictBoolean(value);
  }
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
  const collections = [COLLECTIONS.contentItems, COLLECTIONS.vitrinePosts, COLLECTIONS.campaigns, COLLECTIONS.scheduledPosts, COLLECTIONS.socialConnections, COLLECTIONS.seoReports, COLLECTIONS.autopilotConfigs];
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
  return getPlanEntitlements(planId).maxCompanies;
}

async function requireSocialPublishingAccess(userId: string, role?: string): Promise<void> {
  if (role === 'admin') return;
  const wallet = await getWallet(userId);
  const entitlements = getPlanEntitlements(wallet.planId);
  if (!entitlements.socialConnections) {
    const error: any = new Error('Publicações em redes sociais exigem o plano PRO ou superior.');
    error.statusCode = 403;
    throw error;
  }
}

function cleanHeading(txt: string): string {
  if (!txt) return '';
  return String(txt)
    .replace(/^#+\s*/, '')
    .replace(/^[Hh][1-6][:\s-]+/i, '')
    .replace(/^#+\s*/, '')
    .trim();
}

function contentBodyFromArticle(article: any): string {
  const parts = [`# ${cleanHeading(article.title || '')}`, article.introduction || ''];
  for (const section of article.sections || []) {
    parts.push(`## ${cleanHeading(section.h2 || '')}`, section.content || '');
    for (const sub of section.h3s || []) parts.push(`### ${cleanHeading(sub.h3 || '')}`, sub.content || '');
  }
  if (article.faqSection?.length) {
    parts.push('## Perguntas Frequentes');
    for (const faq of article.faqSection) parts.push(`### ${cleanHeading(faq.question || '')}`, faq.answer || '');
  }
  parts.push('## Conclusão', article.conclusion || '', article.callToAction || '');
  return parts.filter(Boolean).join('\n\n');
}

// Health
router.get('/health', asyncRoute(async (_req, res) => {
  const dbHealth = await probeDatabaseHealth();
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
  const isExistingUser = Boolean(req.user?.termsAcceptedAt);

  let termsAcceptedAt: string | undefined = req.user?.termsAcceptedAt;
  let privacyAcceptedAt: string | undefined = req.user?.privacyAcceptedAt;
  let termsVersion: string | undefined = req.user?.termsVersion;
  let privacyVersion: string | undefined = req.user?.privacyVersion;

  if (!isExistingUser) {
    const hasTerms = Boolean(req.body?.termsAccepted);
    const hasPrivacy = Boolean(req.body?.privacyAccepted);
    if (!hasTerms || !hasPrivacy) {
      return res.status(428).json({
        error: 'Para ativar sua conta, aceite os Termos de Uso e a Política de Privacidade no cadastro.'
      });
    }
    termsAcceptedAt = now;
    privacyAcceptedAt = now;
    termsVersion = CURRENT_TERMS_VERSION;
    privacyVersion = CURRENT_PRIVACY_VERSION;
  }

  const profile = await ensureUserProfile(req.firebaseUser!, {
    name: name || req.user?.name,
    termsAcceptedAt,
    privacyAcceptedAt,
    termsVersion,
    privacyVersion,
    avatarUrl: safeString(req.body?.avatarUrl, 1000) || req.user?.avatarUrl
  });

  const clientIp = trustedClientIp(req);
  const userAgent = safeString(req.headers['user-agent'], 300);

  // Avaliação rigorosa anti-abuso e anti-multicontas para concessão de bônus (apenas na criação)
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
    needsTermsConsent: !hasAcceptedLatestTerms(profile),
    currentTermsVersion: CURRENT_TERMS_VERSION,
    security: {
      bonusEligible: outcome.eligibleForBonus,
      bonusAmount: outcome.bonusAmount,
      reason: outcome.reason,
      message: outcome.detail
    }
  });
}));

router.post('/auth/accept-terms', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const termsAccepted = req.body?.termsAccepted === true;
  const privacyAccepted = req.body?.privacyAccepted === true;
  if (!termsAccepted || !privacyAccepted) {
    return res.status(400).json({ error: 'Você precisa aceitar explicitamente os Termos de Uso e a Política de Privacidade.' });
  }

  // O backend é a fonte de verdade absoluta para as versões legais vigentes (ignora versões enviadas no payload do cliente)
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
    wallet: await getWallet(profile.id),
    needsTermsConsent: false,
    currentTermsVersion: CURRENT_TERMS_VERSION
  });
}));

router.get('/auth/me', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  res.json({
    user: req.user,
    wallet: await getWallet(req.user!.id),
    needsTermsConsent: !hasAcceptedLatestTerms(req.user),
    currentTermsVersion: CURRENT_TERMS_VERSION
  });
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
  if (!config.adminBootstrap.enabled || !config.adminBootstrap.key) {
    return res.status(403).json({ error: 'Recurso de bootstrap de administrador desabilitado.' });
  }
  if (safeString(req.body?.secretKey, 500) !== config.adminBootstrap.key) {
    return res.status(403).json({ error: 'Chave de bootstrap inválida.' });
  }
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
  // Administrador não tem limite de projetos.
  if (req.user!.role !== 'admin' && current.size >= planCompanyLimit(wallet.planId)) return res.status(403).json({ error: 'Seu plano atingiu o limite de empresas. Faça upgrade para cadastrar outra marca.' });
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
    // Vitrine é paga: entra só pelo botão "Colocar na Vitrine" (POST /companies/:id/vitrine).
    isPublicInVitrine: false,
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
  const allowed = ['name','businessType','onlineChannels','logoUrl','description','website','androidApp','iosApp','phone','whatsapp','email','address','city','state','country','category','segment','products','services','targetAudience','coverageRegion','differentials','brandTone','goals','competitors','keywords','socialLinks','marketingProfile'];
  const patch: Record<string, any> = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = normalizeCompanyField(key, req.body[key]);
  if (patch.name && patch.name !== current.name) patch.slug = `${slugify(safeString(patch.name, 120))}-${req.params.id.slice(-6)}`;
  patch.updatedAt = nowIso();
  await firestore().collection(COLLECTIONS.companies).doc(req.params.id).set(cleanObject(patch), { merge: true });
  const snap = await firestore().collection(COLLECTIONS.companies).doc(req.params.id).get();
  res.json({ message: 'Empresa atualizada com sucesso.', company: { id: snap.id, ...snap.data() } });
}));

// Vitrine paga: plano ativo + 10 créditos/dia por projeto. Ligar/desligar o post diário é só do admin.
router.post('/companies/:id/vitrine', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const company = await requireOwnedCompany(req.user!.id, req.params.id);
  if (parseStrictBoolean(company.isPublicInVitrine)) return res.json({ ok: true, message: 'Este projeto já está na Vitrine.', company });
  const outcome = await enterVitrine({ company, isAdmin: req.user!.role === 'admin' });
  if (!outcome.ok) return res.status(402).json({ error: outcome.message, reason: outcome.reason });
  const snap = await firestore().collection(COLLECTIONS.companies).doc(company.id).get();
  res.json({ ok: true, message: outcome.message, url: outcome.url, company: { id: snap.id, ...snap.data() }, wallet: await getWallet(req.user!.id) });
}));

router.get('/vitrine-billing', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const eligibility = await vitrineEligibility(req.user!.id, req.user!.role === 'admin');
  res.json({ dailyCost: vitrineDailyCost(), chatReplyCost: config.billing.chatReplyCost, canEnter: eligibility.ok, reason: eligibility.reason || null, message: vitrineBlockMessage(eligibility.reason) });
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
  await firestore().collection(COLLECTIONS.linkClicks).doc(req.params.id).delete();
  await firestore().collection(COLLECTIONS.companies).doc(req.params.id).delete();
  res.json({ message: 'Empresa removida com sucesso, com posts e dados vinculados.' });
}));

// Credits
router.get('/credits/balance', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => res.json({ wallet: await getWallet(req.user!.id) })));
router.get('/credits/transactions', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => res.json({ transactions: await listCreditTransactions(req.user!.id, Number(req.query.limit || 50)) })));
router.get('/credits/history', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => res.json({ transactions: await listCreditTransactions(req.user!.id, Number(req.query.limit || 50)) })));

// IA (tabela pública de custos)
router.get('/ai/costs', (_req, res) => res.json({ costs: config.creditCosts }));

// Biblioteca de criações ("Minhas Criações")
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

router.delete('/content/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.contentItems).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) return res.status(404).json({ error: 'Conteúdo não encontrado.' });
  const item = snap.data() as any;
  if (item?.metadata?.storagePath) await getAdminStorage().bucket().file(String(item.metadata.storagePath)).delete({ ignoreNotFound: true }).catch(() => undefined);
  await ref.delete();
  res.json({ message: 'Conteúdo removido.' });
}));

// Payments
router.get('/payments/plans', (_req, res) => res.json({ plans: config.plans, gatewayConfigured: mercadoPagoConfigured() }));
router.post('/payments/checkout', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const planId = safeString(req.body?.planId, 100);
  if (!planId) return res.status(400).json({ error: 'Selecione um plano.' });
  const bodyIdempotencyKey = safeString(req.body?.idempotencyKey, 200);
  const headerIdempotencyKey = safeString(req.headers['x-idempotency-key'], 200);
  if (bodyIdempotencyKey && headerIdempotencyKey && bodyIdempotencyKey !== headerIdempotencyKey) {
    return res.status(400).json({ error: 'A chave de idempotência do cabeçalho diverge da chave enviada no corpo.' });
  }
  const idempotencyKey = headerIdempotencyKey || bodyIdempotencyKey || undefined;
  res.json(await createCheckout({ userId: req.user!.id, userEmail: req.user!.email, userName: req.user!.name, planId, idempotencyKey }));
}));
router.get('/payments/orders', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const snap = await firestore().collection(COLLECTIONS.payments).where('userId', '==', req.user!.id).get();
  res.json({ orders: queryData<any>(snap).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}));
router.get('/payments/orders/:orderId', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.payments).doc(req.params.orderId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.userId !== req.user!.id) {
    return res.status(404).json({ error: 'Pedido não encontrado.' });
  }
  res.json({ order: { id: snap.id, ...snap.data() } });
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

// Social OAuth (mantido para integrações futuras; sem tela no painel atual)
router.get('/social/connections', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  res.json({ connections: await listConnections(req.user!.id, companyId) });
}));
router.get('/social/:provider/connect', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const wallet = await getWallet(req.user!.id);
  const entitlements = getPlanEntitlements(wallet.planId);
  const isAdmin = req.user?.role === 'admin';
  if (!entitlements.socialConnections && !isAdmin) {
    return res.status(403).json({
      error: 'A conexão com redes sociais está disponível a partir do plano PRO. Faça upgrade para conectar suas contas.'
    });
  }

  const provider = req.params.provider as SocialProvider;
  if (!['instagram','facebook','tiktok','youtube','linkedin','pinterest','x'].includes(provider)) return res.status(400).json({ error: 'Provedor social inválido.' });
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  res.json(await createOAuthUrl({ provider, userId: req.user!.id, companyId }));
}));
router.get('/social/:provider/callback', asyncRoute(async (req, res) => {
  const provider = req.params.provider as SocialProvider;
  const errorParam = safeString(req.query.error, 500) || safeString(req.query.error_description, 500);
  if (errorParam) {
    const safeError = errorParam.includes('access_denied')
      ? 'Autorização cancelada pelo usuário.'
      : sanitizeOAuthPublicError(errorParam, provider);
    return res.redirect(`${config.appUrl}/redes-sociais?error=${encodeURIComponent(safeError)}`);
  }
  const code = safeString(req.query.code, 3000);
  const state = safeString(req.query.state, 3000);
  if (!code || !state) return res.redirect(`${config.appUrl}/redes-sociais?error=${encodeURIComponent('Autorização OAuth incompleta')}`);
  try {
    const result = await handleOAuthCallback({ provider, code, state });
    if (result.selectionRequired && result.pageSelectToken) {
      return res.redirect(`${config.appUrl}/redes-sociais?pageSelection=${encodeURIComponent(result.pageSelectToken)}&companyId=${encodeURIComponent(result.companyId)}`);
    }
    res.redirect(`${config.appUrl}/redes-sociais?connected=${encodeURIComponent(provider)}&companyId=${encodeURIComponent(result.companyId)}`);
  } catch (err: any) {
    const publicError = sanitizeOAuthPublicError(err, provider);
    const rawMsg = String(err?.message || err || 'Falha ao processar autorização social.');
    // Sanitização de logs: mascarar tokens, códigos e secrets
    const sanitizedLog = rawMsg
      .replace(/EAAB\w+/g, '[REDACTED_PAGE_TOKEN]')
      .replace(/EAA\w+/g, '[REDACTED_USER_TOKEN]')
      .replace(/access_token=[^&\s]+/g, 'access_token=[REDACTED]')
      .replace(/code=[^&\s]+/g, 'code=[REDACTED]')
      .replace(/client_secret=[^&\s]+/g, 'client_secret=[REDACTED]');
    console.error(`[Social OAuth Callback Error] [${provider}]:`, sanitizedLog);
    res.redirect(`${config.appUrl}/redes-sociais?error=${encodeURIComponent(publicError)}`);
  }
}));
router.delete('/social/:provider/disconnect', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const success = await disconnectSocial(req.user!.id, companyId, req.params.provider);
  res.json({ success, message: success ? 'Conta desconectada.' : 'Conexão não encontrada.' });
}));

router.get('/social/facebook/selection-candidates', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const selectionToken = safeString(req.query.selectionToken || req.query.pageSelectToken || req.headers['x-selection-token'], 1000);
  const companyId = safeString(req.query.companyId, 200) || undefined;
  if (!selectionToken) {
    return res.status(400).json({ error: 'selectionToken é obrigatório.' });
  }
  const pages = await getFacebookPageSelectionCandidates({
    userId: req.user!.id,
    selectionToken,
    companyId
  });
  res.json({ pages });
}));

router.post('/social/facebook/select-page', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const selectionToken = safeString(req.body?.selectionToken || req.body?.pageSelectToken, 1000);
  const pageId = safeString(req.body?.pageId || req.body?.selectedPageId, 200);
  const companyId = safeString(req.body?.companyId, 200) || undefined;
  if (!selectionToken || !pageId) {
    return res.status(400).json({ error: 'selectionToken e pageId são obrigatórios.' });
  }
  const result = await selectFacebookPage({
    userId: req.user!.id,
    companyId,
    selectionToken,
    pageId
  });
  res.json({
    success: true,
    message: `Página "${result.pageName}" selecionada e conectada com sucesso.`,
    connection: result
  });
}));

router.get('/social/connections/:companyId', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  await requireOwnedCompany(req.user!.id, req.params.companyId);
  res.json({ connections: await listConnections(req.user!.id, req.params.companyId) });
}));
router.get('/social/oauth/:provider/start', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const wallet = await getWallet(req.user!.id);
  const entitlements = getPlanEntitlements(wallet.planId);
  const isAdmin = req.user?.role === 'admin';
  if (!entitlements.socialConnections && !isAdmin) {
    return res.status(403).json({
      error: 'A conexão com redes sociais está disponível a partir do plano PRO. Faça upgrade para conectar suas contas.'
    });
  }

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

// TikTok Content Posting API (Draft Video / Inbox Upload)
const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_TIKTOK_SANDBOX_VIDEO_SIZE // 4 MiB
  },
  fileFilter: (_req, file, cb) => {
    const originalName = (file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const isMp4Ext = originalName.endsWith('.mp4');
    const isMp4Mime = !mime || mime === 'video/mp4' || mime === 'application/mp4' || mime === 'application/octet-stream';
    if (isMp4Ext && isMp4Mime) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos de vídeo MP4 (.mp4) são aceitos para envio de rascunho ao TikTok.'));
    }
  }
});

router.post('/social/tiktok/upload-draft', requireAuth, (req, res, next) => {
  uploadVideo.single('video')(req, res, (err) => {
    if (err) {
      if ((err as any).code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'O vídeo excede o limite de 4 MB desta fase de verificação do TikTok.' });
      }
      return res.status(400).json({ error: err.message || 'Erro no envio do arquivo de vídeo.' });
    }
    next();
  });
}, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200) || safeString(req.query?.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  await requireSocialPublishingAccess(req.user!.id, req.user?.role);

  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({ error: 'Arquivo de vídeo MP4 é obrigatório.' });
  }

  const result = await uploadTikTokDraftVideo({
    userId: req.user!.id,
    companyId,
    videoBuffer: req.file.buffer,
    videoSize: req.file.size,
    mimeType: req.file.mimetype,
    title: safeString(req.body?.title, 300)
  });

  res.status(200).json(result);
}));

router.post('/social/tiktok/upload-status', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200) || safeString(req.query?.companyId, 200);
  const publishId = safeString(req.body?.publishId, 200);
  if (!companyId || !publishId) {
    return res.status(400).json({ error: 'companyId e publishId são obrigatórios.' });
  }
  await requireOwnedCompany(req.user!.id, companyId);

  const result = await getTikTokUploadStatus({
    userId: req.user!.id,
    companyId,
    publishId
  });

  res.status(200).json(result);
}));

router.get('/social/readiness', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  const readiness = await getSocialReadiness(companyId, req.user!.id);
  res.json(readiness);
}));

router.post('/social/instagram/publish-media', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);
  await requireSocialPublishingAccess(req.user!.id, req.user?.role);

  const imageUrl = safeHttpUrl(req.body?.imageUrl, 2000) || undefined;
  const videoUrl = safeHttpUrl(req.body?.videoUrl, 2000) || undefined;
  const caption = safeString(req.body?.caption, 2200);
  const contentItemId = safeString(req.body?.contentItemId, 200) || undefined;

  if (!imageUrl && !videoUrl) {
    return res.status(400).json({ error: 'Forneça uma URL válida de imagem ou vídeo (Reels).' });
  }

  const result = await publishInstagramMedia({
    userId: req.user!.id,
    companyId,
    imageUrl,
    videoUrl,
    caption,
    contentItemId
  });

  res.json(result);
}));

router.post('/social/tiktok/init-upload', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  const videoSize = Number(req.body?.videoSize || 0);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  if (videoSize <= 0) return res.status(400).json({ error: 'videoSize deve ser maior que 0.' });
  await requireOwnedCompany(req.user!.id, companyId);
  await requireSocialPublishingAccess(req.user!.id, req.user?.role);

  const result = await initTikTokDraftUpload({
    userId: req.user!.id,
    companyId,
    videoSize,
    title: safeString(req.body?.title, 300)
  });

  res.json(result);
}));

router.post('/social/youtube/init-upload', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  const title = safeString(req.body?.title, 100);
  if (!companyId || !title) return res.status(400).json({ error: 'companyId e title são obrigatórios.' });
  await requireOwnedCompany(req.user!.id, companyId);
  await requireSocialPublishingAccess(req.user!.id, req.user?.role);

  const result = await initYouTubeResumableUpload({
    userId: req.user!.id,
    companyId,
    title,
    description: safeString(req.body?.description, 5000),
    privacyStatus: ['private', 'unlisted', 'public'].includes(req.body?.privacyStatus) ? req.body.privacyStatus : 'unlisted',
    videoSize: req.body?.videoSize ? Number(req.body.videoSize) : undefined,
    mimeType: safeString(req.body?.mimeType, 100) || 'video/mp4'
  });

  res.json(result);
}));

router.get('/social/pinterest/boards', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.status(400).json({ error: 'companyId é obrigatório.' });
  await requireOwnedCompany(req.user!.id, companyId);

  const boards = await getPinterestBoards({
    userId: req.user!.id,
    companyId
  });

  res.json({ boards });
}));

router.post('/social/pinterest/create-pin', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.body?.companyId, 200);
  const boardId = safeString(req.body?.boardId, 200);
  const title = safeString(req.body?.title, 100);
  const imageUrl = safeHttpUrl(req.body?.imageUrl, 2000);

  if (!companyId || !boardId || !title || !imageUrl) {
    return res.status(400).json({ error: 'companyId, boardId, title e imageUrl válida são obrigatórios.' });
  }
  await requireOwnedCompany(req.user!.id, companyId);
  await requireSocialPublishingAccess(req.user!.id, req.user?.role);

  const result = await createPinterestPin({
    userId: req.user!.id,
    companyId,
    boardId,
    title,
    description: safeString(req.body?.description, 800),
    link: safeHttpUrl(req.body?.link, 1000) || undefined,
    imageUrl
  });

  res.json(result);
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
function sanitizePublicVitrineCompany(company: any) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    segment: company.segment || '',
    niche: company.niche || '',
    description: company.description || '',
    logoUrl: company.logoUrl || null,
    coverUrl: company.coverUrl || null,
    website: company.website || null,
    whatsapp: company.whatsapp || null,
    androidApp: appLinksOf(company).android,
    iosApp: appLinksOf(company).ios,
    instagram: company.instagram || null,
    linkedin: company.linkedin || null,
    facebook: company.facebook || null,
    youtube: company.youtube || null,
    tiktok: company.tiktok || null,
    city: company.city || null,
    state: company.state || null,
    country: company.country || 'BR',
    businessType: company.businessType || 'digital',
    isPublicInVitrine: true,
    updatedAt: company.updatedAt || company.createdAt || null
  };
}

router.get('/vitrine', asyncRoute(async (_req, res) => {
  const snap = await firestore().collection(COLLECTIONS.companies).get();
  const companies = queryData<any>(snap)
    .filter((c) => parseStrictBoolean(c.isPublicInVitrine))
    .map((c) => sanitizePublicVitrineCompany(c))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  res.json({ companies });
}));
router.get('/vitrine/:slug', asyncRoute(async (req, res) => {
  const param = safeString(req.params.slug, 200);
  const snap = await firestore().collection(COLLECTIONS.companies).where('slug', '==', param).limit(1).get();
  if (!snap.empty) {
    const data = snap.docs[0].data() as any;
    if (parseStrictBoolean(data.isPublicInVitrine)) {
      const company = sanitizePublicVitrineCompany({ id: snap.docs[0].id, ...data });
      return res.json({ company });
    }
  }
  // Try direct document ID fallback
  const directSnap = await firestore().collection(COLLECTIONS.companies).doc(param).get();
  if (directSnap.exists) {
    const data = directSnap.data() as any;
    if (parseStrictBoolean(data.isPublicInVitrine)) {
      const company = sanitizePublicVitrineCompany({ id: directSnap.id, ...data });
      return res.json({ company });
    }
  }
  res.status(404).json({ error: 'Empresa não encontrada ou não está visível na Vitrine Pública.' });
}));


// ───────────── Froc.IA Concierge (IA conversacional que executa tudo) ─────────────
async function optionalAuth(req: AuthenticatedRequest, res: Response, next: () => void): Promise<void> {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  if (!header) { next(); return; }
  await requireAuth(req, res, next as any);
}

router.get('/agents', (_req, res) => {
  res.json({ total: FROC_AGENTS.length, squads: FROC_SQUADS.map(({ id, name, color, mission, roles }) => ({ id, name, color, mission, agents: roles.length })), agents: FROC_AGENTS });
});

/** IP real do visitante: no Vercel o cabeçalho próprio da plataforma não pode ser forjado pelo cliente. */
export function trustedClientIp(req: AuthenticatedRequest): string {
  const header = (name: string) => String(req.headers[name] || '').split(',')[0].trim();
  return (header('x-vercel-forwarded-for') || header('x-real-ip') || String(req.ip || req.socket?.remoteAddress || '') || 'unknown').slice(0, 200);
}

function chatNeedsMessage(reason: 'login' | 'credits', name?: string): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const who = first && !first.includes('@') ? `${first.charAt(0).toUpperCase()}${first.slice(1)}, ` : '';
  if (reason === 'login') return `Adorei conversar com você! 😊 Pra gente continuar, crie sua conta grátis: você ganha ${config.freeSignupBonusCredits} créditos de presente e eu já começo a montar o marketing do seu negócio. 🚀`;
  return `${who}seus créditos acabaram por agora. Cada resposta minha usa ${config.billing.chatReplyCost} créditos. Escolha um plano ou recarregue e a gente continua de onde parou! 💛`;
}

type ChatReady = { messages: ReturnType<typeof sanitizeMessages>; conversationId?: string; reservationId: string; cost: number; account?: { paidPlan: boolean; planName?: string; balance?: number; isAdmin?: boolean }; company?: any };
type ChatPrepared = { blocked: Record<string, any> } | ChatReady;

/** Valida, confere a cota do visitante e reserva os créditos da resposta (em paralelo para ser rápido). */
async function prepareChat(req: AuthenticatedRequest): Promise<ChatPrepared> {
  const messages = sanitizeMessages(req.body?.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') { const e: any = new Error('Envie uma mensagem para o Froc.IA.'); e.statusCode = 400; throw e; }
  const isAdmin = req.user?.role === 'admin';
  const cost = Number(config.billing.chatReplyCost) || 0;
  const conversationId = safeString(req.body?.conversationId, 200) || undefined;
  const base = { collected: req.body?.collected || {}, readyToConfirm: false, plan: null, agents: [], activeAgentsTotal: 0 };

  if (!req.user) {
    const limit = Number(config.billing.guestFreeReplies) || 0;
    const quota = limit > 0 ? await consumeRateLimit({ key: `guest-chat:${trustedClientIp(req)}`, limit, windowMs: 86_400_000 }) : { allowed: false };
    if (!quota.allowed) return { blocked: { ...base, reply: chatNeedsMessage('login'), quickReplies: ['Criar conta grátis'], needsAuth: true, needsLogin: true } };
    return { messages, cost: 0, reservationId: '' };
  }

  const [wallet, company, conversation] = await Promise.all([
    getWallet(req.user.id),
    ownedCompany(req.user.id, safeString(req.body?.companyId, 200)),
    conversationId ? getConversation(req.user.id, conversationId) : Promise.resolve(null)
  ]);
  if (conversation?.status === 'closed') { const e: any = new Error('Esta conversa foi fechada. Comece uma nova conversa.'); e.statusCode = 409; throw e; }
  const available = Math.max(Number(wallet.balance || 0) - Number(wallet.reservedCredits || 0), 0);
  const account = { paidPlan: isPaidPlan(wallet), planName: String(wallet.planId || '').replace('plan_', '').toUpperCase(), balance: available, isAdmin };
  let reservationId = '';
  if (!isAdmin && cost > 0) {
    try {
      reservationId = (await reserveCredits({ userId: req.user.id, amount: cost, operation: 'chat_reply' })).reservationId;
    } catch {
      return { blocked: { ...base, reply: chatNeedsMessage('credits', req.user.name), quickReplies: ['Ver planos', 'Comprar créditos'], needsAuth: false, needsCredits: true, wallet } };
    }
  }
  return { messages, conversationId, reservationId, cost, account, company };
}

/** Cobra só se a IA respondeu de verdade e salva a conversa. */
async function settleChat(req: AuthenticatedRequest, prepared: ChatReady, turn: any) {
  if (prepared.reservationId) {
    if (turn.aiAnswered) await commitReservation({ userId: req.user!.id, reservationId: prepared.reservationId, source: 'Chat Froc.IA: resposta', metadata: { conversationId: prepared.conversationId || null } });
    else await rollbackReservation(req.user!.id, prepared.reservationId, 'IA indisponível: resposta sem cobrança');
  }
  let conversationId: string | undefined;
  let wallet: any;
  if (req.user) {
    [conversationId, wallet] = await Promise.all([
      saveConversationTurn({ userId: req.user.id, conversationId: prepared.conversationId, messages: prepared.messages, reply: turn.reply, collected: turn.collected }).catch(() => prepared.conversationId),
      getWallet(req.user.id)
    ]);
  }
  return { ...turn, needsAuth: !req.user, conversationId, creditsUsed: prepared.reservationId && turn.aiAnswered ? prepared.cost : 0, wallet };
}

// Chat: cada resposta da IA usa `billing.chatReplyCost` créditos (admin não paga).
// Visitante tem `billing.guestFreeReplies` respostas grátis por dia (por rede), depois cria a conta.
router.post('/concierge/chat', optionalAuth as any, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const prepared = await prepareChat(req);
  if ('blocked' in prepared) return res.json(prepared.blocked);
  let turn;
  try {
    turn = await conciergeChat({ messages: prepared.messages, collected: req.body?.collected, company: prepared.company, authenticated: Boolean(req.user), userName: req.user?.name, account: prepared.account });
  } catch (error) {
    if (prepared.reservationId) await rollbackReservation(req.user!.id, prepared.reservationId, 'Falha no chat');
    throw error;
  }
  res.json(await settleChat(req, prepared, turn));
}));

// Mesmo chat, em streaming (SSE): a fala chega aos pedaços e a voz começa na primeira frase.
router.post('/concierge/chat/stream', optionalAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  let prepared: ChatPrepared;
  try {
    prepared = await prepareChat(req);
  } catch (error: any) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Falha no chat.' });
    return;
  }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
  const send = (event: string, payload: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  if ('blocked' in prepared) { send('done', prepared.blocked); res.end(); return; }
  const ready: ChatReady = prepared;
  try {
    const turn = await conciergeChatStream(
      { messages: ready.messages, collected: req.body?.collected, company: ready.company, authenticated: Boolean(req.user), userName: req.user?.name, account: ready.account },
      (text) => send('token', { text })
    );
    send('done', await settleChat(req, ready, turn));
  } catch (error: any) {
    if (ready.reservationId) await rollbackReservation(req.user!.id, ready.reservationId, 'Falha no chat').catch(() => undefined);
    send('error', { error: error?.message || 'Falha no chat.' });
  }
  if (!res.writableEnded) res.end();
});

router.get('/concierge/conversations', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  res.json({ conversations: await listConversations(req.user!.id) });
}));
router.get('/concierge/conversations/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  res.json({ conversation: await getConversation(req.user!.id, safeString(req.params.id, 200)) });
}));
router.post('/concierge/conversations/:id/close', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  await closeConversation(req.user!.id, safeString(req.params.id, 200));
  res.json({ message: 'Conversa fechada.' });
}));
router.delete('/concierge/conversations/:id', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  await deleteConversation(req.user!.id, safeString(req.params.id, 200));
  res.json({ message: 'Conversa excluída.' });
}));

router.post('/concierge/execute', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!req.body?.collected || !Array.isArray(req.body?.actions)) return res.status(400).json({ error: 'Plano inválido. Confirme o resumo com o Froc.IA novamente.' });
  const outcome = await executeConciergePlan({ userId: req.user!.id, isAdmin: req.user!.role === 'admin', companyId: safeString(req.body?.companyId, 200), collected: req.body.collected, actions: req.body.actions });
  res.json({ ...outcome, wallet: await getWallet(req.user!.id) });
}));


// ───────────── Voz do Froc.IA (microfone + voz neural, mesmo sistema do Froc IA) ─────────────
function speechTextFromBody(body: any): string {
  return cleanSpeechText(safeString(body?.text, 6000));
}

router.post('/ai/speech/live-token', requireAuth, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await createLiveTranscriptionToken());
}));

router.post('/ai/speech', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const text = speechTextFromBody(req.body);
  if (!text) return res.status(400).json({ error: 'O texto para voz é inválido ou excede o limite permitido.' });
  try {
    const result = await synthesizeSpeech(text);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(result);
  } catch (error: any) {
    console.error('[Froc Voz] Falha na voz neural:', error?.message || error);
    res.status(503).json({ error: 'A voz neural está temporariamente indisponível.' });
  }
}));

router.post('/ai/speech/stream', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const text = speechTextFromBody(req.body);
  if (!text) {
    res.status(400).json({ error: 'O texto para voz é inválido ou excede o limite permitido.' });
    return;
  }
  let started = false;
  let clientGone = false;
  res.once('close', () => { clientGone = true; });
  try {
    for await (const chunk of synthesizeSpeechStream(text)) {
      if (clientGone || res.writableEnded || res.destroyed) break;
      if (!started) {
        started = true;
        res.status(200);
        res.setHeader('Content-Type', 'audio/L16');
        res.setHeader('Cache-Control', 'private, no-store, no-transform');
        res.setHeader('X-Froc-Audio-Format', 'pcm-s16le');
        res.setHeader('X-Froc-Audio-Sample-Rate', String(NEURAL_SPEECH_SAMPLE_RATE));
        res.setHeader('X-Froc-Audio-Channels', String(NEURAL_SPEECH_CHANNELS));
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
      }
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done);
          res.once('close', done);
        });
      }
    }
    if (!started && !res.headersSent) {
      res.status(503).json({ error: 'O streaming de voz está temporariamente indisponível.' });
      return;
    }
    if (!res.writableEnded && !res.destroyed) res.end();
  } catch (error: any) {
    console.error('[Froc Voz] Falha no streaming da voz:', error?.message || error);
    if (res.writableEnded || res.destroyed) return;
    // Nenhum áudio enviado ainda: devolve JSON para o navegador usar o fallback.
    if (!started && !res.headersSent) {
      res.status(503).json({ error: 'O streaming de voz está temporariamente indisponível.' });
      return;
    }
    res.end();
  }
});

// ───────────── Posts diários da Vitrine (público + painel) ─────────────
router.get('/vitrine-posts', asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 24), 1), 100);
  const [postsSnap, companiesSnap] = await Promise.all([
    firestore().collection(COLLECTIONS.vitrinePosts).where('status', '==', 'published').get(),
    firestore().collection(COLLECTIONS.companies).get()
  ]);
  const publicIds = new Set(queryData<any>(companiesSnap).filter((c) => parseStrictBoolean(c.isPublicInVitrine)).map((c) => c.id));
  const posts = queryData<any>(postsSnap).filter((p) => publicIds.has(p.companyId))
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, limit)
    .map((p) => ({ ...sanitizePublicVitrinePost(p), content: undefined }));
  res.json({ posts });
}));

router.get('/vitrine-posts/mine', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const snap = await firestore().collection(COLLECTIONS.vitrinePosts).where('userId', '==', req.user!.id).get();
  const companyId = safeString(req.query.companyId, 200);
  const posts = queryData<any>(snap).filter((p) => !companyId || p.companyId === companyId)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 60).map(sanitizePublicVitrinePost);
  res.json({ posts });
}));

router.get('/vitrine-clicks/mine', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const companyId = safeString(req.query.companyId, 200);
  if (!companyId) return res.json({ clicks: { total: 0, site: 0, app: 0, whatsapp: 0 } });
  await requireOwnedCompany(req.user!.id, companyId);
  const snap = await firestore().collection(COLLECTIONS.linkClicks).doc(companyId).get();
  const data: any = snap.exists ? snap.data() : {};
  res.json({ clicks: { total: Number(data.total || 0), site: Number(data.site || 0), app: Number(data.android || 0) + Number(data.ios || 0), whatsapp: Number(data.whatsapp || 0) } });
}));

router.get('/vitrine/:slug/posts', asyncRoute(async (req, res) => {
  const slug = safeString(req.params.slug, 200);
  const companySnap = await firestore().collection(COLLECTIONS.companies).where('slug', '==', slug).limit(1).get();
  if (companySnap.empty || !parseStrictBoolean((companySnap.docs[0].data() as any).isPublicInVitrine)) return res.status(404).json({ error: 'Empresa não encontrada na vitrine.' });
  const snap = await firestore().collection(COLLECTIONS.vitrinePosts).where('companyId', '==', companySnap.docs[0].id).get();
  const posts = queryData<any>(snap).filter((p) => p.status === 'published')
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 60)
    .map((p) => ({ ...sanitizePublicVitrinePost(p), content: undefined }));
  res.json({ posts });
}));

router.get('/vitrine/:slug/posts/:postSlug', asyncRoute(async (req, res) => {
  const slug = safeString(req.params.slug, 200);
  const postSlug = safeString(req.params.postSlug, 200);
  const snap = await firestore().collection(COLLECTIONS.vitrinePosts).where('slug', '==', postSlug).limit(1).get();
  if (snap.empty) return res.status(404).json({ error: 'Post não encontrado.' });
  const post = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
  const companySnap = await firestore().collection(COLLECTIONS.companies).doc(post.companyId).get();
  const company = companySnap.exists ? { id: companySnap.id, ...companySnap.data() } as any : null;
  if (!company || company.slug !== slug || !parseStrictBoolean(company.isPublicInVitrine) || post.status !== 'published') return res.status(404).json({ error: 'Post não encontrado.' });
  res.json({ post: sanitizePublicVitrinePost(post), company: sanitizePublicVitrineCompany(company) });
}));


// ───────────── Janela "Posts": todas as postagens do site (Magazine + Vitrine) ─────────────
router.get('/posts', asyncRoute(async (req, res) => {
  const type = ['magazine', 'vitrine'].includes(String(req.query.type)) ? String(req.query.type) : 'all';
  const q = safeString(req.query.q, 100).toLocaleLowerCase('pt-BR');
  const limit = Math.min(Math.max(Number(req.query.limit || 24), 1), 60);
  const page = Math.min(Math.max(Number(req.query.page || 1), 1), 1000);
  const all = await listAllPublicPosts();
  const filtered = all.filter((post) => (type === 'all' || post.kind === type) && (!q || `${post.title} ${post.summary} ${post.source} ${post.label} ${post.location || ''}`.toLocaleLowerCase('pt-BR').includes(q)));
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.json({
    posts: filtered.slice((page - 1) * limit, page * limit),
    total: filtered.length,
    page,
    hasMore: page * limit < filtered.length,
    counts: { all: all.length, magazine: all.filter((p) => p.kind === 'magazine').length, vitrine: all.filter((p) => p.kind === 'vitrine').length }
  });
}));


// ───────────── Painel Admin completo: usuários, créditos, planos, projetos, posts, pagamentos ─────────────
const ADMIN_ROLES = ['user', 'admin', 'support', 'editor'];
const ADMIN_PLAN_IDS = ['plan_start', 'plan_pro', 'plan_business', 'plan_agency'];

function walletSummary(wallet: any) {
  return {
    balance: Number(wallet?.balance || 0),
    bonusBalance: Number(wallet?.bonusBalance || 0),
    reservedCredits: Number(wallet?.reservedCredits || 0),
    totalUsed: Number(wallet?.totalUsed || 0),
    totalReceived: Number(wallet?.totalReceived || 0),
    planId: wallet?.planId || 'plan_free',
    planStatus: wallet?.planStatus || 'free',
    currentPeriodEnd: wallet?.currentPeriodEnd || null
  };
}

async function requireExistingUser(userId: string): Promise<any> {
  const snap = await firestore().collection(COLLECTIONS.users).doc(userId).get();
  if (!snap.exists) {
    const error: any = new Error('Usuário não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  return { id: snap.id, ...snap.data() };
}

async function deleteWhere(collection: string, field: string, value: string): Promise<number> {
  const db = firestore();
  let removed = 0;
  while (true) {
    const snap = await db.collection(collection).where(field, '==', value).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
    removed += snap.size;
    if (snap.size < 400) break;
  }
  return removed;
}

router.get('/admin/dashboard', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const db = firestore();
  const [users, wallets, companies, contents, blog, vitrinePosts, payments, tickets, executions] = await Promise.all([
    db.collection(COLLECTIONS.users).get(), db.collection(COLLECTIONS.wallets).get(), db.collection(COLLECTIONS.companies).get(),
    db.collection(COLLECTIONS.contentItems).get(), db.collection(COLLECTIONS.blogPosts).get(), db.collection(COLLECTIONS.vitrinePosts).get(),
    db.collection(COLLECTIONS.payments).get(), db.collection(COLLECTIONS.supportTickets).get(), db.collection(COLLECTIONS.aiExecutions).get()
  ]);
  const walletList = queryData<any>(wallets);
  const paymentList = queryData<any>(payments);
  const approved = paymentList.filter((p) => p.lastPaymentStatus === 'approved' && p.source !== 'admin_grant');
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const userList = queryData<any>(users);
  res.json({
    stats: {
      users: users.size,
      newUsers7d: userList.filter((u) => String(u.createdAt || '') >= since).length,
      companies: companies.size,
      vitrineCompanies: queryData<any>(companies).filter((c) => parseStrictBoolean(c.isPublicInVitrine)).length,
      contents: contents.size,
      blogPublished: queryData<any>(blog).filter((p) => p.status === 'published').length,
      vitrinePosts: vitrinePosts.size,
      creditsInCirculation: walletList.reduce((sum, w) => sum + Number(w.balance || 0), 0),
      creditsUsed: walletList.reduce((sum, w) => sum + Number(w.totalUsed || 0), 0),
      paidUsers: walletList.filter((w) => w.planId && w.planId !== 'plan_free').length,
      revenueApproved: Math.round(approved.reduce((sum, p) => sum + Number(p.amount || p.price || 0), 0) * 100) / 100,
      openTickets: queryData<any>(tickets).filter((t) => ['open', 'in_progress'].includes(t.status)).length,
      aiExecutions: executions.size,
      aiFailures: queryData<any>(executions).filter((e) => e.status === 'failed').length
    }
  });
}));

router.get('/admin/users', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const db = firestore();
  const [usersSnap, walletsSnap, companiesSnap] = await Promise.all([db.collection(COLLECTIONS.users).get(), db.collection(COLLECTIONS.wallets).get(), db.collection(COLLECTIONS.companies).get()]);
  const wallets = new Map(queryData<any>(walletsSnap).map((w) => [w.userId || w.id, w]));
  const companyCount = new Map<string, number>();
  queryData<any>(companiesSnap).forEach((c) => companyCount.set(c.userId, (companyCount.get(c.userId) || 0) + 1));
  const users = queryData<any>(usersSnap).map(({ passwordHash, ...user }) => ({ ...user, wallet: walletSummary(wallets.get(user.id)), companies: companyCount.get(user.id) || 0 }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json({ users });
}));

router.get('/admin/users/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const user = await requireExistingUser(safeString(req.params.id, 200));
  const db = firestore();
  const [wallet, companies, contents, payments] = await Promise.all([
    getWallet(user.id),
    db.collection(COLLECTIONS.companies).where('userId', '==', user.id).get(),
    db.collection(COLLECTIONS.contentItems).where('userId', '==', user.id).get(),
    db.collection(COLLECTIONS.payments).where('userId', '==', user.id).get()
  ]);
  const { passwordHash, ...safeUser } = user;
  res.json({
    user: safeUser,
    wallet: walletSummary(wallet),
    companies: queryData<any>(companies),
    transactions: await listCreditTransactions(user.id, 50),
    contents: queryData<any>(contents).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30)
      .map((c) => ({ id: c.id, type: c.type, title: c.title, companyId: c.companyId, status: c.status, creditsUsed: c.creditsUsed, createdAt: c.createdAt })),
    payments: queryData<any>(payments).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  });
}));

router.patch('/admin/users/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const user = await requireExistingUser(safeString(req.params.id, 200));
  const patch: Record<string, any> = { updatedAt: nowIso() };
  if (req.body?.name !== undefined) patch.name = safeString(req.body.name, 120);
  if (req.body?.role !== undefined) {
    const role = safeString(req.body.role, 20);
    if (!ADMIN_ROLES.includes(role)) return res.status(400).json({ error: 'Papel inválido.' });
    if (user.id === req.user!.id && role !== 'admin') return res.status(400).json({ error: 'Você não pode remover o seu próprio acesso de administrador.' });
    patch.role = role;
    await getAdminAuth().setCustomUserClaims(user.id, { role, frocRole: role });
  }
  if (req.body?.disabled !== undefined) {
    const disabled = parseStrictBoolean(req.body.disabled);
    if (user.id === req.user!.id && disabled) return res.status(400).json({ error: 'Você não pode bloquear a sua própria conta.' });
    patch.disabled = disabled;
    await getAdminAuth().updateUser(user.id, { disabled });
    if (disabled) await getAdminAuth().revokeRefreshTokens(user.id);
  }
  await firestore().collection(COLLECTIONS.users).doc(user.id).set(cleanObject(patch), { merge: true });
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'update_user', targetUserId: user.id, details: { ...patch, updatedAt: undefined } });
  res.json({ message: 'Usuário atualizado.', user: { ...user, ...patch, passwordHash: undefined } });
}));

router.delete('/admin/users/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const user = await requireExistingUser(safeString(req.params.id, 200));
  if (user.id === req.user!.id) return res.status(400).json({ error: 'Você não pode excluir a sua própria conta pelo painel.' });
  if (safeString(req.body?.confirm, 200) !== user.email && safeString(req.body?.confirm, 200) !== user.id) {
    return res.status(400).json({ error: 'Confirme digitando o e-mail do usuário.' });
  }
  const db = firestore();
  const companies = queryData<any>(await db.collection(COLLECTIONS.companies).where('userId', '==', user.id).get());
  for (const company of companies) {
    await deleteCompanyData(user.id, company.id);
    await deleteWhere(COLLECTIONS.vitrinePosts, 'companyId', company.id);
    await db.collection(COLLECTIONS.companies).doc(company.id).delete();
  }
  const removed: Record<string, number> = { companies: companies.length };
  for (const collection of [COLLECTIONS.contentItems, COLLECTIONS.scheduledPosts, COLLECTIONS.campaigns, COLLECTIONS.notifications, COLLECTIONS.conciergeSessions, COLLECTIONS.conversations, COLLECTIONS.mediaGenerationJobs, COLLECTIONS.creditReservations]) {
    removed[collection] = await deleteWhere(collection, 'userId', user.id);
  }
  await db.collection(COLLECTIONS.wallets).doc(user.id).delete();
  await db.collection(COLLECTIONS.users).doc(user.id).delete();
  // Pagamentos e extrato de créditos são mantidos (obrigação fiscal/auditoria).
  try {
    await getAdminAuth().deleteUser(user.id);
  } catch (error: any) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'delete_user', targetUserId: user.id, details: { email: user.email, removed } });
  res.json({ message: 'Perfil excluído. Pagamentos e extrato foram preservados para auditoria.', removed });
}));

router.post('/admin/remove-credits', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const userId = safeString(req.body?.userId, 200);
  const amount = Number(req.body?.amount || 0);
  const reason = safeString(req.body?.reason, 500) || 'Remoção administrativa';
  if (!userId || !Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000) return res.status(400).json({ error: 'Usuário ou quantidade inválidos.' });
  await requireExistingUser(userId);
  const wallet = await removeCreditsAdmin({ userId, amount, reason, operatorId: req.user!.id });
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'remove_credits', targetUserId: userId, details: { amount, reason } });
  res.json({ message: 'Créditos removidos.', wallet: walletSummary(wallet) });
}));

router.post('/admin/users/:id/plan', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const user = await requireExistingUser(safeString(req.params.id, 200));
  const db = firestore();
  if (req.body?.revoke === true) {
    const grants = queryData<any>(await db.collection(COLLECTIONS.payments).where('userId', '==', user.id).get()).filter((p) => p.source === 'admin_grant' && p.status !== 'failed');
    for (const grant of grants) await db.collection(COLLECTIONS.payments).doc(grant.id).set({ status: 'failed', lastPaymentStatus: 'rejected', revokedAt: nowIso(), revokedBy: req.user!.id }, { merge: true });
    await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'revoke_plan', targetUserId: user.id, details: { revoked: grants.length } });
    return res.json({ message: 'Planos concedidos pelo admin foram revogados.', wallet: walletSummary(await getWallet(user.id)) });
  }
  const planId = safeString(req.body?.planId, 40);
  const days = Math.min(Math.max(Number(req.body?.days || 30), 1), 3650);
  if (!ADMIN_PLAN_IDS.includes(planId)) return res.status(400).json({ error: 'Plano inválido.' });
  const plan = config.plans.find((item) => item.id === planId);
  const id = newId('order');
  const now = nowIso();
  await db.collection(COLLECTIONS.payments).doc(id).set({
    id, userId: user.id, planId, planName: plan?.name || planId, amount: 0, status: 'active', lastPaymentStatus: 'approved', lastCreditedAt: now,
    currentPeriodEnd: new Date(Date.now() + days * 86_400_000).toISOString(), source: 'admin_grant', grantedBy: req.user!.id, createdAt: now, updatedAt: now
  });
  if (parseStrictBoolean(req.body?.withCredits) && plan) {
    await addCredits({ userId: user.id, amount: plan.totalCredits, type: 'admin_adjustment', source: `Plano ${plan.name} concedido pelo admin`, idempotencyKey: `admin-plan:${id}`, metadata: { operatorId: req.user!.id } });
  }
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'grant_plan', targetUserId: user.id, details: { planId, days } });
  await createNotification({ userId: user.id, title: 'Plano ativado', message: `Seu plano ${plan?.name || planId} foi ativado por ${days} dias.`, type: 'system' });
  res.json({ message: `Plano ${plan?.name || planId} ativado por ${days} dias.`, wallet: walletSummary(await getWallet(user.id)) });
}));

router.get('/admin/companies', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const db = firestore();
  const [companiesSnap, usersSnap, postsSnap, clicksSnap] = await Promise.all([db.collection(COLLECTIONS.companies).get(), db.collection(COLLECTIONS.users).get(), db.collection(COLLECTIONS.vitrinePosts).get(), db.collection(COLLECTIONS.linkClicks).get()]);
  const clicks = new Map(queryData<any>(clicksSnap).map((c) => [c.companyId || c.id, c]));
  const users = new Map(queryData<any>(usersSnap).map((u) => [u.id, u]));
  const postCount = new Map<string, number>();
  queryData<any>(postsSnap).forEach((p) => postCount.set(p.companyId, (postCount.get(p.companyId) || 0) + 1));
  const companies = queryData<any>(companiesSnap).map((c) => ({
    id: c.id, name: c.name, slug: c.slug, userId: c.userId, ownerName: users.get(c.userId)?.name || '', ownerEmail: users.get(c.userId)?.email || '',
    category: c.category || '', city: c.city || '', state: c.state || '', website: c.website || '', whatsapp: c.whatsapp || '', description: c.description || '',
    androidApp: c.androidApp || '', iosApp: c.iosApp || '',
    clicks: { total: Number(clicks.get(c.id)?.total || 0), site: Number(clicks.get(c.id)?.site || 0), app: Number(clicks.get(c.id)?.android || 0) + Number(clicks.get(c.id)?.ios || 0), whatsapp: Number(clicks.get(c.id)?.whatsapp || 0) },
    isPublicInVitrine: parseStrictBoolean(c.isPublicInVitrine), dailyPostsEnabled: c.dailyPostsEnabled !== false, vitrineBillingExempt: c.vitrineBillingExempt === true || users.get(c.userId)?.role === 'admin',
    vitrineRemovedReason: c.vitrineRemovedReason || null, vitrinePosts: postCount.get(c.id) || 0, createdAt: c.createdAt || '', updatedAt: c.updatedAt || ''
  })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ companies });
}));

// Chave geral do post diário (somente admin): desligada = nenhum post e nenhuma cobrança no site inteiro.
router.get('/admin/settings/daily-posts', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  res.json({ ...(await getSiteSettings()), dailyCost: vitrineDailyCost(), chatReplyCost: config.billing.chatReplyCost, guestFreeReplies: config.billing.guestFreeReplies });
}));
router.patch('/admin/settings/daily-posts', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const result = await setSiteDailyPosts(parseStrictBoolean(req.body?.dailyPostsEnabled), req.user!.id);
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'site_daily_posts', details: result });
  res.json({ message: result.dailyPostsEnabled ? 'Post diário ligado no site.' : 'Post diário desligado no site (sem posts e sem cobrança).', ...result });
}));

router.post('/admin/companies', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  // Sem dono escolhido, o projeto fica na conta do próprio administrador (sem limite de quantidade).
  const userId = safeString(req.body?.userId, 200) || req.user!.id;
  const name = safeString(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: 'O nome do projeto é obrigatório.' });
  await requireExistingUser(userId);
  const id = newId('company');
  const company = cleanObject({
    id, userId, name, slug: `${slugify(name)}-${id.slice(-6)}`,
    description: safeString(req.body?.description, 5000), website: safeHttpUrl(req.body?.website, 1000), whatsapp: safeString(req.body?.whatsapp, 80),
    androidApp: safeHttpUrl(req.body?.androidApp, 1000), iosApp: safeHttpUrl(req.body?.iosApp, 1000),
    city: safeString(req.body?.city, 150), state: safeString(req.body?.state, 100), country: safeString(req.body?.country, 100) || 'Brasil',
    category: safeString(req.body?.category, 150) || 'Comércio & Serviços', businessType: normalizeCompanyField('businessType', req.body?.businessType || 'online'),
    products: [], services: [], keywords: [], isPublicInVitrine: parseStrictBoolean(req.body?.isPublicInVitrine),
    // Projeto colocado pelo admin: não paga diária (o admin pode mudar isso depois).
    vitrineBillingExempt: req.body?.vitrineBillingExempt === undefined ? true : parseStrictBoolean(req.body.vitrineBillingExempt),
    dailyPostsEnabled: req.body?.dailyPostsEnabled === undefined ? true : parseStrictBoolean(req.body.dailyPostsEnabled),
    createdBy: req.user!.id, createdAt: nowIso(), updatedAt: nowIso()
  });
  await firestore().collection(COLLECTIONS.companies).doc(id).set(company);
  if (company.isPublicInVitrine) await pingIndexNow([`${config.appUrl.replace(/\/$/, '')}/vitrine/${encodeURIComponent(company.slug)}`], 'admin_company_create');
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'create_company', targetUserId: userId, details: { companyId: id, name } });
  res.status(201).json({ message: 'Projeto criado.', company });
}));

router.patch('/admin/companies/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.companies).doc(safeString(req.params.id, 200));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Projeto não encontrado.' });
  const current = { id: snap.id, ...snap.data() } as any;
  const allowed = ['name', 'description', 'website', 'whatsapp', 'androidApp', 'iosApp', 'city', 'state', 'country', 'category', 'businessType', 'isPublicInVitrine', 'dailyPostsEnabled', 'vitrineBillingExempt'];
  const patch: Record<string, any> = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = normalizeCompanyField(key, req.body[key]);
  if (req.body?.userId !== undefined) {
    const newOwner = safeString(req.body.userId, 200);
    await requireExistingUser(newOwner);
    patch.userId = newOwner;
  }
  if (patch.name && patch.name !== current.name) patch.slug = `${slugify(patch.name)}-${current.id.slice(-6)}`;
  patch.updatedAt = nowIso();
  await ref.set(cleanObject(patch), { merge: true });
  if (patch.userId) {
    const posts = queryData<any>(await firestore().collection(COLLECTIONS.vitrinePosts).where('companyId', '==', current.id).get());
    for (const post of posts) await firestore().collection(COLLECTIONS.vitrinePosts).doc(post.id).set({ userId: patch.userId }, { merge: true });
  }
  const fresh = { id: current.id, ...(await ref.get()).data() } as any;
  if (parseStrictBoolean(fresh.isPublicInVitrine)) await pingIndexNow([`${config.appUrl.replace(/\/$/, '')}/vitrine/${encodeURIComponent(fresh.slug)}`], 'admin_company_update');
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'update_company', targetUserId: fresh.userId, details: { companyId: current.id, fields: Object.keys(patch) } });
  res.json({ message: 'Projeto atualizado.', company: fresh });
}));

router.delete('/admin/companies/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.companies).doc(safeString(req.params.id, 200));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Projeto não encontrado.' });
  const company = { id: snap.id, ...snap.data() } as any;
  await deleteCompanyData(company.userId, company.id);
  const posts = await deleteWhere(COLLECTIONS.vitrinePosts, 'companyId', company.id);
  await firestore().collection(COLLECTIONS.linkClicks).doc(company.id).delete();
  await ref.delete();
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'delete_company', targetUserId: company.userId, details: { companyId: company.id, name: company.name, vitrinePosts: posts } });
  res.json({ message: 'Projeto excluído com todos os dados vinculados.' });
}));

router.get('/admin/vitrine-posts', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const snap = await firestore().collection(COLLECTIONS.vitrinePosts).get();
  const posts = queryData<any>(snap).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 300)
    .map((p) => ({ id: p.id, title: p.title, slug: p.slug, companyId: p.companyId, companySlug: p.companySlug, companyName: p.companyName, status: p.status, angleLabel: p.angleLabel, date: p.date, publishedAt: p.publishedAt, imageUrl: p.imageUrl || null, imageGenerated: Boolean(p.imageGenerated) }));
  res.json({ posts });
}));

router.patch('/admin/vitrine-posts/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.vitrinePosts).doc(safeString(req.params.id, 300));
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Post não encontrado.' });
  const status = safeString(req.body?.status, 20);
  if (!['published', 'archived'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  await ref.set({ status, updatedAt: nowIso() }, { merge: true });
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'vitrine_post_status', details: { postId: req.params.id, status } });
  res.json({ message: status === 'published' ? 'Post publicado.' : 'Post arquivado (removido do site e dos sitemaps).' });
}));

router.delete('/admin/vitrine-posts/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref = firestore().collection(COLLECTIONS.vitrinePosts).doc(safeString(req.params.id, 300));
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Post não encontrado.' });
  await ref.delete();
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'delete_vitrine_post', details: { postId: req.params.id } });
  res.json({ message: 'Post excluído.' });
}));

router.get('/admin/payments', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const db = firestore();
  const [paymentsSnap, usersSnap] = await Promise.all([db.collection(COLLECTIONS.payments).get(), db.collection(COLLECTIONS.users).get()]);
  const users = new Map(queryData<any>(usersSnap).map((u) => [u.id, u]));
  const payments = queryData<any>(paymentsSnap).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 500)
    .map((p) => ({ id: p.id, userId: p.userId, userEmail: users.get(p.userId)?.email || '', planId: p.planId || '', planName: p.planName || p.planId || p.packageId || '', amount: Number(p.amount || p.price || 0), status: p.status || '', lastPaymentStatus: p.lastPaymentStatus || '', source: p.source || 'mercadopago', currentPeriodEnd: p.currentPeriodEnd || null, createdAt: p.createdAt || '' }));
  res.json({ payments });
}));

router.get('/admin/activity', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  const db = firestore();
  const [logsSnap, execSnap, txSnap] = await Promise.all([db.collection(COLLECTIONS.adminLogs).get(), db.collection(COLLECTIONS.aiExecutions).get(), db.collection(COLLECTIONS.creditTransactions).get()]);
  const byDate = (field: string) => (a: any, b: any) => String(b[field] || '').localeCompare(String(a[field] || ''));
  res.json({
    adminLogs: queryData<any>(logsSnap).sort(byDate('createdAt')).slice(0, 100),
    aiExecutions: queryData<any>(execSnap).sort(byDate('timestamp')).slice(0, 100).map((e) => ({ id: e.id, userId: e.userId, type: e.type, model: e.model, status: e.status, creditsConsumed: e.creditsConsumed, durationMs: e.durationMs, error: e.error, timestamp: e.timestamp })),
    transactions: queryData<any>(txSnap).sort(byDate('timestamp')).slice(0, 100)
  });
}));

// ───────────── Admin: Motor SEO e Vitrine diária ─────────────
router.post('/admin/posts/generate-images', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (parseStrictBoolean(req.body?.retryFailed)) await resetFailedPostImages();
  const result = await backfillPostImages(Math.min(Math.max(Number(req.body?.limit || 4), 1), 8));
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'generate_post_images', details: result });
  res.json({ ...result, message: `${result.generated} imagens criadas, ${result.failed} falhas, ${result.pending} posts ainda aguardando.` });
}));
router.get('/admin/voice/check', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  res.json(await diagnoseVoice());
}));
router.get('/admin/seo/status', requireAdmin, asyncRoute(async (_req: AuthenticatedRequest, res) => {
  res.json(await getSeoEngineStatus());
}));
router.post('/admin/seo/ping-all', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const result = await pingIndexNow(await allIndexableUrls(), 'admin_full_ping');
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'seo_ping_all', details: { status: result.status, submitted: result.submitted } });
  res.json(result);
}));
router.post('/admin/vitrine/generate-daily', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const result = await processVitrineDailyPosts({ force: true, limit: Math.min(Math.max(Number(req.body?.limit || 10), 1), 25) });
  await writeAdminLog({ operatorId: req.user!.id, operatorEmail: req.user!.email, action: 'vitrine_generate_daily', details: result });
  res.json(result);
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
  const image = await createPostImage({ title: safeString(article.title || topic, 180), summary: safeString(article.summary || article.metaDescription, 300), category: safeString(article.category, 100), folder: 'posts/magazine' });
  const post = { id, title:safeString(article.title,180), slug, summary:safeString(article.summary || article.metaDescription,500), content:safeString(article.content,120000), featuredImageUrl:image?.imageUrl || '', imageAlt:image?.imageAlt || '', author:config.blog.author, category:safeString(article.category,100)||'Marketing & IA', tags:stringArray(article.tags,12), seoTitle:safeString(article.title,70), seoDescription:safeString(article.metaDescription || article.summary,180), status:'draft', createdAt:nowIso(), updatedAt:nowIso(), generatedBy:'admin_ai', modelUsed:generated.modelUsed };
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
  await ref.set(patch,{merge:true}); const fresh=await ref.get(); const freshData:any=fresh.data()||{};
  if (freshData.status==='published' && freshData.slug) { const base=config.appUrl.replace(/\/$/,''); await pingIndexNow([`${base}/blog/${encodeURIComponent(freshData.slug)}`, `${base}/blog`], 'admin_blog_publish'); }
  res.json({ post:{id:fresh.id,...freshData} });
}));
router.delete('/admin/blog/:id', requireAdmin, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const ref=firestore().collection(COLLECTIONS.blogPosts).doc(req.params.id); const snap=await ref.get(); if(!snap.exists)return res.status(404).json({error:'Artigo não encontrado.'}); await ref.delete(); await writeAdminLog({operatorId:req.user!.id,operatorEmail:req.user!.email,action:'delete_blog',details:{postId:req.params.id}}); res.json({message:'Artigo removido.'});
}));

// Scheduler.
router.get('/cron/health', asyncRoute(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  const isAuthorized = Boolean(config.cronSecret && auth === `Bearer ${config.cronSecret}`);
  if (!isAuthorized) return res.status(401).json({ error: 'Cron não autorizado.' });
  res.json(await getSchedulerHealth());
}));

router.get('/cron/process', asyncRoute(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  const isAuthorized = Boolean(config.cronSecret && auth === `Bearer ${config.cronSecret}`);
  if (!isAuthorized) return res.status(401).json({ error: 'Cron não autorizado.' });
  res.json(await processSchedulerTick());
}));

// Compatibilidade com integrações antigas: ambas as rotas usam o mesmo coordenador e o mesmo lock.
router.get('/cron/social', asyncRoute(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  const isAuthorized = Boolean(config.cronSecret && auth === `Bearer ${config.cronSecret}`);
  if (!isAuthorized) return res.status(401).json({ error: 'Cron não autorizado.' });
  res.json(await processSchedulerTick());
}));

router.post('/cron/social', asyncRoute(async (req, res) => {
  const auth = String(req.headers.authorization || '');
  const isAuthorized = Boolean(config.cronSecret && auth === `Bearer ${config.cronSecret}`);
  if (!isAuthorized) return res.status(401).json({ error: 'Cron não autorizado.' });
  res.json(await processSchedulerTick());
}));

// Plans public catalog alias
router.get('/plans', (_req, res) => res.json({ plans: config.plans, gatewayConfigured: mercadoPagoConfigured() }));

// Technical SEO endpoints
router.get('/sitemap.xml', asyncRoute(async (_req, res) => res.type('application/xml').send(await buildSitemapXml())));
router.get('/robots.txt', (_req, res) => res.type('text/plain').send(buildRobotsTxt()));

// Compatibilidade: /sitemap.xml passa a servir o índice (padrão Yoast/Google).
export async function buildSitemapXml(): Promise<string> {
  return buildSitemapIndexXml();
}

export { buildRobotsTxt };

export { router };
export default router;
