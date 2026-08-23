// Estado das chamadas de voz — fonte única, fora do React.
//
// Modelado por `callId` num Map, e não como "a chamada do sistema": o WaCalls
// aguenta várias ao mesmo tempo e o mesmo número vai ser usado por mais de um
// operador. Cada navegador é dono do áudio das SUAS chamadas (ver `mine`), e a
// ponte de áudio de uma chamada nunca é compartilhada com outra.
//
// O padrão é o do `services/whatsapp/muteStore`: singleton com
// `subscribe`/`getSnapshot` para `useSyncExternalStore`, sem contexto React.
// Assim o mesmo estado serve o CRM completo e a janela /atendimento.
import { waCallsService, WaCallsError } from '../wacalls.service';
import { whatsappService } from '../whatsapp.service';
import { getWaCallsClientId, waCallsLog } from './config';
import {
  openCallAudio, openMicrophone, MicrophoneError,
  type WaCallAudioBridge, type WaCallRecording, type TransportFailure,
} from './audioBridge';
import {
  CameraError, DEFAULT_FPS, openCallVideo, openCamera, videoSupported,
  type WaCallVideoBridge,
} from './videoBridge';
import { DEFAULT_CAMERA_TURN } from './videoTurn';
import { callLogService, type CallLogOutcome } from '../callLog.service';
import {
  CALLABLE_PHONE_UNKNOWN, parseWaPeer, resolveCallablePhone,
  type CallablePhoneCandidate,
} from './phone';
import {
  endReasonIsFailure, endReasonMeansNeverAnswered, endReasonMessage, phaseFromStatus,
  resolveCallOutcome,
} from './callOutcome';
import { decideCallRing, CALL_ESCALATION_MS, type CallDegree, type CallRoute } from './callRouting';
import { buildLadderFor, conversationRouting } from './routingData';
import { operatorPresence } from './operatorPresence';
import { callBridge } from './callBridge';
import {
  DIAL_DENIED_DETAIL, DIAL_DENIED_MESSAGE, DIAL_UNKNOWN_DETAIL, DIAL_UNKNOWN_MESSAGE,
} from './dialPermission';
import { ensureDialPermission, resetDialPermission } from './dialPermissionData';
import { LINE_DENIED_MESSAGE, defaultLine, lineDeniedDetail, type CallLine } from './callLine';
import { resetCallLines, resolveLines } from './callLinesData';
import { readPreferredLine, writePreferredLine } from './linePreference';
import {
  canDial as canDialLine, retryDelay, shouldRetry, type RetryState,
} from './retryPolicy';
import { supabase } from '../../config/supabase';
import type { WaCall, WaCallContact, WaCallsEvent, WaCallsSession, WaCallsStatus } from './types';

/** Quanto tempo o cartão de uma chamada encerrada fica na tela antes de sumir. */
const ENDED_LINGER_MS = 2500;
const FAILED_LINGER_MS = 4500;

/**
 * Quanto tempo a chamada sobrevive sem conexão antes de ser dada como perdida.
 *
 * Existe por causa da "chamada fantasma": a internet do escritório oscila, o
 * áudio some dos dois lados, e o painel continua contando os minutos como se a
 * conversa estivesse acontecendo — o operador fala sozinho e só descobre
 * quando desliga. Doze segundos é o intervalo que engole uma troca de Wi-Fi
 * para o 4G (que se recupera sozinha) sem deixar um cronômetro mentindo por
 * meio minuto.
 */
const LINK_GRACE_MS = 12_000;

/** Aviso para a UI mostrar como toast. O store não conhece o sistema de toasts. */
export interface WaCallsNotice {
  kind: 'error' | 'info' | 'success';
  message: string;
  description?: string;
}

export interface WaCallsSnapshot {
  /** Já tentamos falar com o WaCalls pelo menos uma vez. */
  ready: boolean;
  /** O serviço respondeu na última tentativa. */
  available: boolean;
  /** O navegador enxerga rede? (`navigator.onLine`) */
  online: boolean;
  /**
   * A ligação com o mundo caiu — sem rede local OU sem o serviço de chamadas.
   * Enquanto isto for verdade, NADA que o painel mostra sobre uma chamada em
   * curso pode ser levado a sério: é o estado da "chamada fantasma".
   */
  linkDown: boolean;
  sessions: WaCallsSession[];
  /**
   * As contas pareadas vestidas de LINHA: com o nome do canal do CRM, o número
   * e o direito desta pessoa de falar por ela. É o que o discador mostra e o
   * que ele oferece para trocar. Ver `callLine.ts`.
   */
  lines: CallLine[];
  /** A linha marcada com a estrela (chave da linha), quando há uma. */
  preferredLine: string | null;
  /** Uma nova tentativa de alcançar a linha está em curso agora. */
  retrying: boolean;
  /**
   * As linhas já são conhecidas? Enquanto for falso, a tela diz que está
   * verificando — e nunca que não há canal, porque ela ainda não sabe.
   */
  linesReady: boolean;
  /** `activeWaCallsSessionId` — a conta usada para ligar. */
  sessionId: string | null;
  /** Todas as chamadas conhecidas, da mais recente para a mais antiga. */
  calls: WaCall[];
  /**
   * Uma discagem está a caminho e ainda não virou chamada no mapa (microfone e
   * POST no WaCalls levam um tempo visível). É o que deixa o botão "Ligar"
   * apagar no PRIMEIRO clique, em vez de só quando a chamada aparece.
   */
  dialing: boolean;
}

const calls = new Map<string, WaCall>();
/**
 * Status que chegou pelo SSE antes de a chamada existir aqui.
 *
 * O servidor publica o `call-status` no MESMO instante em que cria a chamada —
 * quer dizer, antes de a resposta do POST chegar ao navegador. Numa ligação
 * atendida no primeiro toque, o "connected" pode passar na frente do nosso
 * `upsert` e a tela ficaria eternamente em "Chamando…". Guardamos o último
 * status órfão e aplicamos assim que a chamada entra no mapa.
 */
const orphanStatus = new Map<string, WaCallsStatus>();
const bridges = new Map<string, WaCallAudioBridge>();
/**
 * As pontes de VÍDEO, separadas das de áudio de propósito: o vídeo entra e sai
 * várias vezes dentro de uma chamada cujo áudio nunca parou.
 */
const videoBridges = new Map<string, WaCallVideoBridge>();
/**
 * O giro da NOSSA câmera, em quartos de volta, guardado entre chamadas.
 *
 * A webcam da mesa fica onde está: o mesmo giro que acertou a imagem hoje é o
 * que acerta amanhã. Descobrir isso de novo a cada ligação, na frente do
 * cliente, é o que este `localStorage` evita.
 *
 * A CHAVE MUDOU DE NOME de propósito (era `wacalls.video.orientation`). O
 * número mudou de significado: antes era a rotação ANUNCIADA ao outro lado,
 * agora é o quanto giramos os nossos próprios pixels antes de codificar. Quem
 * tivesse clicado em "Girar" tentando consertar a imagem no aparelho do
 * contato carregaria aquele palpite para dentro da regra nova — e apareceria
 * de cabeça para baixo sem ter pedido. Chave nova, todo mundo começa do zero:
 * a câmera como ela é, e o giro é escolha de quem está vendo a miniatura.
 */
const ORIENTACAO_KEY = 'wacalls.video.turn';
/**
 * Câmeras já autorizadas esperando a chamada ser ATENDIDA.
 *
 * O teste de 19/08/2026 fechou a conta: com o `<video>` na oferta o telefone do
 * contato não toca (variante B x D), e o upgrade no meio da chamada só é aceito
 * quando a oferta anunciou a capability de vídeo. Então a ligação sai por voz,
 * a câmera fica guardada aqui — permissão pedida ANTES de o telefone tocar — e
 * o vídeo sobe sozinho no instante do atendimento. O operador não clica em
 * nada: quem pediu vídeo pediu uma vez.
 *
 * Só o FIM da chamada solta esta câmera. Um `call-video` com `videoOn: false`
 * NÃO a solta — foi assim que ela era descartada durante o toque, e o upgrade
 * não achava mais câmera nenhuma quando o contato atendia.
 */
const cameraAoAtender = new Map<string, MediaStream>();

function orientacaoGuardada(): number {
  // Sem escolha guardada vale o padrão de FÁBRICA, não o zero: a webcam da mesa
  // sem giro nenhum chega deitada no celular do contato (ver `videoTurn`).
  if (typeof localStorage === 'undefined') return DEFAULT_CAMERA_TURN;
  const bruto = Number(localStorage.getItem(ORIENTACAO_KEY));
  return Number.isInteger(bruto) && bruto >= 0 && bruto <= 3 ? bruto : DEFAULT_CAMERA_TURN;
}
/**
 * Gravação que o operador parou ANTES de a chamada acabar.
 *
 * Ela não sobe na hora de propósito: o registro da chamada só existe quando a
 * chamada termina (é ele que sabe a duração e o desfecho), e uma linha
 * incompleta escrita no meio viraria uma segunda versão da mesma ligação.
 */
const pendingRecordings = new Map<string, WaCallRecording>();
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Escalada por chamada: quando o convite exclusivo passa a tocar para todos. */
const escalationTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const noticeListeners = new Set<(notice: WaCallsNotice) => void>();
/** Quem quer saber das chamadas que ninguém atendeu (ver `missedCallStore`). */
const missedListeners = new Set<(call: WaCall) => void>();

let sessions: WaCallsSession[] = [];
let lines: CallLine[] = [];
/** As linhas já foram resolvidas ao menos uma vez com sessão de verdade. */
let linesReady = false;
let preferredLine: string | null = readPreferredLine();
let sessionId: string | null = null;
let ready = false;
let available = false;
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let linkTimer: ReturnType<typeof setTimeout> | null = null;
let linkListenersOn = false;
let initializing: Promise<void> | null = null;
/**
 * Trava de reentrada do discador.
 *
 * A checagem de "já estou em uma chamada" lê o mapa `calls` — e a chamada só
 * entra nele DEPOIS do microfone e do POST, dois `await`. Nesse intervalo o
 * segundo clique passava pela checagem e o telefone do contato tocava duas
 * vezes. Esta bandeira é síncrona: fecha a porta no primeiro clique e só reabre
 * quando a chamada já está no mapa (ou quando a tentativa falhou).
 */
let placing = false;
let closeEvents: (() => void) | null = null;
let snapshot: WaCallsSnapshot = {
  ready: false, available: false, online: true, linkDown: false,
  sessions: [], lines: [], preferredLine: null, retrying: false, linesReady: false,
  sessionId: null, calls: [], dialing: false,
};

function emit(): void {
  snapshot = {
    ready,
    available,
    online,
    // Antes do primeiro contato com o serviço, `available` é falso sem que nada
    // esteja errado — daí o `ready` na conta.
    linkDown: !online || (ready && !available),
    sessions,
    lines,
    preferredLine,
    retrying,
    linesReady,
    sessionId,
    calls: Array.from(calls.values()).sort((a, b) => b.startedAt - a.startedAt),
    dialing: placing,
  };
  // Os colegas precisam saber que esta mesa está em ligação: é o que impede a
  // transferência para quem já está falando e o que o cartão lê para não tocar
  // por cima de uma conversa. `setBusy` ignora repetição, então cabe aqui.
  operatorPresence.setBusy(liveMineCalls().length > 0);
  listeners.forEach(fn => fn());
  // O vigia do amarelo. Depois dos ouvintes de propósito: a tela pinta primeiro,
  // a sala de espera é assunto de segundo plano.
  reviewHealth();
}

