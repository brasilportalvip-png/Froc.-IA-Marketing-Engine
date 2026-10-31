import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, firestore, resetMemoryDb } from '../server/production/store.js';
import { detectOfferPlatform, offerOf, safeOfferUrl } from '../server/production/appLinks.js';
import { buildDailyPostPrompt, createDailyPostForCompany } from '../server/production/vitrineDaily.js';
import { buildPostImagePrompt } from '../server/production/postImages.js';
import { handleRedirect } from '../server/production/redirects.js';
import { renderPublicPage } from '../server/production/publicPages.js';
import { executeConciergePlan, normalizeCollected } from '../server/production/concierge.js';

test('Afiliados: reconhece Hotmart, Kiwify, Amazon com tag e Shopee; loja comum não é afiliado', () => {
  assert.deepEqual(detectOfferPlatform('https://go.hotmart.com/A123?dp=1'), { platform: 'Hotmart', affiliate: true });
  assert.equal(detectOfferPlatform('pay.kiwify.com.br/abc').platform, 'Kiwify');
  assert.equal(detectOfferPlatform('https://www.amazon.com.br/dp/B0X?tag=meu-20').platform, 'Amazon');
  assert.equal(detectOfferPlatform('https://www.amazon.com.br/dp/B0X').affiliate, false, 'Amazon sem tag não é link de afiliado');
  assert.equal(detectOfferPlatform('https://shope.ee/abc').platform, 'Shopee');
  assert.equal(detectOfferPlatform('https://minhaloja.com.br/produto').affiliate, false);
});

test('Segurança: link de venda não aceita IP, localhost, usuário/senha nem protocolos estranhos', () => {
  assert.equal(safeOfferUrl('http://127.0.0.1/admin'), null);
  assert.equal(safeOfferUrl('https://localhost/x'), null);
  assert.equal(safeOfferUrl('https://user:pass@site.com'), null);
  assert.equal(safeOfferUrl('javascript:alert(1)'), null);
  assert.equal(safeOfferUrl('https://192.168.0.1'), null);
  assert.match(String(safeOfferUrl('go.hotmart.com/x')), /^https:\/\/go\.hotmart\.com\/x$/);
});

test('Produto digital é nacional por padrão e o post diário não fala de bairro', () => {
  const company = { id: 'd1', name: 'Curso Bolo Fácil', slug: 'curso-bolo', offerType: 'digital', salesUrl: 'https://pay.kiwify.com.br/xyz', city: 'Campinas', targeting: { city: 'Campinas', neighborhoods: ['Cambuí'] } };
  const offer = offerOf(company);
  assert.equal(offer.scope, 'nacional');
  assert.equal(offer.affiliate, true);
  const { prompt } = buildDailyPostPrompt(company, '2026-10-31');
  assert.match(prompt, /todo o Brasil/);
  assert.match(prompt, /NÃO use bairro, rua ou cidade/);
  assert.match(prompt, /LINK DE AFILIADO/);
  assert.match(prompt, /Proibido prometer renda/);
  assert.doesNotMatch(prompt, /Região-alvo para SEO local/);
  const local = buildDailyPostPrompt({ id: 'l1', name: 'Pizzaria', slug: 'p', targeting: { city: 'Campinas', neighborhoods: ['Cambuí'] } }, '2026-10-31').prompt;
  assert.match(local, /Região-alvo para SEO local: Cambuí, Campinas/);
  assert.match(buildPostImagePrompt({ company, title: 'Bolo de pote' }), /produto digital/);
  assert.doesNotMatch(buildPostImagePrompt({ company, title: 'Bolo de pote' }), /Região atendida/);
});

test('Vitrine: botão "Quero agora" com rel=sponsored, aviso de afiliado, clique contado e país como área atendida', async () => {
  resetMemoryDb();
  const db = firestore();
  const company = { id: 'af1', userId: 'u1', name: 'Fone Top Indica', slug: 'fone-top', isPublicInVitrine: true, vitrineBillingExempt: true, offerType: 'afiliado', salesUrl: 'https://amzn.to/abc123', description: 'Reviews de fones' };
  await db.collection(COLLECTIONS.companies).doc('af1').set(company);
  const page = await renderPublicPage('/vitrine/fone-top');
  assert.match(page.html, /href="\/ir\/fone-top\/oferta" rel="sponsored nofollow noopener"/);
  assert.match(page.html, /link de afiliado/);
  assert.match(page.html, /"areaServed":\[\{"@type":"Country","name":"Brasil"\}\]/);
  const post = (await createDailyPostForCompany(company, '2026-10-31')).post;
  const postPage = await renderPublicPage(`/vitrine/fone-top/${post.slug}`);
  assert.ok(postPage.html.includes(`/ir/fone-top/oferta?p=${post.id}`));
  const redirect = await handleRedirect('fone-top', 'oferta', 'Mozilla/5.0', post.id);
  assert.equal(redirect.location, 'https://amzn.to/abc123');
  const clicks = (await db.collection(COLLECTIONS.linkClicks).doc('af1').get()).data() as any;
  assert.equal(clicks.oferta, 1);
});

test('Concierge: salva tipo, alcance e link de afiliado da conversa', async () => {
  resetMemoryDb();
  const collected = normalizeCollected({ businessName: 'Mentoria Zap', offer: 'Mentoria de vendas no WhatsApp', offerType: 'digital', reachScope: 'nacional', salesUrl: 'https://go.hotmart.com/M1' });
  assert.equal(collected.isAffiliate, true);
  const outcome = await executeConciergePlan({ userId: 'u_dig', collected, actions: [] });
  const saved = (await firestore().collection(COLLECTIONS.companies).doc(outcome.company.id).get()).data() as any;
  assert.equal(saved.offerType, 'digital');
  assert.equal(saved.reachScope, 'nacional');
  assert.equal(saved.salesUrl, 'https://go.hotmart.com/M1');
  assert.equal(saved.businessType, 'online');
  assert.equal(saved.category, 'Produtos Digitais');
});
