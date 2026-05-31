import { useEffect, useState, useMemo, useCallback, lazy, Suspense, useRef } from 'react';
import { useNavigation } from './contexts/NavigationContext';
import type { ModuleName } from './contexts/NavigationContext';
import {
  Users,
  Cloud,
  Calendar,
  MessageCircle,
  X,
  Bell,
  LogOut,
  Loader2,
  UserCog,
  Target,
  Layers,
  Library,
  Briefcase,
  AlarmClock,
  Menu,
  CheckSquare,
  PiggyBank,
  Search,
  FileText,
  Settings,
  Moon,
  Scale,
  Sun,
  PenTool,
  Newspaper,
  RefreshCw,
  Plus,
  Upload,
  FolderPlus,
  Filter,
  List,
  LayoutGrid,
  Lock,
  ShieldOff,
  Copy,
  CheckCheck,
  ArrowLeft,
  Send,
  Clock,
  MessageSquare,
} from 'lucide-react';
import Login from './components/Login';
import OfflinePage from './components/OfflinePage';
import { NotificationBell } from './components/NotificationBell';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import SessionWarning from './components/SessionWarning';
import TermsPrivacyPage from './components/TermsPrivacyPage';
import ProfileModal, { type AppProfile, type UserRole } from './components/ProfileModal';

// Lazy loading dos módulos principais (carrega apenas quando acessado)
const Dashboard = lazy(() => import('./components/Dashboard'));
const Feed = lazy(() => import('./components/Feed'));
const UserProfilePage = lazy(() => import('./components/UserProfilePage'));
const ClientsModule = lazy(() => import('./components/ClientsModule'));
const DocumentsModule = lazy(() => import('./components/DocumentsModule'));
const CloudModule = lazy(() => import('./components/CloudModule'));
const LeadsModule = lazy(() => import('./components/LeadsModule'));
const ProcessesModule = lazy(() => import('./components/ProcessesModule'));
const IntimationsModule = lazy(() => import('./components/IntimationsModule'));
const RequirementsModule = lazy(() => import('./components/RequirementsModule'));
const DeadlinesModule = lazy(() => import('./components/DeadlinesModule'));
const CalendarModule = lazy(() => import('./components/CalendarModule'));
const TasksModule = lazy(() => import('./components/TasksModule'));
const ChatModule = lazy(() => import('./components/ChatModule'));
const UserManagementModule = lazy(() => import('./components/UserManagementModule'));
const NotificationsModuleNew = lazy(() => import('./components/NotificationsModuleNew'));
const FinancialModule = lazy(() => import('./components/FinancialModule'));
const SignatureModule = lazy(() => import('./components/SignatureModule'));
const SettingsModule = lazy(() => import('./components/SettingsModule'));
const CronEndpoint = lazy(() => import('./components/CronEndpoint'));
const PublicSigningPage = lazy(() => import('./components/PublicSigningPage'));
const PublicTemplateFillPage = lazy(() => import('./components/PublicTemplateFillPage'));
const PublicVerificationPage = lazy(() => import('./components/PublicVerificationPage'));
const PublicPermalinkRedirect = lazy(() => import('./components/PublicPermalinkRedirect'));
const PublicCloudSharePage = lazy(() => import('./components/PublicCloudSharePage'));
const PublicDocumentPage = lazy(() => import('./components/PublicDocumentPage'));
const DocsPage = lazy(() => import('./components/DocsPage'));
// Portal do Cliente - Módulo isolado em src/portal/ (pode ser removido sem afetar o app principal)
const PortalApp = lazy(() => import('./portal/PortalApp'));
// Editor de Petições - Módulo isolado (pode ser removido sem afetar outros módulos)
const PetitionEditorModule = lazy(() => import('./components/PetitionEditorModule'));
// Widget flutuante do Editor de Petições
const PetitionEditorWidget = lazy(() => import('./components/PetitionEditorWidget'));
const ChatFloatingWidget = lazy(() => import('./components/ChatFloatingWidget'));
import { usePresence } from './hooks/usePresence';
import { useAuth } from './contexts/AuthContext';
import { events, SYSTEM_EVENTS } from './utils/events';
import { useTheme } from './contexts/ThemeContext';
import { CacheProvider } from './contexts/CacheContext';
import { useDjenSync } from './hooks/useDjenSync';
import { profileService } from './services/profile.service';
import { leadService } from './services/lead.service';
import { taskService } from './services/task.service';
import { djenLocalService } from './services/djenLocal.service';
import { supabase } from './config/supabase';
import { clientService } from './services/client.service';
import { formatCPF } from './utils/formatters';
import { usePermissions } from './hooks/usePermissions';
import type { Lead } from './types/lead.types';
import type { CreateClientDTO } from './types/client.types';

type ClientSearchResult = Awaited<ReturnType<typeof clientService.searchClients>>[number];
type CloudHeaderActionDetail = {
  action: 'upload' | 'create-folder' | 'toggle-filters' | 'set-view-mode' | 'set-card-size' | 'toggle-sidebar' | 'set-search-term';
  value?: 'list' | 'cards' | 'small' | 'medium' | 'large' | string;
};
type CloudHeaderStateDetail = {
  viewMode: 'list' | 'cards';
  cardSize: 'small' | 'medium' | 'large';
  showFilters: boolean;
};

const dispatchCloudHeaderAction = (detail: CloudHeaderActionDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('cloud-header-action', { detail }));
};

