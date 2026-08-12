/**
 * Catálogo de ações do Assistente de IA do WhatsApp — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiActionCatalog.ts
 *   supabase/functions/_shared/wa-ai-catalog.ts
 * O `rootDir` do tsconfig é `src/`, então o front não consegue importar de
 * `supabase/functions/` (e o Deno não importa de `src/`) — a mesma saída que
 * `intimationPartyMatch.ts` e `deadlineIntimationMatch.ts` já usam. Ao mexer em
 * um, COPIE O ARQUIVO INTEIRO para o outro: `waAiActionCatalog.test.ts` compara
 * os dois byte a byte e falha se divergirem.
 *
 * SEM IMPORTS de propósito: o `npm test` roda com ts-node/esm, que não resolve
 * import relativo sem extensão em cadeia (ver memória testes-ts-node-imports).
 *
 * O que mora aqui:
 *   1. o catálogo das ações (nome técnico, título, descrição, schema, risco);
 *   2. a montagem das ferramentas enviadas ao modelo (só as permitidas);
 *   3. a validação de cada chamada de ação (allowlist + argumentos + destino);
 *   4. o leitor/compilador das expressões `ação=...` do editor de prompt;
 *   5. o catálogo de provedores e modelos, com custo de referência.
 *
 * O que NÃO mora aqui: qualquer ida ao banco. Nada neste arquivo executa nada —
 * os handlers com efeito colateral vivem na Edge Function.
 */

// ── Limites da execução ─────────────────────────────────────────────────────

/**
 * Teto de chamadas de ação por execução. O modelo pode pedir mais; da quarta em
 * diante o backend recusa. É o que impede um laço de ferramentas de virar dezenas
 * de escritas no banco a partir de uma única mensagem do cliente.
 */
export const WA_AI_MAX_ACTIONS_PER_RUN = 3;

/** Teto de caracteres de cada área de instrução (o que vai no prompt). */
export const WA_AI_MAX_INSTRUCTIONS_CHARS = 8000;

/** Teto de caracteres da resposta enviada ao cliente. */
export const WA_AI_MAX_REPLY_CHARS = 1200;

// ── Tipos do catálogo ───────────────────────────────────────────────────────

/**
 * Risco da ação. Não existe ação de risco alto neste MVP: cadastro de cliente,
 * contrato, movimentação processual e financeira ficaram de fora de propósito.
 */
export type WaAiRisk = 'baixo' | 'medio';

/**
 * De onde o autocomplete do editor tira os registros reais para o parâmetro de
 * destino. 'none' = a ação não tem destino configurável.
 */
export type WaAiTargetSource = 'none' | 'user_or_department' | 'document_template';

export interface WaAiActionParam {
  name: string;
  type: 'string' | 'string[]' | 'integer' | 'enum';
  required: boolean;
  /** Descrição enviada ao modelo. Em português: o prompt inteiro é em português. */
  description: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}

export interface WaAiActionDef {
  /** Nome técnico IMUTÁVEL. É o nome da ferramenta vista pelo modelo. */
  name: string;
  /** Como o administrador escreve a ação no prompt (`ação=<alias>(...)`). */
  alias: string;
  /** Título amigável, mostrado na lista de checkboxes e no resumo do prompt. */
  title: string;
  /** Descrição amigável para o administrador. */
  description: string;
  /** Descrição enviada ao modelo (mais dura, com o que a ação NÃO faz). */
  modelDescription: string;
  risk: WaAiRisk;
  targetSource: WaAiTargetSource;
  /** true = a ação encerra o turno da IA (nada mais é executado depois dela). */
  terminal: boolean;
  params: WaAiActionParam[];
}

/**
 * Referência compilada de uma expressão `ação=...` do prompt. É isto — e não o
 * nome digitado — que o backend usa para resolver o destino de uma ação.
 */
