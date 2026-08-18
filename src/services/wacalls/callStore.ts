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
  type WaCallAudioBridge, type WaCallRecording,
} from './audioBridge';
import { callLogService, type CallLogOutcome } from '../callLog.service';
import {
  CALLABLE_PHONE_UNKNOWN, parseWaPeer, resolveCallablePhone,
  type CallablePhoneCandidate,
} from './phone';
import { endReasonIsFailure, endReasonMessage, phaseFromStatus } from './callOutcome';
import { decideCallRing, CALL_ESCALATION_MS, type CallRoute, type CallRouteSource } from './callRouting';
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
  /** `activeWaCallsSessionId` — a conta usada para ligar. */
  sessionId: string | null;
  /** Todas as chamadas conhecidas, da mais recente para a mais antiga. */
  calls: WaCall[];
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
let sessionId: string | null = null;
let ready = false;
let available = false;
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let linkTimer: ReturnType<typeof setTimeout> | null = null;
let linkListenersOn = false;
let initializing: Promise<void> | null = null;
let closeEvents: (() => void) | null = null;
let snapshot: WaCallsSnapshot = {
  ready: false, available: false, online: true, linkDown: false,
  sessions: [], sessionId: null, calls: [],
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
    sessionId,
    calls: Array.from(calls.values()).sort((a, b) => b.startedAt - a.startedAt),
  };
  listeners.forEach(fn => fn());
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
    && call.connectedAt === null
    && call.endReason !== 'declined'
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

/**
 * A conta que pode ligar: pareada e com a conexão aberta.
 *
 * Havendo uma só, ela é usada sem perguntar nada. Havendo mais, a primeira
 * serve de padrão e a lista fica no snapshot — é o gancho para, no futuro, o
 * operador escolher por qual número ligar (`setSessionId`).
 */
function callableSessions(list: WaCallsSession[]): WaCallsSession[] {
  return list.filter(s => s.paired && s.state === 'open');
}

function applySessions(list: WaCallsSession[]): void {
  sessions = list;
  const callable = callableSessions(list);
  // Mantém a escolha atual enquanto ela continuar válida.
  if (sessionId && callable.some(s => s.id === sessionId)) return;
  sessionId = callable[0]?.id ?? null;
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
}

function patch(callId: string, changes: Partial<WaCall>): WaCall | null {
  const current = calls.get(callId);
  if (!current) return null;
  const next = { ...current, ...changes };
  calls.set(callId, next);
  emit();
  return next;
}

