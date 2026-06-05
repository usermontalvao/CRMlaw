import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clientPortalService } from '../services/clientPortal.service';
import { useClientAuth } from './ClientAuthContext';
import { supabasePortal } from '../lib/supabasePortal';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { canUsePushNotifications } from '../lib/pwa';

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

const LAST_OPENED_KEY = 'portal_notif_last_opened';
const SEEN_KEY = 'portal_seen_notif_ids';
const PORTAL_CHAT_VISIBLE_KEY = 'portal-chat-visible';
const PORTAL_CHAT_VISIBLE_EVENT = 'crm:portal_chat_visible';

const TOAST_TYPES = new Set([
  'profile_update_rejected',
  'process_status_changed',
  'new_signature_request',
  'new_document_request',
  'document_upload_rejected',
  'chat_reply',
]);

export function isUnread(n: NotifItem): boolean {
  if (typeof n.is_read === 'boolean') return !n.is_read;
  return !n.read_at;
}

function toTimestamp(value?: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getLastOpened(): number {
  try {
    return Number(localStorage.getItem(LAST_OPENED_KEY) || '0');
  } catch {
    return 0;
  }
}

function saveLastOpened(timestamp: number) {
  try {
    localStorage.setItem(LAST_OPENED_KEY, String(timestamp));
  } catch {}
}

function getSeenIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function addSeenId(id: string) {
  const seen = getSeenIds();
  seen.add(id);
  localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-200)));
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

export const PortalNotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, updateSession } = useClientAuth();
  const { route } = usePortalRouter();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<PushToast[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [lastOpened, setLastOpened] = useState<number>(0);
  const [chatVisible, setChatVisible] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const realtimeOk = useRef(false);
  const initialLoadDoneRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const sessionStartedAtRef = useRef<number>(0);

  useEffect(() => {
    const serverSeenAt = toTimestamp(session?.user?.notifications_last_seen_at);
    const localSeenAt = getLastOpened();
    setLastOpened(Math.max(serverSeenAt, localSeenAt));
    sessionStartedAtRef.current = Math.max(toTimestamp(session?.loginAt), Date.now());
  }, [session?.user?.id, session?.user?.notifications_last_seen_at, session?.loginAt]);

  useEffect(() => {
    const sync = () => {
      let visible = route === 'mensagens';
      try {
        visible = visible || localStorage.getItem(PORTAL_CHAT_VISIBLE_KEY) === '1';
      } catch {}
      setChatVisible(visible);
    };
    sync();
    const handler = () => sync();
    window.addEventListener(PORTAL_CHAT_VISIBLE_EVENT, handler as EventListener);
    window.addEventListener('hashchange', handler);
    return () => {
      window.removeEventListener(PORTAL_CHAT_VISIBLE_EVENT, handler as EventListener);
      window.removeEventListener('hashchange', handler);
    };
  }, [route]);

  const shouldSuppressChatReply = useCallback((notification?: NotifItem | null) => {
    return (notification?.type || '') === 'chat_reply' && chatVisible;
  }, [chatVisible]);

  const pushToast = useCallback((n: NotifItem) => {
    if (shouldSuppressChatReply(n)) return;
    if (!TOAST_TYPES.has(n.type || '')) return;
    if (!isUnread(n)) return;
    const createdAt = toTimestamp(n.created_at);
    if (createdAt > 0 && createdAt < sessionStartedAtRef.current) return;
    if (getSeenIds().has(n.id)) return;
    addSeenId(n.id);
    const toast: PushToast = {
      id: n.id,
      type: n.type || 'notification',
      title: n.title || 'Notificação',
      message: n.message,
    };
    setToasts((prev) => [...prev.slice(-4), toast]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== n.id)), 8000);
  }, [shouldSuppressChatReply]);

  const reload = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const data = await clientPortalService.listNotifications(session.user.id) as NotifItem[];
      setItems(data);

      const nextIds = new Set(data.map((n) => n.id));

      if (!initialLoadDoneRef.current) {
        knownIdsRef.current = nextIds;
        initialLoadDoneRef.current = true;
        return;
      }

      data
        .filter((n) => !knownIdsRef.current.has(n.id))
        .forEach(pushToast);

      knownIdsRef.current = nextIds;
    } catch {}
  }, [session?.user?.id, pushToast]);

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
          knownIdsRef.current.add(n.id);
          if (shouldSuppressChatReply(n) && session?.user?.id) {
            const readAt = new Date().toISOString();
            setItems((prev) => [{ ...n, is_read: true, read_at: readAt }, ...prev]);
            void clientPortalService.markNotificationRead(session.user.id, n.id).catch(() => {});
            return;
          }
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
  }, [session?.client?.id, session?.user?.id, pushToast, shouldSuppressChatReply]);

  useEffect(() => {
    if (!session?.user?.id) return;
    initialLoadDoneRef.current = false;
    knownIdsRef.current = new Set();
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

  useEffect(() => {
    if (!session?.user?.id || !VAPID_PUBLIC_KEY || !canUsePushNotifications()) {
      setPushEnabled(false);
      return;
    }
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        setPushEnabled(!!sub);
      })
    ).catch(() => {});
  }, [session?.user?.id]);

  const requestPushPermission = useCallback(async (): Promise<boolean> => {
    if (!session?.user?.id || !VAPID_PUBLIC_KEY) return false;
    if (!canUsePushNotifications()) return false;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
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
    if (!session?.user?.id) return;
    const now = new Date();
    const timestamp = now.getTime();
    const iso = now.toISOString();
    saveLastOpened(timestamp);
    setLastOpened(timestamp);
    updateSession((prev) => prev ? {
      ...prev,
      user: {
        ...prev.user,
        notifications_last_seen_at: iso,
      },
    } : prev);
    void clientPortalService.markNotificationsSeen(session.user.id, iso);
  }, [session?.user?.id, updateSession]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const unreadCount = items.filter(isUnread).length;
  const newIds = new Set(
    items
      .filter((n) => n.created_at && toTimestamp(n.created_at) > lastOpened)
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
