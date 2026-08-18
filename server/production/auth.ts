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

function displayNameFromToken(token: DecodedIdToken): string {
  if (typeof token.name === 'string' && token.name.trim()) return token.name.trim();
  if (token.email) return token.email.split('@')[0];
  return 'Usuário Froc';
}

export async function ensureUserProfile(token: DecodedIdToken, extras: Partial<FrocUser> = {}): Promise<FrocUser> {
  const ref = firestore().collection(COLLECTIONS.users).doc(token.uid);
  const snap = await ref.get();
  const existing = snap.data() as Partial<FrocUser> | undefined;
  const claimsRole = (token.role || token.frocRole) as FrocRole | undefined;
  const role: FrocRole = claimsRole || existing?.role || 'user';
  const now = nowIso();

  const profile: FrocUser = {
    id: token.uid,
    name: extras.name?.trim() || existing?.name || displayNameFromToken(token),
    email: token.email || existing?.email || '',
    role,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    termsAcceptedAt: existing?.termsAcceptedAt || extras.termsAcceptedAt,
    privacyAcceptedAt: existing?.privacyAcceptedAt || extras.privacyAcceptedAt,
    termsVersion: existing?.termsVersion || extras.termsVersion,
    privacyVersion: existing?.privacyVersion || extras.privacyVersion,
    currentCompanyId: extras.currentCompanyId ?? existing?.currentCompanyId,
    avatarUrl: extras.avatarUrl ?? existing?.avatarUrl ?? token.picture,
    emailVerified: token.email_verified ?? existing?.emailVerified ?? false
  };

  await ref.set(profile, { merge: true });
  return profile;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Não autorizado. Faça login novamente.' });
      return;
    }

    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      console.error('[Froc Auth Security] Firebase Admin Auth não está configurado.');
      res.status(503).json({ error: 'Serviço de autenticação temporariamente indisponível.' });
      return;
    }

    let decoded: DecodedIdToken;
    try {
      decoded = await adminAuth.verifyIdToken(token, true);
    } catch (verifyError: any) {
      console.warn('[Froc Auth Security] Falha na verificação criptográfica do token:', verifyError?.code || verifyError?.message || 'Token inválido');
      res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
      return;
    }

    const profile = await ensureUserProfile(decoded);
    req.firebaseUser = decoded;
    req.user = profile;
    const isProfileActivation = req.path === '/auth/sync-profile' || req.originalUrl?.endsWith('/api/auth/sync-profile');
    if (!isProfileActivation && (!profile.termsAcceptedAt || !profile.privacyAcceptedAt)) {
      res.status(428).json({ error: 'Ative sua conta aceitando os Termos de Uso e a Política de Privacidade.' });
      return;
    }
    next();
  } catch (error) {
    console.warn('[Froc Auth] Erro inesperado de autenticação:', error instanceof Error ? error.message : 'Falha desconhecida');
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const checkRole = () => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Acesso restrito a administradores.' });
      return;
    }
    next();
  };

  if (req.user) {
    checkRole();
    return;
  }

  await requireAuth(req, res, () => {
    checkRole();
  });
}
