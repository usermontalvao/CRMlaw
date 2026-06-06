import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, BellOff, CheckCircle2, Copy, Download, Share2, Smartphone, Sparkles } from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import {
  BeforeInstallPromptEvent,
  canUsePushNotifications,
  getPortalAppUrl,
  isIosDevice,
  isStandaloneDisplay,
} from '../lib/pwa';

// Ilustrações removidas a pedido do usuário

const _IllustrationIOS: React.FC = () => (
  <svg viewBox="0 0 320 240" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-auto w-full max-h-56" aria-hidden="true">
    {/* Background card */}
    <rect x="20" y="8" width="280" height="224" rx="32" fill="#FFF7ED" />
    <rect x="20" y="8" width="280" height="224" rx="32" fill="url(#ios-grad)" />
    <defs>
      <linearGradient id="ios-grad" x1="20" y1="8" x2="300" y2="232" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFF7ED" />
        <stop offset="1" stopColor="#FFE4CC" />
      </linearGradient>
    </defs>
    {/* Decorative dots */}
    <circle cx="56" cy="42" r="10" fill="#FDBA74" fillOpacity="0.55" />
    <circle cx="262" cy="52" r="7" fill="#FED7AA" fillOpacity="0.7" />
    <circle cx="250" cy="198" r="12" fill="#FDBA74" fillOpacity="0.25" />
    {/* Phone */}
    <rect x="90" y="20" width="140" height="200" rx="26" fill="#1E293B" />
    <rect x="97" y="27" width="126" height="186" rx="20" fill="#F1F5F9" />
    {/* Notch */}
    <rect x="130" y="33" width="60" height="11" rx="5.5" fill="#1E293B" />
    {/* Browser bar */}
    <rect x="108" y="55" width="104" height="17" rx="8.5" fill="#FFFFFF" />
    <rect x="116" y="61" width="48" height="5" rx="2.5" fill="#CBD5E1" />
    {/* Share chip */}
    <rect x="186" y="58" width="18" height="11" rx="5.5" fill="#FFF3E0" />
    <path d="M195 61.5v5m0-5-2 2m2-2 2 2" stroke="#F97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    {/* App card */}
    <rect x="108" y="82" width="104" height="66" rx="14" fill="#FFFFFF" />
    {/* Orange app icon — plain, no letter */}
    <rect x="118" y="93" width="38" height="38" rx="11" fill="#F97316" />
    <circle cx="137" cy="112" r="8" fill="#FFFFFF" fillOpacity="0.25" />
    <circle cx="137" cy="112" r="4" fill="#FFFFFF" fillOpacity="0.6" />
    {/* App name/sub bars */}
    <rect x="164" y="96" width="36" height="7" rx="3.5" fill="#0F172A" fillOpacity="0.8" />
    <rect x="164" y="108" width="28" height="5" rx="2.5" fill="#CBD5E1" />
    {/* Content lines */}
    <rect x="118" y="162" width="80" height="6" rx="3" fill="#E2E8F0" />
    <rect x="118" y="173" width="60" height="6" rx="3" fill="#E2E8F0" />
    {/* Share sheet */}
    <rect x="88" y="132" width="144" height="70" rx="20" fill="#FFFFFF" />
    <rect x="88" y="132" width="144" height="70" rx="20" stroke="#E8EDF2" strokeWidth="1" />
    {/* Drag handle */}
    <rect x="148" y="140" width="24" height="4" rx="2" fill="#E2E8F0" />
    {/* Upload action */}
    <rect x="100" y="152" width="26" height="26" rx="8" fill="#F97316" />
    <path d="M113 157v12m0-12-3.5 3.5M113 157l3.5 3.5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    {/* Action text bars */}
    <rect x="134" y="155" width="68" height="7" rx="3.5" fill="#0F172A" fillOpacity="0.8" />
    <rect x="134" y="167" width="52" height="5" rx="2.5" fill="#CBD5E1" />
  </svg>
);

