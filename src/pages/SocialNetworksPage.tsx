import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, ExternalLink, FileVideo, Info, RefreshCw, Send, Share2, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import type { Company, SocialConnection } from '../types';
import { apiRequest } from '../lib/api';

interface SocialNetworksPageProps { selectedCompany: Company | null; onNavigate: (tab:string)=>void; }

type Provider = SocialConnection['provider'];
const networks:Array<{id:Provider;name:string;icon:string;capability:string;note:string}> = [
  { id:'instagram', name:'Instagram Business', icon:'📸', capability:'OAuth e conta profissional', note:'Publicação automática exige mídia compatível, conta Business/Creator e permissões Meta aprovadas.' },
  { id:'facebook', name:'Facebook Page', icon:'📘', capability:'Publicação de texto em Página', note:'Disponível quando o token possui a Página e os escopos aprovados necessários.' },
  { id:'linkedin', name:'LinkedIn', icon:'💼', capability:'Publicação de texto', note:'Disponível quando o aplicativo LinkedIn e o usuário possuem o escopo de publicação autorizado.' },
  { id:'tiktok', name:'TikTok', icon:'🎵', capability:'Login Kit & Content Posting (Rascunho)', note:'Envio de vídeo MP4 (até 4 MB) como rascunho para a Caixa de Entrada do TikTok. A publicação final é concluída pelo usuário no app do TikTok.' },
  { id:'youtube', name:'YouTube', icon:'▶️', capability:'OAuth e canal conectado', note:'Upload/publicação exige arquivo de vídeo e permissões próprias da API do YouTube.' },
  { id:'pinterest', name:'Pinterest', icon:'📌', capability:'OAuth e conta conectada', note:'Criação de Pin exige imagem ou mídia e escopos próprios do Pinterest.' },
  { id:'x', name:'X', icon:'𝕏', capability:'Publicação de texto', note:'Disponível quando o aplicativo X permite escrita e o token OAuth 2.0 possui o escopo necessário.' }
];

