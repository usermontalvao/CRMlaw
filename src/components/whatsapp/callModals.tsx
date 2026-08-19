// A cara das chamadas de voz: o convite de chamada recebida e o painel da
// chamada em andamento.
//
// Linguagem visual do módulo (neutros quentes, cantos generosos, framer-motion
// nas entradas). Duas escolhas de cor fogem do âmbar habitual e são
// deliberadas: verde para atender/ligar e vermelho para recusar/desligar — num
// telefone, essas duas cores JÁ significam isso para qualquer pessoa, e hesitar
// meio segundo com o cliente na linha é pior do que a coerência de paleta.
//
// O painel da chamada NÃO é mais um modal. Ele era: scrim escuro por cima do
// CRM inteiro, ninguém conseguia consultar o processo, abrir a conversa ou
// anotar nada enquanto falava — exatamente o que se faz ao telefone. Agora é
// uma janelinha flutuante, arrastável e que encolhe para uma pílula no alto da
// tela; o resto do CRM continua clicável o tempo todo.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Bell, BellOff, ChevronDown, ChevronUp, Circle, GripVertical, Maximize2, MessageSquare, Mic,
  MicOff, Phone, PhoneOff, RotateCw, Square, Video, VideoOff, WifiOff,
} from 'lucide-react';
import { Avatar } from './avatar';
import { AnchorNotice, CallGuestsSection } from './callGuestPanel';
import { WaAudioDeviceButton } from './audioDeviceSettings';
import { prettyPhone } from './format';
import { callElapsedSeconds, endedCallLabel, formatCallTimer, phaseLabel } from '../../services/wacalls/callOutcome';
import { isCallRingMuted, setCallRingMuted, stopRing } from '../../services/wacalls/ringtone';
import type { CallInviteMode, InvitableOperator } from '../../services/wacalls/callGuests';
import type { CallGuest } from '../../services/wacalls/callBridge';
import {
  clampCallWidgetPosition,
  defaultCallWidgetPosition,
  parseStoredPosition,
  topCenterPosition,
  type CallWidgetBox,
  type CallWidgetPoint,
} from './callWidgetPlacement';
import { DEFAULT_CAMERA_TURN, selfViewTurn } from '../../services/wacalls/videoTurn';
import type { WaCall } from '../../services/wacalls/types';

/** Acima dos avisos de mensagem nova (2147483000): uma linha aberta vem antes. */
const Z_WIDGET = 2147483100;
const Z_INCOMING = 2147483200;

/** Onde a última posição arrastada de cada peça fica guardada (por navegador). */
const POSITION_KEY = 'wa:callWidgetPos';
const INCOMING_POSITION_KEY = 'wa:callIncomingPos';
/** Medidas de partida; as reais são lidas do DOM assim que a peça monta. */
const CARD_SIZE: CallWidgetBox = { width: 268, height: 392 };
const INCOMING_SIZE: CallWidgetBox = { width: 400, height: 196 };

/**
 * Nome na tela: cadastro/contato quando o CRM reconhece o número; senão, o
 * número; senão, a verdade.
 *
 * A terceira saída não é enfeite. O WhatsApp entrega algumas chamadas
 * endereçadas por LID — um apelido INTERNO do contato, sem telefone nenhum
 * dentro. O painel antigo cortava o `@lid` e escrevia os dígitos com um "+" na
 * frente: em 17/08/2026 uma ligação da Lisliandra apareceu como
 * "+252677908865131", um número da Somália que nunca existiu. Não sabendo quem
 * é, o cartão diz que não sabe. */
export const CALL_UNKNOWN_PEER = 'Número não identificado';
export const callDisplayName = (call: WaCall): string =>
  call.contact?.name || (call.phone ? prettyPhone(call.phone) : CALL_UNKNOWN_PEER);

/**
 * Cronômetro vivo. Só EXISTE depois que a chamada foi atendida.
 *
 * A diferença entre "só corre" e "só existe" é a que a tela tinha errado: o
 * relógio era desenhado desde o primeiro toque e ficava parado em `00:00`
 * embaixo de "Chamando…". Um zero congelado num painel de ligação não informa
 * nada e parece defeito — o tempo de uma chamada começa quando alguém atende,
 * então antes disso não há tempo nenhum a mostrar. Devolvendo `null`, a linha
 * some e o estado (chamando / tocando) fica sozinho, que é o que interessa
 * enquanto ninguém atendeu.
 */
