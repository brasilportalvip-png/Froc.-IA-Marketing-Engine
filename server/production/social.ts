import crypto from 'crypto';
import { config } from '../config/index.js';
import { COLLECTIONS, firestore, nowIso, stableId } from './store.js';

export type SocialProvider = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'linkedin' | 'pinterest' | 'x';
export type ExternalState = 'confirmed_success' | 'confirmed_failed' | 'unknown';

export interface PublishTextResult {
  provider: SocialProvider;
  externalId?: string | null;
  externalState: ExternalState;
  retrySafe: boolean;
  error?: string;
  statusCode?: number;
}

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
  const encKey = config.encryptionKey || process.env.TOKEN_ENCRYPTION_KEY || (!config.isProduction ? 'default_dev_test_token_encryption_key_32b!' : '');
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
  if (!credentials.clientId && config.isProduction) {
    throw new Error(`Credenciais OAuth de ${data.provider} não configuradas.`);
  }
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
    params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, continuous_refresh: 'true' });
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
  else if (provider === 'youtube') {
    // Obter canal real via YouTube Data API
    try {
      const ytRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers });
      const ytJson = await ytRes.json().catch(() => ({} as any));
      if (ytRes.ok && Array.isArray(ytJson.items) && ytJson.items.length > 0) {
        return {
          id: String(ytJson.items[0].id),
          name: String(ytJson.items[0].snippet?.title || 'Canal YouTube')
        };
      }
    } catch {
      // Fallback para userinfo
    }
    endpoint = 'https://www.googleapis.com/oauth2/v3/userinfo';
  } else if (provider === 'tiktok') endpoint = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url';
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

export async function resolveMetaAccount(
  provider: 'facebook' | 'instagram',
  shortToken: string
): Promise<
  | { id: string; name: string; accessToken: string; pageId?: string; expiresIn?: number | null; multiplePages?: false }
  | { multiplePages: true; pages: Array<{ id: string; name: string; accessToken: string }>; expiresIn?: number | null }
