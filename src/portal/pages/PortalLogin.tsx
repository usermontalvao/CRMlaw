import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, ArrowLeft, ArrowRight,
  Eye, EyeOff, Lock, Shield, Ban, ChevronRight, CheckCircle, X,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { supabase } from '../../config/supabase';
import { BrandLogo } from '../../components/ui';
import { BRAND_SERIF } from '../../constants/brand';

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

// Destaques rotativos exibidos sob o mockup do produto (painel de marca).
const SHOWCASE: { title: string; text: string; url: string; module: string }[] = [
  {
    url: 'jurius.com.br/agenda',
    module: 'Prazos & Andamentos',
    title: 'Prazos sob controle',
    text: 'Vencimentos, audiências e andamentos em um só painel — com alertas automáticos antes de cada prazo fatal.',
  },
  {
    url: 'jurius.com.br/clientes',
    module: 'Clientes',
    title: 'Carteira de clientes organizada',
    text: 'Histórico completo, documentos e processos vinculados a cada cliente, com busca e filtros instantâneos.',
  },
  {
    url: 'jurius.com.br/processos',
    module: 'Processos',
    title: 'Processos com andamentos em tempo real',
    text: 'Acompanhe cada processo, movimentação e prazo em um painel intuitivo, sempre conectado ao cliente.',
  },
  {
    url: 'jurius.com.br/peticoes',
    module: 'Petições & Req. INSS',
    title: 'Do requerimento à assinatura',
    text: 'Petições, requerimentos do INSS e assinaturas com validade jurídica, tudo sem sair do sistema.',
  },
  {
    url: 'jurius.com.br/documentos',
    module: 'Cloud & Documentos',
    title: 'Arquivos seguros na nuvem',
    text: 'Documentos organizados por cliente e processo, com acesso de qualquer lugar e controle de versões.',
  },
  {
    url: 'jurius.com.br/assinaturas',
    module: 'Assinaturas Digitais',
    title: 'Assine com validade jurídica',
    text: 'Contratos e termos assinados digitalmente com certificação ICP-Brasil, enviados e monitorados direto pelo sistema.',
  },
  {
    url: 'jurius.com.br/financeiro',
    module: 'Financeiro',
    title: 'Gestão financeira integrada',
    text: 'Honorários, recebimentos e despesas em um único painel — com relatórios por cliente ou processo.',
  },
];

// ── Tipos compartilhados ──────────────────────────────────────────────────────

