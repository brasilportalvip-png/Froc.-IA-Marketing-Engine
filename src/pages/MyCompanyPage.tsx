import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Globe,
  ImageUp,
  Laptop,
  Layers,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Save,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Store,
  Trash2,
  UploadCloud
} from 'lucide-react';
import type { Company } from '../types';
import { apiRequest } from '../lib/api';

interface Props {
  companies: Company[];
  selectedCompany: Company | null;
  onRefreshCompanies: () => void;
  onSelectCompany: (company: Company | null) => void;
}

type Form = Partial<Company> & { socialLinks?: Record<string, string> };

const ONLINE_CHANNEL_PRESETS = [
  'Loja Virtual / E-commerce',
  'WhatsApp / Atendimento Remoto',
  'Hotmart / Kiwify / Eduzz',
  'Marketplaces (Mercado Livre, Shopee, Amazon)',
  'SaaS / Plataforma Web',
  'Landing Page / Link na Bio',
  'Instagram Shopping & TikTok Shop',
  'Mentoria & Consultoria Digital'
];

const blank = (): Form => ({
  name: '',
  businessType: 'online',
  onlineChannels: ['Loja Virtual / E-commerce', 'WhatsApp / Atendimento Remoto'],
  category: 'Tecnologia & SaaS',
  segment: '',
  description: '',
  website: '',
  androidApp: '',
  iosApp: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  city: '',
  state: '',
  country: 'Brasil',
  targetAudience: '',
  coverageRegion: 'Nacional (Todo o Brasil)',
  differentials: '',
  brandTone: 'Profissional, Persuasivo e Inovador',
  goals: 'Aumentar autoridade e gerar novos leads qualificados',
  products: [],
  services: [],
  keywords: [],
  competitors: [],
  isPublicInVitrine: true,
  socialLinks: {}
});

