import React, { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Crown, ExternalLink, Sparkles, Store, Zap } from 'lucide-react';
import type { Company } from '../types';
import { apiRequest } from '../lib/api';

interface MyPost { id: string; companySlug: string; title: string; slug: string; summary: string; angleLabel: string; publishedAt: string }

export const DashboardBoost: React.FC<{ selectedCompany: Company | null; onNavigate: (tab: string) => void }> = ({ selectedCompany, onNavigate }) => {
  const [posts, setPosts] = useState<MyPost[]>([]);
  const [clicks, setClicks] = useState<{ total: number; site: number; app: number; whatsapp: number } | null>(null);

  useEffect(() => {
    let active = true;
    if (!selectedCompany?.id) { setClicks(null); return; }
    apiRequest<{ clicks: { total: number; site: number; app: number; whatsapp: number } }>(`/api/vitrine-clicks/mine?companyId=${encodeURIComponent(selectedCompany.id)}`)
      .then((data) => { if (active) setClicks(data.clicks); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [selectedCompany?.id]);

  useEffect(() => {
    let active = true;
    const query = selectedCompany?.id ? `?companyId=${encodeURIComponent(selectedCompany.id)}` : '';
    apiRequest<{ posts: MyPost[] }>(`/api/vitrine-posts/mine${query}`)
      .then((data) => { if (active) setPosts(data.posts || []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [selectedCompany?.id]);

  const inVitrine = Boolean(selectedCompany?.isPublicInVitrine);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <button onClick={() => onNavigate('home')} className="froc-glow-card group relative overflow-hidden p-6 text-left lg:col-span-2">
        <div className="froc-aurora opacity-30" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFD400]/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#FFD400]"><Sparkles size={11} /> Froc.IA</span>
          <h3 className="mt-3 text-xl font-black text-white">O que vamos criar hoje?</h3>
          <p className="mt-1 text-xs leading-5 text-neutral-400">Fale com a IA: ela cria anúncios, imagens, vídeos e artigos, segmenta por cidade, bairro e rua e publica para você.</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-black text-[#FF2D87] transition group-hover:gap-2.5">Abrir conversa <ArrowRight size={13} /></span>
        </div>
      </button>

      <div className="rounded-[28px] border border-white/10 bg-[#0b0b0b] p-6 lg:col-span-3">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#00E676]"><Zap size={13} /> Posts diários na Vitrine</p>
          {selectedCompany && inVitrine && (
            <a href={`/vitrine/${encodeURIComponent(selectedCompany.slug)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FFD400]">Ver minha vitrine <ExternalLink size={11} /></a>
          )}
        </div>
        {inVitrine && clicks && (
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[['Cliques', clicks.total, '#ffffff'], ['Site', clicks.site, '#FFD400'], ['App', clicks.app, '#00E676'], ['WhatsApp', clicks.whatsapp, '#FF2D87']].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-xl bg-white/[0.04] px-2 py-2">
                <p className="text-lg font-black" style={{ color: String(color) }}>{Number(value).toLocaleString('pt-BR')}</p>
                <p className="text-[10px] text-neutral-500">{label}</p>
              </div>
            ))}
          </div>
        )}
        {!inVitrine ? (
          <div className="mt-4 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-white/15 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-neutral-300"><Crown size={16} className="text-[#FFD400]" /> Sua marca ainda não está na Vitrine. Lá ela ganha 1 post estratégico por dia.</p>
            <button onClick={() => onNavigate('home')} className="shrink-0 rounded-full bg-[#FFD400] px-4 py-2 text-xs font-black text-black">Pedir para a IA</button>
          </div>
        ) : posts.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-neutral-400"><Store size={15} /> O primeiro post diário será publicado no próximo ciclo da IA.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {posts.slice(0, 4).map((post) => (
              <li key={post.id}>
                <a href={`/vitrine/${encodeURIComponent(post.companySlug)}/${encodeURIComponent(post.slug)}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 hover:bg-white/[0.06]">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">{post.title}</span>
                    <span className="flex items-center gap-1 text-[11px] text-neutral-500"><CalendarDays size={10} /> {new Date(post.publishedAt).toLocaleDateString('pt-BR')} · {post.angleLabel}</span>
                  </span>
                  <ExternalLink size={13} className="shrink-0 text-neutral-500" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