const _IllustrationAndroid: React.FC = () => (
  <svg viewBox="0 0 320 240" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-auto w-full max-h-56" aria-hidden="true">
    <defs>
      <linearGradient id="and-grad" x1="20" y1="8" x2="300" y2="232" gradientUnits="userSpaceOnUse">
        <stop stopColor="#EFF6FF" />
        <stop offset="1" stopColor="#FFF7ED" />
      </linearGradient>
    </defs>
    {/* Background card */}
    <rect x="20" y="8" width="280" height="224" rx="32" fill="url(#and-grad)" />
    {/* Decorative dots */}
    <circle cx="66" cy="204" r="12" fill="#BFDBFE" fillOpacity="0.7" />
    <circle cx="252" cy="44" r="9" fill="#FDBA74" fillOpacity="0.55" />
    {/* Phone */}
    <rect x="88" y="18" width="144" height="204" rx="26" fill="#1E293B" />
    <rect x="95" y="25" width="130" height="190" rx="20" fill="#F8FAFC" />
    {/* Camera */}
    <circle cx="160" cy="37" r="4" fill="#475569" />
    {/* Browser bar */}
    <rect x="106" y="53" width="108" height="17" rx="8.5" fill="#FFFFFF" />
    <rect x="114" y="59" width="54" height="5" rx="2.5" fill="#CBD5E1" />
    {/* Install button in bar */}
    <rect x="186" y="56" width="20" height="11" rx="5.5" fill="#F97316" />
    <path d="M196 59v5m0 0-2.5-2.5M196 64l2.5-2.5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    {/* App card */}
    <rect x="106" y="80" width="108" height="80" rx="16" fill="#FFFFFF" />
    {/* Orange app icon — plain */}
    <rect x="118" y="92" width="38" height="38" rx="11" fill="#F97316" />
    <circle cx="137" cy="111" r="8" fill="#FFFFFF" fillOpacity="0.25" />
    <circle cx="137" cy="111" r="4" fill="#FFFFFF" fillOpacity="0.6" />
    {/* App name/sub bars */}
    <rect x="164" y="95" width="34" height="7" rx="3.5" fill="#0F172A" fillOpacity="0.8" />
    <rect x="164" y="107" width="26" height="5" rx="2.5" fill="#CBD5E1" />
    {/* Content lines */}
    <rect x="118" y="168" width="78" height="6" rx="3" fill="#E2E8F0" />
    <rect x="118" y="179" width="58" height="6" rx="3" fill="#E2E8F0" />
    {/* Install prompt card */}
    <rect x="84" y="148" width="152" height="56" rx="18" fill="#FFFFFF" />
    <rect x="84" y="148" width="152" height="56" rx="18" stroke="#E8EDF2" strokeWidth="1" />
    {/* Download icon box */}
    <rect x="97" y="160" width="30" height="30" rx="10" fill="#FFF7ED" />
    <path d="M112 165v14m0 0-3.5-3.5M112 179l3.5-3.5M106 180h12" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    {/* Prompt text bars */}
    <rect x="135" y="163" width="74" height="7" rx="3.5" fill="#0F172A" fillOpacity="0.8" />
    <rect x="135" y="175" width="56" height="5" rx="2.5" fill="#CBD5E1" />
    <rect x="135" y="185" width="40" height="5" rx="2.5" fill="#F97316" fillOpacity="0.18" />
  </svg>
);