const CloudModuleFallback = () => (
  <div className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-[radial-gradient(circle_at_top,#fff7ed_0%,#ffffff_38%,#fffaf5_100%)] shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
    <div className="border-b border-slate-200/70 bg-white/90 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-10 w-24 animate-pulse rounded-xl bg-orange-100" />
          <div className="h-10 w-28 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-10 w-24 animate-pulse rounded-xl bg-slate-100" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-10 w-28 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-10 w-24 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
    </div>
    <div className="px-4 py-5 sm:px-5 sm:py-6">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="hidden rounded-[26px] border border-slate-200/80 bg-white/85 p-4 lg:block">
          <div className="h-11 animate-pulse rounded-2xl bg-slate-100" />
          <div className="mt-4 space-y-3">
            <div className="h-16 animate-pulse rounded-2xl bg-gradient-to-r from-orange-100 via-amber-50 to-orange-50" />
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        </div>
        <div className="rounded-[26px] border border-slate-200/80 bg-white/88 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="h-6 w-40 animate-pulse rounded-lg bg-slate-200" />
              <div className="mt-2 h-4 w-64 max-w-full animate-pulse rounded-lg bg-slate-100" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-9 w-24 animate-pulse rounded-xl bg-orange-100" />
              <div className="h-9 w-20 animate-pulse rounded-xl bg-slate-100" />
            </div>
          </div>
          <div className="grid gap-3 pt-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fffaf5_100%)] p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                <div className="flex items-start justify-between">
                  <div className="h-12 w-12 animate-pulse rounded-2xl bg-orange-100" />
                  <div className="h-7 w-24 animate-pulse rounded-full bg-emerald-100" />
                </div>
                <div className="mt-5 h-5 w-3/4 animate-pulse rounded-lg bg-slate-200" />
                <div className="mt-2 h-4 w-1/2 animate-pulse rounded-lg bg-slate-100" />
                <div className="mt-5 h-px w-full bg-slate-100" />
                <div className="mt-4 flex items-center gap-2">
                  <div className="h-6 w-20 animate-pulse rounded-full bg-orange-100" />
                  <div className="h-6 flex-1 animate-pulse rounded-full bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-500/80">
            <span className="animate-pulse">Carregando</span>
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-orange-300" />
            <span className="animate-pulse">Cloud</span>
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
            <span className="animate-pulse">Explorador</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ── AccessDeniedScreen ────────────────────────────────────────────────────────
const MODULE_META: Record<string, { label: string; desc: string; Icon: React.ElementType }> = {
  leads:         { label: 'Leads',                desc: 'captação e gestão de leads',            Icon: Target },
  clientes:      { label: 'Clientes',             desc: 'cadastro e histórico de clientes',       Icon: Users },
  documentos:    { label: 'Documentos',           desc: 'contratos e modelos',                    Icon: FileText },
  cloud:         { label: 'Cloud',                desc: 'armazenamento de arquivos',              Icon: Cloud },
  assinaturas:   { label: 'Assinaturas Digitais', desc: 'coleta de assinaturas eletrônicas',      Icon: PenTool },
  processos:     { label: 'Processos',            desc: 'acompanhamento processual',              Icon: Briefcase },
  requerimentos: { label: 'Requerimentos',        desc: 'petições e requerimentos',               Icon: Library },
  prazos:        { label: 'Prazos',               desc: 'controle de prazos judiciais',           Icon: AlarmClock },
  intimacoes:    { label: 'Intimações',           desc: 'comunicações judiciais eletrônicas',     Icon: Bell },
  financeiro:    { label: 'Financeiro',           desc: 'honorários, acordos e pagamentos',       Icon: PiggyBank },
  agenda:        { label: 'Agenda',               desc: 'compromissos e audiências',              Icon: Calendar },
  tarefas:       { label: 'Tarefas',              desc: 'atividades e pendências',                Icon: CheckSquare },
  chat:          { label: 'Mensagens',            desc: 'comunicação interna',                    Icon: MessageCircle },
  peticoes:      { label: 'Editor de Petições',   desc: 'redação e formatação de petições',       Icon: Newspaper },
  configuracoes: { label: 'Configurações',        desc: 'ajustes do sistema',                     Icon: Settings },
};

const AccessDeniedScreen: React.FC<{
  moduleKey: string;
  userRole: string;
  userId: string;
  userName: string;
  onGoHome: () => void;
}> = ({ moduleKey, userRole, userId, userName, onGoHome }) => {
  const meta = MODULE_META[moduleKey] ?? { label: moduleKey, desc: 'este módulo', Icon: Scale };
  const { Icon } = meta;

  type ReqState = 'checking' | 'none' | 'pending' | 'denied' | 'approved_expired';
  const [reqState, setReqState] = useState<ReqState>('checking');
  const [lastRequest, setLastRequest] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [justification, setJustification] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!userId) { setReqState('none'); return; }
    try {
      const { accessRequestService } = await import('./services/accessRequest.service');
      const reqs = await accessRequestService.listByRequester(userId);
      const forModule = reqs
        .filter(r => r.module_key === moduleKey)
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const pending = forModule.find((r: any) => r.status === 'pending');
      if (pending) { setReqState('pending'); setLastRequest(pending); return; }

      const approved = forModule.find((r: any) => r.status === 'approved');
      if (approved?.expires_at && new Date(approved.expires_at) < new Date()) {
        setReqState('approved_expired'); setLastRequest(approved); return;
      }

      const denied = forModule.find((r: any) => r.status === 'denied');
      if (denied) { setReqState('denied'); setLastRequest(denied); return; }

      setReqState('none');
    } catch { setReqState('none'); }
  }, [userId, moduleKey]);

  useEffect(() => { loadState(); }, [loadState]);

  const handleSendRequest = async () => {
    if (!justification.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const { accessRequestService } = await import('./services/accessRequest.service');
      const req = await accessRequestService.createRequest({
        requester_id: userId,
        requester_name: userName,
        requester_role: userRole,
        module_key: moduleKey,
        module_label: meta.label,
        justification: justification.trim(),
      });
      await accessRequestService.notifyAdmins(req.id, userName, meta.label);
      setReqState('pending');
      setLastRequest(req);
      setShowModal(false);
      setJustification('');
    } catch (e: any) {
      setSendError(e?.message ?? 'Erro ao enviar solicitação.');
    } finally {
      setSending(false);
    }
  };

  // Helpers
  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  const grantedDuration = (req: any): string => {
    if (!req?.expires_at) return 'permanente';
    const diffMs = new Date(req.expires_at).getTime() - new Date(req.resolved_at || req.created_at).getTime();
    const h = diffMs / 3_600_000;
    if (h < 23) return `${Math.round(h)} hora${Math.round(h) !== 1 ? 's' : ''}`;
    const d = Math.round(h / 24);
    return `${d} dia${d !== 1 ? 's' : ''}`;
  };

  // ── Right-panel content by state ──────────────────────────────────────
  const renderRightPanel = () => {
    // DENIED
    if (reqState === 'denied') return (
      <div className="flex-1 flex flex-col justify-center bg-white px-10 py-12">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-5 h-5 rounded-md bg-red-100 flex items-center justify-center">
            <ShieldOff className="w-3 h-3 text-red-500" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-400">Acesso Negado</span>
        </div>

        <h1 className="text-[1.85rem] font-extrabold text-slate-900 leading-[1.15] mb-3">
          Sua solicitação<br />foi <span className="text-red-500">negada</span>.
        </h1>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-0.5 bg-red-400 rounded-full" />
          <div className="w-2 h-0.5 bg-slate-200 rounded-full" />
        </div>

        <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-sm">
          O administrador analisou sua solicitação de acesso ao módulo{' '}
          <span className="font-semibold text-slate-700">{meta.label}</span> e optou por não conceder a permissão.
        </p>

        {lastRequest?.admin_notes && (
          <div className="flex items-start gap-3 px-4 py-3.5 bg-red-50 border border-red-200 rounded-2xl mb-4">
            <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <MessageSquare className="w-3.5 h-3.5 text-red-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-red-700 uppercase tracking-wide mb-1">Motivo informado</p>
              <p className="text-sm text-red-800 leading-relaxed">{lastRequest.admin_notes}</p>
            </div>
          </div>
        )}

        {lastRequest?.resolved_at && (
          <p className="text-xs text-slate-400 mb-8">
            Decidido em {fmtDate(lastRequest.resolved_at)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onGoHome}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.97] text-white text-sm font-bold transition-all shadow-md">
            <ArrowLeft className="w-3.5 h-3.5" />
            Ir ao Dashboard
          </button>
          <button onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.97] text-white text-sm font-bold transition-all shadow-md shadow-amber-200/60">
            <Send className="w-3.5 h-3.5" />
            Solicitar novamente
          </button>
        </div>
      </div>
    );

    // APPROVED EXPIRED
    if (reqState === 'approved_expired') return (
      <div className="flex-1 flex flex-col justify-center bg-white px-10 py-12">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center">
            <Clock className="w-3 h-3 text-amber-600" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-500">Acesso Expirado</span>
        </div>

        <h1 className="text-[1.85rem] font-extrabold text-slate-900 leading-[1.15] mb-3">
          Seu acesso<br />temporário <span className="text-amber-500">expirou</span>.
        </h1>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-0.5 bg-amber-400 rounded-full" />
          <div className="w-2 h-0.5 bg-slate-200 rounded-full" />
        </div>

        <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-sm">
          Você havia recebido acesso ao módulo{' '}
          <span className="font-semibold text-slate-700">{meta.label}</span> por um período determinado que já se encerrou.
        </p>

        <div className="flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-2xl mb-4">
          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">Acesso concedido</p>
            <p className="text-sm text-amber-800 font-semibold">por {grantedDuration(lastRequest)}</p>
            {lastRequest?.expires_at && (
              <p className="text-xs text-amber-600 mt-0.5">Expirou em {fmtDate(lastRequest.expires_at)}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-2">
          <button onClick={onGoHome}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.97] text-white text-sm font-bold transition-all shadow-md">
            <ArrowLeft className="w-3.5 h-3.5" />
            Ir ao Dashboard
          </button>
          <button onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.97] text-white text-sm font-bold transition-all shadow-md shadow-amber-200/60">
            <Send className="w-3.5 h-3.5" />
            Solicitar renovação
          </button>
        </div>
      </div>
    );

    // PENDING
    if (reqState === 'pending') return (
      <div className="flex-1 flex flex-col justify-center bg-white px-10 py-12">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center">
            <Clock className="w-3 h-3 text-amber-600" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-500">Em Análise</span>
        </div>

        <h1 className="text-[1.85rem] font-extrabold text-slate-900 leading-[1.15] mb-3">
          Solicitação<br /><span className="text-amber-500">aguardando</span><br />aprovação.
        </h1>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-0.5 bg-amber-400 rounded-full" />
          <div className="w-2 h-0.5 bg-slate-200 rounded-full" />
        </div>

        <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-sm">
          Sua solicitação de acesso ao módulo{' '}
          <span className="font-semibold text-slate-700">{meta.label}</span> foi enviada e está sendo analisada pelo administrador. Você receberá uma notificação assim que houver uma decisão.
        </p>

        {lastRequest?.created_at && (
          <div className="flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-2xl mb-6">
            <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">Enviado em</p>
              <p className="text-sm text-amber-800">{fmtDate(lastRequest.created_at)}</p>
              {lastRequest.justification && (
                <p className="text-xs text-amber-600 mt-1 italic">"{lastRequest.justification}"</p>
              )}
            </div>
          </div>
        )}

        <button onClick={onGoHome}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.97] text-white text-sm font-bold transition-all shadow-md w-fit">
          <ArrowLeft className="w-3.5 h-3.5" />
          Ir ao Dashboard
        </button>
      </div>
    );

    // NONE / CHECKING — default
    return (
      <div className="flex-1 flex flex-col justify-center bg-white px-10 py-12">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-5 h-5 rounded-md bg-red-100 flex items-center justify-center">
            <ShieldOff className="w-3 h-3 text-red-500" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Acesso Restrito</span>
        </div>

        <h1 className="text-[2rem] font-extrabold text-slate-900 leading-[1.1] mb-3">
          Você não tem<br />permissão para<br />este módulo.
        </h1>

        <p className="sm:hidden text-sm text-slate-500 mb-2">
          Módulo: <span className="font-semibold text-slate-700">{meta.label}</span> — {meta.desc}
        </p>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-0.5 bg-amber-400 rounded-full" />
          <div className="w-2 h-0.5 bg-slate-200 rounded-full" />
        </div>

        <p className="text-sm text-slate-500 leading-relaxed mb-8 max-w-sm">
          O seu cargo de <span className="font-semibold text-slate-700">{userRole}</span> não inclui acesso ao módulo de{' '}
          <span className="font-medium text-slate-700">{meta.desc}</span>. Para exercer atividades aqui, solicite ao administrador — você pode enviar uma justificativa pelo botão abaixo.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onGoHome}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-[0.97] text-white text-sm font-bold transition-all shadow-md">
            <ArrowLeft className="w-3.5 h-3.5" />
            Ir ao Dashboard
          </button>

          {reqState !== 'checking' && (
            <button onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.97] text-white text-sm font-bold transition-all shadow-md shadow-amber-200/60">
              <Send className="w-3.5 h-3.5" />
              Solicitar acesso
            </button>
          )}
        </div>

        <p className="mt-10 text-[11px] text-slate-300 leading-relaxed max-w-xs">
          Acesso concedido pelo administrador pode ser temporário (por prazo definido) ou permanente.
        </p>
      </div>
    );
  };

  return (
    <>
    {/* ── Tela principal: split full-height ──────────────────────────── */}
    <div className="flex min-h-[72vh] select-none overflow-hidden rounded-2xl border border-slate-200 shadow-sm">

      {/* ══ Painel esquerdo — visual (45%) ═══════════════════════════════ */}
      <div className="relative hidden sm:flex flex-col items-center justify-center w-[45%] flex-shrink-0 overflow-hidden bg-[#0f172a]">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-[#0f172a] to-[#020617]" />
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

        {/* Glow color changes by state */}
        <div className={`absolute w-80 h-80 rounded-full blur-3xl top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-700 ${
          reqState === 'denied' ? 'bg-red-500/10'
          : reqState === 'approved_expired' ? 'bg-amber-500/10'
          : reqState === 'pending' ? 'bg-amber-400/10'
          : 'bg-amber-500/10'
        }`} />

        <div className="relative z-10 flex flex-col items-center gap-7 px-10">
          <div className="relative">
            <div className="w-36 h-36 rounded-3xl border border-white/8 bg-white/4 flex items-center justify-center backdrop-blur-sm shadow-2xl">
              <Icon className="w-16 h-16 text-white/20" />
            </div>
            <div className={`absolute -bottom-3 -right-3 w-10 h-10 rounded-full flex items-center justify-center shadow-xl border-[3px] border-[#0f172a] transition-colors duration-500 ${
              reqState === 'denied' ? 'bg-red-500'
              : reqState === 'pending' || reqState === 'approved_expired' ? 'bg-amber-500'
              : 'bg-amber-500'
            }`}>
              {reqState === 'denied'
                ? <ShieldOff className="w-4 h-4 text-white" />
                : reqState === 'pending'
                ? <Clock className="w-4 h-4 text-white" />
                : reqState === 'approved_expired'
                ? <Clock className="w-4 h-4 text-white" />
                : <Lock className="w-4 h-4 text-white" />}
            </div>
            <div className="absolute inset-0 rounded-3xl ring-1 ring-amber-400/15 scale-110" />
          </div>

          <div className="text-center">
            <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-amber-400/60 mb-2">Módulo</p>
            <p className="text-2xl font-bold text-white leading-tight">{meta.label}</p>
            <p className="text-xs text-slate-500 mt-1.5 font-medium">{meta.desc}</p>
          </div>

          <div className="flex items-center gap-3 w-full px-4">
            <div className="flex-1 h-px bg-white/8" />
            <Lock className="w-3 h-3 text-white/20" />
            <div className="flex-1 h-px bg-white/8" />
          </div>

          <div className="text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Seu perfil</p>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/8 border border-white/10 text-white/70 text-sm font-semibold">
              {userRole}
            </span>
          </div>

          {/* State indicator on left panel */}
          <div className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border ${
            reqState === 'denied' ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : reqState === 'pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            : reqState === 'approved_expired' ? 'bg-amber-400/10 border-amber-400/20 text-amber-400'
            : 'bg-white/5 border-white/10 text-white/30'
          }`}>
            {reqState === 'denied' ? '✕ Negado'
            : reqState === 'pending' ? '⏳ Em análise'
            : reqState === 'approved_expired' ? '⌛ Expirado'
            : '🔒 Sem permissão'}
          </div>
        </div>
      </div>

      {/* ══ Painel direito — conteúdo dinâmico ═══════════════════════════ */}
      {renderRightPanel()}
    </div>

    {/* ── Modal de solicitação ─────────────────────────────────────────── */}
    {showModal && (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-md" />
        <div
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-[400px] overflow-hidden"
          onClick={e => e.stopPropagation()}
          style={{ boxShadow: '0 32px 64px -12px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06)' }}
        >
          <button
            onClick={() => setShowModal(false)}
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition"
          >
            <X className="w-3.5 h-3.5 text-slate-500" />
          </button>

          <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400" />

          <div className="pt-8 pb-6 px-8 flex flex-col items-center text-center">
            <div className="relative mb-5">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center shadow-sm">
                <Icon className="w-6 h-6 text-amber-600" />
              </div>
              <div className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center border-[2px] border-white">
                <Lock className="w-2.5 h-2.5 text-amber-400" />
              </div>
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-0.5">Solicitar acesso</h2>
            <p className="text-xs text-slate-400">
              Módulo <span className="font-semibold text-slate-600">{meta.label}</span>
            </p>
          </div>

          <div className="px-7 pb-2">
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              Descreva por que precisa acessar este módulo. O administrador receberá uma notificação e poderá liberar o acesso de forma <span className="font-medium text-slate-700">temporária ou permanente</span>.
            </p>

            <label className="block text-[10.5px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Justificativa <span className="text-red-400">*</span>
            </label>
            <textarea
              className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-3 text-sm text-slate-800 placeholder-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300/50 focus:border-amber-400 transition-all leading-relaxed"
              rows={4}
              placeholder={`Por que precisa acessar ${meta.label}?`}
              value={justification}
              onChange={e => setJustification(e.target.value)}
              maxLength={500}
              autoFocus
            />
            <div className="flex justify-end mt-1 mb-1">
              <span className={`text-[10px] tabular-nums ${justification.length > 450 ? 'text-amber-500 font-medium' : 'text-slate-300'}`}>
                {justification.length}/500
              </span>
            </div>

            {sendError && (
              <div className="flex items-center gap-2 mt-1 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
                <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-600">{sendError}</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 px-7 py-5">
            <button
              onClick={() => setShowModal(false)}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={handleSendRequest}
              disabled={!justification.trim() || sending}
              className="flex-[2] inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-all shadow-md shadow-amber-100"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? 'Enviando...' : 'Enviar solicitação'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

// ── SearchBarTypewriter ────────────────────────────────────────────────────────
const TYPEWRITER_PHRASES = [
  'Maria das Graças Oliveira',
  'Requerimento 37363535',
  '1018454-17.2024.8.19.0001',
  'Audiência 15/06',
  'Prazo recursal',
  'José Ribeiro da Silva',
  'Acordo R$ 12.500',
  'Contrato Pedro Alves',
];

const SearchBarTypewriter: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const [display, setDisplay] = useState('');
  const stateRef = useRef({ phraseIdx: 0, charIdx: 0, erasing: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tick = () => {
      const st = stateRef.current;
      const phrase = TYPEWRITER_PHRASES[st.phraseIdx];

      if (!st.erasing) {
        if (st.charIdx < phrase.length) {
          st.charIdx++;
          setDisplay(phrase.slice(0, st.charIdx));
          timerRef.current = setTimeout(tick, 62);
        } else {
          // Full phrase shown — pause then erase
          timerRef.current = setTimeout(() => {
            st.erasing = true;
            tick();
          }, 1800);
        }
      } else {
        if (st.charIdx > 0) {
          st.charIdx--;
          setDisplay(phrase.slice(0, st.charIdx));
          timerRef.current = setTimeout(tick, 28);
        } else {
          // All erased — next phrase
          st.phraseIdx = (st.phraseIdx + 1) % TYPEWRITER_PHRASES.length;
          st.erasing = false;
          timerRef.current = setTimeout(tick, 320);
        }
      }
    };

    timerRef.current = setTimeout(tick, 900);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <button
      onClick={onClick}
      className="hidden lg:flex items-center gap-3 w-80 xl:w-[440px] px-5 py-[10px] rounded-full bg-white border border-slate-200/70 shadow-[0_1px_6px_rgba(32,33,36,0.1)] hover:shadow-[0_2px_14px_rgba(251,146,60,0.16)] hover:border-amber-300/50 transition-all duration-300 group cursor-text select-none"
      title="Busca global (⌘K / Ctrl+K)"
    >
      {/* Ícone */}
      <Search className="w-[17px] h-[17px] flex-shrink-0 text-amber-400 group-hover:text-amber-500 transition-colors duration-200" />

      {/* Texto animado */}
      <span className="flex-1 text-[13px] text-slate-400 font-normal truncate leading-none">
        {display}<span className="search-cursor" />
      </span>

      {/* Separador + atalho */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="w-px h-4 bg-slate-200 group-hover:bg-amber-200/60 transition-colors" />
        <kbd className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 group-hover:bg-amber-50 text-slate-400 group-hover:text-amber-600 border border-slate-200 group-hover:border-amber-200 font-mono transition-all duration-200 leading-none">
          ⌘K
        </kbd>
      </div>
    </button>
  );
};

// ── Sidebar module button with optional temporary-access countdown ────────────
const SidebarModuleBtn: React.FC<{
  moduleKey: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  onClick: () => void;
  expiresAt?: string | null;
}> = ({ label, Icon, isActive, onClick, expiresAt }) => {
  const [countdown, setCountdown] = useState<string | null>(null);
  const isTemporary = !!expiresAt;

  useEffect(() => {
    if (!expiresAt) { setCountdown(null); return; }
    const compute = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setCountdown('Expirado'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      if (h > 0) setCountdown(`${h}h ${m}m`);
      else if (m > 0) setCountdown(`${m}m ${s}s`);
      else setCountdown(`${s}s`);
    };
    compute();
    const id = setInterval(compute, 1_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center py-2 px-1 rounded-lg transition-colors ${
        isActive
          ? 'text-amber-500'
          : isTemporary
          ? 'text-cyan-400 hover:text-cyan-300 hover:bg-slate-800/50'
          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
      }`}
    >
      {/* Barra lateral esquerda */}
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />
      )}
      {isTemporary && !isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-cyan-400 rounded-r" />
      )}

      {/* Ícone + ponto indicador */}
      <div className="relative">
        <Icon className="w-5 h-5" />
        {isTemporary && !isActive && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-cyan-400 rounded-full ring-1 ring-slate-900" />
        )}
      </div>

      <span className="text-[9px] mt-0.5 leading-tight">{label}</span>

      {/* Contagem regressiva */}
      {isTemporary && countdown && (
        <span
          className={`text-[8px] font-mono leading-tight ${
            isActive ? 'text-amber-400/80' : 'text-cyan-400/80'
          }`}
        >
          {countdown}
        </span>
      )}
    </button>
  );
};

