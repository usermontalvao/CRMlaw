// A PONTE ENTRE NAVEGADORES — o segundo atendente e a transferência de voz.
//
// POR QUE ELA EXISTE. O WaCalls entrega uma ligação a UM navegador: o
// `X-Client-Id` é dono da chamada e o áudio sobe como PCM por um DataChannel
// só. Não há conferência, não há "passar a chamada para outro cliente" — o
// serviço recusa (409) uma segunda posse. Então quem faz sala de conferência
// aqui é o CRM: a aba que atendeu vira ÂNCORA e liga uma segunda conexão
// WebRTC, esta convencional, com a aba do colega.
//
// O caminho do som, que é onde tudo se decide:
//
//   cliente ──WhatsApp──▶ âncora ──WebRTC──▶ convidado
//   convidado ──WebRTC──▶ âncora ──WhatsApp──▶ cliente
//
// A âncora já tinha, para a gravação, o ponto do grafo em que as duas vozes
// existem juntas; é ele que vai para o convidado (ver `audioBridge.guestFeed`).
// E a voz do convidado entra no MESMO worklet de captura do microfone — o
// WebAudio soma as entradas, e o WhatsApp continua vendo uma linha só.
//
// A CONSEQUÊNCIA, que a tela precisa dizer em voz alta: a aba da âncora segura
// a ligação inteira. Ela fecha, a chamada cai para todo mundo. Não é descuido
// de projeto, é o que sobra quando o servidor de voz não sabe conferenciar.
//
// SINALIZAÇÃO pelo Supabase Realtime, em dois canais:
//   · `wa:call-invite:<userId>` — a caixa de convites de cada atendente;
//   · `wa:call:<callId>:<userId>` — a negociação daquele par (oferta, resposta,
//     candidatos, tchau).
//
// As regras de QUEM pode ser convidado e do que cada estado significa são puras
// e moram em `callGuests.ts`.
import { supabase } from '../../config/supabase';
import { openMicrophone } from './audioBridge';
import { WEBRTC_ICE_SERVERS, getWaCallsClientId, waCallsLog } from './config';
import { operatorPresence } from './operatorPresence';
import { myUserId } from './routingData';
import { whatsappService } from '../whatsapp.service';
import { inviteExpired, type CallInviteMode, type GuestStatus } from './callGuests';
import type { RealtimeChannel } from '@supabase/supabase-js';

/** O convite como ele viaja entre as duas abas. */
export interface CallInvite {
  callId: string;
  mode: CallInviteMode;
  fromUserId: string;
  fromName: string | null;
  toUserId: string;
  /** Quem está do outro lado da linha, para o convite dizer de quem se trata. */
  contactName: string | null;
  phone: string;
  conversationId: string | null;
  clientId: string | null;
  sentAt: number;
}

/** Um convidado, do ponto de vista de quem atendeu. */
export interface CallGuest {
  userId: string;
  name: string | null;
  mode: CallInviteMode;
  status: GuestStatus;
}

export interface CallBridgeSnapshot {
  /** Convidados desta mesa (só a âncora tem). */
  guests: CallGuest[];
  /** Convite recebido e ainda não respondido. */
  invite: CallInvite | null;
  /** A ligação em que ESTA mesa entrou como convidada. */
  joined: { callId: string; mode: CallInviteMode; invite: CallInvite } | null;
  /** Esta mesa é a ponte de áudio de alguém? (a janela não pode fechar) */
  anchoring: boolean;
  /** O microfone do convidado está cortado? */
  guestMuted: boolean;
  /** Quem sou eu — a lista de convite precisa para não me oferecer a mim mesmo. */
  me: string | null;
}

/** O que a âncora precisa emprestar do áudio da chamada. */
export interface HostAudio {
  feed: () => MediaStream | null;
  attachGuest: (stream: MediaStream) => void;
  detachGuest: () => void;
  /** Desliga o microfone da âncora — usado quando ela TRANSFERE a ligação. */
  mute: () => void;
}

const listeners = new Set<() => void>();
let snapshot: CallBridgeSnapshot = {
  guests: [], invite: null, joined: null, anchoring: false, guestMuted: false, me: null,
};
let started = false;
let me: string | null = null;
let meuNome: string | null = null;
let inviteChannel: RealtimeChannel | null = null;
let hostAudioFor: (callId: string) => HostAudio | null = () => null;

