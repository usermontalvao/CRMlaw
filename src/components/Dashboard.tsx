import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Users,
  Briefcase,
  Calendar,
  CheckSquare,
  AlertCircle,
  Clock,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  DollarSign,
  TrendingUp,
  PiggyBank,
  CircleDollarSign,
  ArrowRight,
  X,
  UserPlus,
  Bell,
  Scale,
  ChevronRight,
  ExternalLink,
  Zap,
  BarChart3,
  Wallet,
  AlertTriangle,
  CalendarDays,
  Gavel,
  Plus,
  RefreshCw,
  Eye,
  Sparkles,
  User,
  GripVertical,
  RotateCcw,
  ShieldAlert,
  UserCheck,
  UserX,
  Loader2,
} from 'lucide-react';
import { ResponsiveGridLayout, verticalCompactor } from 'react-grid-layout';
import { useContainerWidth } from 'react-grid-layout/react';
import type { ResponsiveLayouts, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { supabase } from '../config/supabase';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { taskService } from '../services/task.service';
import { calendarService } from '../services/calendar.service';
import { requirementService } from '../services/requirement.service';
import { financialService } from '../services/financial.service';
import { djenLocalService } from '../services/djenLocal.service';
import { intimationAnalysisService } from '../services/intimationAnalysis.service';
import { dashboardPreferencesService } from '../services/dashboardPreferences.service';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Deadline } from '../types/deadline.types';
import type { Task } from '../types/task.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { Requirement } from '../types/requirement.types';
import type { FinancialStats, Installment, Agreement } from '../types/financial.types';
import type { DjenComunicacaoLocal } from '../types/djen.types';
import { FinancialCard } from './dashboard/FinancialCard';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { QuickActions } from './dashboard/QuickActions';
import { profileService } from '../services/profile.service';

// ── Modal rápido de ficha do cliente (abre sem sair do dashboard) ────────────
const ClientQuickViewModal: React.FC<{ clientId: string; onClose: () => void; onNavigateToModule?: (k: string, p?: any) => void }> = ({ clientId, onClose, onNavigateToModule }) => {
  const [client, setClient] = React.useState<Client | null>(null);
  const [processes, setProcesses] = React.useState<Process[]>([]);
  const [requirements, setRequirements] = React.useState<Requirement[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      import('./ClientDetails').then(m => m),
      clientService.getClientById(clientId),
      processService.listProcesses({ client_id: clientId }),
      requirementService.listRequirements({ client_id: clientId }),
    ]).then(([, c, p, r]) => {
      if (!mounted) return;
      setClient(c);
      setProcesses(p);
      setRequirements(r);
      setLoading(false);
    }).catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [clientId]);

  const ClientDetailsComp = React.lazy(() => import('./ClientDetails'));

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 sm:px-6 py-6 overflow-y-auto">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden my-auto">
        <div className="h-1.5 w-full bg-gradient-to-r from-orange-500 to-amber-400" />
        {loading || !client ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="w-7 h-7 animate-spin text-orange-500" />
          </div>
        ) : (
          <React.Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-orange-500" /></div>}>
            <div className="overflow-y-auto max-h-[85vh]">
              <ClientDetailsComp
                client={client}
                processes={processes}
                requirements={requirements}
                onBack={onClose}
                onEdit={onClose}
              />
            </div>
          </React.Suspense>
        )}
      </div>
    </div>,
    document.body
  );
};
// ─────────────────────────────────────────────────────────────────────────────
import { events, SYSTEM_EVENTS } from '../utils/events';
import { usePermissions } from '../hooks/usePermissions';

interface DashboardProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, string>) => void;
  params?: any;
}

type QuickActionProps = {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  accent?: 'amber' | 'blue' | 'green' | 'purple';
};

const QuickAction: React.FC<QuickActionProps> = ({ title, description, icon, onClick, accent = 'amber' }) => {
  const accentClasses: Record<NonNullable<QuickActionProps['accent']>, string> = {
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <button
      onClick={onClick}
      className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-amber-300 hover:shadow-md"
    >
      <div className={`rounded-lg p-3 ${accentClasses[accent]}`}>{icon}</div>
      <div className="flex-1">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
    </button>
  );
};

interface ModuleShortcut {
  title: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  accent: NonNullable<QuickActionProps['accent']>;
}

// Cache
const DASHBOARD_CACHE_KEY = 'crm-dashboard-cache';
const DASHBOARD_CACHE_VERSION = 2;
const CACHE_DURATION = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

// Grid layout
const LAYOUT_STORAGE_KEY = 'crm-dashboard-grid-v5';
const ROW_HEIGHT = 36;

type RLayouts = ResponsiveLayouts<string>;

// Ordem preferêncial dos widgets (mantida no auto-fit)
const WIDGET_ORDER = ['agenda', 'acoes', 'financeiro', 'prazos', 'tarefas', 'intimacoes', 'processos', 'requerimentos'] as const;

// Alturas padrão por widget (em rows)
const WIDGET_HEIGHT: Record<string, number> = {
  agenda: 14,
  acoes: 4,
  financeiro: 6,
  prazos: 6,
  tarefas: 7,
  intimacoes: 7,
  processos: 7,
  requerimentos: 7,
};

/**
 * Gera um layout auto-ajustado redistribuindo apenas os widgets visíveis,
 * preenchendo toda a largura disponível sem deixar espaços vazios.
 */
function buildAutoFitLayout(visibleKeys: Set<string>, bp: string): LayoutItem[] {
  const cols = bp === 'lg' || bp === 'md' ? 12 : bp === 'sm' ? 6 : bp === 'xs' ? 4 : 2;
  const visible = WIDGET_ORDER.filter(k => visibleKeys.has(k));
  if (visible.length === 0) return [];

  const isMobile = bp === 'sm' || bp === 'xs' || bp === 'xxs';

  // Mobile: empilhar verticalmente em largura total
  if (isMobile) {
    let y = 0;
    return visible.map(k => {
      const h = WIDGET_HEIGHT[k] ?? 7;
      const item: LayoutItem = { i: k, x: 0, y, w: cols, h };
      y += h;
      return item;
    });
  }

  // lg/md (12 cols): distribuir uniformemente
  const n = visible.length;
  let perRow: number;
  if (n === 1) perRow = 1;
  else if (n === 2) perRow = 2;
  else if (n === 3) perRow = 3;
  else if (n === 4) perRow = 2;
  else if (n <= 6) perRow = 3;
  else perRow = 4;

  const baseW = Math.floor(cols / perRow);
  const remainder = cols - baseW * perRow;

  const result: LayoutItem[] = [];
  let col = 0;
  let rowStartY = 0;
  let rowMaxH = 0;

  visible.forEach(k => {
    const h = WIDGET_HEIGHT[k] ?? 7;
    const w = col < remainder ? baseW + 1 : baseW;
    const x = col < remainder
      ? col * (baseW + 1)
      : remainder * (baseW + 1) + (col - remainder) * baseW;

    result.push({ i: k, x, y: rowStartY, w, h, minW: 2, minH: 3 });
    rowMaxH = Math.max(rowMaxH, h);
    col += 1;
    if (col >= perRow) {
      col = 0;
      rowStartY += rowMaxH;
      rowMaxH = 0;
    }
  });

  return result;
}

const DEFAULT_LAYOUTS: RLayouts = {
  // ≥ 1100px — 12 cols — 2 rows
  lg: [
    { i: 'agenda',        x: 0, y: 0,  w: 7, h: 14, minW: 4, minH: 5 },
    { i: 'acoes',         x: 7, y: 0,  w: 5, h: 4,  minW: 3, minH: 3 },
    { i: 'financeiro',    x: 7, y: 4,  w: 5, h: 5,  minW: 3, minH: 4 },
    { i: 'prazos',        x: 7, y: 9,  w: 5, h: 5,  minW: 3, minH: 3 },
    { i: 'tarefas',       x: 0, y: 14, w: 4, h: 7,  minW: 2, minH: 3 },
    { i: 'intimacoes',    x: 4, y: 14, w: 4, h: 7,  minW: 2, minH: 3 },
    { i: 'processos',     x: 8, y: 14, w: 4, h: 7,  minW: 2, minH: 3 },
    { i: 'requerimentos', x: 0, y: 21, w: 4, h: 7,  minW: 2, minH: 3 },
  ],
  // 768–1099px — 12 cols
  md: [
    { i: 'agenda',        x: 0, y: 0,  w: 7, h: 14 },
    { i: 'acoes',         x: 7, y: 0,  w: 5, h: 4  },
    { i: 'financeiro',    x: 7, y: 4,  w: 5, h: 5  },
    { i: 'prazos',        x: 7, y: 9,  w: 5, h: 5  },
    { i: 'tarefas',       x: 0, y: 14, w: 4, h: 7  },
    { i: 'intimacoes',    x: 4, y: 14, w: 4, h: 7  },
    { i: 'processos',     x: 8, y: 14, w: 4, h: 7  },
    { i: 'requerimentos', x: 0, y: 21, w: 4, h: 7  },
  ],
  // 480–767px — 6 cols, stacked
  sm: [
    { i: 'agenda',        x: 0, y: 0,  w: 6, h: 14 },
    { i: 'acoes',         x: 0, y: 14, w: 6, h: 4  },
    { i: 'financeiro',    x: 0, y: 18, w: 6, h: 7  },
    { i: 'prazos',        x: 0, y: 25, w: 6, h: 5  },
    { i: 'tarefas',       x: 0, y: 30, w: 6, h: 7  },
    { i: 'intimacoes',    x: 0, y: 37, w: 6, h: 7  },
    { i: 'processos',     x: 0, y: 44, w: 6, h: 7  },
    { i: 'requerimentos', x: 0, y: 51, w: 6, h: 7  },
  ],
  // < 480px — 4 cols, stacked
  xs: [
    { i: 'agenda',        x: 0, y: 0,  w: 4, h: 12 },
    { i: 'acoes',         x: 0, y: 12, w: 4, h: 4  },
    { i: 'financeiro',    x: 0, y: 16, w: 4, h: 7  },
    { i: 'prazos',        x: 0, y: 23, w: 4, h: 5  },
    { i: 'tarefas',       x: 0, y: 28, w: 4, h: 7  },
    { i: 'intimacoes',    x: 0, y: 35, w: 4, h: 7  },
    { i: 'processos',     x: 0, y: 42, w: 4, h: 7  },
    { i: 'requerimentos', x: 0, y: 49, w: 4, h: 7  },
  ],
  xxs: [
    { i: 'agenda',        x: 0, y: 0,  w: 2, h: 12 },
    { i: 'acoes',         x: 0, y: 12, w: 2, h: 4  },
    { i: 'financeiro',    x: 0, y: 16, w: 2, h: 7  },
    { i: 'prazos',        x: 0, y: 23, w: 2, h: 5  },
    { i: 'tarefas',       x: 0, y: 28, w: 2, h: 7  },
    { i: 'intimacoes',    x: 0, y: 35, w: 2, h: 7  },
    { i: 'processos',     x: 0, y: 42, w: 2, h: 7  },
    { i: 'requerimentos', x: 0, y: 49, w: 2, h: 7  },
  ],
};