export interface WaAiActionRef {
  action: string;
  target_type: 'user' | 'department' | 'document_template' | 'none';
  target_id: string | null;
  target_label: string;
  /** O trecho exato como aparece no prompt, para o operador se localizar. */
  raw: string;
}

// ── O catálogo ──────────────────────────────────────────────────────────────

/**
 * As oito ações do MVP. Todas apoiadas em funcionalidade que já existe no CRM:
 * transferência (whatsapp_transfers), solicitação de documentos
 * (document_requests), preenchimento/assinatura rastreável
 * (template_fill_links, signature_requests) e o agendador de mensagens.
 *
 * Ficaram DE FORA, por decisão de escopo: cadastro automático de cliente,
 * criação de contrato, alteração processual e movimentação financeira.
 */
export const WA_AI_ACTIONS: WaAiActionDef[] = [
  {
    name: 'transferir_atendimento',
    alias: 'transferir',
    title: 'Transferir atendimento',
    description: 'Encaminha a conversa para uma pessoa ou setor escolhido por você na configuração.',
    modelDescription:
      'Encaminha esta conversa para um atendente ou setor. O destino é limitado à lista fixa do campo "destino" — '
      + 'não invente nomes nem identificadores. Ao usar esta ação a IA para de responder nesta conversa.',
    risk: 'medio',
    targetSource: 'user_or_department',
    terminal: true,
    params: [
      {
        name: 'destino',
        type: 'enum',
        required: true,
        description: 'Destino do encaminhamento. Use exatamente um dos valores oferecidos.',
      },
      {
        name: 'resumo',
        type: 'string',
        required: true,
        description: 'Resumo curto do caso para quem vai assumir o atendimento.',
        minLength: 10,
        maxLength: 800,
      },
    ],
  },
  {
    name: 'solicitar_documentos',
    alias: 'solicitar_documentos',
    title: 'Solicitar documentos',
    description: 'Cria uma solicitação de documentos rastreável para o cliente vinculado à conversa.',
    modelDescription:
      'Cria uma solicitação de documentos para o cliente desta conversa. Use uma vez por conjunto de documentos: '
      + 'se já existe uma solicitação aberta com os mesmos itens, a ação é recusada. '
      + 'Só funciona quando a conversa está vinculada a um cliente.',
    risk: 'medio',
    targetSource: 'none',
    terminal: false,
    params: [
      {
        name: 'documentos',
        type: 'string[]',
        required: true,
        description: 'Nome de cada documento pedido, um por item (ex.: "Carteira de trabalho").',
        minItems: 1,
        maxItems: 10,
        minLength: 2,
        maxLength: 120,
      },
      {
        name: 'prazo_dias',
        type: 'integer',
        required: false,
        description: 'Prazo em dias corridos para o cliente enviar. Omita se não houver prazo.',
        minimum: 1,
        maximum: 90,
      },
    ],
  },
  {
    name: 'enviar_documento',
    alias: 'enviar_documento',
    title: 'Enviar documento para preencher/assinar',
    description: 'Envia ao cliente o link de um modelo escolhido por você (contrato, procuração, kit).',
    modelDescription:
      'Envia ao cliente o link de um dos modelos configurados, para ele preencher e assinar. '
      + 'O modelo é limitado à lista fixa do campo "documento" — não invente nomes. '
      + 'Cada envio gera um link exclusivo daquele cliente; nunca escreva um link você mesmo. '
      + 'O acompanhamento de quem ainda não preencheu é automático: não agende follow-up para isso.',
    risk: 'medio',
    targetSource: 'document_template',
    terminal: false,
    params: [
      {
        name: 'documento',
        type: 'enum',
        required: true,
        description: 'Qual modelo enviar. Use exatamente um dos valores oferecidos.',
      },
      {
        name: 'mensagem',
        type: 'string',
        required: true,
        description: 'Frase curta que acompanha o link, explicando ao cliente o que é e o que fazer. '
          + 'NÃO inclua nenhum link no texto: o sistema anexa o link correto sozinho.',
        minLength: 10,
        maxLength: 400,
      },
    ],
  },
  {
    name: 'consultar_documentos',
    alias: 'consultar_documentos',
    title: 'Consultar documentos do cliente',
    description: 'Lê a situação real dos documentos: recebidos, pendentes ou recusados.',
    modelDescription:
      'Consulta a situação REAL dos documentos do cliente desta conversa. '
      + 'Você NÃO pode afirmar que um documento foi recebido, aprovado ou recusado sem antes chamar esta ação '
      + 'e usar o resultado dela.',
    risk: 'baixo',
    targetSource: 'none',
    terminal: false,
    params: [],
  },
  {
    name: 'consultar_assinatura',
    alias: 'consultar_assinatura',
    title: 'Consultar assinatura de documento',
    description: 'Lê o estado real dos pedidos de assinatura do cliente.',
    modelDescription:
      'Consulta o estado REAL dos pedidos de assinatura do cliente desta conversa. '
      + 'Você NÃO pode afirmar que algo foi assinado, recusado ou está pendente sem antes chamar esta ação '
      + 'e usar o resultado dela.',
    risk: 'baixo',
    targetSource: 'none',
    terminal: false,
    params: [],
  },
  {
    name: 'agendar_followup',
    alias: 'agendar_followup',
    title: 'Agendar acompanhamento',
    description: 'Programa uma retomada do contato dentro da política de follow-up configurada no agente.',
    modelDescription:
      'Agenda UMA retomada de contato com o cliente. O horário é decidido pela política do escritório — '
      + 'você só escreve a mensagem. Se já existe um acompanhamento agendado, a ação é recusada. '
      + 'Não use para cobrar documentos ou assinatura: esses acompanhamentos já são automáticos.',
    risk: 'baixo',
    targetSource: 'none',
    terminal: false,
    params: [
      {
        name: 'mensagem',
        type: 'string',
        required: true,
        description: 'Texto exato que será enviado ao cliente na retomada.',
        minLength: 5,
        maxLength: 800,
      },
      {
        name: 'motivo',
        type: 'string',
        required: false,
        description: 'Por que este acompanhamento é necessário (uso interno, o cliente não vê).',
        maxLength: 200,
      },
    ],
  },
  {
    name: 'cancelar_followup',
    alias: 'cancelar_followup',
    title: 'Cancelar acompanhamento',
    description: 'Cancela os acompanhamentos pendentes desta conversa.',
    modelDescription:
      'Cancela o acompanhamento pendente desta conversa. Use quando o assunto foi resolvido ou o cliente '
      + 'pediu para não ser mais lembrado.',
    risk: 'baixo',
    targetSource: 'none',
    terminal: false,
    params: [
      {
        name: 'motivo',
        type: 'string',
        required: false,
        description: 'Por que o acompanhamento não é mais necessário.',
        maxLength: 200,
      },
    ],
  },
  {
    name: 'transferir_para_humano',
    alias: 'transferir_para_humano',
    title: 'Passar para atendimento humano',
    description: 'Para a IA, registra um resumo e devolve a conversa para a fila de atendimento.',
    modelDescription:
      'Para de responder e devolve a conversa para um atendente humano, com um resumo do caso. '
      + 'Use quando o assunto sair do que você pode resolver, quando o cliente pedir uma pessoa, '
      + 'ou quando você estiver em dúvida. Depois desta ação você não responde mais nesta conversa.',
    risk: 'baixo',
    targetSource: 'none',
    terminal: true,
    params: [
      {
        name: 'resumo',
        type: 'string',
        required: true,
        description: 'Resumo do caso e do que já foi coletado, para quem vai assumir.',
        minLength: 10,
        maxLength: 800,
      },
      {
        name: 'motivo',
        type: 'string',
        required: false,
        description: 'Motivo curto da entrega ao humano.',
        maxLength: 200,
      },
    ],
  },
];

