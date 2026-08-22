import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlanEntitlements } from '../server/production/plans.js';
import { recalculateUserPlan, applyPaymentCycle } from '../server/production/payments.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';
import { getWallet } from '../server/production/credits.js';
import { triggerUserAutopilot, processAutopilot } from '../server/production/scheduler.js';

test('Plans: Entitlements por nível de plano são rigorosos e determinísticos', () => {
  // Plan Free
  const free = getPlanEntitlements('plan_free');
  assert.equal(free.planId, 'plan_free');
  assert.equal(free.maxCompanies, 1);
  assert.equal(free.autopilotManual, false);
  assert.equal(free.autopilotAutomatic, false);

  // Plan Start
  const start = getPlanEntitlements('plan_start');
  assert.equal(start.planId, 'plan_start');
  assert.equal(start.maxCompanies, 2);
  assert.equal(start.autopilotManual, false);
  assert.equal(start.autopilotAutomatic, false);

  // Plan Pro
  const pro = getPlanEntitlements('plan_pro');
  assert.equal(pro.planId, 'plan_pro');
  assert.equal(pro.maxCompanies, 5);
  assert.equal(pro.autopilotManual, true);
  assert.equal(pro.autopilotAutomatic, false);

  // Plan Business
  const business = getPlanEntitlements('plan_business');
  assert.equal(business.planId, 'plan_business');
  assert.equal(business.maxCompanies, 15);
  assert.equal(business.autopilotManual, true);
  assert.equal(business.autopilotAutomatic, true);

  // Plan Agency
  const agency = getPlanEntitlements('plan_agency');
  assert.equal(agency.planId, 'plan_agency');
  assert.equal(agency.maxCompanies, Number.POSITIVE_INFINITY);
  assert.equal(agency.autopilotManual, true);
  assert.equal(agency.autopilotAutomatic, true);

  // Default / Unknown fallback
  const unknown = getPlanEntitlements('unknown_plan');
  assert.equal(unknown.planId, 'plan_free');
  assert.equal(unknown.maxCompanies, 1);
});

test('Plans: RecalculateUserPlan preserva plano ativo e cancel_at_period_end até o término do ciclo', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_plan_test_1';

  // 1. Usuário sem assinatura => plano free
  const res1 = await recalculateUserPlan(userId);
  assert.equal(res1.planId, 'plan_free');
  assert.equal(res1.planStatus, 'free');

  // 2. Cria pedido Pro ativo em COLLECTIONS.payments
  const orderRef = db.collection(COLLECTIONS.payments).doc('order_pro_1');
  const now = new Date();
  const future = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
  await orderRef.set({
    id: 'order_pro_1',
    userId,
    planId: 'plan_pro',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: future,
    createdAt: now.toISOString(),
    lastCreditedAt: now.toISOString()
  });

  const res2 = await recalculateUserPlan(userId);
  assert.equal(res2.planId, 'plan_pro');
  assert.equal(res2.planStatus, 'active');

  // 3. Usuário cancela assinatura com cancel_at_period_end
  await orderRef.update({
    status: 'cancel_at_period_end',
    subscriptionStatus: 'cancelled'
  });

  // O plano deve permanecer plan_pro pois o período ainda não expirou
  const res3 = await recalculateUserPlan(userId);
  assert.equal(res3.planId, 'plan_pro');
  assert.equal(res3.planStatus, 'cancel_at_period_end');

  // 4. Período expira no passado
  const past = new Date(now.getTime() - 10000).toISOString();
  await orderRef.update({
    currentPeriodEnd: past
  });

  // Agora rebaixa para plan_free
  const res4 = await recalculateUserPlan(userId);
  assert.equal(res4.planId, 'plan_free');
  assert.equal(res4.planStatus, 'free');
});

