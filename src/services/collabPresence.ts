/**
 * collabPresence
 * -----------------------------------------------------------------------------
 * Quem está editando o documento JUNTO com você — e nada além disso.
 *
 * Por que este arquivo existe separado do serviço de rede: a lista de quem está
 * na sala e a regra de "quando faz sentido avisar que estou digitando" são as
 * duas coisas que estavam erradas na tela. Antes o aviso vinha de um canal de
 * presença paralelo (Supabase), que mostrava "fulano está digitando" mesmo
 * quando NENHUMA edição estava chegando ao servidor — uma promessa de
 * sincronia que o sistema não estava cumprindo.
 *
 * Regras que valem aqui:
 *  - a lista é a da SALA de co-edição (a mesma que entrega as operações);
 *  - com uma pessoa só na sala não existe "digitando" e nada é transmitido;
 *  - presença NUNCA é apresentada como prova de que o texto está sincronizando —
 *    quem responde por isso é o estado da conexão (`CollabStatus`).
 */

export interface CollabPeer {
  /** Id da CONEXÃO. */
  connectionId: string;
  /**
   * Id do usuário no CRM. É por ele que a foto é resolvida (ver
   * `services/userAvatars.ts`) e é por ele que a própria pessoa é excluída da
   * lista — filtrar só pela conexão não basta, porque uma aba que morreu sem
   * avisar deixa a MESMA pessoa na sala com outro id de conexão.
   */
  userId: string | null;
  userName: string;
  /** Está digitando neste instante. */
  typing: boolean;
}

/** Estado da co-edição — é ISTO que a tela pode usar para dizer "sincronizado". */
export type CollabStatus =
  /** Não há sessão de co-edição (documento comum). */
  | 'off'
  /** Entrando na sala. */
  | 'connecting'
  /** Sala conectada: as edições estão indo e voltando. */
  | 'connected'
  /** Caiu, tentando voltar. As alterações locais continuam no editor. */
  | 'reconnecting'
  /** Sem co-edição: o servidor recusou ou a conexão morreu de vez. */
  | 'disconnected';

/** Quanto tempo sem digitar até o aviso "digitando" cair sozinho. */
export const TYPING_IDLE_MS = 2500;

/** Intervalo mínimo entre dois avisos de digitação para a mesma pessoa. */
export const TYPING_THROTTLE_MS = 1200;

/**
 * Só transmite "estou digitando" se houver alguém para ver. Com uma pessoa na
 * sala isso é tráfego puro — e, pior, alimentava um widget que dava a impressão
 * de co-edição funcionando.
 */
export function shouldBroadcastTyping(peerCount: number): boolean {
  return peerCount > 0;
}

/** O indicador de digitação só existe quando há pelo menos duas pessoas na sala. */
export function shouldShowTypingIndicator(peers: Array<{ typing: boolean }>): boolean {
  return peers.length > 0 && peers.some((peer) => peer.typing);
}

function firstName(name: string): string {
  const clean = String(name || '').trim();
  return clean ? clean.split(/\s+/)[0] : 'Alguém';
}

/** O mínimo que a barra precisa saber de cada pessoa para escrever a frase. */
export interface PresenceDescriptor {
  userName: string;
  typing: boolean;
}

/**
 * Texto da barra de presença, no espírito do Google Docs: o nome de quem está
 * digitando, e não um número solto.
 */
export function describePresence(peers: PresenceDescriptor[]): string {
  if (peers.length === 0) return '';

  const typing = peers.filter((peer) => peer.typing);
  if (typing.length === 1) return `${firstName(typing[0].userName)} está digitando…`;
  if (typing.length === 2) {
    return `${firstName(typing[0].userName)} e ${firstName(typing[1].userName)} estão digitando…`;
  }
  if (typing.length > 2) return `${typing.length} pessoas digitando…`;

  if (peers.length === 1) return `${firstName(peers[0].userName)} também está neste documento`;
  if (peers.length === 2) {
    return `${firstName(peers[0].userName)} e ${firstName(peers[1].userName)} estão neste documento`;
  }
  return `${peers.length} pessoas neste documento`;
}

/** Frase curta do estado da co-edição. Nunca diz "sincronizado" sem estar. */
export function describeCollabStatus(status: CollabStatus): string {
  switch (status) {
    case 'connected':
      return 'Coedição ativa';
    case 'connecting':
      return 'Entrando na coedição…';
    case 'reconnecting':
      return 'Coedição reconectando…';
    case 'disconnected':
      return 'Coedição desconectada';
    default:
      return '';
  }
}

interface RawMember {
  connectionId?: string | null;
  currentUser?: string | null;
  userId?: string | null;
}

