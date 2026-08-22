import test from 'node:test';
import assert from 'node:assert/strict';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';
import { getPlanEntitlements } from '../server/production/plans.js';
import { getEffectiveWallet, resolveEffectivePlan } from '../server/production/credits.js';
import { config } from '../server/config/index.js';

test('Routes & Entitlements: Restrição de limite de empresas por plano', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_company_limit_test';

  // 1. Usuário Free (max 1 empresa)
  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    id: userId,
    userId,
    balance: 25,
    planId: 'plan_free',
    planStatus: 'free',
    updatedAt: new Date().toISOString()
  });

  const walletFree = await getEffectiveWallet(userId);
  const entFree = getPlanEntitlements(walletFree.planId);
  assert.equal(entFree.maxCompanies, 1);

  // Cria a primeira empresa
  await db.collection(COLLECTIONS.companies).doc('comp_1').set({
    id: 'comp_1',
    userId,
    name: 'Primeira Empresa'
  });

  const snap1 = await db.collection(COLLECTIONS.companies).where('userId', '==', userId).get();
  const count1 = snap1.docs.length;
  assert.equal(count1, 1);
  assert.equal(count1 >= entFree.maxCompanies, true); // Não pode criar mais

  // 2. Upgrade para Start (max 2 empresas)
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.collection(COLLECTIONS.payments).doc('ord_start_1').set({
    id: 'ord_start_1',
    userId,
    planId: 'plan_start',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: future,
    createdAt: new Date().toISOString()
  });

  const walletStart = await getEffectiveWallet(userId);
  const entStart = getPlanEntitlements(walletStart.planId);
  assert.equal(entStart.maxCompanies, 2);
  assert.equal(count1 < entStart.maxCompanies, true); // Pode criar a 2ª

  // Cria a segunda empresa
  await db.collection(COLLECTIONS.companies).doc('comp_2').set({
    id: 'comp_2',
    userId,
    name: 'Segunda Empresa'
  });

  const snap2 = await db.collection(COLLECTIONS.companies).where('userId', '==', userId).get();
  const count2 = snap2.docs.length;
  assert.equal(count2, 2);
  assert.equal(count2 >= entStart.maxCompanies, true); // Atingiu o limite de 2 empresas do Start
});

test('Routes & Entitlements: Validação fail-closed de rotas restritas a planos pagos (Campanhas e Redes)', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_route_access_test';

  // Configuração inicial no plano Free
  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    id: userId,
    userId,
    balance: 50,
    planId: 'plan_free',
    planStatus: 'free',
    updatedAt: new Date().toISOString()
  });

  // Validação Free: Campanhas (false), Redes (false)
  let planId = await resolveEffectivePlan(userId);
  let ent = getPlanEntitlements(planId);
  assert.equal(ent.campaigns, false);
  assert.equal(ent.socialConnections, false);

  // Upgrade para PRO: Campanhas (false), Redes (true)
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.collection(COLLECTIONS.payments).doc('ord_pro_access').set({
    id: 'ord_pro_access',
    userId,
    planId: 'plan_pro',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: future,
    createdAt: new Date().toISOString()
  });

  planId = await resolveEffectivePlan(userId);
  ent = getPlanEntitlements(planId);
  assert.equal(ent.campaigns, false);
  assert.equal(ent.socialConnections, true);

  // Upgrade para BUSINESS: Campanhas (true), Redes (true)
  await db.collection(COLLECTIONS.payments).doc('ord_biz_access').set({
    id: 'ord_biz_access',
    userId,
    planId: 'plan_business',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: future,
    createdAt: new Date().toISOString()
  });

  planId = await resolveEffectivePlan(userId);
  ent = getPlanEntitlements(planId);
  assert.equal(ent.campaigns, true);
  assert.equal(ent.socialConnections, true);

  // Expiração do plano Business no passado: deve cair para FREE fail-closed
  const past = new Date(Date.now() - 1000).toISOString();
  await db.collection(COLLECTIONS.payments).doc('ord_biz_access').update({
    currentPeriodEnd: past
  });
  await db.collection(COLLECTIONS.payments).doc('ord_pro_access').update({
    currentPeriodEnd: past
  });

  planId = await resolveEffectivePlan(userId);
  ent = getPlanEntitlements(planId);
  assert.equal(planId, 'plan_free');
  assert.equal(ent.campaigns, false);
  assert.equal(ent.socialConnections, false);
});

