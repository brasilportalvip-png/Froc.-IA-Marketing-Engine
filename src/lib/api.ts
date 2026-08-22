import { auth } from './firebase';

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    details: { status: number; requestId?: string; retryAfterSeconds?: number }
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = details.status;
    this.requestId = details.requestId;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

const MUTATING_METHODS = new Set<ApiMethod>(['POST', 'PATCH', 'DELETE']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+/-]{8,200}$/;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 5 * 60_000;

export function getAuthToken(): string | null {
  return auth.currentUser ? 'firebase' : null;
}

export function setAuthToken(_token: string) {
  // Compatibilidade temporária: Firebase Auth gerencia a sessão.
}

export function removeAuthToken() {
  // A sessão é removida por signOut(auth) no App.
}

export function isApiAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function randomRequestValue(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const randomPart = Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('');
  if (randomPart && !/^0+$/.test(randomPart)) return `${prefix}_${randomPart}`;

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function normalizeTimeout(value?: number): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value)) throw new Error('Tempo limite da requisição inválido.');
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(value)));
}

function apiBaseOrigin(): string {
  const browserOrigin = window.location.origin;
  const configured = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (!configured) return browserOrigin;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('VITE_API_BASE_URL possui uma URL inválida.');
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('VITE_API_BASE_URL não pode conter credenciais, parâmetros ou fragmentos.');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('VITE_API_BASE_URL deve conter somente a origem da API, sem caminho adicional.');
  }

  const localDevelopment =
    !import.meta.env.PROD &&
    parsed.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localDevelopment) {
    throw new Error('VITE_API_BASE_URL deve usar HTTPS fora do desenvolvimento local.');
  }

  return parsed.origin;
}

function resolveApiUrl(endpoint: string): URL {
  const normalized = String(endpoint || '').trim();
  if (normalized !== '/api' && !normalized.startsWith('/api/')) {
    throw new Error('Endpoint inválido: somente rotas internas /api são permitidas.');
  }

  const origin = apiBaseOrigin();
  const url = new URL(normalized, `${origin}/`);
  if (url.origin !== origin || (url.pathname !== '/api' && !url.pathname.startsWith('/api/'))) {
    throw new Error('Destino da API rejeitado por segurança.');
  }
  return url;
}

function sanitizedMessage(value: unknown, fallback: string): string {
  const message = typeof value === 'string' ? value : '';
  const sanitized = message
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return sanitized || fallback;
}

async function readResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('A resposta do servidor excedeu o limite permitido.');
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('A resposta do servidor excedeu o limite permitido.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function parseResponse(response: Response): Promise<any> {
  if (response.status === 204 || response.status === 205) return {};

  const text = await readResponseText(response);
  if (!text) return {};
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('json')) return { message: text };

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('O servidor retornou uma resposta JSON inválida.');
  }
}

function idempotencyKeyFromBody(body: any): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  if (typeof FormData !== 'undefined' && body instanceof FormData) return '';
  return typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
}

function prepareHeaders(
  options: ApiRequestOptions,
  method: ApiMethod,
  isFormData: boolean
): Headers {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  if (isFormData) {
    // O navegador precisa gerar automaticamente o boundary multipart correto.
    headers.delete('Content-Type');
  } else if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const suppliedRequestId = (headers.get('X-Request-Id') || '').trim();
  headers.set(
    'X-Request-Id',
    REQUEST_ID_PATTERN.test(suppliedRequestId) ? suppliedRequestId : randomRequestValue('req')
  );

  if (MUTATING_METHODS.has(method)) {
    const suppliedKey = (headers.get('X-Idempotency-Key') || '').trim();
    const bodyKey = idempotencyKeyFromBody(options.body);
    const idempotencyKey = suppliedKey || bodyKey || randomRequestValue('idem');
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new Error('A chave de idempotência deve ter entre 8 e 200 caracteres seguros.');
    }
    if (suppliedKey && bodyKey && suppliedKey !== bodyKey) {
      throw new Error('A chave de idempotência do cabeçalho difere da chave enviada no corpo.');
    }
    headers.set('X-Idempotency-Key', idempotencyKey);
  } else {
    headers.delete('X-Idempotency-Key');
  }

  // O token de autenticação é sempre definido internamente; nunca é aceito do chamador.
  headers.delete('Authorization');
  return headers;
}

function createAbortError(): Error {
  const error = new Error('Operação cancelada.');
  error.name = 'AbortError';
  return error;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const method = options.method || 'GET';
  const requestUrl = resolveApiUrl(endpoint);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    if (controller.signal.aborted) throw createAbortError();

    const currentUser = auth.currentUser;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const baseHeaders = prepareHeaders(options, method, isFormData);
    const body = options.body !== undefined
      ? (isFormData ? options.body : JSON.stringify(options.body))
      : undefined;

    const execute = async (forceRefresh: boolean): Promise<Response> => {
      if (controller.signal.aborted) throw createAbortError();
      const headers = new Headers(baseHeaders);

      if (currentUser) {
        try {
          const idToken = await currentUser.getIdToken(forceRefresh);
          if (controller.signal.aborted) throw createAbortError();
          headers.set('Authorization', `Bearer ${idToken}`);
        } catch (error) {
          if (controller.signal.aborted || isApiAbortError(error)) throw createAbortError();
          throw new Error('Não foi possível validar sua sessão. Entre novamente e tente de novo.');
        }
      }

      return fetch(requestUrl.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
        credentials: requestUrl.origin === window.location.origin ? 'same-origin' : 'omit'
      });
    };

    let response = await execute(false);
    if (
      response.status === 401 &&
      currentUser &&
      auth.currentUser?.uid === currentUser.uid &&
      !controller.signal.aborted
    ) {
      await response.body?.cancel().catch(() => undefined);
      response = await execute(true);
    }

    const data = await parseResponse(response);
    if (!response.ok) {
      const fallback = response.status >= 500
        ? 'Serviço temporariamente indisponível. Tente novamente.'
        : `Erro na requisição (${response.status}).`;
      const message = response.status >= 500
        ? fallback
        : sanitizedMessage(data?.error || data?.message, fallback);
      const requestId = sanitizedMessage(
        response.headers.get('x-request-id') || data?.requestId,
        ''
      ) || undefined;
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterValue = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const retryAfterSeconds = Number.isFinite(retryAfterValue) && retryAfterValue >= 0
        ? retryAfterValue
        : undefined;

      throw new ApiRequestError(message, {
        status: response.status,
        requestId,
        retryAfterSeconds
      });
    }

    return data as T;
  } catch (error: any) {
    if (timedOut) {
      throw new Error('A operação demorou demais. Verifique sua conexão e tente novamente.');
    }
    if (controller.signal.aborted || error?.name === 'AbortError') throw createAbortError();
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}