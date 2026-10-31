import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, Mic, MicOff, Square, Volume2, Check, CheckCircle2, ChevronDown, Coins, Crown, ExternalLink, Image as ImageIcon,
  Loader2, MapPin, Megaphone, RotateCcw, Search, Sparkles, Store, Target, Users, Video, XCircle, Zap
} from 'lucide-react';
import type { Company, User, Wallet } from '../types';
import { apiRequest } from '../lib/api';
import { PublicTopBar } from '../components/PublicTopBar';
import { FROC_AGENTS, FROC_SQUADS } from '../../shared/agents';
import { brazilNow, firstName } from '../../shared/brazilTime';
import { isVoiceSupported, useFrocVoice } from '../lib/voice/useFrocVoice';
import { VoiceStatusBar } from '../components/VoiceStatusBar';

interface Targeting { country: string; state: string; city: string; neighborhoods: string[]; streets: string[]; radiusKm: number }
interface Collected { businessName: string; offer: string; objective: string; audience: string; tone: string; media: string; platforms: string[]; website: string; whatsapp: string; instagram: string; colors: string; targeting: Targeting }
interface PlanAction { type: string; label: string; credits: number }
interface Plan { summary: string; actions: PlanAction[]; estimatedCredits: number }
interface AgentLite { id: string; name: string; role: string; squadName: string; color: 'yellow' | 'pink' | 'green' | 'white' }
interface ActionResult { type: string; label: string; ok: boolean; message: string; data?: any; credits?: number }
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agents?: AgentLite[];
  plan?: Plan | null;
  quickReplies?: string[];
  results?: ActionResult[];
}

interface Props {
  user: User | null;
  wallet: Wallet | null;
  selectedCompany: Company | null;
  onOpenAuth: () => void;
  onNavigate: (tab: string) => void;
  onRefreshWallet: () => void;
  onRefreshCompanies: () => void;
}

const STORAGE_KEY = 'froc.concierge.v1';
const COLOR: Record<AgentLite['color'], string> = { yellow: '#FFD400', pink: '#FF2D87', green: '#00E676', white: '#ffffff' };

const STARTERS = [
  { icon: MapPin, title: 'Clientes do meu bairro', text: 'Quero atrair clientes do meu bairro e da minha cidade para o meu negócio.', color: '#FFD400' },
  { icon: Search, title: 'Aparecer no Google', text: 'Quero que minha empresa apareça no Google quando procurarem pelo que eu vendo.', color: '#00E676' },
  { icon: Megaphone, title: 'Anúncio irresistível', text: 'Crie um anúncio irresistível com foto para o meu Instagram.', color: '#FF2D87' },
  { icon: Store, title: 'Brilhar na Vitrine', text: 'Quero colocar meu site na Vitrine Froc.IA com post diário automático.', color: '#ffffff' }
];

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function loadState(): { messages: ChatMessage[]; collected: Collected | null } {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [], collected: null };
    const parsed = JSON.parse(raw);
    return { messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-40) : [], collected: parsed.collected || null };
  } catch {
    return { messages: [], collected: null };
  }
}

function TargetingCard({ targeting, media }: { targeting: Targeting; media?: string }) {
  const chips: Array<[string, string]> = [];
  if (targeting.country) chips.push(['País', targeting.country]);
  if (targeting.state) chips.push(['Estado', targeting.state]);
  if (targeting.city) chips.push(['Cidade', targeting.city]);
  targeting.neighborhoods.forEach((value) => chips.push(['Bairro', value]));
  targeting.streets.forEach((value) => chips.push(['Rua', value]));
  if (targeting.radiusKm) chips.push(['Raio', `${targeting.radiusKm} km`]);
  if (!chips.length && !media) return null;
  return (
    <div className="rounded-2xl border border-[#00E676]/25 bg-[#00E676]/[0.05] p-4">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#00E676]"><Target size={13} /> Segmentação</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(([label, value], index) => (
          <span key={`${label}-${value}-${index}`} className="rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] text-white">
            <span className="text-neutral-400">{label}:</span> {value}
          </span>
        ))}
        {media && <span className="rounded-full border border-[#FF2D87]/40 bg-[#FF2D87]/10 px-2.5 py-1 text-[11px] text-[#ff7ab3]">Formato: {media}</span>}
      </div>
    </div>
  );
}

