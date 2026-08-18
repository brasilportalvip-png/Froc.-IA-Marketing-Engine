import crypto from 'crypto';
import { config } from '../config/index.js';
import { COLLECTIONS, firestore, nowIso, stableId } from './store.js';

export type SocialProvider = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'linkedin' | 'pinterest' | 'x';

function key(): Buffer {
  if (!config.encryptionKey) throw new Error('TOKEN_ENCRYPTION_KEY não configurada.');
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

function encrypt(value: string): string {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decrypt(value: string): string {
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
      url.search = new URLSearchParams({ client_key: credentials.clientId, response_type: 'code', scope: 'user.info.basic,video.upload,video.publish', redirect_uri: redirectUri, state }).toString();
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
    case 'instagram':
      url = new URL(`https://www.facebook.com/${config.social.meta.graphVersion}/dialog/oauth`);
      url.search = new URLSearchParams({ client_id: credentials.clientId, redirect_uri: redirectUri, state, response_type: 'code', scope: 'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish' }).toString();
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

async function resolveMetaAccount(provider: 'facebook' | 'instagram', shortToken: string): Promise<{ id: string; name: string; accessToken: string; pageId?: string }> {
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

  const pagesUrl = new URL(`https://graph.facebook.com/${config.social.meta.graphVersion}/me/accounts`);
  pagesUrl.search = new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username,name}',
    access_token: userToken
  }).toString();
  const pagesResponse = await fetch(pagesUrl);
  const pagesJson = await pagesResponse.json().catch(() => ({} as any));
  if (!pagesResponse.ok) throw new Error(pagesJson.error?.message || 'Não foi possível consultar as Páginas Meta autorizadas.');
  const pages = Array.isArray(pagesJson.data) ? pagesJson.data : [];

  if (provider === 'facebook') {
    const page = pages.find((item: any) => item?.id && item?.access_token);
    if (!page) throw new Error('Nenhuma Página do Facebook com permissão de publicação foi encontrada nesta conta.');
    return { id: String(page.id), name: String(page.name || 'Facebook Page'), accessToken: String(page.access_token), pageId: String(page.id) };
  }

  const page = pages.find((item: any) => item?.instagram_business_account?.id && item?.access_token);
  if (!page) throw new Error('Nenhuma conta profissional do Instagram vinculada a uma Página do Facebook foi encontrada.');
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
    return { id: doc.id, ...safe };
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
  const snap = await firestore().collection(COLLECTIONS.socialConnections).where('userId', '==', data.userId).where('companyId', '==', data.companyId).where('provider', '==', data.provider).where('status', '==', 'connected').limit(1).get();
  if (snap.empty) throw new Error(`Conta ${data.provider} não conectada.`);
  const connection = snap.docs[0].data() as any;
  const token = decrypt(connection.encryptedAccessToken);

  if (data.provider === 'x') {
    const response = await fetch('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: data.text.slice(0, 280) }) });
    const json = await response.json().catch(() => ({} as any));
    if (!response.ok) throw new Error(json.detail || json.title || 'Falha ao publicar no X.');
    return { provider: 'x', externalId: json.data?.id || null };
  }

  if (data.provider === 'facebook') {
    const endpoint = `https://graph.facebook.com/${config.social.meta.graphVersion}/${encodeURIComponent(connection.accountId)}/feed`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: data.text, access_token: token }).toString()
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
        commentary: data.text,
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
