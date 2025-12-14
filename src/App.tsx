import { BrandLogo } from './components/ui/BrandLogo';
import { useEffect, useState, useMemo, lazy, Suspense, useRef } from 'react';
import { useNavigation } from './contexts/NavigationContext';
import {
  LucideIcon,
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
  Activity,
  Settings,
  Moon,
  Scale,
  Sun,
  UploadCloud,
  User,
  PenTool,
} from 'lucide-react';
import Login from './components/Login';
import OfflinePage from './components/OfflinePage';
import AppLayout from './components/layout/AppLayout';
import Header from './components/layout/Header';
import { NotificationCenterNew as NotificationCenter } from './components/NotificationCenterNew';
import SessionWarning from './components/SessionWarning';
import TermsPrivacyPage from './components/TermsPrivacyPage';
import ProfileModal, { type AppProfile, type UserRole } from './components/ProfileModal';

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
const SignatureModule = lazy(() => import('./components/SignatureModule'));
const SettingsModule = lazy(() => import('./components/SettingsModule'));
const CronEndpoint = lazy(() => import('./components/CronEndpoint'));
const PublicSigningPage = lazy(() => import('./components/PublicSigningPage'));
const PublicVerificationPage = lazy(() => import('./components/PublicVerificationPage'));
import { useNotifications } from './hooks/useNotifications';
import { usePresence } from './hooks/usePresence';
import { pushNotifications } from './utils/pushNotifications';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
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

