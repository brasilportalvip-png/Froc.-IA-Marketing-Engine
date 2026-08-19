import { COLLECTIONS, firestore, newId, nowIso, stableId } from './store.js';
import { recalculateUserPlan } from './plans.js';

export interface WalletRecord {
  id: string;
  userId: string;
  balance: number;
  bonusBalance: number;
  totalUsed: number;
  totalReceived: number;
  reservedCredits: number;
  planId: string;
  planStatus?: 'free' | 'active' | 'cancel_at_period_end' | 'cancelled' | 'past_due';
  currentPeriodEnd?: string | null;
  updatedAt: string;
}

function defaultWallet(userId: string): WalletRecord {
  return {
    id: userId,
    userId,
    balance: 0,
    bonusBalance: 0,
    totalUsed: 0,
    totalReceived: 0,
    reservedCredits: 0,
    planId: 'plan_free',
    planStatus: 'free',
    currentPeriodEnd: null,
    updatedAt: nowIso()
  };
}

export async function getWallet(userId: string): Promise<WalletRecord> {
  return getEffectiveWallet(userId);
}

export async function getEffectiveWallet(userId: string, options?: { failClosed?: boolean }): Promise<WalletRecord> {
  const db = firestore();
  const ref = db.collection(COLLECTIONS.wallets).doc(userId);
  const snap = await ref.get();
  let wallet: WalletRecord;
  if (snap.exists) {
    wallet = { id: snap.id, ...(snap.data() as any) } as WalletRecord;
  } else {
    wallet = defaultWallet(userId);
    try {
      await ref.set(wallet, { merge: true });
    } catch (error) {
      const fresh = await ref.get();
      if (fresh.exists) {
        wallet = { id: fresh.id, ...(fresh.data() as any) } as WalletRecord;
      }
    }
  }

  // Sincronização centralizada e determinística de validade temporal do plano
  try {
    const effectivePlan = await recalculateUserPlan(userId);
    const hasPlanChanged = (
      wallet.planId !== effectivePlan.planId ||
      wallet.planStatus !== effectivePlan.planStatus ||
      wallet.currentPeriodEnd !== effectivePlan.currentPeriodEnd
    );

    if (hasPlanChanged) {
      wallet.planId = effectivePlan.planId;
      wallet.planStatus = effectivePlan.planStatus;
      wallet.currentPeriodEnd = effectivePlan.currentPeriodEnd;
      wallet.updatedAt = nowIso();

      await ref.set({
        planId: wallet.planId,
        planStatus: wallet.planStatus,
        currentPeriodEnd: wallet.currentPeriodEnd,
        updatedAt: wallet.updatedAt
      }, { merge: true });
    }
  } catch (err) {
    if (options?.failClosed) {
      throw new Error(`[Froc Security] Falha ao recalcular plano efetivo para autorização: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Em caso de falha de leitura e recálculo, rebaixa o plano em memória para free (fail-closed de segurança)
    wallet.planId = 'plan_free';
    wallet.planStatus = 'free';
  }

  return wallet;
}

export async function resolveEffectivePlan(userId: string): Promise<string> {
  const wallet = await getEffectiveWallet(userId, { failClosed: true });
  return wallet.planId || 'plan_free';
}

export async function addCredits(data: {
  userId: string;
  amount: number;
  type: 'purchase' | 'subscription' | 'bonus' | 'admin_adjustment' | 'refund';
  source: string;
  referenceId?: string;
  idempotencyKey: string;
  metadata?: Record<string, any>;
}): Promise<WalletRecord> {
  if (!Number.isFinite(data.amount) || data.amount <= 0) throw new Error('Quantidade de créditos inválida.');
  const db = firestore();
  const walletRef = db.collection(COLLECTIONS.wallets).doc(data.userId);
  const idemRef = db.collection(COLLECTIONS.idempotency).doc(stableId(`credit:${data.idempotencyKey}`));
  const txRef = db.collection(COLLECTIONS.creditTransactions).doc(newId('tx'));

  return db.runTransaction(async (tx) => {
    const [idemSnap, walletSnap] = await Promise.all([tx.get(idemRef), tx.get(walletRef)]);
    const current = walletSnap.exists ? ({ id: data.userId, ...(walletSnap.data() as any) } as WalletRecord) : defaultWallet(data.userId);
    if (idemSnap.exists) return current;

    const before = Number(current.balance || 0);
    const after = before + data.amount;
    const next: WalletRecord = {
      ...current,
      id: data.userId,
      userId: data.userId,
      balance: after,
      bonusBalance: Number(current.bonusBalance || 0) + (data.type === 'bonus' ? data.amount : 0),
      totalReceived: Number(current.totalReceived || 0) + data.amount,
      updatedAt: nowIso()
    };

    tx.set(walletRef, next, { merge: true });
    tx.set(txRef, {
      userId: data.userId,
      type: data.type,
      source: data.source,
      amount: data.amount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId: data.referenceId || null,
      idempotencyKey: data.idempotencyKey,
      timestamp: nowIso(),
      metadata: data.metadata || {}
    });
    tx.set(idemRef, { key: data.idempotencyKey, createdAt: nowIso(), transactionId: txRef.id });
    return next;
  });
}

export async function reserveCredits(data: {
  userId: string;
  amount: number;
  operation: string;
  companyId?: string;
}): Promise<{ reservationId: string; wallet: WalletRecord }> {
  if (!Number.isFinite(data.amount) || data.amount <= 0) throw new Error('Custo de créditos inválido.');
  const db = firestore();
  const walletRef = db.collection(COLLECTIONS.wallets).doc(data.userId);
  const reservationRef = db.collection(COLLECTIONS.creditReservations).doc(newId('res'));

  const wallet = await db.runTransaction(async (tx) => {
    const snap = await tx.get(walletRef);
    const current = snap.exists ? ({ id: data.userId, ...(snap.data() as any) } as WalletRecord) : defaultWallet(data.userId);
    const available = Number(current.balance || 0) - Number(current.reservedCredits || 0);
    if (available < data.amount) {
      throw new Error(`Saldo insuficiente. Necessário: ${data.amount} créditos; disponível: ${Math.max(0, available)}.`);
    }
    const next = { ...current, reservedCredits: Number(current.reservedCredits || 0) + data.amount, updatedAt: nowIso() };
    tx.set(walletRef, next, { merge: true });
    tx.set(reservationRef, {
      userId: data.userId,
      companyId: data.companyId || null,
      amount: data.amount,
      operation: data.operation,
      status: 'reserved',
      createdAt: nowIso()
    });
    return next;
  });

  return { reservationId: reservationRef.id, wallet };
}

export async function commitReservation(data: {
  userId: string;
  reservationId: string;
  source: string;
  metadata?: Record<string, any>;
}): Promise<WalletRecord> {
  const db = firestore();
  const walletRef = db.collection(COLLECTIONS.wallets).doc(data.userId);
  const reservationRef = db.collection(COLLECTIONS.creditReservations).doc(data.reservationId);
  const usageRef = db.collection(COLLECTIONS.creditTransactions).doc(newId('tx'));

  return db.runTransaction(async (tx) => {
    const [walletSnap, reservationSnap] = await Promise.all([tx.get(walletRef), tx.get(reservationRef)]);
    if (!reservationSnap.exists) throw new Error('Reserva de créditos não encontrada.');
    const reservation = reservationSnap.data() as any;
    if (reservation.userId !== data.userId) throw new Error('Reserva inválida.');
    const current = walletSnap.exists ? ({ id: data.userId, ...(walletSnap.data() as any) } as WalletRecord) : defaultWallet(data.userId);
    if (reservation.status === 'committed') return current;
    if (reservation.status !== 'reserved') throw new Error('Reserva de créditos não está ativa.');

    const amount = Number(reservation.amount || 0);
    const before = Number(current.balance || 0);
    if (before < amount) throw new Error('Saldo alterado durante a operação. Tente novamente.');
    const after = before - amount;
    const bonusBefore = Math.max(0, Number(current.bonusBalance || 0));
    const bonusUsed = Math.min(bonusBefore, amount);
    const next: WalletRecord = {
      ...current,
      balance: after,
      bonusBalance: bonusBefore - bonusUsed,
      reservedCredits: Math.max(0, Number(current.reservedCredits || 0) - amount),
      totalUsed: Number(current.totalUsed || 0) + amount,
      updatedAt: nowIso()
    };

    tx.set(walletRef, next, { merge: true });
    tx.update(reservationRef, { status: 'committed', committedAt: nowIso() });
    tx.set(usageRef, {
      userId: data.userId,
      companyId: reservation.companyId || null,
      type: 'usage',
      source: data.source,
      amount: -amount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId: data.reservationId,
      timestamp: nowIso(),
      metadata: { ...(data.metadata || {}), bonusUsed }
    });
    return next;
  });
}

export async function rollbackReservation(userId: string, reservationId: string, reason: string): Promise<void> {
  const db = firestore();
  const walletRef = db.collection(COLLECTIONS.wallets).doc(userId);
  const reservationRef = db.collection(COLLECTIONS.creditReservations).doc(reservationId);
  await db.runTransaction(async (tx) => {
    const [walletSnap, reservationSnap] = await Promise.all([tx.get(walletRef), tx.get(reservationRef)]);
    if (!reservationSnap.exists) return;
    const reservation = reservationSnap.data() as any;
    if (reservation.userId !== userId || reservation.status !== 'reserved') return;
    const current = walletSnap.exists ? ({ id: userId, ...(walletSnap.data() as any) } as WalletRecord) : defaultWallet(userId);
    const amount = Number(reservation.amount || 0);
    tx.set(walletRef, { ...current, reservedCredits: Math.max(0, Number(current.reservedCredits || 0) - amount), updatedAt: nowIso() }, { merge: true });
    tx.update(reservationRef, { status: 'rolled_back', rollbackReason: reason, rolledBackAt: nowIso() });
  });
}

export async function listCreditTransactions(userId: string, limit = 50): Promise<any[]> {
  const snap = await firestore().collection(COLLECTIONS.creditTransactions).where('userId', '==', userId).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as any))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, Math.min(Math.max(limit, 1), 100));
}

export async function cleanupStaleReservations(maxAgeMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(5, maxAgeMinutes) * 60_000).toISOString();
  const snap = await firestore().collection(COLLECTIONS.creditReservations)
    .where('status', '==', 'reserved')
    .where('createdAt', '<=', cutoff)
    .limit(100)
    .get();
  let released = 0;
  for (const doc of snap.docs) {
    const reservation = doc.data() as any;
    if (!reservation?.userId) continue;
    await rollbackReservation(String(reservation.userId), doc.id, 'Reserva expirada automaticamente após timeout.');
    released += 1;
  }
  return released;
}
