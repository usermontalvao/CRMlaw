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

/**
 * As antecedências oferecidas no painel, em minutos.
 *
 * A escada vai de horas a um mês porque os compromissos do escritório não têm
 * um único ritmo: uma reunião se lembra no mesmo dia, e uma audiência que exige
 * o cliente viajar, juntar documento e faltar ao trabalho se avisa com semanas.
 * Quem só oferecia até "1 semana" obrigava a escolher entre avisar cedo demais
 * ou não avisar.
 */
export const ANTECEDENCIAS_DA_COMUNICACAO = [
  { minutos: 60, rotulo: '1 h' },
  { minutos: 180, rotulo: '3 h' },
  { minutos: 360, rotulo: '6 h' },
  { minutos: 60 * 24, rotulo: '1 dia' },
  { minutos: 60 * 24 * 2, rotulo: '2 dias' },
  { minutos: 60 * 24 * 3, rotulo: '3 dias' },
  { minutos: 60 * 24 * 5, rotulo: '5 dias' },
  { minutos: 60 * 24 * 7, rotulo: '1 semana' },
  { minutos: 60 * 24 * 10, rotulo: '10 dias' },
  { minutos: 60 * 24 * 15, rotulo: '15 dias' },
  { minutos: 60 * 24 * 20, rotulo: '20 dias' },
  { minutos: 60 * 24 * 30, rotulo: '30 dias' },
] as const;

/** O padrão quando ninguém escolhe: um dia antes. */
export const ANTECEDENCIA_PADRAO_MINUTOS = 60 * 24;

/**
 * O texto genérico, para quando o tipo do compromisso não diz nada de útil.
 *
 * É um ponto de partida editável, não um template fixo: cada compromisso tem um
 * recado diferente, e o campo é livre de propósito.
 */
export const MENSAGEM_PADRAO_DA_COMUNICACAO =
  'Bom dia, {primeiro_nome}. Seu compromisso "{titulo}" está marcado para ' +
  '{data} às {hora}. Qualquer dúvida, é só responder por aqui.';

// ── A MENSAGEM SEGUE O CONTEXTO ─────────────────────────────────────────────
//
// "Seu compromisso está marcado" é verdade e não serve para nada. O que o
// cliente precisa saber depende do que ele vai enfrentar: numa audiência
// presencial é o endereço, a antecedência e o documento com foto; numa perícia
// é levar exames; numa reunião online é aguardar o link.
//
// Escrever isso à mão em todo compromisso é o tipo de tarefa que se faz duas
// vezes e depois se abandona — então o texto já nasce certo, e continua
// editável. Quem mexer nele manda o que escreveu; quem não mexer manda algo que
// serve.
//
// A escolha é por TIPO + MODALIDADE. Tipos personalizados (a Agenda permite
// criar) caem no genérico, que é o comportamento correto: não dá para adivinhar
// o recado de um tipo que o escritório inventou ontem.

const PRESENCIAL_COM_LOCAL =
  ' Compareça em {local}. Chegue com 30 minutos de antecedência e leve um ' +
  'documento oficial com foto.';
const PRESENCIAL_SEM_LOCAL =
  ' Chegue com 30 minutos de antecedência e leve um documento oficial com foto.';

/**
 * O texto sugerido para um compromisso, a partir do tipo e da modalidade.
 *
 * `temLocal` decide entre citar o endereço ou omitir a frase inteira: sugerir
 * "Compareça em {local}" com o campo vazio entregaria "Compareça em ." ao
 * cliente — e essa mensagem sai sozinha, sem ninguém reler antes.
 */
