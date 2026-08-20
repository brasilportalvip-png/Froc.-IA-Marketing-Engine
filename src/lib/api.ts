import { auth } from './firebase';

export function getAuthToken(): string | null {
  return auth.currentUser ? 'firebase' : null;
}

export function setAuthToken(_token: string) {
  // Compatibilidade temporária: Firebase Auth gerencia a sessão.
}

export function removeAuthToken() {
  // A sessão é removida por signOut(auth) no App.
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const controller = new AbortController();
  const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const requestUrl = endpoint.startsWith('/api/') && apiBase ? `${apiBase}${endpoint}` : endpoint;
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || 45_000);
  try {
    const currentUser = auth.currentUser;
    const idToken = currentUser ? await currentUser.getIdToken() : null;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(options.headers || {})
    };
    const body = options.body !== undefined
      ? (isFormData ? options.body : JSON.stringify(options.body))
      : undefined;
    const response = await fetch(requestUrl, {
      method: options.method || 'GET',
      headers,
      body,
      signal: controller.signal,
      credentials: 'same-origin'
    });
    const contentType = response.headers.get('content-type') || '';
    const data: any = contentType.includes('application/json') ? await response.json().catch(() => ({})) : { message: await response.text() };
    if (!response.ok) throw new Error(data.error || data.message || `Erro na requisição (${response.status})`);
    return data as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('A operação demorou demais. Verifique sua conexão e tente novamente.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
