// Bolha de mensagem + conteúdo de mídia da thread do WhatsApp.
// Apresentacional (props-driven), extraído do god-module `WhatsAppModule.tsx`.
// `MessageBubble` e `ImageAlbum` são consumidos pelo orquestrador; os demais
// (`WaAudioPlayer`, `MediaContent`, `MediaPlaceholder`) são internos.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Pencil, RotateCcw, Calendar, ListTodo, CornerUpLeft, Loader2, AlertCircle,
  CheckCheck, Check, X, Pause, Play, FileText, Download, ChevronDown, Forward,
  Image as ImageIcon, Video as VideoIcon, Trash2, Ban,
  UserRound, MapPin, BarChart3, Smile, HelpCircle, MousePointerClick, Images, CalendarClock,
} from 'lucide-react';
import { formatTime, typeLabel, maskSensitive, fmtAudioTime, formatBytes } from './format';
import { WaRichText } from './WaRichTextView';
import { waPlainText, stripAgentSignature } from './waRichText';
import { WaPdfCard, isPdfMessage } from './pdfPreview';
import { WaContactCard, type ContactCardActions } from './contactMessageCard';
import { WaVideoLightbox } from './lightbox';
import type { WhatsAppMessage, WhatsAppDeleteScope } from '../../types/whatsapp.types';
import { applyOutputToElement } from '../../utils/audioDevices';

const WA_MESSAGE_MENU_EVENT = 'wa-message-menu-open';
const WA_MESSAGE_MENU_WIDTH = 192;

