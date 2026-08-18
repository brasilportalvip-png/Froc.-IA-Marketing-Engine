import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCanonicalEmail, isDisposableEmailDomain, evaluateSignupBonusEligibility } from '../server/production/antiAbuse.js';
import { resetMemoryDb } from '../server/production/store.js';

test('Anti-Abuse: Normalização canônica de e-mails', () => {
  assert.equal(
    normalizeCanonicalEmail('Usuario.Teste+promocao123@gmail.com').canonical,
    'usuarioteste@gmail.com'
  );
  assert.equal(
    normalizeCanonicalEmail('Joao.Silva@googlemail.com').canonical,
    'joaosilva@gmail.com'
  );
  assert.equal(
    normalizeCanonicalEmail('Empresa.contato+news@empresa.com.br').canonical,
    'empresa.contato@empresa.com.br'
  );
});

test('Anti-Abuse: Bloqueio de domínios descartáveis / temporários', () => {
  assert.equal(isDisposableEmailDomain('tempmail.com'), true);
  assert.equal(isDisposableEmailDomain('mailinator.com'), true);
  assert.equal(isDisposableEmailDomain('10minutemail.com'), true);
  assert.equal(isDisposableEmailDomain('guerrillamail.com'), true);
  assert.equal(isDisposableEmailDomain('gmail.com'), false);
  assert.equal(isDisposableEmailDomain('outlook.com'), false);
  assert.equal(isDisposableEmailDomain('empresa.com.br'), false);
});

test('Anti-Abuse: Avaliação rigorosa de bônus de boas-vindas (25 créditos na 1ª conta, 0 nas subsequentes)', async () => {
  resetMemoryDb();

  const user1 = await evaluateSignupBonusEligibility({
    userId: 'user_primeiro_123',
    email: 'cliente.real@gmail.com',
    ip: '187.50.10.1',
    userAgent: 'Mozilla/5.0 Chrome/120',
    securityPayload: {
      deviceId: 'dev_hardware_alpha_99',
      fingerprintHash: 'fp_hash_alpha_99',
      hardwareConcurrency: 8,
      screenResolution: '1920x1080'
    }
  });

  assert.equal(user1.eligibleForBonus, true);
  assert.equal(user1.bonusAmount, 25);
  assert.equal(user1.reason, 'approved_first_account');

  // Segunda conta criada pela mesma pessoa / mesmo dispositivo
  const user2 = await evaluateSignupBonusEligibility({
    userId: 'user_segunda_conta_456',
    email: 'cliente.real+conta2@gmail.com',
    ip: '187.50.10.1',
    userAgent: 'Mozilla/5.0 Chrome/120',
    securityPayload: {
      deviceId: 'dev_hardware_alpha_99',
      fingerprintHash: 'fp_hash_alpha_99',
      hardwareConcurrency: 8,
      screenResolution: '1920x1080'
    }
  });

  assert.equal(user2.eligibleForBonus, false);
  assert.equal(user2.bonusAmount, 0);
  assert.ok(user2.reason.startsWith('blocked_'));
});
