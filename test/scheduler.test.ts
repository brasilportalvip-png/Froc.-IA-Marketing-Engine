import test from 'node:test';
import assert from 'node:assert/strict';
import { triggerUserAutopilot } from '../server/production/scheduler.js';
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
