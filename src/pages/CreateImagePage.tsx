import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Image as ImageIcon, Sparkles, Wand2 } from 'lucide-react';
import type { Company, Wallet } from '../types';
import { CREDIT_COSTS } from '../types';
import { apiRequest } from '../lib/api';

interface Props { selectedCompany: Company | null; wallet: Wallet | null; onRefreshWallet: () => void; onRefreshContents?: () => void; onNavigate: (tab: string) => void; }
interface ImagePrompt { promptPt: string; promptEn: string; artStyle: string; composition: string; colorPalette: string[]; lightingNote: string; aspectRatio: string; }
interface GeneratedImage { imageUrl: string; mimeType: string; creditsUsed: number; modelUsed: string; }

export const CreateImagePage: React.FC<Props> = ({ selectedCompany, wallet, onRefreshWallet, onRefreshContents, onNavigate }) => {

  const [theme, setTheme] = useState('');
  const [platform, setPlatform] = useState('Instagram Feed');
  const [style, setStyle] = useState('Fotografia comercial premium, realista e moderna');
  const [lighting, setLighting] = useState('Iluminação de estúdio suave e cinematográfica');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<ImagePrompt | null>(null);
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);

  const aspectRatio = useMemo(() => {
    if (platform.includes('Stories') || platform.includes('Reels') || platform.includes('TikTok')) return '9:16';
    if (platform.includes('YouTube') || platform.includes('Site')) return '16:9';
    if (platform.includes('Pinterest')) return '2:3';
    return '1:1';
  }, [platform]);

  const briefing = `${style}. ${lighting}. Formato ${platform}, proporção ${aspectRatio}.`;

  const requireTheme = () => {
    if (!theme.trim()) { setError('Informe a ideia ou tema da imagem.'); return false; }
    if (!selectedCompany?.id) { setError('Selecione uma empresa para usar o contexto da marca.'); return false; }
    return true;
  };

  const createDirection = async () => {
    if (!requireTheme()) return;
    setLoadingPrompt(true); setError('');
    try {
      const data = await apiRequest<{ imagePrompt: ImagePrompt }>('/api/ai/generate-image-prompt', {
        method: 'POST', body: { companyId: selectedCompany!.id, theme, style: briefing }
      });
      setGeneratedPrompt(data.imagePrompt);
      onRefreshWallet();
    } catch (e: any) { setError(e.message || 'Falha ao criar direção visual.'); }
    finally { setLoadingPrompt(false); }
  };

  const renderImage = async () => {
    if (!requireTheme()) return;
    setLoadingImage(true); setError('');
    try {
      const visual = generatedPrompt?.promptEn || generatedPrompt?.promptPt || theme;
      const data = await apiRequest<{ image: GeneratedImage; imageUrl: string }>('/api/ai/generate-image', {
        method: 'POST',
        body: { companyId: selectedCompany!.id, theme: visual, title: theme, style: briefing, aspectRatio }
      });
      setGeneratedImage(data.image); 
      onRefreshWallet();
      onRefreshContents?.();
    } catch (e: any) { setError(e.message || 'Falha ao gerar imagem com IA.'); }
    finally { setLoadingImage(false); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError('Não foi possível copiar automaticamente. Selecione o texto manualmente.'); }
  };

  return <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="flex items-center gap-2 text-xl font-black text-white"><ImageIcon className="text-cyan-400"/>Estúdio de Imagens Froc.IA</h2><p className="mt-1 text-xs text-slate-400">Direção visual + geração real de imagem pelo Gemini, salva automaticamente na sua biblioteca.</p></div>
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] font-bold text-amber-200">Saldo: {wallet?.balance ?? 0} créditos</div>
    </header>

    {error && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">⚠️ {error}</div>}
    {!selectedCompany && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-200">Selecione uma empresa para que a IA respeite identidade, público, produtos e tom da marca. <button onClick={() => onNavigate('empresa')} className="ml-1 font-bold underline">Configurar empresa</button></div>}

    <div className="grid gap-6 lg:grid-cols-12">
      <section className="froc-panel space-y-4 lg:col-span-5">
        <label className="block text-xs font-semibold text-slate-300">Ideia / briefing da imagem<textarea rows={4} required value={theme} onChange={e => setTheme(e.target.value)} placeholder="Ex: campanha de lançamento de uma pizza artesanal, close no produto, atmosfera premium…" className="froc-input mt-1.5 resize-y"/></label>
        <label className="block text-xs font-semibold text-slate-300">Formato<select value={platform} onChange={e => setPlatform(e.target.value)} className="froc-input mt-1.5"><option>Instagram Feed</option><option>Stories / Reels / TikTok</option><option>YouTube / Site</option><option>Pinterest Pin</option></select></label>
        <label className="block text-xs font-semibold text-slate-300">Estilo<select value={style} onChange={e => setStyle(e.target.value)} className="froc-input mt-1.5"><option>Fotografia comercial premium, realista e moderna</option><option>Editorial de luxo, clean e sofisticado</option><option>3D publicitário de alta qualidade</option><option>Ilustração moderna e vibrante</option><option>Minimalista, tecnológico e futurista</option></select></label>
        <label className="block text-xs font-semibold text-slate-300">Iluminação<select value={lighting} onChange={e => setLighting(e.target.value)} className="froc-input mt-1.5"><option>Iluminação de estúdio suave e cinematográfica</option><option>Luz natural de golden hour</option><option>Contraste dramático com rim light</option><option>High-key clean de e-commerce</option></select></label>
        <div className="grid gap-2 sm:grid-cols-2"><button onClick={createDirection} disabled={loadingPrompt || loadingImage} className="min-h-11 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 text-xs font-black text-cyan-200 disabled:opacity-50"><span className="flex items-center justify-center gap-2"><Wand2 size={15}/>{loadingPrompt ? 'Criando…' : `Direção visual · ${CREDIT_COSTS.image_prompt} cr`}</span></button><button onClick={renderImage} disabled={loadingImage || loadingPrompt} className="froc-primary flex items-center justify-center gap-2"><Sparkles size={15}/>{loadingImage ? 'Gerando imagem…' : `Gerar imagem · ${CREDIT_COSTS.image_ai} cr`}</button></div>
        <p className="text-[10px] leading-relaxed text-slate-500">A imagem é gerada no servidor, registrada no ledger de créditos e armazenada no Firebase Storage. O navegador nunca recebe sua chave Gemini.</p>
      </section>

      <section className="froc-panel min-h-[520px] lg:col-span-7">
        {generatedImage ? <div className="space-y-4"><div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950"><img src={generatedImage.imageUrl} alt={`Imagem gerada para ${theme}`} className="h-auto w-full object-contain"/></div><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black text-emerald-300">Imagem gerada e salva</div><div className="text-[10px] text-slate-500">{generatedImage.modelUsed} • {generatedImage.creditsUsed} créditos</div></div><a href={generatedImage.imageUrl} target="_blank" rel="noreferrer" download className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-xs font-bold text-white"><Download size={14}/>Abrir / baixar</a></div></div> : <div className="grid min-h-[440px] place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 p-8 text-center"><div><ImageIcon size={46} className="mx-auto text-slate-700"/><div className="mt-3 text-sm font-bold text-slate-300">Seu criativo aparecerá aqui</div><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">Você pode gerar a imagem diretamente ou criar primeiro uma direção visual detalhada para controlar melhor o resultado.</p></div></div>}

        {generatedPrompt && <div className="mt-5 space-y-3 rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4"><div className="flex items-center justify-between"><div className="text-xs font-black text-purple-300">Direção visual</div><button onClick={() => copy(generatedPrompt.promptEn || generatedPrompt.promptPt)} className="flex items-center gap-1 text-[10px] font-bold text-cyan-300">{copied ? <Check size={12}/> : <Copy size={12}/>} {copied ? 'Copiado' : 'Copiar prompt'}</button></div><p className="text-xs leading-relaxed text-slate-300">{generatedPrompt.promptPt}</p><div className="grid gap-2 text-[10px] text-slate-400 sm:grid-cols-2"><div><strong className="text-white">Composição:</strong> {generatedPrompt.composition}</div><div><strong className="text-white">Luz:</strong> {generatedPrompt.lightingNote}</div><div><strong className="text-white">Estilo:</strong> {generatedPrompt.artStyle}</div><div><strong className="text-white">Proporção:</strong> {generatedPrompt.aspectRatio || aspectRatio}</div></div>{generatedPrompt.colorPalette?.length ? <div className="flex flex-wrap items-center gap-2">{generatedPrompt.colorPalette.map(color => <span key={color} className="rounded-lg border border-slate-700 px-2 py-1 text-[9px] text-slate-400">{color}</span>)}</div> : null}</div>}
      </section>
    </div>
  </div>;
};
