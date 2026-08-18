import React, { useState } from 'react';
import {
  PenTool,
  Sparkles,
  Copy,
  Calendar,
  Check,
  Building2,
  Share2,
  RefreshCw,
  Zap,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Company, Wallet, ContentItem } from '../types';
import { apiRequest } from '../lib/api';

interface CreateContentPageProps {
  companies: Company[];
  selectedCompany: Company | null;
  wallet: Wallet | null;
  onRefreshWallet: () => void;
  onNavigate: (tab: string) => void;
}

export const CreateContentPage: React.FC<CreateContentPageProps> = ({
  companies,
  selectedCompany,
  wallet,
  onRefreshWallet,
  onNavigate
}) => {
  const [contentType, setContentType] = useState<'post' | 'carousel' | 'cta' | 'headline'>('post');
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState('Instagram');
  const [goal, setGoal] = useState('Gerar autoridade e novos clientes');
  const [tone, setTone] = useState('Persuasivo e Profissional');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);

  // Result state
  const [generatedPost, setGeneratedPost] = useState<{
    headline: string;
    body: string;
    cta: string;
    hashtags: string[];
    visualPrompt: string;
    keywords: string[];
  } | null>(null);

  const [generatedCarousel, setGeneratedCarousel] = useState<any | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setErrorMessage('Informe o tema ou assunto do conteúdo.');
      return;
    }
    setErrorMessage('');
    setLoading(true);

    try {
      if (contentType === 'post') {
        const data = await apiRequest<{ post: any; contentItem: ContentItem }>('/api/ai/generate-post', {
          method: 'POST',
          body: {
            companyId: selectedCompany?.id,
            topic,
            platform,
            goal,
            tone
          }
        });
        setGeneratedPost(data.post);
        setGeneratedCarousel(null);
      } else if (contentType === 'carousel') {
        const data = await apiRequest<{ carousel: any }>('/api/ai/generate-carousel', {
          method: 'POST',
          body: {
            companyId: selectedCompany?.id,
            topic,
            goal,
            slidesCount: 5
          }
        });
        setGeneratedCarousel(data.carousel);
        setGeneratedPost(null);
      } else {
        // Copy / CTA / Headline
        const data = await apiRequest<{ text: string }>('/api/ai/generate-copy', {
          method: 'POST',
          body: {
            companyId: selectedCompany?.id,
            type: contentType,
            prompt: `${topic} com foco em ${goal} para a plataforma ${platform}`
          }
        });
        setGeneratedPost({
          headline: contentType === 'headline' ? data.text : 'Copy Estratégica',
          body: data.text,
          cta: contentType === 'cta' ? data.text : 'Saiba mais no link da bio',
          hashtags: ['#marketing', '#negocios', '#inovacao'],
          visualPrompt: 'Imagem profissional moderna de alto contraste',
          keywords: []
        });
        setGeneratedCarousel(null);
      }

      onRefreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao gerar conteúdo com IA.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <PenTool className="text-cyan-400" /> Criador de Conteúdo com IA
          </h2>
          <p className="text-xs text-slate-400">
            Gere posts completos, carrosséis estruturados, CTAs e legendas magnéticas com contexto da sua marca.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form (5 cols) */}
        <div className="lg:col-span-5 p-6 rounded-3xl bg-[#0F172A] border border-[#334155] space-y-4">
          {/* Format Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Formato Desejado</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'post', label: 'Post Completo' },
                { id: 'carousel', label: 'Carrossel (5 Slides)' },
                { id: 'headline', label: 'Headlines' },
                { id: 'cta', label: 'Chamadas CTA' }
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setContentType(f.id as any)}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                    contentType === f.id
                      ? 'bg-blue-600/30 text-cyan-300 border-blue-500'
                      : 'bg-[#1E293B] text-slate-400 border-slate-700 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Tema / Assunto do Conteúdo *</label>
            <textarea
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ex: Como nosso método inovador reduz o tempo de entrega pela metade..."
              className="w-full bg-[#1E293B] border border-slate-700 rounded-xl p-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Rede Social</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
              >
                <option value="Instagram">Instagram</option>
                <option value="LinkedIn">LinkedIn</option>
                <option value="Facebook">Facebook</option>
                <option value="TikTok">TikTok</option>
                <option value="X">X (Twitter)</option>
                <option value="Pinterest">Pinterest</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Tom de Voz</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
              >
                <option value="Persuasivo e Profissional">Persuasivo & Profissional</option>
                <option value="Autoritário e Educativo">Autoritário & Educativo</option>
                <option value="Descontraído e Envolvente">Descontraído & Envolvente</option>
                <option value="Direto e Urgente (Vendas)">Direto & Urgente (Vendas)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Objetivo da Postagem</label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Ex: Quebrar objeções e levar para o WhatsApp"
              className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>

          {errorMessage && (
            <p className="text-xs text-rose-400">⚠️ {errorMessage}</p>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 hover:opacity-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <>
                <Sparkles size={16} /> Gerar Conteúdo
              </>
            )}
          </button>
        </div>

        {/* Right Output Card (7 cols) */}
        <div className="lg:col-span-7 p-6 rounded-3xl bg-[#0F172A] border border-[#334155] flex flex-col justify-between min-h-[450px]">
          {generatedPost ? (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                  Post Gerado para {platform}
                </span>
                <button
                  onClick={() => handleCopyText(`${generatedPost.headline}\n\n${generatedPost.body}\n\n${generatedPost.cta}\n\n${generatedPost.hashtags.join(' ')}`)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? 'Copiado!' : 'Copiar Tudo'}
                </button>
              </div>

              {/* Headline */}
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Headline Magnética</span>
                <p className="text-sm font-bold text-white bg-[#1E293B] p-3 rounded-xl border border-slate-700">
                  {generatedPost.headline}
                </p>
              </div>

              {/* Body */}
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Texto Principal do Post</span>
                <div className="text-xs text-slate-200 whitespace-pre-line leading-relaxed bg-[#1E293B] p-4 rounded-xl border border-slate-700 max-h-56 overflow-y-auto">
                  {generatedPost.body}
                </div>
              </div>

              {/* CTA & Hashtags */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-[#1E293B] p-3 rounded-xl border border-slate-700">
                  <span className="text-[10px] text-amber-400 uppercase font-bold block mb-1">Chamada para Ação (CTA)</span>
                  <p className="text-xs text-slate-200 font-semibold">{generatedPost.cta}</p>
                </div>
                <div className="bg-[#1E293B] p-3 rounded-xl border border-slate-700">
                  <span className="text-[10px] text-cyan-400 uppercase font-bold block mb-1">Hashtags Estratégicas</span>
                  <p className="text-[11px] text-cyan-300 font-mono">{generatedPost.hashtags.join(' ')}</p>
                </div>
              </div>

              {/* Sugestão Visual */}
              {generatedPost.visualPrompt && (
                <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-500/30 text-xs text-purple-200">
                  <span className="text-[10px] font-bold uppercase text-purple-400 block mb-0.5">Sugestão de Criativo Visual</span>
                  {generatedPost.visualPrompt}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => onNavigate('calendario')}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Calendar size={14} /> Agendar Publicação
                </button>
                <button
                  onClick={handleGenerate}
                  className="px-3 py-2 rounded-xl bg-[#1E293B] hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1.5"
                >
                  <RefreshCw size={13} /> Gerar Outra Versão
                </button>
              </div>
            </div>
          ) : generatedCarousel ? (
            <div className="space-y-4 animate-fadeIn">
              <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                {generatedCarousel.carouselTitle}
              </h3>
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {generatedCarousel.slides?.map((slide: any, idx: number) => (
                  <div key={idx} className="p-3 rounded-xl bg-[#1E293B] border border-slate-700 space-y-1">
                    <span className="text-[10px] font-bold text-amber-400 uppercase">Slide {slide.slideNumber}</span>
                    <h5 className="text-xs font-bold text-white">{slide.title}</h5>
                    <p className="text-xs text-slate-300">{slide.text}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 italic bg-[#1E293B] p-3 rounded-xl">
                Legenda: {generatedCarousel.caption}
              </p>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <PenTool size={40} className="mb-3 text-slate-600" />
              <h4 className="text-sm font-semibold text-slate-400">Nenhum conteúdo gerado ainda</h4>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Preencha as informações ao lado e clique em &ldquo;Gerar Conteúdo&rdquo; para criar copys profissionais com inteligência artificial.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