export const CallTimer: React.FC<{ connectedAt: number | null; endedAt?: number | null }> = ({ connectedAt, endedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Chamada encerrada tem duração FIXA. Deixar o relógio correndo depois do
    // fim mostrava, nos segundos em que o cartão ainda está na tela, uma
    // conversa que continua acontecendo — e era esse número, e não o registro,
    // que o operador anotava.
    if (!connectedAt || endedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connectedAt, endedAt]);
  if (!connectedAt) return null;
  return <span className="tabular-nums">{formatCallTimer(callElapsedSeconds(connectedAt, endedAt || now))}</span>;
};

/** Botãozinho que silencia o TOQUE (não o microfone) e guarda a preferência. */
const RingMuteButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [muted, setMuted] = useState(() => isCallRingMuted());
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const next = !muted;
        setMuted(next);
        setCallRingMuted(next);
        if (next) stopRing();
      }}
      title={muted ? 'Toque silenciado — reativar' : 'Silenciar o toque'}
      aria-pressed={muted}
      className={`rounded-lg p-1.5 transition ${className}`}
    >
      {muted ? <BellOff size={15} /> : <Bell size={15} />}
    </button>
  );
};

/**
 * Chamada recebida — o cartão que aparece sozinho, em qualquer tela do CRM.
 *
 * Nasce no ALTO E AO CENTRO, e não no canto: ali é onde os olhos já estão e,
 * mais prático, é o único lugar que não briga com a coluna de avisos de
 * mensagem nova (canto superior direito). Dali em diante ele é arrastável pela
 * faixa verde — quem está no meio de uma tarefa empurra o convite para o lado
 * sem precisar decidir na hora entre atender e recusar. Vem acima de tudo: uma
 * linha tocando não pode ficar atrás de um toast.
 */
