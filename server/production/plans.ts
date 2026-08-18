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
  const pid = planId || 'plan_free';
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

export async function recalculateUserPlan(userId: string): Promise<{
  planId: string;
  planStatus: 'free' | 'active' | 'cancel_at_period_end' | 'cancelled' | 'past_due';
  currentPeriodEnd: string | null;
}> {
  const db = firestore();
  const snap = await db.collection(COLLECTIONS.payments).where('userId', '==', userId).get();
  const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  const now = new Date().toISOString();

  // Filtra pedidos válidos e ativos
  const activeOrders = orders.filter((o) => {
    if (['refunded', 'charged_back', 'failed'].includes(o.status) || ['refunded', 'charged_back'].includes(o.lastPaymentStatus)) {
      return false;
    }
    if (o.status === 'cancel_at_period_end' || o.subscriptionStatus === 'cancelled') {
      return Boolean(o.currentPeriodEnd && o.currentPeriodEnd > now);
    }
    if (o.status === 'active' || o.status === 'approved' || o.lastPaymentStatus === 'approved') {
      return true;
    }
    return false;
  }).sort((a, b) => String(b.lastCreditedAt || b.createdAt || '').localeCompare(String(a.lastCreditedAt || a.createdAt || '')));

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
