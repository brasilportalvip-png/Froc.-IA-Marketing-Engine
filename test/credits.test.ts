import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { config } from '../server/config/index.js';
import { addCredits, getWallet, reserveCredits, commitReservation, rollbackReservation } from '../server/production/credits.js';
import { applyPaymentCycle, processMercadoPagoWebhook, verifyMercadoPagoSignature } from '../server/production/payments.js';
import { COLLECTIONS, firestore, resetMemoryDb } from '../server/production/store.js';

test('Credits: Estado de plano de nova conta é estritamente "plan_free" e não concede plano pago sem compra', async () => {
  resetMemoryDb();
  const userId = 'usr_new_free_user_1';

  const wallet = await getWallet(userId);
  assert.equal(wallet.planId, 'plan_free');
  assert.equal(wallet.balance, 0);
  assert.equal(wallet.bonusBalance, 0);
  assert.equal(wallet.totalReceived, 0);
  assert.equal(wallet.reservedCredits, 0);
});

test('Credits: Inicialização de carteira e adição com chave de idempotência', async () => {
  resetMemoryDb();
  const userId = 'usr_test_credits_1';

  const w1 = await addCredits({
    userId,
    amount: 50,
    type: 'purchase',
    source: 'Plano Pro Teste',
    idempotencyKey: 'tx_idemp_key_1001'
  });

  assert.equal(w1.balance, 50);

  // Tentativa duplicada com a mesma chave de idempotência
  const w2 = await addCredits({
    userId,
    amount: 50,
    type: 'purchase',
    source: 'Plano Pro Teste Duplicado',
    idempotencyKey: 'tx_idemp_key_1001'
  });

  // O saldo deve permanecer 50 (não pode duplicar para 100)
  assert.equal(w2.balance, 50);
});

test('Credits: Reserva de créditos, commit e rollback em caso de falha de IA', async () => {
  resetMemoryDb();
  const userId = 'usr_test_reserva_2';

  // Inicia com 30 créditos
  await addCredits({
    userId,
    amount: 30,
    type: 'bonus',
    source: 'Bônus Inicial'
  });

  // Reserva 10 créditos para geração de post
  const res1 = await reserveCredits({
    userId,
    amount: 10,
    operation: 'post_ai'
  });

  assert.ok(res1.reservationId);
  assert.equal(res1.wallet.reservedCredits, 10);
  const wAposReserva = await getWallet(userId);
  assert.equal(wAposReserva.balance, 30);
  assert.equal(wAposReserva.reservedCredits, 10);
  assert.equal(wAposReserva.balance - (wAposReserva.reservedCredits || 0), 20); // Saldo disponível líquido

  // Sucesso na operação -> commit da reserva
  await commitReservation({
    userId,
    reservationId: res1.reservationId,
    source: 'IA Post Concluído'
  });

  const wAposCommit = await getWallet(userId);
  assert.equal(wAposCommit.balance, 20);
  assert.equal(wAposCommit.reservedCredits, 0);

  // Nova reserva de 15 créditos para imagem com simulação de erro
  const res2 = await reserveCredits({
    userId,
    amount: 15,
    operation: 'image_ai'
  });

  const wAposReserva2 = await getWallet(userId);
  assert.equal(wAposReserva2.reservedCredits, 15);
  assert.equal(wAposReserva2.balance - (wAposReserva2.reservedCredits || 0), 5);

  // Falha na IA -> Rollback da reserva deve devolver os 15 créditos
  await rollbackReservation(userId, res2.reservationId, 'Simulação de erro na API do Gemini');

  const wAposRollback = await getWallet(userId);
  assert.equal(wAposRollback.balance, 20); // Saldo intocado
  assert.equal(wAposRollback.reservedCredits, 0); // Reserva limpa
});

