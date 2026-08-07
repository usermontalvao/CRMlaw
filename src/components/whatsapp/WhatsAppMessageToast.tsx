// Cartão de mensagem nova — o aviso que aparece por cima de qualquer tela do CRM.
//
// A referência é a notificação do próprio WhatsApp no computador: uma faixa de
// vidro com o rosto de quem falou, o nome, e uma linha dizendo o que chegou.
// Nada além disso. A versão anterior tinha barra de progresso verde, borda
// verde no topo, badge "3 mensagens" e um link "Abrir conversa →" — quatro
// elementos disputando atenção com a única informação que importa (quem falou
// e o quê), e ainda escrevia a palavra "Áudio" no lugar da mensagem.
//
// Decisões desta versão:
//  • uma linha de conteúdo, altura de ~66px: o cartão informa de relance;
//  • o tipo de mídia é dito por ÍCONE ("Mensagem de voz" com microfone e onda),
//    como no WhatsApp — a palavra solta "Áudio" não parecia produto;
//  • a HORA real no lugar de "agora": aos dois minutos o "agora" já mente;
//  • a foto é a do CLIENTE VINCULADO quando existe (o cadastro do escritório
//    vale mais que o apelido e o avatar que o contato escolheu no aplicativo);
//  • 400px de largura para caber nome completo de cliente ("Pedro Rodrigues
//    Montalvão Neto") sem cortar, com reticências só nos casos extremos;
//  • entra e sai em fade — some sozinho aos 8s, sem cronômetro à vista.
import React, { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Mic, Sticker, Video, X } from 'lucide-react';

export const WHATSAPP_TOAST_DURATION_MS = 8000;
/** Duração do fade de saída (o cartão só é removido depois dele). */
export const WHATSAPP_TOAST_OUT_MS = 420;

export type WhatsAppToastKind = 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker';

