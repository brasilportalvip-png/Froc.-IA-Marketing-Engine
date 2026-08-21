import test from 'node:test';
import assert from 'node:assert/strict';
import {
  triggerUserAutopilot,
  processScheduledPosts,
  recoverStalePublishingPosts,
  getSchedulerHealth,
  isAutopilotDue,
  getLocalDateAndHour,
  type AutopilotScheduleConfig
} from '../server/production/scheduler.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';
import { addCredits } from '../server/production/credits.js';
import { encrypt } from '../server/production/social.js';
import { config } from '../server/config/index.js';

test('Scheduler: Isolamento de trigger do Autopilot para a empresa do próprio usuário', async () => {
  resetMemoryDb();
  const db = firestore();

  const userA = 'usr_dono_empresa_a';
  const userB = 'usr_invasor_b';

  // Cadastra empresa de User A
  const companyAId = 'comp_padaria_estrela';
  await db.collection(COLLECTIONS.companies).doc(companyAId).set({
    id: companyAId,
    userId: userA,
    name: 'Padaria Estrela',
    category: 'Alimentação & Panificação',
    description: 'Padaria artesanal com pães de fermentação natural.',
    products: ['Pão francês', 'Croissant', 'Café especial']
  });

  // Saldo de User A
  await addCredits({
    userId: userA,
    amount: 100,
    type: 'purchase',
    source: 'Créditos User A'
  });

  // Tentativa de User B acionar o Autopilot da empresa de User A -> deve ser rejeitada imediatamente
  await assert.rejects(
    async () => {
      await triggerUserAutopilot(userB, companyAId);
    },
    (err: any) => {
      return err.message.includes('permissão') || err.message.includes('não encontrada');
    }
  );
});

test('Scheduler: Revalidação estrita de ownership antes da publicação de scheduledPosts', async () => {
  resetMemoryDb();
  const db = firestore();

  const userA = 'usr_owner_alpha';
  const userB = 'usr_attacker_beta';

  // Registra perfis
  await db.collection(COLLECTIONS.users).doc(userA).set({ id: userA, email: 'alpha@empresa.com', role: 'admin' });
  await db.collection(COLLECTIONS.users).doc(userB).set({ id: userB, email: 'beta@empresa.com', role: 'admin' });
  await db.collection(COLLECTIONS.wallets).doc(userA).set({ userId: userA, planId: 'plan_pro', balance: 50 });
  await db.collection(COLLECTIONS.wallets).doc(userB).set({ userId: userB, planId: 'plan_pro', balance: 50 });

  // Empresa de User A
  const compA = 'comp_alpha_1';
  await db.collection(COLLECTIONS.companies).doc(compA).set({ id: compA, userId: userA, name: 'Empresa Alpha' });

  // Empresa de User B
  const compB = 'comp_beta_2';
  await db.collection(COLLECTIONS.companies).doc(compB).set({ id: compB, userId: userB, name: 'Empresa Beta' });

  // Conteúdo legítimo de User A
  const contentA = 'cnt_legit_a';
  await db.collection(COLLECTIONS.contentItems).doc(contentA).set({
    id: contentA,
    userId: userA,
    companyId: compA,
    headline: 'Oferta Especial Alpha',
    body: 'Texto da promoção',
    status: 'draft'
  });

  // CASO 1: Post de User B tentando apontar para a empresa de User A (Cross-tenant Company)
  const maliciousPost1 = 'sched_malicious_1';
  await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost1).set({
    id: maliciousPost1,
    userId: userB,
    companyId: compA, // Empresa de User A!
    contentItemId: contentA,
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() - 10000).toISOString(),
    status: 'scheduled'
  });

  await processScheduledPosts();

  const checkedPost1 = (await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost1).get()).data();
  assert.equal(checkedPost1?.status, 'failed');
  assert.ok(checkedPost1?.errorMessage?.includes('isolamento multi-tenant'));

  // CASO 2: Post de User A apontando para conteúdo de User B (Cross-tenant Content)
  const contentB = 'cnt_legit_b';
  await db.collection(COLLECTIONS.contentItems).doc(contentB).set({
    id: contentB,
    userId: userB,
    companyId: compB,
    headline: 'Conteúdo do User B',
    status: 'draft'
  });

  const maliciousPost2 = 'sched_malicious_2';
  await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost2).set({
    id: maliciousPost2,
    userId: userA,
    companyId: compA,
    contentItemId: contentB, // Conteúdo de User B!
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() - 10000).toISOString(),
    status: 'scheduled'
  });

  await processScheduledPosts();

  const checkedPost2 = (await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost2).get()).data();
  assert.equal(checkedPost2?.status, 'failed');
  assert.ok(checkedPost2?.errorMessage?.includes('isolamento multi-tenant'));
});