/** Dia e hora do agendamento, curtos — cabem na linha da marca interna. */
const formatScheduleStamp = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const MessageBubble: React.FC<{
  m: WhatsAppMessage;
  repliedTo: WhatsAppMessage | null;
  senderName: string | null;
  senderRole?: string | null;
  groupStart?: boolean;
  groupEnd?: boolean;
  privateMode?: boolean;
  canCreateFollowups?: boolean;
  onReply: (m: WhatsAppMessage) => void;
  onEdit: (m: WhatsAppMessage) => void;
  /** Encaminhar para outras conversas. Ausente = recurso indisponível no host. */
  onForward?: (m: WhatsAppMessage) => void;
  onOpenImage: (url: string) => void;
  onRetry: (m: WhatsAppMessage) => void;
  onDiscard: (m: WhatsAppMessage) => void;
  onResend: (m: WhatsAppMessage) => void;
  uploadProgress?: number;
  onCancel: (m: WhatsAppMessage) => void;
  onCreateDeadline: (m: WhatsAppMessage) => void;
  onCreateTask: (m: WhatsAppMessage) => void;
  /** Apagar a mensagem. Ausente = recurso indisponível no host. */
  onDelete?: (m: WhatsAppMessage, scope: WhatsAppDeleteScope) => void;
  /** Só para áudio: o áudio logo abaixo, que emenda quando este termina. */
  nextAudioId?: string | null;
  /**
   * Quando esta mensagem saiu de um AGENDAMENTO, o horário para o qual ela
   * estava marcada. Vira uma marca INTERNA na bolha — o contato recebeu uma
   * mensagem comum, sem qualquer sinal de que ela estava na fila.
   */
  scheduledAt?: string | null;
  /**
   * O que o cartão de contato RECEBIDO sabe fazer: ligar para o número e
   * vincular o número a um cadastro. Ausentes = o host não oferece o recurso.
   * Encaminhar o cartão é do menu da bolha, como em qualquer outra mensagem.
   */
  onOpenContactChat?: (phone: string, name: string) => void;
  onCallContactPhone?: (phone: string, name: string) => void;
  onLinkContactPhone?: (phone: string, name: string) => void;
}> = React.memo(({ m, repliedTo, senderName, senderRole, groupStart = true, groupEnd = true, privateMode, canCreateFollowups, onReply, onEdit, onForward, onOpenImage, onRetry, onDiscard, onResend, uploadProgress, onCancel, onCreateDeadline, onCreateTask, onDelete, nextAudioId, scheduledAt, onOpenContactChat, onCallContactPhone, onLinkContactPhone }) => {
  const out = m.direction === 'out';
  const failed = m._local === 'failed' || m.status === 'failed';
  const busy = m._local === 'uploading' || m._local === 'sending';
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = m._tempId || m.id;
  // Reenvio rápido: só faz sentido para mídia já entregue (com objeto no storage).
  const canResend = out && !busy && !failed && m.type !== 'text' && !!m.storage_path;
  // Encaminhar: precisa de algo para reenviar — texto escrito ou arquivo que já
  // está no storage (a mídia vai pelo caminho do storage, sem baixar e subir de
  // novo). Mensagem ainda em envio ou falhada não é encaminhável.
  // O cartão de contato não tem arquivo no storage, e por isso ficava fora do
  // encaminhamento: a única mensagem que o escritório mais quer repassar (o
  // número do perito, do despachante) era justamente a que não dava. Ele vai
  // pelo texto do cartão, que é reenviado como CARTÃO (ver `sendContact`).
  const canForward = !!onForward && !busy && !failed
    && (m.type === 'text' || m.type === 'contact' ? !!m.content : !!m.storage_path);

  // ── Apagar ──
  const deleted = !!m.deleted_at;
  // "Apagar só aqui" vale para tudo que já existe no banco, inclusive mensagem
  // recebida: o que ela faz é tirar da tela do escritório, e isso não depende do
  // aparelho do contato. Fora: a mensagem ainda em voo (sem id no servidor, não
  // há o que apagar) e a que já está apagada.
  const canDeleteLocal = !!onDelete && !deleted && !busy && !m._tempId;
  // "Apagar para todos" pede uma revogação à Evolution, e o WhatsApp só aceita
  // revogar mensagem NOSSA que ainda tenha chave. A janela de tempo do WhatsApp
  // não é conferida aqui de propósito: ela muda sem aviso e não é observável do
  // client — quem responde por ela é a Evolution, e a recusa dela vira o toast
  // que oferece apagar só aqui.
  const canDeleteEveryone = canDeleteLocal && out && !failed && !!m.evolution_message_id;
  // Imagem/vídeo sem legenda/reply/nome → bolha sem moldura (igual WhatsApp):
  // a mídia "sangra" até a borda e a hora fica sobreposta num canto.
  // Reserva a bolha de mídia mesmo enquanto a URL assinada ainda não chegou.
  // Assim o placeholder e a imagem final ocupam exatamente a mesma caixa.
  const mediaOnly = (m.type === 'image' || m.type === 'video' || m.type === 'sticker') && !m.content && !repliedTo && !senderName;
  // Figurinha não usa bolha: no WhatsApp ela aparece solta sobre o fundo da
  // conversa, sem retângulo colorido nem sombra atrás.
  const stickerOnly = m.type === 'sticker' && mediaOnly;

  // Cada bolha é um componente separado. Sem coordenação, seus estados locais
  // permitiam vários menus abertos ao mesmo tempo. Este evento fecha todos os
  // outros assim que um novo menu é acionado.
  useEffect(() => {
    const closeOtherMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== menuId) setMenuOpen(false);
    };
    window.addEventListener(WA_MESSAGE_MENU_EVENT, closeOtherMenu);
    return () => window.removeEventListener(WA_MESSAGE_MENU_EVENT, closeOtherMenu);
  }, [menuId]);

  // O menu usa coordenadas da viewport e fecha quando a âncora deixa de ser
  // confiável. Renderizado em portal, ele não disputa z-index com outras bolhas.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuOpen]);

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const actionCount = 1
      + (canForward ? 1 : 0)
      + (out && m.type === 'text' && m.evolution_message_id ? 1 : 0)
      + (canResend ? 1 : 0)
      + (canCreateFollowups && !m._tempId ? 2 : 0)
      + (canDeleteLocal ? 1 : 0)
      + (canDeleteEveryone ? 1 : 0);
    const estimatedHeight = actionCount * 42 + (actionCount > 1 ? 14 : 8);
    const below = rect.bottom + 6;
    const top = below + estimatedHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - estimatedHeight - 6);
    const preferredLeft = out ? rect.right - WA_MESSAGE_MENU_WIDTH : rect.left;
    const left = Math.min(
      window.innerWidth - WA_MESSAGE_MENU_WIDTH - 8,
      Math.max(8, preferredLeft),
    );
    window.dispatchEvent(new CustomEvent(WA_MESSAGE_MENU_EVENT, { detail: menuId }));
    setMenuPosition({ top, left });
    setMenuOpen(true);
  };

  const runAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  // ── Mensagem apagada ──
  // Sai antes de tudo: a bolha apagada não tem conteúdo, menu, mídia, resposta
  // citada nem legenda — ela é só o aviso, e qualquer pedaço do corpo normal que
  // vazasse para cá seria exatamente o que a exclusão deveria ter tirado da tela.
  // A linha continua ocupando o lugar dela no tempo, como no WhatsApp: some o
  // conteúdo, não o fato de ter havido uma mensagem ali.
  if (deleted) {
    return (
      <div data-msg-id={m.id} className={`wa-message-row group flex items-end ${groupStart ? 'mt-2' : 'mt-[2px]'} ${out ? 'justify-end' : 'justify-start'}`}>
        <div className={`wa-bubble-in wa-bubble ${out ? 'wa-bubble-out origin-bottom-right' : 'wa-bubble-incoming origin-bottom-left'} ${groupStart ? (out ? 'wa-bubble-tail-out' : 'wa-bubble-tail-in') : ''} ${groupEnd ? '' : 'wa-bubble-continued'} wa-bubble-content relative px-[9px] pt-[6px] pb-[5px] text-[14px] leading-[1.36]`}>
          <span className="flex items-center gap-1.5 italic text-[13.5px] text-[#8696a0]">
            <Ban size={14} className="shrink-0" />
            {/* Quem apagou muda a frase, como no aplicativo: a mensagem que o
                CONTATO revogou não pode dizer "Você apagou". `deleted_by` nulo
                com data preenchida é exatamente a marca do revoke dele. */}
            {out || m.deleted_by ? 'Você apagou esta mensagem' : 'Esta mensagem foi apagada'}
          </span>
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] leading-4 text-[#667781]">
            {formatTime(m.wa_timestamp)}
          </span>
        </div>
      </div>
    );
  }

  // Figurinha não tem moldura nem fundo: encostada na mídia de cima (um vídeo,
  // por exemplo) ela parece grudada no player. Por isso pede um respiro próprio,
  // dos dois lados, em vez dos 2px do agrupamento normal.
  return (
    // `data-msg-id`: é por ele que a thread encontra uma mensagem para saltar
    // até ela (ver `jumpToMessage`). Fica na LINHA, e não na bolha, para o
    // realce cobrir o balão inteiro.
    <div data-msg-id={m.id} className={`wa-message-row group flex items-end ${stickerOnly ? 'my-2.5' : groupStart ? 'mt-2' : 'mt-[2px]'} ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`wa-bubble-in ${stickerOnly ? 'wa-sticker-bubble' : `wa-bubble ${out ? 'wa-bubble-out origin-bottom-right' : 'wa-bubble-incoming origin-bottom-left'} ${groupStart ? (out ? 'wa-bubble-tail-out' : 'wa-bubble-tail-in') : ''}`} ${out ? 'origin-bottom-right' : 'origin-bottom-left'} ${groupEnd ? '' : 'wa-bubble-continued'} relative text-[14px] leading-[1.36] text-slate-800 ${mediaOnly ? `wa-bubble-media max-w-[300px] p-0 ${stickerOnly ? '' : 'wa-bubble-media-surface'}` : 'wa-bubble-content px-[9px] pt-[6px] pb-[5px]'}`}>
        {!busy && (
          <button ref={menuTriggerRef} type="button" title="Ações da mensagem" aria-label="Ações da mensagem" aria-expanded={menuOpen}
            onClick={toggleMenu}
            className={`wa-bubble-menu-trigger absolute z-10 top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-slate-500 opacity-0 group-hover:opacity-100 ${menuOpen ? '!opacity-100' : ''}`}>
            <ChevronDown size={15} strokeWidth={2.2} />
          </button>
        )}
        {menuOpen && typeof document !== 'undefined' && createPortal(
          <>
            <button type="button" aria-label="Fechar ações da mensagem" className="fixed inset-0 z-[9990] cursor-default bg-transparent" onClick={() => setMenuOpen(false)} />
            <div role="menu" aria-label="Ações da mensagem" style={{ top: menuPosition.top, left: menuPosition.left, width: WA_MESSAGE_MENU_WIDTH }}
              className="fixed z-[9991] overflow-hidden rounded-xl bg-white py-1.5 shadow-[0_12px_38px_rgba(15,23,42,0.24)] ring-1 ring-black/[0.08]">
              <MessageAction icon={<CornerUpLeft size={15} />} label="Responder" onClick={() => runAction(() => onReply(m))} />
              {canForward && <MessageAction icon={<Forward size={15} />} label="Encaminhar" onClick={() => runAction(() => onForward?.(m))} />}
              {out && m.type === 'text' && m.evolution_message_id && (
                <MessageAction icon={<Pencil size={15} />} label="Editar mensagem" onClick={() => runAction(() => onEdit(m))} />
              )}
              {canResend && <MessageAction icon={<RotateCcw size={15} />} label="Reenviar arquivo" onClick={() => runAction(() => onResend(m))} />}
              {canCreateFollowups && !m._tempId && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <MessageAction icon={<Calendar size={15} />} label="Criar prazo" onClick={() => runAction(() => onCreateDeadline(m))} />
                  <MessageAction icon={<ListTodo size={15} />} label="Criar tarefa" onClick={() => runAction(() => onCreateTask(m))} />
                </>
              )}
              {/* Apagar por último e separado: é a única ação irreversível do
                  menu, e no WhatsApp ela também mora no fim, em vermelho. */}
              {canDeleteLocal && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  {canDeleteEveryone && (
                    <MessageAction danger icon={<Ban size={15} />} label="Apagar para todos"
                      onClick={() => runAction(() => onDelete?.(m, 'everyone'))} />
                  )}
                  <MessageAction danger icon={<Trash2 size={15} />} label="Apagar só aqui"
                    onClick={() => runAction(() => onDelete?.(m, 'me'))} />
                </>
              )}
            </div>
          </>,
          document.body,
        )}

        {/* Marca INTERNA de agendamento. Fica dentro da bolha, colada na
            mensagem, porque a pergunta que ela responde ("isto foi eu na hora
            ou foi a fila?") só faz sentido ao lado do texto. O contato não vê
            nada disso: o que saiu para o aparelho dele é uma mensagem comum —
            este selo existe só na tela do escritório. */}
        {scheduledAt && (
          <span
            title={`Marca interna: esta mensagem saiu de um agendamento para ${formatScheduleStamp(scheduledAt)}. O contato não vê este aviso.`}
            className={mediaOnly
              ? 'absolute top-1.5 left-1.5 z-[2] flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-white'
              : 'mb-0.5 flex items-center gap-1 pr-6 text-[10.5px] font-semibold leading-4 text-amber-700'}>
            <CalendarClock size={11} className="shrink-0" />
            <span className="truncate">Enviada por agendamento · {formatScheduleStamp(scheduledAt)}</span>
          </span>
        )}

        {senderName && (
          <span className="block mb-0.5 pr-6 text-[11.5px] font-semibold leading-4 text-[#008069] truncate"
            title={senderRole ? `${senderName} · ${senderRole}` : senderName}>{senderName}</span>
        )}

        {repliedTo && (
          <div className={`mb-1.5 px-2 py-1.5 rounded-md border-l-[3px] text-[12px] border-[#00a884] ${out ? 'bg-black/[0.045]' : 'bg-[#f0f2f5]'}`}>
            <span className="block font-semibold text-[#008069]">{repliedTo.direction === 'out' ? 'Você' : 'Contato'}</span>
            {/* Citação é resumo de uma linha: as marcas saem, não viram estilo. */}
            <span className="block truncate text-slate-500">
              {repliedTo.content
                ? waPlainText(stripAgentSignature(repliedTo.content))
                : typeLabel(repliedTo.type)}
            </span>
          </div>
        )}

        <MediaContent m={m} out={out} onOpenImage={onOpenImage} nextAudioId={nextAudioId} />

        {/* Cartão de contato: o texto vira número clicável com ações. Ver
            `contactMessageCard.tsx`. */}
        {m.type === 'contact' && (
          <WaContactCard
            content={m.content}
            out={out}
            privateMode={privateMode}
            actions={{
              onOpenChat: onOpenContactChat,
              onCall: onCallContactPhone,
              onLinkClient: onLinkContactPhone,
            } satisfies ContactCardActions}
          />
        )}

        {/* `unsupported` já se explica na própria moldura — repetir o texto
            embaixo dela seria dizer a mesma coisa duas vezes. */}
        {m.content && m.type !== 'text' && m.type !== 'unsupported' && m.type !== 'contact' && (
          <WaRichText text={privateMode ? maskSensitive(m.content) : m.content}
            className="block mt-1 whitespace-pre-wrap break-words" />
        )}
        {m.content && m.type === 'text' && (
          <WaRichText text={privateMode ? maskSensitive(m.content) : m.content} stripSignature={out}
            className="whitespace-pre-wrap break-words" />
        )}
        {/* TEXTO SEM TEXTO. São as mensagens que o webhook antigo já gravou em
            branco (contato, localização, enquete, "ver uma vez") antes de saber
            lê-las: ficaram no banco como `text` com conteúdo nulo e nada as
            conserta retroativamente. Aqui elas param de ser bolha vazia — o
            reconhecimento novo cuida das que chegarem daqui para frente. */}
        {!m.content && m.type === 'text' && !busy && <MensagemNaoSuportada />}

        <span className={mediaOnly
          ? 'absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px]'
          : 'flex items-center gap-1 justify-end mt-0.5 ml-8 text-[10.5px] leading-4 text-[#667781]'}>
          {m.edited_at && <span className="italic opacity-80">editado</span>}
          {busy && <Loader2 size={11} className="animate-spin" />}
          {formatTime(m.wa_timestamp)}
          {out && !busy && (failed
            ? <AlertCircle size={12} className="text-red-500" />
            : m.status === 'read'
              ? <CheckCheck size={13} className={mediaOnly ? 'text-sky-300' : 'text-[#53bdeb]'} />
            : m.status === 'delivered'
              ? <CheckCheck size={13} className="text-[#8696a0]" />
            : <Check size={13} className="text-[#8696a0]" />)}
        </span>

        {/* Barra de progresso de upload + botão cancelar (Fase D) */}
        {m._local === 'uploading' && uploadProgress !== undefined && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 rounded-full bg-emerald-600/20 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-300"
                style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="text-[10px] text-slate-500 tabular-nums">{uploadProgress}%</span>
            {m._tempId && (
              <button onClick={() => onCancel(m)} title="Cancelar envio"
                className="text-slate-500 hover:text-slate-700 transition leading-none">
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {/* Falha no envio: tentar de novo ou descartar da fila */}
        {failed && m._tempId && (
          <span className="flex items-center gap-2 justify-end mt-1 text-[11px] font-semibold">
            <span className="text-red-600">Não enviado</span>
            <button onClick={() => onRetry(m)} className="underline hover:no-underline text-emerald-700">Tentar de novo</button>
            <button onClick={() => onDiscard(m)} className="text-slate-500 hover:text-slate-700">Descartar</button>
          </span>
        )}
      </div>
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';

const MessageAction: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }> = ({ icon, label, onClick, danger }) => (
  <button type="button" onClick={onClick}
    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-[#f0f2f5]'}`}>
    <span className={danger ? 'text-red-500' : 'text-slate-500'}>{icon}</span>
    <span>{label}</span>
  </button>
);

// ── Player de áudio estilo WhatsApp (play/pause + onda clicável + tempo/velocidade) ──
//
// SALA DE CONTROLE DOS ÁUDIOS DA THREAD. Cada bolha é um componente isolado e não
// enxerga as vizinhas; sem um ponto comum, dois áudios tocavam ao mesmo tempo
// (bastava clicar no segundo sem pausar o primeiro) e nada emendava um no outro.
// Este registro é esse ponto: cada player se anuncia pelo id da mensagem e
// oferece "toque" e "pause". Módulo-nível de propósito — é o único escopo que
// todas as bolhas compartilham, e ele se esvazia sozinho conforme elas desmontam.
interface ControleDeAudio { tocar: () => void; pausar: () => void }
const audiosDaThread = new Map<string, ControleDeAudio>();

/** Silencia todos os outros áudios. Um por vez, como no WhatsApp. */
function pausarOsOutrosAudios(idQueVaiTocar: string): void {
  audiosDaThread.forEach((controle, id) => { if (id !== idQueVaiTocar) controle.pausar(); });
}

const WA_AUDIO_BARS = Array.from({ length: 30 }, (_, i) => 25 + ((i * 41 + i * i * 7) % 75));
const WaAudioPlayer: React.FC<{
  src: string;
  /** Identidade no registro da thread (id do servidor, ou o temporário). */
  messageId: string;
  /** Áudio imediatamente abaixo; ausente = a sequência foi cortada. */
  nextAudioId?: string | null;
}> = ({ src, messageId, nextAudioId }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  // O id de quem emenda muda conforme a conversa recebe mensagens novas; guardado
  // em ref para o `onEnded` ler o valor do momento sem recriar o listener.
  const proximoRef = useRef<string | null | undefined>(nextAudioId);
  proximoRef.current = nextAudioId;

  useEffect(() => {
    const controle: ControleDeAudio = {
      tocar: () => { const a = audioRef.current; if (a) void a.play().catch(() => {}); },
      pausar: () => { audioRef.current?.pause(); },
    };
    audiosDaThread.set(messageId, controle);
    return () => {
      // Só apaga a própria entrada: em re-render com o mesmo id, o registro novo
      // já tomou o lugar e apagá-lo cegamente deixaria a corrente partida.
      if (audiosDaThread.get(messageId) === controle) audiosDaThread.delete(messageId);
    };
  }, [messageId]);

  const toggle = () => { const a = audioRef.current; if (!a) return; if (a.paused) void a.play().catch(() => {}); else a.pause(); };
  const cycleRate = () => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(next); if (audioRef.current) audioRef.current.playbackRate = next; };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current; if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * duration; setCurrent(a.currentTime);
  };
  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2.5 select-none" style={{ minWidth: '250px', maxWidth: '330px' }}>
      <audio ref={audioRef} src={src} preload="metadata"
        onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onPlay={e => {
          setPlaying(true); pausarOsOutrosAudios(messageId);
          // O alto-falante escolhido no painel de áudio vale aqui também: quem
          // pôs o headset para atender não quer o áudio do cliente saindo no
          // monitor. Aplicado a cada play, e não uma vez só, porque a escolha
          // pode mudar (inclusive noutra janela) com a página aberta.
          void applyOutputToElement(e.currentTarget);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false); setCurrent(0);
          // A emenda só existe quando a mensagem logo abaixo TAMBÉM é áudio (ver
          // `nextAudioId` em useWaThread). O navegador libera este `play()` sem
          // clique porque a página já tem interação do usuário — foi ele quem
          // iniciou o primeiro áudio da corrente.
          const proximo = proximoRef.current;
          if (proximo) audiosDaThread.get(proximo)?.tocar();
        }}
        className="hidden" />
      <button type="button" onClick={toggle} title={playing ? 'Pausar' : 'Reproduzir'}
        className="shrink-0 w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#008f72] text-white flex items-center justify-center active:scale-95 transition">
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-[2px] h-6 cursor-pointer" onClick={seek} title="Avançar / retroceder">
          {WA_AUDIO_BARS.map((h, i) => {
            const filled = (i / WA_AUDIO_BARS.length) * 100 <= progress;
            return <div key={i} className="flex-1 rounded-full" style={{ height: `${h}%`, background: filled ? '#00a884' : 'rgba(84,101,111,0.28)' }} />;
          })}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-slate-500 tabular-nums font-semibold">{playing || current > 0 ? fmtAudioTime(current) : fmtAudioTime(duration)}</span>
          <button type="button" onClick={cycleRate} title="Velocidade"
            className="text-[9px] font-bold text-slate-500 bg-black/[0.06] hover:bg-black/[0.12] rounded px-1 py-0.5 transition leading-none">{rate}x</button>
        </div>
      </div>
    </div>
  );
};