test('AI Grounding & Content: Validação de companyContext e restrição estrita de destinos', async () => {
  const { companyContext, cleanHeadingText, normalizeArticleHeadings, countArticleWords } = await import('../server/production/ai.js');

  // 1. Empresa sem canais cadastrados -> Não deve permitir inventar links nem WhatsApp
  const ctxEmpty = companyContext({
    name: 'Loja Teste',
    businessType: 'online',
    description: 'Venda de roupas'
  });
  assert.match(ctxEmpty, /NENHUM canal de contato ou link foi cadastrado/);
  assert.match(ctxEmpty, /PROIBIÇÃO DE FATOS FICTÍCIOS/);
  assert.match(ctxEmpty, /PROIBIÇÃO DE NÚMEROS E ESTATÍSTICAS INVENTADAS/);

  // 2. Empresa com website e WhatsApp reais -> Deve listar exatamente os destinos permitidos
  const ctxWithChannels = companyContext({
    name: 'Advocacia Silva',
    businessType: 'physical',
    website: 'https://advocaciasilva.com.br',
    whatsapp: '11999999999',
    city: 'São Paulo',
    state: 'SP'
  });
  assert.match(ctxWithChannels, /https:\/\/advocaciasilva\.com\.br/);
  assert.match(ctxWithChannels, /11999999999/);
  assert.match(ctxWithChannels, /DESTINOS DISPONÍVEIS PARA CTA/);

  // 3. Limpeza de cabeçalhos
  assert.equal(cleanHeadingText('## Meu Título H2'), 'Meu Título H2');
  assert.equal(cleanHeadingText('H2: Meu Título H2'), 'Meu Título H2');
  assert.equal(cleanHeadingText('h3 - Subtópico'), 'Subtópico');

  // 4. Normalização de artigo completo
  const rawArticle = {
    title: '## Como Escolher Software',
    sections: [
      {
        h2: 'H2: Critérios de Avaliação',
        content: 'Conteúdo explicativo rico com várias palavras aqui.',
        h3s: [{ h3: '### Segurança e LGPD', content: 'Detalhes sobre conformidade.' }]
      }
    ],
    faqSection: [
      { question: '## É seguro?', answer: 'Sim, totalmente seguro.' }
    ],
    introduction: 'Introdução do artigo com mais texto.',
    conclusion: 'Conclusão final.',
    callToAction: 'Entre em contato.'
  };
  const normalized = normalizeArticleHeadings(rawArticle);
  assert.equal(normalized.title, 'Como Escolher Software');
  assert.equal(normalized.sections[0].h2, 'Critérios de Avaliação');
  assert.equal(normalized.sections[0].h3s[0].h3, 'Segurança e LGPD');

  // 5. Contagem de palavras
  const words = countArticleWords(normalized);
  assert.equal(words > 15, true);
});

test('Shared CREDIT_COSTS: Backend e Frontend utilizam a mesma fonte e valores oficiais', async () => {
  const { CREDIT_COSTS: backendCosts } = await import('../shared/creditCosts.js');
  const { config } = await import('../server/config/index.js');

  const officialCosts = {
    cta: 1,
    headline: 1,
    caption: 2,
    full_post: 5,
    image_prompt: 10,
    variations: 10,
    image_ai: 15,
    image_ai_1k: 15,
    image_ai_2k: 25,
    image_ai_4k: 40,
    site_analysis: 20,
    strategy: 30,
    carousel: 30,
    seo_article: 35,
    video_script: 10,
    video_veo_fast: 50,
    video_veo_1080p: 100,
    video_veo_4k: 200,
    campaign: 50,
    autopilot_cycle: 5,
    auto_calendar: 100
  };

  assert.deepEqual(backendCosts, officialCosts);
  assert.deepEqual(config.creditCosts, officialCosts);
});

