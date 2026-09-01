// ── COMUNICAR O CLIENTE ANTES DO COMPROMISSO ────────────────────────────────
//
// O lembrete de compromisso que já existia avisa QUEM CRIOU o evento. O cliente
// vinculado — que é quem precisa sair de casa, pegar um documento e chegar meia
// hora antes — nunca era avisado de nada. Isto é essa comunicação.
//
// As regras vivem aqui, fora do componente e fora da Edge Function, porque as
// duas pontas precisam da mesma resposta: a tela mostra a prévia do que vai
// sair, e o `notification-scheduler` monta o texto que sai de fato. Divergir é
// o escritório prometer uma coisa na tela e mandar outra no WhatsApp.
//
// ESPELHO: este arquivo é copiado byte a byte para
// `supabase/functions/_shared/comunicacao-compromisso.ts` (Deno não enxerga
// `src/`). O teste `comunicacaoCompromisso.test.ts` reprova se divergirem.

/** As antecedências oferecidas no painel, em minutos. */
export const ANTECEDENCIAS_DA_COMUNICACAO = [
  { minutos: 60, rotulo: '1 h' },
  { minutos: 180, rotulo: '3 h' },
  { minutos: 60 * 24, rotulo: '1 dia' },
  { minutos: 60 * 48, rotulo: '2 dias' },
  { minutos: 60 * 24 * 7, rotulo: '1 semana' },
] as const;

/** O padrão quando ninguém escolhe: um dia antes. */
export const ANTECEDENCIA_PADRAO_MINUTOS = 60 * 24;

/**
 * O texto sugerido ao ligar o interruptor.
 *
 * É um ponto de partida editável, não um template fixo: cada compromisso tem um
 * recado diferente, e o campo é livre de propósito.
 */
export const MENSAGEM_PADRAO_DA_COMUNICACAO =
  'Bom dia, {primeiro_nome}. Seu compromisso "{titulo}" está marcado para ' +
  '{data} às {hora}. Qualquer dúvida, é só responder por aqui.';

/** O que `{...}` pode virar no texto. Tudo string — quem não tem, vira vazio. */
export interface CamposDaComunicacao {
  primeiro_nome: string;
  cliente: string;
  titulo: string;
  data: string;
  hora: string;
  /** O texto de "Detalhes" do compromisso — é ali que se escreve o endereço. */
  detalhes: string;
  /** "presencial" ou "online", quando o compromisso diz. */
  modalidade: string;
  processo: string;
}

// NÃO existe `{local}`: a Agenda não tem campo de endereço, e oferecer a
// variável faria a mensagem sair com "na " e nada depois. Quem precisa do
// endereço escreve em Detalhes e usa `{detalhes}`.

/** As chaves que o editor oferece, para a tela listar sem repetir a mão. */
export const VARIAVEIS_DA_COMUNICACAO: (keyof CamposDaComunicacao)[] = [
  'primeiro_nome', 'cliente', 'titulo', 'data', 'hora', 'detalhes', 'modalidade', 'processo',
];

/**
 * Troca `{chave}` pelo valor. Tolera espaço dentro das chaves (`{ data }`),
 * porque quem digita à mão põe espaço.
 *
 * Variável DESCONHECIDA fica literal, à vista. O contrário — apagar em silêncio
 * o que não reconhece — produziria "Seu compromisso está marcado para  às ", e
 * a advogada só descobriria o erro pela reclamação do cliente.
 */
export function montarMensagemDaComunicacao(
  modelo: string,
  campos: Partial<CamposDaComunicacao>,
): string {
  return (modelo || '').replace(/\{\s*([a-z_]+)\s*\}/gi, (literal, chave: string) => {
    const valor = (campos as Record<string, string | undefined>)[chave.toLowerCase()];
    return valor === undefined ? literal : valor;
  });
}

/**
 * A hora em que a comunicação deve sair: o começo do compromisso menos a
 * antecedência.
 */
export function momentoDoEnvio(inicio: Date, minutosAntes: number): Date {
  return new Date(inicio.getTime() - minutosAntes * 60_000);
}

/** Por que uma comunicação não sai agora — ou `null` quando ela deve sair. */
export type MotivoDeNaoEnviar =
  | 'desligada'
  | 'ja_enviada'
  | 'sem_cliente'
  | 'sem_mensagem'
  | 'ainda_cedo'
  | 'compromisso_passou';

export interface ComunicacaoAgendada {
  ligada: boolean;
  enviadaEm: string | Date | null | undefined;
  clienteId: string | null | undefined;
  mensagem: string | null | undefined;
  inicio: string | Date;
  minutosAntes: number | null | undefined;
}

/**
 * A comunicação deve sair NESTA execução do cron?
 *
 * Devolve `null` para "sim, manda", e o motivo quando não. Motivo em vez de
 * booleano porque o log do cron precisa dizer por que pulou — "0 enviadas" sem
 * explicação é o tipo de silêncio que escondeu o aviso de prazo por meses.
 *
 * A porta de trás importa: um compromisso que JÁ COMEÇOU não recebe mais nada.
 * O cron roda de hora em hora, e sem esta trava um evento marcado para as 14h
 * com "avisar 1h antes" que passou despercebido às 13h dispararia às 15h — um
 * lembrete para uma audiência que já aconteceu, que é pior que lembrete nenhum.
 */
export function motivoDeNaoEnviar(
  c: ComunicacaoAgendada,
  agora: Date = new Date(),
): MotivoDeNaoEnviar | null {
  if (!c.ligada) return 'desligada';
  if (c.enviadaEm) return 'ja_enviada';
  if (!c.clienteId) return 'sem_cliente';
  if (!(c.mensagem || '').trim()) return 'sem_mensagem';

  const inicio = c.inicio instanceof Date ? c.inicio : new Date(c.inicio);
  if (Number.isNaN(inicio.getTime())) return 'compromisso_passou';
  if (inicio.getTime() <= agora.getTime()) return 'compromisso_passou';

  const minutos = Number(c.minutosAntes);
  const antes = Number.isFinite(minutos) && minutos > 0 ? minutos : ANTECEDENCIA_PADRAO_MINUTOS;
  if (agora.getTime() < momentoDoEnvio(inicio, antes).getTime()) return 'ainda_cedo';

  return null;
}