test('Scheduler: Processamento de scheduledPosts vencidos versus futuros', async () => {
  resetMemoryDb();
  const db = firestore();

  const user = 'usr_scheduler_timer_1';
  const company = 'comp_timer_1';

  await db.collection(COLLECTIONS.users).doc(user).set({ id: user, email: 'timer@empresa.com' });
  await db.collection(COLLECTIONS.wallets).doc(user).set({ userId: user, planId: 'pro', balance: 50 });
  await db.collection(COLLECTIONS.companies).doc(company).set({ id: company, userId: user, name: 'Timer Empresa' });

  const contentDue = 'cnt_due_1';
  await db.collection(COLLECTIONS.contentItems).doc(contentDue).set({
    id: contentDue,
    userId: user,
    companyId: company,
    headline: 'Post Vencido',
    body: 'Texto pronto',
    status: 'draft'
  });

  const contentFuture = 'cnt_future_1';
  await db.collection(COLLECTIONS.contentItems).doc(contentFuture).set({
    id: contentFuture,
    userId: user,
    companyId: company,
    headline: 'Post Futuro',
    body: 'Texto futuro',
    status: 'draft'
  });

  // Post 1: Vencido (agendado para 5 minutos no passado) -> deve ser processado
  const postDueId = 'sched_post_past_due';
  await db.collection(COLLECTIONS.scheduledPosts).doc(postDueId).set({
    id: postDueId,
    userId: user,
    companyId: company,
    contentItemId: contentDue,
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    status: 'scheduled'
  });

  // Post 2: Futuro (agendado para 2 horas no futuro) -> NÃO deve ser processado
  const postFutureId = 'sched_post_in_future';
  await db.collection(COLLECTIONS.scheduledPosts).doc(postFutureId).set({
    id: postFutureId,
    userId: user,
    companyId: company,
    contentItemId: contentFuture,
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    status: 'scheduled'
  });

  const processedCount = await processScheduledPosts();
  assert.equal(processedCount, 1);

  // Post vencido foi processado (ou falhou por falta de credenciais sociais, mas seu status saiu de 'scheduled')
  const postDueSnap = await db.collection(COLLECTIONS.scheduledPosts).doc(postDueId).get();
  assert.notEqual(postDueSnap.data()?.status, 'scheduled');

  // Post futuro continua intacto com status 'scheduled'
  const postFutureSnap = await db.collection(COLLECTIONS.scheduledPosts).doc(postFutureId).get();
  assert.equal(postFutureSnap.data()?.status, 'scheduled');
});

test('Scheduler: Autopilot isAutopilotDue validação determinística de janelas, minutos e timezone America/Sao_Paulo', () => {
  const config: AutopilotScheduleConfig = {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    frequency: 'daily',
    preferredDays: [1, 2, 3, 4, 5], // Seg a Sex
    preferredHours: [10, 15] // 10h e 15h
  };

  // 1. Segunda-feira às 10:07 em São Paulo (UTC 13:07) -> DENTRO DA JANELA DAS 10h (DEVE EXECUTAR)
  const monday1007SP = new Date('2026-08-17T13:07:00.000Z');
  assert.equal(isAutopilotDue(config, monday1007SP), true);

  // 2. Segunda-feira às 10:45 em São Paulo (UTC 13:45) -> DENTRO DA JANELA DAS 10h (DEVE EXECUTAR)
  const monday1045SP = new Date('2026-08-17T13:45:00.000Z');
  assert.equal(isAutopilotDue(config, monday1045SP), true);

  // 3. Segunda-feira às 11:00 em São Paulo (UTC 14:00) -> FORA DA JANELA (NÃO DEVE EXECUTAR)
  const monday1100SP = new Date('2026-08-17T14:00:00.000Z');
  assert.equal(isAutopilotDue(config, monday1100SP), false);

  // 4. Mesma janela chamada duas vezes: 1ª chamada é autorizada, após registrar lastRunSlot a 2ª chamada é bloqueada
  const { hour, dateStr } = getLocalDateAndHour(monday1007SP, 'America/Sao_Paulo');
  assert.equal(hour, 10);
  assert.equal(dateStr, '2026-08-17');

  const afterFirstRunConfig: AutopilotScheduleConfig = {
    ...config,
    lastRunSlot: `${dateStr}_h${hour}`,
    lastRunAt: monday1007SP.toISOString()
  };

  // 2ª execução às 10:45 no mesmo dia -> BLOQUEADA por lastRunSlot
  assert.equal(isAutopilotDue(afterFirstRunConfig, monday1045SP), false);

  // 5. Domingo às 10:07 -> BLOQUEADO por preferredDays
  const sunday1007SP = new Date('2026-08-16T13:07:00.000Z');
  assert.equal(isAutopilotDue(config, sunday1007SP), false);

  // 6. Timezone America/Sao_Paulo vs UTC
  const spLocal = getLocalDateAndHour(monday1007SP, 'America/Sao_Paulo');
  assert.equal(spLocal.hour, 10);
  assert.equal(spLocal.dayOfWeek, 1);
  assert.equal(spLocal.dateStr, '2026-08-17');
});

