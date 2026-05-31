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
  perfil:       'Meu Perfil',
};

export const PortalHeader: React.FC<{ onMenuClick: () => void }> = ({ onMenuClick }) => {
  const { route, navigate } = usePortalRouter();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/90 px-3 backdrop-blur-md lg:hidden">
      <button
        onClick={onMenuClick}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition active:bg-slate-100"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Marca central */}
      <button
        onClick={() => navigate('dashboard')}
        className="flex items-center gap-2"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 shadow-sm">
          <span className="text-sm font-black text-white" style={{ fontFamily: 'Arial, sans-serif' }}>J</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-black tracking-tight text-slate-900">JURIUS</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-semibold text-slate-600">{ROUTE_TITLES[route] || 'Portal'}</span>
        </div>
      </button>

      <button
        onClick={() => navigate('notificacoes')}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition active:bg-slate-100"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
      </button>
    </header>
  );
};