export const SocialNetworksPage:React.FC<SocialNetworksPageProps> = ({ selectedCompany, onNavigate }) => {
  const [connections,setConnections]=useState<SocialConnection[]>([]);
  const [loading,setLoading]=useState(false);
  const [working,setWorking]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');

  // TikTok Draft Modal State
  const [isTikTokModalOpen, setIsTikTokModalOpen] = useState(false);
  const [tiktokVideoFile, setTiktokVideoFile] = useState<File | null>(null);
  const [tiktokVideoTitle, setTiktokVideoTitle] = useState('');
  const [tiktokUploading, setTiktokUploading] = useState(false);
  const [tiktokCheckingStatus, setTiktokCheckingStatus] = useState(false);
  const [tiktokError, setTiktokError] = useState('');
  const [tiktokSuccessResult, setTiktokSuccessResult] = useState<{ publishId: string; message: string; status: string } | null>(null);
  const [tiktokStatusResult, setTiktokStatusResult] = useState<{ status: string; message: string; failReason?: string | null } | null>(null);
  const [copiedPublishId, setCopiedPublishId] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Facebook Multi-Page Selection Modal State
  const [isPageSelectModalOpen, setIsPageSelectModalOpen] = useState(false);
  const [pageCandidates, setPageCandidates] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [pageSelectToken, setPageSelectToken] = useState('');
  const [pageSelectLoading, setPageSelectLoading] = useState(false);
  const [pageSelectSaving, setPageSelectSaving] = useState(false);
  const [pageSelectError, setPageSelectError] = useState('');
  const [readiness, setReadiness] = useState<{
    healthy: boolean;
    connectedCount: number;
    connections: Array<{ provider: string; accountName: string; status: string; supportsAutoPublish: boolean; directMediaCapable?: boolean }>;
    summary: string;
  } | null>(null);

  const fetchConnections=useCallback(async()=>{
    if(!selectedCompany?.id){setConnections([]);setReadiness(null);return;}
    setLoading(true); setError('');
    try{
      const [d, r] = await Promise.all([
        apiRequest<{connections:SocialConnection[]}>(`/api/social/connections/${selectedCompany.id}`),
        apiRequest<any>(`/api/social/readiness?companyId=${encodeURIComponent(selectedCompany.id)}`).catch(() => null)
      ]);
      setConnections(d.connections||[]);
      if (r) setReadiness(r);
    }
    catch(e:any){setError(e.message||'Não foi possível carregar as conexões sociais.');}
    finally{setLoading(false)}
  },[selectedCompany?.id]);

  useEffect(()=>{void fetchConnections()},[fetchConnections]);
  useEffect(()=>{
    const p = new URLSearchParams(window.location.search);
    const connected = p.get('connected');
    const oauthError = p.get('error');
    const pageSelection = p.get('pageSelection') || p.get('pageSelectToken');

    if (connected) {
      setMessage(`${connected} conectado com sucesso.`);
      void fetchConnections();
    }
    if (oauthError) setError(oauthError);

    if (pageSelection) {
      setPageSelectToken(pageSelection);
      setIsPageSelectModalOpen(true);
      setPageSelectLoading(true);
      setPageSelectError('');
      const compId = p.get('companyId') || selectedCompany?.id || '';
      apiRequest<{ pages: Array<{ id: string; name: string }> }>(
        `/api/social/facebook/selection-candidates?selectionToken=${encodeURIComponent(pageSelection)}${compId ? `&companyId=${encodeURIComponent(compId)}` : ''}`
      )
        .then((res) => {
          const list = res.pages || [];
          setPageCandidates(list);
          if (list.length > 0) setSelectedPageId(list[0].id);
        })
        .catch((err: any) => {
          setPageSelectError(err.message || 'Não foi possível carregar a lista de Páginas disponíveis.');
        })
        .finally(() => {
          setPageSelectLoading(false);
        });
    }

    if (connected || oauthError || (!pageSelection && p.has('companyId'))) {
      try {
        p.delete('connected');
        p.delete('error');
        p.delete('companyId');
        const newSearch = p.toString();
        const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
      } catch {
        // Safe fallback
      }
    }
  },[fetchConnections, selectedCompany?.id]);

  const byProvider=useMemo(()=>new Map(connections.map(c=>[c.provider,c])),[connections]);
  const connect=async(provider:Provider)=>{
    if(!selectedCompany?.id){setError('Cadastre ou selecione uma empresa antes de conectar uma rede.');onNavigate('empresa');return;}
    setWorking(provider);setError('');setMessage('');
    try{const d=await apiRequest<{authUrl:string}>(`/api/social/oauth/${provider}/start?companyId=${encodeURIComponent(selectedCompany.id)}`);if(!d.authUrl)throw new Error('O provedor não retornou URL de autorização.');window.location.assign(d.authUrl)}
    catch(e:any){setError(e.message||'Falha ao iniciar OAuth.');setWorking(null)}
  };
  const disconnect=async(connection:SocialConnection)=>{
    if(!window.confirm(`Desconectar ${connection.accountName||connection.provider}?`))return;
    setWorking(connection.provider);setError('');setMessage('');
    try{await apiRequest(`/api/social/connections/${connection.id}`,{method:'DELETE'});setMessage('Conta desconectada com segurança.');await fetchConnections()}
    catch(e:any){setError(e.message||'Falha ao desconectar conta.');}
    finally{setWorking(null)}
  };

  const handleOpenTikTokModal = () => {
    setTiktokVideoFile(null);
    setTiktokVideoTitle('');
    setTiktokError('');
    setTiktokSuccessResult(null);
    setTiktokStatusResult(null);
    setIsTikTokModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTiktokError('');
    setTiktokSuccessResult(null);
    setTiktokStatusResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Validação de formato MP4
    const isMp4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
    if (!isMp4) {
      setTiktokError('Formato inválido. Selecione um arquivo de vídeo no formato MP4 (.mp4).');
      return;
    }

    // Validação de tamanho (máximo 4MB para fase de Sandbox / Vercel Serverless)
    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      setTiktokError('O vídeo excede o limite de 4 MB desta fase de verificação do TikTok.');
      return;
    }

    if (file.size < 1024) {
      setTiktokError('O arquivo selecionado é muito pequeno para ser um vídeo válido.');
      return;
    }

    setTiktokVideoFile(file);
  };

  const handleSendTikTokDraft = async () => {
    if (!selectedCompany?.id) {
      setTiktokError('Selecione uma empresa antes de enviar o rascunho.');
      return;
    }
    if (!tiktokVideoFile) {
      setTiktokError('Selecione um arquivo de vídeo MP4 antes de enviar.');
      return;
    }

    setTiktokUploading(true);
    setTiktokError('');
    setTiktokSuccessResult(null);
    setTiktokStatusResult(null);

    try {
      const formData = new FormData();
      formData.append('companyId', selectedCompany.id);
      formData.append('video', tiktokVideoFile);
      if (tiktokVideoTitle.trim()) {
        formData.append('title', tiktokVideoTitle.trim());
      }

      const res = await apiRequest<{
        success: boolean;
        publishId: string;
        status: string;
        message: string;
      }>('/api/social/tiktok/upload-draft', {
        method: 'POST',
        body: formData,
        timeoutMs: 120_000
      });

      if (res.success && res.publishId) {
        setTiktokSuccessResult({
          publishId: res.publishId,
          message: res.message || 'Rascunho enviado ao TikTok. Abra o TikTok e acesse a notificação na Caixa de Entrada para continuar a edição e publicar.',
          status: res.status || 'draft_sent'
        });
      } else {
        throw new Error(res.message || 'Não foi possível concluir o envio do rascunho ao TikTok.');
      }
    } catch (err: any) {
      setTiktokError(err.message || 'Erro ao enviar rascunho para o TikTok.');
    } finally {
      setTiktokUploading(false);
    }
  };

  const handleCheckTikTokStatus = async () => {
    if (!selectedCompany?.id || !tiktokSuccessResult?.publishId) return;
    setTiktokCheckingStatus(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        publishId: string;
        status: string;
        failReason?: string | null;
        isDraftDelivered: boolean;
        message: string;
      }>('/api/social/tiktok/upload-status', {
        method: 'POST',
        body: {
          companyId: selectedCompany.id,
          publishId: tiktokSuccessResult.publishId
        }
      });
      setTiktokStatusResult({
        status: res.status,
        message: res.message,
        failReason: res.failReason
      });
    } catch (err: any) {
      setTiktokError(err.message || 'Erro ao consultar status no TikTok.');
    } finally {
      setTiktokCheckingStatus(false);
    }
  };

  const handleCopyPublishId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedPublishId(true);
    setTimeout(() => setCopiedPublishId(false), 2000);
  };

  const handleConfirmPageSelection = async () => {
    if (!pageSelectToken || !selectedPageId) {
      setPageSelectError('Selecione uma Página do Facebook para continuar.');
      return;
    }
    setPageSelectSaving(true);
    setPageSelectError('');
    try {
      const res = await apiRequest<{ success: boolean; message: string }>(
        '/api/social/facebook/select-page',
        {
          method: 'POST',
          body: {
            selectionToken: pageSelectToken,
            pageId: selectedPageId,
            companyId: selectedCompany?.id
          }
        }
      );
      setMessage(res.message || 'Página do Facebook conectada com sucesso.');
      setIsPageSelectModalOpen(false);
      setPageSelectToken('');
      setPageCandidates([]);
      // Clean query url params
      const p = new URLSearchParams(window.location.search);
      p.delete('pageSelection');
      p.delete('pageSelectToken');
      p.delete('companyId');
      const newSearch = p.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
      await fetchConnections();
    } catch (err: any) {
      setPageSelectError(err.message || 'Falha ao conectar Página selecionada.');
    } finally {
      setPageSelectSaving(false);
    }
  };

  return <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="flex items-center gap-2 text-xl font-bold text-white"><Share2 className="text-cyan-400"/>Redes Sociais</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Conecte contas oficiais via OAuth. O Froc.IA só registra publicação quando a API do provedor confirma sucesso.</p></div>
      <button onClick={()=>void fetchConnections()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-xs font-bold text-slate-200 hover:border-cyan-500/50 disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/>Atualizar</button>
    </div>

    <div className="flex gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-4 text-xs text-slate-300"><ShieldCheck className="mt-0.5 shrink-0 text-cyan-400" size={20}/><p><strong className="text-white">Tokens protegidos no backend.</strong> Credenciais OAuth são criptografadas e nunca retornam para o navegador. Aplicativos móveis também usam a mesma API segura.</p></div>
    {error&&<div role="alert" className="flex gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200"><AlertTriangle size={17} className="shrink-0"/>{error}</div>}
    {message&&<div className="flex gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200"><CheckCircle2 size={17} className="shrink-0"/>{message}</div>}

    {readiness && selectedCompany && (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#0F172A] p-4 text-xs">
        <div className="flex items-center gap-3">
          <div className={`grid h-9 w-9 place-items-center rounded-xl ${readiness.healthy && readiness.connectedCount > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <p className="font-bold text-white">Status de Prontidão Operacional: {selectedCompany.name}</p>
            <p className="text-slate-400 text-[11px]">{readiness.summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-slate-950 px-3 py-1.5 font-mono text-[11px] text-cyan-300 border border-slate-800">
            {readiness.connectedCount} {readiness.connectedCount === 1 ? 'canal conectado' : 'canais conectados'}
          </span>
        </div>
      </div>
    )}

    {!selectedCompany?<div className="rounded-3xl border border-slate-800 bg-[#0F172A] p-10 text-center"><p className="text-sm font-bold text-white">Selecione uma empresa para gerenciar conexões.</p><button onClick={()=>onNavigate('empresa')} className="mt-4 rounded-xl bg-cyan-500 px-5 py-3 text-xs font-extrabold text-slate-950">Ir para Minha Empresa</button></div>:
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{networks.map(net=>{const conn=byProvider.get(net.id);const connected=conn?.status==='connected';const expired=conn?.expiresAt&&new Date(conn.expiresAt).getTime()<Date.now();return <article key={net.id} className="flex min-h-[270px] flex-col justify-between rounded-3xl border border-[#334155] bg-[#0F172A] p-5 shadow-xl shadow-black/10 transition hover:border-cyan-500/40">
      <div><div className="flex items-start justify-between gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-700 bg-[#1E293B] text-xl">{net.icon}</div>{connected&&!expired?<span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300"><CheckCircle2 size={11}/>Conectado</span>:<span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-400">{expired?'Expirado':'Desconectado'}</span>}</div>
      <h3 className="mt-4 text-sm font-bold text-white">{net.name}</h3><p className="mt-1 text-xs font-semibold text-cyan-300">{net.capability}</p><p className="mt-2 text-[11px] leading-relaxed text-slate-400">{net.note}</p>
      {conn&&<div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px]"><p className="truncate font-semibold text-slate-200">{conn.accountName||'Conta conectada'}</p>{conn.scopes?.length>0&&<p className="mt-1 line-clamp-2 text-slate-500">Escopos: {conn.scopes.join(', ')}</p>}</div>}</div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {connected&&!expired?(
          <>
            {net.id === 'tiktok' && (
              <button
                type="button"
                onClick={handleOpenTikTokModal}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-3 text-xs font-extrabold text-white shadow-lg shadow-blue-500/20 hover:opacity-95"
              >
                <Send size={14}/>Enviar rascunho ao TikTok
              </button>
            )}
            <button
              disabled={working===net.id}
              onClick={()=>void disconnect(conn!)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 size={14}/>Desconectar
            </button>
          </>
        ):(
          <button disabled={working===net.id} onClick={()=>void connect(net.id)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-xs font-extrabold text-white disabled:opacity-50"><ExternalLink size={14}/>{working===net.id?'Abrindo…':'Conectar via OAuth'}</button>
        )}
      </div>
    </article>})}</div>}

    {/* Facebook Page Selection Modal */}
    {isPageSelectModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm animate-fadeIn">
        <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[#334155] bg-[#0F172A] shadow-2xl shadow-black/80">
          <div className="flex items-center justify-between border-b border-slate-800 p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#1E293B] text-lg">📘</div>
              <div>
                <h3 className="text-sm font-bold text-white">Selecionar Página do Facebook</h3>
                <p className="text-[11px] text-slate-400">Escolha a Página gerenciada para conectar à empresa</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsPageSelectModalOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {pageSelectError && (
              <div className="flex gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-200">
                <AlertTriangle size={16} className="shrink-0 text-rose-400 mt-0.5" />
                <p className="leading-relaxed">{pageSelectError}</p>
              </div>
            )}

            {pageSelectLoading ? (
              <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
                <div className="w-7 h-7 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin"></div>
                <p className="text-xs text-slate-400">Carregando Páginas autorizadas...</p>
              </div>
            ) : pageCandidates.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-[#1E293B]/40 p-6 text-center space-y-2">
                <Info size={24} className="mx-auto text-amber-400" />
                <p className="text-xs font-bold text-white">Nenhuma Página disponível</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  O token não possui permissões administrativas ou você não selecionou Páginas durante o OAuth. Tente reconectar autorizando as Páginas desejadas.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Páginas disponíveis ({pageCandidates.length})
                </label>
                <div className="space-y-2">
                  {pageCandidates.map((page) => (
                    <label
                      key={page.id}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition ${
                        selectedPageId === page.id
                          ? 'border-cyan-400 bg-cyan-500/10'
                          : 'border-slate-800 bg-[#1E293B]/60 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="facebookPage"
                          value={page.id}
                          checked={selectedPageId === page.id}
                          onChange={() => setSelectedPageId(page.id)}
                          className="h-4 w-4 text-cyan-400 focus:ring-cyan-400"
                        />
                        <div>
                          <p className="text-xs font-bold text-white">{page.name}</p>
                          <p className="text-[10px] text-slate-400">ID: {page.id}</p>
                        </div>
                      </div>
                      {selectedPageId === page.id && (
                        <Check size={16} className="text-cyan-400" />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setIsPageSelectModalOpen(false)}
              className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmPageSelection}
              disabled={pageSelectSaving || !selectedPageId || pageCandidates.length === 0}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 text-xs font-extrabold text-white shadow-lg shadow-blue-500/25 hover:opacity-95 disabled:opacity-50"
            >
              {pageSelectSaving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>Conectando Página...</span>
                </>
              ) : (
                <>
                  <Check size={15} />
                  <span>Conectar Página Selecionada</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* TikTok Draft Upload Modal */}
    {isTikTokModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm animate-fadeIn">
        <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[#334155] bg-[#0F172A] shadow-2xl shadow-black/80">
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-slate-800 p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#1E293B] text-lg">🎵</div>
              <div>
                <h3 className="text-sm font-bold text-white">Enviar rascunho ao TikTok</h3>
                <p className="text-[11px] text-slate-400">Content Posting API · scope video.upload</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsTikTokModalOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {/* Informational Guidance */}
            <div className="flex gap-2.5 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3.5 text-xs text-cyan-200">
              <Info size={18} className="mt-0.5 shrink-0 text-cyan-400" />
              <p className="leading-relaxed">
                O vídeo será enviado como rascunho. Você receberá uma notificação no TikTok para continuar a edição e concluir a publicação.
              </p>
            </div>

            {/* Error Message */}
            {tiktokError && (
              <div role="alert" className="flex gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-200">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <p className="leading-relaxed break-words">{tiktokError}</p>
              </div>
            )}

            {/* Success Card */}
            {tiktokSuccessResult && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200 space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-white font-bold text-xs mb-1">Rascunho enviado com sucesso!</strong>
                    <p className="text-[11px] leading-relaxed text-emerald-300">
                      Rascunho enviado ao TikTok. Abra o TikTok e acesse a notificação na Caixa de Entrada para continuar a edição e publicar.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950/70 p-2.5 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 font-mono block">publish_id:</span>
                    <span className="text-xs font-mono text-cyan-300 truncate block">{tiktokSuccessResult.publishId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyPublishId(tiktokSuccessResult.publishId)}
                    className="shrink-0 flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
                  >
                    {copiedPublishId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copiedPublishId ? 'Copiado' : 'Copiar ID'}
                  </button>
                </div>

                <div className="pt-2 border-t border-emerald-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleCheckTikTokStatus}
                    disabled={tiktokCheckingStatus}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={tiktokCheckingStatus ? 'animate-spin' : ''} />
                    {tiktokCheckingStatus ? 'Consultando...' : 'Consultar status no TikTok'}
                  </button>
                  {tiktokStatusResult && (
                    <span className="text-[11px] font-bold text-emerald-300">
                      Status: {tiktokStatusResult.status}
                    </span>
                  )}
                </div>

                {tiktokStatusResult && (
                  <div className="rounded-xl bg-slate-950/50 p-2.5 text-[11px] text-slate-300 border border-slate-800">
                    <p className="leading-relaxed">{tiktokStatusResult.message}</p>
                    {tiktokStatusResult.failReason && (
                      <p className="mt-1 text-rose-300 text-[10px]">Motivo: {tiktokStatusResult.failReason}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Video File Picker */}
            {!tiktokSuccessResult && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Título / Referência (opcional)
                  </label>
                  <input
                    type="text"
                    value={tiktokVideoTitle}
                    onChange={(e) => setTiktokVideoTitle(e.target.value)}
                    placeholder="Ex: Roteiro 3 Dicas de Vendas"
                    className="min-h-11 w-full rounded-xl border border-slate-700 bg-[#1E293B] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Arquivo de Vídeo (MP4) *
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,.mp4"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-[#1E293B]/60 p-6 text-center cursor-pointer transition hover:border-cyan-400/60 hover:bg-[#1E293B]"
                  >
                    {tiktokVideoFile ? (
                      <div className="space-y-1 text-center">
                        <FileVideo size={32} className="mx-auto text-cyan-400" />
                        <p className="text-xs font-bold text-white truncate max-w-xs">{tiktokVideoFile.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {(tiktokVideoFile.size / (1024 * 1024)).toFixed(2)} MB · {tiktokVideoFile.type || 'video/mp4'}
                        </p>
                        <span className="inline-block mt-1 text-[10px] text-cyan-400 font-semibold underline">
                          Clique para trocar o vídeo
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload size={28} className="mx-auto text-slate-400" />
                        <p className="text-xs font-bold text-slate-200">Clique para selecionar o vídeo MP4</p>
                        <p className="text-[11px] text-slate-400">MP4 · até 4 MB nesta fase de verificação</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="border-t border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setIsTikTokModalOpen(false)}
              className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              Fechar
            </button>
            {!tiktokSuccessResult && (
              <button
                type="button"
                onClick={handleSendTikTokDraft}
                disabled={!tiktokVideoFile || tiktokUploading}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 text-xs font-extrabold text-white shadow-lg shadow-blue-500/25 hover:opacity-95 disabled:opacity-50"
              >
                {tiktokUploading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Enviando rascunho para o TikTok...</span>
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    <span>Enviar rascunho ao TikTok</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </div>;
};