test('Plans: Autopilot bloqueia usuários do plano free e permite plano pro', async () => {
  resetMemoryDb();
  const db = firestore();
  const userFree = 'usr_free_autopilot';
  const userPro = 'usr_pro_autopilot';

  // Empresa user free
  const compFree = 'comp_free_1';
  await db.collection(COLLECTIONS.companies).doc(compFree).set({
    id: compFree,
    userId: userFree,
    name: 'Loja Free'
  });
  // Cria carteira free com créditos
  const wRef = db.collection(COLLECTIONS.wallets).doc(userFree);
  await wRef.set({
    id: userFree,
    userId: userFree,
    balance: 50,
    bonusBalance: 0,
    reservedCredits: 0,
    planId: 'plan_free',
    updatedAt: new Date().toISOString()
  });

  // Tentativa de rodar Autopilot no plano free deve falhar por falta de entitlement
  await assert.rejects(
    async () => {
      await triggerUserAutopilot(userFree, compFree);
    },
    (err: any) => {
      return err.message.includes('plano PRO');
    }
  );

  // Agora usuário Pro
  const compPro = 'comp_pro_1';
  await db.collection(COLLECTIONS.companies).doc(compPro).set({
    id: compPro,
    userId: userPro,
    name: 'Loja Pro',
    category: 'Varejo',
    description: 'Moda feminina'
  });
  await db.collection(COLLECTIONS.payments).doc('order_pro_autopilot').set({
    id: 'order_pro_autopilot',
    userId: userPro,
    planId: 'plan_pro',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    lastCreditedAt: new Date().toISOString()
  });
  await db.collection(COLLECTIONS.wallets).doc(userPro).set({
    id: userPro,
    userId: userPro,
    balance: 50,
    bonusBalance: 0,
    reservedCredits: 0,
    planId: 'plan_pro',
    planStatus: 'active',
    updatedAt: new Date().toISOString()
  });

  // Config do Autopilot para Pro
  await db.collection(COLLECTIONS.autopilotConfigs).doc(`${userPro}_${compPro}`).set({
    id: `${userPro}_${compPro}`,
    userId: userPro,
    companyId: compPro,
    enabled: true,
    mode: 'manual_approval',
    frequency: 'daily',
    targetPlatforms: ['Instagram'],
    primaryGoal: 'Vender roupas',
    maxMonthlyCredits: 100,
    usedCreditsThisMonth: 0
  });

  const res = await triggerUserAutopilot(userPro, compPro);
  assert.equal(res.success, true);
  assert.equal(res.creditsUsed, 5);

  const walletPro = await getWallet(userPro);
  assert.equal(walletPro.balance, 45); // 50 - 5 = 45
});

test('Plans: getWallet persiste downgrade para plan_free quando a assinatura expira', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_downgrade_sync_test';

  // 1. Cria carteira inicial Pro
  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    id: userId,
    userId,
    balance: 100,
    bonusBalance: 0,
    totalUsed: 0,
    totalReceived: 100,
    reservedCredits: 0,
    planId: 'plan_pro',
    planStatus: 'active',
    updatedAt: new Date().toISOString()
  });

  // 2. Pedido expirado no passado
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db.collection(COLLECTIONS.payments).doc('order_expired_1').set({
    id: 'order_expired_1',
    userId,
    planId: 'plan_pro',
    status: 'cancel_at_period_end',
    subscriptionStatus: 'cancelled',
    currentPeriodEnd: pastDate,
    createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    lastCreditedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
  });

  // Ao chamar getWallet, deve sincronizar e persistir plan_free
  const wallet = await getWallet(userId);
  assert.equal(wallet.planId, 'plan_free');
  assert.equal(wallet.planStatus, 'free');

  // Verifica persistência no Firestore
  const savedDoc = await db.collection(COLLECTIONS.wallets).doc(userId).get();
  assert.equal(savedDoc.data()?.planId, 'plan_free');
  assert.equal(savedDoc.data()?.planStatus, 'free');
});

