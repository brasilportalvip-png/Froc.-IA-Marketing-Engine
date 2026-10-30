import React, { useEffect, useState } from 'react';
import { ExternalLink, FileCode2, Loader2, Radio, RefreshCw, Rss, Sparkles, Store } from 'lucide-react';
import { apiRequest } from '../../lib/api';

interface SeoStatus {
  sitemapIndex: string;
  sitemapTxt: string;
  feed: string;
  counts: Record<string, number>;
  totalUrls: number;
  indexNow: { configured: boolean; enabled: boolean; keyLocation: string | null };
  lastPings: Array<{ id: string; reason: string; urlCount: number; status: number | string; message: string; createdAt: string }>;
}

const GROUP_LABEL: Record<string, string> = { page: 'Páginas', post: 'Artigos (Magazine)', vitrine: 'Marcas da Vitrine', 'vitrine-post': 'Posts diários' };

export const AdminSeoPanel: React.FC = () => {
  const [status, setStatus] = useState<SeoStatus | null>(null);
  const [busy, setBusy] = useState<'load' | 'ping' | 'daily' | null>('load');
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    setBusy('load');
    try { setStatus(await apiRequest<SeoStatus>('/api/admin/seo/status')); } catch (err: any) { setFeedback(err?.message || 'Falha ao carregar o motor SEO.'); } finally { setBusy(null); }
  };
  useEffect(() => { void load(); }, []);

  const pingAll = async () => {
    setBusy('ping'); setFeedback('');
    try {
      const result = await apiRequest<{ submitted: number; status: any; message?: string }>('/api/admin/seo/ping-all', { method: 'POST', body: {} });
      setFeedback(`IndexNow: ${result.message || result.status} (${result.submitted} URLs).`);
      await load();
    } catch (err: any) { setFeedback(err?.message || 'Falha no ping.'); } finally { setBusy(null); }
  };

  const generateDaily = async () => {
    setBusy('daily'); setFeedback('');
    try {
      const result = await apiRequest<{ created: number; pending: number; errors: number }>('/api/admin/vitrine/generate-daily', { method: 'POST', body: { limit: 10 }, timeoutMs: 5 * 60_000 });
      setFeedback(`Posts diários: ${result.created} criados, ${result.pending} pendentes, ${result.errors} erros.`);
      await load();
    } catch (err: any) { setFeedback(err?.message || 'Falha ao gerar posts.'); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      {feedback && <div className="rounded-2xl border border-[#FFD400]/30 bg-[#FFD400]/10 p-3 text-xs text-[#ffe14d]">{feedback}</div>}
      <section className="froc-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="froc-section-title flex items-center gap-2"><FileCode2 size={15} className="text-[#00E676]" /> Motor SEO — Sitemaps (padrão Yoast + Google)</h3>
            <p className="mt-1 text-xs text-slate-400">{status ? `${status.totalUrls} URLs indexáveis publicadas nos sitemaps.` : 'Carregando…'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void load()} className="froc-secondary inline-flex items-center gap-2"><RefreshCw size={13} className={busy === 'load' ? 'animate-spin' : ''} /> Atualizar</button>
            <button onClick={() => void pingAll()} disabled={busy !== null} className="froc-secondary inline-flex items-center gap-2">{busy === 'ping' ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />} Ping IndexNow (tudo)</button>
            <button onClick={() => void generateDaily()} disabled={busy !== null} className="froc-primary inline-flex items-center gap-2">{busy === 'daily' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Gerar posts do dia</button>
          </div>
        </div>
        {status && (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Object.entries(status.counts).map(([group, count]) => (
                <a key={group} href={`/${group}-sitemap.xml`} target="_blank" rel="noreferrer" className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 hover:border-[#FFD400]/50">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{GROUP_LABEL[group] || group}</p>
                  <p className="mt-1 text-2xl font-black text-white">{count}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#FFD400]">{group}-sitemap.xml <ExternalLink size={9} /></p>
                </a>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
              {[[status.sitemapIndex, 'sitemap_index.xml'], [status.sitemapTxt, 'sitemap.txt'], [status.feed, 'feed.xml (RSS)'], ['/robots.txt', 'robots.txt']].map(([href, label]) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1.5 text-slate-300 hover:text-white">{label.includes('RSS') ? <Rss size={11} /> : <FileCode2 size={11} />} {label}</a>
              ))}
            </div>
          </>
        )}
      </section>

      {status && (
        <section className="froc-panel">
          <h3 className="froc-section-title flex items-center gap-2"><Radio size={15} className="text-[#FF2D87]" /> IndexNow (Bing, Yandex, Seznam, Naver, Yep)</h3>
          <p className="mt-2 text-xs text-slate-400">
            {status.indexNow.configured ? `Configurado · chave em ${status.indexNow.keyLocation}` : 'Defina a variável INDEXNOW_KEY (8 a 128 caracteres: letras, números e hífen) na Vercel para ativar os pings.'}
            {' '}O Google descobre os sitemaps pelo robots.txt e pelo Search Console (o antigo “ping” do Google foi desativado por ele em 2023).
          </p>
          <div className="mt-4 space-y-2">
            {status.lastPings.length ? status.lastPings.map((ping) => (
              <div key={ping.id} className="flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="text-white">{ping.reason} · {ping.urlCount} URLs</span>
                <span className="text-slate-400">{String(ping.status)} · {new Date(ping.createdAt).toLocaleString('pt-BR')}</span>
              </div>
            )) : <p className="text-xs text-slate-500">Nenhum ping registrado ainda.</p>}
          </div>
        </section>
      )}

      <section className="froc-panel">
        <h3 className="froc-section-title flex items-center gap-2"><Store size={15} className="text-[#FFD400]" /> Vitrine diária</h3>
        <p className="mt-2 text-xs text-slate-400">O agendador (/api/cron/process) gera automaticamente 1 post estratégico por dia para cada marca pública, em lotes (VITRINE_DAILY_POSTS_PER_TICK), e avisa os buscadores. Para pausar, defina VITRINE_DAILY_POSTS_ENABLED=false.</p>
      </section>
    </div>
  );
};
