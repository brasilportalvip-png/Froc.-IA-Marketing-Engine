/** Links de aplicativo da marca (Google Play / App Store), validados para exibição pública. */
export interface AppLinks { android: string | null; ios: string | null }

function storeUrl(value: any, hosts: string[]): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:') return null;
    return hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function appLinksOf(company: any): AppLinks {
  return {
    android: storeUrl(company?.androidApp, ['play.google.com']),
    ios: storeUrl(company?.iosApp, ['apps.apple.com', 'itunes.apple.com'])
  };
}

export function hasApp(company: any): boolean {
  const links = appLinksOf(company);
  return Boolean(links.android || links.ios);
}

// ───────────── Produto digital, e-commerce e afiliados ─────────────

export type OfferType = 'local' | 'servico_online' | 'digital' | 'afiliado' | 'ecommerce' | 'app';
export type ReachScope = 'local' | 'regional' | 'nacional' | 'internacional';
export const OFFER_TYPES: OfferType[] = ['local', 'servico_online', 'digital', 'afiliado', 'ecommerce', 'app'];
export const REACH_SCOPES: ReachScope[] = ['local', 'regional', 'nacional', 'internacional'];

/** Plataformas de produto digital e programas de afiliados mais usados no Brasil. */
const AFFILIATE_PLATFORMS: Array<{ name: string; hosts: string[]; requireParam?: RegExp }> = [
  { name: 'Hotmart', hosts: ['hotmart.com', 'hotmart.com.br', 'hotm.art'] },
  { name: 'Kiwify', hosts: ['kiwify.com.br', 'kiwify.app'] },
  { name: 'Eduzz', hosts: ['eduzz.com', 'sun.eduzz.com'] },
  { name: 'Monetizze', hosts: ['monetizze.com.br'] },
  { name: 'Braip', hosts: ['braip.com', 'ev.braip.com'] },
  { name: 'PerfectPay', hosts: ['perfectpay.com.br'] },
  { name: 'Ticto', hosts: ['ticto.app', 'ticto.com.br'] },
  { name: 'Lastlink', hosts: ['lastlink.com'] },
  { name: 'Cakto', hosts: ['cakto.com.br'] },
  { name: 'Amazon', hosts: ['amzn.to'] },
  { name: 'Amazon', hosts: ['amazon.com.br', 'amazon.com'], requireParam: /[?&]tag=/i },
  { name: 'Shopee', hosts: ['shope.ee', 's.shopee.com.br'] },
  { name: 'Mercado Livre', hosts: ['mercadolivre.com', 'meli.la'], requireParam: /\/sec\/|[?&](matt_tool|matt_word)=/i },
  { name: 'Magalu', hosts: ['magazinevoce.com.br'] },
  { name: 'AliExpress', hosts: ['s.click.aliexpress.com'] },
  { name: 'Natura', hosts: ['minhaloja.natura.com'] },
  { name: 'Boticário', hosts: ['revendedor.boticario.com.br'] }
];

export function safeOfferUrl(value: any): string | null {
  const raw = String(value ?? '').trim().slice(0, 1000);
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    // Nunca links internos ou IPs (segurança).
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.includes(':')) return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Reconhece a plataforma (Hotmart, Kiwify, Amazon com tag...) de um link. */
export function detectOfferPlatform(value: any): { platform: string | null; affiliate: boolean } {
  const url = safeOfferUrl(value);
  if (!url) return { platform: null, affiliate: false };
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  for (const item of AFFILIATE_PLATFORMS) {
    if (!item.hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    if (item.requireParam && !item.requireParam.test(`${parsed.pathname}${parsed.search}`)) continue;
    return { platform: item.name, affiliate: true };
  }
  return { platform: null, affiliate: false };
}

export interface OfferInfo {
  url: string | null;
  platform: string | null;
  /** Link de afiliado/indicação: o Google exige rel="sponsored" e o leitor precisa ser avisado. */
  affiliate: boolean;
  type: OfferType;
  scope: ReachScope;
  digital: boolean;
}

export function offerOf(company: any): OfferInfo {
  const url = safeOfferUrl(company?.salesUrl);
  const detected = detectOfferPlatform(url);
  const type: OfferType = OFFER_TYPES.includes(company?.offerType) ? company.offerType : (detected.affiliate ? 'afiliado' : company?.businessType === 'online' ? 'servico_online' : 'local');
  const affiliate = Boolean(url) && (company?.isAffiliate === true || type === 'afiliado' || detected.affiliate);
  const scope: ReachScope = REACH_SCOPES.includes(company?.reachScope) ? company.reachScope : (['digital', 'afiliado', 'ecommerce', 'app'].includes(type) ? 'nacional' : 'local');
  return { url, platform: detected.platform, affiliate, type, scope, digital: ['digital', 'afiliado', 'ecommerce', 'app', 'servico_online'].includes(type) };
}

export function offerTypeLabel(type: OfferType): string {
  return ({ local: 'negócio local', servico_online: 'serviço online', digital: 'produto digital (curso, e-book, mentoria, assinatura)', afiliado: 'produto de afiliado', ecommerce: 'loja virtual / e-commerce', app: 'aplicativo' } as Record<OfferType, string>)[type];
}

export function scopeLabel(scope: ReachScope, country?: string): string {
  if (scope === 'nacional') return `todo o ${country && !/^br/i.test(country) ? country : 'Brasil'}`;
  if (scope === 'internacional') return 'vários países (alcance internacional)';
  if (scope === 'regional') return 'a região/estado informado';
  return 'a cidade e os bairros informados';
}
