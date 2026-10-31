import React from 'react';
import { ArrowRight, Building2, Coins, Crown, FileText, FolderOpen, Image as ImageIcon, Mic, PenTool, Store, Video } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { DashboardBoost } from '../components/DashboardBoost';
import type { Company, ContentItem, User, Wallet } from '../types';

interface DashboardPageProps {
  user: User | null;
  wallet: Wallet | null;
  selectedCompany: Company | null;
  contentItems: ContentItem[];
  onNavigate: (tab: string) => void;
}

const PLAN_LABEL: Record<string, string> = { plan_free: 'Grátis', free: 'Grátis', plan_start: 'START', plan_pro: 'PRO', plan_business: 'BUSINESS', plan_agency: 'AGENCY' };

function contentIcon(type: ContentItem['type']) {
  if (type === 'image') return <ImageIcon size={15} className="text-[#FF2D87]" />;
  if (type === 'video' || type === 'video_script') return <Video size={15} className="text-[#FF2D87]" />;
  if (type === 'article') return <FileText size={15} className="text-[#00E676]" />;
  return <PenTool size={15} className="text-[#FFD400]" />;
}

/** Meu Painel: só o que está ativo — IA, créditos, marca, vitrine/post diário e criações. */
export const DashboardPage: React.FC<DashboardPageProps> = ({ user, wallet, selectedCompany, contentItems, onNavigate }) => {
  const balance = wallet ? wallet.balance : 0;
  const plan = PLAN_LABEL[wallet?.planId || 'plan_free'] || wallet?.planId || 'Grátis';
  const recent = contentItems.filter((item) => !selectedCompany || item.companyId === selectedCompany.id).slice(0, 4);
  const firstName = (user?.name || '').split(' ')[0];

  return (
    <div className="space-y-6 animate-fadeIn">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b0b] p-6 md:p-8">
        <div className="froc-aurora opacity-30" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <BrandLogo size="lg" showText={false} />
            <div>
              <h1 className="text-2xl font-black text-white md:text-3xl">Olá{firstName ? `, ${firstName}` : ''}! 👑</h1>
              <p className="mt-1 text-sm text-neutral-400">Fale com a Froc.IA por texto ou voz. Ela cria, publica e coloca sua marca no Google.</p>
            </div>
          </div>
          <button onClick={() => onNavigate('home')} className="froc-shimmer inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#FFD400] via-[#FF2D87] to-[#00E676] px-6 py-3 text-sm font-black text-black">
            <Mic size={16} /> Falar com a Froc.IA
          </button>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <button onClick={() => onNavigate('creditos')} className="rounded-3xl border border-white/10 bg-[#0b0b0b] p-5 text-left transition hover:border-[#FFD400]/50">
          <Coins size={18} className="text-[#FFD400]" />
          <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-neutral-500">Créditos</p>
          <p className="mt-1 text-3xl font-black text-white">{balance.toLocaleString('pt-BR')}</p>
          <p className="mt-1 text-[11px] text-neutral-500">Ver extrato</p>
        </button>
        <button onClick={() => onNavigate('planos')} className="rounded-3xl border border-white/10 bg-[#0b0b0b] p-5 text-left transition hover:border-[#FF2D87]/50">
          <Crown size={18} className="text-[#FF2D87]" />
          <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-neutral-500">Plano</p>
          <p className="mt-1 text-3xl font-black text-white">{plan}</p>
          <p className="mt-1 text-[11px] text-neutral-500">{wallet?.currentPeriodEnd ? `Renova em ${new Date(wallet.currentPeriodEnd).toLocaleDateString('pt-BR')}` : 'Ver planos'}</p>
        </button>
        <button onClick={() => onNavigate('empresa')} className="rounded-3xl border border-white/10 bg-[#0b0b0b] p-5 text-left transition hover:border-[#00E676]/50">
          <Building2 size={18} className="text-[#00E676]" />
          <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-neutral-500">Minha marca</p>
          <p className="mt-1 truncate text-xl font-black text-white">{selectedCompany?.name || 'Cadastrar marca'}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500">
            <Store size={11} /> {selectedCompany ? (selectedCompany.isPublicInVitrine ? 'Na Vitrine · post diário ativo' : 'Fora da Vitrine') : 'A IA cadastra para você'}
          </p>
        </button>
      </div>

      <DashboardBoost selectedCompany={selectedCompany} onNavigate={onNavigate} />

      <section className="rounded-3xl border border-white/10 bg-[#0b0b0b] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-black text-white"><FolderOpen size={16} className="text-[#FFD400]" /> Últimas criações</h2>
          <button onClick={() => onNavigate('conteudos')} className="inline-flex items-center gap-1 text-xs font-bold text-[#FFD400]">Ver todas <ArrowRight size={12} /></button>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-neutral-500">Nada criado ainda. Peça para a Froc.IA: “crie um anúncio com foto para o meu Instagram”.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {recent.map((item) => (
              <button key={item.id} onClick={() => onNavigate('conteudos')} className="flex items-start gap-3 rounded-2xl bg-white/[0.03] p-3 text-left hover:bg-white/[0.06]">
                {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-black">{contentIcon(item.type)}</span>}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{item.title || item.headline || 'Criação Froc.IA'}</span>
                  <span className="block truncate text-[11px] text-neutral-500">{new Date(item.createdAt).toLocaleDateString('pt-BR')} · {item.body?.slice(0, 80)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
