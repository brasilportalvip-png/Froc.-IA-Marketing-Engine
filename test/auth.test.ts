import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  ensureUserProfile,
  hasAcceptedLatestTerms,
  requireAdmin,
  requireAuth
} from '../server/production/auth.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';
import * as firebaseAdminProvider from '../server/providers/firebaseAdmin.js';

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
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });

  assert.equal(profile.id, 'usr_normal_123');
  assert.equal(profile.role, 'user');
  assert.equal(profile.termsVersion, CURRENT_TERMS_VERSION);
  assert.equal(profile.privacyVersion, CURRENT_PRIVACY_VERSION);

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

test('Auth: Validação rigorosa e determinística de versões de consentimento (hasAcceptedLatestTerms)', () => {
  const now = new Date().toISOString();

  // 1. Usuário sem consentimento (null / undefined / campos ausentes)
  assert.equal(hasAcceptedLatestTerms(null), false);
  assert.equal(hasAcceptedLatestTerms(undefined), false);
  assert.equal(hasAcceptedLatestTerms({ id: 'u1', name: 'A', email: 'a@a.com', role: 'user', createdAt: now }), false);

  // 2. Usuário com versão antiga (ex: 2025.1) => bloqueado
  assert.equal(
    hasAcceptedLatestTerms({
      id: 'u2',
      name: 'B',
      email: 'b@b.com',
      role: 'user',
      createdAt: now,
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      termsVersion: '2025.1',
      privacyVersion: '2025.1'
    }),
    false
  );

  // 3. Usuário com somente termos atuais mas sem privacidade => bloqueado
  assert.equal(
    hasAcceptedLatestTerms({
      id: 'u3',
      name: 'C',
      email: 'c@c.com',
      role: 'user',
      createdAt: now,
      termsAcceptedAt: now,
      privacyAcceptedAt: undefined,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: undefined
    }),
    false
  );

  // 4. Usuário com somente privacidade atual mas sem termos => bloqueado
  assert.equal(
    hasAcceptedLatestTerms({
      id: 'u4',
      name: 'D',
      email: 'd@d.com',
      role: 'user',
      createdAt: now,
      termsAcceptedAt: undefined,
      privacyAcceptedAt: now,
      termsVersion: undefined,
      privacyVersion: CURRENT_PRIVACY_VERSION
    }),
    false
  );

  // 5. Usuário com ambas as versões atuais (2026.1) => autorizado
  assert.equal(
    hasAcceptedLatestTerms({
      id: 'u5',
      name: 'E',
      email: 'e@e.com',
      role: 'user',
      createdAt: now,
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION
    }),
    true
  );
});

