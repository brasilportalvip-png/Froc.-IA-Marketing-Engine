import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, firestore, resetMemoryDb } from '../server/production/store.js';
import {
  buildGroupSitemapXml, buildRobotsTxt, buildRssFeed, buildSitemapIndexXml, buildSitemapTxt, buildSitemapXsl,
  escapeXml, indexNowKeyFromPath, parseSitemapPath, pingIndexNow, sitemapFileName, w3cDate
} from '../server/production/seoEngine.js';
import { markdownToSafeHtml, renderPublicPage } from '../server/production/publicPages.js';
import { config } from '../server/config/index.js';

const base = config.appUrl.replace(/\/$/, '');

async function seed() {
  resetMemoryDb();
  const db = firestore();
  await db.collection(COLLECTIONS.companies).doc('c_pub').set({ id: 'c_pub', userId: 'u1', name: 'Pizzaria Rei & Cia', slug: 'pizzaria-rei', isPublicInVitrine: true, logoUrl: 'https://cdn.example.com/logo.png', city: 'Campinas', state: 'SP', updatedAt: '2026-10-01T10:00:00.000Z', businessType: 'physical', targeting: { neighborhoods: ['Cambuí'], city: 'Campinas' } });
  await db.collection(COLLECTIONS.companies).doc('c_priv').set({ id: 'c_priv', userId: 'u2', name: 'Privada', slug: 'privada', isPublicInVitrine: false });
  await db.collection(COLLECTIONS.blogPosts).doc('b1').set({ id: 'b1', title: 'Artigo', slug: 'artigo-seo', status: 'published', publishedAt: '2026-10-02T10:00:00.000Z' });
  await db.collection(COLLECTIONS.blogPosts).doc('b2').set({ id: 'b2', title: 'Rascunho', slug: 'rascunho', status: 'draft' });
  await db.collection(COLLECTIONS.vitrinePosts).doc('c_pub_2026-10-30').set({ id: 'c_pub_2026-10-30', companyId: 'c_pub', companySlug: 'pizzaria-rei', slug: 'melhor-pizza-cambui-20261030', title: 'A melhor pizza do Cambuí', summary: 'Resumo', content: '## Título\n\nTexto <script>alert(1)</script>\n\n- item **forte**', faq: [{ question: 'Entrega?', answer: 'Sim, no Cambuí.' }], status: 'published', publishedAt: '2026-10-30T12:00:00.000Z' });
  await db.collection(COLLECTIONS.vitrinePosts).doc('c_priv_2026-10-30').set({ id: 'c_priv_2026-10-30', companyId: 'c_priv', companySlug: 'privada', slug: 'post-privado', title: 'Privado', status: 'published', publishedAt: '2026-10-30T12:00:00.000Z' });
}

test('SEO Engine: parseSitemapPath reconhece arquivos e paginação no padrão Yoast', () => {
  assert.deepEqual(parseSitemapPath('/post-sitemap.xml'), { group: 'post', page: 1 });
  assert.deepEqual(parseSitemapPath('/vitrine-post-sitemap2.xml'), { group: 'vitrine-post', page: 2 });
  assert.equal(parseSitemapPath('/post-sitemap1.xml'), null);
  assert.equal(parseSitemapPath('/post-sitemap0.xml'), null);
  assert.equal(parseSitemapPath('/hack-sitemap.xml'), null);
  assert.equal(sitemapFileName('page', 1), 'page-sitemap.xml');
  assert.equal(sitemapFileName('post', 3), 'post-sitemap3.xml');
});

test('SEO Engine: índice lista somente grupos com URLs e usa lastmod W3C', async () => {
  await seed();
  const xml = await buildSitemapIndexXml();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /main-sitemap\.xsl/);
  for (const file of ['page-sitemap.xml', 'post-sitemap.xml', 'vitrine-sitemap.xml', 'vitrine-post-sitemap.xml']) {
    assert.ok(xml.includes(`${base}/${file}`), `faltou ${file}`);
  }
  assert.match(xml, /<lastmod>2026-10-30T12:00:00\.000Z<\/lastmod>/);
});