> {
  let userToken = shortToken;
  let longLivedExpiresIn: number | null = null;

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
    if (response.ok && json.access_token) {
      userToken = String(json.access_token);
      if (json.expires_in) {
        longLivedExpiresIn = Number(json.expires_in);
      }
    }
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

    let candidatePages = [...pages];

    // 2. Fallback para Business Manager: /me/businesses -> /{business-id}/owned_pages e /{business-id}/client_pages
    const eligibleInPrimary = pages.filter((item: any) => item?.id && item?.access_token && hasPagePublishTask(item?.tasks));
    if (eligibleInPrimary.length === 0) {
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
      }
    }

    // Deduplicação de páginas encontradas por ID
    const uniqueMap = new Map<string, any>();
    for (const p of candidatePages) {
      if (p?.id && !uniqueMap.has(String(p.id))) {
        uniqueMap.set(String(p.id), p);
      }
    }
    const uniqueCandidates = Array.from(uniqueMap.values());
    const eligiblePages = uniqueCandidates.filter((p: any) => p?.id && p?.access_token && hasPagePublishTask(p?.tasks));

    if (eligiblePages.length === 1) {
      const page = eligiblePages[0];
      return {
        id: String(page.id),
        name: String(page.name || 'Facebook Page'),
        accessToken: String(page.access_token),
        pageId: String(page.id),
        expiresIn: longLivedExpiresIn,
        multiplePages: false
      };
    }

    if (eligiblePages.length > 1) {
      return {
        multiplePages: true,
        pages: eligiblePages.map((p: any) => ({
          id: String(p.id),
          name: String(p.name || 'Facebook Page'),
          accessToken: String(p.access_token)
        })),
        expiresIn: longLivedExpiresIn
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

    if (uniqueCandidates.length > 0) {
      const pageWithoutTask = uniqueCandidates.find((p: any) => p?.id && p?.tasks && !hasPagePublishTask(p.tasks));
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

  const instagramCandidates: Array<{ id: string; name: string; username: string; pageName: string; accessToken: string }> = [];
  for (const p of pages) {
    if (p?.instagram_business_account?.id && p?.access_token) {
      instagramCandidates.push({
        id: String(p.instagram_business_account.id),
        username: String(p.instagram_business_account.username || p.instagram_business_account.name || 'Instagram Account'),
        name: String(p.instagram_business_account.name || p.instagram_business_account.username || p.name || 'Instagram Business'),
        pageName: String(p.name || 'Facebook Page'),
        accessToken: String(p.access_token)
      });
    }
  }

  // Deduplicate by IG account ID
  const uniqueIgMap = new Map<string, any>();
  for (const ig of instagramCandidates) {
    if (!uniqueIgMap.has(ig.id)) {
      uniqueIgMap.set(ig.id, ig);
    }
  }
  const uniqueIgCandidates = Array.from(uniqueIgMap.values());

  if (uniqueIgCandidates.length === 1) {
    const ig = uniqueIgCandidates[0];
    return {
      id: ig.id,
      name: ig.username,
      accessToken: ig.accessToken,
      pageId: ig.id,
      expiresIn: longLivedExpiresIn,
      multiplePages: false
    };
  }

  if (uniqueIgCandidates.length > 1) {
    return {
      multiplePages: true,
      pages: uniqueIgCandidates.map((ig) => ({
        id: ig.id,
        name: `@${ig.username} (${ig.pageName})`,
        accessToken: ig.accessToken
      })),
      expiresIn: longLivedExpiresIn
    };
  }

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

  let account: any;
  if (data.provider === 'facebook' || data.provider === 'instagram') {
    account = await resolveMetaAccount(data.provider, token.access_token);
  } else {
    account = await fetchAccount(data.provider, token.access_token);
  }

  if (account.multiplePages) {
    // Múltiplas páginas: criar sessão temporária one-time com TTL de 10 minutos
    const pageSelectToken = crypto.randomBytes(32).toString('base64url');
    await firestore().collection(COLLECTIONS.oauthStates).doc(stableId(pageSelectToken)).set({
      type: 'facebook_page_selection',
      userId: state.userId,
      companyId: state.companyId,
      provider: 'facebook',
      pages: account.pages.map((p: any) => ({
        id: p.id,
        name: p.name,
        encryptedAccessToken: encrypt(p.accessToken)
      })),
      scopes: String(token.scope || '').split(/[ ,]+/).filter(Boolean),
      expiresIn: account.expiresIn || null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    return {
      success: true,
      selectionRequired: true,
      pageSelectToken,
      provider: 'facebook',
      userId: state.userId,
      companyId: state.companyId,
      pages: account.pages.map((p: any) => ({ id: p.id, name: p.name }))
    };
  }

  const tokenToStore = account.accessToken || token.access_token;
  const connectionId = stableId(`${state.userId}:${state.companyId}:${data.provider}`);
  // Se for Meta (Facebook/Instagram), usa exclusivamente o expiresIn do long-lived token (se houver)
  const expiresAt = (data.provider === 'facebook' || data.provider === 'instagram')
    ? (account.expiresIn ? new Date(Date.now() + Number(account.expiresIn) * 1000).toISOString() : null)
    : (token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null);

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

  return { success: true, selectionRequired: false, userId: state.userId, companyId: state.companyId, account: { id: account.id, name: account.name } };
}

export async function selectFacebookPage(data: {
  userId: string;
  companyId?: string;
  pageSelectToken?: string;
  selectionToken?: string;
  selectedPageId?: string;
  pageId?: string;
}): Promise<{ id: string; success: boolean; provider: string; pageId: string; pageName: string; account: { id: string; name: string } }> {
  const token = data.pageSelectToken || data.selectionToken;
  const targetPageId = data.selectedPageId || data.pageId;

  if (!token || !targetPageId) {
    throw new Error('Token de seleção e ID da página são obrigatórios.');
  }

  const tokenHash = stableId(token);
  let docRef = firestore().collection(COLLECTIONS.oauthStates).doc(tokenHash);
  let snap = await docRef.get();
  if (!snap.exists) {
    docRef = firestore().collection(COLLECTIONS.pageSelectTokens).doc(tokenHash);
    snap = await docRef.get();
  }

  if (!snap.exists) {
    throw new Error('Token de seleção de página inválido ou expirado (já utilizada).');
  }

  const stateData = snap.data() as any;

  if (stateData.type && stateData.type !== 'facebook_page_selection') {
    throw new Error('Tipo de sessão OAuth inválido.');
  }

  if (stateData.userId !== data.userId) {
    throw new Error('Permissão negada: sessão de seleção pertence a outro usuário.');
  }

  const companyId = data.companyId || stateData.companyId;
  if (stateData.companyId && data.companyId && stateData.companyId !== data.companyId) {
    throw new Error('Permissão negada: empresa não corresponde à sessão de seleção.');
  }

  if (Number(stateData.expiresAt) < Date.now()) {
    throw new Error('Sessão de seleção de página expirada.');
  }

  const pages = Array.isArray(stateData.pages) ? stateData.pages : [];
  const chosen = pages.find((p: any) => p.id === targetPageId);
  if (!chosen) {
    throw new Error('Página não encontrada na lista autorizada.');
  }

  const encryptedToken = chosen.encryptedAccessToken || (chosen.accessToken ? encrypt(chosen.accessToken) : null);
  if (!encryptedToken) {
    throw new Error('Token de acesso da página não encontrado.');
  }

  // Anti-replay estrito: deletar sessão de seleção após validação completa
  await docRef.delete().catch(() => undefined);
  // Also clean up from both collections if present
  await firestore().collection(COLLECTIONS.oauthStates).doc(tokenHash).delete().catch(() => undefined);
  await firestore().collection(COLLECTIONS.pageSelectTokens).doc(tokenHash).delete().catch(() => undefined);

  const connectionId = stableId(`${data.userId}:${companyId}:facebook`);
  const expiresAt = stateData.expiresIn ? new Date(Date.now() + Number(stateData.expiresIn) * 1000).toISOString() : null;

  await firestore().collection(COLLECTIONS.socialConnections).doc(connectionId).set({
    userId: data.userId,
    companyId,
    provider: 'facebook',
    accountId: chosen.id,
    accountName: chosen.name,
    pageId: chosen.id,
    encryptedAccessToken: encryptedToken,
    encryptedRefreshToken: null,
    scopes: stateData.scopes || [],
    expiresAt,
    connectedAt: nowIso(),
    updatedAt: nowIso(),
    status: 'connected'
  }, { merge: true });

  return {
    id: connectionId,
    success: true,
    provider: 'facebook',
    pageId: chosen.id,
    pageName: chosen.name,
    account: { id: chosen.id, name: chosen.name }
  };
}

export async function getFacebookPageSelectionCandidates(
  userIdOrData: string | { userId: string; selectionToken?: string; pageSelectToken?: string; companyId?: string },
  tokenArg?: string,
  companyIdArg?: string
): Promise<{ companyId?: string; pages: Array<{ id: string; name: string }> }> {
  let userId = '';
  let selectionToken = '';
  let companyId: string | undefined = undefined;

  if (typeof userIdOrData === 'string') {
    userId = userIdOrData;
    selectionToken = tokenArg || '';
    companyId = companyIdArg;
  } else {
    userId = userIdOrData.userId;
    selectionToken = userIdOrData.selectionToken || userIdOrData.pageSelectToken || tokenArg || '';
    companyId = userIdOrData.companyId;
  }

  if (!selectionToken) {
    throw new Error('Token de seleção é obrigatório.');
  }

  const tokenHash = stableId(selectionToken);
  let docRef = firestore().collection(COLLECTIONS.oauthStates).doc(tokenHash);
  let snap = await docRef.get();

  if (!snap.exists) {
    docRef = firestore().collection(COLLECTIONS.pageSelectTokens).doc(tokenHash);
    snap = await docRef.get();
  }

  if (!snap.exists) {
    throw new Error('Token de seleção de página inválido ou expirado.');
  }

  const stateData = snap.data() as any;
  if (stateData.type && stateData.type !== 'facebook_page_selection') {
    throw new Error('Tipo de sessão OAuth inválido.');
  }

  if (stateData.userId !== userId) {
    throw new Error('Permissão negada: sessão de seleção pertence a outro usuário.');
  }

  if (stateData.companyId && companyId && stateData.companyId !== companyId) {
    throw new Error('Permissão negada: empresa não corresponde à sessão de seleção.');
  }

  if (Number(stateData.expiresAt) < Date.now()) {
    throw new Error('Sessão de seleção de página expirada.');
  }

  const rawPages = Array.isArray(stateData.pages) ? stateData.pages : [];
  const cleanPages = rawPages.map((p: any) => ({
    id: String(p.id),
    name: String(p.name || 'Facebook Page')
  }));

  return {
    companyId: stateData.companyId,
    pages: cleanPages
  };
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

export async function refreshSocialAccessToken(
  provider: SocialProvider,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  if (!refreshToken) throw new Error(`Refresh token não fornecido para ${provider}.`);

  if (provider === 'x') {
    const creds = Buffer.from(`${config.social.x.clientId}:${config.social.x.clientSecret}`).toString('base64');
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.social.x.clientId
      }).toString()
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description || json.error || `Falha ao renovar token do X (HTTP ${res.status}).`);
    }
    const expiresIn = Number(json.expires_in || 7200);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  if (provider === 'tiktok') {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: config.social.tiktok.clientId,
        client_secret: config.social.tiktok.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString()
    });
    const json = await res.json().catch(() => ({} as any));
    const tokenData = json.data || json;
    if (!res.ok || !tokenData.access_token) {
      throw new Error(json.error?.message || json.message || `Falha ao renovar token do TikTok (HTTP ${res.status}).`);
    }
    const expiresIn = Number(tokenData.expires_in || 86400);
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  if (provider === 'youtube') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.social.google.clientId,
        client_secret: config.social.google.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description || json.error || `Falha ao renovar token do Google/YouTube (HTTP ${res.status}).`);
    }
    const expiresIn = Number(json.expires_in || 3600);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  if (provider === 'pinterest') {
    const creds = Buffer.from(`${config.social.pinterest.clientId}:${config.social.pinterest.clientSecret}`).toString('base64');
    const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString()
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json.access_token) {
      throw new Error(json.message || json.error || `Falha ao renovar token do Pinterest (HTTP ${res.status}).`);
    }
    const expiresIn = Number(json.expires_in || 86400 * 30);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  if (provider === 'linkedin') {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.social.linkedin.clientId,
        client_secret: config.social.linkedin.clientSecret
      }).toString()
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json.access_token) {
      throw new Error(json.error_description || json.error || `Falha ao renovar token do LinkedIn (HTTP ${res.status}).`);
    }
    const expiresIn = Number(json.expires_in || 5184000);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  throw new Error(`Renovação de token não suportada para o provedor ${provider}.`);
}

