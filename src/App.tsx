import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { AuthModal } from './components/AuthModal';
import { BottomNav } from './components/BottomNav';
import { MobileTopBar } from './components/MobileTopBar';
import { MobileDrawer } from './components/MobileDrawer';
import { OfflineBanner } from './components/OfflineBanner';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { DashboardPage } from './pages/DashboardPage';
import { MyCompanyPage } from './pages/MyCompanyPage';
import { FrocIaPage } from './pages/FrocIaPage';
import { CreateContentPage } from './pages/CreateContentPage';
import { CreateImagePage } from './pages/CreateImagePage';
import { CreateVideoPage } from './pages/CreateVideoPage';
import { CreateArticlePage } from './pages/CreateArticlePage';
import { SeoPage } from './pages/SeoPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CalendarPage } from './pages/CalendarPage';
import { SocialNetworksPage } from './pages/SocialNetworksPage';
import { AutopilotPage } from './pages/AutopilotPage';
import { PlansPage } from './pages/PlansPage';
import { CreditsPage } from './pages/CreditsPage';
import { VitrinePage } from './pages/VitrinePage';
import { ContentsLibraryPage } from './pages/ContentsLibraryPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SupportPage } from './pages/SupportPage';
import { AdminPage } from './pages/AdminPage';
import { LegalPage } from './pages/LegalPage';
import { LandingPage } from './pages/LandingPage';
import type { Campaign, Company, ContentItem, ScheduledPost, User, Wallet } from './types';
import { apiRequest } from './lib/api';
import { auth } from './lib/firebase';

const TAB_PATH: Record<string,string> = {
  home:'/', dashboard:'/dashboard', empresa:'/empresa', vitrine:'/vitrine', 'froc-ia':'/froc-ia', estrategia:'/froc-ia', autopilot:'/autopilot',
  'criar-conteudo':'/criar-conteudo','criar-imagem':'/criar-imagem','criar-video':'/criar-video','criar-artigo':'/criar-artigo',seo:'/seo',campanhas:'/campanhas',calendario:'/calendario','redes-sociais':'/redes-sociais',conteudos:'/conteudos',analytics:'/analytics',planos:'/planos',creditos:'/creditos',perfil:'/perfil',configuracoes:'/perfil',suporte:'/suporte',admin:'/admin'
};
function tabFromPath(path:string):string {
  const clean = path.replace(/\/+$/,'') || '/';
  const match = Object.entries(TAB_PATH).find(([,value])=>value===clean);
  if(match)return match[0];
  if(clean.startsWith('/vitrine/'))return 'vitrine';
  if(clean.startsWith('/blog'))return 'vitrine';
  if(clean==='/termos'||clean==='/privacidade')return 'legal';
  return clean==='/'?'home':'dashboard';
}