/**
 * Lista de participantes da sala, alimentada pelas mensagens do hub
 * (`addUser`, `removeUser`, `typing`, `action`). Guarda só quem NÃO é você.
 */
export class CollabPeerRegistry {
  private readonly peers = new Map<string, CollabPeer>();

  private selfConnectionId = '';

  private selfUserId = '';

  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  setSelfConnectionId(connectionId: string): void {
    this.selfConnectionId = String(connectionId || '');
    // Se o próprio id chegou depois de um `addUser` com ele dentro, tira da lista.
    if (this.selfConnectionId) this.peers.delete(this.selfConnectionId);
  }

  /**
   * Quem é você, do ponto de vista do CRM.
   *
   * Filtrar apenas pelo id da CONEXÃO não é suficiente: uma aba que morreu sem
   * avisar (queda de rede, reinício do serviço, aba fechada à força) fica
   * pendurada na sala com outro id de conexão. A pessoa abre o documento
   * sozinha e vê o PRÓPRIO nome como "fulano também está neste documento".
   * O servidor limpa essas sobras ao reentrar; isto aqui é o cinto de segurança
   * do lado da tela.
   */
  setSelfUserId(userId: string | null | undefined): void {
    this.selfUserId = String(userId || '');
    if (!this.selfUserId) return;
    for (const [connectionId, peer] of this.peers) {
      if (peer.userId === this.selfUserId) this.peers.delete(connectionId);
    }
  }

  private isSelf(connectionId: string, userId: string | null): boolean {
    if (connectionId && connectionId === this.selfConnectionId) return true;
    return Boolean(this.selfUserId) && userId === this.selfUserId;
  }

  list(): CollabPeer[] {
    return Array.from(this.peers.values());
  }

  count(): number {
    return this.peers.size;
  }

  /** `addUser` traz um objeto ou um array (quando você acaba de entrar). */
  add(entry: unknown): boolean {
    if (Array.isArray(entry)) {
      let changed = false;
      for (const item of entry) {
        if (this.add(item)) changed = true;
      }
      return changed;
    }

    const member = entry as RawMember | null;
    const connectionId = String(member?.connectionId || '');
    if (!connectionId) return false;

    const existing = this.peers.get(connectionId);
    const userId = member?.userId ? String(member.userId) : existing?.userId ?? null;
    if (this.isSelf(connectionId, userId)) {
      // Pode ser uma sobra da própria pessoa que já estava na lista.
      return this.peers.delete(connectionId);
    }

    const next: CollabPeer = {
      connectionId,
      userId,
      userName: String(member?.currentUser || existing?.userName || 'Alguém'),
      typing: existing?.typing ?? false,
    };

    if (existing && existing.userName === next.userName && existing.userId === next.userId) {
      return false;
    }

    this.peers.set(connectionId, next);
    return true;
  }

  remove(connectionId: unknown): boolean {
    const id = String(connectionId || '');
    const timer = this.typingTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(id);
    }
    return this.peers.delete(id);
  }

  /**
   * Marca alguém como digitando. O aviso cai sozinho depois de
   * `TYPING_IDLE_MS` — o servidor não precisa mandar "parou de digitar".
   */
  setTyping(connectionId: unknown, typing: boolean, onExpire?: () => void): boolean {
    const id = String(connectionId || '');
    const peer = this.peers.get(id);
    if (!peer) return false;

    const timer = this.typingTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(id);
    }

    if (typing) {
      this.typingTimers.set(
        id,
        setTimeout(() => {
          this.typingTimers.delete(id);
          const current = this.peers.get(id);
          if (current?.typing) {
            this.peers.set(id, { ...current, typing: false });
            onExpire?.();
          }
        }, TYPING_IDLE_MS),
      );
    }

    if (peer.typing === typing) return false;
    this.peers.set(id, { ...peer, typing });
    return true;
  }

  clear(): void {
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    this.peers.clear();
  }
}

/**
 * Controla a frequência do aviso de digitação que ESTE usuário envia.
 * Devolve `true` quando o aviso deve ir para a rede agora.
 */
export class TypingBroadcastGate {
  private lastSentAt = 0;

  private lastState = false;

  shouldSend(peerCount: number, now: number = Date.now()): boolean {
    if (!shouldBroadcastTyping(peerCount)) {
      // Com ninguém na sala o estado local também zera: quando alguém entrar, o
      // primeiro caractere digitado volta a avisar na hora.
      this.lastState = false;
      return false;
    }
    if (this.lastState && now - this.lastSentAt < TYPING_THROTTLE_MS) return false;
    this.lastSentAt = now;
    this.lastState = true;
    return true;
  }

  reset(): void {
    this.lastSentAt = 0;
    this.lastState = false;
  }
}
