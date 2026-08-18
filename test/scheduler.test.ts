import test from 'node:test';
import assert from 'node:assert/strict';
import {
  triggerUserAutopilot,
  processScheduledPosts,
  isAutopilotDue,
  getLocalDateAndHour,
  type AutopilotScheduleConfig
} from '../server/production/scheduler.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';
import { addCredits } from '../server/production/credits.js';

test('Scheduler: Isolamento de trigger do Autopilot para a empresa do próprio usuário', async () => {
  resetMemoryDb();
  const db = firestore();

  const userA = 'usr_dono_empresa_a';
  const userB = 'usr_invasor_b';

  // Cadastra empresa de User A
  const companyAId = 'comp_padaria_estrela';
  await db.collection(COLLECTIONS.companies).doc(companyAId).set({
    id: companyAId,
    userId: userA,
    name: 'Padaria Estrela',
    category: 'Alimentação & Panificação',
    description: 'Padaria artesanal com pães de fermentação natural.',
    products: ['Pão francês', 'Croissant', 'Café especial']
  });

  // Saldo de User A
  await addCredits({
    userId: userA,
    amount: 100,
    type: 'purchase',
    source: 'Créditos User A'
  });

  // Tentativa de User B acionar o Autopilot da empresa de User A -> deve ser rejeitada imediatamente
  await assert.rejects(
    async () => {
      await triggerUserAutopilot(userB, companyAId);
    },
    (err: any) => {
      return err.message.includes('permissão') || err.message.includes('não encontrada');
    }
  );
});

test('Scheduler: Revalidação estrita de ownership antes da publicação de scheduledPosts', async () => {
  resetMemoryDb();
  const db = firestore();

  const userA = 'usr_owner_alpha';
  const userB = 'usr_attacker_beta';

  // Registra perfis
  await db.collection(COLLECTIONS.users).doc(userA).set({ id: userA, email: 'alpha@empresa.com' });
  await db.collection(COLLECTIONS.users).doc(userB).set({ id: userB, email: 'beta@empresa.com' });

  // Empresa de User A
  const compA = 'comp_alpha_1';
  await db.collection(COLLECTIONS.companies).doc(compA).set({ id: compA, userId: userA, name: 'Empresa Alpha' });

  // Empresa de User B
  const compB = 'comp_beta_2';
  await db.collection(COLLECTIONS.companies).doc(compB).set({ id: compB, userId: userB, name: 'Empresa Beta' });

  // Conteúdo legítimo de User A
  const contentA = 'cnt_legit_a';
  await db.collection(COLLECTIONS.contentItems).doc(contentA).set({
    id: contentA,
    userId: userA,
    companyId: compA,
    headline: 'Oferta Especial Alpha',
    body: 'Texto da promoção',
    status: 'draft'
  });

  // CASO 1: Post de User B tentando apontar para a empresa de User A (Cross-tenant Company)
  const maliciousPost1 = 'sched_malicious_1';
  await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost1).set({
    id: maliciousPost1,
    userId: userB,
    companyId: compA, // Empresa de User A!
    contentItemId: contentA,
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() - 10000).toISOString(),
    status: 'scheduled'
  });

  await processScheduledPosts();

  const checkedPost1 = (await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost1).get()).data();
  assert.equal(checkedPost1?.status, 'failed');
  assert.ok(checkedPost1?.errorMessage?.includes('isolamento multi-tenant'));

  // CASO 2: Post de User A apontando para conteúdo de User B (Cross-tenant Content)
  const contentB = 'cnt_legit_b';
  await db.collection(COLLECTIONS.contentItems).doc(contentB).set({
    id: contentB,
    userId: userB,
    companyId: compB,
    headline: 'Conteúdo do User B',
    status: 'draft'
  });

  const maliciousPost2 = 'sched_malicious_2';
  await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost2).set({
    id: maliciousPost2,
    userId: userA,
    companyId: compA,
    contentItemId: contentB, // Conteúdo de User B!
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() - 10000).toISOString(),
    status: 'scheduled'
  });

  await processScheduledPosts();

  const checkedPost2 = (await db.collection(COLLECTIONS.scheduledPosts).doc(maliciousPost2).get()).data();
  assert.equal(checkedPost2?.status, 'failed');
  assert.ok(checkedPost2?.errorMessage?.includes('isolamento multi-tenant'));
});

