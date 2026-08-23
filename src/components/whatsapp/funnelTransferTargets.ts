/**
 * Quem pode receber a transferência automática de uma etapa do funil — e como
 * o destino salvo volta a virar nome na tela.
 *
 * ── POR QUE ESTE MÓDULO EXISTE ─────────────────────────────────────────────
 *
 * A ação "Transferir atendimento" guardava um `target` solto: um uuid dentro de
 * um `jsonb`, sem nada que dissesse de qual tabela ele saiu nem se ainda vale.
 * Isso produzia três defeitos que só apareciam depois:
 *
 *  1. o `<select>` de destino recebia a lista INTEIRA de setores e de gente do
 *     escritório — inclusive quem não enxerga o canal daquele funil. A etapa
 *     era salva apontando para alguém que o banco recusaria na hora H, e o erro
 *     só nascia meses depois, quando um card entrasse na etapa;
 *  2. reabrir a ação com um destino desligado mostrava o campo VAZIO. O usuário
 *     salvava de novo achando que estava tudo certo e o destino era trocado em
 *     silêncio pelo primeiro da lista;
 *  3. o texto do aviso ao cliente exigia digitar `{{setor}}` de memória. Errar
 *     uma letra não dá erro nenhum: a variável simplesmente vira vazio e o
 *     cliente recebe uma frase truncada.
 *
 * ── ESTE MÓDULO NÃO É A TRAVA ──────────────────────────────────────────────
 *
 * A trava é do banco: `wa_funnel_destination_can_receive` valida o destino no
 * momento de SALVAR a etapa (trigger em `whatsapp_channel_funnel_stages`), e
 * `wa_destination_can_access` valida de novo dentro de
 * `wa_transfer_contact_attendance`, na hora de transferir. As regras abaixo são
 * as MESMAS, escritas de novo para a tela — cópia proposital e vigiada por
 * teste, no mesmo desenho de `waPermissions.ts`. O que se ganha aqui é mostrar
 * "não pode" ANTES do clique, em vez de colher um 42501 depois de salvar.
 *
 * SEM IMPORTS de runtime, só `import type`. É o que deixa o `node --test`
 * carregar o módulo sem arrastar a cadeia do cliente Supabase.
 */
import type { WhatsAppFunnelStageAction } from '../../types/whatsapp.types';

// ── Vocabulário ─────────────────────────────────────────────────────────────

/** Os tipos de destino que o sistema realmente sabe executar. */
export type FunnelDestinationKind = 'department' | 'user';

export const FUNNEL_DESTINATION_KINDS: readonly FunnelDestinationKind[] = ['department', 'user'];

export const ROTULO_TIPO_DESTINO: Record<FunnelDestinationKind, string> = {
  department: 'Setor',
  user: 'Pessoa / atendente',
};

/** `transfer_to_*` é o tipo salvo na ação; `kind` é como a tela raciocina. */
export const TIPO_DA_ACAO: Record<FunnelDestinationKind, 'transfer_to_department' | 'transfer_to_user'> = {
  department: 'transfer_to_department',
  user: 'transfer_to_user',
};

/**
 * Por que um destino não está disponível. `null` = disponível.
 *
 * A distinção importa na tela: "inativo" é um cadastro que existe e foi
 * desligado (o administrador reativa), "sem-membros" é um setor que ninguém
 * atende (transferir para ele é abandonar a conversa) e "sem-acesso-ao-canal" é
 * permissão — a pessoa existe e trabalha aqui, mas não enxerga este número.
 */
export type MotivoIndisponivel = 'inativo' | 'sem-membros' | 'sem-acesso-ao-canal';

export const EXPLICACAO_INDISPONIVEL: Record<MotivoIndisponivel, string> = {
  'inativo': 'Cadastro desativado.',
  'sem-membros': 'Nenhum atendente neste setor.',
  'sem-acesso-ao-canal': 'Sem acesso a este canal.',
};

