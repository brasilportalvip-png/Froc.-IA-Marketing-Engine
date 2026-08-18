import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, Mail, ShieldAlert, ShieldCheck, Sparkles, User as UserIcon, X } from 'lucide-react';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiRequest } from '../lib/api';
import { getClientSecurityFingerprint, markBonusClaimedOnThisDevice } from '../lib/security';
import type { User, Wallet } from '../types';
import { BRAND } from '../lib/brand';
import { BrandLogo } from './BrandLogo';

interface Props { isOpen: boolean; onClose: () => void; onSuccess: (user: User, wallet: Wallet) => void; }
type Mode = 'login' | 'register' | 'forgot';

export const AuthModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const sync = async (fbUser: FirebaseUser, extras: Record<string, any> = {}) => {
    const securityPayload = await getClientSecurityFingerprint();
    const data = await apiRequest<{
      user: User;
      wallet: Wallet;
      security?: { bonusEligible: boolean; bonusAmount: number; reason: string; message: string };
    }>('/api/auth/sync-profile', {
      method: 'POST',
      body: {
        ...extras,
        securityPayload
      }
    });

    if (data.security?.bonusEligible) {
      markBonusClaimedOnThisDevice(fbUser.uid);
    } else if (data.security && !data.security.bonusEligible && mode === 'register') {
      setSecurityNotice(data.security.message || 'Bônus de boas-vindas não elegível para contas adicionais.');
    }

    onSuccess(data.user, data.wallet);
    onClose();
  };

  const friendlyError = (err: any) => {
    const code = String(err?.code || '');
    if (code.includes('email-already-in-use')) return 'Este e-mail já possui uma conta.';
    if (code.includes('invalid-credential')) return 'E-mail ou senha inválidos.';
    if (code.includes('weak-password')) return 'Use uma senha com pelo menos 6 caracteres.';
    if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde e tente novamente.';
    if (code.includes('popup-closed')) return 'Login com Google cancelado.';
    return err?.message || 'Não foi possível concluir a autenticação.';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setSuccess(''); setSecurityNotice(null); setLoading(true);
    try {
      if (mode === 'forgot') {
        if (!email.trim()) throw new Error('Informe seu e-mail cadastrado.');
        await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/` });
        setSuccess('Enviamos um link seguro de redefinição de senha para seu e-mail.');
        return;
      }
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Informe seu nome completo.');
        if (password !== confirm) throw new Error('As senhas não coincidem.');
        if (!terms || !privacy) throw new Error('Aceite os Termos de Uso e a Política de Privacidade.');
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await sync(credential.user, {
          name: name.trim(),
          termsAccepted: true,
          privacyAccepted: true,
          termsVersion: '2026.1',
          privacyVersion: '2026.1'
        });
      } else {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        await sync(credential.user);
      }
    } catch (err: any) { setError(friendlyError(err)); }
    finally { setLoading(false); }
  };

  const google = async () => {
    setError(''); setSuccess(''); setSecurityNotice(null); setLoading(true);
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const isExplicitConsent = terms && privacy;
      await sync(credential.user, {
        name: credential.user.displayName || '',
        avatarUrl: credential.user.photoURL || '',
        ...(isExplicitConsent ? { termsAccepted: true, privacyAccepted: true, termsVersion: '2026.1', privacyVersion: '2026.1' } : {})
      });
    } catch (err: any) { setError(friendlyError(err)); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-3 backdrop-blur-xl" role="dialog" aria-modal="true">
      <div className="relative max-h-[calc(100dvh-24px)] w-full max-w-md overflow-y-auto rounded-[28px] border border-slate-700/80 bg-[#0F172A] p-6 shadow-2xl md:p-8">
        <button onClick={onClose} aria-label="Fechar" className="absolute right-4 top-4 rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18}/></button>
        <div className="mb-6 text-center">
          <div className="flex justify-center mb-3">
            <BrandLogo size="lg" showText={false} />
          </div>
          <h2 className="text-xl font-extrabold text-white">{mode === 'register' ? 'Criar conta Froc.IA' : mode === 'forgot' ? 'Recuperar acesso' : 'Entrar no Froc.IA'}</h2>
          <p className="mt-1 text-xs text-slate-400">{mode === 'forgot' ? 'O Firebase enviará um link seguro. Sua senha nunca é redefinida sem verificação.' : 'Sua conta funciona na web, PWA e aplicativo.'}</p>
        </div>
        {mode === 'register' && (
          <div className="mb-4 flex gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            <Sparkles size={18} className="shrink-0 text-cyan-400"/>
            <span>O bônus de 25 créditos é concedido uma única vez por titular/dispositivo na primeira conta criada.</span>
          </div>
        )}
        {securityNotice && (
          <div className="mb-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <ShieldAlert size={16} className="shrink-0 text-amber-400"/>
            <span>{securityNotice}</span>
          </div>
        )}
        {success && <div className="mb-4 flex gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300"><CheckCircle2 size={16}/>{success}</div>}
        {error && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">⚠️ {error}</div>}
        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' && <label className="block text-xs font-semibold text-slate-300">Nome completo<div className="relative mt-1.5"><UserIcon className="absolute left-3.5 top-3 text-slate-500" size={16}/><input value={name} onChange={(e)=>setName(e.target.value)} autoComplete="name" className="froc-input pl-10" required /></div></label>}
          <label className="block text-xs font-semibold text-slate-300">E-mail<div className="relative mt-1.5"><Mail className="absolute left-3.5 top-3 text-slate-500" size={16}/><input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} autoComplete="email" className="froc-input pl-10" required /></div></label>
          {mode !== 'forgot' && <label className="block text-xs font-semibold text-slate-300">Senha<div className="relative mt-1.5"><Lock className="absolute left-3.5 top-3 text-slate-500" size={16}/><input type={showPassword?'text':'password'} value={password} onChange={(e)=>setPassword(e.target.value)} autoComplete={mode==='login'?'current-password':'new-password'} minLength={6} className="froc-input pl-10 pr-11" required/><button type="button" onClick={()=>setShowPassword(!showPassword)} aria-label="Mostrar ou ocultar senha" className="absolute right-3 top-2.5 p-1 text-slate-400">{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label>}
          {mode === 'register' && <label className="block text-xs font-semibold text-slate-300">Confirmar senha<input type="password" value={confirm} onChange={(e)=>setConfirm(e.target.value)} autoComplete="new-password" minLength={6} className="froc-input mt-1.5" required/></label>}
          {mode === 'register' && <div className="space-y-2 text-[11px] text-slate-300"><label className="flex items-start gap-2"><input type="checkbox" checked={terms} onChange={(e)=>setTerms(e.target.checked)} className="mt-0.5"/><span>Aceito os <a href="/termos" target="_blank" className="text-cyan-300 underline">Termos de Uso</a>.</span></label><label className="flex items-start gap-2"><input type="checkbox" checked={privacy} onChange={(e)=>setPrivacy(e.target.checked)} className="mt-0.5"/><span>Aceito a <a href="/privacidade" target="_blank" className="text-cyan-300 underline">Política de Privacidade</a> e tratamento de dados.</span></label></div>}
          <button disabled={loading} className="froc-primary w-full">{loading ? 'Processando…' : mode === 'register' ? 'Criar minha conta' : mode === 'forgot' ? 'Enviar link seguro' : 'Entrar'}</button>
          {mode === 'login' && (
            <p className="text-center text-[10px] leading-relaxed text-slate-500">
              Ao utilizar o Froc.IA, seu acesso está sujeito aos <a href="/termos" target="_blank" className="text-cyan-300 underline">Termos de Uso</a> e à <a href="/privacidade" target="_blank" className="text-cyan-300 underline">Política de Privacidade</a> vigentes.
            </p>
          )}
        </form>
        {mode !== 'forgot' && <><div className="my-4 flex items-center gap-3 text-[10px] text-slate-500"><span className="h-px flex-1 bg-slate-800"/>OU<span className="h-px flex-1 bg-slate-800"/></div><button onClick={google} disabled={loading} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-bold text-white hover:border-cyan-500/50">Continuar com Google</button></>}
        <div className="mt-5 flex items-center justify-between text-xs"><button onClick={()=>{setMode(mode==='login'?'register':'login');setError('');setSuccess('');setSecurityNotice(null)}} className="text-cyan-400 hover:underline">{mode==='login'?'Criar conta':mode==='register'?'Já tenho conta':'Voltar ao login'}</button>{mode==='login'&&<button onClick={()=>{setMode('forgot');setError('');setSuccess('');setSecurityNotice(null)}} className="text-slate-400 hover:text-white">Esqueci minha senha</button>}{mode==='forgot'&&<button onClick={()=>{setMode('login');setSecurityNotice(null)}} className="flex items-center gap-1 text-slate-400"><ArrowLeft size={13}/>Login</button>}</div>
        <div className="mt-5 flex items-center justify-center gap-1 text-[10px] text-slate-500"><ShieldCheck size={12}/>Firebase Authentication + Firestore Sync + Proteção Anti-Abuso</div>
      </div>
    </div>
  );
};