const MainApp: React.FC = () => {
  const { currentModule: activeModule, moduleParams, navigateTo, setModuleParams, clearModuleParams } = useNavigation();
  const { theme, toggleTheme } = useTheme();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [cloudMobileSearchTerm, setCloudMobileSearchTerm] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cloudHeaderState, setCloudHeaderState] = useState<CloudHeaderStateDetail>({ viewMode: 'list', cardSize: 'medium', showFilters: false });
  const { canView, canCreate, canEdit, canDelete, loading: permissionsLoading, isAdmin, overrides } = usePermissions();

  // Retorna expires_at caso o módulo tenha acesso temporário via override
  const getOverrideExpiry = useCallback((moduleKey: string): string | null => {
    if (isAdmin) return null;
    const ov = overrides.find(o => o.module === moduleKey && !!o.expires_at);
    return ov?.expires_at ?? null;
  }, [isAdmin, overrides]);
  const [sidebarPendingCount, setSidebarPendingCount] = useState(0);

  // Carregar contagem de solicitações pendentes para badge no sidebar
  useEffect(() => {
    if (!isAdmin) return;
    import('./services/accessRequest.service').then(({ accessRequestService }) => {
      accessRequestService.getPendingCount().then(setSidebarPendingCount).catch(() => {});
    });
  }, [isAdmin]);

  // Estados para o seletor de mês do módulo Prazos
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handler = (event: MessageEvent) => {
      const data = (event as any)?.data;
      if (!data) return;
      if (data.action === 'navigate' && data.module) {
        navigateTo(data.module as any, data.params);
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [navigateTo]);

  // Cross-module navigation via events
  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.NAVIGATE_REQUEST, (data?: { module: string; params?: Record<string, any> }) => {
      if (data?.module) {
        safeNavigateTo(data.module as any, data.params);
      }
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleCloudHeaderState = (event: Event) => {
      const detail = (event as CustomEvent<CloudHeaderStateDetail>).detail;
      if (!detail) return;
      setCloudHeaderState(detail);
    };

    window.addEventListener('cloud-header-state', handleCloudHeaderState as EventListener);
    return () => window.removeEventListener('cloud-header-state', handleCloudHeaderState as EventListener);
  }, []);

  useEffect(() => {
    if (activeModule !== 'cloud') {
      setCloudMobileSearchTerm('');
    }
  }, [activeModule]);

  // Detectar status de conexão
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  const { user, loading, signIn, signOut, resetPassword } = useAuth();

  useEffect(() => {
    if (!user) return;

    const connection = (navigator as any)?.connection;
    const saveData = Boolean(connection?.saveData);
    const effectiveType = String(connection?.effectiveType || '');

    if (saveData) return;
    if (effectiveType && effectiveType.includes('2g')) return;

    const prefetch = () => {
      const tasks = [
        () => import('./components/Dashboard'),
        () => import('./components/ProcessesModule'),
        () => import('./components/ClientsModule'),
        () => import('./components/DeadlinesModule'),
        () => import('./components/CalendarModule'),
        () => import('./components/FinancialModule'),
        () => import('./components/DocumentsModule'),
        () => import('./components/IntimationsModule'),
        () => import('./components/NotificationsModuleNew'),
        () => import('./components/TasksModule'),
        () => import('./components/SignatureModule'),
        () => import('./components/LeadsModule'),
        () => import('./components/RequirementsModule'),
        () => import('./components/SettingsModule'),
        () => import('./components/DocsPage'),
      ];

      tasks.forEach((task, idx) => {
        window.setTimeout(() => {
          task().catch(() => undefined);
        }, 200 * idx);
      });
    };

    const ric = (window as any)?.requestIdleCallback;
    if (typeof ric === 'function') {
      ric(prefetch, { timeout: 2000 });
      return;
    }

    const timer = window.setTimeout(prefetch, 600);
    return () => window.clearTimeout(timer);
  }, [user]);
  
  // Ativar sincronização automática com DJEN
  useDjenSync();
  
  // Ativar sistema de presença
  usePresence();

  const GENERIC_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=300';

  const sanitizeRole = (role: any): UserRole => {
    const value = String(role || '').toLowerCase();
    if (value === 'administrador') return 'Administrador';
    if (value === 'advogado') return 'Advogado';
    if (value === 'auxiliar') return 'Auxiliar';
    if (value === 'secretaria' || value === 'secretária') return 'Secretária';
    if (value === 'financeiro') return 'Financeiro';
    if (value === 'estagiario' || value === 'estagiário') return 'Estagiário';
    return 'Auxiliar';
  };

  const [profile, setProfile] = useState<AppProfile>({
    name: 'Usuário',
    email: '',
    avatarUrl: GENERIC_AVATAR,
    role: 'Auxiliar',
    cpf: '',
    oab: '',
    phone: '',
    bio: '',
    lawyerFullName: '',
  });

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileBanner, setProfileBanner] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [clientPrefill, setClientPrefill] = useState<Partial<CreateClientDTO> | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const logoutCleanupDoneRef = useRef(false);

  const canAccessConfig = useMemo(() => 
    ['admin', 'administrador', 'advogado'].includes((profile.role || '').toLowerCase()),
    [profile.role]
  );

  const permissionGuardedModules = useMemo<ModuleName[]>(() => [
    'leads',
    'clientes',
    'documentos',
    'cloud',
    'assinaturas',
    'processos',
    'requerimentos',
    'prazos',
    'intimacoes',
    'notificacoes',
    'financeiro',
    'agenda',
    'tarefas',
    'chat',
    'peticoes',
    'configuracoes',
    'usuarios',
    'monitor',
  ], []);

  const canAccessModule = useCallback((moduleKey: ModuleName) => {
    if (isAdmin) return true;
    if (moduleKey === 'configuracoes') return canAccessConfig;
    if (moduleKey === 'cloud') return canView('cloud') || canView('documentos');
    return canView(moduleKey);
  }, [isAdmin, canAccessConfig, canView]);

  const hasModuleAccess = useCallback((moduleKey: ModuleName) => {
    if (moduleKey === 'dashboard') return true;
    if (moduleKey === 'perfil') return true;
    if (!permissionGuardedModules.includes(moduleKey)) return true;
    return canAccessModule(moduleKey);
  }, [permissionGuardedModules, canAccessModule]);

  const safeNavigateTo = useCallback((moduleKey: ModuleName, params?: Record<string, string>) => {
    // Navega normalmente — o módulo renderizará AccessDeniedScreen se não houver permissão
    navigateTo(moduleKey, params);
  }, [navigateTo]);

  const handleNavigateToModule = (moduleKey: string, params?: Record<string, string>) => {
    safeNavigateTo(moduleKey as ModuleName, params);
  };

  // Guard de permissões — sem redirecionamento; AccessDeniedScreen é renderizado no slot do módulo

  useEffect(() => {
    if (!profileMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [profileMenuOpen]);

  // #9 — Busca global ⌘K
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  // Atalho de teclado ⌘K / Ctrl+K
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  const [leadToConvert, setLeadToConvert] = useState<Lead | null>(null);
  const [pendingTasksCount, setPendingTasksCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<ClientSearchResult[]>([]);
  const [collaboratorSearchResults, setCollaboratorSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const safePendingTasksCount = Number.isFinite(pendingTasksCount) ? pendingTasksCount : 0;
  // const [isClientFormModalOpen, setIsClientFormModalOpen] = useState(false);
  // const [clientFormPrefill, setClientFormPrefill] = useState<Partial<CreateClientDTO> | null>(null);

  const clientsParams = useMemo(() => {
    if (!moduleParams['clientes']) return null;
    try {
      return JSON.parse(moduleParams['clientes']);
    } catch (error) {
      console.error('Erro ao interpretar parâmetros de clientes:', error);
      return null;
    }
  }, [moduleParams]);

  const clientsForceCreate = clientsParams?.mode === 'create';
  const clientsFocusClientId = clientsParams?.mode === 'details' ? clientsParams.entityId : undefined;

  const agendaParams = useMemo(() => {
    const raw = moduleParams['agenda'] || moduleParams['calendar'];
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('Erro ao interpretar parâmetros de agenda:', error);
      return null;
    }
  }, [moduleParams]);

  const financeiroParams = useMemo(() => {
    if (!moduleParams['financeiro']) return null;
    try {
      return JSON.parse(moduleParams['financeiro']);
    } catch (error) {
      console.error('Erro ao interpretar parâmetros do financeiro:', error);
      return null;
    }
  }, [moduleParams]);

  const PROFILE_CACHE_KEY = 'crm-profile-cache';
  const LAST_LOGIN_CPF_KEY = 'crm-last-login-cpf';

  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      const cacheAvailable = typeof window !== 'undefined';
      const lastLoginCpf = cacheAvailable ? sessionStorage.getItem(LAST_LOGIN_CPF_KEY) : null;
      const lastLoginCpfDigits = lastLoginCpf ? lastLoginCpf.replace(/\D/g, '') : null;

      if (cacheAvailable) {
        const cachedProfile = sessionStorage.getItem(PROFILE_CACHE_KEY);
        if (cachedProfile) {
          try {
            const parsed = JSON.parse(cachedProfile);
            setProfile({
              ...parsed,
              role: sanitizeRole(parsed?.role),
              cpf: parsed?.cpf || '',
            });
          } catch (error) {
            sessionStorage.removeItem(PROFILE_CACHE_KEY);
          }
        }
      }

      const loadProfileFromAPI = async () => {
        try {
          setProfileLoading(true);
          const data = await profileService.getProfile(user.id);

          if (data) {
            const effectiveEmail = (data.email || user.email || '').trim();
            let effectiveCpf = data.cpf ? formatCPF(String(data.cpf)) : '';

            if (!effectiveCpf) {
              try {
                let clientCpfCnpj: string | null = null;
                if (lastLoginCpfDigits) {
                  const clientByCpf = await clientService.getClientByCpfCnpj(lastLoginCpfDigits);
                  clientCpfCnpj = clientByCpf?.cpf_cnpj || null;
                }

                if (!clientCpfCnpj && effectiveEmail) {
                  const clientByEmail = await clientService.getClientByEmail(effectiveEmail);
                  clientCpfCnpj = clientByEmail?.cpf_cnpj || null;
                }

                if (clientCpfCnpj) {
                  effectiveCpf = formatCPF(String(clientCpfCnpj));
                } else if (lastLoginCpfDigits && lastLoginCpfDigits.length === 11) {
                  effectiveCpf = formatCPF(lastLoginCpfDigits);
                } else if (lastLoginCpf) {
                  effectiveCpf = String(lastLoginCpf);
                }

                if (!data.cpf && effectiveCpf) {
                  await profileService.upsertProfile(user.id, {
                    name: data.name || 'Área Jurídica',
                    email: effectiveEmail,
                    role: sanitizeRole(data.role),
                    cpf: effectiveCpf,
                    phone: data.phone || null,
                    oab: data.oab || null,
                    lawyer_full_name: data.lawyer_full_name || null,
                    bio: data.bio || null,
                    avatar_url: data.avatar_url || GENERIC_AVATAR,
                  });

                  if (cacheAvailable) {
                    sessionStorage.removeItem(LAST_LOGIN_CPF_KEY);
                  }
                }
              } catch {
                // Se falhar, apenas não preenche automaticamente.
              }
            }

            const normalized = {
              name: data.name || 'Área Jurídica',
              email: effectiveEmail,
              role: sanitizeRole(data.role),
              cpf: effectiveCpf,
              oab: data.oab || '',
              phone: data.phone || '',
              bio: data.bio || '',
              lawyerFullName: data.lawyer_full_name || '',
              avatarUrl: data.avatar_url || GENERIC_AVATAR,
            };
            setProfile(normalized);
            if (cacheAvailable) {
              sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(normalized));
            }
          } else {
            let effectiveCpf = '';
            try {
              const emailForClient = (user.email || '').trim();
              if (lastLoginCpfDigits) {
                const clientByCpf = await clientService.getClientByCpfCnpj(lastLoginCpfDigits);
                if (clientByCpf?.cpf_cnpj) {
                  effectiveCpf = formatCPF(String(clientByCpf.cpf_cnpj));
                }
              }

              if (!effectiveCpf && emailForClient) {
                const clientByEmail = await clientService.getClientByEmail(emailForClient);
                if (clientByEmail?.cpf_cnpj) {
                  effectiveCpf = formatCPF(String(clientByEmail.cpf_cnpj));
                }
              }

              if (!effectiveCpf && lastLoginCpfDigits && lastLoginCpfDigits.length === 11) {
                effectiveCpf = formatCPF(lastLoginCpfDigits);
              }
            } catch {
              // ignore
            }

            const fallback = {
              name: user.user_metadata.full_name || user.email?.split('@')[0] || 'Usuário',
              email: user.email || '',
              avatarUrl: GENERIC_AVATAR,
              role: 'Auxiliar' as UserRole,
              cpf: effectiveCpf,
              phone: '',
              oab: '',
              bio: '',
              lawyerFullName: '',
            };
            await profileService.upsertProfile(user.id, {
              name: fallback.name,
              email: fallback.email,
              role: fallback.role,
              cpf: fallback.cpf,
              phone: fallback.phone,
              oab: fallback.oab,
              lawyer_full_name: fallback.lawyerFullName,
              bio: fallback.bio,
              avatar_url: fallback.avatarUrl,
            });
            setProfile(fallback);
            if (cacheAvailable) {
              sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(fallback));
              sessionStorage.removeItem(LAST_LOGIN_CPF_KEY);
            }
          }
        } catch (error: any) {
          const message = String(error?.message || error || '');
          const isTransientNetworkError = message.includes('Failed to fetch') || message.includes('Load failed') || message.includes('ERR_CONNECTION_CLOSED');
          const isAuthRace = message.includes('Usuário não autenticado');

          if (!isTransientNetworkError && !isAuthRace) {
            setProfileError(message || 'Não foi possível carregar o perfil.');
          }
        } finally {
          setProfileLoading(false);
        }
      };

      loadProfileFromAPI();
    };

    loadProfile();
  }, [user]);

  // Monitorar mudanças de autenticação e renovar sessão automaticamente
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        console.log('🔒 Logout detectado');
        sessionStorage.removeItem(PROFILE_CACHE_KEY);
        sessionStorage.removeItem(LAST_LOGIN_CPF_KEY);

        setProfile({
          name: 'Usuário',
          email: '',
          avatarUrl: GENERIC_AVATAR,
          role: 'Auxiliar' as UserRole,
          cpf: '',
          oab: '',
          phone: '',
          bio: '',
          lawyerFullName: '',
        });
        setPendingTasksCount(0);
        setModuleParams({});
        setClientPrefill(null);

        if (activeModule !== 'login') {
          navigateTo('login');
        }
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [activeModule, navigateTo, GENERIC_AVATAR, setModuleParams]);

