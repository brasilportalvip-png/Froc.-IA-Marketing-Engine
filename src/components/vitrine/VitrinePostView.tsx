import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, ExternalLink, Globe, Loader2, MapPin, MessageCircle, Share2, Sparkles } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface FullPost {
  id: string; companySlug: string; companyName: string; title: string; slug: string; summary: string; hook: string;
  content: string; cta: string; faq: Array<{ question: string; answer: string }>; keywords: string[]; angleLabel: string;
  imageUrl: string | null; location: string | null; publishedAt: string;
}

interface Props {
  companySlug: string;
  postSlug: string;
  onBack: (path: string) => void;
  onStart: () => void;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** Markdown simples → HTML seguro (texto sempre escapado antes da formatação). */
export function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const inline = (text: string) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const flush = () => { if (list.length) { out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`); list = []; } };
  for (const raw of String(markdown || '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { flush(); const level = Math.min(Math.max(heading[1].length, 2), 3); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const item = /^[-*•]\s+(.*)$/.exec(line) || /^\d+[.)]\s+(.*)$/.exec(line);
    if (item) { list.push(item[1]); continue; }
    flush();
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('');
}

function safeUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch { return undefined; }
}

export const VitrinePostView: React.FC<Props> = ({ companySlug, postSlug, onBack, onStart }) => {
  const [post, setPost] = useState<FullPost | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setPost(null);
    setError('');
    apiRequest<{ post: FullPost; company: any }>(`/api/vitrine/${encodeURIComponent(companySlug)}/posts/${encodeURIComponent(postSlug)}`)
      .then((data) => { if (active) { setPost(data.post); setCompany(data.company); document.title = `${data.post.title} | ${data.post.companyName}`; } })
      .catch((err) => { if (active) setError(err?.message || 'Post não encontrado.'); });
    return () => { active = false; };
  }, [companySlug, postSlug]);

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: post?.title, url: window.location.href });
      else { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch { /* cancelado */ }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-32 text-center">
        <p className="text-xl font-black">Post indisponível</p>
        <p className="mt-2 text-sm text-neutral-400">{error}</p>
        <button onClick={() => onBack('/vitrine')} className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black">Voltar à Vitrine</button>
      </div>
    );
  }
  if (!post) return <div className="grid min-h-[70vh] place-items-center"><Loader2 className="animate-spin text-[#FFD400]" size={30} /></div>;

  const whatsapp = company?.whatsapp ? `https://wa.me/${String(company.whatsapp).replace(/\D/g, '')}` : undefined;
  const website = safeUrl(company?.website);

  return (
    <div className="relative px-4 pb-24 pt-[calc(96px+env(safe-area-inset-top))]">
      <div className="froc-aurora opacity-30" />
      <article className="relative mx-auto max-w-3xl">
        <button onClick={() => onBack(`/vitrine/${encodeURIComponent(post.companySlug)}`)} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-neutral-300 hover:text-white">
          <ArrowLeft size={14} /> {post.companyName}
        </button>
        <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px]">
          {post.angleLabel && <span className="rounded-full bg-[#FFD400]/10 px-3 py-1 font-black uppercase tracking-wider text-[#FFD400]">{post.angleLabel}</span>}
          <span className="inline-flex items-center gap-1 text-neutral-400"><CalendarDays size={12} /> {new Date(post.publishedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
          {post.location && <span className="inline-flex items-center gap-1 text-[#00E676]"><MapPin size={12} /> {post.location}</span>}
        </div>
        <h1 className="mt-4 text-3xl font-black leading-tight sm:text-5xl">{post.title}</h1>
        {post.hook && <p className="mt-5 border-l-4 border-[#FF2D87] pl-4 text-lg font-semibold leading-8 text-white">{post.hook}</p>}
        {post.imageUrl && <img src={post.imageUrl} alt={post.companyName} className="mt-8 max-h-[420px] w-full rounded-3xl object-cover" />}
        <div className="froc-prose mt-8" dangerouslySetInnerHTML={{ __html: markdownToHtml(post.content) }} />

        {post.faq.length > 0 && (
          <section className="mt-12">
            <h2 className="text-2xl font-black">Perguntas frequentes</h2>
            <div className="mt-4 space-y-3">
              {post.faq.map((item) => (
                <details key={item.question} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <summary className="cursor-pointer list-none text-sm font-bold text-white">{item.question}</summary>
                  <p className="mt-2 text-sm leading-6 text-neutral-300">{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section className="froc-glow-card mt-12 p-6 text-center sm:p-8">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#FF2D87]">Fale com {post.companyName}</p>
          {post.cta && <p className="mt-3 text-lg font-black text-white">{post.cta}</p>}
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[#00E676] px-5 py-3 text-sm font-black text-black"><MessageCircle size={16} /> Chamar no WhatsApp</a>}
            {website && <a href={website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-black"><Globe size={16} /> Visitar site <ExternalLink size={12} /></a>}
            <button onClick={() => onBack(`/vitrine/${encodeURIComponent(post.companySlug)}`)} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-bold text-white">Ver a marca</button>
            <button onClick={share} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-bold text-white"><Share2 size={15} /> {copied ? 'Link copiado' : 'Compartilhar'}</button>
          </div>
        </section>

        <div className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="text-sm text-neutral-300">Quer um post como este para a sua marca, todos os dias?</p>
          <button onClick={onStart} className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FFD400] to-[#FF2D87] px-5 py-2.5 text-sm font-black text-black"><Sparkles size={15} /> Falar com a Froc.IA</button>
        </div>
      </article>
    </div>
  );
};
