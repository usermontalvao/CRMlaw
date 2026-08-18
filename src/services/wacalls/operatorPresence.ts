// QUEM ESTÁ NA MESA AGORA — a presença dos atendentes.
//
// A hierarquia de atendimento (ver `callRouting`) precisa de um sinal que o CRM
// não tinha: saber que o responsável pela conversa está com o sistema aberto.
// Sem ele, a regra "toca primeiro para o dono" vira "o cliente ouve quinze
// segundos de chamada enquanto o dono está no fórum" toda vez que o dono não
// está — e a hierarquia, que existe para organizar, passa a atrasar.
//
// A presença serve a três coisas, e é a MESMA em todas:
//
//  1. PULAR o degrau em que ninguém está online (o toque desce na hora).
//  2. TRANSFERIR a ligação só para quem pode atendê-la agora — transferir para
//     uma mesa vazia é desligar na cara do cliente com passos extras.
//  3. CHAMAR um segundo atendente para a ligação, pela mesma lista.
//
// O que NÃO se pede a ela: certeza. Aba aberta não é pessoa na cadeira, e é por
// isso que a escalada por tempo continua existindo por cima disto. Presença
// desconhecida (canal ainda ligando, Realtime fora) é tratada como "todo mundo
// disponível" por quem lê — na dúvida, o telefone toca.
import { supabase } from '../../config/supabase';
import { criarControleDePresenca } from '../realtime/presenceTrack';
import { getWaCallsClientId, waCallsLog } from './config';
import type { RealtimeChannel } from '@supabase/supabase-js';

/** Um atendente visto pelo canal de presença. */
export interface OperatorPresence {
  userId: string;
  name: string | null;
  /** Aba/navegador (o mesmo id que o WaCalls usa como dono da chamada). */
  clientId: string;
  /** Está em ligação neste instante? */
  busy: boolean;
}

const CHANNEL_NAME = 'wa:operators';

const listeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;
/** `null` enquanto o canal não respondeu: presença DESCONHECIDA, não vazia. */
let presentes: OperatorPresence[] | null = null;
let eu: { userId: string; name: string | null } | null = null;
let ocupado = false;
let started = false;

const controle = criarControleDePresenca<Record<string, unknown>>({
  enviar: payload => { void channel?.track(payload); },
  marca: '[Jurius Realtime][Presence][WaCalls]',
});

function emit(): void {
  listeners.forEach(fn => fn());
}

/** Lê o estado do canal e o transforma na lista que as regras consomem. */
function sync(): void {
  if (!channel) return;
  const state = channel.presenceState<Record<string, unknown>>();
  const lista: OperatorPresence[] = [];
  for (const entradas of Object.values(state)) {
    for (const entrada of entradas as Array<Record<string, unknown>>) {
      const userId = typeof entrada.userId === 'string' ? entrada.userId : '';
      if (!userId) continue;
      lista.push({
        userId,
        name: typeof entrada.name === 'string' ? entrada.name : null,
        clientId: typeof entrada.clientId === 'string' ? entrada.clientId : '',
        busy: entrada.busy === true,
      });
    }
  }
  presentes = lista;
  emit();
}

function publicar(): void {
  if (!eu) return;
  controle.publicar({ userId: eu.userId, name: eu.name, clientId: getWaCallsClientId(), busy: ocupado });
}

export const operatorPresence = {
  /** Liga o canal. Idempotente — várias telas podem chamar. */
  init(): void {
    if (started || typeof window === 'undefined') return;
    started = true;

    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) { started = false; return; }
        const { data: perfil } = await supabase
          .from('profiles').select('name').eq('user_id', user.id).maybeSingle();
        eu = { userId: user.id, name: (perfil as { name: string | null } | null)?.name ?? null };
      } catch {
        // Sem perfil, a presença ainda vale: o que a regra lê é o id.
        const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as never));
        if (!data?.user) { started = false; return; }
        eu = { userId: data.user.id, name: null };
      }

      // A chave é a ABA, não o usuário: quem trabalha com o CRM aberto em duas
      // janelas continua sendo uma pessoa só na leitura das regras, mas cada
      // aba precisa aparecer para a transferência saber para onde mandar.
      const criado = supabase.channel(CHANNEL_NAME, {
        config: { presence: { key: getWaCallsClientId() } },
      });
      channel = criado;
      criado
        .on('presence', { event: 'sync' }, sync)
        .on('presence', { event: 'join' }, sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            controle.esquecer();
            publicar();
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Presença desconhecida de novo: melhor "não sei" do que uma lista
            // velha dizendo que o colega está online quando o canal caiu.
            presentes = null;
            controle.esquecer();
            waCallsLog('presença de atendentes indisponível', { status });
            emit();
          }
        });
    })();
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  /** Todos os atendentes online. `null` = ainda não se sabe. */
  online(): OperatorPresence[] | null {
    return presentes;
  },

  /** Só os ids, do jeito que a regra de roteamento pede. */
  onlineUserIds(): string[] | null {
    if (!presentes) return null;
    return Array.from(new Set(presentes.map(p => p.userId)));
  },

  /** Uma linha por PESSOA (não por aba), para as listas da tela. */
  onlineOperators(): OperatorPresence[] {
    const porUsuario = new Map<string, OperatorPresence>();
    for (const p of presentes ?? []) {
      const atual = porUsuario.get(p.userId);
      // Entre duas abas da mesma pessoa, a que está em ligação manda: é a
      // informação que muda a decisão de quem vai transferir.
      if (!atual || (p.busy && !atual.busy)) porUsuario.set(p.userId, p);
    }
    return Array.from(porUsuario.values());
  },

  /** Este operador está em ligação? (o estado sobe na presença) */
  setBusy(busy: boolean): void {
    if (ocupado === busy) return;
    ocupado = busy;
    publicar();
  },

  /** Quem sou eu, para as regras compararem sem outra ida ao servidor. */
  meUserId(): string | null {
    return eu?.userId ?? null;
  },

  shutdown(): void {
    controle.encerrar();
    if (channel) {
      void channel.untrack();
      void supabase.removeChannel(channel);
    }
    channel = null;
    presentes = null;
    started = false;
  },
};
