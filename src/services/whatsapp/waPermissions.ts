/**
 * O que ESTA pessoa pode fazer NESTE atendimento — a versão do navegador.
 *
 * ── ISTO NÃO É A TRAVA ─────────────────────────────────────────────────────
 *
 * A trava é do banco: `wa_can_see_conv`, `wa_can_manage_conv`,
 * `wa_can_reply_conv`, `wa_can_transfer_conv` e `wa_can_accept_transfer`
 * decidem antes de a consulta responder e antes de a RPC executar. Nada aqui
 * protege coisa alguma — esconder um botão não impede um POST.
 *
 * Este módulo existe para o outro lado do problema: mostrar um botão que só vai
 * responder 403 é pior do que não mostrar. O atendente clica, lê um erro que
 * não explica nada, e conclui que o sistema está quebrado. "Não posso" tem de
 * ser visível ANTES do clique — e é isso que se calcula aqui.
 *
 * As regras são as MESMAS das funções do banco, escritas de novo. Duplicação
 * proposital e vigiada por teste: quando uma das duas mudar, o teste que
 * compara os casos-limite é o que avisa. Cada função abaixo diz de qual função
 * SQL ela é o espelho.
 *
 * SEM IMPORTS de propósito — nem de tipo. É o que deixa o `node --test`
 * carregar o módulo sem arrastar a cadeia do cliente Supabase (ver a nota em
 * `canaisPermitidos.ts`).
 */

// ── Quem sou eu, e onde ─────────────────────────────────────────────────────

/**
 * O escopo do usuário atual, montado a partir de `whatsapp_channel_members` e
 * `whatsapp_department_members` (as duas ganharam a coluna `role`).
 */
export interface WaEscopo {
  userId: string | null;
  /** Administrador ATIVO: acesso global, com auditoria de toda intervenção. */
  isAdmin: boolean;
  /** Canais em que sou supervisor. */
  canaisSupervisionados: readonly string[];
  /** Setores em que sou supervisor. */
  setoresSupervisionados: readonly string[];
  /** Canais em que atendo (inclui os supervisionados). */
  canaisMembro: readonly string[];
  /** Setores a que pertenço (inclui os supervisionados). */
  setoresMembro: readonly string[];
  /**
   * O escopo já foi carregado? Enquanto for `false`, NADA é decidido como
   * "não pode" — a tela mostra "carregando", que é diferente de "sem permissão"
   * e mais diferente ainda de "sem canais". Ver `estadoDoEscopo`.
   */
  carregado: boolean;
}

export const ESCOPO_VAZIO: WaEscopo = {
  userId: null,
  isAdmin: false,
  canaisSupervisionados: [],
  setoresSupervisionados: [],
  canaisMembro: [],
  setoresMembro: [],
  carregado: false,
};

/** O recorte da conversa de que as regras precisam. */
export interface WaConversaResumo {
  id: string;
  instanceId: string | null;
  departmentId: string | null;
  assignedUserId: string | null;
  /** 'open' | 'pending' | 'closed' */
  status: string;
  awaitingAccept?: boolean | null;
  /** O canal é `visibility_mode = 'all'`. */
  canalAberto?: boolean;
  /** O setor tem membros cadastrados (setor vazio não filtra ninguém). */
  setorTemMembros?: boolean;
  /** Tenho empréstimo vigente desta conversa (colaborador temporário). */
  souColaborador?: boolean;
  /** Há transferência pendente desta conversa endereçada a mim (ou ao meu setor). */
  transferenciaPendenteParaMim?: boolean;
  /** Eu transferi e ainda está pendente — continuo respondendo por ela. */
  transferenciaPendenteMinha?: boolean;
}

// ── As três perguntas de escopo ─────────────────────────────────────────────

const contem = (lista: readonly string[], valor: string | null): boolean =>
  !!valor && lista.includes(valor);

/** Espelho de `wa_is_supervisor_of_channel`. */
export function supervisionaCanal(escopo: WaEscopo, canalId: string | null): boolean {
  return escopo.isAdmin || contem(escopo.canaisSupervisionados, canalId);
}

/** Espelho de `wa_supervises_department`. */
export function supervisionaSetor(escopo: WaEscopo, setorId: string | null): boolean {
  return escopo.isAdmin || contem(escopo.setoresSupervisionados, setorId);
}

