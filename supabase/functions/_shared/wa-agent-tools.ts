/**
 * Catálogo de gatilhos do atendente de IA do WhatsApp.
 *
 * O QUE É: a lista fechada de coisas que a IA pode PEDIR para o sistema fazer.
 * A IA nunca executa nada — ela emite uma chamada, o runtime valida contra a
 * allow-list do agente e executa de forma determinística, registrando no log.
 * É essa separação que torna o atendente auditável e removível: todo efeito
 * colateral passa por aqui, e nada aqui faz o que um humano já não pudesse
 * fazer pela tela.
 *
 * POR QUE UM CATÁLOGO FECHADO: as duas tentativas anteriores morreram por
 * excesso de configuração — um motor de regras com ~20 condições e ~17 ações
 * em JSON, que precisava ser todo preenchido antes da primeira conversa rodar.
 * Aqui a configuração do escritório é só escolher QUAIS destes gatilhos cada
 * agente pode usar. O resto é prompt em português.
 *
 * PURO DE PROPÓSITO: nenhum import. É lido pelo runtime (Deno), pelo editor de
 * prompt (browser) e pelos testes (node). Ver o cabeçalho de `wa-raw.ts`.
 */

// ── Tipos ────────────────────────────────────────────────────────────

/** Natureza do efeito. Decide o default de aprovação humana e o que logar. */
export type WaToolEffect =
  | 'leitura'   // só consulta; não muda nada nem fala com o cliente
  | 'interno'   // muda estado no CRM; o cliente não vê
  | 'cliente';  // o cliente recebe alguma coisa — mensagem, link, documento

/**
 * Risco de o gatilho sair errado. Não é sobre falha técnica, é sobre o
 * estrago que um disparo indevido causa com um cliente real do outro lado.
 */
export type WaToolRisk = 'baixo' | 'medio' | 'alto';

export interface WaToolParamSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array';
    description: string;
    enum?: string[];
    items?: { type: 'string' };
  }>;
  required?: string[];
}

export interface WaToolDef {
  /** Identificador usado na chamada de função e no log. */
  name: string;
  /** Como aparece no editor de prompt, no estilo `@Menção`. */
  mention: string;
  /** Vai para o LLM. Escrita para a IA saber QUANDO usar, não só o que faz. */
  description: string;
  parameters: WaToolParamSchema;
  effect: WaToolEffect;
  risk: WaToolRisk;
  /**
   * false = está no catálogo para a gente decidir junto, mas o runtime ainda
   * não executa. Pedir um gatilho não implementado devolve erro para a IA, que
   * segue a conversa sem ele — nunca finge que fez.
   */
  implemented: boolean;
  /** Onde o efeito acontece de verdade. Serve de mapa para manutenção. */
  landsOn: string;
}

// ── Catálogo ─────────────────────────────────────────────────────────

