import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthUrl, uploadTikTokDraftVideo, getTikTokUploadStatus } from '../server/production/social.js';
import { encrypt } from '../server/production/social.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';

test('TikTok OAuth: Escopos cirúrgicos aprovados para TikTok Developer Login Kit & Content Posting', async () => {
  resetMemoryDb();
  const oauth = await createOAuthUrl({
    provider: 'tiktok',
    userId: 'usr_test_tiktok_1',
    companyId: 'comp_test_tiktok_1'
  });

  assert.ok(oauth.url, 'URL de autorização deve ser gerada');
  const parsedUrl = new URL(oauth.url);
  assert.equal(parsedUrl.searchParams.get('client_key'), 'mock_tiktok_client_id');
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedUrl.searchParams.get('scope'), 'user.info.basic,video.upload');
  assert.ok(!parsedUrl.searchParams.get('scope')?.includes('video.publish'), 'video.publish NÃO deve estar presente');
});

test('TikTok Draft Upload: Bloqueio estrito quando não há conexão para a empresa', async () => {
  resetMemoryDb();
  const fakeVideo = Buffer.from('mock mp4 video content bytes for testing');

  await assert.rejects(
    async () => {
      await uploadTikTokDraftVideo({
        userId: 'usr_unconnected_1',
        companyId: 'comp_unconnected_1',
        videoBuffer: fakeVideo,
        videoSize: fakeVideo.length
      });
    },
    (err: any) => {
      return err.message.includes('Conta TikTok não conectada');
    }
  );
});

test('TikTok Draft Upload: Bloqueio estrito multi-tenant (conexão de outra empresa)', async () => {
  resetMemoryDb();
  const db = firestore();

  // Conexão criada para User A e Empresa A
  await db.collection(COLLECTIONS.socialConnections).doc('conn_tiktok_a').set({
    id: 'conn_tiktok_a',
    userId: 'usr_owner_a',
    companyId: 'comp_alpha',
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('tiktok_token_secret_123'),
    createdAt: new Date().toISOString()
  });

  const fakeVideo = Buffer.from('mock mp4 video bytes');

  // Tentativa por User B / Empresa B não pode usar a conexão de A
  await assert.rejects(
    async () => {
      await uploadTikTokDraftVideo({
        userId: 'usr_attacker_b',
        companyId: 'comp_beta',
        videoBuffer: fakeVideo,
        videoSize: fakeVideo.length
      });
    },
    (err: any) => {
      return err.message.includes('Conta TikTok não conectada');
    }
  );
});

test('TikTok Draft Upload: Tratamento de erro quando o TikTok rejeita a inicialização', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_owner_init_fail';
  const companyId = 'comp_init_fail';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_tiktok_fail').set({
    id: 'conn_tiktok_fail',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_fail_test'),
    createdAt: new Date().toISOString()
  });

  const originalFetch = globalThis.fetch;
  try {
    // Mock TikTok endpoint retornando erro
    globalThis.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/post/publish/inbox/video/init/')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              code: 'invalid_param',
              message: 'Invalid video chunk dimensions.'
            }
          })
        } as any;
      }
      return originalFetch(input);
    };

    const fakeVideo = Buffer.from('mock video bytes');
    await assert.rejects(
      async () => {
        await uploadTikTokDraftVideo({
          userId,
          companyId,
          videoBuffer: fakeVideo,
          videoSize: fakeVideo.length
        });
      },
      (err: any) => {
        return err.message.includes('Invalid video chunk dimensions') || err.message.includes('Falha ao inicializar rascunho');
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TikTok Draft Upload: Fluxo de sucesso completo com FILE_UPLOAD e upload binário (Inbox Draft)', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_tiktok_success';
  const companyId = 'comp_tiktok_success';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_tiktok_ok').set({
    id: 'conn_tiktok_ok',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('valid_tiktok_access_token_xyz'),
    createdAt: new Date().toISOString()
  });

  const originalFetch = globalThis.fetch;
  let initCalledWithToken = '';
  let putCalledWithBuffer = false;
  let statusFetchCalled = false;

  try {
    globalThis.fetch = async (input: any, init?: any) => {
      const urlStr = String(input);

      // 1. Init draft upload
      if (urlStr.includes('/post/publish/inbox/video/init/')) {
        initCalledWithToken = init?.headers?.['Authorization'] || '';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              publish_id: 'v_inbox_file_987654321',
              upload_url: 'https://open-upload.tiktokapis.com/video/upload/chunk_test_abc'
            },
            error: { code: 'ok', message: '' }
          })
        } as any;
      }

      // 2. Put binary chunk to upload_url
      if (urlStr.includes('open-upload.tiktokapis.com')) {
        putCalledWithBuffer = init?.method === 'PUT' && Buffer.isBuffer(init?.body);
        return {
          ok: true,
          status: 200,
          text: async () => 'OK'
        } as any;
      }

      // 3. Status check endpoint
      if (urlStr.includes('/post/publish/status/fetch/')) {
        statusFetchCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              status: 'SUCCESS'
            },
            error: { code: 'ok', message: '' }
          })
        } as any;
      }

      return originalFetch(input, init);
    };

    const fakeVideo = Buffer.from('valid mp4 simulated binary content');
    const result = await uploadTikTokDraftVideo({
      userId,
      companyId,
      videoBuffer: fakeVideo,
      videoSize: fakeVideo.length,
      title: 'Vídeo Institucional Froc'
    });

    assert.equal(result.success, true);
    assert.equal(result.publishId, 'v_inbox_file_987654321');
    assert.equal(result.status, 'draft_sent');
    assert.ok(result.message.includes('Rascunho enviado ao TikTok'));
    assert.equal(initCalledWithToken, 'Bearer valid_tiktok_access_token_xyz');
    assert.equal(putCalledWithBuffer, true);

    // Consulta de status
    const statusResult = await getTikTokUploadStatus({
      userId,
      companyId,
      publishId: result.publishId
    });

    assert.equal(statusResult.success, true);
    assert.equal(statusResult.status, 'SUCCESS');
    assert.equal(statusResult.isDraftDelivered, true);
    assert.ok(statusResult.message.includes('Rascunho disponível no TikTok'));
    assert.equal(statusFetchCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