/** Supervisiono alguma coisa? Decide se o "Modo supervisão" existe para mim. */
export function supervisionaAlgo(escopo: WaEscopo): boolean {
  return escopo.isAdmin
    || escopo.canaisSupervisionados.length > 0
    || escopo.setoresSupervisionados.length > 0;
}

// ── Ver, comandar, responder ────────────────────────────────────────────────

/** Espelho de `wa_can_see_conv`. */
export function podeVer(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!escopo.carregado) return true;         // ainda não sei — não escondo nada
  if (escopo.isAdmin) return true;
  if (escopo.userId && c.assignedUserId === escopo.userId) return true;
  if (supervisionaCanal(escopo, c.instanceId)) return true;
  if (supervisionaSetor(escopo, c.departmentId)) return true;
  if (c.transferenciaPendenteParaMim) return true;
  if (c.transferenciaPendenteMinha) return true;
  if (c.souColaborador) return true;

  const passaCanal = c.instanceId === null
    || c.canalAberto === true
    || contem(escopo.canaisMembro, c.instanceId);
  const passaSetor = c.departmentId === null
    || c.setorTemMembros === false
    || contem(escopo.setoresMembro, c.departmentId);
  return passaCanal && passaSetor;
}

/**
 * Espelho de `wa_can_manage_conv` — mexer no ATENDIMENTO (responsável, fila,
 * leitura, encerramento).
 *
 * A linha que separa este do `podeVer` é a razão de o "apenas acompanhar"
 * existir: o supervisor de OUTRO canal não entra aqui, e o colaborador
 * temporário também não — ele foi chamado para ajudar num caso, não para
 * responder pelo caso.
 */
export function podeComandar(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!escopo.carregado) return false;        // no comando, a dúvida fecha
  if (escopo.isAdmin) return true;
  if (escopo.userId && c.assignedUserId === escopo.userId) return true;
  if (supervisionaCanal(escopo, c.instanceId)) return true;
  if (supervisionaSetor(escopo, c.departmentId)) return true;
  // Conversa sem dono é da fila: quem a enxerga pode assumi-la.
  if (c.assignedUserId === null && podeVer(escopo, c)) return true;
  return false;
}

/** Espelho de `wa_can_reply_conv`. O colaborador temporário responde. */
export function podeResponder(escopo: WaEscopo, c: WaConversaResumo): boolean {
  return podeComandar(escopo, c) || c.souColaborador === true;
}

/** Espelho de `wa_can_transfer_conv`. */
export function podeTransferir(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!escopo.carregado) return false;
  if (escopo.isAdmin) return true;
  if (supervisionaCanal(escopo, c.instanceId)) return true;
  if (supervisionaSetor(escopo, c.departmentId)) return true;
  if (escopo.userId && c.assignedUserId === escopo.userId) return true;
  if (c.assignedUserId === null && podeComandar(escopo, c)) return true;
  return false;
}

/**
 * Redistribuir (atribuir a terceiro sem aceite) é ato de supervisor — com a
 * exceção nomeada de entregar o que já é seu, que é o que a transferência
 * dentro da ligação faz. Espelho da regra de `wa_assign_contact_attendance`.
 */
export function podeRedistribuir(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!escopo.carregado) return false;
  if (escopo.isAdmin) return true;
  if (supervisionaCanal(escopo, c.instanceId)) return true;
  if (supervisionaSetor(escopo, c.departmentId)) return true;
  // O próprio atendimento (ou um sem dono que eu poderia assumir).
  const meu = !!escopo.userId && c.assignedUserId === escopo.userId;
  return (meu || c.assignedUserId === null) && podeComandar(escopo, c);
}

/**
 * Tomar a conversa de outra pessoa. Assumir o que está na fila é rotina;
 * tomar o que tem dono é intervenção, e só supervisor do canal/setor faz.
 */
export function podeAssumir(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!podeComandar(escopo, c)) return false;
  if (!escopo.userId) return false;
  if (c.assignedUserId === escopo.userId && !c.awaitingAccept) return false; // já é minha
  if (c.assignedUserId === null) return true;
  return escopo.isAdmin
    || supervisionaCanal(escopo, c.instanceId)
    || supervisionaSetor(escopo, c.departmentId);
}

/** Espelho de `wa_can_accept_transfer` no que a tela consegue saber. */
export function podeAceitar(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!escopo.carregado) return false;
  return c.transferenciaPendenteParaMim === true || (escopo.isAdmin && !!c.awaitingAccept);
}

