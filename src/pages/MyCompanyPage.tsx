import React, { useEffect, useRef, useState } from 'react';
import { Building2, Globe, ImageUp, Link2, Mail, MapPin, MessageSquare, Save, Smartphone, Store, Trash2, UploadCloud } from 'lucide-react';
import type { Company } from '../types';
import { apiRequest } from '../lib/api';

interface Props {
  companies: Company[];
  selectedCompany: Company | null;
  onRefreshCompanies: () => void;
  onSelectCompany: (company: Company | null) => void;
}

type Form = Partial<Company> & { socialLinks?: Record<string, string> };
const blank = (): Form => ({
  name: '', category: 'Comércio & Serviços', segment: '', description: '', website: '', androidApp: '', iosApp: '',
  phone: '', whatsapp: '', email: '', address: '', city: '', state: '', country: 'Brasil', targetAudience: '',
  coverageRegion: 'Nacional', differentials: '', brandTone: 'Profissional, Persuasivo e Inovador',
  goals: 'Aumentar autoridade e gerar novos leads qualificados', products: [], services: [], keywords: [], competitors: [],
  isPublicInVitrine: true, socialLinks: {}
});

export const MyCompanyPage: React.FC<Props> = ({ companies, selectedCompany, onRefreshCompanies, onSelectCompany }) => {
  const [form, setForm] = useState<Form>(blank());
  const [products, setProducts] = useState(''); const [services, setServices] = useState(''); const [keywords, setKeywords] = useState(''); const [competitors, setCompetitors] = useState('');
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedCompany) { setForm(blank()); setProducts(''); setServices(''); setKeywords(''); setCompetitors(''); return; }
    setForm({ ...selectedCompany, socialLinks: { ...(selectedCompany.socialLinks || {}) } as any });
    setProducts((selectedCompany.products || []).join(', ')); setServices((selectedCompany.services || []).join(', ')); setKeywords((selectedCompany.keywords || []).join(', ')); setCompetitors((selectedCompany.competitors || []).join(', '));
  }, [selectedCompany]);

  const update = (key: keyof Form, value: any) => setForm(current => ({ ...current, [key]: value }));
  const social = (key: string, value: string) => setForm(current => ({ ...current, socialLinks: { ...(current.socialLinks || {}), [key]: value } }));
  const csv = (value: string) => value.split(',').map(v => v.trim()).filter(Boolean).slice(0, 50);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setFeedback(null);
    try {
      const payload = { ...form, products: csv(products), services: csv(services), keywords: csv(keywords), competitors: csv(competitors) };
      if (selectedCompany?.id) {
        const data = await apiRequest<{ company: Company }>(`/api/companies/${selectedCompany.id}`, { method: 'PATCH', body: payload });
        onSelectCompany(data.company); setFeedback({ type: 'success', text: 'Brand Center atualizado e salvo no Firestore.' });
      } else {
        const data = await apiRequest<{ company: Company }>('/api/companies', { method: 'POST', body: payload });
        onSelectCompany(data.company); setFeedback({ type: 'success', text: 'Empresa cadastrada e pronta para o Froc.IA.' });
      }
      await onRefreshCompanies();
    } catch (err: any) { setFeedback({ type: 'error', text: err.message || 'Não foi possível salvar a empresa.' }); }
    finally { setSaving(false); }
  };

  const uploadLogo = async (file?: File) => {
    if (!file || !selectedCompany?.id) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { setFeedback({ type: 'error', text: 'Use uma logo PNG, JPG ou WEBP.' }); return; }
    if (file.size > 1_350_000) { setFeedback({ type: 'error', text: 'A logo deve ter no máximo 1,3 MB.' }); return; }
    setUploading(true); setFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      const data = await apiRequest<{ logoUrl: string }>(`/api/companies/${selectedCompany.id}/logo`, { method: 'POST', body: { dataUrl } });
      update('logoUrl', data.logoUrl); setFeedback({ type: 'success', text: 'Logo enviada para o Firebase Storage.' }); await onRefreshCompanies();
    } catch (err: any) { setFeedback({ type: 'error', text: err.message || 'Falha ao enviar logo.' }); }
    finally { setUploading(false); if (logoInput.current) logoInput.current.value = ''; }
  };

  const removeCompany = async () => {
    if (!selectedCompany?.id || !window.confirm(`Excluir permanentemente a empresa “${selectedCompany.name}”?`)) return;
    setDeleting(true); setFeedback(null);
    try { await apiRequest(`/api/companies/${selectedCompany.id}`, { method: 'DELETE' }); onSelectCompany(null); await onRefreshCompanies(); setFeedback({ type: 'success', text: 'Empresa removida.' }); }
    catch (err: any) { setFeedback({ type: 'error', text: err.message || 'Falha ao remover empresa.' }); }
    finally { setDeleting(false); }
  };

  const input = 'froc-input mt-1.5';
  return <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-xl font-black text-white"><Building2 className="text-cyan-400"/>{selectedCompany ? selectedCompany.name : 'Cadastrar nova empresa'}</h2><p className="mt-1 text-xs text-slate-400">Brand Center completo: estes dados alimentam IA, SEO, Vitrine, campanhas e Autopilot.</p></div><div className="flex flex-wrap gap-2">{selectedCompany && <button type="button" onClick={() => onSelectCompany(null)} className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-4 text-xs font-bold text-slate-200">+ Nova empresa</button>}{companies.length > 1 && <select value={selectedCompany?.id || ''} onChange={e => onSelectCompany(companies.find(c => c.id === e.target.value) || null)} className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-white"><option value="">Selecionar…</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div></header>

    {feedback && <div className={`rounded-2xl border p-4 text-xs ${feedback.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>{feedback.type === 'success' ? '✅' : '⚠️'} {feedback.text}</div>}

    <form onSubmit={save} className="space-y-6">
      <section className="froc-panel"><div className="mb-5 flex items-center gap-2"><UploadCloud size={17} className="text-cyan-400"/><h3 className="froc-section-title">Identidade da marca</h3></div><div className="grid gap-5 lg:grid-cols-[180px_1fr]"><div className="space-y-3"><div className="grid aspect-square place-items-center overflow-hidden rounded-3xl border border-slate-700 bg-slate-950">{form.logoUrl ? <img src={form.logoUrl} alt={`Logo ${form.name || ''}`} className="h-full w-full object-contain p-3"/> : <ImageUp size={42} className="text-slate-700"/>}</div><input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => void uploadLogo(e.target.files?.[0])}/><button type="button" disabled={!selectedCompany || uploading} onClick={() => logoInput.current?.click()} className="w-full min-h-10 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-200 disabled:opacity-40">{uploading ? 'Enviando…' : selectedCompany ? 'Enviar logo' : 'Salve a empresa primeiro'}</button><p className="text-center text-[9px] text-slate-500">PNG/JPG/WEBP • máx. 1,3 MB</p></div><div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold text-slate-300">Nome / marca *<input required value={form.name || ''} onChange={e => update('name', e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">Categoria *<select value={form.category || 'Comércio & Serviços'} onChange={e => update('category', e.target.value)} className={input}><option>Comércio & Serviços</option><option>Restaurantes & Gastronomia</option><option>Tecnologia & SaaS</option><option>E-commerce & Varejo</option><option>Saúde, Beleza & Bem-Estar</option><option>Serviços Profissionais & Consultoria</option><option>Imobiliária & Construção</option><option>Educação & Treinamentos</option><option>Moda & Vestuário</option></select></label><label className="text-xs font-semibold text-slate-300">Segmento<input value={form.segment || ''} onChange={e => update('segment', e.target.value)} className={input} placeholder="Ex: pizzaria artesanal premium"/></label><label className="text-xs font-semibold text-slate-300">Tom de voz<input value={form.brandTone || ''} onChange={e => update('brandTone', e.target.value)} className={input}/></label><label className="md:col-span-2 text-xs font-semibold text-slate-300">Descrição / história<textarea rows={4} value={form.description || ''} onChange={e => update('description', e.target.value)} className={`${input} resize-y`} placeholder="O que a empresa faz, para quem e por que é diferente…"/></label></div></div></section>

      <section className="froc-panel"><div className="mb-5 flex items-center gap-2"><Globe size={17} className="text-cyan-400"/><h3 className="froc-section-title">Presença digital e contato</h3></div><div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold text-slate-300">Website<input type="url" value={form.website || ''} onChange={e => update('website', e.target.value)} className={input} placeholder="https://…"/></label><label className="text-xs font-semibold text-slate-300">E-mail comercial<div className="relative"><Mail size={14} className="absolute left-3 top-4 text-slate-500"/><input type="email" value={form.email || ''} onChange={e => update('email', e.target.value)} className={`${input} pl-9`}/></div></label><label className="text-xs font-semibold text-slate-300">Telefone<input type="tel" value={form.phone || ''} onChange={e => update('phone', e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">WhatsApp<div className="relative"><MessageSquare size={14} className="absolute left-3 top-4 text-slate-500"/><input type="tel" value={form.whatsapp || ''} onChange={e => update('whatsapp', e.target.value)} className={`${input} pl-9`}/></div></label><label className="text-xs font-semibold text-slate-300">App Android<div className="relative"><Smartphone size={14} className="absolute left-3 top-4 text-slate-500"/><input type="url" value={form.androidApp || ''} onChange={e => update('androidApp', e.target.value)} className={`${input} pl-9`} placeholder="Link Google Play"/></div></label><label className="text-xs font-semibold text-slate-300">App iOS<input type="url" value={form.iosApp || ''} onChange={e => update('iosApp', e.target.value)} className={input} placeholder="Link App Store"/></label></div><div className="mt-5 grid gap-4 md:grid-cols-4"><label className="md:col-span-2 text-xs font-semibold text-slate-300">Endereço<div className="relative"><MapPin size={14} className="absolute left-3 top-4 text-slate-500"/><input value={form.address || ''} onChange={e => update('address', e.target.value)} className={`${input} pl-9`}/></div></label><label className="text-xs font-semibold text-slate-300">Cidade<input value={form.city || ''} onChange={e => update('city', e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">Estado<input value={form.state || ''} onChange={e => update('state', e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">País<input value={form.country || ''} onChange={e => update('country', e.target.value)} className={input}/></label><label className="md:col-span-3 text-xs font-semibold text-slate-300">Região de atendimento<input value={form.coverageRegion || ''} onChange={e => update('coverageRegion', e.target.value)} className={input}/></label></div></section>

      <section className="froc-panel"><div className="mb-5 flex items-center gap-2"><Store size={17} className="text-cyan-400"/><h3 className="froc-section-title">Marketing Intelligence Profile</h3></div><div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold text-slate-300">Produtos (separe por vírgula)<input value={products} onChange={e => setProducts(e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">Serviços (separe por vírgula)<input value={services} onChange={e => setServices(e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">Palavras-chave SEO<input value={keywords} onChange={e => setKeywords(e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">Concorrentes / referências<input value={competitors} onChange={e => setCompetitors(e.target.value)} className={input}/></label><label className="text-xs font-semibold text-slate-300">Público-alvo<textarea rows={3} value={form.targetAudience || ''} onChange={e => update('targetAudience', e.target.value)} className={`${input} resize-y`}/></label><label className="text-xs font-semibold text-slate-300">Diferenciais<textarea rows={3} value={form.differentials || ''} onChange={e => update('differentials', e.target.value)} className={`${input} resize-y`}/></label><label className="md:col-span-2 text-xs font-semibold text-slate-300">Objetivos de marketing<textarea rows={3} value={form.goals || ''} onChange={e => update('goals', e.target.value)} className={`${input} resize-y`}/></label></div></section>

      <section className="froc-panel"><div className="mb-5 flex items-center gap-2"><Link2 size={17} className="text-cyan-400"/><h3 className="froc-section-title">Links sociais públicos</h3></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[['instagram','Instagram'],['facebook','Facebook'],['tiktok','TikTok'],['youtube','YouTube'],['linkedin','LinkedIn'],['pinterest','Pinterest'],['x','X / Twitter']].map(([key,label]) => <label key={key} className="text-xs font-semibold text-slate-300">{label}<input type="url" value={form.socialLinks?.[key] || ''} onChange={e => social(key, e.target.value)} className={input} placeholder="https://…"/></label>)}</div></section>

      <section className="froc-panel flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-bold text-white"><Store size={17} className="text-cyan-400"/>Vitrine pública e SEO</div><p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-400">Quando ativado, os dados públicos desta empresa podem aparecer na Vitrine e no sitemap dinâmico. Dados financeiros, OAuth e configurações privadas nunca são expostos.</p></div><label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4"><input type="checkbox" checked={Boolean(form.isPublicInVitrine)} onChange={e => update('isPublicInVitrine', e.target.checked)}/><span className="text-xs font-bold text-white">{form.isPublicInVitrine ? 'Publicada' : 'Privada'}</span></label></section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">{selectedCompany ? <button type="button" disabled={deleting} onClick={removeCompany} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"><Trash2 size={15}/>{deleting ? 'Excluindo…' : 'Excluir empresa'}</button> : <span/>}<button disabled={saving} className="froc-primary inline-flex items-center justify-center gap-2 px-6"><Save size={15}/>{saving ? 'Salvando…' : selectedCompany ? 'Salvar Brand Center' : 'Cadastrar empresa'}</button></div>
    </form>
  </div>;
};