function AgentsStrip({ agents }: { agents: AgentLite[] }) {
  const [open, setOpen] = useState(false);
  if (!agents.length) return null;
  return (
    <div className="mt-3">
      <button onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-neutral-300 hover:text-white">
        <span className="flex -space-x-1.5">
          {agents.slice(0, 5).map((agent) => <span key={agent.id} className="h-3.5 w-3.5 rounded-full border border-black" style={{ background: COLOR[agent.color] }} />)}
        </span>
        {agents.length} especialistas trabalharam nesta resposta
        <ChevronDown size={12} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {agents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/40 px-2.5 py-1.5 text-[11px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR[agent.color] }} />
              <span className="font-bold text-white">{agent.name}</span>
              <span className="truncate text-neutral-400">{agent.role}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: ActionResult }) {
  const data = result.data || {};
  return (
    <div className={`rounded-2xl border p-3 ${result.ok ? 'border-[#00E676]/25 bg-[#00E676]/[0.04]' : 'border-[#FF2D87]/30 bg-[#FF2D87]/[0.05]'}`}>
      <div className="flex items-start gap-2">
        {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#00E676]" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-[#FF2D87]" />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-white">{result.label}</p>
          <p className="text-[11px] text-neutral-400">{result.message}{result.credits ? ` · ${result.credits} créditos` : ''}</p>
          {data.headline && (
            <div className="mt-2 rounded-xl bg-black/50 p-3 text-xs text-neutral-200">
              <p className="font-black text-[#FFD400]">{data.headline}</p>
              {data.body && <p className="mt-1 whitespace-pre-line">{data.body}</p>}
              {data.cta && <p className="mt-2 font-bold text-[#FF2D87]">{data.cta}</p>}
              {Array.isArray(data.hashtags) && data.hashtags.length > 0 && <p className="mt-1 text-[11px] text-[#00E676]">{data.hashtags.join(' ')}</p>}
            </div>
          )}
          {data.imageUrl && <img src={data.imageUrl} alt="Imagem criada pelo Froc.IA" className="mt-2 max-h-72 rounded-xl border border-white/10 object-cover" />}
          {Array.isArray(data.scenes) && data.scenes.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-neutral-300">
              {data.scenes.map((scene: any, index: number) => <li key={index}>{scene?.narration || scene?.description || scene?.visual || JSON.stringify(scene).slice(0, 160)}</li>)}
            </ol>
          )}
          {data.summary && <p className="mt-2 text-[11px] text-neutral-300">{data.summary}</p>}
          {data.url && (
            <a href={data.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#FFD400] hover:underline">
              {data.title || 'Ver publicação'} <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export const ConciergeHome: React.FC<Props> = ({ user, wallet, selectedCompany, onOpenAuth, onNavigate, onRefreshWallet, onRefreshCompanies }) => {
  const initial = useMemo(loadState, []);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [collected, setCollected] = useState<Collected | null>(initial.collected);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [liveAgents, setLiveAgents] = useState(173);
  const [now, setNow] = useState(() => brazilNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(brazilNow()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const name = firstName(user?.name);
  const voiceSupported = useMemo(isVoiceSupported, []);
  const voice = useFrocVoice({
    neural: Boolean(user),
    onCommand: (command) => { void send(command, true); },
    onPartial: (text) => { setInput(text); window.requestAnimationFrame(autosize); }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-40), collected })); } catch { /* armazenamento opcional */ }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, collected, thinking]);

  useEffect(() => {
    const timer = window.setInterval(() => setLiveAgents(170 + Math.floor(Math.random() * 30)), 2600);
    return () => window.clearInterval(timer);
  }, []);

  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const send = async (text: string, fromVoice = false) => {
    const content = text.trim();
    if (!content || thinking) { if (fromVoice) voice.cancelThinking(); return; }
    setError('');
    const next: ChatMessage[] = [...messages, { id: uid(), role: 'user', content }];
    setMessages(next);
    setInput('');
    window.requestAnimationFrame(autosize);
    setThinking(true);
    try {
      const data = await apiRequest<{ reply: string; quickReplies: string[]; collected: Collected; plan: Plan | null; agents: AgentLite[] }>('/api/concierge/chat', {
        method: 'POST',
        body: {
          messages: next.map(({ role, content: body }) => ({ role, content: body })).slice(-24),
          collected,
          companyId: selectedCompany?.id
        },
        timeoutMs: 90_000
      });
      setCollected(data.collected);
      const replyId = uid();
      setMessages((current) => [...current, { id: replyId, role: 'assistant', content: data.reply, agents: data.agents, plan: data.plan, quickReplies: data.quickReplies }]);
      // Conversa por voz ligada: o Froc.IA responde falando e volta a ouvir sozinha.
      if (fromVoice || voice.enabled) void voice.speak(data.reply, replyId);
    } catch (err: any) {
      setError(err?.message || 'O Froc.IA está muito requisitada agora. Tente de novo em instantes.');
      if (fromVoice || voice.enabled) voice.cancelThinking();
    } finally {
      setThinking(false);
    }
  };

  const execute = async (message: ChatMessage) => {
    if (!message.plan || !collected) return;
    if (!user) {
      onOpenAuth();
      return;
    }
    setExecuting(message.id);
    setError('');
    try {
      const data = await apiRequest<{ results: ActionResult[]; creditsUsed: number; company: Company }>('/api/concierge/execute', {
        method: 'POST',
        body: { collected, actions: message.plan.actions.map((action) => action.type), companyId: selectedCompany?.id },
        timeoutMs: 5 * 60_000
      });
      const okCount = data.results.filter((item) => item.ok).length;
      setMessages((current) => [
        ...current.map((item) => item.id === message.id ? { ...item, plan: null } : item),
        {
          id: uid(), role: 'assistant',
          content: `Pronto! 👑 Executei ${okCount} de ${data.results.length} etapas para **${data.company?.name || 'sua marca'}**${data.creditsUsed ? ` usando ${data.creditsUsed} créditos` : ''}. Seus clientes já podem te encontrar. Quer que eu crie mais alguma coisa?`,
          results: data.results,
          quickReplies: ['Criar outro anúncio', 'Ver minha vitrine', 'Mudar a segmentação']
        }
      ]);
      onRefreshWallet();
      onRefreshCompanies();
    } catch (err: any) {
      setError(err?.message || 'Não consegui concluir a execução. Nenhum crédito foi cobrado nas etapas que falharam.');
    } finally {
      setExecuting(null);
    }
  };

  const reset = () => {
    voice.disable();
    setMessages([]);
    setCollected(null);
    setError('');
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* opcional */ }
  };

  const onQuick = (value: string) => {
    if (value === 'Ver minha vitrine') { onNavigate('vitrine'); return; }
    send(value);
  };

  const empty = messages.length === 0;
  const lastAssistant = [...messages].reverse().find((item) => item.role === 'assistant');
  const balance = wallet ? wallet.balance + (wallet.bonusBalance || 0) : null;

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#050505] text-white">
      <div className="froc-aurora" />
      <div className="froc-grid-bg" />
      <PublicTopBar user={user} wallet={wallet} current="home" onNavigate={onNavigate} onOpenAuth={onOpenAuth} />

      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto pb-44 pt-[calc(80px+env(safe-area-inset-top))]">
        {empty ? (
          <section className="mx-auto flex max-w-4xl flex-col items-center px-4 pt-6 text-center sm:pt-14">
            <div className="froc-logo-hero froc-float mb-6">
              <img src="/brand/logo-froc-512.webp" alt="Froc.IA — inteligência artificial de marketing" width={176} height={176} className="relative z-10 h-32 w-32 rounded-full sm:h-44 sm:w-44" fetchPriority="high" />
            </div>
            <p className="mb-3 text-lg font-black text-white sm:text-xl">{now.greeting}{name ? `, ${name}` : ''}! 👋</p>
            <p className="mb-5 text-xs capitalize text-neutral-400">{now.longDate} · {now.time}</p>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#00E676]/30 bg-[#00E676]/[0.07] px-4 py-1.5 text-[11px] font-bold text-[#00E676]">
              <span className="froc-pulse-dot h-2 w-2 rounded-full bg-[#00E676] text-[#00E676]" />
              {liveAgents} de {FROC_AGENTS.length} agentes trabalhando agora
            </div>
            <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
              Fale o que você quer.<br />
              <span className="froc-text-gradient">O Froc.IA faz o resto.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-neutral-300 sm:text-base">
              Sem formulários, sem painéis complicados. Converse com o Froc.IA: ele entende seu negócio, define a região (país, cidade, bairro e até a rua), cria o anúncio e coloca sua marca para ser encontrada no Google — todos os dias.
            </p>

            <div className="mt-10 grid w-full gap-3 sm:grid-cols-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter.title}
                  onClick={() => send(starter.text)}
                  className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.06]"
                >
                  <span className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl transition group-hover:opacity-50" style={{ background: starter.color }} />
                  <starter.icon size={22} style={{ color: starter.color }} />
                  <p className="mt-3 text-sm font-black text-white">{starter.title}</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-400">{starter.text}</p>
                </button>
              ))}
            </div>

            <div className="mt-10 grid w-full grid-cols-3 gap-3 text-left">
              {[
                { icon: Users, value: `${FROC_AGENTS.length}`, label: 'agentes especialistas', color: '#FFD400' },
                { icon: Zap, value: `${FROC_SQUADS.length}`, label: 'esquadrões de marketing', color: '#FF2D87' },
                { icon: Crown, value: '1/dia', label: 'post estratégico na vitrine', color: '#00E676' }
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                  <stat.icon size={16} style={{ color: stat.color }} />
                  <p className="mt-2 text-xl font-black text-white sm:text-2xl">{stat.value}</p>
                  <p className="text-[11px] text-neutral-400">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="mx-auto max-w-3xl space-y-5 px-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">Conversa com o Froc.IA</p>
              <button onClick={reset} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-[11px] text-neutral-400 hover:text-white"><RotateCcw size={11} /> Nova conversa</button>
            </div>

            {messages.map((message) => message.role === 'user' ? (
              <div key={message.id} className="flex justify-end animate-fadeIn">
                <div className="max-w-[85%] rounded-3xl rounded-br-md bg-white px-4 py-3 text-sm font-medium text-black">{message.content}</div>
              </div>
            ) : (
              <div key={message.id} className="flex gap-3 animate-fadeIn">
                <img src="/brand/logo-froc.webp" alt="Froc.IA" width={36} height={36} className="mt-1 h-9 w-9 shrink-0 rounded-full shadow-[0_0_16px_rgba(45,107,255,.55)] ring-1 ring-white/20" />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-line text-sm leading-7 text-neutral-100" dangerouslySetInnerHTML={{ __html: escapeAndBold(message.content) }} />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => voice.speakingId === message.id ? voice.stopSpeaking() : void voice.speak(message.content, message.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition ${voice.speakingId === message.id ? 'border-[#FF2D87] bg-[#FF2D87]/15 text-[#ff7ab3]' : 'border-white/10 text-neutral-400 hover:text-white'}`}
                      aria-label={voice.speakingId === message.id ? 'Parar leitura' : 'Ouvir resposta'}
                    >
                      {voice.speakingId === message.id ? <Square size={11} /> : <Volume2 size={12} />}
                      {voice.speakingId === message.id ? 'Parar' : 'Ouvir'}
                    </button>
                  </div>
                  {message.agents && <AgentsStrip agents={message.agents} />}

                  {message.plan && (
                    <div className="froc-glow-card mt-4 p-5">
                      <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#FFD400]"><Sparkles size={13} /> Resumo para confirmar</p>
                      {message.plan.summary && <p className="mt-2 text-sm leading-6 text-white">{message.plan.summary}</p>}
                      {collected && <div className="mt-3"><TargetingCard targeting={collected.targeting} media={collected.media} /></div>}
                      <ul className="mt-4 space-y-2">
                        {message.plan.actions.map((action) => (
                          <li key={action.type} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs">
                            <span className="flex items-center gap-2 text-neutral-200">
                              {action.type === 'generate_image' ? <ImageIcon size={14} className="text-[#FF2D87]" /> : action.type === 'generate_video_script' ? <Video size={14} className="text-[#FF2D87]" /> : <Check size={14} className="text-[#00E676]" />}
                              {action.label}
                            </span>
                            <span className="shrink-0 font-bold text-neutral-400">{action.credits ? `${action.credits} cr` : 'incluso'}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <p className="flex items-center gap-1.5 text-xs text-neutral-300"><Coins size={14} className="text-[#FFD400]" /> Total estimado: <strong className="text-white">{message.plan.estimatedCredits} créditos</strong>{balance !== null && <span className="text-neutral-500">· saldo {balance}</span>}</p>
                        <button
                          onClick={() => execute(message)}
                          disabled={Boolean(executing)}
                          className="froc-shimmer inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FFD400] via-[#FF2D87] to-[#00E676] px-5 py-2.5 text-sm font-black text-black shadow-[0_0_30px_rgba(255,45,135,.45)] disabled:opacity-60"
                        >
                          {executing === message.id ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                          {executing === message.id ? 'Os agentes estão criando…' : user ? 'Confirmar e criar' : 'Entrar e criar'}
                        </button>
                      </div>
                    </div>
                  )}

                  {message.results && (
                    <div className="mt-4 space-y-2">
                      {message.results.map((result, index) => <ResultCard key={`${result.type}-${index}`} result={result} />)}
                    </div>
                  )}

                  {message.id === lastAssistant?.id && message.quickReplies && message.quickReplies.length > 0 && !thinking && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {message.quickReplies.map((reply) => (
                        <button key={reply} onClick={() => onQuick(reply)} className="rounded-full border border-white/15 bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:border-[#FFD400] hover:text-[#FFD400]">{reply}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex items-center gap-3 animate-fadeIn">
                <img src="/brand/logo-froc.webp" alt="Froc.IA" width={36} height={36} className="h-9 w-9 shrink-0 animate-pulse rounded-full shadow-[0_0_16px_rgba(45,107,255,.55)] ring-1 ring-white/20" />
                <div className="froc-typing rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"><span /><span /><span /></div>
                <span className="text-[11px] text-neutral-500">Digitando…</span>
              </div>
            )}

            {executing && (
              <div className="rounded-2xl border border-[#FFD400]/20 bg-[#FFD400]/[0.04] p-4 text-xs text-neutral-300 animate-fadeIn">
                <p className="flex items-center gap-2 font-bold text-[#FFD400]"><Loader2 size={14} className="animate-spin" /> Executando a automação</p>
                <p className="mt-1">Salvando a segmentação, criando conteúdo, publicando na vitrine e avisando os buscadores. Isso pode levar até 1 minuto.</p>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black/95 to-transparent px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-10">
        <div className="mx-auto max-w-3xl">
          {error && <p className="mb-2 rounded-xl border border-[#FF2D87]/30 bg-[#FF2D87]/10 px-3 py-2 text-xs text-[#ff7ab3]">{error}</p>}
          {voice.error && <p className="mb-2 rounded-xl border border-[#FFD400]/30 bg-[#FFD400]/10 px-3 py-2 text-xs text-[#ffe14d]">{voice.error}</p>}
          {voice.enabled && <VoiceStatusBar phase={voice.phase} neural={Boolean(user)} onStop={voice.disable} />}
          <form
            onSubmit={(event) => { event.preventDefault(); send(input); }}
            className="froc-glow-card flex items-end gap-2 p-2 pl-4"
          >
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(event) => { setInput(event.target.value); autosize(); }}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(input); } }}
              placeholder={voice.enabled ? 'Pode falar, estou ouvindo…' : empty ? 'Ex.: Tenho uma pizzaria no bairro Centro em Campinas e quero mais pedidos…' : 'Responda para o Froc.IA…'}
              className="max-h-[180px] min-h-[44px] flex-1 resize-none bg-transparent py-3 text-sm text-white outline-none placeholder:text-neutral-500"
              aria-label="Mensagem para o Froc.IA"
              maxLength={2000}
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={voice.toggle}
                aria-label={voice.enabled ? 'Desligar conversa por voz' : 'Falar com o Froc.IA'}
                aria-pressed={voice.enabled}
                title={voice.enabled ? 'Desligar microfone' : 'Falar com o Froc.IA (diga "pare" para desligar)'}
                className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition ${voice.enabled ? 'bg-[#FF2D87] text-white shadow-[0_0_24px_rgba(255,45,135,.6)]' : 'border border-white/15 bg-white/[0.04] text-white hover:border-[#FFD400] hover:text-[#FFD400]'}`}
              >
                {voice.enabled && voice.phase === 'listening' && <span className="absolute inset-0 animate-ping rounded-2xl bg-[#FF2D87]/40" />}
                {voice.enabled ? <MicOff size={19} className="relative" /> : <Mic size={19} />}
              </button>
            )}
            <button type="submit" disabled={!input.trim() || thinking} aria-label="Enviar" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#FFD400] text-black transition hover:bg-white disabled:opacity-30">
              {thinking ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={20} strokeWidth={3} />}
            </button>
          </form>
          <p className="mt-2 text-center text-[10px] text-neutral-500">Digite ou toque no microfone e fale. O Froc.IA confirma tudo antes de executar; conversar é grátis e créditos só são usados nas criações confirmadas.</p>
        </div>
      </div>
    </div>
  );
};

/** Escapa HTML e converte **negrito** — seguro para dangerouslySetInnerHTML. */
function escapeAndBold(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>');
}
