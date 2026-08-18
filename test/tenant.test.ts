import test from 'node:test';
import assert from 'node:assert/strict';
import { requireOwnedCompany } from '../server/production/router.js';
import { resetMemoryDb, firestore, COLLECTIONS } from '../server/production/store.js';

test('Multi-Tenant: requireOwnedCompany bloqueia estritamente acesso cruzado entre usuários', async () => {
  resetMemoryDb();
  const db = firestore();

  const userA = 'usr_legit_owner_1';
  const userB = 'usr_rogue_tenant_2';
  const companyA = 'comp_boutique_a';

  // Salva empresa pertencente exclusivamente a User A
  await db.collection(COLLECTIONS.companies).doc(companyA).set({
    id: companyA,
    userId: userA,
    name: 'Boutique Alpha',
    category: 'Moda'
  });

  // 1. User A acessa a própria empresa -> sucesso
  const retrieved = await requireOwnedCompany(userA, companyA);
  assert.equal(retrieved.id, companyA);
  assert.equal(retrieved.userId, userA);

  // 2. User B tenta acessar a empresa de User A -> deve lançar erro 403/rejeição
  await assert.rejects(
    async () => {
      await requireOwnedCompany(userB, companyA);
    },
    (err: any) => {
      return (
        err.message.includes('permissão') ||
        err.message.includes('não encontrada') ||
        err.statusCode === 403
      );
    }
  );

  // 3. Tentativa com ID inexistente
  await assert.rejects(
    async () => {
      await requireOwnedCompany(userA, 'comp_inexistente_999');
    },
    (err: any) => {
      return err.message.includes('não encontrada') || err.statusCode === 404;
    }
  );
});