// Detectar quando usuário perde autenticação e limpar estado
useEffect(() => {
  if (!user && !loading) {
    if (!logoutCleanupDoneRef.current) {
      logoutCleanupDoneRef.current = true;

      // Limpar cache ao fazer logout/expiração de sessão
      sessionStorage.removeItem(PROFILE_CACHE_KEY);
      // Reset estado
      setProfile({
        name: 'Usuário',
        email: '',
        avatarUrl: GENERIC_AVATAR,
        role: 'Auxiliar',
        cpf: '',
        oab: '',
        phone: '',
        bio: '',
        lawyerFullName: '',
      });
      setPendingTasksCount(0);
      setModuleParams({});
      setClientPrefill(null);
    }

    // Redirecionar para login se não estiver autenticado
    if (activeModule !== 'login') {
      navigateTo('login');
    }
  } else if (user) {
    logoutCleanupDoneRef.current = false;
  }
}, [user, loading, activeModule, navigateTo]);

useEffect(() => {
  if (user && activeModule === 'login') {
    navigateTo('dashboard');
  }
}, [user, activeModule, navigateTo]);

useEffect(() => {
  if (!user) {
    setPendingTasksCount(0);
    return;
  }

  const loadPendingTasks = async () => {
    try {
      const items = await taskService.listTasks();
      const pendingCount = Array.isArray(items)
        ? items.filter((task) => task.status === 'pending').length
        : 0;
      setPendingTasksCount(Number.isFinite(pendingCount) ? pendingCount : 0);
    } catch (error: any) {
      const message = String(error?.message || error || '');
      const isExpectedAuthOrNetworkIssue = message.includes('Usuário não autenticado') || message.includes('Failed to fetch') || message.includes('Load failed');
      setPendingTasksCount(0);
      if (!isExpectedAuthOrNetworkIssue) {
        console.error('Erro ao carregar tarefas pendentes:', error);
      }
    }
  };

  loadPendingTasks();
}, [user]);