test('Scheduler: recoverStalePublishingPosts recupera posts travados em publishing por mais de 15 minutos e marca requires_review se não houver externalId', async () => {
  resetMemoryDb();
  const db = firestore();

  const user = 'usr_stale_test';
  const company = 'comp_stale_test';

  // 1. Post travado há 20 minutos em status 'publishing' sem confirmação externa
  const stalePostId = 'sched_stale_20min';
  await db.collection(COLLECTIONS.scheduledPosts).doc(stalePostId).set({
    id: stalePostId,
    userId: user,
    companyId: company,
    status: 'publishing',
    processingAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    platforms: ['Facebook']
  });

  // 2. Post em 'publishing' recente (há 2 minutos) -> NÃO deve ser afetado
  const freshPostId = 'sched_fresh_2min';
  await db.collection(COLLECTIONS.scheduledPosts).doc(freshPostId).set({
    id: freshPostId,
    userId: user,
    companyId: company,
    status: 'publishing',
    processingAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    platforms: ['Facebook']
  });

  // 3. Post travado há 20 minutos mas com confirmação externa para todas as plataformas -> deve marcar published
  const staleConfirmedId = 'sched_stale_confirmed';
  await db.collection(COLLECTIONS.scheduledPosts).doc(staleConfirmedId).set({
    id: staleConfirmedId,
    userId: user,
    companyId: company,
    status: 'publishing',
    processingAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    platforms: ['Facebook'],
    publicationResults: [
      { platform: 'Facebook', success: true, externalId: 'fb_recovered_123' }
    ]
  });

  const recovered = await recoverStalePublishingPosts();
  assert.equal(recovered, 2);

  const staleSnap = await db.collection(COLLECTIONS.scheduledPosts).doc(stalePostId).get();
  assert.equal(staleSnap.data()?.status, 'requires_review');
  assert.match(staleSnap.data()?.errorMessage, /Verificação manual necessária/i);

  const confirmedSnap = await db.collection(COLLECTIONS.scheduledPosts).doc(staleConfirmedId).get();
  assert.equal(confirmedSnap.data()?.status, 'published');
  assert.equal(confirmedSnap.data()?.lastExternalId, 'fb_recovered_123');

  const freshSnap = await db.collection(COLLECTIONS.scheduledPosts).doc(freshPostId).get();
  assert.equal(freshSnap.data()?.status, 'publishing');
});

test('Scheduler: getSchedulerHealth retorna métricas e status do lock', async () => {
  resetMemoryDb();
  const db = firestore();

  await db.collection(COLLECTIONS.scheduledPosts).doc('p1').set({ status: 'scheduled', scheduledFor: new Date(Date.now() - 10000).toISOString() });
  await db.collection(COLLECTIONS.scheduledPosts).doc('p2').set({ status: 'publishing' });
  await db.collection(COLLECTIONS.scheduledPosts).doc('p3').set({ status: 'failed', errorMessage: 'Erro teste' });
  await db.collection(COLLECTIONS.scheduledPosts).doc('p4').set({ status: 'published' });

  const health = await getSchedulerHealth();
  assert.equal(health.status, 'ok');
  assert.equal(health.queueStats.scheduledPending, 1);
  assert.equal(health.queueStats.publishingCount, 1);
});

