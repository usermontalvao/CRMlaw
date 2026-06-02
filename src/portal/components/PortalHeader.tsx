import React from 'react';
import { Menu, Bell } from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';

const ROUTE_TITLES: Record<string, string> = {
  dashboard:    'Início',
  processos:    'Processos',
  documentos:   'Documentos',
  assinar:      'Assinaturas',
  financeiro:   'Financeiro',
  agenda:       'Agenda',
  mensagens:    'Mensagens',
  notificacoes: 'Notificações',
  perfil:       'Meu perfil',
};

export const PortalHeader: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { route, navigate } = usePortalRouter();
  const { unreadCount } = usePortalNotifications();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 lg:hidden">
      <button
        onClick={onMenuClick}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button onClick={() => navigate('dashboard')} className="flex items-center gap-2">
        <span className="text-[15px] font-black tracking-tight text-slate-900">JURIUS</span>
        <span className="text-slate-300">|</span>
        <span className="text-sm font-semibold text-slate-700">{ROUTE_TITLES[route] || 'Portal'}</span>
      </button>

      <button
        onClick={() => navigate('notificacoes')}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </header>
  );
};