test('Plans: cancelSubscription é estritamente fail-closed e propaga erros do Mercado Pago sem corromper estado local', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_cancel_test_failclosed';
  const orderId = 'order_sub_cancel_1';
  const subId = 'mp_sub_998877';

  // Salva fetch original
  const originalFetch = globalThis.fetch;

  try {
    // 1. Cria assinatura ativa com ciclo liquidado
    await db.collection(COLLECTIONS.payments).doc(orderId).set({
      id: orderId,
      userId,
      planId: 'plan_business',
      billingMode: 'subscription',
      providerSubscriptionId: subId,
      status: 'active',
      subscriptionStatus: 'authorized',
      lastPaymentStatus: 'approved',
      lastCreditedAt: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    });

    await db.collection(COLLECTIONS.wallets).doc(userId).set({
      id: userId,
      userId,
      balance: 200,
      planId: 'plan_business',
      planStatus: 'active',
      updatedAt: new Date().toISOString()
    });

    const { cancelSubscription } = await import('../server/production/payments.js');

    // Simula erro de comunicação / 500 do Mercado Pago
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({ message: 'Mercado Pago Internal Gateway Error' })
      } as any;
    };

    // Deve lançar erro e NÃO alterar estado local para cancelado
    await assert.rejects(
      async () => {
        await cancelSubscription(userId, orderId);
      },
      (err: any) => {
        return err.statusCode === 502 || err.message.includes('Mercado Pago');
      }
    );

    // O status no banco permanece active
    const orderAfterFailure = await db.collection(COLLECTIONS.payments).doc(orderId).get();
    assert.equal(orderAfterFailure.data()?.status, 'active');

    // Agora simula resposta bem-sucedida do Mercado Pago
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'cancelled' })
      } as any;
    };

    const res = await cancelSubscription(userId, orderId);
    assert.equal(res.status, 'cancel_at_period_end');

    // Verifica que agora foi marcado como cancel_at_period_end no banco
    const orderAfterSuccess = await db.collection(COLLECTIONS.payments).doc(orderId).get();
    assert.equal(orderAfterSuccess.data()?.status, 'cancel_at_period_end');
    assert.equal(orderAfterSuccess.data()?.subscriptionStatus, 'cancelled');

    const walletAfterSuccess = await db.collection(COLLECTIONS.wallets).doc(userId).get();
    assert.equal(walletAfterSuccess.data()?.planStatus, 'cancel_at_period_end');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Plans: Múltiplos pedidos resolvem para o pedido ativo mais recente e de maior precedência', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_multi_orders_test';

  const now = Date.now();
  // Pedido 1: Antigo expirado Start
  await db.collection(COLLECTIONS.payments).doc('order_old_start').set({
    id: 'order_old_start',
    userId,
    planId: 'plan_start',
    status: 'cancel_at_period_end',
    subscriptionStatus: 'cancelled',
    currentPeriodEnd: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(),
    lastCreditedAt: new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()
  });

  // Pedido 2: Pedido falhado / estornado
  await db.collection(COLLECTIONS.payments).doc('order_failed_business').set({
    id: 'order_failed_business',
    userId,
    planId: 'plan_business',
    status: 'refunded',
    lastPaymentStatus: 'refunded',
    createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
  });

  // Pedido 3: Pedido ativo Pro
  await db.collection(COLLECTIONS.payments).doc('order_active_pro').set({
    id: 'order_active_pro',
    userId,
    planId: 'plan_pro',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: new Date(now + 25 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    lastCreditedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()
  });

  const result = await recalculateUserPlan(userId);
  assert.equal(result.planId, 'plan_pro');
  assert.equal(result.planStatus, 'active');
});

test('Plans: Entitlements de Campanhas e Social Connections seguem a matriz oficial de planos', () => {
  // Free: sem campanhas, sem redes
  const free = getPlanEntitlements('plan_free');
  assert.equal(free.campaigns, false);
  assert.equal(free.socialConnections, false);

  // Start: sem campanhas, sem redes
  const start = getPlanEntitlements('plan_start');
  assert.equal(start.campaigns, false);
  assert.equal(start.socialConnections, false);

  // Pro: sem campanhas, com redes
  const pro = getPlanEntitlements('plan_pro');
  assert.equal(pro.campaigns, false);
  assert.equal(pro.socialConnections, true);

  // Business: com campanhas, com redes
  const business = getPlanEntitlements('plan_business');
  assert.equal(business.campaigns, true);
  assert.equal(business.socialConnections, true);

  // Agency: com campanhas, com redes
  const agency = getPlanEntitlements('plan_agency');
  assert.equal(agency.campaigns, true);
  assert.equal(agency.socialConnections, true);
});

test('Scheduler: Autopilot com plano expirado é bloqueado, não debita créditos e reconcilia para FREE', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_expired_autopilot_runner';
  const companyId = 'comp_expired_1';

  // 1. Empresa do usuário
  await db.collection(COLLECTIONS.companies).doc(companyId).set({
    id: companyId,
    userId,
    name: 'Empresa Teste Expirada',
    businessType: 'online'
  });

  // 2. Assinatura Business com currentPeriodEnd no passado
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  await db.collection(COLLECTIONS.payments).doc('order_expired_biz').set({
    id: 'order_expired_biz',
    userId,
    planId: 'plan_business',
    status: 'active',
    lastPaymentStatus: 'approved',
    currentPeriodEnd: past,
    createdAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
    lastCreditedAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString()
  });

  // 3. Carteira desatualizada ainda marcando plan_business
  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    id: userId,
    userId,
    balance: 100,
    bonusBalance: 0,
    totalUsed: 0,
    totalReceived: 100,
    reservedCredits: 0,
    planId: 'plan_business',
    planStatus: 'active',
    updatedAt: new Date().toISOString()
  });

  // 4. Configuração de Autopilot ativa e devida
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const hour = now.getUTCHours();
  await db.collection(COLLECTIONS.autopilotConfigs).doc(`${userId}_${companyId}`).set({
    id: `${userId}_${companyId}`,
    userId,
    companyId,
    enabled: true,
    mode: 'automatic',
    frequency: 'daily',
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    preferredHours: [hour],
    timezone: 'UTC',
    maxMonthlyCredits: 500,
    usedCreditsThisMonth: 0,
    lastRunSlot: 'old_slot',
    targetPlatforms: ['Instagram']
  });

  // 5. Executa processAutopilot
  const processed = await processAutopilot();
  assert.equal(processed, 0);

  // 6. Verifica que nenhum crédito foi debitado
  const walletAfter = await getWallet(userId);
  assert.equal(walletAfter.balance, 100);
  assert.equal(walletAfter.planId, 'plan_free');
  assert.equal(walletAfter.planStatus, 'free');

  // 7. Verifica que nenhum post agendado ou conteúdo foi gerado
  const scheduledSnap = await db.collection(COLLECTIONS.scheduledPosts).where('userId', '==', userId).get();
  assert.equal(scheduledSnap.empty, true);
  const contentSnap = await db.collection(COLLECTIONS.contentItems).where('userId', '==', userId).get();
  assert.equal(contentSnap.empty, true);
});