function notify(notice: WaCallsNotice): void {
  noticeListeners.forEach(fn => fn(notice));
}

/**
 * Esta chamada é uma PERDIDA — daquelas que ficam avisando na tela?
 *
 * Recebida, nunca atendida, e não recusada: recusar é um ato, quem recusou já
 * viu a chamada. Uma que outro operador atendeu nem chega aqui (o
 * `incoming-claimed` a tira do mapa antes), e a que falhou também não entra: o
 * cartão diz "chamada perdida", e uma chamada que nem chegou a tocar direito
 * seria uma meia-verdade na tela de todo mundo.
 *
 * `route.show === false` é o contato BLOQUEADO. O bloqueio existe justamente
 * para essa pessoa não alcançar o escritório; avisar que ela ligou desfaria o
 * bloqueio pela porta dos fundos.
 */
function isMissedInboundCall(call: WaCall, failed: boolean): boolean {
  return call.direction === 'inbound'
    && !failed
    // Uma pergunta só, e a mesma que a ficha do cliente responde: o desfecho
    // desta chamada foi `missed`? Enquanto isto era uma lista de exceções
    // escrita à mão aqui, cada motivo novo do WhatsApp entrava como perdida —
    // `accepted_elsewhere` (atendida no celular do escritório) e `rejected`
    // (recusada) acendiam o cartão de retorno pendente na tela de todo mundo.
    && resolveCallOutcome(call.endReason, { connected: call.connectedAt !== null, failed }) === 'missed'
    && call.route?.show !== false;
}

/** As chamadas desta aba que ainda estão de pé. */
function liveMineCalls(): WaCall[] {
  return Array.from(calls.values()).filter(
    c => c.mine && c.phase !== 'ENDED' && c.phase !== 'FAILED',
  );
}

function clearEscalation(callId: string): void {
  const timer = escalationTimers.get(callId);
  if (!timer) return;
  clearTimeout(timer);
  escalationTimers.delete(callId);
}

function clearLinkTimer(): void {
  if (linkTimer) clearTimeout(linkTimer);
  linkTimer = null;
}

/**
 * A rede caiu ou voltou.
 *
 * Voltou dentro da carência: nada acontece, a chamada continua (o WebRTC se
 * recupera de oscilações curtas sozinho). Não voltou: as chamadas desta aba
 * são dadas como perdidas, com motivo próprio — é isso que impede o painel de
 * seguir contando minutos de uma conversa que já acabou sem avisar.
 */
function onLinkChanged(): void {
  emit();
  if (online) { clearLinkTimer(); return; }
  if (linkTimer) return;
  linkTimer = setTimeout(() => {
    linkTimer = null;
    if (online) return;
    for (const call of liveMineCalls()) finishCall(call.callId, 'connection_lost');
  }, LINK_GRACE_MS);
}

/** Escuta a rede do navegador. Idempotente — os ouvintes são de módulo. */
function watchLink(): void {
  if (linkListenersOn || typeof window === 'undefined') return;
  linkListenersOn = true;
  window.addEventListener('online', () => { online = true; onLinkChanged(); });
  window.addEventListener('offline', () => { online = false; onLinkChanged(); });
}

/** A bancada armou as linhas: o serviço de voz real não manda mais aqui. */
let previewLines = false;

/**
 * A conta que pode ligar: pareada, com a conexão aberta E autorizada para esta
 * pessoa.
 *
 * A AUTORIZAÇÃO ENTRA AQUI, e não só na hora de discar, porque é ela que decide
 * qual linha o discador usa quando ninguém escolheu nada: oferecer como padrão
 * uma linha que a pessoa não pode usar seria montar a armadilha de um botão
 * verde que só sabe responder com um erro. Ver `callLine.ts` para a regra.
 *
 * Enquanto as linhas não foram resolvidas (a resposta vem do banco e demora um
 * instante), vale o que o serviço disse — a lista `lines` nasce vazia e a
 * primeira conta de pé serve de padrão. O `placeCall` confere de novo, agora
 * com a resposta em mãos, e é lá que uma linha proibida é barrada de verdade.
 */
function callableSessions(list: WaCallsSession[]): WaCallsSession[] {
  return list.filter(s => s.paired && s.state === 'open');
}

/** A linha atendida por esta conta de voz, se as linhas já foram resolvidas. */
function lineOf(id: string | null): CallLine | null {
  return (id && lines.find(l => l.sessionId === id)) || null;
}

/** Dá para ligar por esta sessão AGORA? Sem linhas resolvidas, não se opõe. */
function sessionAllowed(id: string | null): boolean {
  const linha = lineOf(id);
  return linha ? linha.authorized : true;
}

function chooseSession(): void {
  const callable = callableSessions(sessions);
  // Mantém a escolha atual enquanto ela continuar válida E permitida.
  if (sessionId && callable.some(s => s.id === sessionId) && sessionAllowed(sessionId)) return;
  // Com as linhas resolvidas, quem decide é a ESTRELA (e, sem ela, a primeira
  // usável). Antes disso vale o que o serviço ofereceu.
  const preferida = lines.length > 0 ? defaultLine(lines, preferredLine) : null;
  if (preferida?.sessionId && callable.some(s => s.id === preferida.sessionId)) {
    sessionId = preferida.sessionId;
    return;
  }
  sessionId = callable.find(s => sessionAllowed(s.id))?.id ?? null;
}

function applySessions(list: WaCallsSession[]): void {
  if (previewLines) return;
  sessions = list;
  chooseSession();
  // As linhas custam duas consultas e chegam depois; quando chegarem, a escolha
  // é refeita com a autorização na mão.
  void refreshLines();
}

/**
 * Reconstrói as linhas a partir das contas pareadas.
 *
 * Falha em silêncio de propósito: sem as linhas o discador continua discando
 * pelo que o serviço ofereceu (é `placeCall` quem tem a última palavra), e um
 * erro de consulta não pode aparecer como "você não pode ligar".
 */
async function refreshLines(): Promise<void> {
  if (previewLines) return;
  const alvo = sessions;
  try {
    const resolvidas = await resolveLines(alvo);
    // Chegou tarde: as contas já são outras. Descarta.
    if (alvo !== sessions) return;
    lines = resolvidas;
    linesReady = true;
    chooseSession();
    emit();
  } catch (err) {
    // `LinesNotReady` = a pergunta ainda não podia ser feita (sessão do Supabase
    // não restaurada, consulta de canais barrada pela RLS). NÃO se apaga o que
    // já se sabia: uma resposta vazia dessas trocaria a linha de trabalho por
    // "Nenhum canal disponível" e só voltaria ao normal recarregando a página.
    // Marca para tentar de novo e segue com as linhas de antes.
    waCallsLog('linhas não resolvidas agora', err);
    if (!linesReady) scheduleRetry();
  }
}

function upsert(call: WaCall): void {
  calls.set(call.callId, call);
  emit();
  const pending = orphanStatus.get(call.callId);
  if (pending) {
    orphanStatus.delete(call.callId);
    applyStatus(call.callId, pending);
  }
}

/** Aplica um status do servidor sobre a chamada local, respeitando a fase atual. */
function applyStatus(callId: string, status: WaCallsStatus): void {
  const current = calls.get(callId);
  if (!current) return;
  const phase = phaseFromStatus(status, current.direction, current.phase);
  if (phase === current.phase) return;
  const connectedAt = phase === 'ACTIVE' && !current.connectedAt ? Date.now() : current.connectedAt;
  if (phase === 'ACTIVE' && !current.connectedAt) waCallsLog('call ACTIVE', { callId });
  patch(callId, { phase, connectedAt });
  // Atendida: a partir daqui o silêncio deixa de ser normal.
  if (phase === 'ACTIVE') watchIncomingAudio(callId);
  // E é ESTE o instante em que o upgrade de vídeo passa a ser aceito pelo outro
  // lado. Quem discou pedindo vídeo recebe a câmera aqui, sem clicar em nada.
  if (phase === 'ACTIVE' && cameraAoAtender.has(callId)) {
    const camera = cameraAoAtender.get(callId)!;
    cameraAoAtender.delete(callId);
    waCallsLog('atendida: subindo o vídeo pedido na discagem', { callId });
    void waCallsStore.startVideo(callId, camera);
  }
}

function patch(callId: string, changes: Partial<WaCall>): WaCall | null {
  const current = calls.get(callId);
  if (!current) return null;
  const next = { ...current, ...changes };
  // `wasVideo` é derivada e PEGAJOSA (ver o tipo): quem liga a câmera — daqui ou
  // do outro lado — não precisa lembrar de marcá-la, e ninguém consegue apagá-la
  // desligando o vídeo no meio da conversa.
  if (next.videoOn || next.peerVideo) next.wasVideo = true;
  calls.set(callId, next);
  emit();
  return next;
}

/** Solta a câmera que esperava o atendimento, se ainda houver uma. */
function descartarCameraPendente(callId: string): void {
  const camera = cameraAoAtender.get(callId);
  if (!camera) return;
  cameraAoAtender.delete(callId);
  try { camera.getTracks().forEach(t => t.stop()); } catch { /* já parada */ }
  waCallsLog('câmera liberada sem chegar a transmitir', { callId });
}

/** Fecha a ponte de áudio e solta os recursos daquela chamada — e só dela. */
function closeBridge(callId: string): void {
  clearAudioWatchdog(callId);
  descartarCameraPendente(callId);
  closeVideoBridge(callId);
  const bridge = bridges.get(callId);
  if (!bridge) return;
  bridges.delete(callId);
  bridge.close();
}

/** Desliga a câmera daquela chamada — e só dela. */
function closeVideoBridge(callId: string): void {
  const video = videoBridges.get(callId);
  if (!video) return;
  videoBridges.delete(callId);
  video.close();
}

/**
 * Sobe o encoder da nossa câmera nesta chamada.
 *
 * Só a parte LOCAL: quem negociou o vídeo com o outro lado é quem chama — a
 * oferta inicial, na chamada que já nasce em vídeo, ou o `enable_video`, no
 * upgrade de uma chamada de voz em curso. Misturar as duas coisas aqui foi
 * exatamente o que fazia o botão de vídeo discar em áudio e depois pedir um
 * upgrade que o outro lado recusava.
 */
