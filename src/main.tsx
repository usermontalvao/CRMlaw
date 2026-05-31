import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// ── Stale-chunk auto-reload ────────────────────────────────────────────────
// Após um novo deploy os nomes dos chunks mudam (hash Vite).
// Se o browser usou o index.html antigo em cache e tenta carregar um chunk
// que não existe mais → 404 / "Failed to fetch dynamically imported module".
// A solução é forçar um reload para buscar o index.html novo.
window.addEventListener('unhandledrejection', (event) => {
  const msg = String((event.reason as any)?.message || event.reason || '');
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    msg.includes('Unable to preload CSS')
  ) {
    console.warn('[App] Chunk desatualizado detectado — recarregando para aplicar novo deploy...');
    // Evita loop infinito: só recarrega 1x por minuto
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

// Registrar licença Syncfusion (lendo do .env com prefixo VITE_)
const syncfusionLicenseKey = import.meta.env.VITE_SYNCFUSION_LICENSE_KEY || '';
if (syncfusionLicenseKey) {
  registerLicense(syncfusionLicenseKey);
}

const isDev = import.meta.env.DEV;

// Detectar rotas especiais antes de forçar "/"
const currentPath = window.location.pathname;
const currentHash = window.location.hash;

// Permitir rota /cron/djen para endpoint público
if (currentHash.includes('/cron/djen')) {
  // Não alterar a URL, permitir que o app processe a rota
} else if (currentPath.startsWith('/portal')) {
  // Portal do Cliente — preservar URL para o PortalApp processar
} else if (currentPath !== '/') {
  // Garante que a URL sempre seja "/" (raiz) para outras rotas
  window.history.replaceState({}, '', '/');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
);

if (!isDev && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registrado com sucesso:', registration.scope);
        
        // Verificar se há atualização
        if (registration.active) {
          console.log('Service Worker já ativo');
        }
        if (registration.installing) {
          console.log('Service Worker instalando...');
        }
        if (registration.waiting) {
          console.log('Service Worker aguardando ativação');
        }
      })
      .catch((error) => {
        console.error('Falha ao registrar o service worker:', error);
        
        // Tentar limpar e re-registrar em caso de erro
        if (error.message.includes('network error')) {
          console.log('🔄 Erro de rede detectado, tentando limpar caches...');
          
          // Limpar caches antigos que possam causar conflitos
          caches.keys().then(cacheNames => {
            return Promise.all(
              cacheNames
                .filter(name => name.startsWith('crm-cache-'))
                .map(name => {
                  console.log('Limpando cache antigo:', name);
                  return caches.delete(name);
                })
            );
          }).then(() => {
            console.log('Caches limpos, recarregue a página');
          });
        }
      });
  });
}
