import React from 'react';
import {
  Briefcase,
  Calendar,
  ChevronRight,
  ScanLine,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  PenTool,
  PiggyBank,
  X,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalConfig } from '../contexts/PortalConfigContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePortalRouter } from '../hooks/usePortalRouter';
import type { PortalNavItem } from '../types/portal.types';
import { ClientAvatar } from './ClientAvatar';

const NAV_ITEMS: PortalNavItem[] = [
  { id: 'dashboard', label: 'Início', icon: LayoutDashboard },
  { id: 'casos', label: 'Meus casos', icon: Briefcase },
  { id: 'scanner', label: 'Scanner', icon: ScanLine },
  { id: 'documentos', label: 'Documentos', icon: FolderOpen },
  { id: 'assinar', label: 'Assinaturas', icon: PenTool },
  { id: 'financeiro', label: 'Financeiro', icon: PiggyBank },
  { id: 'agenda', label: 'Agenda', icon: Calendar },
  { id: 'mensagens', label: 'Mensagens', icon: MessageCircle },
];

interface PortalSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const PortalSidebar: React.FC<PortalSidebarProps> = ({ isOpen = true, onClose }) => {
  const { route, navigate } = usePortalRouter();
  const { session, logout } = useClientAuth();
  const { isEnabled, customization } = usePortalConfig();
  const isMobile = useIsMobile();
  const accentColor = customization.accent_color || '#ff8a00';

  const visible = NAV_ITEMS.filter((item) => {
    if (item.id === 'scanner' && !isMobile) return false;
    return item.id === 'dashboard' || isEnabled(item.id as never);
  });
  const clientName = session?.client?.nome || 'Cliente';
  const clientSub = session?.client?.email || session?.client?.telefone || 'Portal do cliente';

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-[286px] flex-col border-r border-slate-200 bg-white text-slate-900 shadow-[0_18px_42px_rgba(15,23,42,0.08)] transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex h-20 shrink-0 items-center justify-between border-b border-slate-200 px-6">
          <button onClick={() => navigate('dashboard')} className="flex items-center gap-3" aria-label="Início">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-base font-extrabold text-white"
              style={{ backgroundColor: accentColor, boxShadow: `0 12px 24px ${accentColor}3d` }}
            >
              J
            </span>
            <span className="flex flex-col items-start leading-none">
              <span className="text-[17px] font-extrabold tracking-tight text-slate-900">Jurius</span>
              <span
                className="mt-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.24em]"
                style={{ borderColor: accentColor + '33', backgroundColor: accentColor + '10', color: accentColor }}
              >
                Portal do Cliente
              </span>
            </span>
          </button>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-[#f8f7f5] text-slate-500 transition hover:bg-slate-50 lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <button
          onClick={() => {
            navigate('perfil');
            onClose?.();
          }}
          className="group mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-slate-200 bg-[#f8f7f5] px-3.5 py-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          <ClientAvatar size={40} rounded="full" className="shadow-none" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Ativo</span>
            </div>
            <p className="mt-1 truncate text-[14px] font-semibold text-slate-900">{clientName}</p>
            <p className="truncate text-[12px] text-slate-500">{clientSub}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
        </button>

        <nav className="flex-1 overflow-y-auto px-3 pb-2 pt-5">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  navigate(item.id);
                  onClose?.();
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-[13px] font-semibold transition-all ${
                  active
                    ? ''
                    : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                }`}
              style={active ? {
                borderColor: accentColor + '33',
                backgroundColor: accentColor + '10',
                color: accentColor,
              } : undefined}
              >
                <span style={active ? { color: accentColor } : undefined} className="shrink-0">
                  <Icon className="h-[15px] w-[15px]" />
                </span>
                <span className="flex-1 text-left leading-none">{item.label}</span>
                {item.badge && (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mx-3 mb-4 mt-1 shrink-0">
          <div className="mb-3 h-px bg-slate-200" />
          <button
            onClick={logout}
            className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-[13px] font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="h-[15px] w-[15px] shrink-0 transition group-hover:text-rose-700" />
            Sair da conta
          </button>
          <p className="mt-3 px-3 text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {customization.footer_text || `Jurius ${new Date().getFullYear()}`}
          </p>
          {customization.support_contact && (
            <p className="px-3 pb-1 text-[10px] text-slate-400">{customization.support_contact}</p>
          )}
        </div>
      </aside>
    </>
  );
};
