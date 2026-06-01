import React from 'react';
import { Menu, Bell } from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';

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
        <img src="/jurius-logo.png" alt="Jurius" className="h-6 w-auto select-none" draggable={false} />
        <span className="text-slate-300">|</span>
        <span className="text-sm font-semibold text-slate-700">{ROUTE_TITLES[route] || 'Portal'}</span>
      </button>

      <button
        onClick={() => navigate('notificacoes')}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
      </button>
    </header>
  );
};
