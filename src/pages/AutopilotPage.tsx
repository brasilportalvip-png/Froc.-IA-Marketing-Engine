import React, { useEffect, useState } from 'react';
import { AlertCircle, Bot, Calendar, CheckCircle2, Coins, Lock, Rocket, ShieldCheck, Zap } from 'lucide-react';
import type { Company, Wallet } from '../types';
import { apiRequest } from '../lib/api';

interface Props {
  selectedCompany: Company | null;
  wallet?: Wallet | null;
  onNavigate: (tab: string) => void;
}

interface AutopilotConfig {
  id?: string;
  companyId: string;
  enabled: boolean;
  mode: 'manual_approval' | 'automatic';
  frequency: 'daily' | '3_times_week' | 'weekly';
  targetPlatforms: string[];
  primaryGoal: string;
  maxMonthlyCredits: number;
  usedCreditsThisMonth: number;
  lastRunAt?: string;
}

export const AutopilotPage: React.FC<Props> = ({ selectedCompany, wallet, onNavigate }) => {
  const [cfg, setCfg] = useState<AutopilotConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const planId = wallet?.planId || 'plan_free';
  const hasAutopilotAccess = ['plan_pro', 'plan_business', 'plan_agency'].includes(planId);
  const hasAutomaticModeAccess = ['plan_business', 'plan_agency'].includes(planId);

  useEffect(() => {
    if (!selectedCompany?.id) {
      setCfg(null);
      return;
    }
    setLoading(true);
    apiRequest<{ config: AutopilotConfig }>(`/api/autopilot/config?companyId=${encodeURIComponent(selectedCompany.id)}`)
      .then((d) => setCfg(d.config))
      .catch((e) => setMessage(e.message))
      .finally(() => setLoading(false));
  }, [selectedCompany?.id]);

  const patch = (p: Partial<AutopilotConfig>) => setCfg((c) => (c ? { ...c, ...p } : c));
  const toggleChannel = (name: string) =>
    patch({
      targetPlatforms: cfg?.targetPlatforms.includes(name)
        ? cfg.targetPlatforms.filter((v) => v !== name)
        : [...(cfg?.targetPlatforms || []), name]
    });

  const save = async () => {
    if (!cfg || !selectedCompany) return;
    if (!hasAutopilotAccess && cfg.enabled) {
      setMessage('O recurso Autopilot requer o plano PRO ou superior. Faça upgrade para ativar.');
      return;
    }
    if (cfg.mode === 'automatic' && !hasAutomaticModeAccess) {
      setMessage('O modo automático do Autopilot é exclusivo para os planos BUSINESS e AGENCY.');
      return;
    }
    if (cfg.mode === 'automatic') {
      const supported = ['facebook', 'linkedin', 'x'];
      const hasSupportedChannel = cfg.targetPlatforms.some((p) => supported.includes(p.toLowerCase().trim()));
      if (!hasSupportedChannel) {
        setMessage('Para o modo 100% automático, selecione ao menos um canal que suporte publicação direta de texto (Facebook, LinkedIn ou X).');
        return;
      }
    }
    setSaving(true);
    setMessage('');
    try {
      const d = await apiRequest<{ config: AutopilotConfig }>('/api/autopilot/config', {
        method: 'POST',
        body: { ...cfg, companyId: selectedCompany.id }
      });
      setCfg(d.config);
      setMessage('Configuração salva no backend com sucesso.');
    } catch (e: any) {
      setMessage(e.message || 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!selectedCompany) return;
    if (!hasAutopilotAccess) {
      setMessage('O recurso Autopilot requer o plano PRO ou superior. Faça upgrade para executar.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      await apiRequest('/api/autopilot/trigger-now', {
        method: 'POST',
        body: { companyId: selectedCompany.id }
      });
      setMessage('Ciclo executado com sucesso pelo backend! O conteúdo foi gerado e está pronto.');
    } catch (e: any) {
      setMessage(e.message || 'Falha ao executar ciclo.');
    } finally {
      setLoading(false);
    }
  };

  if (!selectedCompany) {
    return (
      <div className="froc-panel mx-auto max-w-3xl text-center">
        <Bot size={38} className="mx-auto text-cyan-400" />
        <h2 className="mt-3 text-lg font-bold text-white">Selecione uma empresa para ativar o Autopilot</h2>
        <p className="mt-1 text-xs text-slate-400">O piloto automático precisa do contexto de uma marca.</p>
        <button onClick={() => onNavigate('empresa')} className="froc-primary mt-5">
          Configurar empresa
        </button>
      </div>
    );
  }

  if (loading && !cfg) return <div className="grid min-h-72 place-items-center text-xs text-slate-400">Carregando Autopilot…</div>;
  if (!cfg) return <div className="froc-panel text-rose-300">Não foi possível carregar a configuração. {message}</div>;

  const channels = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'Pinterest', 'X'];

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fadeIn">
      <header className="rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-blue-950 via-[#0F172A] to-slate-900 p-6 md:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
              <Bot size={25} />
            </div>
            <div>
              <h2 className="text-xl font-black text-white">Froc Autopilot</h2>
              <p className="text-xs text-slate-400">Geração e agendamento contínuo de conteúdo com limite estrito de créditos.</p>
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 px-4">
            <input
              type="checkbox"
              checked={cfg.enabled}
              disabled={!hasAutopilotAccess}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            <span className={`text-xs font-bold ${cfg.enabled ? 'text-emerald-300' : 'text-slate-400'}`}>
              {cfg.enabled ? 'Ativo' : 'Pausado'}
            </span>
          </label>
        </div>
      </header>

      {!hasAutopilotAccess && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-amber-400 shrink-0" />
            <span>O recurso Autopilot está disponível a partir do plano <strong>PRO</strong>. Faça upgrade para ativar o piloto automático.</span>
          </div>
          <button onClick={() => onNavigate('planos')} className="froc-primary py-1.5 px-3 text-xs whitespace-nowrap ml-4">
            Ver planos
          </button>
        </div>
      )}

      {message && <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-xs text-cyan-200">{message}</div>}

      <section className="froc-panel space-y-6">
        <div>
          <h3 className="froc-section-title">Frequência</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              ['daily', 'Diariamente'],
              ['3_times_week', '3x por semana'],
              ['weekly', 'Semanalmente']
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => patch({ frequency: id as any })}
                className={`min-h-16 rounded-2xl border p-4 text-left text-xs font-bold ${
                  cfg.frequency === id ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-800 pt-5">
          <h3 className="froc-section-title">Modo de Operação</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <button
              onClick={() => patch({ mode: 'manual_approval' })}
              className={`rounded-2xl border p-4 text-left transition ${
                cfg.mode === 'manual_approval' ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-700 bg-slate-900'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <ShieldCheck size={16} className="text-cyan-400" />
                Aprovação manual
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Cria e salva o conteúdo para você revisar e aprovar antes de postar.</p>
            </button>

            <button
              onClick={() => {
                if (!hasAutomaticModeAccess) {
                  setMessage('O modo 100% automático requer o plano BUSINESS ou AGENCY.');
                }
                patch({ mode: 'automatic' });
              }}
              className={`rounded-2xl border p-4 text-left transition relative ${
                cfg.mode === 'automatic' ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-700 bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <Rocket size={16} className="text-cyan-400" />
                  Automático (Publicação direta)
                </div>
                {!hasAutomaticModeAccess && (
                  <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    BUSINESS+
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Cria e agenda diretamente na fila de publicação das redes conectadas.</p>
            </button>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-5">
          <h3 className="froc-section-title">Canais Alvo</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {channels.map((ch) => (
              <button
                key={ch}
                onClick={() => toggleChannel(ch)}
                className={`min-h-10 rounded-xl border px-3 text-xs font-semibold ${
                  cfg.targetPlatforms.includes(ch) ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-200' : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 border-t border-slate-800 pt-5 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-300">
            Objetivo principal
            <textarea
              value={cfg.primaryGoal}
              onChange={(e) => patch({ primaryGoal: e.target.value })}
              className="froc-input mt-1.5 min-h-24"
            />
          </label>
          <label className="text-xs font-semibold text-slate-300">
            Limite mensal de créditos
            <div className="relative mt-1.5">
              <Coins className="absolute left-3.5 top-3 text-amber-400" size={16} />
              <input
                type="number"
                min={5}
                value={cfg.maxMonthlyCredits}
                onChange={(e) => patch({ maxMonthlyCredits: Number(e.target.value) })}
                className="froc-input pl-10"
              />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Usados no mês: <strong className="text-white">{cfg.usedCreditsThisMonth || 0}</strong> / {cfg.maxMonthlyCredits} (5 créditos por ciclo)
            </div>
          </label>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-800 pt-5 sm:flex-row">
          <button onClick={save} disabled={saving} className="froc-primary flex items-center justify-center gap-2">
            <CheckCircle2 size={15} />
            {saving ? 'Salvando…' : 'Salvar Autopilot'}
          </button>
          <button
            onClick={runNow}
            disabled={loading || !hasAutopilotAccess}
            className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-5 text-xs font-bold text-slate-200 hover:border-cyan-500/40 disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              <Zap size={15} />
              {loading ? 'Processando…' : 'Executar ciclo agora (5 créditos)'}
            </span>
          </button>
        </div>
      </section>

      <div className="flex gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-[11px] leading-relaxed text-amber-100">
        <AlertCircle size={16} className="shrink-0" />
        <span>
          O Autopilot consome 5 créditos por ciclo gerado e só realiza publicações quando a respectiva rede social possui conexão autorizada e ativa. Todas as tentativas são protegidas com transações atômicas no servidor.
        </span>
      </div>

      {cfg.lastRunAt && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Calendar size={13} />
          Último ciclo executado: {new Date(cfg.lastRunAt).toLocaleString('pt-BR')}
        </div>
      )}
    </div>
  );
};