type SvcStatus = 'checking' | 'online' | 'offline';

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

  // Mobile usa um layout dedicado (tela cheia) para o fluxo da Área Restrita.
  // Via matchMedia (não só CSS) para montar apenas uma árvore — assim os refs de
  // foco (identRef/pwRef) apontam para o input ativo, sem conflito desktop/mobile.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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

  // ── Estado da conexão com o backend (mede latência via RPC leve)
  const [svc,     setSvc]     = useState<SvcStatus>('checking');
  const [latency, setLatency] = useState<number | null>(null);

  // ── Carrossel de destaques do produto (painel de marca)
  const [showcase, setShowcase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setShowcase((s) => (s + 1) % SHOWCASE.length), 5200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = async () => {
      const t0 = performance.now();
      try {
        const { error } = await supabase.rpc('portal_public_stats');
        const ms = Math.round(performance.now() - t0);
        if (!error) { setSvc('online'); setLatency(ms); }
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

  // ── Layout dedicado MOBILE para a Área Restrita (mockup Manrope) ─────────────
  // Reutiliza exatamente o mesmo estado/handlers/refs do fluxo desktop; só muda a
  // apresentação. A transição "procurar conta" (identifierLoading + passo account)
  // é preservada.
  if (isMobile && mode === 'staff') {
    const fontStack = "'Manrope', system-ui, sans-serif";

    const Brand = <BrandLogo variant="light" size="md" divider={false} />;

    const Footer = (
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, paddingTop: 28 }}>
        {portalEnabled !== false && (
          <button type="button" onClick={() => switchMode('client')} className="jlink"
            style={{ fontSize: 13, fontWeight: 700, color: '#EC5614', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 4 }}>
            Sou cliente do escritório
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#A8A399' }}>
          <Lock className="h-3 w-3" strokeWidth={1.6} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Conexão segura e criptografada</span>
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 500, color: '#C2BDB3' }}>© {new Date().getFullYear()} Jurius</div>
      </div>
    );

    const inputStyle: React.CSSProperties = { width: '100%', height: 58, boxSizing: 'border-box', border: '1.5px solid #E8E2D8', borderRadius: 15, background: '#FFFFFF', padding: '0 18px', fontFamily: fontStack, fontSize: 15, fontWeight: 600, color: '#1C1A17', outline: 'none' };
    const primaryBtnStyle: React.CSSProperties = { marginTop: 18, width: '100%', height: 58, border: 'none', borderRadius: 15, background: 'linear-gradient(140deg,#F89A2B,#EC5614)', color: '#fff', fontFamily: fontStack, fontSize: 16, fontWeight: 700, letterSpacing: '.2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', boxShadow: '0 14px 28px -10px rgba(236,86,20,.6)' };

    return (
      <div className="staff-mobile" style={{ minHeight: '100vh', background: '#FBFAF7', fontFamily: fontStack, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <style>{`
          .staff-mobile .jfield::placeholder { color:#B7B2A8; font-weight:500; }
          .staff-mobile .jfield:focus { border-color:#EC5614 !important; box-shadow:0 0 0 4px rgba(236,86,20,.13); }
          .staff-mobile .jlink { transition:opacity .15s ease; }
          .staff-mobile .jlink:hover { opacity:.7; }
          .staff-mobile .jbtn { transition:transform .15s ease, filter .15s ease; }
          .staff-mobile .jbtn:hover { filter:brightness(1.05); transform:translateY(-1px); }
          .staff-mobile .jbtn:disabled { opacity:.5; cursor:not-allowed; filter:none; transform:none; }
          @keyframes smIn { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
          @keyframes smScan { 0%{top:0%;opacity:1} 80%{top:100%;opacity:1} 100%{top:100%;opacity:0} }
          @keyframes smRing { 0%{transform:scale(.8);opacity:.6} 100%{transform:scale(2.2);opacity:0} }
          @keyframes smDot { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-8px);opacity:1} }
          .staff-mobile .sm-step { animation: smIn .4s cubic-bezier(.22,.61,.36,1) both; }
        `}</style>

        {/* barra superior + brilhos */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: 'linear-gradient(90deg,#F89A2B,#EE5A18)', zIndex: 3 }} />
        <div style={{ position: 'absolute', top: -130, right: -90, width: 380, height: 380, background: 'radial-gradient(circle, rgba(242,106,33,.18), rgba(242,106,33,0) 68%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -160, left: -120, width: 360, height: 360, background: 'radial-gradient(circle, rgba(242,106,33,.07), rgba(242,106,33,0) 70%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', padding: '24px 30px 30px', width: '100%', maxWidth: 460, margin: '0 auto' }}>
          {/* header: voltar + logo lado a lado */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {!identifierLoading && !askSaveQuick && staffStep === 'password' && (
              <button type="button" onClick={accounts.length ? () => setStaffStep('account') : goBackStaff}
                className="jlink" aria-label="Voltar"
                style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 13, background: '#FFFFFF', border: '1px solid #ECE6DC', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px -6px rgba(70,45,20,.2)', cursor: 'pointer' }}>
                <ArrowLeft className="h-4 w-4" style={{ color: '#3A352E' }} strokeWidth={2} />
              </button>
            )}
            {Brand}
          </div>

          {sessionEnded && (
            <div className="sm-step" style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 14, border: '1px solid #FCD9B6', background: '#FFF6EC', padding: '12px 14px' }}>
              <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#C2603F', marginTop: 1 }} />
              <p style={{ fontSize: 12.5, lineHeight: 1.4, color: '#9A5A3A' }}>Sua sessão foi encerrada por segurança. Entre novamente para continuar.</p>
            </div>
          )}

          {/* ── procurar conta (transição preservada) ── */}
          {identifierLoading && (
            <div className="sm-step" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 26 }}>
                <div style={{ position: 'absolute', height: 64, width: 64, borderRadius: '50%', background: '#FDE7D3', animation: 'smRing 1.6s ease-out infinite' }} />
                <div style={{ position: 'absolute', height: 64, width: 64, borderRadius: '50%', background: '#FDE7D3', animation: 'smRing 1.6s ease-out .5s infinite' }} />
                <div style={{ position: 'relative', height: 64, width: 64, borderRadius: 19, background: 'linear-gradient(140deg,#2A2017,#171210)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 12px 28px -10px rgba(70,45,20,.5)' }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,transparent,#F89A2B,transparent)', animation: 'smScan 2s ease-in-out infinite' }} />
                  <Shield className="h-7 w-7" style={{ color: '#F89A2B' }} />
                </div>
              </div>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#2A241D' }}>Procurando sua conta…</p>
              <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                {[0, 0.2, 0.4].map((d, i) => (
                  <div key={i} style={{ height: 6, width: 6, borderRadius: '50%', background: '#EC5614', animation: `smDot 1.2s ease ${d}s infinite` }} />
                ))}
              </div>
            </div>
          )}

          {/* ── passo 1: identificação ── */}
          {!identifierLoading && !askSaveQuick && staffStep === 'identifier' && (
            <form onSubmit={handleIdentifierSubmit} className="sm-step" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ marginTop: 58 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: '#EC5614', marginBottom: 14 }}>ACESSO DO COLABORADOR</div>
                <h1 style={{ margin: 0, fontSize: 31, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-.7px', color: '#1C1A17' }}>Bem-vindo<br />de volta</h1>
                <p style={{ margin: '12px 0 0', fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: '#847F76' }}>Entre para acessar o painel jurídico do seu escritório.</p>
              </div>

              <div style={{ marginTop: 36 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#3A352E', marginBottom: 9 }}>CPF ou e-mail</label>
                <input ref={identRef} className="jfield" type="text" value={identifier} disabled={identifierLoading}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const isNumeric = /^[\d.\-]*$/.test(raw) && !raw.includes('@');
                    setIdentifier(isNumeric ? formatCpfRaw(raw.replace(/\D/g, '').slice(0, 11)) : raw);
                    setStaffError(null); setStaffBanned(false);
                  }}
                  inputMode="text" autoComplete="username" placeholder="" style={inputStyle} />

                {staffBanned && <div style={{ marginTop: 16 }}><BannedMsg /></div>}
                {staffError && !staffBanned && <div style={{ marginTop: 16 }}><ErrorMsg msg={staffError} /></div>}

                <button type="submit" className="jbtn" disabled={!identifier.trim()} style={primaryBtnStyle}>
                  Continuar
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              {Footer}
            </form>
          )}

          {/* ── procurar conta: contas salvas (transição preservada) ── */}
          {!identifierLoading && !askSaveQuick && staffStep === 'account' && (
            <div className="sm-step" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ marginTop: 50 }}>
                <h1 style={{ margin: 0, fontSize: 27, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-.6px', color: '#1C1A17' }}>Bem-vindo de volta</h1>
                <p style={{ margin: '11px 0 0', fontSize: 14.5, fontWeight: 500, color: '#847F76' }}>
                  {accounts.length > 1 ? 'Escolha uma conta para continuar.' : 'Continue com sua conta para acessar o sistema.'}
                </p>
              </div>
              <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {accounts.map((acc) => (
                  <div key={acc.email} style={{ position: 'relative' }}>
                    <button type="button" onClick={() => pickAccount(acc)} className="jlink"
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, borderRadius: 16, border: '1px solid #ECE6DC', background: '#FFFFFF', padding: '12px 42px 12px 13px', textAlign: 'left', cursor: 'pointer', boxShadow: '0 4px 14px -10px rgba(70,45,20,.18)' }}>
                      <Avatar url={acc.avatar} name={acc.name} email={acc.email} size={46} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1C1A17', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.name || acc.email}</p>
                        {acc.role && <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#EC5614' }}>{acc.role}</p>}
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#A8A399', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.email}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0" style={{ color: '#D8CFC0' }} />
                    </button>
                    <button type="button" onClick={() => removeAccount(acc.email)} title="Esquecer este acesso" className="jlink"
                      style={{ position: 'absolute', right: 10, top: 10, height: 24, width: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: '#C2BDB3', cursor: 'pointer' }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={switchStaffAccount} className="jlink"
                style={{ marginTop: 16, width: '100%', borderRadius: 15, border: '1px solid #ECE6DC', background: '#fff', padding: '13px 0', fontSize: 13.5, fontWeight: 700, color: '#6B665E', cursor: 'pointer' }}>
                Acessar outra conta
              </button>
              {Footer}
            </div>
          )}

          {/* ── consentimento: salvar acesso rápido ── */}
          {!identifierLoading && askSaveQuick && (
            <div className="sm-step" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ marginTop: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
                {profileAvatar && !avatarError ? (
                  <img src={profileAvatar} alt={profileName || ''} onError={() => setAvatarError(true)} style={{ height: 70, width: 70, borderRadius: '50%', objectFit: 'cover', outline: '2px solid #fff', boxShadow: '0 0 0 2px #EC5614' }} />
                ) : (
                  <div style={{ height: 70, width: 70, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#F89A2B,#A04100)', outline: '2px solid #fff', boxShadow: '0 0 0 2px #EC5614' }}>{avatarInitial}</div>
                )}
                <div>
                  <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: '-.4px', color: '#1C1A17' }}>Salvar acesso rápido?</h1>
                  <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 500, lineHeight: 1.5, color: '#847F76' }}>Da próxima vez, {(profileName || '').trim().split(' ')[0] || 'você'} entra neste dispositivo só com a senha.</p>
                </div>
              </div>
              <div style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 14, border: '1px solid #ECE6DC', background: '#FFFFFF', padding: '12px 14px' }}>
                <Lock className="h-4 w-4 shrink-0" style={{ color: '#A8A399', marginTop: 1 }} />
                <span style={{ fontSize: 12, lineHeight: 1.45, color: '#847F76' }}>Guardamos apenas seu <strong style={{ color: '#3A352E' }}>nome, foto e e-mail</strong> neste navegador. Sua senha nunca é salva.</span>
              </div>
              <button type="button" onClick={confirmSaveQuick} className="jbtn" style={primaryBtnStyle}>
                <CheckCircle className="h-5 w-5" /> Salvar e continuar
              </button>
              <button type="button" onClick={declineSaveQuick} className="jlink"
                style={{ marginTop: 11, width: '100%', borderRadius: 15, border: '1px solid #ECE6DC', background: '#fff', padding: '13px 0', fontSize: 14, fontWeight: 700, color: '#6B665E', cursor: 'pointer' }}>
                Agora não
              </button>
              {Footer}
            </div>
          )}

          {/* ── passo 2: senha ── */}
          {!identifierLoading && !askSaveQuick && staffStep === 'password' && (
            <form onSubmit={handleStaffLogin} className="sm-step" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              {/* chip de identidade */}
              <div style={{ marginTop: 42, display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', background: '#FFFFFF', border: '1px solid #ECE6DC', borderRadius: 16, boxShadow: '0 4px 14px -8px rgba(70,45,20,.16)' }}>
                <div style={{ flexShrink: 0 }}>
                  {profileAvatar && !avatarError ? (
                    <img src={profileAvatar} alt={profileName || ''} onError={() => setAvatarError(true)} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#FDEEE3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EC5614', fontWeight: 800, fontSize: 14 }}>{avatarInitial}</div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1C1A17', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profileName || staffEmail}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: '#A8A399', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{staffEmail}</div>
                </div>
                <button type="button" onClick={accounts.length ? () => setStaffStep('account') : switchStaffAccount} className="jlink"
                  style={{ fontSize: 13, fontWeight: 700, color: '#EC5614', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer' }}>Trocar</button>
              </div>

              <div style={{ marginTop: 30 }}>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-.6px', color: '#1C1A17' }}>Digite sua senha</h1>
                <p style={{ margin: '11px 0 0', fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: '#847F76' }}>Use a senha do seu acesso corporativo para continuar.</p>
              </div>

              <div style={{ marginTop: 30 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#3A352E', marginBottom: 9 }}>Senha</label>
                <div style={{ position: 'relative' }}>
                  <input ref={pwRef} className="jfield" type={showPw ? 'text' : 'password'} value={staffPw} disabled={staffLoading}
                    onChange={(e) => { setStaffPw(e.target.value); setStaffError(null); setStaffBanned(false); }}
                    onKeyDown={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                    onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                    onBlur={() => setCapsOn(false)}
                    placeholder="Digite sua senha" autoComplete="current-password" style={{ ...inputStyle, letterSpacing: '.5px', paddingRight: 52 }} />
                  <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                    aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'} title={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                    className="jlink"
                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9E988C" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                      {/* risco que "tampa" o olho quando a senha está oculta; anima ao alternar */}
                      <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" stroke="#EC5614"
                        style={{ strokeDasharray: 25, strokeDashoffset: showPw ? 25 : 0, transition: 'stroke-dashoffset .32s ease' }} />
                    </svg>
                  </button>
                </div>

                {capsOn && (
                  <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0 0', fontSize: 12, fontWeight: 600, color: '#C2872B' }}>
                    <AlertCircle className="h-3.5 w-3.5" /> Caps Lock está ativado
                  </p>
                )}
                {staffBanned && <div style={{ marginTop: 14 }}><BannedMsg /></div>}
                {staffError && !staffBanned && <div style={{ marginTop: 14 }}><ErrorMsg msg={staffError} /></div>}

                <button type="submit" className="jbtn" disabled={staffLoading || !staffPw} style={primaryBtnStyle}>
                  {staffLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Entrando…</> : <>Entrar <ArrowRight className="h-4 w-4" /></>}
                </button>
              </div>
              {Footer}
            </form>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#f8f7f5', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }} className="flex-col md:flex-row">

      {/* ── Efeito de abertura: keyframes + barra de carregamento no topo ── */}
      <style>{`
        @keyframes loginFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes loginPanelIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes loginBarSweep { 0% { transform: scaleX(0); } 55% { transform: scaleX(0.7); } 100% { transform: scaleX(1); } }
        @keyframes loginBarFade { to { opacity: 0; } }
        .login-anim { animation: loginFadeUp 0.62s cubic-bezier(0.22,0.61,0.36,1) both; }

        /* ── Vitrine de módulos: entrada em cascata + cards compactos com profundidade ── */
        @keyframes chipIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes chipFloatA { 0%,100% { transform: translate3d(0,0,0) rotate(0deg); } 50% { transform: translate3d(0,-6px,0) rotate(-0.4deg); } }
        @keyframes chipFloatB { 0%,100% { transform: translate3d(0,0,0); } 34% { transform: translate3d(3px,-4px,0); } 67% { transform: translate3d(-2px,-7px,0); } }
        @keyframes chipFloatC { 0%,100% { transform: translate3d(0,0,0) rotate(0deg); } 50% { transform: translate3d(-4px,-5px,0) rotate(0.5deg); } }
        @keyframes chipBreathe { 0%,100% { opacity: 0.32; transform: scale(1); } 50% { opacity: 0.55; transform: scale(1.07); } }

        .chip-grid { position: relative; transition: transform 0.55s cubic-bezier(0.22,0.61,0.36,1); will-change: transform; }
        .chip-float {
          display: block; opacity: 0; will-change: transform, opacity;
          animation: chipIn 0.6s cubic-bezier(0.22,0.61,0.36,1) var(--chip-in,0s) both;
        }
        /* showcase do produto — moldura de navegador + gráfico + tabela + carrossel */
        .show-browser {
          width: 100%; border-radius: 14px; overflow: hidden; background: #fff;
          border: 1px solid rgba(0,0,0,0.06);
          box-shadow: 0 44px 88px -34px rgba(0,0,0,0.72), 0 10px 26px -14px rgba(0,0,0,0.5);
        }
        .show-bar { display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; background: #f1ede6; border-bottom: 1px solid rgba(0,0,0,0.05); }
        .show-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .show-url { margin-left: 10px; flex: 1; max-width: 280px; height: 20px; border-radius: 6px; background: #e5e0d7; color: #8a8177; font-size: 10.5px; font-weight: 500; display: flex; align-items: center; padding: 0 10px; }
        .show-screen { padding: 16px; background: #faf8f5; }
        .show-appbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .show-apptitle { font-size: 14px; font-weight: 700; color: #2a2320; letter-spacing: -0.01em; }
        .show-live { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #c56a1a; }
        .show-livedot { width: 6px; height: 6px; border-radius: 50%; background: #ea6a1e; box-shadow: 0 0 0 3px rgba(234,106,30,0.16); }
        .show-card { background: #fff; border: 1px solid #efeae2; border-radius: 12px; padding: 14px; }
        .show-cardhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .show-cardtitle { font-size: 12px; font-weight: 700; color: #3a332c; }
        .show-chip { font-size: 10px; font-weight: 700; color: #9a8f82; background: #f3efe8; border-radius: 5px; padding: 2px 7px; }
        .show-line { stroke-dasharray: 1100; animation: showDraw 1.6s cubic-bezier(0.22,0.61,0.36,1) 0.45s both; }
        @keyframes showDraw { from { stroke-dashoffset: 1100; } to { stroke-dashoffset: 0; } }
        .show-tip { position: absolute; top: 18px; right: 16px; background: #fff; border: 1px solid #ececec; border-radius: 9px; padding: 8px 11px; box-shadow: 0 14px 28px -12px rgba(0,0,0,0.28); display: flex; flex-direction: column; gap: 2px; }
        .show-tiplabel { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #a49a8d; }
        .show-tipval { font-size: 11.5px; font-weight: 600; color: #2a2320; }
        .show-tipval strong { color: #d1521a; }
        .show-row { display: grid; grid-template-columns: 0.9fr 1.2fr 0.7fr; gap: 10px; align-items: center; padding: 9px 14px; font-size: 11.5px; border-top: 1px solid #f2ede6; }
        .show-rowhead { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: #a49a8d; border-top: none; padding-top: 11px; padding-bottom: 7px; }
        .show-fade { animation: showFade 0.55s cubic-bezier(0.22,0.61,0.36,1) both; }
        @keyframes showFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .show-dotbtn { width: 22px; height: 4px; border-radius: 999px; border: none; cursor: pointer; padding: 0; background: rgba(255,255,255,0.22); transition: background 0.35s ease, width 0.35s ease; }
        .show-dotbtn[data-on="true"] { width: 34px; background: linear-gradient(90deg, #f59e0b, #ea6a1e); }

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
          flexDirection: 'column', justifyContent: 'flex-start', padding: 'clamp(36px, 4.5vw, 72px)', color: '#f4ede2',
          backgroundColor: '#1e1811',
          backgroundImage: 'radial-gradient(900px 640px at 84% 8%, rgba(244,150,60,0.18), transparent 60%),radial-gradient(760px 640px at -4% 106%, rgba(242,122,35,0.10), transparent 62%),linear-gradient(158deg, #29221b 0%, #1d1710 55%, #140f0a 100%)',
          backgroundSize: '100% 100%, 100% 100%, 100% 100%',
          animation: 'loginPanelIn 0.7s ease both',
        }}>
        {/* textura de papel — grão sutil em multiply para dar corpo ao marfim */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.05,
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
        }} />
        {/* vinheta — aprofunda as bordas para o mockup ganhar destaque no centro */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 55% 42%, transparent 52%, rgba(0,0,0,0.4) 100%)',
        }} />

        {/* logo */}
        <div className="login-anim" style={{ position: 'relative', zIndex: 2, animationDelay: '0.12s' }}>
          <BrandLogo variant="reversed" size="md" divider={false} shine />
        </div>

        {/* showcase do produto — mockup em moldura de navegador + carrossel */}
        <div className="login-anim" style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 620, marginTop: 'clamp(20px, 3vh, 40px)', animationDelay: '0.26s' }}>

          {/* moldura de navegador */}
          <div className="show-browser">
            <div className="show-bar">
              <span className="show-dot" style={{ background: '#ef6a5f' }} />
              <span className="show-dot" style={{ background: '#f5bd4f' }} />
              <span className="show-dot" style={{ background: '#58c66a' }} />
              <div className="show-url">{SHOWCASE[showcase].url}</div>
            </div>

            <div key={showcase} className="show-screen show-fade">
              <div className="show-appbar">
                <span className="show-apptitle">{SHOWCASE[showcase].module}</span>
                <span className="show-live"><span className="show-livedot" /> ao vivo</span>
              </div>

              {/* ── Slide 0: Prazos & Andamentos ── */}
              {showcase === 0 && (<>
                <div className="show-card" style={{ position: 'relative' }}>
                  <div className="show-cardhead">
                    <span className="show-cardtitle">Prazos por mês</span>
                    <span className="show-chip">2025</span>
                  </div>
                  <svg viewBox="0 0 520 176" preserveAspectRatio="none" style={{ width: '100%', height: 120, display: 'block' }}>
                    <defs>
                      <linearGradient id="showArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.34" />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[44, 88, 132].map((y) => (
                      <line key={y} x1="0" y1={y} x2="520" y2={y} stroke="#efeae2" strokeWidth="1" />
                    ))}
                    <path d="M0,132 L52,120 L104,128 L156,96 L208,104 L260,74 L312,86 L364,58 L416,66 L468,40 L520,52 L520,176 L0,176 Z" fill="url(#showArea)" />
                    <path className="show-line" d="M0,132 L52,120 L104,128 L156,96 L208,104 L260,74 L312,86 L364,58 L416,66 L468,40 L520,52" fill="none" stroke="#ea6a1e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="364" cy="58" r="4.5" fill="#fff" stroke="#ea6a1e" strokeWidth="2.5" />
                  </svg>
                  <div className="show-tip">
                    <span className="show-tiplabel">Setembro</span>
                    <span className="show-tipval">28 prazos · <strong>4 fatais</strong></span>
                  </div>
                </div>
                <div className="show-card" style={{ marginTop: 10, padding: 0, overflow: 'hidden' }}>
                  <div className="show-row show-rowhead"><span>Processo</span><span>Cliente</span><span style={{ textAlign: 'right' }}>Vence</span></div>
                  {[
                    { p: '1002345-67', c: 'Maria Oliveira', d: 'em 2 dias', warn: true },
                    { p: '0456123-70', c: 'Construtora Ápice', d: 'em 5 dias', warn: false },
                    { p: '2231908-18', c: 'João P. Santos', d: 'em 8 dias', warn: false },
                  ].map((r) => (
                    <div key={r.p} className="show-row">
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#5a534c' }}>{r.p}</span>
                      <span style={{ color: '#2a2320', fontWeight: 600 }}>{r.c}</span>
                      <span style={{ textAlign: 'right', fontWeight: 700, color: r.warn ? '#d1521a' : '#6a625a' }}>{r.d}</span>
                    </div>
                  ))}
                </div>
              </>)}

              {/* ── Slide 1: Clientes ── */}
              {showcase === 1 && (<>
                <div style={{ background: '#f3f0eb', borderRadius: 8, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 11, color: '#8a8177' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  Buscar cliente, CPF ou CNPJ…
                </div>
                {[
                  { name: 'Maria S. Oliveira', doc: '812.***.**8', procs: 12, ini: 'MS', hi: true },
                  { name: 'Construtora Ápice Ltda.', doc: 'CNPJ 12.***/0001', procs: 3, ini: 'CA', hi: false },
                  { name: 'João P. Santos', doc: '074.***.**1', procs: 8, ini: 'JP', hi: false },
                  { name: 'Roberta C. Lima', doc: '531.***.**7', procs: 5, ini: 'RL', hi: false },
                ].map((c, i) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderTop: i === 0 ? 'none' : '1px solid #f2ede6' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: c.hi ? '#ea6a1e' : '#e8e3d8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: c.hi ? '#fff' : '#6a625a', flexShrink: 0 }}>{c.ini}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#2a2320', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: '#9a8f82' }}>{c.doc}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6a625a', background: '#f3efe8', borderRadius: 5, padding: '2px 7px', flexShrink: 0 }}>{c.procs} proc.</span>
                  </div>
                ))}
              </>)}

              {/* ── Slide 2: Processos ── */}
              {showcase === 2 && (<>
                <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
                  {[['Em andamento', true], ['Aguardando', false], ['Arquivado', false]].map(([s, on]) => (
                    <span key={String(s)} style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: on ? '#ea6a1e' : '#f3efe8', color: on ? '#fff' : '#8a8177' }}>{String(s)}</span>
                  ))}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: '#a49a8d', display: 'grid', gridTemplateColumns: '0.9fr 1fr 0.75fr', gap: 8, padding: '6px 0' }}>
                  <span>Número</span><span>Cliente</span><span>Situação</span>
                </div>
                {[
                  { num: '1002345-67.2023', client: 'Maria Oliveira', st: 'Em andamento', color: '#22c55e' },
                  { num: '0456123-70.2022', client: 'Construtora Ápice', st: 'Aguardando', color: '#f59e0b' },
                  { num: '2231908-18.2024', client: 'João P. Santos', st: 'Em andamento', color: '#22c55e' },
                  { num: '0987654-32.2021', client: 'Roberta C. Lima', st: 'Arquivado', color: '#94a3b8' },
                ].map((p) => (
                  <div key={p.num} style={{ display: 'grid', gridTemplateColumns: '0.9fr 1fr 0.75fr', gap: 8, padding: '7px 0', borderTop: '1px solid #f2ede6', alignItems: 'center' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: '#5a534c', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.num}</span>
                    <span style={{ color: '#2a2320', fontWeight: 600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.client}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                      <span style={{ color: '#6a625a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.st}</span>
                    </span>
                  </div>
                ))}
              </>)}

              {/* ── Slide 3: Petições & Req. INSS ── */}
              {showcase === 3 && (<>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#3a332c' }}>Documentos recentes</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, background: '#ea6a1e', color: '#fff', borderRadius: 5, padding: '2px 9px', cursor: 'default' }}>+ Novo</span>
                </div>
                {[
                  { icon: '📄', title: 'Contestação — Proc. 1002345', tag: 'Petição', st: 'Rascunho', sb: '#f3efe8', tc: '#8a8177' },
                  { icon: '📋', title: 'Req. INSS BPC/LOAS — Maria S.', tag: 'Req. INSS', st: 'Pronto', sb: '#d1fae5', tc: '#059669' },
                  { icon: '📄', title: 'Recurso Ordinário — Const. Ápice', tag: 'Petição', st: 'Revisão', sb: '#fef3c7', tc: '#d97706' },
                  { icon: '📋', title: 'Req. Auxílio-Doença — João S.', tag: 'Req. INSS', st: 'Rascunho', sb: '#f3efe8', tc: '#8a8177' },
                ].map((d) => (
                  <div key={d.title} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #f2ede6' }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{d.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#2a2320', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#9a8f82', background: '#f3efe8', borderRadius: 4, padding: '1px 5px' }}>{d.tag}</span>
                    </div>
                    <span style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 5, padding: '2px 7px', background: d.sb, color: d.tc, flexShrink: 0 }}>{d.st}</span>
                  </div>
                ))}
              </>)}

              {/* ── Slide 4: Cloud & Documentos ── */}
              {showcase === 4 && (<>
                <div style={{ background: '#f3f0eb', borderRadius: 8, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 11, color: '#8a8177' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  Buscar arquivos e pastas…
                </div>
                {[
                  { indent: 0, icon: '📁', name: 'Clientes', isFolder: true },
                  { indent: 1, icon: '📂', name: 'Maria Souza', isFolder: true },
                  { indent: 2, icon: '📄', name: 'RG.pdf', size: '340 KB' },
                  { indent: 2, icon: '📄', name: 'Procuração.pdf', size: '1.2 MB' },
                  { indent: 1, icon: '📂', name: 'João Santos', isFolder: true },
                  { indent: 2, icon: '📄', name: 'Contrato_Hon.pdf', size: '88 KB' },
                  { indent: 0, icon: '📁', name: 'Processos', isFolder: true },
                ].map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', paddingLeft: f.indent * 14, borderTop: i > 0 ? '1px solid #f7f3ee' : 'none' }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{f.icon}</span>
                    <span style={{ fontSize: 11, color: f.isFolder ? '#2a2320' : '#5a534c', fontWeight: f.isFolder ? 600 : 400, flex: 1 }}>{f.name}</span>
                    {!f.isFolder && 'size' in f && <span style={{ fontSize: 9.5, color: '#a49a8d', flexShrink: 0 }}>{(f as any).size}</span>}
                  </div>
                ))}
              </>)}

              {/* ── Slide 5: Assinaturas Digitais ── */}
              {showcase === 5 && (<>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 10 }}>
                  {([['Pendentes', '2', '#fef3c7', '#d97706'], ['Assinados', '5', '#d1fae5', '#059669'], ['Expirados', '1', '#fee2e2', '#dc2626']] as const).map(([l, n, bg, tc]) => (
                    <div key={l} style={{ background: bg, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: tc, lineHeight: 1 }}>{n}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: tc, opacity: 0.75, marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
                {[
                  { doc: 'Contrato de Honorários', client: 'Maria Oliveira', st: 'Pendente', prog: '1 de 2', sb: '#fef3c7', tc: '#d97706' },
                  { doc: 'Procuração ad judicia', client: 'João P. Santos', st: 'Assinado', prog: '2 de 2', sb: '#d1fae5', tc: '#059669' },
                  { doc: 'Termo de Confidencialidade', client: 'Construtora Ápice', st: 'Expirado', prog: '0 de 1', sb: '#fee2e2', tc: '#dc2626' },
                ].map((s) => (
                  <div key={s.doc} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #f2ede6' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#2a2320', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.doc}</div>
                      <div style={{ fontSize: 10, color: '#9a8f82' }}>{s.client} · {s.prog}</div>
                    </div>
                    <span style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 5, padding: '2px 7px', background: s.sb, color: s.tc, flexShrink: 0 }}>{s.st}</span>
                  </div>
                ))}
              </>)}

              {/* ── Slide 6: Financeiro ── */}
              {showcase === 6 && (<>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  {([['Honorários (Jul)', 'R$ 14.800', '+18%', '#d1fae5', '#059669'], ['Pendente', 'R$ 5.600', '3 faturas', '#fef3c7', '#d97706']] as const).map(([l, v, s, bg, tc]) => (
                    <div key={l} style={{ background: bg, borderRadius: 8, padding: '9px 10px' }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: tc, opacity: 0.75, marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: tc, lineHeight: 1 }}>{v}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 600, color: tc, opacity: 0.65, marginTop: 2 }}>{s}</div>
                    </div>
                  ))}
                </div>
                <div className="show-card" style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#3a332c', marginBottom: 8 }}>Receita mensal — 2025</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 60 }}>
                    {[42, 58, 50, 72, 64, 88, 76].map((h, i) => (
                      <div key={i} style={{ flex: 1, borderRadius: '3px 3px 0 0', background: i === 5 ? '#ea6a1e' : '#e8e3d8', height: `${h}%`, position: 'relative', transition: 'height .4s ease' }}>
                        {i === 5 && <div style={{ position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: 8, fontWeight: 700, color: '#ea6a1e', whiteSpace: 'nowrap' }}>Jul</div>}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                    {['Jan','Fev','Mar','Abr','Mai','Jun','Jul'].map((m) => (
                      <span key={m} style={{ fontSize: 8, color: '#a49a8d', flex: 1, textAlign: 'center' }}>{m}</span>
                    ))}
                  </div>
                </div>
              </>)}
            </div>
          </div>

          {/* legenda + carrossel */}
          <div style={{ marginTop: 'clamp(20px, 3vh, 34px)', minHeight: 96 }}>
            <div key={showcase} className="show-fade">
              <h2 style={{ fontFamily: BRAND_SERIF, fontWeight: 500, fontSize: 'clamp(21px, 2vw, 27px)', lineHeight: 1.15, letterSpacing: '-0.01em', color: '#f7f1e8' }}>
                {SHOWCASE[showcase].title}
              </h2>
              <p style={{ marginTop: 10, fontSize: 'clamp(13px, 1vw, 15px)', lineHeight: 1.6, color: 'rgba(244,237,226,0.6)', maxWidth: 460 }}>
                {SHOWCASE[showcase].text}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              {SHOWCASE.map((_, i) => (
                <button key={i} type="button" aria-label={`Destaque ${i + 1}`} onClick={() => setShowcase(i)}
                  className="show-dotbtn" data-on={i === showcase ? 'true' : 'false'} />
              ))}
            </div>
          </div>
        </div>

        {/* footer meta — estado real da conexão com o backend (Supabase) */}
        <div className="login-anim" style={{ position: 'relative', zIndex: 2, marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 22, borderTop: '1px solid rgba(255,255,255,0.10)', animationDelay: '0.4s' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 500, letterSpacing: '0.24em', textTransform: 'uppercase' }}>© {new Date().getFullYear()} jurius.com.br</span>
          <span
            title={svc === 'online'
              ? `Servidor Supabase · ${supabaseRegion} (${supabaseRegionCode})${latency != null ? ` · ${latency} ms` : ''}`
              : svc === 'offline' ? `Sem conexão com o servidor (${supabaseRegion})` : `Conectando ao servidor (${supabaseRegion})…`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: svc === 'online' ? '#5cc47a' : svc === 'offline' ? '#e05a4a' : '#e0a54a', boxShadow: svc === 'online' ? '0 0 0 3px rgba(92,196,122,0.18)' : 'none' }} />
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.38)' }}>Servidor</span>
            <span style={{ color: 'rgba(255,255,255,0.62)' }}>{supabaseRegion}</span>
            {svc === 'online' && latency != null && <span style={{ color: 'rgba(255,255,255,0.38)' }}>· {latency} ms</span>}
            {svc === 'offline' && <span style={{ color: '#e05a4a' }}>· offline</span>}
            {svc === 'checking' && <span style={{ color: 'rgba(255,255,255,0.38)' }}>· …</span>}
          </span>
        </div>
      </aside>

      {/* ── PAINEL DO FORMULÁRIO ── */}
      <main className="min-h-screen md:h-auto" style={{ position: 'relative', flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', padding: 'clamp(28px, 4vw, 56px) clamp(18px, 3vw, 44px) clamp(20px, 2.5vw, 32px)' }}>

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

        {/* eco quente no desktop — o formulário não flutua num branco estéril */}
        <div aria-hidden="true" className="hidden md:block" style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          background:
            'radial-gradient(560px 420px at 88% 6%, rgba(242,122,35,0.055), transparent 70%),' +
            'radial-gradient(480px 380px at 10% 100%, rgba(242,122,35,0.035), transparent 70%)',
        }} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 'clamp(52px, 8vw, 108px)', position: 'relative', zIndex: 1, width: '100%' }}>
        <div id="login-card" tabIndex={-1}
          className="login-anim relative z-10 w-full bg-white md:bg-transparent border border-slate-200 md:border-0 rounded-xl md:rounded-none overflow-hidden md:overflow-visible p-7 sm:p-8 md:p-0 shadow-[0_10px_30px_-6px_rgba(15,23,42,0.10)] md:shadow-none"
          style={{ maxWidth: 420, animationDelay: '0.34s' }}>

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
              <div className="flex gap-1 rounded-xl bg-[#efece6] p-1 ring-1 ring-[#e5e1d8]">
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
                      <h2 className="text-[22px] font-semibold text-[#211c18] mt-2 tracking-tight" style={{ fontFamily: BRAND_SERIF }}>Qual é o seu CPF?</h2>
                      <p className="text-[13px] text-slate-500 mt-1">Informe seus dados para acessar o painel.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Documento de Identidade</label>
                        <input ref={cpfRef} type="text" value={formatCPF(cpf)}
                          onChange={(e) => { setCpf(e.target.value); setClientError(null); }}
                          placeholder="000.000.000-00" autoComplete="username" inputMode="numeric" disabled={clientLoading}
                          className="w-full px-4 py-3.5 bg-white border border-[#e7e4de] rounded-xl focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all text-base font-semibold text-slate-900 placeholder:text-slate-400 hover:border-[#d9d5cd] shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
                        />
                      </div>
                      {clientError && <ErrorMsg msg={clientError} />}
                      <button type="submit" disabled={clientLoading || !cpfOk}
                        className="w-full py-3.5 rounded-xl font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:hover:brightness-100"
                        style={clientLoading || !cpfOk
                          ? { background: '#eceae4', color: '#a8a199', boxShadow: 'none' }
                          : { background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', color: '#fff', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}>
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
                      <h2 className="text-[22px] font-semibold text-[#211c18] mt-2 tracking-tight" style={{ fontFamily: BRAND_SERIF }}>Confirme seu acesso</h2>
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
                      className="w-full py-3.5 rounded-xl font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:hover:brightness-100"
                      style={clientLoading || !pinOk
                        ? { background: '#eceae4', color: '#a8a199', boxShadow: 'none' }
                        : { background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', color: '#fff', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}>
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
                      <h2 className="text-[26px] font-semibold text-[#211c18] tracking-tight leading-[1.15]" style={{ fontFamily: BRAND_SERIF }}>Bem-vindo de volta</h2>
                      <p className="text-[14px] text-slate-500 mt-2 leading-relaxed">Entre com seu CPF ou e-mail corporativo para continuar.</p>
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
                        className="w-full px-4 py-3.5 bg-white border border-[#e7e4de] rounded-xl focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all text-base font-medium text-slate-900 placeholder:text-slate-400 hover:border-[#d9d5cd] shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
                      />
                    </div>
                    {staffBanned && <BannedMsg />}
                    {staffError && !staffBanned && <ErrorMsg msg={staffError} />}
                    <button type="submit" disabled={identifierLoading || !identifier.trim()}
                      className="w-full py-3.5 rounded-xl font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:hover:brightness-100"
                      style={identifierLoading || !identifier.trim()
                        ? { background: '#eceae4', color: '#a8a199', boxShadow: 'none' }
                        : { background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', color: '#fff', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }}>
                      {identifierLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Buscando...</> : <><span>Continuar</span><ArrowRight className="h-5 w-5" /></>}
                    </button>
                  </form>
                )}

                {/* ═══ CONTA LEMBRADA (estilo Facebook: foto + nome + cargo) ═══ */}
                {!identifierLoading && staffStep === 'account' && (
                  <div style={{ animation: 'staffProfileIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }} className="space-y-4">
                    <style>{`@keyframes staffProfileIn { from{opacity:0;transform:translateY(18px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }`}</style>
                    <div>
                      <h2 className="text-[22px] font-semibold text-[#211c18] tracking-tight" style={{ fontFamily: BRAND_SERIF }}>Bem-vindo de volta</h2>
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
                          className="w-full px-4 py-3.5 bg-white border border-[#e7e4de] rounded-xl focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all pr-12 text-base font-medium text-slate-900 hover:border-[#d9d5cd] shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
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
                      style={{
                        animation: 'staffProfileIn 0.4s ease 0.4s both',
                        ...(staffLoading || !staffPw
                          ? { background: '#eceae4', color: '#a8a199', boxShadow: 'none' }
                          : { background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', color: '#fff', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }),
                      }}
                      className="w-full py-3.5 rounded-xl font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:hover:brightness-100">
                      {staffLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Autenticando...</> : <><Shield className="h-5 w-5" /> Acessar Sistema</>}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* rodapé do painel — só mobile (no desktop há rodapé institucional fixo) */}
          <p className="md:hidden" style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: '#9aa0ab', fontWeight: 500 }}>© {new Date().getFullYear()} Jurius</p>
        </div>
        </div>

        {/* rodapé institucional — ancora a página (só desktop) */}
        <div className="login-anim hidden md:flex" style={{ justifyContent: 'center', position: 'relative', zIndex: 1, animationDelay: '0.5s' }}>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(33,28,24,0.12), transparent)', marginBottom: 16 }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 600, color: '#a8a199' }}>
                <Lock className="h-3 w-3" strokeWidth={1.8} />
                Conexão segura e criptografada
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, fontSize: 11.5, fontWeight: 500, color: '#b5afa6' }}>
                <a href="#/terms" style={{ color: 'inherit', textDecoration: 'none' }} className="hover:text-orange-600 transition-colors">Termos</a>
                <a href="#/privacidade" style={{ color: 'inherit', textDecoration: 'none' }} className="hover:text-orange-600 transition-colors">Privacidade</a>
                <span>© {new Date().getFullYear()} jurius.com.br</span>
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default PortalLogin;