test('Payments Webhook: Validação e rejeição de assinaturas HMAC SHA-256 do Mercado Pago', async () => {
  resetMemoryDb();

  const secret = 'test_webhook_secret_froc_123';
  // Mock config secret temporarily for test
  config.mercadoPago.webhookSecret = secret;

  const dataId = 'mp_payment_12345';
  const requestId = 'req_abc_999';
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const validV1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const validSignatureHeader = `ts=${ts},v1=${validV1}`;

  // 1. Assinatura válida
  const isValid = verifyMercadoPagoSignature({
    signatureHeader: validSignatureHeader,
    requestId,
    dataId
  });
  assert.equal(isValid, true);

  // 2. Assinatura adulterada / forjada
  const isInvalid = verifyMercadoPagoSignature({
    signatureHeader: `ts=${ts},v1=deadbeef1234567890abcdef`,
    requestId,
    dataId
  });
  assert.equal(isInvalid, false);

  // 3. Webhook com assinatura adulterada deve lançar erro 401
  await assert.rejects(
    async () => {
      await processMercadoPagoWebhook({
        body: { data: { id: dataId }, type: 'payment' },
        query: {},
        headers: { 'x-signature': 'ts=123,v1=invalida', 'x-request-id': requestId }
      });
    },
    (err: any) => {
      return err.statusCode === 401 || err.message.includes('inválida');
    }
  );
});

test('Payments Webhook: Idempotência lógica de pagamento aprovado e transição de plano no Mercado Pago', async () => {
  resetMemoryDb();
  const db = firestore();

  const userId = 'usr_customer_mp_1';
  const orderId = 'ord_froc_plan_start_001';
  const paymentId = 'mp_pay_real_987654321';

  // 1. Cria pedido com plano START (R$ 49,00 -> 100 créditos)
  await db.collection(COLLECTIONS.payments).doc(orderId).set({
    id: orderId,
    userId,
    planId: 'plan_start',
    planName: 'START',
    amount: 49.0,
    currency: 'BRL',
    creditsGranted: 100,
    bonusCreditsGranted: 0,
    billingMode: 'subscription',
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  // Verifica que antes do pagamento o usuário possui plano gratuito (plan_free)
  const initialWallet = await getWallet(userId);
  assert.equal(initialWallet.planId, 'plan_free');
  assert.equal(initialWallet.balance, 0);

  // 2. Primeiro processamento do webhook (Pagamento Aprovado)
  await applyPaymentCycle({
    orderId,
    paymentId,
    cycleId: 'cycle_1',
    status: 'approved',
    amount: 49.0,
    currency: 'BRL',
    paymentMethod: 'credit_card',
    subscriptionId: 'sub_mp_123'
  });

  // Verifica concessão: Saldo 100, Plano START
  const walletAposPrimeiro = await getWallet(userId);
  assert.equal(walletAposPrimeiro.balance, 100);
  assert.equal(walletAposPrimeiro.planId, 'plan_start');
  assert.equal(walletAposPrimeiro.totalReceived, 100);

  // Verifica que foi gravada exatamente 1 transação de crédito
  const txSnap1 = await db.collection(COLLECTIONS.creditTransactions).where('userId', '==', userId).get();
  assert.equal(txSnap1.docs.length, 1);
  assert.equal(txSnap1.docs[0].data()?.amount, 100);

  // Verifica que o pedido foi atualizado para status 'active'
  const orderSnap1 = await db.collection(COLLECTIONS.payments).doc(orderId).get();
  assert.equal(orderSnap1.data()?.status, 'active');
  assert.equal(orderSnap1.data()?.providerPaymentId, paymentId);

  // 3. Segundo processamento idêntico (Webhook duplicado / Retentativa de rede)
  await applyPaymentCycle({
    orderId,
    paymentId,
    cycleId: 'cycle_1',
    status: 'approved',
    amount: 49.0,
    currency: 'BRL',
    paymentMethod: 'credit_card',
    subscriptionId: 'sub_mp_123'
  });

  // O saldo e o plano DEVEM permanecer idênticos (não pode duplicar para 200 créditos)
  const walletAposDuplicado = await getWallet(userId);
  assert.equal(walletAposDuplicado.balance, 100);
  assert.equal(walletAposDuplicado.planId, 'plan_start');
  assert.equal(walletAposDuplicado.totalReceived, 100);

  // A contagem de transações de crédito continua sendo exatamente 1
  const txSnap2 = await db.collection(COLLECTIONS.creditTransactions).where('userId', '==', userId).get();
  assert.equal(txSnap2.docs.length, 1);
});