/** Nomes técnicos válidos. Qualquer coisa fora daqui é recusada. */
export const WA_AI_ACTION_NAMES: string[] = WA_AI_ACTIONS.map(a => a.name);

export function getWaAiAction(name: string): WaAiActionDef | null {
  const key = String(name || '').trim();
  return WA_AI_ACTIONS.find(a => a.name === key) || null;
}

/** Resolve tanto o nome técnico quanto o alias curto usado no editor de prompt. */
export function resolveWaAiActionByAlias(alias: string): WaAiActionDef | null {
  const key = String(alias || '').trim().toLowerCase();
  if (!key) return null;
  return WA_AI_ACTIONS.find(a => a.alias === key || a.name === key) || null;
}

/** Normaliza a allowlist gravada no agente: só nomes conhecidos, sem repetição. */
export function normalizeWaAiAllowedActions(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [];
  const out: string[] = [];
  for (const raw of list) {
    const name = String(raw || '').trim();
    if (WA_AI_ACTION_NAMES.indexOf(name) === -1) continue;
    if (out.indexOf(name) === -1) out.push(name);
  }
  return out;
}

// ── Ferramentas enviadas ao modelo ──────────────────────────────────────────

export interface WaAiToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: false;
    };
  };
}

/** Destinos válidos de uma ação, extraídos das referências compiladas. */
export function targetLabelsFor(action: string, refs: WaAiActionRef[]): string[] {
  const out: string[] = [];
  for (const ref of refs || []) {
    if (!ref || ref.action !== action) continue;
    if (!ref.target_id || ref.target_type === 'none') continue;
    const label = String(ref.target_label || '').trim();
    if (label && out.indexOf(label) === -1) out.push(label);
  }
  return out;
}

