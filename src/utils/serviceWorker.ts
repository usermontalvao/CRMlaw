import { FULL_APP_VERSION } from './appVersion';

export const VERSIONED_SW_URL = `/sw.js?v=${encodeURIComponent(FULL_APP_VERSION)}`;

export async function registerVersionedServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  if (import.meta.env.DEV) return null;
  return navigator.serviceWorker.register(VERSIONED_SW_URL, { updateViaCache: 'none' });
}
