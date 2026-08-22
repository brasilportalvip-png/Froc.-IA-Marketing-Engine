import crypto from 'crypto';
import { config } from '../config/index.js';
import { COLLECTIONS, firestore, nowIso, queryData, stableId } from './store.js';

export interface SecurityFingerprintPayload {
  deviceId?: string;
  fingerprintHash?: string;
  hardwareConcurrency?: number;
  screenResolution?: string;
  timezone?: string;
  language?: string;
  claimedToken?: string;
}

export interface AntiAbuseContext {
  userId: string;
  email: string;
  ip: string;
  emailVerified?: boolean;
  userAgent?: string;
  securityPayload?: SecurityFingerprintPayload;
}

export interface BonusVerificationOutcome {
  eligibleForBonus: boolean;
  bonusAmount: number;
  reason:
    | 'approved_first_account'
    | 'blocked_duplicate_device'
    | 'blocked_duplicate_canonical_email'
    | 'blocked_ip_abuse'
    | 'blocked_disposable_email'
    | 'blocked_stored_claim'
    | 'blocked_unverified_email';
  detail: string;
  claimId?: string;
}

type TransactionDecision = {
  outcome: BonusVerificationOutcome;
  eventType?: string;
  eventMetadata?: Record<string, unknown>;
};

// Lista de domínios conhecidos de e-mails descartáveis e temporários
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.biz',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'yopmail.com',
  'yopmail.net',
  'mailinator.com',
  'throwawaymail.com',
  'dispostable.com',
  'getairmail.com',
  'mohmal.com',
  'nada.ltd',
  'inboxkitten.com',
  'burnermail.io',
  'fakemailgenerator.com',
  'crazymailing.com',
  'trashmail.com',
  'trashmail.net',
  'tempail.com',
  'mytemp.email',
  'generator.email',
  'dropmail.me'
]);

export function isDisposableEmailDomain(domain: string): boolean {
  return DISPOSABLE_EMAIL_DOMAINS.has((domain || '').toLowerCase().trim());
}

/**
 * Normaliza e-mail para formato canônico, eliminando truques de aliases
 * (ex.: user+1@gmail.com -> user@gmail.com).
 */
export function normalizeCanonicalEmail(email: string): { canonical: string; domain: string; isDisposable: boolean } {
  const clean = (email || '').trim().toLowerCase();
  const parts = clean.split('@');
  if (parts.length !== 2) {
    return { canonical: clean, domain: '', isDisposable: false };
  }

  let [user, domain] = parts;

  if (domain === 'googlemail.com') domain = 'gmail.com';

  // Sub-endereçamento RFC 5233: remove o alias após o sinal de mais.
  user = user.split('+')[0];

  if (domain === 'gmail.com') {
    // No Gmail, pontos no nome de usuário são ignorados.
    user = user.replace(/\./g, '');
  }

  const isDisposable = DISPOSABLE_EMAIL_DOMAINS.has(domain);
  return {
    canonical: `${user}@${domain}`,
    domain,
    isDisposable
  };
}

export function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function blocked(
  reason: Exclude<BonusVerificationOutcome['reason'], 'approved_first_account'>,
  detail: string
): BonusVerificationOutcome {
  return {
    eligibleForBonus: false,
    bonusAmount: 0,
    reason,
    detail
  };
}

function ownerHashFromRecord(record: any): string {
  if (typeof record?.ownerHash === 'string' && record.ownerHash) return record.ownerHash;
  if (typeof record?.userIdHash === 'string' && record.userIdHash) return record.userIdHash;
  if (typeof record?.userId === 'string' && record.userId) return hashString(record.userId);
  return '';
}

function belongsTo(record: any, ownerHash: string): boolean {
  return Boolean(record && ownerHashFromRecord(record) === ownerHash);
}

async function transactionCreate(transaction: any, ref: any, data: any): Promise<void> {
  // Firestore Admin oferece create(), que falha se o documento já existir.
  // O armazenamento isolado de testes é serializado e expõe apenas set().
  if (typeof transaction.create === 'function') {
    await transaction.create(ref, data);
    return;
  }
  await transaction.set(ref, data);
}

function sanitizeSecurityMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = new Set([
    'email',
    'canonical',
    'ip',
    'deviceId',
    'fingerprintHash',
    'claimedToken',
    'userAgent',
    'originalUserId'
  ]);
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (sensitiveKeys.has(key)) {
      sanitized[`${key}Hash`] = hashString(String(value).slice(0, 1000));
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }
    sanitized[key] = String(value).slice(0, 200);
  }

  return sanitized;
}

/**
 * Verifica se a criação da conta tem direito ao bônus de 25 créditos.
 * Todas as chaves de unicidade são registradas na mesma transação para impedir
 * concessões duplicadas em requisições concorrentes.
 */
