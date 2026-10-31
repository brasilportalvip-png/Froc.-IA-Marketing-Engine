import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Coins, Crown, Loader2, MinusCircle, PlusCircle, RefreshCw, Search, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface WalletSummary { balance: number; bonusBalance: number; reservedCredits: number; totalUsed: number; totalReceived: number; planId: string; planStatus: string; currentPeriodEnd: string | null }
interface AdminUser { id: string; name: string; email: string; role: string; disabled?: boolean; createdAt?: string; wallet: WalletSummary; companies: number }
interface UserDetail {
  user: AdminUser;
  wallet: WalletSummary;
  companies: Array<{ id: string; name: string; slug: string; isPublicInVitrine: boolean; city?: string }>;
  transactions: Array<{ id: string; type: string; source: string; amount: number; balanceAfter: number; timestamp: string }>;
  contents: Array<{ id: string; type: string; title: string; creditsUsed: number; createdAt: string }>;
  payments: Array<{ id: string; planId: string; amount: number; status: string; source?: string; createdAt: string }>;
}

const PLAN_LABEL: Record<string, string> = { plan_free: 'Grátis', plan_start: 'START', plan_pro: 'PRO', plan_business: 'BUSINESS', plan_agency: 'AGENCY' };
const fmtDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('pt-BR') : '—';

