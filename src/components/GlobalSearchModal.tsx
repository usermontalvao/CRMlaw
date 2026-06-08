import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Search, X, FileText, Users, Loader2, ChevronRight, ChevronLeft, ArrowRight,
  ClipboardList, Calendar, CheckSquare, AlarmClock, DollarSign, FolderOpen,
  Clock, Zap, Gavel, PenTool, Sparkles, CornerDownLeft, LayoutGrid,
  Phone, Mail, Hash, Building2, Tag, User, CreditCard, Copy, Check,
  Scale, MessageCircle, Terminal, Plus, Navigation, Trash2, Sun, Moon,
  UserPlus, FileSignature, BookOpen, Settings, LogOut, RefreshCw,
  ClipboardCheck, Banknote, FilePlus, CalendarPlus, UserCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { djenLocalService } from '../services/djenLocal.service';
import { requirementService } from '../services/requirement.service';
import { calendarService } from '../services/calendar.service';
import { taskService } from '../services/task.service';
import { deadlineService } from '../services/deadline.service';
import { financialService } from '../services/financial.service';
import { cloudService } from '../services/cloud.service';
import { signatureService } from '../services/signature.service';
import { matchesNormalizedSearch } from '../utils/search';
import type { Client } from '../types/client.types';

// ─── Module-level cache ───────────────────────────────────────────────────────

interface SearchData {
  processes: Awaited<ReturnType<typeof processService.listProcesses>>;
  clients: Client[];
  intimacoes: Awaited<ReturnType<typeof djenLocalService.listComunicacoes>>;
  requirements: Awaited<ReturnType<typeof requirementService.listRequirements>>;
  events: Awaited<ReturnType<typeof calendarService.listEvents>>;
  tasks: Awaited<ReturnType<typeof taskService.listTasks>>;
  deadlines: Awaited<ReturnType<typeof deadlineService.listDeadlines>>;
  agreements: Awaited<ReturnType<typeof financialService.listAgreements>>;
  rootFolders: Awaited<ReturnType<typeof cloudService.listFolders>>;
  signatures: Awaited<ReturnType<typeof signatureService.listRequests>>;
}

let _cache: { data: SearchData; fetchedAt: number } | null = null;
let _inflight: Promise<SearchData> | null = null; // deduplicação: evita 2 fetches simultâneos
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getSearchData(force = false): Promise<SearchData> {
  if (!force && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL) {
    return _cache.data;
  }

  // Se já há uma requisição em andamento (ex: priming + busca simultâneos), reutilizá-la
  if (_inflight) return _inflight;

  // Invalidar caches dos services para garantir dados frescos após idle
  processService.invalidateCache();
  clientService.invalidateCache();
  requirementService.invalidateCache();
  deadlineService.invalidateCache();

  _inflight = Promise.all([
    processService.listProcesses().catch(() => [] as Awaited<ReturnType<typeof processService.listProcesses>>),
    clientService.listClients().catch(() => [] as Client[]),
    djenLocalService.listComunicacoes({}).catch(() => [] as Awaited<ReturnType<typeof djenLocalService.listComunicacoes>>),
    requirementService.listRequirements().catch(() => []),
    calendarService.listEvents().catch(() => [] as Awaited<ReturnType<typeof calendarService.listEvents>>),
    taskService.listTasks().catch(() => []),
    deadlineService.listDeadlines().catch(() => []),
    financialService.listAgreements().catch(() => []),
    cloudService.listFolders(null, false).catch(() => [] as Awaited<ReturnType<typeof cloudService.listFolders>>),
    signatureService.listRequests().catch(() => [] as Awaited<ReturnType<typeof signatureService.listRequests>>),
  ]).then(([processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders, signatures]) => {
    const data: SearchData = { processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders, signatures };
    _cache = { data, fetchedAt: Date.now() };
    _inflight = null;
    return data;
  }).catch((err) => {
    _inflight = null;
    throw err;
  });

  return _inflight;
}

// Invalidar cache ao abrir (pre-warm na abertura)
export function invalidateSearchCache() { _cache = null; }

// Invalida automaticamente o cache quando o tab fica visível após longa inatividade (>4 min)
let _hiddenAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _hiddenAt = Date.now();
    } else if (_hiddenAt > 0 && Date.now() - _hiddenAt > 4 * 60 * 1000) {
      // Ficou escondido por mais de 4 minutos → forçar refresh na próxima busca
      _cache = null;
      _hiddenAt = 0;
    }
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultType =
  | 'cliente' | 'processo' | 'processo-via-cliente' | 'intimacao'
  | 'requerimento' | 'prazo' | 'agenda' | 'tarefa' | 'financeiro' | 'cloud' | 'assinatura';

interface DetailRow { icon: React.ElementType; label: string; value: string }

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  meta?: string;
  score: number; // Higher = more relevant
  navModule: string;
  navParams?: Record<string, string>;
  details?: DetailRow[];
  clientPhotoPath?: string | null;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: string, params?: Record<string, string>) => void;
}

// ─── Command Palette ──────────────────────────────────────────────────────────

type CmdCategory = 'criar' | 'navegar' | 'sistema';

interface Cmd {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  category: CmdCategory;
  shortcut?: string;
  keywords: string[];
  moduleKey?: string; // for permission check
  action: (ctx: { onNavigate: (m: string, p?: Record<string,string>) => void; onClose: () => void; userId?: string }) => void;
}

const CMD_CATEGORY_LABEL: Record<CmdCategory, string> = {
  criar:   'Criar',
  navegar: 'Navegar',
  sistema: 'Sistema',
};

const ALL_COMMANDS: Cmd[] = [
  // ── Criar ──────────────────────────────────────────────────────────────────
  { id:'new-client',     label:'Novo Cliente',              description:'Cadastrar um novo cliente',             icon:UserPlus,      category:'criar',   keywords:['novo','cliente','cadastrar','pf','pj'],                                 moduleKey:'clientes',      action:({onNavigate,onClose})=>{ onNavigate('clientes',{mode:'create'}); onClose(); } },
  { id:'new-process',    label:'Novo Processo',             description:'Abrir um novo processo judicial',       icon:FilePlus,      category:'criar',   keywords:['novo','processo','judicial','abrir'],                                    moduleKey:'processos',     action:({onNavigate,onClose})=>{ onNavigate('processos',{mode:'create'}); onClose(); } },
  { id:'new-deadline',   label:'Novo Prazo',                description:'Cadastrar um prazo ou intimação',       icon:AlarmClock,    category:'criar',   keywords:['novo','prazo','intimacao','vencimento'],                                 moduleKey:'prazos',        action:({onNavigate,onClose})=>{ onNavigate('prazos',{mode:'create'}); onClose(); } },
  { id:'new-task',       label:'Nova Tarefa',               description:'Criar uma tarefa para a equipe',        icon:ClipboardCheck,category:'criar',   keywords:['nova','tarefa','criar','equipe','todo'],                                 moduleKey:'tarefas',       action:({onNavigate,onClose})=>{ onNavigate('tarefas',{mode:'create'}); onClose(); } },
  { id:'new-event',      label:'Novo Evento na Agenda',     description:'Agendar audiência, reunião ou perícia', icon:CalendarPlus,  category:'criar',   keywords:['novo','evento','agenda','audiencia','reuniao','pericia'],               moduleKey:'agenda',        action:({onNavigate,onClose})=>{ onNavigate('agenda',{mode:'create'}); onClose(); } },
  { id:'new-agreement',  label:'Novo Acordo Financeiro',    description:'Registrar contrato ou acordo',          icon:Banknote,      category:'criar',   keywords:['novo','acordo','financeiro','contrato','honorarios'],                   moduleKey:'financeiro',    action:({onNavigate,onClose})=>{ onNavigate('financeiro',{mode:'payment'}); onClose(); } },
  { id:'new-requirement',label:'Novo Requerimento',         description:'Iniciar requerimento de benefício',     icon:ClipboardList, category:'criar',   keywords:['novo','requerimento','beneficio','inss','previdencia'],                 moduleKey:'requerimentos',  action:({onNavigate,onClose})=>{ onNavigate('requerimentos',{mode:'create'}); onClose(); } },
  { id:'new-signature',  label:'Nova Solicitação de Assinatura', description:'Enviar documento para assinatura', icon:FileSignature, category:'criar',   keywords:['nova','assinatura','documento','assinar','enviar'],                     moduleKey:'assinaturas',   action:({onNavigate,onClose})=>{ onNavigate('assinaturas'); onClose(); } },
  // ── Navegar ─────────────────────────────────────────────────────────────────
  { id:'go-clients',     label:'Ir para Clientes',          description:'Módulo de gestão de clientes',          icon:Users,         category:'navegar', keywords:['clientes','ir','abrir','modulo'],                                       moduleKey:'clientes',      action:({onNavigate,onClose})=>{ onNavigate('clientes'); onClose(); } },
  { id:'go-processes',   label:'Ir para Processos',         description:'Módulo de processos judiciais',         icon:FileText,      category:'navegar', keywords:['processos','ir','abrir','judicial'],                                    moduleKey:'processos',     action:({onNavigate,onClose})=>{ onNavigate('processos'); onClose(); } },
  { id:'go-deadlines',   label:'Ir para Prazos',            description:'Módulo de prazos e intimações',         icon:AlarmClock,    category:'navegar', keywords:['prazos','ir','abrir','prazo'],                                          moduleKey:'prazos',        action:({onNavigate,onClose})=>{ onNavigate('prazos'); onClose(); } },
  { id:'go-agenda',      label:'Ir para Agenda',            description:'Calendário de audiências e eventos',    icon:Calendar,      category:'navegar', keywords:['agenda','ir','abrir','calendario','audiencias'],                        moduleKey:'agenda',        action:({onNavigate,onClose})=>{ onNavigate('agenda'); onClose(); } },
  { id:'go-tasks',       label:'Ir para Tarefas',           description:'Módulo de tarefas da equipe',           icon:CheckSquare,   category:'navegar', keywords:['tarefas','ir','abrir'],                                                 moduleKey:'tarefas',       action:({onNavigate,onClose})=>{ onNavigate('tarefas'); onClose(); } },
  { id:'go-financial',   label:'Ir para Financeiro',        description:'Acordos, honorários e receitas',        icon:DollarSign,    category:'navegar', keywords:['financeiro','ir','abrir','honorarios','acordo'],                        moduleKey:'financeiro',    action:({onNavigate,onClose})=>{ onNavigate('financeiro'); onClose(); } },
  { id:'go-cloud',       label:'Ir para Cloud',             description:'Documentos e pastas na nuvem',          icon:FolderOpen,    category:'navegar', keywords:['cloud','ir','abrir','documentos','pasta','arquivos'],                   moduleKey:'documentos',    action:({onNavigate,onClose})=>{ onNavigate('cloud'); onClose(); } },
  { id:'go-signatures',  label:'Ir para Assinaturas',       description:'Assinaturas digitais de documentos',    icon:PenTool,       category:'navegar', keywords:['assinaturas','ir','abrir','digital'],                                   moduleKey:'assinaturas',   action:({onNavigate,onClose})=>{ onNavigate('assinaturas'); onClose(); } },
  { id:'go-requirements',label:'Ir para Requerimentos',     description:'Requerimentos de benefícios previdenciários', icon:ClipboardList,category:'navegar',keywords:['requerimentos','ir','abrir','inss','beneficio'],                  moduleKey:'requerimentos',  action:({onNavigate,onClose})=>{ onNavigate('requerimentos'); onClose(); } },
  { id:'go-profile',     label:'Ir para Perfil',            description:'Configurações da sua conta',            icon:UserCheck,     category:'navegar', keywords:['perfil','conta','configuracoes','usuario'],                             action:({onNavigate,onClose})=>{ onNavigate('profile'); onClose(); } },
  { id:'go-changelog',   label:'Ir para Changelog',         description:'Histórico de atualizações do sistema',  icon:BookOpen,      category:'navegar', keywords:['changelog','atualizacoes','versao','novidades','historico'],            action:({onNavigate,onClose})=>{ onNavigate('docs'); onClose(); } },
  // ── Sistema ─────────────────────────────────────────────────────────────────
  { id:'toggle-dark',    label:'Alternar Tema',             description:'Mudar entre modo claro e escuro',       icon:Moon,          category:'sistema', keywords:['tema','dark','escuro','claro','night','light','alternar'],              action:({onClose})=>{ document.documentElement.classList.toggle('dark'); onClose(); } },
  { id:'clear-history',  label:'Limpar Histórico de Busca', description:'Apagar buscas recentes salvas',         icon:Trash2,        category:'sistema', keywords:['limpar','historico','busca','recentes','apagar'],                       action:({userId,onClose})=>{ localStorage.removeItem(userId?`globalSearch_recent_${userId}`:'globalSearch_recent_anon'); onClose(); } },
  { id:'reload-cache',   label:'Recarregar Dados',          description:'Forçar atualização do cache de busca',  icon:RefreshCw,     category:'sistema', keywords:['recarregar','atualizar','cache','refresh','dados'],                     action:({onClose})=>{ _cache = null; onClose(); } },
  { id:'copy-url',       label:'Copiar URL da Página',      description:'Copiar endereço atual para área de transferência', icon:Copy, category:'sistema', keywords:['copiar','url','link','endereco','clipboard'],                  action:({onClose})=>{ navigator.clipboard.writeText(window.location.href); onClose(); } },
];

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ResultType, {
  label: string; icon: React.ElementType; color: string; border: string; group: string;
}> = {
  cliente:               { label: 'Cliente',      icon: Users,         color: 'text-slate-600 bg-slate-100',    border: 'border-slate-200',   group: 'Clientes'      },
  processo:              { label: 'Processo',     icon: FileText,      color: 'text-amber-600 bg-amber-50',     border: 'border-amber-200',   group: 'Processos'     },
  'processo-via-cliente':{ label: 'Processo',     icon: FileText,      color: 'text-amber-600 bg-amber-50',     border: 'border-amber-200',   group: 'Processos'     },
  intimacao:             { label: 'Intimação',    icon: Gavel,         color: 'text-orange-600 bg-orange-50',   border: 'border-orange-200',  group: 'Intimações'    },
  requerimento:          { label: 'Requerimento', icon: ClipboardList, color: 'text-purple-600 bg-purple-50',   border: 'border-purple-200',  group: 'Requerimentos' },
  prazo:                 { label: 'Prazo',        icon: AlarmClock,    color: 'text-red-600 bg-red-50',         border: 'border-red-200',     group: 'Prazos'        },
  agenda:                { label: 'Agenda',       icon: Calendar,      color: 'text-teal-600 bg-teal-50',       border: 'border-teal-200',    group: 'Agenda'        },
  tarefa:                { label: 'Tarefa',       icon: CheckSquare,   color: 'text-sky-600 bg-sky-50',         border: 'border-sky-200',     group: 'Tarefas'       },
  financeiro:            { label: 'Financeiro',   icon: DollarSign,    color: 'text-emerald-600 bg-emerald-50', border: 'border-emerald-200', group: 'Financeiro'    },
  cloud:                 { label: 'Pasta',        icon: FolderOpen,    color: 'text-indigo-600 bg-indigo-50',   border: 'border-indigo-200',  group: 'Cloud'         },
  assinatura:            { label: 'Assinatura',   icon: PenTool,       color: 'text-violet-600 bg-violet-50',   border: 'border-violet-200',  group: 'Assinaturas'   },
};