/** Cancelar a transferência que eu mesmo mandei (ou como supervisor do canal). */
export function podeCancelarTransferencia(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!escopo.carregado) return false;
  return c.transferenciaPendenteMinha === true
    || escopo.isAdmin
    || supervisionaCanal(escopo, c.instanceId)
    || supervisionaSetor(escopo, c.departmentId);
}

// ── Modo supervisão ─────────────────────────────────────────────────────────

/**
 * Os quatro modos. `acompanhar` é o padrão de quem entra numa conversa que não
 * é dele: sem ele, olhar já mexia — abrir zerava o contador de não lidas do
 * responsável, e a pendência sumia da tela de quem tinha de agir.
 */
export type WaModoSupervisao = 'acompanhar' | 'responder' | 'assumir' | 'redistribuir';

export const MODOS_SUPERVISAO: readonly WaModoSupervisao[] =
  ['acompanhar', 'responder', 'assumir', 'redistribuir'];

export const ROTULO_MODO: Record<WaModoSupervisao, string> = {
  acompanhar: 'Apenas acompanhar',
  responder: 'Responder sem assumir',
  assumir: 'Assumir atendimento',
  redistribuir: 'Redistribuir',
};

export const EXPLICACAO_MODO: Record<WaModoSupervisao, string> = {
  acompanhar: 'Você lê e não muda nada: nem responsável, nem leitura, nem fila, nem SLA.',
  responder: 'Sua mensagem sai identificada como sua, e o responsável continua sendo quem já era.',
  assumir: 'O atendimento passa para o seu nome. Fica registrado que foi uma intervenção.',
  redistribuir: 'Você escolhe quem passa a responder por este atendimento.',
};

/**
 * Estou olhando esta conversa como supervisor (e não como dono nem como fila)?
 * É o que decide se o Modo supervisão aparece — e se o padrão é "acompanhar".
 */
export function estouSupervisionando(escopo: WaEscopo, c: WaConversaResumo): boolean {
  if (!escopo.carregado || !escopo.userId) return false;
  if (c.assignedUserId === escopo.userId) return false;   // é minha, não é supervisão
  if (c.souColaborador) return false;                     // fui chamado, não supervisiono
  if (c.transferenciaPendenteParaMim) return false;       // sou o destino, é handoff
  if (c.assignedUserId === null) return false;            // fila é fila
  return escopo.isAdmin
    || supervisionaCanal(escopo, c.instanceId)
    || supervisionaSetor(escopo, c.departmentId);
}

export function modosDisponiveis(escopo: WaEscopo, c: WaConversaResumo): WaModoSupervisao[] {
  if (!estouSupervisionando(escopo, c)) return [];
  const modos: WaModoSupervisao[] = ['acompanhar'];
  if (podeResponder(escopo, c)) modos.push('responder');
  if (podeAssumir(escopo, c)) modos.push('assumir');
  if (podeRedistribuir(escopo, c)) modos.push('redistribuir');
  return modos;
}

// ── O que o modo bloqueia ───────────────────────────────────────────────────

export type WaAcao =
  | 'responder' | 'assumir' | 'redistribuir' | 'transferir' | 'aceitar'
  | 'marcarLida' | 'marcarNaoLida' | 'devolverFila' | 'encerrar' | 'reabrir'
  | 'bloquear' | 'agendar' | 'emprestar' | 'anotar' | 'controlarIa';

/**
 * "Apenas acompanhar" não pode alterar responsável, leitura, fila, SLA nem
 * transferência. Anotar internamente CONTINUA liberado de propósito: é o
 * registro do que o supervisor observou, e ele não toca no atendimento.
 */
const BLOQUEADO_EM_ACOMPANHAR: readonly WaAcao[] = [
  'responder', 'assumir', 'redistribuir', 'transferir', 'aceitar',
  'marcarLida', 'marcarNaoLida', 'devolverFila', 'encerrar', 'reabrir',
  // Pausar a IA é decidir que o cliente para de receber resposta. Cabe em
  // "responder" (ali o supervisor já assumiu a fala) mas não em "acompanhar",
  // que é o modo de quem está só conferindo.
  'bloquear', 'agendar', 'emprestar', 'controlarIa',
];

/** Responder sem assumir mexe na conversa com o cliente, e em nada mais. */
const BLOQUEADO_EM_RESPONDER: readonly WaAcao[] = [
  'assumir', 'redistribuir', 'transferir', 'aceitar',
  'marcarLida', 'marcarNaoLida', 'devolverFila', 'encerrar', 'reabrir',
];