test('Auth: Middleware requireAuth - Token válido, token adulterado, expirado, JWT inventado e Firebase indisponível', async () => {
  resetMemoryDb();
  const now = new Date().toISOString();

  // Prepara perfil no banco de memória
  await firestore().collection(COLLECTIONS.users).doc('usr_real_jwt_1').set({
    id: 'usr_real_jwt_1',
    email: 'valid@empresa.com',
    role: 'user',
    createdAt: now,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });

  // Salva referência original
  const originalGetAdminAuth = firebaseAdminProvider.getAdminAuth;

  try {
    // 1. Cenário: Token válido
    let mockAuthInstance: any = {
      verifyIdToken: async (token: string) => {
        if (token === 'valid_firebase_id_token_xyz') {
          return {
            uid: 'usr_real_jwt_1',
            email: 'valid@empresa.com',
            email_verified: true
          };
        }
        if (token === 'expired_token') {
          const err: any = new Error('Firebase ID token has expired');
          err.code = 'auth/id-token-expired';
          throw err;
        }
        const err: any = new Error('Decoding Firebase ID token failed');
        err.code = 'auth/argument-error';
        throw err;
      }
    };

    firebaseAdminProvider.setAdminAuthForTesting(mockAuthInstance);

    let nextCalled = false;
    let resStatus = 0;
    let resJson: any = null;
    const makeRes = () => ({
      status: (code: number) => {
        resStatus = code;
        return {
          json: (data: any) => {
            resJson = data;
          }
        };
      }
    });

    const reqValid: any = {
      headers: { authorization: 'Bearer valid_firebase_id_token_xyz' },
      path: '/content',
      originalUrl: '/api/content'
    };

    await requireAuth(reqValid, makeRes() as any, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(reqValid.user?.id, 'usr_real_jwt_1');
    assert.equal(reqValid.firebaseUser?.uid, 'usr_real_jwt_1');

    // 2. Cenário: Token adulterado
    nextCalled = false;
    resStatus = 0;
    const reqTampered: any = {
      headers: { authorization: 'Bearer tampered_signature_token' },
      path: '/content'
    };
    await requireAuth(reqTampered, makeRes() as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(resStatus, 401);
    assert.ok(resJson?.error?.includes('inválida ou expirada'));

    // 3. Cenário: Token expirado
    nextCalled = false;
    resStatus = 0;
    const reqExpired: any = {
      headers: { authorization: 'Bearer expired_token' },
      path: '/content'
    };
    await requireAuth(reqExpired, makeRes() as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(resStatus, 401);
    assert.ok(resJson?.error?.includes('inválida ou expirada'));

    // 4. Cenário: JWT inventado com role admin forjado no cabeçalho (sem validação pelo Firebase Admin)
    nextCalled = false;
    resStatus = 0;
    const fakeAdminJwt = 'eyJhbGciOiJub25lIn0.eyJ1aWQiOiJhdHRhY2tlciIsInJvbGUiOiJhZG1pbiJ9.';
    const reqFakeJwt: any = {
      headers: { authorization: `Bearer ${fakeAdminJwt}` },
      path: '/admin/stats'
    };
    await requireAuth(reqFakeJwt, makeRes() as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(resStatus, 401);

    // 5. Cenário: Firebase Admin indisponível (getAdminAuth() retorna null)
    firebaseAdminProvider.setAdminAuthForTesting(null);

    nextCalled = false;
    resStatus = 0;
    const reqAdminUnavailable: any = {
      headers: { authorization: 'Bearer any_token' },
      path: '/content'
    };
    await requireAuth(reqAdminUnavailable, makeRes() as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(resStatus, 503);
    assert.ok(resJson?.error?.includes('indisponível'));
  } finally {
    // Restaura
    firebaseAdminProvider.setAdminAuthForTesting(undefined);
  }
});

test('Auth: Login não promove consentimento legado; exigência de consentimento explícito para 2026.1', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_legacy_consent_user';
  const now = new Date().toISOString();

  // 1. Usuário existente no banco com versão de termos antiga (2025.1)
  await db.collection(COLLECTIONS.users).doc(userId).set({
    id: userId,
    email: 'legacy@empresa.com',
    name: 'Usuário Legado',
    role: 'user',
    createdAt: now,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: '2025.1',
    privacyVersion: '2025.1'
  });

  const mockToken = {
    uid: userId,
    email: 'legacy@empresa.com',
    email_verified: true,
    name: 'Usuário Legado'
  } as any;

  // 2. Usuário faz login comum (sync-profile sem flag de consentimento explícito)
  const profileAfterLogin = await ensureUserProfile(mockToken, {
    name: 'Usuário Legado Atualizado'
  });

  // As versões de consentimento continuam sendo as versões legadas antigas
  assert.equal(profileAfterLogin.termsVersion, '2025.1');
  assert.equal(profileAfterLogin.privacyVersion, '2025.1');
  assert.equal(hasAcceptedLatestTerms(profileAfterLogin), false);

  // 3. Usuário aceita explicitamente os novos Termos e Política (versão 2026.1)
  const profileAfterConsent = await ensureUserProfile(mockToken, {
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });

  assert.equal(profileAfterConsent.termsVersion, '2026.1');
  assert.equal(profileAfterConsent.privacyVersion, '2026.1');
  assert.equal(hasAcceptedLatestTerms(profileAfterConsent), true);
});

