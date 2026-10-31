import React, { useEffect, useState } from 'react';
import { Activity, Archive, CreditCard, ExternalLink, Newspaper, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';

const fmt = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR') : '—';

interface VitrinePostRow { id: string; title: string; slug: string; companySlug: string; companyName: string; status: string; angleLabel: string; publishedAt: string }

export const AdminVitrinePosts: React.FC<{ onFeedback: (message: string) => void }> = ({ onFeedback }) => {
  const [posts, setPosts] = useState<VitrinePostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try { setPosts((await apiRequest<{ posts: VitrinePostRow[] }>('/api/admin/vitrine-posts')).posts || []); }
    catch (err: any) { onFeedback(err?.message || 'Falha ao carregar posts.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (promise: Promise<{ message?: string }>) => {
    try { onFeedback((await promise).message || 'Salvo.'); await load(); } catch (err: any) { onFeedback(err?.message || 'Falha na operação.'); }
  };
  return (
    <section className="froc-panel">
      <div className="mb-4 flex items-center justify-between"><h3 className="froc-section-title flex items-center gap-2"><Newspaper size={15} className="text-[#FFD400]" /> Posts diários da Vitrine ({posts.length})</h3><button onClick={() => void load()} className="froc-secondary" aria-label="Atualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button></div>
      <div className="max-h-[560px] space-y-2 overflow-auto">
        {posts.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-950/50 p-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{p.title}</p>
              <p className="text-[11px] text-slate-500">{p.companyName} · {p.angleLabel} · {fmt(p.publishedAt)} · <span className={p.status === 'published' ? 'text-[#00E676]' : 'text-amber-300'}>{p.status === 'published' ? 'publicado' : 'arquivado'}</span></p>
            </div>
            <div className="flex gap-2">
              <a href={`/vitrine/${encodeURIComponent(p.companySlug)}/${encodeURIComponent(p.slug)}`} target="_blank" rel="noreferrer" className="froc-secondary inline-flex items-center gap-1 text-[11px]"><ExternalLink size={12} /> Ver</a>
              <button onClick={() => void act(apiRequest(`/api/admin/vitrine-posts/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { status: p.status === 'published' ? 'archived' : 'published' } }))} className="froc-secondary inline-flex items-center gap-1 text-[11px]">{p.status === 'published' ? <Archive size={12} /> : <RotateCcw size={12} />} {p.status === 'published' ? 'Arquivar' : 'Republicar'}</button>
              <button onClick={() => { if (window.confirm('Excluir este post definitivamente?')) void act(apiRequest(`/api/admin/vitrine-posts/${encodeURIComponent(p.id)}`, { method: 'DELETE' })); }} className="inline-flex items-center gap-1 rounded-xl border border-rose-500/40 px-3 text-[11px] font-bold text-rose-300"><Trash2 size={12} /> Excluir</button>
            </div>
          </div>
        ))}
        {!posts.length && !loading && <p className="text-xs text-slate-500">Nenhum post diário ainda.</p>}
      </div>
    </section>
  );
};

interface PaymentRow { id: string; userEmail: string; planName: string; amount: number; status: string; lastPaymentStatus: string; source: string; currentPeriodEnd: string | null; createdAt: string }

export const AdminPayments: React.FC<{ onFeedback: (message: string) => void }> = ({ onFeedback }) => {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  useEffect(() => {
    apiRequest<{ payments: PaymentRow[] }>('/api/admin/payments').then((d) => setPayments(d.payments || [])).catch((err) => onFeedback(err?.message || 'Falha ao carregar pagamentos.'));
  }, []);
  const total = payments.filter((p) => p.lastPaymentStatus === 'approved' && p.source !== 'admin_grant').reduce((sum, p) => sum + p.amount, 0);
  return (
    <section className="froc-panel">
      <h3 className="froc-section-title mb-1 flex items-center gap-2"><CreditCard size={15} className="text-[#FF2D87]" /> Pagamentos ({payments.length})</h3>
      <p className="mb-4 text-xs text-slate-400">Receita aprovada: <strong className="text-[#00E676]">R$ {total.toFixed(2).replace('.', ',')}</strong></p>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="sticky top-0 bg-[#0d0d0d] text-[10px] uppercase text-slate-500"><tr><th className="p-2">Data</th><th className="p-2">Usuário</th><th className="p-2">Plano/pacote</th><th className="p-2">Valor</th><th className="p-2">Status</th><th className="p-2">Origem</th><th className="p-2">Válido até</th></tr></thead>
          <tbody>{payments.map((p) => (
            <tr key={p.id} className="border-t border-slate-800">
              <td className="p-2 text-slate-400">{fmt(p.createdAt)}</td><td className="p-2 text-white">{p.userEmail || '—'}</td><td className="p-2 text-slate-300">{p.planName}</td>
              <td className="p-2 font-bold text-white">R$ {p.amount.toFixed(2).replace('.', ',')}</td>
              <td className="p-2"><span className={p.lastPaymentStatus === 'approved' ? 'text-[#00E676]' : 'text-amber-300'}>{p.lastPaymentStatus || p.status}</span></td>
              <td className="p-2 text-slate-400">{p.source === 'admin_grant' ? 'Admin' : 'Mercado Pago'}</td><td className="p-2 text-slate-500">{p.currentPeriodEnd ? new Date(p.currentPeriodEnd).toLocaleDateString('pt-BR') : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {!payments.length && <p className="p-3 text-xs text-slate-500">Nenhum pagamento registrado.</p>}
      </div>
    </section>
  );
};

export const AdminActivity: React.FC<{ onFeedback: (message: string) => void }> = ({ onFeedback }) => {
  const [data, setData] = useState<{ adminLogs: any[]; aiExecutions: any[]; transactions: any[] } | null>(null);
  useEffect(() => {
    apiRequest<{ adminLogs: any[]; aiExecutions: any[]; transactions: any[] }>('/api/admin/activity').then(setData).catch((err) => onFeedback(err?.message || 'Falha ao carregar atividade.'));
  }, []);
  if (!data) return <section className="froc-panel text-xs text-slate-500">Carregando atividade…</section>;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <section className="froc-panel">
        <h3 className="froc-section-title mb-3 flex items-center gap-2"><Activity size={15} className="text-[#FFD400]" /> Ações administrativas</h3>
        <div className="max-h-[480px] space-y-1.5 overflow-auto">{data.adminLogs.map((l) => <p key={l.id} className="text-[11px] text-slate-400"><span className="text-white">{l.action}</span> · {fmt(l.createdAt)}{l.targetUserId ? ` · ${l.targetUserId}` : ''}</p>)}{!data.adminLogs.length && <p className="text-xs text-slate-500">Sem registros.</p>}</div>
      </section>
      <section className="froc-panel">
        <h3 className="froc-section-title mb-3">Execuções de IA</h3>
        <div className="max-h-[480px] space-y-1.5 overflow-auto">{data.aiExecutions.map((e) => <p key={e.id} className="text-[11px] text-slate-400"><span className={e.status === 'failed' ? 'text-rose-300' : 'text-[#00E676]'}>{e.status}</span> · {e.type} · {e.creditsConsumed || 0} cr · {fmt(e.timestamp)}</p>)}{!data.aiExecutions.length && <p className="text-xs text-slate-500">Sem registros.</p>}</div>
      </section>
      <section className="froc-panel">
        <h3 className="froc-section-title mb-3">Movimentações de créditos</h3>
        <div className="max-h-[480px] space-y-1.5 overflow-auto">{data.transactions.map((t) => <p key={t.id} className="text-[11px] text-slate-400"><span className={Number(t.amount) < 0 ? 'text-rose-300' : 'text-[#00E676]'}>{Number(t.amount) > 0 ? '+' : ''}{t.amount}</span> · {t.source} · {fmt(t.timestamp)}</p>)}{!data.transactions.length && <p className="text-xs text-slate-500">Sem registros.</p>}</div>
      </section>
    </div>
  );
};