/**
 * A mensagem é um GIF? O WhatsApp entrega GIF por caminhos diferentes conforme
 * a origem: o do teclado/galeria chega como imagem ou documento `image/gif`; o
 * do seletor de GIFs chega como VÍDEO mp4 com `gifPlayback` (ver
 * `isAnimatedVideo`). Aqui tratamos o primeiro grupo.
 */
function isGifLike(m: WhatsAppMessage): boolean {
  if ((m.media_mime || '').toLowerCase().includes('image/gif')) return true;
  return (m.file_name || '').toLowerCase().endsWith('.gif');
}

/**
 * Vídeo que na verdade é um GIF: toca sozinho, em laço, sem som e sem
 * controles. O WhatsApp converte GIF para mp4 e marca `gifPlayback`; sem essa
 * marca ele fica indistinguível de um vídeo curto, e um GIF parado atrás de um
 * botão de play não é um GIF.
 */
function isAnimatedVideo(m: WhatsAppMessage): boolean {
  if (m.is_animated) return true;
  return (m.file_name || '').toLowerCase().endsWith('.gif');
}

// ── Conteúdo de mídia por tipo ──
const MediaContent: React.FC<{
  m: WhatsAppMessage; out: boolean; onOpenImage: (url: string) => void; nextAudioId?: string | null;
}> = ({ m, out, onOpenImage, nextAudioId }) => {
  if (m.type === 'text') return null;
  const url = m.media_url;
  const mediaKey = m.storage_path || url || m.id;

  // Figurinha: imagem (webp, muitas vezes animada) sem moldura nem fundo — como
  // no WhatsApp. Sem este ramo ela caía no renderizador de DOCUMENTO e o
  // atendente via um cartão de arquivo "Documento · 12 KB" no lugar da figurinha.
  if (m.type === 'sticker') {
    return url
      ? <WaSticker key={url} src={url} alt={m.content || 'figurinha'} />
      : <MediaPlaceholder label="Figurinha" />;
  }

  // GIF pode chegar como imagem OU como documento (mimetype image/gif). Nos dois
  // casos é para animar na conversa, não virar um anexo para baixar.
  if (m.type === 'image' || isGifLike(m)) {
    return url
      ? <WaImage key={url} src={url} cacheKey={mediaKey} alt={m.content || 'imagem'} onOpen={() => onOpenImage(url)} badge={isGifLike(m) ? 'GIF' : null} />
      : <MediaSkeleton kind="image" frame={mediaFrameCache.get(mediaKey)} />;
  }

  if (m.type === 'video') {
    return url
      ? <WaVideo key={url} src={url} cacheKey={mediaKey} autoLoop={isAnimatedVideo(m)} name={m.file_name} />
      : <MediaSkeleton kind="video" frame={mediaFrameCache.get(mediaKey)} />;
  }

  if (m.type === 'audio') {
    return (
      <div className="min-w-[220px]">
        {url ? <WaAudioPlayer src={url} messageId={m.id} nextAudioId={nextAudioId} />
          : <MediaPlaceholder label={typeLabel('audio')} />}
        {m.transcription_status === 'pending' && (
          <span className="flex items-center gap-1 mt-1 text-[11px] italic text-slate-400"><Loader2 size={11} className="animate-spin" /> Transcrevendo…</span>
        )}
        {/* A transcrição fica SEMPRE à vista. Ela existe justamente para quem
            não pode (ou não quer) ouvir o áudio — atendente em ligação, sala
            cheia, cliente esperando. Escondida atrás de um clique, ela só
            atrapalhava: era preciso abrir áudio por áudio para varrer a
            conversa, e a busca visual do histórico não funcionava. */}
        {m.transcription_status === 'done' && m.transcription_text && (
          <p className="mt-1.5 max-w-[320px] border-t border-black/[0.06] pt-1.5 text-[12px] leading-[1.45] text-slate-600">
            “{m.transcription_text}”
          </p>
        )}
        {m.transcription_status === 'failed' && (
          <span className="block mt-1 text-[11px] italic text-slate-400">Transcrição indisponível</span>
        )}
      </div>
    );
  }

  // ── Tipos nativos sem arquivo ──
  // Contato, localização e enquete chegam do WhatsApp já convertidos em texto
  // legível pelo webhook (ver `wa-native-content.ts`); o que falta aqui é a
  // moldura que diz O QUE aquilo é. Sem ela, um cartão de contato aparecia como
  // um parágrafo solto de nome e telefone, indistinguível de alguém digitando.
  // O texto em si continua saindo pelo caminho normal, logo abaixo da moldura —
  // é por isso que a coordenada da localização já vira link clicável de graça.
  if (m.type === 'contact') return <FaixaDeTipo icon={<UserRound size={13} />} label="Contato" out={out} />;
  if (m.type === 'location') return <FaixaDeTipo icon={<MapPin size={13} />} label="Localização" out={out} />;
  if (m.type === 'poll') return <FaixaDeTipo icon={<BarChart3 size={13} />} label="Enquete" out={out} />;
  if (m.type === 'reaction') return <FaixaDeTipo icon={<Smile size={13} />} label="Reação" out={out} />;
  // Botões/lista/template/fluxo: o WhatsApp Business do outro lado. O corpo e as
  // opções já vêm no texto — inclusive as URLs dos botões, que a bolha
  // transforma em link clicável (rastreio, 2ª via, acompanhar pedido).
  if (m.type === 'interactive') return <FaixaDeTipo icon={<MousePointerClick size={13} />} label="Mensagem com opções" out={out} />;
  if (m.type === 'album') return <FaixaDeTipo icon={<Images size={13} />} label="Álbum" out={out} />;
  if (m.type === 'unsupported') return <MensagemNaoSuportada />;

  // PDF: miniatura da 1ª página + visualizador ao clicar. É o anexo mais comum
  // do escritório (contrato, comprovante, decisão) e o cartão mudo obrigava a
  // baixar arquivo por arquivo só para saber qual era qual.
  if (isPdfMessage(m)) return <WaPdfCard m={m} out={out} />;

  // documento
  return (
    <a href={url || undefined} target="_blank" rel="noreferrer" download={m.file_name || undefined}
      className={`flex items-center gap-2.5 min-w-[200px] px-2 py-1.5 rounded-lg ${out ? 'bg-black/[0.05] hover:bg-black/[0.08]' : 'bg-slate-100 hover:bg-slate-200'} transition`}>
      <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white text-emerald-600 shadow-sm"><FileText size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold truncate text-slate-800">{m.file_name || 'Documento'}</span>
        <span className="block text-[11px] text-slate-400">{formatBytes(m.media_size)}</span>
      </span>
      {url && <Download size={16} className="text-slate-400" />}
    </a>
  );
};

