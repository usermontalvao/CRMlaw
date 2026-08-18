/**
 * Para quem o telefone toca — e em que ordem.
 *
 * O WaCalls avisa TODOS os navegadores conectados quando uma chamada chega —
 * ele não sabe nada de responsável, de canal, de setor nem de escritório. Sem
 * regra, o resultado é o pior dos dois mundos: a recepção inteira toca ao mesmo
 * tempo, três pessoas correm para atender e o cliente conta a história de novo
 * para quem chegou por último.
 *
 * A ordem é uma ESCADA, do mais específico para o mais genérico, e é a mesma
 * hierarquia que a inbox já usa para as mensagens:
 *
 *   1. RESPONSÁVEL DA CONVERSA (`whatsapp_conversations.assigned_user_id`). Se
 *      a conversa foi assumida ou transferida, o dono dela atende — mesmo que o
 *      canal tenha outro padrão. Quem transferiu esperava exatamente isso.
 *   2. DEPARTAMENTO DA CONVERSA (`whatsapp_conversations.department_id`). A
 *      conversa que foi para o setor mas ainda não tem pessoa: toca para o
 *      setor inteiro. Vem antes do canal porque é uma decisão que ALGUÉM tomou
 *      sobre ESTA conversa; o canal é só a porta de entrada.
 *   3. RESPONSÁVEL DO CANAL (`whatsapp_instances.default_assignee_id`). O canal
 *      "Pedro" tem dono; a ligação que entra por ele toca para ele.
 *   4. DEPARTAMENTO(S) DO CANAL (`whatsapp_channel_departments`). O canal sem
 *      dono pessoal costuma ter setor — o padrão (`is_default`) na frente.
 *   5. ADMINISTRAÇÃO. Ninguém em nenhum degrau acima: a ligação é do
 *      escritório, e o escritório tem quem responda por ele.
 *   6. TODOS. O último recurso, que existe para uma verdade simples: nenhuma
 *      regra pode terminar com o telefone sem tocar em lugar nenhum.
 *
 * E quatro regras que existem para a ligação NÃO se perder por causa da regra:
 *
 *   · DISPONIBILIDADE. Um degrau em que ninguém está com o CRM aberto é PULADO
 *     na hora — esperar 15 segundos pela mesa vazia de quem foi ao fórum é
 *     tempo que o cliente passa ouvindo chamar. Presença desconhecida (o canal
 *     de presença ainda não respondeu) trata todo mundo como disponível: na
 *     dúvida, toca.
 *   · ESCALADA. Passados alguns segundos sem ninguém atender, a chamada desce
 *     UM degrau. Estar escalado não significa estar na mesa, e presença não é
 *     prova de atenção.
 *   · QUEM ESTÁ FALANDO NÃO É INTERROMPIDO. Já em outra chamada, o cartão
 *     aparece mas o som não toca — atender a segunda derrubaria a primeira.
 *   · QUEM NÃO É DA VEZ VÊ EM SILÊNCIO. O cartão aparece para todo o escritório
 *     desde o primeiro toque, dizendo para quem está tocando; quem sabe que o
 *     dono saiu pode atender no lugar dele sem esperar a escalada.
 *
 * PURO DE PROPÓSITO: nenhum import de runtime, como em `attendanceRouting`.
 * É o que permite testar a regra com `node --test`. Quem BUSCA os dados da
 * escada é `routingData.ts`; aqui só se decide com eles na mão.
 */

/** De onde saiu o degrau — cada um é uma linha da hierarquia acima. */
export type CallRouteSource =
  | 'assigned'
  | 'conversation-department'
  | 'channel'
  | 'channel-department'
  | 'admin'
  | 'everyone';

/** Um degrau da escada: quem atende, e como o cartão o chama. */
export interface CallDegree {
  source: CallRouteSource;
  /** Quem atende neste degrau. Vazio SÓ no degrau `everyone`. */
  userIds: readonly string[];
  /** "Bruno", "Financeiro", "a administração" — o que o cartão escreve. */
  label: string | null;
}

/** Um setor com a gente dele dentro. */
export interface CallDepartment {
  name: string | null;
  memberIds: readonly string[];
}

export interface CallLadderInput {
  /** Responsável da conversa, se ela tem um. */
  assignedUserId: string | null;
  assignedName?: string | null;
  /** Setor da conversa (para onde ela foi transferida), com os membros. */
  conversationDepartment?: CallDepartment | null;
  /** Responsável padrão do canal por onde a ligação entrou. */
  channelAssigneeId?: string | null;
  channelAssigneeName?: string | null;
  /** Setores ligados ao canal, o padrão na frente. */
  channelDepartments?: readonly CallDepartment[];
  /** Administradores do escritório — o penúltimo degrau. */
  adminIds?: readonly string[];
}

