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
  X,
} from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalConfig } from '../contexts/PortalConfigContext';
import { ClientAvatar } from './ClientAvatar';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import type { PortalNavItem } from '../types/portal.types';

const NAV_ITEMS: PortalNavItem[] = [
  { id: 'dashboard',     label: 'Início',        icon: LayoutDashboard },
  { id: 'casos',         label: 'Meus casos',    icon: Briefcase       },
  { id: 'documentos',   label: 'Documentos',     icon: FolderOpen      },
  { id: 'assinar',      label: 'Assinaturas',    icon: PenTool         },
  { id: 'financeiro',   label: 'Financeiro',     icon: PiggyBank       },
  { id: 'agenda',       label: 'Agenda',         icon: Calendar        },
  { id: 'mensagens',    label: 'Mensagens',      icon: MessageCircle   },
  { id: 'notificacoes', label: 'Notificações',   icon: Bell            },
  { id: 'perfil',       label: 'Meu perfil',     icon: User            },
];

interface PortalSidebarProps { isOpen?: boolean; onClose?: () => void; }

export const PortalSidebar: React.FC<PortalSidebarProps> = ({ isOpen = true, onClose }) => {
  const { route, navigate } = usePortalRouter();
  const { session, logout } = useClientAuth();
  const { isEnabled } = usePortalConfig();

  const { unreadCount } = usePortalNotifications();
  const visible = NAV_ITEMS.filter((item) => item.id === 'dashboard' || isEnabled(item.id as any));
  const clientName = session?.client?.nome || 'Cliente';
  const clientSub  = session?.client?.email || session?.client?.telefone || 'Portal do cliente';

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col bg-white border-r border-slate-100 transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>

        {/* Header */}
        <div className="flex h-16 shrink-0 items-center justify-between px-6 border-b border-slate-100">
          <button onClick={() => navigate('dashboard')} className="flex items-center gap-2.5" aria-label="Início">
            <span className="text-[18px] font-black tracking-tight text-slate-900">JURIUS</span>
            <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white">
              Portal
            </span>
          </button>
          <button onClick={onClose} className="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition" aria-label="Fechar menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Perfil */}
        <button
          onClick={() => { navigate('perfil'); onClose?.(); }}
          className="group mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 px-3.5 py-3 text-left transition hover:from-orange-100 hover:to-amber-100"
        >
          <ClientAvatar size={36} rounded="full" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-bold text-slate-800">{clientName}</p>
            <p className="truncate text-[10.5px] text-slate-400 mt-0.5">{clientSub}</p>
          </div>
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-2">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { navigate(item.id); onClose?.(); }}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all mb-0.5 ${
                  active
                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-200/60'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                <Icon className={`h-[15px] w-[15px] shrink-0 transition-all ${
                  active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'
                }`} />
                <span className="flex-1 text-left leading-none">{item.label}</span>
                {item.id === 'notificacoes' && unreadCount > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                    active ? 'bg-white/30 text-white' : 'bg-orange-500 text-white'
                  }`}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                {item.badge && item.id !== 'notificacoes' && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                    active ? 'bg-white/25 text-white' : 'bg-rose-500 text-white'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Rodapé */}
        <div className="shrink-0 mx-3 mb-4 mt-1">
          <div className="h-px bg-slate-100 mb-3" />
          <button
            onClick={logout}
            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
          >
            <LogOut className="h-[15px] w-[15px] shrink-0 group-hover:text-rose-500 transition" />
            Sair da conta
          </button>
          <p className="mt-2 px-3 text-[10px] text-slate-300">© {new Date().getFullYear()} Jurius</p>
        </div>
      </aside>
    </>
  );
};