export async function ensureValidSocialAccessToken(connectionIdOrDoc: string | any): Promise<string> {
  let docRef: any;
  let connection: any;

  if (typeof connectionIdOrDoc === 'string') {
    docRef = firestore().collection(COLLECTIONS.socialConnections).doc(connectionIdOrDoc);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error('Conexão social não encontrada.');
    connection = snap.data();
  } else {
    connection = connectionIdOrDoc;
    docRef = firestore().collection(COLLECTIONS.socialConnections).doc(connection.id);
  }

  const now = Date.now();
  const expiresAtMs = connection.expiresAt ? new Date(connection.expiresAt).getTime() : Infinity;
  const isExpiringSoon = expiresAtMs - now < 5 * 60 * 1000; // Menos de 5 minutos

  let rawRefreshToken = '';
  if (connection.encryptedRefreshToken) {
    try {
      rawRefreshToken = decrypt(connection.encryptedRefreshToken);
    } catch {
      // Ignora erro de decrypt no refresh token
    }
  }

  // Se o token ainda é válido por mais de 5 minutos, apenas retorna o accessToken
  if (!isExpiringSoon && (connection.encryptedAccessToken || connection.accessToken)) {
    try {
      return decrypt(connection.encryptedAccessToken || connection.accessToken);
    } catch (e: any) {
      throw new Error(`Falha ao descriptografar token de acesso: ${e.message}`);
    }
  }

  // Se estiver expirando ou expirado e possui refresh_token
  if (rawRefreshToken) {
    try {
      const refreshed = await refreshSocialAccessToken(connection.provider, rawRefreshToken);
      const updateData: any = {
        encryptedAccessToken: encrypt(refreshed.accessToken),
        expiresAt: new Date(refreshed.expiresAt).toISOString(),
        status: 'connected',
        errorMessage: null,
        updatedAt: nowIso()
      };
      if (refreshed.refreshToken) {
        updateData.encryptedRefreshToken = encrypt(refreshed.refreshToken);
      }
      await docRef.update(updateData);
      return refreshed.accessToken;
    } catch (refreshErr: any) {
      await docRef.update({
        status: 'token_expired',
        errorMessage: `Falha ao renovar token automaticamente: ${refreshErr.message}`,
        updatedAt: nowIso()
      }).catch(() => undefined);
      throw new Error(`A autenticação com ${connection.provider} expirou e a renovação falhou: ${refreshErr.message}`);
    }
  }

  // Expirado e SEM refresh_token
  if (expiresAtMs <= now) {
    await docRef.update({
      status: 'token_expired',
      errorMessage: 'Token expirou e não há refresh_token disponível para renovação automática.',
      updatedAt: nowIso()
    }).catch(() => undefined);
    throw new Error(`A autenticação com ${connection.provider} expirou. Reconecte a conta nas configurações.`);
  }

  // Token não tem expiresAt (ex: Meta Page token permanente) ou ainda válido
  try {
    return decrypt(connection.encryptedAccessToken || connection.accessToken);
  } catch (e: any) {
    throw new Error(`Falha ao descriptografar token de acesso: ${e.message}`);
  }
}