const MediaPlaceholder: React.FC<{ label: string }> = ({ label }) => (
  <span className="flex items-center gap-1.5 text-[12px] opacity-80"><Loader2 size={12} className="animate-spin" /> {label}</span>
);

/** Cabeçalho de uma linha que nomeia o tipo da mensagem antes do conteúdo. */
const FaixaDeTipo: React.FC<{ icon: React.ReactNode; label: string; out: boolean }> = ({ icon, label, out }) => (
  <span className={`mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${
    out ? 'text-emerald-800/70' : 'text-[#008069]'
  }`}>
    {icon}{label}
  </span>
);

/**
 * O que o painel não sabe desenhar. Aparece no lugar da bolha branca de antes:
 * dizer "chegou algo que não sei mostrar, abra no celular" é informação; uma
 * bolha vazia é um defeito com cara de mensagem perdida.
 */
const MensagemNaoSuportada: React.FC = () => (
  <span className="flex items-center gap-1.5 text-[12px] italic text-slate-500">
    <HelpCircle size={13} className="flex-shrink-0 text-slate-400" />
    Mensagem não suportada aqui — abra no WhatsApp para ver.
  </span>
);

type MediaLoadState = 'loading' | 'loaded' | 'error';
type MediaFrame = { width: number; ratio: number };

