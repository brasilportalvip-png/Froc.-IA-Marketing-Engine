import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, firestore, queryData, resetMemoryDb } from '../server/production/store.js';
import { backfillPostImages, buildPostImagePrompt, isGeneratedPostImage } from '../server/production/postImages.js';
import { appLinksOf, hasApp } from '../server/production/appLinks.js';
import { deviceOf, handleRedirect, resolveDestination } from '../server/production/redirects.js';
import { createDailyPostForCompany, buildDailyPostPrompt } from '../server/production/vitrineDaily.js';
import { executeConciergePlan } from '../server/production/concierge.js';
import { renderPublicPage } from '../server/production/publicPages.js';
import { voiceErrorMessage } from '../src/lib/voice/voiceText.js';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari';

test('Imagens: o briefing nasce do projeto (nicho, oferta, região) e da publicação, sem texto na arte', () => {
  const prompt = buildPostImagePrompt({
    company: { name: 'Pizzaria Rei', category: 'Alimentação', segment: 'Pizzaria', products: ['Pizza napolitana'], services: ['Delivery'], city: 'Campinas', targeting: { neighborhoods: ['Cambuí'] } },
    title: 'A melhor pizza do Cambuí', keyword: 'pizza em Campinas', angle: 'Guia local'
  });
  assert.match(prompt, /Pizzaria Rei/);
  assert.match(prompt, /Pizzaria/);
  assert.match(prompt, /Pizza napolitana, Delivery/);
  assert.match(prompt, /Cambuí/);
  assert.match(prompt, /A melhor pizza do Cambuí/);
  assert.match(prompt, /PROIBIDO: textos/);
  assert.equal(isGeneratedPostImage('https://x/og-froc.jpg'), false);
  assert.equal(isGeneratedPostImage('https://firebasestorage.googleapis.com/v0/b/x/o/y'), true);
});

