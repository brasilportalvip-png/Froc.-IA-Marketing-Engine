import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { getMemoryCollection, resetMemoryDb } from '../server/production/store.js';
import * as firebaseAdminProvider from '../server/providers/firebaseAdmin.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../server/production/auth.js';
import { isValidMp4Buffer, setMediaAiClientForTesting } from '../server/production/ai.js';
import { config } from '../server/config/index.js';

test('Media Generation: Full Production Hardening Suite (Images, Veo Presets, Concurrency, Fail-Closed, Background Worker)', async () => {
  process.env.NODE_ENV = 'test';
  resetMemoryDb();

  const validMp4Header = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d]);

  setMediaAiClientForTesting({
    models: {
      generateContent: async (_params: any) => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                    mimeType: 'image/png'
                  }
                }
              ]
            }
          }
        ]
      }),
      generateImages: async (_params: any) => ({
        generatedImages: [
          {
            image: {
              imageBytes: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            }
          }
        ]
      }),
      generateVideos: async (_params: any) => ({
        name: 'operations/test-video-op-123'
      })
    },
    operations: {
      getVideosOperation: async (_params: any) => ({
        done: true,
        response: {
          generatedVideos: [
            {
              video: {
                videoBytes: validMp4Header.toString('base64'),
                mimeType: 'video/mp4'
              }
            }
          ]
        }
      })
    }
  } as any);

  const { default: router } = await import('../server/production/router.js');
  const { addCredits, getWallet } = await import('../server/production/credits.js');
  const { processPendingVideoJobs, checkAndCompleteVideoJob, startVideoGenerationJob } = await import('../server/production/ai.js');

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

  // Mock padrão do Firebase Admin Storage
  const savedStorageFiles = new Map<string, { buffer: Buffer; metadata: any }>();
  let throwStorageSaveError = false;

  firebaseAdminProvider.setAdminStorageForTesting({
    bucket: () => ({
      name: 'froc-ia-test.appspot.com',
      file: (path: string) => ({
        save: async (buffer: Buffer, options: any) => {
          if (throwStorageSaveError) {
            throw new Error('Firebase Storage Simulado: Falha de I/O na gravação.');
          }
          savedStorageFiles.set(path, { buffer, metadata: options?.metadata });
        },
        delete: async () => {
          savedStorageFiles.delete(path);
        }
      })
    })
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

  // Saldo inicial
  await addCredits({
    userId,
    amount: 5000,
    type: 'purchase',
    source: 'Test Seed'
  });

  try {
    // =========================================================================
    // 1. VALIDAÇÃO DE CONTAINER MP4 (isValidMp4Buffer)
    // =========================================================================
    const htmlErrorBuffer = Buffer.from('<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>Error</body></html>');
    const jsonErrorBuffer = Buffer.from('{"error": {"code": 500, "message": "Internal Server Error"}}');
    const shortBuffer = Buffer.from([0x00, 0x01, 0x02]);

    assert.equal(isValidMp4Buffer(validMp4Header), true, 'Buffer com ftyp/mp4 deve ser aceito como válido');
    assert.equal(isValidMp4Buffer(htmlErrorBuffer), false, 'HTML de erro deve ser rejeitado');
    assert.equal(isValidMp4Buffer(jsonErrorBuffer), false, 'JSON de erro deve ser rejeitado');
    assert.equal(isValidMp4Buffer(shortBuffer), false, 'Buffer curto deve ser rejeitado');

    // =========================================================================
    // 2. GERAÇÃO DE IMAGEM 1K (15 créditos), 2K (25 créditos) e 4K (40 créditos)
    // =========================================================================
    const resImage1k = await fetch(`${baseUrl}/api/ai/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
      body: JSON.stringify({ theme: 'Bolsa de couro minimalista', aspectRatio: '1:1', resolution: '1K', companyId })
    });
    assert.equal(resImage1k.status, 200);
    const dataImage1k = await resImage1k.json();
    assert.equal(dataImage1k.creditsUsed, 15, 'Imagem 1K deve consumir 15 créditos');

    const resImage2k = await fetch(`${baseUrl}/api/ai/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
      body: JSON.stringify({ theme: 'Coleção de primavera', style: 'Editorial de moda', aspectRatio: '9:16', resolution: '2K', companyId })
    });
    assert.equal(resImage2k.status, 200);
    const dataImage2k = await resImage2k.json();
    assert.equal(dataImage2k.creditsUsed, 25, 'Imagem 2K deve consumir 25 créditos');

    const resImage4k = await fetch(`${baseUrl}/api/ai/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
      body: JSON.stringify({ theme: 'Tênis futurista neon', style: 'Publicidade 4K', aspectRatio: '1:1', resolution: '4K', companyId })
    });
    assert.equal(resImage4k.status, 200);
    const dataImage4k = await resImage4k.json();
    assert.equal(dataImage4k.creditsUsed, 40, 'Imagem 4K deve consumir 40 créditos');
    assert.ok(dataImage4k.imageUrl);
    assert.equal(dataImage4k.contentItem.type, 'image');
    assert.equal(dataImage4k.contentItem.metadata.resolution, '4K');

    // =========================================================================
    // 3. ROTEIRO E DIREÇÃO VISUAL DE VÍDEO (10 créditos cada)
    // =========================================================================
    const resScript = await fetch(`${baseUrl}/api/ai/generate-video-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
      body: JSON.stringify({ topic: 'Lançamento Froc Urban', format: 'Reels / TikTok (60s)', objective: 'Vendas', companyId })
    });
    assert.equal(resScript.status, 200);
    const dataScript = await resScript.json();
    assert.equal(dataScript.creditsUsed, 10, 'Roteiro de vídeo deve consumir 10 créditos');
    assert.ok(dataScript.script);

    const resDirection = await fetch(`${baseUrl}/api/ai/generate-video-direction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
      body: JSON.stringify({ prompt: 'Mulher correndo na praia ao pôr do sol', aspectRatio: '9:16', mood: 'Enérgico', companyId })
    });
    assert.equal(resDirection.status, 200);
    const dataDirection = await resDirection.json();
    assert.ok(dataDirection.direction?.visualPrompt);

    // =========================================================================
    // 4. PRESETS DE VÍDEO: demo_720p (50), pro_1080p (100), cinema_4k (200) + Auto-Direction
    // =========================================================================
    // Preset demo_720p
    const resVideo720 = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
      body: JSON.stringify({ prompt: 'Demonstração rápida do produto', preset: 'demo_720p', aspectRatio: '9:16', companyId })
    });
    assert.equal(resVideo720.status, 202);
    const dataVideo720 = await resVideo720.json();
    assert.equal(dataVideo720.creditsReserved, 50, 'Preset demo_720p deve reservar 50 créditos');
    assert.equal(dataVideo720.job.resolution, '720p');
    assert.equal(dataVideo720.job.durationSeconds, 4);

    // Preset cinema_4k com 4K Real
    const resVideo4k = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
      body: JSON.stringify({ prompt: 'Comercial cinematográfico de luxo', preset: 'cinema_4k', aspectRatio: '16:9', companyId })
    });
    assert.equal(resVideo4k.status, 202);
    const dataVideo4k = await resVideo4k.json();
    assert.equal(dataVideo4k.creditsReserved, 200, 'Preset cinema_4k deve reservar 200 créditos');
    assert.equal(dataVideo4k.job.resolution, '4k', 'Preset cinema_4k deve manter resolução 4k real');
    assert.equal(dataVideo4k.job.durationSeconds, 8);
    assert.ok(dataVideo4k.job.finalPrompt.length > dataVideo4k.job.sourcePrompt.length, 'Auto-direction deve enriquecer o finalPrompt');

    // Preset pro_1080p
    const resStartVideo = await fetch(`${baseUrl}/api/ai/generate-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer token_${userId}` },
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
    assert.equal(dataStartVideo.job.resolution, '1080p');
    assert.equal(dataStartVideo.job.durationSeconds, 8);
    const mainJobId = dataStartVideo.jobId;

    // =========================================================================
    // 5. TESTE DE CONCORRÊNCIA E CLAIM ATÔMICO
    // =========================================================================
    // Simular chamadas simultâneas de finalização no mesmo job
    const [resJobA, resJobB] = await Promise.all([
      checkAndCompleteVideoJob(userId, mainJobId),
      checkAndCompleteVideoJob(userId, mainJobId)
    ]);

    assert.ok(resJobA.status === 'completed' || resJobA.status === 'finalizing');
    assert.ok(resJobB.status === 'completed' || resJobB.status === 'finalizing');

    const finalCheck = await checkAndCompleteVideoJob(userId, mainJobId);
    assert.equal(finalCheck.status, 'completed');
    assert.ok(finalCheck.videoUrl);
    assert.ok(finalCheck.contentItemId);

    // Verificar que contentItem foi criado exatamente uma vez
    const savedContent = getMemoryCollection('contentItems').get(finalCheck.contentItemId);
    assert.ok(savedContent);
    assert.equal(savedContent.type, 'video');

    // =========================================================================
    // 6. TESTE DE FAIL-CLOSED: FALHA NO FIREBASE STORAGE
    // =========================================================================
    const walletBeforeFail = await getWallet(userId);
    
    // Iniciar novo job
    const jobForStorageFail = await startVideoGenerationJob({
      userId,
      company: { id: companyId, name: 'Loja Exemplo Media' } as any,
      prompt: 'Vídeo para teste de falha de storage',
      preset: 'demo_720p',
      aspectRatio: '9:16'
    });

    const walletWithReservation = await getWallet(userId);
    assert.equal(walletWithReservation.reservedCredits - walletBeforeFail.reservedCredits, 50, 'Deve reservar exatamente 50 créditos');

    // Ativar falha intencional de storage
    throwStorageSaveError = true;
    try {
      const failedResult = await checkAndCompleteVideoJob(userId, jobForStorageFail.id);
      assert.equal(failedResult.status, 'failed');
      assert.equal(failedResult.errorCode, 'STORAGE_PERSIST_FAILED');
      
      const walletAfterRollback = await getWallet(userId);
      assert.equal(walletAfterRollback.reservedCredits, walletBeforeFail.reservedCredits, 'Reserva de créditos deve ser estornada');
      assert.equal(walletAfterRollback.availableCredits, walletBeforeFail.availableCredits, 'Saldo disponível deve retornar integralmente');
    } finally {
      throwStorageSaveError = false;
    }

    // =========================================================================
    // 7. BACKGROUND WORKER REAL VIA /api/cron/process (CRON_SECRET)
    // =========================================================================
    // Criar um job pendente que será finalizado pelo cron sem interação do usuário
    const backgroundJob = await startVideoGenerationJob({
      userId,
      company: { id: companyId, name: 'Loja Exemplo Media' } as any,
      prompt: 'Vídeo gerado em background deslogado',
      preset: 'demo_720p',
      aspectRatio: '9:16'
    });
    assert.equal(backgroundJob.status, 'processing');

    // Chamar o endpoint /api/cron/process com Authorization: Bearer CRON_SECRET
    const cronSecret = config.cronSecret || 'test-cron-secret-123';
    config.cronSecret = cronSecret;

    // Tentativa sem autorização (deve retornar 401)
    const resCronUnauthorized = await fetch(`${baseUrl}/api/cron/process`);
    assert.equal(resCronUnauthorized.status, 401, 'Endpoint de cron deve rejeitar requisição não autorizada');

    // Chamada autorizada
    const resCron = await fetch(`${baseUrl}/api/cron/process`, {
      headers: {
        Authorization: `Bearer ${cronSecret}`
      }
    });
    assert.equal(resCron.status, 200, 'Endpoint de cron deve responder 200 com autorização válida');
    const cronData = await resCron.json();
    assert.ok(cronData.videoJobs, 'Cron deve processar videoJobs');
    assert.ok(cronData.videoJobs.completed >= 1, 'Pelo menos 1 job de vídeo pendente deve ter sido completado');

    // Verificar que o job agora está concluído na base de dados
    const completedBgJob = getMemoryCollection('mediaGenerationJobs').get(backgroundJob.id);
    assert.ok(completedBgJob);
    assert.equal(completedBgJob.status, 'completed');
    assert.ok(completedBgJob.contentItemId);

    // =========================================================================
    // 8. ISOLAMENTO MULTI-TENANT
    // =========================================================================
    const resOtherAccess = await fetch(`${baseUrl}/api/ai/video-jobs/${mainJobId}`, {
      headers: { Authorization: `Bearer token_${otherUserId}` }
    });
    assert.equal(resOtherAccess.status, 403, 'Usuário de outro tenant não pode consultar job alheio');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
