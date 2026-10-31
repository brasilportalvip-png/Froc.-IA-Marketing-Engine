/**
 * Chat do Froc.IA em streaming (SSE), igual ao Froc IA: a fala chega aos pedaços.
 * Se o streaming falhar antes de começar, quem chama usa o endpoint normal.
 */
import { auth } from './firebase';
import { apiUrl } from './api';

export class ChatStreamUnavailable extends Error {}

export async function streamConciergeChat<T = any>(body: unknown, handlers: { onToken: (text: string) => void; signal?: AbortSignal }): Promise<T> {
  const user = auth.currentUser;
  const send = async (forceRefresh: boolean) => fetch(apiUrl('/api/concierge/chat/stream'), {
    method: 'POST',
    signal: handlers.signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(user ? { Authorization: `Bearer ${await user.getIdToken(forceRefresh)}` } : {})
    },
    body: JSON.stringify(body)
  });
  let response: Response;
  try {
    response = await send(false);
    if (response.status === 401 && user) response = await send(true);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ChatStreamUnavailable('stream_network');
  }
  if (!response.ok) {
    let message = '';
    try { message = (await response.json())?.error || ''; } catch { /* sem corpo */ }
    if (response.status === 409 || response.status === 400) throw new Error(message || 'Não foi possível enviar a mensagem.');
    throw new ChatStreamUnavailable(message || `stream_http_${response.status}`);
  }
  if (!response.body || !String(response.headers.get('content-type') || '').includes('text/event-stream')) throw new ChatStreamUnavailable('stream_body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotToken = false;
  let result: T | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1]?.trim();
      const dataLine = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || dataLine === undefined) continue;
      let data: any;
      try { data = JSON.parse(dataLine); } catch { continue; }
      if (event === 'token' && typeof data?.text === 'string') { gotToken = true; handlers.onToken(data.text); }
      else if (event === 'done') result = data as T;
      else if (event === 'error') {
        if (!gotToken) throw new ChatStreamUnavailable(data?.error || 'stream_error');
        throw new Error(data?.error || 'O Froc.IA não conseguiu terminar a resposta.');
      }
    }
  }
  if (!result) {
    if (!gotToken) throw new ChatStreamUnavailable('stream_incomplete');
    throw new Error('A resposta foi interrompida. Tente de novo.');
  }
  return result;
}
