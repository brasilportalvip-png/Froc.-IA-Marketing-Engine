/**
 * Direcionamento inteligente dos posts e da Vitrine: /ir/{marca}/{destino}
 *   site     → site oficial
 *   app      → Google Play no Android, App Store no iPhone/iPad (no computador: a loja disponível)
 *   android  → Google Play      ios → App Store      whatsapp → conversa no WhatsApp
 * Cada clique é contado por marca e por post (?p=ID) para o painel.
 */
import { appLinksOf } from './appLinks.js';
import { baseUrl } from './seoEngine.js';
import { COLLECTIONS, firestore, nowIso } from './store.js';

export const REDIRECT_TARGETS = ['site', 'app', 'android', 'ios', 'whatsapp'] as const;
export type RedirectTarget = (typeof REDIRECT_TARGETS)[number];

function isPublic(company: any): boolean {
  return company?.isPublicInVitrine === true || company?.isPublicInVitrine === 'true';
}

function safeHttps(value: any): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function deviceOf(userAgent: string): 'android' | 'ios' | 'desktop' {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && /mobile/i.test(userAgent))) return 'ios';
  return 'desktop';
}

/** Decide o destino final. Retorna null quando a marca não tem aquele canal. */
export function resolveDestination(company: any, target: RedirectTarget, userAgent: string): { url: string; channel: string } | null {
  const apps = appLinksOf(company);
  if (target === 'site') { const url = safeHttps(company.website); return url ? { url, channel: 'site' } : null; }
  if (target === 'android') return apps.android ? { url: apps.android, channel: 'android' } : null;
  if (target === 'ios') return apps.ios ? { url: apps.ios, channel: 'ios' } : null;
  if (target === 'whatsapp') {
    const digits = String(company.whatsapp || '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    const phone = digits.length <= 11 ? `55${digits}` : digits;
    return { url: `https://wa.me/${phone}`, channel: 'whatsapp' };
  }
  const device = deviceOf(userAgent);
  if (device === 'ios' && apps.ios) return { url: apps.ios, channel: 'ios' };
  if (device === 'android' && apps.android) return { url: apps.android, channel: 'android' };
  if (apps.android) return { url: apps.android, channel: 'android' };
  if (apps.ios) return { url: apps.ios, channel: 'ios' };
  return null;
}

export async function recordClick(companyId: string, channel: string, postId?: string): Promise<void> {
  const db = firestore();
  const ref = db.collection(COLLECTIONS.linkClicks).doc(companyId);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() as any) : {};
    const byPost = { ...(current.byPost || {}) };
    if (postId) byPost[postId] = Number(byPost[postId] || 0) + 1;
    tx.set(ref, {
      companyId,
      total: Number(current.total || 0) + 1,
      [channel]: Number(current[channel] || 0) + 1,
      byPost,
      lastClickAt: nowIso()
    }, { merge: true });
  });
}

export async function handleRedirect(slug: string, target: string, userAgent: string, postId?: string): Promise<{ status: number; location: string }> {
  const fallback = `${baseUrl()}/vitrine`;
  if (!(REDIRECT_TARGETS as readonly string[]).includes(target)) return { status: 302, location: fallback };
  const snap = await firestore().collection(COLLECTIONS.companies).where('slug', '==', slug).limit(1).get();
  if (snap.empty) return { status: 302, location: fallback };
  const company = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
  const companyPage = `${baseUrl()}/vitrine/${encodeURIComponent(company.slug)}`;
  if (!isPublic(company)) return { status: 302, location: fallback };
  const destination = resolveDestination(company, target as RedirectTarget, userAgent);
  if (!destination) return { status: 302, location: companyPage };
  try {
    await recordClick(company.id, destination.channel, postId ? String(postId).slice(0, 200) : undefined);
  } catch (error) {
    console.warn('[Froc Direcionamento] Falha ao contar clique:', error instanceof Error ? error.message : error);
  }
  return { status: 302, location: destination.url };
}
