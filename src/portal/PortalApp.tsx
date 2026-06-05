/**
 * PortalApp — Entry point isolado do Portal do Cliente.
 *
 * Decide entre tela de login e layout autenticado com base no
 * ClientAuthContext. Roteamento interno por hash (#/portal/{rota}).
 *
 * Este arquivo é o ÚNICO ponto de entrada montado pelo App.tsx
 * quando a rota começa com /portal. Toda a árvore do portal vive
 * dentro de src/portal/, isolada do resto da aplicação.
 */
import React, { Suspense, lazy } from 'react';
import { ClientAuthProvider, useClientAuth } from './contexts/ClientAuthContext';
import { PortalConfigProvider, usePortalConfig } from './contexts/PortalConfigContext';
import { PortalNotificationsProvider } from './contexts/PortalNotificationsContext';
import { useIsMobile } from './hooks/useIsMobile';
import { usePortalRouter } from './hooks/usePortalRouter';
import { PortalLayout } from './PortalLayout';

// Lazy imports — cada página vira seu próprio chunk.
const PortalLogin = lazy(() => import('./pages/PortalLogin').then((m) => ({ default: m.PortalLogin })));
const PortalDashboard = lazy(() => import('./pages/PortalDashboard').then((m) => ({ default: m.PortalDashboard })));
const PortalCasos = lazy(() => import('./pages/PortalCasos').then((m) => ({ default: m.PortalCasos })));
const PortalScanner = lazy(() => import('./pages/PortalScanner').then((m) => ({ default: m.PortalScanner })));
const PortalProcessDetails = lazy(() => import('./pages/PortalProcessDetails').then((m) => ({ default: m.PortalProcessDetails })));
const PortalRequirementDetails = lazy(() => import('./pages/PortalRequirementDetails').then((m) => ({ default: m.PortalRequirementDetails })));
const PortalDocuments = lazy(() => import('./pages/PortalDocumentRequests').then((m) => ({ default: m.PortalDocumentRequests })));
const PortalSignatures = lazy(() => import('./pages/PortalSignatures').then((m) => ({ default: m.PortalSignatures })));
const PortalFinancial = lazy(() => import('./pages/PortalFinancial').then((m) => ({ default: m.PortalFinancial })));
const PortalCalendar = lazy(() => import('./pages/PortalCalendar').then((m) => ({ default: m.PortalCalendar })));
const PortalMessages = lazy(() => import('./pages/PortalMessages').then((m) => ({ default: m.PortalMessages })));
const PortalNotifications = lazy(() => import('./pages/PortalNotifications').then((m) => ({ default: m.PortalNotifications })));
const PortalProfile = lazy(() => import('./pages/PortalProfile').then((m) => ({ default: m.PortalProfile })));
const PortalAppInstall = lazy(() => import('./pages/PortalAppInstall').then((m) => ({ default: m.PortalAppInstall })));

const LoadingSpinner: React.FC = () => (
  <div className="flex h-screen items-center justify-center bg-slate-50">
    <div className="flex flex-col items-center gap-3">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-orange-100 border-t-orange-500" />
      <p className="text-sm text-slate-500">Carregando portal...</p>
    </div>
  </div>
);

const PortalRouter: React.FC = () => {
  const { session, loading } = useClientAuth();
  const { route, param, navigate } = usePortalRouter();
  const { isEnabled } = usePortalConfig();
  const isMobile = useIsMobile();

  if (loading) return <LoadingSpinner />;

  // Sem sessão → tela de login
  if (!session) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <PortalLogin />
      </Suspense>
    );
  }

  // Com sessão → layout + página
  const renderPage = () => {
    switch (route) {
      case 'dashboard':
        return <PortalDashboard />;
      case 'app':
        return <PortalAppInstall />;
      case 'casos':
        if (!isEnabled('processos')) { navigate('dashboard'); return <PortalDashboard />; }
        if (!param) return <PortalCasos />;
        if (param.startsWith('proc:')) return <PortalProcessDetails processId={param.slice(5)} />;
        if (param.startsWith('req:'))  return <PortalRequirementDetails requirementId={param.slice(4)} />;
        return <PortalCasos />;
      case 'processos':
        // Alias legado → redireciona para 'casos'
        navigate('casos', param ? `proc:${param}` : undefined);
        return <PortalDashboard />;
      case 'scanner':
        if (!isEnabled('scanner') || !isMobile) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalScanner />;
      case 'documentos':
        if (!isEnabled('documentos')) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalDocuments />;
      case 'assinar':
        if (!isEnabled('assinar')) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalSignatures />;
      case 'financeiro':
        if (!isEnabled('financeiro')) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalFinancial />;
      case 'agenda':
        if (!isEnabled('agenda')) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalCalendar />;
      case 'mensagens':
        if (!isEnabled('mensagens')) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalMessages />;
      case 'notificacoes':
        if (!isEnabled('notificacoes')) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalNotifications />;
      case 'perfil':
        if (!isEnabled('perfil')) { navigate('dashboard'); return <PortalDashboard />; }
        return <PortalProfile />;
      default:
        return <PortalDashboard />;
    }
  };

  return (
    <PortalLayout>
      <Suspense fallback={<LoadingSpinner />}>{renderPage()}</Suspense>
    </PortalLayout>
  );
};

const PortalApp: React.FC = () => {
  return (
    <ClientAuthProvider>
      <PortalConfigProvider>
        <PortalNotificationsProvider>
          <PortalRouter />
        </PortalNotificationsProvider>
      </PortalConfigProvider>
    </ClientAuthProvider>
  );
};

export default PortalApp;
