import { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { useNavigation } from './contexts/NavigationContext';
import {
  Scale,
  Users,
  Calendar,
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
  Home,
  FileText,
} from 'lucide-react';
import Login from './components/Login';
import ProfileModal from './components/ProfileModal';
import { ClientFormModal } from './components/ClientFormModal';
import { NotificationCenterNew as NotificationCenter } from './components/NotificationCenterNew';
import { NotificationPermissionBanner } from './components/NotificationPermissionBanner';
import SessionWarning from './components/SessionWarning';

// Lazy loading dos módulos principais (carrega apenas quando acessado)
const Dashboard = lazy(() => import('./components/Dashboard'));
const ClientsModule = lazy(() => import('./components/ClientsModule'));
const DocumentsModule = lazy(() => import('./components/DocumentsModule'));
const LeadsModule = lazy(() => import('./components/LeadsModule'));
const ProcessesModule = lazy(() => import('./components/ProcessesModule'));
const IntimationsModule = lazy(() => import('./components/IntimationsModule'));
const RequirementsModule = lazy(() => import('./components/RequirementsModule'));
const DeadlinesModule = lazy(() => import('./components/DeadlinesModule'));
const CalendarModule = lazy(() => import('./components/CalendarModule'));
const TasksModule = lazy(() => import('./components/TasksModule'));
const NotificationsModuleNew = lazy(() => import('./components/NotificationsModuleNew'));
const FinancialModule = lazy(() => import('./components/FinancialModule'));
const CronEndpoint = lazy(() => import('./components/CronEndpoint'));
import { useNotifications } from './hooks/useNotifications';
import { usePresence } from './hooks/usePresence';
import { pushNotifications } from './utils/pushNotifications';
import { useAuth } from './contexts/AuthContext';
import { CacheProvider } from './contexts/CacheContext';
import { useDjenSync } from './hooks/useDjenSync';
import { profileService } from './services/profile.service';
import { leadService } from './services/lead.service';
import { notificationService } from './services/notification.service';
import { taskService } from './services/task.service';
import { djenLocalService } from './services/djenLocal.service';
import { supabase } from './config/supabase';
import { clientService } from './services/client.service';
import type { Lead } from './types/lead.types';
import type { CreateClientDTO } from './types/client.types';
import type { NotificationItem } from './types/notification.types';

type ClientSearchResult = Awaited<ReturnType<typeof clientService.searchClients>>[number];

function App() {
  const isCronRoute = typeof window !== 'undefined' && window.location.hash.includes('/cron/djen');

  if (isCronRoute) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Suspense fallback={<div className="p-8 text-center text-slate-600">Carregando cron...</div>}>
          <CronEndpoint />
        </Suspense>
      </div>
    );
  }

  const { currentModule: activeModule, moduleParams, navigateTo, setModuleParams, clearModuleParams } = useNavigation();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { user, loading, signIn, signOut, resetPassword } = useAuth();
  
  // Ativar sincronização automática com DJEN
  useDjenSync();
  
  // Ativar sistema de presença
  usePresence();

  const GENERIC_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=300';

  const [profile, setProfile] = useState({
    name: 'Usuário',
    email: '',
    avatarUrl: GENERIC_AVATAR,
    role: 'Advogado',
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
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [leadToConvert, setLeadToConvert] = useState<Lead | null>(null);
  const [pendingTasksCount, setPendingTasksCount] = useState(0);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<ClientSearchResult[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [isClientFormModalOpen, setIsClientFormModalOpen] = useState(false);
  const [clientFormPrefill, setClientFormPrefill] = useState<Partial<CreateClientDTO> | null>(null);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

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

  const PROFILE_CACHE_KEY = 'crm-profile-cache';
  const NOTIFICATIONS_CACHE_KEY = 'crm-notifications-cache';

  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      const cacheAvailable = typeof window !== 'undefined';

      if (cacheAvailable) {
        const cachedProfile = sessionStorage.getItem(PROFILE_CACHE_KEY);
        if (cachedProfile) {
          try {
            const parsed = JSON.parse(cachedProfile);
            setProfile(parsed);
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
            const normalized = {
              name: data.name || 'Área Jurídica',
              email: data.email || user.email || '',
              role: data.role || 'Advogado',
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
            const fallback = {
              name: user.user_metadata.full_name || user.email?.split('@')[0] || 'Usuário',
              email: user.email || '',
              avatarUrl: GENERIC_AVATAR,
              role: 'Advogado',
              phone: '',
              oab: '',
              bio: '',
              lawyerFullName: '',
            };
            await profileService.upsertProfile(user.id, {
              name: fallback.name,
              email: fallback.email,
              role: fallback.role,
              phone: fallback.phone,
              oab: fallback.oab,
              lawyer_full_name: fallback.lawyerFullName,
              bio: fallback.bio,
              avatar_url: fallback.avatarUrl,
            });
            setProfile(fallback);
            if (cacheAvailable) {
              sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(fallback));
            }
          }
        } catch (error: any) {
          setProfileError(error.message || 'Não foi possível carregar o perfil.');
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
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event);
      
      if (event === 'TOKEN_REFRESHED') {
        console.log('✅ Token renovado automaticamente');
      }
      
      if (event === 'SIGNED_OUT' || (event === 'USER_UPDATED' && !session)) {
        console.log('🔒 Sessão expirada ou logout detectado');
        // Limpar cache
        sessionStorage.removeItem(PROFILE_CACHE_KEY);
        sessionStorage.removeItem(NOTIFICATIONS_CACHE_KEY);
        
        // Reset estado
        setProfile({
          name: 'Usuário',
          email: '',
          avatarUrl: GENERIC_AVATAR,
          role: 'Advogado',
          oab: '',
          phone: '',
          bio: '',
          lawyerFullName: '',
        });
        setNotifications([]);
        setPendingTasksCount(0);
        setModuleParams({});
        setClientPrefill(null);
        
        // Redirecionar para login
        if (activeModule !== 'login') {
          navigateTo('login');
        }
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [activeModule, navigateTo]);

  // Detectar quando usuário perde autenticação e limpar estado
  useEffect(() => {
    if (!user && !loading) {
      // Limpar cache ao fazer logout/expiração de sessão
      sessionStorage.removeItem(PROFILE_CACHE_KEY);
      sessionStorage.removeItem(NOTIFICATIONS_CACHE_KEY);
      
      // Reset estado
      setProfile({
        name: 'Usuário',
        email: '',
        avatarUrl: GENERIC_AVATAR,
        role: 'Advogado',
        oab: '',
        phone: '',
        bio: '',
        lawyerFullName: '',
      });
      setNotifications([]);
      setPendingTasksCount(0);
      setModuleParams({});
      setClientPrefill(null);
      
      // Redirecionar para login se não estiver autenticado
      if (activeModule !== 'login') {
        navigateTo('login');
      }
    }
  }, [user, loading, activeModule, navigateTo]);

  useEffect(() => {
    if (!user) {
      setPendingTasksCount(0);
      return;
    }

    const loadPendingTasks = async () => {
      try {
        const items = await taskService.listTasks();
        setPendingTasksCount(items.filter((task) => task.status === 'pending').length);
      } catch (error) {
        console.error('Erro ao carregar tarefas pendentes:', error);
      }
    };

    loadPendingTasks();
  }, [user]);

  useEffect(() => {
    const term = clientSearchTerm.trim();

    if (term.length < 2) {
      setClientSearchResults([]);
      setClientSearchLoading(false);
      return;
    }

    setClientSearchLoading(true);
    let isActive = true;
    const handler = setTimeout(async () => {
      try {
        const results = await clientService.searchClients(term);
        if (!isActive) return;
        setClientSearchResults(results);
      } catch (error) {
        if (!isActive) return;
        console.error('Erro ao buscar clientes:', error);
        setClientSearchResults([]);
      } finally {
        if (isActive) {
          setClientSearchLoading(false);
        }
      }
    }, 350);

    return () => {
      isActive = false;
      clearTimeout(handler);
    };
  }, [clientSearchTerm]);

  useEffect(() => {
    const cacheAvailable = typeof window !== 'undefined';

    if (cacheAvailable) {
      const cachedNotifications = sessionStorage.getItem(NOTIFICATIONS_CACHE_KEY);
      if (cachedNotifications) {
        try {
          const parsed: NotificationItem[] = JSON.parse(cachedNotifications);
          setNotifications(parsed);
        } catch (error) {
          sessionStorage.removeItem(NOTIFICATIONS_CACHE_KEY);
        }
      }
    }

    const loadNotifications = async () => {
      try {
        setNotificationsLoading(true);
        const items = await notificationService.list();
        setNotifications(items);
        if (cacheAvailable) {
          sessionStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(items));
        }
      } catch (error) {
        console.error('Erro ao carregar notificações:', error);
      } finally {
        setNotificationsLoading(false);
      }
    };

    loadNotifications();
  }, []);

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationService.markAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch (error) {
      console.error('Erro ao marcar notificação como lida:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (error) {
      console.error('Erro ao marcar todas como lidas:', error);
    }
  };

  const handleClearAll = async () => {
    try {
      await notificationService.clear();
      setNotifications([]);
    } catch (error) {
      console.error('Erro ao limpar notificações:', error);
    }
  };

  const handleNavigateToModule = (moduleKey: string, params?: Record<string, string>) => {
    navigateTo(moduleKey as any, params);
  };

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

    // Guardar referência do lead para remover apenas quando cliente for salvo
    setLeadToConvert(lead);
    setClientPrefill(prefill);
    navigateTo('clientes');
  };

  const handleClientSaved = async () => {
    // Remover lead do pipeline após cliente ser salvo com sucesso
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
    // Limpar dados sem remover o lead
    setLeadToConvert(null);
    setClientPrefill(null);
  };

  const handleClientSearchSelect = (clientId: string) => {
    setClientSearchOpen(false);
    navigateTo('clientes', { mode: 'details', entityId: clientId });
  };

  const handleClientSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (clientSearchResults.length > 0) {
        handleClientSearchSelect(clientSearchResults[0].id);
      }
    }

    if (event.key === 'Escape') {
      setClientSearchOpen(false);
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
    setIsProfileModalOpen(true);
  };

  const closeProfileModal = () => {
    setIsProfileModalOpen(false);
  };

  const handleProfileUpdate = (updatedProfile: any) => {
    setProfile(updatedProfile);
    setProfileBanner('Perfil atualizado com sucesso!');
    setTimeout(() => setProfileBanner(null), 3000);
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

  if (!user) {
    return <Login onLogin={signIn} onResetPassword={resetPassword} />;
  }

  return (
    <CacheProvider>
      <div className="min-h-screen bg-gray-100">
        {/* Aviso de sessão */}
        <SessionWarning />
      {/* Novo Sidebar - Estilo Compacto Vertical */}
      {isMobileNavOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setIsMobileNavOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 bg-slate-900 text-white transition-transform duration-300 z-50 flex flex-col w-20 ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-center py-5 border-b border-slate-800">
            <div className="bg-amber-600 p-2 rounded-xl">
              <img src="/icon-192.png" alt="Advogado Web" className="w-10 h-10 object-contain" />
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-2 flex flex-col items-stretch gap-1 overflow-y-auto scrollbar-hide">
            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('dashboard');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 bg-amber-600 text-white border-amber-400 shadow-lg`}
            >
              <Layers className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Dashboard</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('leads');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'leads'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Target className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Leads</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('clientes');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'clientes'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Users className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Clientes</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('documentos');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'documentos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Library className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Documentos</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('processos');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'processos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Scale className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Processos</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('requerimentos');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'requerimentos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Briefcase className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Requerimentos</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('prazos');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'prazos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <AlarmClock className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Prazos</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('intimacoes');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'intimacoes'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Bell className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Intimações</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('financeiro');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'financeiro'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <PiggyBank className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Financeiro</span>
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
                navigateTo('agenda');
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'agenda'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Calendar className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Agenda</span>
            </button>
          </nav>

          {/* Indicador de mais itens */}
          <div className="flex items-center justify-center py-1 border-t border-slate-800/50">
            <div className="text-slate-500 text-xs">⋮</div>
          </div>

          {/* Configurações */}
          <div className="border-t border-slate-800 py-2">
            <button
              onClick={() => setIsProfileModalOpen(true)}
              className="flex flex-col items-center justify-center py-3 px-2 w-full transition-all hover:bg-slate-800"
            >
              <UserCog className="w-6 h-6 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Perfil</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="md:ml-20 ml-0 transition-all duration-300">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
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
                    {activeModule === 'leads' && 'Pipeline de Leads'}
                    {activeModule === 'clientes' && 'Gestão de Clientes'}
                    {activeModule === 'processos' && 'Gestão de Processos'}
                    {activeModule === 'requerimentos' && 'Sistema de Requerimentos'}
                    {activeModule === 'prazos' && 'Gestão de Prazos'}
                    {activeModule === 'intimacoes' && 'Diário de Justiça Eletrônico'}
                    {activeModule === 'financeiro' && 'Gestão Financeira'}
                    {activeModule === 'agenda' && 'Agenda'}
                    {activeModule === 'tarefas' && 'Tarefas'}
                    {activeModule === 'documentos' && 'Documentos'}
                  </h2>
                  <p className="hidden md:block text-xs sm:text-sm text-slate-600 mt-1 truncate">
                    {activeModule === 'dashboard' && 'Visão geral do escritório e atividades recentes'}
                    {activeModule === 'leads' && 'Gerencie leads e converta em clientes'}
                    {activeModule === 'clientes' && 'Gerencie todos os seus clientes e informações'}
                    {activeModule === 'processos' && 'Acompanhe processos e andamentos'}
                    {activeModule === 'requerimentos' && 'Gerencie requerimentos administrativos do INSS'}
                    {activeModule === 'prazos' && 'Controle compromissos e prazos vinculados aos seus casos'}
                    {activeModule === 'intimacoes' && 'Consulte comunicações processuais do DJEN'}
                    {activeModule === 'financeiro' && 'Acompanhe acordos, parcelas e honorários do escritório'}
                    {activeModule === 'agenda' && 'Organize compromissos e prazos'}
                    {activeModule === 'tarefas' && 'Gerencie suas tarefas e lembretes'}
                    {activeModule === 'documentos' && 'Crie modelos e gere documentos personalizados'}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-3 flex-shrink-0">
                <div className="hidden lg:block relative w-48 xl:w-64">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={clientSearchTerm}
                    onChange={(event) => setClientSearchTerm(event.target.value)}
                    onFocus={() => setClientSearchOpen(true)}
                    onKeyDown={handleClientSearchKeyDown}
                    placeholder="Buscar clientes..."
                    className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                  {(clientSearchOpen && (clientSearchLoading || clientSearchResults.length > 0 || clientSearchTerm.trim().length >= 2)) && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40 max-h-72 overflow-y-auto text-sm">
                      {clientSearchLoading && (
                        <div className="px-3 py-2 text-slate-500">Buscando...</div>
                      )}
                      {!clientSearchLoading && clientSearchResults.length === 0 && clientSearchTerm.trim().length >= 2 && (
                        <>
                          <div className="px-3 py-2 text-slate-400 border-b border-slate-100">
                            Nenhum cliente encontrado para "{clientSearchTerm}"
                          </div>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setClientSearchOpen(false);
                              setClientFormPrefill({ full_name: clientSearchTerm });
                              setIsClientFormModalOpen(true);
                              setClientSearchTerm('');
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 transition border-t border-slate-100 flex items-center gap-2 text-emerald-600 font-medium"
                          >
                            <span className="text-lg">+</span>
                            <div>
                              <p className="text-sm font-semibold">Adicionar Novo Cliente</p>
                              <p className="text-xs text-slate-500">Criar cadastro para "{clientSearchTerm}"</p>
                            </div>
                          </button>
                        </>
                      )}
                      {!clientSearchLoading && clientSearchResults.map((client) => {
                        const primaryPhone = client.phone || client.mobile || '';
                        return (
                          <button
                            key={client.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleClientSearchSelect(client.id)}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 transition"
                          >
                            <p className="text-sm font-semibold text-slate-900 truncate">{client.full_name}</p>
                            <p className="text-xs text-slate-500 truncate">{client.email || primaryPhone || 'Sem contato cadastrado'}</p>
                          </button>
                        );
                      })}
                      {!clientSearchLoading && clientSearchResults.length > 0 && (
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setClientSearchOpen(false);
                            setClientFormPrefill(null);
                            setIsClientFormModalOpen(true);
                            setClientSearchTerm('');
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition border-t border-slate-100 flex items-center gap-2 text-emerald-600 font-medium"
                        >
                          <span className="text-lg">+</span>
                          <span className="text-sm font-semibold">Adicionar Novo Cliente</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
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
                  {pendingTasksCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] sm:min-w-[1.25rem] rounded-full bg-emerald-500 px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs font-semibold text-white text-center leading-none">
                      {pendingTasksCount > 99 ? '99+' : pendingTasksCount}
                    </span>
                  )}
                </button>
                <NotificationCenter 
                  onNavigateToModule={(moduleKey, params) => {
                    navigateTo(moduleKey as any, params);
                  }}
                />
                
                <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-gray-200">
                  <div className="hidden lg:block text-right">
                    <p className="text-sm font-semibold text-slate-900 truncate max-w-[150px]">{profile.name}</p>
                    <p className="text-xs text-slate-600">{profile.role}</p>
                  </div>
                  <div className="relative group">
                    <button
                      onClick={openProfileModal}
                      className="focus:outline-none"
                      title="Meu Perfil"
                    >
                      <div className="relative w-9 h-9 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full overflow-hidden border-2 border-amber-500 shadow-md">
                        <img src={profile.avatarUrl || GENERIC_AVATAR} alt={profile.name} className="w-full h-full object-cover" />
                      </div>
                    </button>
                    <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-2 opacity-0 translate-y-2 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all z-50">
                      <button
                        onClick={openProfileModal}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-amber-50"
                      >
                        <UserCog className="w-4 h-4 text-amber-600" />
                        Meu Perfil
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => signOut()}
                    className="p-1.5 sm:p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
        <main className={`px-3 sm:px-4 lg:px-6 xl:px-8 space-y-4 sm:space-y-6 ${activeModule === 'agenda' ? 'py-0' : 'py-4 sm:py-6'}`}>
          {/* Banner de Permissão de Notificações */}
          <NotificationPermissionBanner />
          
          {profileBanner && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex justify-between items-center">
              <span>{profileBanner}</span>
              <button onClick={() => setProfileBanner(null)} className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold uppercase">
                Fechar
              </button>
            </div>
          )}

          {profileError && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
              {profileError}
            </div>
          )}

          {/* Renderização condicional baseada no módulo ativo com Lazy Loading */}
          <Suspense fallback={
            <div className="flex h-96 items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-12 h-12 text-amber-600 animate-spin mx-auto mb-4" />
                <p className="text-slate-600">Carregando módulo...</p>
              </div>
            </div>
          }>
            {activeModule === 'dashboard' && <Dashboard onNavigateToModule={handleNavigateToModule} />}
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
            {activeModule === 'documentos' && <DocumentsModule />}
            {activeModule === 'processos' && (
              <ProcessesModule 
                forceCreate={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).mode === 'create' : false}
                entityId={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).entityId : undefined}
                prefillData={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).prefill : undefined}
                onParamConsumed={() => clearModuleParams('processos')}
              />
            )}
            {activeModule === 'requerimentos' && (
              <RequirementsModule 
                forceCreate={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).mode === 'create' : false}
                entityId={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).entityId : undefined}
                prefillData={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).prefill : undefined}
                onParamConsumed={() => clearModuleParams('requerimentos')}
              />
            )}
            {activeModule === 'prazos' && (
              <DeadlinesModule 
                forceCreate={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).mode === 'create' : false}
                entityId={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).entityId : undefined}
                prefillData={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).prefill : undefined}
                onParamConsumed={() => clearModuleParams('prazos')}
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
                onNavigateToModule={({ module, entityId }) => {
                  if (entityId) {
                    navigateTo(module as any, { entityId });
                  } else {
                    navigateTo(module as any);
                  }
                }}
                forceCreate={moduleParams['calendar'] ? JSON.parse(moduleParams['calendar']).mode === 'create' : false}
                prefillData={moduleParams['calendar'] ? JSON.parse(moduleParams['calendar']).prefill : undefined}
                onParamConsumed={() => clearModuleParams('calendar')}
              />
            )}
            {activeModule === 'tarefas' && (
              <TasksModule 
                focusNewTask={moduleParams['tasks'] ? JSON.parse(moduleParams['tasks']).mode === 'create' : false}
                onParamConsumed={() => clearModuleParams('tasks')}
                onPendingTasksChange={setPendingTasksCount}
              />
            )}
            {activeModule === 'notificacoes' && <NotificationsModuleNew onNavigateToModule={handleNavigateToModule} />}
            {activeModule === 'financeiro' && <FinancialModule />}
            {activeModule === 'cron' && <CronEndpoint />}
          </Suspense>
        </main>

        {/* Profile Modal */}
        <ProfileModal 
          isOpen={isProfileModalOpen}
          onClose={closeProfileModal}
          profile={profile}
          onProfileUpdate={handleProfileUpdate}
        />

        {/* Client Form Modal */}
        <ClientFormModal
          isOpen={isClientFormModalOpen}
          onClose={() => {
            setIsClientFormModalOpen(false);
            setClientFormPrefill(null);
          }}
          onClientCreated={(clientId, clientName) => {
            console.log('✅ Cliente criado:', clientId, clientName);
            // Apenas fecha o modal, permanece na mesma tela
            setIsClientFormModalOpen(false);
            setClientFormPrefill(null);
          }}
          prefillData={clientFormPrefill || undefined}
        />
      </div>
      </div>
    </CacheProvider>
  );
}

export default App;
