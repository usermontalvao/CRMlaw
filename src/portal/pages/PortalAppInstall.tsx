import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Copy, Download, ExternalLink, Info, Share2, Smartphone } from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import {
  BeforeInstallPromptEvent,
  getPortalAppUrl,
  isIosDevice,
  isStandaloneDisplay,
} from '../lib/pwa';

export const PortalAppInstall: React.FC = () => {
  const { navigate } = usePortalRouter();
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const isIos = isIosDevice();
  const isInstalled = isStandaloneDisplay();

  useEffect(() => {
    const handler = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      event.preventDefault?.();
      setDeferredPrompt(promptEvent);
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
    try {
      setInstalling(true);
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      setDeferredPrompt(null);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.06)]">
        <button
          onClick={() => navigate('dashboard')}
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </button>

        <div className="mt-4 flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-[0_12px_26px_rgba(249,115,22,0.28)]">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Baixe nosso app</h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Instale o portal no celular para abrir como aplicativo, usar atalho na tela inicial e receber notificações com mais consistência.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/80 p-4">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
            <div className="text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Status atual</p>
              <p className="mt-1">
                {isInstalled
                  ? 'Este portal já está aberto como aplicativo instalado.'
                  : isIos
                    ? 'No iPhone, as notificações web funcionam corretamente quando o portal está instalado na Tela de Início.'
                    : 'No Android, você pode instalar este portal como aplicativo pelo navegador compatível.'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {!isIos && !!deferredPrompt && !isInstalled && (
            <button
              onClick={handleInstall}
              disabled={installing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {installing ? 'Instalando...' : 'Instalar aplicativo'}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Link copiado' : 'Copiar link do portal'}
          </button>
          <a
            href={getPortalAppUrl()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir link do portal
          </a>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Android</h2>
              <p className="text-xs text-slate-500">Chrome e navegadores compatíveis</p>
            </div>
          </div>

          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
            <li><span className="font-semibold text-slate-900">1.</span> Abra o portal normalmente no celular.</li>
            <li><span className="font-semibold text-slate-900">2.</span> Toque em <span className="font-semibold">Instalar aplicativo</span> quando o botão aparecer.</li>
            <li><span className="font-semibold text-slate-900">3.</span> Se o navegador não mostrar o botão, abra o menu e procure <span className="font-semibold">Instalar app</span> ou <span className="font-semibold">Adicionar à tela inicial</span>.</li>
            <li><span className="font-semibold text-slate-900">4.</span> Abra o atalho criado para usar o portal como aplicativo.</li>
          </ol>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-sky-50 p-2 text-sky-600">
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">iPhone</h2>
              <p className="text-xs text-slate-500">Safari + Adicionar à Tela de Início</p>
            </div>
          </div>

          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
            <li><span className="font-semibold text-slate-900">1.</span> Abra este portal no <span className="font-semibold">Safari</span>.</li>
            <li><span className="font-semibold text-slate-900">2.</span> Toque em <span className="font-semibold">Compartilhar</span>.</li>
            <li><span className="font-semibold text-slate-900">3.</span> Selecione <span className="font-semibold">Adicionar à Tela de Início</span>.</li>
            <li><span className="font-semibold text-slate-900">4.</span> Abra o atalho criado. É desse modo que o portal funciona como app no iPhone.</li>
          </ol>
        </section>
      </div>
    </div>
  );
};

export default PortalAppInstall;