const DEFAULT_MEDIA_FRAME: MediaFrame = { width: 240, ratio: 8 / 9 };
const mediaFrameCache = new Map<string, MediaFrame>();

/** Caixa máxima da mídia na conversa. A imagem carregada nunca passa disto. */
const MEDIA_MAX_WIDTH = 300;
const MEDIA_MAX_HEIGHT = 360;

const fitMediaFrame = (naturalWidth: number, naturalHeight: number): MediaFrame | null => {
  // Sem dimensão real não há palpite honesto. Devolver o padrão quase quadrado
  // aqui era o bug: um print de celular (bem mais alto que largo) ficava dentro
  // de uma caixa quase quadrada e o `object-contain` desenhava faixas cinza dos
  // dois lados. `null` = "não sei", e quem chama mantém o que já tinha.
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  const scale = Math.min(MEDIA_MAX_WIDTH / naturalWidth, MEDIA_MAX_HEIGHT / naturalHeight, 1);
  return {
    width: Math.max(72, Math.round(naturalWidth * scale)),
    ratio: naturalWidth / naturalHeight,
  };
};

const mediaFrameStyle = (frame = DEFAULT_MEDIA_FRAME): React.CSSProperties => ({
  width: `${frame.width}px`,
  aspectRatio: String(frame.ratio),
});