export const IncomingCallCard: React.FC<{
  call: WaCall;
  onAccept: () => void;
  onReject: () => void;
}> = ({ call, onAccept, onReject }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const { pos, dragging, handlers } = useDraggablePosition(cardRef, {
    storageKey: INCOMING_POSITION_KEY, fallbackSize: INCOMING_SIZE, place: topCenterPosition,
  });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: -18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -18, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      role="alertdialog"
      aria-label="Chamada de WhatsApp recebida"
      className="fixed w-[min(94vw,25rem)] overflow-hidden rounded-2xl border border-emerald-600/20 bg-white shadow-[0_18px_50px_-12px_rgba(15,23,42,0.45)]"
      style={{ left: pos.x, top: pos.y, zIndex: Z_INCOMING }}
    >
      <div
        {...handlers}
        className={`flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 px-3.5 py-2 text-white ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <GripVertical size={14} className="shrink-0 text-white/60" />
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        {/* Voz e vídeo se anunciam diferente: quem atende um convite de vídeo
            achando que é voz aparece na tela do cliente sem ter escolhido isso.
            (Atender ainda entra só com a voz — a câmera é um clique depois.) */}
        <p className="flex-1 select-none text-[12px] font-bold uppercase tracking-wide">
          {call.peerVideo ? 'Chamada de vídeo · WhatsApp' : 'Chamada de voz · WhatsApp'}
        </p>
        <RingMuteButton className="text-white/85 hover:bg-white/15 hover:text-white" />
      </div>
      <div className="flex items-center gap-3.5 px-4 py-4">
        <div className="relative shrink-0">
          {/* Os dois anéis pulsando são o "telefone tocando" visual: mesmo de
              relance, do outro lado da sala, dá para ver que ainda está tocando. */}
          <span className="absolute -inset-1.5 animate-ping rounded-full bg-emerald-500/20" />
          <span className="absolute -inset-0.5 rounded-full ring-2 ring-emerald-500/40" />
          <div className="relative">
            <Avatar url={call.contact?.avatarUrl ?? null} name={call.contact?.name ?? null} phone={call.phone} size={52} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-slate-800">{callDisplayName(call)}</p>
          {/* Número desconhecido já É o título; repeti-lo abaixo só ocupava linha. */}
          {call.contact?.name && call.phone
            ? <p className="truncate text-[12.5px] text-slate-500">{prettyPhone(call.phone)}</p>
            : <p className="truncate text-[12.5px] text-slate-400">
                {call.phone ? 'Número fora do cadastro' : 'O WhatsApp não enviou o número desta chamada'}
              </p>}
          {/* Por que está tocando (ou por que está calado) aqui: é o que evita
              duas pessoas atendendo a mesma ligação — e o que permite a terceira
              atender quando sabe que o dono da conversa saiu. */}
          <p className={`mt-0.5 text-[12px] font-semibold ${call.route?.ring === false ? 'text-slate-400' : 'text-emerald-600'}`}>
            {call.route?.label || 'Chamando você…'}
          </p>
        </div>
      </div>
      <div className="flex gap-2 border-t border-[#f1f0ec] p-3">
        <button
          onClick={onReject}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#e2e0d9] bg-white px-3 py-2.5 text-[13px] font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <PhoneOff size={16} /> Recusar
        </button>
        <button
          onClick={onAccept}
          className="flex flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Phone size={16} /> Atender
        </button>
      </div>
    </motion.div>,
    document.body,
  );
};

/** A posição guardada no navegador para aquela peça, se houver uma válida. */
function storedPosition(key: string): CallWidgetPoint | null {
  try { return parseStoredPosition(localStorage.getItem(key)); } catch { return null; }
}

const viewportBox = (): CallWidgetBox => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * Arrasto por ponteiro (mouse, caneta e dedo no mesmo caminho).
 *
 * Enquanto arrasta, quem escuta é a JANELA — não o punho. Prender o ponteiro no
 * próprio punho (`setPointerCapture`) parece a solução óbvia e falha calado
 * quando a captura não é concedida: o painel gruda no primeiro pixel e não sai
 * mais. Com os ouvintes na janela, o painel acompanha o ponteiro mesmo quando
 * ele corre por cima de um iframe, de um canvas ou sai da área do documento.
 *
 * A medida do painel é lida do DOM, e não fixada aqui: a altura muda com o
 * estado da chamada (o rodapé de controles some quando ela termina) e com o
 * zoom do navegador. Com a medida errada, o canto padrão calculado no primeiro
 * quadro estourava o limite e o painel nascia grudado no canto superior
 * esquerdo, longe de onde deveria.
 */
export function useDraggablePosition(
  nodeRef: React.RefObject<HTMLElement | null>,
  options: {
    /** Chave no localStorage — cada peça guarda a SUA posição. */
    storageKey: string;
    /** Medida de partida, usada até o DOM ser medido. */
    fallbackSize: CallWidgetBox;
    /** O canto de onde a peça parte quando ninguém a arrastou ainda. */
    place: (viewport: CallWidgetBox, size: CallWidgetBox) => CallWidgetPoint;
  },
) {
  const { storageKey, fallbackSize, place } = options;
  const sizeRef = useRef<CallWidgetBox>(fallbackSize);
  const [pos, setPos] = useState<CallWidgetPoint>(() => {
    const stored = storedPosition(storageKey);
    return stored
      ? clampCallWidgetPosition(stored, viewportBox(), fallbackSize)
      : place(viewportBox(), fallbackSize);
  });
  const [dragging, setDragging] = useState(false);
  const posRef = useRef(pos);
  const grab = useRef({ x: 0, y: 0 });

  useEffect(() => { posRef.current = pos; }, [pos]);

  /** Move e ANOTA na mesma hora: o `posRef` não pode esperar o próximo render. */
  const moveTo = useCallback((point: CallWidgetPoint) => {
    const next = clampCallWidgetPosition(point, viewportBox(), sizeRef.current);
    posRef.current = next;
    setPos(next);
  }, []);

  // Já montado: mede de verdade e refaz a conta do canto padrão. Quem já
  // arrastou alguma vez mantém a posição escolhida — só o limite é reconferido.
  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    const measured = { width: el.offsetWidth, height: el.offsetHeight };
    if (!measured.width || !measured.height) return;
    sizeRef.current = measured;
    const stored = storedPosition(storageKey);
    setPos(stored
      ? clampCallWidgetPosition(stored, viewportBox(), measured)
      : place(viewportBox(), measured));
  }, [nodeRef, storageKey, place]);

  // Janela redimensionada (ou monitor trocado) não pode deixar o botão de
  // encerrar fora do alcance com a ligação de pé.
  useEffect(() => {
    const onResize = () => setPos(p => clampCallWidgetPosition(p, viewportBox(), sizeRef.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A PEÇA também muda de tamanho: ligar a câmera alarga o cartão. Sem observar
  // isso, o limite continuaria calculado sobre a medida antiga e a janela de
  // vídeo nasceria com um pedaço fora da tela — a medida só seria refeita se
  // alguém por acaso redimensionasse o navegador.
  useEffect(() => {
    const el = nodeRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const medida = { width: el.offsetWidth, height: el.offsetHeight };
      if (!medida.width || !medida.height) return;
      sizeRef.current = medida;
      setPos(p => clampCallWidgetPosition(p, viewportBox(), medida));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [nodeRef]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      moveTo({ x: event.clientX - grab.current.x, y: event.clientY - grab.current.y });
    };
    const onUp = () => {
      setDragging(false);
      try { localStorage.setItem(storageKey, JSON.stringify(posRef.current)); } catch { /* sem persistência */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, storageKey, moveTo]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); // sem seleção de texto arrastando junto
    grab.current = { x: event.clientX - posRef.current.x, y: event.clientY - posRef.current.y };
    setDragging(true);
  }, []);

  return { pos, dragging, handlers: { onPointerDown } };
}

/**
 * O que a chamada diz de si, em uma linha.
 *
 * Enquanto ela corre, é a fase ("Chamando…", "Em chamada"). Depois que acaba,
 * é o DESFECHO — e essa era a informação que faltava: "Chamada encerrada"
 * servia igualmente para a que o contato atendeu e para a que ele recusou, que
 * é justamente a que muda o próximo passo do atendente.
 */
export function callStatusText(call: WaCall, finished: boolean): string {
  if (call.error && call.phase === 'FAILED') return call.error;
  if (!finished) return phaseLabel(call.phase, call.direction);
  return endedCallLabel(call.endReason, {
    answered: call.connectedAt !== null,
    direction: call.direction,
  });
}

/** A linha de status que aparece nos dois formatos: fase ou cronômetro. */
const CallStatusLine: React.FC<{ call: WaCall; finished: boolean }> = ({ call, finished }) => {
  const status = callStatusText(call, finished);
  return call.connectedAt
    ? <CallTimer connectedAt={call.connectedAt} endedAt={call.endedAt} />
    : <span className={finished ? 'text-slate-500' : 'text-emerald-600'}>{status}</span>;
};

/**
 * A pílula do alto — o que fica quando o painel é minimizado.
 *
 * Existe para responder a uma pergunta só, sem clique nenhum: "eu ainda estou
 * em ligação, e com quem?". Por isso ela leva rosto, nome e cronômetro, e não
 * um simples ícone de telefone. Fica no topo e ao centro, fora do caminho do
 * conteúdo e sempre no mesmo lugar, independentemente de onde o painel estava
 * quando foi encolhido.
 */
const MinimizedCallPill: React.FC<{
  call: WaCall;
  finished: boolean;
  linkDown: boolean;
  onExpand: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
}> = ({ call, finished, linkDown, onExpand, onHangUp, onToggleMute }) => (
  <div className="pointer-events-none fixed inset-x-0 top-3 flex justify-center px-3" style={{ zIndex: Z_WIDGET }}>
    <motion.div
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      role="status"
      aria-label="Chamada em andamento (minimizada)"
      className={`pointer-events-auto flex items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-2 shadow-lg ${
        linkDown ? 'border-amber-400 bg-amber-50' : finished ? 'border-[#e7e5df] bg-white' : 'border-emerald-600/25 bg-white'
      }`}
    >
      <button
        onClick={onExpand}
        className="flex items-center gap-2.5 rounded-full pr-1 text-left transition hover:opacity-80"
        title="Abrir o painel da chamada"
      >
        <div className="relative shrink-0">
          <Avatar url={call.contact?.avatarUrl ?? null} name={call.contact?.name ?? null} phone={call.phone} size={30} />
          {!finished && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="max-w-[9.5rem] truncate text-[12.5px] font-bold leading-tight text-slate-800">
            {callDisplayName(call)}
          </p>
          <p className="flex items-center gap-1 text-[12px] font-semibold leading-tight tabular-nums">
            {linkDown && <WifiOff size={12} className="shrink-0 text-amber-600" />}
            {call.recording && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-600" />}
            <CallStatusLine call={call} finished={finished} />
          </p>
        </div>
      </button>
      {!finished && (
        <div className="flex items-center gap-1 border-l border-[#f1f0ec] pl-1.5">
          <button
            onClick={onToggleMute}
            aria-pressed={call.muted}
            title={call.muted ? 'Reativar microfone' : 'Silenciar microfone'}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
              call.muted ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'
            }`}
          >
            {call.muted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <button
            onClick={onHangUp}
            disabled={call.phase === 'ENDING'}
            title="Encerrar chamada"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <PhoneOff size={14} />
          </button>
          <button
            onClick={onExpand}
            title="Expandir"
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-[#f3f2ef] hover:text-slate-600"
          >
            <ChevronDown size={15} />
          </button>
        </div>
      )}
    </motion.div>
  </div>
);

