import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminAuth } from '../providers/firebaseAdmin.js';
import { COLLECTIONS, firestore, nowIso } from './store.js';

export type FrocRole = 'user' | 'admin' | 'support' | 'editor';

export interface FrocUser {
  id: string;
  name: string;
  email: string;
  role: FrocRole;
  createdAt: string;
  updatedAt?: string;
  termsAcceptedAt?: string;
  privacyAcceptedAt?: string;
  termsVersion?: string;
  privacyVersion?: string;
  currentCompanyId?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
}

export interface AuthenticatedRequest extends Request {
  firebaseUser?: DecodedIdToken;
  user?: FrocUser;
}

export const CURRENT_TERMS_VERSION = '2026.1';
export const CURRENT_PRIVACY_VERSION = '2026.1';

const VALID_ROLES = new Set<FrocRole>(['user', 'admin', 'support', 'editor']);
const CONSENT_FLOW_PATHS = new Set([
  '/auth/sync-profile',
  '/auth/accept-terms',
  '/auth/me',
  '/api/auth/sync-profile',
  '/api/auth/accept-terms',
  '/api/auth/me'
]);

export function hasAcceptedLatestTerms(user?: FrocUser | null): boolean {
  if (!user) return false;
  return Boolean(
    user.termsAcceptedAt &&
    user.privacyAcceptedAt &&
    user.termsVersion === CURRENT_TERMS_VERSION &&
    user.privacyVersion === CURRENT_PRIVACY_VERSION
  );
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail(value: unknown): string {
  const email = cleanText(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeHttpUrl(value: unknown): string | undefined {
  const raw = cleanText(value, 1000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function isFrocRole(value: unknown): value is FrocRole {
  return typeof value === 'string' && VALID_ROLES.has(value as FrocRole);
}

/**
 * Custom claims do Firebase são a única fonte autoritativa de privilégios.
 * Um papel salvo no perfil ou enviado em extras nunca promove o usuário.
 */
function roleFromToken(token: DecodedIdToken): FrocRole {
  const roleClaim = isFrocRole(token.role) ? token.role : undefined;
  const frocRoleClaim = isFrocRole(token.frocRole) ? token.frocRole : undefined;

  // Claims conflitantes indicam token/configuração inconsistente: falha segura.
  if (roleClaim && frocRoleClaim && roleClaim !== frocRoleClaim) return 'user';
  return frocRoleClaim || roleClaim || 'user';
}

function displayNameFromToken(token: DecodedIdToken): string {
  const tokenName = cleanText(token.name, 120);
  if (tokenName) return tokenName;
  const email = normalizeEmail(token.email);
  if (email) return cleanText(email.split('@')[0], 120);
  return 'Usuário Froc';
}

function normalizeRequestPath(value: unknown): string {
  const withoutQuery = String(value ?? '').split(/[?#]/, 1)[0];
  const normalized = withoutQuery.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

function isConsentFlow(req: AuthenticatedRequest): boolean {
  return CONSENT_FLOW_PATHS.has(normalizeRequestPath(req.path)) ||
    CONSENT_FLOW_PATHS.has(normalizeRequestPath(req.originalUrl));
}

/**
 * Cria ou recupera o perfil de forma transacional e idempotente.
 * O cliente pode atualizar somente campos comuns; privilégios vêm do token
 * Firebase verificado e consentimentos aceitam apenas as versões vigentes.
 */
export async function ensureUserProfile(token: DecodedIdToken, extras: Partial<FrocUser> = {}): Promise<FrocUser> {
  const uid = cleanText(token.uid, 128);
  if (!uid || uid !== token.uid || uid.includes('/')) {
    throw new Error('Identificador autenticado inválido.');
  }

  const db = firestore();
  const ref = db.collection(COLLECTIONS.users).doc(uid);

  return db.runTransaction(async (transaction: any): Promise<FrocUser> => {
    const snap = await transaction.get(ref);
    const existing = (snap.data() || {}) as Partial<FrocUser>;
    const now = nowIso();

    const requestedTermsVersion = extras.termsVersion === CURRENT_TERMS_VERSION
      ? CURRENT_TERMS_VERSION
      : undefined;
    const requestedPrivacyVersion = extras.privacyVersion === CURRENT_PRIVACY_VERSION
      ? CURRENT_PRIVACY_VERSION
      : undefined;
    const requestedTermsAcceptedAt = requestedTermsVersion
      ? normalizeIsoTimestamp(extras.termsAcceptedAt)
      : undefined;
    const requestedPrivacyAcceptedAt = requestedPrivacyVersion
      ? normalizeIsoTimestamp(extras.privacyAcceptedAt)
      : undefined;

    const requestedName = cleanText(extras.name, 120);
    const existingName = cleanText(existing.name, 120);
    const tokenEmail = normalizeEmail(token.email);
    const existingEmail = normalizeEmail(existing.email);
    const requestedCompanyId = extras.currentCompanyId === undefined
      ? undefined
      : cleanText(extras.currentCompanyId, 200);
    const requestedAvatarUrl = extras.avatarUrl === undefined
      ? undefined
      : normalizeHttpUrl(extras.avatarUrl);

    const profile: FrocUser = {
      id: uid,
      name: requestedName || existingName || displayNameFromToken(token),
      email: tokenEmail || existingEmail,
      role: roleFromToken(token),
      createdAt: normalizeIsoTimestamp(existing.createdAt) || now,
      updatedAt: now,
      termsAcceptedAt: requestedTermsAcceptedAt || normalizeIsoTimestamp(existing.termsAcceptedAt),
      privacyAcceptedAt: requestedPrivacyAcceptedAt || normalizeIsoTimestamp(existing.privacyAcceptedAt),
      termsVersion: requestedTermsAcceptedAt
        ? CURRENT_TERMS_VERSION
        : cleanText(existing.termsVersion, 30) || undefined,
      privacyVersion: requestedPrivacyAcceptedAt
        ? CURRENT_PRIVACY_VERSION
        : cleanText(existing.privacyVersion, 30) || undefined,
      currentCompanyId: requestedCompanyId || cleanText(existing.currentCompanyId, 200) || undefined,
      avatarUrl: requestedAvatarUrl ||
        normalizeHttpUrl(existing.avatarUrl) ||
        normalizeHttpUrl(token.picture),
      // Nunca preserva um true antigo se o token atual disser false ou omitir o sinal.
      emailVerified: token.email_verified === true
    };

    await transaction.set(ref, profile, { merge: true });
    return profile;
  });
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authorization = typeof req.headers.authorization === 'string'
    ? req.headers.authorization.trim()
    : '';
  const match = /^Bearer[\t ]+(\S+)$/i.exec(authorization);
  const idToken = match?.[1] || '';

  if (!idToken || idToken.length > 10_000) {
    res.status(401).json({ error: 'Não autorizado. Faça login novamente.' });
    return;
  }

  let adminAuth;
  try {
    adminAuth = getAdminAuth();
  } catch {
    adminAuth = null;
  }
  if (!adminAuth) {
    console.error('[Froc Auth Security] Firebase Admin Auth não está configurado.');
    res.status(503).json({ error: 'Serviço de autenticação temporariamente indisponível.' });
    return;
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch (verifyError: any) {
    console.warn('[Froc Auth Security] Token rejeitado pelo Firebase Admin:', {
      code: cleanText(verifyError?.code, 100) || 'auth/invalid-token'
    });
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    return;
  }

  if (!cleanText(decoded.uid, 128) || cleanText(decoded.uid, 128) !== decoded.uid || decoded.uid.includes('/')) {
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    return;
  }

  let profile: FrocUser;
  try {
    profile = await ensureUserProfile(decoded);
  } catch (error) {
    console.error(
      '[Froc Auth] Falha ao sincronizar perfil autenticado:',
      error instanceof Error ? cleanText(error.message, 200) : 'Falha desconhecida'
    );
    res.status(503).json({ error: 'Serviço de perfil temporariamente indisponível.' });
    return;
  }

  req.firebaseUser = decoded;
  req.user = profile;

  if (!isConsentFlow(req) && !hasAcceptedLatestTerms(profile)) {
    res.status(428).json({
      error: 'Atualização de consentimento necessária: aceite os Termos de Uso e a Política de Privacidade para continuar.',
      requiresConsent: true,
      currentTermsVersion: CURRENT_TERMS_VERSION,
      currentPrivacyVersion: CURRENT_PRIVACY_VERSION
    });
    return;
  }

  next();
}

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const checkRole = () => {
    const tokenRole = req.firebaseUser ? roleFromToken(req.firebaseUser) : req.user?.role;
    if (!req.user || req.user.role !== 'admin' || tokenRole !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito a administradores.' });
      return;
    }
    next();
  };

  // req.user só é preenchido por requireAuth no backend. Quando a rota ainda
  // não foi autenticada, requireAdmin executa toda a validação criptográfica.
  if (req.user) {
    checkRole();
    return;
  }

  await requireAuth(req, res, checkRole);
}