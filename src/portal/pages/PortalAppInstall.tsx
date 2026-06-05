import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bell, BellOff, CheckCircle2, Copy, Download, Share2, Sparkles } from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import {
  BeforeInstallPromptEvent,
  canUsePushNotifications,
  getPortalAppUrl,
  isIosDevice,
  isStandaloneDisplay,
} from '../lib/pwa';

const IllustrationIOS: React.FC = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-auto w-full max-h-64">
    <defs>
      <linearGradient id="ios-card" x1="28" y1="12" x2="292" y2="248" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFF7ED" />
        <stop offset="1" stopColor="#FFE7D6" />
      </linearGradient>
      <linearGradient id="ios-screen" x1="74" y1="46" x2="246" y2="232" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F8FAFC" />
        <stop offset="1" stopColor="#EEF2FF" />
      </linearGradient>
      <filter id="ios-shadow" x="0" y="0" width="320" height="260" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="16" stdDeviation="18" floodColor="#0F172A" floodOpacity="0.14" />
      </filter>
      <filter id="ios-sheet" x="82" y="128" width="156" height="100" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0F172A" floodOpacity="0.12" />
      </filter>
    </defs>

    <rect x="28" y="12" width="264" height="236" rx="36" fill="url(#ios-card)" />
    <circle cx="62" cy="44" r="8" fill="#FDBA74" />
    <circle cx="256" cy="48" r="6" fill="#FED7AA" />
    <circle cx="246" cy="204" r="10" fill="#FDBA74" fillOpacity="0.35" />

    <g filter="url(#ios-shadow)">
      <rect x="88" y="24" width="144" height="212" rx="30" fill="#1E293B" />
      <rect x="94" y="30" width="132" height="200" rx="24" fill="url(#ios-screen)" />
      <rect x="128" y="38" width="64" height="14" rx="7" fill="#1E293B" />

      <rect x="106" y="58" width="108" height="20" rx="10" fill="#FFFFFF" />
      <rect x="114" y="65" width="58" height="6" rx="3" fill="#CBD5E1" />
      <rect x="184" y="61" width="22" height="14" rx="7" fill="#FFEDD5" />
      <path d="M194 64v8m0 0-3-3m3 3 3-3" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

      <rect x="106" y="90" width="108" height="74" rx="18" fill="#FFFFFF" />
      <rect x="118" y="104" width="44" height="44" rx="14" fill="#F97316" />
      <text x="140" y="132" textAnchor="middle" fill="#fff" fontSize="24" fontWeight="800" fontFamily="Inter, system-ui, sans-serif">J</text>
      <rect x="170" y="106" width="30" height="8" rx="4" fill="#0F172A" fillOpacity="0.92" />
      <rect x="170" y="120" width="24" height="6" rx="3" fill="#94A3B8" />
      <rect x="118" y="176" width="94" height="8" rx="4" fill="#E2E8F0" />
      <rect x="118" y="190" width="68" height="8" rx="4" fill="#E2E8F0" />
    </g>

    <g filter="url(#ios-sheet)">
      <rect x="92" y="138" width="136" height="78" rx="22" fill="#FFFFFF" />
      <rect x="93" y="139" width="134" height="76" rx="21" stroke="#F1F5F9" strokeWidth="1.5" />
      <text x="160" y="156" textAnchor="middle" fill="#94A3B8" fontSize="10" fontWeight="600" fontFamily="Inter, system-ui, sans-serif">Compartilhar</text>
      <rect x="106" y="168" width="26" height="26" rx="9" fill="#F97316" />
      <path d="M119 175v11m0-11-4 4m4-4 4 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="142" y="171" width="68" height="8" rx="4" fill="#0F172A" fillOpacity="0.92" />
      <rect x="142" y="185" width="52" height="6" rx="3" fill="#94A3B8" />
      <text x="142" y="178" fill="#0F172A" fontSize="10.5" fontWeight="700" fontFamily="Inter, system-ui, sans-serif">Adicionar à Tela de Início</text>
      <text x="142" y="190" fill="#94A3B8" fontSize="8.5" fontFamily="Inter, system-ui, sans-serif">Abrir como aplicativo no iPhone</text>
    </g>
  </svg>
);

