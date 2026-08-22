import crypto from 'crypto';
import { config } from '../config/index.js';
import { COLLECTIONS, firestore, newId, nowIso, stableId } from './store.js';
import { recalculateUserPlan } from './plans.js';

export { recalculateUserPlan };

export type BillingMode = 'subscription' | 'one_time';

export function mercadoPagoConfigured(): boolean {
  return Boolean(config.mercadoPago.accessToken && config.mercadoPago.webhookSecret);
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${config.mercadoPago.accessToken}`, ...extra };
}

async function mpJson(url: string, init: RequestInit = {}): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: authHeaders({ ...(init.headers as Record<string, string> || {}) })
    });
    const body = await response.json().catch(() => ({} as any));
    if (!response.ok) {
      const message = body?.message || body?.error_description || body?.error || `Mercado Pago HTTP ${response.status}`;
      const error: any = new Error(String(message));
      error.statusCode = response.status >= 500 ? 502 : 400;
      throw error;
    }
    return body;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      const timeoutError: any = new Error('Tempo limite excedido ao comunicar com o Mercado Pago.');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createCheckout(data: { userId: string; userEmail: string; userName: string; planId: string; idempotencyKey?: string }) {
  if (!config.mercadoPago.accessToken) throw new Error('Mercado Pago não configurado no servidor.');
  const plan = config.plans.find((item) => item.id === data.planId);
  if (!plan) throw new Error('Plano inválido.');

  const db = firestore();

  // A01: Idempotência atômica com escopo por usuário e operação
  let orderId: string;
  let billingMode = config.mercadoPago.billingMode as BillingMode;

  if (data.idempotencyKey) {
    const idemDocId = stableId(`checkout:${data.userId}:${data.idempotencyKey}`);
    const idemRef = db.collection(COLLECTIONS.idempotency).doc(idemDocId);

    // Reserva atômica via transação
    const reservation = await db.runTransaction(async (tx) => {
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) {
        const stored = idemSnap.data() as any;
        // Se a mesma chave foi enviada com plano ou usuário diferente => 409 Conflict
        if (stored.planId !== data.planId || stored.userId !== data.userId) {
          const conflictErr: any = new Error('Conflito de idempotência: a mesma chave já foi utilizada com outros parâmetros.');
          conflictErr.statusCode = 409;
          throw conflictErr;
        }
        return { isExisting: true, orderId: stored.orderId, initPoint: stored.initPoint, billingMode: stored.billingMode || billingMode, status: stored.status };
      }

      const newOrderId = newId('order');
      const orderData: Record<string, any> = {
        id: newOrderId,
        userId: data.userId,
        clientCheckoutKey: data.idempotencyKey,
        planId: plan.id,
        planName: plan.name,
        amount: plan.price,
        currency: 'BRL',
        creditsGranted: plan.credits,
        bonusCreditsGranted: plan.bonusCredits,
        billingMode,
        status: 'pending',
        provider: 'mercadopago',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      const newOrderRef = db.collection(COLLECTIONS.payments).doc(newOrderId);
      tx.set(newOrderRef, orderData);
      tx.set(idemRef, {
        key: data.idempotencyKey,
        userId: data.userId,
        planId: data.planId,
        orderId: newOrderId,
        billingMode,
        status: 'pending',
        createdAt: nowIso()
      });

      return { isExisting: false, orderId: newOrderId, orderData };
    });

    if (reservation.isExisting) {
      if (reservation.initPoint) {
        return {
          order: { id: reservation.orderId, planId: data.planId, status: reservation.status, initPoint: reservation.initPoint },
          initPoint: reservation.initPoint,
          billingMode: reservation.billingMode
        };
      }
      // Se a ordem já existe mas ainda está em processamento de criação do initPoint por outra requisição concorrente,
      // aguarda com polling até que o initPoint seja persistido
      for (let attempt = 0; attempt < 80; attempt++) {
        await new Promise((r) => setTimeout(r, 25));
        const idemSnap = await db.collection(COLLECTIONS.idempotency).doc(idemDocId).get();
        if (idemSnap.exists && idemSnap.data()?.initPoint) {
          const stored = idemSnap.data() as any;
          return {
            order: { id: reservation.orderId, planId: data.planId, status: stored.status, initPoint: stored.initPoint },
            initPoint: stored.initPoint,
            billingMode: stored.billingMode || billingMode
          };
        }
        const existingOrderSnap = await db.collection(COLLECTIONS.payments).doc(reservation.orderId).get();
        if (existingOrderSnap.exists) {
          const ext = existingOrderSnap.data() as any;
          if (ext.initPoint) {
            return {
              order: { id: reservation.orderId, ...ext },
              initPoint: ext.initPoint,
              billingMode: ext.billingMode || billingMode
            };
          }
        }
      }
      orderId = reservation.orderId;
    } else {
      orderId = reservation.orderId;
    }
  } else {
    orderId = newId('order');
    const orderData: Record<string, any> = {
      id: orderId,
      userId: data.userId,
      clientCheckoutKey: null,
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      currency: 'BRL',
      creditsGranted: plan.credits,
      bonusCreditsGranted: plan.bonusCredits,
      billingMode,
      status: 'pending',
      provider: 'mercadopago',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await db.collection(COLLECTIONS.payments).doc(orderId).set(orderData);
  }

  const orderRef = db.collection(COLLECTIONS.payments).doc(orderId);
  const orderSnap = await orderRef.get();
  const order = orderSnap.data() as any;

  try {
    if (billingMode === 'subscription') {
      const mpIdemKey = `mp-preapproval-${orderId}`;
      const body = await mpJson('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': mpIdemKey
        },
        body: JSON.stringify({
          reason: `Plano Froc.IA ${plan.name} - ${plan.totalCredits} créditos por ciclo`,
          external_reference: orderId,
          payer_email: data.userEmail,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: plan.price,
            currency_id: 'BRL'
          },
          back_url: `${config.appUrl}/planos?payment_status=subscription&order_id=${orderId}`,
          status: 'pending'
        })
      });
      const initPoint = body.init_point;
      if (!body.id || !initPoint) throw new Error('Mercado Pago não retornou o link da assinatura.');
      await orderRef.update({
        providerSubscriptionId: String(body.id),
        providerPreapprovalId: String(body.id),
        initPoint,
        status: String(body.status || 'pending'),
        updatedAt: nowIso()
      });

      if (data.idempotencyKey) {
        const idemDocId = stableId(`checkout:${data.userId}:${data.idempotencyKey}`);
        await db.collection(COLLECTIONS.idempotency).doc(idemDocId).set({ initPoint, status: String(body.status || 'pending') }, { merge: true });
      }

      return { order: { ...order, providerSubscriptionId: String(body.id), initPoint }, initPoint, billingMode };
    }

    const mpIdemKey = `mp-pref-${orderId}`;
    const body = await mpJson('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': mpIdemKey },
      body: JSON.stringify({
        items: [{
          id: plan.id,
          title: `Plano Froc.IA ${plan.name} (${plan.totalCredits} créditos)`,
          description: 'Ciclo avulso de automação de marketing e inteligência artificial Froc.IA',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: plan.price
        }],
        payer: { email: data.userEmail, name: data.userName },
        back_urls: {
          success: `${config.appUrl}/planos?payment_status=success&order_id=${orderId}`,
          pending: `${config.appUrl}/planos?payment_status=pending&order_id=${orderId}`,
          failure: `${config.appUrl}/planos?payment_status=failure&order_id=${orderId}`
        },
        auto_return: 'approved',
        external_reference: orderId,
        notification_url: `${config.appUrl}/api/webhooks/mercadopago`,
        statement_descriptor: 'FROC IA'
      })
    });
    const initPoint = body.init_point || body.sandbox_init_point;
    if (!body.id || !initPoint) throw new Error('Mercado Pago não retornou o checkout.');
    await orderRef.update({ providerPreferenceId: body.id, initPoint, idempotencyKey: mpIdemKey, updatedAt: nowIso() });

    if (data.idempotencyKey) {
      const idemDocId = stableId(`checkout:${data.userId}:${data.idempotencyKey}`);
      await db.collection(COLLECTIONS.idempotency).doc(idemDocId).set({ initPoint, status: 'pending' }, { merge: true });
    }

    return { order: { ...order, providerPreferenceId: body.id, initPoint }, initPoint, billingMode };
  } catch (error: any) {
    await orderRef.set({ status: 'failed', providerError: String(error?.message || error).slice(0, 500), updatedAt: nowIso() }, { merge: true });
    throw error;
  }
}

function parseSignature(header: string): { ts?: string; v1?: string } {
  const result: { ts?: string; v1?: string } = {};
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 'ts') result.ts = value;
    if (key === 'v1') result.v1 = value;
  }
  return result;
}

export function verifyMercadoPagoSignature(data: { signatureHeader?: string; requestId?: string; dataId?: string }): boolean {
  if (!config.mercadoPago.webhookSecret || !data.signatureHeader || !data.requestId || !data.dataId) return false;
  const { ts, v1 } = parseSignature(data.signatureHeader);
  if (!ts || !v1) return false;
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > 15 * 60) return false;

  const manifest = `id:${String(data.dataId).toLowerCase()};request-id:${data.requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', config.mercadoPago.webhookSecret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}

// A02: Máquina de estados monotônica estrita para ordens de pagamento
const ALLOWED_ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'active', 'rejected', 'cancelled', 'failed'],
  approved: ['refunded', 'charged_back'],
  active: ['cancel_at_period_end', 'cancelled', 'refunded', 'charged_back'],
  cancel_at_period_end: ['cancelled', 'refunded', 'charged_back'],
  rejected: [],
  failed: [],
  cancelled: [],
  refunded: [],
  charged_back: []
};

