import React from 'react';
import { Bell, Menu } from 'lucide-react';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import { usePortalRouter } from '../hooks/usePortalRouter';

const ROUTE_TITLES: Record<string, string> = {
  app: 'Aplicativo',
  dashboard: 'Início',
  processos: 'Processos',
  documentos: 'Documentos',
  assinar: 'Assinaturas',
  financeiro: 'Financeiro',
  agenda: 'Agenda',
  mensagens: 'Mensagens',
  notificacoes: 'Notificações',
  perfil: 'Meu perfil',
};

export const PortalHeader: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { route, navigate } = usePortalRouter();
  const { unreadCount } = usePortalNotifications();

  return (
    <header className="sticky top-0 z-20 px-3 pt-3 lg:hidden">
      <div className="flex h-14 shrink-0 items-center justify-between rounded-[20px] border border-slate-200 bg-white px-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <button onClick={() => navigate('dashboard')} className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500 text-[13px] font-extrabold text-white shadow-[0_8px_18px_rgba(249,115,22,0.2)]">
            J
          </span>
          <span className="text-sm font-bold tracking-tight text-slate-900">{ROUTE_TITLES[route] || 'Portal'}</span>
        </button>

        <button
          onClick={() => navigate('notificacoes')}
          className="relative flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100"
          aria-label="Notificações"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
