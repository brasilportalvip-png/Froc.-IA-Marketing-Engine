import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, Crown, Loader2, MapPin, Newspaper, Search, Sparkles, Store } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface PostCard {
  kind: 'magazine' | 'vitrine';
  id: string;
  title: string;
  summary: string;
  path: string;
  imageUrl: string | null;
  source: string;
  label: string;
  location: string | null;
  publishedAt: string;
  hasApp?: boolean;
  imageAlt?: string;
}

interface PostsResponse {
  posts: PostCard[];
  total: number;
  page: number;
  hasMore: boolean;
  counts: { all: number; magazine: number; vitrine: number };
}

type Filter = 'all' | 'magazine' | 'vitrine';

const ACCENT: Record<PostCard['kind'], string> = { magazine: '#FFD400', vitrine: '#00E676' };

/** Abre uma postagem dentro do app (o App sincroniza a rota pelo evento popstate). */
function openPath(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export const PostsPage: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [posts, setPosts] = useState<PostCard[]>([]);
  const [counts, setCounts] = useState({ all: 0, magazine: 0, vitrine: 0 });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = async (nextPage: number, append: boolean) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ type: filter, page: String(nextPage), limit: '24' });
      if (debounced) params.set('q', debounced);
      const data = await apiRequest<PostsResponse>(`/api/posts?${params.toString()}`);
      if (request !== requestRef.current) return;
      setPosts((current) => append ? [...current, ...data.posts] : data.posts);
      setCounts(data.counts);
      setHasMore(data.hasMore);
      setPage(nextPage);
    } catch (err: any) {
      if (request === requestRef.current) setError(err?.message || 'Não foi possível carregar os posts.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debounced]);

  useEffect(() => {
    document.title = 'Posts — Marketing, SEO e marcas em destaque | Froc.IA';
  }, []);

  const [featured, ...rest] = posts;
  const tabs: Array<{ id: Filter; label: string; icon: typeof Newspaper; count: number }> = [
    { id: 'all', label: 'Todos', icon: Newspaper, count: counts.all },
    { id: 'magazine', label: 'Froc Magazine', icon: BookOpen, count: counts.magazine },
    { id: 'vitrine', label: 'Vitrine', icon: Store, count: counts.vitrine }
  ];

  return (
    <div className="relative">
      <section className="relative overflow-hidden px-4 pb-10 pt-[calc(110px+env(safe-area-inset-top))] text-center">
        <div className="froc-aurora opacity-60" />
        <div className="froc-grid-bg" />
        <div className="relative mx-auto max-w-4xl">
          <div className="froc-logo-hero froc-float mx-auto mb-6 w-fit">
            <img src="/brand/logo-froc-512.webp" alt="Froc.IA" width={112} height={112} className="relative z-10 h-20 w-20 rounded-full sm:h-28 sm:w-28" />
          </div>
          <p className="inline-flex items-center gap-2 rounded-full border border-[#FFD400]/40 bg-[#FFD400]/10 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-[#FFD400]">
            <Newspaper size={13} /> Posts
          </p>
          <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            Tudo o que o Froc.IA<br /><span className="froc-text-gradient">publica, num só lugar.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-neutral-300 sm:text-base">
            Artigos de marketing, SEO e IA do Froc Magazine e os posts estratégicos que a IA publica todos os dias para as marcas da Vitrine.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 pb-24">
        <div className="sticky top-[calc(72px+env(safe-area-inset-top))] z-20 -mx-4 mb-8 flex flex-col gap-3 border-y border-white/5 bg-black/70 px-4 py-3 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-black transition ${filter === tab.id ? 'bg-white text-black' : 'border border-white/10 text-neutral-300 hover:text-white'}`}
              >
                <tab.icon size={14} /> {tab.label}
                <span className={`rounded-full px-1.5 text-[10px] ${filter === tab.id ? 'bg-black/10' : 'bg-white/10'}`}>{tab.count}</span>
              </button>
            ))}
          </div>
          <label className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar post, marca, cidade…" aria-label="Buscar posts" className="h-11 w-full rounded-full border border-white/10 bg-white/[0.04] pl-10 pr-4 text-sm text-white outline-none focus:border-[#FFD400] md:w-80" />
          </label>
        </div>

        {error && <p className="mb-6 rounded-2xl border border-[#FF2D87]/30 bg-[#FF2D87]/10 p-4 text-sm text-[#ff7ab3]">{error}</p>}

        {loading && posts.length === 0 ? (
          <div className="grid min-h-[30vh] place-items-center"><Loader2 className="animate-spin text-[#FFD400]" size={30} /></div>
        ) : posts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/15 p-12 text-center">
            <Crown className="mx-auto text-[#FFD400]" size={34} />
            <p className="mt-3 text-lg font-black">{debounced ? 'Nenhum post encontrado para essa busca.' : 'Os primeiros posts estão chegando.'}</p>
            <p className="mt-1 text-sm text-neutral-400">O Froc.IA publica conteúdo novo todos os dias.</p>
          </div>
        ) : (
          <>
            {featured && (
              <button onClick={() => openPath(featured.path)} className="froc-glow-card group mb-8 grid w-full overflow-hidden text-left md:grid-cols-5">
                <div className="relative min-h-[220px] md:col-span-2">
                  {featured.imageUrl
                    ? <img src={featured.imageUrl} alt={featured.imageAlt || featured.title} className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-105" />
                    : <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#FF2D87]/30 via-black to-[#00E676]/20"><Sparkles size={48} className="text-[#FFD400]" /></div>}
                </div>
                <div className="p-6 md:col-span-3 md:p-8">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FF2D87]/15 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#ff7ab3]">Mais recente</span>
                  <h2 className="mt-3 text-2xl font-black leading-tight text-white sm:text-3xl">{featured.title}</h2>
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-neutral-300">{featured.summary}</p>
                  <p className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-neutral-400">
                    <span className="font-bold" style={{ color: ACCENT[featured.kind] }}>{featured.source}</span>
                    {featured.publishedAt && <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> {new Date(featured.publishedAt).toLocaleDateString('pt-BR')}</span>}
                    {featured.location && <span className="inline-flex items-center gap-1 text-[#00E676]"><MapPin size={11} /> {featured.location}</span>}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-black text-[#FFD400] transition group-hover:gap-2.5">Ler agora <ArrowRight size={13} /></span>
                </div>
              </button>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((post) => (
                <button key={`${post.kind}-${post.id}`} onClick={() => openPath(post.path)} className="group flex flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0b0b0b] text-left transition hover:-translate-y-1 hover:border-white/25">
                  <div className="relative h-36 overflow-hidden">
                    {post.imageUrl
                      ? <img src={post.imageUrl} alt={post.imageAlt || post.title} loading="lazy" className="h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-105" />
                      : <div className="h-full w-full bg-gradient-to-br from-[#FFD400]/15 via-black to-[#FF2D87]/20" />}
                    <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider backdrop-blur" style={{ color: ACCENT[post.kind] }}>
                      {post.kind === 'magazine' ? 'Magazine' : 'Vitrine'} · {post.label}
                    </span>
                    {post.hasApp && <span className="absolute right-3 top-3 rounded-full bg-[#00E676] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-black">📱 Tem app</span>}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="line-clamp-2 text-base font-black leading-snug text-white">{post.title}</h3>
                    <p className="mt-2 line-clamp-3 flex-1 text-xs leading-5 text-neutral-400">{post.summary}</p>
                    <p className="mt-4 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                      <span className="truncate font-bold text-neutral-300">{post.source}</span>
                      {post.publishedAt && <span className="shrink-0">{new Date(post.publishedAt).toLocaleDateString('pt-BR')}</span>}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {hasMore && (
              <div className="mt-10 text-center">
                <button onClick={() => void load(page + 1, true)} disabled={loading} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-50">
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} Carregar mais posts
                </button>
              </div>
            )}
          </>
        )}

        <section className="froc-glow-card mt-16 p-8 text-center sm:p-12">
          <Crown className="mx-auto text-[#FFD400]" size={36} />
          <h2 className="mt-3 text-2xl font-black sm:text-4xl">Quer a sua marca <span className="froc-text-gradient">aqui todo dia?</span></h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-neutral-300">Fale com o Froc.IA: ele coloca sua marca na Vitrine e publica um post estratégico por dia, pronto para o Google.</p>
          <button onClick={onStart} className="froc-shimmer mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FFD400] via-[#FF2D87] to-[#00E676] px-7 py-3.5 text-sm font-black text-black">
            <Sparkles size={16} /> Falar com o Froc.IA
          </button>
        </section>
      </div>
    </div>
  );
};