/**
 * O painel da chamada em curso (ou da que acabou de terminar).
 *
 * Flutuante e arrastável pelo punho do cabeçalho; nada de scrim atrás. O resto
 * do CRM segue navegável durante a ligação — e como o host mora na raiz do
 * app, trocar de módulo não desmonta nem o painel nem a chamada.
 */
/**
 * O palco de vídeo da chamada: a imagem do outro lado grande e a nossa câmera
 * numa miniatura por cima.
 *
 * Os `MediaStream` NÃO vêm por prop nem pelo estado do store — eles nunca são
 * iguais a si mesmos numa comparação, e a tela repintaria sem parar. Vêm de uma
 * função que o palco chama na hora de plugar o <video>.
 */
const CallVideoStage: React.FC<{
  call: WaCall;
  streams: () => { local: MediaStream | null; remote: MediaStream | null } | null;
  /** Quartos de volta da NOSSA imagem; a miniatura desenha o que o contato vê. */
  orientation?: number;
  /** Abre a tela cheia (ver `callVideoScreen`). */
  onExpand?: () => void;
}> = ({ call, streams, orientation = DEFAULT_CAMERA_TURN, onExpand }) => {
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const [temImagem, setTemImagem] = useState(false);

  useEffect(() => {
    const atual = streams();
    // Reatribuir o MESMO stream reinicia o <video> no Chrome — e a imagem
    // pisca a cada repintura do cartão, que acontece a cada segundo por causa
    // do cronômetro. Só troca quando realmente mudou.
    const aplicar = (el: HTMLVideoElement | null, stream: MediaStream | null) => {
      if (!el || el.srcObject === stream) return;
      el.srcObject = stream;
    };
    aplicar(remoteRef.current, atual?.remote ?? null);
    aplicar(localRef.current, atual?.local ?? null);
    setTemImagem(!!atual?.remote);
  }, [streams, call.videoOn, call.peerVideo]);

  // O outro lado pediu vídeo e nós ainda não ligamos a câmera. Sem esta
  // mensagem o operador via um retângulo preto sem explicação: o vídeo dele só
  // começa a chegar depois que este lado aceita o upgrade.
  const aguardandoNos = call.peerVideo && !call.videoOn;

  return (
    // 4:3 e não 16:9. Numa janela de 440px o palco 16:9 tinha 247px de altura e
    // o bloco branco embaixo (rosto, nome, cronômetro, botões) tinha mais que
    // isso: a ligação de VÍDEO era desenhada como uma ligação de voz com uma
    // faixa de imagem em cima. Aqui o vídeo é o assunto — o nome e o tempo vêm
    // POR CIMA dele, como no telefone, e o bloco branco sai da tela.
    <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-[#f1f0ec] bg-slate-900">
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        // Sem `muted` o navegador barraria o autoplay; o som da chamada não vem
        // por aqui de qualquer forma — ele sai pelo alto-falante escolhido no
        // painel de áudio, que é o mesmo caminho da chamada só de voz.
        muted
        className={`h-full w-full object-cover ${temImagem && call.peerVideo ? '' : 'opacity-0'}`}
      />
      {!(temImagem && call.peerVideo) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-5 text-center">
          <VideoOff size={22} className="text-slate-500" />
          <p className="text-[11.5px] font-semibold leading-snug text-slate-300">
            {aguardandoNos
              ? 'O outro lado ligou a câmera.'
              : call.videoOn
                ? 'A câmera do outro lado está desligada'
                : 'Sem vídeo'}
          </p>
          {aguardandoNos && (
            <p className="text-[11px] leading-snug text-slate-500">
              Toque em Vídeo para ver e aparecer.
            </p>
          )}
        </div>
      )}
      {call.videoOn && (
        // A moldura vira com o giro (o <video> por dentro é sempre deitado):
        // girando só o elemento, a imagem aparecia cortada nas laterais.
        <div
          className="wa-call-selfview absolute bottom-2 right-2 z-10 overflow-hidden rounded-lg border border-white/20 shadow-lg"
          style={{
            width: selfViewTurn(orientation) % 2 === 1 ? 72 : 96,
            height: selfViewTurn(orientation) % 2 === 1 ? 96 : 72,
          }}
        >
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="absolute left-1/2 top-1/2 object-cover"
            style={{
              width: 96,
              height: 72,
              transform: `translate(-50%, -50%) rotate(${selfViewTurn(orientation) * 90}deg) scaleX(-1)`,
            }}
          />
        </div>
      )}
      {/* Quem está na linha e há quanto tempo, sem roubar altura do vídeo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold leading-tight text-white">{callDisplayName(call)}</p>
          <p className="truncate text-[11.5px] font-semibold text-white/70">
            {call.connectedAt
              ? <CallTimer connectedAt={call.connectedAt} endedAt={call.endedAt} />
              : callStatusText(call, false)}
          </p>
        </div>
      </div>
      {/* Voltar para a tela cheia. O caminho de ida é automático (a câmera
          acendeu, a tela abre); este é o caminho de volta para quem recolheu o
          painel para mexer no CRM e agora quer o rosto grande outra vez. */}
      {onExpand && (
        <button
          onClick={onExpand}
          title="Ver em tela cheia"
          aria-label="Ver a chamada em tela cheia"
          className="wa-call-controls absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full text-white/90 transition hover:brightness-150"
        >
          <Maximize2 size={15} />
        </button>
      )}
    </div>
  );
};

