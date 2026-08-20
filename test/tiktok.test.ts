import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOAuthUrl,
  uploadTikTokDraftVideo,
  getTikTokUploadStatus,
  MAX_TIKTOK_SANDBOX_VIDEO_SIZE,
  isValidMp4Buffer,
  encrypt
} from '../server/production/social.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';

// Helper para gerar um buffer binário com assinatura ISO MP4 ftyp válida
function createMockMp4Buffer(byteLength = 1024): Buffer {
  const buf = Buffer.alloc(byteLength);
  // Box length (32-bit big endian: 24 bytes header)
  buf.writeUInt32BE(24, 0);
  // 'ftyp'
  buf.write('ftyp', 4, 4, 'ascii');
  // Major brand: 'isom'
  buf.write('isom', 8, 4, 'ascii');
  // Minor version: 512
  buf.writeUInt32BE(512, 12);
  // Compatible brands: 'isom', 'mp42'
  buf.write('isom', 16, 4, 'ascii');
  buf.write('mp42', 20, 4, 'ascii');
  return buf;
}

// ==========================================
// 1. OAUTH TESTS
// ==========================================
test('TikTok OAuth: Escopos cirúrgicos aprovados (user.info.basic, video.upload; sem video.publish)', async () => {
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
  const scope = parsedUrl.searchParams.get('scope') || '';
  assert.ok(scope.includes('user.info.basic'), 'scope deve conter user.info.basic');
  assert.ok(scope.includes('video.upload'), 'scope deve conter video.upload');
  assert.ok(!scope.includes('video.publish'), 'scope NÃO deve conter video.publish');
});

// ==========================================
// 2. MP4 VALIDATION TESTS
// ==========================================
test('TikTok MP4 Validation: Validação de container e assinatura ftyp', () => {
  const validMp4 = createMockMp4Buffer(512);
  assert.equal(isValidMp4Buffer(validMp4), true, 'Buffer com assinatura ftyp deve ser reconhecido como MP4 válido');

  const webmHeader = Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81]); // EBML / WebM
  assert.equal(isValidMp4Buffer(webmHeader), false, 'WebM deve ser rejeitado');

  const arbitraryBytes = Buffer.from('quicktime video or plain text simulated content');
  assert.equal(isValidMp4Buffer(arbitraryBytes), false, 'Conteúdo sem ftyp deve ser rejeitado');

  assert.equal(isValidMp4Buffer(Buffer.alloc(4)), false, 'Buffer < 8 bytes deve ser rejeitado');
});

// ==========================================
// 3. UPLOAD LIMITS & FORMAT TESTS
// ==========================================
test('TikTok Draft Upload: Arquivo > 4 MiB é bloqueado com erro específico', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_size_test';
  const companyId = 'comp_size_test';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_size').set({
    id: 'conn_size',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_size_test'),
    createdAt: new Date().toISOString()
  });

  const oversizedBuffer = createMockMp4Buffer(MAX_TIKTOK_SANDBOX_VIDEO_SIZE + 1024);

  await assert.rejects(
    async () => {
      await uploadTikTokDraftVideo({
        userId,
        companyId,
        videoBuffer: oversizedBuffer,
        videoSize: oversizedBuffer.length
      });
    },
    (err: any) => {
      return err.message.includes('O vídeo excede o limite de 4 MB desta fase de verificação do TikTok.');
    }
  );
});

test('TikTok Draft Upload: Arquivo não-MP4 (ex: WebM) é rejeitado pelo backend', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_format_test';
  const companyId = 'comp_format_test';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_fmt').set({
    id: 'conn_fmt',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_fmt_test'),
    createdAt: new Date().toISOString()
  });

  const webmBuffer = Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x00, 0x00]);

  await assert.rejects(
    async () => {
      await uploadTikTokDraftVideo({
        userId,
        companyId,
        videoBuffer: webmBuffer,
        videoSize: webmBuffer.length
      });
    },
    (err: any) => {
      return err.message.includes('Apenas containers MP4 autênticos');
    }
  );
});

// ==========================================
// 4. MULTI-TENANT ACCESS CONTROL TESTS
// ==========================================
test('TikTok Draft Upload: Bloqueio estrito quando não há conexão para a empresa', async () => {
  resetMemoryDb();
  const validVideo = createMockMp4Buffer(2048);

  await assert.rejects(
    async () => {
      await uploadTikTokDraftVideo({
        userId: 'usr_unconnected_1',
        companyId: 'comp_unconnected_1',
        videoBuffer: validVideo,
        videoSize: validVideo.length
      });
    },
    (err: any) => {
      return err.message.includes('Conta TikTok não conectada');
    }
  );
});

