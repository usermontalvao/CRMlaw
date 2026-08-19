// A tela cheia da chamada de vídeo — o formato que todo mundo já conhece do
// telefone: o rosto do outro lado ocupando a tela inteira, a nossa imagem numa
// miniatura arrastável e os botões numa barra que some sozinha.
//
// Por que uma tela e não o painelzinho flutuante: falar por vídeo é olhar para
// alguém. Uma faixa de 440 px dentro de um cartão serve para conferir que a
// câmera ligou, não para conversar — documento na mão, expressão, o ambiente
// atrás da pessoa, nada disso se lê num selo. Uma chamada de VOZ é diferente:
// ali o painel flutuante continua sendo o certo, porque o operador precisa do
// CRM inteiro enquanto fala. Por isso a tela cheia é só do vídeo, e sair dela
// (botão de recolher ou Esc) devolve a mesma ligação ao painel flutuante sem
// interromper nada.
//
// A imagem que aparece aqui vem por FUNÇÃO, nunca por prop: `MediaStream` nunca
// é igual a si mesmo numa comparação e o cronômetro repinta a tela a cada
// segundo — passá-lo pelo estado reiniciaria o <video> uma vez por segundo.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  ChevronDown, Circle, Maximize2, MessageSquare, Mic, MicOff, Minimize2, PhoneOff,
  RotateCw, Square, User, Video, VideoOff, WifiOff,
} from 'lucide-react';
import { Avatar } from './avatar';
import { WaAudioDeviceButton } from './audioDeviceSettings';
import { CallTimer, callDisplayName, callStatusText, useDraggablePosition } from './callModals';
import { prettyPhone } from './format';
import { selfViewPosition } from './callWidgetPlacement';
import { DEFAULT_CAMERA_TURN, selfViewTurn } from '../../services/wacalls/videoTurn';
import type { WaCall } from '../../services/wacalls/types';

/** Acima do painel flutuante (2147483100) e abaixo da chamada recebida (…200). */
const Z_VIDEO_SCREEN = 2147483150;

/** Onde a miniatura da nossa câmera foi largada da última vez. */
const SELF_VIEW_KEY = 'wa:callSelfViewPos';

/**
 * A miniatura, em pé e deitada.
 *
 * O <video> por dentro é SEMPRE deitado (a webcam entrega 4:3); quem vira é a
 * moldura. Girando só o elemento dentro de uma moldura fixa, a imagem aparecia
 * cortada nas laterais a cada quarto de volta.
 */
const SELF_LANDSCAPE = { width: 176, height: 132 };
const SELF_PORTRAIT = { width: 132, height: 176 };

/** Quanto tempo os controles ficam na tela depois do último movimento. */
const CHROME_IDLE_MS = 4000;