// Intimações removidas da exibição (ainda carregadas para extrair partes dos processos)
const GROUP_ORDER: ResultType[] = [
  'cliente', 'processo', 'processo-via-cliente', 'requerimento', 'prazo',
  'agenda', 'tarefa', 'financeiro', 'cloud', 'assinatura',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nrm = (s: string) =>
  (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();

const BENEFIT_LABELS: Record<string, string> = {
  bpc_loas: 'BPC LOAS', bpc_loas_deficiencia: 'BPC LOAS Deficiência', bpc_loas_idoso: 'BPC LOAS Idoso',
  aposentadoria_tempo: 'Aposent. Tempo', aposentadoria_idade: 'Aposent. Idade',
  aposentadoria_invalidez: 'Aposent. Invalidez', auxilio_acidente: 'Auxílio Acidente',
  auxilio_doenca: 'Auxílio Doença', pensao_morte: 'Pensão por Morte',
  salario_maternidade: 'Salário Maternidade', outro: 'Outro',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  deadline: 'Prazo', hearing: 'Audiência', requirement: 'Requerimento',
  payment: 'Pagamento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

const AVATAR_PALETTE = [
  '#475569','#6366f1','#0891b2','#059669','#7c3aed',
  '#0369a1','#0f766e','#4338ca','#be185d','#b45309',
];
function avatarColor(name: string) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return w.length >= 2 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  ativo:      { bg: '#d1fae5', text: '#065f46' },
  ativo_temp: { bg: '#d1fae5', text: '#065f46' },
  andamento:  { bg: '#dbeafe', text: '#1e40af' },
  pendente:   { bg: '#fef3c7', text: '#92400e' },
  recurso:    { bg: '#ede9fe', text: '#5b21b6' },
  concluido:  { bg: '#dbeafe', text: '#1e3a8a' },
  cancelado:  { bg: '#fee2e2', text: '#991b1b' },
  signed:     { bg: '#d1fae5', text: '#065f46' },
  pending:    { bg: '#fef3c7', text: '#92400e' },
  expired:    { bg: '#fee2e2', text: '#991b1b' },
  cancelled:  { bg: '#fee2e2', text: '#991b1b' },
  cumprido:   { bg: '#d1fae5', text: '#065f46' },
};

function fmtCPF(v?: string | null): string {
  if (!v) return '';
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
}

function fmtPhone(v?: string | null): string {
  if (!v) return '';
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v;
}

/** Score: 10 = exact word match, 5 = starts-with, 2 = contains */
function score(haystack: string, needle: string): number {
  const h = nrm(haystack), n = nrm(needle);
  if (!h || !n) return 0;
  if (h === n) return 20;
  const words = h.split(/\s+/);
  if (words.some(w => w === n)) return 10;
  if (words.some(w => w.startsWith(n))) return 5;
  if (h.includes(n)) return 2;
  return 0;
}

function topScore(fields: string[], needle: string): number {
  return Math.max(0, ...fields.map(f => score(f, needle)));
}

/** Highlight: wraps the matching substring — bold amber text, no background paint */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const nText = nrm(text);
  const nQuery = nrm(query);
  const idx = nText.indexOf(nQuery);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="search-highlight">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

const MAX_RECENT = 6;

// Chave por usuário — histórico isolado por conta
function recentKey(userId?: string) {
  return userId ? `globalSearch_recent_${userId}` : 'globalSearch_recent_anon';
}
function loadRecent(userId?: string): string[] {
  try { return JSON.parse(localStorage.getItem(recentKey(userId)) || '[]'); } catch { return []; }
}
function saveRecent(userId: string | undefined, q: string) {
  const key = recentKey(userId);
  const prev = loadRecent(userId).filter(r => r !== q);
  localStorage.setItem(key, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)));
}

// Mapa ResultType → chave do módulo (para checar permissão)
// Os nomes devem bater com a coluna `module` da tabela role_permissions
const TYPE_MODULE: Record<string, string> = {
  cliente:              'clientes',
  processo:             'processos',
  'processo-via-cliente': 'processos',
  intimacao:            'intimacoes',
  requerimento:         'requerimentos',
  prazo:                'prazos',
  agenda:               'agenda',
  tarefa:               'tarefas',
  financeiro:           'financeiro',
  cloud:                'documentos',
  assinatura:           'assinaturas',
};

// Mapa ResultType → módulo de navegação para o botão "Ver todos"
const TYPE_NAV: Record<string, string> = {
  cliente:              'clientes',
  processo:             'processos',
  'processo-via-cliente': 'processos',
  requerimento:         'requerimentos',
  prazo:                'prazos',
  agenda:               'agenda',
  tarefa:               'tarefas',
  financeiro:           'financeiro',
  cloud:                'cloud',
  assinatura:           'assinaturas',
};

// ─── Sidebar module list (static, always visible) ────────────────────────────

