import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, ArrowLeft, ArrowRight,
  Eye, EyeOff, Lock, Shield, Bell, MessageSquare, Ban, ChevronRight, CheckCircle, X,
  Calendar, MessageCircle, Users, Scale, Briefcase, FileText,
  PiggyBank, AlarmClock, Library, PenTool, Cloud, UserPlus,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { supabase } from '../../config/supabase';

type ClientStep = 'cpf' | 'pin';
type Mode = 'client' | 'staff';
type StaffStep = 'identifier' | 'account' | 'password';

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

// ── Contas lembradas (estilo Facebook: vários acessos rápidos salvos) ───────────
// Guardamos só nome/foto/e-mail/cargo (NUNCA a senha). A conta FICA salva no
// acesso rápido (não expira sozinha) — só sai com "Esquecer" ou "Acessar outra
// conta". A confirmação de identidade é simplesmente pedir a senha ao usar o card.

interface RememberedStaff { name: string | null; avatar: string | null; email: string; role: string | null; }
const REMEMBER_KEY = 'jurius:staffAccounts';

// Lê as contas salvas (valida o formato; não remove por tempo)
const loadRememberedStaff = (): RememberedStaff[] => {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((a: any): a is RememberedStaff => a && typeof a.email === 'string' && a.email);
  } catch { return []; }
};
// Insere/atualiza uma conta (mais recente primeiro; máx. 5)
const saveRememberedStaff = (s: RememberedStaff) => {
  try {
    const list = loadRememberedStaff().filter(a => a.email !== s.email);
    const next = [s, ...list].slice(0, 5);
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
};
// Remove uma conta específica do dispositivo
const removeRememberedStaff = (email: string) => {
  try {
    const list = loadRememberedStaff().filter(a => a.email !== email);
    if (list.length) localStorage.setItem(REMEMBER_KEY, JSON.stringify(list));
    else localStorage.removeItem(REMEMBER_KEY);
  } catch { /* ignore */ }
};

// Traduz mensagens de erro de autenticação do Supabase para português
const friendlyAuthError = (raw: string): string => {
  const m = (raw || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'E-mail ainda não confirmado. Verifique sua caixa de entrada.';
  if (m.includes('too many requests') || m.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Falha de conexão. Verifique sua internet e tente de novo.';
  if (m.includes('user not found')) return 'Usuário não encontrado.';
  return raw || 'Não foi possível entrar. Tente novamente.';
};

// Região do servidor Supabase para o indicador de conexão.
// NUNCA expomos o project-ref/host na UI pública — apenas a região (dado não sensível)
// e a latência medida. A região vem de VITE_SUPABASE_REGION (configurável); o default
// reflete a região real do projeto (sa-east-1 / São Paulo).
const SUPABASE_REGIONS: Record<string, string> = {
  'sa-east-1': 'São Paulo · BR',
  'us-east-1': 'N. Virginia · US',
  'us-east-2': 'Ohio · US',
  'us-west-1': 'N. California · US',
  'us-west-2': 'Oregon · US',
  'ca-central-1': 'Canadá',
  'eu-west-1': 'Irlanda · EU',
  'eu-west-2': 'Londres · UK',
  'eu-west-3': 'Paris · EU',
  'eu-central-1': 'Frankfurt · EU',
  'ap-south-1': 'Mumbai',
  'ap-southeast-1': 'Singapura',
  'ap-southeast-2': 'Sydney',
  'ap-northeast-1': 'Tóquio',
  'ap-northeast-2': 'Seul',
};
const supabaseRegionCode = ((import.meta.env.VITE_SUPABASE_REGION as string) || 'sa-east-1').trim();
const supabaseRegion = SUPABASE_REGIONS[supabaseRegionCode] || supabaseRegionCode;

// ── Sub-componentes ───────────────────────────────────────────────────────────

const Logo: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div className="flex items-center gap-2.5 select-none">
    <div className={`${compact ? 'w-7 h-7 text-sm' : 'w-9 h-9 text-base'} bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center text-white font-bold shadow-md shadow-orange-500/20 shrink-0`}>
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

// Avatar com fallback próprio (cada item da lista gerencia seu próprio erro de imagem)
const Avatar: React.FC<{ url: string | null; name: string | null; email: string; size: number }> = ({ url, name, email, size }) => {
  const [err, setErr] = useState(false);
  const initial = (name || email || '?').trim().charAt(0).toUpperCase() || '?';
  const ring = { outline: '2px solid #fff', boxShadow: '0 0 0 2px #ff6b00' } as const;
  if (url && !err) {
    return <img src={url} alt={name || ''} onError={() => setErr(true)}
      className="shrink-0 rounded-full object-cover" style={{ height: size, width: size, ...ring }} />;
  }
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full font-black text-white"
      style={{ height: size, width: size, fontSize: size * 0.4, background: 'linear-gradient(135deg,#ff6b00,#a04100)', ...ring }}>
      {initial}
    </div>
  );
};

const ErrorMsg: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3.5">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100">
      <AlertCircle className="h-4 w-4 text-red-600" />
    </div>
    <p className="text-[13px] font-medium leading-snug text-red-700">{msg}</p>
  </div>
);

const BannedMsg: React.FC = () => (
  <div className="flex flex-col items-center gap-4 rounded-lg border border-orange-200 bg-gradient-to-b from-orange-50 to-white px-6 py-6 text-center"
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

// ── Módulos do sistema (vitrine no painel de marca) ────────────────────────────

const MODULES: { icon: React.ElementType; label: string }[] = [
  { icon: Users,      label: 'Clientes' },
  { icon: UserPlus,   label: 'Leads' },
  { icon: Scale,      label: 'Processos' },
  { icon: Calendar,   label: 'Agenda' },
  { icon: AlarmClock, label: 'Prazos' },
  { icon: Bell,       label: 'Intimações' },
  { icon: PiggyBank,  label: 'Financeiro' },
  { icon: Briefcase,  label: 'Requerimentos' },
  { icon: FileText,   label: 'Petições' },
  { icon: Library,    label: 'Documentos' },
  { icon: PenTool,    label: 'Assinaturas' },
  { icon: MessageSquare, label: 'WhatsApp' },
  { icon: MessageCircle, label: 'Chat da Equipe' },
  { icon: Cloud,      label: 'Cloud' },
];

// Movimento por chip (determinístico — sem random a cada render, para a flutuação
// ser estável e o ciclo nunca "sincronizar"). Entrega por chip:
//  · --chip-anim         variante de flutuação (A/B/C em rodízio)
//  · --chip-dur          duração da flutuação (varia → desencontro natural)
//  · --chip-in           atraso do fade-in de entrada (cascata suave)
//  · --chip-float-delay  quando a flutuação assume — após a entrada
const CHIP_VARIANTS = ['chipFloatA', 'chipFloatB', 'chipFloatC'] as const;
const chipMotion = (i: number): React.CSSProperties => ({
  // ts: variáveis CSS customizadas não existem no tipo CSSProperties
  ['--chip-anim' as any]:  CHIP_VARIANTS[i % CHIP_VARIANTS.length],
  ['--chip-dur'  as any]: `${(9 + (i % 5) * 1.15).toFixed(2)}s`,     // 9.0s … 13.6s
  ['--chip-in'   as any]: `${(0.45 + i * 0.045).toFixed(2)}s`,       // entrada em cascata
  ['--chip-float-delay' as any]: `${(1.4 + i * 0.05).toFixed(2)}s`,  // flutuação após assentar
});

// ── Tipos compartilhados ──────────────────────────────────────────────────────

type SvcStatus = 'checking' | 'online' | 'offline';

interface LiveStats {
  clientes: number; processos: number; assinaturas: number;
  acordos: number; prazos: number;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export const PortalLogin: React.FC = () => {
  const { loginByCPF, session: clientSession } = useClientAuth();

  // ── Aviso de sessão encerrada (inatividade/time-box) — staff e cliente ───
  // Ambos os fluxos redirecionam para cá após o logout automático, deixando um
  // marcador em sessionStorage. Lemos uma vez, exibimos o banner e limpamos.
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => {
    try {
      const ended = sessionStorage.getItem('auth_notice') || sessionStorage.getItem('portal_notice');
      if (ended) {
        sessionStorage.removeItem('auth_notice');
        sessionStorage.removeItem('portal_notice');
        setSessionEnded(true);
      }
    } catch { /* ignore */ }
  }, []);

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

  // Contas lembradas localmente (leitura na montagem) — lista com TTL
  const remembered = useRef(loadRememberedStaff()).current;
  const [accounts, setAccounts] = useState<RememberedStaff[]>(remembered);

  // ── Client portal state
  const [mode, setMode]             = useState<Mode>(remembered.length ? 'staff' : 'client');
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

  // ── Parallax suave dos chips (só ponteiro fino e sem reduced-motion) ──────
  const asideRef    = useRef<HTMLElement>(null);
  const chipGridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine   = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const aside = asideRef.current;
    const grid  = chipGridRef.current;
    if (reduce || !fine || !aside || !grid) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = aside.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
      const dy = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { grid.style.transform = `translate3d(${dx * 10}px, ${dy * 8}px, 0)`; });
    };
    const onLeave = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { grid.style.transform = 'translate3d(0,0,0)'; }); };
    aside.addEventListener('pointermove', onMove);
    aside.addEventListener('pointerleave', onLeave);
    return () => { aside.removeEventListener('pointermove', onMove); aside.removeEventListener('pointerleave', onLeave); cancelAnimationFrame(raf); };
  }, []);

  // ── Staff state
  const [staffStep, setStaffStep]             = useState<StaffStep>(remembered.length ? 'account' : 'identifier');
  const [identifier, setIdentifier]           = useState('');
  const [staffEmail, setStaffEmail]           = useState('');
  const [staffPw, setStaffPw]                 = useState('');
  const [showPw, setShowPw]                   = useState(false);
  const [capsOn, setCapsOn]                   = useState(false);
  const [profileName, setProfileName]         = useState<string | null>(null);
  const [profileAvatar, setProfileAvatar]     = useState<string | null>(null);
  const [profileRole, setProfileRole]         = useState<string | null>(null);
  const [identifierLoading, setIdentifierLoading] = useState(false);
  const [staffLoading, setStaffLoading]           = useState(false);
  const [staffError, setStaffError]               = useState<string | null>(null);
  const [staffBanned, setStaffBanned]             = useState(false);
  const [avatarError, setAvatarError]             = useState(false);
  // Após o 1º login bem-sucedido, pergunta se quer salvar o acesso rápido neste dispositivo
  const [askSaveQuick, setAskSaveQuick]           = useState(false);

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
      // Identificação pré-login via RPC security definer (não expõe profiles/clients
      // ao papel anon). Resolve staff por e-mail/CPF e cliente por CPF/CNPJ.
      const { data, error } = await supabase.rpc('login_identify', { p_identifier: trimmed });
      const p = (data ?? null) as {
        found?: boolean;
        name?: string | null;
        avatar_url?: string | null;
        email?: string | null;
        role?: string | null;
        is_active?: boolean | null;
      } | null;
      if (error || !p?.found) {
        setStaffError('Usuário não encontrado. Verifique o dado informado.');
        return false;
      }
      if (p.is_active === false) { setStaffBanned(true); return false; }
      setProfileName(p.name ?? p.email ?? trimmed);
      setProfileAvatar(p.avatar_url ?? null);
      setProfileRole(p.role ?? null);
      setStaffEmail(p.email ?? trimmed);
      return true;
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
      if (accounts.some(a => a.email === staffEmail)) {
        // conta já lembrada (o usuário voltou pelo card) → renova o prazo e segue
        saveRememberedStaff({ name: profileName, avatar: profileAvatar, email: staffEmail, role: profileRole });
        window.location.href = '/';
      } else {
        // primeiro login desta conta neste navegador → pergunta antes de salvar (prudente)
        setAskSaveQuick(true);
      }
    } catch (err: any) {
      const msg: string = err.message || '';
      if (msg.toLowerCase().includes('banned')) {
        setStaffBanned(true);
        setStaffError(null);
      } else {
        setStaffError(friendlyAuthError(msg));
        setStaffBanned(false);
      }
    }
    finally { setStaffLoading(false); }
  };

  const goBackStaff = () => { setStaffStep('identifier'); setStaffError(null); setStaffBanned(false); setStaffPw(''); setProfileName(null); setProfileAvatar(null); setProfileRole(null); };

  // "Acessar outra conta": vai ao passo de identificação SEM apagar as contas já salvas
  const switchStaffAccount = () => {
    setStaffEmail('');
    setAvatarError(false);
    goBackStaff();
  };

  // Clicar numa conta da lista → carrega o perfil e abre o passo de senha
  const pickAccount = (acc: RememberedStaff) => {
    setProfileName(acc.name); setProfileAvatar(acc.avatar); setProfileRole(acc.role);
    setStaffEmail(acc.email); setAvatarError(false);
    setStaffPw(''); setStaffError(null); setStaffBanned(false);
    setStaffStep('password');
  };

  // Esquecer uma conta salva neste dispositivo
  const removeAccount = (email: string) => {
    removeRememberedStaff(email);
    const next = accounts.filter(a => a.email !== email);
    setAccounts(next);
    if (!next.length) switchStaffAccount();
  };

  // Consentimento de "acesso rápido" (mostrado após o 1º login da conta)
  const confirmSaveQuick = () => {
    saveRememberedStaff({ name: profileName, avatar: profileAvatar, email: staffEmail, role: profileRole });
    window.location.href = '/';
  };
  const declineSaveQuick = () => {
    // não salva esta conta; mantém intactas as demais já salvas
    window.location.href = '/';
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setClientError(null); setStaffError(null); setStaffBanned(false);
  };

  const avatarInitial = (profileName || identifier || staffEmail).trim().charAt(0).toUpperCase() || '?';

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#FCFAF6', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }} className="flex-col md:flex-row">

      {/* ── Efeito de abertura: keyframes + barra de carregamento no topo ── */}
      <style>{`
        @keyframes loginFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes loginPanelIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes loginBarSweep { 0% { transform: scaleX(0); } 55% { transform: scaleX(0.7); } 100% { transform: scaleX(1); } }
        @keyframes loginBarFade { to { opacity: 0; } }
        .login-anim { animation: loginFadeUp 0.62s cubic-bezier(0.22,0.61,0.36,1) both; }

        /* ── Vitrine de módulos: fade-in em cascata + flutuação orgânica + hover ── */
        /* Camadas: .chip-float (fade-in de entrada) › .chip-drift (flutuação) › .chip (hover). */
        @keyframes chipIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes chipFloatA { 0%,100% { transform: translate3d(0,0,0) rotate(0deg); } 50% { transform: translate3d(0,-6px,0) rotate(-0.4deg); } }
        @keyframes chipFloatB { 0%,100% { transform: translate3d(0,0,0); } 34% { transform: translate3d(3px,-4px,0); } 67% { transform: translate3d(-2px,-7px,0); } }
        @keyframes chipFloatC { 0%,100% { transform: translate3d(0,0,0) rotate(0deg); } 50% { transform: translate3d(-4px,-5px,0) rotate(0.5deg); } }
        @keyframes chipBreathe { 0%,100% { opacity: 0.32; transform: scale(1); } 50% { opacity: 0.55; transform: scale(1.07); } }

        .chip-grid { position: relative; transition: transform 0.55s cubic-bezier(0.22,0.61,0.36,1); will-change: transform; }
        .chip-float {
          display: inline-flex; opacity: 0; will-change: transform, opacity;
          animation: chipIn 0.6s cubic-bezier(0.22,0.61,0.36,1) var(--chip-in,0s) both;
        }
        .chip-drift {
          display: inline-flex; will-change: transform;
          animation: var(--chip-anim,chipFloatA) var(--chip-dur,9s) ease-in-out var(--chip-float-delay,1.4s) infinite;
        }
        .chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 6px;
          font-size: 12px; font-weight: 600; color: #aeb6c4; white-space: nowrap;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
          transition: transform 0.35s cubic-bezier(0.22,0.61,0.36,1), background 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease, color 0.35s ease;
        }
        .chip:hover {
          transform: translateY(-3px);
          background: rgba(255,255,255,0.06); border-color: rgba(242,99,26,0.45); color: #e7ebf2;
          box-shadow: 0 8px 22px -10px rgba(242,99,26,0.4), inset 0 0 0 1px rgba(242,99,26,0.08);
        }
        .chip-ico { color: #FF9259; }
        .chip-breathe { animation: chipBreathe 9s ease-in-out infinite; }

        /* ── Brilho interno passando pelo logo J (sheen diagonal em loop com pausa) ── */
        @keyframes logoShine {
          0%   { transform: translateX(-180%) skewX(-20deg); }
          16%  { transform: translateX(180%)  skewX(-20deg); }
          100% { transform: translateX(180%)  skewX(-20deg); }  /* fica fora à direita até o próximo ciclo */
        }
        .logo-shine { position: relative; overflow: hidden; }
        .logo-shine::after {
          content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 55%; z-index: 2; pointer-events: none;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.55) 50%, transparent);
          transform: translateX(-180%) skewX(-20deg);
          animation: logoShine 4.8s cubic-bezier(0.4,0,0.2,1) 1.2s infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .login-anim, [data-login-bar] { animation: none !important; opacity: 1 !important; transform: none !important; }
          .chip-float, .chip-drift { animation: none !important; opacity: 1 !important; transform: none !important; }
          .chip:hover { transform: none; }
          .chip-grid { transition: none !important; transform: none !important; }
          .chip-breathe { animation: none !important; opacity: 0.4 !important; }
          .logo-shine::after { animation: none !important; opacity: 0 !important; }
        }
      `}</style>
      <div data-login-bar aria-hidden="true"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 50, transformOrigin: 'left',
          background: 'linear-gradient(90deg,#F2631A,#FF9259)',
          boxShadow: '0 0 12px rgba(242,99,26,0.6)',
          animation: 'loginBarSweep 0.95s cubic-bezier(0.22,0.61,0.36,1) both, loginBarFade 0.4s ease 1s forwards',
        }} />

      {/* ── PAINEL DE MARCA (editorial, escuro) — oculto no mobile ── */}
      <aside
        ref={asideRef}
        className="hidden md:flex"
        style={{
          position: 'relative', overflow: 'hidden', flex: '0 0 56%', minWidth: 0,
          flexDirection: 'column', justifyContent: 'space-between', padding: 'clamp(36px, 5vw, 72px)', color: '#fff',
          backgroundColor: '#0C1320',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px),radial-gradient(640px 540px at 8% 92%, rgba(242,99,26,0.16), transparent 62%),radial-gradient(520px 460px at 96% 4%, rgba(74,108,170,0.16), transparent 60%)',
          backgroundSize: '80px 80px, 80px 80px, 100% 100%, 100% 100%',
          animation: 'loginPanelIn 0.7s ease both',
        }}>
        {/* watermark monogram */}
        <div style={{ position: 'absolute', right: -60, bottom: -90, fontFamily: "'Newsreader', serif", fontSize: 460, lineHeight: 1, fontWeight: 400, color: 'rgba(255,255,255,0.018)', zIndex: 1, userSelect: 'none' }}>J</div>

        {/* logo */}
        <div className="login-anim" style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 2, animationDelay: '0.12s' }}>
          <div className="logo-shine" style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(150deg,#FF7A33,#EA5310)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 23, color: '#fff', boxShadow: '0 10px 24px -8px rgba(242,99,26,0.65)' }}>J</div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}><span style={{ color: '#fff' }}>jurius</span><span style={{ color: '#8893a8', fontWeight: 500 }}>.com.br</span></div>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', color: '#5e6a82', fontWeight: 600, marginTop: 1 }}>GESTÃO JURÍDICA</div>
          </div>
        </div>

        {/* headline editorial */}
        <div className="login-anim" style={{ position: 'relative', zIndex: 2, maxWidth: 580, animationDelay: '0.26s' }}>
          <div style={{ width: 34, height: 2, background: '#F2631A', marginBottom: 'clamp(20px, 3vw, 34px)', opacity: 0.9 }} />
          <h1 style={{ fontFamily: "'Newsreader', serif", fontWeight: 400, fontSize: 'clamp(30px, 3.3vw, 52px)', lineHeight: 1.08, letterSpacing: '-0.015em', color: '#F5F2EB' }}>
            Gestão jurídica conduzida com <span style={{ fontStyle: 'italic', color: '#FF9259' }}>precisão</span>.
          </h1>
          <p style={{ fontSize: 'clamp(13px, 1.05vw, 16px)', lineHeight: 1.65, color: '#97a1b4', fontWeight: 400, marginTop: 'clamp(16px, 2vw, 26px)', maxWidth: 460 }}>
            Processos, prazos e documentos do escritório reunidos em um só ambiente — com a segurança e o rigor que a advocacia exige.
          </p>

          {/* módulos do sistema — vitrine viva (chips suspensos, parallax + flutuação) */}
          <div style={{ marginTop: 'clamp(26px, 3.4vw, 44px)', position: 'relative' }}>
            <span style={{ fontSize: 10, letterSpacing: '0.22em', color: '#5e6a82', fontWeight: 700, textTransform: 'uppercase' }}>
              Tudo o que o escritório precisa
            </span>

            {/* brilho ambiente que "respira" por trás dos chips → profundidade e ar */}
            <div aria-hidden="true" className="chip-breathe"
              style={{
                position: 'absolute', left: -28, right: 60, top: 40, bottom: -24, zIndex: 0,
                pointerEvents: 'none', filter: 'blur(28px)',
                background: 'radial-gradient(420px 200px at 28% 55%, rgba(242,99,26,0.11), transparent 70%)',
              }} />

            <div ref={chipGridRef} className="chip-grid"
              style={{ position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 16, maxWidth: 540 }}>
              {MODULES.map(({ icon: Icon, label }, i) => (
                <span key={label} className="chip-float" style={chipMotion(i)}>
                  <span className="chip-drift">
                    <span className="chip">
                      <Icon size={12.5} strokeWidth={1.75} className="chip-ico" />
                      {label}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* footer meta — estado real da conexão com o backend (Supabase) */}
        <div className="login-anim" style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)', animationDelay: '0.4s' }}>
          <span style={{ fontSize: 13, color: '#6e7a92', fontWeight: 500, letterSpacing: '0.01em' }}>jurius.com.br</span>
          <span
            title={svc === 'online'
              ? `Servidor Supabase · ${supabaseRegion} (${supabaseRegionCode})${latency != null ? ` · ${latency} ms` : ''}`
              : svc === 'offline' ? `Sem conexão com o servidor (${supabaseRegion})` : `Conectando ao servidor (${supabaseRegion})…`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#8a94a8', fontWeight: 500 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: svc === 'online' ? '#3ec47a' : svc === 'offline' ? '#ef4444' : '#f5a623', boxShadow: svc === 'online' ? '0 0 0 3px rgba(62,196,122,0.18)' : 'none' }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#5e6a82' }}>Servidor</span>
            <span style={{ color: '#aeb6c4' }}>{supabaseRegion}</span>
            {svc === 'online' && latency != null && <span style={{ color: '#5e6a82' }}>· {latency} ms</span>}
            {svc === 'offline' && <span style={{ color: '#c2603f' }}>· offline</span>}
            {svc === 'checking' && <span style={{ color: '#5e6a82' }}>· …</span>}
          </span>
        </div>
      </aside>

      {/* ── PAINEL DO FORMULÁRIO ── */}
      <main className="min-h-screen md:h-auto" style={{ position: 'relative', flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(28px, 4vw, 56px) clamp(18px, 3vw, 44px)' }}>

        {/* backdrop decorativo — SÓ mobile (no desktop o painel de marca já cumpre esse papel).
            Eco da identidade: brilho âmbar no topo + grade tênue, para o formulário não
            flutuar num branco estéril. */}
        <div aria-hidden="true" className="md:hidden" style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          backgroundImage:
            'radial-gradient(300px 300px at 6% -2%, rgba(255,102,0,0.06), transparent 70%),' +
            'radial-gradient(320px 320px at 102% 104%, rgba(80,95,118,0.07), transparent 70%),' +
            'linear-gradient(rgba(148,163,184,0.13) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(148,163,184,0.13) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 100% 100%, 40px 40px, 40px 40px',
        }} />

        <div id="login-card" tabIndex={-1}
          className="login-anim relative z-10 w-full bg-white md:bg-transparent border border-slate-200 md:border-0 rounded-xl md:rounded-none overflow-hidden md:overflow-visible p-7 sm:p-8 md:p-0 shadow-[0_10px_30px_-6px_rgba(15,23,42,0.10)] md:shadow-none"
          style={{ maxWidth: 408, animationDelay: '0.34s' }}>

          {/* acento de marca no topo do cartão — só mobile */}
          <div aria-hidden="true" className="md:hidden absolute inset-x-0 top-0 h-1"
            style={{ background: 'linear-gradient(90deg,#F2631A,#FF9259)' }} />

          {/* logo no mobile (painel de marca fica oculto) — alinhado à esquerda,
              em coluna editorial coerente com o restante do formulário */}
          <div className="md:hidden mb-6 flex border-b border-slate-100 pb-5"><Logo /></div>

          {/* aviso de sessão encerrada por segurança (inatividade / tempo máximo) */}
          {sessionEnded && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-[12.5px] leading-snug text-amber-800">
                Sua sessão foi encerrada por segurança (inatividade ou tempo máximo de acesso).
                Entre novamente para continuar.
              </p>
            </div>
          )}

          {/* Sem moldura: o formulário vive direto sobre o painel claro (estilo editorial/premium) */}
          <div className="relative">

            {/* Tabs — segmented control; só aparece quando o login do cliente está ativo */}
            {portalEnabled !== false && (
            <div className="mb-6">
              <div className="flex gap-1 rounded-lg bg-slate-100/80 p-1 ring-1 ring-slate-200/70">
                <button type="button" onClick={() => switchMode('client')}
                  className={`flex-1 py-2.5 rounded-md text-[13px] font-semibold tracking-wide transition-all ${
                    mode === 'client'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  Portal do Cliente
                </button>
                <button type="button" onClick={() => switchMode('staff')}
                  className={`flex-1 py-2.5 rounded-md text-[13px] font-semibold tracking-wide transition-all flex items-center justify-center gap-1.5 ${
                    mode === 'staff'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  <Lock className="h-3.5 w-3.5" /> Área Restrita
                </button>
              </div>
            </div>
            )}

            {/* ═══ CLIENT PORTAL ═══ */}
            {mode === 'client' && (
              <div className="space-y-5">
                <div className="flex gap-1.5">
                  <div className="h-1 flex-1 rounded-full bg-orange-500" />
                  <div className={`h-1 flex-1 rounded-full transition-colors ${clientStep === 'pin' ? 'bg-orange-500' : 'bg-slate-200'}`} />
                </div>

                {clientStep === 'cpf' && (
                  <form onSubmit={handleClientContinue} className="space-y-4">
                    <div>
                      <span className="inline-block px-2 py-0.5 bg-orange-50 rounded text-[10px] font-bold text-orange-600 tracking-widest uppercase">Passo 1 de 2</span>
                      <h2 className="text-xl font-bold text-slate-900 mt-2 tracking-tight">Qual é o seu CPF?</h2>
                      <p className="text-[13px] text-slate-500 mt-1">Informe seus dados para acessar o painel.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Documento de Identidade</label>
                        <input ref={cpfRef} type="text" value={formatCPF(cpf)}
                          onChange={(e) => { setCpf(e.target.value); setClientError(null); }}
                          placeholder="000.000.000-00" autoComplete="username" inputMode="numeric" disabled={clientLoading}
                          className="w-full px-4 py-3.5 bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-orange-500/15 focus:border-orange-400 outline-none transition-all text-base font-semibold text-slate-900 placeholder:text-slate-400"
                        />
                      </div>
                      {clientError && <ErrorMsg msg={clientError} />}
                      <button type="submit" disabled={clientLoading || !cpfOk}
                        className="w-full text-white py-3.5 rounded-lg font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50"
                        style={{ background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}>
                        {clientLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Verificando...</> : <><span>Continuar</span><ArrowRight className="h-5 w-5" /></>}
                      </button>
                    </div>
                    <p className="text-center text-[12px] text-slate-400">Dúvidas? Entre em contato com seu advogado.</p>
                  </form>
                )}

                {clientStep === 'pin' && (
                  <form onSubmit={handleClientLogin} className="space-y-4">
                    <div>
                      <button type="button" onClick={goBackClient}
                        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-900 transition mb-1">
                        <ArrowLeft className="h-3.5 w-3.5" /> Voltar
                      </button>
                      <span className="block px-2 py-0.5 bg-orange-50 rounded text-[10px] font-bold text-orange-600 tracking-widest uppercase w-fit">Passo 2 de 2</span>
                      <h2 className="text-xl font-bold text-slate-900 mt-2 tracking-tight">Confirme seu acesso</h2>
                    </div>
                    {phoneHint && (
                      <div className="flex items-center gap-3 rounded-lg bg-orange-50/60 px-3.5 py-3 border border-orange-100">
                        <span className="text-lg">📱</span>
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
                            className={`h-14 w-full rounded-lg border-2 text-center text-xl font-bold outline-none transition
                              ${d ? 'border-orange-400 bg-orange-50/50 text-slate-900' : 'border-slate-200 bg-white text-slate-900'}
                              focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15 disabled:opacity-50`}
                          />
                        ))}
                      </div>
                    </div>
                    {clientError && <ErrorMsg msg={clientError} />}
                    <button type="submit" disabled={clientLoading || !pinOk}
                      className="w-full text-white py-3.5 rounded-lg font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50"
                      style={{ background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}>
                      {clientLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Entrando...</> : 'Entrar na minha área'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* ═══ ÁREA RESTRITA ═══ */}
            {mode === 'staff' && (
              <div className="relative space-y-5">
                {identifierLoading && (
                  <div className="flex flex-col items-center justify-center py-10"
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

                {!identifierLoading && staffStep === 'identifier' && (
                  <form onSubmit={handleIdentifierSubmit} className="space-y-6">
                    <div>
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 ring-1 ring-slate-200/70 shadow-inner">
                        <Shield className="h-[22px] w-[22px] text-slate-500" strokeWidth={1.75} />
                      </div>
                      <h2 className="text-[22px] font-bold text-slate-900 tracking-tight leading-none">Área Restrita</h2>
                      <p className="text-[13px] text-slate-500 mt-2">Acesso exclusivo para colaboradores do escritório</p>
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
                        className="w-full px-4 py-3.5 bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-orange-500/15 focus:border-orange-400 outline-none transition-all text-base font-medium text-slate-900 placeholder:text-slate-400"
                      />
                    </div>
                    {staffBanned && <BannedMsg />}
                    {staffError && !staffBanned && <ErrorMsg msg={staffError} />}
                    <button type="submit" disabled={identifierLoading || !identifier.trim()}
                      className="w-full text-white py-3.5 rounded-lg font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50"
                      style={{ background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}>
                      {identifierLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Buscando...</> : <><span>Continuar</span><ArrowRight className="h-5 w-5" /></>}
                    </button>
                  </form>
                )}

                {/* ═══ CONTA LEMBRADA (estilo Facebook: foto + nome + cargo) ═══ */}
                {!identifierLoading && staffStep === 'account' && (
                  <div style={{ animation: 'staffProfileIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }} className="space-y-4">
                    <style>{`@keyframes staffProfileIn { from{opacity:0;transform:translateY(18px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }`}</style>
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight">Bem-vindo de volta</h2>
                      <p className="text-[13px] text-slate-500 mt-1">
                        {accounts.length > 1 ? 'Escolha uma conta para continuar' : 'Continue com sua conta para acessar o sistema'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {accounts.map((acc) => (
                        <div key={acc.email} className="group relative">
                          <button type="button" onClick={() => pickAccount(acc)}
                            className="w-full flex items-center gap-3.5 rounded-lg border border-slate-200 bg-white p-3 pr-10 text-left transition hover:border-orange-300 hover:bg-orange-50/40">
                            <Avatar url={acc.avatar} name={acc.name} email={acc.email} size={48} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[15px] font-bold text-slate-900 leading-tight">{acc.name || acc.email}</p>
                              {acc.role && <p className="truncate text-[12px] font-semibold text-orange-600 mt-0.5">{acc.role}</p>}
                              <p className="truncate text-[12px] text-slate-400 mt-0.5">{acc.email}</p>
                            </div>
                            <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:text-orange-500" />
                          </button>
                          <button type="button" onClick={() => removeAccount(acc.email)} title="Esquecer este acesso"
                            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={switchStaffAccount}
                      className="w-full rounded-lg border border-slate-200 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50">
                      Acessar outra conta
                    </button>
                  </div>
                )}

                {/* ═══ CONSENTIMENTO: salvar acesso rápido? (após 1º login) ═══ */}
                {askSaveQuick && (
                  <div style={{ animation: 'staffProfileIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }} className="space-y-5">
                    <style>{`@keyframes staffProfileIn { from{opacity:0;transform:translateY(18px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }`}</style>
                    <div className="flex flex-col items-center gap-3 py-1 text-center">
                      {profileAvatar && !avatarError ? (
                        <img src={profileAvatar} alt={profileName || ''} onError={() => setAvatarError(true)}
                          className="h-16 w-16 rounded-full object-cover"
                          style={{ outline: '2px solid #fff', boxShadow: '0 0 0 2px #ff6b00' }} />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-black text-white"
                          style={{ background: 'linear-gradient(135deg,#ff6b00,#a04100)', outline: '2px solid #fff', boxShadow: '0 0 0 2px #ff6b00' }}>
                          {avatarInitial}
                        </div>
                      )}
                      <div>
                        <h2 className="text-[19px] font-bold text-slate-900 tracking-tight">Salvar acesso rápido?</h2>
                        <p className="text-[13px] text-slate-500 mt-1.5 leading-snug">
                          Da próxima vez, {(profileName || '').trim().split(' ')[0] || 'você'} entra neste dispositivo
                          só com a senha — sem digitar o CPF ou e-mail.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-[12px] leading-snug text-slate-500">
                      <Lock className="h-4 w-4 shrink-0 text-slate-400 mt-px" />
                      <span>Guardamos apenas seu <strong className="font-semibold text-slate-600">nome, foto e e-mail</strong> neste navegador. Sua senha nunca é salva.</span>
                    </div>
                    <div className="space-y-2.5">
                      <button type="button" onClick={confirmSaveQuick}
                        className="w-full text-white py-3.5 rounded-lg font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2"
                        style={{ background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}>
                        <CheckCircle className="h-5 w-5" /> Salvar e continuar
                      </button>
                      <button type="button" onClick={declineSaveQuick}
                        className="w-full rounded-lg border border-slate-200 py-3 text-[14px] font-semibold text-slate-600 transition hover:bg-slate-50">
                        Agora não
                      </button>
                    </div>
                  </div>
                )}

                {!identifierLoading && !askSaveQuick && staffStep === 'password' && (
                  <form onSubmit={handleStaffLogin}
                    style={{ animation: 'staffProfileIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }}
                    className="space-y-5">
                    <style>{`
                      @keyframes staffProfileIn { from{opacity:0;transform:translateY(18px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
                      @keyframes avatarPop { 0%{transform:scale(0.6);opacity:0} 70%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
                      @keyframes ringPulse { 0%,100%{box-shadow:0 0 0 0px rgba(249,115,22,0.4)} 50%{box-shadow:0 0 0 6px rgba(249,115,22,0)} }
                    `}</style>
                    <button type="button" onClick={accounts.length ? () => setStaffStep('account') : goBackStaff}
                      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900 transition">
                      <ArrowLeft className="h-3.5 w-3.5" /> Voltar
                    </button>
                    <div className="flex flex-col items-center gap-3 py-2">
                      <div style={{ animation: 'avatarPop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s both' }}>
                        {profileAvatar && !avatarError ? (
                          <img src={profileAvatar} alt={profileName || ''}
                            onError={() => setAvatarError(true)}
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
                          <Shield className="h-3 w-3" /> {profileRole || 'Colaborador'}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5" style={{ animation: 'staffProfileIn 0.4s ease 0.3s both' }}>
                      <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Senha</label>
                      <div className="relative">
                        <input ref={pwRef} type={showPw ? 'text' : 'password'} value={staffPw}
                          onChange={(e) => { setStaffPw(e.target.value); setStaffError(null); setStaffBanned(false); }}
                          onKeyDown={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                          onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                          onBlur={() => setCapsOn(false)}
                          placeholder="••••••••" autoComplete="current-password" disabled={staffLoading}
                          className="w-full px-4 py-3.5 bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-orange-500/15 focus:border-orange-400 outline-none transition-all pr-12 text-base font-medium text-slate-900"
                        />
                        <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                          {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                      {capsOn && (
                        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-600">
                          <AlertCircle className="h-3.5 w-3.5" /> Caps Lock está ativado
                        </p>
                      )}
                    </div>
                    {staffBanned && <BannedMsg />}
                    {staffError && !staffBanned && <ErrorMsg msg={staffError} />}
                    <button type="submit" disabled={staffLoading || !staffPw}
                      style={{ animation: 'staffProfileIn 0.4s ease 0.4s both', background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}
                      className="w-full text-white py-3.5 rounded-lg font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50">
                      {staffLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Autenticando...</> : <><Shield className="h-5 w-5" /> Acessar Sistema</>}
                    </button>
                  </form>
                )}
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

