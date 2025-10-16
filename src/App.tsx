import { useEffect, useState, useMemo } from 'react';
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
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
import Dashboard from './components/Dashboard';
import ClientsModule from './components/ClientsModule';
import DocumentsModule from './components/DocumentsModule';
import LeadsModule from './components/LeadsModule';
import ProcessesModule from './components/ProcessesModule';
import IntimationsModule from './components/IntimationsModule';
import RequirementsModule from './components/RequirementsModule';
import DeadlinesModule from './components/DeadlinesModule';
import CalendarModule from './components/CalendarModule';
import TasksModule from './components/TasksModule';
import NotificationsModuleNew from './components/NotificationsModuleNew';
import FinancialModule from './components/FinancialModule';
import ProfileModal from './components/ProfileModal';
import { NotificationCenterNew as NotificationCenter } from './components/NotificationCenterNew';
import { NotificationPermissionBanner } from './components/NotificationPermissionBanner';
import { useNotifications } from './hooks/useNotifications';
import { usePresence } from './hooks/usePresence';
import { pushNotifications } from './utils/pushNotifications';
import Login from './components/Login';
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
  const navigate = useNavigate();
  const location = useLocation();
  const [moduleParams, setModuleParams] = useState<Record<string, string>>({});
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { user, loading, signIn, signOut, resetPassword } = useAuth();
  
  // Extrai o módulo ativo da URL
  const activeModule = location.pathname.split('/')[1] || 'dashboard';
  
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

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const clientsParams = useMemo(() => {
    if (!moduleParams['clients']) return null;
    try {
      return JSON.parse(moduleParams['clients']);
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
        if (location.pathname !== '/' && location.pathname !== '/login') {
          navigate('/', { replace: true });
        }
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [location.pathname, navigate]);

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
      
      // Redirecionar para raiz se estiver em uma rota protegida
      if (location.pathname !== '/' && location.pathname !== '/login') {
        navigate('/', { replace: true });
      }
    }
  }, [user, loading, location.pathname, navigate]);

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
    if (params) {
      setModuleParams(prev => ({
        ...prev,
        [moduleKey]: JSON.stringify(params)
      }));
    }
    navigate(`/${moduleKey}`);
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
    navigate('/clientes');
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
    setModuleParams((prev) => ({
      ...prev,
      clients: JSON.stringify({ mode: 'details', entityId: clientId }),
    }));
    setClientSearchOpen(false);
    navigate('/clientes');
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
        delete updated['clients'];
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
      {/* Novo Sidebar - Estilo Compacto Vertical */}
      {isMobileNavOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setIsMobileNavOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 bg-slate-900 text-white transition-transform duration-300 z-50 flex flex-col w-64 md:w-20 ${
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
            <Link
              to="/dashboard"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'dashboard'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Layers className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Dashboard</span>
            </Link>

            <Link
              to="/leads"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'leads'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Target className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Leads</span>
            </Link>

            <Link
              to="/clientes"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'clientes'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Users className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Clientes</span>
            </Link>

            <Link
              to="/documentos"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'documentos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Library className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Documentos</span>
            </Link>

            <Link
              to="/processos"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'processos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Scale className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Processos</span>
            </Link>

            <Link
              to="/requerimentos"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'requerimentos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Briefcase className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Requerimentos</span>
            </Link>

            <Link
              to="/prazos"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'prazos'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <AlarmClock className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Prazos</span>
            </Link>

            <Link
              to="/intimacoes"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'intimacoes'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Bell className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Intimações</span>
            </Link>

            <Link
              to="/financeiro"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'financeiro'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <PiggyBank className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Financeiro</span>
            </Link>

            <Link
              to="/agenda"
              onClick={() => {
                setClientPrefill(null);
                setIsMobileNavOpen(false);
              }}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
                activeModule === 'agenda'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                  : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Calendar className="w-5 h-5 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Agenda</span>
            </Link>
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
                  {(clientSearchOpen && (clientSearchLoading || clientSearchResults.length > 0)) && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-40 max-h-72 overflow-y-auto text-sm">
                      {clientSearchLoading && (
                        <div className="px-3 py-2 text-slate-500">Buscando...</div>
                      )}
                      {!clientSearchLoading && clientSearchResults.length === 0 && (
                        <div className="px-3 py-2 text-slate-400">Nenhum cliente encontrado</div>
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
                    </div>
                  )}
                </div>
                <Link
                  to="/tarefas"
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
                </Link>
                <NotificationCenter 
                  onNavigateToModule={(moduleKey, params) => {
                    if (params) {
                      setModuleParams(prev => ({
                        ...prev,
                        [moduleKey]: JSON.stringify(params),
                      }));
                    }
                    navigate(`/${moduleKey}`);
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

          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard onNavigateToModule={handleNavigateToModule} />} />
            <Route path="/leads" element={<LeadsModule onConvertLead={handleConvertLead} />} />
            <Route path="/clientes" element={
              <ClientsModule 
                prefillData={clientPrefill} 
                onClientSaved={handleClientSaved}
                onClientCancelled={handleClientCancelled}
                forceCreate={clientsForceCreate}
                focusClientId={clientsFocusClientId}
                onParamConsumed={clearClientParams}
                onNavigateToModule={(moduleKey, params) => {
                  if (params) {
                    setModuleParams(prev => ({
                      ...prev,
                      [moduleKey]: JSON.stringify(params),
                    }));
                  }
                  navigate(`/${moduleKey}`);
                }}
              />
            } />
            <Route path="/processos" element={
              <ProcessesModule 
                forceCreate={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).mode === 'create' : false}
                entityId={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).entityId : undefined}
                prefillData={moduleParams['processos'] ? JSON.parse(moduleParams['processos']).prefill : undefined}
                onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['processos']; return updated; })}
              />
            } />
            <Route path="/requerimentos" element={
              <RequirementsModule 
                forceCreate={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).mode === 'create' : false}
                entityId={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).entityId : undefined}
                prefillData={moduleParams['requerimentos'] ? JSON.parse(moduleParams['requerimentos']).prefill : undefined}
                onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['requerimentos']; return updated; })}
              />
            } />
            <Route path="/prazos" element={
              <DeadlinesModule 
                forceCreate={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).mode === 'create' : false}
                entityId={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).entityId : undefined}
                prefillData={moduleParams['prazos'] ? JSON.parse(moduleParams['prazos']).prefill : undefined}
                onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['prazos']; return updated; })}
              />
            } />
            <Route path="/intimacoes" element={
              <IntimationsModule 
                onNavigateToModule={(moduleKey, params) => {
                  if (params) {
                    setModuleParams(prev => ({
                      ...prev,
                      [moduleKey]: JSON.stringify(params),
                    }));
                  }
                  navigate(`/${moduleKey}`);
                }}
              />
            } />
            <Route path="/agenda" element={
              <CalendarModule 
                userName={profile.name}
                onNavigateToModule={({ module, entityId }) => {
                  if (entityId) {
                    setModuleParams(prev => ({
                      ...prev,
                      [module]: JSON.stringify({ entityId }),
                    }));
                  }
                  navigate(`/${module}`);
                }}
                forceCreate={moduleParams['calendar'] ? JSON.parse(moduleParams['calendar']).mode === 'create' : false}
                prefillData={moduleParams['calendar'] ? JSON.parse(moduleParams['calendar']).prefill : undefined}
                onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['calendar']; return updated; })}
              />
            } />
            <Route path="/tarefas" element={
              <TasksModule 
                focusNewTask={moduleParams['tasks'] ? JSON.parse(moduleParams['tasks']).mode === 'create' : false}
                onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['tasks']; return updated; })}
                onPendingTasksChange={setPendingTasksCount}
              />
            } />
            <Route path="/notificacoes" element={<NotificationsModuleNew onNavigateToModule={handleNavigateToModule} />} />
            <Route path="/financeiro" element={<FinancialModule />} />
            <Route path="/documentos" element={<DocumentsModule />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>

        {/* Profile Modal */}
        <ProfileModal 
          isOpen={isProfileModalOpen}
          onClose={closeProfileModal}
          profile={profile}
          onProfileUpdate={handleProfileUpdate}
        />
      </div>
      </div>
    </CacheProvider>
  );
}

export default App;