/**
 * Monta as ferramentas que serão enviadas ao modelo.
 *
 * Só entra o que está na allowlist do agente — ação não selecionada não é sequer
 * mostrada ao modelo. Ação que exige destino e não tem NENHUMA referência
 * compilada também fica de fora: sem destino válido ela só poderia ser
 * executada com um id inventado.
 */
export function buildWaAiTools(allowed: string[], refs: WaAiActionRef[]): WaAiToolSchema[] {
  const allow = normalizeWaAiAllowedActions(allowed);
  const tools: WaAiToolSchema[] = [];

  for (const def of WA_AI_ACTIONS) {
    if (allow.indexOf(def.name) === -1) continue;

    const labels = def.targetSource === 'none' ? [] : targetLabelsFor(def.name, refs || []);
    if (def.targetSource !== 'none' && labels.length === 0) continue;

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const p of def.params) {
      if (p.required) required.push(p.name);
      if (p.type === 'enum') {
        properties[p.name] = { type: 'string', description: p.description, enum: labels };
      } else if (p.type === 'string[]') {
        properties[p.name] = {
          type: 'array',
          description: p.description,
          minItems: p.minItems,
          maxItems: p.maxItems,
          items: { type: 'string', minLength: p.minLength, maxLength: p.maxLength },
        };
      } else if (p.type === 'integer') {
        properties[p.name] = {
          type: 'integer', description: p.description, minimum: p.minimum, maximum: p.maximum,
        };
      } else {
        properties[p.name] = {
          type: 'string', description: p.description, minLength: p.minLength, maxLength: p.maxLength,
        };
      }
    }

    tools.push({
      type: 'function',
      function: {
        name: def.name,
        description: def.modelDescription,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    });
  }

  return tools;
}

// ── Validação das chamadas ──────────────────────────────────────────────────

export type WaAiValidation =
  | { ok: true; action: string; args: Record<string, unknown>; ref: WaAiActionRef | null }
  | { ok: false; error: string };

