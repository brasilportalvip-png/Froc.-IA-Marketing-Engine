import React from 'react';
import { Crown, LayoutDashboard, LogIn, Newspaper, Sparkles, Store } from 'lucide-react';
import type { User, Wallet } from '../types';
import { BrandLogo } from './BrandLogo';

interface Props {
  user: User | null;
  wallet: Wallet | null;
  current: 'home' | 'vitrine' | 'posts';
  onNavigate: (tab: string) => void;
  onOpenAuth: () => void;
}

export const PublicTopBar: React.FC<Props> = ({ user, wallet, current, onNavigate, onOpenAuth }) => {
  const link = (tab: 'home' | 'vitrine' | 'posts', label: string, Icon: typeof Sparkles) => (
    <button
      onClick={() => {
        onNavigate(tab);
        // Garante que a vitrine volte para a listagem mesmo quando já estamos numa subpágina dela.
        if (tab === 'vitrine') window.dispatchEvent(new PopStateEvent('popstate'));
      }}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-bold transition sm:px-3 ${current === tab ? 'bg-white text-black' : 'text-neutral-300 hover:bg-white/10 hover:text-white'}`}
    >
      <Icon size={14} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/[0.06] bg-black/60 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-3 px-4">
        <button onClick={() => onNavigate('home')} className="shrink-0" aria-label="Froc.IA início">
          <span className="sm:hidden"><BrandLogo size="md" showText={false} /></span>
          <span className="hidden sm:block"><BrandLogo size="md" showText subtitle="Rei do Orgânico" /></span>
        </button>
        <nav className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {link('home', 'Falar com o Froc.IA', Sparkles)}
          {link('vitrine', 'Vitrine', Store)}
          {link('posts', 'Posts', Newspaper)}
          <button onClick={() => onNavigate('planos')} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-neutral-300 hover:bg-white/10 hover:text-white">
            <Crown size={14} />
            <span className="hidden sm:inline">Planos</span>
          </button>
        </nav>
        {user ? (
          <div className="flex items-center gap-2">
            {wallet && (
              <span className="hidden rounded-full border border-[#FFD400]/30 bg-[#FFD400]/10 px-3 py-1.5 text-[11px] font-black text-[#FFD400] md:inline">
                {(wallet.balance + (wallet.bonusBalance || 0)).toLocaleString('pt-BR')} créditos
              </span>
            )}
            <button onClick={() => onNavigate('dashboard')} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-black text-black hover:bg-[#FFD400]">
              <LayoutDashboard size={14} />
              <span className="hidden sm:inline">Meu painel</span>
            </button>
          </div>
        ) : (
          <button onClick={onOpenAuth} className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#FF2D87] to-[#FFD400] px-4 py-2 text-xs font-black text-black shadow-[0_0_24px_rgba(255,45,135,.35)]">
            <LogIn size={14} />
            Entrar
          </button>
        )}
      </div>
    </header>
  );
};