export async function evaluateSignupBonusEligibility(ctx: AntiAbuseContext): Promise<BonusVerificationOutcome> {
  const db = firestore();
  const userId = String(ctx.userId || '').trim();
  const ownerHash = hashString(userId);
  const { canonical, domain, isDisposable } = normalizeCanonicalEmail(ctx.email);
  const canonicalHash = hashString(canonical);
  const rawIp = String(ctx.ip || '').trim();
  const ipHash = hashString(rawIp || 'unknown');
  const payload = ctx.securityPayload || {};

  const deviceId = String(payload.deviceId || '').trim();
  const fingerprintHash = String(payload.fingerprintHash || '').trim();
  const claimedToken = String(payload.claimedToken || '').trim();
  const validDeviceId = deviceId.length >= 8 ? deviceId : '';
  const validFingerprint = fingerprintHash.length >= 16 ? fingerprintHash : '';
  const isLoopbackOrUnknownIp = !rawIp || rawIp === '127.0.0.1' || rawIp === '::1';

  if (!userId || !canonical || !domain || !canonical.split('@')[0]) {
    await recordSecurityEvent(userId || 'unknown', 'invalid_email_bonus_rejected', {
      email: ctx.email,
      ip: rawIp
    });
    return blocked(
      'blocked_unverified_email',
      'Confirme um endereço de e-mail válido antes de solicitar o bônus de boas-vindas.'
    );
  }

  // A rota de produção persiste o perfil autenticado antes desta avaliação.
  // Em produção, a ausência do perfil também é tratada de forma fail-closed.
  const profileSnap = await db.collection(COLLECTIONS.users).doc(userId).get();
  const storedEmailVerified = profileSnap.exists
    ? profileSnap.data()?.emailVerified === true
    : undefined;
  const emailVerified = storedEmailVerified ?? (ctx.emailVerified === true);
  const verificationRequired = config.isProduction || profileSnap.exists || typeof ctx.emailVerified === 'boolean';

  if (verificationRequired && !emailVerified) {
    await recordSecurityEvent(userId, 'unverified_email_bonus_rejected', {
      email: ctx.email,
      ip: rawIp
    });
    return blocked(
      'blocked_unverified_email',
      'Verifique seu e-mail antes de receber os créditos de boas-vindas.'
    );
  }

  if (isDisposable) {
    await recordSecurityEvent(userId, 'disposable_email_bonus_rejected', {
      email: ctx.email,
      domain,
      ip: rawIp
    });
    return blocked(
      'blocked_disposable_email',
      'E-mails temporários não são elegíveis para créditos de boas-vindas.'
    );
  }

  if (claimedToken && claimedToken.startsWith('froc_claimed_')) {
    await recordSecurityEvent(userId, 'client_storage_claim_detected', {
      claimedToken,
      ip: rawIp,
      deviceId
    });
    return blocked(
      'blocked_stored_claim',
      'Este dispositivo já recebeu o bônus de boas-vindas em uma conta anterior.'
    );
  }

  const claimId = stableId(`claim:${userId}`);
  const legacyClaimId = `claim-${userId}`;
  const claimRef = db.collection(COLLECTIONS.bonusClaims).doc(claimId);
  const legacyClaimRef = db.collection(COLLECTIONS.bonusClaims).doc(legacyClaimId);
  const emailRef = db.collection(COLLECTIONS.bonusClaims).doc(stableId(`email:${canonicalHash}`));
  const deviceRef = validDeviceId
    ? db.collection(COLLECTIONS.bonusClaims).doc(stableId(`device:${validDeviceId}`))
    : null;
  const fingerprintRef = validFingerprint
    ? db.collection(COLLECTIONS.bonusClaims).doc(stableId(`fp:${validFingerprint}`))
    : null;
  const ipIndexRef = !isLoopbackOrUnknownIp
    ? db.collection(COLLECTIONS.bonusClaims).doc(stableId(`ip:${ipHash}`))
    : null;

  // Compatibilidade com registros anteriores: deduplica por titular para que
  // os documentos de índice legados não sejam contados como bônus separados.
  const legacyIpOwnerHashes = new Set<string>();
  if (ipIndexRef) {
    const legacyIpSnap = await db.collection(COLLECTIONS.bonusClaims).where('ipHash', '==', ipHash).get();
    for (const item of queryData<any>(legacyIpSnap)) {
      const itemOwnerHash = ownerHashFromRecord(item);
      if (itemOwnerHash) legacyIpOwnerHashes.add(itemOwnerHash);
    }
  }

  let decision: TransactionDecision;
  try {
    decision = await db.runTransaction(async (transaction: any): Promise<TransactionDecision> => {
      // Todas as leituras acontecem antes da primeira escrita, como exigido pelo Firestore.
      const claimSnap = await transaction.get(claimRef);
      const legacyClaimSnap = await transaction.get(legacyClaimRef);
      const emailSnap = await transaction.get(emailRef);
      const deviceSnap = deviceRef ? await transaction.get(deviceRef) : null;
      const fingerprintSnap = fingerprintRef ? await transaction.get(fingerprintRef) : null;
      const ipIndexSnap = ipIndexRef ? await transaction.get(ipIndexRef) : null;

      const existingMain = claimSnap.exists
        ? claimSnap.data()
        : legacyClaimSnap.exists
          ? legacyClaimSnap.data()
          : undefined;

      if (existingMain && belongsTo(existingMain, ownerHash)) {
        return {
          outcome: {
            eligibleForBonus: true,
            bonusAmount: 25,
            reason: 'approved_first_account',
            detail: 'Bônus de primeiro cadastro já registrado com segurança.',
            claimId: claimSnap.exists ? claimId : legacyClaimId
          }
        };
      }

      if (emailSnap.exists && !belongsTo(emailSnap.data(), ownerHash)) {
        return {
          outcome: blocked(
            'blocked_duplicate_canonical_email',
            'Este titular de e-mail já resgatou o bônus de boas-vindas em outra conta.'
          ),
          eventType: 'canonical_email_duplicate_blocked',
          eventMetadata: { canonical, ip: rawIp }
        };
      }

      if (deviceSnap?.exists && !belongsTo(deviceSnap.data(), ownerHash)) {
        return {
          outcome: blocked(
            'blocked_duplicate_device',
            'Este dispositivo já recebeu o bônus de boas-vindas na primeira conta criada.'
          ),
          eventType: 'duplicate_device_bonus_blocked',
          eventMetadata: { deviceId: validDeviceId, ip: rawIp }
        };
      }

      if (fingerprintSnap?.exists && !belongsTo(fingerprintSnap.data(), ownerHash)) {
        return {
          outcome: blocked(
            'blocked_duplicate_device',
            'Assinatura digital de hardware já associada a outra conta com bônus resgatado.'
          ),
          eventType: 'duplicate_fingerprint_bonus_blocked',
          eventMetadata: { fingerprintHash: validFingerprint, ip: rawIp }
        };
      }

      const ipOwnerHashes = new Set(legacyIpOwnerHashes);
      const storedIpOwners = ipIndexSnap?.exists && Array.isArray(ipIndexSnap.data()?.ownerHashes)
        ? ipIndexSnap.data().ownerHashes
        : [];
      for (const storedOwner of storedIpOwners) {
        if (typeof storedOwner === 'string' && storedOwner) ipOwnerHashes.add(storedOwner);
      }

      const otherOwnersFromIp = [...ipOwnerHashes].filter((item) => item !== ownerHash);
      if (ipIndexRef && otherOwnersFromIp.length >= 2) {
        return {
          outcome: blocked(
            'blocked_ip_abuse',
            'Limite de bônus por rede de internet atingido. A conta foi criada normalmente sem bônus repetido.'
          ),
          eventType: 'ip_rate_limit_bonus_blocked',
          eventMetadata: { ip: rawIp, count: otherOwnersFromIp.length }
        };
      }

      const claimedAt = nowIso();
      const claimRecord = {
        id: claimId,
        recordType: 'claim',
        ownerHash,
        canonicalEmailHash: canonicalHash,
        deviceIdHash: validDeviceId ? hashString(validDeviceId) : null,
        fingerprintDigest: validFingerprint ? hashString(validFingerprint) : null,
        ipHash,
        userAgentHash: ctx.userAgent ? hashString(String(ctx.userAgent).slice(0, 300)) : null,
        bonusAmount: 25,
        claimedAt
      };
      const indexRecord = {
        recordType: 'unique_index',
        ownerHash,
        claimId,
        claimedAt
      };

      if (!claimSnap.exists && !legacyClaimSnap.exists) {
        await transactionCreate(transaction, claimRef, claimRecord);
      }
      if (!emailSnap.exists) {
        await transactionCreate(transaction, emailRef, indexRecord);
      }
      if (deviceRef && !deviceSnap?.exists) {
        await transactionCreate(transaction, deviceRef, indexRecord);
      }
      if (fingerprintRef && !fingerprintSnap?.exists) {
        await transactionCreate(transaction, fingerprintRef, indexRecord);
      }
      if (ipIndexRef) {
        ipOwnerHashes.add(ownerHash);
        await transaction.set(ipIndexRef, {
          recordType: 'ip_index',
          ipHash,
          ownerHashes: [...ipOwnerHashes].slice(0, 2),
          updatedAt: claimedAt
        });
      }

      return {
        outcome: {
          eligibleForBonus: true,
          bonusAmount: 25,
          reason: 'approved_first_account',
          detail: 'Bônus de primeiro cadastro concedido com sucesso.',
          claimId
        }
      };
    });
  } catch (err) {
    console.error('[AntiAbuse] Falha ao persistir registro de concessão de bônus:', err);
    throw new Error(`Falha ao registrar concessão de bônus anti-abuso: ${(err as any)?.message || err}`);
  }

  if (decision.eventType) {
    await recordSecurityEvent(userId, decision.eventType, decision.eventMetadata || {});
  }

  return decision.outcome;
}

async function recordSecurityEvent(
  userId: string,
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const db = firestore();
    await db.collection(COLLECTIONS.securityEvents).doc(`sec-${crypto.randomUUID()}`).set({
      userIdHash: hashString(String(userId || 'unknown')),
      eventType: String(eventType || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 100),
      metadata: sanitizeSecurityMetadata(metadata),
      timestamp: nowIso()
    });
  } catch {
    // Registro de segurança em best-effort: não altera a decisão transacional do bônus.
  }
}