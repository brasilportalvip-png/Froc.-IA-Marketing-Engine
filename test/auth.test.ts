import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureUserProfile, requireAdmin } from '../server/production/auth.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';

test('Auth: Criação de perfil com role "user" padrão e imutabilidade de privilégios pelo cliente', async () => {
  resetMemoryDb();

  const mockToken = {
    uid: 'usr_normal_123',
    email: 'normal.user@empresa.com',
    email_verified: true,
    name: 'Normal User',
    picture: 'https://example.com/avatar.jpg'
  } as any;

  const profile = await ensureUserProfile(mockToken, {
    name: 'Normal User Renomeado',
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    termsVersion: '2026.1',
    privacyVersion: '2026.1'
  });

  assert.equal(profile.id, 'usr_normal_123');
  assert.equal(profile.role, 'user');
  assert.equal(profile.termsVersion, '2026.1');
  assert.equal(profile.privacyVersion, '2026.1');

  // Tentativa do usuário tentar se auto-elevar a admin via extras ou payload
  const profileReauth = await ensureUserProfile(mockToken, {
    role: 'admin' as any // Tentativa de injeção
  });

  // O role deve permanecer estritamente 'user'
  assert.equal(profileReauth.role, 'user');
});

test('Auth: Middleware requireAdmin bloqueia usuários comuns e permite apenas admin configurado', async () => {
  resetMemoryDb();

  let nextCalled = false;
  const mockReqUser: any = {
    user: { id: 'usr_normal_123', email: 'normal@empresa.com', role: 'user' }
  };
  let statusCode = 0;
  let jsonError = '';
  const mockRes: any = {
    status: (code: number) => {
      statusCode = code;
      return {
        json: (data: any) => {
          jsonError = data.error;
        }
      };
    }
  };

  // Usuário comum
  requireAdmin(mockReqUser, mockRes, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.ok(jsonError.includes('Acesso restrito'));

  // Usuário admin
  let adminNextCalled = false;
  const mockReqAdmin: any = {
    user: { id: 'usr_admin_999', email: 'admin@froc.ia', role: 'admin' }
  };

  requireAdmin(mockReqAdmin, mockRes, () => {
    adminNextCalled = true;
  });

  assert.equal(adminNextCalled, true);
});

test('Auth: Validação estrita de termos de uso e política de privacidade (versão 2026.1)', async () => {
  resetMemoryDb();

  const mockToken = {
    uid: 'usr_terms_test',
    email: 'consent@empresa.com',
    email_verified: true
  } as any;

  // Tentativa com versão vazia de termos -> não deve registrar versão
  const profileEmpty = await ensureUserProfile(mockToken, {
    termsVersion: '   ',
    privacyVersion: ''
  });

  assert.equal(profileEmpty.termsVersion, undefined);
  assert.equal(profileEmpty.privacyVersion, undefined);

  // Registro válido com versão 2026.1
  const profileValid = await ensureUserProfile(mockToken, {
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    termsVersion: '2026.1',
    privacyVersion: '2026.1'
  });

  assert.equal(profileValid.termsVersion, '2026.1');
  assert.equal(profileValid.privacyVersion, '2026.1');
  assert.ok(profileValid.termsAcceptedAt);
  assert.ok(profileValid.privacyAcceptedAt);
});