test('SEO Engine: sitemaps de grupo respeitam visibilidade e incluem imagens', async () => {
  await seed();
  const vitrine = await buildGroupSitemapXml('vitrine');
  assert.ok(vitrine);
  assert.ok(vitrine!.includes(`${base}/vitrine/pizzaria-rei`));
  assert.ok(!vitrine!.includes('/vitrine/privada'));
  assert.match(vitrine!, /<image:loc>https:\/\/cdn\.example\.com\/logo\.png<\/image:loc>/);

  const posts = await buildGroupSitemapXml('vitrine-post');
  assert.ok(posts!.includes(`${base}/vitrine/pizzaria-rei/melhor-pizza-cambui-20261030`));
  assert.ok(!posts!.includes('post-privado'), 'post de empresa fora da vitrine não pode ser indexado');

  const blog = await buildGroupSitemapXml('post');
  assert.ok(blog!.includes('/blog/artigo-seo'));
  assert.ok(!blog!.includes('rascunho'));

  assert.equal(await buildGroupSitemapXml('post', 2), null);
});

test('SEO Engine: sitemap.txt, robots.txt, RSS e XSL', async () => {
  await seed();
  const txt = await buildSitemapTxt();
  const lines = txt.trim().split('\n');
  assert.ok(lines.every((line) => line.startsWith(`${base}/`)));
  assert.equal(new Set(lines).size, lines.length);
  assert.ok(lines.includes(`${base}/vitrine/pizzaria-rei`));

  const robots = buildRobotsTxt();
  assert.match(robots, /Sitemap: .*\/sitemap_index\.xml/);
  assert.match(robots, /Sitemap: .*\/sitemap\.txt/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/admin/);

  const rss = await buildRssFeed();
  assert.match(rss, /<rss version="2\.0"/);
  assert.ok(rss.includes('A melhor pizza do Cambuí'));

  assert.match(buildSitemapXsl(), /xsl:stylesheet/);
});

test('SEO Engine: utilitários e IndexNow', async () => {
  assert.equal(escapeXml(`a&b<c>"d"'e`), 'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e');
  assert.equal(w3cDate('data inválida'), '');
  assert.equal(indexNowKeyFromPath('/indexnow-key.txt'), config.seoEngine.indexNowKey);
  assert.equal(indexNowKeyFromPath('/outra.txt'), null);
  const ping = await pingIndexNow([`${base}/vitrine`], 'test');
  assert.equal(ping.status, 'skipped', 'fora de produção nunca faz chamada externa');
  const invalid = await pingIndexNow(['https://site-de-terceiros.com/x'], 'test');
  assert.equal(invalid.submitted, 0);
});

test('Páginas públicas: post diário pré-renderizado com Schema FAQ, Breadcrumb e LocalBusiness', async () => {
  await seed();
  const page = await renderPublicPage('/vitrine/pizzaria-rei/melhor-pizza-cambui-20261030');
  assert.equal(page.status, 200);
  assert.match(page.html, /<link rel="canonical" href="[^"]+\/vitrine\/pizzaria-rei\/melhor-pizza-cambui-20261030"/);
  assert.match(page.html, /"@type":"FAQPage"/);
  assert.match(page.html, /"@type":"BreadcrumbList"/);
  assert.match(page.html, /"@type":"BlogPosting"/);
  assert.match(page.html, /"@type":"LocalBusiness"/);
  assert.match(page.html, /<h1>A melhor pizza do Cambuí<\/h1>/);
  assert.ok(!page.html.includes('<script>alert(1)</script>'), 'conteúdo deve ser escapado');
  assert.match(page.html, /name="google-site-verification"/);

  const wrongCompany = await renderPublicPage('/vitrine/privada/post-privado');
  assert.equal(wrongCompany.status, 404);
  assert.match(wrongCompany.html, /noindex,follow/);

  const companyPage = await renderPublicPage('/vitrine/pizzaria-rei');
  assert.equal(companyPage.status, 200);
  assert.ok(companyPage.html.includes('/vitrine/pizzaria-rei/melhor-pizza-cambui-20261030'));
  assert.match(companyPage.html, /"areaServed"/);
});

test('Markdown seguro: escapa HTML antes de formatar', () => {
  const html = markdownToSafeHtml('## Olá\n\n<img src=x onerror=alert(1)>\n\n- **um**\n- dois');
  assert.match(html, /<h2>Olá<\/h2>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /<ul><li><strong>um<\/strong><\/li><li>dois<\/li><\/ul>/);
});
