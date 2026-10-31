import React from 'react';
import { Gift, MessageCircle, Sparkles, Store } from 'lucide-react';

/** Regras de créditos do Froc.IA, iguais às do backend (config.billing). */
export const CreditRules: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const rules = [
    { icon: Gift, color: '#00E676', title: '25 créditos grátis', text: 'Ao criar a conta você ganha 25 créditos de presente (1 vez por pessoa).' },
    { icon: MessageCircle, color: '#FFD400', title: '3 créditos por resposta', text: 'Cada resposta do Froc.IA no chat usa 3 créditos. Posts, imagens, roteiros e artigos já estão incluídos.' },
    { icon: Store, color: '#FF2D87', title: 'Vitrine: 10 créditos/dia', text: 'Exclusiva para assinantes. Cada projeto ganha 1 post personalizado por dia com imagem do nicho. Sem créditos, sai da Vitrine.' },
    { icon: Sparkles, color: '#ffffff', title: 'Projetos ilimitados', text: 'Coloque quantos projetos quiser, desde que tenha créditos para as diárias.' }
  ];
  return (
    <div className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
      {rules.map((rule) => (
        <div key={rule.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:-translate-y-0.5 hover:border-white/25">
          <rule.icon size={18} style={{ color: rule.color }} />
          <p className="mt-2 text-sm font-black text-white">{rule.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-neutral-400">{rule.text}</p>
        </div>
      ))}
    </div>
  );
};
