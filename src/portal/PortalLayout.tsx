import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PortalSidebar } from './components/PortalSidebar';
import { PortalHeader } from './components/PortalHeader';
import { usePortalRouter } from './hooks/usePortalRouter';
import { useClientAuth } from './contexts/ClientAuthContext';
import { clientPortalService } from './services/clientPortal.service';
import type { PortalRoute } from './types/portal.types';
import { usePortalConfig } from './contexts/PortalConfigContext';
import {
  LayoutDashboard, Briefcase, PenTool, PiggyBank, Calendar,
  UserCheck, UserX, Bell, X,
} from 'lucide-react';

interface PortalLayoutProps {
  children: React.ReactNode;
}

// ── Tipos de notificação push do portal ──────────────────────────────────────
interface PushToast {
  id: string;
  type: string;
  title: string;
  message?: string;
}

const SEEN_KEY = 'portal_seen_notif_ids';

function getSeenIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function addSeenId(id: string) {
  const seen = getSeenIds();
  seen.add(id);
  const arr = Array.from(seen).slice(-100);
  localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
}

/** Rota interna do portal para cada tipo de notificação */
function portalRouteFor(type: string, processId?: string): { route: PortalRoute; param?: string } {
  if (type === 'profile_update_approved' || type === 'profile_update_rejected')
    return { route: 'perfil' };
  if (processId) return { route: 'processos', param: processId };
  if (type.includes('financ') || type.includes('parcela')) return { route: 'financeiro' };
  if (type.includes('assin') || type.includes('sign')) return { route: 'assinar' };
  if (type.includes('agend') || type.includes('audien')) return { route: 'agenda' };
  return { route: 'notificacoes' };
}

/** URL completa para o push notification abrir */
function pushUrl(type: string, processId?: string): string {
  const dest = portalRouteFor(type, processId);
  const hash = dest.param ? `#portal/${dest.route}/${dest.param}` : `#portal/${dest.route}`;
  return `${window.location.origin}/portal${hash}`;
}

function iconFor(type: string) {
  if (type === 'profile_update_approved') return <UserCheck className="h-5 w-5 text-white" />;
  if (type === 'profile_update_rejected') return <UserX className="h-5 w-5 text-white" />;
  if (type === 'process_status_changed')  return <Bell className="h-5 w-5 text-white" />;
  if (type === 'new_signature_request')   return <Bell className="h-5 w-5 text-white" />;
  if (type === 'new_agreement')           return <Bell className="h-5 w-5 text-white" />;
  if (type === 'new_document_request')    return <Bell className="h-5 w-5 text-white" />;
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

// ── Toast push overlay ────────────────────────────────────────────────────────
const PushToastOverlay: React.FC<{ toasts: PushToast[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => {
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
  { id: 'dashboard', icon: LayoutDashboard, label: 'Início'     },
  { id: 'processos', icon: Briefcase,       label: 'Processos'  },
  { id: 'assinar',   icon: PenTool,         label: 'Assinar'    },
  { id: 'financeiro',icon: PiggyBank,       label: 'Financeiro' },
  { id: 'agenda',    icon: Calendar,        label: 'Agenda'     },
] as const;

// ── Layout principal ──────────────────────────────────────────────────────────
export const PortalLayout: React.FC<PortalLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { route, navigate } = usePortalRouter();
  const { session } = useClientAuth();
  const { isEnabled } = usePortalConfig();
  const [toasts, setToasts] = useState<PushToast[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setSidebarOpen(false); }, [route]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Registrar SW e solicitar permissão push ──
  useEffect(() => {
    // Registra SW (reutiliza o existente do app)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    // Solicita permissão
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // ── Ouve mensagens do SW (clique na push) → navega ──
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.portalRoute) {
        navigate(data.portalRoute as PortalRoute, data.portalParam);
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [navigate]);

  // ── Polling de notificações (a cada 30s) ──
  useEffect(() => {
    if (!session?.user?.id) return;

    const check = async () => {
      try {
        const items = await clientPortalService.listNotifications(session.user.id);
        const seen = getSeenIds();
        // Envia push para eventos do sistema — NÃO para movimentações processuais
        const PUSH_TYPES = new Set([
          'profile_update_approved',
          'profile_update_rejected',
          'process_status_changed',
          'new_signature_request',
          'new_agreement',
          'new_document_request',
        ]);
        const fresh = (items as any[]).filter(
          (n) => n.id && !seen.has(n.id) && PUSH_TYPES.has(n.type)
        );
        if (fresh.length === 0) return;

        for (const n of fresh) {
          addSeenId(n.id);

          // Toast in-app
          const toast: PushToast = { id: n.id, type: n.type, title: n.title || 'Notificação', message: n.message };
          setToasts((prev) => [...prev.slice(-4), toast]);
          setTimeout(() => dismissToast(n.id), 8000);

          // Browser push via SW (inclui rota para navegação ao clicar)
          const dest = portalRouteFor(n.type, n.process_id);
          const notifPayload = {
            title: n.title || 'Jurius',
            body: n.message || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-96.png',
            tag: n.id,
            data: {
              url: pushUrl(n.type, n.process_id),
              portalRoute: dest.route,
              portalParam: dest.param,
            },
          };

          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
              reg.showNotification(notifPayload.title, {
                body: notifPayload.body,
                icon: notifPayload.icon,
                badge: notifPayload.badge,
                tag: notifPayload.tag,
                data: notifPayload.data,
                requireInteraction: true,
              } as NotificationOptions).catch(() => {
                // Fallback para Notification API simples
                if (Notification.permission === 'granted') {
                  new Notification(notifPayload.title, { body: notifPayload.body, icon: notifPayload.icon });
                }
              });
            }).catch(() => {
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification(notifPayload.title, { body: notifPayload.body, icon: notifPayload.icon });
              }
            });
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(notifPayload.title, { body: notifPayload.body, icon: notifPayload.icon });
          }
        }
      } catch { /* silent */ }
    };

    check();
    pollRef.current = setInterval(check, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [session?.user?.id, dismissToast]);

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
        </div>
      </nav>

      {/* ── Push toasts ── */}
      <PushToastOverlay toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