/** Uma negociação viva — na âncora, uma por convidado; no convidado, uma só. */
interface Sessao {
  callId: string;
  peerUserId: string;
  /** Conversa da chamada — a transferência precisa dela para entregar o caso. */
  conversationId?: string | null;
  channel: RealtimeChannel;
  pc: RTCPeerConnection;
  audioEl?: HTMLAudioElement;
  micStream?: MediaStream;
}
/** Chave: `${callId}:${userId do outro lado}`. */
const sessoes = new Map<string, Sessao>();

const chave = (callId: string, userId: string) => `${callId}:${userId}`;

function emit(): void {
  snapshot = { ...snapshot, anchoring: snapshot.guests.some(g => g.status === 'live' || g.status === 'joining') };
  listeners.forEach(fn => fn());
}

function setGuest(userId: string, patch: Partial<CallGuest>): void {
  snapshot = {
    ...snapshot,
    guests: snapshot.guests.map(g => (g.userId === userId ? { ...g, ...patch } : g)),
  };
  emit();
}

function dropGuest(userId: string): void {
  snapshot = { ...snapshot, guests: snapshot.guests.filter(g => g.userId !== userId) };
  emit();
}

/** Canal de negociação de um par. Os dois lados assinam o mesmo nome. */
function canalDoPar(callId: string, guestUserId: string): RealtimeChannel {
  return supabase.channel(`wa:call:${callId}:${guestUserId}`, {
    config: { broadcast: { self: false, ack: false } },
  });
}

const enviar = (channel: RealtimeChannel, event: string, payload: unknown) => {
  void channel.send({ type: 'broadcast', event, payload });
};

/** Solta uma negociação: conexão, microfone, alto-falante e canal. */
function encerrarSessao(callId: string, peerUserId: string, avisar = true): void {
  const k = chave(callId, peerUserId);
  const sessao = sessoes.get(k);
  if (!sessao) return;
  sessoes.delete(k);
  if (avisar) enviar(sessao.channel, 'bye', { callId });
  try { sessao.pc.close(); } catch { /* já fechada */ }
  try { sessao.micStream?.getTracks().forEach(t => t.stop()); } catch { /* idem */ }
  if (sessao.audioEl) {
    try { sessao.audioEl.pause(); sessao.audioEl.srcObject = null; sessao.audioEl.remove(); } catch { /* idem */ }
  }
  void supabase.removeChannel(sessao.channel);
  waCallsLog('ponte entre navegadores encerrada', { callId, peerUserId });
}

/** Toca o som que chega do outro navegador. */
function tocar(stream: MediaStream): HTMLAudioElement {
  const el = document.createElement('audio');
  el.autoplay = true;
  el.srcObject = stream;
  el.style.display = 'none';
  document.body.appendChild(el);
  void el.play().catch(() => { /* o gesto de aceitar já liberou o autoplay */ });
  return el;
}

/**
 * TRANSFERIR É ENTREGAR O ATENDIMENTO, não só passar o som.
 *
 * Quando o colega entra em modo transferência, três coisas acontecem juntas, e
 * as três são necessárias para a transferência ser verdade no dia seguinte:
 *
 *  1. A CONVERSA passa a ser dele na inbox (é o que faz o próximo retorno do
 *     cliente tocar na mesa certa — ver a hierarquia em `callRouting`).
 *  2. O MICROFONE de quem transferiu se cala: quem entregou o caso saiu da
 *     conversa. A pessoa pode religar o microfone com um clique se precisar.
 *  3. A JANELA de quem transferiu continua sendo a ponte de áudio, e a tela diz
 *     isso — é a única parte que não dá para esconder.
 *
 * Falhando a atribuição, o áudio continua: a ligação em curso vale mais que o
 * registro, e o responsável pode ser corrigido na inbox depois.
 */
async function concluirTransferencia(
  callId: string,
  guestUserId: string,
  audio: HostAudio,
): Promise<void> {
  audio.mute();
  const conversationId = sessoes.get(chave(callId, guestUserId))?.conversationId ?? null;
  if (!conversationId) return;
  try {
    await whatsappService.assignConversation(conversationId, guestUserId, 'Transferência durante a ligação');
    waCallsLog('atendimento transferido na ligação', { callId, guestUserId });
  } catch {
    // A ligação segue de pé; o responsável fica para a inbox resolver.
  }
}

