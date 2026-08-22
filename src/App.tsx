import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { AuthModal } from './components/AuthModal';
import { TermsConsentModal } from './components/TermsConsentModal';
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
import { ApiRequestError, apiRequest, isApiAbortError } from './lib/api';
import { auth } from './lib/firebase';

const TAB_PATH: Record<string, string> = {
  home: '/',
  dashboard: '/dashboard',
  empresa: '/empresa',
  vitrine: '/vitrine',
  'froc-ia': '/froc-ia',
  autopilot: '/autopilot',
  'criar-conteudo': '/criar-conteudo',
  'criar-imagem': '/criar-imagem',
  'criar-video': '/criar-video',
  'criar-artigo': '/criar-artigo',
  seo: '/seo',
  campanhas: '/campanhas',
  calendario: '/calendario',
  'redes-sociais': '/redes-sociais',
  conteudos: '/conteudos',
  analytics: '/analytics',
  planos: '/planos',
  creditos: '/creditos',
  perfil: '/perfil',
  suporte: '/suporte',
  admin: '/admin'
};

const TAB_ALIASES: Record<string, string> = {
  estrategia: 'froc-ia',
  configuracoes: 'perfil',
  redes: 'redes-sociais'
};

const PUBLIC_TABS = new Set(['home', 'vitrine', 'planos', 'legal']);

interface RouteResolution {
  tab: string;
  canonicalPath: string;
  known: boolean;
}

function canonicalTab(value: string): string {
  const clean = String(value || '').trim();
  return TAB_ALIASES[clean] || clean;
}

function routeFromPath(path: string): RouteResolution {
  const clean = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const match = Object.entries(TAB_PATH).find(([, value]) => value === clean);
  if (match) return { tab: match[0], canonicalPath: clean, known: true };
  if (clean.startsWith('/vitrine/')) return { tab: 'vitrine', canonicalPath: clean, known: true };
  if (clean === '/blog' || clean.startsWith('/blog/')) return { tab: 'vitrine', canonicalPath: clean, known: true };
  if (clean === '/termos' || clean === '/privacidade') return { tab: 'legal', canonicalPath: clean, known: true };
  return { tab: 'home', canonicalPath: '/', known: false };
}

function isPrivateTab(tab: string): boolean {
  return !PUBLIC_TABS.has(tab);
}

