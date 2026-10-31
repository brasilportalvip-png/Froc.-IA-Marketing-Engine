import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, firestore, queryData, resetMemoryDb } from '../server/production/store.js';
import { addCredits, getWallet } from '../server/production/credits.js';
import { config } from '../server/config/index.js';
import { createDailyPostForCompany, enterVitrine, processVitrineDailyPosts } from '../server/production/vitrineDaily.js';
import { chargeVitrineDay, isPaidPlan, setSiteDailyPosts, vitrineEligibility } from '../server/production/vitrineBilling.js';
import { actionCost, buildPlan } from '../server/production/concierge.js';
import { isDuplicatePost, isImageHashUsed, registerImageHash, similarity } from '../server/production/uniqueness.js';
import { backfillPostImages } from '../server/production/postImages.js';
import { closeConversation, deleteConversation, getConversation, listConversations, saveConversationTurn } from '../server/production/conversations.js';

async function paidUser(userId: string, credits: number) {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await firestore().collection(COLLECTIONS.payments).doc(`ord_${userId}`).set({
    id: `ord_${userId}`, userId, planId: 'plan_start', status: 'active', lastPaymentStatus: 'approved',
    lastCreditedAt: new Date().toISOString(), currentPeriodEnd: future, createdAt: new Date().toISOString()
  });
  if (credits > 0) await addCredits({ userId, amount: credits, type: 'purchase', source: 'teste', idempotencyKey: `seed:${userId}:${credits}` });
}

async function company(id: string, userId: string, extra: Record<string, any> = {}) {
  const data = { id, userId, name: `Projeto ${id}`, slug: `projeto-${id}`, category: 'Pizzaria', city: 'Campinas', ...extra };
  await firestore().collection(COLLECTIONS.companies).doc(id).set(data);
  return data;
}

test('Regras: chat custa 3 créditos por resposta, vitrine 10 por dia e criações estão incluídas', () => {
  assert.equal(config.billing.chatReplyCost, 3);
  assert.equal(config.billing.vitrineDailyCost, 10);
  assert.equal(config.freeSignupBonusCredits, 25);
  assert.equal(actionCost('publish_vitrine'), 10);
  const plan = buildPlan(['publish_vitrine'], 'Resumo');
  assert.ok(plan!.actions.some((a) => a.type === 'publish_vitrine' && a.credits === 10));
  const names = config.plans.map((p) => [p.name, p.price, p.totalCredits]);
  assert.deepEqual(names, [['START', 49, 110], ['PRO', 99.9, 230], ['BUSINESS', 199.9, 480], ['AGENCY', 399.9, 1000]]);
  assert.ok(config.plans.every((p) => !p.features.some((f) => /até \d+ marcas/i.test(f))), 'planos sem limite de marcas');
});

test('Vitrine: plano grátis não entra; assinante entra, paga 10 e ganha o post do dia', async () => {
  resetMemoryDb();
  const free = await company('f1', 'u_free');
  await addCredits({ userId: 'u_free', amount: 25, type: 'bonus', source: 'bônus', idempotencyKey: 'welcome:u_free' });
  const blocked = await enterVitrine({ company: free });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'no_plan');
  assert.notEqual((await firestore().collection(COLLECTIONS.companies).doc('f1').get()).data().isPublicInVitrine, true);

  await paidUser('u_paid', 25);
  assert.equal(isPaidPlan(await getWallet('u_paid')), true);
  const proj = await company('p1', 'u_paid');
  const entered = await enterVitrine({ company: proj });
  assert.equal(entered.ok, true);
  assert.equal((await getWallet('u_paid')).balance, 15);
  const posts = queryData<any>(await firestore().collection(COLLECTIONS.vitrinePosts).where('companyId', '==', 'p1').get());
  assert.equal(posts.length, 1);
  assert.equal(posts[0].status, 'published');
  assert.ok(posts[0].imageGenerated, 'todo post nasce com imagem');

  // Mesma diária não é cobrada duas vezes.
  const again = await chargeVitrineDay(proj, posts[0].date);
  assert.equal(again.charged, 0);
  await processVitrineDailyPosts({ force: true, limit: 10 });
  assert.equal((await getWallet('u_paid')).balance, 15);
});

test('Vitrine: sem créditos o projeto sai sozinho e não recebe post', async () => {
  resetMemoryDb();
  await paidUser('u_low', 5);
  await company('l1', 'u_low', { isPublicInVitrine: true });
  assert.equal((await vitrineEligibility('u_low')).reason, 'no_credits');
  const result = await processVitrineDailyPosts({ force: true, limit: 10 });
  assert.equal(result.created, 0);
  const fresh = (await firestore().collection(COLLECTIONS.companies).doc('l1').get()).data() as any;
  assert.equal(fresh.isPublicInVitrine, false);
  assert.equal(fresh.vitrineRemovedReason, 'no_credits');
  assert.equal((await getWallet('u_low')).balance, 5, 'não cobra quando não publica');
  const notes = queryData<any>(await firestore().collection(COLLECTIONS.notifications).where('userId', '==', 'u_low').get());
  assert.ok(notes.some((n) => n.type === 'vitrine_removed'));
});