const _IllustrationPush: React.FC = () => (
  <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-auto w-full max-h-48" aria-hidden="true">
    <defs>
      <linearGradient id="push-grad" x1="16" y1="8" x2="304" y2="192" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFF7ED" />
        <stop offset="1" stopColor="#FFE4D6" />
      </linearGradient>
    </defs>
    {/* Background */}
    <rect x="16" y="8" width="288" height="184" rx="30" fill="url(#push-grad)" />
    {/* Decorative dots */}
    <circle cx="50" cy="44" r="9" fill="#FDBA74" fillOpacity="0.7" />
    <circle cx="272" cy="162" r="11" fill="#FED7AA" fillOpacity="0.6" />
    {/* Phone body */}
    <rect x="84" y="22" width="92" height="156" rx="22" fill="#1E293B" />
    <rect x="90" y="28" width="80" height="144" rx="16" fill="#F8FAFC" />
    {/* Notch */}
    <rect x="114" y="34" width="32" height="8" rx="4" fill="#1E293B" />
    {/* App grid — plain colored squares, no letters */}
    <rect x="98" y="52" width="18" height="18" rx="6" fill="#F97316" />
    <rect x="120" y="52" width="18" height="18" rx="6" fill="#E2E8F0" />
    <rect x="142" y="52" width="18" height="18" rx="6" fill="#E2E8F0" />
    <rect x="98"  y="74" width="18" height="18" rx="6" fill="#E2E8F0" />
    <rect x="120" y="74" width="18" height="18" rx="6" fill="#E2E8F0" />
    <rect x="142" y="74" width="18" height="18" rx="6" fill="#E2E8F0" />
    {/* Notification banner overlay */}
    <rect x="88" y="28" width="144" height="50" rx="14" fill="#FFFFFF" />
    <rect x="88" y="28" width="144" height="50" rx="14" stroke="#E8EDF2" strokeWidth="1" />
    {/* App icon in notif — orange square, no letter */}
    <rect x="98" y="37" width="22" height="22" rx="7" fill="#F97316" />
    <circle cx="109" cy="48" r="5" fill="#FFFFFF" fillOpacity="0.3" />
    <circle cx="109" cy="48" r="2.5" fill="#FFFFFF" fillOpacity="0.7" />
    {/* Notif text bars */}
    <rect x="128" y="39" width="58" height="6" rx="3" fill="#0F172A" fillOpacity="0.8" />
    <rect x="128" y="50" width="76" height="5" rx="2.5" fill="#CBD5E1" />
    {/* Green online dot */}
    <circle cx="216" cy="40" r="4" fill="#34D399" />
    {/* Bell circle */}
    <circle cx="252" cy="96" r="26" fill="#FFFFFF" fillOpacity="0.75" />
    <circle cx="252" cy="96" r="18" fill="#FFEDD5" />
    {/* Bell shape — path only, no complex arcs */}
    <path d="M252 80c-6.6 0-12 5.4-12 12v6l-3 3v2h30v-2l-3-3v-6c0-6.6-5.4-12-12-12z" fill="#F97316" fillOpacity="0.9" />
    <rect x="249" y="103" width="6" height="5" rx="3" fill="#F97316" />
    {/* Dotted arc connecting phone to bell */}
    <path d="M182 100c10-8 22-12 34-12s24 4 32 10" stroke="#FDBA74" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 8" />
  </svg>
);