/** Remove controle e espaço redundante. A mensagem do cliente é conteúdo hostil. */
function cleanText(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // Preserva \n e \t; derruba o resto do bloco de controle.
    if (code === 10 || code === 9) { out += raw[i]; continue; }
    if (code < 32 || code === 127) continue;
    out += raw[i];
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Valida UMA chamada de ação pedida pelo modelo.
 *
 * A ordem importa: allowlist antes de qualquer coisa. Uma ação que o
 * administrador não marcou é recusada mesmo que o modelo a tenha inventado com
 * argumentos perfeitos — a segurança não depende do prompt.
 */
export function validateWaAiActionCall(
  name: string,
  rawArgs: unknown,
  allowed: string[],
  refs: WaAiActionRef[],
): WaAiValidation {
  const def = getWaAiAction(name);
  if (!def) return { ok: false, error: `Ação desconhecida: ${String(name).slice(0, 60)}` };

  const allow = normalizeWaAiAllowedActions(allowed);
  if (allow.indexOf(def.name) === -1) {
    return { ok: false, error: `Ação "${def.name}" não está habilitada neste agente.` };
  }

  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs))
    ? rawArgs as Record<string, unknown>
    : {};

  const out: Record<string, unknown> = {};
  let ref: WaAiActionRef | null = null;

  for (const p of def.params) {
    const provided = args[p.name];
    const missing = provided === undefined || provided === null
      || (typeof provided === 'string' && provided.trim() === '');

    if (missing) {
      if (p.required) return { ok: false, error: `Ação "${def.name}": parâmetro obrigatório "${p.name}" ausente.` };
      continue;
    }

    if (p.type === 'enum') {
      const label = cleanText(provided);
      const match = (refs || []).find(r =>
        r && r.action === def.name && r.target_id && String(r.target_label).trim() === label);
      if (!match) {
        return { ok: false, error: `Ação "${def.name}": destino "${label.slice(0, 80)}" não está entre os destinos configurados.` };
      }
      ref = match;
      out[p.name] = label;
      continue;
    }

    if (p.type === 'string[]') {
      if (!Array.isArray(provided)) {
        return { ok: false, error: `Ação "${def.name}": "${p.name}" deve ser uma lista.` };
      }
      const items: string[] = [];
      for (const item of provided) {
        const text = cleanText(item);
        if (!text) continue;
        if (p.minLength !== undefined && text.length < p.minLength) {
          return { ok: false, error: `Ação "${def.name}": item "${text.slice(0, 40)}" curto demais.` };
        }
        if (p.maxLength !== undefined && text.length > p.maxLength) {
          return { ok: false, error: `Ação "${def.name}": item "${text.slice(0, 40)}…" longo demais.` };
        }
        if (items.indexOf(text) === -1) items.push(text);
      }
      if (p.minItems !== undefined && items.length < p.minItems) {
        return { ok: false, error: `Ação "${def.name}": "${p.name}" precisa de ao menos ${p.minItems} item(ns).` };
      }
      if (p.maxItems !== undefined && items.length > p.maxItems) {
        return { ok: false, error: `Ação "${def.name}": "${p.name}" aceita no máximo ${p.maxItems} itens.` };
      }
      out[p.name] = items;
      continue;
    }

    if (p.type === 'integer') {
      const num = typeof provided === 'number' ? provided : Number(String(provided).trim());
      if (!Number.isFinite(num) || !Number.isInteger(num)) {
        return { ok: false, error: `Ação "${def.name}": "${p.name}" deve ser um número inteiro.` };
      }
      if (p.minimum !== undefined && num < p.minimum) {
        return { ok: false, error: `Ação "${def.name}": "${p.name}" abaixo do mínimo (${p.minimum}).` };
      }
      if (p.maximum !== undefined && num > p.maximum) {
        return { ok: false, error: `Ação "${def.name}": "${p.name}" acima do máximo (${p.maximum}).` };
      }
      out[p.name] = num;
      continue;
    }

    const text = cleanText(provided);
    if (p.minLength !== undefined && text.length < p.minLength) {
      return { ok: false, error: `Ação "${def.name}": "${p.name}" precisa de ao menos ${p.minLength} caracteres.` };
    }
    if (p.maxLength !== undefined && text.length > p.maxLength) {
      out[p.name] = text.slice(0, p.maxLength);
      continue;
    }
    out[p.name] = text;
  }

  // O link de preenchimento é ÚNICO por cliente e quem o gera é o backend. Um
  // modelo que escrevesse um link no texto mandaria o permalink fixo (ou um
  // endereço inventado) — e aí dois clientes preencheriam o mesmo formulário,
  // ou o cliente receberia um link quebrado. A frase de acompanhamento é só
  // texto; o endereço é anexado depois.
  if (def.name === 'enviar_documento' && typeof out.mensagem === 'string' && URL_NO_TEXTO_RE.test(out.mensagem)) {
    return {
      ok: false,
      error: 'Ação "enviar_documento": não escreva links na mensagem. O sistema anexa o link exclusivo do cliente automaticamente.',
    };
  }

  return { ok: true, action: def.name, args: out, ref };
}