test('Admin: desligar o post diário (projeto ou site inteiro) = sem post e sem cobrança', async () => {
  resetMemoryDb();
  await paidUser('u_off', 50);
  await company('o1', 'u_off', { isPublicInVitrine: true, dailyPostsEnabled: false });
  await processVitrineDailyPosts({ limit: 10 });
  assert.equal((await getWallet('u_off')).balance, 50);
  assert.equal(queryData<any>(await firestore().collection(COLLECTIONS.vitrinePosts).get()).length, 0);
  assert.equal((await firestore().collection(COLLECTIONS.companies).doc('o1').get()).data().isPublicInVitrine, true, 'continua na vitrine');

  await firestore().collection(COLLECTIONS.companies).doc('o1').set({ dailyPostsEnabled: true }, { merge: true });
  await setSiteDailyPosts(false, 'admin');
  const off = await processVitrineDailyPosts({ limit: 10 });
  assert.equal(off.created, 0);
  assert.equal((await getWallet('u_off')).balance, 50);
  await setSiteDailyPosts(true, 'admin');
  const on = await processVitrineDailyPosts({ limit: 10 });
  assert.equal(on.created, 1);
  assert.equal((await getWallet('u_off')).balance, 40);
});

test('Conteúdo único: posts repetidos e imagens repetidas são barrados', async () => {
  resetMemoryDb();
  const base = 'Pizza artesanal no Cambuí com massa de fermentação natural, forno a lenha e entrega rápida para toda Campinas todos os dias da semana.';
  assert.ok(similarity(base, base) === 1);
  assert.equal(isDuplicatePost({ title: 'Pizza no Cambuí', content: base }, [{ title: 'Outro', content: base }]), true);
  assert.equal(isDuplicatePost({ title: 'Pizza no Cambuí!', content: 'x' }, [{ title: 'pizza no cambui', content: 'y' }]), true);
  assert.equal(isDuplicatePost({ title: 'Como escolher sabores', content: 'Guia de sabores clássicos e combinações para festas em família.' }, [{ title: 'Pizza no Cambuí', content: base }]), false);

  assert.equal(await isImageHashUsed('abc123'), false);
  await registerImageHash('abc123', { imageUrl: 'https://x/1.jpg', folder: 'posts' });
  assert.equal(await isImageHashUsed('abc123'), true);

  const proj = await company('u1c', 'u1', { vitrineBillingExempt: true, isPublicInVitrine: true });
  const day1 = await createDailyPostForCompany(proj, '2026-10-30');
  const day2 = await createDailyPostForCompany(proj, '2026-10-31');
  assert.equal(day1.created && day2.created, true);
  assert.notEqual(day1.post.title, day2.post.title);
  assert.notEqual(day1.post.imageUrl, day2.post.imageUrl);
  assert.notEqual(day1.post.imageSha256, day2.post.imageSha256);
  assert.ok(Array.isArray(day1.post.hashtags) && day1.post.hashtags.every((tag: string) => tag.startsWith('#')));
});

test('Imagem obrigatória: sem imagem o post espera e só publica quando a imagem fica pronta', async () => {
  resetMemoryDb();
  const proj = await company('img1', 'u1', { vitrineBillingExempt: true, isPublicInVitrine: true });
  (config.postImages as any).enabled = false;
  try {
    const created = await createDailyPostForCompany(proj, '2026-10-30');
    assert.equal(created.post.status, 'awaiting_image');
    assert.equal(created.post.imageUrl, null);
  } finally {
    (config.postImages as any).enabled = true;
  }
  const filled = await backfillPostImages(5);
  assert.equal(filled.generated, 1);
  const post = (await firestore().collection(COLLECTIONS.vitrinePosts).doc('img1_2026-10-30').get()).data() as any;
  assert.equal(post.status, 'published');
  assert.ok(post.publishedAt && post.imageGenerated);
});

test('Conversas: salvar, listar, fechar (só leitura) e excluir; só o dono acessa', async () => {
  resetMemoryDb();
  const id = await saveConversationTurn({ userId: 'u1', messages: [{ role: 'user', content: 'Quero divulgar minha pizzaria' }], reply: 'Bora!' });
  await saveConversationTurn({ userId: 'u1', conversationId: id, messages: [{ role: 'user', content: 'Quero divulgar minha pizzaria' }, { role: 'assistant', content: 'Bora!' }, { role: 'user', content: 'No Cambuí' }], reply: 'Show!' });
  const list = await listConversations('u1');
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 4);
  assert.equal(list[0].title, 'Quero divulgar minha pizzaria');
  await assert.rejects(() => getConversation('intruso', id), /não encontrada/);
  await closeConversation('u1', id);
  await assert.rejects(() => saveConversationTurn({ userId: 'u1', conversationId: id, messages: [{ role: 'user', content: 'oi' }], reply: 'x' }), /fechada/);
  await assert.rejects(() => deleteConversation('intruso', id), /não encontrada/);
  await deleteConversation('u1', id);
  assert.equal((await listConversations('u1')).length, 0);
});