export const PortalAppInstall: React.FC = () => {
  const { navigate } = usePortalRouter();
  const { pushEnabled, requestPushPermission } = usePortalNotifications();
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [activating, setActivating] = useState(false);
  const [pushDone, setPushDone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const isIos = isIosDevice();
  const isInstalled = isStandaloneDisplay();
  const canPush = canUsePushNotifications();
  const notifDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied';

  useEffect(() => {
    const handler = (event: Event) => {
      (event as BeforeInstallPromptEvent).preventDefault?.();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getPortalAppUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      setDeferredPrompt(null);
    } finally {
      setInstalling(false);
    }
  };

  const handleActivatePush = async () => {
    setActivating(true);
    try {
      const enabled = await requestPushPermission();
      if (enabled) setPushDone(true);
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('dashboard')}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-semibold text-slate-900">Aplicativo</h1>
      </div>

      <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_8px_28px_rgba(15,23,42,0.07)] ring-1 ring-slate-100">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.16),_transparent_40%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,_#ffffff_0%,_#fffaf6_100%)] p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-orange-500 shadow-[0_10px_24px_rgba(249,115,22,0.30)]">
              <span className="text-xl font-extrabold text-white">J</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[16px] font-bold tracking-tight text-slate-900">Jurius Portal</p>
                <Sparkles className="h-4 w-4 text-orange-400" />
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {isInstalled ? 'Instalado como aplicativo' : 'Disponível para instalar'}
              </p>
              {isInstalled && (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  App instalado
                </span>
              )}
            </div>
          </div>

          {isInstalled && canPush && !pushEnabled && !pushDone && !notifDenied && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center gap-3 rounded-2xl bg-orange-50 px-4 py-3">
                <Bell className="h-5 w-5 shrink-0 text-orange-500" />
                <p className="text-sm text-slate-700">Ative as notificações para receber atualizações dos seus processos em tempo real.</p>
              </div>
              <button
                onClick={handleActivatePush}
                disabled={activating}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(249,115,22,0.30)] transition hover:opacity-90 disabled:opacity-60"
              >
                <Bell className="h-4 w-4" />
                {activating ? 'Ativando...' : 'Ativar notificações push'}
              </button>
            </div>
          )}

          {(pushEnabled || pushDone) && (
            <div className="mt-4 flex items-center gap-2.5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="font-medium">Notificações push ativadas</span>
            </div>
          )}

          {notifDenied && (
            <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>Notificações bloqueadas. Vá em <strong>Configurações → Safari → Notificações</strong> para reativar.</span>
            </div>
          )}

          {isInstalled && isIos && !canPush && !notifDenied && (
            <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-medium">Requer iOS 16.4 ou superior</p>
              <p className="mt-0.5 text-amber-700/80">Atualize o iPhone para receber notificações push.</p>
            </div>
          )}

          {!isIos && !!deferredPrompt && !isInstalled && (
            <button
              onClick={handleInstall}
              disabled={installing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(249,115,22,0.30)] transition hover:opacity-90 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {installing ? 'Instalando...' : 'Instalar aplicativo'}
            </button>
          )}

          <button
            onClick={handleCopy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/85 py-3 text-sm font-semibold text-slate-600 transition hover:bg-white"
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Link copiado!' : 'Copiar link do portal'}
          </button>
        </div>
      </div>

      {!isInstalled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[24px] bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.07)] ring-1 ring-slate-100">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                  <Share2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">iPhone</p>
                  <p className="text-xs text-slate-400">Safari</p>
                </div>
              </div>
              <ol className="space-y-2.5 text-sm text-slate-600">
                {[
                  <>Abra no <strong className="text-slate-800">Safari</strong></>,
                  <>Toque em <strong className="text-slate-800">Compartilhar ↑</strong></>,
                  <><strong className="text-slate-800">Adicionar à Tela de Início</strong></>,
                  <>Abra o app e ative as notificações</>,
                ].map((step, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-600">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
          </div>

          <div className="rounded-[24px] bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.07)] ring-1 ring-slate-100">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <Smartphone className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Android</p>
                  <p className="text-xs text-slate-400">Chrome · Brave · Edge</p>
                </div>
              </div>

              {/* Botão direto quando o navegador suporta beforeinstallprompt */}
              {!!deferredPrompt ? (
                <button
                  onClick={handleInstall}
                  disabled={installing}
                  className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 py-3 text-sm font-bold text-white shadow-[0_4px_14px_rgba(249,115,22,0.28)] transition active:opacity-90 disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  {installing ? 'Instalando…' : 'Adicionar à tela inicial'}
                </button>
              ) : (
                <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Abra no <strong>Chrome</strong> ou <strong>Edge</strong> para instalar com um clique.
                </p>
              )}

              <ol className="space-y-2.5 text-sm text-slate-600">
                {(!!deferredPrompt
                  ? [
                      <>Toque em <strong className="text-slate-800">Adicionar à tela inicial</strong> acima</>,
                      <>Confirme a instalação</>,
                      <>Abra o app instalado</>,
                    ]
                  : [
                      <>Abra o portal no <strong className="text-slate-800">Chrome</strong></>,
                      <>Toque em <strong className="text-slate-800">⋮ → Instalar app</strong></>,
                      <>Ou aguarde o banner de instalação aparecer</>,
                      <>Abra o app instalado</>,
                    ]
                ).map((step, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-600">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
          </div>
        </div>
      )}

      {isInstalled && isIos && !pushEnabled && !pushDone && (
        <div className="rounded-[24px] bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.07)] ring-1 ring-slate-100">
          <p className="mb-1 text-sm font-bold text-slate-900">Como funcionam as notificações no iPhone</p>
          <p className="text-sm leading-relaxed text-slate-500">
            No iOS, notificações push só funcionam quando o portal está instalado como app.
            Toque em <strong className="text-slate-700">Ativar notificações push</strong> acima e autorize quando o iPhone perguntar.
          </p>
        </div>
      )}
    </div>
  );
};

export default PortalAppInstall;