const SIDEBAR_MODULES: Array<{ key: ResultType | 'all'; label: string; icon: React.ElementType; mod: string | null }> = [
  { key: 'all',          label: 'Tudo',          icon: Sparkles,      mod: null },
  { key: 'cliente',      label: 'Clientes',      icon: Users,         mod: 'clientes' },
  { key: 'processo',     label: 'Processos',     icon: FileText,      mod: 'processos' },
  { key: 'requerimento', label: 'Requerimentos', icon: ClipboardList, mod: 'requerimentos' },
  { key: 'prazo',        label: 'Prazos',        icon: AlarmClock,    mod: 'prazos' },
  { key: 'agenda',       label: 'Agenda',        icon: Calendar,      mod: 'agenda' },
  { key: 'tarefa',       label: 'Tarefas',       icon: CheckSquare,   mod: 'tarefas' },
  { key: 'financeiro',   label: 'Financeiro',    icon: DollarSign,    mod: 'financeiro' },
  { key: 'cloud',        label: 'Cloud',         icon: FolderOpen,    mod: 'cloud' },
  { key: 'assinatura',   label: 'Assinaturas',   icon: PenTool,       mod: 'assinaturas' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ open, onClose, onNavigate }) => {
  const { user } = useAuth();
  const { canView, isAdmin, loading: permissionsLoading } = usePermissions();

  // Verifica permissão: admins veem tudo; outros respeitam canView().
  // Se as permissões ainda estão carregando, libera tudo (será re-filtrado ao carregar).
  const canSeeModule = useCallback((moduleKey: string) => {
    if (isAdmin) return true;
    if (permissionsLoading) return true;
    return canView(moduleKey);
  }, [isAdmin, canView, permissionsLoading]);

  const userId = user?.id;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [priming, setPriming] = useState(false);
  const [selected, setSelected] = useState(0);
  const [selectedCmd, setSelectedCmd] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<ResultType | 'all'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('gsLayout_sidebar') !== 'false'; } catch { return true; }
  });
  const [previewExpanded, setPreviewExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('gsLayout_preview') === 'true'; } catch { return false; }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSidebar = () => {
    setSidebarExpanded(v => {
      const next = !v;
      try { localStorage.setItem('gsLayout_sidebar', String(next)); } catch {}
      return next;
    });
  };
  const togglePreview = () => {
    setPreviewExpanded(v => {
      const next = !v;
      try { localStorage.setItem('gsLayout_preview', String(next)); } catch {}
      return next;
    });
  };

  // Reset filtro ao mudar a query
  useEffect(() => { setActiveFilter('all'); setSelected(0); setSelectedCmd(0); }, [query]);

  // Re-foca o input quando a sidebar é colapsada/expandida
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, [sidebarExpanded]);

  // Reset + pre-warm cache on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setActiveFilter('all');
      setRecentSearches(loadRecent(userId));
      setTimeout(() => inputRef.current?.focus(), 60);
      // Pre-warm cache in background if stale
      if (!_cache || Date.now() - _cache.fetchedAt >= CACHE_TTL) {
        setPriming(true);
        getSearchData().then(() => setPriming(false)).catch(() => setPriming(false));
      }
    }
  }, [open]);

  // ── Search ──────────────────────────────────────────────────────────────────
  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const q2 = q.trim();
      const nq = nrm(q2);
      const today = new Date().toISOString().slice(0, 10);

      const { processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders, signatures } =
        await getSearchData();

      const clientById = new Map<string, Client>(clients.map(c => [c.id, c]));

      // Partes por process_id (a partir das intimações já carregadas)
      const partiesByProcessId = new Map<string, { polo_ativo: string | null; polo_passivo: string | null }>();
      for (const i of intimacoes) {
        if (i.process_id && !partiesByProcessId.has(i.process_id) && (i.polo_ativo || i.polo_passivo)) {
          partiesByProcessId.set(i.process_id, { polo_ativo: i.polo_ativo, polo_passivo: i.polo_passivo });
        }
      }

      // digits-only extracted once — reused for CPF/CNPJ and process code matching
      const queryDigits = q2.replace(/\D/g, '');

      // ── Clientes ──────────────────────────────────────────────────────────
      const clientResults: SearchResult[] = clients
        .map(c => {
          const base = topScore([c.full_name ?? '', c.cpf_cnpj ?? '', c.email ?? '', c.phone ?? ''], q2);
          let s = base;
          if (!base && queryDigits.length >= 4) {
            const cpf = (c.cpf_cnpj ?? '').replace(/\D/g, '');
            if (cpf.startsWith(queryDigits)) s = 5;
            else if (cpf.includes(queryDigits)) s = 2;
          }
          return { s, c };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map(({ c, s }) => ({
          id: c.id, type: 'cliente' as const,
          title: c.full_name ?? 'Cliente',
          subtitle: [fmtCPF(c.cpf_cnpj), c.email].filter(Boolean).join(' · ') || undefined,
          meta: fmtPhone(c.phone) || undefined,
          score: s + 10,
          navModule: 'clientes',
          navParams: { mode: 'details', entityId: c.id },
          details: [
            c.cpf_cnpj ? { icon: CreditCard, label: c.cpf_cnpj.replace(/\D/g,'').length === 14 ? 'CNPJ' : 'CPF', value: fmtCPF(c.cpf_cnpj) } : null,
            c.phone    ? { icon: Phone,      label: 'Telefone',  value: fmtPhone(c.phone) }  : null,
            c.email    ? { icon: Mail,        label: 'E-mail',    value: c.email }             : null,
          ].filter(Boolean) as DetailRow[],
          clientPhotoPath: c.photo_path ?? null,
        }));

      // Helper: subtitle do processo priorizando partes
      const buildProcessSubtitle = (pid: string, clientName?: string | null, court?: string | null) => {
        const p = partiesByProcessId.get(pid);
        if (p?.polo_ativo || p?.polo_passivo) {
          const partsStr = [p.polo_ativo, p.polo_passivo].filter(Boolean).join(' × ');
          return court ? `${partsStr} · ${court}` : partsStr;
        }
        return [clientName, court].filter(Boolean).join(' · ') || undefined;
      };

      // Digits-only matching: lets users type CNJ numbers without separators
      // e.g. "100231203" matches "1002312-03.2026.8.11.0045"
      const scoreProcessCode = (code: string): number => {
        const base = score(code, q2);
        if (base > 0) return base;
        if (queryDigits.length >= 3) {
          const codeDigits = code.replace(/\D/g, '');
          if (codeDigits.startsWith(queryDigits)) return 5;
          if (codeDigits.includes(queryDigits)) return 2;
        }
        return 0;
      };

      // ── Processos (só número e comarca — advogado removido para evitar
      //    retornar TODOS os casos do usuário logado ao buscar seu próprio nome)
      const processResults: SearchResult[] = processes
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          const sc = Math.max(scoreProcessCode(p.process_code ?? ''), score(p.court ?? '', q2));
          return { p, client, s: sc };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map(({ p, client, s }) => {
          const pts = partiesByProcessId.get(p.id);
          return {
            id: p.id, type: 'processo' as const,
            title: p.process_code ?? 'Processo',
            subtitle: buildProcessSubtitle(p.id, client?.full_name, p.court),
            meta: p.status,
            score: s,
            navModule: 'processos',
            navParams: { entityId: p.id },
            details: [
              (pts?.polo_ativo ?? client?.full_name) ? { icon: User,     label: 'Polo Ativo',   value: pts?.polo_ativo ?? client?.full_name ?? '' } : null,
              pts?.polo_passivo                       ? { icon: Scale,    label: 'Polo Passivo', value: pts.polo_passivo }                            : null,
              p.court                                 ? { icon: Building2, label: 'Comarca',      value: p.court }                                     : null,
              p.status                                ? { icon: Tag,       label: 'Status',       value: p.status }                                     : null,
            ].filter(Boolean) as DetailRow[],
          };
        });

      // ── Processos via cliente ─────────────────────────────────────────────
      // Sem filtro de matchedClientIds — se o cliente bate na busca, TODOS os
      // seus processos devem aparecer (inclusive quando o card do cliente já aparece)
      const processViaClientResults: SearchResult[] = processes
        .filter(p => {
          if (!p.client_id) return false;
          const client = clientById.get(p.client_id);
          return client && topScore([client.full_name ?? ''], q2) > 0;
        })
        .slice(0, 6)
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          const parties = partiesByProcessId.get(p.id);
          const clientScore = topScore([client?.full_name ?? ''], q2);
          return {
            id: p.id, type: 'processo-via-cliente' as const,
            title: p.process_code ?? 'Processo',
            subtitle: parties?.polo_ativo
              ? [parties.polo_ativo, parties.polo_passivo].filter(Boolean).join(' × ')
              : `${client?.full_name ?? ''}${p.court ? ' · ' + p.court : ''}`,
            meta: p.status,
            score: Math.max(3, clientScore - 2),
            navModule: 'processos',
            navParams: { entityId: p.id },
            details: (() => {
              const pts2 = partiesByProcessId.get(p.id);
              return [
                (pts2?.polo_ativo ?? client?.full_name) ? { icon: User,      label: 'Polo Ativo',   value: pts2?.polo_ativo ?? client?.full_name ?? '' } : null,
                pts2?.polo_passivo                       ? { icon: Scale,     label: 'Polo Passivo', value: pts2.polo_passivo }                            : null,
                p.court                                  ? { icon: Building2, label: 'Comarca',      value: p.court }                                       : null,
                p.status                                 ? { icon: Tag,       label: 'Status',       value: p.status }                                       : null,
              ].filter(Boolean) as DetailRow[];
            })(),
          };
        });

      // Intimações são carregadas apenas para construir o mapa de partes —
      // não são exibidas como resultado de busca (removidas a pedido do usuário).

      // ── Requerimentos ─────────────────────────────────────────────────────
      const reqResults: SearchResult[] = requirements
        .map(r => {
          const base = topScore([r.beneficiary ?? '', r.cpf ?? '', r.protocol ?? '', BENEFIT_LABELS[r.benefit_type] ?? ''], q2);
          let s = base;
          if (!base && queryDigits.length >= 4) {
            const cpf = (r.cpf ?? '').replace(/\D/g, '');
            if (cpf.startsWith(queryDigits)) s = 5;
            else if (cpf.includes(queryDigits)) s = 2;
          }
          return { r, s };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ r, s }) => ({
          id: r.id, type: 'requerimento' as const,
          title: r.beneficiary ?? 'Requerimento',
          subtitle: [BENEFIT_LABELS[r.benefit_type], r.protocol].filter(Boolean).join(' · ') || undefined,
          meta: r.cpf ? fmtCPF(r.cpf) : undefined,
          score: s,
          navModule: 'requerimentos',
          navParams: { entityId: r.id },
          details: [
            r.cpf          ? { icon: CreditCard, label: 'CPF',       value: fmtCPF(r.cpf) }                      : null,
            r.benefit_type ? { icon: Tag,        label: 'Benefício', value: BENEFIT_LABELS[r.benefit_type] ?? r.benefit_type } : null,
            r.protocol     ? { icon: Hash,       label: 'Protocolo', value: r.protocol }                          : null,
          ].filter(Boolean) as DetailRow[],
        }));

      // ── Prazos ────────────────────────────────────────────────────────────
      const prazoResults: SearchResult[] = deadlines
        .filter(d => d.status !== 'cumprido' && d.status !== 'cancelado')
        .map(d => {
          const client = clientById.get(d.client_id ?? '');
          return {
            d,
            client,
            s: topScore([d.title ?? '', d.description ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ d, client, s }) => {
          const isOverdue = d.due_date < today && d.status === 'pendente';
          return {
            id: d.id, type: 'prazo' as const,
            title: d.title,
            subtitle: client?.full_name || undefined,
            meta: `${fmtDate(d.due_date)}${isOverdue ? ' ⚠' : ''}`,
            score: s,
            navModule: 'prazos',
            navParams: { entityId: d.id },
            details: [
              client?.full_name ? { icon: User,      label: 'Cliente',     value: client.full_name }                                : null,
              { icon: AlarmClock, label: 'Vencimento', value: fmtDate(d.due_date) + (isOverdue ? ' · VENCIDO ⚠' : '') },
              d.status          ? { icon: Tag,         label: 'Status',      value: d.status }                                       : null,
            ].filter(Boolean) as DetailRow[],
          };
        });

      // ── Agenda (apenas futuros) ───────────────────────────────────────────
      const agendaResults: SearchResult[] = events
        .filter(e => e.start_at.slice(0, 10) >= today)
        .map(e => ({
          e,
          s: topScore([e.title ?? '', e.description ?? '', e.client_name ?? '', EVENT_TYPE_LABELS[e.event_type] ?? ''], q2),
        }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        // Dedup: same title+date+client → keep first
        .filter((x, i, arr) => {
          const key = `${nrm(x.e.title ?? '')}|${x.e.start_at.slice(0, 10)}|${x.e.client_name ?? ''}`;
          return arr.findIndex(y => `${nrm(y.e.title ?? '')}|${y.e.start_at.slice(0, 10)}|${y.e.client_name ?? ''}` === key) === i;
        })
        .slice(0, 4)
        .map(({ e, s }) => ({
          id: e.id, type: 'agenda' as const,
          title: e.title ?? 'Compromisso',
          subtitle: [EVENT_TYPE_LABELS[e.event_type], e.client_name].filter(Boolean).join(' · ') || undefined,
          meta: fmtDate(e.start_at),
          score: s,
          navModule: 'agenda',
          navParams: { mode: 'event', entityId: e.id },
        }));

      // ── Tarefas ───────────────────────────────────────────────────────────
      const tarefaResults: SearchResult[] = tasks
        .map(t => {
          const client = clientById.get(t.client_id ?? '');
          return {
            t, client,
            s: topScore([t.title ?? '', t.description ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ t, client, s }) => ({
          id: t.id, type: 'tarefa' as const,
          title: t.title ?? 'Tarefa',
          subtitle: client?.full_name || undefined,
          meta: t.due_date ? fmtDate(t.due_date) : undefined,
          score: s,
          navModule: 'tarefas',
          navParams: undefined,
          details: [
            client?.full_name ? { icon: User,     label: 'Cliente',     value: client.full_name }  : null,
            t.due_date        ? { icon: Calendar,  label: 'Vencimento',  value: fmtDate(t.due_date) } : null,
          ].filter(Boolean) as DetailRow[],
        }));

      // ── Financeiro ────────────────────────────────────────────────────────
      const financeiroResults: SearchResult[] = agreements
        .map(a => {
          const client = clientById.get(a.client_id ?? '');
          return {
            a, client,
            s: topScore([a.title ?? '', client?.full_name ?? '', client?.cpf_cnpj ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ a, client, s }) => ({
          id: a.id, type: 'financeiro' as const,
          title: a.title,
          subtitle: client?.full_name || undefined,
          meta: `R$ ${a.total_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          score: s,
          navModule: 'financeiro',
          navParams: { entityId: a.id },
          details: [
            client?.full_name ? { icon: User,       label: 'Cliente', value: client.full_name }                                              : null,
            { icon: DollarSign, label: 'Total',   value: `R$ ${a.total_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
            a.status          ? { icon: Tag,        label: 'Status',  value: a.status }                                                       : null,
          ].filter(Boolean) as DetailRow[],
        }));

      // ── Cloud ─────────────────────────────────────────────────────────────
      const cloudResults: SearchResult[] = rootFolders
        .map(f => {
          const client = f.client_id ? clientById.get(f.client_id) : undefined;
          return {
            f, client,
            s: topScore([f.name ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ f, client, s }) => ({
          id: f.id, type: 'cloud' as const,
          title: f.name,
          subtitle: client?.full_name || undefined,
          meta: undefined,
          score: s,
          navModule: 'cloud',
          navParams: { folderId: f.id },
        }));

      // ── Assinaturas ───────────────────────────────────────────────────────
      const STATUS_LABELS: Record<string, string> = {
        pending: 'Pendente', signed: 'Assinado', expired: 'Expirado', cancelled: 'Cancelado',
      };
      const assinaturaResults: SearchResult[] = signatures
        .map(r => {
          const client = r.client_id ? clientById.get(r.client_id) : undefined;
          return {
            r, client,
            s: topScore([r.document_name ?? '', r.client_name ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ r, client, s }) => ({
          id: r.id, type: 'assinatura' as const,
          title: r.document_name ?? 'Documento',
          subtitle: (client?.full_name ?? r.client_name) || undefined,
          meta: STATUS_LABELS[r.status] ?? r.status,
          score: s,
          navModule: 'assinaturas',
          navParams: { mode: 'details', requestId: r.id },
          details: [
            (client?.full_name ?? r.client_name) ? { icon: User,     label: 'Cliente', value: client?.full_name ?? r.client_name ?? '' } : null,
            { icon: Tag, label: 'Status', value: STATUS_LABELS[r.status] ?? r.status },
          ].filter(Boolean) as DetailRow[],
        }));

      // ── Merge + dedup ─────────────────────────────────────────────────────
      const merged = [
        ...clientResults, ...processResults, ...processViaClientResults,
        ...reqResults, ...prazoResults,
        ...agendaResults, ...tarefaResults, ...financeiroResults, ...cloudResults,
        ...assinaturaResults,
      ];
      const seen = new Set<string>();
      const deduped = merged.filter(r => {
        // processos aparecem em dois tipos distintos — dedupe pela id pura
        // para que o mesmo processo não apareça duas vezes na lista
        const key = (r.type === 'processo' || r.type === 'processo-via-cliente')
          ? r.id
          : `${r.type}:${r.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Armazena resultados brutos — o filtro de permissão é aplicado no render
      // via useMemo para reagir automaticamente quando as permissões terminam de carregar
      setResults(deduped);
      setSelected(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Resolve client photos: 1) localStorage cache (instant) → 2) signed URL fetch
  useEffect(() => {
    let cancelled = false;
    const clientResults = results.filter(r => r.type === 'cliente');
    if (clientResults.length === 0) { setPhotoUrls(new Map()); return; }

    // Read the same cache that ClientsModule populates
    let lsCache: Record<string, { url?: string; expiresAt: number; miss?: boolean }> = {};
    try { lsCache = JSON.parse(localStorage.getItem('jurius.clientPhotoCache.v1') || '{}'); } catch { /* ok */ }
    const now = Date.now();

    const m = new Map<string, string>();
    const toFetch: SearchResult[] = [];

    for (const r of clientResults) {
      const cached = lsCache[r.id];
      if (cached?.url && cached.expiresAt > now) {
        m.set(r.id, cached.url); // instant from cache
      } else if (!cached?.miss && r.clientPhotoPath) {
        toFetch.push(r);        // needs a signed URL
      }
    }

    if (m.size > 0) setPhotoUrls(new Map(m)); // show cached photos immediately

    if (toFetch.length === 0) return;

    Promise.allSettled(
      toFetch.map(r =>
        signatureService.getSignedImageUrl(r.clientPhotoPath!, 3600)
          .then(url => ({ id: r.id, url }))
          .catch(() => null)
      )
    ).then(settled => {
      if (cancelled) return;
      settled.forEach(res => {
        if (res.status === 'fulfilled' && res.value) m.set(res.value.id, res.value.url);
      });
      setPhotoUrls(new Map(m));
    });

    return () => { cancelled = true; };
  }, [results]);

  // ── Command palette detection (needed for keyboard handler) ────────────────
  const isCommandMode = query.startsWith('/');
  const commandQuery = query.slice(1).trim().toLowerCase();
  const filteredCmds = useMemo(() => {
    const q = commandQuery;
    return ALL_COMMANDS
      .filter(c => !c.moduleKey || canSeeModule(c.moduleKey))
      .filter(c => !q ||
        nrm(c.label).includes(nrm(q)) ||
        nrm(c.description).includes(nrm(q)) ||
        c.keywords.some(k => k.includes(q))
      );
  }, [commandQuery, canSeeModule]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }

      if (isCommandMode) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedCmd(s => Math.min(s + 1, filteredCmds.length - 1)); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedCmd(s => Math.max(s - 1, 0)); return; }
        if (e.key === 'Enter' && filteredCmds[selectedCmd]) {
          e.preventDefault();
          filteredCmds[selectedCmd].action({ onNavigate, onClose, userId });
          return;
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (filters.length > 1) {
          const idx = filters.findIndex(f => f.key === activeFilter);
          const next = e.shiftKey
            ? (idx - 1 + filters.length) % filters.length
            : (idx + 1) % filters.length;
          setActiveFilter(filters[next].key);
          setSelected(0);
        }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flatResults.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && flatResults[selected]) handleSelect(flatResults[selected]);
      // 1-9: jump directly to Nth result (only when input is not focused to avoid eating digits while typing)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key >= '1' && e.key <= '9' && document.activeElement !== inputRef.current) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < flatResults.length) { e.preventDefault(); setSelected(idx); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, selected, activeFilter, selectedCmd, isCommandMode]);

  const handleSelect = (result: SearchResult) => {
    if (query.trim().length >= 2) saveRecent(userId, query.trim());
    setRecentSearches(loadRecent(userId));
    onNavigate(result.navModule, result.navParams);
    onClose();
  };

  // Filtro de permissão aplicado no render — reage automaticamente quando
  // permissionsLoading muda de true→false sem precisar rebuscar
  const permitted = useMemo(
    () => results.filter(r => canSeeModule(TYPE_MODULE[r.type] ?? r.navModule)),
    [results, canSeeModule],
  );

  if (!open) return null;

  // Ícone com acento sutil por tipo — fundo levemente colorido, ícone monocromático escuro
  const TYPE_ICON_COLOR: Record<ResultType, string> = {
    cliente:                'text-slate-600',
    processo:               'text-amber-700',
    'processo-via-cliente': 'text-amber-700',
    intimacao:              'text-orange-600',
    requerimento:           'text-violet-600',
    prazo:                  'text-red-600',
    agenda:                 'text-teal-600',
    tarefa:                 'text-sky-600',
    financeiro:             'text-emerald-600',
    cloud:                  'text-indigo-600',
    assinatura:             'text-purple-600',
  };
  const TYPE_ICON_BG: Record<ResultType, string> = {
    cliente:                '#f1f5f9',
    processo:               '#fef9ec',
    'processo-via-cliente': '#fef9ec',
    intimacao:              '#fff7ed',
    requerimento:           '#f5f3ff',
    prazo:                  '#fef2f2',
    agenda:                 '#f0fdfa',
    tarefa:                 '#f0f9ff',
    financeiro:             '#f0fdf4',
    cloud:                  '#eef2ff',
    assinatura:             '#faf5ff',
  };
  const ICON_BOX_STYLE: React.CSSProperties = {
    background: '#f4f4f5',
    border: '1px solid rgba(0,0,0,0.06)',
  };
  const iconBoxStyle = (type: ResultType): React.CSSProperties => ({
    background: TYPE_ICON_BG[type] ?? '#f4f4f5',
    border: '1px solid rgba(0,0,0,0.06)',
  });
  // alias para compatibilidade
  const TYPE_ICON_STYLE: Record<ResultType, React.CSSProperties> = Object.fromEntries(
    (Object.keys(TYPE_ICON_COLOR) as ResultType[]).map(k => [k, iconBoxStyle(k)])
  ) as Record<ResultType, React.CSSProperties>;

  // Contagem por tipo (respeitando dedupe de processo-via-cliente no grupo processo)
  const allGroups = GROUP_ORDER
    .map(type => ({ type, cfg: TYPE_CONFIG[type], items: permitted.filter(r => r.type === type) }))
    .filter(g => g.items.length > 0);

  // Chips de filtro: "Tudo" + tipos presentes (agrupa processo + processo-via-cliente num único chip)
  const uniqueFilterTypes = [
    ...new Set(allGroups.map(g => g.type === 'processo-via-cliente' ? 'processo' : g.type)),
  ] as ResultType[];
  const filterDefs: { key: ResultType | 'all'; label: string; icon: React.ElementType }[] = [
    { key: 'all', label: 'Tudo', icon: Sparkles },
    ...uniqueFilterTypes.map(type => ({
      key: type,
      label: TYPE_CONFIG[type].group,
      icon: TYPE_CONFIG[type].icon,
    })),
  ];
  const countFor = (k: ResultType | 'all') =>
    k === 'all'
      ? permitted.length
      : k === 'processo'
      ? permitted.filter(r => r.type === 'processo' || r.type === 'processo-via-cliente').length
      : permitted.filter(r => r.type === k).length;
  const filters = filterDefs.map(f => ({ ...f, count: countFor(f.key) }));

  // Grupos visíveis conforme filtro ativo
  const grouped = allGroups.filter(g => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'processo') return g.type === 'processo' || g.type === 'processo-via-cliente';
    return g.type === activeFilter;
  });

  const flatResults = grouped.flatMap(g => g.items);
  const flatIdx = new Map(flatResults.map((r, i) => [`${r.type}:${r.id}`, i]));
  const safeSelected = Math.min(selected, Math.max(0, flatResults.length - 1));
  const previewItem = flatResults[safeSelected];

  const isEmpty = query.trim().length === 0;
  const noResults = query.trim().length >= 2 && !loading && permitted.length === 0;

  const previewCfg = previewItem ? TYPE_CONFIG[previewItem.type] : null;
  const showResults = !isEmpty && results.length > 0;

  return (
    <div className="global-search-overlay" onClick={onClose}>
      <style>{`
        @keyframes gsOverlayIn { from { opacity:0 } to { opacity:1 } }
        @keyframes gsModalIn {
          from { opacity:0; transform:scale(.97) translateY(-8px) }
          to   { opacity:1; transform:scale(1) translateY(0) }
        }
        @keyframes gsContentIn {
          from { opacity:0; transform:translateY(6px) }
          to   { opacity:1; transform:translateY(0) }
        }
        .gs-content-anim { animation: gsContentIn .2s ease-out; }

        /* Overlay */
        .global-search-overlay {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: flex-start; justify-content: center;
          padding-top: 80px;
          background: rgba(0, 0, 0, 0.40);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          animation: gsOverlayIn .18s ease-out;
        }

        /* Modal */
        .global-search-modal {
          width: min(1120px, calc(100vw - 32px));
          height: min(760px, 82vh);
          display: flex; flex-direction: column; overflow: hidden;
          background: #ffffff;
          border: 1px solid #c4c7c7; border-radius: 12px;
          box-shadow: 0 32px 80px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.03);
          animation: gsModalIn .18s cubic-bezier(.32,0,.67,0);
        }

        /* Header */
        .global-search-header {
          flex-shrink: 0; padding: 24px 24px 8px;
          border-bottom: 1px solid rgba(15,23,42,0.06);
        }

        /* Input wrap */
        .global-search-input-wrap {
          height: 56px; display: flex; align-items: center; gap: 12px;
          padding: 0 16px;
          background: #eceef0; border: 1px solid #747878; border-radius: 8px;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .global-search-input-wrap:focus-within {
          border-color: #ff8a00; box-shadow: 0 0 0 2px rgba(255,138,0,0.18), 0 0 0 1px #ff8a00;
        }
        .global-search-icon { width:20px; height:20px; color:#747878; flex-shrink:0; }
        .global-search-input-wrap:focus-within .global-search-icon { color: #ff8a00; }

        .global-search-input {
          flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
          font-size: 18px; font-weight: 500; color: #191c1e;
        }
        .global-search-input::placeholder { color: #c4c7c7; }

        .global-search-clear {
          border: 0; background: transparent; color: #9ca3af; cursor: pointer;
          padding: 5px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          transition: background .12s ease, color .12s ease;
        }
        .global-search-clear:hover { background: #e0e3e5; color: #444748; }

        .global-search-keycap {
          padding: 4px 8px; border-radius: 6px;
          border: 1px solid #c4c7c7; background: #e6e8ea; color: #444748;
          font-size: 11px; font-weight: 600; white-space: nowrap; flex-shrink: 0;
        }

        /* Filter tabs — pill shape */
        .global-search-tabs {
          display: flex; align-items: center; gap: 6px;
          padding: 10px 0 2px; overflow-x: auto; scrollbar-width: none;
        }
        .global-search-tabs::-webkit-scrollbar { display: none; }

        .global-search-tab {
          display: inline-flex; align-items: center; gap: 6px;
          height: 32px; padding: 0 16px; border-radius: 999px; border: 0;
          background: #e6e8ea; color: #444748;
          font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
          transition: background .15s ease, color .15s ease, transform .12s ease;
        }
        .global-search-tab:hover { background: #e0e3e5; color: #191c1e; }
        .global-search-tab:active { transform: scale(0.97); }
        .global-search-tab.active {
          background: #000000; color: #fff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.18);
        }
        .global-search-tab-count {
          min-width: 18px; height: 18px; padding: 0 4px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 999px; background: rgba(0,0,0,0.10);
          color: inherit; font-size: 10px; font-weight: 700;
        }
        .global-search-tab.active .global-search-tab-count { background: rgba(255,255,255,0.20); }

        /* Body grid */
        .global-search-body {
          flex: 1; min-height: 0; display: grid;
          grid-template-columns: minmax(0,1fr) 380px;
        }
        .global-search-body.no-preview { grid-template-columns: 1fr; }

        /* Results list */
        .global-search-results {
          min-width: 0; overflow-y: auto; padding: 16px;
          scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.10) transparent;
        }
        .global-search-results::-webkit-scrollbar { width: 4px; }
        .global-search-results::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 4px; }
        .global-search-results::-webkit-scrollbar-track { background: transparent; }

        /* Section */
        .search-section { margin-bottom: 20px; }
        .search-section-header {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 8px; padding: 0 4px;
        }
        .search-section-title {
          font-size: 11px; font-weight: 800; letter-spacing: 0.07em;
          color: #747878; text-transform: uppercase; white-space: nowrap;
        }
        .search-section-count {
          min-width: 18px; height: 18px; padding: 0 5px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 999px; background: #eceef0; color: #747878;
          font-size: 10px; font-weight: 700;
        }
        .search-section-line { flex: 1; height: 1px; background: rgba(15,23,42,0.07); }
        .search-section-see-all {
          border: 0; background: transparent; color: #914c00;
          font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; padding: 0;
          transition: color .12s ease;
        }
        .search-section-see-all:hover { color: #ff8a00; }

        /* Result item */
        .search-result-item {
          position: relative; display: flex; align-items: center; gap: 12px;
          min-height: 60px; padding: 10px 12px;
          border: 1px solid transparent; border-radius: 12px;
          cursor: pointer; width: 100%; text-align: left; background: transparent;
          transition: background .15s ease, border-color .15s ease, transform .12s ease;
        }
        .search-result-item:hover { background: #f2f4f6; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
        .search-result-item:active { transform: scale(0.997); }
        .search-result-item.selected {
          background: rgba(255,138,0,0.05); border-color: rgba(255,138,0,0.50);
          box-shadow: 0 0 0 1px rgba(255,138,0,0.12);
        }

        /* Avatar / icon */
        .search-result-avatar {
          width: 48px; height: 48px; border-radius: 999px;
          object-fit: cover; flex-shrink: 0;
          border: 1px solid #e0e3e5;
        }
        .search-result-avatar-initials {
          width: 48px; height: 48px; border-radius: 999px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: white; font-weight: 700; font-size: 14px;
          border: 1px solid rgba(0,0,0,0.06);
        }
        .search-result-icon {
          width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }

        /* Content */
        .search-result-content { min-width: 0; flex: 1; }
        .search-result-title {
          font-size: 14px; font-weight: 650; color: #191c1e;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;
        }
        .search-result-subtitle {
          display: block; margin-top: 2px; font-size: 12px; color: #747878;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;
        }
        /* Client-specific: title + phone on same row */
        .search-result-title-row {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
        }
        .search-result-phone { font-size: 12px; color: #747878; flex-shrink: 0; white-space: nowrap; }
        .search-result-meta-row { display: flex; gap: 12px; margin-top: 2px; font-size: 12px; color: #747878; }

        /* Highlight */
        .search-highlight {
          color: #c2410c; font-weight: 700;
          background: rgba(255,138,0,0.12); border-radius: 3px; padding: 0 2px;
        }

        /* Meta / right column */
        .search-result-meta {
          display: flex; align-items: center; gap: 6px; flex-shrink: 0; color: #94a3b8;
        }
        .search-result-badge {
          height: 22px; padding: 0 8px;
          display: inline-flex; align-items: center;
          border-radius: 4px; background: #e0e3e5; color: #444748;
          font-size: 10px; font-weight: 700; white-space: nowrap;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .search-result-arrow { display: flex; align-items: center; color: #c4c7c7; }
        .search-result-item.selected .search-result-arrow { color: #ff8a00; }

        /* Index badge — visible on hover only */
        .result-index {
          opacity: 0; transition: opacity .15s ease;
          padding: 2px 5px; border-radius: 4px; border: 1px solid #c4c7c7;
          font-size: 10px; font-weight: 700; color: #747878; line-height: 1;
        }
        .search-result-item:hover .result-index { opacity: 1; }
        .search-result-item.selected .result-index { display: none; }

        /* ── Preview inspector ── */
        .global-search-preview {
          min-height: 0; border-left: 1px solid #c4c7c7;
          background: #f2f4f6;
          display: flex; flex-direction: column;
        }
        .preview-content {
          flex: 1; min-height: 0; overflow-y: auto; padding: 32px 32px 16px;
          scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.08) transparent;
        }
        .preview-content::-webkit-scrollbar { width: 4px; }
        .preview-content::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius:4px; }

        .preview-header {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          padding-bottom: 24px; border-bottom: 1px solid rgba(15,23,42,0.08);
          margin-bottom: 16px; gap: 12px;
        }
        .preview-avatar {
          width: 96px; height: 96px; border-radius: 999px; object-fit: cover; flex-shrink: 0;
          border: 2px solid #fff; box-shadow: 0 6px 18px rgba(15,23,42,0.14);
        }
        .preview-avatar-initials {
          width: 96px; height: 96px; border-radius: 999px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: white; font-weight: 800; font-size: 28px;
          box-shadow: 0 6px 18px rgba(15,23,42,0.16);
        }
        .preview-avatar-icon {
          width: 96px; height: 96px; border-radius: 999px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          border: 1px solid rgba(0,0,0,0.06);
        }
        .preview-type {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          color: #747878; text-transform: uppercase;
          display: flex; align-items: center; justify-content: center; gap: 4px;
        }
        .preview-name {
          font-size: 18px; line-height: 1.3; font-weight: 700; color: #191c1e; word-break: break-word;
        }
        .preview-fields { padding-top: 4px; }
        .preview-field {
          position: relative; padding: 10px 0; border-bottom: 1px solid rgba(15,23,42,0.06);
        }
        .preview-field:last-child { border-bottom: 0; }
        .preview-field-label {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.07em;
          color: #747878; text-transform: uppercase; margin-bottom: 4px;
          display: flex; align-items: center; gap: 6px;
        }
        .preview-field-icon { color: #747878; }
        .preview-field-value {
          font-size: 15px; color: #191c1e; word-break: break-all; line-height: 1.4;
        }
        .preview-field-actions {
          position: absolute; right: 0; top: 50%; transform: translateY(-50%);
          display: none; align-items: center; gap: 2px;
        }
        .preview-field:hover .preview-field-actions { display: flex; }
        .preview-field-action-btn {
          padding: 4px; border: 0; background: transparent; cursor: pointer;
          border-radius: 5px; color: #c4c7c7; display: flex; align-items: center;
          transition: background .1s ease, color .1s ease;
        }
        .preview-field-action-btn:hover { background: rgba(0,0,0,0.07); color: #444748; }

        /* Preview action */
        .preview-action-wrap {
          flex-shrink: 0; padding: 16px 32px 24px;
          border-top: 1px solid rgba(15,23,42,0.07);
        }
        .preview-open-button {
          width: 100%; height: 56px; border: 0; border-radius: 8px;
          background: #000000;
          color: #fff; font-size: 15px; font-weight: 700; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: opacity .15s ease, transform .15s ease;
        }
        .preview-open-button:hover { opacity: 0.85; }
        .preview-open-button:active { transform: scale(0.985); }
        .preview-hint { text-align: center; margin-top: 10px; font-size: 11px; color: #94a3b8; }

        /* Footer */
        .global-search-footer {
          flex-shrink: 0; height: 48px; padding: 0 24px;
          display: flex; align-items: center; justify-content: space-between;
          border-top: 1px solid rgba(15,23,42,0.07); background: #eceef0;
        }
        .footer-shortcuts {
          display: flex; align-items: center; gap: 8px;
          color: #747878; font-size: 12px; font-weight: 500;
        }
        .footer-key {
          display: inline-flex; align-items: center; justify-content: center;
          height: 22px; min-width: 22px; padding: 0 6px; border-radius: 6px;
          border: 1px solid #c4c7c7; background: #fff; color: #444748;
          font-size: 11px; font-weight: 700;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }

        /* Quick access */
        .quick-access-section { padding: 18px 18px 22px; }
        .quick-section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .quick-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
        .quick-card {
          display: flex; align-items: center; gap: 12px;
          min-height: 68px; padding: 12px 14px;
          border: 1px solid #e0e3e5; border-radius: 12px;
          background: #fff; cursor: pointer; text-align: left;
          transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
        }
        .quick-card:hover {
          transform: translateY(-2px); border-color: rgba(255,138,0,0.30);
          box-shadow: 0 8px 24px rgba(15,23,42,0.08);
        }
        .quick-card:active { transform: scale(0.98); }
        .quick-card-icon {
          width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .quick-card-title {
          font-size: 13px; font-weight: 700; color: #191c1e; line-height: 1.3;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .quick-card-subtitle {
          margin-top: 2px; font-size: 11px; color: #94a3b8;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* Recent searches */
        .recent-section { padding: 14px 18px 0; }
        .recent-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .recent-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 12px; border-radius: 8px;
          background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.07);
          color: #444748; font-size: 12px; font-weight: 500; cursor: pointer;
          transition: background .12s ease;
        }
        .recent-pill:hover { background: rgba(0,0,0,0.08); color: #191c1e; }

        /* No results */
        .no-results-state {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 80px 40px; gap: 14px; text-align: center;
        }
        .no-results-icon {
          width: 52px; height: 52px; border-radius: 14px; background: #eceef0;
          display: flex; align-items: center; justify-content: center;
        }

        /* Dark mode */
        .dark .global-search-modal {
          background: rgba(24,24,27,0.97); border-color: rgba(255,255,255,0.10);
          box-shadow: 0 24px 80px rgba(0,0,0,0.55);
        }
        .dark .global-search-input-wrap { background: rgba(39,39,42,0.92); border-color: rgba(255,255,255,0.18); }
        .dark .global-search-input-wrap:focus-within { border-color: #ff8a00; box-shadow: 0 0 0 1px #ff8a00; }
        .dark .global-search-input { color: #fafafa; }
        .dark .global-search-keycap, .dark .footer-key {
          background: #27272a; color: #d4d4d8; border-color: rgba(255,255,255,0.12);
        }
        .dark .global-search-header { border-bottom-color: rgba(255,255,255,0.07); }
        .dark .global-search-tab { background: rgba(255,255,255,0.08); color: #a1a1aa; }
        .dark .global-search-tab:hover { background: rgba(255,255,255,0.12); color: #fafafa; }
        .dark .global-search-tab.active { background: #fafafa; color: #18181b; }
        .dark .search-result-item:hover { background: rgba(255,255,255,0.05); }
        .dark .search-result-item.selected { background: rgba(255,138,0,0.08); border-color: #ff8a00; }
        .dark .search-result-title, .dark .quick-card-title, .dark .preview-name { color: #fafafa; }
        .dark .search-result-subtitle, .dark .search-result-phone { color: #a1a1aa; }
        .dark .global-search-preview { background: rgba(24,24,27,0.95); border-left-color: rgba(255,255,255,0.08); }
        .dark .global-search-footer { background: rgba(24,24,27,0.92); border-top-color: rgba(255,255,255,0.08); }
        .dark .quick-card { background: rgba(39,39,42,0.72); border-color: rgba(255,255,255,0.08); }
        .dark .search-section-count { background: rgba(255,255,255,0.08); color: #a1a1aa; }
        .dark .preview-field-value { color: #e4e4e7; }
        .dark .preview-type { color: #a1a1aa; }
        .dark .result-index { border-color: rgba(255,255,255,0.15); color: #a1a1aa; }
        .dark .search-result-badge { background: rgba(255,255,255,0.10); color: #d4d4d8; }

        /* ── Sidebar layout ── */
        .gs-layout {
          flex: 1; min-height: 0; display: flex; flex-direction: row; overflow: hidden;
        }

        .gs-sidebar {
          flex-shrink: 0; width: 280px;
          border-right: 1px solid #c4c7c7;
          background: #f2f4f6;
          display: flex; flex-direction: column;
          padding: 24px 20px;
          overflow: hidden;
          transition: width .2s ease, padding .2s ease;
        }
        .gs-sidebar.collapsed {
          width: 48px; padding: 12px 8px;
          align-items: center;
        }

        .gs-sidebar-heading {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 12px;
        }
        .gs-sidebar-label {
          font-size: 10px; font-weight: 800; letter-spacing: 0.07em;
          color: #747878; text-transform: uppercase;
        }

        .gs-collapse-btn {
          border: 0; background: transparent; cursor: pointer; padding: 4px;
          border-radius: 6px; color: #747878; display: flex; align-items: center;
          flex-shrink: 0;
          transition: background .12s ease, color .12s ease;
        }
        .gs-collapse-btn:hover { background: #e0e3e5; color: #191c1e; }

        .gs-sidebar-filters {
          flex: 1; overflow-y: auto; padding-top: 16px; margin-top: 4px;
          scrollbar-width: none;
        }
        .gs-sidebar-filters::-webkit-scrollbar { display: none; }

        .gs-filter-btn {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px; border-radius: 8px; border: 0;
          width: 100%; text-align: left; cursor: pointer;
          font-size: 12px; font-weight: 600; color: #444748;
          background: transparent; margin-bottom: 2px;
          transition: background .15s ease;
        }
        .gs-filter-btn:hover { background: #e0e3e5; }
        .gs-filter-btn.active { background: #000; color: #fff; }
        .gs-filter-btn-left { display: flex; align-items: center; gap: 10px; }
        .gs-filter-count { font-size: 10px; opacity: 0.55; font-weight: 700; }
        .gs-filter-btn.active .gs-filter-count { opacity: 0.7; }

        .gs-sidebar-footer {
          flex-shrink: 0; margin-top: auto; padding-top: 0;
        }

        .gs-main {
          flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0;
        }

        /* Dark mode sidebar */
        .dark .gs-sidebar { background: rgba(24,24,27,0.95); border-right-color: rgba(255,255,255,0.08); }
        .dark .gs-collapse-btn { color: #a1a1aa; }
        .dark .gs-collapse-btn:hover { background: rgba(255,255,255,0.08); color: #fafafa; }
        .dark .gs-filter-btn { color: #a1a1aa; }
        .dark .gs-filter-btn:hover { background: rgba(255,255,255,0.07); color: #fafafa; }
        .dark .gs-filter-btn.active { background: #fafafa; color: #18181b; }
      `}</style>

      <div className="global-search-modal" onClick={e => e.stopPropagation()}>

        {/* ── Layout: sidebar + main ── */}
        <div className="gs-layout">

          {/* ── LEFT SIDEBAR ── */}
          <aside className={`gs-sidebar${sidebarExpanded ? '' : ' collapsed'}`}>
            {sidebarExpanded ? (
              <>
                {/* Heading */}
                <div className="gs-sidebar-heading">
                  <span className="gs-sidebar-label">Busca Global</span>
                  <button
                    className="gs-collapse-btn"
                    onClick={toggleSidebar}
                    type="button"
                    title="Colapsar sidebar"
                  >
                    <ChevronLeft style={{ width: 16, height: 16 }} />
                  </button>
                </div>

                {/* Search input */}
                <div className="global-search-input-wrap">
                  <div style={{ flexShrink: 0 }}>
                    {loading
                      ? <Loader2 className="global-search-icon animate-spin" />
                      : isCommandMode
                      ? <Terminal className="global-search-icon" />
                      : <Search className="global-search-icon" />
                    }
                  </div>
                  <input
                    ref={sidebarExpanded ? inputRef : undefined}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={isCommandMode ? 'Digite um comando…' : 'Pesquisar...'}
                    className="global-search-input"
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {priming && !loading && (
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>indexando…</span>
                    )}
                    {query && (
                      <button className="global-search-clear" onClick={() => setQuery('')} type="button">
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                    <span className="global-search-keycap">ESC</span>
                  </div>
                </div>

                {/* Count + ⌘K */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '0 2px' }}>
                  <span className="global-search-keycap">⌘K</span>
                  {!isEmpty && (
                    <span style={{ fontSize: 11, color: '#747878', fontWeight: 500 }}>
                      {permitted.length} resultado{permitted.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Module nav — always visible */}
                <div className="gs-sidebar-filters">
                  <div className="gs-sidebar-label" style={{ marginBottom: 8 }}>
                    {showResults && !isCommandMode ? 'Filtrar por' : 'Módulos'}
                  </div>
                  {SIDEBAR_MODULES
                    .filter(m => m.mod === null || canSeeModule(m.mod))
                    .map(m => {
                      const active = !isCommandMode && showResults && m.key === activeFilter;
                      const count = !isCommandMode && showResults
                        ? (filters.find(f => f.key === m.key)?.count ?? 0)
                        : null;
                      const dimmed = count === 0 && count !== null;
                      const MIcon = m.icon;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => {
                            if (!isCommandMode && showResults) {
                              setActiveFilter(m.key); setSelected(0);
                            } else if (m.mod) {
                              onNavigate(m.mod); onClose();
                            }
                          }}
                          className={`gs-filter-btn${active ? ' active' : ''}`}
                          style={dimmed ? { opacity: 0.35 } : {}}
                        >
                          <div className="gs-filter-btn-left">
                            <MIcon style={{ width: 15, height: 15 }} />
                            <span>{m.label}</span>
                          </div>
                          {count !== null && <span className="gs-filter-count">{count}</span>}
                        </button>
                      );
                    })}
                </div>

                {/* Sidebar shortcuts */}
                <div className="gs-sidebar-footer">
                  <div style={{ borderTop: '1px solid rgba(15,23,42,0.07)', paddingTop: 14 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, color: '#747878', fontSize: 12, fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="footer-key" style={{ fontSize: 13 }}>⇅</span>
                        <span>navegar</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="footer-key">↵</span>
                        <span>abrir</span>
                      </div>
                      {!isCommandMode && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="footer-key">/</span>
                          <span>comandos</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Collapsed: só botão de expandir */
              <button
                className="gs-collapse-btn"
                onClick={toggleSidebar}
                type="button"
                title="Expandir sidebar"
                style={{ margin: '8px auto' }}
              >
                <ChevronRight style={{ width: 18, height: 18 }} />
              </button>
            )}
          </aside>

          {/* ── RIGHT MAIN AREA ── */}
          <div className="gs-main">

            {/* Header com search visível apenas quando sidebar colapsada */}
            {!sidebarExpanded && (
              <div className="global-search-header">
                <div className="global-search-input-wrap">
                  <div style={{ flexShrink: 0 }}>
                    {loading
                      ? <Loader2 className="global-search-icon animate-spin" />
                      : isCommandMode
                      ? <Terminal className="global-search-icon" />
                      : <Search className="global-search-icon" />
                    }
                  </div>
                  <input
                    ref={!sidebarExpanded ? inputRef : undefined}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={isCommandMode ? 'Digite um comando…' : 'Pesquisar...'}
                    className="global-search-input"
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {priming && !loading && (
                      <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>indexando…</span>
                    )}
                    {query && (
                      <button className="global-search-clear" onClick={() => setQuery('')} type="button">
                        <X style={{ width: 16, height: 16 }} />
                      </button>
                    )}
                    <span className="global-search-keycap">ESC</span>
                  </div>
                </div>
                {!isCommandMode && showResults && filters.length > 1 && (
                  <div className="global-search-tabs">
                    {filters.map(f => {
                      const active = f.key === activeFilter;
                      const FIcon = f.icon;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => { setActiveFilter(f.key); setSelected(0); }}
                          className={`global-search-tab${active ? ' active' : ''}`}
                        >
                          <FIcon style={{ width: 13, height: 13, opacity: active ? 0.9 : 0.6 }} />
                          {f.label}
                          <span className="global-search-tab-count">{f.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Body: results + preview */}
            {(() => {
              const hasPreview = !isCommandMode && showResults && !!previewItem && !!previewCfg && previewExpanded;
              return (
                <div className={`global-search-body${hasPreview ? '' : ' no-preview'}`}>

                  {/* Left: results list */}
                  <div className="global-search-results">
                  {(() => {
                    const stateKey = isCommandMode ? 'cmd' : isEmpty ? 'empty' : noResults ? 'nores' : 'results';
                    return (
                    <div key={stateKey} className="gs-content-anim">

                {/* ── Command palette mode ── */}
                {isCommandMode ? (
                  filteredCmds.length === 0 ? (
                    <div className="no-results-state">
                      <div className="no-results-icon">
                        <Terminal style={{ width: 22, height: 22, color: '#94a3b8' }} />
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#475569', margin: 0 }}>
                          Nenhum comando encontrado
                        </p>
                        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                          Tente "novo cliente" ou "ir para processos"
                        </p>
                      </div>
                    </div>
                  ) : (
                    (() => {
                      const categories: CmdCategory[] = ['criar', 'navegar', 'sistema'];
                      let gIdx = 0;
                      return categories.map(cat => {
                        const cmds = filteredCmds.filter(c => c.category === cat);
                        if (cmds.length === 0) return null;
                        return (
                          <div key={cat} className="search-section">
                            <div className="search-section-header">
                              <span className="search-section-title">{CMD_CATEGORY_LABEL[cat]}</span>
                              <div className="search-section-line" />
                            </div>
                            {cmds.map(cmd => {
                              const idx = gIdx++;
                              const isSel = idx === selectedCmd;
                              const CmdIcon = cmd.icon;
                              return (
                                <button
                                  key={cmd.id}
                                  type="button"
                                  onClick={() => cmd.action({ onNavigate, onClose, userId })}
                                  onMouseEnter={() => setSelectedCmd(idx)}
                                  className={`search-result-item${isSel ? ' selected' : ''}`}
                                >
                                  <span
                                    className="search-result-icon"
                                    style={{ background: '#f8fafc', border: '1px solid rgba(0,0,0,0.07)', color: '#64748b' }}
                                  >
                                    <CmdIcon style={{ width: 17, height: 17 }} />
                                  </span>
                                  <div className="search-result-content">
                                    <span className="search-result-title">{cmd.label}</span>
                                    <span className="search-result-subtitle">{cmd.description}</span>
                                  </div>
                                  <div className="search-result-meta">
                                    {cmd.shortcut && (
                                      <span className="footer-key">{cmd.shortcut}</span>
                                    )}
                                    <span className="search-result-arrow">
                                      {isSel
                                        ? <CornerDownLeft style={{ width: 14, height: 14, color: '#f97316' }} />
                                        : <ChevronRight style={{ width: 14, height: 14 }} />
                                      }
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        );
                      });
                    })()
                  )

                ) : showResults ? (
                  /* ── Search results ── */
                  <>
                    {grouped.map(({ type, cfg, items }) => (
                      <div key={type} className="search-section">
                        <div className="search-section-header">
                          <span className="search-section-title">{cfg.group}</span>
                          <span className="search-section-count">{items.length}</span>
                          <div className="search-section-line" />
                          {TYPE_NAV[type] && (
                            <button
                              type="button"
                              className="search-section-see-all"
                              onClick={() => { onNavigate(TYPE_NAV[type]); onClose(); }}
                            >
                              Ver todos
                            </button>
                          )}
                        </div>

                        {items.map(r => {
                          const fi = flatIdx.get(`${r.type}:${r.id}`) ?? -1;
                          const isSel = fi === safeSelected;
                          const Icon = cfg.icon;
                          return (
                            <button
                              key={`${r.type}-${r.id}`}
                              type="button"
                              className={`search-result-item${isSel ? ' selected' : ''}`}
                              onClick={() => handleSelect(r)}
                              onMouseEnter={() => setSelected(fi)}
                            >
                                {r.type === 'cliente' ? (
                                <>
                                  {/* Clientes: avatar circular grande */}
                                  {photoUrls.get(r.id) ? (
                                    <img src={photoUrls.get(r.id)} className="search-result-avatar" alt="" />
                                  ) : (
                                    <span className="search-result-avatar-initials" style={{ background: avatarColor(r.title) }}>
                                      {initials(r.title)}
                                    </span>
                                  )}
                                  <div className="search-result-content">
                                    <div className="search-result-title-row">
                                      <span className="search-result-title">
                                        <Highlight text={r.title} query={query} />
                                      </span>
                                      {r.meta && <span className="search-result-phone">{r.meta}</span>}
                                    </div>
                                    {r.subtitle && (
                                      <div className="search-result-meta-row">
                                        <span><Highlight text={r.subtitle} query={query} /></span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="search-result-meta">
                                    {fi >= 0 && fi < 9 && (
                                      <span className="result-index">{fi + 1}</span>
                                    )}
                                    <span className="search-result-arrow">
                                      {isSel
                                        ? <CornerDownLeft style={{ width: 14, height: 14, color: '#ff8a00' }} />
                                        : <ChevronRight style={{ width: 14, height: 14 }} />
                                      }
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  {/* Demais tipos: ícone quadrado */}
                                  <span
                                    className={`search-result-icon ${TYPE_ICON_COLOR[r.type as ResultType]}`}
                                    style={iconBoxStyle(r.type as ResultType)}
                                  >
                                    <Icon style={{ width: 17, height: 17 }} />
                                  </span>
                                  <div className="search-result-content">
                                    <span className="search-result-title">
                                      <Highlight text={r.title} query={query} />
                                    </span>
                                    {r.subtitle && (
                                      <span className="search-result-subtitle">
                                        <Highlight text={r.subtitle} query={query} />
                                      </span>
                                    )}
                                  </div>
                                  <div className="search-result-meta">
                                    {r.meta && (() => {
                                      const st = STATUS_STYLE[r.meta.toLowerCase()];
                                      return (
                                        <span className="search-result-badge" style={st ? { background: st.bg, color: st.text } : {}}>
                                          {r.meta}
                                        </span>
                                      );
                                    })()}
                                    {fi >= 0 && fi < 9 && (
                                      <span className="result-index">{fi + 1}</span>
                                    )}
                                    <span className="search-result-arrow">
                                      {isSel
                                        ? <CornerDownLeft style={{ width: 14, height: 14, color: '#ff8a00' }} />
                                        : <ChevronRight style={{ width: 14, height: 14 }} />
                                      }
                                    </span>
                                  </div>
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </>

                ) : noResults ? (
                  /* ── No results ── */
                  <div className="no-results-state">
                    <div className="no-results-icon">
                      <Search style={{ width: 22, height: 22, color: '#94a3b8' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#475569', margin: 0 }}>
                        Nenhum resultado para
                      </p>
                      <p style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '4px 0 0' }}>
                        &ldquo;{query}&rdquo;
                      </p>
                      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                        Tente outro nome, número ou CPF
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button
                        type="button"
                        onClick={() => setQuery('/' + query.trim())}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '8px 16px', borderRadius: 10,
                          background: '#f1f5f9', border: '0',
                          fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer',
                        }}
                      >
                        <Terminal style={{ width: 13, height: 13 }} /> Usar como comando
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '8px 16px', borderRadius: 10,
                          background: 'transparent', border: '1px solid rgba(0,0,0,0.10)',
                          fontSize: 12, fontWeight: 600, color: '#94a3b8', cursor: 'pointer',
                        }}
                      >
                        <X style={{ width: 12, height: 12 }} /> Limpar
                      </button>
                    </div>
                  </div>

                ) : isEmpty ? (
                  /* ── Empty / quick access ── */
                  <>
                    {recentSearches.length > 0 && (
                      <div className="recent-section">
                        <div className="search-section-header">
                          <Clock style={{ width: 11, height: 11, color: '#94a3b8' }} />
                          <span className="search-section-title">Recentes</span>
                          <div className="search-section-line" />
                          <button
                            type="button"
                            className="search-section-see-all"
                            onClick={() => { localStorage.removeItem(recentKey(userId)); setRecentSearches([]); }}
                          >
                            Limpar
                          </button>
                        </div>
                        <div className="recent-pills">
                          {recentSearches.map(r => (
                            <button key={r} type="button" className="recent-pill" onClick={() => setQuery(r)}>
                              <Search style={{ width: 11, height: 11, color: '#94a3b8' }} />
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="quick-access-section">
                      <div className="quick-section-header">
                        <span className="search-section-title">Acesso rápido</span>
                        <div className="search-section-line" />
                      </div>
                      <div className="quick-grid">
                        {([
                          { icon: Users,         label: 'Clientes',      desc: 'nome, CPF, e-mail',       mod: 'clientes',      iColor: 'text-slate-600',   iBg: '#f1f5f9' },
                          { icon: FileText,      label: 'Processos',     desc: 'número, comarca',         mod: 'processos',     iColor: 'text-amber-700',   iBg: '#fef9ec' },
                          { icon: ClipboardList, label: 'Requerimentos', desc: 'beneficiário, protocolo', mod: 'requerimentos', iColor: 'text-violet-600',  iBg: '#f5f3ff' },
                          { icon: AlarmClock,    label: 'Prazos',        desc: 'título, cliente',         mod: 'prazos',        iColor: 'text-red-600',     iBg: '#fef2f2' },
                          { icon: Calendar,      label: 'Agenda',        desc: 'audiências, reuniões',    mod: 'agenda',        iColor: 'text-teal-600',    iBg: '#f0fdfa' },
                          { icon: CheckSquare,   label: 'Tarefas',       desc: 'título, descrição',       mod: 'tarefas',       iColor: 'text-sky-600',     iBg: '#f0f9ff' },
                          { icon: DollarSign,    label: 'Financeiro',    desc: 'acordo, cliente',         mod: 'financeiro',    iColor: 'text-emerald-600', iBg: '#f0fdf4' },
                          { icon: FolderOpen,    label: 'Cloud',         desc: 'pasta, cliente',          mod: 'cloud',         iColor: 'text-indigo-600',  iBg: '#eef2ff' },
                          { icon: PenTool,       label: 'Assinaturas',   desc: 'documento, cliente',      mod: 'assinaturas',   iColor: 'text-purple-600',  iBg: '#faf5ff' },
                        ] as { icon: React.ElementType; label: string; desc: string; mod: string; iColor: string; iBg: string }[])
                          .filter(item => canSeeModule(item.mod))
                          .map(({ icon: Icon, label, desc, mod, iColor, iBg }) => (
                            <button
                              key={label}
                              type="button"
                              className="quick-card"
                              onClick={() => { onNavigate(mod, undefined); onClose(); }}
                            >
                              <span
                                className={`quick-card-icon ${iColor}`}
                                style={{ background: iBg, border: '1px solid rgba(0,0,0,0.05)' }}
                              >
                                <Icon style={{ width: 18, height: 18 }} />
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <div className="quick-card-title">{label}</div>
                                <div className="quick-card-subtitle">{desc}</div>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  </>

                ) : null}
                    </div>
                    );
                  })()}
              </div>

              {/* ── Preview inspector (right column) ── */}
              {hasPreview && previewItem && previewCfg && (
                <div className="global-search-preview">
                  {/* Botão fechar preview */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px 0', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={togglePreview}
                      className="gs-collapse-btn"
                      title="Ocultar preview"
                      style={{ padding: 5 }}
                    >
                      <X style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                  <div className="preview-content" style={{ paddingTop: 12 }}>
                    {/* Header — centrado */}
                    <div className="preview-header">
                      {previewItem.type === 'cliente' && photoUrls.get(previewItem.id) ? (
                        <img src={photoUrls.get(previewItem.id)} className="preview-avatar" alt="" />
                      ) : previewItem.type === 'cliente' ? (
                        <div className="preview-avatar-initials" style={{ background: avatarColor(previewItem.title) }}>
                          {initials(previewItem.title)}
                        </div>
                      ) : (
                        <div className={`preview-avatar-icon ${TYPE_ICON_COLOR[previewItem.type]}`} style={{ background: TYPE_ICON_BG[previewItem.type] }}>
                          <previewCfg.icon style={{ width: 36, height: 36 }} />
                        </div>
                      )}
                      <div>
                        <div className="preview-type">{previewCfg.label}</div>
                        <div className="preview-name">{previewItem.title}</div>
                      </div>
                    </div>

                    {/* Detail rows */}
                    <div className="preview-fields">
                      {(previewItem.details && previewItem.details.length > 0
                        ? previewItem.details
                        : [
                            previewItem.subtitle ? { icon: Tag, label: 'Info',  value: previewItem.subtitle } : null,
                            previewItem.meta     ? { icon: Tag, label: 'Status', value: previewItem.meta }     : null,
                          ].filter(Boolean) as DetailRow[]
                      ).map(({ icon: DIcon, label, value }) => {
                        const st = label === 'Status' ? STATUS_STYLE[value.toLowerCase()] : undefined;
                        const copyId = `${previewItem.id}:${label}`;
                        const isCopied = copiedKey === copyId;
                        const isPhone = label === 'Telefone';
                        const isEmail = label === 'E-mail';
                        const phoneDigits = isPhone ? value.replace(/\D/g, '') : '';
                        return (
                          <div key={label} className="preview-field">
                            <div className="preview-field-label">
                              <DIcon className="preview-field-icon" style={{ width: 12, height: 12 }} />
                              {label}
                            </div>
                            <div>
                              {st ? (
                                <span style={{
                                  display: 'inline-block', fontSize: 12, fontWeight: 600,
                                  padding: '2px 10px', borderRadius: 999,
                                  background: st.bg, color: st.text,
                                }}>{value}</span>
                              ) : (
                                <div className="preview-field-value">{value}</div>
                              )}
                            </div>
                            {/* Hover action buttons */}
                            <div className="preview-field-actions">
                              {isPhone && (
                                <>
                                  <a
                                    href={`https://wa.me/55${phoneDigits}`}
                                    target="_blank" rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="preview-field-action-btn" title="WhatsApp"
                                  >
                                    <MessageCircle style={{ width: 12, height: 12, color: '#22c55e' }} />
                                  </a>
                                  <a
                                    href={`tel:+55${phoneDigits}`}
                                    onClick={e => e.stopPropagation()}
                                    className="preview-field-action-btn" title="Ligar"
                                  >
                                    <Phone style={{ width: 12, height: 12 }} />
                                  </a>
                                </>
                              )}
                              {isEmail && (
                                <a
                                  href={`mailto:${value}`}
                                  onClick={e => e.stopPropagation()}
                                  className="preview-field-action-btn" title="E-mail"
                                >
                                  <Mail style={{ width: 12, height: 12 }} />
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(value).then(() => {
                                    setCopiedKey(copyId);
                                    setTimeout(() => setCopiedKey(null), 2000);
                                  });
                                }}
                                className="preview-field-action-btn" title="Copiar"
                              >
                                {isCopied
                                  ? <Check style={{ width: 12, height: 12, color: '#22c55e' }} />
                                  : <Copy style={{ width: 12, height: 12 }} />
                                }
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Open button */}
                  <div className="preview-action-wrap">
                    <button
                      type="button"
                      className="preview-open-button"
                      onClick={() => handleSelect(previewItem)}
                    >
                      <ArrowRight style={{ width: 18, height: 18 }} />
                      Abrir
                    </button>
                    <p className="preview-hint">
                      ou pressione{' '}
                      <span className="footer-key" style={{ fontSize: 10, height: 18, minWidth: 18, padding: '0 4px' }}>↵</span>
                    </p>
                  </div>
                </div>
              )}
                </div>
              );
            })()}

          </div>{/* /gs-main */}
        </div>{/* /gs-layout */}

        {/* ── Footer ── */}
        <div className="global-search-footer">
          {/* Toggle de preview — visível quando há resultados */}
          {showResults && !isCommandMode && previewItem ? (
            <button
              type="button"
              onClick={togglePreview}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: 999,
                border: '1px solid #c4c7c7',
                background: previewExpanded ? '#000' : '#e6e8ea',
                color: previewExpanded ? '#fff' : '#444748',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'background .15s ease, color .15s ease',
              }}
            >
              <ChevronRight style={{ width: 14, height: 14, transform: previewExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }} />
              {previewExpanded ? 'Ocultar detalhe' : 'Ver detalhe'}
            </button>
          ) : (
            <div />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, border: '1px solid #c4c7c7', background: '#e6e8ea' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#444748' }}>comandos</span>
            <span className="footer-key" style={{ marginLeft: 4 }}>⌘K</span>
          </div>
        </div>
      </div>
    </div>
  );
};
