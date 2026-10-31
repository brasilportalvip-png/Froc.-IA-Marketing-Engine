/**
 * Vitrine paga — regras comerciais do Froc.IA.
 *
 * - Só entra na Vitrine quem tem plano pago ativo (o admin não tem limite).
 * - Cada projeto na Vitrine com post diário ligado custa `billing.vitrineDailyCost`
 *   créditos por dia (padrão 10) e ganha 1 post personalizado com imagem do nicho.
 * - Acabou o crédito: o projeto sai da Vitrine automaticamente.
 * - Liga/desliga do post diário: SOMENTE o admin (por projeto e chave geral do site).
 *   Desligado = sem post e sem cobrança.
 * Cobrança idempotente: 1 registro por projeto por dia (`${companyId}_${YYYY-MM-DD}`).
 */
import { config } from '../config/index.js';
import { commitReservation, getEffectiveWallet, reserveCredits, rollbackReservation } from './credits.js';
import { COLLECTIONS, createNotification, firestore, nowIso } from './store.js';

const VITRINE_CHARGES = COLLECTIONS.vitrineCharges;
const SITE_SETTINGS = COLLECTIONS.siteSettings;

export type VitrineBlockReason = 'no_plan' | 'no_credits';

export function vitrineDailyCost(): number {
  return Math.max(Number(config.billing.vitrineDailyCost) || 0, 0);
}

export function isPaidPlan(wallet: { planId?: string; planStatus?: string } | null | undefined): boolean {
  if (!wallet) return false;
  const plan = String(wallet.planId || 'plan_free');
  return plan !== 'plan_free' && ['active', 'cancel_at_period_end'].includes(String(wallet.planStatus || ''));
}

export async function isAdminUser(userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const snap = await firestore().collection(COLLECTIONS.users).doc(String(userId)).get();
  return snap.exists && (snap.data() as any)?.role === 'admin';
}

/** Projetos do admin (ou que o admin colocou na vitrine) não pagam diária. */
export async function isBillingExempt(company: any): Promise<boolean> {
  if (company?.vitrineBillingExempt === true) return true;
  return isAdminUser(company?.userId);
}

export async function getSiteSettings(): Promise<{ dailyPostsEnabled: boolean }> {
  const snap = await firestore().collection(SITE_SETTINGS).doc('main').get();
  const data = snap.exists ? (snap.data() as any) : {};
  return { dailyPostsEnabled: data.dailyPostsEnabled !== false };
}

export async function setSiteDailyPosts(enabled: boolean, operatorId: string): Promise<{ dailyPostsEnabled: boolean }> {
  await firestore().collection(SITE_SETTINGS).doc('main').set({ dailyPostsEnabled: Boolean(enabled), updatedAt: nowIso(), updatedBy: operatorId }, { merge: true });
  return { dailyPostsEnabled: Boolean(enabled) };
}

export function dailyPostsOn(company: any): boolean {
  return company?.dailyPostsEnabled !== false && company?.dailyPostsEnabled !== 'false';
}

/** Pode entrar na vitrine? (plano pago + créditos para o 1º dia) */
export async function vitrineEligibility(userId: string, isAdmin = false): Promise<{ ok: boolean; reason?: VitrineBlockReason; balance: number; cost: number }> {
  const cost = vitrineDailyCost();
  if (isAdmin) return { ok: true, balance: Number.POSITIVE_INFINITY, cost: 0 };
  const wallet = await getEffectiveWallet(userId);
  const balance = Math.max(Number(wallet.balance || 0) - Number(wallet.reservedCredits || 0), 0);
  if (!isPaidPlan(wallet)) return { ok: false, reason: 'no_plan', balance, cost };
  if (balance < cost) return { ok: false, reason: 'no_credits', balance, cost };
  return { ok: true, balance, cost };
}

export function vitrineBlockMessage(reason?: VitrineBlockReason): string {
  if (reason === 'no_plan') return 'A Vitrine é exclusiva para assinantes: escolha um plano para colocar seu projeto lá.';
  if (reason === 'no_credits') return `Faltam créditos: a Vitrine usa ${vitrineDailyCost()} créditos por dia por projeto. Recarregue para continuar.`;
  return '';
}

/** Cobra a diária do projeto (idempotente por dia). */
export async function chargeVitrineDay(company: any, dateStr: string): Promise<{ ok: boolean; charged: number; already?: boolean; exempt?: boolean; reason?: VitrineBlockReason }> {
  const db = firestore();
  const ref = db.collection(VITRINE_CHARGES).doc(`${company.id}_${dateStr}`);
  const existing = await ref.get();
  if (existing.exists) return { ok: true, charged: 0, already: true };
  const cost = vitrineDailyCost();
  if (cost <= 0 || await isBillingExempt(company)) {
    await ref.set({ companyId: company.id, userId: company.userId || null, date: dateStr, amount: 0, exempt: true, createdAt: nowIso() });
    return { ok: true, charged: 0, exempt: true };
  }
  const wallet = await getEffectiveWallet(String(company.userId));
  if (!isPaidPlan(wallet)) return { ok: false, charged: 0, reason: 'no_plan' };
  try {
    await ref.create({ companyId: company.id, userId: company.userId, date: dateStr, amount: cost, status: 'pending', createdAt: nowIso() });
  } catch {
    return { ok: true, charged: 0, already: true };
  }
  let reservationId = '';
  try {
    const reservation = await reserveCredits({ userId: String(company.userId), amount: cost, operation: 'vitrine_daily', companyId: company.id });
    reservationId = reservation.reservationId;
    await commitReservation({ userId: String(company.userId), reservationId, source: `Vitrine Froc.IA: diária ${dateStr} (${company.name || company.id})`, metadata: { companyId: company.id, date: dateStr } });
    await ref.set({ status: 'charged', chargedAt: nowIso() }, { merge: true });
    return { ok: true, charged: cost };
  } catch (error) {
    if (reservationId) await rollbackReservation(String(company.userId), reservationId, 'Falha na diária da vitrine').catch(() => undefined);
    await ref.delete().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    if (/saldo|insuficiente|crédito/i.test(message)) return { ok: false, charged: 0, reason: 'no_credits' };
    throw error;
  }
}

/** Tira o projeto da vitrine e avisa o dono. */
export async function removeFromVitrine(company: any, reason: VitrineBlockReason): Promise<void> {
  await firestore().collection(COLLECTIONS.companies).doc(company.id).set({
    isPublicInVitrine: false, vitrineRemovedReason: reason, vitrineRemovedAt: nowIso(), updatedAt: nowIso()
  }, { merge: true });
  if (company.userId) {
    await createNotification({
      userId: String(company.userId),
      type: 'vitrine_removed',
      title: `${company.name || 'Seu projeto'} saiu da Vitrine`,
      message: reason === 'no_plan'
        ? 'Seu plano não está ativo. Escolha um plano para voltar à Vitrine e continuar recebendo o post diário.'
        : `Seus créditos acabaram. Recarregue para voltar à Vitrine (${vitrineDailyCost()} créditos por dia por projeto).`,
      idempotencyKey: `vitrine_removed:${company.id}:${nowIso().slice(0, 10)}`
    }).catch(() => undefined);
  }
}