test('SEO & Google Search Console: renderPublicPage("/ ") contém meta tag oficial no head', async () => {
  const { renderPublicPage } = await import('../server/production/publicPages.js');
  const page = await renderPublicPage('/');
  
  assert.equal(page.status, 200);
  assert.match(page.html, /name="google-site-verification"/);
  assert.match(page.html, /content="WgcZ29owPWh-IYCntXdzzCadEoHsfk7NA7rx65_NRE4"/);
});

test('Vitrine & Sitemap: parseStrictBoolean e consistência de valores legados', async () => {
  const { parseStrictBoolean } = await import('../server/production/router.js');

  // Validação estrita
  assert.equal(parseStrictBoolean(true), true);
  assert.equal(parseStrictBoolean('true'), true);
  assert.equal(parseStrictBoolean(false), false);
  assert.equal(parseStrictBoolean('false'), false);
  assert.equal(parseStrictBoolean(undefined), false);
  assert.equal(parseStrictBoolean(null), false);
  assert.equal(parseStrictBoolean(''), false);
  assert.equal(parseStrictBoolean('sim'), false);
  assert.equal(parseStrictBoolean(1), false);
  assert.equal(parseStrictBoolean(0), false);
});

test('Social Connect & OAuth: Regra de acesso por plano e bypass autorizado para role === "admin"', async () => {
  resetMemoryDb();
  const db = firestore();
  const express = (await import('express')).default;
  const routerModule = await import('../server/production/router.js');
  const router = routerModule.default;
  const firebaseAdminProvider = await import('../server/providers/firebaseAdmin.js');
  const { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } = await import('../server/production/auth.js');

  const now = new Date().toISOString();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Configurar Usuário FREE Comum (role === 'user', plan_free)
  const freeUserId = 'usr_test_free_common';
  const freeCompanyId = 'comp_test_free_common';
  await db.collection(COLLECTIONS.users).doc(freeUserId).set({
    id: freeUserId,
    email: 'free.user@example.com',
    role: 'user',
    createdAt: now,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });
  await db.collection(COLLECTIONS.companies).doc(freeCompanyId).set({
    id: freeCompanyId,
    userId: freeUserId,
    name: 'Empresa Free'
  });
  await db.collection(COLLECTIONS.wallets).doc(freeUserId).set({
    id: freeUserId,
    userId: freeUserId,
    balance: 10,
    planId: 'plan_free',
    planStatus: 'free',
    updatedAt: now
  });

  // 2. Configurar Usuário ADMIN no plano FREE (role === 'admin', plan_free)
  const adminUserId = 'usr_test_admin_free';
  const adminCompanyId = 'comp_test_admin_free';
  await db.collection(COLLECTIONS.users).doc(adminUserId).set({
    id: adminUserId,
    email: 'admin.user@froc.ia',
    role: 'admin',
    createdAt: now,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });
  await db.collection(COLLECTIONS.companies).doc(adminCompanyId).set({
    id: adminCompanyId,
    userId: adminUserId,
    name: 'Empresa Admin'
  });
  await db.collection(COLLECTIONS.wallets).doc(adminUserId).set({
    id: adminUserId,
    userId: adminUserId,
    balance: 10,
    planId: 'plan_free',
    planStatus: 'free',
    updatedAt: now
  });

  // 3. Configurar Usuário PRO Comum (role === 'user', plan_pro)
  const proUserId = 'usr_test_pro_common';
  const proCompanyId = 'comp_test_pro_common';
  await db.collection(COLLECTIONS.users).doc(proUserId).set({
    id: proUserId,
    email: 'pro.user@example.com',
    role: 'user',
    createdAt: now,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });
  await db.collection(COLLECTIONS.companies).doc(proCompanyId).set({
    id: proCompanyId,
    userId: proUserId,
    name: 'Empresa Pro'
  });
  await db.collection(COLLECTIONS.wallets).doc(proUserId).set({
    id: proUserId,
    userId: proUserId,
    balance: 50,
    planId: 'plan_pro',
    planStatus: 'active',
    updatedAt: now
  });
  await db.collection(COLLECTIONS.payments).doc('ord_pro_test').set({
    id: 'ord_pro_test',
    userId: proUserId,
    planId: 'plan_pro',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: future,
    createdAt: now
  });

  // Mock do Firebase Admin Auth para autenticar os 3 usuários
  firebaseAdminProvider.setAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 'token_free_user') {
        return { uid: freeUserId, email: 'free.user@example.com', role: 'user' } as any;
      }
      if (token === 'token_admin_free') {
        return { uid: adminUserId, email: 'admin.user@froc.ia', role: 'admin' } as any;
      }
      if (token === 'token_pro_user') {
        return { uid: proUserId, email: 'pro.user@example.com', role: 'user' } as any;
      }
      throw new Error('Invalid token');
    }
  } as any);

  // Inicializar servidor de teste Express
  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const server = app.listen(0);
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Usuário FREE comum => deve receber HTTP 403 em ambas as rotas
    // -------------------------------------------------------------------------
    const resFreeConnect = await fetch(`${baseUrl}/api/social/tiktok/connect?companyId=${freeCompanyId}`, {
      headers: { Authorization: 'Bearer token_free_user' }
    });
    assert.equal(resFreeConnect.status, 403, 'FREE comum deve receber 403 em /social/:provider/connect');
    const dataFreeConnect = await resFreeConnect.json();
    assert.ok(dataFreeConnect.error.includes('plano PRO'), 'Mensagem de upgrade deve ser retornada para FREE comum');

    const resFreeStart = await fetch(`${baseUrl}/api/social/oauth/tiktok/start?companyId=${freeCompanyId}`, {
      headers: { Authorization: 'Bearer token_free_user' }
    });
    assert.equal(resFreeStart.status, 403, 'FREE comum deve receber 403 em /social/oauth/:provider/start');
    const dataFreeStart = await resFreeStart.json();
    assert.ok(dataFreeStart.error.includes('plano PRO'), 'Mensagem de upgrade deve ser retornada para FREE comum');

    // -------------------------------------------------------------------------
    // TESTE 2: Usuário ADMIN FREE => pode iniciar OAuth / conectar (HTTP 200)
    // -------------------------------------------------------------------------
    const resAdminConnect = await fetch(`${baseUrl}/api/social/tiktok/connect?companyId=${adminCompanyId}`, {
      headers: { Authorization: 'Bearer token_admin_free' }
    });
    assert.equal(resAdminConnect.status, 200, 'ADMIN FREE deve ter acesso permitido (200) em /social/:provider/connect');
    const dataAdminConnect = await resAdminConnect.json();
    assert.ok(dataAdminConnect.url, 'ADMIN FREE deve receber URL de autenticação');

    const resAdminStart = await fetch(`${baseUrl}/api/social/oauth/tiktok/start?companyId=${adminCompanyId}`, {
      headers: { Authorization: 'Bearer token_admin_free' }
    });
    assert.equal(resAdminStart.status, 200, 'ADMIN FREE deve ter acesso permitido (200) em /social/oauth/:provider/start');
    const dataAdminStart = await resAdminStart.json();
    assert.ok(dataAdminStart.authUrl || dataAdminStart.url, 'ADMIN FREE deve receber authUrl');

    // -------------------------------------------------------------------------
    // TESTE 3: Usuário PRO comum => pode iniciar OAuth / conectar (HTTP 200)
    // -------------------------------------------------------------------------
    const resProConnect = await fetch(`${baseUrl}/api/social/tiktok/connect?companyId=${proCompanyId}`, {
      headers: { Authorization: 'Bearer token_pro_user' }
    });
    assert.equal(resProConnect.status, 200, 'PRO comum deve ter acesso permitido (200) em /social/:provider/connect');
    const dataProConnect = await resProConnect.json();
    assert.ok(dataProConnect.url, 'PRO comum deve receber URL de autenticação');

    const resProStart = await fetch(`${baseUrl}/api/social/oauth/tiktok/start?companyId=${proCompanyId}`, {
      headers: { Authorization: 'Bearer token_pro_user' }
    });
    assert.equal(resProStart.status, 200, 'PRO comum deve ter acesso permitido (200) em /social/oauth/:provider/start');
    const dataProStart = await resProStart.json();
    assert.ok(dataProStart.authUrl || dataProStart.url, 'PRO comum deve receber authUrl');

    // -------------------------------------------------------------------------
    // TESTE 4: Rota /api/cron/health protegida por CRON_SECRET
    // -------------------------------------------------------------------------
    const resCronNoAuth = await fetch(`${baseUrl}/api/cron/health`);
    assert.equal(resCronNoAuth.status, 401, 'Cron sem Bearer token deve retornar 401');

    const resCronBadAuth = await fetch(`${baseUrl}/api/cron/health`, {
      headers: { Authorization: 'Bearer token_invalido_cron' }
    });
    assert.equal(resCronBadAuth.status, 401, 'Cron com token incorreto deve retornar 401');

    const resCronValid = await fetch(`${baseUrl}/api/cron/health`, {
      headers: { Authorization: `Bearer ${config.cronSecret}` }
    });
    assert.equal(resCronValid.status, 200, 'Cron com CRON_SECRET válido deve retornar 200');
    const cronData = await resCronValid.json();
    assert.equal(cronData.status, 'ok');
    assert.ok(cronData.queueStats);

    // -------------------------------------------------------------------------
    // TESTE 5: Rota /api/content/schedule com validação de plano e rede conectada
    // -------------------------------------------------------------------------
    // Conteúdo de teste
    await db.collection(COLLECTIONS.contentItems).doc('item_route_test').set({
      id: 'item_route_test',
      userId: proUserId,
      companyId: proCompanyId,
      headline: 'Post para Agendar',
      body: 'Texto completo do post',
      status: 'draft'
    });

    await db.collection(COLLECTIONS.contentItems).doc('item_free_test').set({
      id: 'item_free_test',
      userId: freeUserId,
      companyId: freeCompanyId,
      headline: 'Post Free para Agendar',
      body: 'Texto completo do post free',
      status: 'draft'
    });

    // 5.1 Free user tenta agendar -> 403
    const resSchedFree = await fetch(`${baseUrl}/api/content/schedule`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_free_user',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyId: freeCompanyId,
        contentItemId: 'item_free_test',
        platforms: ['Facebook'],
        scheduledFor: new Date(Date.now() + 3600_000).toISOString()
      })
    });
    assert.equal(resSchedFree.status, 403, 'Usuário Free deve receber 403 ao agendar');

    // 5.2 Pro user tenta agendar sem rede conectada -> 400
    const resSchedNoConn = await fetch(`${baseUrl}/api/content/schedule`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_pro_user',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyId: proCompanyId,
        contentItemId: 'item_route_test',
        platforms: ['Facebook'],
        scheduledFor: new Date(Date.now() + 3600_000).toISOString()
      })
    });
    assert.equal(resSchedNoConn.status, 400, 'Agendar sem rede conectada deve retornar 400');
    const noConnData = await resSchedNoConn.json();
    assert.match(noConnData.error, /não está conectada/);

    // Conectar Facebook para Pro User
    await db.collection(COLLECTIONS.socialConnections).doc('conn_pro_fb').set({
      id: 'conn_pro_fb',
      userId: proUserId,
      companyId: proCompanyId,
      provider: 'facebook',
      pageId: '1234567890',
      accessToken: 'encrypted_token',
      status: 'connected'
    });

    // 5.3 Pro user agenda com sucesso -> 201
    const resSchedSuccess = await fetch(`${baseUrl}/api/content/schedule`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_pro_user',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyId: proCompanyId,
        contentItemId: 'item_route_test',
        platforms: ['Facebook'],
        scheduledFor: new Date(Date.now() + 3600_000).toISOString()
      })
    });
    assert.equal(resSchedSuccess.status, 201, 'Agendamento válido deve retornar 201');
    const schedData = await resSchedSuccess.json();
    assert.equal(schedData.scheduled.status, 'scheduled');
    assert.equal(schedData.scheduled.contentItemId, 'item_route_test');

    // 5.4 Rejeição de rede sem suporte a texto direto (Instagram) em auto-publicação
    const resSchedInstagram = await fetch(`${baseUrl}/api/content/schedule`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_pro_user',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyId: proCompanyId,
        contentItemId: 'item_route_test',
        platforms: ['Instagram'],
        scheduledFor: new Date(Date.now() + 3600_000).toISOString()
      })
    });
    assert.equal(resSchedInstagram.status, 400, 'Instagram sem mídia deve ser rejeitado no agendamento textual');
    const instaData = await resSchedInstagram.json();
    assert.match(instaData.error, /mídia visual|Graph API/i);

    // 5.5 Planejamento editorial (isPlanning: true) liberado para usuário FREE/START
    const resSchedPlanning = await fetch(`${baseUrl}/api/content/schedule`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_free_user',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyId: freeCompanyId,
        contentItemId: 'item_route_test',
        platforms: ['Instagram'],
        scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
        isPlanning: true
      })
    });
    // item_route_test pertence a proCompanyId, logo deve validar tenant (400 ou 404)
    assert.ok([400, 404].includes(resSchedPlanning.status), 'Validação de tenant deve ocorrer também no modo de planejamento');

    // Cria item para freeCompanyId
    await db.collection(COLLECTIONS.contentItems).doc('item_free_test').set({
      id: 'item_free_test',
      userId: freeUserId,
      companyId: freeCompanyId,
      headline: 'Post Editorial Free',
      body: 'Planejamento de conteúdo',
      status: 'draft'
    });

    const resSchedPlanningSuccess = await fetch(`${baseUrl}/api/content/schedule`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_free_user',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        companyId: freeCompanyId,
        contentItemId: 'item_free_test',
        platforms: ['Instagram'],
        scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
        isPlanning: true
      })
    });
    assert.equal(resSchedPlanningSuccess.status, 201, 'Planejamento editorial deve ser 201 para plano FREE');
    const planningData = await resSchedPlanningSuccess.json();
    assert.equal(planningData.scheduled.status, 'planned');
    assert.equal(planningData.scheduled.isPlanning, true);

    // 5.6 Retry Safety: Rejeita requires_review
    await db.collection(COLLECTIONS.scheduledPosts).doc('sched_review_test').set({
      id: 'sched_review_test',
      userId: proUserId,
      companyId: proCompanyId,
      contentItemId: 'item_route_test',
      platforms: ['Facebook'],
      scheduledFor: new Date(Date.now() - 3600_000).toISOString(),
      status: 'requires_review'
    });
    const resRetryReview = await fetch(`${baseUrl}/api/content/scheduled/sched_review_test/retry`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token_pro_user' }
    });
    assert.equal(resRetryReview.status, 409, 'Retry em status requires_review deve retornar 409');

    // 5.7 Retry Safety: Preserva publicationResults com externalId
    await db.collection(COLLECTIONS.scheduledPosts).doc('sched_partial_failed').set({
      id: 'sched_partial_failed',
      userId: proUserId,
      companyId: proCompanyId,
      contentItemId: 'item_route_test',
      platforms: ['Facebook', 'LinkedIn'],
      scheduledFor: new Date(Date.now() - 3600_000).toISOString(),
      status: 'failed',
      publicationResults: [
        { platform: 'Facebook', success: true, externalId: 'fb_confirmed_999' },
        { platform: 'LinkedIn', success: false, error: 'Token expired' }
      ]
    });
    const resRetryPartial = await fetch(`${baseUrl}/api/content/scheduled/sched_partial_failed/retry`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token_pro_user' }
    });
    assert.equal(resRetryPartial.status, 200, 'Retry de post com falha deve ser 200');
    const partialSnap = await db.collection(COLLECTIONS.scheduledPosts).doc('sched_partial_failed').get();
    const partialData = partialSnap.data() as any;
    assert.equal(partialData.status, 'scheduled');
    assert.equal(partialData.publicationResults.length, 1);
    assert.equal(partialData.publicationResults[0].externalId, 'fb_confirmed_999');

    // 5.8 Cancel Safety: Rejeita cancelamento de requires_review
    const resCancelReview = await fetch(`${baseUrl}/api/content/scheduled/sched_review_test/cancel`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token_pro_user' }
    });
    assert.equal(resCancelReview.status, 409, 'Cancelamento em status requires_review deve retornar 409');
  } finally {
    server.close();
    firebaseAdminProvider.setAdminAuthForTesting(undefined);
  }
});