export function acaoBloqueadaPeloModo(modo: WaModoSupervisao, acao: WaAcao): boolean {
  if (modo === 'acompanhar') return BLOQUEADO_EM_ACOMPANHAR.includes(acao);
  if (modo === 'responder') return BLOQUEADO_EM_RESPONDER.includes(acao);
  if (modo === 'assumir') return acao === 'redistribuir';
  return false; // redistribuir: o supervisor está agindo, tudo o que ele pode vale
}

// ── O conjunto pronto, para a tela ─────────────────────────────────────────

export interface WaAcoesPermitidas {
  ver: boolean;
  responder: boolean;
  assumir: boolean;
  transferir: boolean;
  redistribuir: boolean;
  aceitar: boolean;
  cancelarTransferencia: boolean;
  marcarLida: boolean;
  devolverFila: boolean;
  encerrar: boolean;
  reabrir: boolean;
  emprestar: boolean;
  /**
   * Pausar/retomar a IA, limpar a memória e cancelar a retomada agendada —
   * espelho de `wa_ai_require_control`, que usa a MESMA régua de assumir e
   * encerrar (`wa_can_manage_conv`). Não confundir com CONFIGURAR a IA: prompt,
   * modelo e canais são de administrador e vivem em Configurações
   * (`podeConfigurarIa`).
   */
  controlarIa: boolean;
  /** Estou aqui como supervisor — a tela mostra a faixa e o seletor de modo. */
  supervisionando: boolean;
}

/**
 * A resposta única que a tela consome. O `modo` só APERTA o resultado: ele
 * nunca libera o que a permissão já negou.
 */
export function acoesPermitidas(
  escopo: WaEscopo,
  c: WaConversaResumo,
  modo: WaModoSupervisao = 'acompanhar',
): WaAcoesPermitidas {
  const supervisionando = estouSupervisionando(escopo, c);
  const aperta = (acao: WaAcao, permitido: boolean): boolean =>
    permitido && !(supervisionando && acaoBloqueadaPeloModo(modo, acao));

  const encerrada = c.status === 'closed';
  const comandar = podeComandar(escopo, c);

  return {
    ver: podeVer(escopo, c),
    responder: aperta('responder', podeResponder(escopo, c) && !encerrada),
    assumir: aperta('assumir', podeAssumir(escopo, c)),
    transferir: aperta('transferir', podeTransferir(escopo, c) && !encerrada),
    redistribuir: aperta('redistribuir', podeRedistribuir(escopo, c) && !encerrada),
    aceitar: aperta('aceitar', podeAceitar(escopo, c)),
    cancelarTransferencia: aperta('transferir', podeCancelarTransferencia(escopo, c) && !!c.awaitingAccept),
    marcarLida: aperta('marcarLida', comandar),
    devolverFila: aperta('devolverFila', comandar && !!c.assignedUserId && !encerrada),
    encerrar: aperta('encerrar', comandar && !encerrada),
    reabrir: aperta('reabrir', comandar && encerrada),
    emprestar: aperta('emprestar', comandar),
    controlarIa: aperta('controlarIa', comandar),
    supervisionando,
  };
}

// ── A IA da conversa: quem comanda, quem configura, e o que está havendo ────

/**
 * Espelho de `wa_ai_require_control` — pausar, retomar, limpar a memória e
 * cancelar a retomada agendada.
 *
 * É a MESMA régua de assumir e encerrar, e isso é a decisão de desenho: mexer
 * na IA de um atendimento é mexer no atendimento. Ver não basta — antes bastava,
 * e qualquer um que enxergasse a conversa (canal aberto, setor sem membros,
 * colaborador emprestado, supervisor de outro canal) podia calar o agente no
 * caso de outra pessoa.
 */
export function podeControlarIa(escopo: WaEscopo, c: WaConversaResumo): boolean {
  return podeComandar(escopo, c);
}

/**
 * Espelho de `wa_ai_assistants_escrita`, `ai_config_escrita`,
 * `ai_playbooks_escrita` e `wa_ai_agents_escrita`: CONFIGURAR a IA — prompt,
 * playbook, modelo, ações, limites, canais atendidos, follow-up — é ato de
 * administrador, e não tem nada a ver com atender.
 *
 * Existe para a tela de Configurações não oferecer o editor a quem o banco vai
 * recusar: o cargo "auxiliar" entra em Configurações, e sem esta pergunta ele
 * via o editor de prompt inteiro para colher um erro de RLS ao salvar.
 */
