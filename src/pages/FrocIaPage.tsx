import React, { useState } from 'react';
import {
  Sparkles,
  Bot,
  Send,
  Building2,
  Coins,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowRight,
  Share2,
  PenTool,
  Compass
} from 'lucide-react';
import { Company, Wallet, CREDIT_COSTS } from '../types';
import { apiRequest } from '../lib/api';
import { BrandLogo } from '../components/BrandLogo';

interface FrocIaPageProps {
  selectedCompany: Company | null;
  wallet: Wallet | null;
  onRefreshWallet: () => void;
  onNavigate: (tab: string) => void;
}

export const FrocIaPage: React.FC<FrocIaPageProps> = ({
  selectedCompany,
  wallet,
  onRefreshWallet,
  onNavigate
}) => {
  const [promptInput, setPromptInput] = useState('');
  const [selectedGoal, setSelectedGoal] = useState('Vendas & Atração de Novos Clientes');
  const [timeframe, setTimeframe] = useState<'semana' | 'mes'>('semana');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedStrategy, setGeneratedStrategy] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const estimatedCredits = CREDIT_COSTS.strategy; // Custo oficial para estratégia completa com Gemini 3.7 & 3.1 Pro

  const quickPrompts = [
    'Divulgue minha empresa com foco em atrair novos clientes nesta semana.',
    'Crie uma estratégia de autoridade e diferenciais para redes sociais.',
    'Planeje 5 posts persuasivos para quebrar objeções de compra.',
    'Gere um plano de promoção agressiva para o final de semana.'
  ];

  const handleStartGeneration = () => {
    if (!promptInput.trim()) {
      setErrorMessage('Digite o que você deseja que o Froc.IA planeje ou execute.');
      return;
    }
    setErrorMessage('');
    setShowConfirmModal(true);
  };

  const handleConfirmAndGenerate = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    setErrorMessage('');

    try {
      const data = await apiRequest<{ strategy: any }>('/api/ai/generate-strategy', {
        method: 'POST',
        body: {
          companyId: selectedCompany?.id,
          timeframe,
          goal: promptInput
        }
      });

      setGeneratedStrategy(data.strategy);
      onRefreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao gerar com Froc IA Engine.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl">
      {/* Top Banner */}
      <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-r from-blue-950 via-[#0F172A] to-slate-900 border border-blue-500/40 relative overflow-hidden shadow-2xl">
        <div className="flex items-center gap-4 mb-2">
          <BrandLogo size="md" showText={false} />
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Froc IA Central Marketing Hub</h2>
            <p className="text-xs text-slate-300">
              Transforme comandos em linguagem natural em estratégias, carrosséis, posts e campanhas multicanal.
            </p>
          </div>
        </div>

        {selectedCompany ? (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-950/60 border border-blue-400/30 text-xs text-cyan-300">
            <Building2 size={14} />
            Marca Ativa: <strong>{selectedCompany.name}</strong> ({selectedCompany.category})
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between">
            <span>Nenhuma empresa selecionada. Selecione ou cadastre uma empresa para hiper-personalização.</span>
            <button
              onClick={() => onNavigate('empresa')}
              className="px-3 py-1 rounded-lg bg-amber-500 text-black font-bold text-xs hover:bg-amber-400"
            >
              Configurar
            </button>
          </div>
        )}
      </div>

      {/* Main Input Box */}
      <div className="p-6 rounded-3xl bg-[#0F172A] border border-[#334155] space-y-4">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
          O que o Froc.IA deve criar para você hoje?
        </label>

        <textarea
          rows={3}
          value={promptInput}
          onChange={(e) => setPromptInput(e.target.value)}
          placeholder="Ex: Divulgue meu restaurante durante esta semana com foco nos pratos especiais de almoço e entrega rápida..."
          className="w-full bg-[#1E293B] border border-slate-700 rounded-2xl p-4 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 leading-relaxed shadow-inner"
        />

        {/* Quick prompt suggestions */}
        <div>
          <span className="text-[11px] text-slate-400 font-medium block mb-2">Exemplos rápidos:</span>
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((qp, i) => (
              <button
                key={i}
                onClick={() => setPromptInput(qp)}
                className="text-[11px] px-3 py-1.5 rounded-xl bg-[#1E293B] border border-slate-700/80 hover:border-slate-500 text-slate-300 hover:text-white transition-colors text-left"
              >
                {qp}
              </button>
            ))}
          </div>
        </div>

        {/* Configuration Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-slate-800">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Período de Ação</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as any)}
              className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
            >
              <option value="semana">1 Semana Intensiva (5 a 7 Ações)</option>
              <option value="mes">1 Mês Completo (Roadmap Estratégico)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Modelo de IA</label>
            <div className="px-3 py-2 rounded-xl bg-[#1E293B] border border-slate-700 text-xs text-cyan-300 font-medium flex items-center justify-between">
              <span>Google Gemini 2.5 Pro</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">Alta Precisão</span>
            </div>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleStartGeneration}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 hover:opacity-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              ) : (
                <>
                  <Sparkles size={15} /> Gerar Estratégia Completa
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
          <span>⚠️</span>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-[#0F172A] border border-[#334155] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Coins size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirmar Execução de IA</h3>
                <p className="text-[11px] text-slate-400">Verificação de saldo e ledger transacional.</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#1E293B] border border-slate-700 text-xs text-slate-300 space-y-2">
              <p>
                Essa ação utilizará aproximadamente <strong className="text-amber-400">{estimatedCredits} créditos</strong> do seu saldo.
              </p>
              <div className="flex items-center justify-between pt-2 border-t border-slate-700 text-[11px]">
                <span className="text-slate-400">Seu saldo atual:</span>
                <span className="font-bold text-white">{wallet?.balance ?? 0} créditos</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-[#1E293B] text-slate-300 hover:text-white text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmAndGenerate}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold text-xs shadow-md hover:opacity-95"
              >
                Confirmar e gerar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generated Strategy Display */}
      {generatedStrategy && (
        <div className="p-6 md:p-8 rounded-3xl bg-[#0F172A] border border-cyan-500/40 space-y-6 shadow-2xl animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Estratégia Produzida por Froc IA</span>
              <h3 className="text-lg font-bold text-white mt-0.5">Resumo Executivo do Plano</h3>
            </div>
            <button
              onClick={() => onNavigate('calendario')}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Calendar size={14} /> Ver no Calendário
            </button>
          </div>

          <p className="text-xs text-slate-200 leading-relaxed bg-[#1E293B] p-4 rounded-2xl border border-slate-700">
            {generatedStrategy.strategySummary}
          </p>

          {/* Pilares de Conteúdo */}
          {generatedStrategy.contentPillars && (
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Layers size={14} className="text-cyan-400" /> Pilares Estratégicos
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {generatedStrategy.contentPillars.map((pillar: string, idx: number) => (
                  <div key={idx} className="p-3 rounded-2xl bg-[#1E293B]/70 border border-slate-700 text-xs text-slate-300">
                    <span className="text-[10px] text-cyan-400 font-bold block mb-1">Pilar {idx + 1}</span>
                    {pillar}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plano de Ação Passo a Passo */}
          {generatedStrategy.actionPlan && (
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Compass size={14} className="text-cyan-400" /> Cronograma de Ações Recomendadas
              </h4>
              <div className="space-y-3">
                {generatedStrategy.actionPlan.map((action: any, i: number) => (
                  <div
                    key={i}
                    className="p-4 rounded-2xl bg-[#1E293B]/50 border border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-cyan-300 border border-blue-400/30">
                          {action.dayOrWeek}
                        </span>
                        <span className="text-[10px] text-slate-400 font-semibold">{action.platform} &bull; {action.format}</span>
                      </div>
                      <p className="text-xs font-bold text-white">{action.topic}</p>
                      <p className="text-[11px] text-slate-400 italic">&ldquo;{action.hook}&rdquo;</p>
                    </div>

                    <button
                      onClick={() => {
                        sessionStorage.setItem('froc_create_content_prefill', JSON.stringify({
                          topic: action.topic,
                          goal: action.hook || selectedGoal,
                          platform: action.platform || 'Instagram'
                        }));
                        onNavigate('criar-conteudo');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 border border-slate-700 flex items-center gap-1 shrink-0 self-start md:self-center transition-colors"
                    >
                      <PenTool size={13} /> Gerar Post deste Tópico
                    </button>
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
