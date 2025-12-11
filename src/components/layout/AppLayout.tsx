import React, { useState } from 'react';
import {
  Scale,
  Users,
  Calendar,
  X,
  Bell,
  LogOut,
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
} from 'lucide-react';
import type { ModuleName } from '../../contexts/NavigationContext';
import { BrandLogo } from '../ui/BrandLogo';

// ============ TYPES ============
interface NavItem {
  id: ModuleName;
  label: string;
  icon: React.ReactNode;
}

interface ModuleInfo {
  title: string;
  description: string;
}

interface AppLayoutProps {
  activeModule: ModuleName;
  onNavigate: (module: ModuleName) => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  profile: {
    name: string;
    avatarUrl: string;
  };
  pendingTasksCount: number;
  children: React.ReactNode;
  // Client search props
  clientSearchTerm: string;
  onClientSearchChange: (term: string) => void;
  onClientSearchFocus: () => void;
  clientSearchOpen: boolean;
  clientSearchLoading: boolean;
  clientSearchResults: Array<{
    id: string;
    full_name: string;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
  }>;
  onClientSearchSelect: (clientId: string) => void;
  onClientSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onAddNewClient: (prefillName?: string) => void;
  // Notification center
  notificationCenter: React.ReactNode;
}

// ============ CONSTANTS ============
const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Layers className="w-5 h-5 mb-1.5" /> },
  { id: 'leads', label: 'Leads', icon: <Target className="w-5 h-5 mb-1.5" /> },
  { id: 'clientes', label: 'Clientes', icon: <Users className="w-5 h-5 mb-1.5" /> },
  { id: 'documentos', label: 'Documentos', icon: <Library className="w-5 h-5 mb-1.5" /> },
  { id: 'processos', label: 'Processos', icon: <Scale className="w-5 h-5 mb-1.5" /> },
  { id: 'requerimentos', label: 'Requerimentos', icon: <Briefcase className="w-5 h-5 mb-1.5" /> },
  { id: 'prazos', label: 'Prazos', icon: <AlarmClock className="w-5 h-5 mb-1.5" /> },
  { id: 'intimacoes', label: 'Intimações', icon: <Bell className="w-5 h-5 mb-1.5" /> },
  { id: 'financeiro', label: 'Financeiro', icon: <PiggyBank className="w-5 h-5 mb-1.5" /> },
  { id: 'agenda', label: 'Agenda', icon: <Calendar className="w-5 h-5 mb-1.5" /> },
];

const moduleLabels: Record<string, ModuleInfo> = {
  dashboard: { title: 'Dashboard', description: 'Visão geral do escritório e atividades recentes' },
  leads: { title: 'Pipeline de Leads', description: 'Gerencie leads e converta em clientes' },
  clientes: { title: 'Gestão de Clientes', description: 'Gerencie todos os seus clientes e informações' },
  documentos: { title: 'Documentos', description: 'Crie modelos e gere documentos personalizados' },
  processos: { title: 'Gestão de Processos', description: 'Acompanhe processos e andamentos' },
  requerimentos: { title: 'Sistema de Requerimentos', description: 'Gerencie requerimentos administrativos do INSS' },
  prazos: { title: 'Gestão de Prazos', description: 'Controle compromissos e prazos vinculados aos seus casos' },
  intimacoes: { title: 'Diário de Justiça Eletrônico', description: 'Consulte comunicações processuais do DJEN' },
  financeiro: { title: 'Gestão Financeira', description: 'Acompanhe acordos, parcelas e honorários do escritório' },
  agenda: { title: 'Agenda', description: 'Organize compromissos e prazos' },
  tarefas: { title: 'Tarefas', description: 'Gerencie suas tarefas e lembretes' },
};

