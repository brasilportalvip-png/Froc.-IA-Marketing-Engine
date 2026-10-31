import React, { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, Eye, EyeOff, FolderKanban, Loader2, Pencil, PlusCircle, Power, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface AdminCompany { id: string; name: string; slug: string; userId: string; ownerName: string; ownerEmail: string; category: string; city: string; state: string; website: string; whatsapp: string; androidApp: string; iosApp: string; description: string; isPublicInVitrine: boolean; dailyPostsEnabled?: boolean; vitrineBillingExempt?: boolean; vitrineRemovedReason?: string | null; vitrinePosts: number; clicks?: { total: number; site: number; app: number; whatsapp: number }; updatedAt: string }
interface UserOption { id: string; name: string; email: string }

const EMPTY = { name: '', userId: '', description: '', website: '', whatsapp: '', androidApp: '', iosApp: '', city: '', state: '', category: '', isPublicInVitrine: true };

export const AdminProjects: React.FC<{ onFeedback: (message: string) => void }> = ({ onFeedback }) => {
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [siteDaily, setSiteDaily] = useState<boolean | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [c, u] = await Promise.all([
        apiRequest<{ companies: AdminCompany[] }>('/api/admin/companies'),
        apiRequest<{ users: UserOption[] }>('/api/admin/users')
      ]);
      setCompanies(c.companies || []);
      setUsers(u.users || []);
      const settings = await apiRequest<{ dailyPostsEnabled: boolean }>('/api/admin/settings/daily-posts').catch(() => null);
      if (settings) setSiteDaily(settings.dailyPostsEnabled);
    } catch (err: any) { onFeedback(err?.message || 'Falha ao carregar projetos.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => companies.filter((c) => `${c.name} ${c.ownerEmail} ${c.city} ${c.category}`.toLowerCase().includes(search.toLowerCase())), [companies, search]);

  const run = async (key: string, action: () => Promise<{ message?: string }>) => {
    setBusy(key);
    try { const result = await action(); onFeedback(result.message || 'Salvo.'); await load(); return true; }
    catch (err: any) { onFeedback(err?.message || 'Falha na operação.'); return false; }
    finally { setBusy(''); }
  };

  const startEdit = (c: AdminCompany) => {
    setEditing(c.id);
    setShowForm(true);
    setForm({ name: c.name, userId: c.userId, description: c.description, website: c.website, whatsapp: c.whatsapp, androidApp: c.androidApp || '', iosApp: c.iosApp || '', city: c.city, state: c.state, category: c.category, isPublicInVitrine: c.isPublicInVitrine });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await run('save', () => editing
      ? apiRequest(`/api/admin/companies/${encodeURIComponent(editing)}`, { method: 'PATCH', body: form })
      : apiRequest('/api/admin/companies', { method: 'POST', body: form }));
    if (ok) { setForm({ ...EMPTY }); setEditing(null); setShowForm(false); }
  };

  const field = (key: keyof typeof EMPTY, placeholder: string) => (
    <input value={String(form[key])} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="froc-input" placeholder={placeholder} aria-label={placeholder} />
  );

  return (
    <section className="froc-panel">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="froc-section-title flex items-center gap-2"><FolderKanban size={15} className="text-[#00E676]" /> Projetos ({companies.length})</h3>
        <div className="flex gap-2">
          <div className="relative w-full sm:w-64"><Search size={14} className="absolute left-3 top-3 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="froc-input pl-9" placeholder="Buscar projeto, dono, cidade…" /></div>
          <button onClick={() => { setShowForm((v) => !v); setEditing(null); setForm({ ...EMPTY }); }} className="froc-primary inline-flex shrink-0 items-center gap-1.5"><PlusCircle size={14} /> Novo projeto</button>
          <button onClick={() => void load()} className="froc-secondary shrink-0" aria-label="Atualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* Chave geral (somente admin): desligada = nenhum post e nenhuma cobrança no site inteiro. */}
      <div className={`mb-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${siteDaily === false ? 'border-[#FF2D87]/40 bg-[#FF2D87]/[0.06]' : 'border-[#00E676]/30 bg-[#00E676]/[0.05]'}`}>
        <div>
          <p className="flex items-center gap-2 text-sm font-black text-white"><Power size={15} className={siteDaily === false ? 'text-[#FF2D87]' : 'text-[#00E676]'} /> Post diário do site: {siteDaily === null ? '…' : siteDaily ? 'LIGADO' : 'DESLIGADO'}</p>
          <p className="mt-1 text-[11px] text-slate-400">Ligado: cada projeto da Vitrine ganha 1 post por dia e paga 10 créditos. Desligado: nenhum post e nenhuma cobrança. Só o administrador controla.</p>
        </div>
        <button disabled={Boolean(busy) || siteDaily === null} onClick={() => run('site-daily', async () => { const r = await apiRequest<{ message: string; dailyPostsEnabled: boolean }>('/api/admin/settings/daily-posts', { method: 'PATCH', body: { dailyPostsEnabled: !siteDaily } }); setSiteDaily(r.dailyPostsEnabled); return r; })} className={`inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2 text-xs font-black ${siteDaily ? 'bg-[#FF2D87] text-white' : 'bg-[#00E676] text-black'}`}>
          {busy === 'site-daily' ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} {siteDaily ? 'Desligar para todos' : 'Ligar para todos'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="mb-5 space-y-2 rounded-2xl border border-[#FFD400]/30 bg-[#FFD400]/[0.03] p-4">
          <div className="flex items-center justify-between"><p className="text-sm font-bold text-white">{editing ? 'Editar projeto' : 'Novo projeto'}</p><button type="button" onClick={() => { setShowForm(false); setEditing(null); }} aria-label="Fechar"><X size={15} className="text-slate-400" /></button></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {field('name', 'Nome do projeto / marca')}
            <select value={form.userId} onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))} className="froc-input" aria-label="Dono do projeto">
              <option value="">Eu (administrador) — sem limite</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name || 'Sem nome'} — {u.email}</option>)}
            </select>
            {field('website', 'Site (https://…)')}
            {field('whatsapp', 'WhatsApp')}
            {field('androidApp', 'App na Google Play (opcional)')}
            {field('iosApp', 'App na App Store (opcional)')}
            {field('city', 'Cidade')}
            {field('state', 'Estado')}
            {field('category', 'Categoria')}
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.isPublicInVitrine} onChange={(e) => setForm((f) => ({ ...f, isPublicInVitrine: e.target.checked }))} /> Publicar na Vitrine (post diário automático)</label>
          </div>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="froc-input min-h-20" placeholder="Descrição" aria-label="Descrição" />
          <button disabled={busy === 'save'} className="froc-primary inline-flex items-center gap-1.5">{busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar projeto</button>
        </form>
      )}

      <div className="space-y-2">
        {filtered.map((c) => (
          <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{c.name} {c.isPublicInVitrine && <span className="ml-1 rounded bg-[#00E676]/15 px-1.5 text-[9px] font-black text-[#00E676]">VITRINE</span>}
                {c.isPublicInVitrine && <span className={`ml-1 rounded px-1.5 text-[9px] font-black ${c.dailyPostsEnabled === false ? 'bg-[#FF2D87]/15 text-[#ff7ab3]' : 'bg-[#FFD400]/15 text-[#FFD400]'}`}>{c.dailyPostsEnabled === false ? 'POST DIÁRIO OFF' : 'POST DIÁRIO ON'}</span>}
                {c.vitrineBillingExempt && <span className="ml-1 rounded bg-white/10 px-1.5 text-[9px] font-black text-white">ISENTO</span>}
                {!c.isPublicInVitrine && c.vitrineRemovedReason && <span className="ml-1 rounded bg-[#FF2D87]/15 px-1.5 text-[9px] font-black text-[#ff7ab3]">{c.vitrineRemovedReason === 'no_credits' ? 'SAIU: SEM CRÉDITOS' : 'SAIU: SEM PLANO'}</span>}</p>
              <p className="text-[11px] text-slate-500">{c.ownerName || '—'} · {c.ownerEmail} · {[c.city, c.state].filter(Boolean).join(' - ') || 'sem cidade'} · {c.vitrinePosts} posts · {c.clicks?.total || 0} cliques (site {c.clicks?.site || 0} · app {c.clicks?.app || 0} · WhatsApp {c.clicks?.whatsapp || 0}){(c.androidApp || c.iosApp) ? ' · 📱 tem app' : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {c.isPublicInVitrine && <a href={`/vitrine/${encodeURIComponent(c.slug)}`} target="_blank" rel="noreferrer" className="froc-secondary text-[11px]">Ver</a>}
              <button disabled={Boolean(busy)} onClick={() => run(`v-${c.id}`, () => apiRequest(`/api/admin/companies/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: { isPublicInVitrine: !c.isPublicInVitrine } }))} className="froc-secondary inline-flex items-center gap-1 text-[11px]">{c.isPublicInVitrine ? <EyeOff size={12} /> : <Eye size={12} />} {c.isPublicInVitrine ? 'Tirar da vitrine' : 'Pôr na vitrine'}</button>
              <button disabled={Boolean(busy)} onClick={() => run(`p-${c.id}`, () => apiRequest(`/api/admin/companies/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: { dailyPostsEnabled: c.dailyPostsEnabled === false } }))} className="froc-secondary inline-flex items-center gap-1 text-[11px]" title="Ligado: 1 post por dia e cobrança da diária. Desligado: sem post e sem cobrança."><Power size={12} /> {c.dailyPostsEnabled === false ? 'Ligar post diário' : 'Desligar post diário'}</button>
              <button disabled={Boolean(busy)} onClick={() => run(`b-${c.id}`, () => apiRequest(`/api/admin/companies/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: { vitrineBillingExempt: !c.vitrineBillingExempt } }))} className="froc-secondary inline-flex items-center gap-1 text-[11px]" title="Isento: o projeto não paga a diária da vitrine."><BadgeDollarSign size={12} /> {c.vitrineBillingExempt ? 'Cobrar diária' : 'Isentar diária'}</button>
              <button onClick={() => startEdit(c)} className="froc-secondary inline-flex items-center gap-1 text-[11px]"><Pencil size={12} /> Editar</button>
              <button disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Excluir o projeto "${c.name}" e todos os dados dele?`)) void run(`d-${c.id}`, () => apiRequest(`/api/admin/companies/${encodeURIComponent(c.id)}`, { method: 'DELETE' })); }} className="inline-flex items-center gap-1 rounded-xl border border-rose-500/40 px-3 text-[11px] font-bold text-rose-300"><Trash2 size={12} /> Excluir</button>
            </div>
          </div>
        ))}
        {!filtered.length && !loading && <p className="text-xs text-slate-500">Nenhum projeto encontrado.</p>}
      </div>
    </section>
  );
};
