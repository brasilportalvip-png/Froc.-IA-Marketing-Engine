import React from 'react';
export class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('[Froc UI]', error, info); }
  render() {
    if (this.state.error) return <div className="grid min-h-screen place-items-center bg-[#0B0F19] p-6 text-center text-white"><div className="max-w-md rounded-3xl border border-rose-500/30 bg-slate-900 p-7"><h1 className="text-xl font-black">O Froc.IA encontrou um erro nesta tela</h1><p className="mt-2 text-sm text-slate-400">Seus dados não foram apagados. Recarregue a aplicação para continuar.</p><button onClick={()=>window.location.reload()} className="mt-5 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-bold text-slate-950">Recarregar</button></div></div>;
    return this.props.children;
  }
}
