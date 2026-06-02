import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clientPortalService } from '../services/clientPortal.service';
import { useClientAuth } from './ClientAuthContext';
import { supabasePortal } from '../lib/supabasePortal';

export interface NotifItem {
  id: string;
  is_read?: boolean;
  read?: boolean;
  read_at?: string | null;
  created_at?: string;
  type?: string;
  title?: string;
  message?: string;
  [key: string]: any;
}

export interface PushToast {
  id: string;
  type: string;
  title: string;
  message?: string;
}

interface PortalNotificationsContextType {
  items: NotifItem[];
  unreadCount: number;
  newIds: Set<string>;
  toasts: PushToast[];
  loading: boolean;
  pushEnabled: boolean;
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearNew: () => void;
  dismissToast: (id: string) => void;
  requestPushPermission: () => Promise<boolean>;
}

const Ctx = createContext<PortalNotificationsContextType | undefined>(undefined);

const LAST_OPENED_KEY  = 'portal_notif_last_opened';
const SEEN_KEY         = 'portal_seen_notif_ids';

// Tipos que geram push toast (eventos do escritório, não movimentações)
const PUSH_TYPES = new Set([
  'profile_update_approved', 'profile_update_rejected',
  'process_status_changed',  'new_signature_request',
  'new_agreement',           'new_document_request',
]);

export function isUnread(n: NotifItem): boolean {
  if (typeof n.is_read === 'boolean') return !n.is_read;
  return !n.read_at;
}

function getLastOpened(): number {
  try { return Number(localStorage.getItem(LAST_OPENED_KEY) || '0'); }
  catch { return 0; }
}
function saveLastOpened() {
  try { localStorage.setItem(LAST_OPENED_KEY, String(Date.now())); }
  catch {}
}
function getSeenIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function addSeenId(id: string) {
  const seen = getSeenIds();
  seen.add(id);
  localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-200)));
}

// Chave pública VAPID — configurada em VITE_VAPID_PUBLIC_KEY
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const arr     = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

export const PortalNotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session } = useClientAuth();
  const [items, setItems]       = useState<NotifItem[]>([]);
  const [loading, setLoading]   = useState(false);
  const [toasts, setToasts]     = useState<PushToast[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [lastOpened, setLastOpened] = useState<number>(getLastOpened);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef  = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const realtimeOk  = useRef(false);

  const pushToast = useCallback((n: NotifItem) => {
    if (!PUSH_TYPES.has(n.type || '')) return;
    if (getSeenIds().has(n.id)) return;
    addSeenId(n.id);
    const toast: PushToast = { id: n.id, type: n.type!, title: n.title || 'Notificação', message: n.message };
    setToasts((prev) => [...prev.slice(-4), toast]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== n.id)), 8000);
  }, []);

  const reload = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const data = await clientPortalService.listNotifications(session.user.id) as NotifItem[];
      setItems(data);
      // Detectar notificações não vistas para push toast
      data.filter((n) => !getSeenIds().has(n.id)).forEach(pushToast);
    } catch {}
  }, [session?.user?.id, pushToast]);

  // Realtime: escuta INSERTs em portal_client_notifications
  useEffect(() => {
    if (!session?.client?.id) return;
    const clientId = session.client.id;

    channelRef.current = supabasePortal
      .channel(`portal-notifs:${clientId}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'portal_client_notifications',
          filter: `client_id=eq.${clientId}`,
        },
        (payload: any) => {
          const n = payload.new as NotifItem;
          setItems((prev) => [n, ...prev]);
          pushToast(n);
        }
      )
      .subscribe((status: string) => {
        realtimeOk.current = status === 'SUBSCRIBED';
      });

    return () => {
      if (channelRef.current) {
        supabasePortal.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [session?.client?.id, pushToast]);

  // Polling como fallback (a cada 60s se realtime ok, senão 20s)
  useEffect(() => {
    if (!session?.user?.id) return;
    setLoading(true);
    reload().finally(() => setLoading(false));

    const tick = () => {
      const interval = realtimeOk.current ? 60_000 : 20_000;
      pollRef.current = setTimeout(async () => {
        await reload();
        tick();
      }, interval);
    };
    tick();

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [session?.user?.id, reload]);

  const markRead = useCallback(async (id: string) => {
    if (!session?.user?.id) return;
    setItems((prev) => prev.map((n) =>
      n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
    ));
    await clientPortalService.markNotificationRead(session.user.id, id);
  }, [session?.user?.id]);

  const markAllRead = useCallback(async () => {
    if (!session?.user?.id) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
    await clientPortalService.markAllNotificationsRead(session.user.id);
  }, [session?.user?.id]);

  // Web Push: verifica subscription existente ao iniciar
  useEffect(() => {
    if (!session?.user?.id || !VAPID_PUBLIC_KEY || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(sub => {
        setPushEnabled(!!sub);
      })
    ).catch(() => {});
  }, [session?.user?.id]);

  const requestPushPermission = useCallback(async (): Promise<boolean> => {
    if (!session?.user?.id || !VAPID_PUBLIC_KEY) return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      await clientPortalService.savePushSubscription(session.user.id, sub.toJSON());
      setPushEnabled(true);
      return true;
    } catch (e) {
      console.error('[portal-push] subscription error:', e);
      return false;
    }
  }, [session?.user?.id]);

  const clearNew = useCallback(() => {
    saveLastOpened();
    setLastOpened(Date.now());
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const unreadCount = items.filter(isUnread).length;
  const newIds = new Set(
    items
      .filter((n) => n.created_at && new Date(n.created_at).getTime() > lastOpened)
      .map((n) => n.id)
  );

  return (
    <Ctx.Provider value={{ items, unreadCount, newIds, toasts, loading, pushEnabled, reload, markRead, markAllRead, clearNew, dismissToast, requestPushPermission }}>
      {children}
    </Ctx.Provider>
  );
};

export function usePortalNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortalNotifications must be inside PortalNotificationsProvider');
  return ctx;
}
