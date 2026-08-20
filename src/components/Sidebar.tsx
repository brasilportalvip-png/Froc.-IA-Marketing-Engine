import React from 'react';
import {
  LayoutDashboard,
  Building2,
  Sparkles,
  PenTool,
  Image as ImageIcon,
  Video,
  FileText,
  Search,
  Compass,
  Megaphone,
  Calendar,
  Share2,
  FolderOpen,
  BarChart3,
  Coins,
  CreditCard,
  User,
  Settings,
  HelpCircle,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Bot,
  Store
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { BRAND } from '../lib/brand';
import { Company, User as UserType, Wallet } from '../types';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  user: UserType | null;
  wallet: Wallet | null;
  selectedCompany?: Company | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isAdmin: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  user,
  wallet,
  selectedCompany,
  isCollapsed,
  onToggleCollapse,
  isAdmin
}) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'empresa', label: 'Minha Empresa', icon: Building2 },
    { id: 'vitrine', label: 'Vitrine', icon: Store },
    { id: 'froc-ia', label: 'Froc IA', icon: Sparkles, badge: 'Central' },
    { id: 'criar-conteudo', label: 'Criar Conteúdo', icon: PenTool },
    { id: 'criar-imagem', label: 'Criar Imagem', icon: ImageIcon },
    { id: 'criar-video', label: 'Criar Vídeo', icon: Video },
    { id: 'criar-artigo', label: 'Criar Artigo', icon: FileText },
    { id: 'seo', label: 'SEO Inteligente', icon: Search },
    { id: 'estrategia', label: 'Estratégia', icon: Compass },
    { id: 'campanhas', label: 'Campanhas', icon: Megaphone },
    { id: 'calendario', label: 'Calendário', icon: Calendar },
    { id: 'redes-sociais', label: 'Redes Sociais', icon: Share2 },
    { id: 'conteudos', label: 'Conteúdos', icon: FolderOpen },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'creditos', label: 'Créditos', icon: Coins },
    { id: 'planos', label: 'Planos e Pagamentos', icon: CreditCard },
    { id: 'perfil', label: 'Perfil', icon: User },
    { id: 'suporte', label: 'Suporte', icon: HelpCircle }
  ];

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-[#080D1A]/95 backdrop-blur-xl border-r border-white/[0.08] flex flex-col z-30 transition-all duration-300 ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Top Header & Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-white/[0.08] bg-[#070B14]/80 backdrop-blur-md">
        <div
          className="flex items-center gap-3 cursor-pointer overflow-hidden"
          onClick={() => onSelectTab('dashboard')}
        >
          <BrandLogo size="md" showText={!isCollapsed} />
        </div>

        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors shrink-0"
          title={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation Links (Scrollable) */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-1 custom-scrollbar">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-blue-600/20 to-cyan-500/10 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/50 hover:border-slate-700/50 border border-transparent'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon size={18} className={isActive ? 'text-cyan-400' : 'text-slate-400'} />
              {!isCollapsed && (
                <span className="flex-1 text-left truncate tracking-tight">{item.label}</span>
              )}
              {!isCollapsed && item.badge && (
                <span className="text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Item exclusivo de Administrador */}
        {isAdmin && (
          <div className="pt-2 mt-2 border-t border-slate-800">
            <button
              onClick={() => onSelectTab('admin')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                currentTab === 'admin'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-amber-400/90 hover:text-amber-300 hover:bg-amber-950/20 border border-transparent'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
              title="Painel Administrativo"
            >
              <ShieldAlert size={18} className="text-amber-400" />
              {!isCollapsed && <span>Painel Admin</span>}
            </button>
          </div>
        )}
      </div>

      {/* Bottom User & Credits Footer */}
      <div className="p-3 border-t border-white/[0.08] bg-[#070B14]/80 backdrop-blur-md space-y-2">
        {!isCollapsed && (
          <>
            {/* Saldo de Créditos */}
            <div
              onClick={() => onSelectTab('creditos')}
              className="p-2.5 rounded-xl bg-gradient-to-r from-blue-950/60 to-slate-900/80 border border-blue-500/25 hover:border-cyan-500/50 cursor-pointer transition-all flex items-center justify-between shadow-sm"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Coins size={14} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400">Seus Créditos</span>
                  <span className="text-xs font-black text-white">
                    {wallet?.balance ?? 0} <span className="text-[10px] text-amber-400 font-normal">pts</span>
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTab('planos');
                }}
                className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 hover:opacity-90 text-white transition-opacity shadow-sm"
              >
                Recarregar
              </button>
            </div>

            {/* Autopilot Status Indicator */}
            {(() => {
              const plan = wallet?.planId || 'free';
              const isFree = plan === 'free' || plan === 'plan_free' || !wallet?.planId;
              return (
                <div
                  onClick={() => onSelectTab('autopilot')}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs cursor-pointer hover:border-slate-700 transition-colors"
                >
                  <span className="text-[11px] text-slate-300 flex items-center gap-1.5">
                    <Bot size={13} className="text-cyan-400" /> Froc Autopilot
                  </span>
                  {isFree ? (
                    <span className="text-[10px] text-slate-500 font-medium">
                      Bloqueado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-cyan-400 font-medium">
                      Configurar
                    </span>
                  )}
                </div>
              );
            })()}
          </>
        )}

        {/* User Card */}
        <div className="flex items-center gap-2.5 pt-1">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-600 border border-cyan-400/40 flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
            {user?.name ? user.name[0].toUpperCase() : 'U'}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-xs font-bold text-white truncate">
                {user?.name || 'Visitante'}
              </span>
              <span className="text-[10px] text-slate-400 truncate">
                {user?.email || 'Faça login para salvar'}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