async function attachVideoBridge(callId: string, cameraStream: MediaStream): Promise<boolean> {
  if (videoBridges.has(callId)) {
    cameraStream.getTracks().forEach(t => t.stop());
    return true;
  }
  let video: WaCallVideoBridge;
  try {
    video = await openCallVideo({
      callId,
      cameraStream,
      fps: DEFAULT_FPS,
      // O giro escolhido antes vale desde o PRIMEIRO quadro. Aplicá-lo depois
      // faria o contato ver a imagem deitada e ela endireitar sozinha na cara
      // dele, no meio da conversa.
      orientation: orientacaoGuardada(),
      onFailure: motivo => {
        waCallsLog('a ponte de vídeo falhou', { callId, motivo });
        void waCallsStore.stopVideo(callId);
        notify({ kind: 'error', message: 'O vídeo caiu. A voz continua.' });
      },
    });
  } catch (err) {
    cameraStream.getTracks().forEach(t => t.stop());
    notify({
      kind: 'error',
      message: err instanceof CameraError ? err.message : 'Não foi possível codificar o vídeo.',
    });
    return false;
  }
  // O encoder leva alguns quadros para subir; nesse intervalo a chamada pode ter
  // acabado (recusa, cancelamento). Guardar a ponte agora deixaria a câmera
  // acesa iluminando ninguém.
  const viva = calls.get(callId);
  if (!viva || viva.phase === 'ENDED' || viva.phase === 'FAILED') {
    video.close();
    return false;
  }
  videoBridges.set(callId, video);
  patch(callId, { videoOn: true });
  waCallsLog('câmera ligada na chamada', { callId, giro: video.orientation() });
  return true;
}

/**
 * O vigia da voz que não chega.
 *
 * Atendida a chamada, o WaCalls tem de começar a mandar PCM pelo DataChannel.
 * Quando não manda, o operador fica ouvindo silêncio sem ter como saber de quem
 * é a culpa — e é aí que ele mexe no fone, troca de alto-falante e desliga
 * achando que o problema é dele. Este aviso fecha essa dúvida com o único dado
 * que o navegador tem certeza: quantos bytes chegaram.
 *
 * A carência existe porque o canal abre antes de o cliente atender; contar
 * silêncio durante o toque acusaria defeito em toda ligação normal.
 */
const audioWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();
const SEM_AUDIO_MS = 6000;

function watchIncomingAudio(callId: string): void {
  if (audioWatchdogs.has(callId)) return;
  audioWatchdogs.set(callId, setTimeout(() => {
    audioWatchdogs.delete(callId);
    const bridge = bridges.get(callId);
    const call = calls.get(callId);
    if (!bridge || !call || call.phase !== 'ACTIVE') return;
    if (bridge.receivedAudioBytes() > 0) return;
    waCallsLog('nenhum áudio recebido depois de atendida', { callId });
    notify({
      kind: 'error',
      message: 'A voz do outro lado não está chegando.',
      description: 'A chamada foi atendida, mas o serviço de chamadas não enviou áudio nenhum. '
        + 'Não é o seu alto-falante nem o seu fone: nada chegou até o navegador.',
    });
  }, SEM_AUDIO_MS));
}

/**
 * Traduz a queda do transporte para quem está com o cliente na linha.
 *
 * Sem isto a chamada simplesmente sumia da tela depois de alguns segundos de
 * silêncio, e a leitura natural do operador era "o CRM desligou na cara do
 * cliente". Cada motivo pede uma reação diferente — ligar de novo resolve uma
 * oscilação e não resolve um servidor sem caminho de áudio.
 */
/**
 * Chamadas que ESTE navegador desligou por falta de caminho de áudio.
 *
 * O desligamento é um DELETE nosso, e o servidor o registra como `user_ended` —
 * indistinguível de alguém clicando em encerrar. Sem esta marca, a ligação que
 * o CRM matou sozinho ia para a ficha como PERDIDA, e uma perdida fabricada
 * acende o cartão de aviso na tela de todo o escritório.
 */
const transportLost = new Set<string>();

function avisarTransporte(motivo: TransportFailure): void {
  if (motivo === 'sem-transporte') {
    notify({
      kind: 'error',
      message: 'A ligação caiu: o áudio nunca chegou a se conectar.',
      description: 'A chamada foi criada, mas o canal de voz com o serviço de chamadas não abriu — '
        + 'ela ficaria muda dos dois lados. Não é o seu microfone.',
    });
    return;
  }
  notify({
    kind: 'error',
    message: 'A ligação caiu: a conexão de voz se perdeu.',
    description: 'O canal com o serviço de chamadas caiu e não voltou. '
      + 'Verifique a internet e ligue de novo.',
  });
}

function clearAudioWatchdog(callId: string): void {
  const timer = audioWatchdogs.get(callId);
  if (!timer) return;
  clearTimeout(timer);
  audioWatchdogs.delete(callId);
}

function scheduleRemoval(callId: string, delay: number): void {
  const previous = removalTimers.get(callId);
  if (previous) clearTimeout(previous);
  removalTimers.set(callId, setTimeout(() => {
    removalTimers.delete(callId);
    clearEscalation(callId);
    calls.delete(callId);
    orphanStatus.delete(callId);
    emit();
  }, delay));
}

/** O desfecho da chamada como a ficha do cliente vai lê-lo. */
function outcomeOf(call: WaCall, failed: boolean, endReason: string | null): CallLogOutcome {
  // A regra inteira mora em `callOutcome`, onde os testes a alcançam — e lá o
  // MOTIVO vence o cronômetro: uma ligação recusada não vira "atendida" só
  // porque a mídia subiu antes de o contato olhar para o telefone.
  return resolveCallOutcome(endReason, { connected: call.connectedAt !== null, failed });
}

/**
 * O que sobra da ligação: a gravação sobe e a chamada vira uma linha na ficha
 * do cliente.
 *
 * Roda depois do fim, fora do caminho de quem desligou — nada aqui pode
 * atrasar o encerramento na tela. Falha de rede não vira erro na cara do
 * operador quando não houve gravação: o registro é o histórico do escritório, e
 * insistir num toast vermelho por causa dele atrapalharia a próxima chamada.
 * Já a gravação perdida É avisada: quem gravou está contando com o arquivo.
 */
async function archiveCall(call: WaCall, failed: boolean, recording: WaCallRecording | null): Promise<void> {
  let recordingPath: string | null = null;
  if (recording) {
    try {
      recordingPath = await callLogService.uploadRecording(call.callId, recording.blob, recording.mime);
    } catch (err) {
      console.error('[WaCalls] falha ao subir a gravação', err);
      notify({
        kind: 'error',
        message: 'Não foi possível salvar a gravação.',
        description: 'A chamada foi registrada na ficha, mas sem o áudio.',
      });
    }
  }

  // O desfecho é calculado UMA vez e manda em tudo o que vai para a ficha: o
  // `answeredAt` de uma chamada que não foi atendida é o que fazia a ficha
  // exibir duração de uma conversa que não houve.
  const outcome = outcomeOf(call, failed, call.endReason);

  try {
    await callLogService.logCall({
      callId: call.callId,
      sessionId: call.sessionId,
      direction: call.direction,
      phone: call.phone,
      // O apelido vai junto e num campo só dele. Uma ligação que chegou anônima
      // deixa de se perder: quando o CRM aprender este LID, `resolveLids`
      // devolve telefone, conversa e cliente a ela — retroativamente.
      peerLid: call.lid ?? null,
      clientId: call.contact?.clientId ?? null,
      conversationId: call.contact?.conversationId ?? null,
      startedAt: call.startedAt,
      answeredAt: outcome === 'answered' ? call.connectedAt : null,
      endedAt: call.endedAt ?? Date.now(),
      endReason: call.endReason,
      outcome,
      video: call.wasVideo,
      recordingPath,
      recordingMime: recordingPath ? recording?.mime ?? null : null,
      recordingBytes: recordingPath ? recording?.blob.size ?? null : null,
    });
  } catch (err) {
    console.error('[WaCalls] falha ao registrar a chamada', err);
    return;
  }

  if (recordingPath) {
    notify({
      kind: 'success',
      message: 'Gravação salva na ficha do cliente.',
      description: call.contact?.name ? `Ficha de ${call.contact.name}, aba Chamadas.` : 'Aba Chamadas da ficha.',
    });
  }
}

/** Solta o áudio da chamada e manda o que sobrou dela para a ficha. */
async function closeAndArchive(call: WaCall, failed: boolean): Promise<void> {
  descartarCameraPendente(call.callId);
  closeVideoBridge(call.callId);
  const bridge = bridges.get(call.callId);
  bridges.delete(call.callId);
  let recording = pendingRecordings.get(call.callId) ?? null;
  pendingRecordings.delete(call.callId);
  if (bridge) {
    // Parar ANTES de fechar: o último pedaço do áudio só chega no `stop`, e um
    // AudioContext fechado no meio levaria os segundos finais junto.
    try { recording = (await bridge.stopRecording()) ?? recording; } catch { /* sem gravação */ }
    bridge.close();
  }
  await archiveCall(call, failed, recording);
}

/** Encerramento local completo: áudio liberado, cartão em estado final. */
function finishCall(callId: string, endReason: string | null, failed = false): void {
  clearEscalation(callId);
  const call = calls.get(callId);
  if (!call) { closeBridge(callId); return; }
  // A verdade sobre o fim é nossa, não do servidor: ele só viu o DELETE. Quem
  // perdeu o transporte encerra como `connection_lost` — que `outcomeFromEndReason`
  // lê como falha, e não como perdida.
  const transporte = transportLost.delete(callId);
  if (transporte) endReason = 'connection_lost';
  // Uma chamada termina DUAS vezes: quem desligou encerra o lado de cá e o
  // `call-ended` chega logo depois pelo SSE. Sem esta guarda, o operador via o
  // mesmo aviso duas vezes — e agora a gravação subiria e o registro seria
  // escrito em duplicidade.
  if (call.phase === 'ENDED' || call.phase === 'FAILED') return;
  // O motivo do fim pode DESMENTIR o cronômetro. Numa ligação de saída o
  // serviço anuncia a mídia menos de um segundo depois de discar, e o painel
  // já mostrava "Em chamada 00:07" com o telefone do contato apenas tocando;
  // quando o fim chega dizendo `rejected` ou `timeout`, o WhatsApp está
  // afirmando que ninguém atendeu — e essa afirmação vale mais. Zerar o
  // `connectedAt` aqui é o que faz o cartão, o aviso, a ficha e a conversa
  // contarem a MESMA história, sem cada um refazer a conta do seu jeito.
  const neverAnswered = endReasonMeansNeverAnswered(endReason);
  const answered = call.connectedAt !== null && !neverAnswered;
  const updated = patch(callId, {
    phase: failed ? 'FAILED' : 'ENDED',
    endedAt: Date.now(),
    endReason,
    connectedAt: neverAnswered ? null : call.connectedAt,
    recording: false,
    error: failed ? call.error : null,
  });
  if (!updated) return;
  waCallsLog('call ended', { callId, endReason });
  // `avisarTransporte` já disse o que houve, com o motivo exato; o recado
  // genérico de queda por cima dele seria o segundo toast do mesmo fato — e o
  // errado dos dois, porque nem sempre a conexão que faltou é a desta máquina.
  if (!failed && !transporte) {
    const message = endReasonMessage(endReason, { answered, direction: call.direction });
    notify({ kind: endReasonIsFailure(endReason, answered) ? 'error' : 'info', message });
  }
  // O cartão da chamada some da tela em segundos; a PERDIDA não pode sumir
  // junto — quem estava no processo ou na agenda nem viu o telefone tocar.
  // Quem estava na ligação como convidado sai junto: um segundo atendente com
  // a tela dizendo "em atendimento" depois de o cliente desligar é pior que
  // nenhum aviso.
  callBridge.endCall(callId);
  if (isMissedInboundCall(updated, failed)) missedListeners.forEach(fn => fn(updated));
  scheduleRemoval(callId, failed ? FAILED_LINGER_MS : ENDED_LINGER_MS);
  void closeAndArchive(updated, failed);
}

