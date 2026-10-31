import React, { useState } from 'react';
import { Crown, Loader2, Sparkles, Store } from 'lucide-react';
import type { Company, Wallet } from '../types';
import { apiRequest } from '../lib/api';

interface Props {
  company: Company | null;
  wallet: Wallet | null;
  isAdmin?: boolean;
  onNavigate: (tab: string) => void;
  onChanged: () => void;
}

const DAILY_COST = 10;

/**
 * Vitrine paga: só assinantes entram; cada projeto usa 10 créditos por dia e ganha
 * 1 post personalizado com imagem do nicho. Acabou o crédito, o projeto sai sozinho.
 * Ligar/desligar o post diário é exclusivo do administrador.
 */
export const VitrineAccessCard: React.FC<Props> = ({ company, wallet, isAdmin, onNavigate, onChanged }) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!company) return null;
  const paid = Boolean(wallet && wallet.planId && wallet.planId !== 'plan_free' && ['active', 'cancel_at_period_end'].includes(String(wallet.planStatus)));
  const balance = Number(wallet?.balance || 0);
  const inVitrine = Boolean(company.isPublicInVitrine);
  const removed = (company as any).vitrineRemovedReason as string | undefined;
  const daysLeft = Math.floor(balance / DAILY_COST);

  const enter = async () => {
    setLoading(true); setError(''); setMessage('');
    try {
      const data = await apiRequest<{ message: string }>(`/api/companies/${encodeURIComponent(company.id)}/vitrine`, { method: 'POST', timeoutMs: 120_000 });
      setMessage(data.message || 'Seu projeto está na Vitrine!');
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível colocar o projeto na Vitrine agora.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-[#FFD400]/25 bg-gradient-to-br from-[#FFD400]/[0.07] via-[#0b0b0b] to-[#FF2D87]/[0.07] p-6">
      <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#FFD400]/20 blur-3xl" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-[#FFD400]"><Store size={13} /> Vitrine Froc.IA</p>
          <h2 className="mt-1 text-lg font-black text-white">
            {inVitrine ? `${company.name} está na Vitrine 👑` : `Coloque ${company.name} na Vitrine`}
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-neutral-300">
            {inVitrine
              ? isAdmin
                ? 'Projeto do administrador: sem cobrança de diária.'
                : `Todo dia seu projeto ganha 1 post personalizado com imagem exclusiva do nicho (${DAILY_COST} créditos por dia). Seu saldo cobre cerca de ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}.`
              : `Exclusivo para assinantes: ${DAILY_COST} créditos por dia por projeto, com 1 post estratégico por dia, SEO local e aviso imediato aos buscadores.`}
          </p>
          {!inVitrine && removed && (
            <p className="mt-2 text-[11px] font-bold text-[#ff7ab3]">{removed === 'no_credits' ? 'Seu projeto saiu da Vitrine porque os créditos acabaram.' : 'Seu projeto saiu da Vitrine porque o plano não está ativo.'}</p>
          )}
          {inVitrine && !isAdmin && daysLeft <= 3 && <p className="mt-2 text-[11px] font-bold text-[#FFD400]">Atenção: créditos para poucos dias. Sem créditos o projeto sai da Vitrine.</p>}
          {message && <p className="mt-2 text-[11px] font-bold text-[#00E676]">{message}</p>}
          {error && <p className="mt-2 text-[11px] font-bold text-[#ff7ab3]">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {inVitrine ? (
            <>
              <button onClick={() => onNavigate('vitrine')} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-xs font-black text-white hover:border-[#FFD400]">Ver na Vitrine</button>
              {!isAdmin && <button onClick={() => onNavigate('creditos')} className="inline-flex items-center gap-2 rounded-full bg-[#FFD400] px-5 py-2.5 text-xs font-black text-black hover:bg-white">Recarregar</button>}
            </>
          ) : paid || isAdmin ? (
            <button onClick={enter} disabled={loading || (!isAdmin && balance < DAILY_COST)} className="froc-shimmer inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FFD400] via-[#FF2D87] to-[#00E676] px-5 py-2.5 text-xs font-black text-black disabled:opacity-50">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {!isAdmin && balance < DAILY_COST ? `Precisa de ${DAILY_COST} créditos` : 'Colocar na Vitrine'}
            </button>
          ) : (
            <button onClick={() => onNavigate('planos')} className="froc-shimmer inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FFD400] via-[#FF2D87] to-[#00E676] px-5 py-2.5 text-xs font-black text-black">
              <Crown size={14} /> Escolher um plano
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