test('Plans: Casos rigorosos de expiração temporal de active, approved, cancel_at_period_end e múltiplos pedidos', async () => {
  resetMemoryDb();
  const db = firestore();
  const now = Date.now();
  const future = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  // Caso 1: ACTIVE FUTURE => Ativo
  const u1 = 'usr_active_future';
  await db.collection(COLLECTIONS.payments).doc('ord_u1').set({
    id: 'ord_u1', userId: u1, planId: 'plan_pro', status: 'active', currentPeriodEnd: future, createdAt: new Date().toISOString()
  });
  const res1 = await recalculateUserPlan(u1);
  assert.equal(res1.planId, 'plan_pro');
  assert.equal(res1.planStatus, 'active');

  // Caso 2: ACTIVE EXPIRED => FREE
  const u2 = 'usr_active_expired';
  await db.collection(COLLECTIONS.payments).doc('ord_u2').set({
    id: 'ord_u2', userId: u2, planId: 'plan_pro', status: 'active', currentPeriodEnd: past, createdAt: new Date(now - 35 * 86400000).toISOString()
  });
  const res2 = await recalculateUserPlan(u2);
  assert.equal(res2.planId, 'plan_free');
  assert.equal(res2.planStatus, 'free');

  // Caso 3: APPROVED EXPIRED => FREE
  const u3 = 'usr_approved_expired';
  await db.collection(COLLECTIONS.payments).doc('ord_u3').set({
    id: 'ord_u3', userId: u3, planId: 'plan_business', status: 'approved', lastPaymentStatus: 'approved', currentPeriodEnd: past, createdAt: new Date(now - 35 * 86400000).toISOString()
  });
  const res3 = await recalculateUserPlan(u3);
  assert.equal(res3.planId, 'plan_free');
  assert.equal(res3.planStatus, 'free');

  // Caso 4: CANCEL_AT_PERIOD_END FUTURE => Mantém plano (com pagamento aprovado)
  const u4 = 'usr_cancel_future';
  await db.collection(COLLECTIONS.payments).doc('ord_u4').set({
    id: 'ord_u4', userId: u4, planId: 'plan_business', status: 'cancel_at_period_end', subscriptionStatus: 'cancelled', lastPaymentStatus: 'approved', lastCreditedAt: new Date().toISOString(), currentPeriodEnd: future, createdAt: new Date().toISOString()
  });
  const res4 = await recalculateUserPlan(u4);
  assert.equal(res4.planId, 'plan_business');
  assert.equal(res4.planStatus, 'cancel_at_period_end');

  // Caso 5: CANCEL_AT_PERIOD_END EXPIRED => FREE
  const u5 = 'usr_cancel_expired';
  await db.collection(COLLECTIONS.payments).doc('ord_u5').set({
    id: 'ord_u5', userId: u5, planId: 'plan_agency', status: 'cancel_at_period_end', subscriptionStatus: 'cancelled', lastPaymentStatus: 'approved', lastCreditedAt: new Date(now - 40 * 86400000).toISOString(), currentPeriodEnd: past, createdAt: new Date(now - 40 * 86400000).toISOString()
  });
  const res5 = await recalculateUserPlan(u5);
  assert.equal(res5.planId, 'plan_free');
  assert.equal(res5.planStatus, 'free');

  // Caso 6: MULTIPLE ORDERS (Expired Business + Valid Pro => PRO)
  const u6 = 'usr_multi_biz_pro';
  await db.collection(COLLECTIONS.payments).doc('ord_u6_biz').set({
    id: 'ord_u6_biz', userId: u6, planId: 'plan_business', status: 'active', lastPaymentStatus: 'approved', lastCreditedAt: new Date(now - 40 * 86400000).toISOString(), currentPeriodEnd: past, createdAt: new Date(now - 40 * 86400000).toISOString()
  });
  await db.collection(COLLECTIONS.payments).doc('ord_u6_pro').set({
    id: 'ord_u6_pro', userId: u6, planId: 'plan_pro', status: 'active', lastPaymentStatus: 'approved', lastCreditedAt: new Date().toISOString(), currentPeriodEnd: future, createdAt: new Date().toISOString()
  });
  const res6 = await recalculateUserPlan(u6);
  assert.equal(res6.planId, 'plan_pro');
  assert.equal(res6.planStatus, 'active');

  // Caso 7: NO VALID ORDER => FREE
  const u7 = 'usr_no_orders';
  const res7 = await recalculateUserPlan(u7);
  assert.equal(res7.planId, 'plan_free');
  assert.equal(res7.planStatus, 'free');

  // Caso 8 (P01/P04): PREAPPROVAL APENAS AUTHORIZED SEM PAGAMENTO APROVADO => PERMANECE FREE
  const u8 = 'usr_preapproval_only_authorized';
  await db.collection(COLLECTIONS.payments).doc('ord_u8').set({
    id: 'ord_u8', userId: u8, planId: 'plan_pro', status: 'pending', subscriptionStatus: 'authorized', createdAt: new Date().toISOString()
  });
  const res8 = await recalculateUserPlan(u8);
  assert.equal(res8.planId, 'plan_free', 'Preapproval authorized sem liquidação não pode ativar plano Pro');
  assert.equal(res8.planStatus, 'free');

  // Caso 9 (P02): PREAPPROVAL PENDENTE CANCELADA NUNCA LIQUIDADA => PERMANECE FREE
  const u9 = 'usr_preapproval_cancelled_unpaid';
  await db.collection(COLLECTIONS.payments).doc('ord_u9').set({
    id: 'ord_u9', userId: u9, planId: 'plan_business', status: 'cancelled', subscriptionStatus: 'cancelled', createdAt: new Date().toISOString()
  });
  const res9 = await recalculateUserPlan(u9);
  assert.equal(res9.planId, 'plan_free', 'Assinatura cancelada antes do primeiro pagamento aprovado deve ser free');
  assert.equal(res9.planStatus, 'free');
});