useEffect(() => {
  const term = searchTerm.trim();

  if (term.length < 2) {
    setClientSearchResults([]);
    setCollaboratorSearchResults([]);
    setSearchLoading(false);
    return;
  }

  const isCollaboratorSearch = term.startsWith('@');
  const searchQuery = isCollaboratorSearch ? term.slice(1) : term;

  setSearchLoading(true);
  let isActive = true;
  const handler = setTimeout(async () => {
    try {
      if (isCollaboratorSearch) {
        const results = await profileService.searchMembers(searchQuery);
        if (!isActive) return;
        setCollaboratorSearchResults(results);
        setClientSearchResults([]);
      } else {
        const results = await clientService.searchClients(searchQuery);
        if (!isActive) return;
        setClientSearchResults(results);
        setCollaboratorSearchResults([]);
      }
    } catch (error) {
      if (!isActive) return;
      console.error('Erro ao buscar:', error);
      setClientSearchResults([]);
      setCollaboratorSearchResults([]);
    } finally {
      if (isActive) {
        setSearchLoading(false);
      }
    }
  }, 300);

  return () => {
    isActive = false;
    clearTimeout(handler);
  };
}, [searchTerm]);

  const handleConvertLead = async (lead: Lead) => {
    const notesParts = [] as string[];
    if (lead.notes) notesParts.push(lead.notes);
    if (lead.source) notesParts.push(`Origem do lead: ${lead.source}`);

    const prefill: Partial<CreateClientDTO> = {
      full_name: lead.name,
      email: lead.email || undefined,
      phone: lead.phone || undefined,
      mobile: lead.phone || undefined,
      notes: notesParts.length ? notesParts.join('\n\n') : undefined,
      client_type: 'pessoa_fisica',
      status: 'ativo',
    };

    setLeadToConvert(lead);
    setClientPrefill(prefill);
    safeNavigateTo('clientes');
  };

  const handleClientSaved = async () => {
    if (leadToConvert) {
      try {
        await leadService.deleteLead(leadToConvert.id);
      } catch (error) {
        console.error('Erro ao remover lead:', error);
      }
      setLeadToConvert(null);
    }
    setClientPrefill(null);
  };

  const handleClientCancelled = () => {
    setLeadToConvert(null);
    setClientPrefill(null);
  };

  const handleClientSearchSelect = (clientId: string) => {
    setSearchOpen(false);
    setSearchTerm('');
    safeNavigateTo('clientes', { mode: 'details', entityId: clientId });
  };

  const handleCollaboratorSearchSelect = (collaboratorId: string) => {
    setSearchOpen(false);
    setSearchTerm('');
    safeNavigateTo('perfil', { userId: collaboratorId });
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const isCollaboratorSearch = searchTerm.startsWith('@');
      if (isCollaboratorSearch && collaboratorSearchResults.length > 0) {
        handleCollaboratorSearchSelect(collaboratorSearchResults[0].user_id);
      } else if (!isCollaboratorSearch && clientSearchResults.length > 0) {
        handleClientSearchSelect(clientSearchResults[0].id);
      }
    }

    if (event.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  const clearClientParams = useMemo(
    () => () =>
      setModuleParams((prev) => {
        const updated = { ...prev };
        delete updated['clientes'];
        return updated;
      }),
    []
  );

  const openProfileModal = () => {
    if (profileLoading) return;
    // Navegar para a página de perfil em vez de abrir o modal
    safeNavigateTo('perfil');
  };

  const closeProfileModal = () => {
    setIsProfileModalOpen(false);
  };

  const handleProfileUpdate = (updatedProfile: any) => {
    const normalized: AppProfile = {
      ...updatedProfile,
      role: sanitizeRole(updatedProfile?.role),
      cpf: updatedProfile?.cpf || '',
    };

    setProfile(normalized);

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(normalized));
    }
    setProfileBanner('Perfil atualizado com sucesso!');
    setTimeout(() => setProfileBanner(null), 3000);
  };

  const [loggingIn, setLoggingIn] = useState(false);
  const introParticles = useMemo(
    () =>
      Array.from({ length: 18 }).map((_, i) => {
        const left = (i * 37) % 100;
        const top = (i * 53) % 100;
        const delay = (i * 0.37) % 5;
        const duration = 3.5 + (i % 5) * 0.65;
        const size = 1 + (i % 2);
        return { id: i, left, top, delay, duration, size };
      }),
    []
  );

  const handleLogin = async (email: string, password: string) => {
    setLoggingIn(true);

    try {
      await signIn(email, password);
    } finally {
      // Duração da animação de entrada: dobro da saída (definida abaixo)
      setTimeout(() => {
        setLoggingIn(false);
      }, 4000);
    }
  };

  // Logout com animação (sem atraso artificial longo)
  const handleLogout = async () => {
    setLoggingOut(true);

    try {
      // Realiza o logout imediatamente
      await signOut();
    } finally {
      // Duração base da animação de saída (~2s)
      setTimeout(() => {
        setLoggingOut(false);
      }, 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Carregando...</p>
        </div>
      </div>
    );
  }

  // Enquanto estiver animando login/logout, mantemos o overlay global
  if (!user && !loggingIn && !loggingOut) {
    return <Login onLogin={handleLogin} onResetPassword={resetPassword} />;
  }

  // Mostrar página offline se sem conexão
  if (!isOnline) {
    return <OfflinePage />;
  }

  return (
    <CacheProvider>
      <div className="min-h-screen bg-gray-100 dark:bg-black transition-colors duration-300">
        {/* Overlay de Login/Logout - Epic Animation */}
        {(loggingIn || loggingOut) && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black">
            {/* Animated gradient background */}
            <div className="absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(251,146,60,0.12)_0%,transparent_70%)]" />
              <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/20 rounded-full blur-[120px] animate-pulse" />
              <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-amber-500/15 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-600/10 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '0.5s' }} />
              <div className="absolute inset-0 bg-black/35" />
            </div>

            {/* Floating particles */}
            <div className="absolute inset-0 overflow-hidden">
              {introParticles.map((p) => (
                <div
                  key={p.id}
                  className="absolute w-1 h-1 bg-orange-400/60 rounded-full animate-float-particle"
                  style={{
                    left: `${p.left}%`,
                    top: `${p.top}%`,
                    width: `${p.size}px`,
                    height: `${p.size}px`,
                    animationDelay: `${p.delay}s`,
                    animationDuration: `${p.duration}s`,
                  }}
                />
              ))}
            </div>

            {/* Main content - clean floating design */}
            <div className="relative z-10 flex flex-col items-center">
              {/* Logo with glow */}
              <div className="relative mb-10 animate-float-slow">
                <div className="absolute inset-[-50px] rounded-full border border-orange-500/15 animate-ping-slow" />
                <div className="absolute inset-[-30px] rounded-full border border-orange-400/25 animate-ping-slower" />
                <div className="absolute inset-[-70px] rounded-full bg-gradient-to-r from-orange-500/20 via-amber-500/10 to-orange-500/20 blur-3xl animate-pulse" />

                <div className="relative w-24 h-24 rounded-[1.75rem] bg-gradient-to-br from-orange-500 via-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-orange-500/40">
                  <span className="text-white font-black text-5xl tracking-tight select-none">J</span>
                  <div className="absolute inset-0 rounded-[1.75rem] bg-gradient-to-t from-white/0 to-white/25" />
                </div>
              </div>

              {/* Brand */}
              <div className="text-center mb-10">
                <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-3 tracking-tight">
                  jurius<span className="text-orange-400">.com.br</span>
                </h1>
                <p className="text-xs text-white/40 tracking-[0.4em] uppercase font-medium">
                  Gestão Jurídica Inteligente
                </p>
                <div className="mt-6 h-px w-64 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </div>

              {/* Loading bar */}
              <div className="w-64 sm:w-80 mb-8">
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                  <div className="h-full bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500 rounded-full animate-loading-bar shadow-[0_0_24px_rgba(251,146,60,0.25)]" />
                </div>
              </div>

              {/* Status */}
              <div className="text-center">
                <p className="text-lg sm:text-xl font-semibold text-white mb-2">
                  {loggingIn ? 'Preparando seu ambiente' : 'Encerrando sessão'}
                </p>
                <p className="text-sm text-white/50 flex items-center gap-2 justify-center">
                  <span className="inline-block w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
                  {loggingIn ? 'Carregando dados do escritório...' : 'Salvando suas alterações...'}
                </p>
              </div>
            </div>

            {/* Bottom gradient fade */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-950 to-transparent" />
          </div>
        )}

        {/* Aviso de sessão */}
        <SessionWarning />
      {/* Sidebar Minimalista */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 bg-slate-900 text-white z-50 flex flex-col w-20 border-r border-slate-800 ${
          isMobileNavOpen
            ? 'translate-x-0'
            : '-translate-x-full md:translate-x-0'
        } transition-transform duration-300`}
      >
        {/* Logo */}
        <div className="flex items-center justify-center py-5 border-b border-slate-800">
          <div className="bg-amber-500 p-2.5 rounded-xl">
            <Scale className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-1.5 flex flex-col gap-0.5 overflow-y-auto scrollbar-hide">
          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('dashboard'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'dashboard' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'dashboard' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Layers className="w-5 h-5" />
            <span className="text-[9px] mt-1">Dashboard</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('feed'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'feed' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'feed' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Newspaper className="w-5 h-5" />
            <span className="text-[9px] mt-1">Feed</span>
          </button>

          {!permissionsLoading && canAccessModule('leads') && (
            <SidebarModuleBtn
              moduleKey="leads"
              label="Leads"
              Icon={Target}
              isActive={activeModule === 'leads'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('leads'); }}
              expiresAt={getOverrideExpiry('leads')}
            />
          )}

          {!permissionsLoading && canAccessModule('clientes') && (
            <SidebarModuleBtn
              moduleKey="clientes"
              label="Clientes"
              Icon={Users}
              isActive={activeModule === 'clientes'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('clientes'); }}
              expiresAt={getOverrideExpiry('clientes')}
            />
          )}

          {!permissionsLoading && canAccessModule('documentos') && (
            <SidebarModuleBtn
              moduleKey="documentos"
              label="Documentos"
              Icon={Library}
              isActive={activeModule === 'documentos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('documentos'); }}
              expiresAt={getOverrideExpiry('documentos')}
            />
          )}

          {!permissionsLoading && canAccessModule('cloud') && (
            <SidebarModuleBtn
              moduleKey="cloud"
              label="Cloud"
              Icon={Cloud}
              isActive={activeModule === 'cloud'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('cloud'); }}
              expiresAt={getOverrideExpiry('cloud')}
            />
          )}

          {!permissionsLoading && canAccessModule('assinaturas') && (
            <SidebarModuleBtn
              moduleKey="assinaturas"
              label="Assinaturas"
              Icon={PenTool}
              isActive={activeModule === 'assinaturas'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('assinaturas'); }}
              expiresAt={getOverrideExpiry('assinaturas')}
            />
          )}

          {!permissionsLoading && canAccessModule('processos') && (
            <SidebarModuleBtn
              moduleKey="processos"
              label="Processos"
              Icon={Scale}
              isActive={activeModule === 'processos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('processos'); }}
              expiresAt={getOverrideExpiry('processos')}
            />
          )}

          {!permissionsLoading && canAccessModule('requerimentos') && (
            <SidebarModuleBtn
              moduleKey="requerimentos"
              label="Requerimentos"
              Icon={Briefcase}
              isActive={activeModule === 'requerimentos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('requerimentos'); }}
              expiresAt={getOverrideExpiry('requerimentos')}
            />
          )}

          {!permissionsLoading && canAccessModule('prazos') && (
            <SidebarModuleBtn
              moduleKey="prazos"
              label="Prazos"
              Icon={AlarmClock}
              isActive={activeModule === 'prazos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('prazos'); }}
              expiresAt={getOverrideExpiry('prazos')}
            />
          )}

          {!permissionsLoading && canAccessModule('intimacoes') && (
            <SidebarModuleBtn
              moduleKey="intimacoes"
              label="Intimações"
              Icon={Bell}
              isActive={activeModule === 'intimacoes'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('intimacoes'); }}
              expiresAt={getOverrideExpiry('intimacoes')}
            />
          )}


          {!permissionsLoading && canAccessModule('financeiro') && (
            <SidebarModuleBtn
              moduleKey="financeiro"
              label="Financeiro"
              Icon={PiggyBank}
              isActive={activeModule === 'financeiro'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('financeiro'); }}
              expiresAt={getOverrideExpiry('financeiro')}
            />
          )}

          {!permissionsLoading && canAccessModule('agenda') && (
            <SidebarModuleBtn
              moduleKey="agenda"
              label="Agenda"
              Icon={Calendar}
              isActive={activeModule === 'agenda'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('agenda'); }}
              expiresAt={getOverrideExpiry('agenda')}
            />
          )}

          {!permissionsLoading && canAccessModule('chat') && (
            <SidebarModuleBtn
              moduleKey="chat"
              label="Chat"
              Icon={MessageCircle}
              isActive={activeModule === 'chat'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('chat'); }}
              expiresAt={getOverrideExpiry('chat')}
            />
          )}

          {!permissionsLoading && canAccessModule('peticoes') && (
            <button
              onClick={() => {
                setIsMobileNavOpen(false);
                events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN);
              }}
              className="relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors text-slate-400 hover:text-white hover:bg-slate-800/50"
              title="Abrir Editor de Petições (Widget Flutuante)"
            >
              <FileText className="w-5 h-5" />
              <span className="text-[9px] mt-1">Petições</span>
            </button>
          )}

          <div className="my-2 mx-2 h-px bg-slate-800" />

          <button
            onClick={() => { setIsMobileNavOpen(false); navigateTo('perfil'); }}
            className="relative flex flex-col items-center py-2.5 px-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
          >
            <UserCog className="w-5 h-5" />
            <span className="text-[9px] mt-1">Perfil</span>
            {isAdmin && sidebarPendingCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                {sidebarPendingCount > 9 ? '9+' : sidebarPendingCount}
              </span>
            )}
          </button>
        </nav>
      </aside>

        {/* Main Content Area */}
      <div className="md:ml-20 ml-0 transition-all duration-300 min-h-screen flex flex-col">
        {/* Cloud Mobile Header - Pill-shaped navigation shell */}
        {activeModule === 'cloud' ? (
          <header className="sticky top-0 z-30 px-3 py-3 md:hidden">
            <div className="flex items-center justify-between gap-3 rounded-full border border-white/70 bg-white/95 backdrop-blur-xl px-3 py-2.5 shadow-[0px_12px_32px_rgba(44,47,48,0.08)]">
              {/* Menu button */}
              <button
                onClick={() => setIsMobileNavOpen((prev) => !prev)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-600 hover:bg-slate-100 transition flex-shrink-0"
                aria-label="Menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* Search input */}
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={cloudMobileSearchTerm}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setCloudMobileSearchTerm(nextValue);
                    dispatchCloudHeaderAction({ action: 'set-search-term', value: nextValue });
                  }}
                  placeholder="Buscar no Cloud"
                  className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
                  aria-label="Buscar no Cloud"
                />
              </div>

              {/* User avatar with border */}
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-orange-400 shadow-sm flex-shrink-0"
                aria-label="Perfil"
              >
                <img src={profile.avatarUrl || GENERIC_AVATAR} alt={profile.name} className="w-full h-full object-cover" />
              </button>
            </div>
          </header>
        ) : null}
        
        {/* Regular header for non-Cloud modules or desktop */}
        <header className={`sticky top-0 z-30 ${activeModule === 'cloud' ? 'hidden md:block border-b border-slate-200/70 bg-slate-50/90 backdrop-blur-lg' : 'bg-white border-b border-gray-200'}`}>
          <div className={`px-3 sm:px-4 lg:px-8 ${activeModule === 'cloud' ? 'py-3 sm:py-4' : 'py-3 sm:py-4'}`}>
            <div className="flex items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <button
                  className="md:hidden inline-flex items-center justify-center p-2 rounded-lg text-slate-600 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
                  onClick={() => setIsMobileNavOpen((prev) => !prev)}
                  aria-label="Alternar menu"
                >
                  {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 truncate">
                    {activeModule === 'dashboard' && 'Dashboard'}
                    {activeModule === 'feed' && 'Feed'}
                    {activeModule === 'leads' && 'Pipeline de Leads'}
                    {activeModule === 'clientes' && 'Gestão de Clientes'}
                    {activeModule === 'processos' && 'Gestão de Processos'}
                    {activeModule === 'requerimentos' && 'Sistema de Requerimentos'}
                    {activeModule === 'prazos' && 'Gestão de Prazos'}
                    {activeModule === 'intimacoes' && 'Diário de Justiça Eletrônico'}
                    {activeModule === 'financeiro' && 'Gestão Financeira'}
                    {activeModule === 'agenda' && 'Agenda'}
                    {activeModule === 'chat' && 'Chat da Equipe'}
                    {activeModule === 'tarefas' && 'Tarefas'}
                    {activeModule === 'documentos' && 'Documentos'}
                    {activeModule === 'assinaturas' && 'Assinatura Digital'}
                    {activeModule === 'configuracoes' && 'Configurações'}
                  </h2>
                  {activeModule !== 'cloud' ? (
                    <p className="hidden md:block text-xs sm:text-sm text-slate-600 mt-1 truncate">
                      {activeModule === 'dashboard' && 'Visão geral do escritório e métricas'}
                      {activeModule === 'feed' && 'Acompanhe as novidades e publicações da equipe'}
                      {activeModule === 'leads' && 'Gerencie leads e converta em clientes'}
                      {activeModule === 'clientes' && 'Gerencie todos os seus clientes e informações'}
                      {activeModule === 'processos' && 'Acompanhe processos e andamentos'}
                      {activeModule === 'requerimentos' && 'Gerencie requerimentos administrativos do INSS'}
                      {activeModule === 'prazos' && 'Controle compromissos e prazos vinculados aos seus casos'}
                      {activeModule === 'intimacoes' && 'Consulte comunicações processuais do DJEN'}
                      {activeModule === 'financeiro' && 'Acompanhe acordos, parcelas e honorários do escritório'}
                      {activeModule === 'agenda' && 'Organize compromissos e prazos'}
                      {activeModule === 'chat' && 'Converse com a equipe em tempo real'}
                      {activeModule === 'tarefas' && 'Gerencie suas tarefas e lembretes'}
                      {activeModule === 'documentos' && 'Crie modelos e gere documentos personalizados'}
                      {activeModule === 'assinaturas' && 'Assine documentos com biometria facial e assinatura digital'}
                      {activeModule === 'configuracoes' && 'Gerencie usuários, permissões e preferências do sistema'}
                    </p>
                  ) : <div className="min-w-0" />}
                </div>
              </div>
              
              {/* Botões do Cloud - aparecem apenas quando o módulo Cloud está ativo */}
              {activeModule === 'cloud' && (
                <div className="hidden lg:flex lg:w-auto lg:flex-row lg:items-center lg:gap-1.5">
                  {/* Upload */}
                  <button
                    type="button"
                    onClick={() => dispatchCloudHeaderAction({ action: 'upload' })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-[13px] font-medium text-white hover:bg-orange-600 transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Enviar
                  </button>
                  {/* Nova pasta */}
                  <button
                    type="button"
                    onClick={() => dispatchCloudHeaderAction({ action: 'create-folder' })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    Nova pasta
                  </button>
                  {/* Filtros */}
                  <button
                    type="button"
                    onClick={() => dispatchCloudHeaderAction({ action: 'toggle-filters' })}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${cloudHeaderState.showFilters ? 'border-orange-200 bg-orange-50 text-orange-600' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Filtros
                  </button>

                  {/* Separador */}
                  <div className="w-px h-5 bg-slate-200 mx-0.5" />

                  {/* Lista / Cards / P·M·G — grupo único */}
                  <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => dispatchCloudHeaderAction({ action: 'set-view-mode', value: 'list' })}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-all ${cloudHeaderState.viewMode === 'list' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                    >
                      <List className="w-3.5 h-3.5" />
                      Lista
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatchCloudHeaderAction({ action: 'set-view-mode', value: 'cards' })}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-all ${cloudHeaderState.viewMode === 'cards' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Cards
                    </button>
                    {cloudHeaderState.viewMode === 'cards' && (
                      <>
                        <div className="w-px h-4 bg-slate-200 mx-0.5" />
                        {(['small', 'medium', 'large'] as const).map((size, i) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => dispatchCloudHeaderAction({ action: 'set-card-size', value: size })}
                            className={`rounded-md w-7 h-7 text-[11px] font-bold transition-all ${cloudHeaderState.cardSize === size ? 'bg-orange-100 text-orange-700' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
                          >
                            {['P', 'M', 'G'][i]}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-3 flex-shrink-0">
                {/* Busca global — barra com typewriter */}
                <SearchBarTypewriter onClick={() => setGlobalSearchOpen(true)} />
                {/* Botão mobile de busca global (sm e menores) */}
                <button
                  onClick={() => setGlobalSearchOpen(true)}
                  className="flex lg:hidden items-center justify-center p-1.5 sm:p-2 rounded-lg text-slate-600 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                  title="Busca global (⌘K)"
                >
                  <Search className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                <button
                  onClick={() => navigateTo('tarefas')}
                  className={`relative p-1.5 sm:p-2 rounded-lg transition-colors ${
                    activeModule === 'tarefas'
                      ? 'text-blue-600 bg-blue-50'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-gray-100'
                  }`}
                  title="Tarefas"
                >
                  <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5" />
                  {safePendingTasksCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] sm:min-w-[1.25rem] rounded-full bg-emerald-500 px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs font-semibold text-white text-center leading-none">
                      {safePendingTasksCount > 99 ? '99+' : safePendingTasksCount}
                    </span>
                  )}
                </button>

                <NotificationBell
                  onNavigateToModule={(moduleKey: string, params?: any) => {
                    safeNavigateTo(moduleKey as any, params);
                  }}
                />
                
                <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-gray-200">
                  <div className="hidden lg:block text-right">
                    <p className="text-sm font-semibold text-slate-900 truncate max-w-[150px]">{profile.name}</p>
                    <p className="text-xs text-slate-600">{profile.role}</p>
                  </div>
                  
                  {/* Theme Toggle */}
                  <button 
                    onClick={toggleTheme}
                    className="p-1.5 sm:p-2 rounded-lg text-slate-600 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
                  >
                    {theme === 'dark' ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>

                  <div className="relative" ref={profileMenuRef}>
                    <button
                      type="button"
                      onClick={() => setProfileMenuOpen((prev) => !prev)}
                      className={`focus:outline-none border-2 rounded-full ${
                        profileMenuOpen ? 'border-amber-500' : 'border-transparent'
                      }`}
                      aria-haspopup="menu"
                      aria-expanded={profileMenuOpen}
                      title="Meu Perfil"
                    >
                      <div className="relative w-9 h-9 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full overflow-hidden border border-amber-500 shadow-md">
                        <img src={profile.avatarUrl || GENERIC_AVATAR} alt={profile.name} className="w-full h-full object-cover" />
                      </div>
                    </button>
                    <div
                      className={`absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-2 transition-all z-50 ${
                        profileMenuOpen
                          ? 'opacity-100 translate-y-0 pointer-events-auto'
                          : 'opacity-0 translate-y-2 pointer-events-none'
                      }`}
                    >
                      {canAccessConfig && (
                        <button
                          onClick={() => {
                            setProfileMenuOpen(false);
                            navigateTo('configuracoes');
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-amber-50"
                        >
                          <Settings className="w-4 h-4 text-amber-600" />
                          Configurações
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setProfileMenuOpen(false);
                          openProfileModal();
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-amber-50"
                      >
                        <UserCog className="w-4 h-4 text-amber-600" />
                        Meu Perfil
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="p-1.5 sm:p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Sair"
                  >
                    <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className={`${activeModule === 'chat' ? 'px-0 py-0 space-y-0 overflow-hidden' : activeModule === 'cloud' ? 'px-3 sm:px-1 lg:px-2 xl:px-3 space-y-2 sm:space-y-3' : 'px-3 sm:px-4 lg:px-6 xl:px-8 space-y-4 sm:space-y-6'} flex-1 min-h-0 ${activeModule === 'agenda' ? 'py-0' : activeModule === 'chat' ? 'py-0' : activeModule === 'cloud' ? 'py-2 sm:py-2' : 'py-4 sm:py-6'}`}>
          {profileBanner && (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm shadow-sm">
              <CheckCheck className="w-4 h-4 flex-shrink-0 text-emerald-500" />
              <span className="flex-1 font-medium">{profileBanner}</span>
              <button onClick={() => setProfileBanner(null)} className="text-emerald-400 hover:text-emerald-600 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {profileError && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              <span className="flex-1">{profileError}</span>
              <button onClick={() => setProfileError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Renderização condicional baseada no módulo ativo com Lazy Loading */}
          <Suspense fallback={activeModule === 'cloud' ? <CloudModuleFallback /> : <div className="min-h-[200px]" />}>
            {/* Tela de acesso restrito — exibida quando o usuário não tem permissão para o módulo ativo */}
            {!permissionsLoading && !hasModuleAccess(activeModule) && activeModule !== 'dashboard' && activeModule !== 'perfil' ? (
              <AccessDeniedScreen
                moduleKey={activeModule}
                userRole={profile.role ?? 'Usuário'}
                userId={user?.id ?? ''}
                userName={profile.name ?? 'Usuário'}
                onGoHome={() => navigateTo('dashboard')}
              />
            ) : (
            <>
            {activeModule === 'dashboard' && <Dashboard onNavigateToModule={handleNavigateToModule} params={moduleParams['dashboard'] ? JSON.parse(moduleParams['dashboard']) : undefined} />}
            {activeModule === 'feed' && <Feed onNavigateToModule={handleNavigateToModule} params={moduleParams['feed'] ? JSON.parse(moduleParams['feed']) : undefined} />}
            {activeModule === 'leads' && <LeadsModule onConvertLead={handleConvertLead} />}
            {activeModule === 'clientes' && (
              <ClientsModule 
                prefillData={clientPrefill} 
                onClientSaved={handleClientSaved}
                onClientCancelled={handleClientCancelled}
                forceCreate={clientsForceCreate}
                focusClientId={clientsFocusClientId}
                onParamConsumed={clearClientParams}
                onNavigateToModule={(moduleKey, params) => {
                  navigateTo(moduleKey as any, params);
                }}
              />
            )}
            {activeModule === 'documentos' && (
              <DocumentsModule 
                onNavigateToModule={(moduleKey, params) => {
                  navigateTo(moduleKey as any, params);
                }}
              />
            )}
            {activeModule === 'cloud' && (
              <CloudModule
                onNavigateToModule={handleNavigateToModule}
                initialFolderId={moduleParams['cloud'] ? JSON.parse(moduleParams['cloud']).folderId : undefined}
                onParamConsumed={() => clearModuleParams('cloud')}
              />
            )}
            {activeModule === 'processos' && (
              <ProcessesModule
                forceCreate={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).mode === 'create' : false}
                entityId={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).entityId : undefined}
                prefillData={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).prefill : undefined}
                initialStatusFilter={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).statusFilter : undefined}
                initialSearchQuery={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).searchQuery : undefined}
                onParamConsumed={() => clearModuleParams('processos')}
              />
            )}
            {activeModule === 'requerimentos' && (
              <RequirementsModule 
                forceCreate={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).mode === 'create' : false}
                entityId={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).entityId : undefined}
                prefillData={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).prefill : undefined}
                initialStatusTab={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).statusTab : undefined}
                onParamConsumed={() => clearModuleParams('requerimentos')}
              />
            )}
            {activeModule === 'prazos' && (
              <DeadlinesModule 
                forceCreate={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).mode === 'create' : false}
                entityId={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).entityId : undefined}
                prefillData={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).prefill : undefined}
                onParamConsumed={() => clearModuleParams('prazos')}
                calendarMonth={calendarMonth}
                calendarYear={calendarYear}
                onCalendarChange={(month, year) => {
                  setCalendarMonth(month);
                  setCalendarYear(year);
                }}
              />
            )}
            {activeModule === 'intimacoes' && (
              <IntimationsModule 
                onNavigateToModule={(moduleKey, params) => {
                  navigateTo(moduleKey as any, params);
                }}
              />
            )}
            {activeModule === 'agenda' && (
              <CalendarModule 
                userName={profile.name}
                onNavigateToModule={({ module, entityId, extra }) => {
                  if (entityId) {
                    const params: Record<string, string> = module === 'clientes'
                      ? { mode: 'details', entityId }
                      : { entityId, ...(extra as Record<string, string> | undefined) };
                    navigateTo(module as any, params);
                  } else {
                    navigateTo(module as any);
                  }
                }}
                forceCreate={agendaParams?.mode === 'create'}
                prefillData={agendaParams?.prefill}
                focusEventId={agendaParams?.entityId}
                onParamConsumed={() => {
                  clearModuleParams('agenda');
                  clearModuleParams('calendar');
                }}
              />
            )}
            {activeModule === 'tarefas' && (
              <TasksModule 
                focusNewTask={moduleParams['tarefas'] ? JSON.parse(moduleParams['tarefas']).mode === 'create' : false}
                onParamConsumed={() => clearModuleParams('tarefas')}
                onPendingTasksChange={(count) => setPendingTasksCount(Number.isFinite(count) ? count : 0)}
              />
            )}
            {activeModule === 'chat' && <ChatModule />}
            {activeModule === 'notificacoes' && <NotificationsModuleNew onNavigateToModule={handleNavigateToModule} />}
            {activeModule === 'financeiro' && (
              <FinancialModule
                entityId={financeiroParams?.entityId}
                mode={financeiroParams?.mode}
                installmentNumber={financeiroParams?.installmentNumber}
                onParamConsumed={() => clearModuleParams('financeiro')}
              />
            )}
            {activeModule === 'assinaturas' && (
              <SignatureModule 
                prefillData={moduleParams['assinaturas'] ? JSON.parse(moduleParams['assinaturas']).prefill : undefined}
                focusRequestId={
                  moduleParams['assinaturas'] && JSON.parse(moduleParams['assinaturas']).mode === 'details'
                    ? JSON.parse(moduleParams['assinaturas']).requestId
                    : undefined
                }
                onParamConsumed={() => clearModuleParams('assinaturas')}
              />
            )}
            {activeModule === 'configuracoes' && (
              <SettingsModule
                initialSection={
                  moduleParams['configuracoes']
                    ? (JSON.parse(moduleParams['configuracoes']).section as any)
                    : undefined
                }
                onParamConsumed={() => clearModuleParams('configuracoes')}
              />
            )}
            {activeModule === 'cron' && <CronEndpoint />}
            {activeModule === 'perfil' && (
              <UserProfilePage
                userId={moduleParams['perfil'] ? JSON.parse(moduleParams['perfil']).userId : undefined}
                onClose={() => navigateTo('dashboard')}
                onNavigateToModule={(moduleKey, params) => navigateTo(moduleKey as any, params)}
              />
            )}
            </>
            )}
          </Suspense>
        </main>

        {activeModule !== 'chat' && (
          <div className="px-3 sm:px-4 lg:px-6 xl:px-8 py-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>© {new Date().getFullYear()} jurius.com.br</span>
              </div>
              <span>v{__APP_VERSION__}</span>
              <a href="#/docs" className="font-semibold text-orange-700 hover:text-orange-600 transition">
                Alterações
              </a>
            </div>
          </div>
        )}

        {/* Profile Modal */}
        <ProfileModal 
          isOpen={isProfileModalOpen}
          onClose={closeProfileModal}
          profile={profile}
          onProfileUpdate={handleProfileUpdate}
        />

        {/* ClientFormModal removido para evitar overlay duplicado; usar fluxo do módulo Clientes */}
      </div>

      {/* Widget flutuante do Editor de Petições - renderizado fora do fluxo de módulos */}
      <Suspense fallback={null}>
        <PetitionEditorWidget />
      </Suspense>

      <Suspense fallback={null}>
        <ChatFloatingWidget />
      </Suspense>

      {/* #9 — Modal de busca global ⌘K */}
      <GlobalSearchModal
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onNavigate={(module, params) => safeNavigateTo(module as any, params as any)}
      />
    </div>
    </CacheProvider>
  );
};

