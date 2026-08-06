/**
 * Casamento entre prazo cadastrado e intimação.
 *
 * O vínculo forte é `deadlines.intimation_id`, e ele só é gravado quando o prazo
 * nasce pelo botão "Prazo" de dentro do card da intimação. Só que quase todo
 * prazo do escritório é cadastrado pelo módulo de Prazos, onde esse campo fica
 * nulo — e o Guardião, que só sabia olhar para ele, passou a anunciar "nenhum
 * prazo cadastrado" para intimações que JÁ tinham prazo. O alarme falso empurrava
 * o operador para "Marcar como lida sem prazo", que é exatamente o botão que o
 * guardião existe para evitar.
 *
 * Aqui reconhecemos o prazo pelo que ele tem de concreto: mesma âncora (processo
 * ou cliente) e vencimento numa janela plausível.
 *
 * ÂNCORA — por que não é só processo:
 * Ancorar só em `process_id` cobre pouco, porque no escritório o cadastro é
 * centrado no CLIENTE, não no processo: 287 dos 413 prazos têm só `client_id`, e
 * 163 das 837 intimações não têm processo — às vezes porque o processo sequer
 * existe na tabela `processes`. Então: havendo processo dos dois lados, ele manda
 * (processos diferentes é "não" definitivo); faltando de um lado, vale o cliente.
 * E quando a intimação não tem âncora nenhuma, `resolverAncora` empresta a das
 * irmãs de mesmo número de processo.
 *
 * JANELA — por que não filtramos por data de cadastro:
 * A versão anterior exigia que o prazo tivesse sido cadastrado depois de a
 * intimação sair. Isso quebrava no caso mais comum de todos: a MESMA decisão
 * publicada duas vezes (destinatários diferentes, ou republicação). O prazo é
 * cadastrado na primeira publicação, e a segunda chegava "sem prazo". O
 * vencimento cair depois da disponibilização já garante que o prazo estava vivo
 * quando a intimação saiu; é disso que precisamos.
 *
 * Isto é um vínculo FRACO, e de propósito: casar não grava nada. Na tela, serve
 * para perguntar ao operador "é este prazo?" — quem decide é ele, e é por isso
 * que a regra pode ser generosa. No cron, serve para silenciar o alerta; se
 * silenciar errado, a trava da tela ainda pega o caso na hora de marcar como
 * lida.
 *
 * Sem imports: o módulo é puro para o ts-node do `npm test` carregá-lo sem
 * arrastar a cadeia de imports do serviço.
 *
 * ATENÇÃO: `supabase/functions/deadline-guard/index.ts` espelha estas mesmas
 * regras (o Deno não enxerga `src/`). Mexeu aqui, mexa lá.
 */

const DIA_MS = 86400000;

/**
 * Folga entre a estimativa da IA e o vencimento cadastrado à mão.
 *
 * A estimativa da IA erra sistematicamente para MENOS: conta dias corridos, e
 * sobre a disponibilização em vez da publicação. Num prazo de 30 dias a conta
 * certa (dias úteis, a partir do início da contagem) cai ~14 dias depois. 21
 * dias cobrem esse atraso com folga, inclusive com feriado no meio.
 */
export const DIAS_FOLGA_ESTIMATIVA = 21;

/**
 * Teto quando não há estimativa da IA para ancorar a janela.
 *
 * Sem estimativa só sobram âncora e data. Noventa dias pegam qualquer prazo
 * processual e ainda descartam o que claramente é outra coisa — prescrição,
 * controle de arquivamento, agenda de longo prazo.
 */
export const DIAS_JANELA_SEM_ESTIMATIVA = 90;

export type AncoraCasamento = 'processo' | 'cliente';

export interface PrazoCandidato {
  id: string;
  process_id?: string | null;
  client_id?: string | null;
  intimation_id?: string | null;
  status?: string | null;
  due_date: string;
}

export interface IntimacaoParaCasar {
  id: string;
  process_id?: string | null;
  client_id?: string | null;
  data_disponibilizacao?: string | null;
  /** `intimation_ai_analysis.deadline_due_date` — a estimativa da IA, se houver. */
  estimativaVencimento?: string | null;
}

/** O mínimo para emprestar âncora entre intimações do mesmo número de processo. */
export interface IntimacaoAncoravel {
  numero_processo?: string | null;
  process_id?: string | null;
  client_id?: string | null;
}

/**
 * Âncora da intimação, tomando emprestado das irmãs quando ela não tem nenhuma.
 *
 * Uma parte das intimações chega sem processo E sem cliente — a vinculação
 * automática da sincronização não pegou, às vezes porque o processo nem existe
 * na tabela `processes`. Sem âncora nenhuma, o Guardião não tem como achar o
 * prazo, e cobra prazo que existe.
 *
 * Mas o número do processo está sempre lá, e a MESMA decisão costuma ser
 * publicada mais de uma vez. Se qualquer intimação do mesmo número já foi
 * vinculada, a âncora dela vale para esta: mesmo número de processo é o mesmo
 * processo, por definição.
 *
 * O que a intimação já tem sempre manda; as irmãs só preenchem o que falta.
 */
