/** Encerramento determinístico dos roteiros nativos de WhatsApp. */

export interface WaAiCompletionActionRef {
  action: string;
  target_type: 'user' | 'department' | 'document_template' | 'none';
  target_id: string | null;
  target_label: string;
  raw: string;
}

export interface WaAiCompletionAssistant {
  allowed_actions: string[];
  action_refs: WaAiCompletionActionRef[];
}

export interface WaAiCompletionPlaybook {
  id: string;
  /** Os campos do roteiro, só para dar RÓTULO e ORDEM ao resumo do handoff. */
  fields?: { key: string; label?: string }[];
  bindings?: {
    key: string;
    action: string;
    targetLabel?: string;
    suggestedTargetLabel?: string;
  }[];
}

export interface WaAiCompletionMemory {
  knownFacts: Record<string, string | number | boolean>;
  pendingItems: string[];
}

/**
 * O que o CRM já sabe do contato sem ter perguntado nada.
 *
 * Telefone, canal e data de entrada não são resposta de triagem — são fato do
 * atendimento. Perguntá-los ao cliente seria pedir o que já está na tela, e
 * deixá-los de fora obrigaria quem recebe a conversa a procurar em outro lugar
 * justamente enquanto lê o resumo.
 */
export interface WaAiCompletionContact {
  name?: string | null;
  phone?: string | null;
  channelName?: string | null;
  /** Quando o contato chegou, em ISO. */
  firstContactAt?: string | null;
}

export interface WaAiCompletionExternalState {
  documents: 'none' | 'pending' | 'complete';
  /** O documento que a ROTA de residência exige, pedido em separado. */
  routeDocuments?: 'none' | 'pending' | 'complete';
  kit: 'none' | 'pending' | 'signed' | 'refused';
  /** Instante a partir do qual um link de KIT pertence a ESTA rodada. */
  kitDesde?: string;
}

export type WaAiCompletionPlan = {
  action: 'solicitar_documentos' | 'enviar_documento'
    | 'transferir_atendimento' | 'transferir_para_humano';
  args: Record<string, unknown>;
  ref: WaAiCompletionActionRef | null;
};