export const AdminUsers: React.FC<{ onFeedback: (message: string) => void }> = ({ onFeedback }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setUsers((await apiRequest<{ users: AdminUser[] }>('/api/admin/users')).users || []); }
    catch (err: any) { onFeedback(err?.message || 'Falha ao carregar usuários.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => users.filter((u) => `${u.name} ${u.email} ${u.role} ${PLAN_LABEL[u.wallet.planId] || ''}`.toLowerCase().includes(search.toLowerCase())), [users, search]);

  return (
    <section className="froc-panel">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="froc-section-title flex items-center gap-2"><UserRound size={15} className="text-[#FFD400]" /> Usuários ({users.length})</h3>
        <div className="flex gap-2">
          <div className="relative w-full sm:w-72"><Search size={14} className="absolute left-3 top-3 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="froc-input pl-9" placeholder="Buscar nome, e-mail, plano…" /></div>
          <button onClick={() => void load()} className="froc-secondary shrink-0" aria-label="Atualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="sticky top-0 bg-[#0d0d0d] text-[10px] uppercase text-slate-500"><tr><th className="p-2">Usuário</th><th className="p-2">Plano</th><th className="p-2">Créditos</th><th className="p-2">Projetos</th><th className="p-2">Papel</th><th className="p-2">Criado</th><th className="p-2" /></tr></thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-slate-800 hover:bg-white/[0.02]">
                <td className="p-2"><div className="font-semibold text-white">{u.name || '—'} {u.disabled && <span className="ml-1 rounded bg-rose-500/20 px-1.5 text-[9px] text-rose-300">BLOQUEADO</span>}</div><div className="text-slate-500">{u.email}</div></td>
                <td className="p-2 text-slate-300">{PLAN_LABEL[u.wallet.planId] || u.wallet.planId}</td>
                <td className="p-2 font-bold text-[#FFD400]">{u.wallet.balance.toLocaleString('pt-BR')}</td>
                <td className="p-2 text-slate-300">{u.companies}</td>
                <td className="p-2 text-cyan-300">{u.role}</td>
                <td className="p-2 text-slate-500">{fmtDate(u.createdAt)}</td>
                <td className="p-2 text-right"><button onClick={() => setSelected(u.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-white hover:border-[#FFD400]">Gerenciar</button></td>
              </tr>
            ))}
            {!filtered.length && !loading && <tr><td colSpan={7} className="p-4 text-center text-slate-500">Nenhum usuário encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      {selected && <UserDrawer userId={selected} onClose={() => setSelected(null)} onChanged={(message) => { onFeedback(message); void load(); }} onDeleted={(message) => { onFeedback(message); setSelected(null); void load(); }} />}
    </section>
  );
};

const UserDrawer: React.FC<{ userId: string; onClose: () => void; onChanged: (message: string) => void; onDeleted: (message: string) => void }> = ({ userId, onClose, onChanged, onDeleted }) => {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState('Ajuste administrativo');
  const [planId, setPlanId] = useState('plan_pro');
  const [days, setDays] = useState(30);
  const [withCredits, setWithCredits] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState('');

  const load = async () => {
    try { setDetail(await apiRequest<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`)); }
    catch (err: any) { setError(err?.message || 'Falha ao carregar o usuário.'); }
  };
  useEffect(() => { void load(); }, [userId]);

  const run = async (key: string, action: () => Promise<{ message?: string }>) => {
    setBusy(key); setError('');
    try { const result = await action(); onChanged(result.message || 'Alteração salva.'); await load(); }
    catch (err: any) { setError(err?.message || 'Falha na operação.'); }
    finally { setBusy(''); }
  };

  const u = detail?.user;
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-[#080808] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-black text-white">{u?.name || 'Carregando…'}</h3><p className="text-xs text-slate-400">{u?.email} · ID {userId}</p></div>
          <button onClick={onClose} className="rounded-xl border border-slate-700 p-2 text-slate-300 hover:text-white" aria-label="Fechar"><X size={16} /></button>
        </div>
        {error && <p className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</p>}
        {!detail ? <Loader2 className="mx-auto mt-10 animate-spin text-[#FFD400]" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Saldo', detail.wallet.balance], ['Bônus', detail.wallet.bonusBalance], ['Reservado', detail.wallet.reservedCredits], ['Usado', detail.wallet.totalUsed]].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-[10px] uppercase text-slate-500">{label}</p><p className="text-xl font-black text-white">{Number(value).toLocaleString('pt-BR')}</p></div>
              ))}
            </div>
            <p className="text-xs text-slate-400">Plano: <strong className="text-white">{PLAN_LABEL[detail.wallet.planId] || detail.wallet.planId}</strong> ({detail.wallet.planStatus}){detail.wallet.currentPeriodEnd ? ` até ${fmtDate(detail.wallet.currentPeriodEnd)}` : ''}</p>

            <div className="rounded-2xl border border-slate-800 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-white"><Coins size={15} className="text-[#FFD400]" /> Créditos</h4>
              <div className="grid gap-2 sm:grid-cols-3">
                <input type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="froc-input" aria-label="Quantidade" />
                <input value={reason} onChange={(e) => setReason(e.target.value)} className="froc-input sm:col-span-2" placeholder="Motivo" aria-label="Motivo" />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button disabled={Boolean(busy)} onClick={() => run('add', () => apiRequest('/api/admin/grant-credits', { method: 'POST', body: { userId, amount, reason } }))} className="froc-primary inline-flex items-center gap-1.5">{busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <PlusCircle size={13} />} Adicionar</button>
                <button disabled={Boolean(busy)} onClick={() => run('remove', () => apiRequest('/api/admin/remove-credits', { method: 'POST', body: { userId, amount, reason } }))} className="froc-secondary inline-flex items-center gap-1.5">{busy === 'remove' ? <Loader2 size={13} className="animate-spin" /> : <MinusCircle size={13} />} Remover</button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-white"><Crown size={15} className="text-[#FF2D87]" /> Plano</h4>
              <div className="grid gap-2 sm:grid-cols-3">
                <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="froc-input" aria-label="Plano">{['plan_start', 'plan_pro', 'plan_business', 'plan_agency'].map((id) => <option key={id} value={id}>{PLAN_LABEL[id]}</option>)}</select>
                <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} className="froc-input" aria-label="Dias" />
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={withCredits} onChange={(e) => setWithCredits(e.target.checked)} /> Incluir créditos do plano</label>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button disabled={Boolean(busy)} onClick={() => run('plan', () => apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/plan`, { method: 'POST', body: { planId, days, withCredits } }))} className="froc-primary">Ativar plano</button>
                <button disabled={Boolean(busy)} onClick={() => run('revoke', () => apiRequest(`/api/admin/users/${encodeURIComponent(userId)}/plan`, { method: 'POST', body: { revoke: true } }))} className="froc-secondary">Revogar planos concedidos</button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck size={15} className="text-[#00E676]" /> Acesso</h4>
              <div className="flex flex-wrap items-center gap-2">
                <select value={u?.role} onChange={(e) => run('role', () => apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { role: e.target.value } }))} className="froc-input w-auto" aria-label="Papel">
                  {['user', 'editor', 'support', 'admin'].map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <button disabled={Boolean(busy)} onClick={() => run('block', () => apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { disabled: !u?.disabled } }))} className="froc-secondary inline-flex items-center gap-1.5"><Ban size={13} /> {u?.disabled ? 'Desbloquear conta' : 'Bloquear conta'}</button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 p-4">
              <h4 className="mb-2 text-sm font-bold text-white">Projetos ({detail.companies.length})</h4>
              {detail.companies.length ? detail.companies.map((c) => <p key={c.id} className="text-xs text-slate-300">• {c.name} {c.isPublicInVitrine ? <a className="text-[#FFD400]" href={`/vitrine/${encodeURIComponent(c.slug)}`} target="_blank" rel="noreferrer">(na vitrine)</a> : ''}</p>) : <p className="text-xs text-slate-500">Nenhum projeto.</p>}
            </div>

            <div className="rounded-2xl border border-slate-800 p-4">
              <h4 className="mb-2 text-sm font-bold text-white">Extrato de créditos</h4>
              <div className="max-h-56 space-y-1 overflow-auto">
                {detail.transactions.length ? detail.transactions.map((t) => (
                  <div key={t.id} className="flex justify-between gap-2 text-[11px]"><span className="truncate text-slate-400">{fmtDate(t.timestamp)} · {t.source}</span><span className={t.amount < 0 ? 'text-rose-300' : 'text-[#00E676]'}>{t.amount > 0 ? '+' : ''}{t.amount}</span></div>
                )) : <p className="text-xs text-slate-500">Sem movimentações.</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 p-4">
              <h4 className="mb-2 text-sm font-bold text-white">Pagamentos ({detail.payments.length}) · Conteúdos recentes ({detail.contents.length})</h4>
              {detail.payments.slice(0, 8).map((p) => <p key={p.id} className="text-[11px] text-slate-400">{fmtDate(p.createdAt)} · {PLAN_LABEL[p.planId] || p.planId} · R$ {Number(p.amount || 0).toFixed(2)} · {p.status}{p.source === 'admin_grant' ? ' (admin)' : ''}</p>)}
            </div>

            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-4">
              <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-rose-200"><Trash2 size={15} /> Excluir perfil</h4>
              <p className="mb-2 text-[11px] text-rose-200/80">Remove conta, projetos, conteúdos, posts da vitrine e login. Pagamentos e extrato ficam guardados para auditoria. Digite o e-mail para confirmar.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} className="froc-input" placeholder={u?.email} aria-label="Confirmar e-mail" />
                <button
                  disabled={Boolean(busy) || confirmDelete.trim() !== u?.email}
                  onClick={async () => {
                    setBusy('delete'); setError('');
                    try { const result = await apiRequest<{ message: string }>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', body: { confirm: confirmDelete.trim() } }); onDeleted(result.message); }
                    catch (err: any) { setError(err?.message || 'Falha ao excluir.'); setBusy(''); }
                  }}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                >{busy === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir definitivamente</button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