test('Payments: Sentinela de reversão único evita dedução dupla de créditos em múltiplos eventos de estorno', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_reversal_sentinel_test';
  const orderId = 'order_rev_1';
  const paymentId = 'mp_pay_rev_100';

  // Cria pedido Pro de 150 créditos
  await db.collection(COLLECTIONS.payments).doc(orderId).set({
    id: orderId,
    userId,
    planId: 'plan_pro',
    planName: 'PRO',
    amount: 97,
    currency: 'BRL',
    creditsGranted: 150,
    bonusCreditsGranted: 0,
    status: 'pending',
    billingMode: 'one_time'
  });

  // 1. Pagamento aprovado
  await applyPaymentCycle({
    orderId,
    paymentId,
    cycleId: paymentId,
    status: 'approved',
    amount: 97,
    currency: 'BRL'
  });

  const walletAfterApprove = await getWallet(userId);
  assert.equal(walletAfterApprove.balance, 150);
  assert.equal(walletAfterApprove.planStatus, 'active');

  // 2. Primeiro evento de estorno: 'refunded'
  await applyPaymentCycle({
    orderId,
    paymentId,
    cycleId: paymentId,
    status: 'refunded',
    amount: 97,
    currency: 'BRL'
  });

  const walletAfterRefund = await getWallet(userId);
  assert.equal(walletAfterRefund.balance, 0, 'Créditos estornados devem voltar a 0');
  assert.equal(walletAfterRefund.planStatus, 'free');

  // 3. Segundo evento para o MESMO paymentId: 'charged_back'
  await applyPaymentCycle({
    orderId,
    paymentId,
    cycleId: paymentId,
    status: 'charged_back',
    amount: 97,
    currency: 'BRL'
  });

  const walletAfterChargedBack = await getWallet(userId);
  assert.equal(walletAfterChargedBack.balance, 0, 'Sentinela único impede saldo negativo / dedução dupla');
});