export function mensagemSugerida(
  tipo: string | null | undefined,
  modalidade: string | null | undefined,
  temLocal = false,
): string {
  const online = (modalidade || '').toLowerCase() === 'online';
  const presencial = (modalidade || '').toLowerCase() === 'presencial';
  const compareca = temLocal ? PRESENCIAL_COM_LOCAL : PRESENCIAL_SEM_LOCAL;

  switch ((tipo || '').toLowerCase()) {
    case 'hearing':
      if (online) {
        return 'Bom dia, {primeiro_nome}. Sua audiência está marcada para {data} às {hora}, ' +
          'por videoconferência. Enviaremos o link de acesso por aqui antes do horário. ' +
          'Deixe um documento oficial com foto à mão.';
      }
      return 'Bom dia, {primeiro_nome}. Sua audiência está marcada para {data} às {hora}.' +
        (presencial ? compareca : '') +
        ' Qualquer dúvida, é só responder por aqui.';

    case 'pericia':
      if (online) {
        return 'Bom dia, {primeiro_nome}. Sua perícia está marcada para {data} às {hora}, ' +
          'por videoconferência. Enviaremos o link de acesso por aqui antes do horário. ' +
          'Tenha em mãos seus documentos e exames.';
      }
      return 'Bom dia, {primeiro_nome}. Sua perícia está marcada para {data} às {hora}.' +
        (presencial ? compareca : '') +
        ' Leve também seus exames e laudos médicos.';

    case 'meeting':
      if (online) {
        return 'Bom dia, {primeiro_nome}. Nossa reunião está marcada para {data} às {hora}, ' +
          'por videoconferência. Enviaremos o link de acesso por aqui antes do horário.';
      }
      return 'Bom dia, {primeiro_nome}. Nossa reunião está marcada para {data} às {hora}.' +
        (presencial && temLocal ? ' Nós o aguardamos em {local}.' : '') +
        ' Qualquer dúvida, é só responder por aqui.';

    default:
      return MENSAGEM_PADRAO_DA_COMUNICACAO;
  }
}

/** O que `{...}` pode virar no texto. Tudo string — quem não tem, vira vazio. */
export interface CamposDaComunicacao {
  primeiro_nome: string;
  cliente: string;
  titulo: string;
  data: string;
  hora: string;
  /** Onde acontece — a coluna `location`, só nos presenciais. */
  local: string;
  /** O texto de "Observações" do compromisso. */
  detalhes: string;
  /** "presencial" ou "online", quando o compromisso diz. */
  modalidade: string;
  processo: string;
}

// `{local}` nasceu de FORA deste catálogo: até 01/09/2026 a Agenda não tinha
// onde guardar endereço, e a variável teria saído literal. A coluna `location`
// foi criada justamente para isto — um compromisso presencial sem endereço
// esconde a informação de quem mais precisa dela, que é o cliente.

/**
 * O nome como se escreve numa mensagem, não como está no cadastro.
 *
 * O CRM guarda cliente em CAIXA ALTA ("HELEN CRISTINA DE ALMEIDA SILVA") — é a
 * convenção do escritório para as listas e para os documentos. Numa mensagem de
 * WhatsApp isso vira "Bom dia, HELEN.", que se lê como grito.
 *
 * As partículas ficam minúsculas ("Helen Cristina de Almeida Silva"), que é a
 * grafia corrente em português. Nome já escrito em caixa mista é devolvido
 * intacto: quem digitou "McDonald" ou "d'Ávila" sabe melhor que esta função.
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la']);

export function nomeApresentavel(nome: string | null | undefined): string {
  const cru = (nome ?? '').trim();
  if (!cru) return '';
  // Só mexe em quem está TODO em caixa alta (ou toda minúscula). Caixa mista é
  // escolha de quem digitou.
  if (cru !== cru.toUpperCase() && cru !== cru.toLowerCase()) return cru;
  return cru
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((palavra, i) =>
      i > 0 && PARTICULAS.has(palavra)
        ? palavra
        : palavra.charAt(0).toLocaleUpperCase('pt-BR') + palavra.slice(1))
    .join(' ');
}

/** O primeiro nome, já apresentável. É o que abre a mensagem ao cliente. */
export function primeiroNomeApresentavel(nome: string | null | undefined): string {
  const apresentavel = nomeApresentavel(nome);
  return apresentavel ? apresentavel.split(/\s+/)[0] : '';
}

/** As chaves que o editor oferece, para a tela listar sem repetir a mão. */
export const VARIAVEIS_DA_COMUNICACAO: (keyof CamposDaComunicacao)[] = [
  'primeiro_nome', 'cliente', 'titulo', 'data', 'hora', 'local', 'detalhes', 'modalidade', 'processo',
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