export default function App() {
  const initialRoute = routeFromPath(window.location.pathname);
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [currentTab, setCurrentTab] = useState(initialRoute.tab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileMenu, setMobileMenu] = useState(false);

  const mountedRef = useRef(true);
  const sessionEpochRef = useRef(0);
  const tenantEpochRef = useRef(0);
  const sessionControllerRef = useRef<AbortController | null>(null);
  const tenantControllerRef = useRef<AbortController | null>(null);
  const selectedCompanyRef = useRef<Company | null>(null);
  const pendingTabRef = useRef<string | null>(
    initialRoute.known && isPrivateTab(initialRoute.tab) ? initialRoute.tab : null
  );

  const isAdmin = user?.role === 'admin';

  const canCommit = useCallback((uid: string, signal?: AbortSignal): boolean => {
    return Boolean(
      mountedRef.current &&
      !signal?.aborted &&
      auth.currentUser?.uid === uid
    );
  }, []);

  const reportLoadFailure = useCallback((area: string, error: unknown) => {
    if (isApiAbortError(error)) return;
    const diagnostic = error instanceof ApiRequestError
      ? { status: error.status, requestId: error.requestId }
      : { type: error instanceof Error ? error.name : 'UnknownError' };
    console.warn(`[Froc App] ${area} temporariamente indisponível.`, diagnostic);
  }, []);

  const resetSessionState = useCallback(() => {
    tenantControllerRef.current?.abort();
    tenantControllerRef.current = null;
    tenantEpochRef.current += 1;
    selectedCompanyRef.current = null;
    setUser(null);
    setWallet(null);
    setCompanies([]);
    setSelectedCompany(null);
    setCampaigns([]);
    setScheduledPosts([]);
    setContentItems([]);
  }, []);

  const commitNavigation = useCallback((tab: string, mode: 'push' | 'replace' = 'push') => {
    const normalized = canonicalTab(tab);
    const target = TAB_PATH[normalized] ? normalized : 'home';
    const path = TAB_PATH[target] || '/';
    setCurrentTab(target);
    setMobileMenu(false);

    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== path) {
      if (mode === 'replace') window.history.replaceState({ tab: target }, '', path);
      else window.history.pushState({ tab: target }, '', path);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigate = useCallback((requestedTab: string) => {
    let target = canonicalTab(requestedTab);
    if (!TAB_PATH[target]) target = 'home';

    if (target === 'admin' && user && user.role !== 'admin') {
      target = 'dashboard';
    }

    if (!loading && !user && isPrivateTab(target)) {
      pendingTabRef.current = target;
      setAuthOpen(true);
      commitNavigation('home');
      return;
    }

    commitNavigation(target);
  }, [commitNavigation, loading, user]);

  const syncRouteFromLocation = useCallback(() => {
    const route = routeFromPath(window.location.pathname);
    if (!route.known) {
      pendingTabRef.current = null;
      commitNavigation('home', 'replace');
      return;
    }

    if (window.location.pathname !== route.canonicalPath) {
      window.history.replaceState(
        { tab: route.tab },
        '',
        `${route.canonicalPath}${window.location.search}${window.location.hash}`
      );
    }

    if (!loading && !user && isPrivateTab(route.tab)) {
      pendingTabRef.current = route.tab;
      setAuthOpen(true);
      commitNavigation('home', 'replace');
      return;
    }

    if (!loading && route.tab === 'admin' && user?.role !== 'admin') {
      commitNavigation(user ? 'dashboard' : 'home', 'replace');
      return;
    }

    setCurrentTab(route.tab);
    setMobileMenu(false);
  }, [commitNavigation, loading, user]);

  useEffect(() => {
    const onPopState = () => syncRouteFromLocation();
    window.addEventListener('popstate', onPopState);
    syncRouteFromLocation();
    return () => window.removeEventListener('popstate', onPopState);
  }, [syncRouteFromLocation]);

  const refreshWallet = useCallback(async (signal?: AbortSignal) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const data = await apiRequest<{ wallet: Wallet }>('/api/credits/balance', { signal });
      if (canCommit(uid, signal)) setWallet(data.wallet);
    } catch (error) {
      reportLoadFailure('Carteira', error);
    }
  }, [canCommit, reportLoadFailure]);

  const refreshCampaigns = useCallback(async (
    signal: AbortSignal | undefined = tenantControllerRef.current?.signal,
    companyId: string | undefined = selectedCompanyRef.current?.id
  ) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !companyId) {
      if (mountedRef.current) setCampaigns([]);
      return;
    }
    try {
      const data = await apiRequest<{ campaigns: Campaign[] }>(
        `/api/campaigns?companyId=${encodeURIComponent(companyId)}`,
        { signal }
      );
      if (canCommit(uid, signal) && selectedCompanyRef.current?.id === companyId) {
        setCampaigns(data.campaigns || []);
      }
    } catch (error) {
      reportLoadFailure('Campanhas', error);
    }
  }, [canCommit, reportLoadFailure]);

  const refreshContents = useCallback(async (
    signal: AbortSignal | undefined = tenantControllerRef.current?.signal,
    companyId: string | undefined = selectedCompanyRef.current?.id
  ) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !companyId) {
      if (mountedRef.current) setContentItems([]);
      return;
    }
    try {
      const data = await apiRequest<{ contents?: ContentItem[]; items?: ContentItem[] }>(
        `/api/content?companyId=${encodeURIComponent(companyId)}`,
        { signal }
      );
      if (canCommit(uid, signal) && selectedCompanyRef.current?.id === companyId) {
        setContentItems(data.contents || data.items || []);
      }
    } catch (error) {
      reportLoadFailure('Conteúdos', error);
    }
  }, [canCommit, reportLoadFailure]);

  const refreshSchedule = useCallback(async (
    signal: AbortSignal | undefined = tenantControllerRef.current?.signal,
    companyId: string | undefined = selectedCompanyRef.current?.id
  ) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !companyId) {
      if (mountedRef.current) setScheduledPosts([]);
      return;
    }
    try {
      const data = await apiRequest<{ scheduledPosts?: ScheduledPost[]; scheduled?: ScheduledPost[] }>(
        `/api/content/scheduled?companyId=${encodeURIComponent(companyId)}`,
        { signal }
      );
      if (canCommit(uid, signal) && selectedCompanyRef.current?.id === companyId) {
        setScheduledPosts(data.scheduledPosts || data.scheduled || []);
      }
    } catch (error) {
      reportLoadFailure('Agenda', error);
    }
  }, [canCommit, reportLoadFailure]);

  const handleSelectCompany = useCallback(async (company: Company | null) => {
    tenantControllerRef.current?.abort();
    const tenantEpoch = ++tenantEpochRef.current;
    const controller = new AbortController();
    tenantControllerRef.current = controller;
    selectedCompanyRef.current = company;
    setSelectedCompany(company);
    setCampaigns([]);
    setScheduledPosts([]);
    setContentItems([]);

    const uid = auth.currentUser?.uid;
    if (!company || !uid) return;

    await Promise.all([
      refreshCampaigns(controller.signal, company.id),
      refreshContents(controller.signal, company.id),
      refreshSchedule(controller.signal, company.id)
    ]);

    if (
      tenantEpochRef.current !== tenantEpoch ||
      controller.signal.aborted ||
      auth.currentUser?.uid !== uid
    ) return;
  }, [refreshCampaigns, refreshContents, refreshSchedule]);

  const refreshCompanies = useCallback(async (
    signal?: AbortSignal,
    expectedSessionEpoch?: number
  ) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const data = await apiRequest<{ companies: Company[] }>('/api/companies', { signal });
      if (
        !canCommit(uid, signal) ||
        (expectedSessionEpoch !== undefined && sessionEpochRef.current !== expectedSessionEpoch)
      ) return;

      const nextCompanies = data.companies || [];
      setCompanies(nextCompanies);
      const previousId = selectedCompanyRef.current?.id;
      const nextCompany = nextCompanies.find((company) => company.id === previousId) || nextCompanies[0] || null;
      await handleSelectCompany(nextCompany);
    } catch (error) {
      reportLoadFailure('Empresas', error);
    }
  }, [canCommit, handleSelectCompany, reportLoadFailure]);

  const loadSession = useCallback(async (
    signal: AbortSignal,
    expectedSessionEpoch: number,
    expectedUid: string
  ) => {
    const data = await apiRequest<{ user: User; wallet: Wallet }>('/api/auth/me', { signal });
    if (
      !canCommit(expectedUid, signal) ||
      sessionEpochRef.current !== expectedSessionEpoch
    ) return;

    setUser(data.user);
    setWallet(data.wallet);
    await refreshCompanies(signal, expectedSessionEpoch);
  }, [canCommit, refreshCompanies]);

  const reloadSession = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      resetSessionState();
      return;
    }

    sessionControllerRef.current?.abort();
    tenantControllerRef.current?.abort();
    const controller = new AbortController();
    const epoch = ++sessionEpochRef.current;
    sessionControllerRef.current = controller;

    try {
      await loadSession(controller.signal, epoch, firebaseUser.uid);
    } catch (error) {
      reportLoadFailure('Sessão', error);
    }
  }, [loadSession, reportLoadFailure, resetSessionState]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      sessionControllerRef.current?.abort();
      tenantControllerRef.current?.abort();
      const controller = new AbortController();
      const epoch = ++sessionEpochRef.current;
      sessionControllerRef.current = controller;
      setLoading(true);

      try {
        if (!firebaseUser) {
          resetSessionState();
          return;
        }
        await loadSession(controller.signal, epoch, firebaseUser.uid);
      } catch (error) {
        if (!isApiAbortError(error)) {
          resetSessionState();
          reportLoadFailure('Sessão', error);
        }
      } finally {
        if (
          mountedRef.current &&
          sessionEpochRef.current === epoch &&
          !controller.signal.aborted
        ) setLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
      sessionEpochRef.current += 1;
      tenantEpochRef.current += 1;
      sessionControllerRef.current?.abort();
      tenantControllerRef.current?.abort();
      unsubscribe();
    };
  }, [loadSession, reportLoadFailure, resetSessionState]);

  const authSuccess = async (loggedUser: User, loggedWallet: Wallet) => {
    setUser(loggedUser);
    setWallet(loggedWallet);
    setAuthOpen(false);

    sessionControllerRef.current?.abort();
    const controller = new AbortController();
    const epoch = ++sessionEpochRef.current;
    sessionControllerRef.current = controller;
    await refreshCompanies(controller.signal, epoch);

    const pendingTab = pendingTabRef.current;
    pendingTabRef.current = null;
    if (pendingTab) {
      const allowedTarget = pendingTab === 'admin' && loggedUser.role !== 'admin'
        ? 'dashboard'
        : pendingTab;
      commitNavigation(allowedTarget, 'replace');
    }
  };

  const logout = async () => {
    pendingTabRef.current = null;
    sessionControllerRef.current?.abort();
    tenantControllerRef.current?.abort();
    try {
      await signOut(auth);
    } finally {
      resetSessionState();
      setAuthOpen(false);
      commitNavigation('home', 'replace');
    }
  };

  const guardedTab = !user && isPrivateTab(currentTab)
    ? 'home'
    : currentTab === 'admin' && !isAdmin
      ? 'dashboard'
      : currentTab;

  const content = useMemo(() => {
    switch (guardedTab) {
      case 'home':
        return <LandingPage authenticated={Boolean(user)} onOpenAuth={() => setAuthOpen(true)} onNavigate={navigate}/>;
      case 'dashboard':
        return <DashboardPage user={user} wallet={wallet} selectedCompany={selectedCompany} campaigns={campaigns} scheduledPosts={scheduledPosts} onNavigate={navigate} onOpenAuth={() => setAuthOpen(true)}/>;
      case 'empresa':
        return <MyCompanyPage selectedCompany={selectedCompany} companies={companies} onSelectCompany={handleSelectCompany} onRefreshCompanies={refreshCompanies}/>;
      case 'vitrine':
        return <VitrinePage onNavigate={navigate}/>;
      case 'froc-ia':
        return <FrocIaPage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
      case 'autopilot':
        return <AutopilotPage selectedCompany={selectedCompany} wallet={wallet} onNavigate={navigate}/>;
      case 'criar-conteudo':
        return <CreateContentPage companies={companies} selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onRefreshContents={refreshContents} onNavigate={navigate}/>;
      case 'criar-imagem':
        return <CreateImagePage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onRefreshContents={refreshContents} onNavigate={navigate}/>;
      case 'criar-video':
        return <CreateVideoPage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onRefreshContents={refreshContents} onNavigate={navigate}/>;
      case 'criar-artigo':
        return <CreateArticlePage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet} onRefreshContents={refreshContents} onNavigate={navigate}/>;
      case 'seo':
        return <SeoPage selectedCompany={selectedCompany} wallet={wallet} onRefreshWallet={refreshWallet}/>;
      case 'campanhas':
        return <CampaignsPage campaigns={campaigns} selectedCompany={selectedCompany} onRefreshCampaigns={refreshCampaigns} onNavigate={navigate}/>;
      case 'calendario':
        return <CalendarPage scheduledPosts={scheduledPosts} contentItems={contentItems} selectedCompany={selectedCompany} onRefreshSchedule={refreshSchedule} onNavigate={navigate}/>;
      case 'redes-sociais':
        return <SocialNetworksPage selectedCompany={selectedCompany} onNavigate={navigate}/>;
      case 'conteudos':
        return <ContentsLibraryPage contentItems={contentItems} selectedCompany={selectedCompany} onRefreshContents={refreshContents} onNavigate={navigate}/>;
      case 'analytics':
        return <AnalyticsPage selectedCompany={selectedCompany} wallet={wallet} campaigns={campaigns} scheduledPosts={scheduledPosts} onNavigate={navigate}/>;
      case 'planos':
        return <PlansPage wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
      case 'creditos':
        return <CreditsPage wallet={wallet} onRefreshWallet={refreshWallet} onNavigate={navigate}/>;
      case 'perfil':
        return <ProfilePage user={user} wallet={wallet} onRefreshUser={reloadSession} onNavigate={navigate}/>;
      case 'suporte':
        return <SupportPage onNavigate={navigate}/>;
      case 'legal':
        return <LegalPage/>;
      case 'admin':
        return <AdminPage onNavigate={navigate}/>;
      default:
        return <LandingPage authenticated={Boolean(user)} onOpenAuth={() => setAuthOpen(true)} onNavigate={navigate}/>;
    }
  }, [
    campaigns,
    companies,
    contentItems,
    guardedTab,
    handleSelectCompany,
    navigate,
    refreshCampaigns,
    refreshCompanies,
    refreshContents,
    refreshSchedule,
    refreshWallet,
    reloadSession,
    scheduledPosts,
    selectedCompany,
    user,
    wallet
  ]);

  const needsTermsConsent = Boolean(
    user && (
      !user.termsAcceptedAt ||
      !user.privacyAcceptedAt ||
      user.termsVersion !== '2026.1' ||
      user.privacyVersion !== '2026.1'
    )
  );

  if (guardedTab === 'home') {
    return <>
      <OfflineBanner/>
      <PwaInstallPrompt/>
      {content}
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} onSuccess={authSuccess}/>
      <TermsConsentModal isOpen={needsTermsConsent} onConsentSuccess={authSuccess} onLogout={logout}/>
    </>;
  }

  const pageIsolationKey = `${user?.id || 'public'}:${selectedCompany?.id || 'none'}:${guardedTab}`;

  return <div className="min-h-[100dvh] bg-[#0B0F19] text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
    <OfflineBanner/>
    <PwaInstallPrompt/>
    <div className="hidden lg:block">
      <Sidebar currentTab={guardedTab} onSelectTab={navigate} user={user} wallet={wallet} selectedCompany={selectedCompany} isCollapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((value) => !value)} isAdmin={Boolean(isAdmin)}/>
      <Header user={user} wallet={wallet} companies={companies} selectedCompany={selectedCompany} onSelectCompany={handleSelectCompany} onOpenAuth={() => setAuthOpen(true)} onLogout={logout} onNavigate={navigate} isSidebarCollapsed={sidebarCollapsed}/>
    </div>
    <MobileTopBar user={user} wallet={wallet} menuOpen={mobileMenu} onToggleMenu={() => setMobileMenu((value) => !value)} onOpenAuth={() => setAuthOpen(true)} onNavigate={navigate}/>
    <MobileDrawer open={mobileMenu} currentTab={guardedTab} user={user} isAdmin={Boolean(isAdmin)} onClose={() => setMobileMenu(false)} onNavigate={navigate}/>
    <div className={`min-h-[100dvh] transition-[margin] duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64'}`}>
      <main className="mx-auto w-full max-w-[1600px] px-3 pb-[calc(92px+env(safe-area-inset-bottom))] pt-[calc(72px+env(safe-area-inset-top))] sm:px-5 lg:px-8 lg:pb-10 lg:pt-24">
        {loading
          ? <div className="grid min-h-[60vh] place-items-center"><div className="text-center"><span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-400"/><p className="mt-3 text-xs text-slate-400">Carregando Froc.IA…</p></div></div>
          : <React.Fragment key={pageIsolationKey}>{content}</React.Fragment>}
      </main>
    </div>
    <BottomNav currentTab={guardedTab} onNavigate={navigate}/>
    <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} onSuccess={authSuccess}/>
    <TermsConsentModal isOpen={needsTermsConsent} onConsentSuccess={authSuccess} onLogout={logout}/>
  </div>;
}