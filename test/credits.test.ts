import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { config } from '../server/config/index.js';
import { addCredits, getWallet, reserveCredits, commitReservation, rollbackReservation } from '../server/production/credits.js';
import { processMercadoPagoWebhook, verifyMercadoPagoSignature } from '../server/production/payments.js';
import { resetMemoryDb } from '../server/production/store.js';

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
