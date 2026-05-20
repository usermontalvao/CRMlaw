import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Search, X, FileText, Users, Loader2, ChevronRight, ArrowRight,
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
  '#f97316','#3b82f6','#10b981','#8b5cf6','#ec4899',
  '#f59e0b','#06b6d4','#6366f1','#14b8a6','#ef4444',
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

/** Highlight: wraps the matching substring with orange color */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const nText = nrm(text);
  const nQuery = nrm(query);
  const idx = nText.indexOf(nQuery);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-orange-500 font-semibold not-italic">{text.slice(idx, idx + query.length)}</span>
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
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset filtro ao mudar a query
  useEffect(() => { setActiveFilter('all'); setSelected(0); setSelectedCmd(0); }, [query]);

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

      // ── Clientes ──────────────────────────────────────────────────────────
      const clientResults: SearchResult[] = clients
        .map(c => ({
          s: topScore([c.full_name ?? '', c.cpf_cnpj ?? '', c.email ?? '', c.phone ?? ''], q2),
          c,
        }))
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

      // ── Processos (só número e comarca — advogado removido para evitar
      //    retornar TODOS os casos do usuário logado ao buscar seu próprio nome)
      const processResults: SearchResult[] = processes
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          const sc = topScore([p.process_code ?? '', p.court ?? ''], q2);
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
        .map(r => ({
          r,
          s: topScore([r.beneficiary ?? '', r.cpf ?? '', r.protocol ?? '', BENEFIT_LABELS[r.benefit_type] ?? ''], q2),
        }))
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
        const key = `${r.type}:${r.id}`;
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
      // 1-9: jump directly to Nth result
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key >= '1' && e.key <= '9') {
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

  // Cor do ícone por tipo
  const TYPE_ICON_COLOR: Record<ResultType, string> = {
    cliente:                'text-slate-500 bg-slate-100',
    processo:               'text-amber-600 bg-amber-50',
    'processo-via-cliente': 'text-amber-600 bg-amber-50',
    intimacao:              'text-orange-600 bg-orange-50',
    requerimento:           'text-purple-600 bg-purple-50',
    prazo:                  'text-red-500 bg-red-50',
    agenda:                 'text-teal-600 bg-teal-50',
    tarefa:                 'text-sky-600 bg-sky-50',
    financeiro:             'text-emerald-600 bg-emerald-50',
    cloud:                  'text-indigo-600 bg-indigo-50',
    assinatura:             'text-violet-600 bg-violet-50',
  };

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
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[6vh]" onClick={onClose}>
      <style>{`
        @keyframes gsOverlayIn { from { opacity:0 } to { opacity:1 } }
        @keyframes gsModalIn {
          from { opacity:0; transform:translateY(-16px) scale(.97) }
          to   { opacity:1; transform:translateY(0) scale(1) }
        }
        .gs-overlay { animation: gsOverlayIn .2s ease-out }
        .gs-modal   { animation: gsModalIn .28s cubic-bezier(.16,1,.3,1) }
        .gs-chips   { scrollbar-width:none; -ms-overflow-style:none }
        .gs-chips::-webkit-scrollbar { display:none }
        .gs-scroll::-webkit-scrollbar { width:5px }
        .gs-scroll::-webkit-scrollbar-track { background:transparent }
        .gs-scroll::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.08); border-radius:10px }

        /* ── Glass quick-access cards ── */
        .gs-card {
          position: relative;
          background: linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.32) 100%);
          border: 1px solid rgba(255,255,255,0.65);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.85),
            0 1px 2px rgba(15,23,42,0.04);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          transition: all .22s cubic-bezier(.4,0,.2,1);
        }
        .gs-card:hover {
          background: linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,247,237,0.55) 100%);
          border-color: rgba(245,158,11,0.45);
          transform: translateY(-1px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.95),
            0 6px 20px -4px rgba(245,158,11,0.18),
            0 2px 6px rgba(15,23,42,0.06);
        }
        .gs-card:active { transform: scale(0.98); }

        /* ── Search input frame (vidro claro sobre vidro) ── */
        .gs-search-frame {
          background: linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.32) 100%);
          border: 1px solid rgba(255,255,255,0.70);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.90),
            inset 0 -1px 0 rgba(255,255,255,0.20),
            0 1px 2px rgba(15,23,42,0.04);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .gs-search-frame:focus-within {
          border-color: rgba(245,158,11,0.55);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.95),
            0 0 0 3px rgba(245,158,11,0.12),
            0 4px 14px -2px rgba(245,158,11,0.18);
        }

        /* ── Filter pills ── */
        .gs-chip-btn {
          transition: all .15s ease;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .gs-chip-btn.gs-active {
          background: #f97316 !important;
          color: white !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.25),
            0 6px 16px -4px rgba(249,115,22,0.55),
            0 2px 4px rgba(249,115,22,0.20) !important;
          border-color: rgba(249,115,22,0.6) !important;
        }

        /* ── Result rows ── */
        .gs-result {
          transition: background .12s ease, border-color .12s ease, box-shadow .12s ease;
          border-left: 4px solid transparent;
        }
        .gs-result:hover {
          background: rgba(255,255,255,0.50) !important;
        }
        .gs-result.gs-sel {
          background: rgba(255,255,255,0.60) !important;
          border-left-color: #f97316 !important;
          box-shadow: 0 0 0 1px rgba(249,115,22,0.20) !important;
        }

        /* ── Recent pills ── */
        .gs-recent-pill {
          background: linear-gradient(180deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.40) 100%);
          border: 1px solid rgba(255,255,255,0.65);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.85);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          transition: all .15s ease;
        }
        .gs-recent-pill:hover {
          background: linear-gradient(180deg, rgba(254,243,199,0.85) 0%, rgba(253,230,138,0.55) 100%);
          border-color: rgba(251,191,36,0.55);
          color: rgb(120,53,15);
        }

        /* ── Kbd keys ── */
        .gs-kbd {
          background: linear-gradient(180deg, rgba(255,255,255,0.90) 0%, rgba(241,245,249,0.75) 100%);
          border: 1px solid rgba(203,213,225,0.55);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.95),
            0 1px 2px rgba(15,23,42,0.08);
        }
      `}</style>

      {/* Overlay */}
      <div
        className="gs-overlay absolute inset-0 aero-backdrop"
      />

      {/* ═══════════════════════════════════
          MODAL — Aero / Apple Glass Panel
          ═══════════════════════════════════ */}
      <div
        className="gs-modal aero-modal relative w-full max-w-3xl mx-4 rounded-xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Search header ── */}
        <div className="relative z-10 px-5 pt-4 pb-3 border-b border-white/40 flex-shrink-0">
          <div className="gs-search-frame flex items-center gap-3 rounded-lg px-4 py-2.5">
            <div className="flex-shrink-0">
              {loading
                ? <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                : isCommandMode
                ? <Terminal className="w-5 h-5 text-orange-500" />
                : <Search className="w-5 h-5 text-amber-500" />
              }
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={isCommandMode ? "Digite um comando… (ex: novo cliente, ir para agenda)" : "Buscar clientes, processos, prazos… ou / para comandos"}
              className="flex-1 text-[15px] text-gray-800 placeholder-gray-400 bg-transparent outline-none font-medium"
            />
            <div className="flex items-center gap-2">
              {priming && !loading && (
                <span className="flex items-center gap-1 text-[10px] text-amber-500 font-medium">
                  <Zap className="w-3 h-3" /> indexando…
                </span>
              )}
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="text-gray-400 hover:text-gray-600 p-1 hover:bg-white/50 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="hidden sm:inline-flex px-2.5 py-1 text-[11px] font-semibold text-gray-500 rounded-lg hover:bg-white/60 transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.70)',
                  border: '1px solid rgba(203,213,225,0.45)',
                  boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
                }}
              >
                ESC
              </button>
            </div>
          </div>

          {/* Filter pills */}
          {!isCommandMode && showResults && filters.length > 1 && (
            <div className="gs-chips flex items-center gap-2 mt-3 overflow-x-auto">
              {filters.map(f => {
                const active = f.key === activeFilter;
                const FIcon = f.icon;
                return (
                  <button
                    key={f.key}
                    onClick={() => { setActiveFilter(f.key); setSelected(0); }}
                    className={`gs-chip-btn${active ? ' gs-active' : ''} inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap`}
                    style={!active ? {
                      background: 'rgba(255,255,255,0.40)',
                      border: '1px solid rgba(255,255,255,0.35)',
                      color: 'rgb(71,85,105)',
                    } : {}}
                  >
                    <FIcon className={`w-4 h-4 ${active ? 'text-white' : 'text-slate-500'}`} />
                    {f.label}
                    <span className={`tabular-nums text-[11px] font-semibold ${active ? 'text-white/80' : 'text-slate-400'}`}>
                      {f.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="relative z-10 flex flex-1 min-h-0">

          {/* Left: results list */}
          <div className={`flex-1 min-w-0 overflow-y-auto gs-scroll ${!isCommandMode && showResults && previewItem ? 'sm:border-r border-white/30' : ''}`}>

            {/* ── Command Palette ── */}
            {isCommandMode ? (
              <div className="py-2">
                {filteredCmds.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center gap-3">
                    <div className="w-14 h-14 rounded-xl bg-white/60 border border-white/50 flex items-center justify-center">
                      <Terminal className="w-5 h-5 text-gray-300" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-gray-400">Nenhum comando encontrado</p>
                      <p className="text-[11px] text-gray-400 mt-1">Tente "novo cliente" ou "ir para processos"</p>
                    </div>
                  </div>
                ) : (
                  (() => {
                    const categories: CmdCategory[] = ['criar', 'navegar', 'sistema'];
                    let globalIdx = 0;
                    return categories.map(cat => {
                      const cmds = filteredCmds.filter(c => c.category === cat);
                      if (cmds.length === 0) return null;
                      return (
                        <div key={cat}>
                          <div className="flex items-center gap-2 px-5 pt-3 pb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                              {CMD_CATEGORY_LABEL[cat]}
                            </span>
                            <div className="flex-1 h-px bg-gray-200/70" />
                          </div>
                          <div className="space-y-0.5 px-3">
                            {cmds.map(cmd => {
                              const idx = globalIdx++;
                              const isSelected = idx === selectedCmd;
                              const CmdIcon = cmd.icon;
                              return (
                                <button
                                  key={cmd.id}
                                  onClick={() => cmd.action({ onNavigate, onClose, userId })}
                                  onMouseEnter={() => setSelectedCmd(idx)}
                                  className={`gs-result${isSelected ? ' gs-sel' : ''} w-full flex items-center gap-4 px-4 py-3 rounded-lg text-left`}
                                >
                                  <span className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                                    isSelected ? 'bg-orange-50 text-orange-500' : 'bg-slate-50 text-slate-400'
                                  }`}>
                                    <CmdIcon className="w-4 h-4" />
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className={`text-[13px] font-medium truncate ${isSelected ? 'text-slate-800' : 'text-slate-600'}`}>
                                      {cmd.label}
                                    </div>
                                    <div className="text-[11px] text-slate-400 truncate mt-0.5 font-normal">
                                      {cmd.description}
                                    </div>
                                  </div>
                                  {cmd.shortcut && (
                                    <kbd className={`gs-kbd px-1.5 py-0.5 rounded text-[10px] ${isSelected ? 'text-orange-500' : 'text-gray-500'}`}>
                                      {cmd.shortcut}
                                    </kbd>
                                  )}
                                  <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-orange-500' : 'text-slate-300'}`} />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()
                )}
              </div>
            ) : showResults ? (
              <div className="py-2">
                {grouped.map(({ type, cfg, items }) => (
                  <div key={type}>
                    {/* Section header */}
                    <div className="flex items-center gap-2 px-5 pt-3 pb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{cfg.group}</span>
                      <span className="text-[10px] font-bold text-gray-300 tabular-nums">{items.length}</span>
                      <div className="flex-1 h-px bg-gray-200/70" />
                    </div>

                    <div className="space-y-0.5 px-3">
                      {items.map(r => {
                        const fi = flatIdx.get(`${r.type}:${r.id}`) ?? -1;
                        const isSelected = fi === safeSelected;
                        const Icon = cfg.icon;
                        const iconCls = TYPE_ICON_COLOR[r.type];
                        return (
                          <button
                            key={`${r.type}-${r.id}`}
                            onClick={() => handleSelect(r)}
                            onMouseEnter={() => setSelected(fi)}
                            className={`gs-result${isSelected ? ' gs-sel' : ''} w-full flex items-center gap-4 px-4 py-3 rounded-lg text-left`}
                          >
                            {/* Icon / Photo */}
                            {r.type === 'cliente' && photoUrls.get(r.id) ? (
                              <img
                                src={photoUrls.get(r.id)}
                                className="flex-shrink-0 w-10 h-10 rounded-lg object-cover object-top"
                                alt=""
                              />
                            ) : r.type === 'cliente' ? (
                              <span className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-slate-100 text-slate-500 text-[13px] font-semibold">
                                {initials(r.title)}
                              </span>
                            ) : (
                              <span className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-slate-50 text-slate-400">
                                <Icon className="w-5 h-5" />
                              </span>
                            )}

                            {/* Text */}
                            <div className="flex-1 min-w-0">
                              <div className={`text-[13px] font-medium truncate ${isSelected ? 'text-slate-800' : 'text-slate-600'}`}>
                                <Highlight text={r.title} query={query} />
                              </div>
                              {r.subtitle && (
                                <div className="text-[11px] text-slate-400 truncate mt-0.5 font-normal">
                                  <Highlight text={r.subtitle} query={query} />
                                </div>
                              )}
                            </div>

                            {/* Meta + index hint + chevron */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {r.meta && (
                                <span className={`text-[10px] font-normal px-2.5 py-1 rounded-lg border ${
                                  isSelected
                                    ? 'bg-orange-50 text-orange-500 border-orange-200/60'
                                    : 'text-slate-400 border-white/50 bg-white/60'
                                }`}>
                                  {r.meta}
                                </span>
                              )}
                              {fi >= 0 && fi < 9 && !isSelected && (
                                <span className="hidden sm:inline text-[10px] text-slate-300 font-mono bg-slate-50 border border-slate-100 px-1 rounded">
                                  {fi + 1}
                                </span>
                              )}
                              <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-orange-500' : 'text-slate-300'}`} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

            ) : noResults ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-white/60 border border-white/50 flex items-center justify-center">
                  <Search className="w-5 h-5 text-gray-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-400">Nenhum resultado para</p>
                  <p className="text-sm font-semibold text-gray-700 mt-0.5">"{query}"</p>
                  <p className="text-[11px] text-gray-400 mt-2">Tente outro nome, número ou CPF</p>
                </div>
              </div>

            ) : isEmpty ? (
              <div className="py-1">
                {/* Recent searches */}
                {recentSearches.length > 0 && (
                  <div className="px-5 pt-3 pb-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" /> Recentes
                      </span>
                      <button
                        onClick={() => { localStorage.removeItem(recentKey(userId)); setRecentSearches([]); }}
                        className="text-[11px] text-amber-500 hover:text-amber-600 font-medium transition-colors"
                      >
                        Limpar
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {recentSearches.map(r => (
                        <button
                          key={r}
                          onClick={() => setQuery(r)}
                          className="gs-recent-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-gray-500"
                        >
                          <Search className="w-3 h-3 opacity-40" />
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick access grid */}
                <div className="px-5 pt-3 pb-4">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                    <LayoutGrid className="w-3 h-3" /> Acesso rápido
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {([
                      { icon: Users,         label: 'Clientes',      desc: 'nome, CPF, e-mail',          module: 'clientes',      color: 'text-slate-600 bg-slate-100'    },
                      { icon: FileText,      label: 'Processos',     desc: 'número, comarca, partes',     module: 'processos',     color: 'text-amber-600 bg-amber-50'     },
                      { icon: ClipboardList, label: 'Requerimentos', desc: 'beneficiário, protocolo',     module: 'requerimentos', color: 'text-purple-600 bg-purple-50'   },
                      { icon: AlarmClock,    label: 'Prazos',        desc: 'título, cliente',             module: 'prazos',        color: 'text-red-500 bg-red-50'         },
                      { icon: Calendar,      label: 'Agenda',        desc: 'audiências, reuniões',        module: 'agenda',        color: 'text-teal-600 bg-teal-50'       },
                      { icon: CheckSquare,   label: 'Tarefas',       desc: 'título, descrição',           module: 'tarefas',       color: 'text-sky-600 bg-sky-50'         },
                      { icon: DollarSign,    label: 'Financeiro',    desc: 'acordo, cliente',             module: 'financeiro',    color: 'text-emerald-600 bg-emerald-50' },
                      { icon: FolderOpen,    label: 'Cloud',         desc: 'pasta, cliente',              module: 'cloud',         color: 'text-indigo-600 bg-indigo-50'   },
                      { icon: PenTool,       label: 'Assinaturas',   desc: 'documento, cliente',          module: 'assinaturas',   color: 'text-violet-600 bg-violet-50'   },
                    ] as { icon: React.ElementType; label: string; desc: string; module: string; color: string }[])
                      .filter(item => canSeeModule(item.module))
                      .map(({ icon: Icon, label, desc, color, module }) => (
                        <button
                          key={label}
                          onClick={() => { onNavigate(module, undefined); onClose(); }}
                          className="gs-card flex items-start gap-3 p-4 rounded-xl text-left group"
                        >
                          <span className={`flex-shrink-0 p-2.5 rounded-lg ${color} group-hover:scale-105 transition-transform`}>
                            <Icon className="w-5 h-5" />
                          </span>
                          <div className="min-w-0 pt-0.5">
                            <div className="text-[13px] font-medium text-slate-700 group-hover:text-slate-900 leading-none mb-1 truncate">{label}</div>
                            <div className="text-[11px] text-slate-400 leading-tight truncate font-normal">{desc}</div>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right: detail preview panel */}
          {!isCommandMode && showResults && previewItem && previewCfg && (
            <div
              className="hidden sm:flex w-[260px] flex-shrink-0 flex-col items-center justify-start p-5 gap-0"
              style={{
                background: 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,247,237,0.30) 100%)',
                borderLeft: '1px solid rgba(255,255,255,0.50)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
              }}
            >
              {/* Avatar — real photo → initials for clients, icon for others */}
              {previewItem.type === 'cliente' && photoUrls.get(previewItem.id) ? (
                <div
                  className="w-28 h-28 rounded-xl mb-3 flex-shrink-0 overflow-hidden"
                  style={{ boxShadow: '0 12px 32px -8px rgba(0,0,0,0.25)' }}
                >
                  <img src={photoUrls.get(previewItem.id)} className="w-full h-full object-cover object-top" alt="" />
                </div>
              ) : previewItem.type === 'cliente' ? (
                <div
                  className="w-28 h-28 rounded-xl flex items-center justify-center mb-3 text-white text-[32px] font-bold flex-shrink-0"
                  style={{
                    background: '#1e293b',
                    boxShadow: '0 12px 32px -8px rgba(15,23,42,0.35)',
                  }}
                >
                  {initials(previewItem.title)}
                </div>
              ) : (
                <div
                  className={`w-20 h-20 rounded-xl flex items-center justify-center mb-3 ${TYPE_ICON_COLOR[previewItem.type]} flex-shrink-0`}
                  style={{
                    background: 'rgba(255,255,255,0.70)',
                    border: '1px solid rgba(255,255,255,0.55)',
                    boxShadow: '0 6px 20px -4px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.90)',
                  }}
                >
                  <previewCfg.icon className="w-10 h-10" />
                </div>
              )}

              {/* Type badge */}
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
                {previewCfg.label}
              </p>

              {/* Title */}
              <h3 className="text-[15px] font-semibold text-slate-800 leading-snug mb-3 break-words text-center w-full">
                {previewItem.title}
              </h3>

              {/* Detail rows */}
              <div className="w-full space-y-1.5 flex-1">
                {(previewItem.details && previewItem.details.length > 0
                  ? previewItem.details
                  : [
                      previewItem.subtitle ? { icon: Tag, label: 'Info', value: previewItem.subtitle } : null,
                      previewItem.meta     ? { icon: Tag, label: 'Meta', value: previewItem.meta }     : null,
                    ].filter(Boolean) as DetailRow[]
                ).map(({ icon: DIcon, label, value }) => {
                  const st = label === 'Status' ? STATUS_STYLE[value.toLowerCase()] : undefined;
                  const copyId = `${previewItem.id}:${label}`;
                  const isCopied = copiedKey === copyId;
                  const isPhone = label === 'Telefone';
                  const isEmail = label === 'E-mail';
                  const phoneDigits = isPhone ? value.replace(/\D/g, '') : '';
                  return (
                    <div
                      key={label}
                      className="group/row flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors hover:bg-white/60"
                      style={{ background: 'rgba(255,255,255,0.40)' }}
                    >
                      <DIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <div className="min-w-0 text-left flex-1">
                        <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider leading-none mb-0.5">{label}</div>
                        {st ? (
                          <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.text }}>
                            {value}
                          </span>
                        ) : (
                          <div className="text-[12px] text-slate-700 font-normal truncate">{value}</div>
                        )}
                      </div>
                      {/* Quick action buttons — visible on hover */}
                      <div className="opacity-0 group-hover/row:opacity-100 transition-opacity flex items-center gap-0.5 flex-shrink-0">
                        {isPhone && (
                          <>
                            <a
                              href={`https://wa.me/55${phoneDigits}`} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="p-1 hover:bg-green-50 rounded-md" title="WhatsApp"
                            >
                              <MessageCircle className="w-3 h-3 text-green-500" />
                            </a>
                            <a
                              href={`tel:+55${phoneDigits}`}
                              onClick={e => e.stopPropagation()}
                              className="p-1 hover:bg-blue-50 rounded-md" title="Ligar"
                            >
                              <Phone className="w-3 h-3 text-blue-500" />
                            </a>
                          </>
                        )}
                        {isEmail && (
                          <a
                            href={`mailto:${value}`}
                            onClick={e => e.stopPropagation()}
                            className="p-1 hover:bg-orange-50 rounded-md" title="Enviar e-mail"
                          >
                            <Mail className="w-3 h-3 text-orange-400" />
                          </a>
                        )}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(value).then(() => {
                              setCopiedKey(copyId);
                              setTimeout(() => setCopiedKey(null), 2000);
                            });
                          }}
                          className="p-1 hover:bg-white/70 rounded-md flex-shrink-0" title="Copiar"
                        >
                          {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Open button */}
              <button
                onClick={() => handleSelect(previewItem)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-white text-[13px] font-semibold transition-all active:scale-[0.98] mt-4 group"
                style={{
                  background: '#f97316',
                  boxShadow: '0 6px 20px -4px rgba(249,115,22,0.45)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#ea6b0a')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f97316')}
              >
                Abrir
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="relative z-10 px-5 py-2 flex items-center justify-between text-[11px] text-gray-500 flex-shrink-0"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.40) 100%)',
            borderTop: '1px solid rgba(255,255,255,0.45)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <kbd className="gs-kbd px-1.5 py-0.5 rounded text-gray-500 text-[10px]">↑↓</kbd>
              navegar
            </span>
            {!isCommandMode && showResults && filters.length > 1 && (
              <span className="flex items-center gap-1.5">
                <kbd className="gs-kbd px-1.5 py-0.5 rounded text-gray-500 text-[10px]">Tab</kbd>
                filtrar
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <kbd className="gs-kbd px-1.5 py-0.5 rounded text-gray-500 text-[10px]">↵</kbd>
              abrir
            </span>
            {flatResults.length > 0 && (
              <span className="text-gray-400 tabular-nums">
                {flatResults.length} resultado{flatResults.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-gray-400 text-[10px]">
            {!isCommandMode && (
              <span className="flex items-center gap-1 text-gray-400">
                <Terminal className="w-3 h-3 text-orange-400" />
                <span>digite <span className="font-mono font-bold text-orange-400">/</span> para comandos</span>
              </span>
            )}
            {isCommandMode && filteredCmds.length > 0 && (
              <span className="tabular-nums text-gray-400">
                {filteredCmds.length} comando{filteredCmds.length !== 1 ? 's' : ''}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>⌘K · Ctrl+K</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
