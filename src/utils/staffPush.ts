// Web Push do STAFF (módulo WhatsApp): assina o navegador para receber
// notificações mesmo com a aba/navegador fechados. Espelha o fluxo do portal
// (PortalNotificationsContext) mas grava em `staff_push_subscriptions` via RPC.
//
// ⚠️ Depende do Service Worker (`/sw.js`), que SÓ é registrado em produção
// (registerVersionedServiceWorker retorna null em DEV) — em dev o push real
// não funciona; o aviso in-app (som + toast) continua cobrindo.
import { supabase } from '../config/supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function isIosNonStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  const isIos = /iPad|iPhone|iPod/.test(ua) || touchMac;
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // No iOS, Web Push só funciona com o app instalado na tela inicial (standalone).
  return isIos && !standalone;
}

/** O ambiente suporta Web Push e as chaves VAPID estão presentes? */
export function isStaffPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!VAPID_PUBLIC_KEY) return false;
  if (!('Notification' in window)) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  if (isIosNonStandalone()) return false;
  return true;
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

/** Já existe uma subscription ativa neste navegador? */
export async function isStaffPushEnabled(): Promise<boolean> {
  if (!isStaffPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

/**
 * Pede permissão, assina o push e salva a subscription. Retorna o resultado
 * para a UI dar feedback ("permissão negada", "sem suporte", etc.).
 */
export async function enableStaffPush(): Promise<'enabled' | 'denied' | 'unsupported' | 'error'> {
  if (!isStaffPushSupported()) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      });
    }

    const json = sub.toJSON();
    const keys = json.keys as { p256dh: string; auth: string } | undefined;
    if (!json.endpoint || !keys?.p256dh || !keys?.auth) return 'error';

    const { error } = await supabase.rpc('staff_save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 200),
    });
    if (error) { console.error('[whatsapp-push] save subscription failed:', error); return 'error'; }
    return 'enabled';
  } catch (e) {
    console.error('[whatsapp-push] enable error:', e);
    return 'error';
  }
}

/** Cancela a subscription local e remove do banco. */
export async function disableStaffPush(): Promise<boolean> {
  if (!isStaffPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      try { await supabase.rpc('staff_remove_push_subscription', { p_endpoint: endpoint }); } catch { /* silencia */ }
    }
    return true;
  } catch (e) {
    console.error('[whatsapp-push] disable error:', e);
    return false;
  }
}