function comparable(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Valores que significam "o cliente não soube" e não são fato nenhum. */
const WA_AI_SEM_RESPOSTA = ['', '-', 'não informado', 'nao informado', 'não sei', 'nao sei', 'null', 'undefined'];

function vazioNoResumo(value: unknown): boolean {
  return WA_AI_SEM_RESPOSTA.indexOf(String(value ?? '').trim().toLowerCase()) !== -1;
}

/**
 * O resumo que aparece para quem RECEBE a conversa.
 *
 * Antes era `Object.entries(knownFacts)` cru, e saía assim em produção:
 *
 *   "Fatos informados: nome: Pedro · conta: não informado · agencia: não
 *    informado · filiacao: WILSON... · banco_reu: Nubank · tem_print: sim ..."
 *
 * Chave interna no lugar de rótulo, `snake_case`, tudo numa linha só, e três
 * "não informado" competindo por atenção com os fatos que importam. Quem
 * assume a conversa precisa ler isso em cinco segundos, e não conseguia.
 *
 * Agora: uma linha por fato, na ORDEM DO ROTEIRO (que é a ordem em que a
 * conversa aconteceu), com o rótulo que o próprio roteiro declara. O que o
 * cliente não soube responder sai da lista e vira uma linha só no fim — é
 * informação útil, mas não é fato do caso.
 */
export function renderWaAiHandoffSummary(input: {
  motivo: string;
  facts: Record<string, unknown>;
  pendingItems?: string[];
  fields?: { key: string; label?: string }[];
}): string {
  const facts = input.facts || {};
  const campos = input.fields || [];
  const rotulo = (key: string) => {
    const achado = campos.find(item => item.key === key);
    return String(achado?.label || key).trim();
  };

  // A ordem do roteiro primeiro; o que veio de fora dele (leitura de documento,
  // por exemplo) entra depois, na ordem em que foi gravado.
  const ordenadas = campos.map(item => item.key).filter(key => key in facts);
  for (const key of Object.keys(facts)) if (ordenadas.indexOf(key) === -1) ordenadas.push(key);

  const linhas: string[] = [];
  const semResposta: string[] = [];
  for (const key of ordenadas) {
    if (vazioNoResumo(facts[key])) { semResposta.push(rotulo(key).toLowerCase()); continue; }
    linhas.push(`• ${rotulo(key)}: ${String(facts[key]).trim()}`);
  }

  const partes = [`Motivo: ${String(input.motivo || '').trim()}`];
  partes.push(linhas.length > 0 ? linhas.join('\n') : 'Ainda não há fatos estruturados.');
  if (semResposta.length > 0) partes.push(`Não informado: ${semResposta.join(', ')}.`);
  const pendentes = (input.pendingItems || []).filter(Boolean);
  partes.push(pendentes.length > 0
    ? `Ainda falta: ${pendentes.join(' · ')}.`
    : 'Sem pendências do roteiro.');

  return partes.join('\n\n').slice(0, 800);
}

function completionSummary(memory: WaAiCompletionMemory, playbook?: WaAiCompletionPlaybook) {
  return renderWaAiHandoffSummary({
    motivo: 'Triagem concluída com os critérios mínimos confirmados.',
    facts: memory.knownFacts,
    pendingItems: memory.pendingItems,
    fields: playbook?.fields,
  });
}

function bindingRef(
  assistant: WaAiCompletionAssistant, playbook: WaAiCompletionPlaybook,
  key: string, action: string,
) {
  const binding = (playbook.bindings || []).find(item => item.key === key);
  const label = String(binding?.targetLabel || binding?.suggestedTargetLabel || '').trim();
  if (binding?.action !== action || !label) return null;
  return assistant.action_refs.find(item => item.action === action
    && comparable(item.target_label) === comparable(label) && !!item.target_id) || null;
}

/**
 * A lista de documentos essenciais.
 *
 * O comprovante de residência entra GENÉRICO na primeira volta, e é de
 * propósito: a rota (próprio, familiar, aluguel, declaração) deixou de ser
 * perguntada antes e passou a ser lida do arquivo que a pessoa enviar. Só
 * quando o sistema confere o nome no documento e ele não é o do cliente é que
 * `residencia_tipo` aparece — e aí esta função já sabe pedir o que aquela rota
 * exige de fato: o contrato ou o documento do declarante.
 */
function accountDocuments(_memory: WaAiCompletionMemory) {
  return [
    'Documento de identificação com foto do cliente',
    'Print, e-mail ou tela mostrando o bloqueio ou encerramento da conta',
    'Comprovante de residência (conta de luz, água, telefone ou internet)',
  ];
}

/** O título fixo do pedido dos essenciais — é por ele que o estado é lido. */
export const WA_AI_ACCOUNT_DOCS_TITLE = 'Documentos essenciais — conta bloqueada ou encerrada';
/** E o do documento que a rota de residência exige por cima dos essenciais. */
export const WA_AI_ACCOUNT_ROUTE_DOCS_TITLE = 'Documento do vínculo de residência';

/**
 * O documento que a ROTA exige, quando o comprovante não é do próprio cliente.
 *
 * Vem depois dos essenciais, e não junto, porque a rota só existe DEPOIS de o
 * sistema ler o comprovante e o cliente dizer qual é o vínculo:
 *
 *   pai_ou_mae            → nada: o RG do cliente já traz a filiação
 *   conjuge               → certidão de casamento
 *   companheiro           → não há certidão; vai pela declaração de residência
 *   aluguel_com_contrato  → contrato de aluguel
 *   terceiro_sem_contrato → documento do declarante, para a declaração
 */
export function waAiAccountRouteDocument(route: string): string | null {
  if (route === 'conjuge') return 'Certidão de casamento';
  if (route === 'aluguel_com_contrato') return 'Contrato de aluguel';
  if (route === 'companheiro' || route === 'terceiro_sem_contrato') {
    return 'Documento de identificação com foto do declarante';
  }
  return null;
}

/**
 * O fechamento da campanha de conta, que é uma ESCADA e não um evento único.
 *
 * Cada degrau depende de estado que só existe fora da conversa — a solicitação
 * de documentos, o link de preenchimento, a assinatura — e é por isso que esta
 * função é chamada de novo a cada turno e a cada gancho de ciclo de vida
 * (`runLifecycleTurn`), sempre devolvendo só o degrau em que o caso está:
 *
 *   sem solicitação  → solicitar_documentos, com a lista da rota
 *   solicitação aberta → nada: quem cobra é o acompanhamento próprio dela
 *   documentos completos, rota de declaração → transferir para preparar a declaração
 *   documentos completos, demais rotas → enviar o KIT CONSUMIDOR
 *   KIT enviado e não assinado → nada: a cobrança da assinatura também é própria
 *   KIT assinado → transferir para o destino de pós-assinatura
 *
 * Quem trocou de assunto no meio nunca entra na escada: contexto mínimo
 * coletado, transferência na hora e nenhum documento pedido.
 */
function buildAccountCompletionPlans(
  assistant: WaAiCompletionAssistant, playbook: WaAiCompletionPlaybook,
  memory: WaAiCompletionMemory, state: WaAiCompletionExternalState,
): WaAiCompletionPlan[] {
  const allowed = new Set(assistant.allowed_actions || []);

  if (String(memory.knownFacts.tipo_atendimento || '') === 'outro_assunto_juridico') {
    return allowed.has('transferir_para_humano') ? [{
      action: 'transferir_para_humano',
      args: {
        resumo: completionSummary(memory, playbook),
        motivo: 'Outro assunto com possível relevância jurídica: contexto mínimo coletado para análise humana.',
      },
      ref: null,
    }] : [];
  }

  if (state.documents === 'none') {
    return allowed.has('solicitar_documentos') ? [{
      action: 'solicitar_documentos',
      args: {
        titulo: WA_AI_ACCOUNT_DOCS_TITLE,
        documentos: accountDocuments(memory),
      },
      ref: null,
    }] : [];
  }
  if (state.documents === 'pending') return [];

  const route = String(memory.knownFacts.residencia_tipo || '');

  // A rota pode exigir UM documento a mais, pedido em separado justamente
  // porque só se sabe qual é depois que o comprovante chegou e foi lido.
  const routeDocument = waAiAccountRouteDocument(route);
  const routeState = state.routeDocuments || 'none';
  if (routeDocument && routeState !== 'complete') {
    if (routeState === 'pending') return [];
    return allowed.has('solicitar_documentos') ? [{
      action: 'solicitar_documentos',
      args: { titulo: WA_AI_ACCOUNT_ROUTE_DOCS_TITLE, documentos: [routeDocument] },
      ref: null,
    }] : [];
  }
  const summaryArgs = {
    resumo: completionSummary(memory, playbook),
    motivo: (route === 'terceiro_sem_contrato' || route === 'companheiro')
      ? 'Preparar declaração de residência antes do KIT CONSUMIDOR.'
      : 'KIT CONSUMIDOR assinado, documentos essenciais completos e honorários de 40% sobre o êxito aceitos.',
  };

  const transferir = (key: string): WaAiCompletionPlan[] => {
    const ref = bindingRef(assistant, playbook, key, 'transferir_atendimento');
    if (ref && allowed.has('transferir_atendimento')) return [{
      action: 'transferir_atendimento', args: { ...summaryArgs, destino: ref.target_label }, ref,
    }];
    return allowed.has('transferir_para_humano')
      ? [{ action: 'transferir_para_humano', args: summaryArgs, ref: null }]
      : [];
  };

  // Companheiro e terceiro sem contrato desembocam no mesmo lugar: não existe
  // certidão que prove o vínculo, então o endereço se sustenta na declaração.
  if (route === 'terceiro_sem_contrato' || route === 'companheiro') {
    return transferir('destino_declaracao_residencia');
  }

  if (state.kit === 'none') {
    const ref = bindingRef(assistant, playbook, 'modelo_kit_consumidor', 'enviar_documento');
    return ref && allowed.has('enviar_documento') ? [{
      action: 'enviar_documento',
      args: {
        documento: ref.target_label,
        mensagem: 'Seus documentos essenciais estão completos. Preencha e assine o KIT CONSUMIDOR. No campo Réu, coloque o nome do banco informado na triagem.',
      },
      ref,
    }] : [];
  }
  if (state.kit !== 'signed') return [];

  return transferir('destino_pos_assinatura');
}

/**
 * ── Rescisão indireta ──────────────────────────────────────────────────────
 *
 * O fechamento mais simples do CRM, e de propósito: uma transferência, sem
 * escada e sem pedido de documento. A triagem inicial deste canal não pede
 * arquivo, CPF nem dado bancário, então não há estado externo a esperar — o que
 * termina a conversa é a análise humana, não um upload.
 */

/** Os pontos do artigo 483 que a triagem oferece, no vocabulário do cliente. */
const WA_AI_RESCISAO_FALTAS_GRAVES = [
  'salario_atrasado_ou_nao_pago',
  'fgts_nao_depositado',
  'assedio_humilhacao_ou_ameaca',
  'risco_a_saude_ou_seguranca',
  'reducao_salarial',
  'descumprimento_do_contrato',
  'outra_falta_grave',
];

/** Os que costumam não esperar: vínculo ativo somado a um destes. */
const WA_AI_RESCISAO_FALTAS_URGENTES = [
  'assedio_humilhacao_ou_ameaca',
  'risco_a_saude_ou_seguranca',
  'salario_atrasado_ou_nao_pago',
];

function textoDoFato(facts: Record<string, unknown>, key: string): string {
  const valor = facts[key];
  return vazioNoResumo(valor) ? '' : String(valor).trim();
}

function verdade(value: unknown): boolean {
  if (value === true) return true;
  return comparable(String(value ?? '')) === 'sim';
}

/**
 * O nível de urgência — INFERÊNCIA, e o resumo diz isso com todas as letras.
 *
 * Vale a pena calcular no backend em vez de perguntar ao modelo pelo mesmo
 * motivo de sempre: é regra fixa, e regra fixa o modelo erra de vez em quando
 * sem avisar. Aqui ela é sempre a mesma e sempre explicável.
 */
export function waAiRescisaoUrgencia(
  facts: Record<string, unknown>,
): { nivel: 'alta' | 'media' | 'baixa'; porque: string } {
  const ativo = verdade(facts.vinculo_atual);
  const falta = comparable(textoDoFato(facts, 'tipo_falta'));
  if (ativo && WA_AI_RESCISAO_FALTAS_URGENTES.indexOf(falta) !== -1) {
    return { nivel: 'alta', porque: 'ainda está na empresa e relatou ponto que costuma não esperar' };
  }
  if (ativo) return { nivel: 'media', porque: 'ainda está na empresa' };
  return { nivel: 'baixa', porque: 'o vínculo já está encerrado' };
}

/**
 * Por que este contato chegou até aqui — os critérios que de fato bateram.
 *
 * Não é veredito: nenhum deles diz que existe rescisão indireta, e a frase
 * final do resumo repete isso. É a prestação de contas do encaminhamento.
 */
export function waAiRescisaoMotivoDaQualificacao(facts: Record<string, unknown>): string {
  const motivos: string[] = [];
  if (verdade(facts.vinculo_atual)) motivos.push('vínculo de emprego ativo');
  else {
    const saida = textoDoFato(facts, 'data_saida');
    motivos.push(saida ? `vínculo encerrado em ${saida}` : 'vínculo já encerrado');
  }
  const falta = comparable(textoDoFato(facts, 'tipo_falta'));
  if (WA_AI_RESCISAO_FALTAS_GRAVES.indexOf(falta) !== -1) {
    motivos.push('relato de possível descumprimento do empregador');
  }
  const provas = textoDoFato(facts, 'provas');
  if (provas) motivos.push('indicou elementos que podem demonstrar os fatos');
  return `${motivos.join('; ')} — caso para análise humana.`;
}

/** A data do contato como o escritório a lê: dia/mês/ano no fuso de Cuiabá. */
function dataDoContato(iso: string | null | undefined): string {
  const bruto = String(iso || '').trim();
  if (!bruto) return '';
  const data = new Date(bruto);
  if (Number.isNaN(data.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(data);
}

/** Teto do `resumo` de `transferir_atendimento` no catálogo de ações. */
const WA_AI_RESUMO_MAX = 800;

/** Um fato longo demais vira um fato curto, não um resumo cortado no meio. */
function fatoNoLimite(texto: string): string {
  if (texto.length <= 200) return texto;
  return `${texto.slice(0, 199).replace(/\s+\S*$/, '')}…`;
}

/**
 * O resumo que o Pedro lê.
 *
 * A regra que organiza tudo: FATO e INFERÊNCIA em blocos separados e rotulados.
 * O que o contato disse fica no primeiro bloco, do jeito que ele disse; o que o
 * assistente concluiu (urgência, motivo do encaminhamento) fica no segundo, com
 * o rótulo dizendo que é leitura de máquina. Quem recebe precisa saber, sem
 * perguntar, qual das duas coisas está lendo.
 */
export function renderWaAiRescisaoSummary(input: {
  facts: Record<string, unknown>;
  pendingItems?: string[];
  fields?: { key: string; label?: string }[];
  contact?: WaAiCompletionContact | null;
}): string {
  const facts = input.facts || {};
  const campos = input.fields || [];
  const contato = input.contact || {};

  const rotulo = (key: string) => {
    const achado = campos.find(item => item.key === key);
    return String(achado?.label || key).trim();
  };

  const nome = textoDoFato(facts, 'nome') || String(contato.name || '').trim();
  const identificacao = [nome || 'sem nome informado', String(contato.phone || '').trim()]
    .filter(Boolean).join(' · ');
  const origem = [
    String(contato.channelName || '').trim() ? `canal ${String(contato.channelName).trim()}` : '',
    dataDoContato(contato.firstContactAt),
  ].filter(Boolean).join(' · ');

  const cabecalho = [`Contato: ${identificacao}`];
  const cidade = textoDoFato(facts, 'cidade_estado');
  if (cidade) cabecalho.push(`Cidade/UF: ${cidade}`);
  if (origem) cabecalho.push(`Origem: ${origem}`);

  // Os fatos saem na ORDEM DO ROTEIRO, que é a ordem em que a conversa
  // aconteceu. Identificação e cidade já estão no cabeçalho e não se repetem.
  const noCabecalho = ['nome', 'cidade_estado'];
  const ordenadas = campos.map(item => item.key)
    .filter(key => key in facts && noCabecalho.indexOf(key) === -1);
  for (const key of Object.keys(facts)) {
    if (ordenadas.indexOf(key) === -1 && noCabecalho.indexOf(key) === -1) ordenadas.push(key);
  }

  const linhas: string[] = [];
  const semResposta: string[] = [];
  for (const key of ordenadas) {
    if (vazioNoResumo(facts[key])) { semResposta.push(rotulo(key).toLowerCase()); continue; }
    const valor = typeof facts[key] === 'boolean' ? (facts[key] ? 'sim' : 'não') : String(facts[key]).trim();
    linhas.push(`• ${rotulo(key)}: ${fatoNoLimite(valor)}`);
  }

  const urgencia = waAiRescisaoUrgencia(facts);
  const inferencias = [
    `• Urgência: ${urgencia.nivel} — ${urgencia.porque}.`,
    `• Encaminhado porque: ${waAiRescisaoMotivoDaQualificacao(facts)}`,
    '• Nenhuma conclusão sobre existir ou não rescisão indireta: depende da análise do advogado.',
  ];

  // O bloco de inferência é RESERVADO antes de qualquer corte. Ele é o que
  // carrega a ressalva de que nada ali é veredito, e um relato comprido não
  // pode empurrá-la para fora do teto de 800 — quem recebe leria as conclusões
  // do assistente sem a linha que diz que são conclusões do assistente.
  const rodape = `Leitura do assistente (não confirmada):\n${inferencias.join('\n')}`;

  const corpo = [cabecalho.join('\n')];
  corpo.push(linhas.length > 0
    ? `Informado pelo contato:\n${linhas.join('\n')}`
    : 'Informado pelo contato: ainda não há fatos estruturados.');
  if (semResposta.length > 0) corpo.push(`Não informado: ${semResposta.join(', ')}.`);
  const pendentes = (input.pendingItems || []).filter(Boolean);
  if (pendentes.length > 0) corpo.push(`Ainda falta: ${pendentes.join(' · ')}.`);

  const espaco = WA_AI_RESUMO_MAX - rodape.length - 2;
  return `${corpo.join('\n\n').slice(0, Math.max(0, espaco))}\n\n${rodape}`.slice(0, WA_AI_RESUMO_MAX);
}

function buildRescisaoCompletionPlans(
  assistant: WaAiCompletionAssistant, playbook: WaAiCompletionPlaybook,
  memory: WaAiCompletionMemory, contact: WaAiCompletionContact | null,
): WaAiCompletionPlan[] {
  const allowed = new Set(assistant.allowed_actions || []);
  const args = {
    resumo: renderWaAiRescisaoSummary({
      facts: memory.knownFacts,
      pendingItems: memory.pendingItems,
      fields: playbook.fields,
      contact,
    }),
    motivo: 'Triagem de rescisão indireta concluída — encaminhado para análise do advogado.',
  };

  const ref = bindingRef(assistant, playbook, 'destino_triagem_concluida', 'transferir_atendimento');
  if (ref && allowed.has('transferir_atendimento')) {
    return [{ action: 'transferir_atendimento', args: { ...args, destino: ref.target_label }, ref }];
  }
  // Sem destino configurado a conversa NÃO fica com a IA: volta para a fila
  // humana, que é onde alguém a vê. Perder o destino não pode virar silêncio.
  return allowed.has('transferir_para_humano')
    ? [{ action: 'transferir_para_humano', args, ref: null }]
    : [];
}

/**
 * O roteiro decide que terminou; esta função apenas materializa o fechamento
 * já configurado. Assim um modelo antigo não consegue esquecer documentos ou
 * transferência e também não escolhe um destino por texto livre.
 */
export function buildWaAiCompletionPlans(
  assistant: WaAiCompletionAssistant,
  playbook: WaAiCompletionPlaybook | null,
  memory: WaAiCompletionMemory,
  externalState: WaAiCompletionExternalState = { documents: 'none', kit: 'none' },
  contact: WaAiCompletionContact | null = null,
): WaAiCompletionPlan[] {
  if (!playbook) return [];
  if (playbook.id === 'bloqueio_encerramento_conta') {
    return buildAccountCompletionPlans(assistant, playbook, memory, externalState);
  }
  if (playbook.id === 'rescisao_indireta') {
    return buildRescisaoCompletionPlans(assistant, playbook, memory, contact);
  }
  if (playbook.id !== 'sem_registro_carteira') return [];
  const allowed = new Set(assistant.allowed_actions || []);
  const plans: WaAiCompletionPlan[] = [];

  // Só as PROVAS. Documento de identificação e CTPS Digital saíram daqui de
  // propósito: pedir documento pessoal antes de a pessoa saber dos honorários
  // invertia a ordem do atendimento. Quem pede o que falta, depois da análise,
  // é a equipe que recebe a transferência.
  const provas = String(memory.knownFacts.provas || '').replace(/\s+/g, ' ').trim();
  if (allowed.has('solicitar_documentos') && provas) {
    plans.push({
      action: 'solicitar_documentos',
      args: {
        titulo: 'Provas do trabalho sem registro',
        documentos: [`Provas informadas: ${provas}`.slice(0, 120)],
      },
      ref: null,
    });
  }

  const ref = bindingRef(assistant, playbook, 'destino_triagem_concluida', 'transferir_atendimento');
  const args = {
    resumo: completionSummary(memory, playbook),
    motivo: 'Triagem concluída, provas solicitadas e honorários de 40% sobre o êxito aceitos.',
  };

  if (ref && allowed.has('transferir_atendimento')) {
    plans.push({
      action: 'transferir_atendimento', args: { ...args, destino: ref.target_label }, ref,
    });
  } else if (allowed.has('transferir_para_humano')) {
    plans.push({ action: 'transferir_para_humano', args, ref: null });
  }
  return plans;
}