test('Scheduler: Processamento de scheduledPosts vencidos versus futuros', async () => {
  resetMemoryDb();
  const db = firestore();

  const user = 'usr_scheduler_timer_1';
  const company = 'comp_timer_1';

  await db.collection(COLLECTIONS.users).doc(user).set({ id: user, email: 'timer@empresa.com' });
  await db.collection(COLLECTIONS.companies).doc(company).set({ id: company, userId: user, name: 'Timer Empresa' });

  const contentDue = 'cnt_due_1';
  await db.collection(COLLECTIONS.contentItems).doc(contentDue).set({
    id: contentDue,
    userId: user,
    companyId: company,
    headline: 'Post Vencido',
    body: 'Texto pronto',
    status: 'draft'
  });

  const contentFuture = 'cnt_future_1';
  await db.collection(COLLECTIONS.contentItems).doc(contentFuture).set({
    id: contentFuture,
    userId: user,
    companyId: company,
    headline: 'Post Futuro',
    body: 'Texto futuro',
    status: 'draft'
  });

  // Post 1: Vencido (agendado para 5 minutos no passado) -> deve ser processado
  const postDueId = 'sched_post_past_due';
  await db.collection(COLLECTIONS.scheduledPosts).doc(postDueId).set({
    id: postDueId,
    userId: user,
    companyId: company,
    contentItemId: contentDue,
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    status: 'scheduled'
  });

  // Post 2: Futuro (agendado para 2 horas no futuro) -> NÃO deve ser processado
  const postFutureId = 'sched_post_in_future';
  await db.collection(COLLECTIONS.scheduledPosts).doc(postFutureId).set({
    id: postFutureId,
    userId: user,
    companyId: company,
    contentItemId: contentFuture,
    platforms: ['Instagram'],
    scheduledFor: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    status: 'scheduled'
  });

  const processedCount = await processScheduledPosts();
  assert.equal(processedCount, 1);

  // Post vencido foi processado (ou falhou por falta de credenciais sociais, mas seu status saiu de 'scheduled')
  const postDueSnap = await db.collection(COLLECTIONS.scheduledPosts).doc(postDueId).get();
  assert.notEqual(postDueSnap.data()?.status, 'scheduled');

  // Post futuro continua intacto com status 'scheduled'
  const postFutureSnap = await db.collection(COLLECTIONS.scheduledPosts).doc(postFutureId).get();
  assert.equal(postFutureSnap.data()?.status, 'scheduled');
});

test('Scheduler: Autopilot isAutopilotDue validação determinística de janelas, minutos e timezone America/Sao_Paulo', () => {
  const config: AutopilotScheduleConfig = {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    frequency: 'daily',
    preferredDays: [1, 2, 3, 4, 5], // Seg a Sex
    preferredHours: [10, 15] // 10h e 15h
  };

  // 1. Segunda-feira às 10:07 em São Paulo (UTC 13:07) -> DENTRO DA JANELA DAS 10h (DEVE EXECUTAR)
  const monday1007SP = new Date('2026-08-17T13:07:00.000Z');
  assert.equal(isAutopilotDue(config, monday1007SP), true);

  // 2. Segunda-feira às 10:45 em São Paulo (UTC 13:45) -> DENTRO DA JANELA DAS 10h (DEVE EXECUTAR)
  const monday1045SP = new Date('2026-08-17T13:45:00.000Z');
  assert.equal(isAutopilotDue(config, monday1045SP), true);

  // 3. Segunda-feira às 11:00 em São Paulo (UTC 14:00) -> FORA DA JANELA (NÃO DEVE EXECUTAR)
  const monday1100SP = new Date('2026-08-17T14:00:00.000Z');
  assert.equal(isAutopilotDue(config, monday1100SP), false);

  // 4. Mesma janela chamada duas vezes: 1ª chamada é autorizada, após registrar lastRunSlot a 2ª chamada é bloqueada
  const { hour, dateStr } = getLocalDateAndHour(monday1007SP, 'America/Sao_Paulo');
  assert.equal(hour, 10);
  assert.equal(dateStr, '2026-08-17');

  const afterFirstRunConfig: AutopilotScheduleConfig = {
    ...config,
    lastRunSlot: `${dateStr}_h${hour}`,
    lastRunAt: monday1007SP.toISOString()
  };

  // 2ª execução às 10:45 no mesmo dia -> BLOQUEADA por lastRunSlot
  assert.equal(isAutopilotDue(afterFirstRunConfig, monday1045SP), false);

  // 5. Domingo às 10:07 -> BLOQUEADO por preferredDays
  const sunday1007SP = new Date('2026-08-16T13:07:00.000Z');
  assert.equal(isAutopilotDue(config, sunday1007SP), false);

  // 6. Timezone America/Sao_Paulo vs UTC
  const spLocal = getLocalDateAndHour(monday1007SP, 'America/Sao_Paulo');
  assert.equal(spLocal.hour, 10);
  assert.equal(spLocal.dayOfWeek, 1);
  assert.equal(spLocal.dateStr, '2026-08-17');
});