/** Descobre quem é o número — sem travar a chamada se a consulta demorar. */
async function resolveContact(phone: string): Promise<WaCallContact | null> {
  try {
    const found = await whatsappService.findConversationByPhone(phone);
    if (!found) return null;
    return {
      conversationId: found.conversationId,
      clientId: found.clientId,
      name: found.name,
      avatarUrl: found.avatarUrl,
    };
  } catch {
    return null;
  }
}

/**
 * Quem está ligando — tudo o que o CRM consegue saber, em UMA resposta.
 *
 * A ordem é a da confiança, e cada degrau existe porque o cartão já disse
 * "Número não identificado" para alguém que o escritório conhecia:
 *
 *  1. A CONVERSA pelo telefone. O caminho normal.
 *  2. A CONVERSA pelo LID. Uma thread que nasceu endereçada por `<n>@lid` não
 *     tem telefone no cadastro dela, e o mapeamento (`phoneByLid`, que só
 *     devolve número válido) calava — mesmo com nome, foto e cliente ali.
 *  3. A FICHA pelo telefone. Quem tem cadastro no escritório mas nunca trocou
 *     mensagem pelo WhatsApp não tem conversa nenhuma: até aqui a tela mostrava
 *     só os dígitos de um cliente antigo. Reaproveita a
 *     `whatsapp_match_client_by_phone`, que já trata o nono dígito, olha o
 *     celular e o fixo e ignora ficha arquivada ou mesclada.
 *
 * O que NÃO se sabe continua não se sabendo: sem nenhum dos três, a chamada
 * segue anônima. Melhor uma ligação sem nome do que um nome errado na tela.
 */
interface CallerIdentity {
  contact: WaCallContact;
  /** Telefone descoberto no caminho (o convite por LID chega sem ele). */
  phone: string;
  assignedUserId: string | null;
  instanceId: string | null;
  isBlocked: boolean;
}

async function resolveCallerIdentity(phone: string, lid: string | null): Promise<CallerIdentity | null> {
  if (phone) {
    const found = await whatsappService.findConversationByPhone(phone).catch(() => null);
    if (found) {
      return {
        contact: {
          conversationId: found.conversationId,
          clientId: found.clientId,
          name: found.name,
          avatarUrl: found.avatarUrl,
        },
        phone,
        assignedUserId: found.assignedUserId,
        instanceId: found.instanceId,
        isBlocked: found.isBlocked,
      };
    }
  }

  if (!phone && lid) {
    const porLid = await whatsappService.contactByLid(lid).catch(() => null);
    if (porLid) {
      return {
        contact: {
          conversationId: porLid.conversationId,
          clientId: porLid.clientId,
          name: porLid.name,
          avatarUrl: porLid.avatarUrl,
        },
        phone: porLid.phone,
        assignedUserId: porLid.assignedUserId,
        instanceId: porLid.instanceId,
        isBlocked: porLid.isBlocked,
      };
    }
  }

  if (phone) {
    const fichas = await whatsappService.matchClientsByPhone(phone).catch(() => []);
    const ficha = fichas[0];
    if (ficha) {
      return {
        // Sem conversa não há o que abrir na inbox: `conversationId` fica nulo
        // e o botão "Abrir conversa" simplesmente não aparece no painel.
        contact: {
          conversationId: null,
          clientId: ficha.id,
          name: ficha.full_name || null,
          avatarUrl: null,
        },
        phone,
        assignedUserId: null,
        instanceId: null,
        isBlocked: false,
      };
    }
  }

  return null;
}

/**
 * O rosto do WhatsApp para quem o CRM não tem foto.
 *
 * Pedido do escritório, e com razão: não tendo cadastro, o que sobra na tela é
 * um número — e um número não é ninguém. A foto de perfil é o que o celular
 * mostraria, e ela vem da mesma sondagem que a agenda da "Nova conversa" já
 * usa (com cache em `whatsapp_contact_probes`, então a segunda ligação da
 * mesma pessoa não custa nada).
 *
 * Corre DEPOIS de o cartão já estar na tela e falha em silêncio: uma foto é um
 * enfeite útil, nunca um motivo para atrasar o telefone tocando.
 */
async function fillProfilePhoto(callId: string, phone: string): Promise<void> {
  if (!phone) return;
  try {
    const [probe] = await whatsappService.probeContacts([phone]);
    if (!probe?.avatarUrl) return;
    const call = calls.get(callId);
    // Chegou tarde, ou a foto do cadastro já entrou no lugar: não sobrescreve.
    if (!call || call.contact?.avatarUrl) return;
    patch(callId, {
      contact: {
        conversationId: call.contact?.conversationId ?? null,
        clientId: call.contact?.clientId ?? null,
        name: call.contact?.name ?? null,
        avatarUrl: probe.avatarUrl,
      },
    });
  } catch {
    // Sondagem fora do ar: fica as iniciais, como antes.
  }
}

/** O usuário logado nesta aba. Guardado depois da primeira consulta. */
let cachedUserId: string | null | undefined;
async function currentUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  try {
    const { data } = await supabase.auth.getUser();
    cachedUserId = data.user?.id ?? null;
  } catch {
    cachedUserId = null;
  }
  return cachedUserId;
}

/**
 * QUEM ATENDE PRIMEIRO FICA RESPONSÁVEL.
 *
 * O convite toca em várias mesas de propósito (o degrau pode ser um setor
 * inteiro), e sem isto a ligação atendida não deixava dono: o cliente falava
 * com quem pegou o telefone, e a conversa continuava órfã na inbox — o próximo
 * retorno tocaria de novo para o setor inteiro, e a pessoa que já conhece o
 * caso não teria prioridade nenhuma.
 *
 * Só a conversa SEM responsável é assumida. Atender a ligação de um caso que já
 * é de outra pessoa (ela saiu para o fórum, alguém cobriu) não pode tomar o
 * atendimento dela — cobrir uma chamada é um favor, não uma transferência.
 *
 * Best-effort de ponta a ponta: falhou, a ligação continua de pé. Ninguém perde
 * uma chamada porque a atribuição não gravou.
 */
async function assumirAtendimento(call: WaCall): Promise<void> {
  const conversationId = call.contact?.conversationId;
  if (!conversationId) return;
  try {
    const rota = (await conversationRouting([conversationId])).get(conversationId);
    if (rota?.assignedUserId) return;
    const me = await currentUserId();
    if (!me) return;
    // `assumeConversation`, e não `assignConversation`: atribuir a TERCEIRO
    // virou ato de supervisor, e atender a própria chamada não é isso — é
    // assumir o que estava na fila. A RPC de assumir cobre exatamente este
    // caso (conversa sem dono, quem chamou vira responsável) e continua
    // valendo para o atendente comum.
    await whatsappService.assumeConversation(conversationId);
    waCallsLog('atendimento assumido por quem atendeu', { callId: call.callId });
  } catch {
    // A ligação vale mais que o registro do responsável.
  }
}

/** Estou em outra chamada agora? (o toque não pode interromper uma conversa) */
function inAnotherCall(exceptCallId: string): boolean {
  return Array.from(calls.values()).some(
    c => c.callId !== exceptCallId && c.mine && c.phase !== 'ENDED' && c.phase !== 'FAILED',
  );
}

/**
 * Decide para quem esta chamada toca e agenda a escalada.
 *
 * Só o navegador decide: o WaCalls manda o convite para todo mundo e não sabe
 * o que é "responsável". Falhando a consulta (rede ruim, RLS, conversa que não
 * existe), a decisão é TOCAR: perder uma ligação por causa de uma regra que não
 * pôde ser lida seria o pior desfecho possível.
 */
async function resolveIncomingRoute(
  callId: string,
  phone: string,
  lid: string | null,
  peerSessionId: string | null,
): Promise<void> {
  let assignedUserId: string | null = null;
  let departmentId: string | null = null;
  let instanceId: string | null = null;
  let contactBlocked = false;

  // Convite endereçado por LID: o número não veio, e o LID NÃO é um número.
  // Há duas formas honestas de descobrir de quem ele é, nesta ordem:
  //
  //  1. O MAPEAMENTO já registrado (`conversations#phoneByLid`). É o caminho
  //     normal e o mais barato: uma consulta que responde na hora.
  //  2. O CALLBACK (`conversations#phoneByCallback`). Ligamos para alguém,
  //     desligamos, e a pessoa está ligando de volta — a mesma sessão discou
  //     aquele número e mais nenhum outro na janela. É a evidência que fecha o
  //     caso na PRIMEIRA vez que o apelido aparece, e sem ela a ligação de
  //     volta do cliente que acabamos de procurar chegaria anônima.
  //
  // Nenhuma das duas achando, a chamada segue sem telefone — toca, aparece e
  // diz que o número não pôde ser identificado. Melhor uma ligação anônima do
  // que um número inventado na tela e no histórico.
  let numero = phone;
  if (!numero && lid) {
    const mapeado = await whatsappService.phoneByLid(lid).catch(() => null);
    if (mapeado) {
      numero = mapeado.phone;
      patch(callId, { phone: mapeado.phone });
      waCallsLog('LID reconhecido pelo mapeamento', { callId });
    } else {
      const porCallback = await whatsappService
        .phoneByCallback(lid, peerSessionId, Date.now())
        .catch(() => null);
      if (porCallback) {
        numero = porCallback.phone;
        patch(callId, { phone: porCallback.phone });
        waCallsLog('LID reconhecido pelo callback', { callId });
        // Aprendido: registra para a próxima ligação ser reconhecida de cara e
        // devolve identidade às chamadas que já ficaram anônimas com este
        // apelido. As duas coisas são ganho de histórico e falham em silêncio —
        // nada aqui pode atrapalhar o convite que está tocando agora.
        void whatsappService.linkLid(porCallback.phone, lid)
          .then(() => callLogService.resolveLids(lid))
          .catch(() => { /* ganho futuro, nunca um erro na tela */ });
      }
    }
  }
  // Sem telefone AINDA não quer dizer sem identidade: a conversa pode morar no
  // próprio LID (ver `contactByLid`). Só depois de tentar tudo é que a chamada
  // é dada como anônima.
  let identidade = await resolveCallerIdentity(numero, lid).catch(() => null);

  // ÚLTIMA TENTATIVA: perguntar ao WhatsApp de quem é o apelido.
  //
  // Chega aqui a ligação que o CRM não reconheceu por nada que seja dele —
  // sem mapeamento, sem callback, sem conversa. A Evolution ainda pode saber:
  // a lista de participantes dos GRUPOS traz o LID e o telefone na mesma
  // linha. Achando o telefone, tudo recomeça do começo, agora com número em
  // mãos (conversa, ficha, responsável); achando só o nome de perfil, ele já
  // é melhor do que "não identificado" na tela de quem vai atender.
  if (!numero && lid && !identidade) {
    const doWhatsApp = await whatsappService.probeLid(lid).catch(() => null);
    if (doWhatsApp?.phone) {
      numero = doWhatsApp.phone;
      patch(callId, { phone: doWhatsApp.phone });
      waCallsLog('LID reconhecido pelo WhatsApp', { callId });
      identidade = await resolveCallerIdentity(numero, lid).catch(() => null);
    }
    if (!identidade && (doWhatsApp?.name || doWhatsApp?.avatarUrl)) {
      patch(callId, {
        contact: {
          conversationId: null,
          clientId: null,
          name: doWhatsApp.name,
          avatarUrl: doWhatsApp.avatarUrl,
        },
      });
    }
  }
  if (identidade) {
    patch(callId, { contact: identidade.contact });
    if (!numero && identidade.phone) {
      numero = identidade.phone;
      patch(callId, { phone: identidade.phone });
      waCallsLog('LID reconhecido pela conversa', { callId });
    }
    contactBlocked = identidade.isBlocked;
    assignedUserId = identidade.assignedUserId;
    instanceId = identidade.instanceId;
    // O SETOR da conversa não vem na identificação do contato (ela responde
    // "quem está ligando", não "de quem é o atendimento"), e é o segundo degrau
    // da escada. Uma consulta a mais, com a conversa já em mãos.
    const convId = identidade.contact.conversationId;
    if (convId) {
      const rota = (await conversationRouting([convId])).get(convId);
      if (rota) {
        // O banco manda: a conversa pode ter sido transferida enquanto o
        // telefone tocava, e é a transferência mais recente que vale.
        assignedUserId = rota.assignedUserId ?? assignedUserId;
        departmentId = rota.departmentId;
        instanceId = rota.instanceId ?? instanceId;
      }
    }
  }

  // Sem rosto e com número em mãos: pergunta a foto do WhatsApp. Não é esperado
  // — o cartão já está na tela e a foto entra quando chegar.
  if (numero && !identidade?.contact.avatarUrl) void fillProfilePhoto(callId, numero);

  if (!numero && !identidade) {
    // Nem número, nem conversa, nem ficha (com ou sem nome de perfil na tela):
    // não há responsável, setor nem canal a consultar. A escada começa e termina
    // na administração — uma ligação sem dono é do escritório, e o escritório
    // tem quem responda por ele.
    const [me, orfa] = await Promise.all([currentUserId(), buildLadderFor({})]);
    escalar(callId, orfa, me, false);
    return;
  }

  const [me, escada] = await Promise.all([
    currentUserId(),
    buildLadderFor({ assignedUserId, departmentId, instanceId }),
  ]);
  // A escada fica guardada na chamada: o cartão de perdida lê dela depois, sem
  // refazer as quatro consultas quando o telefone já parou de tocar.
  patch(callId, { ladder: escada });
  escalar(callId, escada, me, contactBlocked);
}