test('AI & Credits: Mock AI em teste executa reserva, commit e rollback de créditos corretamente', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_ai_credit_test';

  // 1. Inicializa carteira com 50 créditos
  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    id: userId,
    userId,
    balance: 50,
    bonusBalance: 0,
    totalUsed: 0,
    totalReceived: 50,
    reservedCredits: 0,
    planId: 'plan_pro',
    planStatus: 'active',
    updatedAt: new Date().toISOString()
  });

  const { executeAi } = await import('../server/production/ai.js');

  // 2. Execução bem-sucedida de cta (custo: 1 crédito)
  const resSuccess = await executeAi({
    userId,
    operation: 'cta',
    prompt: 'Crie um CTA persuasivo',
    parse: (text) => text
  });

  assert.equal(resSuccess.creditsUsed, 1);
  assert.ok(typeof resSuccess.modelUsed === 'string' && resSuccess.modelUsed.length > 0);

  const walletAfterSuccess = await getWallet(userId);
  assert.equal(walletAfterSuccess.balance, 49);
  assert.equal(walletAfterSuccess.reservedCredits, 0);
  assert.equal(walletAfterSuccess.totalUsed, 1);

  // 3. Execução com falha controlada no parser (deve acionar rollback automático)
  await assert.rejects(
    async () => {
      await executeAi({
        userId,
        operation: 'campaign', // custo: 50 créditos (saldo atual é 49 => saldo insuficiente)
        prompt: 'Gere campanha',
        parse: () => {
          throw new Error('Falha de parsing forçada');
        }
      });
    },
    (err: any) => {
      return err.message.includes('Saldo insuficiente');
    }
  );

  // Saldo continua 49 intacto
  const walletAfterFail = await getWallet(userId);
  assert.equal(walletAfterFail.balance, 49);
  assert.equal(walletAfterFail.reservedCredits, 0);
});

test('Payments: Dez checkouts concorrentes com a mesma chave geram uma única ordem e uma chamada ao provedor (A01)', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_concurrent_checkout';
  const idemKey = 'test-concurrent-key-123';

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;

  try {
    globalThis.fetch = async (url, init) => {
      providerCalls++;
      // Simula pequena latência de rede
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'mp_pref_conc_999', init_point: 'https://mercadopago.com/checkout/conc_999' })
      } as any;
    };

    const { createCheckout } = await import('../server/production/payments.js');

    // Dispara 10 requisições rigorosamente concorrentes
    const requests = Array.from({ length: 10 }).map(() =>
      createCheckout({
        userId,
        userEmail: 'user@teste.com',
        userName: 'User Teste',
        planId: 'plan_pro',
        idempotencyKey: idemKey
      })
    );

    const results = await Promise.all(requests);

    // Todos os 10 devem retornar o MESMO initPoint e o MESMO orderId
    const firstOrderId = results[0].order.id;
    const firstInitPoint = results[0].initPoint;
    assert.ok(firstOrderId);
    assert.ok(firstInitPoint);

    for (const res of results) {
      assert.equal(res.order.id, firstOrderId);
      assert.equal(res.initPoint, firstInitPoint);
    }

    // Apenas UMA ordem deve existir no banco
    const orderDocs = await db.collection(COLLECTIONS.payments).where('userId', '==', userId).get();
    assert.equal(orderDocs.size, 1);

    // Apenas UMA chamada ao provedor
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Payments: Mesma chave de idempotência com payload diferente retorna conflito 409 (A01)', async () => {
  resetMemoryDb();
  const userId = 'usr_conflict_idem';
  const idemKey = 'test-conflict-key-456';

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'mp_pref_conflict', init_point: 'https://mp.com/conflict' })
    } as any);

    const { createCheckout } = await import('../server/production/payments.js');

    // 1. Primeira chamada com plano PRO
    const res1 = await createCheckout({
      userId,
      userEmail: 'user@teste.com',
      userName: 'User Teste',
      planId: 'plan_pro',
      idempotencyKey: idemKey
    });
    assert.ok(res1.initPoint);

    // 2. Segunda chamada com a MESMA chave mas plano BUSINESS => Deve lançar 409
    await assert.rejects(
      async () => {
        await createCheckout({
          userId,
          userEmail: 'user@teste.com',
          userName: 'User Teste',
          planId: 'plan_business',
          idempotencyKey: idemKey
        });
      },
      (err: any) => {
        return err.statusCode === 409 || err.message.includes('Conflito de idempotência');
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Payments: Máquina de estados monotônica impede regressão de cancelado/estornado para aprovado (A02)', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_monotonic_test';
  const orderId = 'ord_monotonic_1';

  // Cria pedido já estornado (estado final)
  await db.collection(COLLECTIONS.payments).doc(orderId).set({
    id: orderId,
    userId,
    amount: 197,
    currency: 'BRL',
    planId: 'plan_business',
    planName: 'BUSINESS',
    billingMode: 'single_payment',
    creditsGranted: 500,
    status: 'refunded',
    lastPaymentStatus: 'refunded',
    createdAt: new Date().toISOString()
  });

  const { applyPaymentCycle, canTransitionOrderStatus } = await import('../server/production/payments.js');

  // Testes diretos da matriz de transição
  assert.equal(canTransitionOrderStatus('pending', 'approved'), true);
  assert.equal(canTransitionOrderStatus('pending', 'active'), true);
  assert.equal(canTransitionOrderStatus('approved', 'refunded'), true);
  assert.equal(canTransitionOrderStatus('approved', 'charged_back'), true);
  assert.equal(canTransitionOrderStatus('refunded', 'approved'), false);
  assert.equal(canTransitionOrderStatus('cancelled', 'approved'), false);
  assert.equal(canTransitionOrderStatus('failed', 'approved'), false);

  // Tentativa de aplicar webhook tardio 'approved' em pedido 'refunded' não altera status para approved
  await applyPaymentCycle({
    orderId,
    paymentId: 'pay_late_approved_123',
    cycleId: 'cycle_late_123',
    status: 'approved',
    amount: 197,
    currency: 'BRL'
  });

  const orderAfter = await db.collection(COLLECTIONS.payments).doc(orderId).get();
  assert.equal(orderAfter.data()?.status, 'refunded');
});