export function canTransitionOrderStatus(currentStatus: string, targetStatus: string): boolean {
  if (currentStatus === targetStatus) return true;
  const allowed = ALLOWED_ORDER_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(targetStatus);
}

function normalizePaymentStatus(status: string): string {
  if (status === 'approved') return 'approved';
  if (status === 'refunded') return 'refunded';
  if (status === 'charged_back') return 'charged_back';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'rejected') return 'rejected';
  return 'pending';
}

export async function applyPaymentCycle(data: {
  orderId: string;
  paymentId: string;
  cycleId: string;
  status: string;
  amount: number;
  currency: string;
  paymentMethod?: string;
  subscriptionId?: string;
}): Promise<void> {
  const db = firestore();
  const orderRef = db.collection(COLLECTIONS.payments).doc(data.orderId);

  let userIdToRecalculate: string | null = null;

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new Error('Pedido Froc associado ao pagamento não foi encontrado.');
    const order = orderSnap.data() as any;
    const walletRef = db.collection(COLLECTIONS.wallets).doc(order.userId);
    const creditIdemRef = db.collection(COLLECTIONS.idempotency).doc(stableId(`mp-credit:${data.paymentId}`));
    const reversalIdemRef = db.collection(COLLECTIONS.idempotency).doc(stableId(`mp-reversal:${data.paymentId}`));

    // Todas as leituras da transação acontecem antes da primeira escrita.
    const [walletSnap, creditIdemSnap, reversalIdemSnap] = await Promise.all([
      tx.get(walletRef), tx.get(creditIdemRef), tx.get(reversalIdemRef)
    ]);

    if (data.currency !== 'BRL' || Math.abs(Number(data.amount) - Number(order.amount)) > 0.01) {
      throw new Error('Valor ou moeda do pagamento diverge do pedido original.');
    }

    const status = normalizePaymentStatus(data.status);
    const baseUpdate: Record<string, any> = {
      lastPaymentStatus: status,
      providerPaymentId: data.paymentId,
      lastBillingCycleId: data.cycleId,
      paymentMethod: data.paymentMethod || null,
      updatedAt: nowIso()
    };
    if (data.subscriptionId) {
      baseUpdate.providerSubscriptionId = data.subscriptionId;
      baseUpdate.providerPreapprovalId = data.subscriptionId;
    }

    const wallet = walletSnap.exists ? walletSnap.data() as any : {
      id: order.userId, userId: order.userId, balance: 0, bonusBalance: 0,
      totalUsed: 0, totalReceived: 0, reservedCredits: 0, planId: 'plan_free', planStatus: 'free'
    };
    const credits = Number(order.creditsGranted || 0) + Number(order.bonusCreditsGranted || 0);
    const before = Number(wallet.balance || 0);
    const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const currentStatus = order.status || 'pending';
    let targetOrderStatus: string = currentStatus;

    if (status === 'approved' && !creditIdemSnap.exists) {
      targetOrderStatus = order.billingMode === 'subscription' ? 'active' : 'approved';
      if (!canTransitionOrderStatus(currentStatus, targetOrderStatus)) {
        // Se a ordem já foi cancelada ou estornada, ignora aprovação tardia para manter monotonicidade
        return;
      }
      tx.set(walletRef, {
        ...wallet,
        id: order.userId,
        userId: order.userId,
        balance: before + credits,
        bonusBalance: Number(wallet.bonusBalance || 0) + Number(order.bonusCreditsGranted || 0),
        totalReceived: Number(wallet.totalReceived || 0) + credits,
        planId: order.planId,
        planStatus: 'active',
        planStartedAt: wallet.planStartedAt || nowIso(),
        currentPeriodEnd,
        updatedAt: nowIso()
      }, { merge: true });
      const creditTxRef = db.collection(COLLECTIONS.creditTransactions).doc(newId('tx'));
      tx.set(creditTxRef, {
        userId: order.userId,
        type: order.billingMode === 'subscription' ? 'subscription' : 'purchase',
        source: `Mercado Pago - Plano ${order.planName}`,
        amount: credits,
        balanceBefore: before,
        balanceAfter: before + credits,
        referenceId: data.paymentId,
        idempotencyKey: `mp-credit:${data.paymentId}`,
        timestamp: nowIso(),
        metadata: { orderId: data.orderId, planId: order.planId, cycleId: data.cycleId, subscriptionId: data.subscriptionId || null }
      });
      tx.set(creditIdemRef, { key: `mp-credit:${data.paymentId}`, createdAt: nowIso(), orderId: data.orderId, credits });
      baseUpdate.status = targetOrderStatus;
      baseUpdate.currentPeriodEnd = currentPeriodEnd;
      baseUpdate.processedAt = nowIso();
      baseUpdate.lastCreditedAt = nowIso();
    } else if (['refunded', 'charged_back', 'cancelled'].includes(status) && creditIdemSnap.exists && !reversalIdemSnap.exists) {
      targetOrderStatus = status;
      if (canTransitionOrderStatus(currentStatus, targetOrderStatus)) {
        baseUpdate.status = targetOrderStatus;
      }
      const after = before - credits;
      tx.set(walletRef, {
        ...wallet,
        id: order.userId,
        userId: order.userId,
        balance: after,
        bonusBalance: Math.max(0, Number(wallet.bonusBalance || 0) - Number(order.bonusCreditsGranted || 0)),
        updatedAt: nowIso()
      }, { merge: true });
      const refundTxRef = db.collection(COLLECTIONS.creditTransactions).doc(newId('tx'));
      tx.set(refundTxRef, {
        userId: order.userId,
        type: 'refund',
        source: `Reversão Mercado Pago - ${status}`,
        amount: -credits,
        balanceBefore: before,
        balanceAfter: after,
        referenceId: data.paymentId,
        idempotencyKey: `mp-reversal:${data.paymentId}`,
        timestamp: nowIso(),
        metadata: { orderId: data.orderId, planId: order.planId, cycleId: data.cycleId }
      });
      tx.set(reversalIdemRef, { key: `mp-reversal:${data.paymentId}`, createdAt: nowIso(), orderId: data.orderId, credits, status });
      baseUpdate.reversedAt = nowIso();
      userIdToRecalculate = order.userId;
    } else if (status !== 'approved') {
      if (canTransitionOrderStatus(currentStatus, status)) {
        baseUpdate.status = status;
      }
    }

    tx.set(orderRef, baseUpdate, { merge: true });
  });

  // Se houve estorno ou chargeback, recalcula o entitlement do usuário com segurança multi-pedidos
  if (userIdToRecalculate) {
    const recalculated = await recalculateUserPlan(userIdToRecalculate);
    await db.collection(COLLECTIONS.wallets).doc(userIdToRecalculate).set({
      planId: recalculated.planId,
      planStatus: recalculated.planStatus,
      currentPeriodEnd: recalculated.currentPeriodEnd,
      updatedAt: nowIso()
    }, { merge: true });
  }
}