const IllustrationAndroid: React.FC = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-auto w-full max-h-64">
    <defs>
      <linearGradient id="android-card" x1="28" y1="12" x2="292" y2="248" gradientUnits="userSpaceOnUse">
        <stop stopColor="#EFF6FF" />
        <stop offset="1" stopColor="#FFF7ED" />
      </linearGradient>
      <linearGradient id="android-screen" x1="74" y1="42" x2="250" y2="228" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F8FAFC" />
        <stop offset="1" stopColor="#FFF7ED" />
      </linearGradient>
      <filter id="android-shadow" x="0" y="0" width="320" height="260" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="16" stdDeviation="18" floodColor="#0F172A" floodOpacity="0.14" />
      </filter>
      <filter id="android-prompt" x="72" y="140" width="176" height="84" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#0F172A" floodOpacity="0.12" />
      </filter>
    </defs>

    <rect x="28" y="12" width="264" height="236" rx="36" fill="url(#android-card)" />
    <circle cx="70" cy="210" r="10" fill="#BFDBFE" />
    <circle cx="248" cy="46" r="8" fill="#FDBA74" fillOpacity="0.6" />

    <g filter="url(#android-shadow)">
      <rect x="86" y="24" width="148" height="212" rx="30" fill="#1E293B" />
      <rect x="92" y="30" width="136" height="200" rx="24" fill="url(#android-screen)" />
      <circle cx="160" cy="42" r="4" fill="#475569" />

      <rect x="104" y="56" width="112" height="18" rx="9" fill="#FFFFFF" />
      <rect x="112" y="62" width="58" height="6" rx="3" fill="#CBD5E1" />
      <rect x="188" y="59" width="20" height="12" rx="6" fill="#F97316" />
      <path d="M198 62v6m0 0-3-3m3 3 3-3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

      <rect x="104" y="86" width="112" height="84" rx="20" fill="#FFFFFF" />
      <rect x="120" y="102" width="40" height="40" rx="13" fill="#F97316" />
      <text x="140" y="128" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" fontFamily="Inter, system-ui, sans-serif">J</text>
      <rect x="170" y="104" width="28" height="8" rx="4" fill="#0F172A" fillOpacity="0.92" />
      <rect x="170" y="118" width="22" height="6" rx="3" fill="#94A3B8" />
      <rect x="120" y="182" width="82" height="8" rx="4" fill="#E2E8F0" />
      <rect x="120" y="196" width="66" height="8" rx="4" fill="#E2E8F0" />
    </g>

    <g filter="url(#android-prompt)">
      <rect x="82" y="150" width="156" height="62" rx="22" fill="#FFFFFF" />
      <rect x="83" y="151" width="154" height="60" rx="21" stroke="#F1F5F9" strokeWidth="1.5" />
      <rect x="96" y="164" width="34" height="34" rx="12" fill="#FFF7ED" />
      <path d="M113 170v16m0 0-5-5m5 5 5-5" stroke="#F97316" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <text x="142" y="176" fill="#0F172A" fontSize="12" fontWeight="700" fontFamily="Inter, system-ui, sans-serif">Instalar aplicativo</text>
      <text x="142" y="191" fill="#94A3B8" fontSize="9.5" fontFamily="Inter, system-ui, sans-serif">Adicionar Jurius Portal à tela inicial</text>
      <rect x="142" y="197" width="54" height="8" rx="4" fill="#F97316" fillOpacity="0.16" />
    </g>
  </svg>
);

