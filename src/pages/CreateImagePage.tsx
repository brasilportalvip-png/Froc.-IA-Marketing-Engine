import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Image as ImageIcon, Sparkles, Wand2, Zap, Layers, RefreshCw } from 'lucide-react';
import type { Company, Wallet } from '../types';
import { CREDIT_COSTS } from '../types';
import { apiRequest } from '../lib/api';

interface Props {
  selectedCompany: Company | null;
  wallet: Wallet | null;
  onRefreshWallet: () => void;
  onRefreshContents?: () => void;
  onNavigate: (tab: string) => void;
}

interface ImagePrompt {
  promptPt: string;
  promptEn: string;
  artStyle: string;
  composition: string;
  colorPalette: string[];
  lightingNote: string;
  aspectRatio: string;
}

interface GeneratedImage {
  imageUrl: string;
  mimeType: string;
  creditsUsed: number;
  modelUsed: string;
  resolution?: string;
}

export const CreateImagePage: React.FC<Props> = ({
  selectedCompany,
  wallet,
  onRefreshWallet,
  onRefreshContents,
  onNavigate
}) => {
  const [theme, setTheme] = useState('');
  const [platform, setPlatform] = useState('Instagram Feed (1:1)');
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('1K');
  const [style, setStyle] = useState('Fotografia comercial premium, realista e moderna');
  const [lighting, setLighting] = useState('Iluminação de estúdio suave e cinematográfica');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<ImagePrompt | null>(null);
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);

  const aspectRatio = useMemo(() => {
    if (platform.includes('9:16') || platform.includes('Stories') || platform.includes('Reels') || platform.includes('TikTok')) return '9:16';
    if (platform.includes('16:9') || platform.includes('YouTube') || platform.includes('Site')) return '16:9';
    if (platform.includes('2:3') || platform.includes('Pinterest')) return '2:3';
    if (platform.includes('4:5')) return '4:5';
    return '1:1';
  }, [platform]);

  const resolutionCost = useMemo(() => {
    if (resolution === '4K') return CREDIT_COSTS.image_ai_4k || 40;
    if (resolution === '2K') return CREDIT_COSTS.image_ai_2k || 25;
    return CREDIT_COSTS.image_ai_1k || 15;
  }, [resolution]);

  const briefing = `${style}. ${lighting}. Formato ${platform}, proporção ${aspectRatio}, resolução alvo ${resolution}.`;

  const requireTheme = () => {
    if (!theme.trim()) {
      setError('Informe a ideia ou briefing da imagem.');
      return false;
    }
    if (!selectedCompany?.id) {
      setError('Selecione uma empresa para aplicar as diretrizes e identidade da marca.');
      return false;
    }
    return true;
  };

  const createDirection = async () => {
    if (!requireTheme()) return;
    setLoadingPrompt(true);
    setError('');
    try {
      const data = await apiRequest<{ imagePrompt: ImagePrompt }>('/api/ai/generate-image-prompt', {
        method: 'POST',
        body: { companyId: selectedCompany!.id, theme, style: briefing }
      });
      setGeneratedPrompt(data.imagePrompt);
      onRefreshWallet();
    } catch (e: any) {
      setError(e.message || 'Falha ao criar direção visual.');
    } finally {
      setLoadingPrompt(false);
    }
  };

  const renderImage = async () => {
    if (!requireTheme()) return;
    setLoadingImage(true);
    setError('');
    try {
      const visual = generatedPrompt?.promptEn || generatedPrompt?.promptPt || theme;
      const data = await apiRequest<{ image: GeneratedImage; imageUrl: string }>('/api/ai/generate-image', {
        method: 'POST',
        body: {
          companyId: selectedCompany!.id,
          theme: visual,
          title: theme,
          style: briefing,
          aspectRatio,
          resolution
        }
      });
      setGeneratedImage({
        ...data.image,
        resolution
      });
      onRefreshWallet();
      onRefreshContents?.();
    } catch (e: any) {
      setError(e.message || 'Falha ao gerar imagem com IA.');
    } finally {
      setLoadingImage(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione o texto manualmente.');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-white">
            <ImageIcon className="text-cyan-400" />
            Estúdio de Imagens Froc.IA
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Geração real de imagem pelo Gemini com controle de resolução (1K, 2K, 4K), salva diretamente na sua biblioteca.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3.5 py-2 text-xs font-bold text-amber-200">
            Saldo: {wallet?.balance ?? 0} créditos
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {!selectedCompany && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-200">
          Selecione uma empresa para que a IA respeite identidade, público, produtos e tom da marca.{' '}
          <button onClick={() => onNavigate('empresa')} className="ml-1 font-bold underline">
            Configurar empresa
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Formulário de Configuração */}
        <section className="froc-panel space-y-4 lg:col-span-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Ideia / Briefing da Imagem *
            </label>
            <textarea
              rows={4}
              required
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Ex: Campanha de lançamento de um tênis esportivo premium, close no produto, iluminação neon sofisticada..."
              className="froc-input mt-1.5 resize-y"
            />
          </div>

          {/* Seletor de Resolução */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Qualidade / Resolução</span>
              <span className="text-[10px] text-cyan-400 font-bold">{resolutionCost} créditos</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { key: '1K', label: '1K Standard', cost: CREDIT_COSTS.image_ai_1k || 15, desc: 'Rápida e leve' },
                  { key: '2K', label: '2K High-Def', cost: CREDIT_COSTS.image_ai_2k || 25, desc: 'Alta nitidez' },
                  { key: '4K', label: '4K Ultra HD', cost: CREDIT_COSTS.image_ai_4k || 40, desc: 'Publicitário' }
                ] as const
              ).map((res) => (
                <button
                  key={res.key}
                  type="button"
                  onClick={() => setResolution(res.key)}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all ${
                    resolution === res.key
                      ? 'border-cyan-500 bg-cyan-500/15 text-white shadow-sm shadow-cyan-500/20'
                      : 'border-slate-700/80 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                  }`}
                >
                  <span className="text-xs font-black">{res.key}</span>
                  <span className="text-[10px] text-slate-400">{res.desc}</span>
                  <span className="text-[9px] font-bold text-cyan-300 mt-0.5">{res.cost} cr</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300">Formato / Proporção</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="froc-input mt-1.5"
              >
                <option>Instagram Feed (1:1)</option>
                <option>Stories / Reels / TikTok (9:16)</option>
                <option>Vídeo / Site / YouTube (16:9)</option>
                <option>Instagram Retrato (4:5)</option>
                <option>Pinterest Pin (2:3)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">Iluminação</label>
              <select
                value={lighting}
                onChange={(e) => setLighting(e.target.value)}
                className="froc-input mt-1.5"
              >
                <option>Iluminação de estúdio suave e cinematográfica</option>
                <option>Luz natural de golden hour</option>
                <option>Contraste dramático com rim light</option>
                <option>High-key clean de e-commerce</option>
                <option>Cyberpunk / Neon urbano vibrante</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300">Estilo Visual</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="froc-input mt-1.5"
            >
              <option>Fotografia comercial premium, realista e moderna</option>
              <option>Editorial de luxo, clean e sofisticado</option>
              <option>3D publicitário realista de alta qualidade</option>
              <option>Ilustração moderna, minimalista e vibrante</option>
              <option>Design gráfico editorial com tipografia elegante</option>
            </select>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 pt-2">
            <button
              type="button"
              onClick={createDirection}
              disabled={loadingPrompt || loadingImage}
              className="min-h-11 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 text-xs font-black text-cyan-200 hover:bg-cyan-500/20 transition-all disabled:opacity-50"
            >
              <span className="flex items-center justify-center gap-1.5">
                <Wand2 size={14} />
                {loadingPrompt ? 'Criando…' : `Direção visual · ${CREDIT_COSTS.image_prompt} cr`}
              </span>
            </button>
            <button
              type="button"
              onClick={renderImage}
              disabled={loadingImage || loadingPrompt}
              className="froc-primary min-h-11 flex items-center justify-center gap-2 text-xs font-black"
            >
              <Sparkles size={15} />
              {loadingImage ? 'Gerando imagem…' : `Gerar imagem · ${resolutionCost} cr`}
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="flex items-center gap-1.5 font-bold text-slate-300 mb-0.5">
              <Zap size={12} className="text-amber-400" />
              Garantia de Entrega Froc.IA
            </div>
            A cobrança ocorre somente após a imagem ser renderizada e salva com sucesso no Storage. Se houver falha, seus créditos são automaticamente estornados.
          </div>
        </section>

        {/* Visualização de Resultado */}
        <section className="froc-panel min-h-[520px] lg:col-span-7 flex flex-col justify-between">
          {generatedImage ? (
            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 flex items-center justify-center min-h-[380px]">
                <img
                  src={generatedImage.imageUrl}
                  alt={`Imagem gerada para ${theme}`}
                  className="h-auto max-h-[500px] w-full object-contain rounded-xl"
                />
                <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-slate-900/80 backdrop-blur border border-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold text-cyan-300">
                  <Layers size={11} /> {generatedImage.resolution || resolution}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div>
                  <div className="text-xs font-black text-emerald-300 flex items-center gap-1.5">
                    <Check size={14} /> Imagem salva na Biblioteca de Conteúdos
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Modelo: {generatedImage.modelUsed} • Consumo: {generatedImage.creditsUsed} créditos
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={generatedImage.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 transition-all"
                  >
                    <Download size={14} /> Baixar Imagem
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[440px] place-items-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 p-8 text-center my-auto">
              <div>
                <ImageIcon size={48} className="mx-auto text-slate-700" />
                <div className="mt-3 text-sm font-bold text-slate-300">Seu criativo aparecerá aqui</div>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
                  Defina o briefing ao lado e escolha a resolução desejada (1K, 2K ou 4K). A imagem gerada será exibida aqui e salva na sua conta.
                </p>
              </div>
            </div>
          )}

          {generatedPrompt && (
            <div className="mt-5 space-y-3 rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-purple-300 flex items-center gap-1.5">
                  <Wand2 size={13} /> Direção Visual Gerada
                </div>
                <button
                  type="button"
                  onClick={() => copy(generatedPrompt.promptEn || generatedPrompt.promptPt)}
                  className="flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:underline"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado' : 'Copiar prompt'}
                </button>
              </div>
              <p className="text-xs leading-relaxed text-slate-300">{generatedPrompt.promptPt}</p>
              <div className="grid gap-2 text-[10px] text-slate-400 sm:grid-cols-2">
                <div>
                  <strong className="text-white">Composição:</strong> {generatedPrompt.composition}
                </div>
                <div>
                  <strong className="text-white">Luz:</strong> {generatedPrompt.lightingNote}
                </div>
                <div>
                  <strong className="text-white">Estilo:</strong> {generatedPrompt.artStyle}
                </div>
                <div>
                  <strong className="text-white">Proporção:</strong> {generatedPrompt.aspectRatio || aspectRatio}
                </div>
              </div>
              {generatedPrompt.colorPalette?.length ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {generatedPrompt.colorPalette.map((color) => (
                    <span key={color} className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[9px] text-slate-300 font-mono">
                      {color}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
