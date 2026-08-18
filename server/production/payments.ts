import crypto from 'crypto';
import { config } from '../config/index.js';
import { COLLECTIONS, firestore, newId, nowIso, stableId } from './store.js';

export type BillingMode = 'subscription' | 'one_time';

export function mercadoPagoConfigured(): boolean {
  return Boolean(config.mercadoPago.accessToken && config.mercadoPago.webhookSecret);
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${config.mercadoPago.accessToken}`, ...extra };
}

async function mpJson(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    ...init,
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
}

export async function createCheckout(data: { userId: string; userEmail: string; userName: string; planId: string }) {
  if (!config.mercadoPago.accessToken) throw new Error('Mercado Pago não configurado no servidor.');
  const plan = config.plans.find((item) => item.id === data.planId);
  if (!plan) throw new Error('Plano inválido.');

  const orderId = newId('order');
  const billingMode = config.mercadoPago.billingMode as BillingMode;
  const order: Record<string, any> = {
    id: orderId,
    userId: data.userId,
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
  const orderRef = firestore().collection(COLLECTIONS.payments).doc(orderId);
  await orderRef.set(order);

  try {
    if (billingMode === 'subscription') {
      // Assinatura sem plano associado, com checkout pendente. O Mercado Pago
      // disponibiliza init_point e passa a cobrar mensalmente após autorização.
      const body = await mpJson('https://api.mercadopago.com/preapproval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      return { order: { ...order, providerSubscriptionId: String(body.id), initPoint }, initPoint, billingMode };
    }

    const idempotencyKey = `mp-pref-${orderId}`;
    const body = await mpJson('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
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
    await orderRef.update({ providerPreferenceId: body.id, initPoint, idempotencyKey, updatedAt: nowIso() });
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

  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new Error('Pedido Froc associado ao pagamento não foi encontrado.');
    const order = orderSnap.data() as any;
    const walletRef = db.collection(COLLECTIONS.wallets).doc(order.userId);
    const creditIdemRef = db.collection(COLLECTIONS.idempotency).doc(stableId(`mp-credit:${data.paymentId}`));
    const reversalIdemRef = db.collection(COLLECTIONS.idempotency).doc(stableId(`mp-reversal:${data.paymentId}:${data.status}`));

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
      totalUsed: 0, totalReceived: 0, reservedCredits: 0, planId: 'plan_free'
    };
    const credits = Number(order.creditsGranted || 0) + Number(order.bonusCreditsGranted || 0);
    const before = Number(wallet.balance || 0);

    if (status === 'approved' && !creditIdemSnap.exists) {
      tx.set(walletRef, {
        ...wallet,
        id: order.userId,
        userId: order.userId,
        balance: before + credits,
        bonusBalance: Number(wallet.bonusBalance || 0) + Number(order.bonusCreditsGranted || 0),
        totalReceived: Number(wallet.totalReceived || 0) + credits,
        planId: order.planId,
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
      baseUpdate.status = order.billingMode === 'subscription' ? 'active' : 'approved';
      baseUpdate.processedAt = nowIso();
      baseUpdate.lastCreditedAt = nowIso();
    } else if (['refunded', 'charged_back', 'cancelled'].includes(status) && creditIdemSnap.exists && !reversalIdemSnap.exists) {
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
        idempotencyKey: `mp-reversal:${data.paymentId}:${status}`,
        timestamp: nowIso(),
        metadata: { orderId: data.orderId, planId: order.planId, cycleId: data.cycleId }
      });
      tx.set(reversalIdemRef, { key: `mp-reversal:${data.paymentId}:${status}`, createdAt: nowIso(), orderId: data.orderId, credits });
      baseUpdate.status = status;
      baseUpdate.reversedAt = nowIso();
    } else if (status !== 'approved') {
      baseUpdate.status = status;
    }

    tx.set(orderRef, baseUpdate, { merge: true });
  });
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
  await ref.set({
    providerSubscriptionId: String(subscription.id),
    providerPreapprovalId: String(subscription.id),
    subscriptionStatus: String(subscription.status || 'pending'),
    status: subscription.status === 'cancelled' ? 'cancelled' : subscription.status === 'authorized' ? 'active' : String(subscription.status || 'pending'),
    nextPaymentDate: subscription.next_payment_date || null,
    updatedAt: nowIso()
  }, { merge: true });
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
  const target = orderId ? subscriptions.find((item) => item.id === orderId) : subscriptions.find((item) => ['active','authorized','pending'].includes(String(item.status)) || ['authorized','pending'].includes(String(item.subscriptionStatus)));
  if (!target) {
    const error: any = new Error('Nenhuma assinatura ativa encontrada.');
    error.statusCode = 404;
    throw error;
  }
  const subscriptionId = String(target.providerSubscriptionId || target.providerPreapprovalId || '');
  if (!subscriptionId) throw new Error('Assinatura sem identificador do Mercado Pago.');

  const updated = await mpJson(`https://api.mercadopago.com/preapproval/${encodeURIComponent(subscriptionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' })
  });
  await firestore().collection(COLLECTIONS.payments).doc(target.id).set({ status: 'cancelled', subscriptionStatus: 'cancelled', cancelledAt: nowIso(), updatedAt: nowIso() }, { merge: true });
  return { id: target.id, providerSubscriptionId: subscriptionId, status: updated.status || 'cancelled' };
}
