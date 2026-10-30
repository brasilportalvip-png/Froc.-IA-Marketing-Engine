import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, CalendarDays, Crown, Flame, Globe2, MapPin, Search, Sparkles, Star, TrendingUp, Zap } from 'lucide-react';
import type { Company } from '../../types';
import { apiRequest } from '../../lib/api';

export interface VitrinePostSummary {
  id: string; companyId: string; companySlug: string; companyName: string; date: string; title: string; slug: string;
  summary: string; angleLabel: string; imageUrl: string | null; location: string | null; publishedAt: string;
}

interface Props {
  companies: Company[];
  onOpenCompany: (slug: string) => void;
  onOpenPost: (companySlug: string, postSlug: string) => void;
  onStart: () => void;
}

const ACCENTS = ['#FFD400', '#FF2D87', '#00E676', '#ffffff'];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'F';
}

function TiltCard({ children, accent, onClick, className = '' }: { children: React.ReactNode; accent: string; onClick: () => void; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const move = (event: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px)`;
    el.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
    el.style.setProperty('--my', `${(y + 0.5) * 100}%`);
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ''; };
  return (
    <button
      ref={ref}
      onClick={onClick}
      onMouseMove={move}
      onMouseLeave={leave}
      className={`group relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0b0b] text-left transition-[transform,border-color,box-shadow] duration-200 hover:border-white/25 ${className}`}
      style={{ boxShadow: `0 0 0 0 ${accent}`, '--accent': accent } as React.CSSProperties}
    >
      <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: `radial-gradient(400px circle at var(--mx,50%) var(--my,50%), ${accent}26, transparent 45%)` }} />
      {children}
    </button>
  );
}

export const VitrineShowcase: React.FC<Props> = ({ companies, onOpenCompany, onOpenPost, onStart }) => {
  const [posts, setPosts] = useState<VitrinePostSummary[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    let active = true;
    apiRequest<{ posts: VitrinePostSummary[] }>('/api/vitrine-posts?limit=12')
      .then((data) => { if (active) setPosts(data.posts || []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const postCount = useMemo(() => {
    const map = new Map<string, number>();
    posts.forEach((post) => map.set(post.companyId, (map.get(post.companyId) || 0) + 1));
    return map;
  }, [posts]);

  const categories = useMemo(() => ['all', ...Array.from(new Set(companies.map((c) => c.category).filter(Boolean))).sort()], [companies]);
  const filtered = useMemo(() => companies.filter((company) => {
    const text = `${company.name} ${company.description || ''} ${company.city || ''} ${company.category || ''}`.toLowerCase();
    return (category === 'all' || company.category === category) && text.includes(search.toLowerCase());
  }), [companies, category, search]);
  const featured = companies.slice(0, 3);
  const marquee = companies.length ? [...companies, ...companies].slice(0, 40) : [];

  return (
    <div className="relative">
      {/* HERO */}
      <section className="relative overflow-hidden px-4 pb-16 pt-[calc(110px+env(safe-area-inset-top))] text-center">
        <div className="froc-aurora" />
        <div className="froc-grid-bg" />
        <div className="froc-spotlight left" />
        <div className="froc-spotlight right" />
        <div className="relative mx-auto max-w-4xl">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-[#FFD400]/40 bg-[#FFD400]/10 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-[#FFD400]">
            <Crown size={13} /> Vitrine Froc.IA
          </div>
          <h1 className="text-4xl font-black leading-[1.02] tracking-tight sm:text-7xl">
            Onde as marcas<br /><span className="froc-text-gradient">viram desejo.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-neutral-300 sm:text-base">
            Um palco iluminado para quem leva o negócio a sério. Cada marca aqui ganha um post estratégico por dia, SEO local e é anunciada aos buscadores automaticamente.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onStart} className="froc-shimmer inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FFD400] via-[#FF2D87] to-[#00E676] px-7 py-3.5 text-sm font-black text-black shadow-[0_0_40px_rgba(255,45,135,.45)] transition hover:scale-[1.03]">
              <Sparkles size={16} /> Quero meu site aqui
            </button>
            <a href="#marcas" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-bold text-white hover:bg-white/10">Explorar marcas <ArrowRight size={15} /></a>
          </div>
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-3">
            {[
              { value: companies.length, label: 'marcas em destaque', color: '#FFD400' },
              { value: posts.length ? `${posts.length}+` : 'Diário', label: 'posts estratégicos', color: '#FF2D87' },
              { value: '24/7', label: 'indexação automática', color: '#00E676' }
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur">
                <p className="text-2xl font-black" style={{ color: stat.color }}>{stat.value}</p>
                <p className="text-[11px] text-neutral-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      {marquee.length > 0 && (
        <section className="relative border-y border-white/10 bg-black/60 py-4 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
          <div className="froc-marquee gap-3">
            {[...marquee, ...marquee].map((company, index) => (
              <button key={`${company.id}-${index}`} onClick={() => onOpenCompany(company.slug)} className="mx-1.5 inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-white hover:border-[#FFD400]">
                <Star size={12} style={{ color: ACCENTS[index % ACCENTS.length] }} fill="currentColor" />
                {company.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mx-auto max-w-7xl space-y-16 px-4 py-16">
        {/* DESTAQUES */}
        {featured.length > 0 && (
          <section>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#FF2D87]"><Flame size={14} /> Em alta</p>
                <h2 className="mt-1 text-2xl font-black sm:text-3xl">Marcas em destaque</h2>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {featured.map((company, index) => {
                const accent = ACCENTS[index % 3];
                return (
                  <div key={company.id} className="froc-glow-card froc-float" style={{ animationDelay: `${index * -2}s` }}>
                    <TiltCard accent={accent} onClick={() => onOpenCompany(company.slug)} className="w-full border-0 p-6">
                      <div className="flex items-center gap-4">
                        {company.logoUrl
                          ? <img src={company.logoUrl} alt={company.name} className="h-16 w-16 rounded-2xl object-cover ring-2" style={{ '--tw-ring-color': accent } as React.CSSProperties} />
                          : <span className="grid h-16 w-16 place-items-center rounded-2xl text-xl font-black text-black" style={{ background: accent }}>{initials(company.name)}</span>}
                        <div className="min-w-0">
                          <p className="flex items-center gap-1 truncate text-lg font-black text-white">{company.name} <BadgeCheck size={16} style={{ color: accent }} /></p>
                          {company.city && <p className="flex items-center gap-1 text-xs text-neutral-400"><MapPin size={11} /> {company.city}{company.state ? ` - ${company.state}` : ''}</p>}
                        </div>
                      </div>
                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-neutral-300">{company.description || 'Marca em destaque na Vitrine Froc.IA.'}</p>
                      <p className="mt-5 inline-flex items-center gap-1.5 text-xs font-black" style={{ color: accent }}>Conhecer a marca <ArrowRight size={13} /></p>
                    </TiltCard>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* POSTS DE HOJE */}
        {posts.length > 0 && (
          <section>
            <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#00E676]"><span className="froc-pulse-dot h-2 w-2 rounded-full bg-[#00E676] text-[#00E676]" /> Publicado pela IA</p>
            <h2 className="mt-1 text-2xl font-black sm:text-3xl">Posts estratégicos do dia</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {posts.slice(0, 6).map((post, index) => (
                <TiltCard key={post.id} accent={ACCENTS[(index + 1) % 3]} onClick={() => onOpenPost(post.companySlug, post.slug)} className="p-5">
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="font-bold text-white">{post.companyName}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {new Date(post.publishedAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                  {post.angleLabel && <span className="mt-3 inline-block rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#FFD400]">{post.angleLabel}</span>}
                  <h3 className="mt-2 line-clamp-2 text-base font-black leading-snug text-white">{post.title}</h3>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-neutral-400">{post.summary}</p>
                  {post.location && <p className="mt-3 flex items-center gap-1 text-[11px] text-[#00E676]"><MapPin size={11} /> {post.location}</p>}
                </TiltCard>
              ))}
            </div>
          </section>
        )}

        {/* TODAS AS MARCAS */}
        <section id="marcas" className="scroll-mt-24">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#FFD400]"><Globe2 size={14} /> Explorar</p>
              <h2 className="mt-1 text-2xl font-black sm:text-3xl">Todas as marcas da vitrine</h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar marca, cidade, serviço…" className="h-11 w-full rounded-full border border-white/10 bg-white/[0.04] pl-10 pr-4 text-sm text-white outline-none focus:border-[#FFD400] sm:w-72" />
              </label>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 rounded-full border border-white/10 bg-[#0b0b0b] px-4 text-sm text-white outline-none focus:border-[#FFD400]">
                {categories.map((item) => <option key={item} value={item}>{item === 'all' ? 'Todas as categorias' : item}</option>)}
              </select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-white/15 p-10 text-center">
              <Crown className="mx-auto text-[#FFD400]" size={34} />
              <p className="mt-3 text-lg font-black">Este lugar pode ser seu.</p>
              <p className="mt-1 text-sm text-neutral-400">Converse com a Froc.IA e coloque sua marca em destaque hoje mesmo.</p>
              <button onClick={onStart} className="mt-5 rounded-full bg-[#FFD400] px-5 py-2.5 text-sm font-black text-black">Começar agora</button>
            </div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((company, index) => {
                const accent = ACCENTS[index % ACCENTS.length];
                const daily = postCount.get(company.id) || 0;
                return (
                  <TiltCard key={company.id} accent={accent} onClick={() => onOpenCompany(company.slug)} className="p-5">
                    <div className="flex items-center gap-3">
                      {company.logoUrl
                        ? <img src={company.logoUrl} alt={company.name} loading="lazy" className="h-12 w-12 rounded-xl object-cover" />
                        : <span className="grid h-12 w-12 place-items-center rounded-xl text-sm font-black text-black" style={{ background: accent }}>{initials(company.name)}</span>}
                      <div className="min-w-0">
                        <p className="truncate font-black text-white">{company.name}</p>
                        <p className="truncate text-[11px] text-neutral-400">{company.category || 'Marca'}{company.city ? ` · ${company.city}` : ''}</p>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-3 text-xs leading-5 text-neutral-400">{company.description || 'Conheça esta marca na Vitrine Froc.IA.'}</p>
                    <div className="mt-4 flex items-center gap-2 text-[10px] font-bold">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#00E676]/10 px-2 py-1 text-[#00E676]"><Zap size={10} /> Post diário</span>
                      {daily > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[#FF2D87]/10 px-2 py-1 text-[#ff7ab3]"><TrendingUp size={10} /> {daily} recentes</span>}
                    </div>
                  </TiltCard>
                );
              })}
            </div>
          )}
        </section>

        {/* CTA FINAL */}
        <section className="froc-glow-card relative overflow-hidden p-8 text-center sm:p-14">
          <div className="froc-aurora opacity-40" />
          <div className="relative">
            <Crown className="mx-auto text-[#FFD400]" size={40} />
            <h2 className="mt-4 text-3xl font-black sm:text-5xl">Seu site merece <span className="froc-text-gradient">este palco.</span></h2>
            <div className="mx-auto mt-6 grid max-w-3xl gap-3 text-left sm:grid-cols-2">
              {[
                'Post estratégico publicado todo dia, com gatilhos e chamada para ação',
                'SEO local: país, estado, cidade, bairro e rua',
                'Sitemaps XML/TXT, Schema e aviso imediato aos buscadores (IndexNow)',
                'A IA faz tudo — você só conversa e aprova'
              ].map((item) => (
                <p key={item} className="flex items-start gap-2 rounded-2xl bg-white/[0.04] p-3 text-sm text-neutral-200"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-[#00E676]" /> {item}</p>
              ))}
            </div>
            <button onClick={onStart} className="froc-shimmer mt-8 inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-sm font-black text-black transition hover:bg-[#FFD400]">
              <Sparkles size={16} /> Colocar minha marca na vitrine
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
