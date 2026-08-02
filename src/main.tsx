import './utils/consoleGuard'; // 1º: silencia console em prod (só erro) + aviso anti-self-XSS
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerVersionedServiceWorker } from './utils/serviceWorker';
import { isEditorAppLocation } from './utils/editorAppRoute';

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
    hash.includes('/termos-assinatura') ||
    path.includes('/termos-assinatura') ||
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

function hasStaffSessionExpiredNotice(): boolean {
  try {
    return sessionStorage.getItem('auth_notice') === 'session_expired';
  } catch {}
  return false;
}

// -- Roteamento de entrada --------------------------------------------------
// Estrat�gia: tudo roda em "/" � sem rotas de servidor adicionais.
//   � Sess�o Supabase ativa          ? CRM (App)
//   � Hash #/documento/TOKEN         ? CRM (viewer p�blico)
//   � Hash #/cron/djen               ? CRM (endpoint cron)
//   � Sessão expirada do staff       ? CRM interno (login)
//   � Qualquer outra situação        ? Portal do Cliente (PortalApp)
const currentHash = window.location.hash;
const currentPath = window.location.pathname;

// App "Editor" (PWA instalável separado): quando aberto no caminho /editor, este
// é o app dedicado do Editor de Petições. Usamos um CAMINHO real (não hash) para
// que o PWA tenha escopo próprio (/editor) — só assim o navegador consegue abrir
// ESTE app instalado (e não o CRM) ao seguir um link /editor. Trocamos o
// <link rel="manifest"> para o manifest próprio (ícone/nome próprios) e tratamos
// a rota como staff (abre o login se não houver sessão, em vez do Portal).
const isEditorAppRoute = isEditorAppLocation(currentPath, currentHash);
if (isEditorAppRoute) {
  try {
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute('href', '/editor.webmanifest');
  } catch {
    // ignore
  }
}

// Vídeo animado de aniversário: link direto para assistir/conferir a peça
// fora da data. Precisa ser lido ANTES da normalização de path abaixo, que
// descarta a query string. Aceita "?aniversarioanimado" e "#/aniversarioanimado".
const isBirthdayVideoRoute =
  new URLSearchParams(window.location.search).has('aniversarioanimado') ||
  currentHash.includes('/aniversarioanimado') ||
  currentPath.includes('/aniversarioanimado');

const isPublicSignature = isPublicSignatureRoute(currentHash, currentPath);
const isStaffSessionExpired = hasStaffSessionExpiredNotice();

if (isPublicSignature) {
  disablePwaForPublicSignatureRoute();
}

// Normaliza qualquer path estranho para "/" — exceto /editor, que é o caminho
// próprio do app do Editor (precisa ser preservado para o escopo do PWA).
if (currentPath !== '/' && !isEditorAppRoute) {
  window.history.replaceState({}, '', `/${currentHash}`);
}

const isDocRoute  = currentHash.startsWith('#/documento/');
const isCronRoute = currentHash.includes('/cron/djen');

// Rotas p�blicas que s�o renderizadas pelo App (n�o pelo PortalApp)
const isPublicCrmRoute =
  currentHash.includes('/assinar/') ||
  currentPath.includes('/assinar/') ||
  currentHash.includes('/p/') ||
  currentPath.includes('/p/') ||
  currentHash.includes('/preencher/') ||
  currentPath.includes('/preencher/') ||
  currentHash.includes('/cloud/share/') ||
  currentPath.includes('/cloud/share/') ||
  currentHash.includes('/verificar') ||
  currentPath.includes('/verificar') ||
  currentHash.includes('/termos-assinatura') ||
  currentPath.includes('/termos-assinatura') ||
  currentHash.includes('/terms') ||
  currentPath.includes('/terms') ||
  currentHash.includes('/privacidade') ||
  currentPath.includes('/privacidade') ||
  currentHash.includes('/privacy') ||
  currentPath.includes('/privacy') ||
  currentHash.includes('/docs') ||
  currentPath.includes('/docs');

const isStaff = hasSupabaseSession() || isStaffSessionExpired || isDocRoute || isCronRoute || isPublicCrmRoute || isEditorAppRoute;

async function renderRoot() {
  let rootElement: React.ReactNode;

  // DEV-ONLY: harness do certificado de assinatura (?certpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('certpreview')) {
    const { default: CertificatePreview } = await import('./dev/CertificatePreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><CertificatePreview /></React.StrictMode>,
    );
    return;
  }

  // DEV-ONLY: harness visual dos avisos de "quem está editando" (?presencepreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('presencepreview')) {
    const { default: EditingPresencePreview } = await import('./dev/EditingPresencePreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <EditingPresencePreview />,
    );
    return;
  }

  // DEV-ONLY: harness visual do Assistente IA de petições (?aichatpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('aichatpreview')) {
    const { default: PetitionAiChatPreview } = await import('./dev/PetitionAiChatPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <PetitionAiChatPreview />,
    );
    return;
  }

  // Vídeo animado de aniversário (?aniversarioanimado | #/aniversarioanimado).
  // Disponível também em produção: é o link para assistir à homenagem.
  if (isBirthdayVideoRoute) {
    const { default: BirthdayVideoRoute } = await import('./components/birthday/BirthdayVideoRoute');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <BirthdayVideoRoute />,
    );
    return;
  }

  // DEV-ONLY: cadastro obrigatório e aviso de correspondência
  // (?birthdaypreview=gate | ?birthdaypreview=toast).
  if (isDev && new URLSearchParams(window.location.search).has('birthdaypreview')) {
    const { default: BirthdayPreview } = await import('./dev/BirthdayPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <BirthdayPreview />,
    );
    return;
  }

  // App dedicado "Editor" (/editor): casca MÍNIMA — só o editor, sem o CRM
  // completo (sidebar, dashboard, módulos). Providers próprios dentro de EditorApp.
  if (isEditorAppRoute) {
    const { default: EditorApp } = await import('./EditorApp');
    rootElement = <EditorApp />;
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>{rootElement}</React.StrictMode>,
    );
    return;
  }

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
