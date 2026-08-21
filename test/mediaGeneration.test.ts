import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { getMemoryCollection, resetMemoryDb } from '../server/production/store.js';
import * as firebaseAdminProvider from '../server/providers/firebaseAdmin.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../server/production/auth.js';

test('Media Generation: Image 1K, 2K, 4K resolution and Veo 3.1 Async Video Workflow', async () => {
  resetMemoryDb();

  const { default: router } = await import('../server/production/router.js');
  const { addCredits } = await import('../server/production/credits.js');

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
    amount: 1000,
    type: 'purchase',
    source: 'Test Seed'
  });

  try {
    // -------------------------------------------------------------------------
    // 1. GERAÇÃO DE IMAGEM 4K (40 créditos)
    // -------------------------------------------------------------------------
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

    assert.equal(resImage4k.status, 200, 'Geração de imagem 4K deve retornar HTTP 200');
    const dataImage4k = await resImage4k.json();
    assert.equal(dataImage4k.creditsUsed, 40, 'Imagem 4K deve consumir 40 créditos');
    assert.ok(dataImage4k.imageUrl, 'Deve retornar imageUrl');
    assert.equal(dataImage4k.contentItem.type, 'image');
    assert.equal(dataImage4k.contentItem.metadata.resolution, '4K');

    // -------------------------------------------------------------------------
    // 2. GERAÇÃO DE IMAGEM 2K (25 créditos)
    // -------------------------------------------------------------------------
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

    assert.equal(resImage2k.status, 200, 'Geração de imagem 2K deve retornar HTTP 200');
    const dataImage2k = await resImage2k.json();
    assert.equal(dataImage2k.creditsUsed, 25, 'Imagem 2K deve consumir 25 créditos');

    // -------------------------------------------------------------------------
    // 3. INICIAR GERAÇÃO DE VÍDEO ASSÍNCRONO COM VEO 3.1 (HTTP 202)
    // -------------------------------------------------------------------------
    const resStartVideo = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer token_${userId}`
      },
      body: JSON.stringify({
        prompt: 'Câmera em movimento dinâmico revelando nova coleção com iluminação cinematográfica',
        title: 'Comercial Verão 2026',
        preset: 'pro_1080p',
        aspectRatio: '9:16',
        cameraMotion: 'Pan suave com aproximação dinâmica',
        lighting: 'Golden hour com reflexos naturais',
        mood: 'Elegante e inspirador',
        companyId
      })
    });

    assert.equal(resStartVideo.status, 202, 'Início de vídeo deve retornar HTTP 202 Accepted');
    const dataStartVideo = await resStartVideo.json();
    assert.ok(dataStartVideo.jobId, 'Deve retornar jobId');
    assert.equal(dataStartVideo.creditsReserved, 100, 'Preset pro_1080p deve reservar 100 créditos');
    assert.equal(dataStartVideo.status, 'processing');

    const jobId = dataStartVideo.jobId;

    // -------------------------------------------------------------------------
    // 4. CONSULTA E CONCLUSÃO DO JOB DE VÍDEO
    // -------------------------------------------------------------------------
    const resCheckJob = await fetch(`${baseUrl}/api/ai/video-jobs/${jobId}`, {
      headers: { Authorization: `Bearer token_${userId}` }
    });

    assert.equal(resCheckJob.status, 200, 'Checagem do job deve retornar HTTP 200');
    const dataCheckJob = await resCheckJob.json();
    assert.equal(dataCheckJob.job.status, 'completed', 'Job em ambiente de teste deve ser concluído');
    assert.ok(dataCheckJob.job.videoUrl, 'Job concluído deve conter videoUrl');
    assert.ok(dataCheckJob.job.contentItemId, 'Job concluído deve vincular contentItemId');

    // Verificar se o item foi gravado na biblioteca de conteúdos
    const savedContent = getMemoryCollection('contentItems').get(dataCheckJob.job.contentItemId);
    assert.ok(savedContent, 'O vídeo gerado deve ser salvo em contentItems');
    assert.equal(savedContent.type, 'video');
    assert.equal(savedContent.videoUrl, dataCheckJob.job.videoUrl);

    // -------------------------------------------------------------------------
    // 5. LISTAGEM DE JOBS DE VÍDEO DO USUÁRIO
    // -------------------------------------------------------------------------
    const resListJobs = await fetch(`${baseUrl}/api/ai/video-jobs?companyId=${companyId}`, {
      headers: { Authorization: `Bearer token_${userId}` }
    });
    assert.equal(resListJobs.status, 200);
    const dataListJobs = await resListJobs.json();
    assert.ok(Array.isArray(dataListJobs.jobs));
    assert.ok(dataListJobs.jobs.some((j: any) => j.id === jobId));

    // -------------------------------------------------------------------------
    // 6. ISOLAMENTO MULTI-TENANT: Outro usuário não pode consultar job alheio
    // -------------------------------------------------------------------------
    const resOtherAccess = await fetch(`${baseUrl}/api/ai/video-jobs/${jobId}`, {
      headers: { Authorization: `Bearer token_${otherUserId}` }
    });
    assert.equal(resOtherAccess.status, 403, 'Usuário não-autorizado deve receber 403 ao acessar job de outro');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

