import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  Briefcase,
  Calendar,
  CheckCircle2,
  FolderOpen,
  LayoutDashboard,
  PenTool,
  PiggyBank,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { PortalHeader } from './components/PortalHeader';
import { PortalNotificationBell } from './components/PortalNotificationBell';
import { PortalSidebar } from './components/PortalSidebar';
import { usePortalConfig } from './contexts/PortalConfigContext';
import { usePortalNotifications } from './contexts/PortalNotificationsContext';
import { usePortalRouter } from './hooks/usePortalRouter';
import type { PortalRoute } from './types/portal.types';

interface PortalLayoutProps {
  children: React.ReactNode;
}

function iconFor(type: string) {
  if (type === 'profile_update_approved') return <UserCheck className="h-5 w-5 text-white" />;
  if (type === 'profile_update_rejected') return <UserX className="h-5 w-5 text-white" />;
  if (type === 'document_upload_approved') return <CheckCircle2 className="h-5 w-5 text-white" />;
  if (type === 'document_upload_rejected') return <FolderOpen className="h-5 w-5 text-white" />;
  return <Bell className="h-5 w-5 text-white" />;
}

function bgFor(type: string) {
  if (type === 'profile_update_approved') return 'bg-emerald-500';
  if (type === 'profile_update_rejected') return 'bg-rose-500';
  if (type === 'document_upload_approved') return 'bg-emerald-500';
  if (type === 'document_upload_rejected') return 'bg-rose-500';
  if (type === 'process_status_changed') return 'bg-orange-500';
  if (type === 'new_signature_request') return 'bg-violet-500';
  if (type === 'new_agreement') return 'bg-teal-500';
  if (type === 'new_document_request') return 'bg-orange-500';
  return 'bg-orange-500';
}

const PushToastOverlay: React.FC<{
  toasts: { id: string; type: string; title: string; message?: string }[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-4 z-[200] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-3 rounded-[22px] border border-white/70 bg-white/90 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur-xl animate-in slide-in-from-right-4 duration-200"
        >
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${bgFor(toast.type)}`}>
            {iconFor(toast.type)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-slate-900">{toast.title}</p>
            {toast.message && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">{toast.message}</p>}
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="mt-0.5 shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
};

const BOTTOM_NAV = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Início' },
  { id: 'casos', icon: Briefcase, label: 'Casos' },
  { id: 'assinar', icon: PenTool, label: 'Assinar' },
  { id: 'financeiro', icon: PiggyBank, label: 'Financeiro' },
  { id: 'agenda', icon: Calendar, label: 'Agenda' },
] as const;

export const PortalLayout: React.FC<PortalLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { route, navigate } = usePortalRouter();
  const { isEnabled } = usePortalConfig();
  const { toasts, dismissToast } = usePortalNotifications();

  useEffect(() => {
    setSidebarOpen(false);
  }, [route]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

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
    <div
      className="portal-shell min-h-screen"
      style={{ fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif" }}
    >
      <div className="relative flex min-h-screen">
        <PortalSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex min-w-0 flex-1 flex-col">
          <PortalHeader onMenuClick={() => setSidebarOpen(true)} />

          <main className="flex-1 overflow-x-hidden">
            <div className="mx-auto w-full max-w-7xl px-3 py-4 pb-24 sm:px-5 sm:py-6 sm:pb-6 lg:px-6 lg:py-5">
              {children}
            </div>
          </main>
        </div>
      </div>

      <div className="fixed right-3 top-3 z-40 lg:right-5 lg:top-5">
        <PortalNotificationBell />
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-30 rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.12)] lg:hidden">
        <div className="flex h-16 items-stretch">
          {BOTTOM_NAV.filter(({ id }) => id === 'dashboard' || isEnabled(id as never)).map(({ id, icon: Icon, label }) => {
            const active = route === id;
            return (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] transition ${
                  active ? 'text-orange-700' : 'text-slate-400'
                }`}
              >
                {active && <span className="absolute inset-x-3 top-2 h-[3px] rounded-full bg-orange-500" />}
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-semibold">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <PushToastOverlay toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