test('TikTok Draft Upload: Bloqueio estrito multi-tenant (conexão de outro usuário/empresa)', async () => {
  resetMemoryDb();
  const db = firestore();

  await db.collection(COLLECTIONS.socialConnections).doc('conn_tiktok_a').set({
    id: 'conn_tiktok_a',
    userId: 'usr_owner_a',
    companyId: 'comp_alpha',
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('tiktok_token_secret_123'),
    createdAt: new Date().toISOString()
  });

  const validVideo = createMockMp4Buffer(2048);

  await assert.rejects(
    async () => {
      await uploadTikTokDraftVideo({
        userId: 'usr_attacker_b',
        companyId: 'comp_beta',
        videoBuffer: validVideo,
        videoSize: validVideo.length
      });
    },
    (err: any) => {
      return err.message.includes('Conta TikTok não conectada');
    }
  );
});

// ==========================================
// 5. PROTOCOL COMPLIANCE & BINARY PUT (HTTP 201)
// ==========================================
test('TikTok Draft Upload: Protocolo FILE_UPLOAD, Content-Length, Content-Range e HTTP 201', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_tiktok_protocol';
  const companyId = 'comp_tiktok_protocol';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_tiktok_proto').set({
    id: 'conn_tiktok_proto',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_protocol_xyz'),
    createdAt: new Date().toISOString()
  });

  const originalFetch = globalThis.fetch;
  let initBodyCaptured: any = null;
  let putHeadersCaptured: any = null;
  let putBodyCaptured: any = null;

  try {
    globalThis.fetch = async (input: any, init?: any) => {
      const urlStr = String(input);

      // 1. Init endpoint
      if (urlStr.includes('/post/publish/inbox/video/init/')) {
        initBodyCaptured = JSON.parse(init?.body || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              publish_id: 'v_pub_proto_123',
              upload_url: 'https://open-upload.tiktokapis.com/video/upload/proto_chunk'
            },
            error: { code: 'ok', message: '' }
          })
        } as any;
      }

      // 2. Binary PUT endpoint (deve retornar HTTP 201 no protocolo TikTok)
      if (urlStr.includes('open-upload.tiktokapis.com')) {
        putHeadersCaptured = init?.headers;
        putBodyCaptured = init?.body;
        return {
          ok: true,
          status: 201,
          text: async () => ''
        } as any;
      }

      return originalFetch(input, init);
    };

    const validVideo = createMockMp4Buffer(4096);
    const result = await uploadTikTokDraftVideo({
      userId,
      companyId,
      videoBuffer: validVideo,
      videoSize: validVideo.length,
      title: 'Vídeo Institucional'
    });

    assert.equal(result.success, true);
    assert.equal(result.publishId, 'v_pub_proto_123');
    assert.equal(result.status, 'draft_sent');
    assert.ok(result.message.includes('Rascunho enviado ao TikTok'));
    assert.ok(!JSON.stringify(result).includes('token_protocol_xyz'), 'Token nunca deve ser retornado na resposta');

    // Validação da requisição init
    assert.equal(initBodyCaptured?.source_info?.source, 'FILE_UPLOAD');
    assert.equal(initBodyCaptured?.source_info?.video_size, 4096);
    assert.equal(initBodyCaptured?.source_info?.chunk_size, 4096);
    assert.equal(initBodyCaptured?.source_info?.total_chunk_count, 1);

    // Validação do PUT
    assert.equal(putHeadersCaptured?.['Content-Type'], 'video/mp4');
    assert.equal(putHeadersCaptured?.['Content-Length'], '4096');
    assert.equal(putHeadersCaptured?.['Content-Range'], 'bytes 0-4095/4096');
    assert.ok(Buffer.isBuffer(putBodyCaptured));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ==========================================
