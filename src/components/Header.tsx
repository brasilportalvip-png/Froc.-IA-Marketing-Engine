import React, { useState } from 'react';
import {
  Bell,
  Coins,
  Building2,
  ChevronDown,
  LogOut,
  User as UserIcon,
  ShieldAlert,
  Sparkles,
  Plus
} from 'lucide-react';
import { User, Wallet, Company } from '../types';

interface HeaderProps {
  user: User | null;
  wallet: Wallet | null;
  companies: Company[];
  selectedCompany: Company | null;
  onSelectCompany: (company: Company) => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onNavigate: (tab: string) => void;
  isSidebarCollapsed: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  wallet,
  companies,
  selectedCompany,
  onSelectCompany,
  onOpenAuth,
  onLogout,
  onNavigate,
  isSidebarCollapsed
}) => {
  const [showCompanyMenu, setShowCompanyMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const planLabels: Record<string, string> = {
    plan_free: 'Conta Gratuita',
    plan_start: 'Plano START',
    plan_pro: 'Plano PRO ⭐',
    plan_business: 'Plano BUSINESS',
    plan_agency: 'Plano AGENCY 👑'
  };

  const currentPlanName = planLabels[wallet?.planId || 'plan_free'] || 'Conta Gratuita';

  return (
    <header
      className={`fixed top-0 right-0 h-16 bg-[#070B14]/85 backdrop-blur-xl border-b border-white/[0.08] z-20 flex items-center justify-between px-6 transition-all duration-300 ${
        isSidebarCollapsed ? 'left-20' : 'left-64'
      }`}
    >
      {/* Left Greeting & Company Selector */}
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-sm font-semibold text-white flex items-center gap-1.5">
            Olá, <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent font-bold">{user?.name ? user.name.split(' ')[0] : 'Empreendedor'}</span> 👋
          </h1>
          <p className="text-[11px] text-slate-400">Marketing Intelligence Center</p>
        </div>

        {/* Company Switcher Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowCompanyMenu(!showCompanyMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/80 hover:border-cyan-500/40 text-xs text-white transition-all shadow-sm"
          >
            <Building2 size={14} className="text-cyan-400" />
            <span className="max-w-[140px] truncate font-medium">
              {selectedCompany?.name || 'Selecione uma Empresa'}
            </span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>

          {showCompanyMenu && (
            <div className="absolute left-0 mt-2 w-64 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl p-1.5 z-50 animate-fadeIn">
              <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                Minhas Empresas
              </div>
              <div className="max-h-48 overflow-y-auto py-1 space-y-0.5 custom-scrollbar">
                {companies.map((comp) => (
                  <button
                    key={comp.id}
                    onClick={() => {
                      onSelectCompany(comp);
                      setShowCompanyMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                      selectedCompany?.id === comp.id
                        ? 'bg-blue-600/20 text-cyan-300 font-semibold border border-cyan-500/30'
                        : 'text-slate-300 hover:bg-slate-800/80'
                    }`}
                  >
                    <span className="truncate">{comp.name}</span>
                    <span className="text-[10px] text-slate-400">{comp.category}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  onNavigate('empresa');
                  setShowCompanyMenu(false);
                }}
                className="w-full mt-1 pt-2 border-t border-slate-800 px-3 py-2 text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 font-medium rounded-xl hover:bg-slate-800/50"
              >
                <Plus size={13} /> Cadastrar Nova Empresa
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Plano Atual Badge */}
        <div
          onClick={() => onNavigate('planos')}
          className="hidden md:flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-blue-950/80 to-slate-900 border border-blue-500/30 text-xs font-semibold text-cyan-300 cursor-pointer hover:border-cyan-400 hover:scale-105 transition-all shadow-sm"
        >
          <Sparkles size={13} className="text-amber-400" />
          <span>{currentPlanName}</span>
        </div>

        {/* Créditos Badge */}
        <div
          onClick={() => onNavigate('creditos')}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-amber-500/30 text-xs font-bold text-white cursor-pointer hover:border-amber-400 hover:scale-105 transition-all shadow-sm"
        >
          <Coins size={14} className="text-amber-400" />
          <span>{wallet?.balance ?? 0} <span className="text-[10px] text-amber-300 font-normal">créditos</span></span>
        </div>

        {/* Notificações Button */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-xl bg-[#1E293B] text-slate-300 hover:text-white border border-slate-700 hover:border-slate-600 transition-colors relative"
            title="Notificações"
          >
            <Bell size={17} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500"></span>
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-[#1E293B] border border-slate-700 rounded-2xl shadow-2xl p-3 z-50">
              <div className="flex items-center justify-between pb-2 border-b border-slate-700">
                <span className="text-xs font-bold text-white">Notificações do Sistema</span>
                <span className="text-[10px] text-slate-400">Em tempo real</span>
              </div>
              <div className="py-2 text-xs text-slate-300 space-y-2">
                <div className="p-2 rounded-xl bg-[#0F172A] border border-slate-800">
                  <p className="font-semibold text-cyan-300 text-xs">Froc Autopilot Operacional 🚀</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    O motor de inteligência artificial está pronto para criar campanhas e postagens para suas marcas.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Account Button or Login Trigger */}
        {user ? (
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 p-1.5 rounded-xl bg-[#1E293B] border border-slate-700 hover:border-slate-500 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-cyan-500 text-white flex items-center justify-center font-bold text-xs">
                {user.name ? user.name[0].toUpperCase() : 'U'}
              </div>
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-[#1E293B] border border-slate-700 rounded-2xl shadow-2xl p-2 z-50">
                <div className="px-3 py-2 border-b border-slate-700/80">
                  <p className="text-xs font-bold text-white truncate">{user.name}</p>
                  <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                  {user.role === 'admin' && (
                    <span className="inline-block mt-1 text-[10px] uppercase font-extrabold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Administrador
                    </span>
                  )}
                </div>

                <div className="py-1 space-y-0.5">
                  <button
                    onClick={() => {
                      onNavigate('perfil');
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800 flex items-center gap-2"
                  >
                    <UserIcon size={14} /> Meu Perfil
                  </button>
                  {user.role === 'admin' && (
                    <button
                      onClick={() => {
                        onNavigate('admin');
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs text-amber-300 hover:bg-amber-950/40 flex items-center gap-2 font-medium"
                    >
                      <ShieldAlert size={14} /> Painel Administrativo
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onLogout();
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-rose-400 hover:bg-rose-950/30 flex items-center gap-2 font-medium"
                  >
                    <LogOut size={14} /> Sair da Conta
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-xs font-bold shadow-lg shadow-blue-600/20 hover:opacity-90 transition-opacity"
          >
            Entrar / Cadastrar
          </button>
        )}
      </div>
    </header>
  );
};
