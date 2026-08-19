import test from 'node:test';
import assert from 'node:assert/strict';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';
import { getPlanEntitlements } from '../server/production/plans.js';
import { getEffectiveWallet, resolveEffectivePlan } from '../server/production/credits.js';

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
