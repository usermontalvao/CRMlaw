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
import type { PortalNavItem } from '../types/portal.types';

const NAV_ITEMS: PortalNavItem[] = [
  { id: 'dashboard',    label: 'Início',          icon: LayoutDashboard },
  { id: 'processos',   label: 'Meus processos',   icon: Briefcase       },
  { id: 'documentos',  label: 'Documentos',        icon: FolderOpen      },
  { id: 'assinar',     label: 'Assinaturas',       icon: PenTool         },
  { id: 'financeiro',  label: 'Financeiro',        icon: PiggyBank       },
  { id: 'agenda',      label: 'Agenda',            icon: Calendar        },
  { id: 'mensagens',   label: 'Mensagens',         icon: MessageCircle   },
  { id: 'notificacoes',label: 'Notificações',      icon: Bell            },
  { id: 'perfil',      label: 'Meu perfil',        icon: User            },
];

interface PortalSidebarProps { isOpen?: boolean; onClose?: () => void; }

export const PortalSidebar: React.FC<PortalSidebarProps> = ({ isOpen = true, onClose }) => {
  const { route, navigate } = usePortalRouter();
  const { session, logout } = useClientAuth();
  const { isEnabled } = usePortalConfig();

  const visible = NAV_ITEMS.filter((item) => item.id === 'dashboard' || isEnabled(item.id as any));
  const clientName = session?.client?.nome || 'Cliente';

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] lg:hidden" onClick={onClose} aria-hidden />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex h-full w-60 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${isOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'}`}>

        {/* Marca */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <button onClick={() => navigate('dashboard')} className="flex items-center gap-2.5" aria-label="Início">
            <img src="/jurius-logo.png" alt="Jurius" className="h-7 w-auto select-none" draggable={false} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Portal</span>
          </button>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 lg:hidden" aria-label="Fechar menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Perfil compacto */}
        <button
          onClick={() => { navigate('perfil'); onClose?.(); }}
          className="flex shrink-0 items-center gap-2.5 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50"
        >
          <ClientAvatar size={32} rounded="full" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-900">{clientName}</p>
            <p className="truncate text-[11px] text-slate-400">{session?.client?.email || session?.client?.telefone || 'Portal do cliente'}</p>
          </div>
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-1.5">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { navigate(item.id); onClose?.(); }}
                className={`group relative flex w-full items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition ${
                  active ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-orange-500" />}
                <Icon className={`h-4 w-4 shrink-0 transition ${active ? 'text-orange-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge ? (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Rodapé */}
        <div className="shrink-0 border-t border-slate-200 px-2 py-2">
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600">
            <LogOut className="h-4 w-4" />
            Sair da conta
          </button>
          <p className="mt-1 px-3 text-[10px] text-slate-400">© {new Date().getFullYear()} Jurius</p>
        </div>
      </aside>
    </>
  );
};
