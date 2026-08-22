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

function requireCreditAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} inválida.`);
  return value;
}

function nonNegativeCreditValue(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`[Froc Ledger Integrity] Campo ${field} da carteira está corrompido.`);
  }
  return parsed;
}

function normalizeWallet(userId: string, raw?: Record<string, any>): WalletRecord {
  const base = defaultWallet(userId);
  const wallet: WalletRecord = {
    ...base,
    ...(raw || {}),
    id: userId,
    userId,
    balance: nonNegativeCreditValue(raw?.balance, 'balance'),
    bonusBalance: nonNegativeCreditValue(raw?.bonusBalance, 'bonusBalance'),
    totalUsed: nonNegativeCreditValue(raw?.totalUsed, 'totalUsed'),
    totalReceived: nonNegativeCreditValue(raw?.totalReceived, 'totalReceived'),
    reservedCredits: nonNegativeCreditValue(raw?.reservedCredits, 'reservedCredits'),
    updatedAt: String(raw?.updatedAt || base.updatedAt)
  };
  if (wallet.reservedCredits > wallet.balance) {
    throw new Error('[Froc Ledger Integrity] Créditos reservados excedem o saldo total da carteira.');
  }
  if (wallet.bonusBalance > wallet.balance) {
    throw new Error('[Froc Ledger Integrity] Saldo de bônus excede o saldo total da carteira.');
  }
  return wallet;
}

function creditOperationFingerprint(data: {
  userId: string;
  amount: number;
  type: string;
  referenceId?: string;
}): string {
  return stableId(JSON.stringify({
    userId: data.userId,
    amount: data.amount,
    type: data.type,
    referenceId: data.referenceId || null
  }));
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
    wallet = normalizeWallet(userId, snap.data() as any);
  } else {
    wallet = defaultWallet(userId);
    try {
      await ref.set(wallet, { merge: true });
    } catch (error) {
      const fresh = await ref.get();
      if (fresh.exists) {
        wallet = normalizeWallet(userId, fresh.data() as any);
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
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}): Promise<WalletRecord> {
  const amount = requireCreditAmount(data.amount, 'Quantidade de créditos');
  const providedIdempotencyKey = String(data.idempotencyKey || '').trim();
  if (providedIdempotencyKey.length > 500) throw new Error('Chave de idempotência de créditos inválida.');
  // Compatibilidade segura para chamadas internas legadas: chave ausente nunca pode colidir globalmente.
  const idempotencyKey = providedIdempotencyKey || newId('credit');
  const fingerprint = creditOperationFingerprint({ ...data, amount });
  const db = firestore();
  const walletRef = db.collection(COLLECTIONS.wallets).doc(data.userId);
  const idemRef = db.collection(COLLECTIONS.idempotency).doc(stableId(`credit:${data.userId}:${idempotencyKey}`));
  const legacyIdemRef = db.collection(COLLECTIONS.idempotency).doc(stableId(`credit:${idempotencyKey}`));
  const txRef = db.collection(COLLECTIONS.creditTransactions).doc(newId('tx'));

  return db.runTransaction(async (tx) => {
    const [idemSnap, legacyIdemSnap, walletSnap] = await Promise.all([
      tx.get(idemRef),
      tx.get(legacyIdemRef),
      tx.get(walletRef)
    ]);
    const current = walletSnap.exists ? normalizeWallet(data.userId, walletSnap.data() as any) : defaultWallet(data.userId);
    const previousIdempotency = idemSnap.exists
      ? (idemSnap.data() as any)
      : legacyIdemSnap.exists
        ? (legacyIdemSnap.data() as any)
        : null;
    if (previousIdempotency) {
      if (previousIdempotency.fingerprint && previousIdempotency.fingerprint !== fingerprint) {
        const error: any = new Error('A chave de idempotência já foi utilizada com dados diferentes.');
        error.statusCode = 409;
        throw error;
      }
      return current;
    }

    const before = current.balance;
    const after = before + amount;
    const nextBonus = current.bonusBalance + (data.type === 'bonus' ? amount : 0);
    const nextTotalReceived = current.totalReceived + amount;
    if (![after, nextBonus, nextTotalReceived].every(Number.isSafeInteger)) {
      throw new Error('[Froc Ledger Integrity] Operação excede o limite seguro da carteira.');
    }
    const next: WalletRecord = {
      ...current,
      id: data.userId,
      userId: data.userId,
      balance: after,
      bonusBalance: nextBonus,
      totalReceived: nextTotalReceived,
      updatedAt: nowIso()
    };

    tx.set(walletRef, next, { merge: true });
    tx.set(txRef, {
      userId: data.userId,
      type: data.type,
      source: data.source,
      amount,
      balanceBefore: before,
      balanceAfter: after,
      referenceId: data.referenceId || null,
      idempotencyKey,
      timestamp: nowIso(),
      metadata: data.metadata || {}
    });
    tx.set(idemRef, {
      key: idempotencyKey,
      userId: data.userId,
      fingerprint,
      createdAt: nowIso(),
      transactionId: txRef.id
    });
    return next;
  });
}

export async function reserveCredits(data: {
  userId: string;
  amount: number;
  operation: string;
  companyId?: string;
}): Promise<{ reservationId: string; wallet: WalletRecord }> {
  const amount = requireCreditAmount(data.amount, 'Custo de créditos');
  const operation = String(data.operation || '').trim();
  if (!operation || operation.length > 200) throw new Error('Operação de reserva de créditos inválida.');
  const db = firestore();
  const walletRef = db.collection(COLLECTIONS.wallets).doc(data.userId);
  const reservationRef = db.collection(COLLECTIONS.creditReservations).doc(newId('res'));

  const wallet = await db.runTransaction(async (tx) => {
    const snap = await tx.get(walletRef);
    const current = snap.exists ? normalizeWallet(data.userId, snap.data() as any) : defaultWallet(data.userId);
    const available = current.balance - current.reservedCredits;
    if (available < amount) {
      throw new Error(`Saldo insuficiente. Necessário: ${amount} créditos; disponível: ${Math.max(0, available)}.`);
    }
    const nextReserved = current.reservedCredits + amount;
    if (!Number.isSafeInteger(nextReserved) || nextReserved > current.balance) {
      throw new Error('[Froc Ledger Integrity] Reserva excede o saldo disponível da carteira.');
    }
    const timestamp = nowIso();
    const next: WalletRecord = { ...current, reservedCredits: nextReserved, updatedAt: timestamp };
    tx.set(walletRef, next, { merge: true });
    tx.set(reservationRef, {
      id: reservationRef.id,
      userId: data.userId,
      companyId: data.companyId || null,
      amount,
      operation,
      status: 'reserved',
      createdAt: timestamp,
      updatedAt: timestamp
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
    const current = walletSnap.exists ? normalizeWallet(data.userId, walletSnap.data() as any) : defaultWallet(data.userId);
    if (reservation.status === 'committed') return current;
    if (reservation.status !== 'reserved') throw new Error('Reserva de créditos não está ativa.');

    const amount = requireCreditAmount(Number(reservation.amount), 'Quantidade reservada');
    const before = current.balance;
    if (before < amount) throw new Error('Saldo alterado durante a operação. Tente novamente.');
    if (current.reservedCredits < amount) {
      throw new Error('[Froc Ledger Integrity] Reserva ativa não está refletida na carteira.');
    }
    const after = before - amount;
    const bonusBefore = current.bonusBalance;
    const bonusUsed = Math.min(bonusBefore, amount);
    const nextTotalUsed = current.totalUsed + amount;
    if (!Number.isSafeInteger(nextTotalUsed)) {
      throw new Error('[Froc Ledger Integrity] Consumo excede o limite seguro da carteira.');
    }
    const next: WalletRecord = {
      ...current,
      balance: after,
      bonusBalance: bonusBefore - bonusUsed,
      reservedCredits: current.reservedCredits - amount,
      totalUsed: nextTotalUsed,
      updatedAt: nowIso()
    };

    tx.set(walletRef, next, { merge: true });
    tx.update(reservationRef, { status: 'committed', committedAt: nowIso(), updatedAt: nowIso() });
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

export async function rollbackReservation(userId: string, reservationId: string, reason: string): Promise<boolean> {
  const db = firestore();
  const walletRef = db.collection(COLLECTIONS.wallets).doc(userId);
  const reservationRef = db.collection(COLLECTIONS.creditReservations).doc(reservationId);
  return db.runTransaction(async (tx) => {
    const [walletSnap, reservationSnap] = await Promise.all([tx.get(walletRef), tx.get(reservationRef)]);
    if (!reservationSnap.exists) return false;
    const reservation = reservationSnap.data() as any;
    if (reservation.userId !== userId || reservation.status !== 'reserved') return false;
    const current = walletSnap.exists ? normalizeWallet(userId, walletSnap.data() as any) : defaultWallet(userId);
    const amount = requireCreditAmount(Number(reservation.amount), 'Quantidade reservada');
    if (current.reservedCredits < amount) {
      throw new Error('[Froc Ledger Integrity] Estorno recusado: reserva não está refletida na carteira.');
    }
    const timestamp = nowIso();
    tx.set(walletRef, { ...current, reservedCredits: current.reservedCredits - amount, updatedAt: timestamp }, { merge: true });
    tx.update(reservationRef, {
      status: 'rolled_back',
      rollbackReason: String(reason || 'Operação cancelada.').slice(0, 500),
      rolledBackAt: timestamp,
      updatedAt: timestamp
    });
    return true;
  });
}

export async function listCreditTransactions(userId: string, limit = 50): Promise<any[]> {
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const snap = await firestore().collection(COLLECTIONS.creditTransactions).where('userId', '==', userId).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as any))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, safeLimit);
}

export async function cleanupStaleReservations(maxAgeMinutes = 30): Promise<number> {
  const db = firestore();
  const safeAgeMinutes = Number.isFinite(maxAgeMinutes) ? Math.max(5, Math.floor(maxAgeMinutes)) : 30;
  const staleAgeMs = safeAgeMinutes * 60_000;
  const now = Date.now();
  const cutoff = new Date(now - staleAgeMs).toISOString();
  const snap = await db.collection(COLLECTIONS.creditReservations)
    .where('status', '==', 'reserved')
    .where('createdAt', '<=', cutoff)
    .limit(100)
    .get();
  let released = 0;
  for (const doc of snap.docs) {
    const reservation = doc.data() as any;
    if (!reservation?.userId) continue;

    // Não libera créditos de um vídeo que ainda possui heartbeat ou lease ativo.
    const jobsSnap = await db.collection(COLLECTIONS.mediaGenerationJobs)
      .where('reservationId', '==', doc.id)
      .limit(5)
      .get();
    const hasActiveJob = jobsSnap.docs.some((jobDoc: any) => {
      const job = jobDoc.data() as any;
      if (!['queued', 'processing', 'finalizing'].includes(String(job.status))) return false;
      const leaseUntil = job.finalizationLeaseUntil ? new Date(job.finalizationLeaseUntil).getTime() : 0;
      if (job.status === 'finalizing' && Number.isFinite(leaseUntil) && leaseUntil > now) return true;
      const heartbeat = new Date(job.updatedAt || job.providerStartedAt || job.createdAt || 0).getTime();
      return Number.isFinite(heartbeat) && now - heartbeat < staleAgeMs;
    });
    if (hasActiveJob) continue;

    const rolledBack = await rollbackReservation(
      String(reservation.userId),
      doc.id,
      'Reserva expirada automaticamente após timeout sem job ativo.'
    );
    if (rolledBack) released += 1;
  }
  return released;
}