/** Uma opção pronta para a lista: id estável, nome legível, e o porquê do "não". */
export interface FunnelDestinationOption {
  kind: FunnelDestinationKind;
  id: string;
  name: string;
  /** Texto secundário (cargo da pessoa, contagem de atendentes do setor). */
  detail?: string | null;
  /** `null` quando pode receber. */
  indisponivel: MotivoIndisponivel | null;
}

// ── O que a tela precisa saber do banco ─────────────────────────────────────

/** O canal a que este funil pertence. `visibility_mode: 'all'` é canal aberto. */
export interface CanalDoFunil {
  id: string;
  visibility_mode?: string | null;
}

export interface SetorCadastrado {
  id: string;
  name: string;
  is_active?: boolean | null;
}

export interface PessoaCadastrada {
  user_id: string;
  name: string;
  role?: string | null;
  role_label?: string | null;
}

export interface FontesDeDestino {
  canal: CanalDoFunil | null;
  setores: readonly SetorCadastrado[];
  /** Só quem está ativo — `listStaff()` já entrega assim. */
  pessoas: readonly PessoaCadastrada[];
  /** setor → user_ids (`listAllDepartmentMembers`). */
  membrosPorSetor: Readonly<Record<string, readonly string[]>>;
  /** user_ids com vínculo em `whatsapp_channel_members` DESTE canal. */
  membrosDoCanal: readonly string[];
}

const semAcento = (valor: string): string => valor
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR');

/** Espelho do ramo "administrador" de `wa_destination_can_access`. */
export function eAdministrador(pessoa: PessoaCadastrada): boolean {
  return semAcento((pessoa.role || '').trim()) === 'administrador';
}

// ── Quem pode receber ───────────────────────────────────────────────────────

/**
 * Espelho do ramo de SETOR de `wa_destination_can_access`: existir, estar ativo
 * e ter alguém dentro. Setor vazio fica na lista, marcado — some-lo esconderia
 * do administrador justamente o setor que ele precisa povoar.
 */
