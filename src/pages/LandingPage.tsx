import React from 'react';
import {
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  Globe2,
  Image as ImageIcon,
  Megaphone,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  WandSparkles,
  Zap,
  Layers,
  TrendingUp,
  Cpu
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { BRAND } from '../lib/brand';

interface Props {
  authenticated: boolean;
  onOpenAuth: () => void;
  onNavigate: (tab: string) => void;
}

const features = [
  [Sparkles, 'Froc IA Central (Gemini 3.7 & 3.1 Pro)', 'Estratégia, copy persuasiva, artigos completos com SEO, roteiros e geração visual contextualizada com a sua marca.'],
  [CalendarClock, 'Autopilot & Calendário Inteligente', 'Produção e agendamento contínuo com controle de créditos, aprovação manual ou execução autônoma.'],
  [Megaphone, 'Campanhas Multicanal', 'Organize objetivos, criativos, público-alvo e canais de conversão com métricas reais.'],
  [Search, 'SEO Inteligente & Auditoria', 'Diagnóstico técnico completo, recomendações acionáveis, sitemap dinâmico e indexação otimizada.'],
  [Store, 'Vitrine & Froc Magazine', 'Exponha sua empresa e publique artigos com URLs exclusivas para captação orgânica de clientes.'],
  [ShieldCheck, 'Arquitetura de Alta Disponibilidade', 'Firebase Auth, ledger transacional auditável, pagamentos instantâneos via Mercado Pago e cascata de IA anti-quedas.']
] as const;

const plans = [
  { name: 'START', price: 'R$ 49,00', credits: '110 créditos', popular: false, desc: 'Ideal para autônomos e pequenos negócios.' },
  { name: 'PRO', price: 'R$ 99,90', credits: '230 créditos', popular: true, desc: 'O mais escolhido para crescimento acelerado.' },
  { name: 'BUSINESS', price: 'R$ 199,90', credits: '480 créditos', popular: false, desc: 'Para empresas com múltiplas campanhas ativas.' },
  { name: 'AGENCY', price: 'R$ 399,90', credits: '1.000 créditos', popular: false, desc: 'Operação ilimitada para agências e marcas.' }
] as const;

export const LandingPage: React.FC<Props> = ({ authenticated, onOpenAuth, onNavigate }) => (
  <div className="min-h-[100dvh] overflow-hidden bg-[#070B14] text-white selection:bg-cyan-500 selection:text-slate-950">
    {/* Navigation Bar */}
    <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#070B14]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-3">
          <BrandLogo size="md" showText={true} />
        </a>
        <nav className="hidden items-center gap-8 text-xs font-semibold text-slate-300 md:flex">
          <a href="#recursos" className="hover:text-cyan-400 transition-colors">Recursos</a>
          <a href="/vitrine" className="hover:text-cyan-400 transition-colors">Vitrine</a>
          <a href="/blog" className="hover:text-cyan-400 transition-colors">Magazine</a>
          <a href="#planos" className="hover:text-cyan-400 transition-colors">Planos</a>
        </nav>
        <button
          onClick={() => (authenticated ? onNavigate('dashboard') : onOpenAuth())}
          className="froc-primary text-xs !min-h-10 px-5 shadow-cyan-500/20"
        >
          {authenticated ? 'Abrir Painel' : 'Entrar / Criar Conta'}
        </button>
      </div>
    </header>

    <main>
      {/* Hero Section */}
      <section className="relative isolate border-b border-white/[0.08] overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.15),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(37,99,235,0.15),transparent_50%)]" />
        
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1.15fr_.85fr] lg:px-8 lg:py-32">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-bold text-cyan-300 shadow-lg shadow-cyan-500/10 backdrop-blur-md">
              <Zap size={14} className="text-cyan-400" />
              <span>Motor Inteligente de Marketing & Automação</span>
            </div>

            <h1 className="mt-6 max-w-4xl text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl text-white">
              Sua marca acelerada com{' '}
              <span className="bg-gradient-to-r from-blue-400 via-cyan-300 to-teal-300 bg-clip-text text-transparent">
                IA de Última Geração, Conteúdo & Automação
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300">
              Cadastre sua empresa, alinhe a persona da sua marca, gere criativos, artigos com SEO, roteiros e campanhas em segundos, publicando com precisão em todos os canais.
            </p>

            <div className="mt-8 flex flex-col gap-3.5 sm:flex-row">
              <button
                onClick={() => (authenticated ? onNavigate('dashboard') : onOpenAuth())}
                className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-blue-600 via-cyan-500 to-teal-400 px-7 text-sm font-extrabold text-white shadow-xl shadow-cyan-500/25 hover:scale-[1.02] hover:shadow-cyan-500/40 transition-all"
              >
                {authenticated ? 'Acessar Meu Painel' : 'Começar Gratuitamente'}
                <ArrowRight size={16} />
              </button>
              <a
                href="/vitrine"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/80 px-6 text-sm font-bold text-slate-200 hover:border-cyan-500/40 hover:text-white transition-all backdrop-blur-md"
              >
                <Store size={16} className="text-cyan-400" />
                Explorar Vitrine de Marcas
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs text-slate-300">
              {['Motor Multi-Modelo Anti-Quedas', 'Arquitetura Transacional Auditável', 'Geração de Imagens 1K/4K', 'PWA Instalável'].map((item) => (
                <span key={item} className="inline-flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* Interactive Card Mockup */}
          <div className="relative mx-auto w-full max-w-lg">
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-blue-600/20 to-cyan-500/20 blur-2xl" />
            <div className="rounded-3xl border border-white/[0.12] bg-[#0A101E]/90 p-5 shadow-2xl backdrop-blur-2xl sm:p-7">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">Froc AI Hub Central</span>
                </div>
                <span className="text-[11px] font-semibold text-cyan-400 bg-cyan-500/10 px-2.5 py-0.5 rounded-full border border-cyan-500/20">
                  Online
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  [Sparkles, 'Estratégia & Persona', 'Alinhamento com a marca'],
                  [ImageIcon, 'Criativos Visuais 1K', 'Alta resolução'],
                  [Megaphone, 'Campanhas Multicanal', 'Meta & Google'],
                  [Globe2, 'SEO & Magazine', 'Indexação ativa']
                ].map(([Icon, label, sub]: any) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-cyan-500/40 hover:bg-slate-900/90 transition-all group"
                  >
                    <div className="h-8 w-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform">
                      <Icon size={17} />
                    </div>
                    <div className="mt-3 text-xs font-bold text-white">{label}</div>
                    <div className="mt-1 text-[10px] text-slate-400">{sub}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-blue-500/30 bg-gradient-to-r from-blue-950/70 to-slate-900 p-4.5 shadow-inner">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-300 flex items-center gap-1.5">
                    <Cpu size={13} /> Autopilot Froc
                  </div>
                  <span className="text-[10px] text-cyan-400 font-bold bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">Automação Contínua</span>
                </div>
                <div className="mt-2 text-sm font-extrabold text-white">Conteúdo autônomo com calibração contínua</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                  Planejamento e disparo automático de campanhas com validação oficial de entrega.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="recursos" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/20">
            Arquitetura & Recursos
          </span>
          <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl text-white">
            Uma operação profissional de marketing, não apenas uma coleção de prompts.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Todos os recursos compartilham o mesmo cérebro da marca, carteira transparente de créditos e infraestrutura resiliente.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map(([Icon, title, text]) => (
            <article
              key={title}
              className="group rounded-3xl border border-white/[0.08] bg-slate-900/50 backdrop-blur-xl p-7 transition-all duration-300 hover:border-cyan-500/40 hover:bg-slate-900/80 hover:-translate-y-1 shadow-lg"
            >
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-500/20 border border-cyan-500/30 text-cyan-300 group-hover:scale-110 transition-transform">
                <Icon size={22} />
              </div>
              <h3 className="mt-5 text-base font-bold text-white tracking-tight">{title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Pricing Section */}
      <section id="planos" className="border-y border-white/[0.08] bg-[#0A0F1D]/80 backdrop-blur-xl py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/20">
              Planos & Créditos
            </span>
            <h2 className="mt-4 text-3xl font-black text-white">Preços transparentes para escalar seu negócio</h2>
            <p className="mt-2 text-sm text-slate-300">
              Recarregue ou assine para desbloquear execuções com a suíte avançada Froc IA.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => (
              <article
                key={p.name}
                className={`relative rounded-3xl border p-7 transition-all duration-300 backdrop-blur-xl flex flex-col justify-between ${
                  p.popular
                    ? 'border-cyan-400/60 bg-gradient-to-b from-cyan-950/40 to-slate-900/90 shadow-2xl shadow-cyan-950/40 -translate-y-1'
                    : 'border-white/[0.08] bg-slate-900/50 hover:border-slate-700'
                }`}
              >
                {p.popular && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 px-3.5 py-0.5 text-[10px] font-black uppercase text-white shadow-md">
                    Mais Popular
                  </span>
                )}
                <div>
                  <div className="text-xs font-black tracking-widest text-cyan-400">{p.name}</div>
                  <div className="mt-4 text-3xl font-black text-white">
                    {p.price}
                    <span className="text-xs font-normal text-slate-400"> / mês</span>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-cyan-300 bg-cyan-500/10 px-2.5 py-1 rounded-lg border border-cyan-500/20">
                    <Sparkles size={13} className="text-amber-400" />
                    {p.credits} por ciclo
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-slate-300">{p.desc}</p>
                </div>
                <button
                  onClick={() => (authenticated ? onNavigate('planos') : onOpenAuth())}
                  className={`mt-8 min-h-11 w-full rounded-xl text-xs font-bold transition-all shadow-md ${
                    p.popular
                      ? 'froc-primary'
                      : 'border border-slate-700 bg-slate-950 text-white hover:border-cyan-500/50 hover:bg-slate-900'
                  }`}
                >
                  Escolher {p.name}
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>

    {/* Footer */}
    <footer className="border-t border-white/[0.08] bg-[#070B14]">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-xs text-slate-400 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <BrandLogo size="sm" showText={true} />
          <span>— Marketing Intelligence Platform</span>
        </div>
        <div className="flex flex-wrap gap-6 text-slate-400">
          <a href="/termos" className="hover:text-cyan-400 transition-colors">Termos de Uso</a>
          <a href="/privacidade" className="hover:text-cyan-400 transition-colors">Privacidade</a>
          <a href="/blog" className="hover:text-cyan-400 transition-colors">Magazine</a>
          <a href="/vitrine" className="hover:text-cyan-400 transition-colors">Vitrine de Marcas</a>
        </div>
      </div>
    </footer>
  </div>
);
