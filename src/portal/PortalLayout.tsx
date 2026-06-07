import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  LayoutDashboard,
  MessageCircle,
  PenTool,
  PiggyBank,
  ScanLine,
  Smartphone,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { PortalChatWidget } from './components/PortalChatWidget';
import { PortalHeader } from './components/PortalHeader';
import { PortalSidebar } from './components/PortalSidebar';
import { useClientAuth } from './contexts/ClientAuthContext';
import { usePortalConfig } from './contexts/PortalConfigContext';
import { usePortalNotifications } from './contexts/PortalNotificationsContext';
import { clientPortalService } from './services/clientPortal.service';
import { usePortalRouter } from './hooks/usePortalRouter';
import {
  BeforeInstallPromptEvent,
  PORTAL_INSTALL_APP_EVENT,
  PORTAL_INSTALL_DISMISSED_KEY,
  getPortalAppUrl,
  isIosDevice,
  isStandaloneDisplay,
  shouldSuggestInstall,
} from './lib/pwa';
import type { PortalRoute } from './types/portal.types';
import { registerVersionedServiceWorker } from '../utils/serviceWorker';

interface PortalLayoutProps {
  children: React.ReactNode;
}

function iconFor(type: string) {
  if (type === 'profile_update_approved') return <UserCheck className="h-5 w-5 text-white" />;
  if (type === 'profile_update_rejected') return <UserX className="h-5 w-5 text-white" />;
  if (type === 'document_upload_approved') return <CheckCircle2 className="h-5 w-5 text-white" />;
  if (type === 'document_upload_rejected') return <FolderOpen className="h-5 w-5 text-white" />;
  return <Bell className="h-5 w-5 text-white" />;
}

function bgFor(type: string) {
  if (type === 'profile_update_approved') return 'bg-emerald-500';
  if (type === 'profile_update_rejected') return 'bg-rose-500';
  if (type === 'document_upload_approved') return 'bg-emerald-500';
  if (type === 'document_upload_rejected') return 'bg-rose-500';
  if (type === 'process_status_changed') return 'bg-orange-500';
  if (type === 'new_signature_request') return 'bg-violet-500';
  if (type === 'new_agreement') return 'bg-teal-500';
  if (type === 'new_document_request') return 'bg-orange-500';
  return 'bg-orange-500';
}

