import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bot, Building2, Calendar, Coins, FileText, Image as ImageIcon, Megaphone, PenTool, Search, Sparkles, Video, CheckCircle2, TrendingUp, Zap } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import type { Campaign, Company, ScheduledPost, User, Wallet } from '../types';
import { apiRequest } from '../lib/api';

interface Props {
  user: User | null;
  wallet: Wallet | null;
  selectedCompany: Company | null;
  campaigns: Campaign[];
  scheduledPosts: ScheduledPost[];
  onNavigate: (tab: string) => void;
  onOpenAuth: () => void;
}

export const DashboardPage: React.FC<Props> = ({
  user,
  wallet,
  selectedCompany,
  campaigns,
  scheduledPosts,
  onNavigate,
  onOpenAuth
}) => {
  const [status, setStatus] = useState({ hasSeoAudit: false, connectedSocialCount: 0 });

  useEffect(() => {
    if (!user) {
      setStatus({ hasSeoAudit: false, connectedSocialCount: 0 });
      return;
    }
    apiRequest<{ hasSeoAudit: boolean; connectedSocialCount: number }>(
      `/api/dashboard/status${selectedCompany?.id ? `?companyId=${encodeURIComponent(selectedCompany.id)}` : ''}`
    )
      .then(setStatus)
      .catch(() => undefined);
  }, [user, selectedCompany?.id]);

  const month = new Date().toISOString().slice(0, 7);
  const companyPosts = scheduledPosts.filter((p) => !selectedCompany || p.companyId === selectedCompany.id);
  const companyCampaigns = campaigns.filter((c) => !selectedCompany || c.companyId === selectedCompany.id);

  const active = companyCampaigns.filter((c) => c.status === 'active').length;
  const queued = companyPosts.filter((p) => p.status === 'scheduled' || p.status === 'publishing').length;
  const publishedMonth = companyPosts.filter((p) => p.status === 'published' && String(p.publishedAt || p.scheduledFor).startsWith(month)).length;

  const totals = companyCampaigns.reduce(
    (a, c) => ({
      reach: a.reach + Number(c.metrics?.reach || 0),
      clicks: a.clicks + Number(c.metrics?.clicks || 0),
      leads: a.leads + Number(c.metrics?.leads || 0),
      conversions: a.conversions + Number(c.metrics?.conversions || 0)
    }),
    { reach: 0, clicks: 0, leads: 0, conversions: 0 }
  );

  const quick = [
    ['Criar Post', PenTool, 'criar-conteudo', 'Copy, CTA e hashtags'],
    ['Criar Imagem', ImageIcon, 'criar-imagem', 'Imagem real com IA'],
    ['Criar Vídeo', Video, 'criar-video', 'Roteiro vertical'],
    ['Criar Artigo', FileText, 'criar-artigo', 'Artigo com SEO'],
    ['Analisar Site', Search, 'seo', 'Auditoria técnica'],
    ['Criar Campanha', Megaphone, 'campanhas', 'Planejamento multicanal']
  ] as const;

  const steps = useMemo(
    () =>
      [
        ['Cadastrar Empresa', !!selectedCompany, 'empresa'],
        ['Adicionar Website / Links', !!selectedCompany?.website, 'empresa'],
        ['Auditoria SEO do Site', status.hasSeoAudit, 'seo'],
        ['Completar Perfil da Marca', Boolean(selectedCompany?.targetAudience && selectedCompany?.differentials && selectedCompany?.goals), 'empresa'],
        ['Conectar Redes Sociais', status.connectedSocialCount > 0, 'redes-sociais'],
        ['Ter créditos disponíveis', (wallet?.balance ?? 0) > 0, 'planos'],
        ['Criar Primeira Campanha', companyCampaigns.length > 0, 'campanhas']
      ] as const,
    [selectedCompany, status, wallet?.balance, companyCampaigns.length]
  );

  if (!user) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 animate-fadeIn">
        <section className="relative overflow-hidden rounded-3xl border border-blue-500/30 bg-gradient-to-br from-blue-950 via-slate-950 to-cyan-950/30 p-8 md:p-12 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <BrandLogo size="lg" showText={true} subtitle="Marketing Intelligence" />
          </div>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight text-white md:text-5xl">
            Marketing com IA, conteúdo, SEO e automação em uma única operação.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            Cadastre sua marca, gere ativos, organize campanhas e publique somente quando as integrações oficiais confirmarem sucesso.
          </p>
          <button onClick={onOpenAuth} className="froc-primary mt-6 inline-flex items-center gap-2">
            <Sparkles size={16} />
            Criar conta / Entrar
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-7 animate-fadeIn">
      {/* Welcome Hero Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-blue-500/30 bg-gradient-to-r from-blue-950/80 via-[#0F172A] to-slate-900 p-6 shadow-2xl md:p-8">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-300">
              <Zap size={13} className="text-cyan-400" /> Froc AI Engine • Brand Center
            </span>
            {selectedCompany && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold ${
                selectedCompany.businessType === 'physical'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : selectedCompany.businessType === 'hybrid'
                  ? 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
              }`}>
                {selectedCompany.businessType === 'physical'
                  ? '🏬 Empresa Física'
                  : selectedCompany.businessType === 'hybrid'
                  ? '🔄 Modelo Híbrido'
                  : '🌐 100% Online'}
              </span>
            )}
          </div>
          <h2 className="mt-2 text-2xl font-black text-white md:text-3xl">
            Olá, {user.name?.split(' ')[0] || 'Empreendedor'} 👋
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {selectedCompany
              ? `Operação ativa para ${selectedCompany.name}. As diretrizes da sua empresa estão prontas para contextualizar suas criações.`
              : 'Cadastre ou selecione uma empresa para contextualizar a IA e as automações.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => onNavigate('froc-ia')} className="froc-primary inline-flex items-center gap-2">
              <Sparkles size={15} />
              Abrir Froc IA Central
            </button>
            <button onClick={() => onNavigate('empresa')} className="froc-secondary inline-flex items-center gap-2">
              <Building2 size={15} />
              {selectedCompany?.name || 'Configurar Empresa'}
            </button>
          </div>
        </div>
      </section>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {[
          ['Campanhas ativas', active],
          ['Posts na fila', queued],
          ['Publicados no mês', publishedMonth],
          ['Alcance', totals.reach],
          ['Cliques', totals.clicks],
          ['Leads', totals.leads],
          ['Conversões', totals.conversions]
        ].map(([label, value]) => (
          <div key={label as string} className="froc-panel p-4 hover:border-cyan-500/30 transition-colors">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
            <div className="mt-2 text-2xl font-black text-white">{Number(value).toLocaleString('pt-BR')}</div>
          </div>
        ))}
      </div>

      {/* Credits & Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="froc-panel border-amber-500/25 bg-gradient-to-b from-amber-500/5 to-transparent">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-300">
              <Coins size={16} /> Carteira de Créditos
            </span>
            <span className="text-[10px] font-semibold text-amber-400/80 px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20">
              Auditável
            </span>
          </div>
          <div className="mt-4 text-4xl font-black text-white">
            {wallet?.balance ?? 0}
            <span className="ml-2 text-xs font-normal text-slate-400">créditos</span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[10px]">
            <div className="rounded-xl bg-slate-950/60 p-2 text-slate-400 border border-slate-800">
              Usados
              <strong className="block text-sm text-white mt-0.5">{wallet?.totalUsed ?? 0}</strong>
            </div>
            <div className="rounded-xl bg-slate-950/60 p-2 text-slate-400 border border-slate-800">
              Recebidos
              <strong className="block text-sm text-white mt-0.5">{wallet?.totalReceived ?? 0}</strong>
            </div>
            <div className="rounded-xl bg-slate-950/60 p-2 text-slate-400 border border-slate-800">
              Bônus
              <strong className="block text-sm text-amber-300 mt-0.5">{wallet?.bonusBalance ?? 0}</strong>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => onNavigate('creditos')} className="froc-secondary flex-1">
              Extrato
            </button>
            <button onClick={() => onNavigate('planos')} className="froc-primary flex-1">
              Recarregar
            </button>
          </div>
        </section>

        <section className="froc-panel lg:col-span-2">
          <h3 className="froc-section-title mb-4">Ações Rápidas de Criação</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {quick.map(([label, Icon, tab, desc]) => (
              <button
                key={tab}
                onClick={() => onNavigate(tab)}
                className="group rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-left hover:border-cyan-500/40 hover:bg-slate-900/60 transition-all"
              >
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white group-hover:scale-105 transition-transform">
                  <Icon size={17} />
                </div>
                <div className="mt-3 text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
                  {label}
                </div>
                <div className="mt-1 text-[10px] text-slate-400">{desc}</div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Activation Track */}
      <section className="froc-panel">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="froc-section-title">Trilha de Ativação da Marca</h3>
            <p className="mt-1 text-xs text-slate-400">Progresso calculado automaticamente a partir dos seus dados reais.</p>
          </div>
          <span className="text-xs font-bold text-cyan-300 bg-cyan-950/60 border border-cyan-500/30 px-2.5 py-1 rounded-lg">
            {steps.filter((x) => x[1]).length} de {steps.length} concluídos
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {steps.map(([label, done, tab], i) => (
            <button
              key={label}
              onClick={() => onNavigate(tab)}
              className={`flex items-center justify-between rounded-2xl border p-3.5 text-left transition-all ${
                done
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-800 bg-slate-950/50 hover:border-slate-700 text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-black ${
                    done ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className="text-xs font-semibold">{label}</span>
              </div>
              <ArrowRight size={14} className={done ? 'text-emerald-400' : 'text-slate-500'} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};

