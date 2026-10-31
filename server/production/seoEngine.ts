/**
 * Froc.IA — Motor de SEO técnico (sitemaps, robots, feed e IndexNow).
 *
 * Estrutura compatível com o padrão do Yoast SEO (WordPress) e com as regras
 * do Google Search Console:
 *   /sitemap_index.xml            → índice de sitemaps (também servido em /sitemap.xml)
 *   /page-sitemap.xml             → páginas institucionais
 *   /post-sitemap.xml             → artigos do Froc Magazine (paginação: post-sitemap2.xml…)
 *   /vitrine-sitemap.xml          → empresas da vitrine (com image:image do logo)
 *   /vitrine-post-sitemap.xml     → posts diários da vitrine
 *   /sitemap.txt                  → lista simples de URLs (formato texto aceito pelo Google)
 *   /main-sitemap.xsl             → folha de estilo para leitura humana dos sitemaps
 *   /feed.xml                     → RSS 2.0 com os conteúdos mais recentes
 *   /indexnow-key.txt             → arquivo de verificação IndexNow (keyLocation)
 *
 * Regras respeitadas: máx. 50.000 URLs e 50 MB por arquivo (usamos 1.000 por arquivo,
 * como o Yoast), URLs absolutas e canônicas, <lastmod> em W3C Datetime, entidades XML
 * escapadas, somente páginas indexáveis (status 200, sem noindex) nos sitemaps.
 * Observação: o Google desativou o endpoint de "ping" de sitemap em 2023; a descoberta
 * pelo Google ocorre via robots.txt + Search Console. Para os demais buscadores usamos
 * IndexNow, que notifica Bing, Yandex, Seznam, Naver e Yep em uma única chamada.
 */
import { config } from '../config/index.js';
import { COLLECTIONS, firestore, newId, nowIso, queryData } from './store.js';

export type SitemapGroup = 'page' | 'post' | 'vitrine' | 'vitrine-post';
export const SITEMAP_GROUPS: SitemapGroup[] = ['page', 'post', 'vitrine', 'vitrine-post'];

export interface SitemapImage { loc: string; title?: string }
export interface SitemapEntry { loc: string; lastmod?: string; images?: SitemapImage[]; title?: string; description?: string }

export const PRIVATE_PATHS = [
  '/api/', '/admin', '/dashboard', '/empresa', '/froc-ia', '/autopilot', '/criar-conteudo', '/criar-imagem',
  '/criar-video', '/criar-artigo', '/seo', '/campanhas', '/calendario', '/redes-sociais', '/conteudos',
  '/analytics', '/creditos', '/perfil', '/configuracoes', '/suporte'
];

export function baseUrl(): string {
  return config.appUrl.replace(/\/$/, '');
}