/** Endereço escrito no texto: `http(s)://`, `www.` ou o domínio do app. */
export const URL_NO_TEXTO_RE = /(https?:\/\/|www\.|\/#\/preencher\/|jurius\.com\.br)/i;

// ── Editor de prompt: expressões `ação=...` ─────────────────────────────────

export interface WaAiPromptExpression {
  /** Nome técnico resolvido, ou null quando o alias digitado não existe. */
  action: string | null;
  /** O que o administrador escreveu antes do parêntese. */
  alias: string;
  /** O rótulo entre parênteses (vazio quando `ação=algo()`). */
  label: string;
  /** Trecho exato, para destacar na tela. */
  raw: string;
  start: number;
  end: number;
}

/**
 * Gatilho do autocomplete e do compilador. Aceita "ação=" e "acao=" — quem
 * escreve rápido não põe cedilha —, o nome técnico ou o alias curto, e rótulo
 * com espaço e acento. O rótulo não pode conter parêntese nem quebra de linha:
 * é o que mantém a expressão de uma linha só e o compilador previsível.
 */
export const WA_AI_PROMPT_EXPRESSION_RE = /a[çc][ãa]o\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()\n]*)\)/g;

/** Trecho digitado que ainda vai abrir o menu: "ação=" sozinho, no fim do texto. */
export const WA_AI_PROMPT_TRIGGER_RE = /a[çc][ãa]o\s*=\s*([A-Za-z_][A-Za-z0-9_]*)?$/;

