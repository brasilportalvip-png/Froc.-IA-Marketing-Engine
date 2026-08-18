import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>; }
export const PwaInstallPrompt: React.FC = () => {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { const handler = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); }; window.addEventListener('beforeinstallprompt', handler); return () => window.removeEventListener('beforeinstallprompt', handler); }, []);
  if (!event || hidden || window.matchMedia('(display-mode: standalone)').matches) return null;
  const install = async () => { await event.prompt(); const choice = await event.userChoice; if (choice.outcome === 'accepted') setEvent(null); else setHidden(true); };
  return <div className="fixed bottom-[calc(78px+env(safe-area-inset-bottom))] left-3 right-3 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-cyan-500/30 bg-slate-900/98 p-3 shadow-2xl lg:bottom-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-500/10 text-cyan-300"><Download size={19}/></div><div className="min-w-0 flex-1"><div className="text-xs font-bold text-white">Instalar Froc.IA</div><div className="text-[10px] text-slate-400">Abra como aplicativo no seu dispositivo.</div></div><button onClick={install} className="rounded-lg bg-cyan-500 px-3 py-2 text-[11px] font-extrabold text-slate-950">Instalar</button><button onClick={()=>setHidden(true)} aria-label="Fechar" className="p-1 text-slate-500"><X size={15}/></button></div>;
};