export function opcoesDeSetor(fontes: FontesDeDestino): FunnelDestinationOption[] {
  return fontes.setores.map(setor => {
    const membros = fontes.membrosPorSetor[setor.id] || [];
    const indisponivel: MotivoIndisponivel | null = setor.is_active === false
      ? 'inativo'
      : membros.length === 0 ? 'sem-membros' : null;
    return {
      kind: 'department' as const,
      id: setor.id,
      name: setor.name,
      detail: membros.length === 1 ? '1 atendente' : `${membros.length} atendentes`,
      indisponivel,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Espelho do ramo de PESSOA: ativa (a lista já vem filtrada por `is_active`) e
 * enxergando o canal — administrador vê tudo, canal `'all'` é aberto, e o resto
 * depende de `whatsapp_channel_members`.
 *
 * Canal desconhecido (`null`) não é permissão frouxa: sem saber de que canal se
 * trata, ninguém é marcado como sem acesso, porque a pergunta não pôde ser
 * feita. Quem decide, aí, é o banco no salvamento.
 */
export function opcoesDePessoa(fontes: FontesDeDestino): FunnelDestinationOption[] {
  const doCanal = new Set(fontes.membrosDoCanal);
  const canalAberto = !fontes.canal || fontes.canal.visibility_mode === 'all';
  return fontes.pessoas.map(pessoa => {
    const enxerga = canalAberto || eAdministrador(pessoa) || doCanal.has(pessoa.user_id);
    return {
      kind: 'user' as const,
      id: pessoa.user_id,
      name: pessoa.name,
      detail: pessoa.role_label || pessoa.role || null,
      indisponivel: enxerga ? null : ('sem-acesso-ao-canal' as MotivoIndisponivel),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function opcoesDeDestino(kind: FunnelDestinationKind, fontes: FontesDeDestino): FunnelDestinationOption[] {
  return kind === 'department' ? opcoesDeSetor(fontes) : opcoesDePessoa(fontes);
}

/** Busca por nome, sem acento e sem caixa. Consulta vazia devolve tudo. */
export function filtraDestinos(
  opcoes: readonly FunnelDestinationOption[],
  consulta: string,
): FunnelDestinationOption[] {
  const alvo = semAcento(consulta.trim());
  if (!alvo) return [...opcoes];
  const termos = alvo.split(/\s+/);
  return opcoes.filter(opcao => {
    const texto = semAcento(`${opcao.name} ${opcao.detail || ''}`);
    return termos.every(termo => texto.includes(termo));
  });
}

// ── Ler e escrever o destino na ação ────────────────────────────────────────

export interface DestinoDaAcao {
  kind: FunnelDestinationKind;
  id: string | null;
  /** Nome no momento em que foi escolhido. Só retrato — nunca a fonte da verdade. */
  nome: string | null;
}

/**
 * O destino salvo, aceitando as duas gerações do formato.
 *
 * O formato antigo (`type: 'transfer_to_user'` + `target: '<uuid>'`) continua
 * em produção em toda etapa salva antes desta mudança; ele não é migrado, é
 * LIDO. Reescrevê-lo em massa obrigaria a adivinhar, para cada linha, se o uuid
 * é de `profiles` ou de `whatsapp_departments` — e é exatamente essa adivinhação
 * que o campo novo veio eliminar.
 */
export function leDestino(action: WhatsAppFunnelStageAction | null | undefined): DestinoDaAcao {
  const bruto = (action || {}) as Record<string, unknown>;
  const declarado = bruto.destination_type;
  const kind: FunnelDestinationKind = declarado === 'department' || declarado === 'user'
    ? declarado
    : (action?.type === 'transfer_to_department' ? 'department' : 'user');
  const idNovo = typeof bruto.destination_id === 'string' ? bruto.destination_id.trim() : '';
  const idLegado = typeof action?.target === 'string' ? action.target.trim() : '';
  const nome = typeof bruto.destination_name === 'string' ? bruto.destination_name.trim() : '';
  return { kind, id: idNovo || idLegado || null, nome: nome || null };
}

/**
 * Grava o destino mantendo as duas grafias em sincronia. `target` e `type`
 * continuam preenchidos de propósito: o executor antigo, as automações de IA e
 * qualquer leitor que ainda não conheça `destination_id` seguem funcionando —
 * e o dia em que as duas discordarem é bug, não compatibilidade.
 */
export function escreveDestino(
  action: WhatsAppFunnelStageAction,
  destino: Partial<DestinoDaAcao> & { kind: FunnelDestinationKind },
): WhatsAppFunnelStageAction {
  const id = destino.id?.trim() || null;
  const nome = destino.nome?.trim() || null;
  return {
    ...action,
    type: TIPO_DA_ACAO[destino.kind],
    target: id,
    destination_type: destino.kind,
    destination_id: id,
    destination_name: nome,
  } as WhatsAppFunnelStageAction;
}

// ── Reabrir uma ação já salva ───────────────────────────────────────────────

/**
 * O que mostrar ao reabrir a ação.
 *
 *  · `vazio`      — nunca foi escolhido; falta configurar;
 *  · `ok`         — o registro existe e continua podendo receber;
 *  · `sumiu`      — o id salvo não bate com nenhum cadastro (excluído);
 *  · `indisponivel` — existe, mas está desativado / sem membros / sem acesso.
 *
 * Nos três últimos o destino salvo é DEVOLVIDO, não substituído. Trocar em
 * silêncio pelo primeiro da lista é o defeito que isto veio consertar: a etapa
 * passaria a transferir para outra pessoa sem ninguém ter pedido.
 */
export type StatusDestino = 'vazio' | 'ok' | 'sumiu' | 'indisponivel';

export interface DestinoResolvido {
  status: StatusDestino;
  kind: FunnelDestinationKind;
  id: string | null;
  /** Nome atual do cadastro; caindo para o retrato salvo quando ele sumiu. */
  nome: string | null;
  motivo: MotivoIndisponivel | null;
  /** Pronta para a tela. `null` quando está tudo certo. */
  aviso: string | null;
}

export function resolveDestino(
  action: WhatsAppFunnelStageAction | null | undefined,
  fontes: FontesDeDestino,
): DestinoResolvido {
  const salvo = leDestino(action);
  const base = { kind: salvo.kind, id: salvo.id, nome: salvo.nome, motivo: null } as const;

  if (!salvo.id) {
    return { ...base, status: 'vazio', aviso: null };
  }

  const opcao = opcoesDeDestino(salvo.kind, fontes).find(item => item.id === salvo.id);
  if (!opcao) {
    const rotulo = salvo.kind === 'department' ? 'O setor' : 'A pessoa';
    return {
      ...base,
      status: 'sumiu',
      aviso: salvo.nome
        ? `${rotulo} “${salvo.nome}” não existe mais no cadastro. Escolha outro destino.`
        : `${rotulo} escolhida antes não existe mais no cadastro. Escolha outro destino.`,
    };
  }

  if (opcao.indisponivel) {
    return {
      ...base,
      status: 'indisponivel',
      nome: opcao.name,
      motivo: opcao.indisponivel,
      aviso: `“${opcao.name}” não pode receber a transferência: ${EXPLICACAO_INDISPONIVEL[opcao.indisponivel].toLocaleLowerCase('pt-BR')}`,
    };
  }

  return { ...base, status: 'ok', nome: opcao.name, aviso: null };
}

// ── Variáveis clicáveis ─────────────────────────────────────────────────────

/**
 * Só entram aqui variáveis que a EXECUÇÃO sabe preencher (ver
 * `funnelStageActions.ts`). Oferecer um chip que vira string vazia é pior do
 * que não oferecer chip nenhum: o usuário confia no botão e o cliente recebe a
 * frase com o buraco.
 */
export interface VariavelDeMensagem {
  token: string;
  rotulo: string;
  descricao: string;
  /** Como fica quando resolvida — a prévia ao lado do chip. */
  exemplo: string;
}

/**
 * `{{destino}}` e `{{setor}}` vêm de antes e continuam sendo os tokens dos
 * textos-padrão em `settings.service.ts` ("…encaminhando seu atendimento para o
 * setor {{setor}}"). Eles NÃO foram renomeados: trocar o nome do token
 * silenciaria a variável em toda etapa já salva — a frase chegaria ao cliente
 * com um buraco no lugar do setor. O que muda é que ninguém precisa mais
 * digitá-los.
 */
export const VARIAVEIS_AVISO_CLIENTE: readonly VariavelDeMensagem[] = [
  { token: '{{destino}}', rotulo: 'Nome do destino', descricao: 'A pessoa ou o setor escolhido nesta ação.', exemplo: 'Atendimento' },
  { token: '{{setor}}', rotulo: 'Setor de destino', descricao: 'O setor que vai receber. Vazio quando o destino é uma pessoa.', exemplo: 'Atendimento' },
  { token: '{{setor.origem}}', rotulo: 'Setor de origem', descricao: 'O setor em que o atendimento estava antes.', exemplo: 'Comercial' },
  { token: '{{cliente.nome}}', rotulo: 'Nome do cliente', descricao: 'Nome completo do contato da conversa.', exemplo: 'Maria Silva' },
  { token: '{{cliente.primeiro_nome}}', rotulo: 'Primeiro nome do cliente', descricao: 'Só o primeiro nome do contato.', exemplo: 'Maria' },
  { token: '{{agente.nome}}', rotulo: 'Nome do atendente', descricao: 'Quem responde pelo atendimento no momento da transferência.', exemplo: 'Lisliandra Cerqueira' },
  { token: '{{etapa.nome}}', rotulo: 'Nome da etapa', descricao: 'A etapa do funil que disparou a ação.', exemplo: 'Em negociação' },
  { token: '{{canal.nome}}', rotulo: 'Nome do canal', descricao: 'O número por onde o cliente falou.', exemplo: 'Comercial' },
];

/**
 * A observação interna é lida pela equipe, nunca pelo cliente — por isso ela
 * ganha o telefone, que não faz sentido num aviso ao próprio contato.
 */
export const VARIAVEIS_OBSERVACAO_INTERNA: readonly VariavelDeMensagem[] = [
  ...VARIAVEIS_AVISO_CLIENTE,
  { token: '{{cliente.telefone}}', rotulo: 'Telefone do cliente', descricao: 'Número do contato, em formato internacional.', exemplo: '+55 65 99999-0000' },
];

/**
 * A prévia ao lado do editor: o mesmo `{{...}}` do `renderTemplate`, resolvido
 * com os exemplos do catálogo. Token desconhecido fica VISÍVEL de propósito —
 * é assim que quem colou um `{{setorr}}` de outro lugar descobre o erro aqui, e
 * não pelo cliente recebendo a frase truncada.
 */
export function previaComExemplos(
  texto: string,
  variaveis: readonly VariavelDeMensagem[] = VARIAVEIS_OBSERVACAO_INTERNA,
  /**
   * O que JÁ se sabe de verdade nesta ação — hoje, o destino escolhido. Ter o
   * exemplo genérico aqui era pior do que não ter prévia: com "Financeiro"
   * selecionado, a linha anunciava "para o setor Atendimento" e contradizia o
   * campo logo acima.
   */
  reais: Readonly<Record<string, string>> = {},
): string {
  const valores = new Map(variaveis.map(v => [v.token.replace(/[{}]/g, '').trim(), v.exemplo]));
  // String vazia é um valor REAL, não "não sei": com destino Pessoa, `{{setor}}`
  // sai mesmo vazio na execução, e a prévia tem de mostrar a frase encurtada em
  // vez de um setor de mentira.
  for (const [chave, valor] of Object.entries(reais)) valores.set(chave, valor);
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (bruto, chave: string) =>
    valores.has(chave) ? (valores.get(chave) as string) : bruto);
}

/** Toda variável ofertada precisa existir no mapa que a execução monta. */
export function tokensConhecidos(): string[] {
  return Array.from(new Set(VARIAVEIS_OBSERVACAO_INTERNA.map(v => v.token.replace(/[{}]/g, '').trim())));
}

export interface InsercaoDeVariavel {
  texto: string;
  /** Onde o cursor deve ficar depois — sempre logo após o token inserido. */
  cursor: number;
}

/**
 * Insere o token na posição do cursor (substituindo a seleção, se houver) e
 * cuida do espaço: sem isso "Olá" + `{{cliente.nome}}` vira "Olá{{cliente.nome}}"
 * e o texto sai grudado na cara do cliente.
 */
export function insereVariavel(
  texto: string,
  inicio: number,
  fim: number,
  token: string,
): InsercaoDeVariavel {
  const tamanho = texto.length;
  const de = Math.max(0, Math.min(inicio, tamanho));
  const ate = Math.max(de, Math.min(fim, tamanho));
  const antes = texto.slice(0, de);
  const depois = texto.slice(ate);
  const precisaEspacoAntes = antes.length > 0 && !/\s$/.test(antes);
  const precisaEspacoDepois = depois.length > 0 && !/^[\s.,;:!?)]/.test(depois);
  const miolo = `${precisaEspacoAntes ? ' ' : ''}${token}${precisaEspacoDepois ? ' ' : ''}`;
  return {
    texto: `${antes}${miolo}${depois}`,
    cursor: de + (precisaEspacoAntes ? 1 : 0) + token.length,
  };
}
