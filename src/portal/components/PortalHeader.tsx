import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { ClientAvatar } from './ClientAvatar';
import { PortalNotificationBell } from './PortalNotificationBell';

const ROUTE_TITLES: Record<string, string> = {
  app: 'Aplicativo',
  processos: 'Processos',
  documentos: 'Documentos',
  assinar: 'Assinaturas',
  financeiro: 'Financeiro',
  agenda: 'Agenda',
  mensagens: 'Mensagens',
  notificacoes: 'Notificações',
  perfil: 'Meu Perfil',
  scanner: 'Scanner',
  casos: 'Casos',
};

export const PortalHeader: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { route, navigate } = usePortalRouter();
  const { session } = useClientAuth();
  const isDashboard = route === 'dashboard';
  const firstName = session?.client?.nome?.split(' ')[0] || 'Olá';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 lg:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex h-16 items-center justify-between bg-[#f8f7f5]/95 px-4 shadow-[0_1px_0_rgba(15,23,42,0.06)] backdrop-blur-xl">
        {isDashboard ? (
          <>
            {/* Dashboard: avatar + saudação */}
            <button
              onClick={onMenuClick}
              className="flex items-center gap-2.5 active:opacity-70 transition-opacity"
              aria-label="Abrir menu"
            >
              <ClientAvatar size={36} rounded="full" className="shrink-0 ring-2 ring-orange-200" />
              <div className="flex flex-col items-start leading-none">
                <span className="text-[11px] text-slate-400">{greeting}</span>
                <span className="mt-0.5 text-[15px] font-bold text-slate-900">{firstName}</span>
              </div>
            </button>
            <PortalNotificationBell className="shrink-0" />
          </>
        ) : (
          <>
            {/* Sub-páginas: seta de voltar + título centralizado */}
            <button
              onClick={() => navigate('dashboard')}
              className="flex h-10 w-10 items-center justify-center rounded-2xl text-slate-700 transition active:bg-slate-100"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[16px] font-bold text-slate-900">
              {ROUTE_TITLES[route] || 'Portal'}
            </span>
            <PortalNotificationBell className="shrink-0" />
          </>
        )}
      </div>
    </header>
  );
};
