import { apiRequest } from '../api';

/**
 * Transcrição Live do Froc.IA.
 * Este módulo NÃO sintetiza voz e não altera o timbre/persona do Froc.
 * A fala continua sendo produzida pelo neuralSpeechService existente.
 */
const LIVE_MODEL = 'gemini-3.5-transcribe-live';
const OUTPUT_SAMPLE_RATE = 16_000;
const MAX_BUFFERED_BYTES = 256_000;
const CONNECT_TIMEOUT_MS = 15_000;
const SESSION_REFRESH_MS = 9 * 60_000;
const RECONNECT_DELAYS_MS = [500, 1_500, 3_000, 6_000];
const WS_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/' +
  'google.ai.generativelanguage.v1beta.' +
  'GenerativeService.BidiGenerateContentConstrained';

interface LiveTokenResponse {
  token: string;
  model: string;
  expiresAt: string;
}

export interface FrocLiveCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export interface FrocLiveSession {
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

interface LiveServerMessage {
  setupComplete?: Record<string, never>;
  error?: { code?: number; status?: string; message?: string };
  serverContent?: {
    interimInputTranscription?: { text?: string };
    inputTranscription?: { text?: string };
  };
}

/** O Gemini Live pode entregar JSON em quadros de texto ou binários. */
async function parseLiveServerMessage(data: unknown): Promise<LiveServerMessage> {
  let json: string;

  if (typeof data === 'string') {
    json = data;
  } else if (data instanceof ArrayBuffer) {
    json = new TextDecoder().decode(data);
  } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
    json = await data.text();
  } else {
    throw new Error('Tipo de mensagem Live não suportado.');
  }

  const message: unknown = JSON.parse(json);
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('A resposta Live não contém um objeto JSON.');
  }
  return message as LiveServerMessage;
}

