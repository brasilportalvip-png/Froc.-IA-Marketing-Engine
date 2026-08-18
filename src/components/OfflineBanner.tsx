import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
export const OfflineBanner: React.FC = () => {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  if (online) return null;
  return <div className="fixed left-1/2 top-[calc(66px+env(safe-area-inset-top))] z-[80] -translate-x-1/2 rounded-full border border-amber-400/30 bg-amber-950/95 px-4 py-2 text-xs font-semibold text-amber-200 shadow-xl"><span className="flex items-center gap-2"><WifiOff size={14}/>Você está offline. Ações online não serão simuladas.</span></div>;
};