export function parseWaAiPromptExpressions(text: string): WaAiPromptExpression[] {
  const source = typeof text === 'string' ? text : '';
  const out: WaAiPromptExpression[] = [];
  const re = new RegExp(WA_AI_PROMPT_EXPRESSION_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const alias = match[1];
    const def = resolveWaAiActionByAlias(alias);
    out.push({
      action: def ? def.name : null,
      alias,
      label: (match[2] || '').trim(),
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}

export interface WaAiPromptIssue {
  /** 'erro' impede salvar; 'aviso' apenas informa. */
  level: 'erro' | 'aviso';
  message: string;
  raw: string;
  start: number;
  end: number;
}

/**
 * Validação do prompt no momento de salvar.
 *
 * Recusa: alias inexistente, ação sem destino quando o destino é obrigatório,
 * destino sem referência compilada (ou seja, nome digitado à mão em vez de
 * escolhido no menu) e destino com rótulo que não bate com nenhuma referência.
 *
 * Nada aqui executa ação alguma — é só leitura de texto.
 */
export function validateWaAiPrompt(
  text: string,
  refs: WaAiActionRef[],
  allowed: string[],
): WaAiPromptIssue[] {
  const issues: WaAiPromptIssue[] = [];
  const allow = normalizeWaAiAllowedActions(allowed);

  for (const expr of parseWaAiPromptExpressions(text)) {
    const base = { raw: expr.raw, start: expr.start, end: expr.end };

    if (!expr.action) {
      issues.push({ ...base, level: 'erro', message: `A ação "${expr.alias}" não existe no catálogo do sistema.` });
      continue;
    }

    const def = getWaAiAction(expr.action)!;

    if (allow.indexOf(def.name) === -1) {
      issues.push({ ...base, level: 'erro', message: `A ação "${def.title}" está escrita no texto mas não está marcada em "Ações disponíveis".` });
    }

    if (def.targetSource === 'none') {
      if (expr.label) {
        issues.push({ ...base, level: 'aviso', message: `A ação "${def.title}" não recebe destino — "${expr.label}" será ignorado.` });
      }
      continue;
    }

    if (!expr.label) {
      issues.push({ ...base, level: 'erro', message: `A ação "${def.title}" está incompleta: falta escolher o destino.` });
      continue;
    }

    const match = (refs || []).find(r =>
      r && r.action === def.name && r.target_id && String(r.target_label).trim() === expr.label);
    if (!match) {
      issues.push({
        ...base,
        level: 'erro',
        message: `"${expr.label}" não foi escolhido no menu de destinos (ou o registro não existe mais). Apague e selecione de novo.`,
      });
    }
  }

  return issues;
}

/**
 * Ações efetivamente citadas no texto — é o que alimenta o resumo "Ações usadas
 * neste prompt" e a marcação automática das checkboxes.
 */
export function actionsUsedInPrompt(text: string): string[] {
  const out: string[] = [];
  for (const expr of parseWaAiPromptExpressions(text)) {
    if (expr.action && out.indexOf(expr.action) === -1) out.push(expr.action);
  }
  return out;
}

/**
 * Descarta referências órfãs: as que não aparecem mais em nenhum dos dois
 * textos. Sem isto, apagar a linha do prompt deixaria o destino compilado
 * valendo em silêncio.
 */
export function pruneWaAiActionRefs(refs: WaAiActionRef[], ...texts: string[]): WaAiActionRef[] {
  const exprs: WaAiPromptExpression[] = [];
  for (const text of texts) exprs.push(...parseWaAiPromptExpressions(text));
  return (refs || []).filter(ref =>
    ref && exprs.some(e => e.action === ref.action && e.label === String(ref.target_label).trim()));
}

// ── Provedores e modelos ────────────────────────────────────────────────────

export type WaAiProviderId = 'openai' | 'groq' | 'anthropic' | 'gemini' | 'grok';

export interface WaAiProviderDef {
  id: WaAiProviderId;
  label: string;
  /**
   * false = o backend não fala com este provedor. O motivo aparece na tela, em
   * vez de o provedor simplesmente não existir e ninguém saber por quê.
   */
  available: boolean;
  unavailableReason?: string;
}

/**
 * O backend do assistente fala UM protocolo: chat completions no formato
 * OpenAI, com tool calling. OpenAI e Groq atendem por esse mesmo caminho e são
 * os dois provedores cujas chaves já existem no projeto (ver check-env-keys).
 *
 * Anthropic, Gemini e Grok não entram no MVP porque cada um exige um segundo
 * cliente HTTP e um segundo formato de ferramenta — subsistema novo, não reuso.
 */
export const WA_AI_PROVIDERS: WaAiProviderDef[] = [
  { id: 'openai', label: 'OpenAI', available: true },
  { id: 'groq', label: 'Groq', available: true },
  { id: 'anthropic', label: 'Anthropic (Claude)', available: false, unavailableReason: 'Formato de ferramentas próprio; fora do MVP.' },
  { id: 'gemini', label: 'Google (Gemini)', available: false, unavailableReason: 'Formato de ferramentas próprio; fora do MVP.' },
  { id: 'grok', label: 'xAI (Grok)', available: false, unavailableReason: 'Sem chave configurada no projeto.' },
];

export interface WaAiModelDef {
  provider: WaAiProviderId;
  id: string;
  label: string;
  /** Custo de referência em dólares por 1 milhão de tokens de ENTRADA. */
  inputCostPerMTok: number;
  /** Custo de referência em dólares por 1 milhão de tokens de SAÍDA. */
  outputCostPerMTok: number;
  /** Um só modelo é o recomendado; os outros trazem o porquê de não serem. */
  recommended?: boolean;
  notes: string;
}

/**
 * Preços de REFERÊNCIA, em dólares por milhão de tokens, anotados em 11/08/2026.
 * Servem para comparar modelos na hora de escolher — não são fatura. O provedor
 * muda a tabela quando quer; a estimativa na tela diz isso.
 */
export const WA_AI_MODELS_PRICED_AT = '2026-08-11';

export const WA_AI_MODELS: WaAiModelDef[] = [
  {
    provider: 'openai',
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    inputCostPerMTok: 0.15,
    outputCostPerMTok: 0.60,
    recommended: true,
    notes: 'O equilíbrio do MVP: segue instrução longa, chama ferramenta com precisão e custa pouco por conversa.',
  },
  {
    provider: 'openai',
    id: 'gpt-4o',
    label: 'GPT-4o',
    inputCostPerMTok: 2.50,
    outputCostPerMTok: 10.00,
    notes: 'Cerca de 16x o custo do mini. Vale quando a triagem exige interpretar relato jurídico confuso.',
  },
  {
    provider: 'openai',
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    inputCostPerMTok: 0.40,
    outputCostPerMTok: 1.60,
    notes: 'Segue instrução com mais rigor que o 4o mini, por um custo intermediário.',
  },
  {
    provider: 'groq',
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B (Groq)',
    inputCostPerMTok: 0.59,
    outputCostPerMTok: 0.79,
    notes: 'Resposta muito rápida. Chamada de ferramenta menos consistente — combina com modo de teste antes do automático.',
  },
  {
    provider: 'groq',
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B (Groq)',
    inputCostPerMTok: 0.05,
    outputCostPerMTok: 0.08,
    notes: 'O mais barato da lista. Erra mais em instrução longa; use só em fluxo curto e bem delimitado.',
  },
];

export function listWaAiModels(provider?: WaAiProviderId): WaAiModelDef[] {
  return provider ? WA_AI_MODELS.filter(m => m.provider === provider) : WA_AI_MODELS.slice();
}

export function getWaAiModel(provider: string, model: string): WaAiModelDef | null {
  return WA_AI_MODELS.find(m => m.provider === provider && m.id === model) || null;
}

/**
 * Allowlist de modelo. Vale nos dois lados: a tela só oferece o que está aqui e
 * o backend recusa rodar com um par provedor/modelo fora da lista — um agente
 * gravado antes de um modelo sair da lista não continua chamando um endpoint
 * que ninguém revisou.
 */
export function isWaAiModelAllowed(provider: string, model: string): boolean {
  const def = getWaAiModel(provider, model);
  if (!def) return false;
  const prov = WA_AI_PROVIDERS.find(p => p.id === def.provider);
  return !!prov && prov.available;
}

export const WA_AI_DEFAULT_PROVIDER: WaAiProviderId = 'openai';
export const WA_AI_DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Estimativa de custo de UM turno, em dólares. A conta é trivial de propósito:
 * o valor existe para dar ordem de grandeza na hora de escolher o modelo.
 */
export function estimateWaAiTurnCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const def = getWaAiModel(provider, model);
  if (!def) return null;
  const input = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const output = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  return (input / 1_000_000) * def.inputCostPerMTok + (output / 1_000_000) * def.outputCostPerMTok;
}

/**
 * Turno típico deste assistente: as instruções, o resumo da memória e uma dúzia
 * de mensagens curtas na entrada; uma resposta de WhatsApp na saída. Usado só
 * para mostrar "≈ US$ X por 100 atendimentos" ao lado de cada modelo.
 */
export const WA_AI_TYPICAL_TURN_INPUT_TOKENS = 1800;
export const WA_AI_TYPICAL_TURN_OUTPUT_TOKENS = 220;
