import React from 'react';
import { X } from 'lucide-react';

export const WHATSAPP_TOAST_DURATION_MS = 5500;

export interface WhatsAppMessageToastData {
  id: string;
  conversationId: string;
  name: string;
  preview: string;
}

interface WhatsAppMessageToastProps {
  toast: WhatsAppMessageToastData;
  onDismiss: () => void;
  onOpen: (conversationId: string) => void | Promise<void>;
}

function displayContactName(name: string): string {
  return /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ\s]+$/.test(name)
    ? name.toLowerCase().replace(/\b\w/g, character => character.toUpperCase())
    : name;
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'W';
}

/** Aviso compacto de mensagem recebida, posicionado acima do widget global. */
export const WhatsAppMessageToast: React.FC<WhatsAppMessageToastProps> = ({ toast, onDismiss, onOpen }) => (
  <div
    data-testid="whatsapp-message-toast"
    className="mb-2 w-[286px] max-w-[calc(100vw-20px)]"
    style={{
      animation: `whatsappToastIn 200ms cubic-bezier(.2,.8,.2,1) both, whatsappToastOut 220ms ${WHATSAPP_TOAST_DURATION_MS - 220}ms ease-in both`,
    }}
  >
    <style>{`
      @keyframes whatsappToastIn{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes whatsappToastOut{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(5px) scale(.99)}}
      @keyframes whatsappToastProgress{from{transform:scaleX(1)}to{transform:scaleX(0)}}
    `}</style>

    <div
      className="relative overflow-hidden rounded-[14px] border border-slate-200/90 bg-white/95"
      style={{
        boxShadow: '0 10px 28px -16px rgba(15,23,42,.38), 0 2px 8px -5px rgba(15,23,42,.18)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          onDismiss();
        }}
        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
        title="Dispensar"
        aria-label="Dispensar notificação"
      >
        <X className="h-3 w-3" />
      </button>

      <button
        type="button"
        aria-label={`Abrir conversa com ${toast.name}`}
        className="relative flex w-full items-center gap-2.5 py-2.5 pl-2.5 pr-8 text-left transition-colors hover:bg-slate-50/80 active:bg-slate-100/80"
        onClick={() => { void onOpen(toast.conversationId); }}
      >
        <span className="relative shrink-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-[12px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-100">
            {initialsOf(toast.name)}
          </span>
          <span className="absolute -bottom-px -right-px flex h-[15px] w-[15px] items-center justify-center rounded-full bg-white ring-1 ring-white">
            <span className="flex h-[13px] w-[13px] items-center justify-center rounded-full bg-[#20b85a]">
              <svg viewBox="0 0 24 24" className="h-[9px] w-[9px]" fill="#ffffff" aria-hidden>
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.84 9.84 0 0 0 12.04 2zm5.9 13.98c-.25.7-1.45 1.34-2 1.42-.53.08-1.18.11-1.91-.12-.44-.14-1-.32-1.72-.63-3.03-1.31-5.01-4.36-5.16-4.56-.15-.2-1.23-1.64-1.23-3.12 0-1.49.78-2.22 1.06-2.52.28-.31.61-.38.81-.38.2 0 .41 0 .58.01.19.01.44-.07.69.53.25.61.86 2.1.94 2.25.08.15.13.33.02.53-.1.2-.15.33-.3.5-.15.18-.32.39-.46.53-.15.15-.31.31-.13.61.18.3.79 1.3 1.7 2.11 1.17 1.04 2.15 1.36 2.46 1.51.3.15.48.13.66-.08.18-.2.76-.89.96-1.19.2-.3.41-.25.69-.15.28.1 1.77.83 2.07.99.3.15.5.22.58.35.07.12.07.72-.18 1.42z" />
              </svg>
            </span>
          </span>
        </span>

        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5 pr-1">
            <span className="flex-1 truncate text-[12.5px] font-semibold leading-tight text-slate-800">
              {displayContactName(toast.name)}
            </span>
            <span className="shrink-0 text-[9.5px] font-medium text-slate-400">agora</span>
          </span>
          <span className="mt-1 block truncate text-[11.5px] leading-tight text-slate-500">
            {toast.preview}
          </span>
        </span>
      </button>

      <span className="block h-px overflow-hidden bg-slate-100">
        <span
          className="block h-full w-full origin-left bg-emerald-400/70"
          style={{ animation: `whatsappToastProgress ${WHATSAPP_TOAST_DURATION_MS}ms linear both` }}
        />
      </span>
    </div>
  </div>
);

export default WhatsAppMessageToast;
