import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Loader2, AlertCircle, ArrowLeft, ArrowRight,
  Eye, EyeOff, Lock, Shield, Ban, ChevronRight, CheckCircle, X, Smartphone,
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

type StaffLoginGuardResult = { blocked: boolean; suspended?: boolean; retry_after_seconds?: number };

async function callStaffLoginGuard(action: 'check' | 'fail' | 'reset' | 'unlock_with_pin', email: string, pin?: string): Promise<StaffLoginGuardResult & { ok?: boolean; error?: string; message?: string; locked_until?: string | null; attempts_remaining?: number | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('staff-login-guard', {
      body: { action, email: email.trim(), pin: pin?.trim() || undefined },
    });
    if (error) return { blocked: false };
    return (data as StaffLoginGuardResult) ?? { blocked: false };
  } catch {
    return { blocked: false };
  }
}

const formatRetryCountdown = (secs: number): string => {
  const safe = Math.max(0, Math.ceil(secs));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  return `${m}:${String(s).padStart(2, '0')}`;
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

const BannedMsg: React.FC<{ title?: string; body?: React.ReactNode; children?: React.ReactNode }> = ({
  title = 'Acesso Revogado',
  body = <>Sua conta foi desativada pelo administrador do escritório.<br />Entre em contato para reativar o acesso.</>,
  children,
}) => (
  <div className="flex flex-col items-center gap-4 rounded-lg border border-orange-200 bg-gradient-to-b from-orange-50 to-white px-6 py-6 text-center"
    style={{ animation: 'staffProfileIn 0.35s ease both' }}>
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 shadow-sm shadow-orange-200">
      <Ban className="h-7 w-7 text-orange-600" />
    </div>
    <div>
      <p className="text-[15px] font-bold text-slate-900">{title}</p>
      <p className="mt-1.5 text-[13px] leading-snug text-slate-500">{body}</p>
    </div>
    {children}
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

const MOCK_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const PreviewField: React.FC<{ label: string; value: string; span?: number }> = ({ label, value, span = 6 }) => (
  <div style={{ gridColumn: `span ${span} / span ${span}` }}>
    <div className="mock-label">{label}</div>
    <div className="mock-input">{value}</div>
  </div>
);

const PreviewSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mock-section">
    <div className="mock-sectionhead">{title}</div>
    <div className="mock-grid">{children}</div>
  </div>
);

const ShowcasePreview: React.FC<{ showcase: number }> = ({ showcase }) => {
  const moduleLabel = SHOWCASE[showcase].module;

  return (
    <div className="mock-modal" style={{ fontFamily: MOCK_FONT }}>
      <div className="mock-accent" />
      <div className="mock-header">
        <div>
          <div className="mock-eyebrow">{moduleLabel}</div>
          <div className="mock-title">
            {showcase === 0 && 'Novo prazo processual'}
            {showcase === 1 && 'Cadastro de cliente'}
            {showcase === 2 && 'Detalhes do processo'}
            {showcase === 3 && 'Novo requerimento / petição'}
            {showcase === 4 && 'Upload de documento'}
            {showcase === 5 && 'Solicitar assinatura'}
            {showcase === 6 && 'Novo lançamento financeiro'}
          </div>
        </div>
        <div className="mock-close">×</div>
      </div>

      <div className="mock-body">
        {showcase === 0 && (
          <>
            <PreviewSection title="Dados do prazo">
              <PreviewField label="Título" value="Manifestação sobre laudo pericial" span={12} />
              <PreviewField label="Processo" value="1002345-67.2023.8.11.0001" span={7} />
              <PreviewField label="Vencimento" value="18/07/2026" span={5} />
              <PreviewField label="Cliente" value="Maria Oliveira" span={7} />
              <PreviewField label="Responsável" value="Dr. Pedro Neto" span={5} />
            </PreviewSection>
            <div className="mock-sidegrid">
              <div className="mock-note">
                <span className="mock-badge mock-badge-amber">Fatal</span>
                <span className="mock-badge">15 dias</span>
                <span className="mock-badge">TJMT</span>
              </div>
              <div className="mock-list">
                <div className="mock-listrow"><span>Checklist</span><strong>4 itens</strong></div>
                <div className="mock-listrow"><span>Alertas</span><strong>D-3 e D-1</strong></div>
              </div>
            </div>
          </>
        )}

        {showcase === 1 && (
          <>
            <PreviewSection title="Informações principais">
              <PreviewField label="Nome / Razão social" value="Construtora Ápice Ltda." span={8} />
              <PreviewField label="Tipo" value="Pessoa jurídica" span={4} />
              <PreviewField label="CPF / CNPJ" value="12.345.678/0001-90" span={5} />
              <PreviewField label="Telefone" value="(65) 99999-1200" span={4} />
              <PreviewField label="Status" value="Cliente ativo" span={3} />
            </PreviewSection>
            <PreviewSection title="Relacionamentos">
              <PreviewField label="Processos vinculados" value="3 processos ativos" span={6} />
              <PreviewField label="Documentos" value="12 arquivos na cloud" span={6} />
            </PreviewSection>
          </>
        )}

        {showcase === 2 && (
          <>
            <PreviewSection title="Capa do processo">
              <PreviewField label="Número CNJ" value="0456123-70.2022.8.11.0042" span={7} />
              <PreviewField label="Status" value="Em andamento" span={5} />
              <PreviewField label="Cliente" value="Construtora Ápice Ltda." span={7} />
              <PreviewField label="Fase atual" value="Execução / cálculos" span={5} />
            </PreviewSection>
            <div className="mock-list">
              <div className="mock-listrow"><span>Último andamento</span><strong>Publicado hoje</strong></div>
              <div className="mock-listrow"><span>Próximo prazo</span><strong>em 2 dias</strong></div>
              <div className="mock-listrow"><span>Partes e docs</span><strong>Sincronizados</strong></div>
            </div>
          </>
        )}

        {showcase === 3 && (
          <>
            <div className="mock-tabs">
              <span className="mock-tab mock-tab-on">Requerimento</span>
              <span className="mock-tab">Petição</span>
              <span className="mock-tab">Assinatura</span>
            </div>
            <PreviewSection title="Documento">
              <PreviewField label="Modelo" value="BPC/LOAS inicial" span={6} />
              <PreviewField label="Cliente" value="Maria S. Oliveira" span={6} />
              <PreviewField label="Origem" value="Dados puxados do cadastro e processo" span={12} />
            </PreviewSection>
            <div className="mock-note">Blocos dinâmicos, campos preenchíveis e envio para assinatura sem sair do fluxo.</div>
          </>
        )}

        {showcase === 4 && (
          <>
            <PreviewSection title="Arquivo">
              <PreviewField label="Pasta destino" value="Clientes / João Santos / Documentos" span={8} />
              <PreviewField label="Visibilidade" value="Equipe interna" span={4} />
              <PreviewField label="Arquivo" value="Contrato_Honorarios.pdf" span={8} />
              <PreviewField label="Tamanho" value="1,2 MB" span={4} />
            </PreviewSection>
            <div className="mock-list">
              <div className="mock-listrow"><span>Versão</span><strong>v3 atual</strong></div>
              <div className="mock-listrow"><span>Última alteração</span><strong>há 12 min</strong></div>
            </div>
          </>
        )}

        {showcase === 5 && (
          <>
            <div className="mock-kpis">
              <div className="mock-kpi"><strong>2</strong><span>Pendentes</span></div>
              <div className="mock-kpi mock-kpi-green"><strong>5</strong><span>Assinados</span></div>
              <div className="mock-kpi mock-kpi-red"><strong>1</strong><span>Expirado</span></div>
            </div>
            <PreviewSection title="Envio">
              <PreviewField label="Documento" value="Contrato de honorários" span={7} />
              <PreviewField label="Assinantes" value="2 pessoas" span={5} />
              <PreviewField label="Validade" value="Expira em 7 dias" span={5} />
              <PreviewField label="Ordem de assinatura" value="Sequencial" span={7} />
            </PreviewSection>
          </>
        )}

        {showcase === 6 && (
          <>
            <div className="mock-summary">
              <span className="mock-summarydot" />
              <span>Resumo</span>
              <strong>R$ 14.800,00</strong>
              <span className="mock-sep">·</span>
              <span>6 parcelas</span>
            </div>
            <PreviewSection title="Financeiro">
              <PreviewField label="Cliente" value="João P. Santos" span={7} />
              <PreviewField label="Tipo" value="Honorários fixos" span={5} />
              <PreviewField label="Descrição" value="Execução de sentença previdenciária" span={12} />
              <PreviewField label="Entrada" value="R$ 2.500,00" span={4} />
              <PreviewField label="Parcelamento" value="5x de R$ 2.460,00" span={5} />
              <PreviewField label="1º vencimento" value="10/07/2026" span={3} />
            </PreviewSection>
          </>
        )}
      </div>

      <div className="mock-footer">
        <button type="button" className="mock-btn mock-btn-muted">Cancelar</button>
        <button type="button" className="mock-btn mock-btn-primary">
          {showcase === 5 ? 'Enviar' : 'Salvar'}
        </button>
      </div>
    </div>
  );
};

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
  const [renderedShowcase, setRenderedShowcase] = useState(0);
  const [leavingShowcase, setLeavingShowcase] = useState<number | null>(null);
  const [showcaseAnimating, setShowcaseAnimating] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setShowcase((s) => (s + 1) % SHOWCASE.length), 5200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (showcase === renderedShowcase) return;
    setLeavingShowcase(renderedShowcase);
    setRenderedShowcase(showcase);
    setShowcaseAnimating(true);
    const settleTimer = window.setTimeout(() => {
      setLeavingShowcase(null);
      setShowcaseAnimating(false);
    }, 420);
    return () => {
      window.clearTimeout(settleTimer);
    };
  }, [showcase, renderedShowcase]);

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
  const [staffBlockUntil, setStaffBlockUntil]     = useState<number | null>(null);
  const [staffNowTs, setStaffNowTs]               = useState<number>(() => Date.now());
  const [staffUnlockPin, setStaffUnlockPin]       = useState('');
  const [staffUnlocking, setStaffUnlocking]       = useState(false);
  const [staffUnlockMsg, setStaffUnlockMsg]       = useState<string | null>(null);
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
  const staffBlockRemainingSec = staffBlockUntil ? Math.max(0, Math.ceil((staffBlockUntil - staffNowTs) / 1000)) : 0;
  const staffBlocked = staffBlockRemainingSec > 0;
  const staffBlockMessage = staffBlocked
    ? `Muitas tentativas de login. Tente novamente em ${formatRetryCountdown(staffBlockRemainingSec)}.`
    : null;
  const staffCanSelfUnlock = String(profileRole || '').toLowerCase() === 'administrador';

  useEffect(() => {
    if (clientStep === 'cpf') setTimeout(() => cpfRef.current?.focus(), 80);
    if (clientStep === 'pin') setTimeout(() => pinRefs[0].current?.focus(), 80);
  }, [clientStep]);

  useEffect(() => {
    if (staffStep === 'identifier') setTimeout(() => identRef.current?.focus(), 80);
    if (staffStep === 'password') setTimeout(() => pwRef.current?.focus(), 80);
  }, [staffStep]);

  useEffect(() => {
    if (!staffBlockUntil) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setStaffNowTs(now);
      if (now >= staffBlockUntil) {
        setStaffBlockUntil(null);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [staffBlockUntil]);

  useEffect(() => {
    if (staffStep !== 'password' || !staffEmail) return;
    let cancelled = false;
    (async () => {
      const result = await callStaffLoginGuard('check', staffEmail);
      if (!cancelled && result.suspended) {
        setStaffBanned(true);
        setStaffError(null);
        return;
      }
      if (!cancelled && result.blocked && (result.retry_after_seconds ?? 0) > 0) {
        setStaffBlockUntil(Date.now() + (result.retry_after_seconds ?? 0) * 1000);
        setStaffNowTs(Date.now());
      }
    })();
    return () => { cancelled = true; };
  }, [staffStep, staffEmail]);

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
    setStaffUnlockMsg(null);
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
      setProfileName(p.name ?? p.email ?? trimmed);
      setProfileAvatar(p.avatar_url ?? null);
      setProfileRole(p.role ?? null);
      setStaffEmail(p.email ?? trimmed);
      if (p.is_active === false) {
        if (String(p.role || '').toLowerCase() !== 'administrador') {
          setStaffBanned(true);
          return false;
        }
        setStaffBanned(true);
        setStaffError(null);
      }
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
    if (staffBlocked) return;
    setStaffError(null); setStaffUnlockMsg(null); setStaffLoading(true);
    try {
      const pre = await callStaffLoginGuard('check', staffEmail);
      if (pre.suspended) {
        setStaffBanned(true);
        setStaffError(null);
        return;
      }
      if (pre.blocked) {
        const secs = Math.max(1, Math.ceil(pre.retry_after_seconds ?? 60));
        setStaffBlockUntil(Date.now() + secs * 1000);
        setStaffNowTs(Date.now());
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: staffEmail, password: staffPw });
      if (error) {
        const after = await callStaffLoginGuard('fail', staffEmail);
        if (after.suspended) {
          setStaffBanned(true);
          setStaffError(null);
          return;
        }
        if (after.blocked) {
          const secs = Math.max(1, Math.ceil(after.retry_after_seconds ?? 60));
          setStaffBlockUntil(Date.now() + secs * 1000);
          setStaffNowTs(Date.now());
          setStaffError(null);
          setStaffBanned(false);
          return;
        }
        throw error;
      }
      void callStaffLoginGuard('reset', staffEmail);
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

  const handleStaffUnlockWithPin = async () => {
    if (!staffEmail.trim() || staffUnlockPin.trim().length !== 6) {
      setStaffUnlockMsg('Informe o PIN do administrador com 6 dígitos.');
      return;
    }

    try {
      setStaffUnlocking(true);
      setStaffUnlockMsg(null);
      const result = await callStaffLoginGuard('unlock_with_pin', staffEmail, staffUnlockPin);
      if (result.ok) {
        setStaffBanned(false);
        setStaffUnlockPin('');
        setStaffUnlockMsg('Conta liberada. Agora você pode entrar com sua senha.');
        return;
      }
      if (result.error === 'wrong_pin' && typeof result.attempts_remaining === 'number') {
        setStaffUnlockMsg(`PIN incorreto. Restam ${result.attempts_remaining} tentativa(s).`);
        return;
      }
      setStaffUnlockMsg(result.message || 'Não foi possível validar o PIN para desbloqueio.');
    } finally {
      setStaffUnlocking(false);
    }
  };

  const staffUnlockNode = (
    <div className="w-full max-w-sm rounded-xl border border-orange-200 bg-white/85 p-3 text-left">
      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-700">
        PIN do Administrador
      </label>
      <div className="flex gap-2">
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={staffUnlockPin}
          onChange={(e) => setStaffUnlockPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
          placeholder="000000"
        />
        <button
          type="button"
          onClick={handleStaffUnlockWithPin}
          disabled={staffUnlocking || staffUnlockPin.length !== 6}
          className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {staffUnlocking ? 'Validando...' : 'Desbloquear'}
        </button>
      </div>
      {staffUnlockMsg && <p className="mt-2 text-xs font-medium text-orange-800">{staffUnlockMsg}</p>}
    </div>
  );

  const goBackStaff = () => {
    setStaffStep('identifier'); setStaffError(null); setStaffBanned(false); setStaffPw(''); setProfileName(null); setProfileAvatar(null); setProfileRole(null);
    setStaffBlockUntil(null); setStaffNowTs(Date.now());
    setStaffUnlockPin(''); setStaffUnlockMsg(null);
  };

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
    setStaffBlockUntil(null); setStaffNowTs(Date.now());
    setStaffUnlockPin(''); setStaffUnlockMsg(null);
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

                {staffBanned && <div style={{ marginTop: 16 }}><BannedMsg
                  title={staffCanSelfUnlock ? 'Conta suspensa para login' : 'Acesso Revogado'}
                  body={staffCanSelfUnlock
                    ? <>O acesso foi suspenso após repetidas tentativas de login.<br />Se você for administrador, pode liberar a conta aqui com seu PIN.</>
                    : <>Sua conta foi desativada pelo administrador do escritório.<br />Entre em contato para reativar o acesso.</>}
                >{staffCanSelfUnlock ? staffUnlockNode : null}</BannedMsg></div>}
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
                  <input ref={pwRef} className="jfield" type={showPw ? 'text' : 'password'} value={staffPw} disabled={staffLoading || staffBlocked || staffBanned}
                    onChange={(e) => { setStaffPw(e.target.value); if (!staffBlocked) setStaffError(null); }}
                    onKeyDown={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                    onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                    onBlur={() => setCapsOn(false)}
                    placeholder={staffBlocked ? 'Aguarde para tentar novamente' : 'Digite sua senha'} autoComplete="current-password" style={{ ...inputStyle, letterSpacing: '.5px', paddingRight: 52, opacity: staffBlocked ? 0.72 : 1 }} />
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

                <div style={{ position: 'relative', marginTop: 14 }}>
                  <p
                    aria-live="polite"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 999,
                      background: '#FFF7ED',
                      border: '1px solid #FED7AA',
                      boxShadow: '0 10px 24px -18px rgba(194,135,43,0.55)',
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#C2872B',
                      opacity: capsOn ? 1 : 0,
                      transform: capsOn ? 'translateY(0)' : 'translateY(-4px)',
                      pointerEvents: 'none',
                      transition: 'opacity .18s ease, transform .18s ease',
                      zIndex: 2,
                    }}
                  >
                    <AlertCircle className="h-3.5 w-3.5" /> Caps Lock está ativado
                  </p>
                  {staffBanned && <BannedMsg
                    title={staffCanSelfUnlock ? 'Conta suspensa para login' : 'Acesso Revogado'}
                    body={staffCanSelfUnlock
                      ? <>O acesso foi suspenso após repetidas tentativas de login.<br />Se você for administrador, pode liberar a conta aqui com seu PIN.</>
                      : <>Sua conta foi desativada pelo administrador do escritório.<br />Entre em contato para reativar o acesso.</>}
                  >{staffCanSelfUnlock ? staffUnlockNode : null}</BannedMsg>}
                  {staffBlockMessage && !staffBanned && <ErrorMsg msg={staffBlockMessage} />}
                  {staffError && !staffBanned && !staffBlockMessage && <ErrorMsg msg={staffError} />}
                </div>

                <button type="submit" className="jbtn" disabled={staffLoading || staffUnlocking || staffBlocked || staffBanned || !staffPw} style={primaryBtnStyle}>
                  {staffLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Entrando…</> : staffBlocked ? <>Tente em {formatRetryCountdown(staffBlockRemainingSec)}</> : <>Entrar <ArrowRight className="h-4 w-4" /></>}
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
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#f8f7f5', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }} className="login-shell flex-col md:flex-row">

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
        /* showcase do produto — moldura de navegador + preview fiel de modais */
        .show-browser {
          width: 100%; border-radius: 14px; overflow: hidden; background: #fff;
          border: 1px solid rgba(0,0,0,0.06);
          box-shadow: 0 44px 88px -34px rgba(0,0,0,0.72), 0 10px 26px -14px rgba(0,0,0,0.5);
        }
        .show-bar { display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; background: #f1ede6; border-bottom: 1px solid rgba(0,0,0,0.05); }
        .show-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .show-url { margin-left: 10px; flex: 1; max-width: 280px; height: 20px; border-radius: 6px; background: #e5e0d7; color: #8a8177; font-size: 10.5px; font-weight: 500; display: flex; align-items: center; padding: 0 10px; }
        .show-screen { padding: 16px; background: #faf8f5; min-height: 430px; display: flex; flex-direction: column; }
        .show-appbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .show-apptitle { font-size: 14px; font-weight: 700; color: #2a2320; letter-spacing: -0.01em; }
        .show-live { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #c56a1a; }
        .show-livedot { width: 6px; height: 6px; border-radius: 50%; background: #ea6a1e; box-shadow: 0 0 0 3px rgba(234,106,30,0.16); }
        .show-stack { position: relative; }
        .show-screen-stack { position: relative; min-height: 430px; }
        .show-screen-layer { position: absolute; inset: 0; transition: opacity 0.38s ease, transform 0.38s cubic-bezier(0.22,0.61,0.36,1); will-change: opacity, transform; }
        .show-screen-layer[data-state="current"] { opacity: 1; transform: translateX(0); position: relative; z-index: 2; }
        .show-screen-layer[data-state="entering"] { opacity: 1; transform: translateX(0); position: relative; z-index: 2; animation: showScreenIn 0.38s cubic-bezier(0.22,0.61,0.36,1) both; }
        .show-screen-layer[data-state="leaving"] { opacity: 0; transform: translateX(-22px); z-index: 1; }
        .show-meta-stack { position: relative; min-height: 96px; }
        .show-meta-layer { position: absolute; inset: 0; transition: opacity 0.34s ease, transform 0.34s cubic-bezier(0.22,0.61,0.36,1); will-change: opacity, transform; }
        .show-meta-layer[data-state="current"] { opacity: 1; transform: translateX(0); position: relative; z-index: 2; }
        .show-meta-layer[data-state="entering"] { opacity: 1; transform: translateX(0); position: relative; z-index: 2; animation: showMetaIn 0.34s cubic-bezier(0.22,0.61,0.36,1) both; }
        .show-meta-layer[data-state="leaving"] { opacity: 0; transform: translateX(-16px); z-index: 1; }
        @keyframes showScreenIn { from { opacity: 0; transform: translateX(22px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes showMetaIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
        .show-dotbtn { width: 22px; height: 4px; border-radius: 999px; border: none; cursor: pointer; padding: 0; background: rgba(255,255,255,0.22); transition: background 0.35s ease, width 0.35s ease; }
        .show-dotbtn[data-on="true"] { width: 34px; background: linear-gradient(90deg, #f59e0b, #ea6a1e); }
        .mock-modal { background: #fff; border: 1px solid #e7e5df; box-shadow: 0 18px 38px -26px rgba(15,23,42,0.35); min-height: 100%; display: flex; flex-direction: column; }
        .mock-accent { height: 6px; width: 100%; background: #f59e0b; }
        .mock-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #e7e5df; }
        .mock-eyebrow { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .2em; color: #94a3b8; }
        .mock-title { margin-top: 2px; font-size: 13px; font-weight: 600; color: #0f172a; }
        .mock-close { color: #94a3b8; font-size: 18px; line-height: 1; }
        .mock-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; background: #fff; flex: 1 1 auto; }
        .mock-section { display: flex; flex-direction: column; gap: 8px; }
        .mock-sectionhead { padding-bottom: 5px; border-bottom: 1px solid #f1f5f9; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: #64748b; }
        .mock-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 8px; }
        .mock-label { margin-bottom: 4px; font-size: 10px; font-weight: 500; color: #64748b; }
        .mock-input { min-height: 30px; border: 1px solid #cbd5e1; background: #fff; padding: 7px 9px; font-size: 10.5px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mock-note { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; border: 1px solid #fde68a; background: #fffbeb; padding: 8px 9px; font-size: 10.5px; color: #92400e; }
        .mock-sidegrid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 8px; }
        .mock-badge { display: inline-flex; align-items: center; border-radius: 999px; background: #f1f5f9; padding: 3px 7px; font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .05em; }
        .mock-badge-amber { background: #fff7ed; color: #c2410c; }
        .mock-list { border: 1px solid #e2e8f0; background: #fff; }
        .mock-listrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 9px; font-size: 10.5px; color: #475569; }
        .mock-listrow + .mock-listrow { border-top: 1px solid #f1f5f9; }
        .mock-listrow strong { color: #0f172a; font-weight: 600; }
        .mock-tabs { display: flex; gap: 6px; }
        .mock-tab { border-radius: 999px; background: #f1f5f9; padding: 4px 8px; font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
        .mock-tab-on { background: #ea6a1e; color: #fff; }
        .mock-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
        .mock-kpi { background: #fff7ed; padding: 9px 8px; text-align: center; }
        .mock-kpi strong { display: block; font-size: 16px; line-height: 1; color: #c2410c; }
        .mock-kpi span { display: block; margin-top: 3px; font-size: 9px; font-weight: 700; color: #c2410c; opacity: .78; text-transform: uppercase; letter-spacing: .04em; }
        .mock-kpi-green { background: #ecfdf5; }
        .mock-kpi-green strong, .mock-kpi-green span { color: #047857; }
        .mock-kpi-red { background: #fef2f2; }
        .mock-kpi-red strong, .mock-kpi-red span { color: #b91c1c; }
        .mock-summary { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; border: 1px solid #fde68a; background: #fffbeb; padding: 7px 9px; font-size: 10px; color: #92400e; }
        .mock-summary strong { color: #78350f; font-size: 10.5px; }
        .mock-summarydot { width: 6px; height: 6px; border-radius: 999px; background: #f59e0b; }
        .mock-sep { color: #f59e0b; }
        .mock-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid #f1f5f9; background: #f8fafc; }
        .mock-btn { border: 0; padding: 7px 12px; font-size: 10.5px; font-weight: 600; cursor: default; }
        .mock-btn-muted { background: transparent; color: #64748b; }
        .mock-btn-primary { background: #f97316; color: #fff; }

        @media (min-width: 768px) {
          .login-shell { height: 100dvh; overflow: hidden; }
          .login-aside { padding: clamp(20px, 2.6vw, 42px) clamp(24px, 3vw, 48px); }
          .login-showcase { max-width: 580px; margin-top: clamp(10px, 1.5vh, 18px); justify-content: center; }
          .login-showcase-meta { margin-top: clamp(12px, 1.8vh, 18px) !important; min-height: 0 !important; }
          .login-footer-meta { padding-top: 14px !important; }
          .login-main { min-height: 0 !important; height: 100dvh; padding: clamp(18px, 2.4vw, 34px) clamp(16px, 2.2vw, 34px) clamp(14px, 1.8vw, 24px) !important; overflow: hidden; }
          .login-main-inner { justify-content: center !important; padding-top: 0 !important; min-height: 0; }
          #login-card { max-width: 400px !important; }
          .show-browser { transform: scale(0.92); transform-origin: top left; width: 108.695%; }
          .show-screen { padding: 12px; min-height: 392px; }
          .show-appbar { margin-bottom: 8px; }
          .mock-header { padding: 8px 12px; }
          .mock-body { padding: 10px 12px; gap: 8px; }
          .mock-section { gap: 6px; }
          .mock-input { min-height: 26px; padding: 5px 8px; font-size: 10px; }
          .mock-listrow { padding: 6px 8px; font-size: 10px; }
          .mock-note, .mock-summary { padding: 6px 8px; font-size: 10px; }
          .mock-kpi { padding: 7px 6px; }
          .mock-kpi strong { font-size: 14px; }
          .mock-footer { padding: 8px 12px; }
        }

        @media (min-width: 768px) and (max-height: 900px) {
          .login-aside { padding-top: 16px; padding-bottom: 16px; }
          .login-showcase { max-width: 545px; }
          .show-browser { transform: scale(0.86); width: 116.279%; }
          .show-screen { min-height: 368px; }
          .login-showcase-meta h2 { font-size: clamp(19px, 1.7vw, 24px) !important; }
          .login-showcase-meta p { margin-top: 8px !important; font-size: 13px !important; line-height: 1.45 !important; }
          .login-footer-meta { padding-top: 10px !important; }
        }

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
        className="login-aside hidden md:flex"
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
        <div className="login-showcase login-anim" style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 620, marginTop: 'clamp(20px, 3vh, 40px)', animationDelay: '0.26s' }}>

          {/* moldura de navegador */}
          <div className="show-browser">
            <div className="show-bar">
              <span className="show-dot" style={{ background: '#ef6a5f' }} />
              <span className="show-dot" style={{ background: '#f5bd4f' }} />
              <span className="show-dot" style={{ background: '#58c66a' }} />
              <div className="show-url">{SHOWCASE[renderedShowcase].url}</div>
            </div>

            <div className="show-screen-stack">
              {leavingShowcase !== null && (
                <div className="show-screen-layer" data-state="leaving">
                  <div className="show-screen">
                    <div className="show-appbar">
                      <span className="show-apptitle">{SHOWCASE[leavingShowcase].module}</span>
                      <span className="show-live"><span className="show-livedot" /> ao vivo</span>
                    </div>
                    <ShowcasePreview showcase={leavingShowcase} />
                  </div>
                </div>
              )}
              <div className="show-screen-layer" data-state={showcaseAnimating ? 'entering' : 'current'}>
                <div className="show-screen">
                  <div className="show-appbar">
                    <span className="show-apptitle">{SHOWCASE[renderedShowcase].module}</span>
                    <span className="show-live"><span className="show-livedot" /> ao vivo</span>
                  </div>
                  <ShowcasePreview showcase={renderedShowcase} />
                </div>
              </div>
            </div>
          </div>

          {/* legenda + carrossel */}
          <div className="login-showcase-meta" style={{ marginTop: 'clamp(20px, 3vh, 34px)' }}>
            <div className="show-meta-stack">
              {leavingShowcase !== null && (
                <div className="show-meta-layer" data-state="leaving">
                  <h2 style={{ fontFamily: BRAND_SERIF, fontWeight: 500, fontSize: 'clamp(21px, 2vw, 27px)', lineHeight: 1.15, letterSpacing: '-0.01em', color: '#f7f1e8' }}>
                    {SHOWCASE[leavingShowcase].title}
                  </h2>
                  <p style={{ marginTop: 10, fontSize: 'clamp(13px, 1vw, 15px)', lineHeight: 1.6, color: 'rgba(244,237,226,0.6)', maxWidth: 460 }}>
                    {SHOWCASE[leavingShowcase].text}
                  </p>
                </div>
              )}
              <div className="show-meta-layer" data-state={showcaseAnimating ? 'entering' : 'current'}>
                <h2 style={{ fontFamily: BRAND_SERIF, fontWeight: 500, fontSize: 'clamp(21px, 2vw, 27px)', lineHeight: 1.15, letterSpacing: '-0.01em', color: '#f7f1e8' }}>
                  {SHOWCASE[renderedShowcase].title}
                </h2>
                <p style={{ marginTop: 10, fontSize: 'clamp(13px, 1vw, 15px)', lineHeight: 1.6, color: 'rgba(244,237,226,0.6)', maxWidth: 460 }}>
                  {SHOWCASE[renderedShowcase].text}
                </p>
              </div>
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
        <div className="login-footer-meta login-anim" style={{ position: 'relative', zIndex: 2, marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 22, borderTop: '1px solid rgba(255,255,255,0.10)', animationDelay: '0.4s' }}>
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
      <main className="login-main min-h-screen md:h-auto" style={{ position: 'relative', flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', padding: 'clamp(28px, 4vw, 56px) clamp(18px, 3vw, 44px) clamp(20px, 2.5vw, 32px)' }}>

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

        <div className="login-main-inner" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 'clamp(52px, 8vw, 108px)', position: 'relative', zIndex: 1, width: '100%' }}>
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
                      <div className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-2.5 border border-[#e7e4de] shadow-[0_1px_2px_rgba(33,28,24,0.04)]">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-500 ring-1 ring-inset ring-orange-100">
                          <Smartphone className="h-[18px] w-[18px]" strokeWidth={2.1} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Telefone cadastrado</p>
                          <p className="text-[15px] font-semibold text-[#211c18] tabular-nums tracking-tight">{phoneHint}</p>
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
                    {staffBanned && <BannedMsg
                      title={staffCanSelfUnlock ? 'Conta suspensa para login' : 'Acesso Revogado'}
                      body={staffCanSelfUnlock
                        ? <>O acesso foi suspenso após repetidas tentativas de login.<br />Se você for administrador, pode liberar a conta aqui com seu PIN.</>
                        : <>Sua conta foi desativada pelo administrador do escritório.<br />Entre em contato para reativar o acesso.</>}
                    >{staffCanSelfUnlock ? staffUnlockNode : null}</BannedMsg>}
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
                          onChange={(e) => { setStaffPw(e.target.value); if (!staffBlocked) setStaffError(null); }}
                          onKeyDown={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                          onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                          onBlur={() => setCapsOn(false)}
                          placeholder={staffBlocked ? 'Aguarde para tentar novamente' : '••••••••'} autoComplete="current-password" disabled={staffLoading || staffBlocked || staffBanned}
                          className="w-full px-4 py-3.5 bg-white border border-[#e7e4de] rounded-xl focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all pr-12 text-base font-medium text-slate-900 hover:border-[#d9d5cd] shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
                          style={{ opacity: staffBlocked ? 0.72 : 1 }}
                        />
                        <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                          {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                      <div className="relative mt-3.5">
                        <p
                          aria-live="polite"
                          className="absolute left-0 top-0 z-[2] flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-600 shadow-[0_10px_24px_-18px_rgba(194,135,43,0.55)] transition-all"
                          style={{ opacity: capsOn ? 1 : 0, transform: capsOn ? 'translateY(0)' : 'translateY(-4px)', pointerEvents: 'none' }}
                        >
                          <AlertCircle className="h-3.5 w-3.5" /> Caps Lock está ativado
                        </p>
                        {staffBanned && <BannedMsg
                          title={staffCanSelfUnlock ? 'Conta suspensa para login' : 'Acesso Revogado'}
                          body={staffCanSelfUnlock
                            ? <>O acesso foi suspenso após repetidas tentativas de login.<br />Se você for administrador, pode liberar a conta aqui com seu PIN.</>
                            : <>Sua conta foi desativada pelo administrador do escritório.<br />Entre em contato para reativar o acesso.</>}
                        >{staffCanSelfUnlock ? staffUnlockNode : null}</BannedMsg>}
                        {staffBlockMessage && !staffBanned && <ErrorMsg msg={staffBlockMessage} />}
                        {staffError && !staffBanned && !staffBlockMessage && <ErrorMsg msg={staffError} />}
                      </div>
                    </div>
                    <button type="submit" disabled={staffLoading || staffUnlocking || staffBlocked || staffBanned || !staffPw}
                      style={{
                        animation: 'staffProfileIn 0.4s ease 0.4s both',
                        ...(staffLoading || staffBlocked || !staffPw
                          ? { background: '#eceae4', color: '#a8a199', boxShadow: 'none' }
                          : { background: 'linear-gradient(135deg,#FB8C3E,#EA5310)', color: '#fff', boxShadow: '0 12px 24px -12px rgba(234,83,16,0.5)' }),
                      }}
                      className="w-full py-3.5 rounded-xl font-bold text-base hover:brightness-105 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:hover:brightness-100">
                      {staffLoading ? <><Loader2 className="h-5 w-5 animate-spin" /> Autenticando...</> : staffBlocked ? <>Tente em {formatRetryCountdown(staffBlockRemainingSec)}</> : <><Shield className="h-5 w-5" /> Acessar Sistema</>}
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
          <div style={{ width: '100%', maxWidth: 560 }}>
            <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(33,28,24,0.12), transparent)', marginBottom: 16 }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 600, color: '#a8a199', whiteSpace: 'nowrap' }}>
                <Lock className="h-3 w-3" strokeWidth={1.8} />
                Conexão segura e criptografada
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, fontSize: 11.5, fontWeight: 500, color: '#b5afa6', whiteSpace: 'nowrap', flexShrink: 0 }}>
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

