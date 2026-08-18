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

test('Scheduler: Autopilot isAutopilotDue validação por timezone, dias, horas e idempotência de slot', () => {
  // Configuração padrão: Segunda a Sexta [1..5], às 10h e 15h, horário de São Paulo
  const config: AutopilotScheduleConfig = {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    frequency: 'daily',
    preferredDays: [1, 2, 3, 4, 5],
    preferredHours: [10, 15]
  };

  // 1. Segunda-feira às 10:00 em São Paulo (UTC 13:00) -> DEVE EXECUTAR
  // Criar data: Segunda-feira 2026-08-17T13:00:00Z (que é 10:00 em SP)
  const monday10amSP = new Date('2026-08-17T13:00:00.000Z');
  assert.equal(isAutopilotDue(config, monday10amSP), true);

  // 2. Domingo (dia 0) às 10:00 em São Paulo -> NÃO DEVE EXECUTAR (dia não permitido)
  const sunday10amSP = new Date('2026-08-16T13:00:00.000Z');
  assert.equal(isAutopilotDue(config, sunday10amSP), false);

  // 3. Segunda-feira às 12:00 em São Paulo -> NÃO DEVE EXECUTAR (hora não permitida)
  const monday12pmSP = new Date('2026-08-17T15:00:00.000Z');
  assert.equal(isAutopilotDue(config, monday12pmSP), false);

  // 4. Prevenção de execução duplicada no mesmo slot
  const { hour, dateStr } = getLocalDateAndHour(monday10amSP, 'America/Sao_Paulo');
  const executedConfig: AutopilotScheduleConfig = {
    ...config,
    lastRunSlot: `${dateStr}_h${hour}`,
    lastRunAt: monday10amSP.toISOString()
  };
  assert.equal(isAutopilotDue(executedConfig, monday10amSP), false);

  // 5. Restrição de frequência semanal (weekly) -> menos de 6 dias desde a última execução bloqueia
  const weeklyConfig: AutopilotScheduleConfig = {
    ...config,
    frequency: 'weekly',
    lastRunAt: new Date(monday10amSP.getTime() - 2 * 86_400_000).toISOString() // 2 dias atrás
  };
  // Próxima quarta-feira às 10:00
  const wednesday10amSP = new Date('2026-08-19T13:00:00.000Z');
  assert.equal(isAutopilotDue(weeklyConfig, wednesday10amSP), false);
});

