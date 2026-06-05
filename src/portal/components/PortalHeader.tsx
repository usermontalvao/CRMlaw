import React from 'react';
import { Menu } from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { PortalNotificationBell } from './PortalNotificationBell';

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
  scanner: 'Scanner',
  casos: 'Casos',
};

export const PortalHeader: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { route, navigate } = usePortalRouter();

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-slate-200/80 bg-white/96 backdrop-blur-xl lg:hidden">
      <div className="flex h-16 items-center justify-between px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <button
          onClick={onMenuClick}
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-slate-500 transition active:bg-slate-100"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <button onClick={() => navigate('dashboard')} className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500 text-[15px] font-extrabold text-white shadow-[0_10px_24px_rgba(249,115,22,0.22)]">
            J
          </span>
          <span className="truncate text-base font-bold tracking-tight text-slate-900">{ROUTE_TITLES[route] || 'Portal'}</span>
        </button>

        <PortalNotificationBell className="shrink-0" />
      </div>
    </header>
  );
};
