import React, { useState } from 'react';
import {
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  Sparkles,
  TrendingUp,
  FileText,
  HelpCircle,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Company, SeoReport, Wallet } from '../types';
import { apiRequest } from '../lib/api';

interface SeoPageProps {
  selectedCompany: Company | null;
  wallet: Wallet | null;
  onRefreshWallet: () => void;
}

export const SeoPage: React.FC<SeoPageProps> = ({
  selectedCompany,
  wallet,
  onRefreshWallet
}) => {
  const [urlInput, setUrlInput] = useState(selectedCompany?.website || '');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SeoReport | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) {
      setErrorMessage('Informe a URL do site a ser auditado.');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const data = await apiRequest<{ report: SeoReport }>('/api/seo/analyze', {
        method: 'POST',
        body: {
          url: urlInput.trim(),
          companyId: selectedCompany?.id
        }
      });
      setReport(data.report);
      onRefreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro durante a análise de SEO.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Search className="text-cyan-400" /> Froc SEO Inteligente & Auditoria Web
        </h2>
        <p className="text-xs text-slate-400">
          Auditoria técnica real de páginas com detecção de metatags, densidade de palavras-chave, H1/H2 e recomendações com IA.
        </p>
      </div>

      {/* Input Box */}
      <div className="p-6 rounded-3xl bg-[#0F172A] border border-[#334155]">
        <form onSubmit={handleAnalyze} className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Globe size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
            <input
              type="text"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://suaempresa.com.br"
              className="w-full bg-[#1E293B] border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full md:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold text-xs shadow-lg shadow-blue-500/20 hover:opacity-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <>
                <Sparkles size={15} /> Analisar Página (20 créditos)
              </>
            )}
          </button>
        </form>

        {errorMessage && (
          <p className="text-xs text-rose-400 mt-3">⚠️ {errorMessage}</p>
        )}
      </div>

      {/* Report Display */}
      {report && (
        <div className="space-y-6 animate-fadeIn">
          {/* Top Score Banner */}
          <div className="p-6 rounded-3xl bg-gradient-to-r from-blue-950/80 to-slate-900 border border-blue-500/30 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1">
              <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">Score SEO Froc.IA</span>
              <h3 className="text-lg font-bold text-white truncate max-w-lg">{report.url}</h3>
              <p className="text-xs text-slate-300">
                Título detectado: &ldquo;{report.title || 'Nenhum título'}&rdquo;
              </p>
            </div>

            {/* Score Circle */}
            <div className="flex items-center gap-4 shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-slate-900 border-2 border-cyan-400 flex flex-col items-center justify-center shadow-lg shadow-cyan-500/20">
                <span className="text-2xl font-extrabold text-white">{report.seoScore}</span>
                <span className="text-[9px] text-slate-400 uppercase font-bold">de 100</span>
              </div>
              <div className="text-xs">
                <span className="font-bold text-white block">
                  {report.seoScore >= 80 ? 'Excelente Otimização 🟢' : report.seoScore >= 50 ? 'Oportunidades de Melhoria 🟡' : 'Crítico 🔴'}
                </span>
                <span className="text-[11px] text-slate-400">Score estrutural Froc.IA (10 critérios HTML)</span>
              </div>
            </div>
          </div>

          {/* Criteria Breakdown Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl bg-[#0F172A] border border-[#334155] space-y-3">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-slate-800 pb-2">
                Checklist Técnico de Indexação
              </h4>
              <div className="space-y-2 text-xs">
                {[
                  { label: 'Tag <title> Presente', pass: report.criteriaBreakdown.hasTitle },
                  { label: 'Comprimento Ideal do Título (30-65 chars)', pass: report.criteriaBreakdown.titleLengthValid },
                  { label: 'Meta Tag Description Presente', pass: report.criteriaBreakdown.hasDescription },
                  { label: 'Comprimento da Description (70-160 chars)', pass: report.criteriaBreakdown.descriptionLengthValid },
                  { label: 'Tag <h1> Principal Encontrada', pass: report.criteriaBreakdown.hasH1 },
                  { label: 'Estrutura de <h1> Único', pass: report.criteriaBreakdown.singleH1 },
                  { label: 'Segurança HTTPS Ativa', pass: report.criteriaBreakdown.hasHttps },
                  { label: 'Tag Canonical Configurada', pass: report.criteriaBreakdown.hasCanonical }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-[#1E293B]">
                    <span className="text-slate-300">{item.label}</span>
                    {item.pass ? (
                      <span className="text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                        <CheckCircle2 size={13} /> Aprovado
                      </span>
                    ) : (
                      <span className="text-rose-400 font-bold flex items-center gap-1 text-[11px]">
                        <XCircle size={13} /> Ausente
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Keyword Frequency */}
            <div className="p-5 rounded-3xl bg-[#0F172A] border border-[#334155] space-y-3">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-slate-800 pb-2">
                Palavras-chave Mais Frequentes no Conteúdo
              </h4>
              <div className="space-y-2">
                {report.keywords.map((kw, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-[#1E293B] text-xs">
                    <span className="font-semibold text-white capitalize">{kw.word}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">{kw.count}x ocorrências</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-cyan-300">
                        {kw.density}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI Actionable Recommendations */}
          <div className="p-6 rounded-3xl bg-[#0F172A] border border-cyan-500/30 space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sparkles size={15} className="text-cyan-400" /> Recomendações Práticas Geradas por IA
            </h4>
            <div className="space-y-2">
              {report.recommendations.map((rec, i) => (
                <div key={i} className="p-3 rounded-xl bg-[#1E293B] text-xs text-slate-200 flex items-start gap-2 border border-slate-700">
                  <ArrowRight size={14} className="text-cyan-400 shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ Suggestions */}
          {report.faqSuggestions && report.faqSuggestions.length > 0 && (
            <div className="p-6 rounded-3xl bg-[#0F172A] border border-[#334155] space-y-4">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <HelpCircle size={15} className="text-amber-400" /> Perguntas Frequentes (FAQ Schema) Sugeridas
              </h4>
              <div className="space-y-3">
                {report.faqSuggestions.map((faq, i) => (
                  <div key={i} className="p-4 rounded-2xl bg-[#1E293B] border border-slate-700 space-y-1 text-xs">
                    <p className="font-bold text-cyan-300">Q: {faq.question}</p>
                    <p className="text-slate-300 text-[11px]">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
