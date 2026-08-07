/**
 * "Recarregue a lista quando o banco avisar" — para o e-mail e para as petições.
 *
 * Os dois módulos querem a mesma coisa: um canal privado de broadcast que só
 * toca a campainha, e uma recarga por HTTP agrupada. É o mesmo desenho do
 * WhatsApp (`src/services/whatsapp/messageEvents.ts`), com uma diferença: lá o
 * evento carrega campos e há fan-out para vários ouvintes; aqui o payload é
 * jogado fora e quem recarrega é um só.
 *
 * Não existe mais rede de `postgres_changes` por baixo. `email_messages` e
 * `saved_petitions` saíram da publicação `supabase_realtime` (migration
 * `realtime_drop_email_and_petitions`): um canal de `postgres_changes` sobre elas
 * hoje não receberia evento nenhum. O que repõe o que o socket perde é a própria
 * recarga da tela — a lista é relida inteira, não remendada.
 *
 * As duas regras que sustentam o canal privado moram em módulos puros, testáveis
 * sem rede: a política de conexão em `broadcastGate.ts` (token antes do canal,
 * canal em erro removido na hora, tentativas com fim) e a janela de recarga em
 * `broadcastReload.ts`.
 */
import { supabase } from '../config/supabase';
import { criarPortaoBroadcast, type PortaoBroadcast } from './broadcastGate';
import { criarRecargaAgrupada } from './broadcastReload';

type Canal = ReturnType<typeof supabase.channel>;

export interface OpcoesRecargaPorBroadcast {
  /** Aparece no log: `Email`, `Petitions`. */
  escopo: string;
  /**
   * Tópico do broadcast. Precisa bater com o gatilho no banco e estar liberado
   * pela policy de `realtime.messages` — as duas só aceitam equipe interna ATIVA
   * (`public.is_active_office_staff()`), então o Portal do Cliente assina e não
   * recebe nada.
   */
  topico: 'email:changes' | 'petitions:changes';
  /** Janela de agrupamento da recarga, em ms. */
  atrasoMs: number;
  recarregar: () => void;
}

/**
 * Liga o canal e devolve o cleanup. O cleanup cancela a janela pendente, remove
 * o canal e solta o ouvinte de sessão.
 */
export function ligarRecargaPorBroadcast(opcoes: OpcoesRecargaPorBroadcast): () => void {
  const marca = `[Jurius Realtime][${opcoes.escopo}]`;

  const recarga = criarRecargaAgrupada({
    escopo: opcoes.escopo,
    atrasoMs: opcoes.atrasoMs,
    recarregar: opcoes.recarregar,
  });

  const portao: PortaoBroadcast = criarPortaoBroadcast<Canal>({
    marca,

    lerToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },

    // O token precisa estar no RealtimeClient ANTES de `channel()`: o
    // `subscribe()` lê `accessTokenValue` de forma síncrona ao montar o join, e
    // o que não estiver lá nessa hora vira um join `anon` — negado pela policy.
    aplicarToken: (token) => supabase.realtime.setAuth(token),

    abrirBroadcast: (aoStatus) =>
      supabase
        .channel(opcoes.topico, { config: { private: true } })
        .on('broadcast', { event: 'changed' }, () => recarga.aoEvento())
        .subscribe(aoStatus),

    // Só este canal. `removeAllChannels()` derrubaria os do WhatsApp, da agenda
    // e da nuvem junto.
    remover: (canal) => {
      void supabase.removeChannel(canal);
    },

    agendar: (fn, ms) => window.setTimeout(fn, ms),
    cancelar: (id) => window.clearTimeout(id as number),
  });

  // Sem isto, um `RETRY_ABORTED` seria definitivo até o próximo F5: é o login (ou
  // a renovação do token) que muda a resposta da policy. Nada de consulta aqui
  // dentro — o callback do supabase-js roda dentro do lock de auth, e um
  // `getSession()` daqui reentraria nele.
  const { data } = supabase.auth.onAuthStateChange((evento) => {
    portao.aoEventoDeSessao(evento);
  });

  portao.iniciar();

  return () => {
    data.subscription.unsubscribe();
    portao.encerrar();
    recarga.encerrar();
  };
}