test('Payments: Cancelamento sem ciclo liquidado nunca gera 30 dias de fallback e cancela imediatamente (A04)', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_unsettled_cancel';
  const orderId = 'order_unsettled_sub';
  const subId = 'mp_sub_unsettled_123';

  const originalFetch = globalThis.fetch;
  try {
    // Pedido de assinatura com status pending / authorized sem nunca ter sido liquidado
    await db.collection(COLLECTIONS.payments).doc(orderId).set({
      id: orderId,
      userId,
      planId: 'plan_pro',
      billingMode: 'subscription',
      providerSubscriptionId: subId,
      status: 'pending',
      subscriptionStatus: 'pending',
      createdAt: new Date().toISOString()
    });

    await db.collection(COLLECTIONS.wallets).doc(userId).set({
      id: userId,
      userId,
      balance: 0,
      planId: 'plan_free',
      planStatus: 'free',
      updatedAt: new Date().toISOString()
    });

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'cancelled' })
    } as any);

    const { cancelSubscription } = await import('../server/production/payments.js');
    const res = await cancelSubscription(userId, orderId);

    // Deve cancelar imediatamente com status 'cancelled' e SEM currentPeriodEnd
    assert.equal(res.status, 'cancelled');
    assert.equal(res.currentPeriodEnd, null);

    const savedOrder = await db.collection(COLLECTIONS.payments).doc(orderId).get();
    assert.equal(savedOrder.data()?.status, 'cancelled');
    assert.equal(savedOrder.data()?.subscriptionStatus, 'cancelled');
    assert.equal(savedOrder.data()?.currentPeriodEnd, null);

    const savedWallet = await db.collection(COLLECTIONS.wallets).doc(userId).get();
    assert.equal(savedWallet.data()?.planStatus, 'free');
    assert.equal(savedWallet.data()?.planId, 'plan_free');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Payments: Prova financeira real expurga ativações fraudulentas ou não liquidadas (A03)', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_fraud_audit';

  // Ordem adulterada/não liquidada: status='active', mas sem lastCreditedAt e sem lastPaymentStatus='approved'
  await db.collection(COLLECTIONS.payments).doc('ord_fraud_1').set({
    id: 'ord_fraud_1',
    userId,
    planId: 'plan_agency',
    status: 'active',
    // Propositalmente sem comprovante real de liquidação
    createdAt: new Date().toISOString()
  });

  const { recalculateUserPlan } = await import('../server/production/plans.js');
  const plan = await recalculateUserPlan(userId);

  assert.equal(plan.planId, 'plan_free', 'Ordem sem comprovação de liquidação não pode conceder plano Agency');
  assert.equal(plan.planStatus, 'free');
});

test('Payments: Reconciliação atômica da carteira no processamento de assinaturas (A05)', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_sub_reconcile';
  const orderId = 'order_sub_rec_1';

  await db.collection(COLLECTIONS.payments).doc(orderId).set({
    id: orderId,
    userId,
    planId: 'plan_business',
    planName: 'BUSINESS',
    amount: 197,
    currency: 'BRL',
    creditsGranted: 350,
    bonusCreditsGranted: 50,
    status: 'pending',
    billingMode: 'subscription'
  });

  const { applyPaymentCycle } = await import('../server/production/payments.js');
  await applyPaymentCycle({
    orderId,
    paymentId: 'pay_sub_first_cycle',
    cycleId: 'cycle_1',
    status: 'approved',
    amount: 197,
    currency: 'BRL',
    subscriptionId: 'sub_rec_123'
  });

  const wallet = await getWallet(userId);
  assert.equal(wallet.balance, 400);
  assert.equal(wallet.bonusBalance, 50);
  assert.equal(wallet.planId, 'plan_business');
  assert.equal(wallet.planStatus, 'active');
  assert.ok(wallet.currentPeriodEnd);
});

