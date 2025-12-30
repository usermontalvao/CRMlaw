import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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

// Detectar rotas especiais antes de forçar "/"
const currentPath = window.location.pathname;
const currentHash = window.location.hash;

// Permitir rota /cron/djen para endpoint público
if (currentHash.includes('/cron/djen')) {
  // Não alterar a URL, permitir que o app processe a rota
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => {
        console.error('Falha ao registrar o service worker:', error);
      });
  });
}
