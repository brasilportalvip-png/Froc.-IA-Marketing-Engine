/**
 * Voz neural do Froc.IA no navegador (mesmo sistema do Froc IA / frocia2).
 * 1º streaming PCM 24 kHz (começa a tocar enquanto chega) → 2º WAV completo → 3º voz do navegador.
 */
import { auth } from '../firebase';
import { apiRequest, apiUrl } from '../api';

const DEFAULT_SAMPLE_RATE = 24_000;
const INITIAL_BUFFER_SECONDS = 0.18;

type BrowserAudioContext = AudioContext;

function audioContextConstructor(): (new (options?: AudioContextOptions) => BrowserAudioContext) | null {
  const w = window as typeof window & { webkitAudioContext?: new (options?: AudioContextOptions) => BrowserAudioContext };
  return window.AudioContext || w.webkitAudioContext || null;
}

function pcm16LeToFloat32(bytes: Uint8Array): Float32Array {
  const count = Math.floor(bytes.length / 2);
  const out = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let i = 0; i < count; i += 1) {
    const value = view.getInt16(i * 2, true);
    out[i] = value < 0 ? value / 32768 : value / 32767;
  }
  return out;
}

function abortError(): DOMException {
  return new DOMException('Operação cancelada.', 'AbortError');
}

async function openSpeechStream(text: string, signal?: AbortSignal): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('firebase_user_unavailable');
  const request = async (forceRefresh: boolean) => fetch(apiUrl('/api/ai/speech/stream'), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken(forceRefresh)}` },
    body: JSON.stringify({ text })
  });
  let response = await request(false);
  if (response.status === 401 && !signal?.aborted) response = await request(true);
  if (!response.ok) throw new Error(`neural_speech_stream_http_${response.status}`);
  if (!response.body) throw new Error('neural_speech_stream_body_unavailable');
  return response;
}

/** Streaming de baixa latência. Resolve quando o áudio termina de tocar. */
export async function streamNeuralSpeech(text: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  const Ctor = audioContextConstructor();
  if (!Ctor) throw new Error('web_audio_unavailable');
  const ctx = new Ctor({ sampleRate: DEFAULT_SAMPLE_RATE });
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

  let response: Response;
  try {
    response = await openSpeechStream(text, signal);
  } catch (error) {
    await ctx.close().catch(() => undefined);
    throw error;
  }
  const rate = Number(response.headers.get('X-Froc-Audio-Sample-Rate') || DEFAULT_SAMPLE_RATE);
  const sampleRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SAMPLE_RATE;
  const reader = response.body!.getReader();
  const sources = new Set<AudioBufferSourceNode>();
  let remainder = new Uint8Array(0);
  let nextStart: number | null = null;
  let last: AudioBufferSourceNode | null = null;
  let aborted = false;

  const stopAll = () => {
    aborted = true;
    for (const source of sources) {
      try { source.stop(); } catch { /* já terminou */ }
      try { source.disconnect(); } catch { /* já desconectado */ }
    }
    sources.clear();
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', stopAll, { once: true });

  try {
    if (ctx.state === 'suspended') await ctx.resume();
    while (true) {
      if (aborted || signal?.aborted) throw abortError();
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      let bytes: Uint8Array = value;
      if (remainder.length) {
        bytes = new Uint8Array(remainder.length + value.length);
        bytes.set(remainder, 0);
        bytes.set(value, remainder.length);
      }
      if (bytes.length % 2) {
        remainder = bytes.slice(bytes.length - 1);
        bytes = bytes.slice(0, bytes.length - 1);
      } else {
        remainder = new Uint8Array(0);
      }
      if (!bytes.length) continue;
      const samples = pcm16LeToFloat32(bytes);
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const at = Math.max(nextStart ?? ctx.currentTime + INITIAL_BUFFER_SECONDS, ctx.currentTime + 0.01);
      source.start(at);
      nextStart = at + buffer.duration;
      sources.add(source);
      last = source;
      source.onended = () => { sources.delete(source); try { source.disconnect(); } catch { /* ok */ } };
    }
    if (aborted || signal?.aborted) throw abortError();
    if (!last || nextStart === null) throw new Error('neural_speech_stream_empty_audio');
    const remaining = Math.max(0, nextStart - ctx.currentTime);
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, Math.ceil(remaining * 1000) + 60);
        const onAbort = () => { window.clearTimeout(timer); resolve(); };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (signal?.aborted) throw abortError();
  } finally {
    signal?.removeEventListener('abort', stopAll);
    sources.clear();
    if (ctx.state !== 'closed') await ctx.close().catch(() => undefined);
  }
}

/** Fallback: áudio WAV completo para um trecho de texto. */
export async function playNeuralSpeechChunk(text: string, signal?: AbortSignal): Promise<void> {
  const result = await apiRequest<{ audioBase64: string; mimeType: string }>('/api/ai/speech', { method: 'POST', body: { text }, signal, timeoutMs: 60_000 });
  const binary = atob(result.audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'audio/wav' }));
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { audio.pause(); reject(abortError()); };
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      audio.onended = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
      audio.onerror = () => { signal?.removeEventListener('abort', onAbort); reject(new Error('neural_audio_playback_failed')); };
      audio.play().catch((error) => { signal?.removeEventListener('abort', onAbort); reject(error); });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
