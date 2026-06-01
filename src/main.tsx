import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PortalApp from './portal/PortalApp';

// ── Stale-chunk auto-reload ────────────────────────────────────────────────
window.addEventListener('unhandledrejection', (event) => {
  const msg = String((event.reason as any)?.message || event.reason || '');
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    msg.includes('Unable to preload CSS')
  ) {
    console.warn('[App] Chunk desatualizado — recarregando...');
    const lastReload = Number(sessionStorage.getItem('_chunk_reload_at') || 0);
    if (Date.now() - lastReload > 60_000) {
      sessionStorage.setItem('_chunk_reload_at', String(Date.now()));
      window.location.reload();
    }
  }
});

import { NavigationProvider } from './contexts/NavigationContext';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { DeleteConfirmProvider } from './contexts/DeleteConfirmContext';
import { registerLicense } from '@syncfusion/ej2-base';
import './index.css';

const syncfusionLicenseKey = import.meta.env.VITE_SYNCFUSION_LICENSE_KEY || '';
if (syncfusionLicenseKey) registerLicense(syncfusionLicenseKey);

const isDev = import.meta.env.DEV;

// ── Detecta sessão Supabase no localStorage (síncrono) ─────────────────────
// Supabase JS v2 persiste a sessão em chaves "sb-*-auth-token"
function hasSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // Verifica se o token ainda não expirou
        if (parsed?.access_token) return true;
      }
    }
  } catch {}
  return false;
}

// ── Roteamento de entrada ──────────────────────────────────────────────────
// Estratégia: tudo roda em "/" — sem rotas de servidor adicionais.
//   • Sessão Supabase ativa          → CRM (App)
//   • Hash #/documento/TOKEN         → CRM (viewer público)
//   • Hash #/cron/djen               → CRM (endpoint cron)
//   • Qualquer outra situação        → Portal do Cliente (PortalApp)
const currentHash = window.location.hash;
const currentPath = window.location.pathname;

// Normaliza qualquer path estranho para "/"
if (currentPath !== '/') {
  window.history.replaceState({}, '', `/${currentHash}`);
}

const isDocRoute  = currentHash.startsWith('#/documento/');
const isCronRoute = currentHash.includes('/cron/djen');
const isStaff     = hasSupabaseSession() || isDocRoute || isCronRoute;

const rootElement = isStaff
  ? (
    <NavigationProvider initialModule="dashboard">
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>
            <DeleteConfirmProvider>
              <App />
            </DeleteConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </NavigationProvider>
  )
  : <PortalApp />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{rootElement}</React.StrictMode>,
);

if (!isDev && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('SW registrado:', reg.scope))
      .catch((err) => {
        console.error('Falha ao registrar SW:', err);
        if (err.message?.includes('network error')) {
          caches.keys().then((names) =>
            Promise.all(names.filter((n) => n.startsWith('crm-cache-')).map((n) => caches.delete(n)))
          );
        }
      });
  });
}