/** O nome de um setor quando o cadastro não deu nome a ele. */
const SETOR_SEM_NOME = 'o setor responsável';
/** Como a administração é chamada no cartão. */
export const ADMIN_LABEL = 'a administração';

const gente = (ids: readonly string[] | undefined): string[] =>
  Array.from(new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && id !== '')));

/**
 * Monta a escada desta chamada, de cima para baixo.
 *
 * Degrau sem ninguém dentro não entra: um setor vazio no cadastro não pode
 * segurar a ligação por 15 segundos antes de ela seguir para quem existe. O
 * último degrau (`everyone`) é sempre acrescentado — é a garantia de que a
 * escada nunca termina no vazio.
 */
export function buildCallLadder(input: CallLadderInput): CallDegree[] {
  const escada: CallDegree[] = [];

  if (input.assignedUserId) {
    escada.push({
      source: 'assigned',
      userIds: [input.assignedUserId],
      label: input.assignedName?.trim() || null,
    });
  }

  const setorDaConversa = gente(input.conversationDepartment?.memberIds);
  if (setorDaConversa.length > 0) {
    escada.push({
      source: 'conversation-department',
      userIds: setorDaConversa,
      label: input.conversationDepartment?.name?.trim() || SETOR_SEM_NOME,
    });
  }

  if (input.channelAssigneeId) {
    escada.push({
      source: 'channel',
      userIds: [input.channelAssigneeId],
      label: input.channelAssigneeName?.trim() || null,
    });
  }

  for (const setor of input.channelDepartments ?? []) {
    const membros = gente(setor?.memberIds);
    if (membros.length === 0) continue;
    escada.push({
      source: 'channel-department',
      userIds: membros,
      label: setor?.name?.trim() || SETOR_SEM_NOME,
    });
  }

  const admins = gente(input.adminIds);
  if (admins.length > 0) {
    escada.push({ source: 'admin', userIds: admins, label: ADMIN_LABEL });
  }

  escada.push({ source: 'everyone', userIds: [], label: null });
  return escada;
}

/**
 * A escada sem os degraus de quem não está com o CRM aberto.
 *
 * `online` nulo é presença DESCONHECIDA (o canal ainda não respondeu, ou o
 * Realtime caiu) — e aí nada é pulado: na dúvida, toca. Pular um degrau por
 * falta de informação seria transformar uma falha de rede em ligação perdida.
 */
export function availableLadder(
  ladder: readonly CallDegree[],
  online: readonly string[] | null,
): CallDegree[] {
  if (!online) return [...ladder];
  const presentes = new Set(online);
  const filtrada = ladder.filter(
    degrau => degrau.source === 'everyone' || degrau.userIds.some(id => presentes.has(id)),
  );
  // O degrau `everyone` sempre sobra do filtro acima, mas a escada pode chegar
  // aqui montada por outro caminho — sem ele, `decideCallRing` não teria degrau
  // nenhum para ler e a chamada não tocaria em lugar nenhum.
  return filtrada.length > 0 ? filtrada : [{ source: 'everyone', userIds: [], label: null }];
}

export interface CallRingInput {
  /** Usuário logado NESTE navegador. */
  me: string | null;
  /** A escada desta chamada (já montada por `buildCallLadder`). */
  ladder: readonly CallDegree[];
  /** Quem está com o CRM aberto agora. Nulo = presença desconhecida. */
  online?: readonly string[] | null;
  /** Quantas escaladas já correram. 0 = ainda no degrau de cima. */
  step?: number;
  /** Contato bloqueado pelo escritório. */
  contactBlocked: boolean;
  /** Este operador já está em outra chamada. */
  imBusy: boolean;
}

export interface CallRoute {
  /** Toca o som neste navegador? */
  ring: boolean;
  /** Mostra o cartão neste navegador? */
  show: boolean;
  /** Frase curta que explica a decisão, mostrada no cartão. */
  label: string;
  /** Degrau da vez — o cartão e o aviso de perdida leem daqui. */
  source: CallRouteSource;
  /** Quem é da vez. Vazio quando a chamada está tocando para todos. */
  targetUserIds: readonly string[];
  /** Ainda há degrau abaixo deste? (é o que decide agendar a escalada) */
  hasNextStep: boolean;
}