export interface WhatsAppMessageToastData {
  id: string;
  conversationId: string;
  name: string;
  preview: string;
  /** URL já assinada da foto (resolvida pelo host, pode faltar ou chegar depois). */
  avatarUrl?: string | null;
  /** O que chegou — decide o ícone e a frase da segunda linha. */
  kind?: WhatsAppToastKind;
  /** Nome do arquivo, quando a mensagem é um documento. */
  fileName?: string | null;
  /** Quando a mensagem chegou (epoch ms) — vira a hora no canto. */
  at?: number;
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

function timeOf(at?: number): string {
  return new Date(at ?? Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const WhatsAppGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.84 9.84 0 0 0 12.04 2zm5.9 13.98c-.25.7-1.45 1.34-2 1.42-.53.08-1.18.11-1.91-.12-.44-.14-1-.32-1.72-.63-3.03-1.31-5.01-4.36-5.16-4.56-.15-.2-1.23-1.64-1.23-3.12 0-1.49.78-2.22 1.06-2.52.28-.31.61-.38.81-.38.2 0 .41 0 .58.01.19.01.44-.07.69.53.25.61.86 2.1.94 2.25.08.15.13.33.02.53-.1.2-.15.33-.3.5-.15.18-.32.39-.46.53-.15.15-.31.31-.13.61.18.3.79 1.3 1.7 2.11 1.17 1.04 2.15 1.36 2.46 1.51.3.15.48.13.66-.08.18-.2.76-.89.96-1.19.2-.3.41-.25.69-.15.28.1 1.77.83 2.07.99.3.15.5.22.58.35.07.12.07.72-.18 1.42z" />
  </svg>
);

/** Onda estática de áudio — o mesmo desenho que o WhatsApp usa no aviso de voz. */
const VoiceWave: React.FC = () => (
  <span className="flex items-end gap-[2px]" aria-hidden>
    {[8, 13, 10, 16, 7, 11].map((height, index) => (
      <span key={index} className="wa-toast-wave w-[2px] rounded-full" style={{ height }} />
    ))}
  </span>
);

/**
 * A segunda linha do cartão. Texto puro mostra a mensagem; mídia mostra o que é,
 * com ícone — que é como o WhatsApp escreve "🎤 Mensagem de voz".
 */
const PreviewLine: React.FC<{ toast: WhatsAppMessageToastData }> = ({ toast }) => {
  const kind = toast.kind ?? 'text';
  const line = 'flex min-w-0 flex-1 items-center gap-[7px] text-[13.5px] leading-tight text-slate-600 dark:text-slate-300';

  if (kind === 'audio') {
    return (
      <span className={line}>
        <Mic className="wa-toast-ico-voice h-[15px] w-[15px] shrink-0" />
        <VoiceWave />
        <span className="truncate">Mensagem de voz</span>
      </span>
    );
  }

  if (kind === 'document') {
    return (
      <span className={line}>
        <FileText className="wa-toast-ico-doc h-[15px] w-[15px] shrink-0" />
        <span className="truncate">{toast.fileName || 'Documento'}</span>
      </span>
    );
  }

  if (kind === 'sticker') {
    return (
      <span className={line}>
        <Sticker className="wa-toast-ico-media h-[15px] w-[15px] shrink-0" />
        <span className="truncate">Figurinha</span>
      </span>
    );
  }

  // Imagem e vídeo com legenda mostram a legenda (é o que a pessoa escreveu);
  // sem legenda, o ícone e a palavra fazem o papel do texto.
  if ((kind === 'image' || kind === 'video') && !toast.preview) {
    const Icon = kind === 'image' ? ImageIcon : Video;
    return (
      <span className={line}>
        <Icon className="wa-toast-ico-media h-[15px] w-[15px] shrink-0" />
        <span className="truncate">{kind === 'image' ? 'Foto' : 'Vídeo'}</span>
      </span>
    );
  }

  return (
    <span className="line-clamp-2 min-w-0 flex-1 text-[13.5px] leading-[1.35] text-slate-600 dark:text-slate-300">
      {toast.preview}
    </span>
  );
};

/** Quadradinho à direita que anuncia foto/vídeo sem baixar a mídia. */
const MediaChip: React.FC<{ kind: WhatsAppToastKind }> = ({ kind }) => {
  if (kind !== 'image' && kind !== 'video') return null;
  const Icon = kind === 'image' ? ImageIcon : Video;
  return (
    <span className="wa-toast-chip flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[9px]">
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
};

export const WhatsAppMessageToast: React.FC<WhatsAppMessageToastProps> = ({ toast, onDismiss, onOpen }) => {
  // A foto pode chegar depois (assinatura da URL) ou falhar (link expirado):
  // nos dois casos as iniciais continuam valendo, sem buraco no cartão.
  const [photoOk, setPhotoOk] = useState(false);
  useEffect(() => { setPhotoOk(false); }, [toast.avatarUrl]);

  const kind = toast.kind ?? 'text';
  const count = toast.count && toast.count > 1 ? toast.count : 0;

  return (
    <div
      data-testid="whatsapp-message-toast"
      className="wa-toast mb-2.5 w-[400px] max-w-[calc(100vw-24px)]"
      style={{
        animation: `waToastIn 260ms cubic-bezier(.16,1,.3,1) both, waToastOut ${WHATSAPP_TOAST_OUT_MS}ms ${WHATSAPP_TOAST_DURATION_MS - WHATSAPP_TOAST_OUT_MS}ms ease-in both`,
      }}
    >
      <div
        className="wa-toast-card group relative overflow-hidden rounded-[18px] border border-white/70 bg-white/85 dark:border-white/10 dark:bg-[#1f2124]/88"
        style={{
          boxShadow:
            '0 18px 44px -20px rgba(15,23,42,.45), 0 6px 16px -10px rgba(15,23,42,.28), inset 0 1px 0 0 rgba(255,255,255,.55)',
          backdropFilter: 'blur(22px) saturate(180%)',
          WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        }}
      >
        <button
          type="button"
          onClick={event => { event.stopPropagation(); onDismiss(); }}
          className="wa-toast-close absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 opacity-0 transition-all duration-150 hover:text-slate-700 focus-visible:opacity-100 group-hover:opacity-100 dark:text-slate-500 dark:hover:text-slate-200"
          title="Dispensar"
          aria-label="Dispensar notificação"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label={`Abrir conversa com ${toast.name}`}
          className="wa-toast-open relative flex w-full items-center gap-[13px] px-[15px] py-[13px] text-left transition-colors"
          onClick={() => { void onOpen(toast.conversationId); }}
        >
          <span className="relative shrink-0">
            <span className="wa-toast-avatar relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full text-[15px] font-semibold text-slate-600 dark:text-slate-300">
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
            <span className="wa-toast-badge absolute -bottom-0.5 -right-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full text-white">
              <WhatsAppGlyph className="h-[11px] w-[11px]" />
            </span>
          </span>

          <span className="block min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold leading-tight tracking-[-.01em] text-slate-900 dark:text-slate-50">
                {displayContactName(toast.name)}
              </span>
              <span className="shrink-0 text-[11.5px] font-medium text-slate-400 dark:text-slate-500">
                {timeOf(toast.at)}
              </span>
            </span>
            {/* A contagem da rajada mora na SEGUNDA linha: na primeira ela
                comeria justamente o espaço do nome completo do cliente. */}
            <span className="mt-0.5 flex items-center gap-2">
              <PreviewLine toast={toast} />
              {count > 0 && (
                <span className="wa-toast-count shrink-0 rounded-full px-[9px] py-[2px] text-[11.5px] font-semibold">
                  {count} novas
                </span>
              )}
            </span>
          </span>

          <MediaChip kind={kind} />
        </button>
      </div>
    </div>
  );
};

export default WhatsAppMessageToast;
