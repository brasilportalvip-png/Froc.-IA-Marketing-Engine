/**
 * Conversa por voz da Froc.IA — o mesmo ciclo da Froc IA (frocia2):
 * ouvir → entender o comando → pensar → falar com voz neural → voltar a ouvir.
 *
 * Escuta: Gemini Live (logado) com fallback para o reconhecimento do navegador.
 * Fala: voz neural Gemini em streaming → WAV → voz do navegador (sempre há um caminho).
 * Comandos: "Ok, Froc" (despertar) e "pare" (desligar). Após o clique no microfone,
 * a primeira frase já vale como pedido, sem precisar dizer "Ok, Froc".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { startFrocLiveTranscription, type FrocLiveSession } from './liveTranscription';
import { playNeuralSpeechChunk, streamNeuralSpeech } from './neuralSpeech';
import { classifyFrocMobileVoiceTranscript, classifyFrocVoiceTranscript, isAndroidChromeVoiceClient } from './voiceCommands';
import { normalizeTextForSpeech, selectPreferredMalePortugueseVoice, splitTextForProgressiveSpeech, splitTextForSpeech, voiceErrorMessage } from './voiceText';

export { voiceErrorMessage };

export type FrocVoicePhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

interface Options {
  /** Usuário logado: usa Gemini Live + voz neural. Visitante: motores do navegador. */
  neural: boolean;
  onCommand: (text: string) => void;
  onPartial?: (text: string) => void;
}

function recognitionConstructor(): any {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function speakWithBrowser(text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) { reject(new Error('speech_synthesis_unavailable')); return; }
    const chunks = splitTextForSpeech(text);
    if (!chunks.length) { resolve(); return; }
    const voices = window.speechSynthesis.getVoices();
    const voice = selectPreferredMalePortugueseVoice(voices);
    let index = 0;
    const onAbort = () => { window.speechSynthesis.cancel(); reject(new DOMException('Operação cancelada.', 'AbortError')); };
    signal.addEventListener('abort', onAbort, { once: true });
    const next = () => {
      if (signal.aborted) return;
      if (index >= chunks.length) { signal.removeEventListener('abort', onAbort); resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(chunks[index++]);
      utterance.lang = 'pt-BR';
      if (voice) utterance.voice = voice;
      utterance.rate = 1.02;
      utterance.onend = next;
      utterance.onerror = (event) => {
        if (signal.aborted || event.error === 'interrupted' || event.error === 'canceled') return;
        signal.removeEventListener('abort', onAbort);
        reject(new Error(`speech_synthesis_${event.error}`));
      };
      window.speechSynthesis.speak(utterance);
    };
    window.speechSynthesis.cancel();
    next();
  });
}

export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(recognitionConstructor() || navigator.mediaDevices?.getUserMedia);
}