/**
 * Aplica a escada e agenda a descida.
 *
 * Um degrau por vez, com a carência entre eles, até o último. Cada passo SOMA
 * gente ao toque (ver `decideCallRing`) — descer nunca cala o telefone de quem
 * já estava chamando, só chama mais gente para uma ligação que ninguém pegou.
 */
function escalar(
  callId: string,
  ladder: CallDegree[],
  me: string | null,
  contactBlocked: boolean,
): void {
  let passo = 0;

  const aplicar = (): CallRoute | null => {
    const call = calls.get(callId);
    if (!call || call.phase !== 'RINGING' || call.mine) return null;
    const route = decideCallRing({
      me,
      ladder,
      online: operatorPresence.onlineUserIds(),
      step: passo,
      contactBlocked,
      imBusy: inAnotherCall(callId),
    });
    patch(callId, { route });
    return route;
  };

  const agendar = (route: CallRoute | null) => {
    if (!route || !route.hasNextStep || !route.show) return;
    const timer = setTimeout(() => {
      escalationTimers.delete(callId);
      passo += 1;
      agendar(aplicar());
    }, CALL_ESCALATION_MS);
    escalationTimers.set(callId, timer);
  };

  const inicial = aplicar();
  waCallsLog('rota da chamada recebida', {
    callId, source: inicial?.source, alvo: inicial?.targetUserIds?.length ?? 0, ring: inicial?.ring,
  });
  agendar(inicial);
}

function handleEvent(event: WaCallsEvent): void {
  const me = getWaCallsClientId();
  switch (event.type) {
    case 'session-list':
      applySessions(event.sessions ?? []);
      emit();
      break;

    case 'auth-state': {
      const next = sessions.map(s => (
        s.id === event.sessionId ? { ...s, paired: event.paired, state: event.state } : s
      ));
      applySessions(next);
      emit();
      break;
    }

    case 'incoming': {
      // Só interessa a conta que este CRM usa; um segundo número conectado ao
      // mesmo WaCalls não deve tocar aqui.
      if (sessionId && event.sessionId !== sessionId) return;
      if (calls.has(event.id)) return;
      // O `peer` chega de duas formas, e a diferença entre elas é a diferença
      // entre reconhecer o cliente e discar para a Somália: `5565...@s.whatsapp.net`
      // é telefone, `252677908865131@lid` é o apelido INTERNO do contato. O
      // segundo NUNCA vira número — quando é só isso que veio, a chamada nasce
      // sem telefone e `resolveIncomingRoute` vai PROCURAR o mapeamento.
      const { phone, lid } = parseWaPeer(event.peer);
      upsert({
        callId: event.id,
        sessionId: event.sessionId,
        direction: 'inbound',
        phase: 'RINGING',
        phone,
        lid,
        contact: null,
        mine: false,
        startedAt: event.offeredAt || Date.now(),
        connectedAt: null,
        endedAt: null,
        endReason: null,
        muted: false,
        // A rota nasce nula: o cartão aparece calado e o som entra quando o CRM
        // descobre de quem é a conversa (ver `resolveIncomingRoute`).
        route: null,
        videoOn: false,
        peerVideo: false,
        wasVideo: false,
        recording: false,
        recorded: false,
        error: null,
      });
      waCallsLog('incoming call', { callId: event.id, byLid: !!lid });
      void resolveIncomingRoute(event.id, phone, lid, event.sessionId ?? sessionId ?? null);
      break;
    }

    case 'incoming-claimed':
      // Outro operador atendeu antes: o convite some daqui sem alarde.
      if (event.owner !== me && calls.get(event.id)?.mine === false) {
        clearEscalation(event.id);
        calls.delete(event.id);
        emit();
      }
      break;

    case 'call-status': {
      const existing = calls.get(event.id);
      const mine = event.owner === me;
      // APRENDER o LID. Numa chamada de SAÍDA nós sabemos exatamente para qual
      // número discamos; se o servidor devolve o `peer` dela como `<n>@lid`,
      // aquele LID é, por construção, o daquele número. É a fonte mais confiável
      // que existe do mapeamento — e é justamente o que faltava para reconhecer
      // a ligação de VOLTA do mesmo cliente, que chega só com o LID.
      if (existing?.direction === 'outbound' && existing.phone) {
        const { lid } = parseWaPeer(event.peer);
        if (lid && existing.lid !== lid) {
          patch(event.id, { lid });
          // Aprendeu: registra o mapeamento e, na sequência, devolve identidade
          // às chamadas que já tinham chegado com este apelido e ficaram sem
          // dono no histórico.
          void whatsappService.linkLid(existing.phone, lid)
            .then(() => callLogService.resolveLids(lid))
            .catch(() => { /* ganho futuro, nunca um erro na tela */ });
        }
      }
      if (!existing) {
        // Chamada de outro operador no mesmo número: nada a fazer aqui — o
        // áudio e o cartão são da aba dona dela. Sendo nossa, o status espera
        // o `upsert` (ver orphanStatus).
        if (mine) orphanStatus.set(event.id, event.status);
        return;
      }
      if (mine && !existing.mine) patch(event.id, { mine: true });
      applyStatus(event.id, event.status);
      break;
    }

    case 'call-video': {
      if (!calls.has(event.id)) return;
      // Se a nossa câmera caiu do lado do servidor, a ponte local não pode
      // continuar gastando CPU codificando para ninguém.
      if (!event.videoOn) closeVideoBridge(event.id);
      patch(event.id, { videoOn: event.videoOn, peerVideo: event.peerVideo });
      break;
    }

    case 'call-ended':
      if (!calls.has(event.id)) return;
      finishCall(event.id, event.reason ?? null);
      break;

    default:
      break;
  }
}

/**
 * A VOLTA AUTOMÁTICA DO SERVIÇO.
 *
 * Duas quedas parecem iguais na tela e não são: a que acontece com a aba aberta
 * é resolvida pelo socket, que se reconecta sozinho com degraus curtos (ver
 * `socket.ts`); a que já existia QUANDO A ABA ABRIU não tem socket nenhum para
 * se reconectar — `connectEvents` só é chamado depois de o primeiro
 * `/api/status` responder. Era esse o caso sem saída: telefone morto até
 * recarregar a página.
 *
 * QUANDO insistir e com que espera é regra pura e testada — ver `retryPolicy.ts`.
 * Aqui ficam só os relógios e a ida ao servidor.
 */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let retrying = false;
let wakeListenersOn = false;

/**
 * O PONTO VERDE, em forma de pergunta: dá para discar agora?
 *
 * É de propósito a MESMA conta que a tela mostra (`canCall` em `useWaCalls`).
 * A primeira versão da volta automática olhava só o serviço estar fora, e o
 * amarelo tem mais de uma causa: a conta de WhatsApp pode estar pareada sem a
 * conexão aberta, e a pessoa pode ainda não ser membro do canal. Nesses dois
 * casos o socket está de pé e nada se move sozinho — o telefone ficava amarelo
 * para sempre. Vigiar o SINTOMA cobre as causas todas, inclusive as que eu não
 * previ.
 */
function canDialNow(): boolean {
  return canDialLine({ online, available, hasLine: !!sessionId });
}

/** O retrato do momento, do jeito que a regra da sala de espera pede. */
function retryState(): RetryState {
  return {
    ready,
    online,
    available,
    // Linhas ainda desconhecidas contam como "sem linha": é uma pendência que
    // se resolve com nova tentativa, e é exatamente a que ficava para sempre.
    hasLine: !!sessionId && linesReady,
    busy: retrying || retryTimer !== null,
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
    inCall: liveMineCalls().length > 0,
    preview: previewLines,
  };
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

function scheduleRetry(): void {
  watchWake();
  if (!shouldRetry(retryState())) return;
  const espera = retryDelay(retryAttempt);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void tryAgain();
  }, espera);
}

async function tryAgain(): Promise<void> {
  if (canDialNow()) { clearRetry(); return; }
  // Ligação de pé não é hora de refazer nada: o amarelo, se houver, é de outra
  // coisa, e a conversa em curso vale mais do que o acerto do indicador.
  if (liveMineCalls().length > 0) { scheduleRetry(); return; }
  waCallsLog('nova tentativa: a linha está indisponível');
  retrying = true;
  emit();
  try {
    initializing = null;
    await waCallsStore.init();
    // Relê canal e membro também: o amarelo pode ser "você ainda não é membro
    // deste canal", e é assim que o discador acende sozinho quando o admin
    // acabou de incluir a pessoa — sem ela recarregar nada.
    resetCallLines();
    await refreshLines();
  } finally {
    retrying = false;
    emit();
  }
  if (canDialNow()) clearRetry();
  else scheduleRetry();
}

/**
 * O vigia do amarelo. Roda a cada mudança de estado (é barato: só compara
 * bandeiras) e é o que liga a sala de espera assim que o ponto deixa de ser
 * verde — não importa por qual das causas.
 */