async function processStandardPayment(resourceId: string): Promise<{ processed: boolean; message: string }> {
  const payment = await mpJson(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(resourceId)}`);
  const orderId = String(payment.external_reference || '');
  if (!orderId) return { processed: false, message: 'Pagamento sem external_reference.' };
  await applyPaymentCycle({
    orderId,
    paymentId: String(payment.id),
    cycleId: String(payment.id),
    status: String(payment.status || 'pending'),
    amount: Number(payment.transaction_amount || 0),
    currency: String(payment.currency_id || ''),
    paymentMethod: payment.payment_type_id || payment.payment_method_id || undefined
  });
  return { processed: true, message: `Pagamento ${resourceId} validado.` };
}

async function processAuthorizedPayment(resourceId: string): Promise<{ processed: boolean; message: string }> {
  const invoice = await mpJson(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(resourceId)}`);
  let orderId = String(invoice.external_reference || '');
  const subscriptionId = String(invoice.preapproval_id || invoice.preapproval?.id || '');
  if (!orderId && subscriptionId) {
    const snap = await firestore().collection(COLLECTIONS.payments).where('providerSubscriptionId', '==', subscriptionId).limit(1).get();
    if (!snap.empty) orderId = snap.docs[0].id;
  }
  if (!orderId) return { processed: false, message: 'Fatura recorrente sem referência a um pedido Froc.IA.' };
  const paymentId = String(invoice.payment?.id || invoice.id);
  const paymentStatus = String(invoice.payment?.status || invoice.summarized || invoice.status || 'pending');
  await applyPaymentCycle({
    orderId,
    paymentId,
    cycleId: String(invoice.id),
    status: paymentStatus,
    amount: Number(invoice.transaction_amount || 0),
    currency: String(invoice.currency_id || ''),
    subscriptionId: subscriptionId || undefined
  });
  return { processed: true, message: `Ciclo recorrente ${resourceId} validado.` };
}