test('Scheduler: Publicação direta Facebook Page com sucesso grava externalId e status published', async () => {
  resetMemoryDb();
  const db = firestore();

  const userId = 'usr_fb_publisher';
  const companyId = 'comp_fb_publisher';
  const contentId = 'content_fb_123';
  const schedId = 'sched_fb_123';

  // Configura Plano PRO para ter direito a socialConnections
  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    userId,
    planId: 'pro',
    creditsBalance: 50
  });

  await db.collection(COLLECTIONS.users).doc(userId).set({ id: userId, email: 'fb@empresa.com', role: 'admin' });
  await db.collection(COLLECTIONS.companies).doc(companyId).set({ id: companyId, userId, name: 'Empresa Teste Facebook' });

  // Cria item de conteúdo com texto
  await db.collection(COLLECTIONS.contentItems).doc(contentId).set({
    id: contentId,
    userId,
    companyId,
    headline: 'Novidade Imperdível',
    body: 'Venha conferir nossos lançamentos especiais desta semana!',
    cta: 'Saiba mais no link da bio.',
    status: 'scheduled'
  });

  // Conexão social Facebook ativa com Page Access Token criptografado
  const rawPageToken = 'EAABmockPageAccessToken123';
  await db.collection(COLLECTIONS.socialConnections).doc('conn_fb_test').set({
    id: 'conn_fb_test',
    userId,
    companyId,
    provider: 'facebook',
    pageId: '10987654321',
    accountId: '10987654321',
    accountName: 'Página Oficial Facebook',
    encryptedAccessToken: encrypt(rawPageToken),
    status: 'connected',
    updatedAt: new Date().toISOString()
  });

  // Agendamento vencido para Facebook
  await db.collection(COLLECTIONS.scheduledPosts).doc(schedId).set({
    id: schedId,
    userId,
    companyId,
    contentItemId: contentId,
    platforms: ['Facebook'],
    scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    status: 'scheduled'
  });

  // Mock global fetch para simular API do Meta Graph POST /{pageId}/feed
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  let interceptedBody = '';

  globalThis.fetch = async (input: any, init?: any) => {
    interceptedUrl = String(input);
    if (interceptedUrl.includes('10987654321/feed')) {
      interceptedBody = String(init?.body || '');
      return new Response(JSON.stringify({ id: '10987654321_9988776655' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    const processed = await processScheduledPosts();
    assert.equal(processed, 1);

    // Verifica chamada Meta
    assert.ok(interceptedUrl.includes(`graph.facebook.com/${config.social.meta.graphVersion}/10987654321/feed`));
    const parsedParams = new URLSearchParams(interceptedBody);
    const messageParam = parsedParams.get('message') || '';
    assert.ok(messageParam.includes('Novidade Imperdível'));
    assert.ok(messageParam.includes('lançamentos especiais'));

    // Verifica status no banco
    const snap = await db.collection(COLLECTIONS.scheduledPosts).doc(schedId).get();
    const data = snap.data() as any;
    assert.equal(data.status, 'published');
    assert.equal(data.lastExternalId, '10987654321_9988776655');
    assert.equal(data.publicationResults?.length, 1);
    assert.equal(data.publicationResults[0].platform, 'Facebook');
    assert.equal(data.publicationResults[0].success, true);
    assert.equal(data.publicationResults[0].externalId, '10987654321_9988776655');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Scheduler: Idempotência de publicação caso externalId já exista', async () => {
  resetMemoryDb();
  const db = firestore();

  const userId = 'usr_idemp';
  const companyId = 'comp_idemp';
  const contentId = 'content_idemp';
  const schedId = 'sched_idemp';

  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    userId,
    planId: 'pro',
    creditsBalance: 50
  });
  await db.collection(COLLECTIONS.users).doc(userId).set({ id: userId, email: 'idemp@empresa.com', role: 'admin' });
  await db.collection(COLLECTIONS.companies).doc(companyId).set({ id: companyId, userId, name: 'Empresa Idempotente' });

  await db.collection(COLLECTIONS.contentItems).doc(contentId).set({
    id: contentId,
    userId,
    companyId,
    headline: 'Post já publicado no Facebook',
    body: 'Conteúdo repetido',
    status: 'scheduled'
  });

  await db.collection(COLLECTIONS.socialConnections).doc('conn_idemp').set({
    id: 'conn_idemp',
    userId,
    companyId,
    provider: 'facebook',
    pageId: '10987654321',
    accessToken: encrypt('tok_idemp'),
    status: 'connected'
  });

  // Post já possui resultado de sucesso para Facebook com externalId
  await db.collection(COLLECTIONS.scheduledPosts).doc(schedId).set({
    id: schedId,
    userId,
    companyId,
    contentItemId: contentId,
    platforms: ['Facebook'],
    scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    status: 'scheduled',
    publicationResults: [
      { platform: 'facebook', success: true, externalId: 'fb_existing_123', publishedAt: new Date().toISOString() }
    ]
  });

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ id: 'fb_should_not_be_called' }), { status: 200 });
  };

  try {
    const processed = await processScheduledPosts();
    assert.equal(processed, 1);
    assert.equal(fetchCalled, false, 'Fetch não deve ser chamado para plataforma que já possui externalId');

    const snap = await db.collection(COLLECTIONS.scheduledPosts).doc(schedId).get();
    assert.equal(snap.data()?.status, 'published');
    assert.equal(snap.data()?.lastExternalId, 'fb_existing_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


