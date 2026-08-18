import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import type { Company, SocialConnection } from '../types';
import { apiRequest } from '../lib/api';

interface SocialNetworksPageProps { selectedCompany: Company | null; onNavigate: (tab:string)=>void; }

type Provider = SocialConnection['provider'];
const networks:Array<{id:Provider;name:string;icon:string;capability:string;note:string}> = [
  { id:'instagram', name:'Instagram Business', icon:'📸', capability:'OAuth e conta profissional', note:'Publicação automática exige mídia compatível, conta Business/Creator e permissões Meta aprovadas.' },
  { id:'facebook', name:'Facebook Page', icon:'📘', capability:'Publicação de texto em Página', note:'Disponível quando o token possui a Página e os escopos aprovados necessários.' },
  { id:'linkedin', name:'LinkedIn', icon:'💼', capability:'Publicação de texto', note:'Disponível quando o aplicativo LinkedIn e o usuário possuem o escopo de publicação autorizado.' },
  { id:'tiktok', name:'TikTok', icon:'🎵', capability:'OAuth e conta conectada', note:'Publicação exige mídia/vídeo compatível e aprovação dos escopos de Content Posting.' },
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

  const fetchConnections=useCallback(async()=>{
    if(!selectedCompany?.id){setConnections([]);return;}
    setLoading(true); setError('');
    try{const d=await apiRequest<{connections:SocialConnection[]}>(`/api/social/connections/${selectedCompany.id}`);setConnections(d.connections||[])}
    catch(e:any){setError(e.message||'Não foi possível carregar as conexões sociais.');}
    finally{setLoading(false)}
  },[selectedCompany?.id]);

  useEffect(()=>{void fetchConnections()},[fetchConnections]);
  useEffect(()=>{
    const p=new URLSearchParams(window.location.search);
    const connected=p.get('connected'), oauthError=p.get('error');
    if(connected){setMessage(`${connected} conectado com sucesso.`);void fetchConnections();}
    if(oauthError)setError(oauthError);
  },[fetchConnections]);

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

  return <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="flex items-center gap-2 text-xl font-bold text-white"><Share2 className="text-cyan-400"/>Redes Sociais</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Conecte contas oficiais via OAuth. O Froc.IA só registra publicação quando a API do provedor confirma sucesso.</p></div>
      <button onClick={()=>void fetchConnections()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-xs font-bold text-slate-200 hover:border-cyan-500/50 disabled:opacity-50"><RefreshCw size={15} className={loading?'animate-spin':''}/>Atualizar</button>
    </div>

    <div className="flex gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-4 text-xs text-slate-300"><ShieldCheck className="mt-0.5 shrink-0 text-cyan-400" size={20}/><p><strong className="text-white">Tokens protegidos no backend.</strong> Credenciais OAuth são criptografadas e nunca retornam para o navegador. Aplicativos móveis também usam a mesma API segura.</p></div>
    {error&&<div role="alert" className="flex gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200"><AlertTriangle size={17} className="shrink-0"/>{error}</div>}
    {message&&<div className="flex gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200"><CheckCircle2 size={17} className="shrink-0"/>{message}</div>}

    {!selectedCompany?<div className="rounded-3xl border border-slate-800 bg-[#0F172A] p-10 text-center"><p className="text-sm font-bold text-white">Selecione uma empresa para gerenciar conexões.</p><button onClick={()=>onNavigate('empresa')} className="mt-4 rounded-xl bg-cyan-500 px-5 py-3 text-xs font-extrabold text-slate-950">Ir para Minha Empresa</button></div>:
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{networks.map(net=>{const conn=byProvider.get(net.id);const connected=conn?.status==='connected';const expired=conn?.expiresAt&&new Date(conn.expiresAt).getTime()<Date.now();return <article key={net.id} className="flex min-h-[270px] flex-col justify-between rounded-3xl border border-[#334155] bg-[#0F172A] p-5 shadow-xl shadow-black/10 transition hover:border-cyan-500/40">
      <div><div className="flex items-start justify-between gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-700 bg-[#1E293B] text-xl">{net.icon}</div>{connected&&!expired?<span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300"><CheckCircle2 size={11}/>Conectado</span>:<span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-400">{expired?'Expirado':'Desconectado'}</span>}</div>
      <h3 className="mt-4 text-sm font-bold text-white">{net.name}</h3><p className="mt-1 text-xs font-semibold text-cyan-300">{net.capability}</p><p className="mt-2 text-[11px] leading-relaxed text-slate-400">{net.note}</p>
      {conn&&<div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px]"><p className="truncate font-semibold text-slate-200">{conn.accountName||'Conta conectada'}</p>{conn.scopes?.length>0&&<p className="mt-1 line-clamp-2 text-slate-500">Escopos: {conn.scopes.join(', ')}</p>}</div>}</div>
      <div className="mt-4 flex gap-2">{connected&&!expired?<button disabled={working===net.id} onClick={()=>void disconnect(conn!)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"><Trash2 size={14}/>Desconectar</button>:<button disabled={working===net.id} onClick={()=>void connect(net.id)} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-xs font-extrabold text-white disabled:opacity-50"><ExternalLink size={14}/>{working===net.id?'Abrindo…':'Conectar via OAuth'}</button>}</div>
    </article>})}</div>}
  </div>;
};
