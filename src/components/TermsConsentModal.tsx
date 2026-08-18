import React, { useState } from 'react';
import { ShieldCheck, FileText, CheckCircle2, ArrowRight } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { User, Wallet } from '../types';

interface TermsConsentModalProps {
  isOpen: boolean;
  onConsentSuccess: (user: User, wallet: Wallet) => void;
  onLogout: () => void;
}

export function TermsConsentModal({ isOpen, onConsentSuccess, onLogout }: TermsConsentModalProps) {
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!terms || !privacy) {
      setError('Por favor, marque o consentimento para os Termos de Uso e para a Política de Privacidade para continuar.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const response = await apiRequest<{ user: User; wallet: Wallet }>('/api/auth/accept-terms', {
        method: 'POST',
        body: {
          termsAccepted: true,
          privacyAccepted: true,
          termsVersion: '2026.1',
          privacyVersion: '2026.1'
        }
      });
      onConsentSuccess(response.user, response.wallet);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível registrar o consentimento. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-2xl">
      <div className="relative w-full max-w-lg rounded-3xl border border-cyan-500/30 bg-[#0F172A] p-6 shadow-2xl md:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Atualização de Termos de Uso</h2>
            <p className="text-xs text-slate-400">Versão 2026.1 • Froc.IA Governança & Privacidade</p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          Para garantir a conformidade jurídica, a segurança operacional e a transparência no uso de inteligência artificial e publicação em redes sociais, é necessário confirmar o consentimento com os nossos termos atualizados.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        <div className="mt-5 space-y-3">
          <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 cursor-pointer hover:border-slate-700 transition">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
            />
            <div className="text-xs leading-snug text-slate-300">
              Li e concordo com os{' '}
              <a href="/termos" target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-400 hover:underline">
                Termos de Uso (v2026.1)
              </a>{' '}
              do Froc.IA.
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 cursor-pointer hover:border-slate-700 transition">
            <input
              type="checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
            />
            <div className="text-xs leading-snug text-slate-300">
              Li e concordo com a{' '}
              <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-400 hover:underline">
                Política de Privacidade (v2026.1)
              </a>{' '}
              e o tratamento de dados.
            </div>
          </label>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onLogout}
            className="rounded-xl border border-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-400 hover:bg-slate-800/80 hover:text-white transition"
          >
            Sair da Conta
          </button>
          <button
            type="button"
            disabled={!terms || !privacy || loading}
            onClick={handleConfirm}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-xs font-bold text-slate-950 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Salvando...' : 'Confirmar e Continuar'}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
