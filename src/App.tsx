﻿import { useEffect, useState, useMemo, useCallback, lazy, Suspense, useRef, createContext, useContext } from 'react';
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
  Mail,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import Login from './components/Login';
import OfflinePage from './components/OfflinePage';
import { FloatingWindowSystem, useFloatingWindows, MAX_WINDOWS } from './components/FloatingWindowSystem';
import type { FloatingModuleKey } from './components/FloatingWindowSystem';
import { NotificationBell } from './components/NotificationBell';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import SessionWarning from './components/SessionWarning';
import BlockedAccountOverlay from './components/BlockedAccountOverlay';
import LogoutOverlay from './components/LogoutOverlay';
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
const WhatsAppModule = lazy(() => import('./components/WhatsAppModule'));
const EmailModule = lazy(() => import('./components/EmailModule'));
const UserManagementModule = lazy(() => import('./components/UserManagementModule'));
const NotificationsModuleNew = lazy(() => import('./components/NotificationsModuleNew'));
const FinancialModule = lazy(() => import('./components/FinancialModule'));
const SignatureModule = lazy(() => import('./components/SignatureModule'));
const SettingsModule = lazy(() => import('./components/SettingsModule'));
const CronEndpoint = lazy(() => import('./components/CronEndpoint'));
const PublicSigningPage = lazy(() => import('./components/PublicSigningPage'));
const PublicTemplateFillPage = lazy(() => import('./components/PublicTemplateFillPage'));
const PublicVerificationPage = lazy(() => import('./components/PublicVerificationPage'));
const PublicSignatureTermsPage = lazy(() => import('./components/PublicSignatureTermsPage'));
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
import { useWhatsAppNotifications } from './hooks/useWhatsAppNotifications';
import { useAuth } from './contexts/AuthContext';
import { events, SYSTEM_EVENTS } from './utils/events';
import { useTheme } from './contexts/ThemeContext';
import { useSidebarMode } from './contexts/SidebarModeContext';
import { CacheProvider } from './contexts/CacheContext';
import { profileService } from './services/profile.service';
import { ShimmerSweep, BrandLogo } from './components/ui';
import { leadService } from './services/lead.service';
import { taskService } from './services/task.service';
import { djenLocalService } from './services/djenLocal.service';
import { supabase } from './config/supabase';
import { clientService } from './services/client.service';
import { formatCPF, formatDate, loadFormatterPrefs } from './utils/formatters';
import { usePermissions } from './hooks/usePermissions';
import type { Lead } from './types/lead.types';
import type { CreateClientDTO } from './types/client.types';
import { DocumentRequestsTracker } from './components/DocumentRequestsTracker';
import { DISPLAY_APP_VERSION_LABEL } from './utils/appVersion';
import { settingsService, type ModulesConfig, FLOATING_WINDOW_MODULE_DEFAULTS } from './services/settings.service';
import { useToastContext } from './contexts/ToastContext';

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
  <div className="overflow-hidden rounded-[30px] border border-[#e7e5df]/80 bg-[radial-gradient(circle_at_top,#fff7ed_0%,#ffffff_38%,#fffaf5_100%)] shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
    <div className="border-b border-[#e7e5df]/70 bg-[#f8f7f5]/90 px-4 py-3 sm:px-5">
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
        <div className="hidden rounded-[26px] border border-[#e7e5df]/80 bg-[#f8f7f5]/85 p-4 lg:block">
          <div className="h-11 animate-pulse rounded-2xl bg-slate-100" />
          <div className="mt-4 space-y-3">
            <div className="h-16 animate-pulse rounded-2xl bg-gradient-to-r from-orange-100 via-amber-50 to-orange-50" />
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-12 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        </div>
        <div className="rounded-[26px] border border-[#e7e5df]/80 bg-[#f8f7f5]/88 p-4 sm:p-5">
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
              <div key={index} className="rounded-[24px] border border-[#e7e5df]/80 bg-[linear-gradient(180deg,#ffffff_0%,#fffaf5_100%)] p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
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