test('HTTP: chat cobra 3 por resposta, sem saldo não cobra, visitante tem respostas grátis e usuário não liga vitrine sozinho', async () => {
  resetMemoryDb();
  const db = firestore();
  const express = (await import('express')).default as any;
  const { router } = await import('../server/production/router.js');
  const firebaseAdminProvider = await import('../server/providers/firebaseAdmin.js');
  const { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } = await import('../server/production/auth.js');
  const now = new Date().toISOString();
  for (const [id, role] of [['u_chat', 'user'], ['u_admin', 'admin'], ['u_zero', 'user']] as const) {
    await db.collection(COLLECTIONS.users).doc(id).set({ id, email: `${id}@example.com`, name: 'Maria Souza', role, createdAt: now, termsAcceptedAt: now, privacyAcceptedAt: now, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION });
  }
  await addCredits({ userId: 'u_chat', amount: 25, type: 'bonus', source: 'bônus', idempotencyKey: 'welcome:u_chat' });
  await company('free_proj', 'u_chat');
  firebaseAdminProvider.setAdminAuthForTesting({
    verifyIdToken: async (token: string) => {
      if (token === 't_chat') return { uid: 'u_chat', email: 'u_chat@example.com', role: 'user' } as any;
      if (token === 't_admin') return { uid: 'u_admin', email: 'u_admin@example.com', role: 'admin' } as any;
      if (token === 't_zero') return { uid: 'u_zero', email: 'u_zero@example.com', role: 'user' } as any;
      throw new Error('Invalid token');
    }
  } as any);
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const { setTestChatReply } = await import('../server/production/ai.js');
  setTestChatReply('Que legal! Me conta em qual bairro estão seus clientes?');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const chat = (token: string | null, body: any) => fetch(`${base}/api/concierge/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const res = await chat('t_chat', { messages: [{ role: 'user', content: 'Oi, tenho uma pizzaria' }] });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.ok(data.conversationId, 'conversa salva');
    assert.equal(data.creditsUsed, 3);
    assert.equal((await getWallet('u_chat')).balance, 22);
    const list = await (await fetch(`${base}/api/concierge/conversations`, { headers: { Authorization: 'Bearer t_chat' } })).json();
    assert.equal(list.conversations.length, 1);

    const adminRes = await (await chat('t_admin', { messages: [{ role: 'user', content: 'Oi' }] })).json();
    assert.equal(adminRes.creditsUsed, 0, 'admin não paga');

    const zero = await (await chat('t_zero', { messages: [{ role: 'user', content: 'Oi' }] })).json();
    assert.equal(zero.needsCredits, true);
    assert.equal((await getWallet('u_zero')).balance, 0);

    for (let i = 0; i < config.billing.guestFreeReplies; i += 1) {
      const guest = await (await chat(null, { messages: [{ role: 'user', content: `Oi ${i}` }] })).json();
      assert.notEqual(guest.needsLogin, true);
    }
    const blockedGuest = await (await chat(null, { messages: [{ role: 'user', content: 'Mais uma' }] })).json();
    assert.equal(blockedGuest.needsLogin, true);

    // Usuário não consegue se colocar na vitrine pelo cadastro (só pelo fluxo pago).
    const patch = await fetch(`${base}/api/companies/free_proj`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t_chat' }, body: JSON.stringify({ isPublicInVitrine: true }) });
    assert.equal(patch.status, 200);
    assert.notEqual((await db.collection(COLLECTIONS.companies).doc('free_proj').get()).data().isPublicInVitrine, true);
    const enter = await fetch(`${base}/api/companies/free_proj/vitrine`, { method: 'POST', headers: { Authorization: 'Bearer t_chat' } });
    assert.equal(enter.status, 402);

    // Liga/desliga do post diário é exclusivo do admin.
    const userToggle = await fetch(`${base}/api/admin/settings/daily-posts`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t_chat' }, body: JSON.stringify({ dailyPostsEnabled: false }) });
    assert.equal(userToggle.status, 403);
    const adminToggle = await fetch(`${base}/api/admin/settings/daily-posts`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t_admin' }, body: JSON.stringify({ dailyPostsEnabled: false }) });
    assert.equal(adminToggle.status, 200);
    assert.equal((await adminToggle.json()).dailyPostsEnabled, false);

    // IA fora do ar: resposta de contingência não cobra.
    setTestChatReply(null);
    const fallback = await (await chat('t_chat', { messages: [{ role: 'user', content: 'Oi de novo' }] })).json();
    assert.equal(fallback.creditsUsed, 0);
    assert.equal((await getWallet('u_chat')).balance, 22);
  } finally {
    setTestChatReply(null);
    server.close();
  }
});
