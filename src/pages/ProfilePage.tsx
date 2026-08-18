import React, { useEffect, useState } from 'react';
import { Calendar, KeyRound, Mail, Save, ShieldCheck, User as UserIcon } from 'lucide-react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, updateProfile } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { apiRequest } from '../lib/api';
import type { User, Wallet } from '../types';

interface Props { user: User | null; wallet: Wallet | null; onRefreshUser: () => void; onNavigate: (tab: string) => void; }
export const ProfilePage: React.FC<Props> = ({ user, wallet, onRefreshUser }) => {
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{type:'success'|'error';text:string}|null>(null);
  useEffect(() => setName(user?.name || ''), [user?.name]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setStatus(null);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error('Faça login novamente.');
      if (newPassword) {
        if (!currentPassword) throw new Error('Informe sua senha atual para trocar a senha.');
        if (newPassword.length < 8) throw new Error('Use pelo menos 8 caracteres na nova senha.');
        if (newPassword !== confirmPassword) throw new Error('As novas senhas não coincidem.');
        if (!firebaseUser.email) throw new Error('Sua conta não possui e-mail para reautenticação.');
        const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, credential);
        await updatePassword(firebaseUser, newPassword);
      }
      if (name.trim() && name.trim() !== firebaseUser.displayName) await updateProfile(firebaseUser, { displayName: name.trim() });
      await apiRequest('/api/auth/profile', { method: 'PATCH', body: { name: name.trim() } });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setStatus({ type: 'success', text: 'Perfil e segurança atualizados com sucesso.' });
      await onRefreshUser();
    } catch (error: any) {
      const code = String(error?.code || '');
      setStatus({ type: 'error', text: code.includes('invalid-credential') ? 'Senha atual incorreta.' : error?.message || 'Não foi possível atualizar o perfil.' });
    } finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-4xl space-y-6 animate-fadeIn">
    <div><h2 className="flex items-center gap-2 text-xl font-bold text-white"><UserIcon className="text-cyan-400"/>Meu Perfil & Segurança</h2><p className="text-xs text-slate-400">A mesma conta é usada na web, PWA e futuro aplicativo.</p></div>
    {status && <div className={`rounded-2xl border p-4 text-xs ${status.type==='success'?'border-emerald-500/30 bg-emerald-500/10 text-emerald-300':'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>{status.type==='success'?'✅':'⚠️'} {status.text}</div>}
    <form onSubmit={submit} className="space-y-6">
      <section className="froc-panel space-y-4"><h3 className="froc-section-title">Informações pessoais</h3><div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold text-slate-300">Nome completo<input value={name} onChange={(e)=>setName(e.target.value)} autoComplete="name" className="froc-input mt-1.5" required/></label><label className="text-xs font-semibold text-slate-300">E-mail<input value={user?.email||''} type="email" disabled className="froc-input mt-1.5 opacity-60"/></label></div><div className="flex flex-wrap gap-4 text-xs text-slate-400"><span className="flex items-center gap-1"><Calendar size={13} className="text-cyan-400"/>Membro desde {user?.createdAt?new Date(user.createdAt).toLocaleDateString('pt-BR'):'—'}</span><span className="flex items-center gap-1"><ShieldCheck size={13} className="text-emerald-400"/>Conta protegida pelo Firebase Auth</span><span>Plano: <strong className="text-white">{wallet?.planId?.replace('plan_','').toUpperCase()||'START'}</strong></span></div></section>
      <section className="froc-panel space-y-4"><h3 className="froc-section-title"><span className="flex items-center gap-2"><KeyRound size={15}/>Trocar senha</span></h3><p className="text-xs text-slate-500">Por segurança, a troca exige reautenticação com sua senha atual. Contas criadas por Google podem gerenciar senha pelo provedor.</p><div className="grid gap-4 md:grid-cols-3"><label className="text-xs font-semibold text-slate-300">Senha atual<input type="password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} autoComplete="current-password" className="froc-input mt-1.5"/></label><label className="text-xs font-semibold text-slate-300">Nova senha<input type="password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} autoComplete="new-password" className="froc-input mt-1.5"/></label><label className="text-xs font-semibold text-slate-300">Confirmar<input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} autoComplete="new-password" className="froc-input mt-1.5"/></label></div></section>
      <button disabled={saving} className="froc-primary flex items-center gap-2"><Save size={15}/>{saving?'Salvando…':'Salvar alterações'}</button>
    </form>
  </div>;
};
