import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

test('Firestore Rules: Auditoria estática e estrutural de regras de segurança multi-tenant (11 Invariantes)', async () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

  // 1. Invariante 1: Usuário lê seu próprio documento de perfil em /users/{uid}
  assert.ok(
    rulesContent.includes('match /users/{uid}'),
    'Regra para users/{uid} deve existir'
  );
  assert.ok(
    rulesContent.match(/match \/users\/\{uid\}\s*\{[\s\S]*?allow read: if own\(uid\);/),
    'Invariante 1: Usuário lê o próprio users'
  );

  // 2. Invariante 2: Cliente NUNCA escreve diretamente em /users/{uid} (backend-write-only)
  assert.ok(
    rulesContent.match(/match \/users\/\{uid\}\s*\{[\s\S]*?allow write: if false;/),
    'Invariante 2: Escrita de users pelo cliente terminantemente bloqueada'
  );

  // 3. Invariante 3: Usuário lê sua própria carteira em /wallets/{uid}
  assert.ok(
    rulesContent.match(/match \/wallets\/\{uid\}\s*\{[\s\S]*?allow read: if own\(uid\);/),
    'Invariante 3: Usuário lê própria wallet'
  );

  // 4. Invariante 4: Cliente NUNCA escreve diretamente em /wallets/{uid} (backend-write-only)
  assert.ok(
    rulesContent.match(/match \/wallets\/\{uid\}\s*\{[\s\S]*?allow write: if false;/),
    'Invariante 4: Escrita de wallet pelo cliente terminantemente bloqueada'
  );

  // 5. Invariante 5 & 6: Leitura de empresas (Usuário A lê sua empresa; Usuário B não lê privada de A)
  assert.ok(
    rulesContent.match(/match \/companies\/\{id\}\s*\{[\s\S]*?resource\.data\.userId == request\.auth\.uid/),
    'Invariante 5 & 6: Leitura restrita ao proprietário para empresas privadas'
  );

  // 7. Invariante 7: Vitrine pública lê empresas com isPublicInVitrine == true
  assert.ok(
    rulesContent.match(/match \/companies\/\{id\}\s*\{[\s\S]*?resource\.data\.isPublicInVitrine == true/),
    'Invariante 7: Leitura pública permitida para empresas na vitrine'
  );

  // 8. Invariante 8: Cliente NÃO cria/edita empresas diretamente (backend-write-only)
  assert.ok(
    rulesContent.match(/match \/companies\/\{id\}\s*\{[\s\S]*?allow write: if false;/),
    'Invariante 8: Cliente não escreve diretamente em companies'
  );

  // 9. Invariante 9: Cliente NÃO altera contentItems diretamente (backend-write-only)
  assert.ok(
    rulesContent.match(/match \/contentItems\/\{id\}\s*\{[\s\S]*?allow write: if false;/),
    'Invariante 9: Cliente não altera contentItems'
  );

  // 10. Invariante 10: Cliente NÃO altera campaigns diretamente (backend-write-only)
  assert.ok(
    rulesContent.match(/match \/campaigns\/\{id\}\s*\{[\s\S]*?allow write: if false;/),
    'Invariante 10: Cliente não altera campaigns'
  );

  // 11. Invariante 11: Cliente NÃO cria/altera scheduledPosts diretamente (backend-write-only)
  assert.ok(
    rulesContent.match(/match \/scheduledPosts\/\{id\}\s*\{[\s\S]*?allow write: if false;/),
    'Invariante 11: Cliente não cria/altera scheduledPosts'
  );

  // Invariante Extra: Fallback global /{document=**} fechado para leitura e escrita
  assert.ok(
    rulesContent.match(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/),
    'Fallback de documentos deve ser estritamente allow read, write: if false'
  );
});
