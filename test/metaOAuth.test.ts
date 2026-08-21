import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthUrl, handleOAuthCallback, resolveMetaAccount, SocialProvider } from '../server/production/social.js';
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

test('3. Facebook Page: Descoberta primária via /me/accounts com Page Access Token e tarefas de publicação', async () => {
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

test('4. Facebook Page: Fallback para Business Manager (/me/assigned_pages) quando /me/accounts está vazio', async () => {
  const originalFetch = globalThis.fetch;
  let assignedPagesCalled = false;
  let pageNodeCalled = false;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'long_lived_user_token_mock' }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        // /me/accounts vazio (Página gerenciada via Portfólio Empresarial)
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/assigned_pages')) {
        assignedPagesCalled = true;
        return new Response(JSON.stringify({
          data: [
            {
              id: 'bm_assigned_page_999',
              name: 'Página Portfólio Empresarial',
              tasks: ['MANAGE', 'CREATE_CONTENT']
            }
          ]
        }), { status: 200 });
      }
      if (url.includes('/bm_assigned_page_999')) {
        pageNodeCalled = true;
        return new Response(JSON.stringify({
          id: 'bm_assigned_page_999',
          name: 'Página Portfólio Empresarial',
          access_token: 'EAAB_bm_page_access_token_mock',
          tasks: ['MANAGE', 'CREATE_CONTENT']
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    const resolved = await resolveMetaAccount('facebook', 'short_user_token_mock');
    assert.ok(assignedPagesCalled, 'Deve ter chamado /me/assigned_pages como fallback');
    assert.ok(pageNodeCalled, 'Deve ter consultado o nó da página para obter o Page Access Token');
    assert.equal(resolved.id, 'bm_assigned_page_999');
    assert.equal(resolved.name, 'Página Portfólio Empresarial');
    assert.equal(resolved.accessToken, 'EAAB_bm_page_access_token_mock');
    assert.equal(resolved.pageId, 'bm_assigned_page_999');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('5. Facebook Page: Rejeição quando Página não tem capacidade de publicação', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'long_lived_token' }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'page_readonly',
              name: 'Página Somente Analítica',
              access_token: 'token_readonly',
              tasks: ['ANALYZE'] // Sem permissão de postar/criar conteúdo
            }
          ]
        }), { status: 200 });
      }
      if (url.includes('/me/assigned_pages')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/permissions')) {
        return new Response(JSON.stringify({
          data: [
            { permission: 'public_profile', status: 'granted' },
            { permission: 'pages_show_list', status: 'granted' },
            { permission: 'pages_read_engagement', status: 'granted' },
            { permission: 'pages_manage_posts', status: 'granted' },
            { permission: 'business_management', status: 'granted' }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await resolveMetaAccount('facebook', 'short_token');
      },
      /A Página do Facebook encontrada não possui permissão de criação\/publicação de conteúdo/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6. Facebook Page: Diagnóstico seguro quando permissão essencial (ex: pages_manage_posts) é negada', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'user_token' }), { status: 200 });
      }
      if (url.includes('/me/accounts')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/assigned_pages')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
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

test('7. Callback Social HTTP: Erro esperado de OAuth redireciona para /redes-sociais?error=... e NÃO gera JSON 500', async () => {
  resetMemoryDb();

  // Simular requisição ao Express mockando req/res
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

  // Localizar a rota /social/:provider/callback
  const callbackLayer = (router as any).stack.find((layer: any) =>
    layer.route && layer.route.path === '/social/:provider/callback'
  );
  assert.ok(callbackLayer, 'Rota /social/:provider/callback deve estar registrada');

  const handler = callbackLayer.route.stack[0].handle;
  await handler(mockReq, mockRes, () => {});

  assert.equal(statusCode, 200, 'Não deve setar status 500');
  assert.equal(jsonBody, null, 'Não deve retornar payload JSON');
  assert.ok(redirectedUrl.startsWith(`${config.appUrl}/redes-sociais?error=`), 'Deve redirecionar para a página com query param de erro');
  assert.ok(redirectedUrl.includes('Estado%20OAuth%20inv%C3%A1lido') || redirectedUrl.includes('inv%C3%A1lido'), 'Erro deve estar codificado na URL de redirecionamento');
});

test('8. Callback Social HTTP: Sucesso redireciona para /redes-sociais?connected=facebook&companyId=...', async () => {
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

test('9. OAuth State Management: Anti-replay, expiração e integridade de sessão', async () => {
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

test('10. OAuth Outros Provedores: LinkedIn, YouTube, TikTok, Pinterest e X permanecem inalterados', async () => {
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
