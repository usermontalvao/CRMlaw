import { useEffect, useState, useMemo } from 'react';
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
import NotificationsModule from './components/NotificationsModule';
import ProfileModal from './components/ProfileModal';
import { NotificationCenter } from './components/NotificationCenter';
import { NotificationPermissionBanner } from './components/NotificationPermissionBanner';
import { useNotifications } from './hooks/useNotifications';
import { pushNotifications } from './utils/pushNotifications';
import Login from './components/Login';
import { useAuth } from './contexts/AuthContext';
import { profileService } from './services/profile.service';
import { leadService } from './services/lead.service';
import { notificationService } from './services/notification.service';
import { taskService } from './services/task.service';
import { djenLocalService } from './services/djenLocal.service';
import { supabase } from './config/supabase';
import type { Lead } from './types/lead.types';
import type { CreateClientDTO } from './types/client.types';
import type { NotificationItem } from './types/notification.types';

function App() {
  const [activeModule, setActiveModule] = useState('dashboard');
  const [moduleParams, setModuleParams] = useState<Record<string, string>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { user, loading, signIn, signOut, resetPassword } = useAuth();

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

  const showSidebarLabels = sidebarOpen || isMobileNavOpen;
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

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

  const handleNavigateToModule = (moduleString: string) => {
    const [moduleKey, paramString] = moduleString.split('?');
    setActiveModule(moduleKey as any);
    
    if (paramString) {
      const params: Record<string, string> = {};
      paramString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        if (key && value) params[key] = value;
      });
      setModuleParams(prev => ({ ...prev, [moduleKey]: JSON.stringify(params) }));
    } else {
      setModuleParams(prev => {
        const updated = { ...prev };
        delete updated[moduleKey];
        return updated;
      });
    }
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
    setActiveModule('clients');
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
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar */}
      {isMobileNavOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setIsMobileNavOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 bg-slate-900 text-white transition-transform duration-300 z-50 flex flex-col w-64 ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 ${sidebarOpen ? 'md:w-64' : 'md:w-20'}`}
        onMouseEnter={() => window.innerWidth >= 768 && setSidebarOpen(true)}
        onMouseLeave={() => window.innerWidth >= 768 && setSidebarOpen(false)}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-slate-800">
            <div className="flex items-center justify-between">
              {sidebarOpen ? (
                <div className="flex items-center space-x-3">
                  <div className="bg-amber-600 p-2 rounded-lg">
                    <Scale className="w-6 h-6" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold">Advogado\Web</h1>
                    <p className="text-xs text-slate-400">Gestão Jurídica</p>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-600 p-2 rounded-lg mx-auto">
                  <Scale className="w-6 h-6" />
                </div>
              )}
              <button
                className="hidden md:inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-800 transition"
                onClick={() => setSidebarOpen((prev) => !prev)}
              >
                {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('dashboard');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'dashboard'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Layers className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Dashboard</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('leads');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'leads'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Target className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Leads</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('clients');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'clients'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Users className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Clientes</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('documents');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'documents'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Library className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Documentos</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('cases');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'cases'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Layers className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Processos</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('requirements');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'requirements'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Briefcase className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Requerimentos</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('deadlines');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'deadlines'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <AlarmClock className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Prazos</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('intimations');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'intimations'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Bell className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Intimações</span>}
            </button>

            <button
              onClick={() => {
                setClientPrefill(null);
                setActiveModule('calendar');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                activeModule === 'calendar'
                  ? 'bg-amber-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Calendar className="w-5 h-5 flex-shrink-0" />
              {showSidebarLabels && <span className="font-medium">Agenda</span>}
            </button>

          </nav>

          {/* Toggle Sidebar */}
          <div className="p-4 border-t border-slate-800">
            <div className="text-xs text-center text-slate-500">
              Passe o mouse para expandir
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div
        className={`transition-all duration-300 ${sidebarOpen ? 'md:ml-64' : 'md:ml-20'} ml-0`}
      >
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  className="md:hidden inline-flex items-center justify-center p-2 rounded-lg text-slate-600 hover:text-white hover:bg-slate-800 transition"
                  onClick={() => setIsMobileNavOpen((prev) => !prev)}
                  aria-label="Alternar menu"
                >
                  {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                    {activeModule === 'leads' && 'Pipeline de Leads'}
                    {activeModule === 'clients' && 'Gestão de Clientes'}
                    {activeModule === 'cases' && 'Gestão de Processos'}
                    {activeModule === 'requirements' && 'Sistema de Requerimentos'}
                    {activeModule === 'deadlines' && 'Gestão de Prazos'}
                    {activeModule === 'intimations' && 'Diário de Justiça Eletrônico'}
                    {activeModule === 'calendar' && 'Agenda'}
                    {activeModule === 'tasks' && 'Tarefas'}
                    {activeModule === 'documents' && 'Documentos'}
                  </h2>
                  <p className="hidden sm:block text-sm text-slate-600 mt-1">
                    {activeModule === 'leads' && 'Gerencie leads e converta em clientes'}
                    {activeModule === 'clients' && 'Gerencie todos os seus clientes e informações'}
                    {activeModule === 'cases' && 'Acompanhe processos e andamentos'}
                    {activeModule === 'requirements' && 'Gerencie requerimentos administrativos do INSS'}
                    {activeModule === 'deadlines' && 'Controle compromissos e prazos vinculados aos seus casos'}
                    {activeModule === 'intimations' && 'Consulte comunicações processuais do DJEN'}
                    {activeModule === 'calendar' && 'Organize compromissos e prazos'}
                    {activeModule === 'tasks' && 'Gerencie suas tarefas e lembretes'}
                    {activeModule === 'documents' && 'Crie modelos e gere documentos personalizados'}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setActiveModule('tasks' as any)}
                  className={`relative p-2 rounded-lg transition-colors ${
                    activeModule === 'tasks'
                      ? 'text-blue-600 bg-blue-50'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-gray-100'
                  }`}
                  title="Tarefas"
                >
                  <CheckSquare className="w-5 h-5" />
                  {pendingTasksCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[1.25rem] rounded-full bg-emerald-500 px-1.5 py-0.5 text-xs font-semibold text-white text-center">
                      {pendingTasksCount > 99 ? '99+' : pendingTasksCount}
                    </span>
                  )}
                </button>
                <NotificationCenter 
                  onNavigateToModule={(moduleKey, params) => {
                    setActiveModule(moduleKey as any);
                    if (params) {
                      setModuleParams(prev => ({
                        ...prev,
                        [moduleKey]: JSON.stringify(params),
                      }));
                    }
                  }}
                />
                
                <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
                  <div className="hidden sm:block text-right">
                    <p className="text-sm font-semibold text-slate-900">{profile.name}</p>
                    <p className="text-xs text-slate-600">{profile.role}</p>
                  </div>
                  <div className="relative group">
                    <button
                      onClick={openProfileModal}
                      className="focus:outline-none"
                      title="Meu Perfil"
                    >
                      <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-amber-500 shadow-md">
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
                    className="p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Sair"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="px-4 sm:px-6 lg:px-8 py-6 space-y-6">
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

          {activeModule === 'dashboard' && <Dashboard onNavigateToModule={handleNavigateToModule} />}
          {activeModule === 'leads' && <LeadsModule onConvertLead={handleConvertLead} />}
          {activeModule === 'clients' && (
            <ClientsModule 
              prefillData={clientPrefill} 
              onClientSaved={handleClientSaved}
              onClientCancelled={handleClientCancelled}
              forceCreate={moduleParams['clients'] ? JSON.parse(moduleParams['clients']).mode === 'create' : false}
              onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['clients']; return updated; })}
            />
          )}
          {activeModule === 'cases' && (
            <ProcessesModule 
              forceCreate={moduleParams['cases'] ? JSON.parse(moduleParams['cases']).mode === 'create' : false}
              onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['cases']; return updated; })}
            />
          )}
          {activeModule === 'requirements' && (
            <RequirementsModule 
              forceCreate={moduleParams['requirements'] ? JSON.parse(moduleParams['requirements']).mode === 'create' : false}
              onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['requirements']; return updated; })}
            />
          )}
          {activeModule === 'deadlines' && (
            <DeadlinesModule 
              forceCreate={moduleParams['deadlines'] ? JSON.parse(moduleParams['deadlines']).mode === 'create' : false}
              prefillData={moduleParams['deadlines'] ? JSON.parse(moduleParams['deadlines']).prefill : undefined}
              onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['deadlines']; return updated; })}
            />
          )}
          {activeModule === 'intimations' && (
            <IntimationsModule 
              onNavigateToModule={(moduleKey, params) => {
                setActiveModule(moduleKey);
                if (params) {
                  setModuleParams(prev => ({
                    ...prev,
                    [moduleKey]: JSON.stringify(params),
                  }));
                }
              }}
            />
          )}
          {activeModule === 'calendar' && (
            <CalendarModule 
              onNavigateToModule={({ module }) => setActiveModule(module as any)}
              forceCreate={moduleParams['calendar'] ? JSON.parse(moduleParams['calendar']).mode === 'create' : false}
              prefillData={moduleParams['calendar'] ? JSON.parse(moduleParams['calendar']).prefill : undefined}
              onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['calendar']; return updated; })}
            />
          )}
          {activeModule === 'tasks' && (
            <TasksModule 
              focusNewTask={moduleParams['tasks'] ? JSON.parse(moduleParams['tasks']).mode === 'create' : false}
              onParamConsumed={() => setModuleParams(prev => { const updated = {...prev}; delete updated['tasks']; return updated; })}
              onPendingTasksChange={setPendingTasksCount}
            />
          )}
          {activeModule === 'notifications' && (
            <NotificationsModule
              onNavigateToModule={(moduleKey, params) => {
                setActiveModule(moduleKey as any);
                if (params) {
                  setModuleParams(prev => ({
                    ...prev,
                    [moduleKey]: JSON.stringify(params),
                  }));
                }
              }}
            />
          )}
          {activeModule === 'documents' && <DocumentsModule />}
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
  );
}

export default App;
