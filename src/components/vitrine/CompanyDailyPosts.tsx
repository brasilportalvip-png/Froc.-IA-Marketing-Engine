import React, { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Zap } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { VitrinePostSummary } from './VitrineShowcase';

export const CompanyDailyPosts: React.FC<{ slug: string; onOpen: (path: string) => void }> = ({ slug, onOpen }) => {
  const [posts, setPosts] = useState<VitrinePostSummary[]>([]);

  useEffect(() => {
    let active = true;
    apiRequest<{ posts: VitrinePostSummary[] }>(`/api/vitrine/${encodeURIComponent(slug)}/posts`)
      .then((data) => { if (active) setPosts(data.posts || []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [slug]);

  if (!posts.length) return null;
  return (
    <section className="rounded-3xl border border-white/10 bg-[#0b0b0b] p-6">
      <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#00E676]"><Zap size={13} /> Publicações diárias</p>
      <h2 className="mt-1 text-xl font-black text-white">Conteúdos estratégicos desta marca</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {posts.map((post) => (
          <button key={post.id} onClick={() => onOpen(`/vitrine/${encodeURIComponent(post.companySlug)}/${encodeURIComponent(post.slug)}`)} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#FFD400]/50">
            <p className="flex items-center gap-1 text-[11px] text-neutral-400"><CalendarDays size={11} /> {new Date(post.publishedAt).toLocaleDateString('pt-BR')} {post.angleLabel && <span className="ml-1 text-[#FFD400]">· {post.angleLabel}</span>}</p>
            <p className="mt-1.5 line-clamp-2 text-sm font-black text-white">{post.title}</p>
            <p className="mt-1 line-clamp-2 text-xs text-neutral-400">{post.summary}</p>
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#FF2D87]">Ler post <ArrowRight size={11} /></span>
          </button>
        ))}
      </div>
    </section>
  );
};
