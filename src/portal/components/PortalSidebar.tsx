/**
 * Sidebar de navegação do Portal do Cliente
 * - Desktop (lg+): fixa, largura 260px
 * - Mobile: drawer com overlay
 */
import React from 'react';
import {
  LayoutDashboard,
  Briefcase,
  FolderOpen,
  PenTool,
  PiggyBank,
  Calendar,
  MessageCircle,
  Bell,
  User,
  LogOut,
  ChevronRight,
  X,
} from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalConfig } from '../contexts/PortalConfigContext';
import { ClientAvatar } from './ClientAvatar';
import type { PortalNavItem } from '../types/portal.types';

const NAV_ITEMS: PortalNavItem[] = [
  { id: 'dashboard', label: 'Início', icon: LayoutDashboard },
  { id: 'processos', label: 'Meus Processos', icon: Briefcase },
  { id: 'documentos', label: 'Documentos', icon: FolderOpen },
  { id: 'assinar', label: 'Assinaturas', icon: PenTool },
  { id: 'financeiro', label: 'Financeiro', icon: PiggyBank },
  { id: 'agenda', label: 'Agenda', icon: Calendar },
  { id: 'mensagens', label: 'Mensagens', icon: MessageCircle },
  { id: 'notificacoes', label: 'Notificações', icon: Bell },
  { id: 'perfil', label: 'Meu Perfil', icon: User },
];

interface PortalSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const PortalSidebar: React.FC<PortalSidebarProps> = ({ isOpen = true, onClose }) => {
  const { route, navigate } = usePortalRouter();
  const { session, logout } = useClientAuth();
  const { isEnabled } = usePortalConfig();

  const visibleNavItems = NAV_ITEMS.filter((item) =>
    item.id === 'dashboard' || isEnabled(item.id as any)
  );

  const clientName = session?.client?.nome || 'Cliente';

  return (
    <>
      {/* Overlay mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-72 flex-col border-r border-slate-200/80 bg-white shadow-xl transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:translate-x-0 lg:shadow-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header / Brand */}
        <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-5">
          <button
            onClick={() => navigate('dashboard')}
            className="flex items-center gap-3 group"
            aria-label="Ir para o início"
          >
            <img
              src="/jurius-logo.png"
              alt="Jurius"
              className="h-8 w-auto select-none transition group-hover:opacity-80"
              draggable={false}
            />
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 sm:inline">
              Portal
            </span>
          </button>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* User card */}
        <div className="px-4 pt-4 pb-3">
          <button
            onClick={() => navigate('perfil')}
            className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white px-3 py-3 text-left transition hover:border-orange-200 hover:from-orange-50/40 hover:to-white"
          >
            <ClientAvatar size={40} rounded="xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{clientName}</p>
              <p className="truncate text-[11px] text-slate-500">
                {session?.client?.email || session?.client?.telefone || 'Cliente'}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  navigate(item.id);
                  onClose?.();
                }}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-gradient-to-r from-orange-50 to-amber-50 text-orange-700 shadow-sm ring-1 ring-orange-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-orange-500 to-amber-500" />
                )}
                <Icon
                  className={`h-4 w-4 shrink-0 transition ${
                    active ? 'text-orange-600' : 'text-slate-400 group-hover:text-slate-600'
                  }`}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge ? (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-200/70 px-3 py-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
          <p className="mt-2 px-3 text-[10px] text-slate-400">
            © {new Date().getFullYear()} Jurius • v1.0
          </p>
        </div>
      </aside>
    </>
  );
};