export const WA_AGENT_TOOLS: WaToolDef[] = [
  {
    name: 'registrar_dados',
    mention: '@RegistrarDados',
    description:
      'Grava informações que o cliente forneceu (nome, CPF, profissão, o que aconteceu, datas). ' +
      'Use assim que o cliente informar algo relevante, sem esperar o fim da conversa — ' +
      'se ele sumir no meio, o que já foi dito não se perde.',
    parameters: {
      type: 'object',
      properties: {
        campos: {
          type: 'array',
          description: 'Pares "chave: valor" com o que foi coletado. Ex.: "cpf: 123...", "profissao: pedreiro".',
          items: { type: 'string' },
        },
      },
      required: ['campos'],
    },
    effect: 'interno',
    risk: 'baixo',
    implemented: true,
    landsOn: 'whatsapp_ai_sessions.collected_data',
  },
  {
    name: 'salvar_nome',
    mention: '@SalvarNome',
    description:
      'Corrige o nome do contato quando o cliente se identifica e o nome salvo está errado ' +
      'ou é só o número. Não invente: use exatamente o nome que ele escreveu.',
    parameters: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome completo como o cliente escreveu.' },
      },
      required: ['nome'],
    },
    effect: 'interno',
    risk: 'baixo',
    implemented: true,
    landsOn: 'whatsapp_conversations.contact_name',
  },
  {
    name: 'qualificar',
    mention: '@Qualificar',
    description:
      'Registra se o caso serve para o escritório. Use "qualificado" só quando tiver os dados ' +
      'que sustentam isso; "desqualificado" quando houver motivo claro (já tem advogado, caso ' +
      'fora da área, sem direito). Sempre explique o motivo — é o que o advogado vai ler.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Resultado da triagem.',
          enum: ['qualificado', 'desqualificado', 'em_analise'],
        },
        motivo: { type: 'string', description: 'Por quê, em uma frase, com o dado que sustenta.' },
      },
      required: ['status', 'motivo'],
    },
    effect: 'interno',
    risk: 'medio',
    implemented: true,
    landsOn: 'whatsapp_ai_sessions.qualification',
  },
  {
    name: 'mover_etapa',
    mention: '@MoverEtapa',
    description:
      'Move o atendimento para outra etapa do funil do canal. É assim que a conversa avança de ' +
      'fase. Só mova quando o objetivo da etapa atual estiver cumprido de verdade.',
    parameters: {
      type: 'object',
      properties: {
        etapa: { type: 'string', description: 'Nome exato da etapa de destino no funil deste canal.' },
        motivo: { type: 'string', description: 'O que foi concluído que justifica avançar.' },
      },
      required: ['etapa', 'motivo'],
    },
    effect: 'interno',
    risk: 'medio',
    implemented: true,
    landsOn: 'whatsapp_conversations.funnel_stage + entry_actions da etapa',
  },
  {
    name: 'pedir_documentos',
    mention: '@PedirDocumentos',
    description:
      'Abre uma solicitação de documentos para o cliente. Depois disso, o próprio sistema ' +
      'confere o que ele mandar e dá baixa item a item — você NÃO precisa analisar as fotos, ' +
      'só pedir e acompanhar o que ainda falta.',
    parameters: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          description: 'Documentos pedidos, um por item. Ex.: "RG ou CNH", "comprovante de residência".',
          items: { type: 'string' },
        },
        observacao: { type: 'string', description: 'Instrução extra para o cliente, se houver.' },
      },
      required: ['itens'],
    },
    effect: 'cliente',
    risk: 'medio',
    implemented: true,
    landsOn: 'document_requests + document_request_items (conferência via whatsapp-doc-intake)',
  },
  {
    name: 'enviar_template',
    mention: '@EnviarTemplate',
    description:
      'Envia uma mensagem pronta já cadastrada pelo escritório (vídeo de apresentação, ' +
      'explicação de honorários, lista de documentos). Prefira o template à sua própria ' +
      'redação quando existir um que sirva — ele foi revisado por advogado.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Nome exato do template cadastrado.' },
      },
      required: ['template'],
    },
    effect: 'cliente',
    risk: 'medio',
    implemented: true,
    landsOn: 'whatsapp_templates → evolution-send',
  },
  {
    name: 'agendar_followup',
    mention: '@AgendarFollowup',
    description:
      'Agenda uma cobrança para quando o cliente ficar sem responder. Use ao terminar um turno ' +
      'em que você espera resposta. Se ele responder antes, o agendamento é cancelado sozinho.',
    parameters: {
      type: 'object',
      properties: {
        horas: { type: 'number', description: 'Daqui a quantas horas cobrar.' },
        mensagem: { type: 'string', description: 'O que enviar na cobrança.' },
      },
      required: ['horas', 'mensagem'],
    },
    effect: 'cliente',
    risk: 'medio',
    implemented: true,
    landsOn: 'whatsapp_scheduled_messages',
  },
  {
    name: 'transferir_humano',
    mention: '@TransferirHumano',
    description:
      'Passa o atendimento para uma pessoa do escritório e PARA de responder. Use quando o ' +
      'cliente pedir para falar com advogado, quando ficar irritado, quando o assunto sair do ' +
      'seu escopo, ou quando você não souber responder. Na dúvida, transfira — errar para o ' +
      'lado de chamar um humano não causa dano.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Por que está transferindo — o humano lê isto primeiro.' },
        setor: { type: 'string', description: 'Setor de destino, se souber qual.' },
      },
      required: ['motivo'],
    },
    effect: 'interno',
    risk: 'baixo',
    implemented: true,
    landsOn: 'whatsapp_conversations.assigned_user_id/department_id + nota interna',
  },
  {
    name: 'passar_para_agente',
    mention: '@PassarPara',
    description:
      'Entrega a conversa para outro agente especializado e sai de cena. Use quando o assunto ' +
      'passar a ser da especialidade dele. IMPORTANTE: junto com a passagem, faça JÁ a primeira ' +
      'pergunta do próximo agente, na mesma mensagem. Nunca anuncie "vou te transferir" e pare — ' +
      'isso obriga o cliente a responder duas vezes e a troca fica óbvia. Do lado dele deve ' +
      'parecer uma conversa só.',
    parameters: {
      type: 'object',
      properties: {
        agente: { type: 'string', description: 'Nome exato do agente de destino.' },
        motivo: { type: 'string', description: 'O que na conversa fez você passar adiante.' },
        primeira_pergunta: {
          type: 'string',
          description: 'A pergunta de abertura do próximo agente, enviada agora junto com a passagem.',
        },
      },
      required: ['agente', 'motivo'],
    },
    effect: 'interno',
    risk: 'medio',
    implemented: true,
    landsOn: 'whatsapp_ai_agent_state.current_agent_id',
  },
  {
    name: 'resumir_atendimento',
    mention: '@Resumir',
    description:
      'Escreve um resumo do atendimento como nota interna. Use antes de transferir para humano ' +
      'e ao encerrar. É o texto que o advogado lê para entrar no caso sem reler a conversa toda.',
    parameters: {
      type: 'object',
      properties: {
        resumo: { type: 'string', description: 'O caso em poucas linhas: quem é, o que houve, o que já foi coletado, o que falta.' },
      },
      required: ['resumo'],
    },
    effect: 'interno',
    risk: 'baixo',
    implemented: true,
    landsOn: 'whatsapp_internal_notes',
  },
  {
    name: 'parar_ia',
    mention: '@PararIA',
    description:
      'Desliga o atendimento automático nesta conversa, sem transferir para ninguém. Use quando ' +
      'o cliente pedir explicitamente para não falar com robô.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Por que está desligando.' },
      },
      required: ['motivo'],
    },
    effect: 'interno',
    risk: 'baixo',
    implemented: true,
    landsOn: 'whatsapp_ai_sessions.status = aborted',
  },

  // ── Ainda não executados pelo runtime ──────────────────────────────
  // Estão aqui para você cortar ou aprovar antes de eu implementar. Todos são
  // de risco alto: mexem em dinheiro, vínculo jurídico ou agenda real.

  {
    name: 'gerar_contrato',
    mention: '@GerarContrato',
    description:
      'Preenche o contrato do escritório com os dados já coletados e o deixa pronto para envio.',
    parameters: {
      type: 'object',
      properties: {
        modelo: { type: 'string', description: 'Nome do modelo de contrato.' },
      },
      required: ['modelo'],
    },
    effect: 'interno',
    risk: 'alto',
    implemented: false,
    landsOn: 'document_templates + template-fill',
  },
  {
    name: 'enviar_link_assinatura',
    mention: '@EnviarAssinatura',
    description:
      'Envia ao cliente o link para assinar digitalmente o contrato já gerado.',
    parameters: {
      type: 'object',
      properties: {
        observacao: { type: 'string', description: 'Mensagem que acompanha o link.' },
      },
    },
    effect: 'cliente',
    risk: 'alto',
    implemented: false,
    landsOn: 'signature_requests + send-signature-link',
  },
  {
    name: 'marcar_reuniao',
    mention: '@MarcarReuniao',
    description:
      'Agenda uma reunião do cliente com o escritório na agenda interna.',
    parameters: {
      type: 'object',
      properties: {
        data_hora: { type: 'string', description: 'Data e hora no fuso do escritório (America/Cuiaba).' },
        assunto: { type: 'string', description: 'Assunto da reunião.' },
      },
      required: ['data_hora', 'assunto'],
    },
    effect: 'interno',
    risk: 'alto',
    implemented: false,
    // ARMADILHA: horário de compromisso é âncora no fuso do escritório
    // (America/Cuiaba, ver src/utils/officeTime.ts), nunca do navegador nem UTC.
    // Marcar com o fuso errado erra a hora e erra em silêncio.
    landsOn: 'calendar_events (fuso-âncora America/Cuiaba)',
  },
  {
    name: 'consultar_processo',
    mention: '@ConsultarProcesso',
    description:
      'Consulta o andamento dos processos do cliente já cadastrado.',
    parameters: {
      type: 'object',
      properties: {
        cpf: { type: 'string', description: 'CPF do cliente.' },
      },
      required: ['cpf'],
    },
    effect: 'leitura',
    risk: 'baixo',
    implemented: false,
    landsOn: 'processes',
  },
];

