import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthUrl, handleOAuthCallback, resolveMetaAccount, sanitizeOAuthPublicError, selectFacebookPage, SocialProvider } from '../server/production/social.js';
import { resetMemoryDb, firestore, COLLECTIONS, stableId } from '../server/production/store.js';
import { config } from '../server/config/index.js';
import { router } from '../server/production/router.js';

test('1. Meta OAuth Facebook: Escopos cirúrgicos de Facebook Page (incluindo business_management)', async () => {
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

  // Endpoint base e versão v24.0
  assert.equal(parsedUrl.origin, 'https://www.facebook.com');
  assert.equal(parsedUrl.pathname, `/${config.social.meta.graphVersion}/dialog/oauth`);
  assert.equal(parsedUrl.searchParams.get('client_id'), config.social.meta.clientId);
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');

  // Callback URL exata
  const redirectUri = parsedUrl.searchParams.get('redirect_uri') || '';
  assert.equal(redirectUri, `${config.appUrl}/api/social/facebook/callback`);

  // Escopos estritos de Facebook
  const scopeStr = parsedUrl.searchParams.get('scope') || '';
  const scopes = scopeStr.split(',').map((s) => s.trim());

  assert.ok(scopes.includes('public_profile'), 'Deve conter public_profile');
  assert.ok(scopes.includes('pages_show_list'), 'Deve conter pages_show_list');
  assert.ok(scopes.includes('pages_read_engagement'), 'Deve conter pages_read_engagement');
  assert.ok(scopes.includes('pages_manage_posts'), 'Deve conter pages_manage_posts');
  assert.ok(scopes.includes('business_management'), 'Deve conter business_management');

  // NÃO pode conter escopos de Instagram
  assert.ok(!scopes.includes('instagram_basic'), 'NÃO deve conter instagram_basic');
  assert.ok(!scopes.includes('instagram_content_publish'), 'NÃO deve conter instagram_content_publish');

  // Validação do state gravado no Firestore
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

test('2. Meta OAuth Instagram: Escopos cirúrgicos de Instagram Professional (sem pages_manage_posts e sem business_management)', async () => {
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

  // Endpoint base e versão v24.0
  assert.equal(parsedUrl.origin, 'https://www.facebook.com');
  assert.equal(parsedUrl.pathname, `/${config.social.meta.graphVersion}/dialog/oauth`);
  assert.equal(parsedUrl.searchParams.get('client_id'), config.social.meta.clientId);
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');

  // Callback URL exata
  const redirectUri = parsedUrl.searchParams.get('redirect_uri') || '';
  assert.equal(redirectUri, `${config.appUrl}/api/social/instagram/callback`);

  // Escopos estritos de Instagram
  const scopeStr = parsedUrl.searchParams.get('scope') || '';
  const scopes = scopeStr.split(',').map((s) => s.trim());

  assert.ok(scopes.includes('public_profile'), 'Deve conter public_profile');
  assert.ok(scopes.includes('pages_show_list'), 'Deve conter pages_show_list para localizar a página vinculada');
  assert.ok(scopes.includes('pages_read_engagement'), 'Deve conter pages_read_engagement');
  assert.ok(scopes.includes('instagram_basic'), 'Deve conter instagram_basic');
  assert.ok(scopes.includes('instagram_content_publish'), 'Deve conter instagram_content_publish');

  // NÃO deve conter escopos desnecessários
  assert.ok(!scopes.includes('pages_manage_posts'), 'NÃO deve conter pages_manage_posts');
  assert.ok(!scopes.includes('business_management'), 'NÃO deve conter business_management');
});

test('2b. Meta OAuth Instagram: Descoberta de conta profissional via /me/accounts NÃO consulta /me/businesses nem depende de business_management', async () => {
  const originalFetch = globalThis.fetch;
  let businessesCalled = false;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'ig_user_token_mock', token_type: 'bearer' }), { status: 200 });
      }
      if (url.includes('/me/businesses')) {
        businessesCalled = true;
        return new Response(JSON.stringify({ error: { message: 'Permissions error #200', code: 200 } }), { status: 400 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'page_ig_host_101',
              name: 'Instagram Host Page',
              access_token: 'EAAB_page_token_for_ig',
              instagram_business_account: {
                id: 'ig_biz_account_777',
                username: 'minha_empresa_oficial',
                name: 'Minha Empresa Oficial'
              }
            }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const resolved = await resolveMetaAccount('instagram', 'short_ig_token');
    assert.equal(businessesCalled, false, 'Instagram NÃO deve consultar /me/businesses');
    assert.equal(resolved.id, 'ig_biz_account_777');
    assert.equal(resolved.name, 'minha_empresa_oficial');
    assert.equal(resolved.accessToken, 'EAAB_page_token_for_ig');
    assert.equal(resolved.pageId, 'page_ig_host_101');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('3. Facebook Page: Descoberta primária via /me/accounts com Page Access Token real e tarefas de publicação', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'long_lived_user_token_mock', token_type: 'bearer' }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'page_123456',
              name: 'Minha Empresa Facebook Page',
              access_token: 'EAAB_real_page_access_token_mock',
              tasks: ['CREATE_CONTENT', 'MANAGE', 'MESSAGING']
            }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const resolved = await resolveMetaAccount('facebook', 'short_user_token_mock');
    assert.equal(resolved.id, 'page_123456');
    assert.equal(resolved.name, 'Minha Empresa Facebook Page');
    assert.equal(resolved.accessToken, 'EAAB_real_page_access_token_mock');
    assert.equal(resolved.pageId, 'page_123456');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('4. Facebook Page: /me/accounts vazio chama /me/businesses e owned_pages retorna Página com token', async () => {
  const originalFetch = globalThis.fetch;
  let businessesCalled = false;
  let ownedPagesCalled = false;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'long_lived_user_token_mock' }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/businesses')) {
        businessesCalled = true;
        return new Response(JSON.stringify({
          data: [
            { id: 'biz_123', name: 'Portfólio Empresarial Alpha' }
          ]
        }), { status: 200 });
      }
      if (url.includes('/biz_123/owned_pages')) {
        ownedPagesCalled = true;
        return new Response(JSON.stringify({
          data: [
            {
              id: 'page_owned_789',
              name: 'Página Owned BM',
              access_token: 'EAAB_owned_page_token_real',
              tasks: ['MANAGE', 'CREATE_CONTENT']
            }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const resolved = await resolveMetaAccount('facebook', 'short_user_token_mock');
    assert.ok(businessesCalled, 'Deve ter consultado /me/businesses quando /me/accounts estava vazio');
    assert.ok(ownedPagesCalled, 'Deve ter consultado /biz_123/owned_pages');
    assert.equal(resolved.id, 'page_owned_789');
    assert.equal(resolved.name, 'Página Owned BM');
    assert.equal(resolved.accessToken, 'EAAB_owned_page_token_real');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('5. Facebook Page: Página não encontrada em owned_pages testa client_pages e conecta com token real', async () => {
  const originalFetch = globalThis.fetch;
  let clientPagesCalled = false;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'long_lived_user_token_mock' }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/businesses')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'biz_agency_456', name: 'Agência Digital BM' }
          ]
        }), { status: 200 });
      }
      if (url.includes('/biz_agency_456/owned_pages')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/biz_agency_456/client_pages')) {
        clientPagesCalled = true;
        return new Response(JSON.stringify({
          data: [
            {
              id: 'page_client_999',
              name: 'Página Cliente BM',
              access_token: 'EAAB_client_page_token_real',
              tasks: ['CREATE_CONTENT', 'MODERATE']
            }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const resolved = await resolveMetaAccount('facebook', 'short_user_token_mock');
    assert.ok(clientPagesCalled, 'Deve ter consultado client_pages quando owned_pages estava vazio');
    assert.equal(resolved.id, 'page_client_999');
    assert.equal(resolved.name, 'Página Cliente BM');
    assert.equal(resolved.accessToken, 'EAAB_client_page_token_real');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6. Facebook Page: Não depender de /me/assigned_pages e gerar diagnóstico seguro quando nenhuma Página for encontrada', async () => {
  const originalFetch = globalThis.fetch;
  let assignedPagesCalled = false;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'user_token' }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/businesses')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/assigned_pages')) {
        assignedPagesCalled = true;
        return new Response(JSON.stringify({ error: { message: 'Unknown path', code: 3 } }), { status: 400 });
      }
      if (url.includes('/me/permissions')) {
        return new Response(JSON.stringify({
          data: [
            { permission: 'public_profile', status: 'granted' },
            { permission: 'pages_show_list', status: 'granted' },
            { permission: 'pages_read_engagement', status: 'granted' },
            { permission: 'pages_manage_posts', status: 'declined' }, // NEGADA
            { permission: 'business_management', status: 'granted' }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    assert.equal(assignedPagesCalled, false, 'Não deve chamar /me/assigned_pages');

    await assert.rejects(
      async () => {
        await resolveMetaAccount('facebook', 'short_token');
      },
      /Permissão 'pages_manage_posts' não foi concedida na autorização da Meta/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('7. Sanitização de Erros: Nenhuma mensagem pública contém access_token, OAuth code ou secret', () => {
  // Erros com tokens ou secrets vazados
  const dirtyError = new Error('Graph API failure with access_token=EAAB123456789&client_secret=secret_xyz999&code=auth_code_secret');
  const safeMsg = sanitizeOAuthPublicError(dirtyError, 'facebook');

  assert.ok(!safeMsg.includes('EAAB123456789'), 'Não deve conter access_token');
  assert.ok(!safeMsg.includes('secret_xyz999'), 'Não deve conter client_secret');
  assert.ok(!safeMsg.includes('auth_code_secret'), 'Não deve conter oauth code');
  assert.equal(safeMsg, 'Não foi possível concluir a conexão com o Facebook.');

  // Erro amigável de permissão deve ser mantido
  const permError = new Error("Permissão 'pages_manage_posts' não foi concedida na autorização da Meta.");
  assert.equal(sanitizeOAuthPublicError(permError, 'facebook'), "Permissão 'pages_manage_posts' não foi concedida na autorização da Meta.");

  // Erro de cancelamento
  const cancelError = new Error('User access_denied');
  assert.equal(sanitizeOAuthPublicError(cancelError, 'facebook'), 'Autorização cancelada pelo usuário.');
});

test('8. Callback Social HTTP: Erro de autorização redireciona para /redes-sociais?error=... e NÃO gera JSON 500', async () => {
  resetMemoryDb();

  let redirectedUrl = '';
  let statusCode = 200;
  let jsonBody: any = null;

  const mockReq: any = {
    method: 'GET',
    params: { provider: 'facebook' },
    query: {
      code: 'mock_bad_code',
      state: 'non_existent_state'
    },
    headers: {}
  };

  const mockRes: any = {
    redirect(url: string) {
      redirectedUrl = url;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      jsonBody = data;
      return this;
    }
  };

  const callbackLayer = (router as any).stack.find((layer: any) =>
    layer.route && layer.route.path === '/social/:provider/callback'
  );
  assert.ok(callbackLayer, 'Rota /social/:provider/callback deve estar registrada');

  const handler = callbackLayer.route.stack[0].handle;
  await handler(mockReq, mockRes, () => {});

  assert.equal(statusCode, 200, 'Não deve setar status 500');
  assert.equal(jsonBody, null, 'Não deve retornar payload JSON');
  assert.ok(redirectedUrl.startsWith(`${config.appUrl}/redes-sociais?error=`), 'Deve redirecionar para a página com query param de erro');
  assert.ok(redirectedUrl.includes('Estado%20OAuth%20inv%C3%A1lido') || redirectedUrl.includes('inv%C3%A1lido'), 'Erro seguro deve estar codificado na URL');
});

test('9. Callback Social HTTP: Sucesso redireciona para /redes-sociais?connected=facebook&companyId=...', async () => {
  resetMemoryDb();
  const userId = 'usr_success_test';
  const companyId = 'comp_success_test';

  const oauth = await createOAuthUrl({
    provider: 'facebook',
    userId,
    companyId
  });
  const parsedUrl = new URL(oauth.url);
  const state = parsedUrl.searchParams.get('state')!;

  const originalFetch = globalThis.fetch;
  let redirectedUrl = '';

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'EAAB_user_token_valid', expires_in: 5184000 }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'page_valid_123',
              name: 'Página Sucesso',
              access_token: 'EAAB_page_token_valid',
              tasks: ['CREATE_CONTENT', 'MANAGE']
            }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const mockReq: any = {
      method: 'GET',
      params: { provider: 'facebook' },
      query: {
        code: 'valid_auth_code_123',
        state
      },
      headers: {}
    };

    const mockRes: any = {
      redirect(url: string) {
        redirectedUrl = url;
      },
      status() { return this; },
      json() { return this; }
    };

    const callbackLayer = (router as any).stack.find((layer: any) =>
      layer.route && layer.route.path === '/social/:provider/callback'
    );
    const handler = callbackLayer.route.stack[0].handle;
    await handler(mockReq, mockRes, () => {});

    assert.equal(
      redirectedUrl,
      `${config.appUrl}/redes-sociais?connected=facebook&companyId=${encodeURIComponent(companyId)}`,
      'Deve redirecionar para a URL com connected=facebook e companyId correto'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('10. OAuth State Management: Anti-replay, expiração e integridade de sessão', async () => {
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

test('11. OAuth Outros Provedores: LinkedIn, YouTube, TikTok, Pinterest e X permanecem inalterados', async () => {
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

test('12. Facebook Multi-Page: selectFacebookPage conecta a página escolhida e invalida o selectionToken', async () => {
  resetMemoryDb();
  const userId = 'usr_multi_page';
  const companyId = 'comp_multi_page';
  const selectionToken = 'sel_tok_abc123';

  // Grava pendência de seleção de múltiplas páginas
  await firestore().collection(COLLECTIONS.oauthStates).doc(stableId(selectionToken)).set({
    type: 'facebook_page_selection',
    userId,
    companyId,
    pages: [
      { id: 'page_1', name: 'Página Alpha', accessToken: 'EAAB_token_alpha' },
      { id: 'page_2', name: 'Página Beta', accessToken: 'EAAB_token_beta' }
    ],
    expiresAt: Date.now() + 10 * 60 * 1000,
    createdAt: new Date().toISOString()
  });

  // 1. Tenta conectar com usuário diferente (deve ser rejeitado)
  await assert.rejects(
    async () => {
      await selectFacebookPage({
        userId: 'usr_impostor',
        selectionToken,
        pageId: 'page_1'
      });
    },
    /Permissão negada/
  );

  // 2. Tenta conectar com pageId inexistente na lista (deve ser rejeitado)
  await assert.rejects(
    async () => {
      await selectFacebookPage({
        userId,
        selectionToken,
        pageId: 'page_inexistente'
      });
    },
    /Página não encontrada/
  );

  // 3. Conecta com a página correta
  const result = await selectFacebookPage({
    userId,
    selectionToken,
    pageId: 'page_2'
  });

  assert.equal(result.pageId, 'page_2');
  assert.equal(result.pageName, 'Página Beta');
  assert.equal(result.provider, 'facebook');

  // Verifica conexão no banco
  const connSnap = await firestore().collection(COLLECTIONS.socialConnections).doc(result.id).get();
  assert.ok(connSnap.exists);
  assert.equal(connSnap.data()?.accountId, 'page_2');
  assert.equal(connSnap.data()?.accountName, 'Página Beta');

  // 4. Token já consumido (anti-replay)
  await assert.rejects(
    async () => {
      await selectFacebookPage({
        userId,
        selectionToken,
        pageId: 'page_2'
      });
    },
    /inválido ou expirado/
  );
});