// 6. REAL ENUM STATUS HANDLING TESTS (NO "SUCCESS" ENUM)
// ==========================================
test('TikTok Status: PROCESSING_UPLOAD indica processamento em andamento', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_st_proc';
  const companyId = 'comp_st_proc';
  const publishId = 'pub_st_proc';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_proc').set({
    id: 'conn_proc',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_st_1'),
    createdAt: new Date().toISOString()
  });

  // Salvar registro de draft para isolamento multi-tenant
  const { stableId } = await import('../server/production/store.js');
  const draftId = stableId(`${userId}:${companyId}:${publishId}`);
  await db.collection('socialDraftUploads').doc(draftId).set({
    id: draftId,
    userId,
    companyId,
    provider: 'tiktok',
    publishId,
    status: 'draft_sent',
    createdAt: new Date().toISOString()
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/post/publish/status/fetch/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { status: 'PROCESSING_UPLOAD' },
            error: { code: 'ok' }
          })
        } as any;
      }
      return originalFetch(input);
    };

    const status = await getTikTokUploadStatus({ userId, companyId, publishId });
    assert.equal(status.status, 'PROCESSING_UPLOAD');
    assert.equal(status.isDraftDelivered, false);
    assert.ok(status.message.includes('processando o arquivo'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TikTok Status: SEND_TO_USER_INBOX indica rascunho entregue com sucesso', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_st_inbox';
  const companyId = 'comp_st_inbox';
  const publishId = 'pub_st_inbox';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_inbox').set({
    id: 'conn_inbox',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_st_2'),
    createdAt: new Date().toISOString()
  });

  const { stableId } = await import('../server/production/store.js');
  const draftId = stableId(`${userId}:${companyId}:${publishId}`);
  await db.collection('socialDraftUploads').doc(draftId).set({
    id: draftId,
    userId,
    companyId,
    provider: 'tiktok',
    publishId,
    status: 'draft_sent',
    createdAt: new Date().toISOString()
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/post/publish/status/fetch/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { status: 'SEND_TO_USER_INBOX' },
            error: { code: 'ok' }
          })
        } as any;
      }
      return originalFetch(input);
    };

    const status = await getTikTokUploadStatus({ userId, companyId, publishId });
    assert.equal(status.status, 'SEND_TO_USER_INBOX');
    assert.equal(status.isDraftDelivered, true);
    assert.ok(status.message.includes('Rascunho entregue ao TikTok'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TikTok Status: PUBLISH_COMPLETE indica conclusão pelo usuário dentro do app TikTok', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_st_complete';
  const companyId = 'comp_st_complete';
  const publishId = 'pub_st_complete';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_complete').set({
    id: 'conn_complete',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_st_3'),
    createdAt: new Date().toISOString()
  });

  const { stableId } = await import('../server/production/store.js');
  const draftId = stableId(`${userId}:${companyId}:${publishId}`);
  await db.collection('socialDraftUploads').doc(draftId).set({
    id: draftId,
    userId,
    companyId,
    provider: 'tiktok',
    publishId,
    status: 'draft_sent',
    createdAt: new Date().toISOString()
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/post/publish/status/fetch/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { status: 'PUBLISH_COMPLETE' },
            error: { code: 'ok' }
          })
        } as any;
      }
      return originalFetch(input);
    };

    const status = await getTikTokUploadStatus({ userId, companyId, publishId });
    assert.equal(status.status, 'PUBLISH_COMPLETE');
    assert.equal(status.isDraftDelivered, true);
    assert.ok(status.message.includes('publicado após a continuidade do fluxo pelo usuário no aplicativo TikTok'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TikTok Status: FAILED retorna mensagem de erro com fail_reason sanitizado', async () => {
  resetMemoryDb();
  const db = firestore();
  const userId = 'usr_st_fail';
  const companyId = 'comp_st_fail';
  const publishId = 'pub_st_fail';

  await db.collection(COLLECTIONS.socialConnections).doc('conn_failed').set({
    id: 'conn_failed',
    userId,
    companyId,
    provider: 'tiktok',
    status: 'connected',
    encryptedAccessToken: encrypt('token_st_4'),
    createdAt: new Date().toISOString()
  });

  const { stableId } = await import('../server/production/store.js');
  const draftId = stableId(`${userId}:${companyId}:${publishId}`);
  await db.collection('socialDraftUploads').doc(draftId).set({
    id: draftId,
    userId,
    companyId,
    provider: 'tiktok',
    publishId,
    status: 'draft_sent',
    createdAt: new Date().toISOString()
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: any) => {
      const urlStr = String(input);
      if (urlStr.includes('/post/publish/status/fetch/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              status: 'FAILED',
              fail_reason: 'video_dimension_not_supported'
            },
            error: { code: 'ok' }
          })
        } as any;
      }
      return originalFetch(input);
    };

    const status = await getTikTokUploadStatus({ userId, companyId, publishId });
    assert.equal(status.status, 'FAILED');
    assert.equal(status.isDraftDelivered, false);
    assert.equal(status.failReason, 'video_dimension_not_supported');
    assert.ok(status.message.includes('video_dimension_not_supported'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('TikTok Status: publishId de outro usuário/empresa é estritamente bloqueado', async () => {
  resetMemoryDb();
  const db = firestore();
  const { stableId } = await import('../server/production/store.js');

  // Draft criado pelo Usuário Legítimo A
  const draftIdA = stableId('usr_legit_a:comp_legit_a:pub_secret_999');
  await db.collection('socialDraftUploads').doc(draftIdA).set({
    id: draftIdA,
    userId: 'usr_legit_a',
    companyId: 'comp_legit_a',
    provider: 'tiktok',
    publishId: 'pub_secret_999',
    status: 'draft_sent',
    createdAt: new Date().toISOString()
  });

  // Atacante B tenta consultar pub_secret_999
  await assert.rejects(
    async () => {
      await getTikTokUploadStatus({
        userId: 'usr_attacker_b',
        companyId: 'comp_attacker_b',
        publishId: 'pub_secret_999'
      });
    },
    (err: any) => {
      return err.message.includes('Envio de rascunho não encontrado ou não pertence a esta empresa.');
    }
  );
});
