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
  await db.collection(COLLECTIONS.wallets).doc(userPro).set({
    id: userPro,
    userId: userPro,
    balance: 50,
    bonusBalance: 0,
    reservedCredits: 0,
    planId: 'plan_pro',
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