export function resolverAncora(
  intimacao: IntimacaoAncoravel,
  irmas: readonly IntimacaoAncoravel[],
): { process_id: string | null; client_id: string | null } {
  let processId = intimacao.process_id ?? null;
  let clientId = intimacao.client_id ?? null;
  if (processId && clientId) return { process_id: processId, client_id: clientId };

  const numero = intimacao.numero_processo;
  if (!numero) return { process_id: processId, client_id: clientId };

  for (const irma of irmas) {
    if (irma.numero_processo !== numero) continue;
    processId = processId ?? irma.process_id ?? null;
    clientId = clientId ?? irma.client_id ?? null;
    if (processId && clientId) break;
  }

  return { process_id: processId, client_id: clientId };
}

function paraMs(valor?: string | null): number | null {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Janela de vencimento em que um prazo desta intimação pode cair.
 *
 * Devolve `null` quando a intimação não tem data — sem âncora temporal não há
 * casamento possível, e é melhor não casar do que casar errado.
 */
export function janelaDeVencimento(
  intimacao: IntimacaoParaCasar,
): { inicioMs: number; fimMs: number } | null {
  const disponibilizacaoMs = paraMs(intimacao.data_disponibilizacao);
  if (disponibilizacaoMs === null) return null;

  const estimativaMs = paraMs(intimacao.estimativaVencimento);
  const fimMs =
    estimativaMs === null
      ? disponibilizacaoMs + DIAS_JANELA_SEM_ESTIMATIVA * DIA_MS
      : estimativaMs + DIAS_FOLGA_ESTIMATIVA * DIA_MS;

  return { inicioMs: disponibilizacaoMs, fimMs };
}

/**
 * Por onde prazo e intimação se ligam — ou `null` se não se ligam.
 *
 * Processo manda quando os dois lados têm processo: processos diferentes são um
 * "não" definitivo, que o cliente em comum não derruba. Cliente é o plano B para
 * quando falta processo de um dos lados, que é a maioria dos casos.
 */
export function ancoraDoCasamento(
  prazo: PrazoCandidato,
  intimacao: IntimacaoParaCasar,
): AncoraCasamento | null {
  if (prazo.process_id && intimacao.process_id) {
    return prazo.process_id === intimacao.process_id ? 'processo' : null;
  }
  if (prazo.client_id && intimacao.client_id && prazo.client_id === intimacao.client_id) {
    return 'cliente';
  }
  return null;
}

/**
 * O prazo pode ser o desta intimação? Devolve a âncora que o ligou, ou `null`.
 *
 * Prazo já vinculado a OUTRA intimação não conta: ele tem dono. Prazo cancelado
 * também não — cancelar é justamente dizer que aquele controle não vale mais.
 */
export function casamentoDePrazo(
  prazo: PrazoCandidato,
  intimacao: IntimacaoParaCasar,
): AncoraCasamento | null {
  if (prazo.intimation_id && prazo.intimation_id !== intimacao.id) return null;
  if (prazo.status === 'cancelado') return null;

  const ancora = ancoraDoCasamento(prazo, intimacao);
  if (!ancora) return null;

  const janela = janelaDeVencimento(intimacao);
  if (!janela) return null;

  const vencimentoMs = paraMs(prazo.due_date);
  if (vencimentoMs === null) return null;
  if (vencimentoMs < janela.inicioMs || vencimentoMs > janela.fimMs) return null;

  return ancora;
}

export function prazoCasaComIntimacao(
  prazo: PrazoCandidato,
  intimacao: IntimacaoParaCasar,
): boolean {
  return casamentoDePrazo(prazo, intimacao) !== null;
}

/**
 * Entre os candidatos, o mais provável: primeiro os ligados pelo processo, que é
 * a âncora forte; depois o que vence mais perto da estimativa da IA. Empate
 * resolve pelo id, para a escolha não depender da ordem em que o banco devolveu
 * as linhas.
 */
export function escolherMelhorCandidato<T extends PrazoCandidato>(
  prazos: readonly T[],
  intimacao: IntimacaoParaCasar,
): { prazo: T; ancora: AncoraCasamento } | null {
  const candidatos: { prazo: T; ancora: AncoraCasamento }[] = [];
  for (const prazo of prazos) {
    const ancora = casamentoDePrazo(prazo, intimacao);
    if (ancora) candidatos.push({ prazo, ancora });
  }
  if (candidatos.length === 0) return null;

  const alvoMs =
    paraMs(intimacao.estimativaVencimento) ?? paraMs(intimacao.data_disponibilizacao) ?? 0;
  const distancia = (item: { prazo: T }) => Math.abs((paraMs(item.prazo.due_date) ?? 0) - alvoMs);

  return candidatos.reduce((melhor, atual) => {
    if (atual.ancora !== melhor.ancora) return atual.ancora === 'processo' ? atual : melhor;
    const dAtual = distancia(atual);
    const dMelhor = distancia(melhor);
    if (dAtual !== dMelhor) return dAtual < dMelhor ? atual : melhor;
    return atual.prazo.id < melhor.prazo.id ? atual : melhor;
  });
}
