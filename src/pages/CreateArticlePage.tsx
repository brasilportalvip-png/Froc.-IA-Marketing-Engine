import React, { useState } from 'react';
import {
  FileText,
  Sparkles,
  Copy,
  Check,
  Building2,
  Search,
  Layers,
  ArrowRight,
  BookOpen
} from 'lucide-react';
import { Company, Wallet, CREDIT_COSTS } from '../types';
import { apiRequest } from '../lib/api';

interface CreateArticlePageProps {
  selectedCompany: Company | null;
  wallet: Wallet | null;
  onRefreshWallet: () => void;
  onNavigate: (tab: string) => void;
}

export const CreateArticlePage: React.FC<CreateArticlePageProps> = ({
  selectedCompany,
  wallet,
  onRefreshWallet,
  onNavigate
}) => {
  const [topic, setTopic] = useState('');
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [targetAudience, setTargetAudience] = useState(selectedCompany?.targetAudience || 'Empreendedores e Clientes');
  const [tone, setTone] = useState('Educativo, Autoritário e Otimizado para SEO');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [generatedArticle, setGeneratedArticle] = useState<{
    title: string;
    metaDescription: string;
    introduction: string;
    sections: Array<{
      h2: string;
      content: string;
      h3s?: Array<{ h3: string; content: string }>;
    }>;
    faqSection?: Array<{ question: string; answer: string }>;
    conclusion: string;
    callToAction: string;
    suggestedSlug: string;
  } | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setErrorMessage('Informe o tema do artigo.');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const data = await apiRequest<{ article: any }>('/api/ai/generate-article', {
        method: 'POST',
        body: {
          companyId: selectedCompany?.id,
          topic,
          primaryKeyword: primaryKeyword || topic,
          targetAudience,
          tone
        }
      });

      setGeneratedArticle(data.article);
      onRefreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao gerar artigo com IA.');
    } finally {
      setLoading(false);
    }
  };

  const getFullArticleText = () => {
    if (!generatedArticle) return '';
    let text = `# ${generatedArticle.title}\n\n`;
    text += `*Meta Description:* ${generatedArticle.metaDescription}\n\n`;
    text += `## Introdução\n${generatedArticle.introduction}\n\n`;

    generatedArticle.sections?.forEach((sec) => {
      text += `## ${sec.h2}\n${sec.content}\n\n`;
      sec.h3s?.forEach((sub) => {
        text += `### ${sub.h3}\n${sub.content}\n\n`;
      });
    });

    if (generatedArticle.faqSection && generatedArticle.faqSection.length > 0) {
      text += `## Perguntas Frequentes (FAQ)\n\n`;
      generatedArticle.faqSection.forEach((faq) => {
        text += `**${faq.question}**\n${faq.answer}\n\n`;
      });
    }

    text += `## Conclusão\n${generatedArticle.conclusion}\n\n`;
    text += `**Chamada:** ${generatedArticle.callToAction}\n`;
    return text;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getFullArticleText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileText className="text-cyan-400" /> Criador de Artigos Longos com SEO
        </h2>
        <p className="text-xs text-slate-400">
          Gere artigos profundos e autoritários de 1.000 a 2.500 palavras estruturados com H1, H2, H3, FAQ Schema e Meta Description.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form */}
        <div className="lg:col-span-5 p-6 rounded-3xl bg-[#0F172A] border border-[#334155] space-y-4">
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Tema Principal do Artigo *</label>
              <textarea
                rows={3}
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ex: Guia definitivo para escolher o melhor sistema de automação para pequenos negócios em 2026..."
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl p-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Palavra-chave Foco (SEO)</label>
              <input
                type="text"
                value={primaryKeyword}
                onChange={(e) => setPrimaryKeyword(e.target.value)}
                placeholder="Ex: automação de marketing para restaurantes"
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Público-Alvo do Artigo</label>
              <input
                type="text"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="Ex: Proprietários de pequenas empresas e gestores"
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Tom de Voz e Estilo</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
              >
                <option value="Educativo, Autoritário e Otimizado para SEO">Educativo, Autoritário & SEO</option>
                <option value="Jornalístico / Revista Digital">Jornalístico / Froc Magazine</option>
                <option value="Técnico e Analítico Passo a Passo">Técnico & Analítico Passo a Passo</option>
                <option value="Persuasivo com Foco em Vendas">Persuasivo com Foco em Vendas</option>
              </select>
            </div>

            {errorMessage && (
              <p className="text-xs text-rose-400">⚠️ {errorMessage}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold text-xs shadow-lg shadow-blue-500/20 hover:opacity-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              ) : (
                <>
                  <Sparkles size={16} /> Gerar Artigo Completo ({CREDIT_COSTS.seo_article} cr)
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Preview */}
        <div className="lg:col-span-7 p-6 rounded-3xl bg-[#0F172A] border border-[#334155] flex flex-col justify-between min-h-[480px]">
          {generatedArticle ? (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                  Artigo Gerado com Estrutura SEO
                </span>
                <button
                  onClick={handleCopy}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? 'Artigo Copiado!' : 'Copiar em Markdown'}
                </button>
              </div>

              {/* Title & Meta */}
              <div>
                <span className="text-[10px] text-amber-400 uppercase font-bold block mb-1">Título H1 Otimizado</span>
                <h3 className="text-sm font-bold text-white bg-[#1E293B] p-3 rounded-xl border border-slate-700">
                  {generatedArticle.title}
                </h3>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Meta Description</span>
                <p className="text-xs text-slate-300 bg-[#1E293B] p-2.5 rounded-xl border border-slate-700 italic">
                  {generatedArticle.metaDescription}
                </p>
              </div>

              {/* Article Content Preview */}
              <div className="max-h-72 overflow-y-auto space-y-3 pr-1 text-xs leading-relaxed text-slate-200">
                <div className="bg-[#1E293B]/70 p-3 rounded-xl border border-slate-700/80">
                  <h4 className="text-xs font-bold text-cyan-300 mb-1">Introdução</h4>
                  <p>{generatedArticle.introduction}</p>
                </div>

                {generatedArticle.sections?.map((sec, idx) => (
                  <div key={idx} className="bg-[#1E293B]/70 p-3 rounded-xl border border-slate-700/80 space-y-1.5">
                    <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className="text-cyan-400">H2:</span> {sec.h2}
                    </h4>
                    <p>{sec.content}</p>

                    {sec.h3s?.map((sub, sIdx) => (
                      <div key={sIdx} className="pl-3 border-l-2 border-cyan-500/40 mt-2 space-y-0.5">
                        <h5 className="text-[11px] font-bold text-slate-300">
                          <span className="text-amber-400">H3:</span> {sub.h3}
                        </h5>
                        <p className="text-[11px] text-slate-400">{sub.content}</p>
                      </div>
                    ))}
                  </div>
                ))}

                {generatedArticle.faqSection && generatedArticle.faqSection.length > 0 && (
                  <div className="bg-[#1E293B]/70 p-3 rounded-xl border border-slate-700/80 space-y-2">
                    <h4 className="text-xs font-bold text-amber-300">FAQ Schema</h4>
                    {generatedArticle.faqSection.map((faq, i) => (
                      <div key={i} className="text-[11px]">
                        <strong className="text-white">Q: {faq.question}</strong>
                        <p className="text-slate-300 mt-0.5">{faq.answer}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <BookOpen size={40} className="mb-3 text-slate-600" />
              <h4 className="text-sm font-semibold text-slate-400">Nenhum artigo produzido ainda</h4>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Configure o tema e a palavra-chave ao lado para gerar artigos de autoridade para o blog da sua empresa ou portal Froc Magazine.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
