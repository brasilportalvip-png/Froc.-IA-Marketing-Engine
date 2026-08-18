import React from 'react';
import { Coins, Menu, X } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import type { User, Wallet } from '../types';

interface Props { user: User | null; wallet: Wallet | null; menuOpen: boolean; onToggleMenu: () => void; onOpenAuth: () => void; onNavigate: (tab: string) => void; }
export const MobileTopBar: React.FC<Props> = ({ user, wallet, menuOpen, onToggleMenu, onOpenAuth, onNavigate }) => (
  <header className="fixed inset-x-0 top-0 z-50 flex h-[calc(58px+env(safe-area-inset-top))] items-end border-b border-slate-800/80 bg-[#0B0F19]/95 px-3 pb-2 backdrop-blur-xl lg:hidden">
    <div className="flex w-full items-center justify-between gap-3">
      <button onClick={onToggleMenu} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-800 bg-slate-900 text-slate-200" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
      <button onClick={() => onNavigate('dashboard')} className="min-w-0 flex-1 text-left">
        <BrandLogo size="sm" showText={true} subtitle="Marketing Intelligence" />
      </button>
      {user ? <button onClick={() => onNavigate('creditos')} className="flex h-10 items-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 text-xs font-bold text-amber-300"><Coins size={15}/>{wallet?.balance ?? 0}</button> : <button onClick={onOpenAuth} className="froc-primary text-xs px-3.5 py-2">Entrar</button>}
    </div>
  </header>
);
