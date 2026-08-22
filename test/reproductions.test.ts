import test from 'node:test';
import assert from 'node:assert/strict';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';
import { createCheckout, applyPaymentCycle, processMercadoPagoWebhook } from '../server/production/payments.js';
import { recalculateUserPlan } from '../server/production/plans.js';
import { getWallet } from '../server/production/credits.js';

// R01: Checkout sem idempotência
test('R01 — Checkout sem idempotência é rejeitado e não cria ordem nem chama provedor', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_r01_test';
  let providerCalled = false;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      providerCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'mp_123', init_point: 'https://mp.com' })
      } as any;
    };

    // Chamada sem idempotencyKey (ou vazia/undefined)
    await assert.rejects(
      async () => {
        await createCheckout({
          userId,
          userEmail: 'r01@test.com',
          userName: 'R01 User',
          planId: 'plan_pro'
          // idempotencyKey omitido
        } as any);
      },
      (err: any) => {
        return err.statusCode === 400 || err.statusCode === 422 || err.message.includes('idempotency');
      }
    );

    // Nenhuma ordem criada
    const orders = await db.collection(COLLECTIONS.payments).where('userId', '==', userId).get();
    assert.equal(orders.size, 0, 'Nenhuma ordem deve ser criada sem chave de idempotência');
    assert.equal(providerCalled, false, 'Mercado Pago não pode ser chamado');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// R02: Concorrência com provedor lento (stub demora 2.5s)
test('R02 — Concorrência com provedor lento (2.5s) gera exatamente 1 chamada e 1 ordem para 10 requisições simultâneas', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_r02_slow_mp';
  const idemKey = 'idem-key-r02-slow-2500';
  let providerCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url: any) => {
      providerCalls++;
      // Simula lentidão de 2.5s no provedor conforme especificação de R02
      await new Promise((r) => setTimeout(r, 2500));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'mp_pref_r02_slow',
          init_point: 'https://mercadopago.com/checkout/r02_slow'
        })
      } as any;
    };

    const requests = Array.from({ length: 10 }).map(() =>
      createCheckout({
        userId,
        userEmail: 'r02@test.com',
        userName: 'R02 User',
        planId: 'plan_business',
        idempotencyKey: idemKey
      })
    );

    const results = await Promise.all(requests);

    assert.equal(providerCalls, 1, 'Provedor deve ser chamado exatamente uma vez');

    const firstOrderId = results[0].order.id;
    const firstInitPoint = results[0].initPoint;
    assert.ok(firstOrderId);
    assert.ok(firstInitPoint);

    for (const res of results) {
      assert.equal(res.order.id, firstOrderId);
      assert.equal(res.initPoint, firstInitPoint);
    }

    const orderDocs = await db.collection(COLLECTIONS.payments).where('userId', '==', userId).get();
    assert.equal(orderDocs.size, 1, 'Deve existir exatamente 1 ordem no banco');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// R03: Plano ativo sem prova financeira
test('R03 — Documento legado active com currentPeriodEnd futuro mas sem lastCreditedAt ou lastPaymentStatus approved é rebaixado para plan_free', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_r03_no_proof';

  // Documento legado: status='active', currentPeriodEnd no futuro, planId='plan_agency',
  // SEM lastCreditedAt, SEM lastPaymentStatus approved
  const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
  await db.collection(COLLECTIONS.payments).doc('ord_r03_fake').set({
    id: 'ord_r03_fake',
    userId,
    planId: 'plan_agency',
    planName: 'AGENCY',
    status: 'active',
    currentPeriodEnd: futureDate,
    // Propositalmente sem lastCreditedAt e sem lastPaymentStatus: 'approved'
    createdAt: new Date().toISOString()
  });

  const plan = await recalculateUserPlan(userId);
  assert.equal(plan.planId, 'plan_free', 'Usuário sem prova financeira imutável deve receber plan_free');
  assert.equal(plan.planStatus, 'free');
});

// R04: Regressão parcial por evento atrasado
test('R04 — Evento pending atrasado para pagamento approved é ignorado e lastPaymentStatus permanece approved', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_r04_delayed';
  const orderId = 'ord_r04_test';

  await db.collection(COLLECTIONS.payments).doc(orderId).set({
    id: orderId,
    userId,
    planId: 'plan_pro',
    planName: 'PRO',
    amount: 97,
    currency: 'BRL',
    creditsGranted: 200,
    status: 'pending',
    billingMode: 'single_payment'
  });

  // 1. Pagamento approved recebido
  await applyPaymentCycle({
    orderId,
    paymentId: 'pay_r04_123',
    cycleId: 'cycle_r04',
    status: 'approved',
    amount: 97,
    currency: 'BRL'
  });

  const orderAfterApproved = (await db.collection(COLLECTIONS.payments).doc(orderId).get()).data() as any;
  assert.equal(orderAfterApproved.status, 'approved');
  assert.equal(orderAfterApproved.lastPaymentStatus, 'approved');
  const creditsFirst = (await getWallet(userId)).balance;

  // 2. Evento atrasado com status 'pending' para o mesmo pagamento
  await applyPaymentCycle({
    orderId,
    paymentId: 'pay_r04_123',
    cycleId: 'cycle_r04',
    status: 'pending',
    amount: 97,
    currency: 'BRL'
  });

  const orderAfterDelayed = (await db.collection(COLLECTIONS.payments).doc(orderId).get()).data() as any;
  assert.equal(orderAfterDelayed.status, 'approved', 'Status da ordem não pode regredir');
  assert.equal(orderAfterDelayed.lastPaymentStatus, 'approved', 'lastPaymentStatus não pode regredir para pending');

  const creditsSecond = (await getWallet(userId)).balance;
  assert.equal(creditsSecond, creditsFirst, 'Créditos não podem ser alterados por evento atrasado');
});

// R05: Cancelamento de preapproval não atualiza carteira
test('R05 — Cancelamento de preapproval em assinatura não liquidada atualiza ordem e carteira para plan_free', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_r05_sub';
  const orderId = 'ord_r05_sub_1';
  const subId = 'sub_r05_mp_999';

  // Ordem de assinatura ainda não liquidada
  await db.collection(COLLECTIONS.payments).doc(orderId).set({
    id: orderId,
    userId,
    planId: 'plan_business',
    planName: 'BUSINESS',
    amount: 197,
    currency: 'BRL',
    billingMode: 'subscription',
    providerSubscriptionId: subId,
    status: 'pending'
  });

  // Carteira incorretamente em plan_business
  await db.collection(COLLECTIONS.wallets).doc(userId).set({
    id: userId,
    userId,
    planId: 'plan_business',
    planStatus: 'active',
    balance: 0,
    bonusBalance: 0
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url: any) => {
      if (String(url).includes('/preapproval/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: subId,
            status: 'cancelled',
            external_reference: orderId
          })
        } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    };

    // Processa webhook de preapproval cancelado
    await processMercadoPagoWebhook({
      body: { type: 'subscription_preapproval', data: { id: subId } },
      query: {},
      headers: {}
    });

    const orderAfter = (await db.collection(COLLECTIONS.payments).doc(orderId).get()).data() as any;
    assert.equal(orderAfter.status, 'cancelled');

    const walletAfter = await getWallet(userId);
    assert.equal(walletAfter.planId, 'plan_free', 'Carteira deve ser reconciliada para plan_free');
    assert.equal(walletAfter.planStatus, 'free');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
