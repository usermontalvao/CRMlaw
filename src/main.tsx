import './utils/consoleGuard'; // 1º: silencia console em prod (só erro) + aviso anti-self-XSS
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerVersionedServiceWorker } from './utils/serviceWorker';

// -- Stale-chunk auto-reload ------------------------------------------------
window.addEventListener('unhandledrejection', (event) => {
  const msg = String((event.reason as any)?.message || event.reason || '');
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    msg.includes('Unable to preload CSS')
  ) {
    console.warn('[App] Chunk desatualizado � recarregando...');
    const lastReload = Number(sessionStorage.getItem('_chunk_reload_at') || 0);
    if (Date.now() - lastReload > 60_000) {
      sessionStorage.setItem('_chunk_reload_at', String(Date.now()));
      window.location.reload();
    }
  }
});

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'app-update-available') return;
  const lastReload = Number(sessionStorage.getItem('_sw_reload_at') || 0);
  if (Date.now() - lastReload > 10_000) {
    sessionStorage.setItem('_sw_reload_at', String(Date.now()));
    window.location.reload();
  }
});

import './index.css';

const isDev = import.meta.env.DEV;

function isPublicSignatureRoute(hash: string, path: string): boolean {
  return (
    hash.includes('/assinar/') ||
    path.includes('/assinar/') ||
    hash.includes('/verificar') ||
    path.includes('/verificar') ||
    hash.startsWith('#/documento/') ||
    path.includes('/documento/')
  );
}

function disablePwaForPublicSignatureRoute() {
  document.querySelector('link[rel="manifest"]')?.remove();
  document.querySelector('link[rel="apple-touch-icon"]')?.remove();
  document
    .querySelectorAll(
      'meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"], meta[name="apple-mobile-web-app-status-bar-style"], meta[name="apple-mobile-web-app-title"]',
    )
    .forEach((element) => element.remove());
}

// -- Detecta sess�o Supabase no localStorage (s�ncrono) ---------------------
// Supabase JS v2 persiste a sess�o em chaves "sb-*-auth-token"
function hasSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // Verifica se o token ainda n�o expirou
        if (parsed?.access_token) return true;
      }
    }
  } catch {}
  return false;
}

// -- Roteamento de entrada --------------------------------------------------
// Estrat�gia: tudo roda em "/" � sem rotas de servidor adicionais.
//   � Sess�o Supabase ativa          ? CRM (App)
//   � Hash #/documento/TOKEN         ? CRM (viewer p�blico)
//   � Hash #/cron/djen               ? CRM (endpoint cron)
//   � Qualquer outra situa��o        ? Portal do Cliente (PortalApp)
const currentHash = window.location.hash;
const currentPath = window.location.pathname;
const isPublicSignature = isPublicSignatureRoute(currentHash, currentPath);

if (isPublicSignature) {
  disablePwaForPublicSignatureRoute();
}

// Normaliza qualquer path estranho para "/"
if (currentPath !== '/') {
  window.history.replaceState({}, '', `/${currentHash}`);
}

const isDocRoute  = currentHash.startsWith('#/documento/');
const isCronRoute = currentHash.includes('/cron/djen');

// Rotas p�blicas que s�o renderizadas pelo App (n�o pelo PortalApp)
const isPublicCrmRoute =
  currentHash.includes('/assinar/') ||
  currentHash.includes('/p/') ||
  currentHash.includes('/preencher/') ||
  currentHash.includes('/cloud/share/') ||
  currentHash.includes('/verificar') ||
  currentHash.includes('/terms') ||
  currentHash.includes('/privacidade') ||
  currentHash.includes('/privacy') ||
  currentHash.includes('/docs');

const isStaff = hasSupabaseSession() || isDocRoute || isCronRoute || isPublicCrmRoute;

async function renderRoot() {
  let rootElement: React.ReactNode;

  if (isStaff) {
    const [
      { default: App },
      { NavigationProvider },
      { AuthProvider },
      { ThemeProvider },
      { SidebarModeProvider },
      { ToastProvider },
      { SecurityPinProvider },
      { DeleteConfirmProvider },
    ] = await Promise.all([
      import('./App'),
      import('./contexts/NavigationContext'),
      import('./contexts/AuthContext'),
      import('./contexts/ThemeContext'),
      import('./contexts/SidebarModeContext'),
      import('./contexts/ToastContext'),
      import('./contexts/SecurityPinContext'),
      import('./contexts/DeleteConfirmContext'),
    ]);

    rootElement = (
      <NavigationProvider initialModule="dashboard">
        <AuthProvider>
          <ThemeProvider>
            <SidebarModeProvider>
              <ToastProvider>
                <SecurityPinProvider>
                  <DeleteConfirmProvider>
                    <App />
                  </DeleteConfirmProvider>
                </SecurityPinProvider>
              </ToastProvider>
            </SidebarModeProvider>
          </ThemeProvider>
        </AuthProvider>
      </NavigationProvider>
    );
  } else {
    const { default: PortalApp } = await import('./portal/PortalApp');
    rootElement = <PortalApp />;
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{rootElement}</React.StrictMode>,
  );
}

void renderRoot();

if (!isDev && 'serviceWorker' in navigator) {
  if (!isPublicSignature) {
    window.addEventListener('load', () => {
      registerVersionedServiceWorker()
        .then((reg) => { if (reg) console.log('SW registrado:', reg.scope); })
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
}