/** Placeholder neutro; quando a dimensão já é conhecida, reaparece no tamanho exato. */
const MediaSkeleton: React.FC<{ kind: 'image' | 'video'; failed?: boolean; frame?: MediaFrame }> = ({ kind, failed = false, frame }) => {
  const Icon = kind === 'image' ? ImageIcon : VideoIcon;
  return (
    <span style={mediaFrameStyle(frame)} className="wa-media-frame wa-media-skeleton relative flex items-center justify-center" aria-label={failed ? 'Mídia indisponível' : 'Carregando mídia'}>
      <span className="relative z-[1] flex flex-col items-center gap-1.5 text-[#8696a0]">
        {failed ? <Icon size={24} /> : <Loader2 size={20} className="animate-spin" />}
        <span className="text-[10.5px] font-medium">{failed ? 'Mídia indisponível' : 'Carregando…'}</span>
      </span>
    </span>
  );
};

/**
 * Figurinha: sem bolha, sem fundo e sem sombra — ela "flutua" sobre a conversa,
 * como no WhatsApp. Webp animado toca sozinho, sem precisar de vídeo.
 */
const WaSticker: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <MediaPlaceholder label="Figurinha indisponível" />;
  return (
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)}
      className="block h-auto w-auto max-h-[140px] max-w-[140px] select-none" />
  );
};

