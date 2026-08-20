import React, { useState } from 'react';
import {
  Video,
  Sparkles,
  Copy,
  Check,
  Building2,
  Clock,
  Mic,
  Film
} from 'lucide-react';
import { Company, Wallet, CREDIT_COSTS } from '../types';
import { apiRequest } from '../lib/api';

interface CreateVideoPageProps {
  selectedCompany: Company | null;
  wallet: Wallet | null;
  onRefreshWallet: () => void;
  onNavigate: (tab: string) => void;
}

export const CreateVideoPage: React.FC<CreateVideoPageProps> = ({
  selectedCompany,
  wallet,
  onRefreshWallet,
  onNavigate
}) => {
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState('Reels / TikTok (60s)');
  const [objective, setObjective] = useState('Quebrar objeção e converter em vendas');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [generatedScript, setGeneratedScript] = useState<{
    hook: string;
    scenes: Array<{
      sceneNumber: number;
      timeSeconds: string;
      visualDescription: string;
      audioVoiceover: string;
      onScreenText: string;
    }>;
    callToAction: string;
    suggestedAudioTrack: string;
    caption: string;
  } | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setErrorMessage('Informe o tema do vídeo.');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const data = await apiRequest<{ videoScript: any }>('/api/ai/generate-video-script', {
        method: 'POST',
        body: {
          companyId: selectedCompany?.id,
          topic,
          format: `${format} com objetivo de ${objective}`
        }
      });

      setGeneratedScript(data.videoScript);
      onRefreshWallet();
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao gerar roteiro de vídeo.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Video className="text-cyan-400" /> Criador de Roteiros de Vídeo (Reels, TikTok & YouTube)
        </h2>
        <p className="text-xs text-slate-400">
          Estrutura completa de roteirização: Gancho magnético (primeiros 3s), descrição visual cena a cena, narração e chamada final.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form */}
        <div className="lg:col-span-5 p-6 rounded-3xl bg-[#0F172A] border border-[#334155] space-y-4">
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Tema / Assunto do Vídeo *</label>
              <textarea
                rows={3}
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Ex: 3 erros que você comete ao escolher seu fornecedor e como evitar prejuízos..."
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl p-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Formato do Vídeo</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
              >
                <option value="Reels / TikTok / Shorts (30-60 segundos)">Reels / TikTok / Shorts (30-60 segundos)</option>
                <option value="Vídeo Institucional / Apresentação (2 minutos)">Vídeo Institucional (2 minutos)</option>
                <option value="Vídeo de Vendas VSL (3-5 minutos)">Vídeo de Vendas VSL (3-5 minutos)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Objetivo Estratégico</label>
              <input
                type="text"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Ex: Gerar comentários e mandar link no direct"
                className="w-full bg-[#1E293B] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              />
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
                  <Film size={16} /> Gerar Roteiro Completo ({CREDIT_COSTS.video_script} cr)
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Output */}
        <div className="lg:col-span-7 p-6 rounded-3xl bg-[#0F172A] border border-[#334155] flex flex-col justify-between min-h-[450px]">
          {generatedScript ? (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                  Roteiro de Vídeo Estruturado
                </span>
                <button
                  onClick={() => handleCopy(JSON.stringify(generatedScript, null, 2))}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? 'Copiado!' : 'Copiar Roteiro'}
                </button>
              </div>

              {/* Gancho */}
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block mb-1">
                  Gancho de Retenção (0-3s)
                </span>
                <p className="text-xs font-bold text-white">&ldquo;{generatedScript.hook}&rdquo;</p>
              </div>

              {/* Scenes */}
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {generatedScript.scenes?.map((scene, idx) => (
                  <div key={idx} className="p-3.5 rounded-2xl bg-[#1E293B] border border-slate-700 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-cyan-300 uppercase">Cena {scene.sceneNumber}</span>
                      <span className="text-slate-400 flex items-center gap-1"><Clock size={11} /> {scene.timeSeconds}</span>
                    </div>
                    <div className="text-[11px] text-slate-300">
                      <strong className="text-slate-400">Visual:</strong> {scene.visualDescription}
                    </div>
                    <div className="text-xs text-white bg-slate-900/50 p-2 rounded-xl border border-slate-800">
                      <strong className="text-cyan-400 flex items-center gap-1 mb-0.5"><Mic size={11} /> Fala / Voz:</strong>
                      {scene.audioVoiceover}
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA & Caption */}
              <div className="p-3 rounded-2xl bg-[#1E293B] border border-slate-700 text-xs space-y-1">
                <span className="text-[10px] font-bold text-cyan-400 uppercase">Chamada Final (CTA)</span>
                <p className="text-white font-semibold">{generatedScript.callToAction}</p>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <Video size={40} className="mb-3 text-slate-600" />
              <h4 className="text-sm font-semibold text-slate-400">Nenhum roteiro gerado ainda</h4>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Preencha o tema ao lado e gere um roteiro detalhado segundo as melhores práticas de retenção e viralidade.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
