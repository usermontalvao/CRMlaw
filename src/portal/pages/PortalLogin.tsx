import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, ArrowLeft, ArrowRight,
  Eye, EyeOff, Lock, Shield, Gavel, Bell, History, MessageSquare, CheckCircle,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { supabase } from '../../config/supabase';
import { clientService } from '../../services/client.service';

type ClientStep = 'cpf' | 'pin';
type Mode = 'client' | 'staff';
type StaffStep = 'identifier' | 'password';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchPhoneHint(cpf: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('portal_phone_hint', { p_cpf: cpf });
    if (error || !data) return null;
    return data as string;
  } catch { return null; }
}

const formatCPF = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

const formatCpfRaw = (v: string) => {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  const [p1, p2, p3, p4] = [d.slice(0,3), d.slice(3,6), d.slice(6,9), d.slice(9,11)];
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
};

// ── Sub-componentes ───────────────────────────────────────────────────────────

const LogoBadge: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <div style={{
    width: size, height: size, borderRadius: size * 0.24,
    background: 'linear-gradient(145deg,#fb923c 0%,#ea580c 55%,#c2410c 100%)',
    boxShadow: '0 4px 14px rgba(234,88,12,.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }}>
    <span style={{ fontSize: size * 0.46, fontWeight: 900, color: '#fff', fontFamily: 'Arial,sans-serif', lineHeight: 1 }}>J</span>
  </div>
);

const FeatureCard: React.FC<{ icon: React.ElementType; title: string; desc: string }> = ({ icon: Icon, title, desc }) => (
  <div className="group rounded-xl border border-slate-200/60 bg-white p-4 transition-all hover:border-orange-200 hover:shadow-sm">
    <div className="mb-2 text-orange-600 transition-transform group-hover:scale-110 inline-block">
      <Icon size={26} strokeWidth={1.5} />
    </div>
    <h3 className="text-[13px] font-bold text-slate-800">{title}</h3>
    <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{desc}</p>
  </div>
);

const ErrorMsg: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{msg}</span>
  </div>
);

// ── Main ──────────────────────────────────────────────────────────────────────