// â”€â”€ AccessDeniedScreen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MODULE_META: Record<string, { label: string; desc: string; Icon: LucideIcon }> = {
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
  whatsapp:      { label: 'WhatsApp',             desc: 'atendimento via WhatsApp',               Icon: MessageSquare },
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
  const fmtDate = (iso?: string | null) => formatDate(iso ?? null);

  const grantedDuration = (req: any): string => {
    if (!req?.expires_at) return 'permanente';
    const diffMs = new Date(req.expires_at).getTime() - new Date(req.resolved_at || req.created_at).getTime();
    const h = diffMs / 3_600_000;
    if (h < 23) return `${Math.round(h)} hora${Math.round(h) !== 1 ? 's' : ''}`;
    const d = Math.round(h / 24);
    return `${d} dia${d !== 1 ? 's' : ''}`;
  };

  // â”€â”€ Right-panel content by state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const renderRightPanel = () => {
    // DENIED
    if (reqState === 'denied') return (
      <div className="flex-1 flex flex-col justify-center bg-[#f8f7f5] px-10 py-12">
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
      <div className="flex-1 flex flex-col justify-center bg-[#f8f7f5] px-10 py-12">
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
      <div className="flex-1 flex flex-col justify-center bg-[#f8f7f5] px-10 py-12">
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

    // NONE / CHECKING "” default
    return (
      <div className="flex-1 flex flex-col justify-center bg-[#f8f7f5] px-10 py-12">
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
          Módulo: <span className="font-semibold text-slate-700">{meta.label}</span> "” {meta.desc}
        </p>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-0.5 bg-amber-400 rounded-full" />
          <div className="w-2 h-0.5 bg-slate-200 rounded-full" />
        </div>

        <p className="text-sm text-slate-500 leading-relaxed mb-8 max-w-sm">
          O seu cargo de <span className="font-semibold text-slate-700">{userRole}</span> não inclui acesso ao módulo de{' '}
          <span className="font-medium text-slate-700">{meta.desc}</span>. Para exercer atividades aqui, solicite ao administrador "” você pode enviar uma justificativa pelo botão abaixo.
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
    {/* â”€â”€ Tela principal: split full-height â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
    <div className="flex min-h-[72vh] select-none overflow-hidden rounded-2xl border border-[#e7e5df] shadow-sm">

      {/* â•â• Painel esquerdo "” visual (45%) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
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
            <div className="w-36 h-36 rounded-3xl border border-white/8 bg-[#f8f7f5]/4 flex items-center justify-center backdrop-blur-sm shadow-2xl">
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
            <div className="flex-1 h-px bg-[#f8f7f5]/8" />
            <Lock className="w-3 h-3 text-white/20" />
            <div className="flex-1 h-px bg-[#f8f7f5]/8" />
          </div>

          <div className="text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Seu perfil</p>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#f8f7f5]/8 border border-white/10 text-white/70 text-sm font-semibold">
              {userRole}
            </span>
          </div>

          {/* State indicator on left panel */}
          <div className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border ${
            reqState === 'denied' ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : reqState === 'pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            : reqState === 'approved_expired' ? 'bg-amber-400/10 border-amber-400/20 text-amber-400'
            : 'bg-[#f8f7f5]/5 border-white/10 text-white/30'
          }`}>
            {reqState === 'denied' ? '✕ Negado'
            : reqState === 'pending' ? 'â³ Em análise'
            : reqState === 'approved_expired' ? '⌛ Expirado'
            : 'ðŸ”’ Sem permissão'}
          </div>
        </div>
      </div>

      {/* â•â• Painel direito "” conteúdo dinâmico â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {renderRightPanel()}
    </div>

    {/* â”€â”€ Modal de solicitação â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
    {showModal && (
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-md" />
        <div
          className="relative bg-[#f8f7f5] rounded-3xl shadow-2xl w-full max-w-[400px] overflow-hidden"
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
              className="w-full bg-white border border-[#e7e5df] rounded-xl px-3.5 py-3 text-sm text-slate-800 placeholder-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300/50 focus:border-amber-400 transition-all leading-relaxed"
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
              className="flex-1 py-2.5 rounded-xl border border-[#e7e5df] text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
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

// â”€â”€ SearchBarTypewriter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          // Full phrase shown "” pause then erase
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
          // All erased "” next phrase
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
      className="hidden lg:flex w-[300px] xl:w-[360px] flex-shrink-0 items-center gap-3 px-4 lg:px-5 py-[10px] rounded-full bg-[#f8f7f5] border border-[#e7e5df]/70 shadow-[0_1px_6px_rgba(32,33,36,0.1)] hover:shadow-[0_2px_14px_rgba(251,146,60,0.16)] hover:border-amber-300/50 transition-all duration-300 group cursor-text select-none"
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
        <kbd className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 group-hover:bg-amber-50 text-slate-400 group-hover:text-amber-600 border border-[#e7e5df] group-hover:border-amber-200 font-mono transition-all duration-200 leading-none">
          ⌘K
        </kbd>
      </div>
    </button>
  );
};

// â”€â”€ Sidebar module button with optional temporary-access countdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Conjunto de módulos ocultados do menu pelo admin (config independente da permissão).
const HiddenMenuModulesContext = createContext<Set<string>>(new Set());

// Ordem dos itens no menu "” usada para escalonar a animação de entrada (um por vez).
const MENU_ORDER: Record<string, number> = {
  dashboard: 0, feed: 1, agenda: 2, chat: 3,
  leads: 4, clientes: 5, processos: 6, requerimentos: 7, peticoes: 8, financeiro: 9,
  prazos: 10, intimacoes: 11, documentos: 12, assinaturas: 13, cloud: 14, perfil: 15,
};
const MENU_ENTER_STEP_MS = 70;

// Placeholder com shimmer exibido enquanto as permissões carregam.
const SidebarSkeletonBtn: React.FC<{ index?: number }> = ({ index = 0 }) => {
  const { sidebarMode } = useSidebarMode();
  const delay = { animationDelay: `${index * 90}ms` } as React.CSSProperties;

  if (sidebarMode === 'normal') {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px]">
        <div className="h-[15px] w-[15px] flex-shrink-0 rounded-[5px] bg-white/[0.08] animate-pulse" style={delay} />
        <div
          className="h-[9px] rounded-full bg-white/[0.06] animate-pulse"
          style={{ ...delay, width: `${52 + ((index * 13) % 34)}%` }}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-1.5 rounded-[10px] px-1 py-[11px]">
      <div className="h-[18px] w-[18px] rounded-[6px] bg-white/[0.08] animate-pulse" style={delay} />
      <div className="h-[5px] w-7 rounded-full bg-white/[0.06] animate-pulse" style={delay} />
    </div>
  );
};

const SidebarModuleBtn: React.FC<{
  moduleKey: string;
  label: string;
  Icon: LucideIcon;
  isActive: boolean;
  onClick: () => void;
  expiresAt?: string | null;
  badgeCount?: number;
  onOpenWindow?: (x: number, y: number) => void;
  onOpenWindowDirect?: () => void;
}> = ({ moduleKey, label, Icon, isActive, onClick, expiresAt, badgeCount, onOpenWindow, onOpenWindowDirect }) => {
  const hiddenMenuModules = useContext(HiddenMenuModulesContext);
  const { sidebarMode } = useSidebarMode();
  const { theme } = useTheme();
  const [countdown, setCountdown] = useState<string | null>(null);
  const isTemporary = !!expiresAt;
  const isDarkSidebar = true;

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

  // Admin pode ocultar o módulo do menu "” exceto Perfil/Configurações (evita lockout).
  if (hiddenMenuModules.has(moduleKey) && moduleKey !== 'perfil' && moduleKey !== 'configuracoes') {
    return null;
  }

  // Entrada escalonada: cada item surge depois do anterior.
  // Perfil monta sempre (fora do ciclo de permissões), então não anima "” evita quebrar a cascata.
  const animatesEntry = moduleKey !== 'perfil';
  const enterClass = animatesEntry ? 'sidebar-enter' : '';
  const iconEnterClass = animatesEntry ? 'sidebar-icon-enter' : '';
  const enterStyle = animatesEntry
    ? { animationDelay: `${(MENU_ORDER[moduleKey] ?? 0) * MENU_ENTER_STEP_MS}ms` }
    : undefined;

  if (sidebarMode === 'normal') {
    return (
      <button
        onClick={onClick}
        onDoubleClick={onOpenWindowDirect ? (e) => { e.preventDefault(); onOpenWindowDirect(); } : undefined}
        onContextMenu={onOpenWindow ? (e) => { e.preventDefault(); onOpenWindow(e.clientX, e.clientY); } : undefined}
        style={enterStyle}
        className={`${enterClass} group relative flex w-full items-center gap-2.5 overflow-hidden rounded-[9px] px-2.5 py-[6px] transition-all duration-150 ${
          isActive
            ? 'bg-[#f27a23]/[0.13]'
            : isTemporary
            ? 'hover:bg-white/[0.05]'
            : 'hover:bg-white/[0.05]'
        }`}
      >
        {isActive && (
          <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px] bg-[#f27a23]" />
        )}
        {/* Ícone */}
        <div className={`relative flex-shrink-0 ${iconEnterClass}`} style={enterStyle}>
          <Icon className={`h-[14px] w-[14px] transition-colors duration-150 ${
            isActive
              ? 'text-[#f27a23]'
              : isTemporary
              ? 'text-cyan-600/70'
              : isDarkSidebar
              ? 'text-[#8b8b80] group-hover:text-[#e7e2d8]'
              : 'text-[#8b8b80] group-hover:text-[#3a3a35]'
          }`} />
          {isTemporary && !isActive && (
            <span className="absolute -top-px -right-px w-1.5 h-1.5 bg-cyan-500 rounded-full ring-1 ring-[#1e2028]" />
          )}
        </div>

        {/* Texto */}
        <span className={`flex-1 truncate text-left text-[12.5px] tracking-[-0.01em] transition-colors duration-150 ${
          isActive
            ? 'font-semibold text-[#f27a23]'
            : isTemporary
            ? 'font-medium text-cyan-700/70'
            : isDarkSidebar
            ? 'font-medium text-[#ddd8cf] group-hover:text-white'
            : 'font-medium text-[#18181a] group-hover:text-[#18181a]'
        }`}>{label}</span>

        {isTemporary && countdown && (
          <span className="text-[9px] font-mono flex-shrink-0 tabular-nums text-[#8b8b80]">
            {countdown}
          </span>
        )}
        {badgeCount !== undefined && badgeCount > 0 && (
          <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#f27a23] text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
        {onOpenWindowDirect && (
          <span
            title="Abrir como janela"
            role="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenWindowDirect(); }}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex h-5 w-5 items-center justify-center rounded text-[#8b8b80] hover:text-white hover:bg-white/10"
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5.5 1H13v7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M8 6L13 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      onDoubleClick={onOpenWindowDirect ? (e) => { e.preventDefault(); onOpenWindowDirect(); } : undefined}
      onContextMenu={onOpenWindow ? (e) => { e.preventDefault(); onOpenWindow(e.clientX, e.clientY); } : undefined}
      style={enterStyle}
      className={`${enterClass} group relative flex w-full flex-col items-center gap-1 rounded-[10px] px-1 py-2.5 transition-colors ${
        isActive
          ? 'text-[#f27a23]'
          : isTemporary
          ? 'text-cyan-400 hover:bg-white/[0.06]'
          : 'text-[#9a9bb8] hover:bg-white/[0.07] hover:text-[#d0d2e8]'
      }`}
    >
      {/* Barra com shimmer sweep */}
      {isActive && (
        <div className="sidebar-bar-shimmer absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-[3px]" />
      )}
      {isTemporary && !isActive && (
        <div className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-cyan-500" />
      )}
      <div className={`relative ${iconEnterClass}`} style={enterStyle}>
        <Icon
          className="h-[18px] w-[18px]"
          strokeWidth={1.75}
          style={isActive ? { filter: 'drop-shadow(0 0 6px rgba(242,122,35,0.9))' } : undefined}
        />
        {isTemporary && !isActive && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan-500 ring-1 ring-[#1e2028]" />
        )}
      </div>
      <span className="text-[9.5px] font-medium leading-none tracking-wide">{label}</span>
      {isTemporary && countdown && (
        <span className={`text-[8px] font-mono leading-tight ${isActive ? 'text-[#f27a23]/80' : 'text-cyan-600/80'}`}>
          {countdown}
        </span>
      )}
      {badgeCount !== undefined && badgeCount > 0 && (
        <span className="absolute right-1 top-1 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#f27a23] px-0.5 text-[9px] font-bold leading-none text-white">
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
      {onOpenWindowDirect && (
        <span
          title="Abrir como janela"
          role="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onOpenWindowDirect(); }}
          className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex h-3.5 w-3.5 items-center justify-center rounded text-white/40 hover:text-white/80"
        >
          <svg width="8" height="8" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M5.5 1H13v7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M8 6L13 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </span>
      )}
    </button>
  );
};

const MainApp: React.FC = () => {
  const { currentModule: activeModule, moduleParams, navigateTo, setModuleParams, clearModuleParams } = useNavigation();
  const { theme, toggleTheme } = useTheme();
  const { sidebarMode, setSidebarMode } = useSidebarMode();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Floating windows
  const { windows: floatWins, openWindow, updateWindow, closeWindow, focusWindow } = useFloatingWindows();
  const [sidebarCtx, setSidebarCtx] = useState<{ x: number; y: number; module: FloatingModuleKey; label: string } | null>(null);
  const toast = useToastContext();

  const handleOpenWindow = useCallback((module: FloatingModuleKey, label: string) => {
    const ok = openWindow(module, label);
    if (!ok) {
      toast.warning(`Limite de ${MAX_WINDOWS} janelas atingido. Feche uma para abrir outra.`);
    }
  }, [openWindow, toast]);
  useEffect(() => {
    if (!sidebarCtx) return;
    const close = () => setSidebarCtx(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [sidebarCtx]);

  // Seção inicial das Configurações (deep-link via moduleParams.section)
  const settingsInitialSection = useMemo(() => {
    const params = moduleParams['configuracoes'];
    try {
      return params ? (JSON.parse(params).section as string | undefined) : undefined;
    } catch {
      return undefined;
    }
  }, [moduleParams]);
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
  const [modulesConfig, setModulesConfig] = useState<ModulesConfig>({
    leads_enabled: true,
    financial_enabled: true,
    requirements_enabled: true,
    documents_enabled: true,
    calendar_enabled: true,
    tasks_enabled: true,
    hidden_menu_modules: [],
  });

  useEffect(() => {
    settingsService.getModulesConfig().then(setModulesConfig).catch(() => {});
    loadFormatterPrefs();
    // Recarrega a config de módulos quando o admin salvar em Configurações.
    const off = events.on(SYSTEM_EVENTS.MODULES_CONFIG_UPDATED, () => {
      settingsService.getModulesConfig().then(setModulesConfig).catch(() => {});
      loadFormatterPrefs();
    });
    return off;
  }, []);

  const hiddenMenuModules = useMemo(
    () => new Set(modulesConfig.hidden_menu_modules ?? []),
    [modulesConfig.hidden_menu_modules],
  );

  const floatingWindowModules = useMemo(
    () => new Set(modulesConfig.floating_window_modules ?? FLOATING_WINDOW_MODULE_DEFAULTS),
    [modulesConfig.floating_window_modules],
  );

  const isModuleEnabled = useCallback((moduleKey: ModuleName): boolean => {
    const map: Partial<Record<ModuleName, keyof ModulesConfig>> = {
      leads: 'leads_enabled',
      financeiro: 'financial_enabled',
      requerimentos: 'requirements_enabled',
      documentos: 'documents_enabled',
      agenda: 'calendar_enabled',
      tarefas: 'tasks_enabled',
    };
    const configKey = map[moduleKey];
    return configKey ? modulesConfig[configKey] !== false : true;
  }, [modulesConfig]);

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
  const { user, loading, signIn, signOut, resetPassword, isAccountBlocked } = useAuth();

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
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [clientPrefill, setClientPrefill] = useState<Partial<CreateClientDTO> | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Nome capturado no início do logout "” o handler SIGNED_OUT reseta o profile
  // para "Usuário", então congelamos o nome real para a despedida.
  const [logoutName, setLogoutName] = useState('');
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
    'whatsapp',
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
    // Navega normalmente "” o módulo renderizará AccessDeniedScreen se não houver permissão
    navigateTo(moduleKey, params);
  }, [navigateTo]);

  const handleNavigateToModule = (moduleKey: string, params?: Record<string, string>) => {
    safeNavigateTo(moduleKey as ModuleName, params);
  };

  // Guard de permissões "” sem redirecionamento; AccessDeniedScreen é renderizado no slot do módulo

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

  // #9 "” Busca global ⌘K
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
  // Keep-alive do WhatsApp: uma vez aberto, o módulo fica montado e só é ocultado
  // via CSS ao trocar de aba "” evita o "recarregamento" (refetch de conversas,
  // reassinatura de URLs, perda de scroll/rascunho) a cada volta para a inbox.
  const [whatsappEverOpened, setWhatsappEverOpened] = useState(false);
  useEffect(() => { if (activeModule === 'whatsapp') setWhatsappEverOpened(true); }, [activeModule]);
  // Notificações globais de WhatsApp (som + visual) para mensagens das MINHAS
  // conversas quando estamos fora do módulo. Vive no App para alcançar qualquer tela.
  useWhatsAppNotifications({
    userId: user?.id,
    inModule: activeModule === 'whatsapp',
    onOpen: (conversationId) => navigateTo('whatsapp', { conversationId }),
  });
  const [docRequestsOpen, setDocRequestsOpen] = useState(false);
  const [docRequestsBadge, setDocRequestsBadge] = useState(0);
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
            setProfileReady(true);
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
          setProfileReady(true);
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
        console.log('ðŸ”’ Logout detectado');
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

  const renderFloatModule = useCallback((module: FloatingModuleKey): React.ReactNode => {
    const wrap = (node: React.ReactNode) => (
      <Suspense fallback={<div className="flex h-full items-center justify-center text-zinc-400 text-sm">Carregando...</div>}>
        {node}
      </Suspense>
    );
    switch (module) {
      case 'agenda':        return wrap(<CalendarModule />);
      case 'prazos':        return wrap(<DeadlinesModule />);
      case 'dashboard':     return wrap(<Dashboard onNavigateToModule={handleNavigateToModule} />);
      case 'feed':          return wrap(<Feed onNavigateToModule={handleNavigateToModule} />);
      case 'clientes':      return wrap(<ClientsModule onClientSaved={() => {}} onClientCancelled={() => {}} />);
      case 'processos':     return wrap(<ProcessesModule />);
      case 'requerimentos': return wrap(<RequirementsModule />);
      case 'financeiro':    return wrap(<FinancialModule />);
      case 'intimacoes':    return wrap(<IntimationsModule onNavigateToModule={(k, p) => navigateTo(k as any, p)} />);
      case 'documentos':    return wrap(<DocumentsModule onNavigateToModule={(k, p) => navigateTo(k as any, p)} />);
      case 'assinaturas':   return wrap(<SignatureModule />);
      case 'cloud':         return wrap(<CloudModule onNavigateToModule={handleNavigateToModule} />);
      case 'chat':          return wrap(<ChatModule />);
      case 'whatsapp':      return wrap(<WhatsAppModule variant="embedded" />);
      case 'email':         return wrap(<EmailModule />);
      case 'leads':         return wrap(<LeadsModule onConvertLead={handleConvertLead} />);
      case 'configuracoes': return wrap(<SettingsModule variant="page" />);
      default:              return null;
    }
  }, [handleNavigateToModule, handleConvertLead, navigateTo]);

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
    setLogoutName(profile.name && profile.name !== 'Usuário' ? profile.name : '');
    setLoggingOut(true);

    try {
      // Encerra a sessão SEM redirecionar agora "” senão a página navega embora
      // e a animação de saída nem chega a aparecer.
      await signOut({ redirect: false });
    } catch {
      /* mesmo com erro, mostramos a animação e redirecionamos ao final */
    } finally {
      // Deixa a animação cinematográfica (~3,6s) rodar e só então navega.
      setTimeout(() => {
        window.location.href = '/';
      }, 3600);
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

  // â”€â”€ Rotas públicas "” renderizadas SEM autenticação de staff â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Devem ser verificadas ANTES do guard de login para que usuários externos
  // (signatários, convidados) acessem sem ter conta no sistema.
  if (!user) {
    const _hash = window.location.hash;
    const _path = window.location.pathname;

    // Assinatura de documento (link enviado por e-mail ao signatário)
    if (_hash.includes('/assinar/') || _path.includes('/assinar/')) {
      let token = _hash.split('/assinar/')[1]?.split('?')[0]?.split('#')[0];
      if (!token && _path.includes('/assinar/')) token = _path.split('/assinar/')[1]?.split('?')[0]?.split('#')[0];
      if (token) return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>}>
          <PublicSigningPage token={token} />
        </Suspense>
      );
    }

    // Visualização pública de documento assinado
    if (_hash.includes('/documento/') || _path.includes('/documento/')) {
      let token = _hash.split('/documento/')[1]?.split('?')[0]?.split('#')[0];
      if (!token && _path.includes('/documento/')) token = _path.split('/documento/')[1]?.split('?')[0]?.split('#')[0];
      if (token) return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>}>
          <PublicDocumentPage token={token} />
        </Suspense>
      );
    }

    // Preenchimento público de template
    if (_hash.includes('/preencher/') || _path.includes('/preencher/')) {
      let token = _hash.split('/preencher/')[1]?.split('?')[0]?.split('#')[0];
      if (!token && _path.includes('/preencher/')) token = _path.split('/preencher/')[1]?.split('?')[0]?.split('#')[0];
      if (token) return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>}>
          <PublicTemplateFillPage token={token} />
        </Suspense>
      );
    }

    // Compartilhamento de pasta cloud
    if (_hash.includes('/cloud/share/') || _path.includes('/cloud/share/')) {
      let token = _hash.split('/cloud/share/')[1]?.split('?')[0]?.split('#')[0];
      if (!token && _path.includes('/cloud/share/')) token = _path.split('/cloud/share/')[1]?.split('?')[0]?.split('#')[0];
      if (token) return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-sky-600" /></div>}>
          <PublicCloudSharePage token={token} />
        </Suspense>
      );
    }
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
      {isAccountBlocked && <BlockedAccountOverlay onLogout={signOut} />}
      <div className="min-h-screen overflow-x-hidden bg-gray-100 dark:bg-black transition-colors duration-300">
        {/* Overlay de LOGIN "” Epic Animation (o logout tem o seu próprio, abaixo) */}
        {loggingIn && (
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

                <BrandLogo iconOnly size="xl" shine />
              </div>

              {/* Brand */}
              <div className="text-center mb-10 flex flex-col items-center">
                <BrandLogo wordmarkOnly variant="reversed" size="xl" />
                <div className="mt-6 h-px w-64 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </div>

              {/* Loading bar */}
              <div className="w-64 sm:w-80 mb-8">
                <div className="h-1.5 bg-[#f8f7f5]/10 rounded-full overflow-hidden backdrop-blur-sm">
                  <div className="h-full bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500 rounded-full animate-loading-bar shadow-[0_0_24px_rgba(251,146,60,0.25)]" />
                </div>
              </div>

              {/* Status */}
              <div className="text-center">
                <p className="text-lg sm:text-xl font-semibold text-white mb-2">
                  Preparando seu ambiente
                </p>
                <p className="text-sm text-white/50 flex items-center gap-2 justify-center">
                  <span className="inline-block w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
                  Carregando dados do escritório...
                </p>
              </div>
            </div>

            {/* Bottom gradient fade */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-950 to-transparent" />
          </div>
        )}

        {/* Overlay de LOGOUT "” despedida cinematográfica dedicada */}
        {loggingOut && <LogoutOverlay userName={logoutName} />}

        {/* Aviso de sessão */}
        <SessionWarning />
      {/* Sidebar Minimalista */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}
      {/* â”€â”€ App shell flex: spacer + main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex min-h-screen">
      {/* Spacer invisible que reserva a largura da sidebar no layout */}
      <div
        className={`hidden md:block flex-none transition-all duration-300 ${
          sidebarMode === 'normal' ? 'w-[256px]' : 'w-[84px]'
        }`}
        aria-hidden="true"
      />

      <HiddenMenuModulesContext.Provider value={hiddenMenuModules}>
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col ${
          sidebarMode === 'normal' ? 'w-[256px]' : 'w-[84px]'
        } border-r border-white/[0.07] bg-[#1e2028] text-white shadow-[2px_0_16px_rgba(0,0,0,0.18)] ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } transition-all duration-300`}
      >
        {/* Logo */}
        {sidebarMode === 'normal' ? (
          <div className="flex items-center px-4 py-4 border-b border-white/[0.06]">
            <BrandLogo variant="reversed" size="sm" showTagline={false} divider={false} />
          </div>
        ) : (
          <div className="flex items-center justify-center py-[17px] border-b border-white/[0.06]">
            <BrandLogo iconOnly variant="reversed" size="sm" />
          </div>
        )}

        {/* Barra de carregamento (enquanto resolve permissões) */}
        {permissionsLoading && (
          <div className="h-[2px] w-full overflow-hidden bg-white/[0.04]">
            <div className="h-full rounded-full bg-[#f27a23] animate-loading-bar" />
          </div>
        )}

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto scrollbar-hide flex flex-col ${
          sidebarMode === 'normal' ? 'pl-0 pr-2.5 py-2 gap-0' : 'px-2.5 py-3 gap-0.5'
        }`}>
          {/* â”€â”€ PRINCIPAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {sidebarMode === 'normal' && (
            <div className="flex items-center gap-2 pl-3 pr-0 pt-2 pb-1 select-none">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/[0.28]">Principal</span>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>
          )}
          <SidebarModuleBtn moduleKey="dashboard" label="Dashboard" Icon={Layers}
            isActive={activeModule === 'dashboard'}
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('dashboard'); }}
            onOpenWindow={floatingWindowModules.has('dashboard') ? (x,y) => setSidebarCtx({x,y,module:'dashboard',label:'Dashboard'}) : undefined}
            onOpenWindowDirect={floatingWindowModules.has('dashboard') ? () => handleOpenWindow('dashboard','Dashboard') : undefined} />
          <SidebarModuleBtn moduleKey="feed" label="Feed" Icon={Newspaper}
            isActive={activeModule === 'feed'}
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('feed'); }}
            onOpenWindow={floatingWindowModules.has('feed') ? (x,y) => setSidebarCtx({x,y,module:'feed',label:'Feed'}) : undefined}
            onOpenWindowDirect={floatingWindowModules.has('feed') ? () => handleOpenWindow('feed','Feed') : undefined} />

          {/* Skeleton enquanto as permissões carregam */}
          {permissionsLoading && (
            <div className={`flex flex-col ${sidebarMode === 'normal' ? 'gap-0' : 'gap-0.5'}`} aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <SidebarSkeletonBtn key={i} index={i} />
              ))}
            </div>
          )}
          {!permissionsLoading && canAccessModule('agenda') && isModuleEnabled('agenda') && (
            <SidebarModuleBtn moduleKey="agenda" label="Agenda" Icon={Calendar}
              isActive={activeModule === 'agenda'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('agenda'); }}
              expiresAt={getOverrideExpiry('agenda')}
              onOpenWindow={floatingWindowModules.has('agenda') ? (x,y) => setSidebarCtx({x,y,module:'agenda',label:'Agenda'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('agenda') ? () => handleOpenWindow('agenda','Agenda') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('chat') && (
            <SidebarModuleBtn moduleKey="chat" label="Chat" Icon={MessageCircle}
              isActive={activeModule === 'chat'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('chat'); }}
              expiresAt={getOverrideExpiry('chat')}
              onOpenWindow={floatingWindowModules.has('chat') ? (x,y) => setSidebarCtx({x,y,module:'chat',label:'Chat'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('chat') ? () => handleOpenWindow('chat','Chat') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('whatsapp') && (
            <SidebarModuleBtn moduleKey="whatsapp" label="WhatsApp" Icon={MessageSquare}
              isActive={activeModule === 'whatsapp'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('whatsapp'); }}
              expiresAt={getOverrideExpiry('whatsapp')}
              onOpenWindow={floatingWindowModules.has('whatsapp') ? (x,y) => setSidebarCtx({x,y,module:'whatsapp',label:'WhatsApp'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('whatsapp') ? () => handleOpenWindow('whatsapp','WhatsApp') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('email') && (
            <SidebarModuleBtn moduleKey="email" label="Email" Icon={Mail}
              isActive={activeModule === 'email'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('email'); }}
              expiresAt={getOverrideExpiry('email')}
              onOpenWindow={floatingWindowModules.has('email') ? (x,y) => setSidebarCtx({x,y,module:'email',label:'Email'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('email') ? () => handleOpenWindow('email','Email') : undefined} />
          )}

          {/* â”€â”€ ATENDIMENTO â”€â”€ Leads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
              O funil de Leads deixou de ser um item de menu próprio: agora vive
              embutido no módulo WhatsApp (gaveta no topo do atendimento). A rota
              interna 'leads' permanece válida para deep-links/compatibilidade,
              mas não é mais exposta no sidebar. */}

          {/* â”€â”€ GESTÃO â”€â”€ Clientes, Processos, Req., Petições, Fin. */}
          {sidebarMode === 'normal' && !permissionsLoading && (
            (canAccessModule('clientes') && !hiddenMenuModules.has('clientes')) ||
            (canAccessModule('processos') && !hiddenMenuModules.has('processos')) ||
            (canAccessModule('requerimentos') && isModuleEnabled('requerimentos') && !hiddenMenuModules.has('requerimentos')) ||
            (canAccessModule('peticoes') && !hiddenMenuModules.has('peticoes')) ||
            (canAccessModule('financeiro') && isModuleEnabled('financeiro') && !hiddenMenuModules.has('financeiro'))
          ) && (
            <div className="flex items-center gap-2 pl-3 pr-0 pt-3.5 pb-1 select-none">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/[0.28]">Gestão</span>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>
          )}
          {!permissionsLoading && canAccessModule('clientes') && (
            <SidebarModuleBtn moduleKey="clientes" label="Clientes" Icon={Users}
              isActive={activeModule === 'clientes'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('clientes'); }}
              expiresAt={getOverrideExpiry('clientes')}
              onOpenWindow={floatingWindowModules.has('clientes') ? (x,y) => setSidebarCtx({x,y,module:'clientes',label:'Clientes'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('clientes') ? () => handleOpenWindow('clientes','Clientes') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('processos') && (
            <SidebarModuleBtn moduleKey="processos" label="Processos" Icon={Scale}
              isActive={activeModule === 'processos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('processos'); }}
              expiresAt={getOverrideExpiry('processos')}
              onOpenWindow={floatingWindowModules.has('processos') ? (x,y) => setSidebarCtx({x,y,module:'processos',label:'Processos'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('processos') ? () => handleOpenWindow('processos','Processos') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('requerimentos') && isModuleEnabled('requerimentos') && (
            <SidebarModuleBtn moduleKey="requerimentos" label="Requerimentos" Icon={Briefcase}
              isActive={activeModule === 'requerimentos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('requerimentos'); }}
              expiresAt={getOverrideExpiry('requerimentos')}
              onOpenWindow={floatingWindowModules.has('requerimentos') ? (x,y) => setSidebarCtx({x,y,module:'requerimentos',label:'Requerimentos'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('requerimentos') ? () => handleOpenWindow('requerimentos','Requerimentos') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('peticoes') && (
            <SidebarModuleBtn moduleKey="peticoes" label="Petições" Icon={FileText}
              isActive={false}
              onClick={() => { setIsMobileNavOpen(false); events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN); }} />
          )}
          {!permissionsLoading && canAccessModule('financeiro') && isModuleEnabled('financeiro') && (
            <SidebarModuleBtn moduleKey="financeiro" label="Financeiro" Icon={PiggyBank}
              isActive={activeModule === 'financeiro'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('financeiro'); }}
              expiresAt={getOverrideExpiry('financeiro')}
              onOpenWindow={floatingWindowModules.has('financeiro') ? (x,y) => setSidebarCtx({x,y,module:'financeiro',label:'Financeiro'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('financeiro') ? () => handleOpenWindow('financeiro','Financeiro') : undefined} />
          )}

          {/* â”€â”€ OPERACIONAL â”€â”€ Prazos, Intimações â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {sidebarMode === 'normal' && !permissionsLoading && (
            (canAccessModule('prazos') && !hiddenMenuModules.has('prazos')) ||
            (canAccessModule('intimacoes') && !hiddenMenuModules.has('intimacoes'))
          ) && (
            <div className="flex items-center gap-2 pl-3 pr-0 pt-3.5 pb-1 select-none">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/[0.28]">Operacional</span>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>
          )}
          {!permissionsLoading && canAccessModule('prazos') && (
            <SidebarModuleBtn moduleKey="prazos" label="Prazos" Icon={AlarmClock}
              isActive={activeModule === 'prazos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('prazos'); }}
              expiresAt={getOverrideExpiry('prazos')}
              onOpenWindow={floatingWindowModules.has('prazos') ? (x,y) => setSidebarCtx({x,y,module:'prazos',label:'Prazos'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('prazos') ? () => handleOpenWindow('prazos','Prazos') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('intimacoes') && (
            <SidebarModuleBtn moduleKey="intimacoes" label="Intimações" Icon={Bell}
              isActive={activeModule === 'intimacoes'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('intimacoes'); }}
              expiresAt={getOverrideExpiry('intimacoes')}
              onOpenWindow={floatingWindowModules.has('intimacoes') ? (x,y) => setSidebarCtx({x,y,module:'intimacoes',label:'Intimações'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('intimacoes') ? () => handleOpenWindow('intimacoes','Intimações') : undefined} />
          )}

          {/* â”€â”€ DOCS â”€â”€ Documentos, Assinaturas, Cloud â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {sidebarMode === 'normal' && !permissionsLoading && (
            (canAccessModule('documentos') && isModuleEnabled('documentos') && !hiddenMenuModules.has('documentos')) ||
            (canAccessModule('assinaturas') && !hiddenMenuModules.has('assinaturas')) ||
            (canAccessModule('cloud') && !hiddenMenuModules.has('cloud'))
          ) && (
            <div className="flex items-center gap-2 pl-3 pr-0 pt-3.5 pb-1 select-none">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/[0.28]">Docs</span>
              <div className="h-px flex-1 bg-white/[0.06]" />
            </div>
          )}
          {!permissionsLoading && canAccessModule('documentos') && isModuleEnabled('documentos') && (
            <SidebarModuleBtn moduleKey="documentos" label="Documentos" Icon={Library}
              isActive={activeModule === 'documentos'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('documentos'); }}
              expiresAt={getOverrideExpiry('documentos')}
              onOpenWindow={floatingWindowModules.has('documentos') ? (x,y) => setSidebarCtx({x,y,module:'documentos',label:'Documentos'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('documentos') ? () => handleOpenWindow('documentos','Documentos') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('assinaturas') && (
            <SidebarModuleBtn moduleKey="assinaturas" label="Assinaturas" Icon={PenTool}
              isActive={activeModule === 'assinaturas'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('assinaturas'); }}
              expiresAt={getOverrideExpiry('assinaturas')}
              onOpenWindow={floatingWindowModules.has('assinaturas') ? (x,y) => setSidebarCtx({x,y,module:'assinaturas',label:'Assinaturas'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('assinaturas') ? () => handleOpenWindow('assinaturas','Assinaturas') : undefined} />
          )}
          {!permissionsLoading && canAccessModule('cloud') && (
            <SidebarModuleBtn moduleKey="cloud" label="Cloud" Icon={Cloud}
              isActive={activeModule === 'cloud'}
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); safeNavigateTo('cloud'); }}
              expiresAt={getOverrideExpiry('cloud')}
              onOpenWindow={floatingWindowModules.has('cloud') ? (x,y) => setSidebarCtx({x,y,module:'cloud',label:'Cloud'}) : undefined}
              onOpenWindowDirect={floatingWindowModules.has('cloud') ? () => handleOpenWindow('cloud','Cloud') : undefined} />
          )}

          {/* Separador + Perfil */}
          <div className={`h-px bg-white/[0.06] ${sidebarMode === 'normal' ? 'mt-1.5 mb-0.5' : 'my-2 mx-1.5'}`} />
          <SidebarModuleBtn moduleKey="perfil" label="Perfil" Icon={UserCog}
            isActive={activeModule === 'perfil'}
            onClick={() => { setIsMobileNavOpen(false); navigateTo('perfil'); }}
            badgeCount={isAdmin && sidebarPendingCount > 0 ? sidebarPendingCount : undefined} />
        </nav>

          {/* Collapse / expand toggle */}
        <div className={`border-t border-white/[0.06] ${
          sidebarMode === 'normal' ? 'px-2 py-1.5' : 'flex justify-center py-2.5'
        }`}>
          <button
            onClick={() => setSidebarMode(sidebarMode === 'normal' ? 'compact' : 'normal')}
            title={sidebarMode === 'normal' ? 'Recolher menu' : 'Expandir menu'}
            className={`flex items-center gap-2.5 rounded-md transition-colors duration-100 ${
              sidebarMode === 'normal'
                ? 'w-full px-2.5 py-[6px] text-white/30 hover:bg-white/[0.05] hover:text-white/60'
                : 'h-8 w-8 justify-center text-white/30 hover:bg-white/[0.05] hover:text-white/60'
            }`}
          >
            <ArrowLeft className={`h-[14px] w-[14px] flex-shrink-0 transition-transform duration-300 ${sidebarMode === 'compact' ? 'rotate-180' : ''}`} />
            {sidebarMode === 'normal' && (
              <span className="text-[11px] font-medium tracking-wide">Recolher</span>
            )}
          </button>
        </div>
      </aside>
      </HiddenMenuModulesContext.Provider>

        {/* Main Content Area */}
      <div className={`flex min-w-0 flex-1 flex-col overflow-x-hidden transition-all duration-300 bg-[#f5f5f3] dark:bg-zinc-950 ${activeModule === 'chat' || activeModule === 'whatsapp' || activeModule === 'email' ? 'h-[100dvh] overflow-hidden' : ''}`}>
        {/* Cloud Mobile Header - Pill-shaped navigation shell */}
        {activeModule === 'cloud' ? (
          <header className="sticky top-0 z-30 px-3 py-3 md:hidden">
            <div className="flex items-center justify-between gap-3 rounded-full border border-white/70 bg-[#f8f7f5]/95 backdrop-blur-xl px-3 py-2.5 shadow-[0px_12px_32px_rgba(44,47,48,0.08)]">
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
        <header className={`sticky top-0 z-30 ${
          activeModule === 'cloud'
            ? `hidden md:block border-b ${theme === 'dark' ? 'border-white/[0.08] bg-[#18181a]' : 'border-[#e7e5df] bg-[#f8f7f5] shadow-[0_1px_0_rgba(15,23,42,0.04)]'}`
            : `border-b ${theme === 'dark' ? 'border-white/[0.08] bg-[#18181a]' : 'border-[#e7e5df] bg-[#f8f7f5] shadow-[0_1px_0_rgba(15,23,42,0.04)]'}`
        }`}>
          <div className="px-4 lg:px-6">
            <div className="flex h-[62px] items-center gap-4">

              {/* LEFT: mobile menu + breadcrumb */}
              <div className="flex min-w-0 flex-none items-center gap-3 w-[190px]">
                <button
                  className="md:hidden inline-flex items-center justify-center p-2 rounded-lg text-slate-600 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
                  onClick={() => setIsMobileNavOpen((prev) => !prev)}
                  aria-label="Alternar menu"
                >
                  {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
                {(() => {
                  const MODULE_META: Record<string, { label: string; Icon: LucideIcon }> = {
                    cloud: { label: 'Cloud', Icon: Cloud },
                    dashboard: { label: 'Dashboard', Icon: Layers },
                    feed: { label: 'Feed', Icon: Newspaper },
                    leads: { label: 'Leads', Icon: Target },
                    clientes: { label: 'Clientes', Icon: Users },
                    processos: { label: 'Processos', Icon: Scale },
                    requerimentos: { label: 'Requerimentos', Icon: Briefcase },
                    peticoes: { label: 'Petições', Icon: FileText },
                    financeiro: { label: 'Financeiro', Icon: PiggyBank },
                    prazos: { label: 'Prazos', Icon: AlarmClock },
                    intimacoes: { label: 'Intimações', Icon: Bell },
                    documentos: { label: 'Documentos', Icon: Library },
                    assinaturas: { label: 'Assinaturas', Icon: PenTool },
                    perfil: { label: 'Perfil', Icon: UserCog },
                    configuracoes: { label: 'Configurações', Icon: Settings },
                    agenda: { label: 'Agenda', Icon: Calendar },
                    chat: { label: 'Chat', Icon: MessageCircle },
                    whatsapp: { label: 'WhatsApp', Icon: MessageSquare },
                    tarefas: { label: 'Tarefas', Icon: CheckSquare },
                  };
                  const meta = MODULE_META[activeModule];
                  if (!meta) return null;
                  const { label, Icon: ModIcon } = meta;
                  return (
                    <div className="hidden md:flex items-center gap-2 select-none min-w-0">
                      <ModIcon className="h-[15px] w-[15px] flex-shrink-0 text-slate-400" />
                      <span className="truncate text-[13.5px] font-semibold text-slate-700">{label}</span>
                    </div>
                  );
                })()}
              </div>

              {/* CENTER: search */}
              <div className="hidden md:flex flex-1 justify-center">
                <button
                  type="button"
                  onClick={() => setGlobalSearchOpen(true)}
                  className="flex w-full max-w-[420px] items-center gap-3 rounded-xl border border-[#e7e5df] bg-[#f7f6f3] px-4 py-2.5 text-[13px] text-slate-400 shadow-[0_1px_3px_rgba(15,23,42,0.04)] transition hover:border-[#d4d2cc] hover:bg-[#f2f1ee] hover:text-slate-600"
                  title="Pesquisa global (⌘K)"
                >
                  <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  <span className="flex-1 text-left">Pesquisa global...</span>
                  <span className="rounded-md border border-[#e0ddd8] bg-white px-1.5 py-0.5 text-[11px] text-slate-400 shadow-sm">⌘K</span>
                </button>
              </div>

              {/* RIGHT: ações */}
              <div className="flex flex-none items-center gap-1">
                {/* Busca mobile */}
                <button
                  onClick={() => setGlobalSearchOpen(true)}
                  className="flex md:hidden items-center justify-center h-9 w-9 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                >
                  <Search className="w-4 h-4" />
                </button>

                {activeModule !== 'cloud' && (
                  permissionsLoading ? (
                    <div className="h-9 w-9 rounded-lg bg-slate-100 animate-pulse" aria-hidden="true" />
                  ) : (isModuleEnabled('tarefas') && canAccessModule('tarefas') && !hiddenMenuModules.has('tarefas') && (
                  <button
                    onClick={() => navigateTo('tarefas')}
                    className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      activeModule === 'tarefas'
                        ? 'text-[#f27a23] bg-[#fff3e8]'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                    title="Tarefas"
                  >
                    <CheckSquare className="w-[18px] h-[18px]" />
                    {safePendingTasksCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white flex items-center justify-center leading-none">
                        {safePendingTasksCount > 99 ? '99+' : safePendingTasksCount}
                      </span>
                    )}
                  </button>
                  ))
                )}

                {activeModule !== 'cloud' && (
                <button
                  onClick={() => setDocRequestsOpen(o => !o)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                    docRequestsOpen
                      ? 'text-[#f27a23] bg-[#fff3e8]'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                  title="Solicitações de documentos"
                >
                  <FolderOpen className="w-[18px] h-[18px]" />
                  {docRequestsBadge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white flex items-center justify-center leading-none">
                      {docRequestsBadge > 99 ? '99+' : docRequestsBadge}
                    </span>
                  )}
                </button>
                )}

                <NotificationBell
                  onNavigateToModule={(moduleKey: string, params?: any) => {
                    safeNavigateTo(moduleKey as any, params);
                  }}
                />

                {/* Tema "” junto das demais ações, antes do divisor de identidade */}
                {activeModule !== 'cloud' && (
                  <button
                    onClick={toggleTheme}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
                  >
                    {theme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
                  </button>
                )}

                {/* Identidade: nome + foto agrupados (foto à direita), tamanhos fixos */}
                <div className={`flex items-center gap-3 ${activeModule === 'cloud' ? '' : 'ml-1.5 pl-3.5 border-l border-[#e7e5df]'}`}>
                  {profileReady ? (
                    <div className="hidden lg:block text-right leading-tight w-[190px]">
                      <p className="text-[14.5px] font-semibold text-slate-900 truncate">{profile.name}</p>
                      <p className="text-[12px] text-slate-500 truncate">{profile.role}</p>
                    </div>
                  ) : (
                    <ShimmerSweep className="hidden lg:block w-[190px] rounded" aria-hidden="true">
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="h-3.5 w-32 rounded bg-slate-200" />
                        <div className="h-2.5 w-20 rounded bg-slate-200" />
                      </div>
                    </ShimmerSweep>
                  )}

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
                      <div className="relative overflow-hidden rounded-full border border-amber-500 shadow-md h-11 w-11 bg-amber-100">
                        {profileReady ? (
                          <img src={profile.avatarUrl || GENERIC_AVATAR} alt={profile.name} decoding="async" className="w-full h-full object-cover" />
                        ) : (
                          <ShimmerSweep className="h-full w-full">
                            <div className="h-full w-full bg-slate-200 dark:bg-zinc-700" />
                          </ShimmerSweep>
                        )}
                      </div>
                    </button>
                    <div
                      className={`absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-[#e7e5df] bg-white shadow-[0_8px_32px_rgba(15,23,42,0.12)] transition-all z-50 ${
                        profileMenuOpen
                          ? 'opacity-100 translate-y-0 pointer-events-auto'
                          : 'opacity-0 translate-y-2 pointer-events-none'
                      }`}
                    >
                      {/* User info header */}
                      <div className="flex items-center gap-3 border-b border-[#f0ede8] px-4 py-3">
                        <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full border border-amber-200">
                          <img src={profile.avatarUrl || GENERIC_AVATAR} alt={profile.name} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-slate-900">{profile.name}</p>
                          <p className="truncate text-[11px] text-slate-500">{profile.role}</p>
                        </div>
                      </div>
                      {/* Menu items */}
                      <div className="py-1.5">
                        {canAccessConfig && (
                          <button
                            onClick={() => {
                              setProfileMenuOpen(false);
                              navigateTo('configuracoes');
                            }}
                            className="flex w-full items-center gap-2.5 px-4 py-[7px] text-[13px] text-slate-700 transition-colors hover:bg-[#faf9f7]"
                          >
                            <Settings className="h-3.5 w-3.5 text-slate-400" />
                            Configurações
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setProfileMenuOpen(false);
                            openProfileModal();
                          }}
                          className="flex w-full items-center gap-2.5 px-4 py-[7px] text-[13px] text-slate-700 transition-colors hover:bg-[#faf9f7]"
                        >
                          <UserCog className="h-3.5 w-3.5 text-slate-400" />
                          Meu Perfil
                        </button>
                      </div>
                      {/* Logout */}
                      <div className="border-t border-[#f0ede8] py-1.5">
                        <button
                          onClick={handleLogout}
                          disabled={loggingOut}
                          className="flex w-full items-center gap-2.5 px-4 py-[7px] text-[13px] text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          Sair da conta
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className={`${activeModule === 'chat' || activeModule === 'whatsapp' || activeModule === 'email' ? 'px-0 py-0 space-y-0 overflow-hidden' : activeModule === 'cloud' ? 'px-3 sm:px-1 lg:px-2 xl:px-3 space-y-2 sm:space-y-3' : 'px-3 sm:px-4 lg:px-6 xl:px-8 space-y-4 sm:space-y-6'} flex-1 min-h-0 ${activeModule === 'agenda' ? 'py-0' : activeModule === 'chat' || activeModule === 'whatsapp' || activeModule === 'email' ? 'py-0' : activeModule === 'cloud' ? 'py-2 sm:py-2' : 'py-4 sm:py-6'}`}>
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
            {/* Tela de acesso restrito "” exibida quando o usuário não tem permissão para o módulo ativo */}
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
            {activeModule === 'configuracoes' && (
              <SettingsModule
                variant="page"
                initialSection={settingsInitialSection as any}
                onParamConsumed={() => clearModuleParams('configuracoes')}
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
            {/* WhatsApp: montado uma vez e mantido vivo (display:none quando inativo)
                para preservar estado da inbox e o realtime entre trocas de aba. */}
            {whatsappEverOpened && (
              // Caixa real (flex + h-full) em vez de `display: contents`: o Chrome
              // não resolve `height: 100%` do módulo através de um ancestral
              // `display: contents`, então a thread crescia até o tamanho do
              // conteúdo e o compositor ficava cortado abaixo da viewport. Com uma
              // caixa de altura definida, o módulo recebe a altura correta e o
              // compositor fica sempre visível (a thread rola acima dele).
              <div className="min-h-0 flex-col" style={{ display: activeModule === 'whatsapp' ? 'flex' : 'none', height: '100%' }}>
                <WhatsAppModule
                  openConversationId={moduleParams['whatsapp'] ? JSON.parse(moduleParams['whatsapp']).conversationId : undefined}
                  onParamConsumed={() => clearModuleParams('whatsapp')}
                  onConvertLead={handleConvertLead}
                />
              </div>
            )}
            {activeModule === 'email' && <EmailModule params={moduleParams['email'] ? JSON.parse(moduleParams['email']) : undefined} />}
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
            {/* settings aberto como modal "” não como módulo de página */}
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

        {/* Tracker de solicitações de documentos */}
        <DocumentRequestsTracker
          open={docRequestsOpen}
          onClose={() => setDocRequestsOpen(false)}
          onBadgeCountChange={setDocRequestsBadge}
        />

        {activeModule !== 'chat' && activeModule !== 'whatsapp' && activeModule !== 'email' && (
          <div className="px-3 sm:px-4 lg:px-6 xl:px-8 py-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-[#e7e5df] pt-4 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>Â© {new Date().getFullYear()} jurius.com.br</span>
              </div>
              <span>{DISPLAY_APP_VERSION_LABEL}</span>
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
      </div>
      <Suspense fallback={null}>
        <PetitionEditorWidget />
      </Suspense>

      <Suspense fallback={null}>
        <ChatFloatingWidget />
      </Suspense>

      {/* #9 "” Modal de busca global ⌘K */}
      <GlobalSearchModal
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        onNavigate={(module, params) => safeNavigateTo(module as any, params as any)}
      />

      {/* Context menu — Abrir como janela */}
      {sidebarCtx && (
        <div
          style={{ position: 'fixed', top: sidebarCtx.y, left: sidebarCtx.x, zIndex: 99999 }}
          className="min-w-[180px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-400 select-none">{sidebarCtx.label}</div>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => { handleOpenWindow(sidebarCtx.module, sidebarCtx.label); setSidebarCtx(null); }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="4" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5.5 1H13v7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M8 6L13 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            Abrir como janela
          </button>
        </div>
      )}

      {/* Floating Windows */}
      {floatWins.length > 0 && (
        <FloatingWindowSystem
          windows={floatWins}
          onUpdate={updateWindow}
          onClose={closeWindow}
          onFocus={focusWindow}
          renderModule={renderFloatModule}
        />
      )}

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
  
  const isSignatureTermsRoute = hashRoute?.includes('/termos-assinatura') || pathname?.includes('/termos-assinatura');
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

  if (isSignatureTermsRoute) {
    let version = hashRoute.split('/termos-assinatura/')[1]?.split('?')[0]?.split('#')[0];
    if (!version && pathname.includes('/termos-assinatura/')) {
      version = pathname.split('/termos-assinatura/')[1]?.split('?')[0]?.split('#')[0];
    }
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#f8f7f5] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-600" /></div>}>
        <PublicSignatureTermsPage version={version || null} />
      </Suspense>
    );
  }

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