const WaImage: React.FC<{ src: string; cacheKey: string; alt: string; onOpen: () => void; badge?: string | null }> = ({ src, cacheKey, alt, onOpen, badge }) => {
  const [state, setState] = useState<MediaLoadState>('loading');
  const [frame, setFrame] = useState<MediaFrame>(() => mediaFrameCache.get(cacheKey) || DEFAULT_MEDIA_FRAME);
  const loaded = state === 'loaded';

  const handleLoad = (image: HTMLImageElement) => {
    const nextFrame = fitMediaFrame(image.naturalWidth, image.naturalHeight);
    if (nextFrame) {
      mediaFrameCache.set(cacheKey, nextFrame);
      setFrame(nextFrame);
    }
    setState('loaded');
  };

  // Enquanto carrega, a caixa com proporção estimada segura o espaço (a thread
  // não pula quando a imagem chega). Depois de carregada, quem manda na forma é
  // a PRÓPRIA imagem, limitada por max-width/max-height: assim a bolha veste a
  // imagem, e nenhuma medição errada consegue produzir moldura sobrando.
  return (
    <button type="button" onClick={() => loaded && onOpen()} disabled={!loaded}
      style={loaded ? undefined : mediaFrameStyle(frame)}
      aria-label="Abrir imagem"
      className={`wa-media-frame relative overflow-hidden text-left ${loaded ? 'inline-block w-fit' : 'block'}`}>
      {!loaded && <MediaSkeleton kind="image" frame={frame} failed={state === 'error'} />}
      <img src={src} alt={alt} loading="lazy" decoding="async"
        onLoad={event => handleLoad(event.currentTarget)} onError={() => setState('error')}
        style={loaded ? { maxWidth: MEDIA_MAX_WIDTH, maxHeight: MEDIA_MAX_HEIGHT } : undefined}
        className={`bg-[#dfe3e5] transition-opacity duration-200 ${
          loaded ? 'block h-auto w-auto' : 'absolute inset-0 h-full w-full object-contain opacity-0'
        }`} />
      {badge && loaded && (
        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          {badge}
        </span>
      )}
    </button>
  );
};