export const CallVideoScreen: React.FC<{
  call: WaCall;
  /** As imagens da chamada, buscadas na hora de plugar o <video>. */
  streams: () => { local: MediaStream | null; remote: MediaStream | null } | null;
  /**
   * Quartos de volta que a NOSSA imagem leva antes de sair daqui. A miniatura
   * NÃO desenha este número: ela desenha o que o contato vê (`selfViewTurn`),
   * que é este giro mais o que o aparelho dele acrescenta sozinho.
   */
  selfOrientation?: number;
  /** Rede local ou serviço de chamadas fora do ar. */
  linkDown?: boolean;
  videoSupported?: boolean;
  /** Volta ao painel flutuante, com a ligação de pé. */
  onMinimize: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleRecording: () => void;
  onToggleVideo?: () => void;
  onRotateVideo?: () => void;
  onOpenConversation?: () => void;
}> = ({
  call, streams, selfOrientation = DEFAULT_CAMERA_TURN, linkDown = false, videoSupported = false,
  onMinimize, onHangUp, onToggleMute, onToggleRecording, onToggleVideo, onRotateVideo,
  onOpenConversation,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const selfRef = useRef<HTMLDivElement>(null);
  const [temRemoto, setTemRemoto] = useState(false);
  const [controlesVisiveis, setControlesVisiveis] = useState(true);
  const [telaCheia, setTelaCheia] = useState(false);

  const finished = call.phase === 'ENDED' || call.phase === 'FAILED';
  // O ângulo da miniatura é o do CELULAR DO CONTATO, não o nosso — é a única
  // leitura útil: o operador quer saber como ele está aparecendo lá.
  const giroVisto = selfViewTurn(selfOrientation);
  const girado = giroVisto % 2 === 1;
  const mostrandoRemoto = temRemoto && call.peerVideo;

  const { pos: selfPos, dragging: arrastandoSelf, handlers: selfHandlers } = useDraggablePosition(
    selfRef,
    {
      storageKey: SELF_VIEW_KEY,
      fallbackSize: girado ? SELF_PORTRAIT : SELF_LANDSCAPE,
      place: selfViewPosition,
    },
  );

  // Plugar os streams nos elementos. Reatribuir o MESMO stream reinicia o
  // <video> no Chrome (a imagem pisca), então só troca quando mudou de verdade.
  useEffect(() => {
    const atual = streams();
    const aplicar = (el: HTMLVideoElement | null, stream: MediaStream | null) => {
      if (!el || el.srcObject === stream) return;
      el.srcObject = stream;
    };
    aplicar(remoteRef.current, atual?.remote ?? null);
    aplicar(backdropRef.current, atual?.remote ?? null);
    aplicar(localRef.current, atual?.local ?? null);
    setTemRemoto(!!atual?.remote);
  }, [streams, call.videoOn, call.peerVideo]);

  /**
   * Sem imagem do outro lado não há o que a barra esteja tapando — e uma tela
   * escura sem botão nenhum parece travada. Nesse caso os controles ficam.
   */
  const podeEsconder = mostrandoRemoto && !finished;
  const podeEsconderRef = useRef(podeEsconder);
  podeEsconderRef.current = podeEsconder;
  const relogio = useRef<number | null>(null);

  /**
   * Movimento (mouse, dedo, tecla) traz os controles de volta e REINICIA a
   * contagem.
   *
   * O relógio é imperativo de propósito. Numa primeira versão ele vivia num
   * `useEffect` que dependia de `controlesVisiveis`: como acordar com os botões
   * já à mostra não muda estado nenhum, o efeito não rodava de novo e o
   * relógio antigo seguia correndo — os controles sumiam 4 segundos depois de
   * aparecerem, com o mouse andando por cima deles.
   */
  const acordar = useCallback(() => {
    setControlesVisiveis(true);
    if (relogio.current) window.clearTimeout(relogio.current);
    relogio.current = null;
    if (!podeEsconderRef.current) return;
    relogio.current = window.setTimeout(() => setControlesVisiveis(false), CHROME_IDLE_MS);
  }, []);

  // Começa acordado, e recomeça quando a câmera do outro lado entra ou sai (é
  // aí que a tela muda de "retrato parado" para "conversa").
  useEffect(() => { acordar(); }, [acordar, podeEsconder]);
  useEffect(() => () => { if (relogio.current) window.clearTimeout(relogio.current); }, []);

  // Esc recolhe para o painel flutuante — mas só depois de sair da tela cheia
  // do navegador, senão um único Esc faria as duas coisas de uma vez.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      acordar();
      if (event.key !== 'Escape') return;
      if (document.fullscreenElement) return;
      onMinimize();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMinimize, acordar]);

  useEffect(() => {
    const onChange = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const alternarTelaCheia = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => { /* o navegador decide */ });
      return;
    }
    void rootRef.current?.requestFullscreen?.().catch(() => { /* recusado: segue em tela cheia nossa */ });
  }, []);

  // A ligação acabou: nada de segurar o operador numa tela preta em cima do
  // CRM. O desfecho ("recusada", "não atendida") é dado pelo painel flutuante,
  // que volta a aparecer sozinho.
  useEffect(() => { if (finished) onMinimize(); }, [finished, onMinimize]);

  if (typeof document === 'undefined') return null;

  const nome = callDisplayName(call);
  const status = callStatusText(call, finished);
  const aguardandoNos = call.peerVideo && !call.videoOn;

  return createPortal(
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      role="dialog"
      aria-label={`Chamada de vídeo com ${nome}`}
      onPointerMove={acordar}
      onPointerDown={acordar}
      className="wa-call-stage fixed inset-0 select-none overflow-hidden text-white"
      style={{ zIndex: Z_VIDEO_SCREEN, cursor: controlesVisiveis ? 'default' : 'none' }}
    >
      {/* O fundo é a MESMA imagem, borrada e ampliada. Um vídeo em pé (o celular
          do cliente) numa tela deitada deixaria duas tarjas pretas enormes; com
          o fundo borrado a tela fica inteira sem cortar o rosto de ninguém. */}
      <video
        ref={backdropRef}
        autoPlay
        playsInline
        muted
        aria-hidden
        className={`absolute inset-0 h-full w-full scale-125 object-cover blur-3xl transition-opacity duration-500 ${
          mostrandoRemoto ? 'opacity-40' : 'opacity-0'
        }`}
      />
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        // Sem `muted` o navegador barra o autoplay. O som da chamada não passa
        // por aqui de qualquer forma: ele sai pelo alto-falante escolhido no
        // painel de áudio, o mesmo caminho da chamada de voz.
        muted
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
          mostrandoRemoto ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Sem imagem do outro lado: rosto grande, como o telefone faz enquanto
          chama. Um retângulo preto sem explicação parecia defeito. */}
      {!mostrandoRemoto && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="relative">
            {!finished && call.phase !== 'ACTIVE' && (
              <span className="absolute -inset-3 animate-ping rounded-full bg-emerald-400/15" />
            )}
            <div className="relative">
              <Avatar url={call.contact?.avatarUrl ?? null} name={call.contact?.name ?? null} phone={call.phone} size={132} />
            </div>
          </div>
          <p className="mt-1 text-[22px] font-bold tracking-tight">{nome}</p>
          <p className="text-[14px] font-semibold text-white/60">
            {aguardandoNos
              ? 'O outro lado ligou a câmera'
              : call.videoOn
                ? 'A câmera do outro lado está desligada'
                : status}
          </p>
          {aguardandoNos && (
            <p className="max-w-xs text-[13px] leading-snug text-white/45">
              Toque em <span className="font-semibold text-white/70">Vídeo</span> para ver e aparecer.
            </p>
          )}
        </div>
      )}

      {/* ── Barra de cima: quem, em que estado, e como sair daqui ─────────── */}
      <motion.div
        animate={{ opacity: controlesVisiveis ? 1 : 0, y: controlesVisiveis ? 0 : -16 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-3 pb-10 pt-3 sm:px-5"
        style={{ pointerEvents: controlesVisiveis ? 'auto' : 'none' }}
      >
        <button
          onClick={onMinimize}
          title="Voltar ao painel pequeno (a chamada continua)"
          aria-label="Recolher a chamada"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <ChevronDown size={20} />
        </button>
        <div className="shrink-0">
          <Avatar url={call.contact?.avatarUrl ?? null} name={call.contact?.name ?? null} phone={call.phone} size={38} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-tight">{nome}</p>
          <p className="truncate text-[12.5px] font-semibold text-white/60">
            {call.connectedAt
              ? <CallTimer connectedAt={call.connectedAt} endedAt={call.endedAt} />
              : status}
            {call.contact?.name && call.phone && (
              <span className="text-white/35"> · {prettyPhone(call.phone)}</span>
            )}
          </p>
        </div>
        {call.recording && (
          <span className="hidden items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Gravando
          </span>
        )}
        {linkDown && !finished && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-amber-950">
            <WifiOff size={13} /> Sem conexão
          </span>
        )}
        <WaAudioDeviceButton
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          size={17}
          sobreAChamada
        />
        <button
          onClick={alternarTelaCheia}
          title={telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-label={telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}
          className="hidden h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:flex"
        >
          {telaCheia ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </motion.div>

      {/* ── A nossa imagem: miniatura arrastável ──────────────────────────── */}
      {call.videoOn && (
        <div
          ref={selfRef}
          {...selfHandlers}
          className={`wa-call-selfview fixed overflow-hidden rounded-2xl shadow-[0_10px_30px_-8px_rgba(0,0,0,0.8)] ring-1 ring-white/15 ${
            arrastandoSelf ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            left: selfPos.x,
            top: selfPos.y,
            zIndex: 2,
            width: girado ? SELF_PORTRAIT.width : SELF_LANDSCAPE.width,
            height: girado ? SELF_PORTRAIT.height : SELF_LANDSCAPE.height,
          }}
          title="A sua imagem, como o contato a vê. Arraste para outro canto."
        >
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="absolute left-1/2 top-1/2 object-cover"
            style={{
              width: SELF_LANDSCAPE.width,
              height: SELF_LANDSCAPE.height,
              // A ordem importa: `scaleX(-1)` (o espelho da auto-visualização,
              // que todo aplicativo de vídeo faz) é aplicado na imagem da
              // câmera, e o giro vem por cima — assim a miniatura mostra
              // exatamente a inclinação que sai daqui.
              transform: `translate(-50%, -50%) rotate(${giroVisto * 90}deg) scaleX(-1)`,
            }}
          />
        </div>
      )}

      {/* ── Barra de baixo: os botões ─────────────────────────────────────── */}
      <motion.div
        animate={{ opacity: controlesVisiveis ? 1 : 0, y: controlesVisiveis ? 0 : 24 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/70 to-transparent px-3 pb-5 pt-14"
        style={{ pointerEvents: controlesVisiveis ? 'auto' : 'none' }}
      >
        <div className="wa-call-controls flex flex-wrap items-center justify-center gap-2 rounded-full p-2 backdrop-blur-md sm:gap-2.5">
          <RoundControl
            label={call.muted ? 'Reativar microfone' : 'Silenciar microfone'}
            active={call.muted}
            onClick={onToggleMute}
          >
            {call.muted ? <MicOff size={21} /> : <Mic size={21} />}
          </RoundControl>

          {onToggleVideo && (
            <RoundControl
              label={videoSupported
                ? (call.videoOn ? 'Desligar a câmera' : 'Ligar a câmera')
                : 'Este navegador não faz chamada de vídeo'}
              active={!call.videoOn}
              disabled={call.phase !== 'ACTIVE' || !videoSupported}
              onClick={onToggleVideo}
            >
              {call.videoOn ? <Video size={21} /> : <VideoOff size={21} />}
            </RoundControl>
          )}

          {/* GIRAR. O aparelho do contato acrescenta um giro por conta própria
              (medido em 19/08/2026 — ver `services/wacalls/videoTurn`), e o que
              sai daqui já nasce compensando. O botão fica para o aparelho que
              se comporte diferente: um quarto de volta por clique, guardado
              para as próximas chamadas, com a miniatura mostrando na hora como
              o contato passa a ver. */}
          {onRotateVideo && call.videoOn && (
            <RoundControl
              label="Girar a sua imagem um quarto de volta"
              onClick={onRotateVideo}
            >
              <RotateCw size={20} />
            </RoundControl>
          )}

          <RoundControl
            label={call.recorded && !call.recording
              ? 'Chamada já gravada'
              : call.recording ? 'Encerrar a gravação' : 'Gravar esta chamada'}
            active={call.recording}
            disabled={call.phase !== 'ACTIVE' || (call.recorded && !call.recording)}
            onClick={onToggleRecording}
          >
            {call.recording
              ? <Square size={18} className="fill-current" />
              : <Circle size={19} className={call.recorded ? '' : 'fill-red-500 text-red-500'} />}
          </RoundControl>

          {onOpenConversation && (
            <RoundControl
              label="Abrir a conversa deste contato"
              onClick={() => { onOpenConversation(); onMinimize(); }}
            >
              <MessageSquare size={20} />
            </RoundControl>
          )}

          <button
            onClick={onHangUp}
            disabled={call.phase === 'ENDING'}
            title="Encerrar a chamada"
            aria-label="Encerrar a chamada"
            className="ml-1 flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700 disabled:opacity-60"
          >
            <PhoneOff size={23} />
          </button>
        </div>
      </motion.div>

      {/* Quem está do outro lado sem câmera nenhuma ligada: um lembrete discreto
          de que a tela cheia é escolha, não prisão. */}
      {!call.videoOn && !call.peerVideo && !finished && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center">
          <span className="wa-call-controls flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white/70">
            <User size={13} /> Chamada só de voz — recolha para usar o CRM
          </span>
        </div>
      )}
    </motion.div>,
    document.body,
  );
};

/** Um botão redondo da barra. `active` é o estado "ligado/alterado", não o foco. */
const RoundControl: React.FC<{
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, active = false, disabled = false, onClick, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={`flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-40 ${
      active ? 'bg-white text-slate-900 hover:bg-white/90' : 'bg-white/15 text-white hover:bg-white/25'
    }`}
  >
    {children}
  </button>
);

export default CallVideoScreen;