export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function w3cDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function absoluteUrl(value?: string | null): string {
  if (!value) return '';
  try {
    const url = new URL(value, baseUrl());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function isPublicCompany(item: any): boolean {
  return item?.isPublicInVitrine === true || item?.isPublicInVitrine === 'true';
}

function newest(entries: SitemapEntry[]): string {
  return entries.reduce((max, entry) => {
    const value = w3cDate(entry.lastmod);
    return value > max ? value : max;
  }, '');
}

/** Coleta todas as URLs indexáveis do site, agrupadas como no Yoast SEO. */
export async function collectSitemapGroups(): Promise<Record<SitemapGroup, SitemapEntry[]>> {
  const base = baseUrl();
  const groups: Record<SitemapGroup, SitemapEntry[]> = {
    page: [
      { loc: `${base}/` },
      { loc: `${base}/posts` },
      { loc: `${base}/vitrine` },
      { loc: `${base}/blog` },
      { loc: `${base}/planos` },
      { loc: `${base}/termos` },
      { loc: `${base}/privacidade` }
    ],
    post: [],
    vitrine: [],
    'vitrine-post': []
  };

  try {
    const db = firestore();
    const [blogSnap, companiesSnap, vitrinePostsSnap] = await Promise.all([
      db.collection(COLLECTIONS.blogPosts).where('status', '==', 'published').get(),
      db.collection(COLLECTIONS.companies).get(),
      db.collection(COLLECTIONS.vitrinePosts).where('status', '==', 'published').get()
    ]);

    for (const post of queryData<any>(blogSnap)) {
      if (!post.slug) continue;
      groups.post.push({
        loc: `${base}/blog/${encodeURIComponent(post.slug)}`,
        lastmod: post.updatedAt || post.publishedAt || post.createdAt,
        title: post.title,
        description: post.summary,
        images: post.featuredImageUrl ? [{ loc: absoluteUrl(post.featuredImageUrl), title: post.title }] : undefined
      });
    }

    const publicCompanies = new Map<string, any>();
    for (const company of queryData<any>(companiesSnap)) {
      if (!isPublicCompany(company) || !company.slug) continue;
      publicCompanies.set(company.id, company);
      groups.vitrine.push({
        loc: `${base}/vitrine/${encodeURIComponent(company.slug)}`,
        lastmod: company.updatedAt || company.createdAt,
        title: company.name,
        description: company.description,
        images: company.logoUrl ? [{ loc: absoluteUrl(company.logoUrl), title: company.name }] : undefined
      });
    }

    for (const post of queryData<any>(vitrinePostsSnap)) {
      const company = publicCompanies.get(post.companyId);
      // Post de empresa que saiu da vitrine não deve ser indexado.
      if (!company || !post.slug) continue;
      groups['vitrine-post'].push({
        loc: `${base}/vitrine/${encodeURIComponent(company.slug)}/${encodeURIComponent(post.slug)}`,
        lastmod: post.updatedAt || post.publishedAt || post.createdAt,
        title: post.title,
        description: post.summary,
        images: post.imageUrl ? [{ loc: absoluteUrl(post.imageUrl), title: post.title }] : undefined
      });
    }
  } catch (error) {
    console.warn('[Froc SEO] Dados dinâmicos indisponíveis; servindo apenas páginas base.', error instanceof Error ? error.message : error);
  }

  for (const group of SITEMAP_GROUPS) {
    groups[group].sort((a, b) => w3cDate(b.lastmod).localeCompare(w3cDate(a.lastmod)));
    for (const entry of groups[group]) {
      entry.images = entry.images?.filter((image) => Boolean(image.loc));
    }
  }
  return groups;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (!items.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function sitemapFileName(group: SitemapGroup, page: number): string {
  return `${group}-sitemap${page > 1 ? page : ''}.xml`;
}

const XSL_PI = '<?xml-stylesheet type="text/xsl" href="/main-sitemap.xsl"?>';

export async function buildSitemapIndexXml(): Promise<string> {
  const base = baseUrl();
  const groups = await collectSitemapGroups();
  const size = config.seoEngine.urlsPerSitemap;
  const items: string[] = [];
  for (const group of SITEMAP_GROUPS) {
    chunk(groups[group], size).forEach((entries, index) => {
      const lastmod = newest(entries);
      items.push(`\t<sitemap>\n\t\t<loc>${escapeXml(`${base}/${sitemapFileName(group, index + 1)}`)}</loc>${lastmod ? `\n\t\t<lastmod>${lastmod}</lastmod>` : ''}\n\t</sitemap>`);
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>${XSL_PI}\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n<!-- Froc.IA SEO Engine -->\n`;
}

/** Retorna null quando o arquivo/página não existe (deve responder 404). */
export async function buildGroupSitemapXml(group: SitemapGroup, page = 1): Promise<string | null> {
  const groups = await collectSitemapGroups();
  const pages = chunk(groups[group], config.seoEngine.urlsPerSitemap);
  const entries = pages[page - 1];
  if (!entries) return null;
  const body = entries.map((entry) => {
    const lastmod = w3cDate(entry.lastmod);
    const images = (entry.images || []).map((image) => `\n\t\t<image:image>\n\t\t\t<image:loc>${escapeXml(image.loc)}</image:loc>\n\t\t</image:image>`).join('');
    return `\t<url>\n\t\t<loc>${escapeXml(entry.loc)}</loc>${lastmod ? `\n\t\t<lastmod>${lastmod}</lastmod>` : ''}${images}\n\t</url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>${XSL_PI}\n<urlset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd http://www.google.com/schemas/sitemap-image/1.1 http://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n<!-- Froc.IA SEO Engine -->\n`;
}

/** Reconhece /post-sitemap.xml, /post-sitemap2.xml etc. */
export function parseSitemapPath(pathname: string): { group: SitemapGroup; page: number } | null {
  const match = /^\/(page|post|vitrine|vitrine-post)-sitemap(\d*)\.xml$/.exec(pathname);
  if (!match) return null;
  const page = match[2] ? Number(match[2]) : 1;
  if (!Number.isSafeInteger(page) || page < 1 || (match[2] && page === 1) || /^0/.test(match[2])) return null;
  return { group: match[1] as SitemapGroup, page };
}

export async function buildSitemapTxt(): Promise<string> {
  const groups = await collectSitemapGroups();
  const urls = SITEMAP_GROUPS.flatMap((group) => groups[group].map((entry) => entry.loc));
  return `${[...new Set(urls)].slice(0, 50_000).join('\n')}\n`;
}

export function buildRobotsTxt(): string {
  const base = baseUrl();
  return `# Froc.IA — robots.txt
User-agent: *
Allow: /
Allow: /posts
Allow: /blog
Allow: /vitrine
Allow: /planos
Allow: /termos
Allow: /privacidade
${PRIVATE_PATHS.map((path) => `Disallow: ${path}`).join('\n')}

Sitemap: ${base}/sitemap_index.xml
Sitemap: ${base}/sitemap.txt
`;
}

export async function buildRssFeed(): Promise<string> {
  const base = baseUrl();
  const groups = await collectSitemapGroups();
  const items = [...groups.post, ...groups['vitrine-post']]
    .sort((a, b) => w3cDate(b.lastmod).localeCompare(w3cDate(a.lastmod)))
    .slice(0, 50);
  const body = items.map((item) => {
    const date = w3cDate(item.lastmod);
    return `\t<item>\n\t\t<title>${escapeXml(item.title || item.loc)}</title>\n\t\t<link>${escapeXml(item.loc)}</link>\n\t\t<guid isPermaLink="true">${escapeXml(item.loc)}</guid>${date ? `\n\t\t<pubDate>${new Date(date).toUTCString()}</pubDate>` : ''}\n\t\t<description>${escapeXml(item.description || '')}</description>\n\t</item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n\t<title>Froc.IA — Vitrine e Magazine</title>\n\t<link>${escapeXml(base)}/</link>\n\t<atom:link href="${escapeXml(base)}/feed.xml" rel="self" type="application/rss+xml" />\n\t<description>Conteúdos diários da Vitrine Froc.IA e do Froc Magazine.</description>\n\t<language>pt-BR</language>\n${body}\n</channel>\n</rss>\n`;
}

export function buildSitemapXsl(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" xmlns:html="http://www.w3.org/TR/REC-html40" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
<xsl:template match="/">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Sitemap XML — Froc.IA</title><meta name="robots" content="noindex,follow"/>
<style>body{font-family:system-ui,sans-serif;background:#050505;color:#f5f5f5;margin:0;padding:32px}h1{color:#FFD400}p{color:#a3a3a3}a{color:#FF2D87;text-decoration:none}table{border-collapse:collapse;width:100%;margin-top:16px}th{text-align:left;color:#00E676;border-bottom:1px solid #333;padding:8px}td{padding:8px;border-bottom:1px solid #1f1f1f;font-size:13px}tr:hover td{background:#111}</style></head>
<body><h1>Sitemap XML — Froc.IA</h1><p>Gerado pelo Froc.IA SEO Engine. Este arquivo é destinado aos mecanismos de busca (Google, Bing e outros).</p>
<xsl:if test="count(sitemap:sitemapindex/sitemap:sitemap) &gt; 0"><table><tr><th>Sitemap</th><th>Última modificação</th></tr>
<xsl:for-each select="sitemap:sitemapindex/sitemap:sitemap"><tr><td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td><td><xsl:value-of select="sitemap:lastmod"/></td></tr></xsl:for-each></table></xsl:if>
<xsl:if test="count(sitemap:urlset/sitemap:url) &gt; 0"><p>Total de URLs: <xsl:value-of select="count(sitemap:urlset/sitemap:url)"/></p><table><tr><th>URL</th><th>Imagens</th><th>Última modificação</th></tr>
<xsl:for-each select="sitemap:urlset/sitemap:url"><tr><td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td><td><xsl:value-of select="count(image:image)"/></td><td><xsl:value-of select="sitemap:lastmod"/></td></tr></xsl:for-each></table></xsl:if>
</body></html></xsl:template></xsl:stylesheet>
`;
}

export function isValidIndexNowKey(key: string): boolean {
  return /^[a-zA-Z0-9-]{8,128}$/.test(key);
}

export function indexNowKeyFromPath(pathname: string): string | null {
  const key = config.seoEngine.indexNowKey;
  if (!key || !isValidIndexNowKey(key)) return null;
  return pathname === '/indexnow-key.txt' ? key : null;
}

/**
 * Notifica os buscadores participantes do IndexNow sobre URLs novas/alteradas.
 * Nunca lança erro: falha de ping não pode derrubar publicação de conteúdo.
 */
export async function pingIndexNow(urls: string[], reason = 'content_update'): Promise<{ submitted: number; status: number | 'skipped' | 'error'; message?: string }> {
  const key = config.seoEngine.indexNowKey;
  const base = baseUrl();
  const clean = [...new Set(urls.filter((url) => typeof url === 'string' && url.startsWith(`${base}/`)))].slice(0, 10_000);
  if (!clean.length) return { submitted: 0, status: 'skipped', message: 'Nenhuma URL válida.' };
  if (!config.seoEngine.indexNowEnabled || !key || !isValidIndexNowKey(key)) return { submitted: 0, status: 'skipped', message: 'IndexNow não configurado.' };
  if (!config.isProduction || !/^https:\/\//.test(base)) return { submitted: 0, status: 'skipped', message: 'Ping só é enviado em produção com HTTPS.' };

  let status: number | 'error' = 'error';
  let message = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(base).host, key, keyLocation: `${base}/indexnow-key.txt`, urlList: clean }),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    status = response.status;
    message = response.ok ? 'URLs enviadas ao IndexNow.' : `IndexNow respondeu HTTP ${response.status}.`;
  } catch (error) {
    message = error instanceof Error ? error.message.slice(0, 300) : 'Falha desconhecida.';
  }

  try {
    const id = newId('ping');
    await firestore().collection(COLLECTIONS.seoPings).doc(id).set({ id, provider: 'indexnow', reason, urls: clean.slice(0, 50), urlCount: clean.length, status, message, createdAt: nowIso() });
  } catch { /* log de ping é best-effort */ }
  return { submitted: typeof status === 'number' && status < 300 ? clean.length : 0, status, message };
}

export async function getSeoEngineStatus() {
  const groups = await collectSitemapGroups();
  let lastPings: any[] = [];
  try {
    const snap = await firestore().collection(COLLECTIONS.seoPings).get();
    lastPings = queryData<any>(snap).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 10);
  } catch { /* opcional */ }
  const base = baseUrl();
  return {
    sitemapIndex: `${base}/sitemap_index.xml`,
    sitemapTxt: `${base}/sitemap.txt`,
    feed: `${base}/feed.xml`,
    counts: Object.fromEntries(SITEMAP_GROUPS.map((group) => [group, groups[group].length])),
    totalUrls: SITEMAP_GROUPS.reduce((sum, group) => sum + groups[group].length, 0),
    indexNow: {
      configured: Boolean(config.seoEngine.indexNowKey && isValidIndexNowKey(config.seoEngine.indexNowKey)),
      enabled: config.seoEngine.indexNowEnabled,
      keyLocation: config.seoEngine.indexNowKey ? `${base}/indexnow-key.txt` : null
    },
    lastPings
  };
}

export async function allIndexableUrls(): Promise<string[]> {
  const groups = await collectSitemapGroups();
  return SITEMAP_GROUPS.flatMap((group) => groups[group].map((entry) => entry.loc));
}
