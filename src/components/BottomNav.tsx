import React from 'react';
import { Bot, CalendarDays, Home, PlusCircle, UserRound } from 'lucide-react';

interface Props { currentTab: string; onNavigate: (tab: string) => void; }
const items = [
  { tab: 'dashboard', label: 'Início', icon: Home },
  { tab: 'criar-conteudo', label: 'Criar', icon: PlusCircle },
  { tab: 'froc-ia', label: 'Froc IA', icon: Bot },
  { tab: 'calendario', label: 'Agenda', icon: CalendarDays },
  { tab: 'perfil', label: 'Conta', icon: UserRound }
];

export const BottomNav: React.FC<Props> = ({ currentTab, onNavigate }) => (
  <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800/90 bg-[#0B0F19]/95 px-[max(10px,env(safe-area-inset-left))] pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden" aria-label="Navegação principal">
    <div className="mx-auto grid max-w-xl grid-cols-5 gap-1">
      {items.map(({ tab, label, icon: Icon }) => {
        const active = currentTab === tab || (tab === 'froc-ia' && currentTab === 'estrategia');
        return <button key={tab} onClick={() => onNavigate(tab)} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition ${active ? 'bg-cyan-500/12 text-cyan-300' : 'text-slate-400 hover:bg-slate-800/70 hover:text-white'}`} aria-current={active ? 'page' : undefined}><Icon size={18}/><span>{label}</span></button>;
      })}
    </div>
  </nav>
);
