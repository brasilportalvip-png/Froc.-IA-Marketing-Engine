/**
 * Froc.IA — Voz neural e transcrição ao vivo (mesmo sistema da Froc IA / frocia2).
 *
 * - Voz: Gemini TTS com voz masculina, natural e calorosa (padrão "Charon"),
 *   em dois modos: streaming PCM 16-bit 24 kHz (baixa latência) e WAV completo (fallback).
 * - Escuta: token efêmero do Gemini Live para transcrição em tempo real no navegador;
 *   a chave GEMINI_API_KEY nunca sai do servidor.
 */
import { config } from '../config/index.js';
import { textAiClient } from './ai.js';

export const MAX_SPEECH_CHARACTERS = 5000;
export const NEURAL_SPEECH_SAMPLE_RATE = 24_000;
export const NEURAL_SPEECH_CHANNELS = 1;
export const LIVE_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';

export function speechModel(): string {
  return (process.env.GEMINI_TTS_MODEL || '').trim() || 'gemini-3.1-flash-tts-preview';
}

export function speechVoice(): string {
  return (process.env.GEMINI_TTS_VOICE || '').trim() || 'Charon';
}

export function cleanSpeechText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\/?fala>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEECH_CHARACTERS);
}

export function buildHumanizedSpeechPrompt(text: string): string {
  const transcript = cleanSpeechText(text);
  if (!transcript) throw new Error('speech_text_empty');
  return [
    'Leia exatamente o conteúdo delimitado ao final, sem alterar a fala.',
    'Fale em português brasileiro com voz masculina adulta, natural, calorosa e amigável.',
    'Soa como um amigo próximo conversando com tranquilidade: educado, simpático, gentil e sempre disposto a ajudar.',
    'Use ritmo humano, pausas naturais e entonação acolhedora, sem soar como robô ou locutor.',
    `<fala>${transcript}</fala>`
  ].join('\n');
}

export function pcm16ToWavBase64(pcmBase64: string, sampleRate = NEURAL_SPEECH_SAMPLE_RATE, channels = NEURAL_SPEECH_CHANNELS): string {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

/** Áudio de teste: 0,1 s de silêncio PCM — nunca chama o provedor em testes. */
function testPcm(): Buffer {
  return Buffer.alloc(NEURAL_SPEECH_SAMPLE_RATE / 10 * 2);
}

export async function synthesizeSpeech(text: string): Promise<{ audioBase64: string; mimeType: string; model: string; voice: string }> {
  const input = buildHumanizedSpeechPrompt(text);
  const model = speechModel();
  const voice = speechVoice();
  if (isTest()) return { audioBase64: pcm16ToWavBase64(testPcm().toString('base64')), mimeType: 'audio/wav', model, voice };

  const ai: any = textAiClient();
  const interaction = await ai.interactions.create({
    model,
    input,
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice, language: 'pt-BR' }] }
  });
  const audio = interaction?.output_audio;
  if (!audio?.data) throw new Error('gemini_tts_empty_audio');
  const providerMimeType = String(audio.mime_type || 'audio/l16');
  const isRawPcm = /(?:l16|pcm)/i.test(providerMimeType);
  return {
    audioBase64: isRawPcm ? pcm16ToWavBase64(audio.data, audio.sample_rate || NEURAL_SPEECH_SAMPLE_RATE, audio.channels || NEURAL_SPEECH_CHANNELS) : audio.data,
    mimeType: isRawPcm ? 'audio/wav' : providerMimeType,
    model,
    voice
  };
}

export async function* synthesizeSpeechStream(text: string): AsyncGenerator<Buffer> {
  const input = buildHumanizedSpeechPrompt(text);
  if (isTest()) {
    yield testPcm();
    return;
  }
  const ai: any = textAiClient();
  const stream = await ai.interactions.create({
    model: speechModel(),
    input,
    response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: NEURAL_SPEECH_SAMPLE_RATE },
    generation_config: { speech_config: [{ voice: speechVoice(), language: 'pt-BR' }] },
    stream: true
  });
  let received = false;
  for await (const event of stream as AsyncIterable<any>) {
    if (event?.event_type !== 'step.delta') continue;
    const delta = event.delta;
    if (delta?.type !== 'audio' || typeof delta.data !== 'string' || !delta.data) continue;
    const audio = Buffer.from(delta.data, 'base64');
    if (!audio.length) continue;
    received = true;
    yield audio;
  }
  if (!received) throw new Error('gemini_tts_stream_empty_audio');
}

/** Token efêmero de uso único para o Gemini Live (transcrição no navegador). */
export async function createLiveTranscriptionToken(): Promise<{ token: string; model: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  if (isTest()) return { token: 'auth_tokens/test-token', model: LIVE_TRANSCRIBE_MODEL, expiresAt };
  const apiKey = String(config.geminiApiKey || '').trim();
  if (!apiKey) {
    const error: any = new Error('Reconhecimento em tempo real indisponível.');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ uses: 1, expireTime: expiresAt, newSessionExpireTime: new Date(Date.now() + 60_000).toISOString() })
  });
  if (!response.ok) {
    const body: any = await response.json().catch(() => null);
    const message = String(body?.error?.message || '').replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]').slice(0, 300);
    console.error('[Froc Voz] Token Live recusado pelo provedor:', response.status, message);
    const error: any = new Error('Não foi possível iniciar a escuta em tempo real.');
    error.statusCode = 503;
    error.providerMessage = `HTTP ${response.status}: ${message || 'sem detalhes'}`;
    throw error;
  }
  const result: any = await response.json();
  if (!result?.name) {
    const error: any = new Error('Não foi possível iniciar a escuta em tempo real.');
    error.statusCode = 503;
    throw error;
  }
  return { token: String(result.name), model: LIVE_TRANSCRIBE_MODEL, expiresAt };
}

/** Diagnóstico real da voz (painel admin): testa a chave, o token Live e a voz neural. */
export async function diagnoseVoice(): Promise<{
  keyConfigured: boolean;
  liveToken: { ok: boolean; model: string; detail: string };
  tts: { ok: boolean; model: string; voice: string; detail: string };
}> {
  const keyConfigured = Boolean(String(config.geminiApiKey || '').trim());
  const liveToken = { ok: false, model: LIVE_TRANSCRIBE_MODEL, detail: '' };
  const tts = { ok: false, model: speechModel(), voice: speechVoice(), detail: '' };
  try {
    await createLiveTranscriptionToken();
    liveToken.ok = true;
    liveToken.detail = 'Token efêmero emitido com sucesso.';
  } catch (error: any) {
    liveToken.detail = String(error?.providerMessage || error?.message || error).slice(0, 400);
  }
  try {
    const result = await synthesizeSpeech('Olá! Esta é a voz da Froc.IA.');
    tts.ok = Boolean(result.audioBase64);
    tts.detail = tts.ok ? `Áudio gerado (${result.mimeType}).` : 'O provedor não devolveu áudio.';
  } catch (error: any) {
    tts.detail = String(error?.message || error).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]').slice(0, 400);
  }
  return { keyConfigured, liveToken, tts };
}
