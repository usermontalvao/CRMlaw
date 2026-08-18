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
  Bell, BellOff, ChevronDown, ChevronUp, Circle, GripVertical, MessageSquare, Mic, MicOff,
  Phone, PhoneOff, Square, WifiOff,
} from 'lucide-react';
import { Avatar } from './avatar';
import { AnchorNotice, CallGuestsSection } from './callGuestPanel';
import { WaAudioDeviceButton } from './audioDeviceSettings';
import { prettyPhone } from './format';
import { callElapsedSeconds, formatCallTimer, phaseLabel } from '../../services/wacalls/callOutcome';
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
const CallTimer: React.FC<{ connectedAt: number | null }> = ({ connectedAt }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);
  if (!connectedAt) return null;
  return <span className="tabular-nums">{formatCallTimer(callElapsedSeconds(connectedAt, now))}</span>;
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
        <p className="flex-1 select-none text-[12px] font-bold uppercase tracking-wide">Chamada de voz · WhatsApp</p>
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

/** A linha de status que aparece nos dois formatos: fase ou cronômetro. */
const CallStatusLine: React.FC<{ call: WaCall; finished: boolean }> = ({ call, finished }) => {
  const status = call.error && call.phase === 'FAILED' ? call.error : phaseLabel(call.phase, call.direction);
  return call.connectedAt
    ? <CallTimer connectedAt={call.connectedAt} />
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
  /** Abre a conversa deste contato na inbox. Ausente para número sem conversa. */
  onOpenConversation?: () => void;
}> = ({
  call, linkDown = false, onHangUp, onToggleMute, onToggleRecording, onOpenConversation,
  guests = [], operators = [], me = null, onInviteGuest, onRemoveGuest,
}) => {
  const [minimized, setMinimized] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { pos, dragging, handlers } = useDraggablePosition(cardRef, {
    storageKey: POSITION_KEY, fallbackSize: CARD_SIZE, place: defaultCallWidgetPosition,
  });
  const finished = call.phase === 'ENDED' || call.phase === 'FAILED';
  const status = call.error && call.phase === 'FAILED' ? call.error : phaseLabel(call.phase, call.direction);
  const ringing = call.phase === 'CALLING' || call.phase === 'RINGING';

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
      className="fixed w-[268px] overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-[0_20px_50px_-16px_rgba(15,23,42,0.5)]"
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
            <CallTimer connectedAt={call.connectedAt} />
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
        <div className="flex items-start justify-center gap-6 border-t border-[#f1f0ec] px-4 py-4">
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