export const ActiveCallWidget: React.FC<{
  call: WaCall;
  /** Quem foi chamado para esta ligação (ver `callBridge`). */
  guests?: CallGuest[];
  /** Atendentes online, para a lista de "chamar" e "transferir". */
  operators?: InvitableOperator[];
  me?: string | null;
  onInviteGuest?: (userId: string, name: string | null, mode: CallInviteMode) => void;
  onRemoveGuest?: (userId: string) => void;
  /** Rede local ou serviço de chamadas fora do ar — ver `WaCallsSnapshot.linkDown`. */
  linkDown?: boolean;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleRecording: () => void;
  /** Liga/desliga a nossa câmera. Ausente = sem botão de vídeo. */
  onToggleVideo?: () => void;
  /** `false` quando o navegador não sabe codificar H.264 (ver `videoBridge`). */
  videoSupported?: boolean;
  /** Gira a NOSSA imagem para o outro lado. Ausente = sem botão de girar. */
  onRotateVideo?: () => void;
  /** Quartos de volta que a nossa imagem já está levando (0..3). */
  videoOrientation?: number;
  /** Abre a tela cheia da chamada de vídeo. Ausente = sem o botão de ampliar. */
  onExpandVideo?: () => void;
  /** As imagens da chamada, buscadas na hora de renderizar (ver `CallVideoStage`). */
  videoStreams?: () => { local: MediaStream | null; remote: MediaStream | null } | null;
  /** Abre a conversa deste contato na inbox. Ausente para número sem conversa. */
  onOpenConversation?: () => void;
}> = ({
  call, linkDown = false, onHangUp, onToggleMute, onToggleRecording, onOpenConversation,
  onToggleVideo, videoSupported = false, videoStreams, onRotateVideo,
  videoOrientation = DEFAULT_CAMERA_TURN,
  onExpandVideo,
  guests = [], operators = [], me = null, onInviteGuest, onRemoveGuest,
}) => {
  const [minimized, setMinimized] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { pos, dragging, handlers } = useDraggablePosition(cardRef, {
    storageKey: POSITION_KEY, fallbackSize: CARD_SIZE, place: defaultCallWidgetPosition,
  });
  const finished = call.phase === 'ENDED' || call.phase === 'FAILED';
  const status = callStatusText(call, finished);
  const ringing = call.phase === 'CALLING' || call.phase === 'RINGING';
  // Com vídeo no ar o cartão alarga: 268px é largura de cartão de voz, e uma
  // imagem de rosto ali dentro não serve para conversar. 440px é o que faz um
  // rosto caber em tamanho de conversa sem o cartão virar uma janela que tapa o
  // CRM — e ele continua arrastável, então a escolha é do operador. O
  // `useDraggablePosition` observa a mudança e reajusta o limite da tela.
  const comVideo = !finished && !!videoStreams && (call.videoOn || call.peerVideo);

  // Uma chamada que termina enquanto está encolhida volta a aparecer: o
  // desfecho ("Chamada recusada", "não completada") é a única informação que o
  // operador ainda não tem, e a pílula sai da tela logo em seguida.
  useEffect(() => { if (finished) setMinimized(false); }, [finished]);

  if (typeof document === 'undefined') return null;

  if (minimized) {
    return createPortal(
      <MinimizedCallPill
        call={call}
        finished={finished}
        linkDown={linkDown && !finished}
        onExpand={() => setMinimized(false)}
        onHangUp={onHangUp}
        onToggleMute={onToggleMute}
      />,
      document.body,
    );
  }

  return createPortal(
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      role="dialog"
      aria-label="Chamada em andamento"
      className={`fixed overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-[0_20px_50px_-16px_rgba(15,23,42,0.5)] transition-[width] duration-200 ${
        comVideo ? 'w-[min(92vw,440px)]' : 'w-[268px]'
      }`}
      style={{ left: pos.x, top: pos.y, zIndex: Z_WIDGET }}
    >
      {/* Punho: a barra inteira arrasta; os botões dentro dela não (stopPropagation
          no pointerdown ficaria escondido — por isso eles ficam fora da área do
          punho, à direita, com o próprio onPointerDown parando ali). */}
      <div
        {...handlers}
        className={`flex items-center gap-1.5 border-b border-[#f1f0ec] px-2 py-1.5 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${finished ? 'bg-[#faf9f7]' : 'bg-emerald-50'}`}
      >
        <GripVertical size={14} className="shrink-0 text-slate-400" />
        <p className={`flex-1 select-none text-[11px] font-bold uppercase tracking-wide ${
          finished ? 'text-slate-400' : 'text-emerald-700'
        }`}>
          {finished ? 'Chamada' : 'Chamada em curso'}
        </p>
        {/* O atalho para os dispositivos de áudio: é NA ligação que se descobre
            que o som está saindo no monitor em vez do headset, e voltar à inbox
            para corrigir custa a chamada. Mesmo painel do fone do cabeçalho. */}
        <WaAudioDeviceButton
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-600"
          sobreAChamada
        />
        <RingMuteButton className="text-slate-400 hover:bg-white hover:text-slate-600" />
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMinimized(true)}
          title="Minimizar (a chamada continua)"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-600"
        >
          <ChevronUp size={15} />
        </button>
      </div>

      {/* A "chamada fantasma": sem rede, o cronômetro continua correndo e nada
          mais é verdade. Dizer isso na cara do operador é a diferença entre
          "ele desligou na minha cara" e "minha internet caiu". */}
      {linkDown && !finished && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-left">
          <WifiOff size={14} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-[11.5px] font-semibold leading-snug text-amber-800">
            Sem conexão. O áudio pode já ter caído dos dois lados — a chamada será
            encerrada se a internet não voltar.
          </p>
        </div>
      )}

      {call.recording && (
        <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-3 py-1.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-red-700">Gravando</p>
          <p className="ml-auto text-[11px] font-semibold text-red-600/80">vai para a ficha</p>
        </div>
      )}

      {/* O palco só aparece quando há vídeo de verdade em alguma direção: uma
          moldura preta numa chamada de voz seria ruído. */}
      {comVideo && videoStreams && (
        <CallVideoStage
          call={call}
          streams={videoStreams}
          orientation={videoOrientation}
          onExpand={onExpandVideo}
        />
      )}

      {/* O retrato grande, o nome e o cronômetro só existem SEM vídeo. Com a
          imagem no ar eles já estão escritos por cima dela (ver
          `CallVideoStage`), e repeti-los aqui era o que fazia o branco ocupar
          mais espaço que a pessoa com quem se está falando. */}
      {!comVideo && (
      <div className="flex flex-col items-center gap-1 px-6 pb-5 pt-6 text-center">
        <div className="relative">
          {ringing && <span className="absolute -inset-1.5 animate-ping rounded-full bg-emerald-500/15" />}
          <div className="relative">
            <Avatar url={call.contact?.avatarUrl ?? null} name={call.contact?.name ?? null} phone={call.phone} size={72} />
          </div>
          {call.phase === 'ACTIVE' && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
              <Phone size={11} className="text-white" />
            </span>
          )}
        </div>
        <p className="mt-2.5 max-w-full truncate text-[15.5px] font-bold text-slate-800">{callDisplayName(call)}</p>
        {call.contact?.name && call.phone && <p className="text-[12px] text-slate-400">{prettyPhone(call.phone)}</p>}
        <p className={`mt-2 text-[13px] font-semibold ${finished ? 'text-slate-500' : 'text-emerald-600'}`}>{status}</p>
        {/* Sem `connectedAt` não há chamada em andamento e, portanto, não há
            duração: a linha inteira sai da tela em vez de mostrar 00:00. */}
        {call.connectedAt && (
          <p className="mt-0.5 text-[22px] font-bold tracking-tight text-slate-700">
            <CallTimer connectedAt={call.connectedAt} endedAt={call.endedAt} />
          </p>
        )}
        {/* Falar ao telefone e ler a conversa é a mesma tarefa: o histórico do
            contato está a um clique, sem precisar procurá-lo na inbox. */}
        {onOpenConversation && (
          <button
            onClick={onOpenConversation}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#f3f2ef] px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200"
          >
            <MessageSquare size={13} /> Abrir conversa
          </button>
        )}
      </div>
      )}

      {/* Chamar um colega para a ligação ou passá-la adiante. Só com o áudio de
          pé: convidar alguém para uma chamada que ainda está chamando é
          convidá-lo para o silêncio. */}
      {!finished && onInviteGuest && (
        <CallGuestsSection
          guests={guests}
          operators={operators}
          me={me}
          canInvite={call.phase === 'ACTIVE'}
          onInvite={onInviteGuest}
          onRemove={userId => onRemoveGuest?.(userId)}
        />
      )}
      {guests.some(g => g.status === 'live' || g.status === 'joining') && <AnchorNotice />}

      {!finished && (
        <div className="flex flex-wrap items-start justify-center gap-x-4 gap-y-3 border-t border-[#f1f0ec] px-3 py-4">
          <button onClick={onToggleMute} className="group flex flex-col items-center gap-1.5" aria-pressed={call.muted}>
            <span className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
              call.muted ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'
            }`}>
              {call.muted ? <MicOff size={20} /> : <Mic size={20} />}
            </span>
            <span className="text-[11px] font-semibold text-slate-500">{call.muted ? 'Reativar' : 'Silenciar'}</span>
          </button>
          {/* Gravar só faz sentido com o áudio de pé, e uma vez por chamada:
              parar encerra o arquivo (ver `waCallsStore.setRecording`). */}
          <button
            onClick={onToggleRecording}
            className="group flex flex-col items-center gap-1.5 disabled:opacity-45"
            aria-pressed={call.recording}
            disabled={call.phase !== 'ACTIVE' || (call.recorded && !call.recording)}
            title={call.recorded && !call.recording ? 'Chamada já gravada' : call.recording ? 'Encerrar a gravação' : 'Gravar esta chamada'}
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
              call.recording ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'
            }`}>
              {call.recording
                ? <Square size={17} className="fill-current" />
                : <Circle size={18} className={call.recorded ? '' : 'fill-red-500 text-red-500'} />}
            </span>
            <span className="text-[11px] font-semibold text-slate-500">
              {call.recording ? 'Parar' : call.recorded ? 'Gravada' : 'Gravar'}
            </span>
          </button>
          {/* A câmera é sempre um UPGRADE: a chamada nasce em voz e o vídeo
              entra depois. Por isso o botão só vale com o áudio de pé. */}
          {onToggleVideo && (
            <button
              onClick={onToggleVideo}
              className="group flex flex-col items-center gap-1.5 disabled:opacity-45"
              aria-pressed={call.videoOn}
              disabled={call.phase !== 'ACTIVE' || !videoSupported}
              title={videoSupported
                ? (call.videoOn ? 'Desligar a câmera' : 'Ligar a câmera')
                : 'Este navegador não faz chamada de vídeo'}
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
                call.videoOn ? 'bg-sky-100 text-sky-700 hover:bg-sky-200' : 'bg-[#f3f2ef] text-slate-600 hover:bg-slate-200'
              }`}>
                {call.videoOn ? <Video size={20} /> : <VideoOff size={20} />}
              </span>
              {/* O rótulo não muda com o estado: a cor e o ícone já dizem se a
                  câmera está no ar, e um texto que troca de largura empurraria
                  os outros botões da fileira a cada clique. */}
              <span className="text-[11px] font-semibold text-slate-500">Vídeo</span>
            </button>
          )}
          {/* GIRAR. O aparelho do contato acrescenta um giro por conta própria
              (ver `services/wacalls/videoTurn`), e o padrão de fábrica já sai
              daqui compensando isso — este botão existe para o aparelho que se
              comporte diferente. Um quarto de volta por clique, a escolha fica
              guardada, e a miniatura mostra o resultado do lado de lá na hora.
              Só aparece com a nossa câmera no ar. */}
          {onRotateVideo && call.videoOn && (
            <button
              onClick={onRotateVideo}
              className="group flex flex-col items-center gap-1.5"
              title="Girar a sua imagem um quarto de volta para o outro lado"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f3f2ef] text-slate-600 transition hover:bg-slate-200">
                <RotateCw size={20} />
              </span>
              <span className="text-[11px] font-semibold text-slate-500">Girar</span>
            </button>
          )}
          {/* Falar ao telefone e ler a conversa é a mesma tarefa. Sem vídeo o
              atalho mora no bloco branco, ali em cima; com vídeo, o bloco não
              existe e ele vem para a fileira. */}
          {comVideo && onOpenConversation && (
            <button onClick={onOpenConversation} className="group flex flex-col items-center gap-1.5" title="Abrir a conversa deste contato">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f3f2ef] text-slate-600 transition hover:bg-slate-200">
                <MessageSquare size={19} />
              </span>
              <span className="text-[11px] font-semibold text-slate-500">Conversa</span>
            </button>
          )}
          <button onClick={onHangUp} className="group flex flex-col items-center gap-1.5" disabled={call.phase === 'ENDING'}>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition hover:bg-red-700 group-disabled:opacity-60">
              <PhoneOff size={20} />
            </span>
            <span className="text-[11px] font-semibold text-slate-500">Encerrar</span>
          </button>
        </div>
      )}
    </motion.div>,
    document.body,
  );
};