/** Fecha a ponte de áudio e solta os recursos daquela chamada — e só dela. */
function closeBridge(callId: string): void {
  const bridge = bridges.get(callId);
  if (!bridge) return;
  bridges.delete(callId);
  bridge.close();
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
  if (call.connectedAt) return 'answered';
  if (failed) return 'failed';
  if (endReason === 'declined') return 'declined';
  return 'missed';
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
      answeredAt: call.connectedAt,
      endedAt: call.endedAt ?? Date.now(),
      endReason: call.endReason,
      outcome: outcomeOf(call, failed, call.endReason),
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
  // Uma chamada termina DUAS vezes: quem desligou encerra o lado de cá e o
  // `call-ended` chega logo depois pelo SSE. Sem esta guarda, o operador via o
  // mesmo aviso duas vezes — e agora a gravação subiria e o registro seria
  // escrito em duplicidade.
  if (call.phase === 'ENDED' || call.phase === 'FAILED') return;
  const answered = call.connectedAt !== null;
  const updated = patch(callId, {
    phase: failed ? 'FAILED' : 'ENDED',
    endedAt: Date.now(),
    endReason,
    recording: false,
    error: failed ? call.error : null,
  });
  if (!updated) return;
  waCallsLog('call ended', { callId, endReason });
  if (!failed) {
    const message = endReasonMessage(endReason, { answered, direction: call.direction });
    notify({ kind: endReasonIsFailure(endReason, answered) ? 'error' : 'info', message });
  }
  // O cartão da chamada some da tela em segundos; a PERDIDA não pode sumir
  // junto — quem estava no processo ou na agenda nem viu o telefone tocar.
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

/** Nome de quem deveria atender — o cartão explica para quem está tocando. */
const nameCache = new Map<string, string | null>();
async function profileName(userId: string): Promise<string | null> {
  const cached = nameCache.get(userId);
  if (cached !== undefined) return cached;
  try {
    const { data } = await supabase.from('profiles').select('name').eq('user_id', userId).maybeSingle();
    const name = (data as { name: string | null } | null)?.name ?? null;
    nameCache.set(userId, name);
    return name;
  } catch {
    return null;
  }
}

/** Padrão de atendimento do canal (`whatsapp_instances.default_assignee_id`). */
async function channelDefaultAssignee(instanceId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('whatsapp_instances').select('default_assignee_id').eq('id', instanceId).maybeSingle();
    return (data as { default_assignee_id: string | null } | null)?.default_assignee_id ?? null;
  } catch {
    return null;
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
  let targetUserId: string | null = null;
  let source: CallRouteSource = 'everyone';
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
    if (identidade.assignedUserId) {
      targetUserId = identidade.assignedUserId;
      source = 'assigned';
    } else if (identidade.instanceId) {
      const padrao = await channelDefaultAssignee(identidade.instanceId);
      if (padrao) { targetUserId = padrao; source = 'channel'; }
    }
  }

  // Sem rosto e com número em mãos: pergunta a foto do WhatsApp. Não é esperado
  // — o cartão já está na tela e a foto entra quando chegar.
  if (numero && !identidade?.contact.avatarUrl) void fillProfilePhoto(callId, numero);

  if (!numero && !identidade) {
    // Nem número, nem conversa, nem ficha (com ou sem nome de perfil na tela):
    // não há responsável, canal nem bloqueio a consultar. Toca para todos,
    // como qualquer chamada sem dono.
    const me = await currentUserId();
    patch(callId, {
      route: decideCallRing({
        me, targetUserId: null, source: 'everyone', contactBlocked: false,
        imBusy: inAnotherCall(callId), escalated: false,
      }),
    });
    return;
  }

  const [me, targetName] = await Promise.all([
    currentUserId(),
    targetUserId ? profileName(targetUserId) : Promise.resolve(null),
  ]);

  const apply = (escalated: boolean) => {
    const call = calls.get(callId);
    if (!call || call.phase !== 'RINGING' || call.mine) return;
    const route = decideCallRing({
      me, targetUserId, source, targetName, contactBlocked,
      imBusy: inAnotherCall(callId),
      escalated,
    });
    patch(callId, { route });
    return route;
  };

  const route = apply(false);
  waCallsLog('rota da chamada recebida', { callId, source, targetUserId, ring: route?.ring });

  // Escalada: o dono não é a mesa dele. Passados alguns segundos sem ninguém
  // atender, o convite deixa de ser exclusivo.
  if (route && !route.ring && route.show) {
    const timer = setTimeout(() => {
      escalationTimers.delete(callId);
      apply(true);
    }, CALL_ESCALATION_MS);
    escalationTimers.set(callId, timer);
  }
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

    case 'call-ended':
      if (!calls.has(event.id)) return;
      finishCall(event.id, event.reason ?? null);
      break;

    default:
      break;
  }
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
    initializing = (async () => {
      try {
        applySessions(await waCallsService.getSessions());
        available = true;
        waCallsLog('session loaded', { sessionId, total: sessions.length });
      } catch {
        available = false;
        waCallsLog('serviço de chamadas indisponível');
      } finally {
        ready = true;
        emit();
      }
      if (!available || closeEvents) return;
      closeEvents = waCallsService.connectEvents({
        onEvent: handleEvent,
        onOpen: () => { available = true; emit(); },
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

  /** Escolha manual da conta — pronto para quando houver mais de um número. */
  setSessionId(id: string | null): void {
    sessionId = id;
    emit();
  },

  /**
   * Liga para um número a partir da conversa.
   *
   * Ordem: sessão → microfone → chamada no WaCalls → negociação → ponte. O
   * microfone vem ANTES de criar a chamada de propósito: descobrir a permissão
   * bloqueada depois que o telefone do cliente já tocou seria pior.
   */
  async placeCall(params: {
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
      notify({ kind: 'error', message: 'Nenhum WhatsApp disponível para chamadas.', description: 'Nenhuma conta pareada e conectada no serviço de chamadas.' });
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

    // Cartão provisório: o operador vê "Preparando…" enquanto o servidor
    // responde. A chave definitiva só existe depois do POST.
    let callId: string;
    try {
      callId = await waCallsService.startCall(sid, phone);
      waCallsLog('outgoing call created', { callId });
    } catch (err) {
      micStream.getTracks().forEach(t => t.stop());
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
      route: { ring: false, show: true, label: '' },
      recording: false,
      recorded: false,
      error: null,
    });
    if (!params.contact) {
      void resolveContact(phone).then(contact => { if (contact) patch(callId, { contact }); });
    }

    await this.attachAudio(sid, callId, micStream);
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
    patch(callId, { phase: 'PREPARING', mine: true });
    try {
      await waCallsService.acceptCall(call.sessionId, callId);
    } catch (err) {
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
    await this.attachAudio(call.sessionId, callId, micStream);
  },

  /**
   * Sobe a ponte WebRTC/DataChannel de uma chamada que já existe no servidor.
   * Falhando aqui, a chamada é derrubada também no servidor — deixá-la de pé
   * faria o telefone do cliente tocar sem ninguém do outro lado.
   */
  async attachAudio(sid: string, callId: string, micStream: MediaStream): Promise<void> {
    try {
      const bridge = await openCallAudio({
        callId,
        micStream,
        negotiate: sdpOffer => waCallsService.negotiateWebRTC(sid, callId, sdpOffer),
        onDisconnected: () => { void this.hangUp(callId); },
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
      console.error('[WaCalls] falha ao abrir o áudio da chamada', err);
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
    for (const callId of Array.from(bridges.keys())) closeBridge(callId);
    for (const timer of removalTimers.values()) clearTimeout(timer);
    removalTimers.clear();
    for (const timer of escalationTimers.values()) clearTimeout(timer);
    escalationTimers.clear();
    clearLinkTimer();
    closeEvents?.();
    closeEvents = null;
    initializing = null;
  },
};
