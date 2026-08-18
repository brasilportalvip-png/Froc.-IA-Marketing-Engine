import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

test('Firestore Rules: Auditoria estrita de isolamento multi-tenant e superfícies de escrita', async () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

  // 1. users: escrita exclusivamente via backend
  assert.ok(
    rulesContent.includes('match /users/{uid}'),
    'Regra para users/{uid} deve existir'
  );
  assert.ok(
    rulesContent.match(/match \/users\/\{uid\}\s*\{\s*allow read: if own\(uid\);\s*allow write: if false;/),
    'users/{uid} deve ser backend-write-only (allow write: if false)'
  );

  // 2. wallets: escrita exclusivamente via backend
  assert.ok(
    rulesContent.includes('match /wallets/{uid}'),
    'Regra para wallets/{uid} deve existir'
  );
  assert.ok(
    rulesContent.match(/match \/wallets\/\{uid\}\s*\{\s*allow read: if own\(uid\);\s*allow write: if false;/),
    'wallets/{uid} deve ser backend-write-only (allow write: if false)'
  );

  // 3. companies: escritas diretas do cliente proibidas (backend-write-only)
  assert.ok(
    rulesContent.includes('match /companies/{id}'),
    'Regra para companies/{id} deve existir'
  );
  assert.ok(
    rulesContent.match(/match \/companies\/\{id\}\s*\{\s*allow read: if resource\.data\.isPublicInVitrine == true \|\| \(signedIn\(\) && resource\.data\.userId == request\.auth\.uid\);\s*allow write: if false;/),
    'companies/{id} deve ter allow write: if false (cliente não pode criar ou editar direto)'
  );

  // 4. contentItems, campaigns, scheduledPosts: backend-write-only
  assert.ok(
    rulesContent.match(/match \/contentItems\/\{id\}\s*\{\s*allow read: if signedIn\(\) && resource\.data\.userId == request\.auth\.uid;\s*allow write: if false;/),
    'contentItems/{id} deve ter allow write: if false'
  );
  assert.ok(
    rulesContent.match(/match \/campaigns\/\{id\}\s*\{\s*allow read: if signedIn\(\) && resource\.data\.userId == request\.auth\.uid;\s*allow write: if false;/),
    'campaigns/{id} deve ter allow write: if false'
  );
  assert.ok(
    rulesContent.match(/match \/scheduledPosts\/\{id\}\s*\{\s*allow read: if signedIn\(\) && resource\.data\.userId == request\.auth\.uid;\s*allow write: if false;/),
    'scheduledPosts/{id} deve ter allow write: if false'
  );

  // 5. Fallback global match /{document=**} fechado para escrita e leitura
  assert.ok(
    rulesContent.match(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/),
    'Document fallback deve ser estritamente allow read, write: if false'
  );
});
