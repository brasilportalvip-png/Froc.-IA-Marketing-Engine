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

export interface PreparedNeuralSpeech { play(): Promise<void> }

/**
 * Começa a baixar a voz AGORA (em paralelo) e só toca quando `play()` for chamado.
 * Assim a próxima frase já está pronta quando a anterior termina — igual ao Froc IA.
 */
export function prepareNeuralSpeech(text: string, signal?: AbortSignal): PreparedNeuralSpeech {
  const queue: Float32Array[] = [];
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let finished = false;
  let failure: unknown = null;
  let received = 0;
  let waiter: (() => void) | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const wake = () => { const next = waiter; waiter = null; next?.(); };
  signal?.addEventListener('abort', () => { void reader?.cancel().catch(() => undefined); wake(); }, { once: true });

  void (async () => {
    const response = await openSpeechStream(text, signal);
    const rate = Number(response.headers.get('X-Froc-Audio-Sample-Rate') || DEFAULT_SAMPLE_RATE);
    sampleRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SAMPLE_RATE;
    reader = response.body!.getReader();
    let remainder = new Uint8Array(0);
    while (true) {
      if (signal?.aborted) throw abortError();
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
      queue.push(pcm16LeToFloat32(bytes));
      received += 1;
      wake();
    }
  })().catch((error) => { failure = error; }).finally(() => { finished = true; wake(); });

  return {
    async play() {
      if (signal?.aborted) throw abortError();
      const Ctor = audioContextConstructor();
      if (!Ctor) throw new Error('web_audio_unavailable');
      const ctx = new Ctor({ sampleRate });
      const sources = new Set<AudioBufferSourceNode>();
      const stopAll = () => {
        for (const source of sources) {
          try { source.stop(); } catch { /* já terminou */ }
          try { source.disconnect(); } catch { /* já desconectado */ }
        }
        sources.clear();
      };
      signal?.addEventListener('abort', stopAll, { once: true });
      let nextStart: number | null = null;
      try {
        if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
        while (true) {
          if (signal?.aborted) throw abortError();
          const samples = queue.shift();
          if (samples) {
            const buffer = ctx.createBuffer(1, samples.length, sampleRate);
            buffer.getChannelData(0).set(samples);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            const at = Math.max(nextStart ?? ctx.currentTime + INITIAL_BUFFER_SECONDS, ctx.currentTime + 0.01);
            source.start(at);
            nextStart = at + buffer.duration;
            sources.add(source);
            source.onended = () => { sources.delete(source); try { source.disconnect(); } catch { /* ok */ } };
            continue;
          }
          if (finished) break;
          await new Promise<void>((resolve) => { waiter = resolve; });
        }
        if (signal?.aborted) throw abortError();
        if (!received || nextStart === null) throw failure || new Error('neural_speech_stream_empty_audio');
        const remaining = Math.max(0, nextStart - ctx.currentTime);
        if (remaining > 0) {
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, Math.ceil(remaining * 1000) + 60);
            signal?.addEventListener('abort', () => { window.clearTimeout(timer); resolve(); }, { once: true });
          });
        }
        if (signal?.aborted) throw abortError();
      } finally {
        signal?.removeEventListener('abort', stopAll);
        if (ctx.state !== 'closed') await ctx.close().catch(() => undefined);
      }
    }
  };
}

/** Streaming de baixa latência. Resolve quando o áudio termina de tocar. */
export async function streamNeuralSpeech(text: string, signal?: AbortSignal): Promise<void> {
  await prepareNeuralSpeech(text, signal).play();
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
