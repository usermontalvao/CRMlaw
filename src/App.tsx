import { useEffect, useState, useMemo, lazy, Suspense, useRef } from 'react';
import { useNavigation } from './contexts/NavigationContext';
import {
  Users,
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
} from 'lucide-react';
import Login from './components/Login';
import OfflinePage from './components/OfflinePage';
import { NotificationBell } from './components/NotificationBell';
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
const DocsPage = lazy(() => import('./components/DocsPage'));
// Editor de Petições - Módulo isolado (pode ser removido sem afetar outros módulos)
const PetitionEditorModule = lazy(() => import('./components/PetitionEditorModule'));
// Widget flutuante do Editor de Petições
const PetitionEditorWidget = lazy(() => import('./components/PetitionEditorWidget'));
import { useNotifications } from './hooks/useNotifications';
import { usePresence } from './hooks/usePresence';
import { pushNotifications } from './utils/pushNotifications';
import { useAuth } from './contexts/AuthContext';
import { events, SYSTEM_EVENTS } from './utils/events';
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
import { formatCPF } from './utils/formatters';
import { usePermissions } from './hooks/usePermissions';
import type { Lead } from './types/lead.types';
import type { CreateClientDTO } from './types/client.types';
import type { NotificationItem } from './types/notification.types';

type ClientSearchResult = Awaited<ReturnType<typeof clientService.searchClients>>[number];

const MainApp: React.FC = () => {
  const { currentModule: activeModule, moduleParams, navigateTo, setModuleParams, clearModuleParams } = useNavigation();
  const { theme, toggleTheme } = useTheme();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { canView, canCreate, canEdit, canDelete, loading: permissionsLoading, isAdmin } = usePermissions();

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

  const hasAnyModulePermission = (moduleKey: string) => {
    if (isAdmin) return true;
    return (
      canView(moduleKey) ||
      canCreate(moduleKey) ||
      canEdit(moduleKey) ||
      canDelete(moduleKey)
    );
  };

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
          role: 'Auxiliar' as UserRole,
          cpf: '',
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
          role: 'Auxiliar',
          cpf: '',
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

          {!permissionsLoading && hasAnyModulePermission('leads') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('clientes') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('documentos') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('assinaturas') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('processos') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('requerimentos') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('prazos') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('intimacoes') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('financeiro') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('agenda') && (
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
          )}

          {!permissionsLoading && hasAnyModulePermission('chat') && (
            <button
              onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('chat'); }}
              className={`relative flex flex-col items-center py-2.5 px-1 rounded-lg transition-colors ${
                activeModule === 'chat' ? 'text-amber-500' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
              title="Chat"
            >
              {activeModule === 'chat' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500 rounded-r" />}
              <MessageCircle className="w-5 h-5" />
              <span className="text-[9px] mt-1">Chat</span>
            </button>
          )}

          {/* Editor de Petições - Widget flutuante (remover este bloco para desativar) */}
          {!permissionsLoading && hasAnyModulePermission('peticoes') && (
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
                    {activeModule === 'chat' && 'Chat da Equipe'}
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
                    {activeModule === 'chat' && 'Converse com a equipe em tempo real'}
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
                <NotificationBell 
                  onNavigateToModule={(moduleKey: string, params?: any) => {
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
            {activeModule === 'documentos' && (
              <DocumentsModule 
                onNavigateToModule={(moduleKey, params) => {
                  navigateTo(moduleKey as any, params);
                }}
              />
            )}
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
            {activeModule === 'chat' && <ChatModule />}
            {activeModule === 'notificacoes' && <NotificationsModuleNew onNavigateToModule={handleNavigateToModule} />}
            {activeModule === 'financeiro' && <FinancialModule />}
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
            {activeModule === 'configuracoes' && <SettingsModule />}
            {activeModule === 'cron' && <CronEndpoint />}
          </Suspense>
        </main>

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
  const isVerificationRoute = hashRoute?.includes('/verificar') || pathname?.includes('/verificar');

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