const MainApp: React.FC = () => {
  const { currentModule: activeModule, moduleParams, navigateTo, setModuleParams, clearModuleParams } = useNavigation();
  const { theme, toggleTheme } = useTheme();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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
  
  // Ativar sincronização automática com DJEN
  useDjenSync();
  
  // Ativar sistema de presença
  usePresence();

  const GENERIC_AVATAR = 'https://www.gravatar.com/avatar/?d=mp&s=300';

  const [profile, setProfile] = useState<AppProfile>({
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const logoutCleanupDoneRef = useRef(false);

  const canAccessConfig = ['admin', 'administrador', 'advogado'].includes(
    (profile.role || '').toLowerCase(),
  );

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

  const [leadToConvert, setLeadToConvert] = useState<Lead | null>(null);
  const [pendingTasksCount, setPendingTasksCount] = useState(0);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<ClientSearchResult[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  // const [isClientFormModalOpen, setIsClientFormModalOpen] = useState(false);
  // const [clientFormPrefill, setClientFormPrefill] = useState<Partial<CreateClientDTO> | null>(null);
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
              role: (data.role as UserRole) || 'Advogado',
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
              role: 'Advogado' as UserRole,
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
      // Apenas logar eventos importantes
      if (event === 'SIGNED_OUT') {
        console.log('🔒 Logout detectado');
        // Limpar cache
        sessionStorage.removeItem(PROFILE_CACHE_KEY);
        sessionStorage.removeItem(NOTIFICATIONS_CACHE_KEY);
        
        // Reset estado
        setProfile({
          name: 'Usuário',
          email: '',
          avatarUrl: GENERIC_AVATAR,
          role: 'Advogado' as UserRole,
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
      if (!logoutCleanupDoneRef.current) {
        logoutCleanupDoneRef.current = true;

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

  const [loggingIn, setLoggingIn] = useState(false);

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
          <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-slate-950">
            {/* Animated gradient background */}
            <div className="absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(251,146,60,0.15)_0%,transparent_70%)]" />
              <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/20 rounded-full blur-[120px] animate-pulse" />
              <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-amber-500/15 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-600/10 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '0.5s' }} />
            </div>

            {/* Floating particles */}
            <div className="absolute inset-0 overflow-hidden">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute w-1 h-1 bg-orange-400/60 rounded-full animate-float-particle"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 5}s`,
                    animationDuration: `${3 + Math.random() * 4}s`,
                  }}
                />
              ))}
            </div>

            {/* Main content */}
            <div className="relative z-10 flex flex-col items-center">
              {/* Glowing logo container */}
              <div className="relative mb-8">
                {/* Outer glow rings */}
                <div className="absolute inset-[-40px] rounded-full border border-orange-500/20 animate-ping-slow" />
                <div className="absolute inset-[-25px] rounded-full border border-orange-400/30 animate-ping-slower" />
                <div className="absolute inset-[-60px] rounded-full bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-orange-500/10 blur-2xl animate-pulse" />
                
                {/* Logo */}
                <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500 via-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-orange-500/50">
                  <span className="text-white font-black text-4xl tracking-tight">J</span>
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-white/0 to-white/20" />
                </div>
              </div>

              {/* Brand name with glow */}
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
                  jurius<span className="text-orange-400">.com.br</span>
                </h1>
                <p className="text-sm text-white/50 tracking-[0.3em] uppercase">
                  Gestão Jurídica Inteligente
                </p>
              </div>

              {/* Animated loading bar */}
              <div className="w-64 mb-6">
                <div className="h-1 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                  <div className="h-full bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500 rounded-full animate-loading-bar" />
                </div>
              </div>

              {/* Status text */}
              <div className="text-center">
                <p className="text-lg font-medium text-white/90 mb-1">
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
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
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
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('leads'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'leads' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'leads' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Target className="w-5 h-5" />
            <span className="text-[9px] mt-1">Leads</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('clientes'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'clientes' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'clientes' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Users className="w-5 h-5" />
            <span className="text-[9px] mt-1">Clientes</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('documentos'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'documentos' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'documentos' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Library className="w-5 h-5" />
            <span className="text-[9px] mt-1">Documentos</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('processos'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'processos' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'processos' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Scale className="w-5 h-5" />
            <span className="text-[9px] mt-1">Processos</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('requerimentos'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'requerimentos' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'requerimentos' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Briefcase className="w-5 h-5" />
            <span className="text-[9px] mt-1">Requerimentos</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('prazos'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'prazos' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'prazos' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <AlarmClock className="w-5 h-5" />
            <span className="text-[9px] mt-1">Prazos</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('intimacoes'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'intimacoes' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'intimacoes' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Bell className="w-5 h-5" />
            <span className="text-[9px] mt-1">Intimações</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('financeiro'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'financeiro' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'financeiro' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <PiggyBank className="w-5 h-5" />
            <span className="text-[9px] mt-1">Financeiro</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('agenda'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'agenda' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'agenda' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <Calendar className="w-5 h-5" />
            <span className="text-[9px] mt-1">Agenda</span>
          </button>

          <button
            onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('assinaturas'); }}
            className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
              activeModule === 'assinaturas' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {activeModule === 'assinaturas' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
            <PenTool className="w-5 h-5" />
            <span className="text-[9px] mt-1">Assinaturas</span>
          </button>

          <div className="my-2 mx-2 h-px bg-slate-800" />

          <button
            onClick={() => { setIsMobileNavOpen(false); setIsProfileModalOpen(true); }}
            className="flex flex-col items-center py-2.5 px-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
          >
            <UserCog className="w-5 h-5" />
            <span className="text-[9px] mt-1">Perfil</span>
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="md:ml-20 ml-0 transition-all duration-300">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30 transition-colors duration-300">
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
                    {activeModule === 'assinaturas' && 'Assinatura Digital'}
                    {activeModule === 'configuracoes' && 'Configurações'}
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
                    {activeModule === 'assinaturas' && 'Assine documentos com biometria facial e assinatura digital'}
                    {activeModule === 'configuracoes' && 'Gerencie usuários, permissões e preferências do sistema'}
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
                              setClientPrefill({ full_name: clientSearchTerm.trim() });
                              setClientSearchOpen(false);
                              setClientSearchTerm('');
                              navigateTo('clientes');
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
                            setClientPrefill({ full_name: clientSearchTerm.trim() });
                            setClientSearchOpen(false);
                            setClientSearchTerm('');
                            navigateTo('clientes');
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
        <main className={`px-3 sm:px-4 lg:px-6 xl:px-8 space-y-4 sm:space-y-6 ${activeModule === 'agenda' ? 'py-0' : 'py-4 sm:py-6'}`}>
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
            {activeModule === 'assinaturas' && <SignatureModule />}
            {activeModule === 'configuracoes' && <SettingsModule />}
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

        {/* ClientFormModal removido para evitar overlay duplicado; usar fluxo do módulo Clientes */}
      </div>
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

  const isTermsRoute = hashRoute?.includes('/terms');
  const isPrivacyRoute = hashRoute?.includes('/privacidade') || hashRoute?.includes('/privacy');
  const isCronRoute = hashRoute?.includes('/cron/djen');
  const isSigningRoute = hashRoute?.includes('/assinar/');
  const isVerificationRoute = hashRoute?.includes('/verificar');

  if (isTermsRoute) {
    return <TermsPrivacyPage type="terms" />;
  }

  if (isPrivacyRoute) {
    return <TermsPrivacyPage type="privacy" />;
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

  if (isSigningRoute) {
    const token = hashRoute.split('/assinar/')[1]?.split('?')[0]?.split('#')[0];
    if (token) {
      return (
        <Suspense fallback={<div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>}>
          <PublicSigningPage token={token} />
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

  return <MainApp />;
};

export default App;
