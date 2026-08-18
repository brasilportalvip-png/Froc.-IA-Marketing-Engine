import crypto from 'crypto';
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
  userAgent?: string;
  securityPayload?: SecurityFingerprintPayload;
}

export interface BonusVerificationOutcome {
  eligibleForBonus: boolean;
  bonusAmount: number;
  reason: 'approved_first_account' | 'blocked_duplicate_device' | 'blocked_duplicate_canonical_email' | 'blocked_ip_abuse' | 'blocked_disposable_email' | 'blocked_stored_claim';
  detail: string;
  claimId?: string;
}

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
 * Normaliza e-mail para formato canônico, eliminando truques de aliases (ex: user+1@gmail.com -> user@gmail.com)
 */
export function normalizeCanonicalEmail(email: string): { canonical: string; domain: string; isDisposable: boolean } {
  const clean = (email || '').trim().toLowerCase();
  const parts = clean.split('@');
  if (parts.length !== 2) {
    return { canonical: clean, domain: '', isDisposable: false };
  }

  let [user, domain] = parts;

  // Domínios Google (gmail.com, googlemail.com)
  if (domain === 'googlemail.com') domain = 'gmail.com';

  // Sub-endereçamento RFC 5233: remove qualquer sub-alias pós sinal de mais (+tag)
  user = user.split('+')[0];

  if (domain === 'gmail.com') {
    // No Gmail, pontos no nome de usuário são ignorados (u.s.e.r = user)
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

/**
 * Verifica se a criação da conta tem direito ao bônus de 25 créditos ou se é uma tentativa de abuso/multicontas
 */
export async function evaluateSignupBonusEligibility(ctx: AntiAbuseContext): Promise<BonusVerificationOutcome> {
  const db = firestore();
  const { canonical, domain, isDisposable } = normalizeCanonicalEmail(ctx.email);
  const canonicalHash = hashString(canonical);
  const rawIp = ctx.ip || '127.0.0.1';
  const ipHash = hashString(rawIp);
  const payload = ctx.securityPayload || {};

  const deviceId = (payload.deviceId || '').trim();
  const fingerprintHash = (payload.fingerprintHash || '').trim();
  const claimedToken = (payload.claimedToken || '').trim();

  // 1. Bloqueio por e-mail descartável / fraudulento
  if (isDisposable) {
    await recordSecurityEvent(ctx.userId, 'disposable_email_bonus_rejected', { email: ctx.email, domain, ip: rawIp });
    return {
      eligibleForBonus: false,
      bonusAmount: 0,
      reason: 'blocked_disposable_email',
      detail: 'E-mails temporários não são elegíveis para créditos de boas-vindas.'
    };
  }

  // 2. Bloqueio por Token de Bônus já registrado no dispositivo cliente
  if (claimedToken && claimedToken.startsWith('froc_claimed_')) {
    await recordSecurityEvent(ctx.userId, 'client_storage_claim_detected', { claimedToken, ip: rawIp, deviceId });
    return {
      eligibleForBonus: false,
      bonusAmount: 0,
      reason: 'blocked_stored_claim',
      detail: 'Este dispositivo já recebeu o bônus de boas-vindas em uma conta anterior.'
    };
  }

  // 3. Verificação por e-mail canônico (evita aliases repetidos: email+1, email+2)
  const canonicalClaimSnap = await db.collection(COLLECTIONS.bonusClaims).doc(stableId(`email:${canonicalHash}`)).get();
  if (canonicalClaimSnap.exists) {
    const existing = canonicalClaimSnap.data();
    if (existing.userId !== ctx.userId) {
      await recordSecurityEvent(ctx.userId, 'canonical_email_duplicate_blocked', { canonical, originalUserId: existing.userId, ip: rawIp });
      return {
        eligibleForBonus: false,
        bonusAmount: 0,
        reason: 'blocked_duplicate_canonical_email',
        detail: 'Este titular de e-mail já resgatou o bônus de boas-vindas em outra conta.'
      };
    }
  }

  // 4. Verificação por Device ID rígido
  if (deviceId && deviceId.length >= 8) {
    const deviceClaimSnap = await db.collection(COLLECTIONS.bonusClaims).doc(stableId(`device:${deviceId}`)).get();
    if (deviceClaimSnap.exists) {
      const existing = deviceClaimSnap.data();
      if (existing.userId !== ctx.userId) {
        await recordSecurityEvent(ctx.userId, 'duplicate_device_bonus_blocked', { deviceId, originalUserId: existing.userId, ip: rawIp });
        return {
          eligibleForBonus: false,
          bonusAmount: 0,
          reason: 'blocked_duplicate_device',
          detail: 'Este dispositivo já recebeu o bônus de boas-vindas na primeira conta criada.'
        };
      }
    }
  }

  // 5. Verificação por Fingerprint de Hardware/Navegador
  if (fingerprintHash && fingerprintHash.length >= 16) {
    const fpClaimSnap = await db.collection(COLLECTIONS.bonusClaims).doc(stableId(`fp:${fingerprintHash}`)).get();
    if (fpClaimSnap.exists) {
      const existing = fpClaimSnap.data();
      if (existing.userId !== ctx.userId) {
        await recordSecurityEvent(ctx.userId, 'duplicate_fingerprint_bonus_blocked', { fingerprintHash, originalUserId: existing.userId, ip: rawIp });
        return {
          eligibleForBonus: false,
          bonusAmount: 0,
          reason: 'blocked_duplicate_device',
          detail: 'Assinatura digital de hardware já associada a outra conta com bônus resgatado.'
        };
      }
    }
  }

  // 6. Verificação de volume anormal por IP (máximo de 2 bônus por IP para evitar automação/bot farm)
  if (rawIp !== '127.0.0.1' && rawIp !== '::1') {
    const ipClaimsSnap = await db.collection(COLLECTIONS.bonusClaims).where('ipHash', '==', ipHash).get();
    const recentFromIp = queryData<any>(ipClaimsSnap).filter((item) => item.userId !== ctx.userId);
    if (recentFromIp.length >= 2) {
      await recordSecurityEvent(ctx.userId, 'ip_rate_limit_bonus_blocked', { ip: rawIp, count: recentFromIp.length });
      return {
        eligibleForBonus: false,
        bonusAmount: 0,
        reason: 'blocked_ip_abuse',
        detail: 'Limite de bônus por rede de internet atingido. A conta foi criada normalmente sem bônus repetido.'
      };
    }
  }

  // 7. Conta legítima: Registrar reivindicação única nos índices de segurança
  const claimId = `claim-${ctx.userId}`;
  const claimRecord = {
    id: claimId,
    userId: ctx.userId,
    canonicalEmail: canonical,
    canonicalEmailHash: canonicalHash,
    deviceId: deviceId || null,
    fingerprintHash: fingerprintHash || null,
    ipHash,
    ip: rawIp,
    userAgent: (ctx.userAgent || '').slice(0, 300),
    bonusAmount: 25,
    claimedAt: nowIso()
  };

  const batch = db.batch();
  batch.set(db.collection(COLLECTIONS.bonusClaims).doc(claimId), claimRecord);
  batch.set(db.collection(COLLECTIONS.bonusClaims).doc(stableId(`email:${canonicalHash}`)), claimRecord);
  if (deviceId) {
    batch.set(db.collection(COLLECTIONS.bonusClaims).doc(stableId(`device:${deviceId}`)), claimRecord);
  }
  if (fingerprintHash) {
    batch.set(db.collection(COLLECTIONS.bonusClaims).doc(stableId(`fp:${fingerprintHash}`)), claimRecord);
  }
  try {
    await batch.commit();
  } catch (err) {
    console.error('[AntiAbuse] Falha ao persistir registro de concessão de bônus:', err);
    throw new Error(`Falha ao registrar concessão de bônus anti-abuso: ${(err as any)?.message || err}`);
  }

  return {
    eligibleForBonus: true,
    bonusAmount: 25,
    reason: 'approved_first_account',
    detail: 'Bônus de primeiro cadastro concedido com sucesso.',
    claimId
  };
}

async function recordSecurityEvent(userId: string, eventType: string, metadata: Record<string, any>): Promise<void> {
  try {
    const db = firestore();
    await db.collection(COLLECTIONS.securityEvents).doc(`sec-${crypto.randomUUID()}`).set({
      userId,
      eventType,
      metadata,
      timestamp: nowIso()
    });
  } catch {
    // Best-effort logging
  }
}