const PushToastOverlay: React.FC<{
  toasts: { id: string; type: string; title: string; message?: string }[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-4 z-[200] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex animate-in items-start gap-3 rounded-[22px] border border-white/70 bg-white/90 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.14)] slide-in-from-right-4 duration-200 backdrop-blur-xl"
        >
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${bgFor(toast.type)}`}>
            {iconFor(toast.type)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-slate-900">{toast.title}</p>
            {toast.message && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">{toast.message}</p>}
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="mt-0.5 shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
};

const BOTTOM_NAV = [
  { id: 'dashboard',  icon: LayoutDashboard, label: 'Início'    },
  { id: 'casos',      icon: Briefcase,       label: 'Casos'     },
  { id: 'scanner',    icon: ScanLine,        label: 'Scanner'   },
  { id: 'mensagens',  icon: MessageCircle,   label: 'Mensagens' },
  { id: 'assinar',    icon: PenTool,         label: 'Assinar'   },
] as const;

const PortalInstallAppPrompt: React.FC<{
  open: boolean;
  ios: boolean;
  canInstall: boolean;
  busy: boolean;
  onInstall: () => void;
  onCopyLink: () => void;
  onClose: () => void;
}> = ({ open, ios, canInstall, busy, onInstall, onCopyLink, onClose }) => {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-500">Aplicativo</p>
            <h3 className="mt-1 text-xl font-bold text-slate-900">Baixe nosso aplicativo</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              {ios
                ? 'No iPhone, as notificações só funcionam com o portal instalado na Tela de Início.'
                : 'Instale o portal no celular para abrir como aplicativo e receber notificações com mais consistência.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {ios ? (
          <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/70 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Como instalar no iPhone</p>
            <ol className="mt-2 space-y-1.5 leading-relaxed">
              <li>1. Abra este portal no <span className="font-semibold">Safari</span>.</li>
              <li>2. Toque em <span className="font-semibold">Compartilhar</span>.</li>
              <li>3. Escolha <span className="font-semibold">Adicionar à Tela de Início</span>.</li>
              <li>4. Abra o app instalado para ativar notificações.</li>
            </ol>
          </div>
        ) : canInstall ? (
          <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Android e navegadores compatíveis</p>
            <p className="mt-2 leading-relaxed">
              Use o botão abaixo para instalar o portal como aplicativo. Depois, as permissões de notificação ficam mais estáveis.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Como instalar no seu dispositivo</p>
            <ol className="mt-2 space-y-1.5 leading-relaxed">
              <li>1. Abra o <span className="font-semibold">menu do navegador</span>.</li>
              <li>2. Toque em <span className="font-semibold">Instalar app</span> ou <span className="font-semibold">Adicionar à tela inicial</span>.</li>
              <li>3. Confirme a instalação.</li>
            </ol>
            <p className="mt-2 text-xs text-slate-400">No Chrome e Brave, a opção de instalar pode aparecer direto na barra do navegador.</p>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {!ios && canInstall && (
            <button
              onClick={onInstall}
              disabled={busy}
              className="flex w-full items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Instalando...' : 'Instalar aplicativo'}
            </button>
          )}
          <button
            onClick={onCopyLink}
            className="flex w-full items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Copiar link do portal
          </button>
          <button
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const PortalLayout: React.FC<PortalLayoutProps> = ({ children }) => {
  const mainRef = useRef<HTMLElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(false);
  const [installPromptOpen, setInstallPromptOpen] = useState(false);
  const [installPromptBusy, setInstallPromptBusy] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [signaturesPending, setSignaturesPending] = useState(0);
  const { route, navigate } = usePortalRouter();
  const { session } = useClientAuth();
  const { isEnabled } = usePortalConfig();
  const { toasts, dismissToast } = usePortalNotifications();
  const isIos = isIosDevice();
  const isStandalone = isStandaloneDisplay();
  const showInstallSuggestion = shouldSuggestInstall();

  useEffect(() => {
    setSidebarOpen(false);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [route]);

  useEffect(() => {
    if ('serviceWorker' in navigator) registerVersionedServiceWorker().catch(() => {});
  }, []);

  useEffect(() => {
    try {
      setInstallBannerDismissed(localStorage.getItem(PORTAL_INSTALL_DISMISSED_KEY) === '1');
    } catch {}
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      event.preventDefault?.();
      setDeferredInstallPrompt(promptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const handler = () => setInstallPromptOpen(true);
    window.addEventListener(PORTAL_INSTALL_APP_EVENT, handler as EventListener);
    return () => window.removeEventListener(PORTAL_INSTALL_APP_EVENT, handler as EventListener);
  }, []);

  const handleInstall = async () => {
    if (!deferredInstallPrompt) {
      setInstallPromptOpen(true);
      return;
    }
    try {
      setInstallPromptBusy(true);
      await deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      setDeferredInstallPrompt(null);
      setInstallPromptOpen(false);
    } finally {
      setInstallPromptBusy(false);
    }
  };

  const handleCopyInstallLink = async () => {
    try {
      await navigator.clipboard.writeText(getPortalAppUrl());
    } catch {}
  };

  const handleCloseInstallPrompt = () => {
    try {
      localStorage.setItem(PORTAL_INSTALL_DISMISSED_KEY, '1');
    } catch {}
    setInstallBannerDismissed(true);
    setInstallPromptOpen(false);
  };

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.portalRoute) navigate(data.portalRoute as PortalRoute, data.portalParam);
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [navigate]);

  // Busca contagem de assinaturas pendentes para mostrar/ocultar "Assinar" na nav
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    clientPortalService.listSignaturesPending(session.user.id)
      .then((sigs) => {
        if (cancelled) return;
        const count = Array.isArray(sigs)
          ? sigs.filter((s) => {
              const rec = s as Record<string, unknown>;
              return rec.status === 'pending' || rec.status === 'in_progress';
            }).length
          : 0;
        setSignaturesPending(count);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session?.user?.id, route]); // atualiza a cada navegação

  return (
    <div
      className="portal-shell h-[100dvh] min-h-[100dvh] max-h-[100dvh] overflow-hidden overscroll-none bg-slate-50"
      style={{ fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif" }}
    >
      <div className="relative flex h-full min-h-0">
        <PortalSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PortalHeader onMenuClick={() => setSidebarOpen(true)} />

          {!!session && showInstallSuggestion && route !== 'app' && !installBannerDismissed && (
            <div className="px-3 pt-[calc(env(safe-area-inset-top)+4.5rem)] lg:hidden">
              <div className="flex items-start gap-3 rounded-[22px] border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-4 py-3 shadow-[0_10px_24px_rgba(249,115,22,0.08)]">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-[0_10px_20px_rgba(249,115,22,0.25)]">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900">Baixe nosso app</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">
                    {isIos
                      ? 'No iPhone, instale na Tela de Início para usar como app e liberar notificações.'
                      : 'Instale no celular para abrir com atalho e usar o portal como aplicativo.'}
                  </p>
                  <button
                    onClick={() => navigate('app')}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-orange-600 shadow-sm transition hover:bg-orange-100"
                  >
                    Ver como instalar
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  onClick={handleCloseInstallPrompt}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
                  aria-label="Fechar aviso"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <main ref={mainRef} className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-slate-50">
            <div className="mx-auto w-full max-w-7xl px-3 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-[calc(env(safe-area-inset-top)+4.75rem)] sm:px-5 sm:pb-6 sm:pt-6 lg:px-6 lg:py-5">
              {children}
            </div>
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 lg:hidden">
        <div
          className="overflow-hidden bg-white shadow-[0_-1px_0_rgba(15,23,42,0.08),0_-16px_40px_rgba(15,23,42,0.07)] backdrop-blur-2xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-stretch px-1 pt-2 pb-1">
            {BOTTOM_NAV
              .filter(({ id }) => {
                if (id === 'dashboard') return true;
                return isEnabled(id as never);
              })
              .map(({ id, icon: Icon, label }) => {
                const active = route === id;
                const badge = id === 'assinar' && signaturesPending > 0 ? signaturesPending : 0;
                return (
                  <button
                    key={id}
                    onClick={() => navigate(id)}
                    className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-2 transition-all duration-150 ${
                      active ? 'text-orange-500' : 'text-slate-400 active:text-slate-600'
                    }`}
                  >
                    <span className="relative">
                      <Icon
                        className="h-[22px] w-[22px] shrink-0 transition-transform duration-150"
                        strokeWidth={active ? 2.5 : 1.75}
                        style={active ? { transform: 'scale(1.08)' } : undefined}
                      />
                      {badge > 0 && (
                        <span className="absolute -right-1.5 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-0.5 text-[9px] font-bold text-white ring-2 ring-white">
                          {badge}
                        </span>
                      )}
                    </span>
                    <span className={`truncate text-[10px] font-bold leading-none tracking-tight transition-colors ${active ? 'text-orange-500' : 'text-slate-400'}`}>
                      {label}
                    </span>
                    {active && (
                      <span className="absolute bottom-0 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-t-full bg-orange-500" />
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      </nav>

      <PushToastOverlay toasts={toasts} onDismiss={dismissToast} />
      <PortalInstallAppPrompt
        open={installPromptOpen && !!session && showInstallSuggestion}
        ios={isIos}
        canInstall={!isIos && !!deferredInstallPrompt}
        busy={installPromptBusy}
        onInstall={handleInstall}
        onCopyLink={handleCopyInstallLink}
        onClose={handleCloseInstallPrompt}
      />
      <PortalChatWidget />
    </div>
  );
};