function reviewHealth(): void {
  if (!ready) return;
  if (canDialNow()) { clearRetry(); return; }
  scheduleRetry();
}

/**
 * Os dois momentos em que vale tentar ANTES do próximo degrau, porque algo
 * mudou no mundo: a rede voltou, ou a pessoa voltou para a aba. Quem deixou o
 * CRM aberto no outro monitor a manhã inteira encontra o telefone de pé ao
 * voltar, em vez de esperar o próximo degrau de dois minutos.
 */
/**
 * A SESSÃO DO SUPABASE CHEGANDO DEPOIS.
 *
 * O host das chamadas monta junto com o app, e a sessão do Supabase é
 * restaurada do armazenamento de forma assíncrona: existe um instante em que o
 * CRM está na tela e `auth.uid()` ainda é nulo. Toda consulta de canal é
 * ancorada nele pela RLS, então nesse instante o banco responde "nenhum canal"
 * — sem erro. Ficar esperando o próximo degrau da sala de espera para descobrir
 * isso é lento; o próprio Supabase avisa quando a sessão entra, e é esse aviso
 * que se escuta aqui.
 */
let authWatchOn = false;

function watchAuth(): void {
  if (authWatchOn) return;
  authWatchOn = true;
  try {
    supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        // Outra pessoa pode sentar na mesma aba: nada do que era dela fica.
        resetDialPermission();
        resetCallLines();
        lines = [];
        linesReady = false;
        emit();
        return;
      }
      if (!linesReady) {
        resetCallLines();
        void refreshLines();
      }
    });
  } catch {
    // Sem o ouvinte, a sala de espera resolve — só demora um degrau a mais.
  }
}

function watchWake(): void {
  if (wakeListenersOn || typeof window === 'undefined') return;
  wakeListenersOn = true;
  const acordar = () => {
    if (canDialNow() || document.visibilityState !== 'visible') return;
    clearRetry();
    void tryAgain();
  };
  window.addEventListener('online', acordar);
  document.addEventListener('visibilitychange', acordar);
}

