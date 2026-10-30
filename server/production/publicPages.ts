import { config } from '../config/index.js';
import { COLLECTIONS, firestore, queryData } from './store.js';

function esc(value: any): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function jsonLd(value: any): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
function absolute(value?: string): string {
  if (!value) return `${config.appUrl}/og-froc.jpg`;
  try { return new URL(value, config.appUrl).toString(); } catch { return `${config.appUrl}/og-froc.jpg`; }
}
function description(value: any, fallback: string): string {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 180);
}
function isPublic(company: any): boolean {
  return company?.isPublicInVitrine === true || company?.isPublicInVitrine === 'true';
}

/** Conversor Markdown → HTML seguro (escapa tudo antes de formatar). */
export function markdownToSafeHtml(markdown: string): string {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let list: string[] = [];
  const inline = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<em>$2</em>');
  const flush = () => { if (list.length) { out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`); list = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { flush(); const level = Math.min(Math.max(heading[1].length, 2), 4); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const item = /^[-*•]\s+(.*)$/.exec(line) || /^\d+[.)]\s+(.*)$/.exec(line);
    if (item) { list.push(item[1]); continue; }
    flush();
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n');
}

interface PublicMeta {
  title: string;
  description: string;
  canonical: string;
  image: string;
  type: 'website' | 'article';
  status: number;
  schema: any[];
  prerender?: string;
  publishedTime?: string;
  modifiedTime?: string;
}

function breadcrumb(base: string, items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Início', url: `${base}/` }, ...items].map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url }))
  };
}

function companySchema(company: any, canonical: string) {
  const t = company.targeting || {};
  const areaServed = [...(t.neighborhoods || []), t.city || company.city, t.state || company.state].filter(Boolean).map((name: string) => ({ '@type': 'Place', name }));
  return {
    '@context': 'https://schema.org',
    '@type': company.businessType === 'online' ? 'OnlineBusiness' : company.businessType === 'physical' ? 'LocalBusiness' : 'Organization',
    '@id': `${canonical}#org`,
    name: company.name, url: company.website || canonical,
    description: company.description || undefined, logo: company.logoUrl || undefined, image: company.logoUrl || undefined,
    email: company.email || undefined, telephone: company.phone || company.whatsapp || undefined,
    address: company.businessType !== 'online' && (company.address || company.city) ? { '@type': 'PostalAddress', streetAddress: company.address || undefined, addressLocality: company.city || undefined, addressRegion: company.state || undefined, addressCountry: company.country || 'BR' } : undefined,
    areaServed: areaServed.length ? areaServed : undefined,
    sameAs: Object.values(company.socialLinks || {}).filter(Boolean)
  };
}

async function findPublicCompany(slug: string): Promise<any | null> {
  const snap = await firestore().collection(COLLECTIONS.companies).where('slug', '==', slug).limit(1).get();
  if (snap.empty) return null;
  const company = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
  return isPublic(company) ? company : null;
}

async function metaFor(pathname: string): Promise<PublicMeta> {
  const base = config.appUrl.replace(/\/$/, '');
  const website = {
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'Froc.IA', url: `${base}/`, inLanguage: 'pt-BR',
    publisher: { '@type': 'Organization', name: 'Froc.IA', url: `${base}/`, logo: { '@type': 'ImageObject', url: `${base}/brand/logo-froc-1024.png` } }
  };
  const fallback: PublicMeta = {
    title: 'Froc.IA — A IA que traz clientes pelo Google e redes sociais',
    description: 'Converse com a Froc.IA e ela cria seus anúncios, posts diários, SEO local por cidade e bairro e coloca sua marca na Vitrine. Tráfego orgânico sem complicação.',
    canonical: `${base}${pathname === '/' ? '/' : pathname}`,
    image: `${base}/og-froc.jpg`, type: 'website', status: 200,
    schema: [website, { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Froc.IA', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: `${base}/`, offers: { '@type': 'AggregateOffer', priceCurrency: 'BRL', lowPrice: '49.00', highPrice: '399.90' } }],
    prerender: `<h1>Froc.IA — inteligência artificial que traz clientes</h1><p>Converse com a IA, diga o que você vende e onde estão seus clientes (país, cidade, bairro ou rua). A Froc.IA cria o anúncio, publica um post estratégico por dia na Vitrine e otimiza tudo para o Google.</p><p><a href="/vitrine">Ver a Vitrine Froc.IA</a> · <a href="/planos">Planos</a> · <a href="/blog">Froc Magazine</a></p>`
  };

  if (pathname === '/vitrine') {
    let prerender = '<h1>Vitrine Froc.IA</h1><p>Marcas que estão crescendo com tráfego orgânico e conteúdo diário.</p>';
    const items: any[] = [];
    try {
      const companies = queryData<any>(await firestore().collection(COLLECTIONS.companies).get()).filter((c) => isPublic(c) && c.slug).slice(0, 200);
      prerender += `<ul>${companies.map((c) => { items.push({ name: c.name, url: `${base}/vitrine/${encodeURIComponent(c.slug)}` }); return `<li><a href="/vitrine/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>${c.city ? ` — ${esc(c.city)}` : ''}: ${esc(description(c.description, ''))}</li>`; }).join('')}</ul>`;
    } catch { /* fallback sem lista */ }
    return {
      ...fallback, title: 'Vitrine Froc.IA — Marcas em destaque com tráfego orgânico', description: 'A vitrine mais desejada do marketing digital: marcas em destaque, posts diários estratégicos e SEO local. Coloque seu site aqui.',
      schema: [website, breadcrumb(base, [{ name: 'Vitrine', url: `${base}/vitrine` }]), { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Vitrine Froc.IA', itemListElement: items.slice(0, 100).map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, url: item.url })) }],
      prerender
    };
  }
  if (pathname === '/blog') return { ...fallback, title: 'Froc Magazine — Marketing, IA e crescimento', description: 'Artigos publicados no Froc Magazine sobre marketing, inteligência artificial, SEO, conteúdo e crescimento.', schema: [website, breadcrumb(base, [{ name: 'Froc Magazine', url: `${base}/blog` }])], prerender: '<h1>Froc Magazine</h1><p>Marketing, IA, SEO e crescimento.</p>' };
  if (pathname === '/planos') return { ...fallback, title: 'Planos Froc.IA — Créditos e automação de marketing', description: 'Conheça os planos oficiais Froc.IA e seus créditos para conteúdo, IA, SEO, campanhas e Autopilot.', schema: [website, breadcrumb(base, [{ name: 'Planos', url: `${base}/planos` }])], prerender: `<h1>Planos Froc.IA</h1><ul>${config.plans.map((plan) => `<li>${esc(plan.name)} — R$ ${plan.price.toFixed(2).replace('.', ',')}/${esc(plan.period)}: ${esc(plan.features.join(', '))}</li>`).join('')}</ul>` };
  if (pathname === '/termos') return { ...fallback, title: 'Termos de Uso — Froc.IA', description: 'Termos de uso do Froc.IA para conta, inteligência artificial, créditos, assinaturas, integrações e Autopilot.', prerender: '' };
  if (pathname === '/privacidade') return { ...fallback, title: 'Política de Privacidade — Froc.IA', description: 'Política de privacidade do Froc.IA e informações sobre dados de conta, integrações, pagamentos e inteligência artificial.', prerender: '' };

  const notFound = (what: string): PublicMeta => ({ ...fallback, status: 404, title: `${what} não encontrado — Froc.IA`, description: `Este conteúdo não está disponível na Froc.IA.`, schema: [website], prerender: `<h1>${what} não encontrado</h1><p><a href="/vitrine">Voltar para a Vitrine</a></p>` });

  const vitrinePostMatch = pathname.match(/^\/vitrine\/([^/]+)\/([^/]+)$/);
  if (vitrinePostMatch) {
    try {
      const company = await findPublicCompany(decodeURIComponent(vitrinePostMatch[1]));
      if (!company) return notFound('Post');
      const snap = await firestore().collection(COLLECTIONS.vitrinePosts).where('slug', '==', decodeURIComponent(vitrinePostMatch[2])).limit(1).get();
      if (snap.empty) return notFound('Post');
      const post = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
      if (post.companyId !== company.id || post.status !== 'published') return notFound('Post');
      const companyUrl = `${base}/vitrine/${encodeURIComponent(company.slug)}`;
      const canonical = `${companyUrl}/${encodeURIComponent(post.slug)}`;
      const faq = Array.isArray(post.faq) ? post.faq.filter((item: any) => item?.question && item?.answer) : [];
      const schema: any[] = [
        website,
        breadcrumb(base, [{ name: 'Vitrine', url: `${base}/vitrine` }, { name: company.name, url: companyUrl }, { name: post.title, url: canonical }]),
        {
          '@context': 'https://schema.org', '@type': 'BlogPosting', headline: String(post.title).slice(0, 110), description: post.summary,
          image: [absolute(post.imageUrl || company.logoUrl)], datePublished: post.publishedAt, dateModified: post.updatedAt || post.publishedAt,
          author: { '@type': 'Organization', name: company.name, url: companyUrl }, publisher: { '@type': 'Organization', name: 'Froc.IA', logo: { '@type': 'ImageObject', url: `${base}/brand/logo-froc-1024.png` } },
          mainEntityOfPage: canonical, keywords: Array.isArray(post.keywords) ? post.keywords.join(', ') : undefined, inLanguage: 'pt-BR',
          about: { '@id': `${companyUrl}#org` }
        },
        companySchema(company, companyUrl)
      ];
      if (faq.length) schema.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((item: any) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
      return {
        title: `${post.title} | ${company.name}`.slice(0, 70), description: description(post.summary, `${company.name} na Vitrine Froc.IA.`), canonical,
        image: absolute(post.imageUrl || company.logoUrl), type: 'article', status: 200, schema, publishedTime: post.publishedAt, modifiedTime: post.updatedAt || post.publishedAt,
        prerender: `<article><nav><a href="/vitrine">Vitrine</a> › <a href="/vitrine/${encodeURIComponent(company.slug)}">${esc(company.name)}</a></nav><h1>${esc(post.title)}</h1><p>${esc(post.summary)}</p>${markdownToSafeHtml(post.content)}${faq.length ? `<h2>Perguntas frequentes</h2>${faq.map((item: any) => `<h3>${esc(item.question)}</h3><p>${esc(item.answer)}</p>`).join('')}` : ''}</article>`
      };
    } catch {
      return fallback;
    }
  }

  const vitrineMatch = pathname.match(/^\/vitrine\/([^/]+)$/);
  if (vitrineMatch) {
    try {
      const company = await findPublicCompany(decodeURIComponent(vitrineMatch[1]));
      if (!company) return { ...notFound('Empresa'), title: 'Empresa não encontrada — Froc.IA', description: 'Esta empresa não está disponível na Vitrine Froc.IA.' };
      const canonical = `${base}/vitrine/${encodeURIComponent(company.slug)}`;
      let postsHtml = '';
      try {
        const posts = queryData<any>(await firestore().collection(COLLECTIONS.vitrinePosts).where('companyId', '==', company.id).get())
          .filter((p) => p.status === 'published').sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 30);
        if (posts.length) postsHtml = `<h2>Publicações de ${esc(company.name)}</h2><ul>${posts.map((p) => `<li><a href="/vitrine/${encodeURIComponent(company.slug)}/${encodeURIComponent(p.slug)}">${esc(p.title)}</a></li>`).join('')}</ul>`;
      } catch { /* sem posts */ }
      return {
        title: `${company.name}${company.city ? ` em ${company.city}` : ''} — Vitrine Froc.IA`.slice(0, 70),
        description: description(company.description, `${company.name} na Vitrine Froc.IA.`),
        canonical, image: absolute(company.logoUrl), type: 'website', status: 200,
        schema: [website, breadcrumb(base, [{ name: 'Vitrine', url: `${base}/vitrine` }, { name: company.name, url: canonical }]), companySchema(company, canonical)],
        prerender: `<h1>${esc(company.name)}</h1><p>${esc(company.description || '')}</p>${company.city ? `<p>${esc([company.city, company.state].filter(Boolean).join(' - '))}</p>` : ''}${company.website ? `<p><a href="${esc(company.website)}" rel="noopener">Site oficial</a></p>` : ''}${postsHtml}`
      };
    } catch {
      return fallback;
    }
  }

  const blogMatch = pathname.match(/^\/blog\/([^/]+)$/);
  if (blogMatch) {
    try {
      const slug = decodeURIComponent(blogMatch[1]);
      const snap = await firestore().collection(COLLECTIONS.blogPosts).where('slug', '==', slug).where('status', '==', 'published').limit(1).get();
      if (snap.empty) return { ...notFound('Artigo'), title: 'Artigo não encontrado — Froc.IA', description: 'Este artigo não está disponível no Froc Magazine.' };
      const post = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
      const canonical = `${base}/blog/${encodeURIComponent(post.slug)}`;
      return {
        title: post.seoTitle || `${post.title} — Froc Magazine`,
        description: description(post.seoDescription || post.summary, 'Artigo do Froc Magazine.'),
        canonical, image: absolute(post.featuredImageUrl), type: 'article', status: 200, publishedTime: post.publishedAt || post.createdAt, modifiedTime: post.updatedAt || post.publishedAt,
        schema: [website, breadcrumb(base, [{ name: 'Froc Magazine', url: `${base}/blog` }, { name: post.title, url: canonical }]), {
          '@context': 'https://schema.org', '@type': 'Article', headline: post.title, description: post.summary || post.seoDescription,
          image: post.featuredImageUrl ? [absolute(post.featuredImageUrl)] : undefined,
          datePublished: post.publishedAt || post.createdAt, dateModified: post.updatedAt || post.publishedAt || post.createdAt,
          author: { '@type': 'Organization', name: post.author || 'Equipe Froc.IA' },
          publisher: { '@type': 'Organization', name: 'Froc.IA', logo: { '@type': 'ImageObject', url: `${base}/brand/logo-froc-1024.png` } },
          mainEntityOfPage: canonical
        }],
        prerender: `<article><h1>${esc(post.title)}</h1><p>${esc(post.summary || '')}</p>${markdownToSafeHtml(post.content)}</article>`
      };
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export async function renderPublicPage(pathname: string): Promise<{ html: string; status: number }> {
  const meta = await metaFor(pathname);
  const base = config.appUrl.replace(/\/$/, '');
  const robots = meta.status === 404
    ? '<meta name="robots" content="noindex,follow" />'
    : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />';
  const bing = config.seoEngine.bingSiteVerification ? `\n<meta name="msvalidate.01" content="${esc(config.seoEngine.bingSiteVerification)}" />` : '';
  const articleTimes = meta.type === 'article'
    ? `${meta.publishedTime ? `\n<meta property="article:published_time" content="${esc(meta.publishedTime)}" />` : ''}${meta.modifiedTime ? `\n<meta property="article:modified_time" content="${esc(meta.modifiedTime)}" />` : ''}`
    : '';
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#050505" />
<meta name="google-site-verification" content="${esc(config.seoEngine.googleSiteVerification)}" />${bing}
${robots}
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}" />
<link rel="canonical" href="${esc(meta.canonical)}" />
<link rel="alternate" hreflang="pt-BR" href="${esc(meta.canonical)}" />
<link rel="alternate" hreflang="x-default" href="${esc(meta.canonical)}" />
<link rel="alternate" type="application/rss+xml" title="Froc.IA — Vitrine e Magazine" href="${esc(base)}/feed.xml" />
<link rel="sitemap" type="application/xml" href="/sitemap_index.xml" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" type="image/png" sizes="96x96" href="/brand/favicon-96.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:site_name" content="Froc.IA" />
<meta property="og:type" content="${meta.type}" />
<meta property="og:url" content="${esc(meta.canonical)}" />
<meta property="og:title" content="${esc(meta.title)}" />
<meta property="og:description" content="${esc(meta.description)}" />
<meta property="og:image" content="${esc(meta.image)}" />${articleTimes}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(meta.title)}" />
<meta name="twitter:description" content="${esc(meta.description)}" />
<meta name="twitter:image" content="${esc(meta.image)}" />
${meta.schema.map((item) => `<script type="application/ld+json">${jsonLd(item)}</script>`).join('\n')}
<link rel="stylesheet" href="/assets/app.css" />
</head><body class="bg-[#050505] text-white antialiased"><div id="root"><div class="froc-prerender"><a href="/" aria-label="Froc.IA — início"><img src="/brand/logo-froc.webp" alt="Froc.IA — inteligência artificial de marketing" width="96" height="96" style="display:block;margin:0 auto 20px;border-radius:9999px" /></a>${meta.prerender || ''}</div></div><noscript>O Froc.IA precisa de JavaScript habilitado para a experiência completa.</noscript><script type="module" src="/assets/app.js"></script></body></html>`;
  return { html, status: meta.status };
}

export function renderPrivateAppPage(pathname: string): { html: string; status: number } {
  const title = 'Froc.IA — Painel de Marketing';
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#050505" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>${esc(title)}</title>
<meta name="description" content="Área autenticada do Froc.IA." />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" type="image/png" sizes="96x96" href="/brand/favicon-96.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="stylesheet" href="/assets/app.css" />
</head><body class="bg-[#050505] text-white antialiased" data-froc-path="${esc(pathname)}"><div id="root"></div><noscript>O Froc.IA precisa de JavaScript habilitado.</noscript><script type="module" src="/assets/app.js"></script></body></html>`;
  return { html, status: 200 };
}
