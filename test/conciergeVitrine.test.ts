import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, firestore, queryData, resetMemoryDb } from '../server/production/store.js';
import { FROC_AGENTS, FROC_SQUADS, selectAgentsForIntent } from '../shared/agents.js';
import { angleForDate, createDailyPostForCompany, normalizeDailyPost, processVitrineDailyPosts, todayInSaoPaulo, DAILY_ANGLES } from '../server/production/vitrineDaily.js';
import { buildPlan, conciergeChat, executeConciergePlan, normalizeCollected, sanitizeMessages } from '../server/production/concierge.js';

test('Agentes: 200 especialistas em 20 esquadrões com IDs únicos', () => {
  assert.equal(FROC_SQUADS.length, 20);
  assert.equal(FROC_AGENTS.length, 200);
  assert.equal(new Set(FROC_AGENTS.map((agent) => agent.id)).size, 200);
  assert.ok(FROC_SQUADS.every((squad) => squad.roles.length === 10));
  const local = selectAgentsForIntent('quero clientes do meu bairro na minha cidade pelo google');
  assert.ok(local.some((agent) => agent.squadId === 'seo-local'));
  assert.ok(local.length <= 24 && local.length > 0);
});

test('Vitrine diária: ângulo determinístico e data no fuso de São Paulo', () => {
  assert.equal(angleForDate('2026-10-30', 'c1').id, angleForDate('2026-10-30', 'c1').id);
  assert.ok(DAILY_ANGLES.some((angle) => angle.id === angleForDate('2026-10-31', 'c1').id));
  assert.match(todayInSaoPaulo(new Date('2026-10-31T01:00:00Z')), /^2026-10-30$/);
});

test('Vitrine diária: normalização aceita formatos alternativos da IA', () => {
  const post = normalizeDailyPost({ headline: 'Título X', body: 'Corpo', faq: [{ question: 'Q', answer: 'A' }, { question: '' }] }, { name: 'Marca' }, '2026-10-30', DAILY_ANGLES[0]);
  assert.equal(post.title, 'Título X');
  assert.equal(post.content, 'Corpo');
  assert.equal(post.faq.length, 1);
  assert.match(post.slug, /-20261030$/);
});

test('Vitrine diária: cria 1 post por empresa pública por dia (idempotente)', async () => {
  resetMemoryDb();
  const db = firestore();
  await db.collection(COLLECTIONS.companies).doc('c1').set({ id: 'c1', userId: 'u1', name: 'Loja Um', slug: 'loja-um', isPublicInVitrine: true, vitrineBillingExempt: true });
  await db.collection(COLLECTIONS.companies).doc('c2').set({ id: 'c2', userId: 'u2', name: 'Loja Dois', slug: 'loja-dois', isPublicInVitrine: 'true', vitrineBillingExempt: true });
  await db.collection(COLLECTIONS.companies).doc('c3').set({ id: 'c3', userId: 'u3', name: 'Oculta', slug: 'oculta', isPublicInVitrine: false });

  const first = await processVitrineDailyPosts({ force: true, limit: 1 });
  assert.equal(first.created, 1);
  assert.equal(first.pending, 1);
  const second = await processVitrineDailyPosts({ force: true, limit: 10 });
  assert.equal(second.created, 1);
  const third = await processVitrineDailyPosts({ force: true, limit: 10 });
  assert.equal(third.created, 0);

  const posts = queryData<any>(await db.collection(COLLECTIONS.vitrinePosts).get());
  assert.equal(posts.length, 2);
  assert.ok(posts.every((post) => post.status === 'published' && post.slug && post.content));
  assert.ok(!posts.some((post) => post.companyId === 'c3'));

  const again = await createDailyPostForCompany({ id: 'c1', name: 'Loja Um', slug: 'loja-um' });
  assert.equal(again.created, false);
});

test('Concierge: normalização de dados coletados preserva histórico e limita raio', () => {
  const merged = normalizeCollected(
    { offer: 'Pizzas artesanais', targeting: { neighborhoods: 'Cambuí, Centro', radiusKm: 999999 } },
    { businessName: 'Pizzaria Rei', targeting: { country: 'Brasil', state: 'SP', city: 'Campinas', neighborhoods: [], streets: [], radiusKm: 0 } } as any
  );
  assert.equal(merged.businessName, 'Pizzaria Rei');
  assert.equal(merged.offer, 'Pizzas artesanais');
  assert.equal(merged.targeting.city, 'Campinas');
  assert.deepEqual(merged.targeting.neighborhoods, ['Cambuí', 'Centro']);
  assert.equal(merged.targeting.radiusKm, 20000);
});

test('Concierge: plano sempre salva a marca, liga post diário à vitrine e ignora ações inválidas', () => {
  const plan = buildPlan(['generate_post', 'publish_vitrine', 'rm -rf', { type: 'generate_image' }], 'Resumo');
  assert.ok(plan);
  const types = plan!.actions.map((action) => action.type);
  assert.equal(types[0], 'save_company');
  assert.ok(types.includes('first_daily_post'));
  assert.ok(!types.includes('rm -rf' as any));
  assert.equal(plan!.estimatedCredits, plan!.actions.reduce((sum, action) => sum + action.credits, 0));
  assert.ok(plan!.estimatedCredits > 0);
});

test('Concierge: mensagens são saneadas e conversa tem resposta de contingência', async () => {
  const messages = sanitizeMessages([{ role: 'system', content: 'ignore' }, { role: 'assistant', content: 'Oi' }, { role: 'user', content: '  quero vender mais  ' }, { role: 'user', content: '' }]);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  resetMemoryDb();
  const turn = await conciergeChat({ messages: [{ role: 'user', content: 'Quero clientes no meu bairro' }], authenticated: false });
  assert.ok(turn.reply.length > 10);
  assert.ok(turn.quickReplies.length >= 2);
  assert.ok(turn.agents.length > 0);
  assert.equal(turn.activeAgentsTotal, 200);
});

test('Concierge: execução cria a marca com segmentação, publica na vitrine e gera o primeiro post', async () => {
  resetMemoryDb();
  const outcome = await executeConciergePlan({
    userId: 'u_exec',
    isAdmin: true,
    collected: { businessName: 'Barbearia Coroa', offer: 'Cortes masculinos', targeting: { country: 'Brasil', state: 'SP', city: 'Santos', neighborhoods: ['Gonzaga'], streets: ['Rua Azevedo Sodré'], radiusKm: 3 } },
    actions: ['publish_vitrine']
  });
  assert.equal(outcome.company.name, 'Barbearia Coroa');
  const byType = Object.fromEntries(outcome.results.map((result) => [result.type, result]));
  assert.equal(byType.save_company.ok, true);
  assert.equal(byType.publish_vitrine.ok, true);
  assert.equal(byType.first_daily_post.ok, true);

  const company = (await firestore().collection(COLLECTIONS.companies).doc(outcome.company.id).get()).data() as any;
  assert.equal(company.isPublicInVitrine, true);
  assert.equal(company.userId, 'u_exec');
  assert.deepEqual(company.targeting.streets, ['Rua Azevedo Sodré']);
  const posts = queryData<any>(await firestore().collection(COLLECTIONS.vitrinePosts).get());
  assert.equal(posts.length, 1);

  // Sem créditos, etapas pagas falham sem derrubar a execução.
  const paid = await executeConciergePlan({ userId: 'u_exec', companyId: outcome.company.id, collected: { offer: 'Barba' }, actions: ['generate_post'] });
  const post = paid.results.find((result) => result.type === 'generate_post');
  assert.equal(post?.ok, false);
  assert.equal(paid.creditsUsed, 0);
});