export const callBridge = {
  /**
   * A âncora empresta o áudio da chamada. Chamado pelo `callStore`, que é quem
   * conhece as pontes vivas — este módulo nunca vai buscá-las.
   */
  bindHostAudio(fn: (callId: string) => HostAudio | null): void {
    hostAudioFor = fn;
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  getSnapshot(): CallBridgeSnapshot {
    return snapshot;
  },

  /** Abre a caixa de convites desta pessoa. Idempotente. */
  init(): void {
    if (started || typeof window === 'undefined') return;
    started = true;
    void (async () => {
      me = await myUserId();
      if (!me) { started = false; return; }
      snapshot = { ...snapshot, me };
      emit();
      try {
        const { data } = await supabase.from('profiles').select('name').eq('user_id', me).maybeSingle();
        meuNome = (data as { name: string | null } | null)?.name ?? null;
      } catch { /* sem nome, o convite diz "Um atendente" */ }

      inviteChannel = supabase.channel(`wa:call-invite:${me}`, {
        config: { broadcast: { self: false } },
      });
      inviteChannel
        .on('broadcast', { event: 'invite' }, ({ payload }) => {
          const convite = payload as CallInvite;
          if (!convite?.callId || convite.toUserId !== me) return;
          // Convite velho não sobe: o cliente pode ter desligado enquanto a aba
          // estava dormindo, e nada é pior que atender uma ligação que já acabou.
          if (inviteExpired(convite.sentAt, Date.now())) return;
          // Já estou nesta ligação (ou em outra): a resposta é automática, e o
          // colega vê "não pôde entrar" em vez de esperar por nada.
          const jaOcupado = !!snapshot.joined
            || snapshot.guests.some(g => g.status === 'joining' || g.status === 'live' || g.status === 'inviting');
          if (jaOcupado) {
            // Resposta automática, e só depois do canal subir: um `send` antes
            // do SUBSCRIBED é descartado em silêncio, e quem convidou ficaria
            // olhando para "Chamando…" até o convite expirar.
            this.decline(convite);
            return;
          }
          snapshot = { ...snapshot, invite: convite };
          emit();
        })
        .on('broadcast', { event: 'invite-cancel' }, ({ payload }) => {
          const { callId } = (payload ?? {}) as { callId?: string };
          if (snapshot.invite?.callId !== callId) return;
          snapshot = { ...snapshot, invite: null };
          emit();
        })
        .subscribe();
    })();
  },

  /**
   * CHAMA UM COLEGA PARA A LIGAÇÃO (ou passa a ligação para ele).
   *
   * Só monta a conexão depois do aceite: abrir WebRTC contra uma mesa que vai
   * recusar é gastar microfone e negociação à toa.
   */
  async invite(params: {
    callId: string;
    toUserId: string;
    toName: string | null;
    mode: CallInviteMode;
    contactName: string | null;
    phone: string;
    conversationId: string | null;
    clientId: string | null;
  }): Promise<void> {
    if (!me) me = await myUserId();
    if (!me) return;
    const { callId, toUserId, toName, mode } = params;

    snapshot = {
      ...snapshot,
      guests: [
        ...snapshot.guests.filter(g => g.userId !== toUserId),
        { userId: toUserId, name: toName, mode, status: 'inviting' },
      ],
    };
    emit();

    const channel = canalDoPar(callId, toUserId);
    sessoes.set(chave(callId, toUserId), {
      callId,
      peerUserId: toUserId,
      conversationId: params.conversationId,
      channel,
      pc: new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS }),
    });

    channel
      .on('broadcast', { event: 'accept' }, () => { void this.hostNegotiate(callId, toUserId); })
      .on('broadcast', { event: 'decline' }, () => {
        setGuest(toUserId, { status: 'declined' });
        encerrarSessao(callId, toUserId, false);
        // O aviso some sozinho: recusa não é erro, é resposta.
        setTimeout(() => dropGuest(toUserId), 4000);
      })
      .on('broadcast', { event: 'answer' }, ({ payload }) => {
        const sessao = sessoes.get(chave(callId, toUserId));
        const { sdp } = (payload ?? {}) as { sdp?: string };
        if (!sessao || !sdp) return;
        void sessao.pc.setRemoteDescription({ type: 'answer', sdp });
      })
      .on('broadcast', { event: 'ice' }, ({ payload }) => {
        const sessao = sessoes.get(chave(callId, toUserId));
        const { candidate } = (payload ?? {}) as { candidate?: RTCIceCandidateInit };
        if (!sessao || !candidate) return;
        void sessao.pc.addIceCandidate(candidate).catch(() => { /* candidato tardio */ });
      })
      .on('broadcast', { event: 'bye' }, () => {
        const audio = hostAudioFor(callId);
        audio?.detachGuest();
        setGuest(toUserId, { status: 'gone' });
        encerrarSessao(callId, toUserId, false);
        setTimeout(() => dropGuest(toUserId), 4000);
      })
      .subscribe(status => {
        if (status !== 'SUBSCRIBED' || !inviteChannel) return;
        const convite: CallInvite = {
          callId, mode, fromUserId: me!, fromName: meuNome, toUserId,
          contactName: params.contactName, phone: params.phone,
          conversationId: params.conversationId, clientId: params.clientId,
          sentAt: Date.now(),
        };
        const caixa = supabase.channel(`wa:call-invite:${toUserId}`, {
          config: { broadcast: { self: false } },
        });
        caixa.subscribe(s => {
          if (s !== 'SUBSCRIBED') return;
          enviar(caixa, 'invite', convite);
          // A caixa do colega não precisa ficar aberta: o que continua é o canal
          // do par, que é onde a negociação acontece.
          setTimeout(() => { void supabase.removeChannel(caixa); }, 2000);
        });
        waCallsLog('convite de ligação enviado', { callId, toUserId, mode });
      });
  },

  /** A âncora oferece o áudio depois que o convidado aceitou. */
  async hostNegotiate(callId: string, guestUserId: string): Promise<void> {
    const sessao = sessoes.get(chave(callId, guestUserId));
    const audio = hostAudioFor(callId);
    if (!sessao || !audio) return;
    const feed = audio.feed();
    if (!feed) { setGuest(guestUserId, { status: 'failed' }); return; }
    setGuest(guestUserId, { status: 'joining' });

    const { pc, channel } = sessao;
    for (const track of feed.getAudioTracks()) pc.addTrack(track, feed);
    pc.ontrack = event => {
      // A voz do convidado entra na ligação com o cliente.
      const [stream] = event.streams;
      if (stream) audio.attachGuest(stream);
      setGuest(guestUserId, { status: 'live' });
      const convidado = snapshot.guests.find(g => g.userId === guestUserId);
      if (convidado?.mode === 'transfer') void concluirTransferencia(callId, guestUserId, audio);
    };
    pc.onicecandidate = event => {
      if (event.candidate) enviar(channel, 'ice', { candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      // `failed` é queda de rede; `disconnected` costuma ser a ABA do convidado
      // fechando sem se despedir. Nos dois casos a voz dele já não chega ao
      // cliente, e deixar o nome dele na tela seria mentir para quem está
      // falando — o áudio do cliente segue intacto de qualquer forma.
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setGuest(guestUserId, { status: pc.connectionState === 'failed' ? 'failed' : 'gone' });
        audio.detachGuest();
        setTimeout(() => dropGuest(guestUserId), 4000);
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    enviar(channel, 'offer', { sdp: offer.sdp });
  },

  /** O convidado aceita: abre o microfone e responde a oferta. */
  async accept(): Promise<void> {
    const convite = snapshot.invite;
    if (!convite || !me) return;
    snapshot = { ...snapshot, invite: null };
    emit();

    let micStream: MediaStream;
    try {
      micStream = await openMicrophone();
    } catch {
      this.decline(convite);
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS });
    const channel = canalDoPar(convite.callId, me);
    sessoes.set(chave(convite.callId, convite.fromUserId), {
      callId: convite.callId, peerUserId: convite.fromUserId, channel, pc, micStream,
    });

    for (const track of micStream.getAudioTracks()) pc.addTrack(track, micStream);
    pc.ontrack = event => {
      const [stream] = event.streams;
      if (!stream) return;
      const sessao = sessoes.get(chave(convite.callId, convite.fromUserId));
      if (sessao) sessao.audioEl = tocar(stream);
    };
    pc.onicecandidate = event => {
      if (event.candidate) enviar(channel, 'ice', { candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      // A janela da âncora fechou (ou a rede dela caiu): não há mais ligação
      // nenhuma deste lado. Sair sozinho é melhor que uma barra verde piscando
      // "em ligação" sobre um silêncio.
      if (pc.connectionState !== 'failed' && pc.connectionState !== 'disconnected') return;
      encerrarSessao(convite.callId, convite.fromUserId, false);
      snapshot = { ...snapshot, joined: null, guestMuted: false };
      emit();
    };

    channel
      .on('broadcast', { event: 'offer' }, ({ payload }) => {
        const { sdp } = (payload ?? {}) as { sdp?: string };
        if (!sdp) return;
        void (async () => {
          await pc.setRemoteDescription({ type: 'offer', sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          enviar(channel, 'answer', { sdp: answer.sdp });
          snapshot = { ...snapshot, joined: { callId: convite.callId, mode: convite.mode, invite: convite } };
          emit();
        })();
      })
      .on('broadcast', { event: 'ice' }, ({ payload }) => {
        const { candidate } = (payload ?? {}) as { candidate?: RTCIceCandidateInit };
        if (candidate) void pc.addIceCandidate(candidate).catch(() => { /* tardio */ });
      })
      .on('broadcast', { event: 'bye' }, () => {
        encerrarSessao(convite.callId, convite.fromUserId, false);
        snapshot = { ...snapshot, joined: null };
        emit();
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') enviar(channel, 'accept', { callId: convite.callId });
      });
  },

  /** O convidado recusa — e o colega sabe disso na hora. */
  decline(invite?: CallInvite): void {
    const convite = invite ?? snapshot.invite;
    if (!convite || !me) return;
    snapshot = { ...snapshot, invite: null };
    emit();
    const channel = canalDoPar(convite.callId, me);
    channel.subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      enviar(channel, 'decline', { callId: convite.callId });
      setTimeout(() => { void supabase.removeChannel(channel); }, 1500);
    });
  },

  /**
   * O convidado corta o próprio microfone.
   *
   * Desligar a track basta AQUI (ao contrário da ponte para o WhatsApp, onde o
   * corte tem de ser no envio dos quadros): esta perna é WebRTC comum, e uma
   * track desabilitada manda silêncio de verdade.
   */
  setGuestMuted(muted: boolean): void {
    const atual = snapshot.joined;
    if (!atual) return;
    const sessao = sessoes.get(chave(atual.callId, atual.invite.fromUserId));
    try { sessao?.micStream?.getAudioTracks().forEach(t => { t.enabled = !muted; }); } catch { /* ignore */ }
    snapshot = { ...snapshot, guestMuted: muted };
    emit();
  },

  /** O convidado sai por conta própria (a ligação continua com a âncora). */
  leave(): void {
    const atual = snapshot.joined;
    if (!atual) return;
    encerrarSessao(atual.callId, atual.invite.fromUserId, true);
    snapshot = { ...snapshot, joined: null, guestMuted: false };
    emit();
  },

  /** A âncora tira o convidado da ligação. */
  removeGuest(callId: string, userId: string): void {
    hostAudioFor(callId)?.detachGuest();
    encerrarSessao(callId, userId, true);
    dropGuest(userId);
  },

  /**
   * A chamada acabou: todo mundo sai junto.
   *
   * Chamado pelo `callStore` no fim da ligação — sem isto o convidado ficaria
   * com um áudio mudo na tela achando que ainda está em atendimento.
   */
  endCall(callId: string): void {
    for (const [k, sessao] of Array.from(sessoes.entries())) {
      if (sessao.callId !== callId) continue;
      encerrarSessao(sessao.callId, sessao.peerUserId, true);
      sessoes.delete(k);
    }
    snapshot = {
      ...snapshot,
      guests: [],
      joined: snapshot.joined?.callId === callId ? null : snapshot.joined,
      invite: snapshot.invite?.callId === callId ? null : snapshot.invite,
    };
    emit();
  },

  /** Quem está online para ser convidado (a presença já filtra por aba). */
  operators() {
    return operatorPresence.onlineOperators();
  },

  shutdown(): void {
    for (const sessao of Array.from(sessoes.values())) {
      encerrarSessao(sessao.callId, sessao.peerUserId, true);
    }
    if (inviteChannel) void supabase.removeChannel(inviteChannel);
    inviteChannel = null;
    started = false;
  },
};

/** Identidade desta aba, para o convite saber de onde veio. */
export const bridgeClientId = getWaCallsClientId;