/** Quanto tempo a chamada fica em cada degrau antes de descer um. */
export const CALL_ESCALATION_MS = 15_000;

/** Como cada degrau se explica quando NÃO é a sua vez. */
function frasePraOutro(degrau: CallDegree): string {
  const nome = degrau.label?.trim() || 'o responsável';
  switch (degrau.source) {
    case 'assigned': return `Tocando para ${nome} (responsável pela conversa)`;
    case 'channel': return `Tocando para ${nome} (responsável pelo canal)`;
    case 'conversation-department': return `Tocando para ${nome} (setor da conversa)`;
    case 'channel-department': return `Tocando para ${nome} (setor do canal)`;
    case 'admin': return `Tocando para ${nome}`;
    default: return 'Tocando para o escritório';
  }
}

/** Como cada degrau se explica quando É a sua vez. */
function frasePraMim(degrau: CallDegree): string {
  switch (degrau.source) {
    case 'assigned': return 'Você é o responsável por esta conversa';
    case 'channel': return 'Você é o responsável por este canal';
    case 'conversation-department': return `Chamada do setor ${degrau.label ?? ''}`.trim();
    case 'channel-department': return `Chamada do setor ${degrau.label ?? ''}`.trim();
    case 'admin': return 'Sem responsável: a chamada é da administração';
    default: return 'Sem responsável definido — tocando para todos';
  }
}

export function decideCallRing(input: CallRingInput): CallRoute {
  // Contato bloqueado não toca e não aparece: o bloqueio existe justamente
  // para essa pessoa não alcançar o escritório.
  if (input.contactBlocked) {
    return {
      ring: false, show: false, label: 'Contato bloqueado',
      source: 'everyone', targetUserIds: [], hasNextStep: false,
    };
  }

  const escada = availableLadder(input.ladder, input.online ?? null);
  const passo = Math.max(0, Math.min(input.step ?? 0, escada.length - 1));
  const degrau = escada[passo] ?? { source: 'everyone' as const, userIds: [], label: null };
  const hasNextStep = passo < escada.length - 1;
  const paraTodos = degrau.source === 'everyone';

  // A escalada SOMA, não passa adiante: descer um degrau acrescenta gente ao
  // toque, e nunca cala o telefone de quem já estava chamando. O responsável
  // que foi buscar um café não pode deixar de ouvir a própria ligação porque
  // ela já correu quinze segundos.
  const alcancados = escada.slice(0, passo + 1);
  const meuDegrau = input.me
    ? alcancados.find(d => d.userIds.includes(input.me as string)) ?? null
    : null;

  if (meuDegrau || paraTodos) {
    const explica = meuDegrau ?? degrau;
    return {
      ring: !input.imBusy,
      show: true,
      label: input.imBusy
        ? (meuDegrau
          ? 'É a sua chamada — você está em outra agora'
          : 'Sem responsável — você está em outra chamada')
        : frasePraMim(explica),
      source: degrau.source,
      targetUserIds: degrau.userIds,
      hasNextStep,
    };
  }

  return {
    ring: false,
    show: true,
    label: frasePraOutro(degrau),
    source: degrau.source,
    targetUserIds: degrau.userIds,
    hasNextStep,
  };
}

/**
 * QUEM FICA COM A CHAMADA PERDIDA.
 *
 * O aviso que fica na tela segue a MESMA hierarquia do toque, mas parado no
 * primeiro degrau: a perdida é de quem devia ter atendido, e não do escritório
 * inteiro. Um cartão que aparece em cinco telas produz cinco pessoas achando
 * que outra pessoa vai retornar a ligação.
 *
 * A disponibilidade NÃO entra aqui de propósito. Quem estava offline quando o
 * telefone tocou é justamente quem precisa saber que perdeu a chamada ao voltar
 * — e a presença de horas atrás não existe mais para ser consultada.
 *
 * Sem nenhum degrau (nem responsável, nem setor, nem canal, nem admin
 * cadastrado), devolve o degrau `everyone`: aí o aviso é do escritório, como
 * era antes. Ninguém definido nunca pode virar ninguém avisado.
 */
export function missedCallAudience(ladder: readonly CallDegree[]): CallDegree {
  const primeiro = ladder.find(d => d.source !== 'everyone' && d.userIds.length > 0);
  return primeiro ?? { source: 'everyone', userIds: [], label: null };
}

/** Esta chamada perdida é para mim? (a leitura do cartão, em uma linha) */
export function missedCallIsMine(audience: CallDegree, me: string | null): boolean {
  if (audience.source === 'everyone') return true;
  return !!me && audience.userIds.includes(me);
}
