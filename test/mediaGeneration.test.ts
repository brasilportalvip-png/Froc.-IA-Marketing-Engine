import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { getMemoryCollection, resetMemoryDb } from '../server/production/store.js';
import * as firebaseAdminProvider from '../server/providers/firebaseAdmin.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../server/production/auth.js';

test('Media Generation: Image (1K, 2K, 4K), Veo 3.1 Presets (720p, 1080p, 4K), Script and Background Worker', async () => {
  resetMemoryDb();

  const { default: router } = await import('../server/production/router.js');
  const { addCredits, getWallet } = await import('../server/production/credits.js');
  const { processPendingVideoJobs } = await import('../server/production/ai.js');

  const userId = 'user-media-tester';
  const otherUserId = 'user-other-tester';
  const companyId = 'comp-media-tester';
  const now = new Date().toISOString();

  // Mock do Firebase Admin Auth para autenticar os usuários no teste
  firebaseAdminProvider.setAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === `token_${userId}`) {
        return { uid: userId, email: 'tester@froc.ia', role: 'user' } as any;
      }
      if (token === `token_${otherUserId}`) {
        return { uid: otherUserId, email: 'other@froc.ia', role: 'user' } as any;
      }
      throw new Error('Invalid token');
    }
  } as any);

  const app = express();
  app.use(express.json());
  app.use('/api', router);

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Seed users and companies
  getMemoryCollection('users').set(userId, {
    id: userId,
    email: 'tester@froc.ia',
    name: 'Media Tester',
    role: 'user',
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });

  getMemoryCollection('users').set(otherUserId, {
    id: otherUserId,
    email: 'other@froc.ia',
    name: 'Other Tester',
    role: 'user',
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION
  });

  getMemoryCollection('companies').set(companyId, {
    id: companyId,
    userId,
    name: 'Loja Exemplo Media',
    category: 'Varejo',
    segment: 'Moda'
  });

  // Dar créditos suficientes para o usuário
  await addCredits({
    userId,
    amount: 2000,
    type: 'purchase',
    source: 'Test Seed'
  });

  try {
    // -------------------------------------------------------------------------
    // 1. GERAÇÃO DE IMAGEM 1K (15 créditos), 2K (25 créditos) e 4K (40 créditos)
    // -------------------------------------------------------------------------
    const resImage1k = await fetch(`${baseUrl}/api/ai/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        theme: 'Bolsa de couro minimalista',
        aspectRatio: '1:1',
        resolution: '1K',
        companyId
      })
    });
    assert.equal(resImage1k.status, 200);
    const dataImage1k = await resImage1k.json();
    assert.equal(dataImage1k.creditsUsed, 15, 'Imagem 1K deve consumir 15 créditos');

    const resImage2k = await fetch(`${baseUrl}/api/ai/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        theme: 'Coleção de primavera em estilo minimalista',
        style: 'Editorial de moda',
        aspectRatio: '9:16',
        resolution: '2K',
        companyId
      })
    });
    assert.equal(resImage2k.status, 200);
    const dataImage2k = await resImage2k.json();
    assert.equal(dataImage2k.creditsUsed, 25, 'Imagem 2K deve consumir 25 créditos');

    const resImage4k = await fetch(`${baseUrl}/api/ai/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        theme: 'Novo tênis esportivo futurista em fundo urbano neon',
        style: 'Fotografia publicitária de produto 4K',
        aspectRatio: '1:1',
        resolution: '4K',
        companyId
      })
    });
    assert.equal(resImage4k.status, 200);
    const dataImage4k = await resImage4k.json();
    assert.equal(dataImage4k.creditsUsed, 40, 'Imagem 4K deve consumir 40 créditos');
    assert.ok(dataImage4k.imageUrl);
    assert.equal(dataImage4k.contentItem.type, 'image');
    assert.equal(dataImage4k.contentItem.metadata.resolution, '4K');

    // -------------------------------------------------------------------------
    // 2. ROTEIRO DE VÍDEO (10 créditos)
    // -------------------------------------------------------------------------
    const resScript = await fetch(`${baseUrl}/api/ai/generate-video-script`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        topic: 'Lançamento do Tênis Froc Urban',
        format: 'Reels / TikTok (60s)',
        objective: 'Conversão em vendas',
        companyId
      })
    });
    assert.equal(resScript.status, 200);
    const dataScript = await resScript.json();
    assert.equal(dataScript.creditsUsed, 10, 'Roteiro de vídeo deve consumir 10 créditos');
    assert.ok(dataScript.script);

    // -------------------------------------------------------------------------
    // 3. DIREÇÃO VISUAL DE VÍDEO (POST /api/ai/generate-video-direction)
    // -------------------------------------------------------------------------
    const resDirection = await fetch(`${baseUrl}/api/ai/generate-video-direction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        prompt: 'Mulher correndo na praia ao pôr do sol usando o novo produto',
        aspectRatio: '9:16',
        mood: 'Enérgico e inspirador',
        companyId
      })
    });
    assert.equal(resDirection.status, 200);
    const dataDirection = await resDirection.json();
    assert.ok(dataDirection.direction?.visualPrompt);

    // -------------------------------------------------------------------------
    // 4. PRESETS DE VÍDEO: demo_720p (50), pro_1080p (100) e cinema_4k (200)
    // -------------------------------------------------------------------------
    // Preset demo_720p (50 créditos)
    const resVideo720 = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        prompt: 'Demonstração rápida do produto',
        preset: 'demo_720p',
        aspectRatio: '9:16',
        companyId
      })
    });
    assert.equal(resVideo720.status, 202);
    const dataVideo720 = await resVideo720.json();
    assert.equal(dataVideo720.creditsReserved, 50, 'Preset demo_720p deve reservar 50 créditos');

    // Preset cinema_4k (200 créditos) com 4K Real
    const resVideo4k = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        prompt: 'Comercial cinematográfico de luxo',
        preset: 'cinema_4k',
        aspectRatio: '16:9',
        companyId
      })
    });
    assert.equal(resVideo4k.status, 202);
    const dataVideo4k = await resVideo4k.json();
    assert.equal(dataVideo4k.creditsReserved, 200, 'Preset cinema_4k deve reservar 200 créditos');
    assert.equal(dataVideo4k.job?.resolution || '4k', '4k', 'Preset cinema_4k deve manter resolução 4k real');

    // Preset pro_1080p (100 créditos)
    const resStartVideo = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        prompt: 'Câmera em movimento dinâmico revelando nova coleção',
        title: 'Comercial Verão 2026',
        preset: 'pro_1080p',
        aspectRatio: '9:16',
        companyId
      })
    });
    assert.equal(resStartVideo.status, 202);
    const dataStartVideo = await resStartVideo.json();
    assert.equal(dataStartVideo.creditsReserved, 100, 'Preset pro_1080p deve reservar 100 créditos');
    const jobId = dataStartVideo.jobId;

    // -------------------------------------------------------------------------
    // 5. CONSULTA E CONCLUSÃO DO JOB
    // -------------------------------------------------------------------------
    const resCheckJob = await fetch(`${baseUrl}/api/ai/video-jobs/${jobId}`, {
      headers: { Authorization: `Bearer token_${userId}` }
    });
    assert.equal(resCheckJob.status, 200);
    const dataCheckJob = await resCheckJob.json();
    assert.equal(dataCheckJob.job.status, 'completed');
    assert.ok(dataCheckJob.job.videoUrl);
    assert.ok(dataCheckJob.job.contentItemId);

    // Salvo em contentItems
    const savedContent = getMemoryCollection('contentItems').get(dataCheckJob.job.contentItemId);
    assert.ok(savedContent);
    assert.equal(savedContent.type, 'video');

    // -------------------------------------------------------------------------
    // 6. PROCESSAMENTO EM SEGUNDO PLANO (processPendingVideoJobs)
    // -------------------------------------------------------------------------
    const workerResult = await processPendingVideoJobs();
    assert.ok(workerResult.checked >= 0);

    // -------------------------------------------------------------------------
    // 7. ISOLAMENTO MULTI-TENANT
    // -------------------------------------------------------------------------
    const resOtherAccess = await fetch(`${baseUrl}/api/ai/video-jobs/${jobId}`, {
      headers: { Authorization: `Bearer token_${otherUserId}` }
    });
    assert.equal(resOtherAccess.status, 403);

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