export function podeConfigurarIa(escopo: WaEscopo): boolean {
  return escopo.carregado && escopo.isAdmin;
}

/**
 * O que está acontecendo com a IA nesta conversa, em UMA palavra.
 *
 * O módulo mostrava isto espalhado: uma faixa que sumia no handoff, um chip
 * dentro de um painel recolhido e um texto de erro em cinza claro. Quatro
 * situações diferentes — a IA parada por ordem de alguém, a IA que falhou, a
 * transferência esperando aceite e o atendimento que já é humano — chegavam à
 * tela como "a faixa não está aí".
 *
 * A ordem das perguntas é a ordem da urgência: primeiro o que impede a IA de
 * existir, depois o que está pendente de uma pessoa, depois a falha, e só então
 * o funcionamento normal.
 */
export interface WaIaSituacao {
  /** Existe agente vinculado (ao canal ou à sessão). */
  temAgente: boolean;
  /** `whatsapp_ai_channel_config.ai_enabled` do canal desta conversa. */
  canalLigado: boolean;
  /** `whatsapp_ai_sessions.ai_active`. */
  iaAtiva: boolean;
  /** A última execução do agente terminou em erro. */
  ultimaExecucaoFalhou: boolean;
  /** Há responsável humano nomeado. */
  temResponsavel: boolean;
  /** Transferência aguardando aceite. */
  aguardandoAceite: boolean;
}

export type WaIaEstado =
  | 'sem-ia'
  | 'canal-desligado'
  | 'transferencia-pendente'
  | 'ia-falha'
  | 'ia-ativa'
  | 'atendimento-humano'
  | 'ia-pausada';

export function estadoDaIa(s: WaIaSituacao): WaIaEstado {
  if (!s.temAgente) return 'sem-ia';
  if (!s.canalLigado) return 'canal-desligado';
  if (s.aguardandoAceite) return 'transferencia-pendente';
  if (s.iaAtiva) return s.ultimaExecucaoFalhou ? 'ia-falha' : 'ia-ativa';
  // Parada. A diferença entre "pausada" e "atendimento humano" é quem está com
  // o caso: sem responsável, a conversa está parada esperando alguém; com
  // responsável, ela está sendo atendida por gente e a IA saiu de cena.
  return s.temResponsavel ? 'atendimento-humano' : 'ia-pausada';
}

/** O texto e o tom que a faixa mostra. `null` = a faixa não existe. */
export const ROTULO_ESTADO_IA: Record<
  WaIaEstado,
  { label: string; tom: 'ativa' | 'falha' | 'pausada' | 'humano' | 'pendente' } | null
> = {
  'sem-ia': null,
  'canal-desligado': { label: 'IA desligada neste canal', tom: 'pausada' },
  'transferencia-pendente': { label: 'Transferência aguardando aceite', tom: 'pendente' },
  'ia-falha': { label: 'Falha na IA', tom: 'falha' },
  'ia-ativa': { label: 'IA atendendo', tom: 'ativa' },
  'atendimento-humano': { label: 'Atendimento humano', tom: 'humano' },
  'ia-pausada': { label: 'IA pausada', tom: 'pausada' },
};

// ── Vazio não é a mesma coisa que proibido ─────────────────────────────────

/**
 * Três estados que a inbox confundia num só ("nenhuma conversa"):
 *
 *  · `carregando` — a resposta ainda não voltou. Mostrar "sem permissão" aqui
 *    faz a tela acusar o usuário de algo que não aconteceu;
 *  · `sem-canais` — o escritório (ou este usuário) não tem canal configurado.
 *    É um pedido de configuração, não um erro;
 *  · `sem-permissao` — existem canais, e nenhum é dele. É a única em que cabe
 *    dizer "fale com um administrador";
 *  · `ok` — há o que mostrar.
 */
export type EstadoDoEscopo = 'carregando' | 'sem-canais' | 'sem-permissao' | 'ok';

export function estadoDoEscopo(
  escopo: WaEscopo,
  totalDeCanaisNoEscritorio: number | null,
): EstadoDoEscopo {
  if (!escopo.carregado || totalDeCanaisNoEscritorio === null) return 'carregando';
  if (totalDeCanaisNoEscritorio === 0) return 'sem-canais';
  if (escopo.isAdmin) return 'ok';
  if (escopo.canaisMembro.length > 0) return 'ok';
  return 'sem-permissao';
}