export const MyCompanyPage: React.FC<Props> = ({
  companies,
  selectedCompany,
  onRefreshCompanies,
  onSelectCompany
}) => {
  const [form, setForm] = useState<Form>(blank());
  const [products, setProducts] = useState('');
  const [services, setServices] = useState('');
  const [keywords, setKeywords] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedCompany) {
      setForm(blank());
      setProducts('');
      setServices('');
      setKeywords('');
      setCompetitors('');
      return;
    }
    setForm({
      ...selectedCompany,
      businessType: selectedCompany.businessType || 'online',
      onlineChannels: selectedCompany.onlineChannels || [],
      socialLinks: { ...(selectedCompany.socialLinks || {}) } as any
    });
    setProducts((selectedCompany.products || []).join(', '));
    setServices((selectedCompany.services || []).join(', '));
    setKeywords((selectedCompany.keywords || []).join(', '));
    setCompetitors((selectedCompany.competitors || []).join(', '));
  }, [selectedCompany]);

  const update = (key: keyof Form, value: any) => setForm((current) => ({ ...current, [key]: value }));
  const social = (key: string, value: string) =>
    setForm((current) => ({ ...current, socialLinks: { ...(current.socialLinks || {}), [key]: value } }));
  const csv = (value: string) =>
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 50);

  const toggleChannel = (channel: string) => {
    setForm((current) => {
      const existing = current.onlineChannels || [];
      const updated = existing.includes(channel)
        ? existing.filter((c) => c !== channel)
        : [...existing, channel];
      return { ...current, onlineChannels: updated };
    });
  };

  const setBusinessType = (type: 'online' | 'physical' | 'hybrid') => {
    setForm((current) => ({
      ...current,
      businessType: type,
      coverageRegion:
        type === 'online' && (!current.coverageRegion || current.coverageRegion === 'Local')
          ? 'Nacional (Todo o Brasil)'
          : current.coverageRegion
    }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const payload = {
        ...form,
        products: csv(products),
        services: csv(services),
        keywords: csv(keywords),
        competitors: csv(competitors)
      };
      if (selectedCompany?.id) {
        const data = await apiRequest<{ company: Company }>(`/api/companies/${selectedCompany.id}`, {
          method: 'PATCH',
          body: payload
        });
        onSelectCompany(data.company);
        setFeedback({ type: 'success', text: 'Brand Center atualizado e salvo no Firestore.' });
      } else {
        const data = await apiRequest<{ company: Company }>('/api/companies', {
          method: 'POST',
          body: payload
        });
        onSelectCompany(data.company);
        setFeedback({ type: 'success', text: 'Empresa cadastrada e pronta para o Froc.IA.' });
      }
      await onRefreshCompanies();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Não foi possível salvar a empresa.' });
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file?: File) => {
    if (!file || !selectedCompany?.id) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setFeedback({ type: 'error', text: 'Use uma logo PNG, JPG ou WEBP.' });
      return;
    }
    if (file.size > 1_350_000) {
      setFeedback({ type: 'error', text: 'A logo deve ter no máximo 1,3 MB.' });
      return;
    }
    setUploading(true);
    setFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const data = await apiRequest<{ logoUrl: string }>(`/api/companies/${selectedCompany.id}/logo`, {
        method: 'POST',
        body: { dataUrl }
      });
      update('logoUrl', data.logoUrl);
      setFeedback({ type: 'success', text: 'Logo enviada para o Firebase Storage.' });
      await onRefreshCompanies();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao enviar logo.' });
    } finally {
      setUploading(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  };

  const removeCompany = async () => {
    if (!selectedCompany?.id || !window.confirm(`Excluir permanentemente a empresa “${selectedCompany.name}”?`)) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await apiRequest(`/api/companies/${selectedCompany.id}`, { method: 'DELETE' });
      onSelectCompany(null);
      await onRefreshCompanies();
      setFeedback({ type: 'success', text: 'Empresa removida com sucesso.' });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao remover empresa.' });
    } finally {
      setDeleting(false);
    }
  };

  const isOnline = form.businessType === 'online';
  const isPhysical = form.businessType === 'physical';
  const isHybrid = form.businessType === 'hybrid';
  const input = 'froc-input mt-1.5';

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-white">
            <Building2 className="text-cyan-400" />
            {selectedCompany ? selectedCompany.name : 'Cadastrar nova empresa'}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Brand Center completo: estes dados alimentam IA, SEO, Vitrine, campanhas e Autopilot.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedCompany && (
            <button
              type="button"
              onClick={() => onSelectCompany(null)}
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-4 text-xs font-bold text-slate-200 hover:border-cyan-500/40 hover:text-white"
            >
              + Nova empresa
            </button>
          )}
          {companies.length > 1 && (
            <select
              value={selectedCompany?.id || ''}
              onChange={(e) => onSelectCompany(companies.find((c) => c.id === e.target.value) || null)}
              className="min-h-10 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs text-white"
            >
              <option value="">Selecionar empresa…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.businessType === 'online' ? '(100% Online)' : c.businessType === 'hybrid' ? '(Híbrida)' : '(Física)'}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {feedback && (
        <div
          className={`rounded-2xl border p-4 text-xs ${
            feedback.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? '✅' : '⚠️'} {feedback.text}
        </div>
      )}

      <form onSubmit={save} className="space-y-6">
        {/* SEÇÃO NOBRE: MODELO DE OPERAÇÃO (ONLINE vs FÍSICA vs HÍBRIDA) */}
        <section className="froc-panel border-cyan-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950/40">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-cyan-400" />
              <h3 className="froc-section-title">Modelo de Operação do Negócio *</h3>
            </div>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold text-cyan-300">
              Calibra IA & Estratégias
            </span>
          </div>

          <p className="mb-5 text-xs text-slate-300 leading-relaxed">
            Selecione como seu negócio funciona. Isso calibra o tom das copies, as chamadas para ação (CTAs), a vitrine e o planejamento de SEO gerado pela IA.
          </p>

          <div className="grid gap-3 md:grid-cols-3">
            {/* Opção 1: 100% Online */}
            <button
              type="button"
              onClick={() => setBusinessType('online')}
              className={`relative flex flex-col justify-between rounded-2xl border p-5 text-left transition-all ${
                isOnline
                  ? 'border-cyan-400 bg-cyan-950/40 shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-400'
                  : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                    <Laptop size={22} />
                  </div>
                  {isOnline && <CheckCircle2 size={18} className="text-cyan-400" />}
                </div>
                <h4 className="mt-3 text-sm font-bold text-white">100% Online / Digital</h4>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  Para quem trabalha online, e-commerce, infoprodutos, criadores de conteúdo, SaaS, afiliados, serviços remotos ou freelancers.
                </p>
              </div>
              <div className="mt-4 border-t border-slate-800/80 pt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
                  <Globe size={12} /> Sem necessidade de endereço físico
                </span>
              </div>
            </button>

            {/* Opção 2: Empresa Física */}
            <button
              type="button"
              onClick={() => setBusinessType('physical')}
              className={`relative flex flex-col justify-between rounded-2xl border p-5 text-left transition-all ${
                isPhysical
                  ? 'border-emerald-400 bg-emerald-950/40 shadow-lg shadow-emerald-950/50 ring-1 ring-emerald-400'
                  : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    <Store size={22} />
                  </div>
                  {isPhysical && <CheckCircle2 size={18} className="text-emerald-400" />}
                </div>
                <h4 className="mt-3 text-sm font-bold text-white">Empresa Física / Ponto Local</h4>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  Para lojas de rua, consultórios, clínicas, restaurantes, escritórios, salões e empresas com atendimento presencial.
                </p>
              </div>
              <div className="mt-4 border-t border-slate-800/80 pt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                  <MapPin size={12} /> Foco em tráfego local e visitas
                </span>
              </div>
            </button>

            {/* Opção 3: Híbrida */}
            <button
              type="button"
              onClick={() => setBusinessType('hybrid')}
              className={`relative flex flex-col justify-between rounded-2xl border p-5 text-left transition-all ${
                isHybrid
                  ? 'border-purple-400 bg-purple-950/40 shadow-lg shadow-purple-950/50 ring-1 ring-purple-400'
                  : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-300">
                    <Layers size={22} />
                  </div>
                  {isHybrid && <CheckCircle2 size={18} className="text-purple-400" />}
                </div>
                <h4 className="mt-3 text-sm font-bold text-white">Modelo Híbrido</h4>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  Para empresas que combinam ponto físico presencial com vendas, entregas ou atendimentos digitais simultâneos.
                </p>
              </div>
              <div className="mt-4 border-t border-slate-800/80 pt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-purple-300">
                  <ShoppingBag size={12} /> Presencial + Vendas Online
                </span>
              </div>
            </button>
          </div>

          {/* Canais Digitais (quando for Online ou Híbrida) */}
          {(isOnline || isHybrid) && (
            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h5 className="text-xs font-bold text-slate-200">
                  Canais e Plataformas Online Utilizados:
                </h5>
                <span className="text-[11px] text-slate-400">Clique para ativar/desativar</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ONLINE_CHANNEL_PRESETS.map((channel) => {
                  const active = (form.onlineChannels || []).includes(channel);
                  return (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => toggleChannel(channel)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
                        active
                          ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {active ? '✓ ' : '+ '}
                      {channel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* IDENTIDADE DA MARCA */}
        <section className="froc-panel">
          <div className="mb-5 flex items-center gap-2">
            <UploadCloud size={17} className="text-cyan-400" />
            <h3 className="froc-section-title">Identidade da marca</h3>
          </div>
          <div className="grid gap-5 lg:grid-cols-[180px_1fr]">
            <div className="space-y-3">
              <div className="grid aspect-square place-items-center overflow-hidden rounded-3xl border border-slate-700 bg-slate-950">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt={`Logo ${form.name || ''}`} className="h-full w-full object-contain p-3" />
                ) : (
                  <ImageUp size={42} className="text-slate-700" />
                )}
              </div>
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void uploadLogo(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={!selectedCompany || uploading}
                onClick={() => logoInput.current?.click()}
                className="w-full min-h-10 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-200 disabled:opacity-40 hover:bg-cyan-500/20"
              >
                {uploading ? 'Enviando…' : selectedCompany ? 'Enviar logo' : 'Salve a empresa primeiro'}
              </button>
              <p className="text-center text-[9px] text-slate-500">PNG/JPG/WEBP • máx. 1,3 MB</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-300">
                Nome / marca *
                <input
                  required
                  value={form.name || ''}
                  onChange={(e) => update('name', e.target.value)}
                  className={input}
                  placeholder="Ex: CyberStore, Portal VIP, Studio IA"
                />
              </label>

              <label className="text-xs font-semibold text-slate-300">
                Categoria *
                <select
                  value={form.category || 'Tecnologia & SaaS'}
                  onChange={(e) => update('category', e.target.value)}
                  className={input}
                >
                  <option>Tecnologia & SaaS</option>
                  <option>E-commerce & Varejo Online</option>
                  <option>Infoprodutos & Cursos Online</option>
                  <option>Serviços Digitais & Freelancer</option>
                  <option>Marketing, Tráfego & Design</option>
                  <option>Comércio & Serviços</option>
                  <option>Restaurantes & Gastronomia</option>
                  <option>Saúde, Beleza & Bem-Estar</option>
                  <option>Serviços Profissionais & Consultoria</option>
                  <option>Imobiliária & Construção</option>
                  <option>Educação & Treinamentos</option>
                  <option>Moda & Vestuário</option>
                </select>
              </label>

              <label className="text-xs font-semibold text-slate-300">
                Segmento / Nicho
                <input
                  value={form.segment || ''}
                  onChange={(e) => update('segment', e.target.value)}
                  className={input}
                  placeholder={isOnline ? 'Ex: E-commerce de moda fitness sustentável' : 'Ex: Pizzaria artesanal premium'}
                />
              </label>

              <label className="text-xs font-semibold text-slate-300">
                Tom de voz da marca
                <input
                  value={form.brandTone || ''}
                  onChange={(e) => update('brandTone', e.target.value)}
                  className={input}
                  placeholder="Ex: Profissional, Persuasivo, Moderno e Acessível"
                />
              </label>

              <label className="md:col-span-2 text-xs font-semibold text-slate-300">
                Descrição / História do negócio
                <textarea
                  rows={4}
                  value={form.description || ''}
                  onChange={(e) => update('description', e.target.value)}
                  className={`${input} resize-y`}
                  placeholder="Explique o que seu negócio faz, seus diferenciais e para quem você vende…"
                />
              </label>
            </div>
          </div>
        </section>

        {/* PRESENÇA DIGITAL E CONTATO */}
        <section className="froc-panel">
          <div className="mb-5 flex items-center gap-2">
            <Globe size={17} className="text-cyan-400" />
            <h3 className="froc-section-title">Presença Digital & Canais de Atendimento</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-300">
              Website / Loja Virtual / Landing Page
              <input
                type="url"
                value={form.website || ''}
                onChange={(e) => update('website', e.target.value)}
                className={input}
                placeholder="https://sualoja.com.br"
              />
            </label>

            <label className="text-xs font-semibold text-slate-300">
              E-mail comercial
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-4 text-slate-500" />
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => update('email', e.target.value)}
                  className={`${input} pl-9`}
                  placeholder="contato@suaempresa.com"
                />
              </div>
            </label>

            <label className="text-xs font-semibold text-slate-300">
              WhatsApp Comercial {isOnline && '(Canal principal de vendas)'}
              <div className="relative">
                <MessageSquare size={14} className="absolute left-3 top-4 text-slate-500" />
                <input
                  type="tel"
                  value={form.whatsapp || ''}
                  onChange={(e) => update('whatsapp', e.target.value)}
                  className={`${input} pl-9`}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Telefone Fixo / Suporte
              <input
                type="tel"
                value={form.phone || ''}
                onChange={(e) => update('phone', e.target.value)}
                className={input}
                placeholder="(11) 3333-3333"
              />
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Link App Android (Google Play)
              <div className="relative">
                <Smartphone size={14} className="absolute left-3 top-4 text-slate-500" />
                <input
                  type="url"
                  value={form.androidApp || ''}
                  onChange={(e) => update('androidApp', e.target.value)}
                  className={`${input} pl-9`}
                  placeholder="https://play.google.com/store/apps/..."
                />
              </div>
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Link App iOS (App Store)
              <input
                type="url"
                value={form.iosApp || ''}
                onChange={(e) => update('iosApp', e.target.value)}
                className={input}
                placeholder="https://apps.apple.com/app/..."
              />
            </label>
          </div>

          {/* LOCALIZAÇÃO E COBERTURA */}
          <div className="mt-7 border-t border-slate-800 pt-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-cyan-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  {isOnline ? 'Região de Atendimento & Sede Opcional' : 'Endereço Físico & Área de Cobertura'}
                </h4>
              </div>
              {isOnline && (
                <span className="rounded-lg bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-300">
                  🌐 Endereço de rua opcional para negócios online
                </span>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <label className="md:col-span-2 text-xs font-semibold text-slate-300">
                Região de atendimento *
                <input
                  value={form.coverageRegion || ''}
                  onChange={(e) => update('coverageRegion', e.target.value)}
                  className={input}
                  placeholder={isOnline ? 'Ex: Todo o Brasil / Nacional' : 'Ex: São Paulo - SP e raio de 20km'}
                />
              </label>

              <label className="text-xs font-semibold text-slate-300">
                País
                <input
                  value={form.country || ''}
                  onChange={(e) => update('country', e.target.value)}
                  className={input}
                  placeholder="Brasil"
                />
              </label>

              <label className="text-xs font-semibold text-slate-300">
                Estado / UF {isOnline && '(Opcional/Sede)'}
                <input
                  value={form.state || ''}
                  onChange={(e) => update('state', e.target.value)}
                  className={input}
                  placeholder="SP, RJ, MG..."
                />
              </label>

              <label className="text-xs font-semibold text-slate-300">
                Cidade {isOnline && '(Opcional/Sede)'}
                <input
                  value={form.city || ''}
                  onChange={(e) => update('city', e.target.value)}
                  className={input}
                  placeholder="Sua cidade"
                />
              </label>

              <label className="md:col-span-3 text-xs font-semibold text-slate-300">
                {isOnline ? 'Endereço físico (opcional - deixe em branco se for 100% digital)' : 'Endereço físico completo *'}
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-4 text-slate-500" />
                  <input
                    value={form.address || ''}
                    onChange={(e) => update('address', e.target.value)}
                    className={`${input} pl-9`}
                    placeholder={isOnline ? 'Não obrigatório para operações online' : 'Av. Paulista, 1000 - Bela Vista'}
                  />
                </div>
              </label>
            </div>
          </div>
        </section>

        {/* MARKETING INTELLIGENCE PROFILE */}
        <section className="froc-panel">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles size={17} className="text-cyan-400" />
            <h3 className="froc-section-title">Marketing Intelligence Profile</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-300">
              Produtos ofertados (separe por vírgula)
              <input
                value={products}
                onChange={(e) => setProducts(e.target.value)}
                className={input}
                placeholder={isOnline ? 'Ex: Curso de Tráfego Pago, E-book SEO, Mentoria VIP' : 'Ex: Pizza Margherita, Calzone Especial'}
              />
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Serviços ofertados (separe por vírgula)
              <input
                value={services}
                onChange={(e) => setServices(e.target.value)}
                className={input}
                placeholder="Ex: Consultoria online, Gestão de Anúncios, Otimização de Conversão"
              />
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Palavras-chave SEO
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className={input}
                placeholder="Ex: comprar online, agência digital, consultoria de marketing"
              />
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Concorrentes / Marcas de referência
              <input
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                className={input}
                placeholder="Ex: Marca A, Empresa B"
              />
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Público-alvo / Persona
              <textarea
                rows={3}
                value={form.targetAudience || ''}
                onChange={(e) => update('targetAudience', e.target.value)}
                className={`${input} resize-y`}
                placeholder="Quem compra seu produto/serviço? Faixa etária, desejos, dores e hábitos de compra online…"
              />
            </label>

            <label className="text-xs font-semibold text-slate-300">
              Diferenciais competitivos
              <textarea
                rows={3}
                value={form.differentials || ''}
                onChange={(e) => update('differentials', e.target.value)}
                className={`${input} resize-y`}
                placeholder="Frete grátis, suporte 24h via WhatsApp, garantia incondicional, método exclusivo…"
              />
            </label>

            <label className="md:col-span-2 text-xs font-semibold text-slate-300">
              Objetivos principais de marketing
              <textarea
                rows={3}
                value={form.goals || ''}
                onChange={(e) => update('goals', e.target.value)}
                className={`${input} resize-y`}
                placeholder="Aumentar vendas no site, gerar leads no WhatsApp, escalar infoproduto…"
              />
            </label>
          </div>
        </section>

        {/* REDES SOCIAIS */}
        <section className="froc-panel">
          <div className="mb-5 flex items-center gap-2">
            <Link2 size={17} className="text-cyan-400" />
            <h3 className="froc-section-title">Links sociais públicos</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              ['instagram', 'Instagram'],
              ['facebook', 'Facebook'],
              ['tiktok', 'TikTok'],
              ['youtube', 'YouTube'],
              ['linkedin', 'LinkedIn'],
              ['pinterest', 'Pinterest'],
              ['x', 'X / Twitter']
            ].map(([key, label]) => (
              <label key={key} className="text-xs font-semibold text-slate-300">
                {label}
                <input
                  type="url"
                  value={form.socialLinks?.[key] || ''}
                  onChange={(e) => social(key, e.target.value)}
                  className={input}
                  placeholder="https://…"
                />
              </label>
            ))}
          </div>
        </section>

        {/* VITRINE PÚBLICA */}
        <section className="froc-panel flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Store size={17} className="text-cyan-400" />
              Vitrine pública e SEO
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-400">
              Quando ativado, os dados públicos desta empresa (nome, links, produtos e serviços) podem aparecer na Vitrine Froc e no sitemap dinâmico. Dados financeiros, credenciais e configurações privadas nunca são expostos.
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 hover:border-cyan-500/40">
            <input
              type="checkbox"
              checked={Boolean(form.isPublicInVitrine)}
              onChange={(e) => update('isPublicInVitrine', e.target.checked)}
            />
            <span className="text-xs font-bold text-white">
              {form.isPublicInVitrine ? 'Publicada na Vitrine' : 'Privada'}
            </span>
          </label>
        </section>

        {/* BOTÕES DE AÇÃO */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {selectedCompany ? (
            <button
              type="button"
              disabled={deleting}
              onClick={removeCompany}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 size={15} />
              {deleting ? 'Excluindo…' : 'Excluir empresa'}
            </button>
          ) : (
            <span />
          )}
          <button
            disabled={saving}
            className="froc-primary inline-flex items-center justify-center gap-2 px-6 shadow-lg shadow-cyan-900/30"
          >
            <Save size={15} />
            {saving ? 'Salvando…' : selectedCompany ? 'Salvar Brand Center' : 'Cadastrar empresa'}
          </button>
        </div>
      </form>
    </div>
  );
};
