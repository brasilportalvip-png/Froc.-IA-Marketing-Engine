import { COLLECTIONS, firestore } from './store.js';

export interface PlanEntitlements {
  planId: string;
  planName: string;
  maxCompanies: number;
  autopilotManual: boolean;
  autopilotAutomatic: boolean;
  advancedSeo: boolean;
  campaigns: boolean;
  socialConnections: boolean;
}

export function getPlanEntitlements(planId?: string | null): PlanEntitlements {
  let pid = planId || 'plan_free';
  if (pid === 'pro') pid = 'plan_pro';
  if (pid === 'start') pid = 'plan_start';
  if (pid === 'business') pid = 'plan_business';
  if (pid === 'agency') pid = 'plan_agency';
  if (pid === 'free') pid = 'plan_free';
  switch (pid) {
    case 'plan_agency':
      return {
        planId: 'plan_agency',
        planName: 'AGENCY',
        maxCompanies: Number.POSITIVE_INFINITY, // Empresas ilimitadas conforme especificação comercial oficial
        autopilotManual: true,
        autopilotAutomatic: true,
        advancedSeo: true,
        campaigns: true,
        socialConnections: true
      };
    case 'plan_business':
      return {
        planId: 'plan_business',
        planName: 'BUSINESS',
        maxCompanies: 15,
        autopilotManual: true,
        autopilotAutomatic: true,
        advancedSeo: true,
        campaigns: true,
        socialConnections: true
      };
    case 'plan_pro':
      return {
        planId: 'plan_pro',
        planName: 'PRO',
        maxCompanies: 5,
        autopilotManual: true,
        autopilotAutomatic: false,
        advancedSeo: true,
        campaigns: false,
        socialConnections: true
      };
    case 'plan_start':
      return {
        planId: 'plan_start',
        planName: 'START',
        maxCompanies: 2,
        autopilotManual: false,
        autopilotAutomatic: false,
        advancedSeo: false,
        campaigns: false,
        socialConnections: false
      };
    case 'plan_free':
    default:
      return {
        planId: 'plan_free',
        planName: 'FREE',
        maxCompanies: 1,
        autopilotManual: false,
        autopilotAutomatic: false,
        advancedSeo: false,
        campaigns: false,
        socialConnections: false
      };
  }
}

const PLAN_TIER_RANK: Record<string, number> = {
  plan_agency: 4,
  plan_business: 3,
  plan_pro: 2,
  plan_start: 1,
  plan_free: 0
};

export async function recalculateUserPlan(userId: string): Promise<{
  planId: string;
  planStatus: 'free' | 'active' | 'cancel_at_period_end' | 'cancelled' | 'past_due';
  currentPeriodEnd: string | null;
}> {
  const db = firestore();
  const snap = await db.collection(COLLECTIONS.payments).where('userId', '==', userId).get();
  const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  const now = new Date().toISOString();

  // Filtra pedidos estritamente válidos, oficialmente liquidados/aprovados e não expirados
  const activeOrders = orders.filter((o) => {
    // Rejeita pagamentos estornados, contestados, com falha ou rejeitados
    if (['refunded', 'charged_back', 'failed', 'rejected'].includes(o.status) || ['refunded', 'charged_back', 'failed', 'rejected'].includes(o.lastPaymentStatus)) {
      return false;
    }

    // Regra P01/P03: Pedidos com status 'pending' ou preapprovals apenas 'authorized' sem liquidação não concedem plano pago.
    // Pedidos válidos devem ter status 'active', 'approved', 'cancel_at_period_end' com pagamento anterior aprovado (lastPaymentStatus ou lastCreditedAt).
    const isExplicitlyPaidOrActive = o.status === 'active' || o.status === 'approved' || o.lastPaymentStatus === 'approved' || Boolean(o.lastCreditedAt);
    if (!isExplicitlyPaidOrActive || o.status === 'pending' || (o.status === 'cancelled' && !o.lastCreditedAt && o.lastPaymentStatus !== 'approved')) {
      return false;
    }

    // Se possui currentPeriodEnd explícito, ele não pode estar vencido (currentPeriodEnd <= now)
    if (o.currentPeriodEnd && o.currentPeriodEnd <= now) {
      return false;
    }

    // Se não possui currentPeriodEnd explícito, calcula ciclo de 30 dias a partir da data de liquidação (lastCreditedAt)
    if (!o.currentPeriodEnd) {
      if (o.lastCreditedAt) {
        const computedEnd = new Date(new Date(o.lastCreditedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        if (computedEnd <= now) {
          return false;
        }
      } else {
        return false;
      }
    }

    if (o.status === 'cancel_at_period_end' || o.subscriptionStatus === 'cancelled') {
      return Boolean(o.currentPeriodEnd && o.currentPeriodEnd > now);
    }
    if (o.status === 'active' || o.status === 'approved' || o.lastPaymentStatus === 'approved') {
      return true;
    }
    return false;
  }).sort((a, b) => {
    // 1. Prioriza nível de plano mais alto (Agency > Business > Pro > Start > Free)
    const rankDiff = (PLAN_TIER_RANK[b.planId || ''] || 0) - (PLAN_TIER_RANK[a.planId || ''] || 0);
    if (rankDiff !== 0) return rankDiff;
    // 2. Desempata pelo pedido válido mais recente
    return String(b.lastCreditedAt || b.createdAt || '').localeCompare(String(a.lastCreditedAt || a.createdAt || ''));
  });

  if (activeOrders.length === 0) {
    return { planId: 'plan_free', planStatus: 'free', currentPeriodEnd: null };
  }

  const bestOrder = activeOrders[0];
  const isCancelledPending = bestOrder.status === 'cancel_at_period_end' || bestOrder.subscriptionStatus === 'cancelled';
  const planStatus = isCancelledPending ? 'cancel_at_period_end' : 'active';
  const currentPeriodEnd = bestOrder.currentPeriodEnd || (bestOrder.lastCreditedAt ? new Date(new Date(bestOrder.lastCreditedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null);

  return {
    planId: bestOrder.planId || 'plan_free',
    planStatus,
    currentPeriodEnd
  };
}