export async function publishText(data: {
  userId: string;
  companyId: string;
  provider: SocialProvider;
  text: string;
}): Promise<PublishTextResult> {
  const trimmedText = (data.text || '').trim();
  if (!trimmedText) {
    return {
      provider: data.provider,
      externalId: null,
      externalState: 'confirmed_failed',
      retrySafe: true,
      error: `O texto para publicação em ${data.provider} não pode estar vazio.`
    };
  }

  if (!isTextAutoPublishSupported(data.provider)) {
    return {
      provider: data.provider,
      externalId: null,
      externalState: 'confirmed_failed',
      retrySafe: false,
      error: getProviderAutoPublishReason(data.provider) || `Publicação textual não suportada para ${data.provider}.`
    };
  }

  const snap = await firestore()
    .collection(COLLECTIONS.socialConnections)
    .where('userId', '==', data.userId)
    .where('companyId', '==', data.companyId)
    .where('provider', '==', data.provider)
    .limit(1)
    .get();

  if (snap.empty) {
    return {
      provider: data.provider,
      externalId: null,
      externalState: 'confirmed_failed',
      retrySafe: false,
      error: `Conta ${data.provider} não conectada para esta empresa.`
    };
  }

  const connDoc = snap.docs[0];
  const connection = connDoc.data() as any;

  if (connection.status !== 'connected' || (!connection.encryptedAccessToken && !connection.accessToken)) {
    return {
      provider: data.provider,
      externalId: null,
      externalState: 'confirmed_failed',
      retrySafe: false,
      error: `Conexão com ${data.provider} inativa ou sem token.`
    };
  }

  let token = '';
  try {
    token = await ensureValidSocialAccessToken(connDoc.id);
  } catch (err: any) {
    return {
      provider: data.provider,
      externalId: null,
      externalState: 'confirmed_failed',
      retrySafe: false,
      error: err.message || `A autenticação com ${data.provider} expirou.`
    };
  }

  const targetAccountId = connection.accountId || connection.pageId;

  if (data.provider === 'facebook') {
    if (!targetAccountId) {
      return {
        provider: 'facebook',
        externalId: null,
        externalState: 'confirmed_failed',
        retrySafe: false,
        error: 'Identificador da Página do Facebook (accountId / pageId) não encontrado na conexão.'
      };
    }

    try {
      const endpoint = `https://graph.facebook.com/${config.social.meta.graphVersion}/${encodeURIComponent(targetAccountId)}/feed`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ message: trimmedText, access_token: token }).toString()
      });

      const json = await response.json().catch(() => ({} as any));

      if (response.status >= 500) {
        return {
          provider: 'facebook',
          externalId: null,
          externalState: 'unknown',
          retrySafe: false,
          statusCode: response.status,
          error: `Erro interno da Meta (HTTP ${response.status}).`
        };
      }

      if (response.status >= 400) {
        const isAuthError =
          json.error?.code === 190 ||
          json.error?.type === 'OAuthException' ||
          json.error?.error_subcode === 463 ||
          json.error?.error_subcode === 467;

        if (isAuthError) {
          await connDoc.ref.update({ status: 'token_expired', updatedAt: nowIso() }).catch(() => undefined);
          return {
            provider: 'facebook',
            externalId: null,
            externalState: 'confirmed_failed',
            retrySafe: false,
            statusCode: response.status,
            error: 'A autenticação com o Facebook expirou ou foi revogada (código 190). Reconecte a conta em Redes Sociais.'
          };
        }

        const errorMsg = json.error?.message || `Rejeição da API do Facebook (HTTP ${response.status}).`;
        return {
          provider: 'facebook',
          externalId: null,
          externalState: 'confirmed_failed',
          retrySafe: true,
          statusCode: response.status,
          error: errorMsg
        };
      }

      // HTTP 2xx
      if (json.id) {
        return {
          provider: 'facebook',
          externalId: String(json.id),
          externalState: 'confirmed_success',
          retrySafe: false,
          statusCode: response.status
        };
      }

      // HTTP 2xx sem ID
      return {
        provider: 'facebook',
        externalId: null,
        externalState: 'unknown',
        retrySafe: false,
        statusCode: response.status,
        error: 'Resposta da Meta retornou HTTP 200, mas sem identificador (id) de publicação.'
      };
    } catch {
      return {
        provider: 'facebook',
        externalId: null,
        externalState: 'unknown',
        retrySafe: false,
        error: 'Erro de rede ou timeout durante a comunicação com a API da Meta.'
      };
    }
  }

  if (data.provider === 'x') {
    try {
      const response = await fetch('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: trimmedText.slice(0, 280) })
      });

      const json = await response.json().catch(() => ({} as any));

      if (response.status >= 500) {
        return {
          provider: 'x',
          externalId: null,
          externalState: 'unknown',
          retrySafe: false,
          statusCode: response.status,
          error: `Erro interno do X (HTTP ${response.status}).`
        };
      }

      if (response.status === 401) {
        let rawRefresh = '';
        if (connection.encryptedRefreshToken) {
          try {
            rawRefresh = decrypt(connection.encryptedRefreshToken);
          } catch {
            // ignore
          }
        }

        if (rawRefresh) {
          try {
            const refreshed = await refreshSocialAccessToken('x', rawRefresh);
            await connDoc.ref.update({
              encryptedAccessToken: encrypt(refreshed.accessToken),
              encryptedRefreshToken: refreshed.refreshToken ? encrypt(refreshed.refreshToken) : connection.encryptedRefreshToken,
              expiresAt: new Date(refreshed.expiresAt).toISOString(),
              status: 'connected',
              updatedAt: nowIso()
            });

            // Re-executa uma única chamada segura com o token renovado
            const retryRes = await fetch('https://api.x.com/2/tweets', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${refreshed.accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ text: trimmedText.slice(0, 280) })
            });
            const retryJson = await retryRes.json().catch(() => ({} as any));
            if (retryRes.status >= 500) {
              return { provider: 'x', externalId: null, externalState: 'unknown', retrySafe: false, statusCode: retryRes.status, error: `Erro interno do X (HTTP ${retryRes.status}).` };
            }
            if (retryRes.status >= 400) {
              const errMsg = retryJson.detail || retryJson.title || retryJson.error || `Rejeição da API do X (HTTP ${retryRes.status}).`;
              return { provider: 'x', externalId: null, externalState: 'confirmed_failed', retrySafe: retryRes.status !== 401, statusCode: retryRes.status, error: errMsg };
            }
            if (retryJson.data?.id) {
              return { provider: 'x', externalId: String(retryJson.data.id), externalState: 'confirmed_success', retrySafe: false, statusCode: retryRes.status };
            }
            return { provider: 'x', externalId: null, externalState: 'unknown', retrySafe: false, statusCode: retryRes.status, error: 'Resposta do X sem ID do tweet.' };
          } catch {
            await connDoc.ref.update({ status: 'token_expired', updatedAt: nowIso() }).catch(() => undefined);
            return { provider: 'x', externalId: null, externalState: 'confirmed_failed', retrySafe: false, statusCode: 401, error: 'A autenticação com o X expirou e a renovação de token falhou. Reconecte a conta.' };
          }
        }

        await connDoc.ref.update({ status: 'token_expired', updatedAt: nowIso() }).catch(() => undefined);
        return {
          provider: 'x',
          externalId: null,
          externalState: 'confirmed_failed',
          retrySafe: false,
          statusCode: 401,
          error: 'A autenticação com o X expirou. Reconecte a conta.'
        };
      }

      if (response.status >= 400) {
        const errorMsg = json.detail || json.title || json.error || `Rejeição da API do X (HTTP ${response.status}).`;
        return {
          provider: 'x',
          externalId: null,
          externalState: 'confirmed_failed',
          retrySafe: true,
          statusCode: response.status,
          error: errorMsg
        };
      }

      // HTTP 2xx
      if (json.data?.id) {
        return {
          provider: 'x',
          externalId: String(json.data.id),
          externalState: 'confirmed_success',
          retrySafe: false,
          statusCode: response.status
        };
      }

      // HTTP 2xx sem data.id
      return {
        provider: 'x',
        externalId: null,
        externalState: 'unknown',
        retrySafe: false,
        statusCode: response.status,
        error: 'Resposta do X retornou HTTP 200, mas sem identificador (data.id) do tweet.'
      };
    } catch {
      return {
        provider: 'x',
        externalId: null,
        externalState: 'unknown',
        retrySafe: false,
        error: 'Erro de rede ou timeout durante a comunicação com a API do X.'
      };
    }
  }

  if (data.provider === 'linkedin') {
    if (!config.social.linkedin.apiVersion) {
      return {
        provider: 'linkedin',
        externalId: null,
        externalState: 'confirmed_failed',
        retrySafe: false,
        error: 'LINKEDIN_API_VERSION precisa estar configurada para publicação no LinkedIn.'
      };
    }

    try {
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

      if (response.status >= 500) {
        return {
          provider: 'linkedin',
          externalId: null,
          externalState: 'unknown',
          retrySafe: false,
          statusCode: response.status,
          error: `Erro interno do LinkedIn (HTTP ${response.status}).`
        };
      }

      if (response.status === 401) {
        let rawRefresh = '';
        if (connection.encryptedRefreshToken) {
          try {
            rawRefresh = decrypt(connection.encryptedRefreshToken);
          } catch {
            // ignore
          }
        }

        if (rawRefresh) {
          try {
            const refreshed = await refreshSocialAccessToken('linkedin', rawRefresh);
            await connDoc.ref.update({
              encryptedAccessToken: encrypt(refreshed.accessToken),
              encryptedRefreshToken: refreshed.refreshToken ? encrypt(refreshed.refreshToken) : connection.encryptedRefreshToken,
              expiresAt: new Date(refreshed.expiresAt).toISOString(),
              status: 'connected',
              updatedAt: nowIso()
            });

            const retryRes = await fetch('https://api.linkedin.com/rest/posts', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${refreshed.accessToken}`,
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

            if (retryRes.status >= 500) {
              return { provider: 'linkedin', externalId: null, externalState: 'unknown', retrySafe: false, statusCode: retryRes.status, error: `Erro interno do LinkedIn (HTTP ${retryRes.status}).` };
            }
            if (retryRes.status >= 400) {
              const textErr = await retryRes.text().catch(() => '');
              return { provider: 'linkedin', externalId: null, externalState: 'confirmed_failed', retrySafe: retryRes.status !== 401, statusCode: retryRes.status, error: textErr.slice(0, 300) || `Rejeição da API do LinkedIn (HTTP ${retryRes.status}).` };
            }
            const headerId = retryRes.headers.get('x-restli-id') || retryRes.headers.get('x-linkedin-id');
            if (headerId && headerId.trim()) {
              return { provider: 'linkedin', externalId: headerId.trim(), externalState: 'confirmed_success', retrySafe: false, statusCode: retryRes.status };
            }
            const retryJson = await retryRes.json().catch(() => ({} as any));
            if (retryJson.id) {
              return { provider: 'linkedin', externalId: String(retryJson.id), externalState: 'confirmed_success', retrySafe: false, statusCode: retryRes.status };
            }
            return { provider: 'linkedin', externalId: null, externalState: 'unknown', retrySafe: false, statusCode: retryRes.status, error: 'LinkedIn retornou HTTP 200 sem ID confiável.' };
          } catch {
            await connDoc.ref.update({ status: 'token_expired', updatedAt: nowIso() }).catch(() => undefined);
            return { provider: 'linkedin', externalId: null, externalState: 'confirmed_failed', retrySafe: false, statusCode: 401, error: 'A autenticação com o LinkedIn expirou e a renovação falhou. Reconecte a conta.' };
          }
        }

        await connDoc.ref.update({ status: 'token_expired', updatedAt: nowIso() }).catch(() => undefined);
        return {
          provider: 'linkedin',
          externalId: null,
          externalState: 'confirmed_failed',
          retrySafe: false,
          statusCode: 401,
          error: 'A autenticação com o LinkedIn expirou. Reconecte a conta.'
        };
      }

      if (response.status >= 400) {
        const responseText = await response.text().catch(() => '');
        let errorMsg = `Rejeição da API do LinkedIn (HTTP ${response.status}).`;
        try {
          const parsed = JSON.parse(responseText);
          errorMsg = parsed.message || parsed.error || errorMsg;
        } catch {
          if (responseText) errorMsg = responseText.slice(0, 300);
        }
        return {
          provider: 'linkedin',
          externalId: null,
          externalState: 'confirmed_failed',
          retrySafe: true,
          statusCode: response.status,
          error: errorMsg
        };
      }

      // HTTP 2xx
      const headerId = response.headers.get('x-restli-id') || response.headers.get('x-linkedin-id');
      if (headerId && headerId.trim()) {
        return {
          provider: 'linkedin',
          externalId: headerId.trim(),
          externalState: 'confirmed_success',
          retrySafe: false,
          statusCode: response.status
        };
      }

      const json = await response.json().catch(() => ({} as any));
      if (json.id) {
        return {
          provider: 'linkedin',
          externalId: String(json.id),
          externalState: 'confirmed_success',
          retrySafe: false,
          statusCode: response.status
        };
      }

      return {
        provider: 'linkedin',
        externalId: null,
        externalState: 'unknown',
        retrySafe: false,
        statusCode: response.status,
        error: 'LinkedIn retornou HTTP 200/201 sem identificador de post confiável (x-restli-id).'
      };
    } catch {
      return {
        provider: 'linkedin',
        externalId: null,
        externalState: 'unknown',
        retrySafe: false,
        error: 'Erro de rede ou timeout durante a comunicação com a API do LinkedIn.'
      };
    }
  }

  return {
    provider: data.provider,
    externalId: null,
    externalState: 'confirmed_failed',
    retrySafe: false,
    error: `Provedor ${data.provider} não suportado para publicação de texto.`
  };
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

export async function initTikTokDraftUpload(data: {
  userId: string;
  companyId: string;
  videoSize: number;
  title?: string;
}): Promise<{
  publishId: string;
  uploadUrl: string;
}> {
  if (data.videoSize <= 0) throw new Error('Tamanho de vídeo inválido.');
  if (data.videoSize > MAX_TIKTOK_SANDBOX_VIDEO_SIZE) {
    throw new Error('O vídeo excede o limite de 4 MB desta fase do TikTok.');
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

  const token = await ensureValidSocialAccessToken(snap.docs[0].id);

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
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify(initBody)
  });

  const initJson = await initResponse.json().catch(() => ({} as any));
  if (!initResponse.ok || (initJson.error?.code && initJson.error.code !== 'ok')) {
    const errorMsg = initJson.error?.message || initJson.message || `Erro ${initResponse.status} do TikTok.`;
    throw new Error(`Falha ao inicializar rascunho no TikTok: ${errorMsg}`);
  }

  const publishId = initJson.data?.publish_id;
  const uploadUrl = initJson.data?.upload_url;

  if (!publishId || !uploadUrl) {
    throw new Error('TikTok não retornou publish_id e upload_url.');
  }

  // Registrar histórico de envio
  const draftRecordId = stableId(`${data.userId}:${data.companyId}:${publishId}`);
  await firestore().collection('socialDraftUploads').doc(draftRecordId).set({
    id: draftRecordId,
    userId: data.userId,
    companyId: data.companyId,
    provider: 'tiktok',
    publishId,
    videoSize: data.videoSize,
    title: data.title || null,
    status: 'draft_initialized',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }, { merge: true }).catch(() => undefined);

  return { publishId, uploadUrl };
}

export async function publishInstagramMedia(data: {
  userId: string;
  companyId: string;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  contentItemId?: string;
}): Promise<{
  success: boolean;
  externalId: string;
  externalState: 'confirmed_success';
  message: string;
}> {
  if (!data.imageUrl && !data.videoUrl) {
    throw new Error('É necessário fornecer imageUrl ou videoUrl para publicar no Instagram.');
  }

  const snap = await firestore()
    .collection(COLLECTIONS.socialConnections)
    .where('userId', '==', data.userId)
    .where('companyId', '==', data.companyId)
    .where('provider', '==', 'instagram')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error('Conta Instagram não conectada para esta empresa.');
  }

  const connection = snap.docs[0].data() as any;
  const igUserId = connection.accountId || connection.pageId;
  if (!igUserId) {
    throw new Error('Identificador da conta profissional do Instagram não encontrado na conexão.');
  }

  const token = await ensureValidSocialAccessToken(snap.docs[0].id);

  // 1. Criar container de mídia: POST /{ig-user-id}/media
  const containerEndpoint = `https://graph.facebook.com/${config.social.meta.graphVersion}/${encodeURIComponent(igUserId)}/media`;
  const containerParams: Record<string, string> = {
    access_token: token,
    caption: (data.caption || '').slice(0, 2200)
  };

  if (data.videoUrl) {
    containerParams.media_type = 'REELS';
    containerParams.video_url = data.videoUrl;
  } else if (data.imageUrl) {
    containerParams.image_url = data.imageUrl;
  }

  const containerRes = await fetch(containerEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(containerParams).toString()
  });

  const containerJson = await containerRes.json().catch(() => ({} as any));
  if (!containerRes.ok || !containerJson.id) {
    const errorMsg = containerJson.error?.message || `Erro ${containerRes.status} ao criar container no Instagram.`;
    throw new Error(`Falha ao criar container no Instagram: ${errorMsg}`);
  }

  const creationId = containerJson.id;

  // 2. Publicar container: POST /{ig-user-id}/media_publish
  const publishEndpoint = `https://graph.facebook.com/${config.social.meta.graphVersion}/${encodeURIComponent(igUserId)}/media_publish`;
  const publishRes = await fetch(publishEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: creationId, access_token: token }).toString()
  });

  const publishJson = await publishRes.json().catch(() => ({} as any));
  if (!publishRes.ok || !publishJson.id) {
    const errorMsg = publishJson.error?.message || `Erro ${publishRes.status} ao publicar no Instagram.`;
    throw new Error(`Falha ao publicar mídia no Instagram: ${errorMsg}`);
  }

  return {
    success: true,
    externalId: String(publishJson.id),
    externalState: 'confirmed_success',
    message: 'Mídia publicada no Instagram com sucesso.'
  };
}

export async function initYouTubeResumableUpload(data: {
  userId: string;
  companyId: string;
  title: string;
  description?: string;
  privacyStatus?: 'private' | 'unlisted' | 'public';
  videoSize?: number;
  mimeType?: string;
}): Promise<{
  uploadUrl: string;
}> {
  if (!data.title?.trim()) {
    throw new Error('Título do vídeo no YouTube é obrigatório.');
  }

  const snap = await firestore()
    .collection(COLLECTIONS.socialConnections)
    .where('userId', '==', data.userId)
    .where('companyId', '==', data.companyId)
    .where('provider', '==', 'youtube')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error('Canal YouTube não conectado para esta empresa.');
  }

  const token = await ensureValidSocialAccessToken(snap.docs[0].id);

  // Iniciar sessão de upload resumível do YouTube Data API v3
  const initEndpoint = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
  const metadata = {
    snippet: {
      title: data.title.trim().slice(0, 100),
      description: (data.description || '').slice(0, 5000),
      categoryId: '22'
    },
    status: {
      privacyStatus: data.privacyStatus || 'unlisted',
      selfDeclaredMadeForKids: false
    }
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': data.mimeType || 'video/mp4'
  };
  if (data.videoSize && data.videoSize > 0) {
    headers['X-Upload-Content-Length'] = String(data.videoSize);
  }

  const initRes = await fetch(initEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(metadata)
  });

  if (!initRes.ok) {
    const errJson = await initRes.json().catch(() => ({} as any));
    const errorMsg = errJson.error?.message || `Erro HTTP ${initRes.status} ao iniciar sessão no YouTube.`;
    throw new Error(`Falha ao iniciar upload no YouTube: ${errorMsg}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('A API do YouTube não retornou o header Location com o endpoint de upload resumível.');
  }

  return { uploadUrl };
}

export async function getPinterestBoards(data: {
  userId: string;
  companyId: string;
}): Promise<Array<{ id: string; name: string; description?: string }>> {
  const snap = await firestore()
    .collection(COLLECTIONS.socialConnections)
    .where('userId', '==', data.userId)
    .where('companyId', '==', data.companyId)
    .where('provider', '==', 'pinterest')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error('Conta Pinterest não conectada para esta empresa.');
  }

  const token = await ensureValidSocialAccessToken(snap.docs[0].id);

  const res = await fetch('https://api.pinterest.com/v5/boards?page_size=50', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    const errorMsg = json.message || json.error || `Erro HTTP ${res.status} ao listar pastas do Pinterest.`;
    throw new Error(errorMsg);
  }

  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((b: any) => ({
    id: String(b.id),
    name: String(b.name || 'Pasta'),
    description: b.description || ''
  }));
}

export async function createPinterestPin(data: {
  userId: string;
  companyId: string;
  boardId: string;
  title: string;
  description?: string;
  link?: string;
  imageUrl: string;
}): Promise<{
  success: boolean;
  pinId: string;
  externalId: string;
  message: string;
}> {
  if (!data.boardId || !data.title?.trim() || !data.imageUrl) {
    throw new Error('Pasta (boardId), título e URL da imagem são obrigatórios para criar Pin no Pinterest.');
  }

  const snap = await firestore()
    .collection(COLLECTIONS.socialConnections)
    .where('userId', '==', data.userId)
    .where('companyId', '==', data.companyId)
    .where('provider', '==', 'pinterest')
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error('Conta Pinterest não conectada para esta empresa.');
  }

  const token = await ensureValidSocialAccessToken(snap.docs[0].id);

  const pinBody: any = {
    board_id: data.boardId,
    title: data.title.trim().slice(0, 100),
    description: (data.description || '').slice(0, 800),
    media_source: {
      source_type: 'image_url',
      url: data.imageUrl
    }
  };
  if (data.link?.trim()) {
    pinBody.link = data.link.trim();
  }

  const res = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(pinBody)
  });

  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json.id) {
    const errorMsg = json.message || json.error || `Erro HTTP ${res.status} ao criar Pin no Pinterest.`;
    throw new Error(`Falha ao criar Pin: ${errorMsg}`);
  }

  return {
    success: true,
    pinId: String(json.id),
    externalId: String(json.id),
    message: 'Pin criado com sucesso no Pinterest.'
  };
}

export function isProviderConfigured(provider: SocialProvider): { configured: boolean; clientIdPresent: boolean; clientSecretPresent: boolean } {
  const creds = providerCredentials(provider);
  const clientIdPresent = Boolean(creds.clientId);
  const clientSecretPresent = Boolean(creds.clientSecret);
  return {
    configured: clientIdPresent && clientSecretPresent,
    clientIdPresent,
    clientSecretPresent
  };
}

export async function getSocialReadiness(companyId: string, userId?: string): Promise<Record<string, any>> {
  const db = firestore();
  let query: any = db.collection(COLLECTIONS.socialConnections).where('companyId', '==', companyId);
  if (userId) {
    query = query.where('userId', '==', userId);
  }
  const connectionsSnap = await query.get();

  const connections = connectionsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];
  const findConn = (p: SocialProvider) => connections.find((c) => c.provider === p);

  const providers: SocialProvider[] = ['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube', 'pinterest'];
  const readiness: Record<string, any> = {
    companyId,
    healthy: true,
    checkedAt: nowIso(),
    connectedCount: 0,
    summary: '',
    scheduler: {
      cronSecretConfigured: Boolean(config.cronSecret),
      nativeCronConfigured: false
    },
    linkedinApiVersionConfigured: Boolean(config.social.linkedin.apiVersion)
  };

  const capabilitiesMap: Record<SocialProvider, string> = {
    facebook: 'text_publish',
    instagram: 'media_publish',
    linkedin: 'text_publish',
    x: 'text_publish',
    tiktok: 'draft_video',
    youtube: 'video_upload',
    pinterest: 'pin_publish'
  };

  let connectedCount = 0;
  for (const p of providers) {
    const conn = findConn(p);
    const { configured } = isProviderConfigured(p);
    const isConnected = Boolean(conn && conn.status === 'connected');
    if (isConnected) connectedCount++;
    readiness[p] = {
      oauthConfigured: configured,
      connected: isConnected,
      status: conn?.status || 'disconnected',
      accountId: conn?.accountId || conn?.pageId || null,
      accountName: conn?.accountName || null,
      expiresAt: conn?.expiresAt || null,
      capability: capabilitiesMap[p]
    };
  }

  readiness.connectedCount = connectedCount;
  readiness.summary = connectedCount > 0
    ? `${connectedCount} canal(is) configurado(s) e operacional(is) para esta empresa.`
    : 'Nenhum canal social conectado para esta empresa.';

  return readiness;
}