interface DashboardCache {
  version: number;
  timestamp: number;
  data: {
    clients: Client[];
    processes: Process[];
    deadlines: Deadline[];
    tasks: Task[];
    calendarEvents: CalendarEvent[];
    requirements: Requirement[];
    financialStats: FinancialStats | null;
    overdueInstallments: (Installment & { agreement?: Agreement })[];
    djenIntimacoes: DjenComunicacaoLocal[];
  };
}

const parseLocalDateTime = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  }

  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = m[6] ? Number(m[6]) : 0;
    return new Date(y, mo - 1, d, hh, mm, ss, 0);
  }

  return new Date(value);
};

const Dashboard: React.FC<DashboardProps> = ({ onNavigateToModule }) => {
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes wave {
        0%   { transform: rotate(0deg); }
        25%  { transform: rotate(20deg); }
        75%  { transform: rotate(-10deg); }
        100% { transform: rotate(0deg); }
      }
      .scroll-hidden::-webkit-scrollbar { display: none; }
      .scroll-hidden { -ms-overflow-style: none; scrollbar-width: none; }
      .widget-header { cursor: grab; user-select: none; }
      .widget-header:active { cursor: grabbing; }
      .react-grid-item.react-grid-placeholder {
        background: rgba(245,158,11,0.1) !important;
        border: 2px dashed rgba(245,158,11,0.4) !important;
        border-radius: 12px;
        z-index: 2;
      }
      .react-resizable-handle {
        opacity: 0.2;
        transition: opacity 0.15s;
      }
      .react-resizable-handle:hover { opacity: 0.6; }
      .react-grid-item.cssTransforms {
        transition-property: transform !important;
        transition-duration: 150ms !important;
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [financialStats, setFinancialStats] = useState<FinancialStats | null>(null);
  const [overdueInstallments, setOverdueInstallments] = useState<(Installment & { agreement?: Agreement })[]>([]);
  const [djenIntimacoes, setDjenIntimacoes] = useState<DjenComunicacaoLocal[]>([]);
  const [djenUrgencyStats, setDjenUrgencyStats] = useState({ alta: 0, media: 0, baixa: 0, sem_analise: 0 });
  const [selectedEvent, setSelectedEvent] = useState<{
    id: string;
    title: string;
    start_at: string;
    type: string;
    client_id?: string | null;
    clientId?: string;
    clientName?: string;
    description?: string;
  } | null>(null);
  const [selectedIntimacao, setSelectedIntimacao] = useState<DjenComunicacaoLocal | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [userProfileId, setUserProfileId] = useState<string>('');
  const [userAuthId, setUserAuthId] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('');
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  // Solicitações de acesso pendentes (visível só para admin)
  const [pendingAccessCount, setPendingAccessCount] = useState(0);
  const [accessBannerDismissed, setAccessBannerDismissed] = useState(false);
  // Solicitações de atualização cadastral pendentes (portal)
  interface ProfileReq {
    id: string; client_id: string; client_name: string; client_cpf: string;
    changes: Record<string, string>; current_values: Record<string, string>;
    requested_at: string;
  }
  const [pendingProfileReqs, setPendingProfileReqs] = useState<ProfileReq[]>([]);
  const pendingProfileCount = pendingProfileReqs.length;
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(false);
  const [profileBannerExpanded, setProfileBannerExpanded] = useState(false);
  const [profileReqProcessing, setProfileReqProcessing] = useState<string | null>(null);
  const [profileRejectId, setProfileRejectId] = useState<string | null>(null);
  const [profileRejectReason, setProfileRejectReason] = useState('');
  const [quickViewClientId, setQuickViewClientId] = useState<string | null>(null);
  // Chave DataJud inválida (visível só para admin)
  const [datajudKeyInvalid, setDatajudKeyInvalid] = useState(false);
  const [datajudKeyBannerDismissed, setDatajudKeyBannerDismissed] = useState(false);
  // Notificações de acesso negado não lidas (visível para não-admin, persiste até marcar como lida no DB)
  const [userDeniedNotifs, setUserDeniedNotifs] = useState<Array<{ id: string; module_label: string; module_key: string; admin_notes?: string | null }>>([]);

  const [layouts, setLayouts] = useState<RLayouts>(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_LAYOUTS;
  });

  // Ref para debounce de salvamento remoto (Supabase)
  const saveLayoutTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flag para evitar salvar layout durante o carregamento inicial do Supabase
  const remoteLayoutLoadedRef = React.useRef<boolean>(false);
  const [layoutSaved, setLayoutSaved] = React.useState(false);
  const layoutSavedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carrega o layout salvo no Supabase ao montar (sobrescreve localStorage se existir remotamente)
  React.useEffect(() => {
    if (!userAuthId) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await dashboardPreferencesService.getGridLayout(userAuthId);
        if (cancelled) return;
        if (remote && typeof remote === 'object') {
          setLayouts(remote as RLayouts);
          try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(remote)); } catch {}
        } else {
          // No remote layout — clear any stale localStorage so default is used cleanly
          try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch {}
        }
      } catch (err) {
        console.warn('Não foi possível carregar layout do Supabase:', err);
      } finally {
        remoteLayoutLoadedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [userAuthId]);

  const handleLayoutsChange = useCallback((_layout: readonly LayoutItem[], allLayouts: RLayouts) => {
    setLayouts((prev: RLayouts) => {
      const next: RLayouts = { ...prev };
      Object.entries(allLayouts).forEach(([bp, updatedItems]) => {
        const prevItems: readonly LayoutItem[] = prev[bp] || DEFAULT_LAYOUTS[bp] || [];
        const merged: LayoutItem[] = (prevItems as LayoutItem[]).map((item: LayoutItem) => {
          const updated = (updatedItems as LayoutItem[]).find((u: LayoutItem) => u.i === item.i);
          return updated ? { ...item, ...updated } : item;
        });
        (updatedItems as LayoutItem[]).forEach((item: LayoutItem) => {
          if (!merged.find((m: LayoutItem) => m.i === item.i)) merged.push(item);
        });
        next[bp] = merged;
      });
      try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch {}

      // Debounce do salvamento no Supabase (800ms) — evita flood durante drag/resize.
      // Só salva após o carregamento inicial e se houver usuário autenticado.
      if (remoteLayoutLoadedRef.current && userAuthId) {
        if (saveLayoutTimerRef.current) clearTimeout(saveLayoutTimerRef.current);
        saveLayoutTimerRef.current = setTimeout(() => {
          dashboardPreferencesService.saveGridLayout(userAuthId, next as any).then(ok => {
            if (ok) {
              setLayoutSaved(true);
              if (layoutSavedTimerRef.current) clearTimeout(layoutSavedTimerRef.current);
              layoutSavedTimerRef.current = setTimeout(() => setLayoutSaved(false), 2500);
            }
          }).catch(err => {
            console.warn('Falha ao persistir layout no Supabase:', err);
          });
        }, 800);
      }
      return next;
    });
  }, [userAuthId]);

  // Limpa o timer de debounce ao desmontar
  React.useEffect(() => {
    return () => {
      if (saveLayoutTimerRef.current) clearTimeout(saveLayoutTimerRef.current);
    };
  }, []);

  const resetLayouts = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS);
    try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch {}
    // Limpa o layout salvo no Supabase também (define grid_layout como null;
    // não remove a linha pois ela pode conter left_widgets/right_widgets de outras features)
    if (userAuthId) {
      dashboardPreferencesService.saveGridLayout(userAuthId, null).catch(err => {
        console.warn('Falha ao resetar layout no Supabase:', err);
      });
    }
  }, [userAuthId]);

  const withTimeout = useCallback(<T,>(promise: Promise<T>, label: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} excedeu ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);
      promise.then(v => { clearTimeout(timer); resolve(v); })
             .catch(e => { clearTimeout(timer); reject(e); });
    });
  }, []);

  const safeFetch = useCallback(<T,>(factory: () => Promise<T>, fallback: T, label: string): Promise<T> => {
    return withTimeout(factory(), label).catch((error: unknown) => {
      console.warn(`Dashboard: ${label} indisponível`, error);
      return fallback;
    });
  }, [withTimeout]);

  const loadDashboardData = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);

      if (!forceRefresh) {
        const cachedData = localStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cachedData) {
          try {
            const cache: DashboardCache = JSON.parse(cachedData);
            const now = Date.now();
            const cacheValid =
              cache?.version === DASHBOARD_CACHE_VERSION &&
              typeof cache?.timestamp === 'number' &&
              cache?.data &&
              Array.isArray(cache.data.clients) &&
              Array.isArray(cache.data.processes) &&
              Array.isArray(cache.data.deadlines) &&
              Array.isArray(cache.data.tasks) &&
              Array.isArray(cache.data.calendarEvents) &&
              Array.isArray(cache.data.requirements) &&
              typeof cache.data.financialStats !== 'undefined' &&
              Array.isArray(cache.data.overdueInstallments) &&
              Array.isArray(cache.data.djenIntimacoes);
            if (cacheValid && now - cache.timestamp < CACHE_DURATION) {
              setClients(cache.data.clients);
              setProcesses(cache.data.processes);
              setDeadlines(cache.data.deadlines);
              setTasks(cache.data.tasks);
              setCalendarEvents(cache.data.calendarEvents);
              setRequirements(cache.data.requirements);
              setFinancialStats(cache.data.financialStats);
              setOverdueInstallments(cache.data.overdueInstallments);
              setDjenIntimacoes(cache.data.djenIntimacoes);
              setLoading(false);
              // Sempre re-busca eventos de calendário em background (dados mais voláteis)
              const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
              const future = new Date(cutoff.getTime() + 60 * 24 * 60 * 60 * 1000);
              calendarService.listEvents()
                .then(evs => {
                  const fresh = evs.filter(e => {
                    if (!e.start_at) return false;
                    const d = parseLocalDateTime(e.start_at);
                    return d >= cutoff && d <= future;
                  }).slice(0, 100);
                  setCalendarEvents(fresh);
                })
                .catch(() => {});
              return;
            }
          } catch (e) {
            console.warn('Cache inválido, recarregando dados');
          }
        }
      }

      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [
        clientsData,
        processesData,
        deadlinesData,
        tasksData,
        calendarEventsData,
        requirementsData,
        financialStatsData,
        allInstallmentsData,
        djenIntimacoesData,
      ] = await Promise.all([
        safeFetch(() => clientService.listClients().then(cs => cs.filter(c => c.status === 'ativo')), [], 'Clientes'),
        safeFetch(() => processService.listProcesses().then(ps => ps.filter(p => p.status !== 'arquivado').slice(0, 100)), [], 'Processos'),
        safeFetch(() => deadlineService.listDeadlines().then(ds => ds.filter(d => d.status === 'pendente').slice(0, 50)), [], 'Prazos'),
        safeFetch(() => taskService.listTasks().then(ts => ts.filter(t => t.status === 'pending').slice(0, 50)), [], 'Tarefas'),
        safeFetch(() => calendarService.listEvents().then(evs => {
          const now = new Date(); now.setHours(0, 0, 0, 0);
          const futureDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
          return evs.filter(e => {
            if (!e.start_at) return false;
            const d = parseLocalDateTime(e.start_at);
            return d >= now && d <= futureDate;
          }).slice(0, 100);
        }), [], 'Agenda'),
        safeFetch(() => requirementService.listRequirements().then(rs => rs.filter(r => r.status === 'aguardando_confeccao').slice(0, 50)), [], 'Requerimentos'),
        safeFetch(() => financialService.getFinancialStats(new Date().toISOString().slice(0, 7)), null, 'Financeiro'),
        safeFetch(() => financialService.listAllInstallments().then(insts =>
          insts.filter(i => (i.status === 'pendente' || i.status === 'vencido') && i.due_date >= thirtyDaysAgo).slice(0, 50)
        ), [], 'Parcelas'),
        safeFetch(() => djenLocalService.listComunicacoes({ lida: false }), [], 'Intimações DJEN'),
      ]);

      const overdue = allInstallmentsData
        .filter((inst: any) => (inst.status === 'pendente' || inst.status === 'vencido') && inst.due_date < today)
        .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5);

      if (djenIntimacoesData.length > 0) {
        try {
          const intimationIds = djenIntimacoesData.map((int: any) => int.id);
          const analyses = await intimationAnalysisService.getAnalysesByIntimationIds(intimationIds);
          const stats = { alta: 0, media: 0, baixa: 0, sem_analise: 0 };
          djenIntimacoesData.forEach((intimacao: any) => {
            const analysis = analyses.get(intimacao.id);
            if (analysis && analysis.urgency) {
              stats[analysis.urgency as 'alta' | 'media' | 'baixa']++;
            } else {
              stats.sem_analise++;
            }
          });
          setDjenUrgencyStats(stats);
        } catch (err) {
          console.error('Erro ao carregar estatísticas de urgência:', err);
        }
      }

      setClients(clientsData);
      setProcesses(processesData);
      setDeadlines(deadlinesData);
      setTasks(tasksData);
      setCalendarEvents(calendarEventsData);
      setRequirements(requirementsData);
      setFinancialStats(financialStatsData);
      setDjenIntimacoes(djenIntimacoesData);
      setOverdueInstallments(overdue);

      const cacheData: DashboardCache = {
        version: DASHBOARD_CACHE_VERSION,
        timestamp: Date.now(),
        data: {
          clients: clientsData,
          processes: processesData,
          deadlines: deadlinesData,
          tasks: tasksData,
          calendarEvents: calendarEventsData,
          requirements: requirementsData,
          financialStats: financialStatsData,
          overdueInstallments: overdue,
          djenIntimacoes: djenIntimacoesData,
        },
      };
      try {
        localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cacheData));
      } catch {
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('crm-') || key.startsWith('syncfusion-') || key.startsWith('petition-'))) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(key => localStorage.removeItem(key));
          localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cacheData));
        } catch {
          console.warn('Não foi possível salvar cache do dashboard');
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dados do dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, [safeFetch]);

  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  useEffect(() => {
    const loadUserName = async () => {
      try {
        const profile = await profileService.getMyProfile();
        const fullName = profile?.name || '';
        setUserName(fullName.split(' ')[0]);
        setUserProfileId(profile?.id || '');
        setUserAuthId(profile?.user_id || '');
        setUserRole(profile?.role || '');
      } catch (error) {
        console.warn('Não foi possível carregar o nome do usuário:', error);
      }
    };
    loadUserName();
  }, []);

  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, () => {
      loadDashboardData(true);
    });
    return () => unsubscribe();
  }, [loadDashboardData]);

  const { canView, canCreate, loading: permissionsLoading } = usePermissions();
  // Hook nativo do react-grid-layout v2 que mede a largura do container automaticamente.
  // No mobile (< 768px) a sidebar é oculta (ml-0), então não subtrai offset.
  const initialGridWidth = typeof window !== 'undefined'
    ? Math.max(window.innerWidth >= 768 ? window.innerWidth - 80 : window.innerWidth, 320)
    : 1200;
  const { width: gridWidth, containerRef: gridContainerRef, mounted: gridMounted } = useContainerWidth({
    measureBeforeMount: false,
    initialWidth: initialGridWidth,
  });
  // Limpa layouts antigos de versões anteriores (uma vez)
  React.useEffect(() => {
    try {
      ['crm-dashboard-grid', 'crm-dashboard-grid-v2', 'crm-dashboard-grid-v3', 'crm-dashboard-grid-v4'].forEach(k => localStorage.removeItem(k));
    } catch {}
  }, []);

  const activeClients = clients.filter(c => c.status === 'ativo').length;
  const activeProcesses = processes.length;
  const pendingDeadlines = deadlines.filter(d => d.status === 'pendente').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const awaitingRequirements = requirements.filter(r => r.status === 'aguardando_confeccao');
  const awaitingDraftProcesses = processes.filter(p => p.status === 'aguardando_confeccao');
  const pendingProcesses = processes.filter(p => p.status === 'andamento' || p.status === 'distribuido');

  const isAdmin = userRole.toLowerCase().includes('admin');

  // Carregar contagem de solicitações pendentes (só admin)
  useEffect(() => {
    if (!isAdmin) return;
    setAccessBannerDismissed(false);
    import('../services/accessRequest.service').then(({ accessRequestService }) => {
      accessRequestService.getPendingCount().then(count => setPendingAccessCount(count)).catch(() => {});
    });
  }, [isAdmin]);

  // Carregar solicitações de atualização cadastral pendentes (só admin)
  const loadProfileReqs = async () => {
    try {
      const { data } = await supabase.rpc('admin_list_profile_update_requests', { p_status: 'pending' });
      setPendingProfileReqs(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  };

  useEffect(() => {
    if (!isAdmin) return;
    setProfileBannerDismissed(false);
    loadProfileReqs();
  }, [isAdmin]);

  // Verificar se a chave DataJud está inválida (só admin)
  useEffect(() => {
    if (!isAdmin) return;
    import('../services/settings.service').then(({ settingsService }) => {
      settingsService.getDatajudKeyConfig()
        .then(cfg => setDatajudKeyInvalid(cfg.invalid))
        .catch(() => {});
    });
  }, [isAdmin]);

  // Carregar notificações de acesso negado não lidas (só não-admin)
  useEffect(() => {
    if (isAdmin || !userAuthId) return;
    import('../services/userNotification.service').then(({ userNotificationService }) => {
      userNotificationService.listNotifications(userAuthId, /* unreadOnly */ true).then(notifs => {
        const denied = notifs.filter(n =>
          n.type === 'access_request_resolved' &&
          n.metadata?.status === 'denied' &&
          n.metadata?.module_key
        );
        setUserDeniedNotifs(denied.map(n => {
          // Extrair motivo da mensagem: "...foi negada. Motivo: XYZ"
          const motivoMatch = (n.message || '').match(/Motivo:\s*(.+)$/);
          return {
            id: n.id,
            module_label: (n.metadata?.module_label as string) || n.message?.match(/"([^"]+)"/)?.[1] || (n.metadata?.module_key as string),
            module_key: n.metadata?.module_key as string,
            admin_notes: motivoMatch ? motivoMatch[1].trim() : null,
          };
        }));
      }).catch(() => {});
    });
  }, [isAdmin, userAuthId]);

  const upcomingDeadlines = deadlines
    .filter(d => d.status === 'pendente' && d.due_date && (isAdmin || !userProfileId || d.responsible_id === userProfileId))
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
    .slice(0, 5);

  const recentTasks = tasks
    .filter(t => t.status === 'pending' && (!userAuthId || t.user_id === userAuthId))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const upcomingEvents = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const cMap = new Map(clients.map(c => [c.id, c.full_name]));
    const inWeek = (d: Date) => d >= today && d <= weekEnd;

    const calEvts = calendarEvents
      .filter(e => {
        if (!e.start_at || !inWeek(parseLocalDateTime(e.start_at))) return false;
        if (isAdmin || !userAuthId) return true;
        // Evento próprio ou compartilhado com o usuário
        return e.user_id === userAuthId || (e.shared_with_ids?.includes(userAuthId) ?? false);
      })
      .map(e => ({
        id: e.id, title: e.title, start_at: e.start_at,
        type: e.event_type || 'meeting',
        clientId: e.client_id || undefined,
        clientName: e.client_id ? cMap.get(e.client_id) : undefined,
        description: e.description || undefined,
      }));

    const hearingEvts = processes
      .filter(p => p.hearing_scheduled && p.hearing_date && inWeek(parseLocalDateTime(p.hearing_date!)))
      .map(p => ({
        id: `hearing-${p.id}`,
        title: `Audiência${p.hearing_mode ? ` ${p.hearing_mode}` : ''}`,
        start_at: p.hearing_time ? `${p.hearing_date}T${p.hearing_time}` : p.hearing_date!,
        type: 'hearing',
        clientId: p.client_id || undefined,
        clientName: p.client_id ? cMap.get(p.client_id) : undefined,
        description: p.process_code ? `Processo: ${p.process_code}` : undefined,
      }));

    const deadlineEvts = deadlines
      .filter(d => {
        if (d.status !== 'pendente' || !d.due_date || !inWeek(parseLocalDateTime(d.due_date))) return false;
        if (isAdmin || !userProfileId) return true;
        return d.responsible_id === userProfileId;
      })
      .map(d => ({
        id: `deadline-${d.id}`, title: d.title,
        start_at: d.due_date!,
        type: 'deadline',
        clientId: d.client_id || undefined,
        clientName: d.client_id ? cMap.get(d.client_id) : undefined,
        description: d.description || undefined,
      }));

    const reqEvts = requirements
      .filter(r => r.status === 'em_exigencia' && r.exigency_due_date && inWeek(parseLocalDateTime(r.exigency_due_date)))
      .map(r => ({
        id: `req-${r.id}`,
        title: `Prazo exigência — ${r.beneficiary || 'Requerimento'}`,
        start_at: r.exigency_due_date!,
        type: 'deadline',
        clientId: undefined,
        clientName: r.beneficiary || undefined,
        description: undefined,
      }));

    return [...calEvts, ...hearingEvts, ...deadlineEvts, ...reqEvts].sort((a, b) => {
      const da = parseLocalDateTime(a.start_at);
      const db = parseLocalDateTime(b.start_at);
      const dayA = new Date(da); dayA.setHours(0, 0, 0, 0);
      const dayB = new Date(db); dayB.setHours(0, 0, 0, 0);
      if (dayA.getTime() !== dayB.getTime()) return dayA.getTime() - dayB.getTime();
      const aAllDay = da.getHours() === 0 && da.getMinutes() === 0;
      const bAllDay = db.getHours() === 0 && db.getMinutes() === 0;
      if (aAllDay !== bAllDay) return aAllDay ? 1 : -1;
      return da.getTime() - db.getTime();
    });
  }, [calendarEvents, processes, deadlines, requirements, clients, userAuthId, userRole, userProfileId]);

  const pendingRequirementsList = awaitingRequirements
    .sort((a, b) => {
      const dateA = a.entry_date ? new Date(a.entry_date).getTime() : 0;
      const dateB = b.entry_date ? new Date(b.entry_date).getTime() : 0;
      return dateA - dateB;
    })
    .slice(0, 5);

  const awaitingDraftProcessesList = awaitingDraftProcesses
    .sort((a, b) => {
      if (a.priority === 'urgente' && b.priority !== 'urgente') return -1;
      if (a.priority !== 'urgente' && b.priority === 'urgente') return 1;
      const dateA = a.distributed_at ? new Date(a.distributed_at).getTime() : new Date(a.created_at).getTime();
      const dateB = b.distributed_at ? new Date(b.distributed_at).getTime() : new Date(b.created_at).getTime();
      return dateA - dateB;
    })
    .slice(0, 5);

  const nowDate = new Date();

  const newClientsThisMonth = clients.filter(c => {
    if (!c.created_at) return false;
    const d = new Date(c.created_at);
    return d.getMonth() === nowDate.getMonth() && d.getFullYear() === nowDate.getFullYear();
  }).length;

  const newProcessesThisMonth = processes.filter(p => {
    if (!p.created_at) return false;
    const d = new Date(p.created_at);
    return d.getMonth() === nowDate.getMonth() && d.getFullYear() === nowDate.getFullYear();
  }).length;

  const completedTasksCount = tasks.filter(t => {
    const n = (t.status || '').toLowerCase();
    return n === 'completed' || n === 'done' || n === 'concluido';
  }).length;

  const totalTrackedTasks = completedTasksCount + pendingTasks;
  const tasksCompletionRate = totalTrackedTasks ? Math.round((completedTasksCount / totalTrackedTasks) * 100) : 0;

  const handleNavigate = (moduleWithParams: string) => {
    if (!onNavigateToModule) return;
    const [module, queryString] = moduleWithParams.split('?');
    if (queryString) {
      const params: Record<string, string> = {};
      queryString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        params[key] = value;
      });
      onNavigateToModule(module, params);
    } else {
      onNavigateToModule(module);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  const urgentAlerts = useMemo(() => {
    const alerts: { type: string; count: number; color: string; icon: React.ReactNode; action: string }[] = [];
    if (pendingDeadlines > 0) {
      const urgentDeadlines = deadlines.filter(d => {
        if (d.status !== 'pendente') return false;
        const dueDate = new Date(d.due_date!);
        const today = new Date();
        const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 3 && diffDays >= 0;
      }).length;
      if (urgentDeadlines > 0) {
        alerts.push({ type: 'Prazos Urgentes', count: urgentDeadlines, color: 'red', icon: <AlertTriangle className="w-4 h-4" />, action: 'prazos' });
      }
    }
    if (djenIntimacoes.length > 0) {
      alerts.push({ type: 'Intimações Não Lidas', count: djenIntimacoes.length, color: 'orange', icon: <Bell className="w-4 h-4" />, action: 'intimacoes' });
    }
    if (financialStats && financialStats.overdue_installments > 0) {
      alerts.push({ type: 'Parcelas Vencidas', count: financialStats.overdue_installments, color: 'amber', icon: <Wallet className="w-4 h-4" />, action: 'financeiro' });
    }
    return alerts;
  }, [pendingDeadlines, deadlines, djenIntimacoes, financialStats]);

  // Compute filtered layouts for only visible widgets
  const visibleWidgetKeys = useMemo(() => {
    const keys = new Set<string>();
    if (canView('agenda')) keys.add('agenda');
    if (canView('tarefas')) keys.add('tarefas');
    if (canView('clientes') || canView('prazos') || canView('tarefas') || canView('agenda') ||
        canView('requerimentos') || canView('processos') || canView('financeiro')) keys.add('acoes');
    // Financeiro: aparece sempre que há permissão (mesmo sem stats ainda carregados —
    // o widget próprio trata o estado vazio/loading)
    if (canView('financeiro')) keys.add('financeiro');
    if (canView('prazos')) keys.add('prazos');
    if (canView('intimacoes')) keys.add('intimacoes');
    if (canView('processos')) keys.add('processos');
    if (canView('requerimentos')) keys.add('requerimentos');
    return keys;
  }, [canView]);

  // Número de colunas por breakpoint
  const COLS_PER_BP: Record<string, number> = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };

  const activeLayouts = useMemo<RLayouts>(() => {
    const result: RLayouts = {};
    const allBps = ['lg', 'md', 'sm', 'xs', 'xxs'];
    const allVisible = visibleWidgetKeys.size === WIDGET_ORDER.length;
    allBps.forEach(bp => {
      if (allVisible) {
        const items: readonly LayoutItem[] = layouts[bp] || DEFAULT_LAYOUTS[bp] || [];
        const cols = COLS_PER_BP[bp] ?? 12;
        // Filtra widgets visíveis e valida que cada item cabe nas colunas do breakpoint
        const filtered = (items as LayoutItem[])
          .filter((item: LayoutItem) => visibleWidgetKeys.has(item.i))
          .map((item: LayoutItem) => ({
            ...item,
            // Garante que o widget não exceda a largura do breakpoint
            w: Math.min(item.w, cols),
            x: Math.min(item.x, cols - Math.min(item.w, cols)),
          }));
        // Se algum item ficou inválido (w+x > cols), usa auto-fit como fallback
        const hasInvalid = filtered.some((item: LayoutItem) => item.x + item.w > cols);
        result[bp] = hasInvalid ? buildAutoFitLayout(visibleWidgetKeys, bp) : filtered;
      } else {
        result[bp] = buildAutoFitLayout(visibleWidgetKeys, bp);
      }
    });
    return result;
  }, [layouts, visibleWidgetKeys]);

  if (loading || permissionsLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-amber-600 border-t-transparent"></div>
          <p className="text-slate-600">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  const typeDot: Record<string, string> = {
    meeting: 'bg-amber-400', hearing: 'bg-red-500',
    payment: 'bg-emerald-500', deadline: 'bg-rose-500',
    task: 'bg-violet-400', other: 'bg-slate-300',
  };
  const typeTag: Record<string, { bg: string; text: string; label: string }> = {
    meeting:  { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'Reunião' },
    hearing:  { bg: 'bg-red-50',     text: 'text-red-700',     label: 'Audiência' },
    payment:  { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Pagamento' },
    deadline: { bg: 'bg-rose-50',    text: 'text-rose-700',    label: 'Prazo' },
    task:     { bg: 'bg-violet-50',  text: 'text-violet-700',  label: 'Tarefa' },
    other:    { bg: 'bg-slate-100',  text: 'text-slate-500',   label: 'Evento' },
  };

  const agendaGroups: { label: string; dateLabel: string; isToday: boolean; dateKey: string; events: typeof upcomingEvents }[] = [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const tomorrow = new Date(now.getTime() + 86400000);
  upcomingEvents.forEach(ev => {
    const d = parseLocalDateTime(ev.start_at); d.setHours(0, 0, 0, 0);
    const isToday    = d.getTime() === now.getTime();
    const isTomorrow = d.getTime() === tomorrow.getTime();
    const label = isToday ? 'Hoje' : isTomorrow ? 'Amanhã'
      : d.toLocaleDateString('pt-BR', { weekday: 'long' });
    const dateLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const key = d.toISOString().slice(0, 10);
    const g = agendaGroups.find(g => g.dateKey === key);
    if (g) g.events.push(ev); else agendaGroups.push({ label, dateLabel, isToday, dateKey: key, events: [ev] });
  });

  return (
    <>
    <div className="bg-slate-50/50 -mx-3 -my-4 sm:-mx-4 sm:-my-6 lg:-mx-6 xl:-mx-8 px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 min-h-screen overflow-x-hidden">

      {/* Layout saved toast */}
      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-full shadow-xl transition-all duration-300 pointer-events-none ${
        layoutSaved ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}>
        <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Layout salvo
      </div>

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-4 sm:mb-5">
        <div className="flex items-center justify-between sm:gap-4">
          <div className="flex items-center gap-2">
            <p className="text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider">{getGreeting()}</p>
            <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900">{userName || 'Dashboard'}</h1>
            {userName && (
              <span className="text-base sm:text-xl leading-none select-none"
                style={{ animation: 'wave 1s ease-in-out infinite', transformOrigin: '70% 70%', display: 'inline-block' }}>
                👋
              </span>
            )}
          </div>
          {canView('clientes') && canCreate('clientes') && (
            <button onClick={() => handleNavigate('clientes?mode=create')}
              className="sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-all shrink-0">
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Cliente</span>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-start sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            {canView('clientes') && (
              <button onClick={() => handleNavigate('clientes')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-all text-xs sm:text-sm">
                <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{activeClients}</span>
                <span className="text-blue-600 hidden sm:inline">clientes</span>
                {newClientsThisMonth > 0 && <span className="text-blue-500 font-medium">+{newClientsThisMonth}</span>}
              </button>
            )}
            {canView('processos') && (
              <button onClick={() => handleNavigate('processos')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 transition-all text-xs sm:text-sm">
                <Gavel className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{activeProcesses}</span>
                <span className="text-purple-600 hidden sm:inline">processos</span>
              </button>
            )}
            {canView('prazos') && (
              <button onClick={() => handleNavigate('prazos')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 transition-all text-xs sm:text-sm">
                <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{pendingDeadlines}</span>
                <span className="text-red-600 hidden sm:inline">prazos</span>
              </button>
            )}
            {canView('tarefas') && (
              <button onClick={() => handleNavigate('tarefas')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-all text-xs sm:text-sm">
                <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{pendingTasks}</span>
                <span className="text-emerald-600 hidden sm:inline">tarefas</span>
              </button>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-2">
            {urgentAlerts.length > 0 && (
              <div className="flex items-center gap-2">
                {urgentAlerts.filter(a => canView(a.action)).map((alert, index) => (
                  <button key={index} onClick={() => handleNavigate(alert.action)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                      alert.action === 'prazos' ? 'border-red-200 bg-red-50/70 text-red-700 hover:bg-red-100'
                      : alert.action === 'intimacoes' ? 'border-orange-200 bg-orange-50/70 text-orange-700 hover:bg-orange-100'
                      : 'border-amber-200 bg-amber-50/70 text-amber-700 hover:bg-amber-100'
                    }`}>
                    {alert.icon}
                    <span>{alert.action === 'prazos' ? 'Prazos' : alert.action === 'intimacoes' ? 'Intimações' : 'Financeiro'}</span>
                    <span className="font-bold">{alert.count}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={resetLayouts} title="Resetar layout dos widgets"
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            {canView('clientes') && canCreate('clientes') && (
              <button onClick={() => handleNavigate('clientes?mode=create')}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-all">
                <Plus className="w-4 h-4" />
                <span>Novo Cliente</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Banner de solicitações de acesso pendentes (apenas admin) */}
      {isAdmin && pendingAccessCount > 0 && !accessBannerDismissed && (
        <div className="mx-1 mb-3">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-amber-200 border-l-4 border-l-amber-400 shadow-sm">
            <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 leading-tight">
                {pendingAccessCount === 1
                  ? '1 solicitação de acesso aguardando aprovação'
                  : `${pendingAccessCount} solicitações de acesso aguardando aprovação`}
              </p>
            </div>
            <button
              onClick={() => onNavigateToModule?.('configuracoes', { section: 'access_requests' })}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition"
            >
              Gerenciar
            </button>
            <button
              onClick={() => setAccessBannerDismissed(true)}
              className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition"
              title="Fechar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Painel de atualizações cadastrais pendentes (apenas admin) */}
      {isAdmin && pendingProfileCount > 0 && !profileBannerDismissed && (() => {
        const FIELD_LABELS: Record<string,string> = {
          full_name:'Nome', email:'E-mail', phone:'Telefone', birth_date:'Nascimento',
          marital_status:'Estado civil', profession:'Profissão', nationality:'Nacionalidade',
          address_street:'Rua', address_number:'Número', address_neighborhood:'Bairro',
          address_city:'Cidade', address_state:'UF', address_zip_code:'CEP',
        };
        const MARITAL: Record<string,string> = {
          solteiro:'Solteiro(a)', casado:'Casado(a)', divorciado:'Divorciado(a)',
          viuvo:'Viúvo(a)', uniao_estavel:'União Estável',
        };
        const fmt = (k: string, v?: string) => {
          if (!v) return '—';
          if (k === 'marital_status') return MARITAL[v] || v;
          if (k === 'birth_date') { try { return new Date(v).toLocaleDateString('pt-BR'); } catch { return v; } }
          if (k === 'phone') { const d = v.replace(/\D/g,''); return d.length===11?`(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`:d.length===10?`(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`:v; }
          return v;
        };
        const handleApprove = async (id: string) => {
          setProfileReqProcessing(id);
          await supabase.rpc('admin_approve_profile_update', { p_request_id: id });
          await loadProfileReqs();
          setProfileReqProcessing(null);
        };
        const handleReject = async (id: string) => {
          setProfileReqProcessing(id);
          await supabase.rpc('admin_reject_profile_update', { p_request_id: id, p_reason: profileRejectReason || 'Solicitação não aprovada.' });
          await loadProfileReqs();
          setProfileReqProcessing(null);
          setProfileRejectId(null);
          setProfileRejectReason('');
        };
        return (
          <div className="mx-1 mb-3">
            <div className="rounded-xl border border-orange-200 bg-white shadow-sm overflow-hidden">
              {/* Header clicável */}
              <button
                onClick={() => setProfileBannerExpanded(e => !e)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-orange-50/50 transition border-l-4 border-l-orange-400"
              >
                <UserCheck className="w-4 h-4 text-orange-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {pendingProfileCount === 1
                      ? '1 atualização cadastral aguardando aprovação'
                      : `${pendingProfileCount} atualizações cadastrais aguardando aprovação`}
                  </p>
                  <p className="text-xs text-slate-500">Enviadas via Portal — clique para {profileBannerExpanded ? 'recolher' : 'revisar'}</p>
                </div>
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${profileBannerExpanded ? 'rotate-90' : ''}`} />
                <button onClick={(e) => { e.stopPropagation(); setProfileBannerDismissed(true); }}
                  className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition p-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              </button>

              {/* Lista expansível */}
              {profileBannerExpanded && (
                <div className="divide-y divide-slate-100 border-t border-orange-100">
                  {pendingProfileReqs.map((req) => (
                    <div key={req.id} className="px-4 py-3 space-y-2.5">
                      {/* Nome + link para ficha */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQuickViewClientId(req.client_id)}
                          className="text-sm font-semibold text-orange-600 hover:underline"
                        >
                          {req.client_name}
                        </button>
                        <span className="text-[10px] text-slate-400">{new Date(req.requested_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                      </div>

                      {/* Campos: antigo → novo */}
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(req.changes).map(([k, newVal]) => newVal && (
                          <div key={k} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200 text-xs">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mr-0.5">{FIELD_LABELS[k]||k}</span>
                            <span className="text-slate-400 line-through">{fmt(k, req.current_values?.[k])}</span>
                            <span className="text-slate-300">→</span>
                            <span className="font-semibold text-emerald-700">{fmt(k, String(newVal))}</span>
                          </div>
                        ))}
                      </div>

                      {/* Ações */}
                      {profileRejectId === req.id ? (
                        <div className="flex gap-2">
                          <input type="text" value={profileRejectReason}
                            onChange={e => setProfileRejectReason(e.target.value)}
                            placeholder="Motivo (opcional)"
                            className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-200"
                          />
                          <button onClick={() => { setProfileRejectId(null); setProfileRejectReason(''); }}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                            Cancelar
                          </button>
                          <button disabled={!!profileReqProcessing} onClick={() => handleReject(req.id)}
                            className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-600 disabled:opacity-60">
                            {profileReqProcessing === req.id ? '...' : 'Confirmar'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button disabled={!!profileReqProcessing}
                            onClick={() => { setProfileRejectId(req.id); setProfileRejectReason(''); }}
                            className="flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                            <UserX className="w-3 h-3" /> Rejeitar
                          </button>
                          <button disabled={!!profileReqProcessing}
                            onClick={() => handleApprove(req.id)}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                            {profileReqProcessing === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
                            Aprovar e aplicar
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Banner de chave DataJud inválida (apenas admin) */}
      {isAdmin && datajudKeyInvalid && !datajudKeyBannerDismissed && (
        <div className="mx-1 mb-3">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-red-200 border-l-4 border-l-red-500 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 leading-tight">
                Chave de API DataJud (CNJ) inválida ou expirada
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                As consultas de movimentações processuais estão falhando. Atualize a chave em Configurações → DJEN.
              </p>
            </div>
            <button
              onClick={() => onNavigateToModule?.('configuracoes', { section: 'djen' })}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-red-300 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 transition"
            >
              Atualizar chave
            </button>
            <button
              onClick={() => setDatajudKeyBannerDismissed(true)}
              className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition"
              title="Fechar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Notificações de acesso negado não lidas (visível para não-admin — persiste até marcar como lida) */}
      {!isAdmin && userDeniedNotifs.length > 0 && (
        <div className="mx-1 mb-3 space-y-2">
          {userDeniedNotifs.map(notif => (
            <div key={notif.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-red-200 border-l-4 border-l-red-400 shadow-sm">
              <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 leading-tight">
                  Acesso ao módulo <span className="font-bold">{notif.module_label}</span> foi negado
                </p>
                {notif.admin_notes && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">Motivo: {notif.admin_notes}</p>
                )}
              </div>
              <button
                onClick={async () => {
                  // Marcar como lida no banco e navegar
                  import('../services/userNotification.service').then(({ userNotificationService }) => {
                    userNotificationService.markAsRead(notif.id).catch(() => {});
                  });
                  setUserDeniedNotifs(prev => prev.filter(n => n.id !== notif.id));
                  onNavigateToModule?.(notif.module_key);
                }}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition"
              >
                Ver detalhes
              </button>
              <button
                onClick={async () => {
                  // Marcar como lida no banco — não volta mais
                  import('../services/userNotification.service').then(({ userNotificationService }) => {
                    userNotificationService.markAsRead(notif.id).catch(() => {});
                  });
                  setUserDeniedNotifs(prev => prev.filter(n => n.id !== notif.id));
                }}
                className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition"
                title="Marcar como visto"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Draggable / Resizable Widget Grid */}
      <div ref={gridContainerRef} className="w-full" style={{ width: '100%' }}>
      {gridMounted && (
      <ResponsiveGridLayout
        width={gridWidth}
        layouts={activeLayouts}
        breakpoints={{ lg: 1100, md: 768, sm: 480, xs: 320, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={ROW_HEIGHT}
        margin={gridWidth < 480 ? [8, 8] as [number, number] : [12, 12] as [number, number]}
        containerPadding={[0, 0] as [number, number]}
        dragConfig={{ enabled: gridWidth >= 480, handle: '.widget-header', cancel: 'button,a', bounded: false, threshold: 3 }}
        resizeConfig={{ enabled: gridWidth >= 480, handles: ['se'] }}
        onLayoutChange={handleLayoutsChange}
        compactor={verticalCompactor}
      >
        {/* ── Agenda ── */}
        {visibleWidgetKeys.has('agenda') && (
          <div key="agenda" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="widget-header px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 leading-tight">
                  {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                </h3>
                <p className="text-[10px] text-slate-400 leading-tight capitalize">
                  {upcomingEvents.length === 0 ? 'Sem eventos esta semana' : `${upcomingEvents.length} evento${upcomingEvents.length !== 1 ? 's' : ''} esta semana`}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => loadDashboardData(true)} title="Atualizar" className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition text-slate-400">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleNavigate('agenda')} className="h-7 px-2.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-semibold flex items-center gap-0.5 transition">
                  <span className="hidden sm:inline">Ver minha agenda</span>
                  <span className="sm:hidden">Agenda</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
                {gridWidth >= 480 && <GripVertical className="w-4 h-4 text-slate-300 ml-0.5 flex-shrink-0" />}
              </div>
            </div>

            {/* Mini week strip — today + 6 upcoming days */}
            {(() => {
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const weekDays = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(today); d.setDate(today.getDate() + i); return d;
              });
              const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
              const eventDateSet = new Set(upcomingEvents.map(ev => {
                const d = parseLocalDateTime(ev.start_at); d.setHours(0, 0, 0, 0);
                return d.toISOString().slice(0, 10);
              }));
              return (
                <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
                  <div className="flex justify-between gap-1">
                    {weekDays.map(day => {
                      const isToday = day.getTime() === today.getTime();
                      const dateKey = day.toISOString().slice(0, 10);
                      const hasEvt = eventDateSet.has(dateKey);
                      return (
                        <div key={dateKey} className="flex flex-col items-center gap-0.5 flex-1">
                          <span className={`text-[9px] font-semibold uppercase tracking-wide ${isToday ? 'text-amber-600' : 'text-slate-400'}`}>
                            {DAY_ABBR[day.getDay()]}
                          </span>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                            isToday ? 'bg-amber-500 shadow-sm shadow-amber-200' : 'hover:bg-slate-100'
                          }`}>
                            <span className={`text-xs font-bold tabular-nums ${isToday ? 'text-white' : 'text-slate-700'}`}>
                              {day.getDate()}
                            </span>
                          </div>
                          <div className={`w-1 h-1 rounded-full ${hasEvt ? (isToday ? 'bg-amber-300' : 'bg-amber-400') : 'bg-transparent'}`} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Event list */}
            {upcomingEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 flex-1">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-slate-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-500">Semana livre</p>
                  <p className="text-xs text-slate-400 mt-0.5">Nenhum compromisso agendado</p>
                </div>
                <button onClick={() => handleNavigate('agenda')}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition shadow-sm shadow-amber-200">
                  + Novo compromisso
                </button>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto scroll-hidden">
                {agendaGroups.map((group) => (
                  <div key={group.dateKey}>
                    {/* Day separator */}
                    <div className={`flex items-center gap-3 px-4 py-1.5 ${
                      group.isToday ? 'bg-amber-500' : 'bg-slate-50 border-t border-slate-100'
                    }`}>
                      <span className={`text-[11px] font-bold capitalize flex-1 ${group.isToday ? 'text-white' : 'text-slate-600'}`}>
                        {group.label}
                      </span>
                      <span className={`text-[10px] ${group.isToday ? 'text-amber-100' : 'text-slate-400'}`}>
                        {group.dateLabel}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        group.isToday ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-500'
                      }`}>
                        {group.events.length}
                      </span>
                    </div>

                    {/* Events */}
                    {group.events.map(ev => {
                      const d = parseLocalDateTime(ev.start_at);
                      const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
                      const time = hasTime ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
                      const stripe = typeDot[ev.type] ?? typeDot.other;
                      const tag = typeTag[ev.type] ?? typeTag.other;
                      return (
                        <div key={ev.id} onClick={() => setSelectedEvent(ev)}
                          className="flex items-stretch hover:bg-amber-50/30 cursor-pointer transition-colors border-b border-slate-50 last:border-b-0 group">
                          <div className={`w-0.5 flex-shrink-0 ${stripe}`} />
                          <div className="flex items-center gap-2.5 px-3 py-2.5 flex-1 min-w-0">
                            <div className="flex-shrink-0 w-10 text-right">
                              {time ? (
                                <span className="text-[11px] font-bold text-slate-600 tabular-nums">{time}</span>
                              ) : (
                                <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wide">dia todo</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-800 truncate leading-snug group-hover:text-amber-700 transition-colors">{ev.title}</p>
                              {(ev.clientName || ev.description) && (
                                <p className="text-[10px] text-slate-400 truncate mt-0.5">{ev.clientName || ev.description}</p>
                              )}
                            </div>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${tag.bg} ${tag.text}`}>
                              {tag.label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tarefas ── */}
        {visibleWidgetKeys.has('tarefas') && (
          <div key="tarefas" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
            <div className="widget-header p-2.5 sm:p-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">Tarefas</h2>
                  <p className="text-[10px] text-slate-500">{recentTasks.length} pendente{recentTasks.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleNavigate('tarefas')} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1">
                  Ver todas <ChevronRight className="w-3.5 h-3.5" />
                </button>
                {gridWidth >= 480 && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scroll-hidden p-2 sm:p-3">
              {recentTasks.length === 0 ? (
                <div className="text-center py-4">
                  <CheckSquare className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-500 text-xs">Nenhuma tarefa pendente</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {recentTasks.map(task => (
                    <div key={task.id} onClick={() => handleNavigate('tarefas')}
                      className="group flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                      <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <CheckSquare className="w-3 h-3 text-emerald-600" />
                      </div>
                      <p className="flex-1 text-xs font-medium text-slate-800 truncate">{task.title}</p>
                      <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Ações Rápidas ── */}
        {visibleWidgetKeys.has('acoes') && (
          <div key="acoes" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
            <div className="widget-header p-2.5 sm:p-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">Ações rápidas</h3>
                  <p className="text-[10px] sm:text-xs text-slate-500">Crie itens em 1 clique</p>
                </div>
              </div>
              {gridWidth >= 480 && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
            </div>
            <div className="flex-1 overflow-y-auto scroll-hidden p-2 sm:p-3">
              <QuickActions onNavigate={handleNavigate} canView={canView} canCreate={canCreate} />
            </div>
          </div>
        )}

        {/* ── Financeiro ── */}
        {visibleWidgetKeys.has('financeiro') && (
          <div key="financeiro" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
              <div className="widget-header p-3 sm:p-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-semibold text-slate-900">Financeiro</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500">Resumo do mês</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleNavigate('financeiro')}
                    className="text-sm font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                    Ver <ChevronRight className="w-4 h-4" />
                  </button>
                  {gridWidth >= 480 && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scroll-hidden p-3 sm:p-4 space-y-3">
                {!financialStats && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-6">
                    <Wallet className="w-8 h-8 text-slate-300 mb-2" />
                    <p className="text-xs text-slate-400">Nenhum dado financeiro</p>
                  </div>
                )}
                {financialStats && (() => {
                  const s = financialStats;
                  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-emerald-500" />
                          <span className="text-sm text-slate-600">Recebido</span>
                        </div>
                        <span className="text-sm font-semibold text-emerald-600">{fmt(s.monthly_fees_received)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <PiggyBank className="w-4 h-4 text-amber-500" />
                          <span className="text-sm text-slate-600">A receber</span>
                        </div>
                        <span className="text-sm font-semibold text-amber-600">{fmt(s.monthly_fees_pending)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                          <span className="text-sm text-slate-600">Em atraso</span>
                        </div>
                        <span className="text-sm font-semibold text-red-600">{fmt(s.total_overdue)}</span>
                      </div>
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-slate-500"><strong className="text-slate-700">{s.paid_installments}</strong> recebidas</span>
                        <span className="text-amber-600"><strong>{s.pending_installments}</strong> pendentes</span>
                        <span className="text-red-600"><strong>{s.overdue_installments}</strong> vencidas</span>
                      </div>
                    </>
                  );
                })()}
              </div>
          </div>
        )}

        {/* ── Prazos ── */}
        {visibleWidgetKeys.has('prazos') && (
          <div key="prazos" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
            <div className="widget-header px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-rose-100 flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-600" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">Prazos</h3>
                  <p className="text-[10px] text-slate-400">{upcomingDeadlines.length} pendente{upcomingDeadlines.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleNavigate('prazos')} className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-0.5 transition">
                  Ver todos <ChevronRight className="w-3 h-3" />
                </button>
                {gridWidth >= 480 && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
              </div>
            </div>
            {upcomingDeadlines.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-1.5 flex-1">
                <CalendarDays className="w-8 h-8 text-slate-200" />
                <p className="text-xs text-slate-400">Nenhum prazo pendente</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto scroll-hidden divide-y divide-slate-50">
                {upcomingDeadlines.map(deadline => {
                  const cName = deadline.client_id ? clientMap.get(deadline.client_id)?.full_name : null;
                  const due = parseLocalDateTime(deadline.due_date!);
                  const todayMs = new Date(); todayMs.setHours(0, 0, 0, 0);
                  const diffDays = Math.ceil((due.getTime() - todayMs.getTime()) / 86400000);
                  const isToday   = diffDays === 0;
                  const isUrgent  = diffDays <= 2 && diffDays >= 0;
                  const isOverdue = diffDays < 0;
                  return (
                    <div key={deadline.id} onClick={() => handleNavigate('prazos')}
                      className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 hover:bg-slate-50 cursor-pointer transition-colors">
                      <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${
                        isOverdue ? 'bg-red-600 text-white' : isToday ? 'bg-rose-500 text-white' : isUrgent ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        <span className="text-sm font-bold leading-none">{due.getDate()}</span>
                        <span className="text-[9px] uppercase leading-none mt-0.5">{due.toLocaleDateString('pt-BR', { month: 'short' })}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{deadline.title}</p>
                        <p className="text-[10px] text-slate-400 truncate">{cName || 'Sem cliente'}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg flex-shrink-0 ${
                        isOverdue ? 'bg-red-100 text-red-700' :
                        isToday   ? 'bg-rose-100 text-rose-700' :
                        isUrgent  ? 'bg-orange-100 text-orange-700' :
                        deadline.priority === 'urgente' ? 'bg-red-100 text-red-700' :
                        deadline.priority === 'alta'    ? 'bg-orange-100 text-orange-700' :
                        deadline.priority === 'media'   ? 'bg-amber-100 text-amber-700' :
                                                          'bg-slate-100 text-slate-500'
                      }`}>
                        {isOverdue ? 'Vencido' : isToday ? 'Hoje' : `${diffDays}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Intimações ── */}
        {visibleWidgetKeys.has('intimacoes') && (
          <div key="intimacoes" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
            <div className="widget-header px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">Intimações</h3>
                  <p className="text-[10px] text-slate-400">{djenIntimacoes.length} pendente{djenIntimacoes.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleNavigate('intimacoes')} className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-0.5 transition">
                  Ver todas <ChevronRight className="w-3 h-3" />
                </button>
                {gridWidth >= 480 && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
              </div>
            </div>
            {djenIntimacoes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-1.5 flex-1">
                <Scale className="w-8 h-8 text-slate-200" />
                <p className="text-xs text-slate-400">Nenhuma intimação pendente</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto scroll-hidden divide-y divide-slate-50">
                {djenIntimacoes.slice(0, 5).map(intimacao => (
                  <div key={intimacao.id} onClick={() => setSelectedIntimacao(intimacao)}
                    className="px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 truncate">
                        {intimacao.tipo_comunicacao || 'Intimação'}
                      </span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {intimacao.data_disponibilizacao ? new Date(intimacao.data_disponibilizacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 truncate">{intimacao.numero_processo_mascara || intimacao.numero_processo}</p>
                    {intimacao.nome_orgao && <p className="text-[10px] text-slate-400 truncate">{intimacao.nome_orgao}</p>}
                    {intimacao.polo_ativo && <p className="text-[10px] text-slate-500 truncate mt-0.5"><span className="text-slate-400">Autor:</span> {intimacao.polo_ativo}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Processos Aguardando ── */}
        {visibleWidgetKeys.has('processos') && (
          <div key="processos" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
            <div className="widget-header px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">Aguardando Confecção</h3>
                  <p className="text-[10px] text-slate-400">{awaitingDraftProcessesList.length} processo{awaitingDraftProcessesList.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleNavigate('processos')} className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 flex items-center gap-0.5 transition">
                  Ver todos <ChevronRight className="w-3 h-3" />
                </button>
                {gridWidth >= 480 && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
              </div>
            </div>
            {awaitingDraftProcessesList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-1.5 flex-1">
                <FileText className="w-8 h-8 text-slate-200" />
                <p className="text-xs text-slate-400">Nenhum processo aguardando</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto scroll-hidden divide-y divide-slate-50">
                {awaitingDraftProcessesList.slice(0, 6).map(process => {
                  const cName = process.client_id ? clientMap.get(process.client_id)?.full_name : null;
                  const since = process.distributed_at || process.created_at;
                  const sinceDays = since ? Math.floor((Date.now() - new Date(since).getTime()) / 86400000) : null;
                  return (
                    <div key={process.id} onClick={() => handleNavigate('processos')}
                      className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 hover:bg-slate-50 cursor-pointer transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{cName || 'Cliente'}</p>
                        {sinceDays !== null && <p className="text-[10px] text-slate-400">Há {sinceDays} dia{sinceDays !== 1 ? 's' : ''}</p>}
                      </div>
                      {process.priority === 'urgente' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-red-100 text-red-700 flex-shrink-0">Urgente</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Requerimentos ── */}
        {visibleWidgetKeys.has('requerimentos') && (
          <div key="requerimentos" className="bg-white rounded-xl border border-slate-200/60 overflow-hidden flex flex-col">
            <div className="widget-header px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-violet-600" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900 truncate">Requerimentos</h3>
                  <p className="text-[10px] text-slate-400">{pendingRequirementsList.length} pendente{pendingRequirementsList.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleNavigate('requerimentos')} className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-0.5 transition">
                  Ver todos <ChevronRight className="w-3 h-3" />
                </button>
                {gridWidth >= 480 && <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
              </div>
            </div>
            {pendingRequirementsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-1.5 flex-1">
                <Target className="w-8 h-8 text-slate-200" />
                <p className="text-xs text-slate-400">Nenhum requerimento pendente</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto scroll-hidden divide-y divide-slate-50">
                {pendingRequirementsList.slice(0, 6).map(req => {
                  const since = req.entry_date;
                  const sinceDays = since ? Math.floor((Date.now() - new Date(since).getTime()) / 86400000) : null;
                  return (
                    <div key={req.id} onClick={() => handleNavigate('requerimentos')}
                      className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 hover:bg-slate-50 cursor-pointer transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-violet-600">{(req.beneficiary || 'R').charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{req.beneficiary || 'Beneficiário'}</p>
                        {sinceDays !== null && <p className="text-[10px] text-slate-400">Entrada há {sinceDays} dia{sinceDays !== 1 ? 's' : ''}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </ResponsiveGridLayout>
      )}
      </div>

      {/* Modal de Detalhes do Evento */}
      {selectedEvent && (() => {
        const ev = selectedEvent;
        const d = parseLocalDateTime(ev.start_at);
        const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
        const typeLabels: Record<string, string> = {
          meeting: 'Reunião', hearing: 'Audiência', payment: 'Pagamento',
          deadline: 'Prazo', task: 'Tarefa', pericia: 'Perícia', other: 'Evento',
        };
        const typeBadge: Record<string, string> = {
          meeting: 'bg-amber-100 text-amber-700', hearing: 'bg-red-100 text-red-700',
          payment: 'bg-emerald-100 text-emerald-700', deadline: 'bg-rose-100 text-rose-700',
          task: 'bg-violet-100 text-violet-700', other: 'bg-slate-100 text-slate-600',
        };
        const accentBar: Record<string, string> = {
          meeting: 'bg-amber-500', hearing: 'bg-red-500',
          payment: 'bg-emerald-500', deadline: 'bg-rose-500',
          task: 'bg-violet-500', other: 'bg-slate-400',
        };
        const cleanDesc = ev.description
          ? ev.description
              .replace(/\[agreement_id:[^\]]+\]/g, '')
              .replace(/\[installment:\d+\]/g, '')
              .replace(/\[inadimplencia\]/g, '')
              .split('\n').filter(l => !/Valor:\s*R\$\s*(NaN|undefined|null|--)/.test(l))
              .join('\n').trim()
          : '';
        const agmMatch = ev.description?.match(/\[agreement_id:([^\]]+)\]/);
        const instMatch = ev.description?.match(/\[installment:(\d+)\]/);
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 py-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedEvent(null)} />
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden max-h-[90vh]">
              <div className={`h-1.5 w-full ${accentBar[ev.type] ?? accentBar.other}`} />
              <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeBadge[ev.type] ?? typeBadge.other}`}>
                    {typeLabels[ev.type] ?? 'Evento'}
                  </span>
                  <h3 className="mt-1.5 text-base font-semibold text-slate-900 leading-snug">{ev.title}</h3>
                </div>
                <button onClick={() => setSelectedEvent(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-3 overflow-y-auto scroll-hidden">
                <div className="flex items-start gap-3 text-sm">
                  <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-slate-700 capitalize">
                      {d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                    {hasTime && <p className="text-slate-500 text-sm">{d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>}
                  </div>
                </div>
                {(ev.clientId || ev.clientName) && (
                  <div className="flex items-center gap-3 text-sm">
                    <Users className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    {ev.clientId ? (
                      <button type="button"
                        onClick={() => { setSelectedEvent(null); handleNavigate(`clientes?mode=details&entityId=${ev.clientId}`); }}
                        className="font-semibold text-amber-600 hover:text-amber-700 hover:underline transition text-left">
                        {ev.clientName || 'Ver cliente'}
                      </button>
                    ) : (
                      <span className="text-slate-700">{ev.clientName}</span>
                    )}
                  </div>
                )}
                {cleanDesc && (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{cleanDesc}</p>
                  </div>
                )}
                {agmMatch && instMatch && (
                  <button
                    onClick={() => { setSelectedEvent(null); handleNavigate(`financeiro?entityId=${agmMatch[1]}&installmentNumber=${instMatch[1]}`); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-xl transition">
                    <DollarSign className="w-4 h-4" />
                    Registrar Pagamento
                  </button>
                )}
              </div>
              <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
                <button onClick={() => setSelectedEvent(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition">
                  Fechar
                </button>
                <button onClick={() => { setSelectedEvent(null); handleNavigate('agenda'); }}
                  className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition">
                  Ver na Agenda
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal de Detalhes da Intimação */}
      {selectedIntimacao && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-2 sm:px-4 py-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedIntimacao(null)} aria-hidden="true" />
          <div className="relative w-full max-w-lg max-h-[90vh] sm:max-h-[92vh] bg-white rounded-xl sm:rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1.5 sm:h-2 w-full bg-orange-500" />
            <div className="px-4 sm:px-6 py-3 sm:py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-2 sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">DJEN</p>
                <h3 className="mt-1 text-base sm:text-lg font-semibold text-slate-900 truncate">{selectedIntimacao.tipo_comunicacao || 'Comunicação'}</h3>
                <span className="inline-flex items-center gap-1 mt-2 sm:mt-3 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-orange-100 text-orange-700 text-[10px] sm:text-xs font-semibold uppercase">
                  {selectedIntimacao.sigla_tribunal}
                </span>
              </div>
              <button onClick={() => setSelectedIntimacao(null)}
                className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg sm:rounded-xl transition">
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            <div className="p-3 sm:p-6 space-y-3 sm:space-y-4 overflow-y-auto">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                <div className="flex-1">
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">Data de Disponibilização:</span>
                  <span className="text-xs sm:text-sm text-slate-600 ml-2">
                    {new Date(selectedIntimacao.data_disponibilizacao).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-xs sm:text-sm font-semibold text-slate-700">Processo:</span>
                <p className="text-xs sm:text-sm text-slate-600 mt-1">{selectedIntimacao.numero_processo_mascara || selectedIntimacao.numero_processo}</p>
              </div>
              {selectedIntimacao.nome_orgao && (
                <div>
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">Órgão:</span>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1">{selectedIntimacao.nome_orgao}</p>
                </div>
              )}
              {selectedIntimacao.texto && (
                <div>
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">Texto:</span>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1 max-h-40 overflow-y-auto">{selectedIntimacao.texto}</p>
                </div>
              )}
              <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
                <button onClick={() => setSelectedIntimacao(null)}
                  className="w-full sm:w-auto px-4 py-2 text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-800 transition">
                  Fechar
                </button>
                <button onClick={() => { setSelectedIntimacao(null); handleNavigate('intimacoes'); }}
                  className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg sm:rounded-xl transition">
                  Ver Todas Intimações
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>

    {/* Modal rápido de ficha do cliente */}
    {quickViewClientId && (
      <ClientQuickViewModal
        clientId={quickViewClientId}
        onClose={() => setQuickViewClientId(null)}
        onNavigateToModule={onNavigateToModule}
      />
    )}
    </>
  );
};

export default Dashboard;
