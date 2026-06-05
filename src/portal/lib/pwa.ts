export const PORTAL_INSTALL_APP_EVENT = 'portal:install_app';
export const PORTAL_INSTALL_DISMISSED_KEY = 'portal-install-dismissed-v1';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || touchMac;
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 1024px)').matches;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function canUsePushNotifications(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  if (isIosDevice() && !isStandaloneDisplay()) return false;
  return true;
}

export function shouldSuggestInstall(): boolean {
  return isMobileDevice() && !isStandaloneDisplay();
}

export function getPortalAppUrl(): string {
  if (typeof window === 'undefined') return '/#/portal/dashboard';
  return `${window.location.origin}/#/portal/dashboard`;
}

export function dispatchPortalInstallEvent() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PORTAL_INSTALL_APP_EVENT));
}
