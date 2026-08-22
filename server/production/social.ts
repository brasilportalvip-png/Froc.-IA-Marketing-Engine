import crypto from 'crypto';
import { config } from '../config/index.js';
import { COLLECTIONS, firestore, nowIso, stableId } from './store.js';

export type SocialProvider = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'linkedin' | 'pinterest' | 'x';

export const TEXT_AUTO_PUBLISH_PROVIDERS: readonly SocialProvider[] = ['facebook', 'linkedin', 'x'] as const;

export function isTextAutoPublishSupported(provider: string): boolean {
  const norm = normalizeProvider(provider);
  if (!norm) return false;
  return (TEXT_AUTO_PUBLISH_PROVIDERS as readonly string[]).includes(norm);
}

export function getProviderAutoPublishReason(provider: string): string | null {
  const norm = normalizeProvider(provider);
  if (!norm) return 'Rede social não reconhecida.';
  if (isTextAutoPublishSupported(norm)) return null;
  switch (norm) {
    case 'instagram':
      return 'O Instagram exige mídia visual obrigatória (imagem ou vídeo) via Graph API e não suporta publicação automática puramente textual.';
    case 'tiktok':
      return 'O TikTok suporta exclusivamente postagem de vídeos via API Direct Post/Draft Inbox.';
    case 'youtube':
      return 'O YouTube exige arquivo de vídeo ou Short para publicação.';
    case 'pinterest':
      return 'O Pinterest exige envio de imagem e URL de destino para criação de Pins.';
    default:
      return `A rede social "${provider}" não suporta publicação automática textual direta neste pipeline.`;
  }
}

export function normalizeProvider(value: string): SocialProvider | null {
  const v = String(value || '').toLowerCase().trim();
  if (v.includes('instagram')) return 'instagram';
  if (v.includes('facebook')) return 'facebook';
  if (v.includes('tiktok')) return 'tiktok';
  if (v.includes('youtube')) return 'youtube';
  if (v.includes('linkedin')) return 'linkedin';
  if (v === 'x' || v.includes('twitter')) return 'x';
  if (v.includes('pinterest')) return 'pinterest';
  return null;
}

function key(): Buffer {
  const encKey = config.encryptionKey || (process.env.NODE_ENV === 'test' ? 'default_test_token_encryption_key_32bytes_long!' : '');
  if (!encKey) throw new Error('TOKEN_ENCRYPTION_KEY não configurada.');
  return crypto.createHash('sha256').update(encKey).digest();
}