const WaVideo: React.FC<{ src: string; cacheKey: string; autoLoop?: boolean; name?: string | null }> = ({ src, cacheKey, autoLoop = false, name }) => {
  const [state, setState] = useState<MediaLoadState>('loading');
  // `null` = ainda não sei o formato do vídeo. Enquanto não sei, a caixa é uma
  // estimativa; assim que os metadados chegam, quem manda na forma é o PRÓPRIO
  // vídeo — era o `object-contain` dentro de uma caixa palpitada que desenhava
  // as faixas vazias ao lado de vídeo vertical (o formato que mais chega).
  const [frame, setFrame] = useState<MediaFrame | null>(() => mediaFrameCache.get(cacheKey) ?? null);
  const [duration, setDuration] = useState(0);
  const [open, setOpen] = useState(false);
  const loaded = state === 'loaded';
  // Só o vídeo com dimensão conhecida pode vestir a bolha sozinho.
  const shaped = loaded && !!frame;

  const handleMetadata = (video: HTMLVideoElement) => {
    if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    const nextFrame = fitMediaFrame(video.videoWidth, video.videoHeight);
    if (!nextFrame) return;
    mediaFrameCache.set(cacheKey, nextFrame);
    setFrame(nextFrame);
  };

  // `#t=0.1` faz o navegador desenhar o primeiro quadro como capa; sem isso o
  // vídeo parado aparece como um retângulo preto na conversa.
  const media = (
    <video src={autoLoop ? src : `${src}#t=0.1`} preload={autoLoop ? 'auto' : 'metadata'}
      autoPlay={autoLoop} loop={autoLoop} muted playsInline
      onLoadedMetadata={event => handleMetadata(event.currentTarget)}
      onLoadedData={() => setState('loaded')} onError={() => setState('error')}
      className={shaped
        ? 'block h-auto w-full bg-[#dfe3e5]'
        : `absolute inset-0 h-full w-full bg-[#dfe3e5] object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
  );
  const boxStyle = shaped && frame ? { width: `${frame.width}px` } : mediaFrameStyle(frame ?? undefined);
  const skeleton = !loaded && <MediaSkeleton kind="video" frame={frame ?? undefined} failed={state === 'error'} />;

  // GIF continua tocando sozinho na conversa, sem controles e sem abrir nada.
  if (autoLoop) {
    return (
      <span style={boxStyle} className="wa-media-frame relative block overflow-hidden">
        {skeleton}
        {media}
        {loaded && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">GIF</span>
        )}
      </span>
    );
  }

  // Vídeo comum: capa com botão de play. Os controles nativos dentro de uma
  // bolha estreita ficavam espremidos e mal davam para acertar; agora o clique
  // abre o vídeo grande, na frente da conversa, com os controles em tamanho de
  // gente.
  return (
    <>
      <button type="button" onClick={() => loaded && setOpen(true)} disabled={!loaded}
        aria-label="Abrir vídeo" style={boxStyle}
        className="wa-media-frame group/video relative block overflow-hidden text-left">
        {skeleton}
        {media}
        {loaded && (
          <>
            <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition group-hover/video:bg-black/25">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/25 transition group-hover/video:scale-105">
                <Play size={22} fill="currentColor" />
              </span>
            </span>
            {duration > 0 && (
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                <VideoIcon size={11} /> {fmtAudioTime(duration)}
              </span>
            )}
          </>
        )}
      </button>
      {open && <WaVideoLightbox src={src} name={name || 'Vídeo'} onClose={() => setOpen(false)} />}
    </>
  );
};

// ── Álbum de imagens (estilo WhatsApp) — agrupa imagens enviadas juntas ──
// Mostra até 4 miniaturas num grid; "+N" no excedente. Legenda da 1ª imagem e
// hora/status da última, como no WhatsApp. Cada célula abre o lightbox.
export const ImageAlbum: React.FC<{
  items: WhatsAppMessage[]; out: boolean; senderName: string | null; groupStart?: boolean;
  onOpenImage: (url: string) => void;
  /** Horário do agendamento, quando alguma das imagens do álbum saiu da fila. */
  scheduledAt?: string | null;
}> = React.memo(({ items, out, senderName, groupStart = true, onOpenImage, scheduledAt }) => {
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  const last = items[items.length - 1];
  const caption = items.find(i => i.content)?.content || '';
  const busy = items.some(i => i._local === 'uploading' || i._local === 'sending');
  // Mídia sangra até a borda (igual WhatsApp): sem moldura verde. Nome do remetente
  // e legenda ficam sobrepostos; a hora vai num canto sobre a imagem.
  const ticks = !busy && out && (last.status === 'read'
    ? <CheckCheck size={12} className="text-sky-300" />
    : last.status === 'delivered' ? <CheckCheck size={12} className="opacity-50" /> : <Check size={12} className="opacity-50" />);
  return (
    <div className={`wa-msg-in group flex items-end ${groupStart ? 'mt-2' : 'mt-[2px]'} ${out ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[280px]">
        <div className={`relative grid gap-1 w-64 ${shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} rounded-2xl overflow-hidden shadow-sm`}>
          {shown.map((m, i) => {
            const overlay = i === shown.length - 1 && extra > 0;
            return (
              <button key={m._tempId || m.id} data-msg-id={m.id} onClick={() => m.media_url && onOpenImage(m.media_url)}
                className="relative aspect-square overflow-hidden bg-black/10">
                {m.media_url
                  ? <AlbumImage key={m.media_url} src={m.media_url} alt={m.content || 'imagem'} />
                  : <span className="wa-media-skeleton absolute inset-0 flex items-center justify-center"><Loader2 size={16} className="relative z-[1] animate-spin text-[#8696a0]" /></span>}
                {overlay && <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-[18px] font-bold">+{extra}</span>}
              </button>
            );
          })}
          {senderName && (
            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px] font-bold">{senderName}</span>
          )}
          {/* Mesma marca interna da bolha (ver `scheduledAt` em MessageBubble):
              sobre a grade, e abaixo do nome quando os dois aparecem. */}
          {scheduledAt && (
            <span title="Marca interna: este envio saiu de um agendamento. O contato não vê este aviso."
              className={`absolute ${senderName ? 'top-7' : 'top-1.5'} left-1.5 z-[2] flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-white`}>
              <CalendarClock size={10} className="shrink-0" /> Agendada · {formatScheduleStamp(scheduledAt)}
            </span>
          )}
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px]">
            {busy && <Loader2 size={11} className="animate-spin" />}
            {formatTime(last.wa_timestamp)}
            {ticks}
          </span>
        </div>
        {caption && <p className="pt-1 text-[13px] leading-snug whitespace-pre-wrap break-words text-slate-800">{caption}</p>}
      </div>
    </div>
  );
});
ImageAlbum.displayName = 'ImageAlbum';

const AlbumImage: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const [state, setState] = useState<MediaLoadState>('loading');
  return (
    <>
      {state !== 'loaded' && (
        <span className="wa-media-skeleton absolute inset-0 flex items-center justify-center">
          {state === 'error'
            ? <ImageIcon size={20} className="relative z-[1] text-[#8696a0]" />
            : <Loader2 size={16} className="relative z-[1] animate-spin text-[#8696a0]" />}
        </span>
      )}
      <img src={src} alt={alt} loading="lazy" decoding="async"
        onLoad={() => setState('loaded')} onError={() => setState('error')}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 hover:opacity-95 ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`} />
    </>
  );
};
