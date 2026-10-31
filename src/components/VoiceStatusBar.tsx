import React from 'react';
import { Loader2, Mic, Sparkles, Volume2, X } from 'lucide-react';
import type { FrocVoicePhase } from '../lib/voice/useFrocVoice';

const LABEL: Record<FrocVoicePhase, string> = {
  idle: 'Microfone pronto',
  connecting: 'Conectando o microfone…',
  listening: 'Estou ouvindo — pode falar',
  thinking: 'Entendi! Pensando na resposta…',
  speaking: 'Froc.IA falando…',
  error: 'Microfone indisponível'
};

const COLOR: Record<FrocVoicePhase, string> = {
  idle: '#a3a3a3',
  connecting: '#FFD400',
  listening: '#00E676',
  thinking: '#FFD400',
  speaking: '#FF2D87',
  error: '#FF2D87'
};

/** Faixa de status da conversa por voz, com ondas animadas como na Froc IA. */
export const VoiceStatusBar: React.FC<{ phase: FrocVoicePhase; neural: boolean; onStop: () => void }> = ({ phase, neural, onStop }) => {
  const color = COLOR[phase];
  const active = phase === 'listening' || phase === 'speaking';
  return (
    <div className="mb-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/70 px-4 py-2.5 backdrop-blur animate-fadeIn" role="status" aria-live="polite">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: `${color}22`, color }}>
        {phase === 'connecting' || phase === 'thinking' ? <Loader2 size={15} className="animate-spin" /> : phase === 'speaking' ? <Volume2 size={15} /> : phase === 'listening' ? <Mic size={15} /> : <Sparkles size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-white">{LABEL[phase]}</p>
        <p className="truncate text-[10px] text-neutral-500">{neural ? 'Voz neural Froc.IA ativa' : 'Entre na conta para ativar a voz neural da Froc.IA'} · diga “pare” para desligar</p>
      </div>
      <div className="flex h-6 items-end gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className="froc-voice-bar w-[3px] rounded-full"
            style={{ background: color, height: active ? undefined : 4, animationDelay: `${bar * 0.12}s`, animationPlayState: active ? 'running' : 'paused' }}
          />
        ))}
      </div>
      <button onClick={onStop} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 text-neutral-300 hover:text-white" aria-label="Desligar conversa por voz">
        <X size={14} />
      </button>
    </div>
  );
};
