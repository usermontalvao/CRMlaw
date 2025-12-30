import React from 'react';
import { Menu, X, Search, CheckSquare, LogOut } from 'lucide-react';
import { BrandLogo } from '../ui/BrandLogo';
import type { ModuleName } from '../../contexts/NavigationContext';

interface HeaderProps {
  activeModule: ModuleName;
  isMobileNavOpen: boolean;
  onToggleMobileNav: () => void;
  profile: {
    name: string;
    avatarUrl: string;
  };
  pendingTasksCount: number;
  onNavigateToTasks: () => void;
  onSignOut: () => void;
  children?: React.ReactNode; // Para NotificationCenter e busca
}

const moduleLabels: Record<ModuleName, { title: string; description: string }> = {
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
  assinaturas: { title: 'Assinatura Digital', description: 'Assine documentos com biometria facial e assinatura digital' },
  tarefas: { title: 'Tarefas', description: 'Gerencie suas tarefas e lembretes' },
  notificacoes: { title: 'Notificações', description: 'Veja todas as suas notificações' },
  monitor: { title: 'Monitor de Processos', description: 'Acompanhe processos em tempo real com análise inteligente' },
  login: { title: 'Login', description: '' },
  cron: { title: 'Cron', description: '' },
  configuracoes: { title: 'Configurações', description: 'Configure seu perfil e preferências' },
  peticoes: { title: 'Editor de Petições', description: 'Crie petições trabalhistas com blocos reutilizáveis' },
};

export const Header: React.FC<HeaderProps> = ({
  activeModule,
  isMobileNavOpen,
  onToggleMobileNav,
  profile,
  pendingTasksCount,
  onNavigateToTasks,
  onSignOut,
  children,
}) => {
  const moduleInfo = moduleLabels[activeModule] || { title: '', description: '' };

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Left side - Menu toggle and title */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              className="md:hidden inline-flex items-center justify-center p-2 rounded-lg text-slate-600 hover:text-white hover:bg-slate-800 transition flex-shrink-0"
              onClick={onToggleMobileNav}
              aria-label="Alternar menu"
            >
              {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="min-w-0 flex-1">
              <BrandLogo size="sm" showTagline={false} className="hidden sm:flex items-center gap-2" wordmarkClassName="text-slate-900" />
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

          {/* Right side - Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 lg:gap-3 flex-shrink-0">
            {/* Children slot for search and notifications */}
            {children}

            {/* Tasks button */}
            <button
              onClick={onNavigateToTasks}
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

            {/* Profile and logout */}
            <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-gray-200">
              <div className="hidden lg:block text-right">
                <p className="text-sm font-semibold text-slate-900 truncate max-w-[150px]">{profile.name}</p>
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
  );
};

export default Header;
