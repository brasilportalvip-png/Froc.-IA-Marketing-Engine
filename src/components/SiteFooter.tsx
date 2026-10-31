import React from 'react';
import { Mail } from 'lucide-react';

/** Rodapé público: links obrigatórios (Termos, Privacidade) e navegação para buscadores e pessoas. */
export const SiteFooter: React.FC<{ onNavigate?: (tab: string) => void; className?: string }> = ({ className = '' }) => {
  const year = new Date().getFullYear();
  const links: Array<[string, string]> = [['Início', '/'], ['Vitrine', '/vitrine'], ['Posts', '/posts'], ['Planos', '/planos'], ['Termos de Uso', '/termos'], ['Política de Privacidade', '/privacidade']];
  return (
    <footer className={`relative z-10 border-t border-white/10 px-4 py-6 text-center ${className}`}>
      <nav aria-label="Rodapé" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-semibold text-neutral-400">
        {links.map(([label, href]) => <a key={href} href={href} className="transition hover:text-[#FFD400]">{label}</a>)}
        <a href="mailto:brasilportalvip@gmail.com" className="inline-flex items-center gap-1 transition hover:text-[#FFD400]"><Mail size={11} /> Contato</a>
      </nav>
      <p className="mt-3 text-[10px] text-neutral-600">© {year} Froc.IA — marketing com inteligência artificial e tráfego orgânico.</p>
    </footer>
  );
};