/** Linear resampling, sufficient for speech capture at browser sample rates. */
function pcm16Base64(samples: Float32Array, inputSampleRate: number): string {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0 || !samples.length) {
    return '';
  }

  const ratio = inputSampleRate / OUTPUT_SAMPLE_RATE;
  const frames = Math.floor(samples.length / ratio);
  if (!frames) return '';

  const bytes = new Uint8Array(frames * 2);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < frames; i += 1) {
    const position = i * ratio;
    const left = Math.min(Math.floor(position), samples.length - 1);
    const right = Math.min(left + 1, samples.length - 1);
    const amount = position - Math.floor(position);
    const sample = Math.max(
      -1,
      Math.min(1, samples[left] * (1 - amount) + samples[right] * amount)
    );
    const value = sample < 0
      ? Math.round(sample * 32768)
      : Math.round(sample * 32767);
    view.setInt16(i * 2, value, true);
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function startFrocLiveTranscription(
  callbacks: FrocLiveCallbacks
): Promise<FrocLiveSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microfone indisponível neste navegador.');
  }

  // Iniciar o contexto de áudio ainda no gesto do usuário. Não tocar som.
  const audioContext = new AudioContext();
  void audioContext.resume().catch(() => undefined);

  let microphone: MediaStream | null = null;
  let microphoneSource: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentOutput: GainNode | null = null;
  let socket: WebSocket | null = null;
  let refreshTimer: number | null = null;
  let stopped = false;
  let liveReady = false;
  let paused = false;
  let reconnecting = false;
  let retryCount = 0;

  const clearTimers = () => {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const closeSocket = (connection: WebSocket) => {
    if (connection.readyState === WebSocket.OPEN) {
      try {
        connection.send(JSON.stringify({
          realtimeInput: { audioStreamEnd: true },
        }));
      } catch {
        // A conexão pode já ter sido encerrada pelo servidor.
      }
    }
    try { connection.close(1000, 'Froc voice session ended'); } catch { /* já fechada */ }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    paused = true;
    clearTimers();

    if (socket) closeSocket(socket);
    socket = null;
    liveReady = false;

    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
      processor = null;
    }
    microphoneSource?.disconnect();
    silentOutput?.disconnect();
    microphone?.getTracks().forEach((track) => track.stop());
    microphoneSource = null;
    silentOutput = null;
    microphone = null;
    void audioContext.close().catch(() => undefined);
  };

  const reportPermanentFailure = () => {
    if (stopped) return;
    stop();
    callbacks.onError(
      'A transcrição Live perdeu a conexão. O reconhecimento alternativo será ativado.'
    );
  };

  const connectOnce = async (): Promise<void> => {
    const credentials = await apiRequest<LiveTokenResponse>(
      '/api/ai/speech/live-token',
      { method: 'POST', body: {} }
    );
    if (!credentials.token || credentials.model !== LIVE_MODEL) {
      throw new Error('Token temporário Gemini Live inválido.');
    }
    if (stopped) return;

    liveReady = false;
    const connection = new WebSocket(
      `${WS_ENDPOINT}?access_token=${encodeURIComponent(credentials.token)}`
    );
    connection.binaryType = 'arraybuffer';
    socket = connection;

    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const timeout = window.setTimeout(() => {
        complete(new Error('Tempo de conexão Gemini Live esgotado.'));
      }, CONNECT_TIMEOUT_MS);

      const complete = (error?: Error) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        connection.removeEventListener('open', onOpen);
        connection.removeEventListener('message', onHandshake);
        connection.removeEventListener('error', onHandshakeError);
        connection.removeEventListener('close', onHandshakeClose);
        if (error) reject(error);
        else resolve();
      };

      const onOpen = () => {
        try {
          connection.send(JSON.stringify({
            setup: {
              model: `models/${LIVE_MODEL}`,
              generationConfig: { responseModalities: ['TEXT'] },
              inputAudioTranscription: { languageCodes: ['pt-BR'] },
            },
          }));
        } catch {
          complete(new Error('Não foi possível configurar o Gemini Live.'));
        }
      };
      const onHandshake = (event: MessageEvent) => {
        void parseLiveServerMessage(event.data).then((message) => {
          if (finished) return;

          if ('setupComplete' in message) {
            complete();
            return;
          }

          if (message.error) {
            const status = message.error.status || 'erro de configuração';
            complete(new Error(`Gemini Live recusou a sessão: ${status}.`));
          }
        }).catch(() => {
          complete(new Error('A primeira mensagem Gemini Live não é JSON válido.'));
        });
      };
      const onHandshakeError = () => {
        complete(new Error('Falha de rede ao abrir o Gemini Live.'));
      };
      const onHandshakeClose = (event: CloseEvent) => {
        complete(new Error(
          `Gemini Live encerrou a abertura da sessão (código ${event.code}).`
        ));
      };

      connection.addEventListener('open', onOpen);
      connection.addEventListener('message', onHandshake);
      connection.addEventListener('error', onHandshakeError);
      connection.addEventListener('close', onHandshakeClose);
    }).catch((error) => {
      closeSocket(connection);
      if (socket === connection) socket = null;
      throw error;
    });

    if (stopped || socket !== connection) {
      closeSocket(connection);
      return;
    }

    liveReady = true;
    connection.addEventListener('message', (event: MessageEvent) => {
      if (stopped || paused || socket !== connection) return;

      void parseLiveServerMessage(event.data).then((response) => {
        if (stopped || paused || socket !== connection) return;

        const content = response.serverContent;
        const interim = content?.interimInputTranscription?.text;
        const final = content?.inputTranscription?.text;

        if (typeof interim === 'string' && interim.trim()) {
          callbacks.onPartial(interim.trim());
        }
        if (typeof final === 'string' && final.trim()) {
          callbacks.onFinal(final.trim());
        }
      }).catch(() => {
        // Ignora quadros de controle não reconhecidos, sem desligar o microfone.
      });
    });

    connection.addEventListener('close', () => {
      if (stopped || socket !== connection) return;
      socket = null;
      liveReady = false;
      clearTimers();
      void reconnect();
    });

    connection.addEventListener('error', () => {
      if (stopped || socket !== connection) return;
      closeSocket(connection);
    });

    retryCount = 0;
    refreshTimer = window.setTimeout(() => {
      if (!stopped && socket === connection) {
        // O serviço Live de transcrição limita a sessão; novo token na renovação.
        closeSocket(connection);
      }
    }, SESSION_REFRESH_MS);
  };

  const reconnect = async () => {
    if (stopped || reconnecting) return;
    reconnecting = true;
    try {
      while (!stopped && retryCount < RECONNECT_DELAYS_MS.length) {
        const delay = RECONNECT_DELAYS_MS[retryCount++];
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, delay);
        });
        if (stopped) return;
        try {
          await connectOnce();
          return;
        } catch {
          // Nova tentativa com um token efêmero fresco.
        }
      }
      reportPermanentFailure();
    } finally {
      reconnecting = false;
    }
  };

  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    if (audioContext.state === 'suspended') await audioContext.resume();

    microphoneSource = audioContext.createMediaStreamSource(microphone);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;

    microphoneSource.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);

    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      const connection = socket;
      if (
        stopped || paused || !liveReady || !connection ||
        connection.readyState !== WebSocket.OPEN ||
        connection.bufferedAmount > MAX_BUFFERED_BYTES
      ) return;

      const data = pcm16Base64(
        event.inputBuffer.getChannelData(0),
        audioContext.sampleRate
      );
      if (!data) return;
      try {
        connection.send(JSON.stringify({
          realtimeInput: {
            audio: { data, mimeType: 'audio/pcm;rate=16000' },
          },
        }));
      } catch {
        // O evento de fechamento tratará a recuperação da conexão.
      }
    };

    await connectOnce();
    if (stopped) throw new Error('Sessão encerrada antes da ativação.');

    return {
      pause: () => {
        if (stopped) return;
        paused = true;
        if (socket?.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({
              realtimeInput: { audioStreamEnd: true },
            }));
          } catch { /* reconexão em andamento */ }
        }
      },
      resume: () => {
        if (!stopped) paused = false;
      },
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}