// ============ SUB-COMPONENTS ============
const NavButton: React.FC<{
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}> = ({ item, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
      isActive
        ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
        : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
    }`}
  >
    {item.icon}
    <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
  </button>
);

// ============ MAIN COMPONENT ============
export const AppLayout: React.FC<AppLayoutProps> = ({
  activeModule,
  onNavigate,
  onOpenProfile,
  onSignOut,
  profile,
  pendingTasksCount,
  children,
  clientSearchTerm,
  onClientSearchChange,
  onClientSearchFocus,
  clientSearchOpen,
  clientSearchLoading,
  clientSearchResults,
  onClientSearchSelect,
  onClientSearchKeyDown,
  onAddNewClient,
  notificationCenter,
}) => {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const handleNavigate = (module: ModuleName) => {
    setIsMobileNavOpen(false);
    onNavigate(module);
  };

  const moduleInfo = moduleLabels[activeModule] || { title: '', description: '' };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile Backdrop */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 bg-slate-900 text-white transition-transform duration-300 z-50 flex flex-col w-20 ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-center py-5 border-b border-slate-800">
            <BrandLogo size="md" showTagline={false} className="justify-center" wordmarkClassName="hidden" />
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-2 flex flex-col items-stretch gap-1 overflow-y-auto scrollbar-hide">
            {navItems.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                isActive={activeModule === item.id}
                onClick={() => handleNavigate(item.id)}
              />
            ))}
          </nav>

          {/* More indicator */}
          <div className="flex items-center justify-center py-1 border-t border-slate-800/50">
            <div className="text-slate-500 text-xs">⋮</div>
          </div>

          {/* Profile button */}
          <div className="border-t border-slate-800 py-2">
            <button
              onClick={onOpenProfile}
              className="flex flex-col items-center justify-center py-3 px-2 w-full transition-all hover:bg-slate-800 text-slate-300"
            >
              <UserCog className="w-6 h-6 mb-1.5" />
              <span className="text-[10px] font-medium text-center leading-tight">Perfil</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="md:ml-20 ml-0 transition-all duration-300">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              {/* Left - Menu toggle and title */}
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
                    {moduleInfo.title}
                  </h2>
                  {moduleInfo.description && (
                    <p className="hidden md:block text-xs sm:text-sm text-slate-600 mt-1 truncate">
                      {moduleInfo.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Right - Actions */}
              <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-3 flex-shrink-0">
                {/* Client Search */}
                <div className="hidden lg:block relative w-48 xl:w-64">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={clientSearchTerm}
                    onChange={(e) => onClientSearchChange(e.target.value)}
                    onFocus={onClientSearchFocus}
                    onKeyDown={onClientSearchKeyDown}
                    placeholder="Buscar clientes..."
                    className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                  {clientSearchOpen && (clientSearchLoading || clientSearchResults.length > 0 || clientSearchTerm.trim().length >= 2) && (
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
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onAddNewClient(clientSearchTerm)}
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
                      {!clientSearchLoading && clientSearchResults.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onClientSearchSelect(client.id)}
                          className="w-full text-left px-3 py-2 hover:bg-amber-50 transition"
                        >
                          <p className="text-sm font-semibold text-slate-900 truncate">{client.full_name}</p>
                          <p className="text-xs text-slate-500 truncate">
                            {client.email || client.phone || client.mobile || 'Sem contato cadastrado'}
                          </p>
                        </button>
                      ))}
                      {!clientSearchLoading && clientSearchResults.length > 0 && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onAddNewClient()}
                          className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition border-t border-slate-100 flex items-center gap-2 text-emerald-600 font-medium"
                        >
                          <span className="text-lg">+</span>
                          <span className="text-sm font-semibold">Adicionar Novo Cliente</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Tasks button */}
                <button
                  onClick={() => onNavigate('tarefas')}
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

                {/* Notification Center */}
                {notificationCenter}

                {/* Profile and logout */}
                <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-gray-200">
                  <div className="hidden lg:block text-right">
                    <p className="text-sm font-semibold text-slate-900 truncate max-w-[150px]">
                      {profile.name}
                    </p>
                  </div>
                  <img
                    src={profile.avatarUrl}
                    alt="Avatar"
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border-2 border-slate-200"
                  />
                  <button
                    onClick={onSignOut}
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
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
