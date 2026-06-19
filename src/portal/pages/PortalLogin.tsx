import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, ArrowLeft, ArrowRight,
  Eye, EyeOff, Lock, Shield, Gavel, Bell, History, MessageSquare, CheckCircle, Ban,
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

const Logo: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div className="flex items-center gap-2.5 select-none">
    <div className={`${compact ? 'w-7 h-7 text-sm' : 'w-9 h-9 text-base'} bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center text-white font-bold shadow-md shadow-orange-500/20 shrink-0`}>
      J
    </div>
    <div className="flex flex-col leading-none">
      <span className={`${compact ? 'text-sm' : 'text-base'} font-bold tracking-tight text-slate-900`}>
        jurius<span className="text-orange-500">.com.br</span>
      </span>
      {!compact && (
        <span className="text-[10px] font-medium text-slate-400 tracking-wide uppercase mt-0.5">
          Gestão Jurídica Inteligente
        </span>
      )}
    </div>
  </div>
);

const HeroFeatureCard: React.FC<{ icon: React.ElementType; title: string; desc: string }> = ({ icon: Icon, title, desc }) => (
  <div className="group bg-[#f8f7f5] p-3.5 rounded-xl border border-orange-200/40 hover:border-orange-700/30 hover:shadow-sm transition-all flex gap-3 items-start">
    <div className="shrink-0 w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center text-orange-700 transition-transform group-hover:scale-110">
      <Icon size={18} strokeWidth={1.5} />
    </div>
    <div>
      <h3 className="text-[13px] font-bold text-slate-900 leading-tight">{title}</h3>
      <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{desc}</p>
    </div>
  </div>
);

const ErrorMsg: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100">
      <AlertCircle className="h-4 w-4 text-red-600" />
    </div>
    <p className="text-[13px] font-medium leading-snug text-red-700">{msg}</p>
  </div>
);

const BannedMsg: React.FC = () => (
  <div className="flex flex-col items-center gap-4 rounded-xl border border-orange-200 bg-gradient-to-b from-orange-50 to-white px-6 py-6 text-center"
    style={{ animation: 'staffProfileIn 0.35s ease both' }}>
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 shadow-sm shadow-orange-200">
      <Ban className="h-7 w-7 text-orange-600" />
    </div>
    <div>
      <p className="text-[15px] font-bold text-slate-900">Acesso Revogado</p>
      <p className="mt-1.5 text-[13px] leading-snug text-slate-500">
        Sua conta foi desativada pelo administrador do escritório.
        <br />Entre em contato para reativar o acesso.
      </p>
    </div>
  </div>
);

// ── Tipos compartilhados ──────────────────────────────────────────────────────

type SvcStatus = 'checking' | 'online' | 'offline';