// ── Consultas ────────────────────────────────────────────────────────

export function findTool(name: string): WaToolDef | null {
  return WA_AGENT_TOOLS.find(t => t.name === name) ?? null;
}

/** Só o que o runtime sabe executar hoje. */
export function implementedTools(): WaToolDef[] {
  return WA_AGENT_TOOLS.filter(t => t.implemented);
}

/**
 * Monta o array de ferramentas no formato de function calling da OpenAI,
 * restrito ao que ESTE agente pode usar. Um gatilho fora da lista simplesmente
 * não é oferecido — a IA não recusa uma ação, ela nem sabe que existe. É a
 * diferença entre "peço para não fazer" e "não dá para fazer".
 */
export function toolsForAgent(allowed: string[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: WaToolParamSchema };
}> {
  const allowSet = new Set(allowed);
  return WA_AGENT_TOOLS
    .filter(t => t.implemented && allowSet.has(t.name))
    .map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

export type WaToolCheck =
  | { ok: true; tool: WaToolDef }
  | { ok: false; reason: string };

/**
 * Porteiro do runtime: roda ANTES de qualquer efeito colateral. Uma IA pode
 * alucinar um nome de função; o que ela não pode é executá-lo.
 */
export function checkToolCall(name: string, allowed: string[]): WaToolCheck {
  const tool = findTool(name);
  if (!tool) return { ok: false, reason: `gatilho "${name}" não existe no catálogo` };
  if (!tool.implemented) return { ok: false, reason: `gatilho "${name}" ainda não está disponível` };
  if (!allowed.includes(name)) return { ok: false, reason: `gatilho "${name}" não está liberado para este agente` };
  return { ok: true, tool };
}

/**
 * Um gatilho precisa de aprovação humana? O modo do canal manda; o risco do
 * gatilho é o piso. Mesmo com o canal em automático, risco alto continua
 * pedindo gente — é a trava que impede um prompt mal calibrado de mandar
 * contrato para assinar sozinho.
 */
export function needsApproval(tool: WaToolDef, channelRequiresApproval: boolean): boolean {
  if (tool.risk === 'alto') return true;
  if (tool.effect === 'leitura') return false;
  return channelRequiresApproval;
}