const IllustrationPush: React.FC = () => (
  <svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-auto w-full max-h-56">
    <defs>
      <linearGradient id="push-bg" x1="24" y1="12" x2="296" y2="208" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFF7ED" />
        <stop offset="1" stopColor="#FFE4D6" />
      </linearGradient>
      <filter id="push-phone" x="56" y="18" width="152" height="188" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#0F172A" floodOpacity="0.14" />
      </filter>
      <filter id="push-banner" x="78" y="18" width="164" height="82" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#0F172A" floodOpacity="0.16" />
      </filter>
    </defs>

    <rect x="24" y="12" width="272" height="196" rx="32" fill="url(#push-bg)" />
    <circle cx="58" cy="48" r="8" fill="#FDBA74" />
    <circle cx="268" cy="180" r="10" fill="#FED7AA" />

    <g filter="url(#push-phone)">
      <rect x="86" y="28" width="92" height="164" rx="24" fill="#1E293B" />
      <rect x="92" y="34" width="80" height="152" rx="18" fill="#F8FAFC" />
      <rect x="118" y="40" width="28" height="8" rx="4" fill="#1E293B" />
      <rect x="102" y="58" width="18" height="18" rx="6" fill="#F97316" />
      <text x="111" y="70" textAnchor="middle" fill="#fff" fontSize="8.5" fontWeight="800" fontFamily="Inter, system-ui, sans-serif">J</text>
      <rect x="124" y="60" width="16" height="16" rx="5" fill="#E2E8F0" />
      <rect x="144" y="60" width="16" height="16" rx="5" fill="#E2E8F0" />
      <rect x="102" y="82" width="16" height="16" rx="5" fill="#E2E8F0" />
      <rect x="122" y="82" width="16" height="16" rx="5" fill="#E2E8F0" />
      <rect x="142" y="82" width="16" height="16" rx="5" fill="#E2E8F0" />
    </g>

    <g filter="url(#push-banner)">
      <rect x="92" y="30" width="136" height="56" rx="18" fill="#FFFFFF" />
      <rect x="93" y="31" width="134" height="54" rx="17" stroke="#F1F5F9" strokeWidth="1.5" />
      <rect x="104" y="42" width="24" height="24" rx="8" fill="#F97316" />
      <text x="116" y="58" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="Inter, system-ui, sans-serif">J</text>
      <text x="138" y="49" fill="#0F172A" fontSize="11" fontWeight="700" fontFamily="Inter, system-ui, sans-serif">Jurius Portal</text>
      <text x="138" y="63" fill="#64748B" fontSize="9.5" fontFamily="Inter, system-ui, sans-serif">Nova mensagem do escritório</text>
      <circle cx="210" cy="44" r="4" fill="#34D399" />
    </g>

    <circle cx="248" cy="102" r="26" fill="#FFFFFF" fillOpacity="0.72" />
    <circle cx="248" cy="102" r="18" fill="#FFEDD5" />
    <path d="M248 88c-6.1 0-11 4.9-11 11v5.8l-3 3V110h28v-2.2l-3-3V99c0-6.1-4.9-11-11-11zm0 25c-1.7 0-3-1.3-3-3h6c0 1.7-1.3 3-3 3z" fill="#F97316" />
    <path d="M60 154c16-12 32-18 48-18 14 0 28 5 42 15" stroke="#FDBA74" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 10" />
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
            <>
              <div className="mt-4 overflow-hidden rounded-[22px] border border-orange-100 bg-white/75">
                <IllustrationPush />
              </div>
              <button
                onClick={handleActivatePush}
                disabled={activating}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(249,115,22,0.30)] transition hover:opacity-90 disabled:opacity-60"
              >
                <Bell className="h-4 w-4" />
                {activating ? 'Ativando...' : 'Ativar notificações push'}
              </button>
            </>
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
          <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_8px_28px_rgba(15,23,42,0.07)] ring-1 ring-slate-100">
            <div className="bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.12),_transparent_45%),linear-gradient(180deg,_#fff_0%,_#fffaf5_100%)] px-5 pt-5">
              <IllustrationIOS />
            </div>
            <div className="p-5">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
                  <Share2 className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">iPhone</p>
                  <p className="text-xs text-slate-400">Safari</p>
                </div>
              </div>
              <ol className="space-y-2 text-sm text-slate-600">
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
          </div>

          <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_8px_28px_rgba(15,23,42,0.07)] ring-1 ring-slate-100">
            <div className="bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_45%),linear-gradient(180deg,_#fff_0%,_#f8fbff_100%)] px-5 pt-5">
              <IllustrationAndroid />
            </div>
            <div className="p-5">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
                  <Download className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Android</p>
                  <p className="text-xs text-slate-400">Chrome · Brave · Edge</p>
                </div>
              </div>
              <ol className="space-y-2 text-sm text-slate-600">
                {[
                  <>Abra o portal no navegador</>,
                  <>Toque em <strong className="text-slate-800">Instalar aplicativo</strong></>,
                  <>Ou use <strong className="text-slate-800">⋮ → Adicionar à tela inicial</strong></>,
                  <>Abra o app instalado</>,
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
