import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar as CalendarIcon, CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, Info, List, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import type { Company, ContentItem, ScheduledPost } from '../types';
import { apiRequest } from '../lib/api';

interface Props {
  scheduledPosts: ScheduledPost[];
  contentItems: ContentItem[];
  selectedCompany: Company | null;
  onRefreshSchedule: () => void;
  onNavigate: (tab: string) => void;
}

const PLATFORM_OPTIONS = [
  { id: 'Facebook', label: 'Facebook Page', icon: '📘', autoPublish: true, note: 'Publicação direta de texto' },
  { id: 'LinkedIn', label: 'LinkedIn', icon: '💼', autoPublish: true, note: 'Publicação de texto' },
  { id: 'X', label: 'X', icon: '𝕏', autoPublish: true, note: 'Publicação de texto (até 280 caracteres)' },
  { id: 'Instagram', label: 'Instagram', icon: '📸', autoPublish: false, note: 'Requer container de mídia' },
  { id: 'TikTok', label: 'TikTok', icon: '🎵', autoPublish: false, note: 'Rascunho via Inbox (vídeo MP4)' },
  { id: 'YouTube', label: 'YouTube', icon: '▶️', autoPublish: false, note: 'Requer arquivo de vídeo' },
  { id: 'Pinterest', label: 'Pinterest', icon: '📌', autoPublish: false, note: 'Requer imagem/mídia' },
];