export function useFrocVoice({ neural, onCommand, onPartial }: Options) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<FrocVoicePhase>('idle');
  const [error, setError] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const enabledRef = useRef(false);
  const busyRef = useRef(false); // aguardando resposta ou falando: microfone pausado
  const liveRef = useRef<FrocLiveSession | null>(null);
  const liveAttemptRef = useRef(0);
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<number | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const mobileRef = useRef(false);
  const neuralRef = useRef(neural);
  const onCommandRef = useRef(onCommand);
  const onPartialRef = useRef(onPartial);
  neuralRef.current = neural;
  onCommandRef.current = onCommand;
  onPartialRef.current = onPartial;

  const clearRestart = () => {
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  };

  const stopBrowserRecognition = () => {
    clearRestart();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.stop(); } catch { /* já encerrada */ }
  };

  const stopSpeaking = useCallback(() => {
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  const handleTranscript = (text: string, isFinal: boolean) => {
    if (!enabledRef.current || busyRef.current) return;
    const intent = mobileRef.current
      ? classifyFrocMobileVoiceTranscript(text, isFinal)
      : classifyFrocVoiceTranscript(text, isFinal, true);
    if (intent.type === 'preview') onPartialRef.current?.(intent.text);
    if (intent.type === 'stop') { disable(); return; }
    if (intent.type === 'command') {
      busyRef.current = true;
      liveRef.current?.pause();
      stopBrowserRecognition();
      setPhase('thinking');
      onPartialRef.current?.(intent.command);
      onCommandRef.current(intent.command);
    }
  };

  const startBrowserRecognition = () => {
    if (!enabledRef.current || busyRef.current || recognitionRef.current) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setError(voiceErrorMessage('unsupported'));
      setPhase('error');
      enabledRef.current = false;
      setEnabled(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = !mobileRef.current;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
        isFinal = isFinal || event.results[i].isFinal;
      }
      handleTranscript(transcript, isFinal);
    };
    recognition.onerror = (event: any) => {
      recognitionRef.current = null;
      if (event?.error === 'no-speech' || event?.error === 'aborted') return;
      enabledRef.current = false;
      setEnabled(false);
      setPhase('error');
      setError(voiceErrorMessage(String(event?.error || 'unknown')));
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (enabledRef.current && !busyRef.current) {
        clearRestart();
        restartTimerRef.current = window.setTimeout(startBrowserRecognition, 350);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setPhase('listening');
    } catch {
      recognitionRef.current = null;
    }
  };

  const startLive = () => {
    const attempt = ++liveAttemptRef.current;
    setPhase('connecting');
    startFrocLiveTranscription({
      onPartial: (text) => { if (attempt === liveAttemptRef.current) handleTranscript(text, false); },
      onFinal: (text) => { if (attempt === liveAttemptRef.current) handleTranscript(text, true); },
      onError: () => {
        if (attempt !== liveAttemptRef.current || !enabledRef.current) return;
        liveAttemptRef.current += 1;
        liveRef.current?.stop();
        liveRef.current = null;
        startBrowserRecognition();
      }
    }).then((session) => {
      if (attempt !== liveAttemptRef.current || !enabledRef.current) { session.stop(); return; }
      liveRef.current = session;
      if (busyRef.current) session.pause();
      else setPhase('listening');
    }).catch(() => {
      if (attempt !== liveAttemptRef.current || !enabledRef.current) return;
      startBrowserRecognition();
    });
  };

  const resumeListening = useCallback(() => {
    busyRef.current = false;
    if (!enabledRef.current) { setPhase('idle'); return; }
    setPhase('listening');
    if (liveRef.current) liveRef.current.resume();
    else if (neuralRef.current && liveAttemptRef.current === 0) startLive();
    else startBrowserRecognition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Lê um texto em voz alta. Se a conversa por voz estiver ligada, volta a ouvir ao terminar. */
  const speak = useCallback(async (text: string, messageId = 'voice') => {
    const clean = normalizeTextForSpeech(text);
    if (!clean) { resumeListening(); return; }
    stopSpeaking();
    const controller = new AbortController();
    speechAbortRef.current = controller;
    busyRef.current = true;
    liveRef.current?.pause();
    stopBrowserRecognition();
    setSpeakingId(messageId);
    setPhase('speaking');
    try {
      let spoken = false;
      if (neuralRef.current) {
        try {
          await streamNeuralSpeech(clean, controller.signal);
          spoken = true;
        } catch (streamError) {
          if (isAbort(streamError)) throw streamError;
          try {
            for (const chunk of splitTextForProgressiveSpeech(clean, 220, 420)) {
              await playNeuralSpeechChunk(chunk, controller.signal);
            }
            spoken = true;
          } catch (chunkError) {
            if (isAbort(chunkError)) throw chunkError;
          }
        }
      }
      if (!spoken) await speakWithBrowser(clean, controller.signal);
    } catch (speakError) {
      if (isAbort(speakError)) return;
      setError('Não foi possível reproduzir a voz. Verifique se o som da aba está liberado.');
    } finally {
      if (speechAbortRef.current === controller) {
        speechAbortRef.current = null;
        setSpeakingId(null);
        if (enabledRef.current) resumeListening();
        else { busyRef.current = false; setPhase('idle'); }
      }
    }
  }, [resumeListening, stopSpeaking]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    busyRef.current = false;
    liveAttemptRef.current += 1;
    liveRef.current?.stop();
    liveRef.current = null;
    stopBrowserRecognition();
    stopSpeaking();
    setEnabled(false);
    setPhase('idle');
  }, [stopSpeaking]);

  const enable = useCallback(() => {
    setError('');
    enabledRef.current = true;
    busyRef.current = false;
    liveAttemptRef.current = 0;
    mobileRef.current = isAndroidChromeVoiceClient(navigator.userAgent) || window.matchMedia?.('(pointer: coarse)').matches === true;
    setEnabled(true);
    // Desbloqueia a síntese de voz ainda dentro do gesto do usuário (iOS/Chrome).
    if ('speechSynthesis' in window) {
      const unlock = new SpeechSynthesisUtterance(' ');
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);
      window.speechSynthesis.cancel();
    }
    if (neuralRef.current) startLive();
    else startBrowserRecognition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    if (enabledRef.current) disable();
    else enable();
  }, [disable, enable]);

  /** Chame quando a IA falhar em responder: devolve a escuta ao usuário. */
  const cancelThinking = useCallback(() => {
    if (enabledRef.current) resumeListening();
  }, [resumeListening]);

  useEffect(() => () => {
    enabledRef.current = false;
    liveAttemptRef.current += 1;
    liveRef.current?.stop();
    stopBrowserRecognition();
    speechAbortRef.current?.abort();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  return { enabled, phase, error, speakingId, toggle, disable, speak, stopSpeaking, cancelThinking, clearError: () => setError('') };
}