async function processSubscription(resourceId: string): Promise<{ processed: boolean; message: string }> {
  const subscription = await mpJson(`https://api.mercadopago.com/preapproval/${encodeURIComponent(resourceId)}`);
  const orderId = String(subscription.external_reference || '');
  if (!orderId) return { processed: false, message: 'Assinatura sem external_reference.' };
  const ref = firestore().collection(COLLECTIONS.payments).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Pedido associado à assinatura não encontrado.');
  const existing = snap.data() as any;
  const now = nowIso();
  const currentPeriodEnd = existing.currentPeriodEnd || (existing.lastCreditedAt ? new Date(new Date(existing.lastCreditedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null);

  let newStatus = existing.status || 'pending';
  let periodEnd = existing.currentPeriodEnd || null;

  if (subscription.status === 'cancelled') {
    if (existing.lastCreditedAt && currentPeriodEnd && currentPeriodEnd > now) {
      newStatus = 'cancel_at_period_end';
      periodEnd = currentPeriodEnd;
    } else {
      newStatus = 'cancelled';
      periodEnd = null;
    }
  } else if (subscription.status === 'authorized') {
    // Preapproval autorizada apenas sinaliza autorização de cobrança periódica;
    // O status do plano só passa a 'active' após o primeiro pagamento 'approved' via processAuthorizedPayment.
    newStatus = existing.status === 'active' ? 'active' : 'pending';
  }

  await ref.set({
    providerSubscriptionId: String(subscription.id),
    providerPreapprovalId: String(subscription.id),
    subscriptionStatus: String(subscription.status || 'pending'),
    status: newStatus,
    currentPeriodEnd: periodEnd,
    nextPaymentDate: subscription.next_payment_date || null,
    updatedAt: nowIso()
  }, { merge: true });

  if (existing.userId) {
    await recalculateUserPlan(existing.userId);
  }

  return { processed: true, message: `Assinatura ${resourceId} sincronizada.` };
}

export async function processMercadoPagoWebhook(data: { body: any; query: any; headers: Record<string, any> }) {
  const resourceId = String(data.body?.data?.id || data.query?.['data.id'] || data.query?.id || data.body?.id || '');
  if (!resourceId) return { processed: false, message: 'Notificação sem data.id.' };
  const signatureHeader = String(data.headers['x-signature'] || '');
  const requestId = String(data.headers['x-request-id'] || '');
  if (!verifyMercadoPagoSignature({ signatureHeader, requestId, dataId: resourceId })) {
    const error: any = new Error('Assinatura do webhook Mercado Pago inválida.');
    error.statusCode = 401;
    throw error;
  }

  const type = String(data.body?.type || data.query?.type || data.body?.topic || data.query?.topic || '').toLowerCase();
  if (type === 'subscription_authorized_payment') return processAuthorizedPayment(resourceId);
  if (type === 'subscription_preapproval') return processSubscription(resourceId);
  if (type === 'payment' || type.startsWith('payment.')) return processStandardPayment(resourceId);

  // Algumas notificações modernas usam action em vez de type. Para payment.created/payment.updated,
  // a consulta oficial do pagamento é a fonte de verdade.
  const action = String(data.body?.action || '').toLowerCase();
  if (action.startsWith('payment.')) return processStandardPayment(resourceId);
  return { processed: true, message: `Evento Mercado Pago ${type || action || 'desconhecido'} autenticado e ignorado por não alterar o ledger.` };
}

export async function listUserSubscriptions(userId: string): Promise<any[]> {
  const snap = await firestore().collection(COLLECTIONS.payments).where('userId', '==', userId).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as any))
    .filter((item) => item.billingMode === 'subscription')
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function cancelSubscription(userId: string, orderId?: string): Promise<any> {
  const subscriptions = await listUserSubscriptions(userId);
  const target = orderId ? subscriptions.find((item) => item.id === orderId) : subscriptions.find((item) => ['active','authorized','pending','cancel_at_period_end'].includes(String(item.status)) || ['authorized','pending'].includes(String(item.subscriptionStatus)));
  if (!target) {
    const error: any = new Error('Nenhuma assinatura ativa encontrada.');
    error.statusCode = 404;
    throw error;
  }
  const subscriptionId = String(target.providerSubscriptionId || target.providerPreapprovalId || '');
  if (!subscriptionId) throw new Error('Assinatura sem identificador do Mercado Pago.');

  // Fail-closed: se o Mercado Pago falhar ou não confirmar, propaga erro sem alterar o estado local
  let updated: any;
  try {
    updated = await mpJson(`https://api.mercadopago.com/preapproval/${encodeURIComponent(subscriptionId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
  } catch (err: any) {
    console.error('[MercadoPago] Falha na comunicação ao cancelar assinatura:', err?.message || err);
    const error: any = new Error(`Falha ao comunicar com o Mercado Pago para cancelar a renovação: ${err?.message || 'Erro desconhecido'}`);
    error.statusCode = 502;
    throw error;
  }

  if (!updated || updated.status !== 'cancelled') {
    const error: any = new Error('O Mercado Pago não confirmou o cancelamento da assinatura.');
    error.statusCode = 502;
    throw error;
  }

  // A04: Se a assinatura nunca teve um ciclo pago liquidado (lastCreditedAt ausente), não concede 30 dias de fallback
  const now = nowIso();
  const hasSettledCycle = Boolean(target.lastCreditedAt || target.lastPaymentStatus === 'approved');
  let currentPeriodEnd: string | null = null;
  let finalStatus = 'cancelled';

  if (hasSettledCycle) {
    const rawPeriodEnd = target.nextPaymentDate || target.currentPeriodEnd || (target.lastCreditedAt ? new Date(new Date(target.lastCreditedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : null);
    if (rawPeriodEnd && rawPeriodEnd > now) {
      currentPeriodEnd = rawPeriodEnd;
      finalStatus = 'cancel_at_period_end';
    }
  }

  await firestore().collection(COLLECTIONS.payments).doc(target.id).set({
    status: finalStatus,
    subscriptionStatus: 'cancelled',
    currentPeriodEnd,
    cancelledAt: now,
    updatedAt: now
  }, { merge: true });

  const recalculated = await recalculateUserPlan(userId);
  await firestore().collection(COLLECTIONS.wallets).doc(userId).set({
    planId: recalculated.planId,
    planStatus: recalculated.planStatus,
    currentPeriodEnd: recalculated.currentPeriodEnd,
    updatedAt: now
  }, { merge: true });

  return { id: target.id, providerSubscriptionId: subscriptionId, status: finalStatus, currentPeriodEnd };
}