const App: React.FC = () => {
  const [hashRoute, setHashRoute] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));

  useEffect(() => {
    const handleHashChange = () => {
      setHashRoute(typeof window !== 'undefined' ? window.location.hash : '');
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Verificar rotas tanto no hash quanto no pathname (para links sem #)
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  
  const isTermsRoute = hashRoute?.includes('/terms') || pathname?.includes('/terms');
  const isPrivacyRoute = hashRoute?.includes('/privacidade') || hashRoute?.includes('/privacy') || pathname?.includes('/privacidade') || pathname?.includes('/privacy');
  const isDocsRoute = hashRoute?.includes('/docs') || pathname?.includes('/docs');
  const isCronRoute = hashRoute?.includes('/cron/djen') || pathname?.includes('/cron/djen');
  const isSigningRoute = hashRoute?.includes('/assinar/') || pathname?.includes('/assinar/');
  const isTemplateFillRoute = hashRoute?.includes('/preencher/') || pathname?.includes('/preencher/');
  const isPermalinkRoute = hashRoute?.includes('/p/') || pathname?.includes('/p/');
  const isCloudShareRoute = hashRoute?.includes('/cloud/share/') || pathname?.includes('/cloud/share/');
  const isVerificationRoute   = hashRoute?.includes('/verificar') || pathname?.includes('/verificar');
  const isDocumentPublicRoute = hashRoute?.includes('/documento/') || pathname?.includes('/documento/');
  const isPortalRoute = hashRoute?.includes('/portal') || pathname?.startsWith('/portal');

  if (isTermsRoute) {
    return <TermsPrivacyPage type="terms" />;
  }

  if (isPrivacyRoute) {
    return <TermsPrivacyPage type="privacy" />;
  }

  if (isDocsRoute) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-amber-600" /></div>}>
        <DocsPage />
      </Suspense>
    );
  }

  if (isCronRoute) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Suspense fallback={<div className="p-8 text-center text-slate-600">Carregando cron...</div>}>
          <CronEndpoint />
        </Suspense>
      </div>
    );
  }

  if (isPermalinkRoute) {
    // Rota de permalink fixo: /#/p/:slug
    // Extrai o slug e redireciona para o componente que faz o mint do token
    let slug = hashRoute.split('/p/')[1]?.split('?')[0]?.split('#')[0];
    if (!slug && pathname.includes('/p/')) {
      slug = pathname.split('/p/')[1]?.split('?')[0]?.split('#')[0];
    }
    if (slug) {
      return (
        <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-600" /></div>}>
          <PublicPermalinkRedirect />
        </Suspense>
      );
    }
  }

  if (isTemplateFillRoute) {
    // Extrair token do hash ou do pathname
    let token = hashRoute.split('/preencher/')[1]?.split('?')[0]?.split('#')[0];
    if (!token && pathname.includes('/preencher/')) {
      token = pathname.split('/preencher/')[1]?.split('?')[0]?.split('#')[0];
    }
    if (token) {
      return (
        <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>}>
          <PublicTemplateFillPage token={token} />
        </Suspense>
      );
    }
  }

  if (isSigningRoute) {
    // Extrair token do hash ou do pathname
    let token = hashRoute.split('/assinar/')[1]?.split('?')[0]?.split('#')[0];
    if (!token && pathname.includes('/assinar/')) {
      token = pathname.split('/assinar/')[1]?.split('?')[0]?.split('#')[0];
    }
    if (token) {
      return (
        <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>}>
          <PublicSigningPage token={token} />
        </Suspense>
      );
    }
  }

  if (isCloudShareRoute) {
    let token = hashRoute.split('/cloud/share/')[1]?.split('?')[0]?.split('#')[0];
    if (!token && pathname.includes('/cloud/share/')) {
      token = pathname.split('/cloud/share/')[1]?.split('?')[0]?.split('#')[0];
    }
    if (token) {
      return (
        <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-sky-600" /></div>}>
          <PublicCloudSharePage token={token} />
        </Suspense>
      );
    }
  }

  if (isDocumentPublicRoute) {
    let token = hashRoute.split('/documento/')[1]?.split('?')[0]?.split('#')[0];
    if (!token && pathname.includes('/documento/')) {
      token = pathname.split('/documento/')[1]?.split('?')[0]?.split('#')[0];
    }
    if (token) {
      return (
        <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <PublicDocumentPage token={token} />
        </Suspense>
      );
    }
  }

  if (isVerificationRoute) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>}>
        <PublicVerificationPage />
      </Suspense>
    );
  }

  if (isPortalRoute) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>}>
        <PortalApp />
      </Suspense>
    );
  }

  return <MainApp />;
};

export default App;