test('Imagens: post diário já nasce com imagem própria e os antigos são completados', async () => {
  resetMemoryDb();
  const db = firestore();
  const company = { id: 'c1', userId: 'u1', name: 'Barbearia Coroa', slug: 'barbearia-coroa', category: 'Beleza', isPublicInVitrine: true };
  await db.collection(COLLECTIONS.companies).doc('c1').set(company);
  const created = await createDailyPostForCompany(company, '2026-10-30');
  assert.equal(created.created, true);
  assert.match(created.post.imageUrl, /^https:\/\/storage\.test\/posts\/vitrine\/c1\//);
  assert.equal(created.post.imageGenerated, true);
  assert.ok(created.post.imageAlt.includes('Barbearia Coroa'));

  await db.collection(COLLECTIONS.vitrinePosts).doc('old').set({ id: 'old', companyId: 'c1', title: 'Post antigo', slug: 'post-antigo', status: 'published', publishedAt: '2026-10-01T00:00:00.000Z', imageUrl: null });
  await db.collection(COLLECTIONS.blogPosts).doc('b1').set({ id: 'b1', title: 'Artigo antigo', slug: 'artigo-antigo', status: 'published', publishedAt: '2026-10-02T00:00:00.000Z', featuredImageUrl: 'https://site/og-froc.jpg' });
  const result = await backfillPostImages(5);
  assert.equal(result.generated, 2);
  assert.equal(result.pending, 0);
  const old = (await db.collection(COLLECTIONS.vitrinePosts).doc('old').get()).data() as any;
  assert.equal(old.imageGenerated, true);
  const blog = (await db.collection(COLLECTIONS.blogPosts).doc('b1').get()).data() as any;
  assert.match(blog.featuredImageUrl, /storage\.test\/posts\/magazine/);
  assert.equal((await backfillPostImages(5)).generated, 0, 'não refaz imagens já criadas');
});

test('Apps: só aceita links reais da Google Play e da App Store', () => {
  assert.deepEqual(appLinksOf({ androidApp: 'https://play.google.com/store/apps/details?id=com.x', iosApp: 'https://apps.apple.com/br/app/x/id1' }), {
    android: 'https://play.google.com/store/apps/details?id=com.x', ios: 'https://apps.apple.com/br/app/x/id1'
  });
  assert.deepEqual(appLinksOf({ androidApp: 'https://golpe.com/play.google.com', iosApp: 'javascript:alert(1)' }), { android: null, ios: null });
  assert.equal(hasApp({}), false);
});

test('Direcionamento: o botão do app leva cada aparelho para a loja certa', () => {
  const company = { website: 'https://pizzaria.com.br', whatsapp: '(19) 99999-0000', androidApp: 'https://play.google.com/store/apps/details?id=com.p', iosApp: 'https://apps.apple.com/br/app/p/id9' };
  assert.equal(deviceOf(ANDROID_UA), 'android');
  assert.equal(deviceOf(IPHONE_UA), 'ios');
  assert.equal(resolveDestination(company, 'app', ANDROID_UA)?.url, company.androidApp);
  assert.equal(resolveDestination(company, 'app', IPHONE_UA)?.url, company.iosApp);
  assert.equal(resolveDestination(company, 'site', ANDROID_UA)?.url, 'https://pizzaria.com.br/');
  assert.equal(resolveDestination(company, 'whatsapp', ANDROID_UA)?.url, 'https://wa.me/5519999990000');
  assert.equal(resolveDestination({ website: 'https://x.com' }, 'app', ANDROID_UA), null, 'sem app não inventa destino');
});

test('Direcionamento: conta cliques por canal e por post; marca fora da vitrine não redireciona', async () => {
  resetMemoryDb();
  const db = firestore();
  await db.collection(COLLECTIONS.companies).doc('c9').set({ id: 'c9', name: 'Loja', slug: 'loja', isPublicInVitrine: true, website: 'https://loja.com', androidApp: 'https://play.google.com/store/apps/details?id=com.loja' });
  await db.collection(COLLECTIONS.companies).doc('c8').set({ id: 'c8', name: 'Oculta', slug: 'oculta', isPublicInVitrine: false, website: 'https://oculta.com' });
  assert.equal((await handleRedirect('loja', 'app', ANDROID_UA, 'post1')).location, 'https://play.google.com/store/apps/details?id=com.loja');
  assert.equal((await handleRedirect('loja', 'site', IPHONE_UA, 'post1')).location, 'https://loja.com/');
  assert.match((await handleRedirect('loja', 'ios', IPHONE_UA)).location, /\/vitrine\/loja$/, 'sem App Store volta para a página da marca');
  assert.match((await handleRedirect('oculta', 'site', IPHONE_UA)).location, /\/vitrine$/);
  const clicks = (await db.collection(COLLECTIONS.linkClicks).doc('c9').get()).data() as any;
  assert.equal(clicks.total, 2);
  assert.equal(clicks.android, 1);
  assert.equal(clicks.site, 1);
  assert.equal(clicks.byPost.post1, 2);
});

test('Posts e páginas: app aparece no texto, nos botões e nos dados estruturados só para quem tem', async () => {
  resetMemoryDb();
  const db = firestore();
  const withApp = { id: 'a1', userId: 'u1', name: 'Delivery Já', slug: 'delivery-ja', isPublicInVitrine: true, website: 'https://deliveryja.com', androidApp: 'https://play.google.com/store/apps/details?id=com.dj' };
  const withoutApp = { id: 'a2', userId: 'u2', name: 'Café Sem App', slug: 'cafe-sem-app', isPublicInVitrine: true, website: 'https://cafe.com' };
  assert.match(buildDailyPostPrompt(withApp, '2026-10-30').prompt, /TEM aplicativo \(Google Play\)/);
  assert.doesNotMatch(buildDailyPostPrompt(withoutApp, '2026-10-30').prompt, /TEM aplicativo/);
  await db.collection(COLLECTIONS.companies).doc('a1').set(withApp);
  await db.collection(COLLECTIONS.companies).doc('a2').set(withoutApp);
  const post = (await createDailyPostForCompany(withApp, '2026-10-30')).post;
  const page = await renderPublicPage(`/vitrine/delivery-ja/${post.slug}`);
  assert.match(page.html, /"@type":"MobileApplication"/);
  assert.ok(page.html.includes(`/ir/delivery-ja/android?p=${post.id}`));
  assert.ok(page.html.includes(`/ir/delivery-ja/site?p=${post.id}`));
  assert.match(page.html, /<img src="https:\/\/storage\.test/);
  const noApp = await renderPublicPage('/vitrine/cafe-sem-app');
  assert.doesNotMatch(noApp.html, /MobileApplication/);
  assert.ok(noApp.html.includes('/ir/cafe-sem-app/site'));
});

test('Admin: cria quantos projetos quiser pela IA, mesmo no plano grátis', async () => {
  resetMemoryDb();
  for (let i = 0; i < 4; i += 1) {
    await executeConciergePlan({ userId: 'admin1', isAdmin: true, collected: { businessName: `Projeto ${i}` }, actions: [] });
  }
  const companies = queryData<any>(await firestore().collection(COLLECTIONS.companies).where('userId', '==', 'admin1').get());
  assert.equal(companies.length, 4);
  // Usuário comum no plano grátis continua limitado a 1 marca (a segunda atualiza a existente).
  await executeConciergePlan({ userId: 'user1', collected: { businessName: 'A' }, actions: [] });
  await executeConciergePlan({ userId: 'user1', collected: { businessName: 'B' }, actions: [] });
  assert.equal(queryData<any>(await firestore().collection(COLLECTIONS.companies).where('userId', '==', 'user1').get()).length, 1);
});

test('Microfone: mensagens de erro dizem o motivo e como resolver', () => {
  assert.match(voiceErrorMessage('not-allowed'), /cadeado/);
  assert.match(voiceErrorMessage('audio-capture'), /Nenhum microfone/);
  assert.match(voiceErrorMessage('network'), /Chrome/);
  assert.match(voiceErrorMessage('xyz'), /\(xyz\)/);
});
