import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PortalSidebar } from './components/PortalSidebar';
import { PortalHeader } from './components/PortalHeader';
import { usePortalRouter } from './hooks/usePortalRouter';
import { usePortalConfig } from './contexts/PortalConfigContext';
import { usePortalNotifications } from './contexts/PortalNotificationsContext';
import {
  LayoutDashboard, Briefcase, PenTool, PiggyBank, Calendar,
  UserCheck, UserX, Bell, X,
} from 'lucide-react';
import type { PortalRoute } from './types/portal.types';

interface PortalLayoutProps { children: React.ReactNode; }

// ── Toast push overlay ────────────────────────────────────────────────────────
function iconFor(type: string) {
  if (type === 'profile_update_approved') return <UserCheck className="h-5 w-5 text-white" />;
  if (type === 'profile_update_rejected') return <UserX    className="h-5 w-5 text-white" />;
  return <Bell className="h-5 w-5 text-white" />;
}
function bgFor(type: string) {
  if (type === 'profile_update_approved') return 'bg-emerald-500';
  if (type === 'profile_update_rejected') return 'bg-rose-500';
  if (type === 'process_status_changed')  return 'bg-orange-500';
  if (type === 'new_signature_request')   return 'bg-violet-500';
  if (type === 'new_agreement')           return 'bg-teal-500';
  if (type === 'new_document_request')    return 'bg-orange-500';
  return 'bg-orange-500';
}

const PushToastOverlay: React.FC<{
  toasts: { id: string; type: string; title: string; message?: string }[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return createPortal(
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg animate-in slide-in-from-right-4 duration-200">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bgFor(t.type)}`}>
            {iconFor(t.type)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-slate-900">{t.title}</p>
            {t.message && <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{t.message}</p>}
          </div>
          <button onClick={() => onDismiss(t.id)} className="mt-0.5 shrink-0 text-slate-400 transition hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
};

// ── Navegação rápida no rodapé mobile ────────────────────────────────────────
const BOTTOM_NAV = [
  { id: 'dashboard',  icon: LayoutDashboard, label: 'Início'     },
  { id: 'casos',      icon: Briefcase,       label: 'Casos'      },
  { id: 'assinar',    icon: PenTool,         label: 'Assinar'    },
  { id: 'financeiro', icon: PiggyBank,       label: 'Financeiro' },
  { id: 'agenda',     icon: Calendar,        label: 'Agenda'     },
] as const;

// ── Layout principal ──────────────────────────────────────────────────────────
export const PortalLayout: React.FC<PortalLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { route, navigate } = usePortalRouter();
  const { isEnabled } = usePortalConfig();
  const { toasts, dismissToast, unreadCount } = usePortalNotifications();

  useEffect(() => { setSidebarOpen(false); }, [route]);

  // Registrar SW e pedir permissão push
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Ouve mensagens do SW (clique na push notification) → navega
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.portalRoute) navigate(data.portalRoute as PortalRoute, data.portalParam);
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        <PortalSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex min-w-0 flex-1 flex-col">
          <PortalHeader onMenuClick={() => setSidebarOpen(true)} />

          <main className="flex-1 overflow-x-hidden">
            <div className="mx-auto w-full max-w-3xl px-3 py-4 pb-24 sm:px-5 sm:py-6 sm:pb-6 lg:max-w-5xl lg:px-8 lg:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* ── BOTTOM NAV (mobile only) ── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white lg:hidden">
        <div className="flex h-16 items-stretch">
          {BOTTOM_NAV.filter(({ id }) => id === 'dashboard' || isEnabled(id as any)).map(({ id, icon: Icon, label }) => {
            const active = route === id;
            return (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition ${
                  active ? 'text-orange-600' : 'text-slate-400'
                }`}
              >
                {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-orange-500" />}
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            );
          })}

          {isEnabled('notificacoes' as any) && (
            <button
              onClick={() => navigate('notificacoes')}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition ${
                route === 'notificacoes' ? 'text-orange-600' : 'text-slate-400'
              }`}
            >
              {route === 'notificacoes' && <span className="absolute inset-x-0 top-0 h-0.5 bg-orange-500" />}
              <span className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">Avisos</span>
            </button>
          )}
        </div>
      </nav>

      {/* ── Push toasts ── */}
      <PushToastOverlay toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
