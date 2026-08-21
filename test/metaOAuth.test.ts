import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthUrl, handleOAuthCallback, SocialProvider } from '../server/production/social.js';
import { resetMemoryDb, firestore, COLLECTIONS, stableId } from '../server/production/store.js';
import { config } from '../server/config/index.js';

test('Meta OAuth Facebook: Escopos cirúrgicos de Facebook Page (sem escopos Instagram)', async () => {
  resetMemoryDb();
  const userId = 'usr_fb_test_1';
  const companyId = 'comp_fb_test_1';

  const oauth = await createOAuthUrl({
    provider: 'facebook',
    userId,
    companyId
  });

  assert.ok(oauth.url, 'URL de autorização do Facebook deve ser gerada');
  const parsedUrl = new URL(oauth.url);

  // 1. Endpoint base e versão v24.0
  assert.equal(parsedUrl.origin, 'https://www.facebook.com');
  assert.equal(parsedUrl.pathname, `/${config.social.meta.graphVersion}/dialog/oauth`);
  assert.equal(parsedUrl.searchParams.get('client_id'), config.social.meta.clientId);
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');

  // 2. Callback URL exata
  const redirectUri = parsedUrl.searchParams.get('redirect_uri') || '';
  assert.equal(redirectUri, `${config.appUrl}/api/social/facebook/callback`);

  // 3. Escopos estritos de Facebook
  const scopeStr = parsedUrl.searchParams.get('scope') || '';
  const scopes = scopeStr.split(',').map((s) => s.trim());

  assert.ok(scopes.includes('public_profile'), 'Deve conter public_profile');
  assert.ok(scopes.includes('pages_show_list'), 'Deve conter pages_show_list');
  assert.ok(scopes.includes('pages_read_engagement'), 'Deve conter pages_read_engagement');
  assert.ok(scopes.includes('pages_manage_posts'), 'Deve conter pages_manage_posts');

  // 4. NÃO pode conter escopos de Instagram
  assert.ok(!scopes.includes('instagram_basic'), 'NÃO deve conter instagram_basic');
  assert.ok(!scopes.includes('instagram_content_publish'), 'NÃO deve conter instagram_content_publish');

  // 5. Validação do state gravado no Firestore
  const state = parsedUrl.searchParams.get('state');
  assert.ok(state, 'Parâmetro state deve estar presente na URL');

  const stateDoc = await firestore().collection(COLLECTIONS.oauthStates).doc(stableId(state!)).get();
  assert.ok(stateDoc.exists, 'Documento de state OAuth deve existir no banco');
  const stateData = stateDoc.data();
  assert.equal(stateData?.provider, 'facebook');
  assert.equal(stateData?.userId, userId);
  assert.equal(stateData?.companyId, companyId);
  assert.ok(stateData?.expiresAt > Date.now(), 'State deve ter validade futura');
});

test('Meta OAuth Instagram: Escopos cirúrgicos de Instagram Professional (sem pages_manage_posts)', async () => {
  resetMemoryDb();
  const userId = 'usr_ig_test_1';
  const companyId = 'comp_ig_test_1';

  const oauth = await createOAuthUrl({
    provider: 'instagram',
    userId,
    companyId
  });

  assert.ok(oauth.url, 'URL de autorização do Instagram deve ser gerada');
  const parsedUrl = new URL(oauth.url);

  // 1. Endpoint base e versão v24.0
  assert.equal(parsedUrl.origin, 'https://www.facebook.com');
  assert.equal(parsedUrl.pathname, `/${config.social.meta.graphVersion}/dialog/oauth`);
  assert.equal(parsedUrl.searchParams.get('client_id'), config.social.meta.clientId);
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');

  // 2. Callback URL exata
  const redirectUri = parsedUrl.searchParams.get('redirect_uri') || '';
  assert.equal(redirectUri, `${config.appUrl}/api/social/instagram/callback`);

  // 3. Escopos estritos de Instagram
  const scopeStr = parsedUrl.searchParams.get('scope') || '';
  const scopes = scopeStr.split(',').map((s) => s.trim());

  assert.ok(scopes.includes('public_profile'), 'Deve conter public_profile');
  assert.ok(scopes.includes('pages_show_list'), 'Deve conter pages_show_list para localizar a página vinculada');
  assert.ok(scopes.includes('pages_read_engagement'), 'Deve conter pages_read_engagement');
  assert.ok(scopes.includes('instagram_basic'), 'Deve conter instagram_basic');
  assert.ok(scopes.includes('instagram_content_publish'), 'Deve conter instagram_content_publish');

  // 4. NÃO deve conter escopos desnecessários de gerenciamento de posts do Facebook
  assert.ok(!scopes.includes('pages_manage_posts'), 'NÃO deve conter pages_manage_posts');
});

test('OAuth State Management: Anti-replay, expiração e integridade de sessão', async () => {
  resetMemoryDb();
  const userId = 'usr_state_test';
  const companyId = 'comp_state_test';

  const oauth = await createOAuthUrl({
    provider: 'facebook',
    userId,
    companyId
  });

  const parsedUrl = new URL(oauth.url);
  const state = parsedUrl.searchParams.get('state')!;
  const stateDocRef = firestore().collection(COLLECTIONS.oauthStates).doc(stableId(state));

  // 1. Simular expiração do state
  await stateDocRef.update({
    expiresAt: Date.now() - 1000
  });

  await assert.rejects(
    async () => {
      await handleOAuthCallback({
        provider: 'facebook',
        code: 'mock_code',
        state
      });
    },
    /Sessão OAuth expirada ou incompatível/
  );

  // 2. State reutilizado ou inexistente deve ser rejeitado (anti-replay)
  await assert.rejects(
    async () => {
      await handleOAuthCallback({
        provider: 'facebook',
        code: 'mock_code',
        state: 'invalid_or_used_state'
      });
    },
    /Estado OAuth inválido ou já utilizado/
  );
});

test('OAuth Outros Provedores: LinkedIn, YouTube, TikTok, Pinterest e X permanecem inalterados', async () => {
  resetMemoryDb();
  const userId = 'usr_other_test';
  const companyId = 'comp_other_test';

  const providers: SocialProvider[] = ['linkedin', 'youtube', 'tiktok', 'pinterest', 'x'];

  for (const provider of providers) {
    const oauth = await createOAuthUrl({
      provider,
      userId,
      companyId
    });

    assert.ok(oauth.url, `URL de autorização de ${provider} deve ser gerada`);
    const parsedUrl = new URL(oauth.url);
    const redirectUri = parsedUrl.searchParams.get('redirect_uri') || '';
    assert.equal(redirectUri, `${config.appUrl}/api/social/${provider}/callback`, `Callback de ${provider} deve manter rota padrão`);
  }
});
