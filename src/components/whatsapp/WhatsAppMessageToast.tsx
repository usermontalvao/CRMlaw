// Cartão de mensagem nova — o aviso que aparece por cima de qualquer tela do CRM.
//
// A referência é a notificação do próprio WhatsApp no computador: vidro escuro
// (ou claro, conforme o tema), a FOTO do contato em vez de iniciais, o selo do
// WhatsApp no canto da foto, nome em destaque, a mensagem embaixo e um convite
// discreto para abrir a conversa. O cartão anterior era um retângulo branco de
// 286px com as iniciais — informava, mas não parecia parte do produto.
//
// Detalhes que fazem o cartão parecer nativo:
//  • entra deslizando da direita (é de lá que ele "vem"), não de baixo;
//  • a foto chega depois das iniciais, com fade — o cartão nunca espera a rede;
//  • rajada da mesma conversa vira "3 mensagens" em vez de três cartões;
//  • a barra de tempo é fina e some junto com o cartão.
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export const WHATSAPP_TOAST_DURATION_MS = 6000;

export interface WhatsAppMessageToastData {
  id: string;
  conversationId: string;
  name: string;
  preview: string;
  /** URL já assinada da foto do contato (resolvida pelo host, pode faltar). */
  avatarUrl?: string | null;
  /** Quantas mensagens desta conversa este cartão está representando. */
  count?: number;
}

interface WhatsAppMessageToastProps {
  toast: WhatsAppMessageToastData;
  onDismiss: () => void;
  onOpen: (conversationId: string) => void | Promise<void>;
}

/** Nomes gritados em CAIXA ALTA (como vêm da agenda) viram Nome Próprio. */
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

/**
 * Cor do círculo de iniciais derivada do nome: o mesmo contato tem sempre a
 * mesma cor, então o olho reconhece quem é antes de ler.
 */
const AVATAR_TONES = [
  'from-emerald-400 to-teal-500',
  'from-sky-400 to-indigo-500',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-500',
  'from-violet-400 to-purple-500',
  'from-lime-400 to-emerald-500',
];
function toneOf(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

const WhatsAppGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.84 9.84 0 0 0 12.04 2zm5.9 13.98c-.25.7-1.45 1.34-2 1.42-.53.08-1.18.11-1.91-.12-.44-.14-1-.32-1.72-.63-3.03-1.31-5.01-4.36-5.16-4.56-.15-.2-1.23-1.64-1.23-3.12 0-1.49.78-2.22 1.06-2.52.28-.31.61-.38.81-.38.2 0 .41 0 .58.01.19.01.44-.07.69.53.25.61.86 2.1.94 2.25.08.15.13.33.02.53-.1.2-.15.33-.3.5-.15.18-.32.39-.46.53-.15.15-.31.31-.13.61.18.3.79 1.3 1.7 2.11 1.17 1.04 2.15 1.36 2.46 1.51.3.15.48.13.66-.08.18-.2.76-.89.96-1.19.2-.3.41-.25.69-.15.28.1 1.77.83 2.07.99.3.15.5.22.58.35.07.12.07.72-.18 1.42z" />
  </svg>
);

export const WhatsAppMessageToast: React.FC<WhatsAppMessageToastProps> = ({ toast, onDismiss, onOpen }) => {
  // A foto pode chegar depois (assinatura da URL) ou falhar (link expirado):
  // nos dois casos as iniciais continuam valendo, sem buraco no cartão.
  const [photoOk, setPhotoOk] = useState(false);
  useEffect(() => { setPhotoOk(false); }, [toast.avatarUrl]);

  const count = toast.count && toast.count > 1 ? toast.count : 0;

  return (
    <div
      data-testid="whatsapp-message-toast"
      className="wa-toast mb-2.5 w-[352px] max-w-[calc(100vw-24px)]"
      style={{
        animation: `whatsappToastIn 320ms cubic-bezier(.16,1,.3,1) both, whatsappToastOut 260ms ${WHATSAPP_TOAST_DURATION_MS - 260}ms cubic-bezier(.4,0,1,1) both`,
      }}
    >
      <div
        className="group relative overflow-hidden rounded-[18px] border border-white/70 bg-white/80 dark:border-white/10 dark:bg-[#1f2124]/85"
        style={{
          boxShadow:
            '0 18px 44px -20px rgba(15,23,42,.45), 0 6px 16px -10px rgba(15,23,42,.28), inset 0 1px 0 0 rgba(255,255,255,.55)',
          backdropFilter: 'blur(22px) saturate(180%)',
          WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        }}
      >
        {/* Brilho verde no topo: a assinatura de cor do WhatsApp sem pintar o cartão inteiro. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(37,211,102,.85),transparent)' }}
        />

        <button
          type="button"
          onClick={event => { event.stopPropagation(); onDismiss(); }}
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 opacity-0 transition-all duration-150 hover:bg-slate-900/10 hover:text-slate-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
          title="Dispensar"
          aria-label="Dispensar notificação"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label={`Abrir conversa com ${toast.name}`}
          className="relative flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-900/[.035] active:bg-slate-900/[.06] dark:hover:bg-white/[.06] dark:active:bg-white/[.09]"
          onClick={() => { void onOpen(toast.conversationId); }}
        >
          <span className="relative mt-px shrink-0">
            <span
              className={`relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${toneOf(toast.name)} text-[13px] font-bold text-white ring-2 ring-white/70 dark:ring-white/10`}
            >
              {!photoOk && <span>{initialsOf(toast.name)}</span>}
              {toast.avatarUrl && (
                <img
                  src={toast.avatarUrl}
                  alt=""
                  onLoad={() => setPhotoOk(true)}
                  onError={() => setPhotoOk(false)}
                  className="absolute inset-0 h-full w-full rounded-full object-cover transition-opacity duration-300"
                  style={{ opacity: photoOk ? 1 : 0 }}
                />
              )}
            </span>
            {/* Selo do WhatsApp no canto da foto: diz de onde veio sem escrever. */}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white shadow-sm dark:bg-[#1f2124]">
              <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#25d366] text-white">
                <WhatsAppGlyph className="h-[10px] w-[10px]" />
              </span>
            </span>
          </span>

          <span className="block min-w-0 flex-1 pr-5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold leading-tight tracking-[-.01em] text-slate-900 dark:text-slate-50">
                {displayContactName(toast.name)}
              </span>
              <span className="shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500">agora</span>
            </span>

            <span className="mt-1 block text-[12px] leading-[1.35] text-slate-600 line-clamp-2 dark:text-slate-300">
              {toast.preview}
            </span>

            <span className="mt-1.5 flex items-center gap-2">
              {count > 0 && (
                <span className="rounded-full bg-[#25d366]/15 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  {count} mensagens
                </span>
              )}
              <span className="text-[10.5px] font-semibold text-emerald-600 opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:text-emerald-400">
                Abrir conversa →
              </span>
            </span>
          </span>
        </button>

        <span className="block h-[2px] overflow-hidden bg-slate-900/5 dark:bg-white/10">
          <span
            className="block h-full w-full origin-left"
            style={{
              background: 'linear-gradient(90deg,#25d366,#12a150)',
              animation: `whatsappToastProgress ${WHATSAPP_TOAST_DURATION_MS}ms linear both`,
            }}
          />
        </span>
      </div>
    </div>
  );
};

export default WhatsAppMessageToast;