export function encrypt(value: string): string {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decrypt(value: string): string {
  if (!value) return '';
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('Token social criptografado inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8');
}

function callbackUrl(provider: SocialProvider): string {
  return `${config.appUrl}/api/social/${provider}/callback`;
}

function base64UrlSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function providerCredentials(provider: SocialProvider): { clientId: string; clientSecret: string } {
  switch (provider) {
    case 'facebook':
    case 'instagram': return { clientId: config.social.meta.clientId, clientSecret: config.social.meta.clientSecret };
    case 'linkedin': return { clientId: config.social.linkedin.clientId, clientSecret: config.social.linkedin.clientSecret };
    case 'youtube': return { clientId: config.social.google.clientId, clientSecret: config.social.google.clientSecret };
    case 'tiktok': return { clientId: config.social.tiktok.clientId, clientSecret: config.social.tiktok.clientSecret };
    case 'pinterest': return { clientId: config.social.pinterest.clientId, clientSecret: config.social.pinterest.clientSecret };
    case 'x': return { clientId: config.social.x.clientId, clientSecret: config.social.x.clientSecret };
  }
}

export async function createOAuthUrl(data: { provider: SocialProvider; userId: string; companyId: string }) {
  const credentials = providerCredentials(data.provider);
  if (!credentials.clientId) throw new Error(`Credenciais OAuth de ${data.provider} não configuradas.`);
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = data.provider === 'x' ? crypto.randomBytes(48).toString('base64url') : '';
  await firestore().collection(COLLECTIONS.oauthStates).doc(stableId(state)).set({
    stateHash: stableId(state),
    provider: data.provider,
    userId: data.userId,
    companyId: data.companyId,
    codeVerifier: codeVerifier ? encrypt(codeVerifier) : null,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const redirectUri = callbackUrl(data.provider);
  let url: URL;
  switch (data.provider) {
    case 'linkedin':
      url = new URL('https://www.linkedin.com/oauth/v2/authorization');
      url.search = new URLSearchParams({ response_type: 'code', client_id: credentials.clientId, redirect_uri: redirectUri, state, scope: 'openid profile email w_member_social' }).toString();
      break;
    case 'youtube':
      url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ response_type: 'code', client_id: credentials.clientId, redirect_uri: redirectUri, state, scope: 'openid email profile https://www.googleapis.com/auth/youtube.upload', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }).toString();
      break;
    case 'tiktok':
      url = new URL('https://www.tiktok.com/v2/auth/authorize/');
      url.search = new URLSearchParams({ client_key: credentials.clientId, response_type: 'code', scope: 'user.info.basic,video.upload', redirect_uri: redirectUri, state }).toString();
      break;
    case 'pinterest':
      url = new URL('https://www.pinterest.com/oauth/');
      url.search = new URLSearchParams({ client_id: credentials.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'boards:read,pins:read,pins:write,user_accounts:read', state }).toString();
      break;
    case 'x':
      url = new URL('https://x.com/i/oauth2/authorize');
      url.search = new URLSearchParams({ response_type: 'code', client_id: credentials.clientId, redirect_uri: redirectUri, scope: 'tweet.read tweet.write users.read offline.access', state, code_challenge: base64UrlSha256(codeVerifier), code_challenge_method: 'S256' }).toString();
      break;
    case 'facebook':
      url = new URL(`https://www.facebook.com/${config.social.meta.graphVersion}/dialog/oauth`);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        scope: 'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,business_management'
      }).toString();
      break;
    case 'instagram':
      url = new URL(`https://www.facebook.com/${config.social.meta.graphVersion}/dialog/oauth`);
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        scope: 'public_profile,pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish'
      }).toString();
      break;
  }
  return { url: url.toString(), provider: data.provider };
}

async function exchangeCode(provider: SocialProvider, code: string, codeVerifier = ''): Promise<any> {
  const { clientId, clientSecret } = providerCredentials(provider);
  const redirectUri = callbackUrl(provider);
  let endpoint = '';
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  let params: URLSearchParams;

  if (provider === 'linkedin') {
    endpoint = 'https://www.linkedin.com/oauth/v2/accessToken';
    params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret });
  } else if (provider === 'youtube') {
    endpoint = 'https://oauth2.googleapis.com/token';
    params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret });
  } else if (provider === 'tiktok') {
    endpoint = 'https://open.tiktokapis.com/v2/oauth/token/';
    params = new URLSearchParams({ client_key: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  } else if (provider === 'pinterest') {
    endpoint = 'https://api.pinterest.com/v5/oauth/token';
    params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else if (provider === 'x') {
    endpoint = 'https://api.x.com/2/oauth2/token';
    params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: clientId });
    if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    const url = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/oauth/access_token`);
    url.search = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }).toString();
    const response = await fetch(url);
    const json = await response.json().catch(() => ({} as any));
    if (!response.ok || !json.access_token) throw new Error(json.error?.message || `Falha OAuth ${provider}.`);
    return json;
  }

  const response = await fetch(endpoint, { method: 'POST', headers, body: params.toString() });
  const json = await response.json().catch(() => ({} as any));
  if (!response.ok || !json.access_token) throw new Error(json.error_description || json.message || json.error || `Falha OAuth ${provider}.`);
  return json;
}

async function fetchAccount(provider: SocialProvider, accessToken: string): Promise<{ id: string; name: string }> {
  let endpoint = '';
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (provider === 'linkedin') endpoint = 'https://api.linkedin.com/v2/userinfo';
  else if (provider === 'youtube') endpoint = 'https://www.googleapis.com/oauth2/v3/userinfo';
  else if (provider === 'tiktok') endpoint = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url';
  else if (provider === 'pinterest') endpoint = 'https://api.pinterest.com/v5/user_account';
  else if (provider === 'x') endpoint = 'https://api.x.com/2/users/me';
  else endpoint = `https://graph.facebook.com/${config.social.meta.graphVersion}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;

  const response = await fetch(endpoint, { headers });
  const json = await response.json().catch(() => ({} as any));
  if (!response.ok) throw new Error(json.error?.message || json.message || `Falha ao consultar perfil ${provider}.`);
  const source = provider === 'tiktok' ? json.data?.user : provider === 'x' ? json.data : json;
  return { id: String(source?.id || source?.sub || source?.open_id || source?.username || 'unknown'), name: String(source?.name || source?.display_name || source?.username || provider) };
}

export function hasPagePublishTask(tasks?: string[]): boolean {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return true;
  }
  const normalized = tasks.map((t) => String(t).toUpperCase());
  return normalized.some((t) =>
    ['CREATE_CONTENT', 'MANAGE', 'MODERATE', 'PUBLISH_TO_PAGE', 'CONTENT'].includes(t)
  );
}

