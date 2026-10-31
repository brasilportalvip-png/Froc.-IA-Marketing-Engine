import React, { useEffect, useState } from 'react';
import { Activity, BarChart3, BookOpen, CheckCircle2, Coins, CreditCard, FileText, FolderKanban, Globe2, Newspaper, RefreshCw, ShieldAlert, Sparkles, Ticket, Users } from 'lucide-react';
import { AdminSeoPanel } from '../components/admin/AdminSeoPanel';
import { AdminUsers } from '../components/admin/AdminUsers';
import { AdminProjects } from '../components/admin/AdminProjects';
import { AdminActivity, AdminPayments, AdminVitrinePosts, AdminVoiceCheck } from '../components/admin/AdminRecords';
import type { BlogPost } from '../types';
import { apiRequest } from '../lib/api';

interface AdminPageProps { onNavigate:(tab:string)=>void; }
type TicketItem={id:string;userEmail:string;subject:string;message:string;status:string;createdAt:string};

export const AdminPage:React.FC<AdminPageProps>=()=>{
 type AdminTab='overview'|'users'|'projects'|'posts'|'blog'|'payments'|'activity'|'seo'|'support';
 const[tab,setTab]=useState<AdminTab>('overview');
 const[dash,setDash]=useState<Record<string,number>>({});
 const[tickets,setTickets]=useState<TicketItem[]>([]);const[posts,setPosts]=useState<BlogPost[]>([]);
 const[loading,setLoading]=useState(false);const[feedback,setFeedback]=useState('');
 const[topic,setTopic]=useState('');const[generating,setGenerating]=useState(false);
 const loadOverview=async()=>{const d=await apiRequest<{stats:Record<string,number>}>('/api/admin/dashboard');setDash(d.stats||{})};
 const loadTickets=async()=>{const d=await apiRequest<{tickets:TicketItem[]}>('/api/admin/support/tickets');setTickets(d.tickets||[])};
 const loadBlog=async()=>{const d=await apiRequest<{posts:BlogPost[]}>('/api/admin/blog');setPosts(d.posts||[])};
 const refresh=async()=>{setLoading(true);setFeedback('');try{await Promise.all([loadOverview(),loadTickets(),loadBlog()])}catch(err:any){setFeedback(err.message||'Falha ao carregar administração.')}finally{setLoading(false)}};
 useEffect(()=>{void refresh()},[]);
 const ticketStatus=async(id:string,status:string)=>{try{await apiRequest(`/api/admin/support/tickets/${id}`,{method:'PATCH',body:{status}});await loadTickets()}catch(err:any){setFeedback(err.message||'Falha ao atualizar chamado.')}};
 const generate=async()=>{setGenerating(true);setFeedback('');try{const d=await apiRequest<{post:BlogPost}>('/api/admin/blog/generate-now',{method:'POST',body:{topic:topic||undefined}});setFeedback(`Rascunho “${d.post.title}” gerado. Revise antes de publicar.`);setTopic('');await loadBlog()}catch(err:any){setFeedback(err.message||'Falha ao gerar artigo.')}finally{setGenerating(false)}};
 const publish=async(post:BlogPost)=>{try{await apiRequest(`/api/admin/blog/${post.id}`,{method:'PATCH',body:{status:'published'}});setFeedback('Artigo publicado, incluído no post-sitemap.xml e enviado ao IndexNow.');await loadBlog()}catch(err:any){setFeedback(err.message||'Falha ao publicar artigo.')}};
 const archive=async(post:BlogPost)=>{try{await apiRequest(`/api/admin/blog/${post.id}`,{method:'PATCH',body:{status:'archived'}});await loadBlog()}catch(err:any){setFeedback(err.message||'Falha ao arquivar artigo.')}};
 return <div className="mx-auto max-w-7xl space-y-6 animate-fadeIn"><header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-xl font-black text-white"><ShieldAlert className="text-rose-400"/>Administração Froc.IA</h2><p className="text-xs text-slate-400">Governança operacional com ações auditáveis.</p></div><button onClick={()=>void refresh()} className="froc-secondary inline-flex items-center justify-center gap-2"><RefreshCw size={14} className={loading?'animate-spin':''}/>Atualizar</button></header>
 {feedback&&<div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs text-cyan-200">{feedback}</div>}
 <div className="flex gap-2 overflow-x-auto pb-1">{([['overview','Visão geral',BarChart3],['users','Usuários',Users],['projects','Projetos',FolderKanban],['posts','Posts da Vitrine',Newspaper],['blog','Froc Magazine',BookOpen],['payments','Pagamentos',CreditCard],['activity','Atividade',Activity],['seo','Motor SEO',Globe2],['support','Suporte',Ticket]] as const).map(([id,label,Icon])=><button key={id} onClick={()=>setTab(id)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-bold ${tab===id?'bg-blue-600 text-white':'border border-slate-700 bg-slate-900 text-slate-400'}`}><Icon size={14}/>{label}</button>)}</div>
 {tab==='overview'&&<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{([
  [Users,'Usuários',dash.users,`+${dash.newUsers7d||0} nos últimos 7 dias`],
  [CreditCard,'Assinantes pagos',dash.paidUsers,`Receita aprovada R$ ${Number(dash.revenueApproved||0).toFixed(2).replace('.',',')}`],
  [FolderKanban,'Projetos',dash.companies,`${dash.vitrineCompanies||0} na Vitrine`],
  [Newspaper,'Posts publicados',(dash.vitrinePosts||0)+(dash.blogPublished||0),`${dash.vitrinePosts||0} vitrine · ${dash.blogPublished||0} magazine`],
  [Coins,'Créditos em circulação',dash.creditsInCirculation,`${Number(dash.creditsUsed||0).toLocaleString('pt-BR')} já usados`],
  [FileText,'Conteúdos criados',dash.contents,'Posts, imagens, vídeos e artigos'],
  [Sparkles,'Execuções de IA',dash.aiExecutions,`${dash.aiFailures||0} falhas`],
  [Ticket,'Chamados abertos',dash.openTickets,'Suporte em andamento']
 ] as const).map(([Icon,label,value,hint]:any)=><div key={label} className="froc-panel"><Icon size={18} className="text-cyan-400"/><div className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 text-3xl font-black text-white">{Number(value||0).toLocaleString('pt-BR')}</div><div className="mt-1 text-[11px] text-slate-500">{hint}</div></div>)}</div>}
 {tab==='overview'&&<AdminVoiceCheck/>}
 {tab==='users'&&<AdminUsers onFeedback={setFeedback}/>}
 {tab==='projects'&&<AdminProjects onFeedback={setFeedback}/>}
 {tab==='posts'&&<AdminVitrinePosts onFeedback={setFeedback}/>}
 {tab==='payments'&&<AdminPayments onFeedback={setFeedback}/>}
 {tab==='activity'&&<AdminActivity onFeedback={setFeedback}/>}
 {tab==='seo'&&<AdminSeoPanel/>}
 {tab==='support'&&<section className="froc-panel"><div className="mb-4 flex items-center justify-between"><h3 className="froc-section-title">Chamados</h3><span className="text-[10px] text-slate-500">{tickets.length} registros</span></div><div className="space-y-3">{tickets.length?tickets.map(t=><div key={t.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-sm font-bold text-white">{t.subject}</div><div className="mt-1 text-[10px] text-slate-500">{t.userEmail} · {new Date(t.createdAt).toLocaleString('pt-BR')}</div></div><select value={t.status} onChange={e=>void ticketStatus(t.id,e.target.value)} className="min-h-9 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-white"><option value="open">Aberto</option><option value="in_progress">Em atendimento</option><option value="resolved">Resolvido</option><option value="closed">Fechado</option></select></div><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-300">{t.message}</p></div>):<div className="text-xs text-slate-500">Nenhum chamado.</div>}</div></section>}
 {tab==='blog'&&<><section className="froc-panel"><h3 className="froc-section-title flex items-center gap-2"><Sparkles size={15} className="text-cyan-400"/>Gerar rascunho editorial com IA</h3><p className="mt-2 text-xs text-slate-400">A IA cria um rascunho sem consumir créditos de cliente. A publicação continua sob controle administrativo.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input value={topic} onChange={e=>setTopic(e.target.value)} className="froc-input flex-1" placeholder="Tema opcional; vazio usa pauta editorial segura"/><button disabled={generating} onClick={()=>void generate()} className="froc-primary shrink-0">{generating?'Gerando…':'Gerar rascunho'}</button></div></section><section className="froc-panel"><h3 className="froc-section-title mb-4">Artigos</h3><div className="space-y-3">{posts.length?posts.map(p=><div key={p.id} className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-white">{p.title}</div><div className="mt-1 text-[10px] text-slate-500">/{p.slug} · {p.status}</div><p className="mt-1 line-clamp-2 text-xs text-slate-400">{p.summary}</p></div><div className="flex gap-2">{p.status!=='published'&&<button onClick={()=>void publish(p)} className="froc-primary inline-flex items-center gap-1"><CheckCircle2 size={13}/>Publicar</button>}{p.status!=='archived'&&<button onClick={()=>void archive(p)} className="froc-secondary">Arquivar</button>}</div></div>):<div className="text-xs text-slate-500">Nenhum artigo cadastrado.</div>}</div></section></>}
 </div>;
};
