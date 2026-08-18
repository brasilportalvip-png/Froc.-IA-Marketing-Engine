import dns from 'dns/promises';
import net from 'net';
import { COLLECTIONS, firestore, newId, nowIso } from './store.js';
import { executeAi, parseAiJson } from './ai.js';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
}

async function assertPublicHost(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Apenas URLs HTTP/HTTPS são permitidas.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Endereço local bloqueado por segurança.');
  if (net.isIP(host)) {
    if ((net.isIP(host) === 4 && isPrivateIpv4(host)) || (net.isIP(host) === 6 && isPrivateIpv6(host))) throw new Error('Endereço privado bloqueado por segurança.');
    return;
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('Domínio não resolvido.');
  for (const item of addresses) {
    if ((item.family === 4 && isPrivateIpv4(item.address)) || (item.family === 6 && isPrivateIpv6(item.address))) throw new Error('O domínio resolve para uma rede privada e foi bloqueado.');
  }
}

export async function safeFetchHtml(rawUrl: string): Promise<{ url: string; html: string }> {
  let current = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicHost(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FrocBot/1.1; SEO audit)', Accept: 'text/html,application/xhtml+xml' }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirecionamento sem destino.');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`Site respondeu HTTP ${response.status}.`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('A URL não retornou uma página HTML.');
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_HTML_BYTES) throw new Error('Página muito grande para auditoria segura.');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_HTML_BYTES) throw new Error('Página excede o limite de 2 MB da auditoria.');
      return { url: current.toString(), html: buffer.toString('utf8') };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Número máximo de redirecionamentos excedido.');
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function matchOne(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  return match?.[1] ? decodeHtml(match[1]) : '';
}

function metaContent(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i');
  return matchOne(html, a) || matchOne(html, b);
}

function headings(html: string, tag: 'h1' | 'h2', max = 20): string[] {
  const result: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  for (let match = re.exec(html); match && result.length < max; match = re.exec(html)) {
    const value = stripTags(match[1]);
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

export async function analyzeSeo(data: { userId: string; rawUrl: string; company?: any }) {
  const page = await safeFetchHtml(data.rawUrl);
  const title = matchOne(page.html, /<title\b[^>]*>([\s\S]*?)<\/title>/i) || metaContent(page.html, 'og:title');
  const metaDescription = metaContent(page.html, 'description') || metaContent(page.html, 'og:description');
  const canonical = matchOne(page.html, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i) || matchOne(page.html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
  const h1s = headings(page.html, 'h1');
  const h2s = headings(page.html, 'h2', 12);
  const body = stripTags(page.html);
  const words = body.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9à-ÿ\s-]/gi, ' ').split(/\s+/).filter((w) => w.length > 3);
  const stop = new Set(['para', 'com', 'mais', 'como', 'sobre', 'essa', 'esse', 'esta', 'este', 'seus', 'suas', 'você', 'pelo', 'pela', 'todos', 'tudo', 'onde', 'quando', 'muito', 'entre', 'uma', 'uns', 'das', 'dos']);
  const counts = new Map<string, number>();
  words.forEach((word) => { if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1); });
  const keywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, count, density: words.length ? `${((count / words.length) * 100).toFixed(1)}%` : '0%' }));

  const criteria = {
    hasTitle: Boolean(title),
    titleLengthValid: title.length >= 30 && title.length <= 65,
    hasDescription: Boolean(metaDescription),
    descriptionLengthValid: metaDescription.length >= 70 && metaDescription.length <= 160,
    hasH1: h1s.length > 0,
    singleH1: h1s.length === 1,
    hasKeywordsInHeadings: keywords.some((item) => [...h1s, ...h2s].some((heading) => heading.toLowerCase().includes(item.word))),
    contentLengthSufficient: words.length >= 250,
    hasHttps: page.url.startsWith('https://'),
    hasCanonical: Boolean(canonical)
  };
  const weights: Record<keyof typeof criteria, number> = { hasTitle: 15, titleLengthValid: 10, hasDescription: 15, descriptionLengthValid: 10, hasH1: 10, singleH1: 5, hasKeywordsInHeadings: 10, contentLengthSufficient: 10, hasHttps: 10, hasCanonical: 5 };
  const score = (Object.keys(criteria) as Array<keyof typeof criteria>).reduce((sum, key) => sum + (criteria[key] ? weights[key] : 0), 0);

  const prompt = `Audite SEO para ${page.url}. Score técnico ${score}/100. Título: ${title || 'ausente'}. Meta: ${metaDescription || 'ausente'}. H1: ${JSON.stringify(h1s)}. H2: ${JSON.stringify(h2s)}. Keywords: ${JSON.stringify(keywords.map((k) => k.word))}.
Responda SOMENTE JSON: {"recommendations":[""],"generatedOutline":[""],"faqSuggestions":[{"question":"","answer":""}]}.`;
  const ai = await executeAi<any>({ userId: data.userId, company: data.company, operation: 'site_analysis', prompt, jsonOutput: true, parse: parseAiJson });
  const id = newId('seo');
  const report = {
    id,
    userId: data.userId,
    companyId: data.company?.id || 'none',
    url: page.url,
    title,
    metaDescription,
    h1s,
    h2s,
    keywords,
    seoScore: score,
    criteriaBreakdown: criteria,
    recommendations: ai.result.recommendations || [],
    generatedOutline: ai.result.generatedOutline || [],
    faqSuggestions: ai.result.faqSuggestions || [],
    createdAt: nowIso()
  };
  await firestore().collection(COLLECTIONS.seoReports).doc(id).set(report);
  return report;
}