interface LiveStats {
  clientes: number; processos: number; assinaturas: number;
  acordos: number; prazos: number;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export const PortalLogin: React.FC = () => {
  const { loginByCPF, session: clientSession } = useClientAuth();

  // ── Auto-redirect: sessão já ativa ───────────────────────────────────────
  useEffect(() => {
    // Cliente do portal já logado → vai direto ao dashboard
    if (clientSession) {
      window.location.hash = '#/portal/dashboard';
      return;
    }
    // Funcionário já logado no Supabase → recarrega (main.tsx detecta sessão e carrega CRM)
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        window.location.reload();
      }
    });
  }, [clientSession]);

  // ── Client portal state
  const [mode, setMode]             = useState<Mode>('client');
  // Login do cliente pode estar desativado (Configurações → Portal). null = ainda carregando.
  const [portalEnabled, setPortalEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.rpc('portal_login_enabled').then(({ data, error }) => {
      if (!active) return;
      const on = error ? true : data !== false;
      setPortalEnabled(on);
      if (!on) setMode('staff');   // sem portal de cliente → só Área Restrita
    });
    return () => { active = false; };
  }, []);
  const [clientStep, setClientStep] = useState<ClientStep>('cpf');
  const [cpf, setCpf]               = useState('');
  const [phoneHint, setPhoneHint]   = useState<string | null>(null);
  const [digits, setDigits]         = useState(['', '', '', '']);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError]     = useState<string | null>(null);

  // ── Stats ao vivo
  const [stats,   setStats]   = useState<LiveStats | null>(null);
  const [svc,     setSvc]     = useState<SvcStatus>('checking');
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      const t0 = performance.now();
      try {
        const { data, error } = await supabase.rpc('portal_public_stats');
        const ms = Math.round(performance.now() - t0);
        if (!error && data) { setStats(data as LiveStats); setSvc('online'); setLatency(ms); }
        else { setSvc('offline'); setLatency(null); }
      } catch { setSvc('offline'); setLatency(null); }
    };
    load();
    const poll = setInterval(load, 60_000);
    return () => clearInterval(poll);
  }, []);

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
  const [staffBanned, setStaffBanned]             = useState(false);

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
    setStaffBanned(false);
    try {
      const trimmed = id.trim();

      if (trimmed.includes('@')) {
        const { data } = await supabase.from('profiles').select('name,avatar_url,email,is_active').ilike('email', trimmed);
        const p = data?.[0] ?? null;
        if (!p) { setStaffError('Usuário não encontrado. Verifique o e-mail informado.'); return false; }
        if (p.is_active === false) { setStaffBanned(true); return false; }
        setProfileName(p.name ?? p.email);
        setProfileAvatar(p.avatar_url ?? null);
        setStaffEmail(p.email ?? trimmed);
        return true;
      }

      const numeric = trimmed.replace(/\D/g, '');
      if (!numeric) return false;

      if (numeric.length === 11) {
        const masked = formatCpfRaw(numeric);
        const { data: byMasked } = await supabase.from('profiles').select('name,avatar_url,email,is_active').eq('cpf', masked).maybeSingle();
        if (byMasked?.email) {
          if (byMasked.is_active === false) { setStaffBanned(true); return false; }
          setProfileName(byMasked.name ?? byMasked.email); setProfileAvatar(byMasked.avatar_url ?? null); setStaffEmail(byMasked.email); return true;
        }

        const { data: byRaw } = await supabase.from('profiles').select('name,avatar_url,email,is_active').eq('cpf', numeric).maybeSingle();
        if (byRaw?.email) {
          if (byRaw.is_active === false) { setStaffBanned(true); return false; }
          setProfileName(byRaw.name ?? byRaw.email); setProfileAvatar(byRaw.avatar_url ?? null); setStaffEmail(byRaw.email); return true;
        }
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
      window.location.href = '/';   // main.tsx detecta sessão Supabase e carrega o CRM
    } catch (err: any) {
      const msg: string = err.message || '';
      if (msg.toLowerCase().includes('banned')) {
        setStaffBanned(true);
        setStaffError(null);
      } else {
        setStaffError(msg || 'Credenciais inválidas.');
        setStaffBanned(false);
      }
    }
    finally { setStaffLoading(false); }
  };

  const goBackStaff = () => { setStaffStep('identifier'); setStaffError(null); setStaffBanned(false); setStaffPw(''); setProfileName(null); setProfileAvatar(null); };

  const switchMode = (m: Mode) => {
    setMode(m);
    setClientError(null); setStaffError(null); setStaffBanned(false);
  };

  const avatarInitial = (profileName || identifier || staffEmail).trim().charAt(0).toUpperCase() || '?';

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#FCFAF6', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }} className="flex-col md:flex-row">

      {/* ── PAINEL DE MARCA (editorial, escuro) — oculto no mobile ── */}
      <aside
        className="hidden md:flex"
        style={{
          position: 'relative', overflow: 'hidden', flex: '0 0 44%', minWidth: 0,
          flexDirection: 'column', justifyContent: 'space-between', padding: 'clamp(32px, 4.5vw, 60px)', color: '#fff',
          backgroundColor: '#0C1320',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px),radial-gradient(640px 540px at 8% 92%, rgba(242,99,26,0.16), transparent 62%),radial-gradient(520px 460px at 96% 4%, rgba(74,108,170,0.16), transparent 60%)',
          backgroundSize: '80px 80px, 80px 80px, 100% 100%, 100% 100%',
        }}>
        {/* watermark monogram */}
        <div style={{ position: 'absolute', right: -60, bottom: -90, fontFamily: "'Newsreader', serif", fontSize: 460, lineHeight: 1, fontWeight: 400, color: 'rgba(255,255,255,0.018)', zIndex: 1, userSelect: 'none' }}>J</div>

        {/* logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 2 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(150deg,#FF7A33,#EA5310)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 23, color: '#fff', boxShadow: '0 10px 24px -8px rgba(242,99,26,0.65)' }}>J</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}><span style={{ color: '#fff' }}>jurius</span><span style={{ color: '#8893a8', fontWeight: 500 }}>.com.br</span></div>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', color: '#5e6a82', fontWeight: 600, marginTop: 1 }}>GESTÃO JURÍDICA</div>
          </div>
        </div>

        {/* headline editorial */}
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 520 }}>
          <div style={{ width: 34, height: 2, background: '#F2631A', marginBottom: 'clamp(20px, 3vw, 34px)', opacity: 0.9 }} />
          <h1 style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 'clamp(28px, 3vw, 46px)', lineHeight: 1.1, letterSpacing: '-0.01em', color: '#F5F2EB' }}>
            Gestão jurídica conduzida com <span style={{ fontStyle: 'italic', color: '#FF9259' }}>precisão</span>.
          </h1>
          <p style={{ fontSize: 'clamp(13px, 1.1vw, 16px)', lineHeight: 1.65, color: '#97a1b4', fontWeight: 400, marginTop: 'clamp(16px, 2vw, 26px)', maxWidth: 430 }}>
            Processos, prazos e documentos do escritório reunidos em um só ambiente — com a segurança e o rigor que a advocacia exige.
          </p>
        </div>

        {/* footer meta */}
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize: 13, color: '#6e7a92', fontWeight: 500, letterSpacing: '0.01em' }}>jurius.com.br</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#8a94a8', fontWeight: 500 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: svc === 'online' ? '#3ec47a' : svc === 'offline' ? '#ef4444' : '#f5a623', boxShadow: svc === 'online' ? '0 0 0 3px rgba(62,196,122,0.18)' : 'none' }} />
            {svc === 'online' ? 'Sistema operacional' : svc === 'offline' ? 'Sistema indisponível' : 'Verificando sistema'}
          </span>
        </div>
      </aside>

      {/* ── PAINEL DO FORMULÁRIO ── */}
      <main className="min-h-screen md:h-auto" style={{ position: 'relative', flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(28px, 5vw, 56px) clamp(18px, 4vw, 48px)' }}>
        {/* fundo pontilhado sutil (reaproveitado do login anterior) */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(234,88,12,0.05) 1px, transparent 0)', backgroundSize: '24px 24px' }} />

        <div id="login-card" tabIndex={-1} className="relative z-10 w-full" style={{ maxWidth: 440 }}>

          {/* logo no mobile (painel de marca fica oculto) */}
          <div className="md:hidden mb-6 flex justify-center"><Logo /></div>

          <div className="bg-[#f8f7f5] rounded-2xl overflow-hidden" style={{ boxShadow: '0 20px 40px -15px rgba(15,23,42,0.12)' }}>

            {/* Tabs — só aparecem quando o login do cliente está ativo (senão, só Área Restrita) */}
            {portalEnabled !== false && (
            <div className="flex border-b border-slate-200">
              <button type="button" onClick={() => switchMode('client')}
                className={`flex-1 py-4 text-sm font-semibold tracking-wide transition-colors ${
                  mode === 'client'
                    ? 'text-slate-900 border-b-2 border-slate-700 bg-[#f8f7f5]'
                    : 'text-slate-500 bg-slate-100 hover:text-slate-700'
                }`}>
                Portal do Cliente
              </button>
              <button type="button" onClick={() => switchMode('staff')}
                className={`flex-1 py-4 text-sm font-semibold tracking-wide transition-colors flex items-center justify-center gap-2 ${
                  mode === 'staff'
                    ? 'text-slate-900 border-b-2 border-slate-700 bg-[#f8f7f5]'
                    : 'text-slate-500 bg-slate-100 hover:text-slate-700'
                }`}>
                <Lock className="h-3.5 w-3.5" /> Área Restrita
              </button>
            </div>
            )}

            {/* ═══ CLIENT PORTAL ═══ */}
            {mode === 'client' && (
              <div className="p-5 space-y-4">
                <div className="flex gap-1.5">
                  <div className="h-1 flex-1 rounded-full bg-slate-900" />
                  <div className={`h-1 flex-1 rounded-full transition-colors ${clientStep === 'pin' ? 'bg-slate-900' : 'bg-slate-200'}`} />
                </div>

                {clientStep === 'cpf' && (
                  <form onSubmit={handleClientContinue} className="space-y-4">
                    <div>
                      <span className="inline-block px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-500 tracking-widest uppercase">Passo 1 de 2</span>
                      <h2 className="text-lg font-bold text-slate-900 mt-1.5">Qual é o seu CPF?</h2>
                      <p className="text-[13px] text-slate-500">Informe seus dados para acessar o painel.</p>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Documento de Identidade</label>
                        <input ref={cpfRef} type="text" value={formatCPF(cpf)}
                          onChange={(e) => { setCpf(e.target.value); setClientError(null); }}
                          placeholder="000.000.000-00" autoComplete="username" inputMode="numeric" disabled={clientLoading}
                          className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-700 focus:border-slate-700 outline-none transition-all text-base font-semibold text-slate-900 placeholder:text-slate-400"
                        />
                      </div>
                      {clientError && <ErrorMsg msg={clientError} />}
                      <button type="submit" disabled={clientLoading || !cpfOk}
                        className="w-full bg-slate-900 text-white py-3 rounded-lg font-bold text-base hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ boxShadow: '0 10px 24px -12px rgba(15,26,46,0.85)' }}>
                        {clientLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Verificando...</> : <><span>Continuar</span><ArrowRight className="h-5 w-5" /></>}
                      </button>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-[12px] text-slate-500">Dúvidas? Entre em contato com seu advogado.</p>
                      <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-400 tracking-[0.15em]">
                        <CheckCircle className="h-3 w-3" /> CONEXÃO SEGURA SSL 256-BIT
                      </div>
                    </div>
                  </form>
                )}

                {clientStep === 'pin' && (
                  <form onSubmit={handleClientLogin} className="space-y-4">
                    <div>
                      <button type="button" onClick={goBackClient}
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-900 transition mb-1">
                        <ArrowLeft className="h-3.5 w-3.5" /> Voltar
                      </button>
                      <span className="block px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-500 tracking-widest uppercase w-fit">Passo 2 de 2</span>
                      <h2 className="text-lg font-bold text-slate-900 mt-1.5">Confirme seu acesso</h2>
                    </div>
                    {phoneHint && (
                      <div className="flex items-center gap-3 rounded-lg bg-slate-100 px-3 py-2.5 border border-slate-200">
                        <span>📱</span>
                        <div>
                          <p className="text-[11px] text-slate-500 font-semibold">Telefone cadastrado</p>
                          <p className="text-sm font-bold text-slate-800 tracking-wider">{phoneHint}</p>
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">4 últimos dígitos</label>
                      <div className="flex gap-2.5" onPaste={handlePaste}>
                        {digits.map((d, i) => (
                          <input key={i} ref={pinRefs[i]} type="password" inputMode="numeric" maxLength={1} value={d}
                            onChange={(e) => handleDigit(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} disabled={clientLoading}
                            className={`h-14 w-full rounded-xl border-2 text-center text-xl font-bold outline-none transition
                              ${d ? 'border-slate-900 bg-slate-100 text-slate-900' : 'border-slate-200 bg-slate-100 text-slate-900'}
                              focus:border-slate-900 focus:bg-white disabled:opacity-50`}
                          />
                        ))}
                      </div>
                    </div>
                    {clientError && <ErrorMsg msg={clientError} />}
                    <button type="submit" disabled={clientLoading || !pinOk}
                      className="w-full bg-slate-900 text-white py-3 rounded-lg font-bold text-base hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ boxShadow: '0 10px 24px -12px rgba(15,26,46,0.85)' }}>
                      {clientLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Entrando...</> : 'Entrar na minha área'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* ═══ ÁREA RESTRITA ═══ */}
            {mode === 'staff' && (
              <div className="relative p-8 space-y-6">
                {identifierLoading && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-b-2xl bg-[#f8f7f5]"
                    style={{ animation: 'fadeIn 0.25s ease both' }}>
                    <style>{`
                      @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
                      @keyframes scanLine { 0%{top:0%;opacity:1} 80%{top:100%;opacity:1} 100%{top:100%;opacity:0} }
                      @keyframes dotBounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-8px);opacity:1} }
                      @keyframes ringExpand { 0%{transform:scale(0.8);opacity:.6} 100%{transform:scale(2.2);opacity:0} }
                      @keyframes slideProgress { 0%{transform:translateX(-100%)} 100%{transform:translateX(0%)} }
                    `}</style>
                    <div className="relative mb-7 flex items-center justify-center">
                      <div className="absolute h-16 w-16 rounded-full bg-orange-100" style={{ animation: 'ringExpand 1.6s ease-out infinite' }} />
                      <div className="absolute h-16 w-16 rounded-full bg-orange-100" style={{ animation: 'ringExpand 1.6s ease-out 0.5s infinite' }} />
                      <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-lg">
                        <div className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-orange-500 to-transparent" style={{ animation: 'scanLine 2s ease-in-out infinite' }} />
                        <Shield className="h-7 w-7 text-orange-500" />
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-slate-800">Verificando credenciais...</p>
                    <div className="mt-3 flex items-center gap-1.5">
                      {[0, 0.2, 0.4].map((d, i) => (
                        <div key={i} className="h-1.5 w-1.5 rounded-full bg-orange-500" style={{ animation: `dotBounce 1.2s ease ${d}s infinite` }} />
                      ))}
                    </div>
                    <div className="mt-6 h-1 w-44 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-700"
                        style={{ width: '100%', transform: 'translateX(-100%)', animation: 'slideProgress 3.5s cubic-bezier(0.4,0,0.2,1) forwards' }} />
                    </div>
                  </div>
                )}

                {staffStep === 'identifier' && (
                  <form onSubmit={handleIdentifierSubmit} className="space-y-6">
                    <div>
                      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900">
                        <Shield className="h-5 w-5 text-white" />
                      </div>
                      <h2 className="text-xl font-bold text-slate-900">Área Restrita</h2>
                      <p className="text-[13px] text-slate-500 mt-1">Acesso exclusivo para colaboradores do escritório</p>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">CPF ou E-mail</label>
                      <input ref={identRef} type="text" value={identifier}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const isNumeric = /^[\d.\-]*$/.test(raw) && !raw.includes('@');
                          if (isNumeric) {
                            const digits = raw.replace(/\D/g, '').slice(0, 11);
                            setIdentifier(formatCpfRaw(digits));
                          } else {
                            setIdentifier(raw);
                          }
                          setStaffError(null);
                          setStaffBanned(false);
                        }}
                        inputMode="text"
                        placeholder="000.000.000-00 ou email@..." autoComplete="username" disabled={identifierLoading}
                        className="w-full px-4 py-3.5 bg-slate-100 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-700 focus:border-slate-700 outline-none transition-all text-base font-medium text-slate-900 placeholder:text-slate-400"
                      />
                    </div>
                    {staffBanned && <BannedMsg />}
                    {staffError && !staffBanned && <ErrorMsg msg={staffError} />}
                    <button type="submit" disabled={identifierLoading || !identifier.trim()}
                      className="w-full bg-slate-900 text-white py-4 rounded-lg font-bold text-base hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40">
                      {identifierLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Buscando...</> : <><span>Continuar</span><ArrowRight className="h-5 w-5" /></>}
                    </button>
                  </form>
                )}

                {staffStep === 'password' && (
                  <form onSubmit={handleStaffLogin}
                    style={{ animation: 'staffProfileIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }}
                    className="space-y-5">
                    <style>{`
                      @keyframes staffProfileIn { from{opacity:0;transform:translateY(18px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
                      @keyframes avatarPop { 0%{transform:scale(0.6);opacity:0} 70%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
                      @keyframes ringPulse { 0%,100%{box-shadow:0 0 0 0px rgba(249,115,22,0.4)} 50%{box-shadow:0 0 0 6px rgba(249,115,22,0)} }
                    `}</style>
                    <button type="button" onClick={goBackStaff}
                      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900 transition">
                      <ArrowLeft className="h-3.5 w-3.5" /> Voltar
                    </button>
                    <div className="flex flex-col items-center gap-3 py-2">
                      <div style={{ animation: 'avatarPop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s both' }}>
                        {profileAvatar ? (
                          <img src={profileAvatar} alt={profileName || ''}
                            className="h-20 w-20 rounded-full object-cover shadow-lg"
                            style={{ animation: 'ringPulse 2s ease-in-out 0.6s 3', outline: '3px solid #fff', outlineOffset: '2px', boxShadow: '0 0 0 3px #ff6b00, 0 8px 24px rgba(0,0,0,0.12)' }}
                          />
                        ) : (
                          <div className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-black text-white shadow-lg"
                            style={{ background: 'linear-gradient(135deg,#ff6b00,#a04100)', animation: 'ringPulse 2s ease-in-out 0.6s 3', outline: '3px solid #fff', outlineOffset: '2px', boxShadow: '0 0 0 3px #ff6b00, 0 8px 24px rgba(234,88,12,0.25)' }}>
                            {avatarInitial}
                          </div>
                        )}
                      </div>
                      <div className="text-center" style={{ animation: 'staffProfileIn 0.4s ease 0.2s both' }}>
                        <p className="text-base font-bold text-slate-900 leading-tight">{profileName || staffEmail}</p>
                        <p className="mt-0.5 text-[13px] text-slate-500">{staffEmail}</p>
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          <Shield className="h-3 w-3" /> Colaborador
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5" style={{ animation: 'staffProfileIn 0.4s ease 0.3s both' }}>
                      <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Senha</label>
                      <div className="relative">
                        <input ref={pwRef} type={showPw ? 'text' : 'password'} value={staffPw}
                          onChange={(e) => { setStaffPw(e.target.value); setStaffError(null); setStaffBanned(false); }}
                          placeholder="••••••••" autoComplete="current-password" disabled={staffLoading}
                          className="w-full px-4 py-3.5 bg-slate-100 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-700 focus:border-slate-700 outline-none transition-all pr-12 text-base font-medium text-slate-900"
                        />
                        <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                          {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>
                    {staffBanned && <BannedMsg />}
                    {staffError && !staffBanned && <ErrorMsg msg={staffError} />}
                    <button type="submit" disabled={staffLoading || !staffPw}
                      style={{ animation: 'staffProfileIn 0.4s ease 0.4s both' }}
                      className="w-full bg-slate-900 text-white py-4 rounded-lg font-bold text-base hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40">
                      {staffLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Autenticando...</> : <><Shield className="h-5 w-5" /> Acessar Sistema</>}
                    </button>
                  </form>
                )}

                <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-400 tracking-[0.15em]">
                  <CheckCircle className="h-3.5 w-3.5" /> CONEXÃO SEGURA SSL 256-BIT
                </div>
              </div>
            )}
          </div>

          {/* rodapé do painel */}
          <p style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: '#9aa0ab', fontWeight: 500 }}>© {new Date().getFullYear()} Jurius</p>
        </div>
      </main>
    </div>
  );
};

export default PortalLogin;

