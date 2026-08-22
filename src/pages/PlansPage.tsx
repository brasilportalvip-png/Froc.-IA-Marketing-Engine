import React, { useEffect, useMemo, useState } from 'react';
import { Check, Coins, Crown, ExternalLink, RefreshCw, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import type { Wallet } from '../types';
import { apiRequest } from '../lib/api';

interface Props { wallet: Wallet | null; onRefreshWallet: () => void; onNavigate: (tab: string) => void; }
interface Plan { id: string; name: string; price: number; period: string; credits: number; bonusCredits: number; totalCredits: number; popular: boolean; features: string[]; }
interface Subscription { id: string; planId: string; planName: string; billingMode?: string; status?: string; subscriptionStatus?: string; providerSubscriptionId?: string; nextPaymentDate?: string; createdAt?: string; }

export const PlansPage: React.FC<Props> = ({ wallet, onRefreshWallet, onNavigate }) => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [billingMode, setBillingMode] = useState<'subscription' | 'one_time'>('subscription');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [gateway, setGateway] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const catalog = await apiRequest<{ plans: Plan[]; gatewayConfigured: boolean }>('/api/payments/plans');
      setPlans(catalog.plans || []);
      setGateway(Boolean(catalog.gatewayConfigured));
      try {
        const subs = await apiRequest<{ subscriptions: Subscription[]; billingMode: 'subscription' | 'one_time' }>('/api/payments/subscriptions');
        setSubscriptions(subs.subscriptions || []);
        setBillingMode(subs.billingMode || 'subscription');
      } catch {
        setSubscriptions([]);
      }
    } catch (e: any) {
      setError(e.message || 'Não foi possível carregar os planos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const orderId = params.get('order_id') || params.get('external_reference');
    const paymentStatus = params.get('payment_status') || params.get('status') || params.get('collection_status');

    if (!orderId && !paymentStatus) return;

    let isSubscribed = true;
    let pollCount = 0;
    const maxPolls = 8;

    if (paymentStatus === 'failure' || paymentStatus === 'rejected' || paymentStatus === 'null') {
      setError('O pagamento não foi concluído ou foi recusado pelo emissor.');
      history.replaceState({}, '', location.pathname);
      return;
    }

    setMessage('Processando confirmação com o Mercado Pago... Aguarde.');

    const checkOrderStatus = async () => {
      if (!isSubscribed) return;
      try {
        if (orderId) {
          const res = await apiRequest<{ order: { id: string; status: string; lastPaymentStatus?: string } }>(`/api/payments/orders/${orderId}`);
          const order = res.order;
          if (order.status === 'approved' || order.status === 'active' || order.lastPaymentStatus === 'approved') {
            setMessage('Pagamento aprovado com sucesso! Seus créditos e plano foram atualizados.');
            onRefreshWallet();
            void load();
            history.replaceState({}, '', location.pathname);
            return;
          }
          if (['failed', 'rejected', 'refunded', 'charged_back', 'cancelled'].includes(order.status)) {
            setError(`O pagamento foi finalizado com status: ${order.status}.`);
            onRefreshWallet();
            void load();
            history.replaceState({}, '', location.pathname);
            return;
          }
        }
        
        pollCount++;
        if (pollCount < maxPolls && isSubscribed) {
          setTimeout(() => { void checkOrderStatus(); }, 2500);
        } else if (isSubscribed) {
          setMessage('Pagamento em processamento. O saldo será creditado automaticamente assim que o Mercado Pago liquidar.');
          onRefreshWallet();
          void load();
          history.replaceState({}, '', location.pathname);
        }
      } catch {
        if (isSubscribed) {
          onRefreshWallet();
          void load();
        }
      }
    };

    void checkOrderStatus();

    return () => {
      isSubscribed = false;
    };
  }, [onRefreshWallet]);

  const activeSubscription = useMemo(() => subscriptions.find((item) =>
    (['active', 'authorized'].includes(String(item.status)) || ['authorized', 'active'].includes(String(item.subscriptionStatus))) &&
    wallet?.planId && wallet.planId !== 'free' && wallet.planStatus === 'active'
  ), [subscriptions, wallet]);

  const checkout = async (planId: string) => {
    if (paying) return; // Previne clique duplo
    setPaying(planId);
    setError('');
    setMessage('');
    try {
      const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `chk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const data = await apiRequest<{ initPoint?: string; billingMode?: string }>('/api/payments/checkout', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idempotencyKey },
        body: { planId, idempotencyKey }
      });
      if (!data.initPoint) throw new Error('O Mercado Pago não retornou o checkout.');
      location.href = data.initPoint;
    } catch (e: any) {
      setError(e.message || 'Falha ao iniciar pagamento.');
      setPaying('');
    }
  };

  const cancelRenewal = async () => {
    if (!activeSubscription) return;
    if (!window.confirm('Cancelar a renovação automática desta assinatura? Seus créditos já adquiridos não serão apagados.')) return;
    setCancelling(true); setError(''); setMessage('');
    try {
      await apiRequest('/api/payments/subscription/cancel', { method: 'POST', body: { orderId: activeSubscription.id } });
      setMessage('Renovação automática cancelada com sucesso.');
      await load();
    } catch (e: any) {
      setError(e.message || 'Não foi possível cancelar a renovação.');
    } finally { setCancelling(false); }
  };

  return <div className="mx-auto max-w-6xl space-y-8 animate-fadeIn">
    <header className="mx-auto max-w-2xl text-center">
      <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-300"><Crown size={14}/>Planos oficiais Froc.IA</div>
      <h2 className="text-2xl font-black text-white md:text-4xl">Escalone seu marketing com créditos transparentes</h2>
      <p className="mt-2 text-sm text-slate-400">Valores, bônus e limites vêm diretamente do catálogo do backend. {billingMode === 'subscription' ? 'A cobrança é mensal recorrente pelo Mercado Pago.' : 'A cobrança atual é avulsa por ciclo de créditos.'}</p>
    </header>

    {message && <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-300">✅ {message}</div>}
    {error && <div className="mx-auto max-w-2xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">⚠️ {error}</div>}
    {!gateway && !loading && <div className="mx-auto max-w-2xl rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-xs text-amber-200">Mercado Pago não está disponível no backend atual. O checkout permanecerá bloqueado até a configuração estar válida.</div>}

    {billingMode === 'subscription' && activeSubscription && <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-slate-300"><div className="font-bold text-cyan-300">Renovação automática ativa</div><div className="mt-1">{activeSubscription.planName || activeSubscription.planId}{activeSubscription.nextPaymentDate ? ` • Próxima cobrança: ${new Date(activeSubscription.nextPaymentDate).toLocaleDateString('pt-BR')}` : ''}</div></div>
      <button disabled={cancelling} onClick={cancelRenewal} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"><XCircle size={14}/>{cancelling ? 'Cancelando…' : 'Cancelar renovação'}</button>
    </div>}

    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {loading ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-96 animate-pulse rounded-3xl bg-slate-900"/>) : plans.map(plan => {
        const active = wallet?.planId === plan.id;
        return <article key={plan.id} className={`relative flex flex-col rounded-3xl border p-5 ${plan.popular ? 'border-cyan-400/60 bg-gradient-to-b from-cyan-950/30 to-[#0F172A] shadow-xl shadow-cyan-500/10' : 'border-slate-700 bg-[#0F172A]'}`}>
          {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-400 px-3 py-1 text-[10px] font-black text-slate-950">MAIS POPULAR</div>}
          <div className="mb-4"><div className="text-xs font-black tracking-widest text-cyan-300">{plan.name}</div><div className="mt-2 flex items-end gap-1"><span className="text-3xl font-black text-white">R$ {plan.price.toFixed(2).replace('.', ',')}</span><span className="pb-1 text-xs text-slate-500">/{plan.period.replace('/', '')}</span></div></div>
          <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3"><div className="flex items-center gap-2 text-sm font-black text-amber-300"><Coins size={17}/>{plan.totalCredits} créditos</div><div className="mt-1 text-[10px] text-amber-100/70">{plan.credits} base + {plan.bonusCredits} bônus</div></div>
          <ul className="flex-1 space-y-2.5">{plan.features.map(f => <li key={f} className="flex gap-2 text-xs text-slate-300"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400"/>{f}</li>)}</ul>
          <button disabled={!gateway || paying === plan.id || (active && billingMode === 'subscription' && Boolean(activeSubscription))} onClick={() => checkout(plan.id)} className={`mt-6 min-h-11 rounded-xl px-4 text-xs font-extrabold ${active && activeSubscription ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white disabled:opacity-40'}`}>{active && activeSubscription ? 'Plano atual' : paying === plan.id ? 'Abrindo Mercado Pago…' : active && billingMode === 'one_time' ? 'Comprar novo ciclo' : 'Escolher plano'}</button>
        </article>;
      })}
    </div>

    <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500"><span className="flex items-center gap-1"><ShieldCheck size={13}/>Pagamento processado pelo Mercado Pago</span><button onClick={() => onNavigate('creditos')} className="flex items-center gap-1 text-cyan-400 hover:underline">Ver extrato de créditos <ExternalLink size={12}/></button><span className="flex items-center gap-1"><Sparkles size={13}/>Créditos só entram após webhook validado</span><button onClick={() => void load()} className="flex items-center gap-1 text-slate-400 hover:text-white"><RefreshCw size={12}/>Atualizar</button></div>
  </div>;
};