export const waCallsStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  getSnapshot(): WaCallsSnapshot {
    return snapshot;
  },

  /**
   * Uma chamada recebida acabou sem que ninguém atendesse.
   *
   * Separado do `onNotice` de propósito: o toast do desfecho é para quem está
   * olhando AGORA, e some sozinho; isto aqui alimenta o cartão que fica na
   * tela até alguém dizer que viu (ver `missedCallStore`).
   */
  onMissedCall(fn: (call: WaCall) => void): () => void {
    missedListeners.add(fn);
    return () => { missedListeners.delete(fn); };
  },

  /** Avisos para virar toast na UI (ver WaCallsHost). */
  onNotice(fn: (notice: WaCallsNotice) => void): () => void {
    noticeListeners.add(fn);
    return () => { noticeListeners.delete(fn); };
  },

  /**
   * Carrega as sessões e liga a escuta de eventos. Idempotente.
   *
   * UMA conexão SSE por aba, aberta aqui e distribuída daqui. O `EventSource`
   * reconecta sozinho; não empilhamos retentativa por cima. Se o serviço
   * estiver fora, `available` fica falso e o botão de ligar sabe explicar.
   */
  async init(): Promise<void> {
    if (initializing) return initializing;
    watchLink();
    // Quem está na mesa agora — a hierarquia pula o degrau vazio com isto (ver
    // `operatorPresence`). Idempotente, e falha em silêncio: sem presença, a
    // regra trata todo mundo como disponível.
    operatorPresence.init();
    // A ponte entre navegadores (segundo atendente e transferência) precisa do
    // áudio DESTA chamada; o mapa de pontes vivas é privado deste módulo, então
    // é ele quem empresta o que ela pode usar — e nada além disso.
    callBridge.bindHostAudio(callId => {
      const bridge = bridges.get(callId);
      if (!bridge) return null;
      return {
        feed: () => bridge.guestFeed(),
        attachGuest: stream => bridge.attachGuest(stream),
        detachGuest: () => bridge.detachGuest(),
        mute: () => { bridge.setMuted(true); patch(callId, { muted: true }); },
      };
    });
    callBridge.init();
    watchAuth();
    initializing = (async () => {
      try {
        applySessions(await waCallsService.getSessions());
        available = true;
        waCallsLog('session loaded', { sessionId, total: sessions.length });
      } catch {
        available = false;
        waCallsLog('serviço de chamadas indisponível');
        // Sem contas pareadas, as linhas ainda existem: são os canais do CRM,
        // e é assim que o discador consegue dizer QUAL canal está sem voz em
        // vez de mostrar um rótulo genérico.
        void refreshLines();
        // A nova tentativa é marcada pelo vigia do amarelo, no `emit` logo
        // abaixo. Sem ela, a aba que abriu com o serviço fora ficava sem
        // telefone até alguém recarregar a página: não há socket para se
        // reconectar sozinho quando ele nem chegou a abrir.
      } finally {
        ready = true;
        emit();
      }
      if (!available || closeEvents) return;
      closeEvents = waCallsService.connectEvents({
        onEvent: handleEvent,
        onOpen: () => { available = true; clearRetry(); emit(); },
        onError: () => { available = false; emit(); },
      });
    })();
    return initializing;
  },

  /** Nova tentativa depois de o serviço ter falhado (o operador clicou de novo). */
  async refresh(): Promise<void> {
    initializing = null;
    await this.init();
  },

  /**
   * Escolha manual da linha — por qual número a próxima ligação sai.
   *
   * Uma linha que a pessoa não pode usar é recusada aqui mesmo, e não na hora
   * de discar: a lista do discador não oferece linha proibida, e um `setSessionId`
   * vindo de outro caminho não pode furar a fila da regra.
   */
  setSessionId(id: string | null): boolean {
    if (id && !sessionAllowed(id)) {
      const linha = lineOf(id);
      notify({
        kind: 'error',
        message: LINE_DENIED_MESSAGE,
        description: lineDeniedDetail(linha?.label || 'escolhida'),
      });
      return false;
    }
    sessionId = id;
    emit();
    return true;
  },

  /**
   * DEV-ONLY: injeta linhas prontas, para a bancada do discador. Sem isto, as
   * três situações que importam olhar (uma linha, duas, nenhuma autorizada)
   * dependeriam de parear contas de verdade no serviço de voz.
   */
  primeLinesForPreview(list: CallLine[]): void {
    previewLines = true;
    lines = list;
    linesReady = true;
    sessions = list
      .filter((l): l is CallLine & { sessionId: string } => !!l.sessionId)
      .map(l => ({
        id: l.sessionId, name: l.label, jid: `${l.phone}@s.whatsapp.net`,
        phone: l.phone, state: l.online ? 'open' : 'connecting', paired: true,
      }));
    ready = true;
    available = true;
    sessionId = null;
    chooseSession();
    emit();
  },

  /**
   * A estrela: por qual canal o discador abre quando há mais de um.
   *
   * Marcar não é o mesmo que escolher — por isso a preferida também passa a
   * valer AGORA, se der: ninguém marca uma estrela para que ela só funcione na
   * próxima vez que abrir o CRM.
   */
  setPreferredLine(key: string | null): void {
    preferredLine = key;
    writePreferredLine(key);
    const preferida = key ? lines.find(l => l.key === key) : null;
    if (preferida?.sessionId && sessionAllowed(preferida.sessionId)) sessionId = preferida.sessionId;
    emit();
  },

  /** Relê canais e membros (o admin acabou de mexer no cadastro). */
  async reloadLines(): Promise<void> {
    resetCallLines();
    await refreshLines();
  },

  /**
   * "Atualizar": refaz a pergunta inteira — serviço de voz, canais e membros.
   *
   * É o botão do discador, e é também o que os gatilhos automáticos chamam. Uma
   * aba aberta desde as 8h da manhã acumula duas defasagens diferentes: o
   * serviço pode ter caído e voltado (e, se ele estava fora quando a aba
   * abriu, nem socket existe para reconectar sozinho), e o cadastro de canal e
   * de membro pode ter mudado no meio do dia.
   */
  async retryNow(): Promise<void> {
    // O clique zera a escada: quem pediu agora não deve esperar o degrau de
    // dois minutos que a espera automática já tinha alcançado.
    clearRetry();
    retrying = true;
    emit();
    try {
      resetCallLines();
      initializing = null;
      await this.init();
      await refreshLines();
    } finally {
      retrying = false;
      emit();
    }
  },

  /**
   * Porta única de saída — a trava de permissão e a trava contra o clique
   * repetido.
   *
   * A PERMISSÃO É CONFERIDA AQUI, e não nos botões, porque são cinco entradas
   * para a mesma ligação: a barra do topo, o atalho ⌘⇧L, a pesquisa global, os
   * botões da inbox e o cartão de chamada perdida. Esconder um botão é desenho,
   * não defesa — quem tem o atalho decorado passaria por baixo de todos eles.
   * Ver `dialPermission.ts` para a regra.
   *
   * Discar leva um tempo visível (permissão do microfone, POST no WaCalls) e
   * nesse intervalo o botão continua na tela. Sem esta trava, cada clique virava
   * uma ligação: o telefone do contato tocava duas, três vezes e sobravam
   * chamadas órfãs no servidor. O segundo clique é ignorado em silêncio, porque
   * para quem clicou aquilo foi um clique só.
   */
  async placeCall(params: {
    phone: string;
    contact?: WaCallContact | null;
    fallbacks?: readonly CallablePhoneCandidate[];
    /** Nasce com a câmera ligada. A permissão é pedida ANTES de o telefone tocar. */
    video?: boolean;
  }): Promise<string | null> {
    if (placing) {
      waCallsLog('placeCall ignorado: já existe uma discagem em andamento');
      return null;
    }
    // A pergunta é feita ANTES de a porta ser trancada: uma tentativa negada
    // não pode deixar `placing` de pé e travar a próxima ligação de quem pode.
    const permissao = await ensureDialPermission();
    if (permissao !== 'allowed') {
      waCallsLog('placeCall negado', { permissao });
      notify(permissao === 'denied'
        ? { kind: 'error', message: DIAL_DENIED_MESSAGE, description: DIAL_DENIED_DETAIL }
        : { kind: 'error', message: DIAL_UNKNOWN_MESSAGE, description: DIAL_UNKNOWN_DETAIL });
      return null;
    }
    placing = true;
    emit();
    try {
      // Ao sair daqui a chamada já está no mapa `calls` — é ele que barra a
      // próxima tentativa, com o recado "Você já está em uma chamada".
      return await this.placeCallUnguarded(params);
    } finally {
      placing = false;
      emit();
    }
  },

  /**
   * Liga para um número a partir da conversa. NÃO chame direto: a porta é
   * `placeCall`, que é quem segura o clique repetido.
   *
   * Ordem: sessão → microfone → chamada no WaCalls → negociação → ponte. O
   * microfone vem ANTES de criar a chamada de propósito: descobrir a permissão
   * bloqueada depois que o telefone do cliente já tocou seria pior.
   */
  async placeCallUnguarded(params: {
    /** O que a tela tem em mãos: telefone, JID — ou, sem querer, um LID. */
    phone: string;
    contact?: WaCallContact | null;
    /**
     * Outros lugares onde o número pode estar, em ordem de prioridade DEPOIS do
     * `phone`. Quem chama passa o que souber (o telefone do cartão de contato, o
     * do cadastro do cliente); a escolha é de `resolveCallablePhone`, nunca da
     * tela.
     */
    fallbacks?: readonly CallablePhoneCandidate[];
    /** Nasce com a câmera ligada (ver `placeCall`). */
    video?: boolean;
  }): Promise<string | null> {
    await this.init();
    if (!online) {
      notify({
        kind: 'error',
        message: 'Sem conexão com a internet.',
        description: 'A chamada sairia muda dos dois lados. Reconecte e tente de novo.',
      });
      return null;
    }
    if (!available) {
      notify({ kind: 'error', message: 'Serviço de chamadas indisponível.', description: 'Tente novamente em instantes.' });
      return null;
    }
    const sid = sessionId;
    if (!sid) {
      // Duas situações diferentes com a mesma cara: não há conta pareada, ou há
      // e nenhuma delas é desta pessoa. Quem não pode usar NENHUMA linha precisa
      // ouvir isso, não "o serviço está fora" — é a diferença entre esperar e
      // pedir acesso.
      const proibidas = lines.filter(l => l.online && !l.authorized);
      notify(proibidas.length > 0
        ? {
          kind: 'error',
          message: LINE_DENIED_MESSAGE,
          description: lineDeniedDetail(proibidas.map(l => l.label).join(', ')),
        }
        : {
          kind: 'error',
          message: 'Nenhum WhatsApp disponível para chamadas.',
          description: 'Nenhuma conta pareada e conectada no serviço de chamadas.',
        });
      return null;
    }
    // As linhas ainda não são conhecidas? Pergunta AGORA, antes de decidir. São
    // duas consultas e alguns milissegundos; sem isso existiria uma janela, logo
    // depois de a aba abrir, em que o degrau do canal simplesmente não opina.
    if (!linesReady) await refreshLines();
    // A linha escolhida continua sendo desta pessoa? (O cadastro pode ter mudado
    // com a aba aberta — e a escolha manual é anterior à resposta do banco.)
    if (!sessionAllowed(sid)) {
      notify({
        kind: 'error',
        message: LINE_DENIED_MESSAGE,
        description: lineDeniedDetail(lineOf(sid)?.label || 'escolhida'),
      });
      return null;
    }
    // A ÚNICA porta de entrada de um número numa ligação de saída. Antes cada
    // tela mandava o que tinha e o store aceitava — foi assim que o apelido
    // interno de um contato (`@lid`) chegou ao discador. Ver `phone.ts`.
    const alvo = resolveCallablePhone([
      { source: 'conversation', value: params.phone },
      ...(params.fallbacks ?? []),
    ]);
    const phone = alvo.phone;
    if (!phone) {
      // LID sem mapeamento é o caso que merece o recado inteiro: o operador
      // está olhando para um contato que ele conhece e precisa entender por que
      // o CRM se recusa a ligar — e por que insistir não vai ajudar.
      notify(alvo.failure === 'lid-only'
        ? {
          kind: 'error',
          message: CALLABLE_PHONE_UNKNOWN,
          description: 'O WhatsApp entregou este contato por um identificador interno, sem o telefone. '
            + 'Abra a conversa com ele ou vincule o cadastro do cliente para o número aparecer.',
        }
        : { kind: 'error', message: 'Número inválido para chamada.' });
      return null;
    }
    if (Array.from(calls.values()).some(c => c.mine && c.phase !== 'ENDED' && c.phase !== 'FAILED')) {
      notify({ kind: 'error', message: 'Você já está em uma chamada.' });
      return null;
    }

    let micStream: MediaStream;
    try {
      micStream = await openMicrophone();
    } catch (err) {
      const message = err instanceof MicrophoneError
        ? err.message
        : 'Não foi possível acessar o microfone. Verifique a permissão do navegador.';
      notify({ kind: 'error', message });
      return null;
    }

    // A câmera vem ANTES do POST, pelo mesmo motivo do microfone: descobrir a
    // permissão negada depois que o telefone do contato já tocou é pior. Uma
    // recusa aqui cancela a ligação inteira — quem pediu vídeo não quer cair
    // numa chamada de voz sem perceber.
    let cameraStream: MediaStream | null = null;
    if (params.video) {
      if (!videoSupported()) {
        micStream.getTracks().forEach(t => t.stop());
        notify({
          kind: 'error',
          message: 'Este navegador não faz chamada de vídeo.',
          description: 'A câmera exige WebCodecs com H.264 — use o Chrome ou o Edge atualizados.',
        });
        return null;
      }
      try {
        cameraStream = await openCamera(DEFAULT_FPS);
      } catch (err) {
        micStream.getTracks().forEach(t => t.stop());
        notify({
          kind: 'error',
          message: err instanceof CameraError ? err.message : 'Não foi possível abrir a câmera.',
        });
        return null;
      }
    }

    // Cartão provisório: o operador vê "Preparando…" enquanto o servidor
    // responde. A chave definitiva só existe depois do POST.
    let callId: string;
    try {
      // SEM vídeo no plano de mídia, de propósito, e a razão é medida:
      //
      //   · oferta COM `<video>`: o telefone do contato não toca. Três
      //     tentativas seguidas, nenhuma stanza de volta — nem `preaccept`.
      //   · oferta SEM `<video>`: toca, e o upgrade no meio da chamada é aceito.
      //
      // Então a ligação nasce por voz e o vídeo entra no atendimento (ver
      // `cameraAoAtender`). Pedir `video: true` aqui subiria o plano de vídeo no
      // servidor e o `enable_video` do upgrade viraria um no-op — a câmera
      // ficaria acesa deste lado sem nunca ser anunciada ao outro.
      callId = await waCallsService.startCall(sid, phone, { video: false });
      waCallsLog('outgoing call created', { callId, video: !!cameraStream });
    } catch (err) {
      micStream.getTracks().forEach(t => t.stop());
      cameraStream?.getTracks().forEach(t => t.stop());
      const message = err instanceof WaCallsError ? err.message : 'Não foi possível iniciar a chamada.';
      notify({ kind: 'error', message });
      return null;
    }

    upsert({
      callId,
      sessionId: sid,
      direction: 'outbound',
      phase: 'PREPARING',
      phone,
      // Saída sempre nasce por telefone; o LID, se houver, aparece no `peer` que
      // o servidor devolve — e é ali que ele é APRENDIDO (ver `call-status`).
      lid: null,
      contact: params.contact ?? null,
      mine: true,
      startedAt: Date.now(),
      connectedAt: null,
      endedAt: null,
      endReason: null,
      muted: false,
      // Chamada que sai daqui é minha por definição: nada a rotear.
      route: { ring: false, show: true, label: '', source: 'assigned', targetUserIds: [], hasNextStep: false },
      videoOn: false,
      peerVideo: false,
      // A oferta saiu com vídeo: a ligação É de vídeo, mesmo que o encoder daqui
      // caia no segundo seguinte.
      wasVideo: !!cameraStream,
      recording: false,
      recorded: false,
      error: null,
    });
    if (!params.contact) {
      void resolveContact(phone).then(contact => { if (contact) patch(callId, { contact }); });
    }

    await this.attachAudio(sid, callId, micStream);

    // A câmera fica ESPERANDO o atendimento. Subir vídeo antes disso não chega a
    // lugar nenhum: o outro lado só passa a aceitar o upgrade depois de atender.
    if (cameraStream) {
      const viva = calls.get(callId);
      if (!viva || viva.phase === 'ENDED' || viva.phase === 'FAILED') {
        // O áudio falhou e já derrubou a chamada: nada de deixar a câmera
        // acesa iluminando ninguém.
        cameraStream.getTracks().forEach(t => t.stop());
      } else {
        cameraAoAtender.set(callId, cameraStream);
        waCallsLog('câmera pronta, aguardando o atendimento', { callId });
      }
    }
    return callId;
  },

  /**
   * Atende uma chamada recebida: reivindica a posse no servidor e sobe o áudio.
   * O microfone é pedido antes do accept — se ele falhar, o cliente continua
   * chamando e outro operador ainda pode atender.
   */
  async acceptCall(callId: string): Promise<void> {
    const call = calls.get(callId);
    if (!call) return;
    let micStream: MediaStream;
    try {
      micStream = await openMicrophone();
    } catch (err) {
      const message = err instanceof MicrophoneError
        ? err.message
        : 'Permissão de microfone necessária para atender a chamada.';
      notify({ kind: 'error', message });
      return;
    }
    // Convite de VÍDEO é atendido COM vídeo, no próprio aceite. O outro lado já
    // está com a câmera ligada desde a oferta; entrar só com voz e ligar a
    // câmera depois é upgrade — e upgrade em chamada que nasceu de vídeo é o
    // que o WhatsApp devolve como `UpgradeReject`. Câmera negada não custa a
    // chamada: entra por voz, que é melhor do que não atender.
    let cameraStream: MediaStream | null = null;
    if (call.peerVideo && videoSupported()) {
      try {
        cameraStream = await openCamera(DEFAULT_FPS);
      } catch (err) {
        notify({
          kind: 'error',
          message: err instanceof CameraError ? err.message : 'Não foi possível abrir a câmera.',
          description: 'A chamada de vídeo vai ser atendida só com a sua voz.',
        });
      }
    }
    patch(callId, { phase: 'PREPARING', mine: true });
    try {
      await waCallsService.acceptCall(call.sessionId, callId, { video: !!cameraStream });
    } catch (err) {
      cameraStream?.getTracks().forEach(t => t.stop());
      micStream.getTracks().forEach(t => t.stop());
      if (err instanceof WaCallsError && err.status === 409) {
        // Outro operador chegou primeiro. Sem erro na cara de ninguém.
        calls.delete(callId);
        emit();
        return;
      }
      patch(callId, { error: err instanceof WaCallsError ? err.message : 'Não foi possível atender.' });
      finishCall(callId, 'failed', true);
      return;
    }
    void assumirAtendimento(call);
    await this.attachAudio(call.sessionId, callId, micStream);

    // O plano de vídeo saiu no próprio `accept`: falta só o encoder daqui.
    if (cameraStream) {
      const viva = calls.get(callId);
      if (!viva || viva.phase === 'ENDED' || viva.phase === 'FAILED') {
        cameraStream.getTracks().forEach(t => t.stop());
      } else {
        await attachVideoBridge(callId, cameraStream);
      }
    }
  },

  /**
   * Acopla o áudio de uma chamada que já existe no servidor.
   *
   * Não há mais negociação: o canal (um WebSocket) já está de pé desde o início
   * da sessão, e acoplar é dizer ao servidor de qual chamada esta aba quer a
   * mídia. Falhando aqui, a chamada é derrubada também no servidor — deixá-la
   * de pé faria o telefone do cliente tocar sem ninguém do outro lado.
   */
  async attachAudio(sid: string, callId: string, micStream: MediaStream): Promise<void> {
    try {
      const bridge = await openCallAudio({
        callId,
        micStream,
        onDisconnected: motivo => {
          transportLost.add(callId);
          avisarTransporte(motivo);
          void this.hangUp(callId);
        },
      });
      bridges.set(callId, bridge);
      const current = calls.get(callId);
      // Subir a ponte leva alguns instantes, e nesse meio-tempo a chamada pode
      // ter caído (o cliente desistiu) ou o operador ter clicado em encerrar.
      // Sem esta guarda, o microfone continuaria aberto depois do fim.
      if (!current || current.phase === 'ENDING' || current.phase === 'ENDED' || current.phase === 'FAILED') {
        bridges.delete(callId);
        bridge.close();
        return;
      }
      // "Chamando…" só vale para quem discou; numa chamada recebida a fase
      // segue em PREPARING ("Conectando…") até o servidor dizer connected.
      if (current.phase === 'PREPARING' && current.direction === 'outbound') {
        patch(callId, { phase: 'CALLING' });
      }
    } catch (err) {
      micStream.getTracks().forEach(t => t.stop());
      // O `detail` é o CORPO da resposta do servidor, e num 500 é lá que está o
      // motivo real (`{"error": "..."}`). Sem imprimi-lo, o console mostrava só
      // a nossa frase genérica e a causa ficava do outro lado da rede, invisível.
      console.error('[WaCalls] falha ao abrir o áudio da chamada', err);
      if (err instanceof WaCallsError && err.detail) {
        console.error('[WaCalls] o servidor respondeu', { status: err.status, corpo: err.detail });
      }
      patch(callId, { error: 'Não foi possível abrir o áudio da chamada.' });
      notify({ kind: 'error', message: 'Não foi possível abrir o áudio da chamada.', description: 'A chamada foi encerrada.' });
      try { await waCallsService.endCall(sid, callId); } catch { /* já pode ter caído */ }
      finishCall(callId, 'failed', true);
    }
  },

  /** Recusa a chamada recebida e tira o alerta da tela. */
  async rejectCall(callId: string): Promise<void> {
    const call = calls.get(callId);
    if (!call) return;
    clearEscalation(callId);
    calls.delete(callId);
    emit();
    // Recusar é informação: a ficha do cliente precisa mostrar que ele ligou e
    // que alguém do escritório optou por não atender naquele momento.
    void archiveCall({ ...call, endedAt: Date.now(), endReason: 'declined' }, false, null);
    try {
      await waCallsService.rejectCall(call.sessionId, callId);
    } catch {
      // O convite já sumiu da tela; insistir no erro não ajuda o operador.
    }
  },

  /** Desliga. O cleanup local acontece aqui e também quando o fim vem pelo SSE. */
  async hangUp(callId: string): Promise<void> {
    const call = calls.get(callId);
    if (!call) return;
    patch(callId, { phase: 'ENDING' });
    try {
      await waCallsService.endCall(call.sessionId, callId);
    } catch {
      // Mesmo sem confirmação do servidor, o lado de cá tem de ser liberado.
    }
    // O evento `call-ended` normalmente chega e fecha tudo; este finish garante
    // o encerramento se o SSE estiver fora do ar.
    if (calls.get(callId)?.phase === 'ENDING') finishCall(callId, 'user_ended');
  },

  /**
   * Muta/desmuta. O corte é no ENVIO dos quadros PCM: como o áudio sai por
   * DataChannel a partir do worklet, desligar a track do microfone sozinha não
   * garantiria silêncio do outro lado.
   */
  setMuted(callId: string, muted: boolean): void {
    bridges.get(callId)?.setMuted(muted);
    patch(callId, { muted });
    // O corte local para de mandar quadro; o servidor precisa saber para o
    // motor emitir conforto (DTX) no lugar. Uma linha que emudece de vez faz o
    // outro lado achar que a ligação caiu.
    void waCallsService.setMuted(callId, muted).catch(() => {
      // Falhar aqui não desfaz o mudo de cá — o operador já não está sendo
      // ouvido, que é o que ele pediu.
    });
  },

  /** Este navegador sabe fazer vídeo? (WebCodecs com H.264.) */
  videoSupported(): boolean {
    return videoSupported();
  },

  /**
   * As imagens desta chamada: a nossa câmera e a do outro lado.
   *
   * Ficam FORA do snapshot de propósito — `MediaStream` não é dado serializável
   * e colocá-lo no estado faria o React comparar objetos que nunca são iguais.
   * A tela pede quando vai renderizar o <video>.
   */
  videoStreams(callId: string): { local: MediaStream | null; remote: MediaStream | null } | null {
    const video = videoBridges.get(callId);
    if (!video) return null;
    return { local: video.localStream(), remote: video.remoteStream() };
  },

  /**
   * UPGRADE: liga a câmera numa chamada de VOZ que já está em curso.
   *
   * Este é o único lugar que fala `enable_video` — a chamada que nasce em vídeo
   * declara isso na própria oferta (ver `placeCallUnguarded`) e não passa por
   * aqui. Por isso a exigência de `ACTIVE`: upgrade só existe depois que o
   * outro lado atendeu; pedido antes disso volta como `UpgradeReject`.
   *
   * A ordem importa: câmera → servidor → encoder. A permissão vem primeiro para
   * uma recusa não deixar o outro lado com um pedido de vídeo pendurado; o
   * servidor vem antes do encoder para o PRIMEIRO quadro (que é sempre um
   * keyframe) já encontrar o plano de vídeo de pé — invertendo, o outro lado
   * ficaria até três segundos na tela preta esperando o keyframe seguinte.
   */
  async startVideo(callId: string, cameraPronta?: MediaStream): Promise<boolean> {
    const call = calls.get(callId);
    if (!call || !call.mine || call.phase !== 'ACTIVE') {
      cameraPronta?.getTracks().forEach(t => t.stop());
      return false;
    }
    if (videoBridges.has(callId)) {
      cameraPronta?.getTracks().forEach(t => t.stop());
      return true;
    }
    if (!videoSupported()) {
      cameraPronta?.getTracks().forEach(t => t.stop());
      notify({
        kind: 'error',
        message: 'Este navegador não faz chamada de vídeo.',
        description: 'A câmera exige WebCodecs com H.264 — use o Chrome ou o Edge atualizados.',
      });
      return false;
    }

    // A câmera pode vir pronta de quem discou pedindo vídeo: a permissão foi
    // pedida antes de o telefone tocar, e reaproveitá-la evita um segundo
    // pedido do navegador no meio da conversa.
    let cameraStream: MediaStream;
    if (cameraPronta) {
      cameraStream = cameraPronta;
    } else {
      try {
        cameraStream = await openCamera(DEFAULT_FPS);
      } catch (err) {
        notify({
          kind: 'error',
          message: err instanceof CameraError ? err.message : 'Não foi possível abrir a câmera.',
        });
        return false;
      }
    }

    try {
      await waCallsService.enableVideo(callId, DEFAULT_FPS);
    } catch (err) {
      cameraStream.getTracks().forEach(t => t.stop());
      notify({
        kind: 'error',
        message: err instanceof WaCallsError ? err.message : 'Não foi possível ligar a câmera.',
      });
      return false;
    }

    const ok = await attachVideoBridge(callId, cameraStream);
    // O upgrade foi negociado e o encoder não subiu: desfazer no servidor, senão
    // o outro lado fica esperando uma imagem que nunca vem.
    if (!ok) {
      try { await waCallsService.disableVideo(callId); } catch { /* já pode ter caído */ }
    }
    return ok;
  },

  /** Quantos quartos de volta a nossa câmera está girando hoje. */
  videoOrientation(): number {
    return orientacaoGuardada();
  },

  /**
   * Gira a nossa câmera mais um quarto de volta e guarda a escolha.
   *
   * Devolve o novo valor. Sem chamada de vídeo no ar não há imagem a girar, mas
   * a escolha continua valendo para a próxima — girar antes de ligar é
   * exatamente o que alguém faz depois de ver a imagem torta uma vez.
   *
   * O giro acontece nos PIXELS, dentro do `videoBridge`, e não como aviso ao
   * outro lado: ver a explicação em `videoBridge.openCallVideo`. Por isso não
   * há nada a esperar do servidor aqui — o quadro seguinte já sai em pé.
   */
  async rotateVideo(callId?: string): Promise<number> {
    const proximo = (orientacaoGuardada() + 1) % 4;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(ORIENTACAO_KEY, String(proximo)); } catch { /* aba privada */ }
    }
    videoBridges.get(callId ?? '')?.setOrientation(proximo);
    emit();
    return proximo;
  },

  /** Desliga a nossa câmera. O outro lado pode continuar mandando a dele. */
  async stopVideo(callId: string): Promise<void> {
    closeVideoBridge(callId);
    patch(callId, { videoOn: false });
    try {
      await waCallsService.disableVideo(callId);
    } catch {
      // A câmera daqui já parou, que é o que o operador pediu.
    }
  },

  /**
   * Liga/desliga a gravação dos DOIS lados da conversa.
   *
   * UMA gravação por chamada, e sem volta: parar encerra o arquivo. Permitir
   * recomeçar pareceria inofensivo e não é — o arquivo tem o nome da chamada,
   * então a segunda gravação apagaria a primeira sem avisar ninguém. Quem
   * precisa de tudo, deixa gravando até desligar.
   *
   * O upload não acontece aqui: o arquivo espera o fim da chamada, que é quando
   * o registro da ficha nasce (ver `archiveCall`).
   */
  setRecording(callId: string, on: boolean): void {
    const call = calls.get(callId);
    if (!call) return;
    const bridge = bridges.get(callId);
    if (!bridge) {
      notify({
        kind: 'error',
        message: 'A gravação começa depois que o áudio conecta.',
        description: 'Aguarde a chamada ser atendida e tente de novo.',
      });
      return;
    }
    if (!on) {
      patch(callId, { recording: false });
      void bridge.stopRecording().then(rec => { if (rec) pendingRecordings.set(callId, rec); });
      return;
    }
    if (call.recorded) {
      notify({
        kind: 'info',
        message: 'Esta chamada já foi gravada.',
        description: 'O arquivo vai para a ficha do cliente quando a chamada terminar.',
      });
      return;
    }
    if (!bridge.startRecording()) {
      notify({
        kind: 'error',
        message: 'Este navegador não grava chamadas.',
        description: 'A gravação funciona no Chrome, no Edge e no Firefox.',
      });
      return;
    }
    patch(callId, { recording: true, recorded: true });
    notify({
      kind: 'info',
      message: 'Gravando a chamada.',
      description: 'O áudio entra na ficha do cliente quando a chamada terminar.',
    });
  },

  /**
   * Solta tudo: pontes de áudio, timers e a escuta de eventos. Chamado quando
   * o host global desmonta (a aba está indo embora) — o microfone não pode
   * ficar aberto porque a página trocou.
   */
  shutdown(): void {
    // Gravação em curso numa aba que está fechando não tem como ser enviada
    // (não há await no descarregamento da página); o áudio da chamada é
    // liberado do mesmo jeito.
    pendingRecordings.clear();
    for (const callId of Array.from(audioWatchdogs.keys())) clearAudioWatchdog(callId);
    for (const callId of Array.from(bridges.keys())) closeBridge(callId);
    for (const timer of removalTimers.values()) clearTimeout(timer);
    removalTimers.clear();
    for (const timer of escalationTimers.values()) clearTimeout(timer);
    escalationTimers.clear();
    transportLost.clear();
    clearLinkTimer();
    clearRetry();
    closeEvents?.();
    closeEvents = null;
    initializing = null;
  },
};
