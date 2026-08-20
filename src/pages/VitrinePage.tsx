import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Calendar,
  ExternalLink,
  FileText,
  Globe,
  Laptop,
  Layers,
  MapPin,
  MessageSquare,
  Search,
  Share2,
  ShoppingBag,
  Store,
  Tag
} from 'lucide-react';
import { Company, BlogPost } from '../types';
import { apiRequest } from '../lib/api';

interface VitrinePageProps {
  onNavigate: (tab: string) => void;
  onSelectCompanyForContext?: (company: Company) => void;
}

function currentPath() {
  return typeof window === 'undefined' ? '/vitrine' : window.location.pathname;
}

function safeExternal(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function renderMarkdownInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const boldRegex = /(\*\*|__)(.*?)\1|(\*|_)(.*?)\3|(`)(.*?)\5|(\[(.*?)\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    if (match[2]) {
      // Bold
      parts.push(<strong key={match.index} className="font-bold text-white">{match[2]}</strong>);
    } else if (match[4]) {
      // Italic
      parts.push(<em key={match.index} className="italic text-slate-200">{match[4]}</em>);
    } else if (match[6]) {
      // Inline code
      parts.push(
        <code key={match.index} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-cyan-300">
          {match[6]}
        </code>
      );
    } else if (match[8] && match[9]) {
      // Link
      parts.push(
        <a
          key={match.index}
          href={match[9]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 underline hover:text-cyan-300"
        >
          {match[8]}
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function ArticleBody({ content }: { content: string }) {
  if (!content) return null;

  const blocks = String(content)
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-5 text-sm leading-relaxed text-slate-300">
      {blocks.map((block, index) => {
        // Horizontal Rule
        if (/^[-*_]{3,}$/.test(block)) {
          return <hr key={index} className="border-slate-800 my-6" />;
        }

        // H1
        if (block.startsWith('# ')) {
          const raw = block.slice(2).replace(/^[Hh]1[:\s-]+/, '').trim();
          return (
            <h1 key={index} className="pt-4 text-2xl font-black tracking-tight text-white md:text-3xl">
              {renderMarkdownInline(raw)}
            </h1>
          );
        }

        // H2
        if (block.startsWith('## ')) {
          const raw = block.slice(3).replace(/^[Hh]2[:\s-]+/, '').trim();
          return (
            <h2 key={index} className="pt-4 text-xl font-extrabold tracking-tight text-white md:text-2xl">
              {renderMarkdownInline(raw)}
            </h2>
          );
        }

        // H3
        if (block.startsWith('### ')) {
          const raw = block.slice(4).replace(/^[Hh]3[:\s-]+/, '').trim();
          return (
            <h3 key={index} className="pt-2 text-base font-bold text-cyan-200">
              {renderMarkdownInline(raw)}
            </h3>
          );
        }

        // Blockquote
        if (block.startsWith('> ')) {
          const quote = block.replace(/^>\s*/gm, '');
          return (
            <blockquote
              key={index}
              className="my-3 rounded-2xl border-l-4 border-cyan-400 bg-slate-900/60 p-4 italic text-slate-200"
            >
              {renderMarkdownInline(quote)}
            </blockquote>
          );
        }

        // Unordered List
        if (/^[-*•]\s+/m.test(block)) {
          const items = block
            .split('\n')
            .map((line) => line.replace(/^[-*•]\s+/, '').trim())
            .filter(Boolean);
          return (
            <ul key={index} className="my-3 space-y-1.5 pl-5 list-disc marker:text-cyan-400">
              {items.map((item, i) => (
                <li key={i} className="text-slate-300">
                  {renderMarkdownInline(item)}
                </li>
              ))}
            </ul>
          );
        }

        // Ordered List
        if (/^\d+\.\s+/m.test(block)) {
          const items = block
            .split('\n')
            .map((line) => line.replace(/^\d+\.\s+/, '').trim())
            .filter(Boolean);
          return (
            <ol key={index} className="my-3 space-y-1.5 pl-5 list-decimal marker:text-cyan-400 font-semibold">
              {items.map((item, i) => (
                <li key={i} className="text-slate-300 font-normal">
                  {renderMarkdownInline(item)}
                </li>
              ))}
            </ol>
          );
        }

        // Standard Paragraph
        return (
          <p key={index} className="leading-7 text-slate-300">
            {renderMarkdownInline(block)}
          </p>
        );
      })}
    </div>
  );
}

export const VitrinePage: React.FC<VitrinePageProps> = ({ onNavigate }) => {
  const [path, setPath] = useState(currentPath());
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [post, setPost] = useState<BlogPost | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'online' | 'physical' | 'hybrid'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const navigatePublic = (next: string) => {
    window.history.pushState({}, '', next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const listener = () => setPath(currentPath());
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      setCompany(null);
      setPost(null);
      try {
        const companyMatch = path.match(/^\/vitrine\/([^/]+)$/);
        const blogMatch = path.match(/^\/blog\/([^/]+)$/);
        if (companyMatch) {
          const data = await apiRequest<{ company: Company }>(
            `/api/vitrine/${encodeURIComponent(decodeURIComponent(companyMatch[1]))}`
          );
          if (active) setCompany(data.company);
        } else if (blogMatch) {
          const data = await apiRequest<{ post: BlogPost }>(
            `/api/blog/${encodeURIComponent(decodeURIComponent(blogMatch[1]))}`
          );
          if (active) setPost(data.post);
        } else if (path.startsWith('/blog')) {
          const data = await apiRequest<{ posts: BlogPost[] }>('/api/blog');
          if (active) setPosts(data.posts || []);
        } else {
          const data = await apiRequest<{ companies: Company[] }>('/api/vitrine');
          if (active) setCompanies(data.companies || []);
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Não foi possível carregar esta página.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [path]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(companies.map((c) => c.category).filter(Boolean))).sort()],
    [companies]
  );

  const filteredCompanies = useMemo(() => {
    return companies.filter((item) => {
      const bType = item.businessType || 'online';
      if (typeFilter !== 'all' && bType !== typeFilter) return false;
      const haystack = `${item.name} ${item.description || ''} ${(item.products || []).join(' ')} ${(item.services || []).join(' ')} ${(item.keywords || []).join(' ')}`.toLowerCase();
      return (selectedCategory === 'all' || item.category === selectedCategory) && haystack.includes(searchTerm.toLowerCase());
    });
  }, [companies, selectedCategory, typeFilter, searchTerm]);

  const share = async (title: string) => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* cancel is not an error */
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl froc-panel text-center">
        <Store className="mx-auto mb-3 text-slate-500" size={38} />
        <h2 className="text-lg font-bold text-white">Conteúdo indisponível</h2>
        <p className="mt-2 text-xs text-slate-400">{error}</p>
        <button className="froc-secondary mt-5" onClick={() => navigatePublic('/vitrine')}>
          Voltar à Vitrine
        </button>
      </div>
    );
  }

  if (company) {
    const website = safeExternal(company.website);
    const social = Object.entries(company.socialLinks || {})
      .map(([name, value]) => [name, safeExternal(typeof value === 'string' ? value : undefined)] as const)
      .filter(([, value]) => value);
    const isOnline = company.businessType === 'online';
    const isPhysical = company.businessType === 'physical';
    const isHybrid = company.businessType === 'hybrid';

    return (
      <div className="mx-auto max-w-5xl space-y-6 animate-fadeIn">
        <button onClick={() => navigatePublic('/vitrine')} className="froc-secondary inline-flex items-center gap-2">
          <ArrowLeft size={14} />
          Vitrine
        </button>

        <section className="froc-panel overflow-hidden p-0">
          <div className="bg-gradient-to-br from-blue-950 via-slate-950 to-cyan-950/40 p-6 md:p-9">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-slate-900 text-2xl font-black text-cyan-300">
                {company.logoUrl ? (
                  <img src={company.logoUrl} alt={`Logo ${company.name}`} className="h-full w-full object-cover" />
                ) : (
                  company.name?.[0]?.toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">{company.category}</span>
                  {isOnline && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300">
                      <Laptop size={11} /> 100% Online
                    </span>
                  )}
                  {isPhysical && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                      <Store size={11} /> Ponto Físico
                    </span>
                  )}
                  {isHybrid && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/15 px-2.5 py-0.5 text-[11px] font-bold text-purple-300">
                      <Layers size={11} /> Presencial & Online
                    </span>
                  )}
                </div>
                <h1 className="mt-1.5 text-3xl font-black text-white">{company.name}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  {company.description || 'Empresa participante da Vitrine Froc.IA.'}
                </p>
              </div>
              <button
                onClick={() => share(company.name)}
                className="froc-secondary inline-flex items-center justify-center gap-2 self-start sm:self-center"
              >
                <Share2 size={15} />
                {copied ? 'Link copiado' : 'Compartilhar'}
              </button>
            </div>
          </div>

          <div className="grid gap-6 p-6 md:grid-cols-[1fr_320px] md:p-9">
            <div className="space-y-7">
              {company.products?.length || company.services?.length ? (
                <div className="grid gap-5 md:grid-cols-2">
                  {company.products?.length ? (
                    <div>
                      <h2 className="froc-section-title mb-3">Produtos</h2>
                      <div className="flex flex-wrap gap-2">
                        {company.products.map((x) => (
                          <span key={x} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">
                            {x}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {company.services?.length ? (
                    <div>
                      <h2 className="froc-section-title mb-3">Serviços</h2>
                      <div className="flex flex-wrap gap-2">
                        {company.services.map((x) => (
                          <span key={x} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">
                            {x}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {company.onlineChannels?.length ? (
                <div>
                  <h2 className="froc-section-title mb-3">Canais de Atendimento & Vendas</h2>
                  <div className="flex flex-wrap gap-2">
                    {company.onlineChannels.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200">
                        <ShoppingBag size={12} /> {c}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {company.differentials ? (
                <div>
                  <h2 className="froc-section-title mb-2">Diferenciais</h2>
                  <p className="text-sm leading-6 text-slate-300">{company.differentials}</p>
                </div>
              ) : null}

              {company.keywords?.length ? (
                <div>
                  <h2 className="froc-section-title mb-3">Especialidades & Tags</h2>
                  <div className="flex flex-wrap gap-2">
                    {company.keywords.map((x) => (
                      <span key={x} className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-200">
                        <Tag size={11} />
                        {x}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <aside className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
              <h2 className="froc-section-title">Atendimento & Contato</h2>

              {isOnline ? (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs text-cyan-200">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <Globe size={14} className="text-cyan-400" />
                    Atendimento 100% Online
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">
                    Cobertura: {company.coverageRegion || 'Nacional / Todo o Brasil'}
                  </p>
                  {(company.city || company.state) && (
                    <p className="mt-1 text-[10px] text-slate-400">
                      Sede: {[company.city, company.state].filter(Boolean).join(' - ')}
                    </p>
                  )}
                </div>
              ) : (
                (company.address || company.city || company.state) && (
                  <div className="flex gap-2 text-xs text-slate-300">
                    <MapPin size={15} className="mt-0.5 shrink-0 text-emerald-400" />
                    <span>{[company.address, company.city, company.state, company.country].filter(Boolean).join(', ')}</span>
                  </div>
                )
              )}

              {company.whatsapp && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`https://wa.me/${company.whatsapp.replace(/\D/g, '')}`}
                  className="froc-primary flex w-full items-center justify-center gap-2 shadow-lg shadow-cyan-900/30"
                >
                  <MessageSquare size={15} />
                  Falar no WhatsApp
                </a>
              )}

              {website && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={website}
                  className="froc-secondary flex w-full items-center justify-center gap-2"
                >
                  <Globe size={15} />
                  Acessar Loja / Website
                </a>
              )}

              {social.length ? (
                <div className="border-t border-slate-800 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Redes oficiais
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {social.map(([name, url]) => (
                      <a
                        key={name}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] capitalize text-slate-200 hover:text-cyan-300"
                      >
                        {name}
                        <ExternalLink className="ml-1 inline" size={10} />
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        </section>
      </div>
    );
  }

  if (post) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 animate-fadeIn">
        <button onClick={() => navigatePublic('/blog')} className="froc-secondary inline-flex items-center gap-2">
          <ArrowLeft size={14} />
          Froc Magazine
        </button>
        <article className="froc-panel p-6 md:p-10">
          <div className="mb-7 border-b border-slate-800 pb-7">
            <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-cyan-300">
              <span>{post.category}</span>
              {post.publishedAt && (
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <Calendar size={11} />
                  {new Date(post.publishedAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-black leading-tight text-white md:text-4xl">{post.title}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">{post.summary}</p>
            <button onClick={() => share(post.title)} className="froc-secondary mt-4 inline-flex items-center gap-2">
              <Share2 size={14} />
              {copied ? 'Link copiado' : 'Compartilhar artigo'}
            </button>
          </div>
          {post.featuredImageUrl && (
            <img src={post.featuredImageUrl} alt="" className="mb-8 max-h-[460px] w-full rounded-3xl object-cover" />
          )}
          <ArticleBody content={post.content} />
        </article>
      </div>
    );
  }

  if (path.startsWith('/blog')) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-blue-950 via-slate-950 to-cyan-950/30 p-7 md:p-10">
          <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">Froc Magazine</span>
          <h1 className="mt-2 text-3xl font-black text-white">Marketing, IA, SEO e crescimento</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Conteúdo publicado pelo ecossistema Froc.IA. Artigos possuem URL própria e entram no sitemap somente quando publicados.
          </p>
        </section>
        {posts.length ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((item) => (
              <button
                key={item.id}
                onClick={() => navigatePublic(`/blog/${encodeURIComponent(item.slug)}`)}
                className="froc-panel group text-left"
              >
                <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-cyan-400">{item.category}</div>
                <h2 className="text-base font-bold text-white group-hover:text-cyan-300">{item.title}</h2>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{item.summary}</p>
                <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300">
                  <FileText size={13} />
                  Ler artigo
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="froc-panel text-center text-sm text-slate-400">Nenhum artigo publicado ainda.</div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
      <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-blue-950 via-slate-950 to-cyan-950/30 p-7 md:p-10">
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400">
          <Store size={14} />
          Vitrine Pública Froc
        </span>
        <h1 className="mt-2 text-3xl font-black text-white">Encontre empresas online, lojas e serviços</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Descubra negócios digitais de todo o Brasil e comércios locais participantes do ecossistema Froc.IA.
        </p>
        <button onClick={() => navigatePublic('/blog')} className="froc-secondary mt-5 inline-flex items-center gap-2">
          <FileText size={14} />
          Abrir Froc Magazine
        </button>
      </section>

      {/* FILTROS DE BUSCA E TIPO DE OPERAÇÃO */}
      <div className="froc-panel space-y-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 text-slate-500" size={15} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar empresa online, produto, serviço ou palavra-chave…"
            className="froc-input pl-10"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
          {/* Tipo de Operação Tabs */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: 'Todos os modelos' },
              { id: 'online', label: '🌐 100% Online' },
              { id: 'physical', label: '🏬 Presencial / Físico' },
              { id: 'hybrid', label: '🔄 Híbrido' }
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTypeFilter(t.id as any)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  typeFilter === t.id
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20'
                    : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Categorias */}
          <div className="flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`rounded-xl px-2.5 py-1 text-xs font-medium ${
                  selectedCategory === category
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'bg-slate-900/60 text-slate-400 hover:text-white'
                }`}
              >
                {category === 'all' ? 'Todas categorias' : category}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredCompanies.length ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredCompanies.map((item) => {
            const isItemOnline = item.businessType === 'online' || !item.businessType;
            const isItemPhysical = item.businessType === 'physical';
            const isItemHybrid = item.businessType === 'hybrid';

            return (
              <button
                key={item.id}
                onClick={() => navigatePublic(`/vitrine/${encodeURIComponent(item.slug)}`)}
                className="froc-panel group flex flex-col text-left transition-all hover:border-cyan-500/40 hover:shadow-xl hover:shadow-cyan-950/20"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">{item.category}</span>
                  {isItemOnline && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                      <Laptop size={10} /> Online
                    </span>
                  )}
                  {isItemPhysical && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      <Store size={10} /> Física
                    </span>
                  )}
                  {isItemHybrid && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                      <Layers size={10} /> Híbrida
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 font-black text-cyan-300">
                    {item.logoUrl ? (
                      <img src={item.logoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      item.name?.[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-bold text-white group-hover:text-cyan-300">{item.name}</h2>
                    <span className="text-[11px] text-slate-400">
                      {isItemOnline
                        ? `🌐 ${item.coverageRegion || 'Atende todo o Brasil'}`
                        : `📍 ${[item.city, item.state].filter(Boolean).join(' - ') || 'Local'}`}
                    </span>
                  </div>
                </div>

                <p className="mt-3 line-clamp-3 flex-1 text-xs leading-5 text-slate-400">
                  {item.description || 'Conheça esta empresa na Vitrine Froc.IA.'}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300">
                    <Building2 size={13} />
                    Ver perfil
                  </span>
                  {item.whatsapp && (
                    <span className="text-[11px] text-emerald-400 font-medium">WhatsApp ativo</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="froc-panel text-center">
          <Store className="mx-auto mb-3 text-slate-600" size={36} />
          <h2 className="text-sm font-bold text-white">Nenhuma empresa encontrada com esses filtros</h2>
          <p className="mt-1 text-xs text-slate-500">Tente ajustar o termo de busca ou o modelo de operação.</p>
          <button onClick={() => onNavigate('empresa')} className="froc-primary mt-4">
            Cadastrar minha empresa
          </button>
        </div>
      )}
    </div>
  );
};
