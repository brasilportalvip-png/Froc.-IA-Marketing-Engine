import { config } from '../config/index.js';
import { COLLECTIONS, firestore } from './store.js';

function esc(value: any): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function jsonLd(value: any): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
function absolute(value?: string): string {
  if (!value) return `${config.appUrl}/og-froc.png`;
  try { return new URL(value, config.appUrl).toString(); } catch { return `${config.appUrl}/og-froc.png`; }
}
function description(value: any, fallback: string): string {
  return String(value || fallback).replace(/\s+/g, ' ').trim().slice(0, 180);
}

interface PublicMeta {
  title: string;
  description: string;
  canonical: string;
  image: string;
  type: 'website' | 'article';
  status: number;
  schema: any;
}

async function metaFor(pathname: string): Promise<PublicMeta> {
  const base = config.appUrl.replace(/\/$/, '');
  const fallback: PublicMeta = {
    title: 'Froc.IA — Automação de Marketing com Inteligência Artificial',
    description: 'Estratégias, conteúdos, SEO, campanhas e automações de marketing com inteligência artificial.',
    canonical: `${base}${pathname === '/' ? '/' : pathname}`,
    image: `${base}/og-froc.png`, type: 'website', status: 200,
    schema: { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Froc.IA', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: base }
  };

  if (pathname === '/vitrine') return { ...fallback, title: 'Vitrine Froc.IA — Descubra empresas e marcas', description: 'Conheça empresas que optaram por divulgar seus produtos, serviços e canais de contato na Vitrine Froc.IA.' };
  if (pathname === '/blog') return { ...fallback, title: 'Froc Magazine — Marketing, IA e crescimento', description: 'Artigos publicados no Froc Magazine sobre marketing, inteligência artificial, SEO, conteúdo e crescimento.' };
  if (pathname === '/planos') return { ...fallback, title: 'Planos Froc.IA — Créditos e automação de marketing', description: 'Conheça os planos oficiais Froc.IA e seus créditos para conteúdo, IA, SEO, campanhas e Autopilot.' };
  if (pathname === '/termos') return { ...fallback, title: 'Termos de Uso — Froc.IA', description: 'Termos de uso do Froc.IA para conta, inteligência artificial, créditos, assinaturas, integrações e Autopilot.' };
  if (pathname === '/privacidade') return { ...fallback, title: 'Política de Privacidade — Froc.IA', description: 'Política de privacidade do Froc.IA e informações sobre dados de conta, integrações, pagamentos e inteligência artificial.' };

  const vitrineMatch = pathname.match(/^\/vitrine\/([^/]+)$/);
  if (vitrineMatch) {
    try {
      const slug = decodeURIComponent(vitrineMatch[1]);
      const snap = await firestore().collection(COLLECTIONS.companies).where('slug', '==', slug).where('isPublicInVitrine', '==', true).limit(1).get();
      if (snap.empty) return { ...fallback, status: 404, title: 'Empresa não encontrada — Froc.IA', description: 'Esta empresa não está disponível na Vitrine Froc.IA.' };
      const company = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
      const canonical = `${base}/vitrine/${encodeURIComponent(company.slug)}`;
      return {
        title: `${company.name} — Vitrine Froc.IA`,
        description: description(company.description, `${company.name} na Vitrine Froc.IA.`),
        canonical, image: absolute(company.logoUrl), type: 'website', status: 200,
        schema: {
          '@context': 'https://schema.org',
          '@type': company.businessType === 'online' ? 'OnlineBusiness' : company.businessType === 'physical' ? 'LocalBusiness' : 'Organization',
          name: company.name, url: company.website || canonical,
          description: company.description || undefined, logo: company.logoUrl || undefined,
          email: company.email || undefined, telephone: company.phone || company.whatsapp || undefined,
          address: company.businessType !== 'online' && (company.address || company.city) ? { '@type': 'PostalAddress', streetAddress: company.address || undefined, addressLocality: company.city || undefined, addressRegion: company.state || undefined, addressCountry: company.country || 'BR' } : undefined,
          sameAs: Object.values(company.socialLinks || {}).filter(Boolean)
        }
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
      if (snap.empty) return { ...fallback, status: 404, title: 'Artigo não encontrado — Froc.IA', description: 'Este artigo não está disponível no Froc Magazine.' };
      const post = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
      const canonical = `${base}/blog/${encodeURIComponent(post.slug)}`;
      return {
        title: post.seoTitle || `${post.title} — Froc Magazine`,
        description: description(post.seoDescription || post.summary, 'Artigo do Froc Magazine.'),
        canonical, image: absolute(post.featuredImageUrl), type: 'article', status: 200,
        schema: {
          '@context': 'https://schema.org', '@type': 'Article', headline: post.title, description: post.summary || post.seoDescription,
          image: post.featuredImageUrl ? [absolute(post.featuredImageUrl)] : undefined,
          datePublished: post.publishedAt || post.createdAt, dateModified: post.updatedAt || post.publishedAt || post.createdAt,
          author: { '@type': 'Organization', name: post.author || 'Equipe Froc.IA' },
          publisher: { '@type': 'Organization', name: 'Froc.IA', logo: { '@type': 'ImageObject', url: `${base}/icons/icon-512.png` } },
          mainEntityOfPage: canonical
        }
      };
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export async function renderPublicPage(pathname: string): Promise<{ html: string; status: number }> {
  const meta = await metaFor(pathname);
  const noindex = meta.status === 404 ? '<meta name="robots" content="noindex,follow" />' : '';
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#0B0F19" />
${noindex}
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}" />
<link rel="canonical" href="${esc(meta.canonical)}" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta property="og:locale" content="pt_BR" />
<meta property="og:site_name" content="Froc.IA" />
<meta property="og:type" content="${meta.type}" />
<meta property="og:url" content="${esc(meta.canonical)}" />
<meta property="og:title" content="${esc(meta.title)}" />
<meta property="og:description" content="${esc(meta.description)}" />
<meta property="og:image" content="${esc(meta.image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(meta.title)}" />
<meta name="twitter:description" content="${esc(meta.description)}" />
<meta name="twitter:image" content="${esc(meta.image)}" />
<script type="application/ld+json">${jsonLd(meta.schema)}</script>
<link rel="stylesheet" href="/assets/app.css" />
</head><body class="bg-[#0B0F19] text-slate-100 antialiased"><div id="root"></div><noscript>O Froc.IA precisa de JavaScript habilitado.</noscript><script type="module" src="/assets/app.js"></script></body></html>`;
  return { html, status: meta.status };
}

export function renderPrivateAppPage(pathname: string): { html: string; status: number } {
  const title = 'Froc.IA — Painel de Marketing';
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#0B0F19" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>${esc(title)}</title>
<meta name="description" content="Área autenticada do Froc.IA." />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="stylesheet" href="/assets/app.css" />
</head><body class="bg-[#0B0F19] text-slate-100 antialiased" data-froc-path="${esc(pathname)}"><div id="root"></div><noscript>O Froc.IA precisa de JavaScript habilitado.</noscript><script type="module" src="/assets/app.js"></script></body></html>`;
  return { html, status: 200 };
}