export const PortalLogin: React.FC = () => {
  const { loginByCPF } = useClientAuth();

  // ── Client portal state
  const [mode, setMode]             = useState<Mode>('client');
  const [clientStep, setClientStep] = useState<ClientStep>('cpf');
  const [cpf, setCpf]               = useState('');
  const [phoneHint, setPhoneHint]   = useState<string | null>(null);
  const [digits, setDigits]         = useState(['', '', '', '']);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError]     = useState<string | null>(null);

  // ── Staff state
  const [staffStep, setStaffStep]             = useState<StaffStep>('identifier');
  const [identifier, setIdentifier]           = useState('');
  const [staffEmail, setStaffEmail]           = useState('');
  const [staffPw, setStaffPw]                 = useState('');
  const [showPw, setShowPw]                   = useState(false);
  const [profileName, setProfileName]         = useState<string | null>(null);
  const [profileAvatar, setProfileAvatar]     = useState<string | null>(null);
  const [identifierLoading, setIdentifierLoading] = useState(false);
  const [staffLoading, setStaffLoading]           = useState(false);
  const [staffError, setStaffError]               = useState<string | null>(null);

  const cpfRef       = useRef<HTMLInputElement>(null);
  const identRef     = useRef<HTMLInputElement>(null);
  const pwRef        = useRef<HTMLInputElement>(null);
  const pinRefs      = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  const rawCPF  = cpf.replace(/\D/g, '');
  const cpfOk   = rawCPF.length === 11;
  const pin     = digits.join('');
  const pinOk   = pin.length === 4;

  useEffect(() => {
    if (clientStep === 'cpf') setTimeout(() => cpfRef.current?.focus(), 80);
    if (clientStep === 'pin') setTimeout(() => pinRefs[0].current?.focus(), 80);
  }, [clientStep]);

  useEffect(() => {
    if (staffStep === 'identifier') setTimeout(() => identRef.current?.focus(), 80);
    if (staffStep === 'password') setTimeout(() => pwRef.current?.focus(), 80);
  }, [staffStep]);

  // ── Client handlers ───────────────────────────────────────────────────────

  const handleClientContinue = useCallback(async (e: React.FormEvent) => {
    e.preventDefault(); if (!cpfOk) return;
    setClientError(null); setClientLoading(true);
    try {
      const hint = await fetchPhoneHint(rawCPF);
      if (!hint) { setClientError('CPF não encontrado. Verifique com seu advogado.'); return; }
      setPhoneHint(hint); setDigits(['', '', '', '']); setClientStep('pin');
    } finally { setClientLoading(false); }
  }, [cpfOk, rawCPF]);

  const handleDigit = (i: number, val: string) => {
    const d = val.replace(/\D/g, '').slice(-1);
    const next = [...digits]; next[i] = d; setDigits(next);
    if (d && i < 3) pinRefs[i + 1].current?.focus();
  };
  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) pinRefs[i - 1].current?.focus();
    if (e.key === 'ArrowLeft'  && i > 0) pinRefs[i - 1].current?.focus();
    if (e.key === 'ArrowRight' && i < 3) pinRefs[i + 1].current?.focus();
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!t) return; e.preventDefault();
    const next = ['', '', '', '']; t.split('').forEach((c, i) => { next[i] = c; });
    setDigits(next); pinRefs[Math.min(t.length, 3)].current?.focus();
  };
  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault(); if (!pinOk) return;
    setClientError(null); setClientLoading(true);
    try {
      await loginByCPF(cpf, pin);
      window.location.hash = '#/portal/dashboard';
    } catch (err) {
      setClientError(err instanceof Error ? err.message : 'Senha incorreta.');
      setDigits(['', '', '', '']); setTimeout(() => pinRefs[0].current?.focus(), 50);
    } finally { setClientLoading(false); }
  };
  const goBackClient = () => { setClientStep('cpf'); setClientError(null); setDigits(['', '', '', '']); };

  // ── Staff handlers ────────────────────────────────────────────────────────

  const loadProfile = useCallback(async (id: string): Promise<boolean> => {
    setIdentifierLoading(true);
    setStaffError(null);
    try {
      const trimmed = id.trim();

      if (trimmed.includes('@')) {
        const { data } = await supabase.from('profiles').select('name,avatar_url,email').ilike('email', trimmed);
        const p = data?.[0] ?? null;
        if (!p) { setStaffError('Usuário não encontrado. Verifique o e-mail informado.'); return false; }
        setProfileName(p.name ?? p.email);
        setProfileAvatar(p.avatar_url ?? null);
        setStaffEmail(p.email ?? trimmed);
        return true;
      }

      const numeric = trimmed.replace(/\D/g, '');
      if (!numeric) return false;

      if (numeric.length === 11) {
        const masked = formatCpfRaw(numeric);
        const { data: byMasked } = await supabase.from('profiles').select('name,avatar_url,email').eq('cpf', masked).maybeSingle();
        if (byMasked?.email) { setProfileName(byMasked.name ?? byMasked.email); setProfileAvatar(byMasked.avatar_url ?? null); setStaffEmail(byMasked.email); return true; }

        const { data: byRaw } = await supabase.from('profiles').select('name,avatar_url,email').eq('cpf', numeric).maybeSingle();
        if (byRaw?.email) { setProfileName(byRaw.name ?? byRaw.email); setProfileAvatar(byRaw.avatar_url ?? null); setStaffEmail(byRaw.email); return true; }
      }

      try {
        const client = await clientService.getClientByCpfCnpj(numeric);
        if (!client?.email) { setStaffError('CPF encontrado, mas sem e-mail cadastrado.'); return false; }
        setProfileName(client.full_name || client.email);
        setStaffEmail(client.email);
        const { data: pd } = await supabase.from('profiles').select('avatar_url').ilike('email', client.email);
        setProfileAvatar(pd?.[0]?.avatar_url ?? null);
        return true;
      } catch { /* ignore */ }

      setStaffError('Usuário não encontrado. Verifique o dado informado.');
      return false;
    } finally { setIdentifierLoading(false); }
  }, []);

  const handleIdentifierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) { setStaffError('Informe seu CPF ou e-mail.'); return; }
    const ok = await loadProfile(identifier);
    if (ok) setStaffStep('password');
  };

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError(null); setStaffLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: staffEmail, password: staffPw });
      if (error) throw error;
      window.location.href = '/admin';
    } catch (err: any) { setStaffError(err.message || 'Credenciais inválidas.'); }
    finally { setStaffLoading(false); }
  };

  const goBackStaff = () => { setStaffStep('identifier'); setStaffError(null); setStaffPw(''); setProfileName(null); setProfileAvatar(null); };

  const switchMode = (m: Mode) => {
    setMode(m);
    setClientError(null); setStaffError(null);
  };

  const avatarInitial = (profileName || identifier || staffEmail).trim().charAt(0).toUpperCase() || '?';

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#f8f9ff]">

      {/* ── NAVBAR ──────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <LogoBadge size={32} />
            <span className="text-[15px] font-bold text-slate-900">Jurius</span>
          </div>
          <span className="hidden text-[12px] text-slate-400 sm:block">jurius.com.br</span>
        </div>
      </nav>

      {/* ── CONTEÚDO ────────────────────────────────────────────────────── */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start gap-16 px-6 py-12 md:flex-row md:items-center md:py-16">

        {/* ═══ LEFT — Hero ═══ */}
        <div className="order-2 flex-1 space-y-8 md:order-1">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              Acompanhe seu processo em{' '}
              <span className="text-orange-600">tempo real</span>
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-slate-500">
              A Jurius redefine a transparência jurídica. Tenha acesso imediato a todas as atualizações do seu caso com clareza, velocidade e segurança.
            </p>
          </div>

          {/* Features 2×2 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FeatureCard icon={Gavel}         title="Processos e intimações"  desc="Acompanhamento de todas as movimentações do Diário Oficial." />
            <FeatureCard icon={Bell}          title="Alertas de prazos"       desc="Notificações sobre datas críticas e próximos passos." />
            <FeatureCard icon={History}       title="Histórico completo"      desc="Toda a jornada do seu caso arquivada em um só lugar." />
            <FeatureCard icon={MessageSquare} title="Comunicação direta"      desc="Canal seguro e exclusivo com seu advogado." />
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-10 border-t border-slate-200/60 pt-6">
            {[['98%', 'SLA de Resposta'], ['+500', 'Clientes Ativos'], ['24/7', 'Disponibilidade']].map(([v, l]) => (
              <div key={l}>
                <p className="text-2xl font-bold text-slate-900">{v}</p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">{l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ RIGHT — Login card ═══ */}
        <div className="order-1 w-full shrink-0 md:order-2 md:w-[400px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg shadow-slate-200/60">

            {/* Tabs */}
            <div className="flex border-b border-slate-100">
              <button type="button" onClick={() => switchMode('client')}
                className={`flex-1 py-3.5 text-[13px] font-semibold transition-colors ${
                  mode === 'client'
                    ? 'border-b-2 border-orange-500 bg-white text-orange-600'
                    : 'bg-slate-50 text-slate-400 hover:text-slate-600'
                }`}>
                Portal do Cliente
              </button>
              <button type="button" onClick={() => switchMode('staff')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-[13px] font-semibold transition-colors ${
                  mode === 'staff'
                    ? 'border-b-2 border-slate-700 bg-white text-slate-800'
                    : 'bg-slate-50 text-slate-400 hover:text-slate-600'
                }`}>
                <Lock className="h-3.5 w-3.5" /> Área Restrita
              </button>
            </div>

            {/* ═══ CLIENT PORTAL ═══ */}
            {mode === 'client' && (
              <div className="p-6 space-y-5">
                {/* Progress */}
                <div className="flex gap-1.5">
                  <div className="h-1 flex-1 rounded-full bg-orange-500" />
                  <div className={`h-1 flex-1 rounded-full transition-colors ${clientStep === 'pin' ? 'bg-orange-500' : 'bg-slate-200'}`} />
                </div>

                {clientStep === 'cpf' && (
                  <form onSubmit={handleClientContinue} className="space-y-4">
                    <div>
                      <span className="inline-block rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Passo 1 de 2</span>
                      <h2 className="mt-2 text-xl font-bold text-slate-900">Qual é o seu CPF?</h2>
                      <p className="text-sm text-slate-500">Informe seus dados para acessar o painel.</p>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Documento de Identidade</label>
                      <input ref={cpfRef} type="text" value={formatCPF(cpf)}
                        onChange={(e) => { setCpf(e.target.value); setClientError(null); }}
                        placeholder="000.000.000-00" autoComplete="username" inputMode="numeric" disabled={clientLoading}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-base font-semibold text-slate-900 placeholder-slate-300 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
                      />
                    </div>
                    {clientError && <ErrorMsg msg={clientError} />}
                    <button type="submit" disabled={clientLoading || !cpfOk}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-[15px] font-bold text-white transition hover:bg-orange-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
                      {clientLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Verificando...</> : <><span>Continuar</span><ArrowRight className="h-4 w-4" /></>}
                    </button>
                    <p className="text-center text-xs text-slate-400">Dúvidas? Entre em contato com seu advogado.</p>
                  </form>
                )}

                {clientStep === 'pin' && (
                  <form onSubmit={handleClientLogin} className="space-y-4">
                    <div>
                      <button type="button" onClick={goBackClient}
                        className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-700 transition">
                        <ArrowLeft className="h-3.5 w-3.5" /> Voltar
                      </button>
                      <span className="block rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-fit">Passo 2 de 2</span>
                      <h2 className="mt-2 text-xl font-bold text-slate-900">Confirme seu acesso</h2>
                    </div>
                    {phoneHint && (
                      <div className="flex items-center gap-3 rounded-xl bg-orange-50 px-4 py-3 ring-1 ring-orange-200">
                        <span className="text-lg">📱</span>
                        <div>
                          <p className="text-[11px] text-orange-600 font-medium">Telefone cadastrado</p>
                          <p className="text-sm font-bold text-orange-900 tracking-wider">{phoneHint}</p>
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">4 últimos dígitos</label>
                      <div className="flex gap-2.5" onPaste={handlePaste}>
                        {digits.map((d, i) => (
                          <input key={i} ref={pinRefs[i]} type="password" inputMode="numeric" maxLength={1} value={d}
                            onChange={(e) => handleDigit(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} disabled={clientLoading}
                            className={`h-14 w-full rounded-xl border-2 text-center text-xl font-bold outline-none transition
                              ${d ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 bg-slate-50 text-slate-900'}
                              focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100 disabled:opacity-50`}
                          />
                        ))}
                      </div>
                    </div>
                    {clientError && <ErrorMsg msg={clientError} />}
                    <button type="submit" disabled={clientLoading || !pinOk}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-[15px] font-bold text-white transition hover:bg-orange-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
                      {clientLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Entrando...</> : 'Entrar na minha área'}
                    </button>
                  </form>
                )}

                {/* Rodapé do card */}
                <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-300">
                  <CheckCircle className="h-3.5 w-3.5" /> Conexão Segura SSL 256-bit
                </div>
              </div>
            )}

            {/* ═══ ÁREA RESTRITA ═══ */}
            {mode === 'staff' && (
              <div className="relative p-6 space-y-5">

                {/* ── Loading overlay ── */}
                {identifierLoading && (
                  <div
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-b-2xl bg-white"
                    style={{ animation: 'fadeIn 0.25s ease both' }}
                  >
                    <style>{`
                      @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
                      @keyframes scanLine {
                        0%   { top: 0%; opacity: 1; }
                        80%  { top: 100%; opacity: 1; }
                        100% { top: 100%; opacity: 0; }
                      }
                      @keyframes dotBounce {
                        0%, 80%, 100% { transform: translateY(0);    opacity: .4; }
                        40%           { transform: translateY(-8px);  opacity: 1;  }
                      }
                      @keyframes textCycle {
                        0%,18%   { opacity: 1; transform: translateY(0); }
                        22%,98%  { opacity: 0; transform: translateY(-6px); }
                        100%     { opacity: 0; }
                      }
                      @keyframes text2Cycle {
                        0%,20%   { opacity: 0; transform: translateY(6px); }
                        25%,48%  { opacity: 1; transform: translateY(0); }
                        52%,100% { opacity: 0; transform: translateY(-6px); }
                      }
                      @keyframes text3Cycle {
                        0%,50%   { opacity: 0; transform: translateY(6px); }
                        55%,78%  { opacity: 1; transform: translateY(0); }
                        82%,100% { opacity: 0; transform: translateY(-6px); }
                      }
                      @keyframes text4Cycle {
                        0%,80%   { opacity: 0; transform: translateY(6px); }
                        85%,100% { opacity: 1; transform: translateY(0); }
                      }
                      @keyframes ringExpand {
                        0%   { transform: scale(0.8); opacity: .6; }
                        100% { transform: scale(2.2); opacity: 0;  }
                      }
                    `}</style>

                    {/* Ícone com anéis pulsantes */}
                    <div className="relative mb-7 flex items-center justify-center">
                      <div className="absolute h-16 w-16 rounded-full bg-orange-100"
                        style={{ animation: 'ringExpand 1.6s ease-out infinite' }} />
                      <div className="absolute h-16 w-16 rounded-full bg-orange-100"
                        style={{ animation: 'ringExpand 1.6s ease-out 0.5s infinite' }} />
                      <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-lg">
                        {/* Scan line */}
                        <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-orange-400 to-transparent"
                          style={{ animation: 'scanLine 2s ease-in-out infinite' }} />
                        <Shield className="h-7 w-7 text-orange-400" />
                      </div>
                    </div>

                    {/* Texto animado em ciclo */}
                    <div className="relative h-6 w-64 overflow-hidden text-center">
                      <p className="absolute inset-x-0 text-sm font-semibold text-slate-800"
                        style={{ animation: 'textCycle 4s ease forwards' }}>
                        Aguarde...
                      </p>
                      <p className="absolute inset-x-0 text-sm font-semibold text-slate-800"
                        style={{ animation: 'text2Cycle 4s ease forwards' }}>
                        Buscando suas informações...
                      </p>
                      <p className="absolute inset-x-0 text-sm font-semibold text-slate-800"
                        style={{ animation: 'text3Cycle 4s ease forwards' }}>
                        Verificando credenciais...
                      </p>
                      <p className="absolute inset-x-0 text-sm font-semibold text-slate-800"
                        style={{ animation: 'text4Cycle 4s ease forwards' }}>
                        Quase lá...
                      </p>
                    </div>

                    {/* Dots */}
                    <div className="mt-3 flex items-center gap-1.5">
                      {[0, 0.2, 0.4].map((d, i) => (
                        <div key={i} className="h-1.5 w-1.5 rounded-full bg-orange-400"
                          style={{ animation: `dotBounce 1.2s ease ${d}s infinite` }} />
                      ))}
                    </div>

                    {/* Barra de progresso */}
                    <div className="mt-6 h-1 w-44 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600"
                        style={{
                          width: '100%',
                          transform: 'translateX(-100%)',
                          animation: 'slideProgress 3.5s cubic-bezier(0.4,0,0.2,1) forwards',
                        }}
                      />
                      <style>{`
                        @keyframes slideProgress {
                          0%   { transform: translateX(-100%); }
                          100% { transform: translateX(0%); }
                        }
                      `}</style>
                    </div>
                  </div>
                )}

                {/* PASSO 1 — identificador */}
                {staffStep === 'identifier' && (
                  <form onSubmit={handleIdentifierSubmit} className="space-y-4">
                    <div>
                      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900">
                        <Shield className="h-5 w-5 text-orange-400" />
                      </div>
                      <h2 className="text-xl font-bold text-slate-900">Área Restrita</h2>
                      <p className="text-sm text-slate-500">Acesso exclusivo para colaboradores do escritório</p>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">CPF ou E-mail</label>
                      <input ref={identRef} type="text" value={identifier}
                        onChange={(e) => {
                          const raw = e.target.value;
                          // Se só tem dígitos (ou pontos/traço de CPF), formata como CPF
                          const isNumeric = /^[\d.\-]*$/.test(raw) && !raw.includes('@');
                          if (isNumeric) {
                            const digits = raw.replace(/\D/g, '').slice(0, 11);
                            setIdentifier(formatCpfRaw(digits));
                          } else {
                            setIdentifier(raw);
                          }
                          setStaffError(null);
                        }}
                        inputMode="text"
                        placeholder="000.000.000-00 ou email@..." autoComplete="username" disabled={identifierLoading}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100"
                      />
                    </div>
                    {staffError && <ErrorMsg msg={staffError} />}
                    <button type="submit" disabled={identifierLoading || !identifier.trim()}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-bold text-white transition hover:bg-orange-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
                      {identifierLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</> : <><span>Continuar</span><ArrowRight className="h-4 w-4" /></>}
                    </button>
                  </form>
                )}

                {/* PASSO 2 — senha com perfil */}
                {staffStep === 'password' && (
                  <form onSubmit={handleStaffLogin}
                    style={{ animation: 'staffProfileIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }}
                    className="space-y-5"
                  >
                    <style>{`
                      @keyframes staffProfileIn {
                        from { opacity: 0; transform: translateY(18px) scale(0.97); }
                        to   { opacity: 1; transform: translateY(0)    scale(1);    }
                      }
                      @keyframes avatarPop {
                        0%   { transform: scale(0.6); opacity: 0; }
                        70%  { transform: scale(1.08); }
                        100% { transform: scale(1);   opacity: 1; }
                      }
                      @keyframes ringPulse {
                        0%, 100% { box-shadow: 0 0 0 0px rgba(249,115,22,0.4); }
                        50%      { box-shadow: 0 0 0 6px rgba(249,115,22,0);   }
                      }
                    `}</style>

                    {/* Voltar */}
                    <button type="button" onClick={goBackStaff}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-700 transition">
                      <ArrowLeft className="h-3.5 w-3.5" /> Voltar
                    </button>

                    {/* Avatar centralizado */}
                    <div className="flex flex-col items-center gap-2 py-2">
                      <div style={{ animation: 'avatarPop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s both' }}>
                        {profileAvatar ? (
                          <img
                            src={profileAvatar}
                            alt={profileName || ''}
                            className="h-20 w-20 rounded-full object-cover shadow-lg"
                            style={{ animation: 'ringPulse 2s ease-in-out 0.6s 3', outline: '3px solid #fff', outlineOffset: '2px', boxShadow: '0 0 0 3px #f97316, 0 8px 24px rgba(0,0,0,0.12)' }}
                          />
                        ) : (
                          <div
                            className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-black text-white shadow-lg"
                            style={{
                              background: 'linear-gradient(135deg,#fb923c,#ea580c)',
                              animation: 'ringPulse 2s ease-in-out 0.6s 3',
                              outline: '3px solid #fff', outlineOffset: '2px',
                              boxShadow: '0 0 0 3px #f97316, 0 8px 24px rgba(234,88,12,0.25)',
                            }}
                          >
                            {avatarInitial}
                          </div>
                        )}
                      </div>

                      <div className="text-center" style={{ animation: 'staffProfileIn 0.4s ease 0.2s both' }}>
                        <p className="text-base font-bold text-slate-900 leading-tight">{profileName || staffEmail}</p>
                        <p className="mt-0.5 text-[12px] text-slate-400">{staffEmail}</p>
                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          <Shield className="h-3 w-3" /> Colaborador
                        </span>
                      </div>
                    </div>

                    {/* Campo senha */}
                    <div className="space-y-1.5" style={{ animation: 'staffProfileIn 0.4s ease 0.3s both' }}>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Senha</label>
                      <div className="relative">
                        <input ref={pwRef} type={showPw ? 'text' : 'password'} value={staffPw}
                          onChange={(e) => { setStaffPw(e.target.value); setStaffError(null); }}
                          placeholder="••••••••" autoComplete="current-password" disabled={staffLoading}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 pr-11 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-700 focus:bg-white focus:ring-2 focus:ring-slate-200"
                        />
                        <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                          {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {staffError && <ErrorMsg msg={staffError} />}

                    <button type="submit" disabled={staffLoading || !staffPw}
                      style={{ animation: 'staffProfileIn 0.4s ease 0.4s both' }}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-bold text-white shadow-md shadow-orange-500/25 transition hover:bg-orange-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
                      {staffLoading
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Autenticando...</>
                        : <><Shield className="h-4 w-4" /> Acessar Sistema</>}
                    </button>
                  </form>
                )}

                <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-300">
                  <CheckCircle className="h-3.5 w-3.5" /> Conexão Segura SSL 256-bit
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200/60 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoBadge size={20} />
            <span className="text-[12px] font-bold text-slate-500">Jurius</span>
            <span className="text-[12px] text-slate-400">· Plataforma de Gestão Jurídica</span>
          </div>
          <p className="text-[11px] text-slate-400">© {new Date().getFullYear()} Jurius Technologies · Todos os direitos reservados</p>
        </div>
      </footer>
    </div>
  );
};

export default PortalLogin;