test('Security & SEO: SSRF e DNS Rebinding bloqueiam estritamente redes privadas e localhost (D01)', async () => {
  const { safeFetchHtml } = await import('../server/production/seo.js');

  // Localhost
  await assert.rejects(
    async () => safeFetchHtml('http://localhost:8080'),
    (err: any) => err.message.includes('bloqueado por segurança')
  );

  // IP Privado 127.0.0.1
  await assert.rejects(
    async () => safeFetchHtml('http://127.0.0.1:3000'),
    (err: any) => err.message.includes('bloqueado por segurança')
  );

  // IP Privado 192.168.1.1
  await assert.rejects(
    async () => safeFetchHtml('http://192.168.1.1/admin'),
    (err: any) => err.message.includes('bloqueado por segurança')
  );

  // IP Privado 10.0.0.1
  await assert.rejects(
    async () => safeFetchHtml('http://10.0.0.1/meta-data'),
    (err: any) => err.message.includes('bloqueado por segurança')
  );

  // Link Local AWS / GCP Metadata 169.254.169.254
  await assert.rejects(
    async () => safeFetchHtml('http://169.254.169.254/latest/meta-data/'),
    (err: any) => err.message.includes('bloqueado por segurança')
  );
});

test('Security & Anti-Abuse: Bônus de boas-vindas bloqueia e-mails descartáveis e aliases canônicos repetidos (D02, D03)', async () => {
  resetMemoryDb();
  const { evaluateSignupBonusEligibility } = await import('../server/production/antiAbuse.js');

  // E-mail descartável
  const disposableRes = await evaluateSignupBonusEligibility({
    userId: 'usr_temp_1',
    email: 'test@10minutemail.com',
    ip: '189.10.20.30'
  });
  assert.equal(disposableRes.eligibleForBonus, false);
  assert.equal(disposableRes.bonusAmount, 0);
  assert.equal(disposableRes.reason, 'blocked_disposable_email');

  // Primeiro cadastro legítimo
  const firstUserRes = await evaluateSignupBonusEligibility({
    userId: 'usr_legit_1',
    email: 'joao.silva@gmail.com',
    ip: '189.10.20.30',
    securityPayload: { deviceId: 'dev_iphone_123' }
  });
  assert.equal(firstUserRes.eligibleForBonus, true);
  assert.equal(firstUserRes.bonusAmount, 25);
  assert.equal(firstUserRes.reason, 'approved_first_account');

  // Tentativa de alias repetido (joao.silva+bonus@gmail.com)
  const aliasUserRes = await evaluateSignupBonusEligibility({
    userId: 'usr_fraud_alias',
    email: 'joao.silva+bonus@gmail.com',
    ip: '189.10.20.30'
  });
  assert.equal(aliasUserRes.eligibleForBonus, false);
  assert.equal(aliasUserRes.bonusAmount, 0);
  assert.equal(aliasUserRes.reason, 'blocked_duplicate_canonical_email');

  // Tentativa de reuso de mesmo Device ID
  const duplicateDeviceRes = await evaluateSignupBonusEligibility({
    userId: 'usr_fraud_device',
    email: 'maria.souza@outlook.com',
    ip: '189.10.20.30',
    securityPayload: { deviceId: 'dev_iphone_123' }
  });
  assert.equal(duplicateDeviceRes.eligibleForBonus, false);
  assert.equal(duplicateDeviceRes.bonusAmount, 0);
  assert.equal(duplicateDeviceRes.reason, 'blocked_duplicate_device');
});

test('Auth & Security: Custom Claims e fail-closed para role de administrador (D04)', async () => {
  const { requireAdmin } = await import('../server/production/auth.js');

  let passed = false;
  let statusSet = 0;
  let jsonRes: any = null;

  const mockRes: any = {
    status: (code: number) => {
      statusSet = code;
      return {
        json: (data: any) => { jsonRes = data; }
      };
    }
  };

  // Usuário padrão sem role admin
  await requireAdmin(
    { user: { id: 'usr_regular', role: 'user', name: 'Regular', email: 'reg@test.com', createdAt: '' } } as any,
    mockRes,
    () => { passed = true; }
  );

  assert.equal(passed, false);
  assert.equal(statusSet, 403);
  assert.equal(jsonRes?.error, 'Acesso restrito a administradores.');

  // Usuário administrador
  passed = false;
  statusSet = 0;
  await requireAdmin(
    { user: { id: 'usr_admin_1', role: 'admin', name: 'Admin', email: 'admin@froc.ia', createdAt: '' } } as any,
    mockRes,
    () => { passed = true; }
  );

  assert.equal(passed, true);
  assert.equal(statusSet, 0);
});