export function sanitizeOAuthPublicError(err: any, provider: SocialProvider): string {
  const msg = String(err?.message || err || '').trim();

  // Erros de diagnóstico e permissão conhecidos
  if (msg.startsWith("Permissão '") && msg.includes('não foi concedida')) {
    return msg;
  }
  if (
    msg.includes('Nenhuma Página do Facebook') ||
    msg.includes('não possui permissão de criação/publicação') ||
    msg.includes('Page Access Token')
  ) {
    return msg;
  }
  if (msg.includes('Nenhuma conta profissional do Instagram')) {
    return msg;
  }
  if (
    msg.includes('Estado OAuth inválido') ||
    msg.includes('Sessão OAuth expirada') ||
    msg.includes('Autorização OAuth incompleta')
  ) {
    return msg;
  }
  if (
    msg.includes('access_denied') ||
    msg.includes('cancelou') ||
    msg.includes('cancelada') ||
    msg.includes('Cancelado')
  ) {
    return 'Autorização cancelada pelo usuário.';
  }

  const providerNames: Record<SocialProvider, string> = {
    facebook: 'o Facebook',
    instagram: 'o Instagram',
    tiktok: 'o TikTok',
    youtube: 'o YouTube',
    linkedin: 'o LinkedIn',
    pinterest: 'o Pinterest',
    x: 'o X (Twitter)'
  };
  const target = providerNames[provider] || provider;
  return `Não foi possível concluir a conexão com ${target}.`;
}

