import React from 'react';
import { Building2, Coins, FolderOpen, HelpCircle, LayoutDashboard, Settings, ShieldCheck, Sparkles, Store, Newspaper, X } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import type { User } from '../types';
interface Props { open:boolean; currentTab:string; user:User|null; isAdmin:boolean; onClose:()=>void; onNavigate:(tab:string)=>void; }
// Ferramentas ficam escondidas: o Froc.IA executa tudo pela conversa.
const items = [
  ['home','Falar com o Froc.IA',Sparkles],['vitrine','Vitrine',Store],['posts','Posts',Newspaper],['dashboard','Meu Painel',LayoutDashboard],['empresa','Minha Marca',Building2],['conteudos','Minhas Criações',FolderOpen],['creditos','Créditos',Coins],['planos','Planos',Settings],['perfil','Perfil',Settings],['suporte','Suporte',HelpCircle]
] as const;
export const MobileDrawer:React.FC<Props>=({open,currentTab,isAdmin,onClose,onNavigate})=>{
  if(!open)return null;
  const go=(tab:string)=>{onNavigate(tab);onClose()};
  return <div className="fixed inset-0 z-[60] lg:hidden"><button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Fechar menu"/><aside className="absolute bottom-0 left-0 top-0 w-[min(88vw,340px)] overflow-y-auto border-r border-slate-800 bg-[#050505] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-[#050505]/95 p-4 backdrop-blur"><BrandLogo size="sm" showText={true} subtitle="Menu Completo" /><button onClick={onClose} className="rounded-xl border border-slate-800 p-2 text-slate-300 hover:text-white"><X size={18}/></button></div><nav className="space-y-1 p-3">{items.map(([tab,label,Icon])=><button key={tab} onClick={()=>go(tab)} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-semibold ${currentTab===tab?'bg-cyan-500/12 text-cyan-300 border border-cyan-500/30':'text-slate-300 hover:bg-slate-800'}`}><Icon size={17}/>{label}</button>)}{isAdmin&&<button onClick={()=>go('admin')} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-semibold ${currentTab==='admin'?'bg-rose-500/10 text-rose-300 border border-rose-500/30':'text-slate-300 hover:bg-slate-800'}`}><ShieldCheck size={17}/>Administração</button>}</nav></aside></div>;
};