export const CalendarPage: React.FC<Props> = ({
  scheduledPosts,
  contentItems,
  selectedCompany,
  onRefreshSchedule,
  onNavigate
}) => {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [modal, setModal] = useState(false);
  const [contentId, setContentId] = useState('');
  const [dateTime, setDateTime] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['Facebook']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionableTab, setActionableTab] = useState<string | null>(null);

  useEffect(() => {
    try {
      const prefillRaw = sessionStorage.getItem('froc_schedule_prefill');
      if (prefillRaw) {
        const data = JSON.parse(prefillRaw);
        if (data.contentItemId) setContentId(data.contentItemId);
        if (Array.isArray(data.platforms) && data.platforms.length > 0) setPlatforms(data.platforms);
        const nextHour = new Date(Date.now() + 3600000);
        setDateTime(nextHour.toISOString().slice(0, 16));
        setModal(true);
        sessionStorage.removeItem('froc_schedule_prefill');
      }
    } catch {
      // Ignore sessionStorage parsing errors
    }
  }, [contentItems]);

  const posts = useMemo(
    () => scheduledPosts.filter((p) => !selectedCompany || p.companyId === selectedCompany.id).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)),
    [scheduledPosts, selectedCompany]
  );

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const monthPosts = posts.filter((p) => p.scheduledFor.startsWith(monthKey));
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const openScheduleModal = () => {
    setError('');
    setActionableTab(null);
    if (!dateTime) {
      const nextHour = new Date(Date.now() + 3600000);
      setDateTime(nextHour.toISOString().slice(0, 16));
    }
    setModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany?.id) {
      setError('Selecione uma empresa no topo antes de agendar.');
      setActionableTab('empresa');
      return;
    }
    if (!contentId) {
      setError('Selecione um conteúdo da lista.');
      return;
    }
    if (!platforms.length) {
      setError('Selecione ao menos uma plataforma de destino.');
      return;
    }
    setLoading(true);
    setError('');
    setActionableTab(null);
    try {
      await apiRequest('/api/content/schedule', {
        method: 'POST',
        body: {
          companyId: selectedCompany.id,
          contentItemId: contentId,
          platforms,
          scheduledFor: new Date(dateTime).toISOString()
        }
      });
      setModal(false);
      setContentId('');
      setDateTime('');
      await onRefreshSchedule();
    } catch (err: any) {
      const msg = err.message || 'Falha ao agendar publicação.';
      setError(msg);
      if (msg.includes('plano') || msg.includes('upgrade') || msg.includes('PRO')) {
        setActionableTab('planos');
      } else if (msg.includes('conectada') || msg.includes('Redes Sociais') || msg.includes('expirou')) {
        setActionableTab('redes');
      }
    } finally {
      setLoading(false);
    }
  };

  const retry = async (id: string) => {
    try {
      await apiRequest(`/api/content/scheduled/${id}/retry`, { method: 'POST' });
      await onRefreshSchedule();
    } catch (err: any) {
      setError(err.message || 'Falha ao reagendar.');
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm('Cancelar este agendamento?')) return;
    try {
      await apiRequest(`/api/content/scheduled/${id}/cancel`, { method: 'POST' });
      await onRefreshSchedule();
    } catch (err: any) {
      setError(err.message || 'Falha ao cancelar.');
    }
  };

  const renderBadge = (status: string) => {
    switch (status) {
      case 'published':
        return (
          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            <CheckCircle2 size={11} /> Publicado
          </span>
        );
      case 'publishing':
        return (
          <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300 animate-pulse">
            <Loader2 size={11} className="animate-spin" /> Publicando…
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-300">
            <AlertCircle size={11} /> Requer atenção
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
            Cancelado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
            <Clock size={11} /> Agendado
          </span>
        );
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <CalendarIcon className="text-cyan-400" />
            Calendário Editorial
          </h2>
          <p className="text-xs text-slate-400">Agendamento real e publicação automática em redes sociais com acompanhamento de status.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void onRefreshSchedule()} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-300 hover:border-slate-600">
            <RefreshCw size={14} /> Atualizar
          </button>
          <button onClick={openScheduleModal} className="froc-primary flex items-center justify-center gap-2">
            <Plus size={15} /> Agendar publicação
          </button>
        </div>
      </div>

      {!selectedCompany && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-200">
          Selecione uma empresa no seletor do topo para criar novos agendamentos e visualizar seu calendário.
        </div>
      )}

      {/* Visão de Calendário Mensal */}
      <section className="froc-panel">
        <div className="mb-5 flex items-center justify-between">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl border border-slate-700 p-2 text-slate-300 hover:bg-slate-800">
            <ChevronLeft size={17} />
          </button>
          <h3 className="text-sm font-black capitalize text-white">{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h3>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl border border-slate-700 p-2 text-slate-300 hover:bg-slate-800">
            <ChevronRight size={17} />
          </button>
        </div>

        {/* Desktop Grid */}
        <div className="hidden md:block">
          <div className="mb-2 grid grid-cols-7 text-center text-[10px] font-black uppercase text-slate-500">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({length: first}).map((_, i) => (
              <div key={`b${i}`} className="min-h-24 rounded-xl bg-slate-950/30 border border-slate-900/50" />
            ))}
            {Array.from({length: days}).map((_, i) => {
              const day = i + 1;
              const prefix = `${monthKey}-${String(day).padStart(2, '0')}`;
              const dayPosts = monthPosts.filter((p) => p.scheduledFor.startsWith(prefix));
              return (
                <div key={day} className="min-h-24 rounded-xl border border-slate-800 bg-slate-950/40 p-2 flex flex-col justify-between">
                  <div className="text-[11px] font-bold text-slate-400">{day}</div>
                  <div className="mt-1 space-y-1">
                    {dayPosts.slice(0, 3).map((p) => (
                      <div key={p.id} className="truncate rounded px-1.5 py-0.5 text-[9px] bg-slate-900 border border-slate-800">
                        <span className="font-mono text-cyan-300">{new Date(p.scheduledFor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span> · {p.status}
                      </div>
                    ))}
                    {dayPosts.length > 3 && <div className="text-[9px] text-slate-500 font-semibold">+{dayPosts.length - 3} mais</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile View */}
        <div className="md:hidden">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-300">
            <List size={15} className="text-cyan-400" />
            Agenda do mês
          </div>
          {monthPosts.length ? (
            <div className="space-y-2">
              {monthPosts.map((p) => {
                const c = contentItems.find((item) => item.id === p.contentItemId);
                return (
                  <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-white">{c?.title || c?.headline || 'Conteúdo agendado'}</div>
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                          <Clock size={11} />
                          {new Date(p.scheduledFor).toLocaleString('pt-BR')}
                        </div>
                        <div className="mt-1 truncate text-[10px] text-slate-500">{p.platforms?.join(', ')}</div>
                      </div>
                      <div className="shrink-0">{renderBadge(p.status)}</div>
                    </div>
                    {p.errorMessage && <div className="mt-2 text-[10px] text-rose-300 rounded-lg bg-rose-500/10 p-2 border border-rose-500/20">{p.errorMessage}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-xs text-slate-500">Nenhuma publicação agendada neste mês.</div>
          )}
        </div>
      </section>

      {/* Fila de Execução e Ocorrências */}
      <section className="froc-panel">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="froc-section-title">Fila de Publicações e Status</h3>
          <span className="text-[10px] text-slate-500">Histórico de execuções</span>
        </div>
        {posts.length ? (
          <div className="space-y-2.5">
            {posts.slice(0, 15).map((p) => {
              const c = contentItems.find((item) => item.id === p.contentItemId);
              const pubResults = Array.isArray((p as any).publicationResults) ? (p as any).publicationResults : [];
              return (
                <div key={`queue-${p.id}`} className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-bold text-white">{c?.title || c?.headline || 'Conteúdo agendado'}</span>
                      {renderBadge(p.status)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400">
                      <span>{new Date(p.scheduledFor).toLocaleString('pt-BR')}</span>
                      <span>·</span>
                      <span className="text-slate-300">{p.platforms?.join(', ')}</span>
                      {p.autopilotGenerated && <span className="rounded bg-cyan-500/10 px-1 text-cyan-300 font-mono text-[9px]">Autopilot</span>}
                    </div>

                    {/* Resultados de Publicação / IDs Externos */}
                    {pubResults.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pubResults.map((res: any, idx: number) => (
                          <span
                            key={idx}
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-mono ${
                              res.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                            }`}
                          >
                            {res.platform || res.provider}: {res.success ? `Publicado (ID: ${res.externalId || 'ok'})` : (res.error || 'falha')}
                          </span>
                        ))}
                      </div>
                    )}

                    {p.errorMessage && <div className="mt-2 text-[10px] text-rose-300 rounded-lg bg-rose-500/10 p-2 border border-rose-500/20">{p.errorMessage}</div>}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    {p.status === 'failed' && (
                      <button onClick={() => retry(p.id)} className="froc-secondary min-h-9 text-[11px] px-3 font-semibold">
                        Tentar novamente
                      </button>
                    )}
                    {(p.status === 'scheduled' || p.status === 'failed') && (
                      <button onClick={() => cancel(p.id)} className="min-h-9 rounded-xl border border-rose-500/20 px-3 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/10">
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
            Nenhum agendamento criado. Clique em "Agendar publicação" acima para programar posts para Facebook e outras redes.
          </div>
        )}
      </section>

      {/* Modal de Agendamento */}
      {modal && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-3 backdrop-blur-sm animate-fadeIn">
          <form onSubmit={submit} className="max-h-[calc(100dvh-24px)] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-700 bg-[#0F172A] p-5 sm:p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-black text-white">Agendar publicação</h3>
              <button type="button" onClick={() => setModal(false)} className="rounded-xl p-2 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300 space-y-2">
                <div className="flex gap-2 items-start">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{error}</p>
                </div>
                {actionableTab && (
                  <button
                    type="button"
                    onClick={() => {
                      setModal(false);
                      onNavigate(actionableTab);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 px-3 py-1 text-xs font-bold text-white hover:bg-rose-500/30"
                  >
                    <ExternalLink size={12} />
                    {actionableTab === 'planos' ? 'Ver Planos & Assinaturas' : actionableTab === 'redes' ? 'Ir para Redes Sociais' : 'Ir para Minha Empresa'}
                  </button>
                )}
              </div>
            )}

            <div className="space-y-4">
              <label className="block text-xs font-semibold text-slate-300">
                Conteúdo para publicação *
                <select value={contentId} onChange={(e) => setContentId(e.target.value)} className="froc-input mt-1.5" required>
                  <option value="">Selecione um conteúdo salvo…</option>
                  {contentItems
                    .filter((c) => !selectedCompany || c.companyId === selectedCompany.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title || c.headline || 'Sem título'} ({c.type || 'post'})
                      </option>
                    ))}
                </select>
              </label>

              <label className="block text-xs font-semibold text-slate-300">
                Data e hora do agendamento *
                <input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} className="froc-input mt-1.5" required />
              </label>

              <div>
                <div className="text-xs font-semibold text-slate-300 mb-1.5">Redes Sociais de Destino *</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PLATFORM_OPTIONS.map((p) => {
                    const selected = platforms.includes(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => togglePlatform(p.id)}
                        className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                          selected ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200' : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <span className="text-lg">{p.icon}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            {p.label}
                            {p.autoPublish && <span className="rounded bg-emerald-500/20 px-1 text-[8px] text-emerald-300 font-normal">Auto</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{p.note}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-800">
                <button type="button" onClick={() => setModal(false)} className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800">
                  Cancelar
                </button>
                <button disabled={loading} className="froc-primary flex-1">
                  {loading ? 'Agendando…' : 'Confirmar agendamento'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