export default function App(){
  const [user,setUser]=useState<User|null>(null); const [wallet,setWallet]=useState<Wallet|null>(null); const [companies,setCompanies]=useState<Company[]>([]); const [selectedCompany,setSelectedCompany]=useState<Company|null>(null); const [campaigns,setCampaigns]=useState<Campaign[]>([]); const [scheduledPosts,setScheduledPosts]=useState<ScheduledPost[]>([]); const [contentItems,setContentItems]=useState<ContentItem[]>([]);
  const [currentTab,setCurrentTab]=useState(()=>tabFromPath(window.location.pathname)); const [sidebarCollapsed,setSidebarCollapsed]=useState(false); const [authOpen,setAuthOpen]=useState(false); const [loading,setLoading]=useState(true); const [mobileMenu,setMobileMenu]=useState(false);

  const navigate=useCallback((tab:string)=>{ const normalized=TAB_PATH[tab]?tab:'dashboard'; setCurrentTab(normalized); const path=TAB_PATH[normalized]||'/dashboard'; if(window.location.pathname!==path) window.history.pushState({tab:normalized},'',path); window.scrollTo({top:0,behavior:'smooth'}); },[]);
  useEffect(()=>{ const onPop=()=>setCurrentTab(tabFromPath(window.location.pathname)); window.addEventListener('popstate',onPop); return()=>window.removeEventListener('popstate',onPop); },[]);

  const refreshWallet=useCallback(async()=>{ if(!auth.currentUser)return; try{const d=await apiRequest<{wallet:Wallet}>('/api/credits/balance');setWallet(d.wallet)}catch(e){console.error('Carteira',e)} },[]);
  const refreshCompanies=useCallback(async()=>{ if(!auth.currentUser)return; try{const d=await apiRequest<{companies:Company[]}>('/api/companies');setCompanies(d.companies||[]);setSelectedCompany(prev=>{if(!d.companies?.length)return null;if(prev){const same=d.companies.find(c=>c.id===prev.id);if(same)return same}return d.companies[0]})}catch(e){console.error('Empresas',e)} },[]);
  const refreshCampaigns=useCallback(async()=>{if(!auth.currentUser)return;try{const d=await apiRequest<{campaigns:Campaign[]}>('/api/campaigns');setCampaigns(d.campaigns||[])}catch(e){console.error('Campanhas',e)}},[]);
  const refreshContents=useCallback(async()=>{if(!auth.currentUser)return;try{const d=await apiRequest<{contents?:ContentItem[];items?:ContentItem[]}>('/api/content');setContentItems(d.contents||d.items||[])}catch(e){console.error('Conteúdos',e)}},[]);
  const refreshSchedule=useCallback(async()=>{if(!auth.currentUser)return;try{const d=await apiRequest<{scheduledPosts?:ScheduledPost[];scheduled?:ScheduledPost[]}>('/api/content/scheduled');setScheduledPosts(d.scheduledPosts||d.scheduled||[])}catch(e){console.error('Agenda',e)}},[]);

  const loadSession=useCallback(async()=>{if(!auth.currentUser){setUser(null);setWallet(null);setCompanies([]);setSelectedCompany(null);setCampaigns([]);setScheduledPosts([]);setContentItems([]);return}const d=await apiRequest<{user:User;wallet:Wallet}>('/api/auth/me');setUser(d.user);setWallet(d.wallet);await Promise.all([refreshCompanies(),refreshCampaigns(),refreshContents(),refreshSchedule()]);},[refreshCampaigns,refreshCompanies,refreshContents,refreshSchedule]);
  useEffect(()=>onAuthStateChanged(auth,async(firebaseUser)=>{setLoading(true);try{if(firebaseUser)await loadSession();else{setUser(null);setWallet(null);setCompanies([]);setSelectedCompany(null);setCampaigns([]);setScheduledPosts([]);setContentItems([])}}catch(e){console.warn('Sessão',e)}finally{setLoading(false)}}),[loadSession]);

  const authSuccess=async(loggedUser:User,loggedWallet:Wallet)=>{setUser(loggedUser);setWallet(loggedWallet);setAuthOpen(false);await Promise.all([refreshCompanies(),refreshCampaigns(),refreshContents(),refreshSchedule()])};
  const logout=async()=>{await signOut(auth);navigate('dashboard')};
  const isAdmin=user?.role==='admin';

  const content=useMemo(()=>{switch(currentTab){
    case'home':return <LandingPage authenticated={Boolean(user)} onOpenAuth={()=>setAuthOpen(true)} onNavigate={navigate}/>;
    case'dashboard':return <DashboardPage user={user} wallet={wallet} selectedCompany={selectedCompany} campaigns={campaigns} scheduledPosts={scheduledPosts} onNavigate={navigate} onOpenAuth={()=>setAuthOpen(true)}/>;
    case'empresa':return <MyCompanyPage selectedCompany={selectedCompany} companies={companies} onSelectCompany={setSelectedCompany} onRefreshCompanies={refreshCompanies}/>;
    case'vitrine':return <VitrinePage onNavigate={navigate}/>;
    case'froc-ia':case'estrategia':return <FrocIaPage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
    case'autopilot':return <AutopilotPage selectedCompany={selectedCompany} onNavigate={navigate}/>;
    case'criar-conteudo':return <CreateContentPage companies={companies} selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
    case'criar-imagem':return <CreateImagePage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
    case'criar-video':return <CreateVideoPage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
    case'criar-artigo':return <CreateArticlePage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
    case'seo':return <SeoPage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet}/>;
    case'campanhas':return <CampaignsPage campaigns={campaigns} selectedCompany={selectedCompany} onRefreshCampaigns={refreshCampaigns} onNavigate={navigate}/>;
    case'calendario':return <CalendarPage scheduledPosts={scheduledPosts} contentItems={contentItems} selectedCompany={selectedCompany} onRefreshSchedule={refreshSchedule} onNavigate={navigate}/>;
    case'redes-sociais':return <SocialNetworksPage selectedCompany={selectedCompany} onNavigate={navigate}/>;
    case'conteudos':return <ContentsLibraryPage contentItems={contentItems} selectedCompany={selectedCompany} onRefreshContents={refreshContents} onNavigate={navigate}/>;
    case'analytics':return <AnalyticsPage selectedCompany={selectedCompany} wallet={wallet} campaigns={campaigns} scheduledPosts={scheduledPosts} onNavigate={navigate}/>;
    case'planos':return <PlansPage wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
    case'creditos':return <CreditsPage wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
    case'perfil':case'configuracoes':return <ProfilePage user={user} wallet={wallet} onRefreshUser={loadSession} onNavigate={navigate}/>;
    case'suporte':return <SupportPage onNavigate={navigate}/>;
    case'legal':return <LegalPage/>;
    case'admin':return isAdmin?<AdminPage onNavigate={navigate}/>:<DashboardPage user={user} wallet={wallet} selectedCompany={selectedCompany} campaigns={campaigns} scheduledPosts={scheduledPosts} onNavigate={navigate} onOpenAuth={()=>setAuthOpen(true)}/>;
    default:return <DashboardPage user={user} wallet={wallet} selectedCompany={selectedCompany} campaigns={campaigns} scheduledPosts={scheduledPosts} onNavigate={navigate} onOpenAuth={()=>setAuthOpen(true)}/>;
  }},[currentTab,user,wallet,selectedCompany,companies,campaigns,scheduledPosts,contentItems,isAdmin,navigate,refreshWallet,refreshCompanies,refreshCampaigns,refreshContents,refreshSchedule,loadSession]);

  if(currentTab==='home') return <><OfflineBanner/><PwaInstallPrompt/>{content}<AuthModal isOpen={authOpen} onClose={()=>setAuthOpen(false)} onSuccess={authSuccess}/></>;

  return <div className="min-h-[100dvh] bg-[#0B0F19] text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
    <OfflineBanner/><PwaInstallPrompt/>
    <div className="hidden lg:block"><Sidebar currentTab={currentTab} onSelectTab={navigate} user={user} wallet={wallet} isCollapsed={sidebarCollapsed} onToggleCollapse={()=>setSidebarCollapsed(v=>!v)} isAdmin={Boolean(isAdmin)}/><Header user={user} wallet={wallet} companies={companies} selectedCompany={selectedCompany} onSelectCompany={setSelectedCompany} onOpenAuth={()=>setAuthOpen(true)} onLogout={logout} onNavigate={navigate} isSidebarCollapsed={sidebarCollapsed}/></div>
    <MobileTopBar user={user} wallet={wallet} menuOpen={mobileMenu} onToggleMenu={()=>setMobileMenu(v=>!v)} onOpenAuth={()=>setAuthOpen(true)} onNavigate={navigate}/><MobileDrawer open={mobileMenu} currentTab={currentTab} user={user} isAdmin={Boolean(isAdmin)} onClose={()=>setMobileMenu(false)} onNavigate={navigate}/>
    <div className={`min-h-[100dvh] transition-[margin] duration-300 ${sidebarCollapsed?'lg:ml-20':'lg:ml-64'}`}><main className="mx-auto w-full max-w-[1600px] px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-[calc(72px+env(safe-area-inset-top))] sm:px-5 lg:px-8 lg:pb-10 lg:pt-24">{loading?<div className="grid min-h-[60vh] place-items-center"><div className="text-center"><span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-400"/><p className="mt-3 text-xs text-slate-400">Carregando Froc.IA…</p></div></div>:content}</main></div>
    <BottomNav currentTab={currentTab} onNavigate={navigate}/><AuthModal isOpen={authOpen} onClose={()=>setAuthOpen(false)} onSuccess={authSuccess}/>
  </div>;
}