async function diagnoseMetaPermissions(userToken: string, requiredPermissions: string[]): Promise<string | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/me/permissions`);
    url.search = new URLSearchParams({ access_token: userToken }).toString();
    const res = await fetch(url);
    const json = await res.json().catch(() => ({} as any));
    if (res.ok && Array.isArray(json.data)) {
      const granted = new Set(
        json.data
          .filter((item: any) => item?.status === 'granted')
          .map((item: any) => String(item?.permission))
      );
      for (const perm of requiredPermissions) {
        if (!granted.has(perm)) {
          return `Permissão '${perm}' não foi concedida na autorização da Meta.`;
        }
      }
    }
  } catch {
    // Diagnóstico silencioso em caso de erro de rede
  }
  return null;
}

export async function resolveMetaAccount(provider: 'facebook' | 'instagram', shortToken: string): Promise<{ id: string; name: string; accessToken: string; pageId?: string }> {
  let userToken = shortToken;
  // Troca o token curto por token de usuário de longa duração quando o app secret está disponível.
  if (config.social.meta.clientSecret) {
    const exchange = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/oauth/access_token`);
    exchange.search = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: config.social.meta.clientId,
      client_secret: config.social.meta.clientSecret,
      fb_exchange_token: shortToken
    }).toString();
    const response = await fetch(exchange);
    const json = await response.json().catch(() => ({} as any));
    if (response.ok && json.access_token) userToken = String(json.access_token);
  }

  if (provider === 'facebook') {
    // 1. Descoberta primária: /me/accounts
    const pagesUrl = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/me/accounts`);
    pagesUrl.search = new URLSearchParams({
      fields: 'id,name,access_token,tasks,category',
      access_token: userToken
    }).toString();
    const pagesResponse = await fetch(pagesUrl);
    const pagesJson = await pagesResponse.json().catch(() => ({} as any));
    const pages = Array.isArray(pagesJson.data) ? pagesJson.data : [];

    let eligiblePage = pages.find((item: any) => item?.id && item?.access_token && hasPagePublishTask(item?.tasks));
    let candidatePages = [...pages];

    // 2. Fallback para Business Manager: /me/businesses -> /{business-id}/owned_pages e /{business-id}/client_pages
    if (!eligiblePage) {
      const businessesUrl = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/me/businesses`);
      businessesUrl.search = new URLSearchParams({
        fields: 'id,name',
        access_token: userToken
      }).toString();
      const businessesResponse = await fetch(businessesUrl);
      const businessesJson = await businessesResponse.json().catch(() => ({} as any));
      const businesses = Array.isArray(businessesJson.data) ? businessesJson.data : [];

      for (const biz of businesses) {
        if (!biz?.id) continue;

        // 2a. /{business-id}/owned_pages
        const ownedUrl = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/${biz.id}/owned_pages`);
        ownedUrl.search = new URLSearchParams({
          fields: 'id,name,access_token,tasks,category',
          access_token: userToken
        }).toString();
        const ownedRes = await fetch(ownedUrl);
        const ownedJson = await ownedRes.json().catch(() => ({} as any));
        const ownedPages = Array.isArray(ownedJson.data) ? ownedJson.data : [];
        candidatePages.push(...ownedPages);

        eligiblePage = ownedPages.find((p: any) => p?.id && p?.access_token && hasPagePublishTask(p?.tasks));
        if (eligiblePage) break;

        // 2b. /{business-id}/client_pages
        const clientUrl = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/${biz.id}/client_pages`);
        clientUrl.search = new URLSearchParams({
          fields: 'id,name,access_token,tasks,category',
          access_token: userToken
        }).toString();
        const clientRes = await fetch(clientUrl);
        const clientJson = await clientRes.json().catch(() => ({} as any));
        const clientPages = Array.isArray(clientJson.data) ? clientJson.data : [];
        candidatePages.push(...clientPages);

        eligiblePage = clientPages.find((p: any) => p?.id && p?.access_token && hasPagePublishTask(p?.tasks));
        if (eligiblePage) break;
      }
    }

    if (eligiblePage && eligiblePage.id && eligiblePage.access_token) {
      return {
        id: String(eligiblePage.id),
        name: String(eligiblePage.name || 'Facebook Page'),
        accessToken: String(eligiblePage.access_token),
        pageId: String(eligiblePage.id)
      };
    }

    // 3. Diagnóstico seguro de permissões quando nenhuma página utilizável foi localizada
    const permDiag = await diagnoseMetaPermissions(userToken, [
      'public_profile',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'business_management'
    ]);
    if (permDiag) {
      throw new Error(permDiag);
    }

    if (candidatePages.length > 0) {
      const pageWithoutTask = candidatePages.find((p: any) => p?.id && p?.tasks && !hasPagePublishTask(p.tasks));
      if (pageWithoutTask) {
        throw new Error('A Página do Facebook encontrada não possui permissão de criação/publicação de conteúdo.');
      }
      throw new Error('A Página do Facebook encontrada não forneceu um Page Access Token válido para publicação.');
    }

    throw new Error('Nenhuma Página do Facebook foi encontrada nesta conta ou Portfólio Empresarial (Business Manager). Certifique-se de que sua conta tenha Controle Total ou permissão de publicação na Página.');
  }

  // Provider: Instagram
  const pagesUrl = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/me/accounts`);
  pagesUrl.search = new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username,name}',
    access_token: userToken
  }).toString();
  const pagesResponse = await fetch(pagesUrl);
  const pagesJson = await pagesResponse.json().catch(() => ({} as any));
  const pages = Array.isArray(pagesJson.data) ? pagesJson.data : [];

  const page = pages.find((item: any) => item?.instagram_business_account?.id && item?.access_token);

  if (!page || !page.instagram_business_account?.id || !page.access_token) {
    const permDiag = await diagnoseMetaPermissions(userToken, [
      'public_profile',
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_content_publish'
    ]);
    if (permDiag) throw new Error(permDiag);
    throw new Error('Nenhuma conta profissional do Instagram vinculada a uma Página do Facebook foi encontrada.');
  }

  const ig = page.instagram_business_account;
  return {
    id: String(ig.id),
    name: String(ig.username || ig.name || 'Instagram'),
    accessToken: String(page.access_token),
    pageId: String(page.id)
  };
}

export async function handleOAuthCallback(data: { provider: SocialProvider; code: string; state: string }) {
  const stateRef = firestore().collection(COLLECTIONS.oauthStates).doc(stableId(data.state));
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) throw new Error('Estado OAuth inválido ou já utilizado.');
  const state = stateSnap.data() as any;
  if (state.provider !== data.provider || Number(state.expiresAt) < Date.now()) {
    await stateRef.delete().catch(() => undefined);
    throw new Error('Sessão OAuth expirada ou incompatível.');
  }
  await stateRef.delete();
  const verifier = state.codeVerifier ? decrypt(state.codeVerifier) : '';
  const token = await exchangeCode(data.provider, data.code, verifier);
  let account: { id: string; name: string; accessToken?: string; pageId?: string };
  if (data.provider === 'facebook' || data.provider === 'instagram') {
    account = await resolveMetaAccount(data.provider, token.access_token);
  } else {
    account = await fetchAccount(data.provider, token.access_token);
  }
  const tokenToStore = account.accessToken || token.access_token;
  const connectionId = stableId(`${state.userId}:${state.companyId}:${data.provider}`);
  const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
  await firestore().collection(COLLECTIONS.socialConnections).doc(connectionId).set({
    userId: state.userId,
    companyId: state.companyId,
    provider: data.provider,
    accountId: account.id,
    accountName: account.name,
    pageId: account.pageId || null,
    encryptedAccessToken: encrypt(tokenToStore),
    encryptedRefreshToken: token.refresh_token ? encrypt(token.refresh_token) : null,
    scopes: String(token.scope || '').split(/[ ,]+/).filter(Boolean),
    expiresAt,
    connectedAt: nowIso(),
    updatedAt: nowIso(),
    status: 'connected'
  }, { merge: true });
  return { success: true, userId: state.userId, companyId: state.companyId, account: { id: account.id, name: account.name } };
}

export async function listConnections(userId: string, companyId: string) {
  const snap = await firestore().collection(COLLECTIONS.socialConnections).where('userId', '==', userId).where('companyId', '==', companyId).get();
  return snap.docs.map((doc) => {
    const item = doc.data() as any;
    const { encryptedAccessToken, encryptedRefreshToken, ...safe } = item;
    const isExpired = item.expiresAt ? new Date(item.expiresAt).getTime() < Date.now() : false;
    return {
      id: doc.id,
      ...safe,
      status: isExpired ? 'token_expired' : item.status || 'connected'
    };
  });
}

export async function disconnectSocial(userId: string, companyId: string, provider: string): Promise<boolean> {
  const snap = await firestore().collection(COLLECTIONS.socialConnections).where('userId', '==', userId).where('companyId', '==', companyId).where('provider', '==', provider).limit(10).get();
  if (snap.empty) return false;
  const batch = firestore().batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return true;
}

export async function publishText(data: { userId: string; companyId: string; provider: SocialProvider; text: string }) {
  const trimmedText = (data.text || '').trim();
  if (!trimmedText) throw new Error(`O texto para publicação em ${data.provider} não pode estar vazio.`);

  const snap = await firestore().collection(COLLECTIONS.socialConnections).where('userId', '==', data.userId).where('companyId', '==', data.companyId).where('provider', '==', data.provider).limit(1).get();
  if (snap.empty) throw new Error(`Conta ${data.provider} não conectada.`);
  const connection = snap.docs[0].data() as any;
  if (connection.expiresAt && new Date(connection.expiresAt).getTime() < Date.now()) {
    await snap.docs[0].ref.update({ status: 'token_expired', updatedAt: nowIso() }).catch(() => undefined);
    throw new Error(`A autenticação com ${data.provider} expirou. Reconecte a conta nas configurações para autorizar novas publicações.`);
  }

  const tokenEncrypted = connection.encryptedAccessToken || connection.accessToken || '';
  const token = decrypt(tokenEncrypted);
  const targetAccountId = connection.accountId || connection.pageId;

  if (data.provider === 'x') {
    const response = await fetch('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: trimmedText.slice(0, 280) }) });
    const json = await response.json().catch(() => ({} as any));
    if (!response.ok) throw new Error(json.detail || json.title || 'Falha ao publicar no X.');
    return { provider: 'x', externalId: json.data?.id || null };
  }

  if (data.provider === 'facebook') {
    if (!targetAccountId) throw new Error('Identificador da Página do Facebook (accountId / pageId) não encontrado na conexão.');
    const endpoint = `https://graph.facebook.com/${config.social.meta.graphVersion}/${encodeURIComponent(targetAccountId)}/feed`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: trimmedText, access_token: token }).toString()
    });
    const json = await response.json().catch(() => ({} as any));
    if (!response.ok || !json.id) throw new Error(json.error?.message || 'Falha ao publicar na Página do Facebook.');
    return { provider: 'facebook', externalId: String(json.id) };
  }

  if (data.provider === 'linkedin') {
    if (!config.social.linkedin.apiVersion) throw new Error('LINKEDIN_API_VERSION precisa estar configurada para publicação no LinkedIn.');
    const response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': config.social.linkedin.apiVersion,
        'X-Restli-Protocol-Version': '2.0.0'
      },
      body: JSON.stringify({
        author: `urn:li:person:${connection.accountId}`,
        commentary: trimmedText,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false
      })
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Falha ao publicar no LinkedIn: ${response.status} ${responseText.slice(0, 300)}`);
    return { provider: 'linkedin', externalId: response.headers.get('x-restli-id') };
  }

  throw new Error(`Publicação automática de texto para ${data.provider} exige mídia e/ou permissões específicas. Conexão mantida, mas o post não será marcado como publicado sem uma chamada real compatível.`);
}

export const MAX_TIKTOK_SANDBOX_VIDEO_SIZE = 4 * 1024 * 1024; // 4 MiB

export function isValidMp4Buffer(buffer: Buffer): boolean {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  const ftyp = buffer.subarray(4, 8).toString('ascii');
  return ftyp === 'ftyp';
}

export async function uploadTikTokDraftVideo(data: {
  userId: string;
  companyId: string;
  videoBuffer: Buffer;
  videoSize: number;
  mimeType?: string;
  title?: string;
}): Promise<{
  success: boolean;
  publishId: string;
  status: string;
  message: string;
}> {
  if (!data.videoBuffer || data.videoSize <= 0) {
    throw new Error('Arquivo de vídeo inválido ou vazio.');
  }

  // Limite estrito de 4 MiB para fase de Sandbox / Vercel Serverless
  if (data.videoSize > MAX_TIKTOK_SANDBOX_VIDEO_SIZE) {
    throw new Error('O vídeo excede o limite de 4 MB desta fase de verificação do TikTok.');
  }

  // Validação de assinatura de container MP4 (ftyp)
  if (!isValidMp4Buffer(data.videoBuffer)) {
    throw new Error('Arquivo de vídeo inválido. Apenas containers MP4 autênticos (.mp4 com assinatura ftyp) são aceitos.');
  }

  const snap = await firestore()
    .collection(COLLECTIONS.socialConnections)
    .where('userId', '==', data.userId)
    .where('companyId', '==', data.companyId)
    .where('provider', '==', 'tiktok')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error('Conta TikTok não conectada para esta empresa. Conecte sua conta TikTok em Redes Sociais.');
  }

  const connection = snap.docs[0].data() as any;
  if (connection.expiresAt && new Date(connection.expiresAt).getTime() < Date.now()) {
    await snap.docs[0].ref.update({ status: 'token_expired', updatedAt: nowIso() }).catch(() => undefined);
    throw new Error('A autenticação com o TikTok expirou. Reconecte a conta nas configurações de Redes Sociais.');
  }

  const token = decrypt(connection.encryptedAccessToken);

  // 1. Inicializar upload no modo Inbox / Draft (Content Posting API - Inbox video)
  const initEndpoint = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
  const initBody = {
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: data.videoSize,
      chunk_size: data.videoSize,
      total_chunk_count: 1
    }
  };

  const initResponse = await fetch(initEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify(initBody)
  });

  const initJson = await initResponse.json().catch(() => ({} as any));

  if (!initResponse.ok || (initJson.error?.code && initJson.error.code !== 'ok')) {
    const errorMsg = initJson.error?.message || initJson.message || `Erro ${initResponse.status} retornado pelo TikTok na inicialização do upload.`;
    throw new Error(`Falha ao inicializar rascunho no TikTok: ${errorMsg}`);
  }

  const publishId = initJson.data?.publish_id;
  const uploadUrl = initJson.data?.upload_url;

  if (!publishId || !uploadUrl) {
    throw new Error('A API do TikTok não retornou os identificadores obrigatórios (publish_id e upload_url).');
  }

  // 2. Upload Binário (PUT)
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(data.videoSize),
      'Content-Range': `bytes 0-${data.videoSize - 1}/${data.videoSize}`
    },
    body: data.videoBuffer
  });

  if (uploadResponse.status !== 201) {
    const uploadErrText = await uploadResponse.text().catch(() => '');
    throw new Error(`Falha ao enviar binário do vídeo para o TikTok (HTTP ${uploadResponse.status}): ${uploadErrText.slice(0, 200)}`);
  }

  // Registrar histórico de envio de rascunho com isolamento multi-tenant (NUNCA salvar token ou uploadUrl)
  const draftRecordId = stableId(`${data.userId}:${data.companyId}:${publishId}`);
  await firestore().collection('socialDraftUploads').doc(draftRecordId).set({
    id: draftRecordId,
    userId: data.userId,
    companyId: data.companyId,
    provider: 'tiktok',
    publishId,
    videoSize: data.videoSize,
    mimeType: data.mimeType || 'video/mp4',
    title: data.title || null,
    status: 'draft_sent',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }, { merge: true }).catch(() => undefined);

  return {
    success: true,
    publishId,
    status: 'draft_sent',
    message: 'Rascunho enviado ao TikTok. Abra o TikTok e acesse a notificação na Caixa de Entrada para continuar a edição e publicar.'
  };
}

export async function getTikTokUploadStatus(data: {
  userId: string;
  companyId: string;
  publishId: string;
}): Promise<{
  success: boolean;
  publishId: string;
  status: string;
  failReason?: string | null;
  isDraftDelivered: boolean;
  message: string;
}> {
  if (!data.publishId) {
    throw new Error('publish_id é obrigatório.');
  }

  // Fortalecimento de isolamento multi-tenant: o publishId deve pertencer a um upload registrado para este usuário e empresa
  const draftRecordId = stableId(`${data.userId}:${data.companyId}:${data.publishId}`);
  const draftRef = firestore().collection('socialDraftUploads').doc(draftRecordId);
  const draftSnap = await draftRef.get();

  if (!draftSnap.exists) {
    throw new Error('Envio de rascunho não encontrado ou não pertence a esta empresa.');
  }

  const draftData = draftSnap.data() as any;
  if (draftData.userId !== data.userId || draftData.companyId !== data.companyId || draftData.provider !== 'tiktok') {
    throw new Error('Envio de rascunho não encontrado ou não pertence a esta empresa.');
  }

  const snap = await firestore()
    .collection(COLLECTIONS.socialConnections)
    .where('userId', '==', data.userId)
    .where('companyId', '==', data.companyId)
    .where('provider', '==', 'tiktok')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error('Conta TikTok não conectada para esta empresa.');
  }

  const connection = snap.docs[0].data() as any;
  if (connection.expiresAt && new Date(connection.expiresAt).getTime() < Date.now()) {
    throw new Error('A autenticação com o TikTok expirou. Reconecte a conta.');
  }

  const token = decrypt(connection.encryptedAccessToken);

  const statusEndpoint = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
  const statusResponse = await fetch(statusEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({ publish_id: data.publishId })
  });

  const statusJson = await statusResponse.json().catch(() => ({} as any));

  if (!statusResponse.ok || (statusJson.error?.code && statusJson.error.code !== 'ok')) {
    const errMsg = statusJson.error?.message || statusJson.message || `Erro ${statusResponse.status} ao consultar status.`;
    throw new Error(`Falha ao consultar status no TikTok: ${errMsg}`);
  }

  const rawStatus = String(statusJson.data?.status || 'UNKNOWN');
  const failReason = statusJson.data?.fail_reason || null;
  const isDraftDelivered = rawStatus === 'SEND_TO_USER_INBOX' || rawStatus === 'PUBLISH_COMPLETE';

  let userFriendlyMessage = 'Processando rascunho no TikTok...';
  if (rawStatus === 'SEND_TO_USER_INBOX') {
    userFriendlyMessage = 'Rascunho entregue ao TikTok. Abra a Caixa de Entrada do TikTok para continuar a edição e publicar.';
  } else if (rawStatus === 'PUBLISH_COMPLETE') {
    userFriendlyMessage = 'O TikTok informa que o conteúdo enviado foi publicado após a continuidade do fluxo pelo usuário no aplicativo TikTok.';
  } else if (rawStatus === 'FAILED') {
    userFriendlyMessage = `Falha no processamento pelo TikTok: ${failReason || 'Verifique se o arquivo segue as diretrizes do TikTok.'}`;
  } else if (rawStatus === 'PROCESSING_UPLOAD' || rawStatus === 'PROCESSING_DOWNLOAD') {
    userFriendlyMessage = 'O TikTok está processando o arquivo de vídeo enviado.';
  }

  // Atualizar histórico sem salvar token ou upload_url
  await draftRef.update({
    status: rawStatus,
    failReason: failReason || null,
    updatedAt: nowIso()
  }).catch(() => undefined);

  return {
    success: true,
    publishId: data.publishId,
    status: rawStatus,
    failReason,
    isDraftDelivered,
    message: userFriendlyMessage
  };
}

