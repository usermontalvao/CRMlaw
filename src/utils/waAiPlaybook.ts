/**
 * O ROTEIRO da triagem — configuração lida pelo backend.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiPlaybook.ts
 *   supabase/functions/_shared/wa-ai-playbook.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiPlaybook.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports. É por isso que
 * o pedaço de leitura de data aparece aqui outra vez, menor: `wa-ai-now.ts` faz
 * a conta das janelas para o PROMPT, este arquivo faz para o VEREDITO.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * A campanha "Sem registro na carteira" vivia inteira dentro de
 * `instructions_do`: treze informações a descobrir, três cortes e oito
 * requisitos cumulativos, tudo em prosa, tudo dependendo de o modelo ler certo.
 * O resultado está no log: nomes de campo diferentes a cada turno, pendência
 * respondida voltando para a fila e, o pior, o corte dos dois anos entregue a
 * quem não sabe que dia é hoje.
 *
 * A divisão que este arquivo estabelece, e que não pode se perder:
 *   - O MODELO devolve texto e valores — `mensagem_cliente`, `atualizacoes`,
 *     `campo_alvo` (ver `waAiTriageReply.ts`);
 *   - O BACKEND calcula `pendencias`, `etapa_atual` e `desqualificado`. O corte
 *     descarta um cliente: é conta, e conta não se pede, se faz;
 *   - O ROTEIRO é dado — etapas, campos com tipo e obrigatoriedade, regras de
 *     corte. Fechar a lista de chaves no schema é o que mata a deriva de nomes
 *     na origem, em vez de remendá-la depois (ver `waAiTriageFacts.ts`, que
 *     continua embaixo como rede: obrigar o modelo a preencher a forma não o
 *     obriga a ler certo — ele gravou 01/2025 para quem disse 2020).
 *
 * As AÇÕES não moram aqui. Elas continuam sendo tool call, porque é o tool call
 * que passa por `validateWaAiActionCall`, pelo destino compilado no backend e
 * pelo teto de três por execução.
 */

// ── Tetos ───────────────────────────────────────────────────────────────────

export const WA_AI_PLAYBOOK_MAX_FIELDS = 40;
export const WA_AI_PLAYBOOK_MAX_STAGES = 12;
export const WA_AI_PLAYBOOK_MAX_CUTS = 8;
export const WA_AI_PLAYBOOK_MAX_OPTIONS = 12;
export const WA_AI_PLAYBOOK_KEY_MAX_CHARS = 40;
export const WA_AI_PLAYBOOK_TEXT_MAX_CHARS = 200;

/** O valor que significa "o cliente ainda não disse". Ver `buildWaAiTriageSchema`. */
export const WA_AI_VAZIO = '';

// ── Forma do roteiro ────────────────────────────────────────────────────────

/**
 * O tipo diz como o valor é lido, não só como é exibido.
 *   `data_mes_ano` vira `MM/AAAA` e é o único que as regras de prazo aceitam;
 *   `bool` só existe como `sim`/`não`;
 *   `enum` só aceita uma das opções declaradas;
 *   `texto` é o que sobra — guardado como veio, sem interpretação.
 */
export type WaAiFieldType = 'data_mes_ano' | 'bool' | 'enum' | 'texto';

/** Um campo só é perguntado quando a condição vale (saída, se já saiu). */
export interface WaAiFieldCondition {
  field: string;
  value: string;
}

export interface WaAiPlaybookField {
  /** Chave canônica. É ela que entra no schema e no painel. */
  key: string;
  /** Nome curto para o painel. */
  label: string;
  type: WaAiFieldType;
  /** Só para `enum`. */
  options?: string[];
  /** Obrigatório entra na lista de pendências enquanto estiver vazio. */
  required: boolean;
  /** O texto da pendência, na voz de quem espera: "mês e ano de início". */
  ask: string;
  /**
   * A PERGUNTA, com as palavras que vão ao cliente.
   *
   * Mora aqui, e não numa seção de prosa, porque é aqui que ela serve: o
   * backend já sabe qual é o próximo campo, então entrega a frase pronta em vez
   * de esperar que o modelo ache a certa numa lista de exemplos. Sem ela, o
   * modelo escreve a pergunta com as próprias palavras — o que continua
   * valendo, só não é mais o padrão.
   */
  question?: string;
  /** Quando existir, o campo só é perguntado se a condição valer. */
  onlyWhen?: WaAiFieldCondition;
}

export interface WaAiPlaybookStage {
  id: string;
  label: string;
  /** Chaves de campo, na ordem em que se pergunta. */
  fields: string[];
}

/**
 * As regras de corte, declarativas de propósito: o backend as avalia, o modelo
 * apenas lê o veredito pronto.
 *
 *   `field_equals`  — o campo é uma das opções listadas (órgão público);
 *   `older_than`    — a data é mais velha que a janela (os dois anos);
 *   `all_equal`     — todos os campos têm o mesmo valor (sem prova E sem
 *                     testemunha; um só não corta).
 */
export type WaAiCutRule =
  | { kind: 'field_equals'; field: string; values: string[] }
  | { kind: 'older_than'; field: string; years: number }
  | { kind: 'all_equal'; fields: string[]; value: string };

export interface WaAiPlaybookCut {
  id: string;
  rule: WaAiCutRule;
  /** `disqualify` encerra o atendimento; `handoff` manda para gente. */
  effect: 'disqualify' | 'handoff';
  /** Por que o caso saiu — vai para o painel e para o resumo de transferência. */
  reason: string;
  /** O que o agente faz agora. Entra no prompt como ordem, não como cálculo. */
  guidance: string;
}

export interface WaAiPlaybook {
  id: string;
  label: string;
  /**
   * A primeira mensagem da conversa, quando não há histórico nenhum.
   *
   * Estas três — abertura, estilo e fechamento — existem para que o "o que este
   * agente deve fazer" não precise repetir, em prosa, o que o roteiro já
   * organiza. O prompt do agente é MONTADO a partir daqui
   * (`waAiPlaybookInstructions`); o texto livre continua existindo para o que
   * não couber em campo nenhum.
   */
  opening?: string;
  /** Como conversar: uma regra por linha, na voz de quem instrui. */
  style?: string[];
  /** O que fazer quando o roteiro fecha sem corte: documentos, resumo, entrega. */
  closing?: string;
  fields: WaAiPlaybookField[];
  stages: WaAiPlaybookStage[];
  cuts: WaAiPlaybookCut[];
}

// ── O roteiro da campanha em produção ───────────────────────────────────────

/**
 * "Trabalhou sem registro na carteira" — o mesmo conteúdo que hoje está escrito
 * em prosa dentro de `instructions_do` do agente `509cc5cf…`, agora em forma de
 * dado.
 *
 * As instruções de texto CONTINUAM valendo: elas dizem como conversar, com que
 * palavras perguntar e o que nunca prometer. O que sai delas e vem para cá é só
 * o que precisa ser contado ou conferido — que é justamente o que um modelo
 * pequeno não faz de forma confiável.
 */
export const WA_AI_PLAYBOOK_SEM_REGISTRO: WaAiPlaybook = {
  id: 'sem_registro_carteira',
  label: 'Trabalhou sem registro na carteira',
  opening: 'Olá! Tudo bem? Vou fazer algumas perguntas rápidas para entender melhor o seu caso.\n\n'
    + 'Para começar, qual é o seu nome?',
  style: [
    'Uma pergunta por vez. Sempre. Espere a resposta antes da próxima.',
    'Mensagens curtas, como gente digitando no WhatsApp. Nada de parágrafo longo nem lista numerada para o cliente.',
    'Depois que souber o nome, use o nome naturalmente.',
    'Reaja ao que a pessoa contou antes de perguntar outra coisa — "entendi", "certo", "puxa, situação chata mesmo". Curto, sem drama e sem exagero.',
    'Nunca pergunte o que ela já respondeu. Se vierem duas ou mais informações de uma vez, aproveite todas e registre cada uma no campo correspondente.',
    'Se a resposta vier vaga, incompleta, confusa ou contraditória, pergunte de outro jeito antes de registrar qualquer coisa.',
    'Fale como o cliente fala. Nada de "vínculo empregatício", "pessoalidade", "habitualidade" ou "subordinação" na conversa com ele.',
    'Se perguntarem quanto vão receber, quanto demora, qual o valor da ação ou se vão ganhar, diga que isso precisa ser avaliado pelo advogado depois de analisar o caso, e siga a triagem.',
    'Não diga que a pessoa "tem direito", "vai ganhar" ou que o caso está ganho.',
    'Analise um empregador por vez. Não misture datas, pagamentos, rotina, provas ou testemunhas de empresas diferentes.',
  ],
  closing: 'Peça os documentos: diga em uma frase que o caso pode ser encaminhado para análise e que '
    + 'você vai precisar de alguns documentos, que podem ser enviados por ali mesmo. Depois registre '
    + 'ação=solicitar_documentos(), listando documento de identificação com foto, CTPS Digital e '
    + 'as provas que a própria pessoa disse possuir. Não invente documentos ou provas que ela não '
    + 'mencionou.\n'
    + 'Ela pode mandar os documentos um por vez ou todos juntos. Antes de afirmar que um documento '
    + 'chegou, está faltando ou já foi enviado, sempre confira por ação=consultar_documentos() — '
    + 'nunca diga que recebeu algo porque lembra da conversa. Se faltar documento, peça só o que '
    + 'falta, um item por vez.\n'
    + 'Quando os documentos possíveis tiverem sido recebidos ou registrados como pendentes, avise em '
    + 'uma frase curta que vai passar o caso para a equipe e faça ação=transferir(Atendimento).\n'
    + 'No resumo escreva, em até 800 caracteres, nesta ordem e sem enfeite:\n'
    + 'Nome | Empresa | Período | Ainda trabalha | Função | Salário aprox. | Dias e horário | '
    + 'CTPS não assinada | Pessoalidade, pagamento, habitualidade e subordinação | Testemunha | '
    + 'Provas que tem | Provas recebidas | Documentos pendentes | Observações | STATUS: LEAD QUALIFICADO\n'
    + 'Só escreva LEAD QUALIFICADO com todos estes pontos confirmados ao mesmo tempo: era a própria '
    + 'pessoa que precisava trabalhar; recebia pelo serviço; trabalhava com regularidade, e não de vez '
    + 'em quando; alguém determinava tarefas, horários ou cobrava o serviço; a carteira não foi '
    + 'assinada; existe pelo menos uma prova ou uma testemunha. Se algum ponto ficar duvidoso, faça '
    + 'uma pergunta curta para esclarecer antes de decidir — "trabalhei sem carteira" não qualifica o '
    + 'caso sozinho.',
  fields: [
    {
      key: 'nome', label: 'Nome', type: 'texto', required: true, ask: 'o nome do cliente',
      question: 'Para começar, qual é o seu nome?',
    },
    {
      key: 'empregador', label: 'Empregador', type: 'texto', required: true,
      ask: 'para quem trabalhou (empresa ou pessoa)',
      question: 'Para qual empresa ou pessoa você trabalhou sem registro?',
    },
    {
      key: 'tipo_empregador', label: 'Tipo de empregador', type: 'enum',
      options: ['particular', 'publico'], required: true,
      ask: 'se o empregador é particular ou órgão público',
      question: 'Esse trabalho era para uma empresa particular ou para prefeitura, estado, órgão público ou empresa pública?',
    },
    {
      key: 'inicio', label: 'Início', type: 'data_mes_ano', required: true,
      ask: 'mês e ano em que começou',
      question: 'Em que mês e ano você começou a trabalhar lá?',
    },
    {
      key: 'ainda_trabalha', label: 'Ainda trabalha lá', type: 'bool', required: true,
      ask: 'se ainda trabalha lá',
      question: 'Você ainda trabalha lá ou já saiu?',
    },
    {
      key: 'saida', label: 'Saída', type: 'data_mes_ano', required: true,
      ask: 'mês e ano da saída',
      question: 'Em que mês e ano você saiu?',
      onlyWhen: { field: 'ainda_trabalha', value: 'não' },
    },
    {
      key: 'pessoalidade', label: 'Tinha de ser ela', type: 'bool', required: true,
      ask: 'se era ela mesma que precisava trabalhar ou podia mandar outra pessoa',
      question: 'Era você mesmo que tinha que ir trabalhar ou, se quisesse, podia mandar outra pessoa no seu lugar?',
    },
    {
      key: 'pagamento', label: 'Pagamento', type: 'texto', required: true,
      ask: 'se recebia pelo serviço, quanto e como era pago',
      question: 'Você recebia por esse trabalho? Se sim, mais ou menos quanto, e como eles te pagavam?',
    },
    {
      key: 'habitualidade', label: 'Rotina', type: 'texto', required: true,
      ask: 'quantos dias por semana, quais dias e quais horários',
      question: 'Você trabalhava quantos dias por semana, e mais ou menos em que horário?',
    },
    {
      key: 'subordinacao', label: 'Quem mandava', type: 'bool', required: true,
      ask: 'se alguém passava as tarefas, cobrava o serviço ou definia o horário',
      question: 'Tinha alguém que passava o que você precisava fazer ou cobrava o serviço?',
    },
    {
      key: 'tem_prova', label: 'Tem prova', type: 'bool', required: true,
      ask: 'se tem alguma prova desse trabalho',
      question: 'Você tem alguma prova desse trabalho? Pode ser Pix ou comprovante de pagamento, conversa de WhatsApp, foto ou vídeo trabalhando, crachá, uniforme ou algum papel da empresa.',
    },
    {
      key: 'provas', label: 'Quais provas', type: 'texto', required: true,
      ask: 'quais provas ela tem',
      question: 'Quais dessas você tem guardadas?',
      onlyWhen: { field: 'tem_prova', value: 'sim' },
    },
    {
      key: 'tem_testemunha', label: 'Tem testemunha', type: 'bool', required: true,
      ask: 'se tem alguém que possa testemunhar',
      question: 'E tem alguém que trabalhou com você ou via sua rotina, que poderia servir de testemunha?',
    },
    {
      key: 'outros_trabalhos', label: 'Outro sem carteira', type: 'bool', required: false,
      ask: 'se teve outro trabalho sem carteira',
      question: 'Você teve algum outro trabalho sem carteira assinada além desse?',
    },
  ],
  stages: [
    { id: 'identificacao', label: 'Quem é e para quem trabalhou', fields: ['nome', 'empregador', 'tipo_empregador'] },
    { id: 'periodo', label: 'Período do trabalho', fields: ['inicio', 'ainda_trabalha', 'saida'] },
    { id: 'vinculo', label: 'Como era o trabalho', fields: ['pessoalidade', 'pagamento', 'habitualidade', 'subordinacao'] },
    { id: 'provas', label: 'Provas e testemunhas', fields: ['tem_prova', 'provas', 'tem_testemunha'] },
    { id: 'fechamento', label: 'Fechamento', fields: ['outros_trabalhos'] },
  ],
  cuts: [
    {
      id: 'orgao_publico',
      rule: { kind: 'field_equals', field: 'tipo_empregador', values: ['publico'] },
      effect: 'handoff',
      reason: 'empregador é órgão público — análise específica',
      guidance: 'Pare a triagem. Não diga se a pessoa tem ou não tem direito, não peça documentos, '
        + 'explique em uma frase que esse tipo de situação precisa de análise específica por advogado '
        + 'e transfira para o Atendimento, marcando no resumo STATUS: ANÁLISE ESPECÍFICA — ÓRGÃO PÚBLICO.',
    },
    {
      id: 'prazo_2_anos',
      rule: { kind: 'older_than', field: 'saida', years: 2 },
      effect: 'disqualify',
      reason: 'saiu há mais de dois anos',
      guidance: 'Pare a triagem AGORA: não pergunte mais nada, não peça documentos e não trate como '
        + 'lead qualificado. Informe de forma curta e educada que, pela data em que esse trabalho '
        + 'terminou, o caso ficou fora do período analisado pelo escritório, e encerre. Se a pessoa '
        + 'insistir, discordar ou pedir para falar com alguém, transfira para Pedro Rodrigues '
        + 'Montalvao Neto.',
    },
    {
      id: 'sem_prova_nem_testemunha',
      rule: { kind: 'all_equal', fields: ['tem_prova', 'tem_testemunha'], value: 'não' },
      effect: 'disqualify',
      reason: 'sem prova e sem testemunha',
      guidance: 'Pare a triagem. Não peça documentos pessoais e não trate como lead qualificado. '
        + 'Encerre de forma educada, sem dizer que o caso é fraco ou que falta prova.',
    },
  ],
};

// ── Texto ───────────────────────────────────────────────────────────────────

/** Sem acento e em minúsculas: é a forma em que as comparações abaixo casam. */
function simples(text: unknown): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function chaveNormalizada(key: unknown): string {
  return simples(key)
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, WA_AI_PLAYBOOK_KEY_MAX_CHARS);
}

function textoAparado(value: unknown, max = WA_AI_PLAYBOOK_TEXT_MAX_CHARS): string {
  const t = String(value ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Igual ao anterior, mas PRESERVANDO as quebras de linha.
 *
 * A abertura da campanha são duas mensagens — saudação, linha em branco,
 * pergunta —, e é a linha em branco que `splitWaAiReply` lê para mandar as duas
 * separadas. Colapsar espaço em branco aqui transformaria a abertura numa bolha
 * só, calada, sem ninguém notar até ver a conversa do cliente.
 */
function textoLongo(value: unknown, max: number): string {
  const t = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(linha => linha.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── Datas ───────────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4,
  mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8,
  set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11,
  dez: 12, dezembro: 12,
};

// Os nomes longos vêm antes na alternância: senão `jan` casa e `janeiro` fica
// com o "eiro" sobrando, e o `$` do fim reprova a data inteira.
const NOMES_DE_MES = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');

/**
 * O que conta como mês e ano.
 *
 * Aceitar só `MM/AAAA` seria mais limpo e estaria errado: o schema pede esse
 * formato, mas o modelo devolve "Janeiro de 2020" quando o cliente escreve
 * assim, e um campo de data que não reconhece o próprio valor fica pendente
 * para sempre — o agente perguntaria a mesma coisa a cada turno, que é o
 * defeito que este arquivo existe para acabar.
 */
const RE_MES_ANO = new RegExp(
  '^(?:'
  + '(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})'      // 05/01/2020
  + '|(\\d{1,2})[\\/.-](\\d{4})'                        // 01/2020
  + `|(${NOMES_DE_MES})(?:\\s+de)?[\\s\\/.-]+(\\d{4})`     // janeiro de 2020
  + ')$');

interface MesAno { mes: number; ano: number }

function lerMesAno(valor: unknown): MesAno | null {
  const m = RE_MES_ANO.exec(simples(valor));
  if (!m) return null;
  const mes = m[3] ? Number(m[2]) : (m[5] ? Number(m[4]) : MESES[m[6]]);
  const ano = Number(m[3] || m[5] || m[7]);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) return null;
  return { mes, ano };
}

/** O dia no fuso do escritório, não no do servidor (que roda em UTC). */
function hojeNoFuso(agora: Date, timeZone: string): { ano: number; mes: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
  const [ano, mes] = partes.split('-').map(Number);
  return { ano, mes };
}

/**
 * O mês inteiro conta A FAVOR do cliente.
 *
 * É a mesma regra que já está escrita no prompt e que o modelo aplicou errado:
 * quem diz "agosto de 2024" com a data de corte em 12/08/2024 está DENTRO da
 * janela, porque parte daquele mês ainda está dentro. Só fica de fora o mês que
 * terminou por inteiro antes do corte — daí a comparação ser estrita e por
 * (ano, mês), sem dia nenhum no meio.
 */
function maisVelhoQue(valor: string, anos: number, agora: Date, timeZone: string): boolean {
  const data = lerMesAno(valor);
  if (!data) return false;
  const hoje = hojeNoFuso(agora, timeZone);
  const corte = { ano: hoje.ano - anos, mes: hoje.mes };
  return data.ano < corte.ano || (data.ano === corte.ano && data.mes < corte.mes);
}

// ── Valores ─────────────────────────────────────────────────────────────────

const SIM = /^(sim|s|isso|isso mesmo|exato|exatamente|correto|certo|positivo|verdade|true|ativo|continuo|ainda)\b/;
const NAO = /^(nao|n|negativo|false|ja sai|sai|saiu|encerrado|inativo|nunca)\b/;

/**
 * O valor na forma que o tipo do campo exige.
 *
 * Devolve vazio quando o valor NÃO SERVE para o campo: enum fora das opções,
 * data que não é mês e ano, bool que não é sim nem não. Vazio quer dizer "ainda
 * não foi respondido", então o campo volta para a fila e a pergunta é refeita.
 * É de propósito: perguntar de novo custa uma mensagem, mas um "prefeitura"
 * guardado num campo que só entende `publico` deixaria o corte de órgão público
 * sem disparar, calado, com a triagem seguindo em frente.
 */
export function normalizeWaAiPlaybookValue(field: WaAiPlaybookField, value: unknown): string {
  const bruto = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!bruto) return WA_AI_VAZIO;

  if (field.type === 'data_mes_ano') {
    const data = lerMesAno(bruto);
    return data ? `${String(data.mes).padStart(2, '0')}/${data.ano}` : WA_AI_VAZIO;
  }

  if (field.type === 'bool') {
    const s = simples(bruto);
    if (NAO.test(s)) return 'não';
    if (SIM.test(s)) return 'sim';
    return WA_AI_VAZIO;
  }

  if (field.type === 'enum') {
    const s = simples(bruto);
    const achada = (field.options || []).find(opt => simples(opt) === s);
    return achada || WA_AI_VAZIO;
  }

  return bruto;
}

// ── Leitura do roteiro ──────────────────────────────────────────────────────

export function waAiPlaybookField(playbook: WaAiPlaybook, key: string): WaAiPlaybookField | null {
  const alvo = chaveNormalizada(key);
  return playbook.fields.find(f => f.key === alvo) || null;
}

/** As chaves na ordem das etapas — é esta ordem que vira pergunta e pendência. */
export function waAiPlaybookFieldKeys(playbook: WaAiPlaybook): string[] {
  const out: string[] = [];
  for (const stage of playbook.stages) {
    for (const key of stage.fields) {
      if (out.indexOf(key) === -1 && waAiPlaybookField(playbook, key)) out.push(key);
    }
  }
  // Campo declarado e esquecido em toda etapa continua existindo para o schema:
  // fora do schema, ele volta a ser uma chave inventada pelo modelo.
  for (const field of playbook.fields) {
    if (out.indexOf(field.key) === -1) out.push(field.key);
  }
  return out;
}

/** O campo está em jogo neste momento? (`saida` só existe para quem já saiu.) */
function campoVale(playbook: WaAiPlaybook, field: WaAiPlaybookField, facts: Record<string, string>): boolean {
  if (!field.onlyWhen) return true;
  const dono = waAiPlaybookField(playbook, field.onlyWhen.field);
  if (!dono) return true;
  const atual = normalizeWaAiPlaybookValue(dono, facts[dono.key]);
  return atual !== WA_AI_VAZIO && simples(atual) === simples(field.onlyWhen.value);
}

/** O valor guardado, já validado contra o tipo. Vazio = não respondido. */
function valorDoCampo(field: WaAiPlaybookField, facts: Record<string, string>): string {
  return normalizeWaAiPlaybookValue(field, facts[field.key]);
}

// ── Cortes ──────────────────────────────────────────────────────────────────

export interface WaAiTriageCut {
  id: string;
  effect: 'disqualify' | 'handoff';
  reason: string;
  guidance: string;
}

/**
 * O primeiro corte que dispara, ou nada.
 *
 * A ordem é a do roteiro: `orgao_publico` antes de `prazo_2_anos` porque é a
 * ordem em que as perguntas acontecem, e porque um caso de órgão público vai
 * para gente mesmo tendo saído ontem.
 *
 * Uma regra só dispara com o dado presente e VÁLIDO. Campo vazio nunca corta —
 * quem ainda não respondeu não pode ser descartado por causa da resposta que
 * não deu.
 */
export function evaluateWaAiCuts(
  playbook: WaAiPlaybook,
  facts: Record<string, string>,
  agora: Date,
  timeZone: string,
): WaAiTriageCut | null {
  for (const cut of playbook.cuts) {
    if (!disparou(playbook, cut.rule, facts, agora, timeZone)) continue;
    return { id: cut.id, effect: cut.effect, reason: cut.reason, guidance: cut.guidance };
  }
  return null;
}

function disparou(
  playbook: WaAiPlaybook,
  rule: WaAiCutRule,
  facts: Record<string, string>,
  agora: Date,
  timeZone: string,
): boolean {
  if (rule.kind === 'field_equals') {
    const field = waAiPlaybookField(playbook, rule.field);
    if (!field) return false;
    const valor = valorDoCampo(field, facts);
    if (!valor) return false;
    return rule.values.some(v => simples(v) === simples(valor));
  }

  if (rule.kind === 'older_than') {
    const field = waAiPlaybookField(playbook, rule.field);
    if (!field || field.type !== 'data_mes_ano') return false;
    const valor = valorDoCampo(field, facts);
    if (!valor) return false;
    return maisVelhoQue(valor, rule.years, agora, timeZone);
  }

  // Todos, e não qualquer um: "sem prova OU sem testemunha" descartaria metade
  // dos casos bons — basta uma das duas para o requisito ficar de pé.
  const campos = rule.fields
    .map(k => waAiPlaybookField(playbook, k))
    .filter((f): f is WaAiPlaybookField => !!f);
  if (campos.length === 0 || campos.length !== rule.fields.length) return false;
  return campos.every(f => {
    const valor = valorDoCampo(f, facts);
    return valor !== WA_AI_VAZIO && simples(valor) === simples(rule.value);
  });
}

// ── Progresso ───────────────────────────────────────────────────────────────

export interface WaAiTriageProgress {
  /** A etapa em que a conversa está. Null quando não há mais o que perguntar. */
  stage: string | null;
  stageLabel: string | null;
  /** As chaves obrigatórias ainda vazias, na ordem do roteiro. */
  missing: string[];
  /** As mesmas, já no texto que vira a lista de espera e a retomada. */
  pending: string[];
  /** A próxima chave a perguntar — uma só. */
  nextField: string | null;
  /** O veredito. Quando existe, não há mais pergunta a fazer. */
  cut: WaAiTriageCut | null;
  /** Todos os campos obrigatórios em jogo estão preenchidos e nenhum corte disparou. */
  complete: boolean;
}

/**
 * Onde a triagem está — calculado, nunca perguntado ao modelo.
 *
 * Quando um corte dispara, a lista de pendências fica VAZIA de propósito: é ela
 * que o acompanhamento lê para escrever a retomada, e cobrar o horário de
 * trabalho de quem acabou de ser dispensado pelo prazo seria a pior mensagem
 * que este agente poderia mandar.
 */
export function computeWaAiTriageProgress(input: {
  playbook: WaAiPlaybook;
  facts: Record<string, string> | null | undefined;
  now?: Date;
  timeZone?: string;
}): WaAiTriageProgress {
  const playbook = input.playbook;
  const facts = input.facts || {};
  const agora = input.now instanceof Date ? input.now : new Date();
  const timeZone = input.timeZone || 'America/Cuiaba';

  const cut = evaluateWaAiCuts(playbook, facts, agora, timeZone);
  if (cut) {
    return {
      stage: null, stageLabel: null, missing: [], pending: [], nextField: null, cut, complete: false,
    };
  }

  const missing: string[] = [];
  const pending: string[] = [];
  let stage: WaAiPlaybookStage | null = null;

  for (const etapa of playbook.stages) {
    for (const key of etapa.fields) {
      const field = waAiPlaybookField(playbook, key);
      if (!field || !field.required) continue;
      if (!campoVale(playbook, field, facts)) continue;
      if (valorDoCampo(field, facts)) continue;
      if (!stage) stage = etapa;
      missing.push(field.key);
      if (pending.indexOf(field.ask) === -1) pending.push(field.ask);
    }
  }

  return {
    stage: stage ? stage.id : null,
    stageLabel: stage ? stage.label : null,
    missing,
    pending,
    nextField: missing.length > 0 ? missing[0] : null,
    cut: null,
    complete: missing.length === 0,
  };
}

// ── Schema do modelo ────────────────────────────────────────────────────────

export interface WaAiTriageSchema {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
}

function descricaoDoCampo(field: WaAiPlaybookField): string {
  const base = `${field.label}: ${field.ask}.`;
  if (field.type === 'data_mes_ano') return `${base} Formato MM/AAAA.`;
  if (field.onlyWhen) return `${base} Só se aplica quando ${field.onlyWhen.field} = ${field.onlyWhen.value}.`;
  return base;
}

function esquemaDoCampo(field: WaAiPlaybookField): Record<string, unknown> {
  const description = descricaoDoCampo(field);
  if (field.type === 'bool') {
    return { type: 'string', enum: [WA_AI_VAZIO, 'sim', 'não'], description };
  }
  if (field.type === 'enum') {
    return { type: 'string', enum: [WA_AI_VAZIO, ...(field.options || [])], description };
  }
  return { type: 'string', description };
}

/**
 * O contrato de resposta — `response_format: {type:'json_schema', strict:true}`.
 *
 * Ferramenta é OPCIONAL para o modelo; formato de resposta não é. Esta é a
 * diferença que motivou o arquivo inteiro: `registrar_memoria` foi chamada duas
 * vezes numa conversa de trinta turnos, e o que ela não trouxe simplesmente não
 * existiu.
 *
 * DUAS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. `atualizacoes` tem PROPRIEDADES FIXAS, uma por campo do roteiro, e
 *    `additionalProperties: false`. O modo estrito exige que todas as chaves
 *    estejam em `required`, e é exatamente esse rigor que se quer: `empresa`,
 *    `data_inicio` e `nome_do_cliente` deixam de ser escrevíveis. A deriva de
 *    nomes morre na origem, em vez de ser remendada por apelido depois.
 *
 * 2. Nada é nulo. Ausência é STRING VAZIA. O modo estrito exigiria declarar
 *    `type: ['string','null']` em todo campo opcional, e um `enum` com `null`
 *    dentro é o tipo de detalhe que faz o provedor devolver 400 — o que, aqui,
 *    seria a IA muda no atendimento inteiro. Vazio já é o que o resto do
 *    sistema entende por "não informado": `canonicalizeWaAiFacts` nunca grava
 *    vazio, então um campo que o cliente não respondeu não tem como apagar o
 *    que ele respondeu antes.
 */
export function buildWaAiTriageSchema(playbook: WaAiPlaybook): WaAiTriageSchema {
  const keys = waAiPlaybookFieldKeys(playbook);
  const properties: Record<string, unknown> = {};
  for (const key of keys) {
    const field = waAiPlaybookField(playbook, key);
    if (field) properties[key] = esquemaDoCampo(field);
  }

  return {
    name: 'triagem',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mensagem_cliente', 'campo_alvo', 'atualizacoes'],
      properties: {
        mensagem_cliente: {
          type: 'string',
          description: 'O que enviar ao cliente agora, em português do Brasil, curto como mensagem '
            + 'de WhatsApp e com no máximo uma pergunta. É o único texto que ele vai ler.',
        },
        campo_alvo: {
          type: 'string',
          enum: [WA_AI_VAZIO, ...keys],
          description: 'A informação que a sua pergunta está buscando agora. Vazio quando você não '
            + 'está perguntando nada.',
        },
        atualizacoes: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(properties),
          properties,
          description: 'O que o cliente informou. Preencha APENAS o que ele disse, com as palavras '
            + 'dele; deixe vazio todo campo que ele ainda não respondeu. Nunca deduza e nunca repita '
            + 'aqui um dado que você mesmo supôs.',
        },
      },
    },
  };
}

// ── Bloco de prompt ─────────────────────────────────────────────────────────

/**
 * O roteiro escrito para o modelo — estado, não cálculo.
 *
 * Ele recebe onde a conversa está e o que falta, já decidido. Quando um corte
 * disparou, recebe a ordem do corte e mais nada: é o mesmo princípio de
 * `waAiDateBlock`, que só conseguiu segurar a janela dos dois anos quando parou
 * de pedir a conta e passou a entregar o resultado.
 */
export function waAiPlaybookPromptBlock(
  playbook: WaAiPlaybook, progress: WaAiTriageProgress,
): string {
  const linhas: string[] = ['# Roteiro da triagem'];

  if (progress.cut) {
    linhas.push(
      `Este atendimento JÁ FOI ENCERRADO pelo sistema: ${progress.cut.reason}.`,
      progress.cut.guidance,
      'Não faça mais nenhuma pergunta da triagem e não volte atrás nesta decisão.',
    );
    return linhas.join('\n');
  }

  if (progress.complete) {
    linhas.push('Todas as informações do roteiro já foram coletadas. Siga para o fechamento previsto '
      + 'nas suas instruções.');
    return linhas.join('\n');
  }

  if (progress.stageLabel) linhas.push(`Etapa atual: ${progress.stageLabel}.`);
  linhas.push('Ainda falta descobrir, nesta ordem:');
  for (const item of progress.pending) linhas.push(`- ${item}`);
  linhas.push('Pergunte apenas o primeiro item da lista. Os demais ficam para as próximas mensagens, '
    + 'e o que o cliente já respondeu não aparece aqui — não torne a perguntar.');

  // A frase exata, quando o roteiro traz uma. Entregar a pergunta pronta é
  // diferente de listar exemplos e torcer para o modelo achar o certo: ele erra
  // menos quando não precisa escolher.
  const proximo = progress.nextField ? waAiPlaybookField(playbook, progress.nextField) : null;
  if (proximo?.question) {
    linhas.push('', 'A pergunta desta vez é esta, e ela já está escrita do jeito que o cliente entende. '
      + 'Use estas palavras, mudando só o necessário para encaixar no que ele acabou de dizer:',
      `"${proximo.question}"`);
  }

  return linhas.join('\n');
}

/**
 * O "o que este agente deve fazer", MONTADO a partir do roteiro.
 *
 * Antes disto, a mesma coisa estava escrita nos dois lugares: o roteiro sabia
 * que o próximo campo era `tipo_empregador`, e a frase para perguntá-lo vivia
 * numa lista de exemplos, em prosa, longe do campo. Duas fontes para o mesmo
 * dado é o mesmo problema de `empresa` e `empregador` — só que na configuração
 * em vez de na memória.
 *
 * O que continua no texto livre do agente: tudo o que não é do roteiro —
 * transferência para humano, acompanhamento, continuidade da conversa. E as
 * expressões `ação=`, que o backend compila a partir dos textos.
 */
export function waAiPlaybookInstructions(playbook: WaAiPlaybook): string {
  const partes: string[] = [];

  const estilo = (playbook.style || []).map(s => String(s || '').trim()).filter(Boolean);
  if (estilo.length > 0) {
    partes.push(`# Como você conversa\n${estilo.map(s => `- ${s}`).join('\n')}`);
  }

  const abertura = String(playbook.opening || '').trim();
  if (abertura) {
    partes.push(
      '# Abertura\n'
      + 'Se esta conversa ainda não tem nenhuma mensagem sua, comece assim, aproximadamente do '
      + `mesmo tamanho:\n\n"${abertura}"\n\n`
      + 'Se você já falou alguma vez nesta conversa, a abertura já aconteceu: não a repita.');
  }

  // As perguntas de todos os campos, na ordem — o modelo vê a que precisa no
  // bloco do roteiro, mas ler a conversa inteira de antemão é o que faz uma
  // pergunta encaixar na anterior em vez de soar avulsa.
  const comPergunta = playbook.fields.filter(f => String(f.question || '').trim());
  if (comPergunta.length > 0) {
    partes.push(
      '# Como perguntar cada coisa\n'
      + 'Estas são as perguntas do roteiro, na voz do escritório. Pergunte UMA por vez, e só a que '
      + 'o roteiro indicar:\n'
      + comPergunta.map(f => `- ${f.label}: "${String(f.question).trim()}"`).join('\n'));
  }

  const fechamento = String(playbook.closing || '').trim();
  if (fechamento) partes.push(`# Quando o roteiro estiver completo\n${fechamento}`);

  return partes.join('\n\n');
}

// ── Leitura de um roteiro vindo de fora ─────────────────────────────────────

/**
 * Lê um roteiro escrito por gente (ou guardado no banco) e devolve só o que é
 * utilizável — ou `null`, quando não sobra roteiro nenhum.
 *
 * Nada aqui confia no formato: o roteiro vai ser digitado numa tela, e um campo
 * sem chave, uma etapa apontando para um campo que não existe ou um corte com
 * regra desconhecida não podem derrubar o atendimento. O que não presta sai; o
 * que sobra funciona.
 */
export function normalizeWaAiPlaybook(raw: unknown): WaAiPlaybook | null {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : null;
  if (!src) return null;

  const fields: WaAiPlaybookField[] = [];
  const vistos: Record<string, true> = {};

  for (const item of (Array.isArray(src.fields) ? src.fields : [])) {
    if (fields.length >= WA_AI_PLAYBOOK_MAX_FIELDS) break;
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;

    const key = chaveNormalizada(f.key);
    if (!key || vistos[key]) continue;

    const type: WaAiFieldType = f.type === 'data_mes_ano' || f.type === 'bool' || f.type === 'enum'
      ? f.type : 'texto';

    const options = type === 'enum'
      ? (Array.isArray(f.options) ? f.options : [])
        .map(o => textoAparado(o, WA_AI_PLAYBOOK_KEY_MAX_CHARS))
        .filter(o => o.length > 0)
        .slice(0, WA_AI_PLAYBOOK_MAX_OPTIONS)
      : undefined;
    // Enum sem opção não restringe nada e ainda quebraria o schema: vira texto.
    if (type === 'enum' && (!options || options.length === 0)) continue;

    const label = textoAparado(f.label, 60) || key;
    const ask = textoAparado(f.ask) || label;

    const cond = (f.onlyWhen && typeof f.onlyWhen === 'object') ? f.onlyWhen as Record<string, unknown> : null;
    const onlyWhen = cond && chaveNormalizada(cond.field) && textoAparado(cond.value, 60)
      ? { field: chaveNormalizada(cond.field), value: textoAparado(cond.value, 60) }
      : undefined;

    // A pergunta é a única coisa daqui que vai INTEIRA para o cliente, então
    // ela tem um teto próprio, bem maior que o dos rótulos.
    const question = textoAparado(f.question, 400);

    vistos[key] = true;
    fields.push({
      key, label, type, required: f.required !== false, ask,
      ...(question ? { question } : {}),
      ...(options ? { options } : {}),
      ...(onlyWhen ? { onlyWhen } : {}),
    });
  }

  if (fields.length === 0) return null;
  const existe = (key: string) => fields.some(f => f.key === key);

  const stages: WaAiPlaybookStage[] = [];
  for (const item of (Array.isArray(src.stages) ? src.stages : [])) {
    if (stages.length >= WA_AI_PLAYBOOK_MAX_STAGES) break;
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const id = chaveNormalizada(s.id);
    if (!id || stages.some(e => e.id === id)) continue;
    const campos = (Array.isArray(s.fields) ? s.fields : [])
      .map(chaveNormalizada)
      .filter((k, i, arr) => k && existe(k) && arr.indexOf(k) === i);
    if (campos.length === 0) continue;
    stages.push({ id, label: textoAparado(s.label, 60) || id, fields: campos });
  }

  // Sem etapa não há ordem de pergunta, e sem ordem a "próxima pergunta" seria
  // aleatória. Uma etapa única, na ordem em que os campos foram escritos, é o
  // mínimo honesto.
  if (stages.length === 0) {
    stages.push({ id: 'triagem', label: 'Triagem', fields: fields.map(f => f.key) });
  }

  const cuts: WaAiPlaybookCut[] = [];
  for (const item of (Array.isArray(src.cuts) ? src.cuts : [])) {
    if (cuts.length >= WA_AI_PLAYBOOK_MAX_CUTS) break;
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const id = chaveNormalizada(c.id);
    const rule = normalizeRule(c.rule, existe);
    if (!id || !rule || cuts.some(x => x.id === id)) continue;
    cuts.push({
      id,
      rule,
      effect: c.effect === 'handoff' ? 'handoff' : 'disqualify',
      reason: textoAparado(c.reason) || id,
      // A orientação vai inteira para o prompt; aparar em 200 cortaria a ordem
      // no meio, que é justamente a parte que não pode ficar pela metade.
      guidance: textoAparado(c.guidance, 800),
    });
  }

  const style = (Array.isArray(src.style) ? src.style : [])
    .map(s => textoAparado(s, 300))
    .filter(s => s.length > 0)
    .slice(0, 30);

  // Abertura e fechamento vão inteiros para o prompt: aparar no meio cortaria a
  // instrução justamente onde ela diz o que fazer.
  const opening = textoLongo(src.opening, 800);
  const closing = textoLongo(src.closing, 3000);

  return {
    id: chaveNormalizada(src.id) || 'roteiro',
    label: textoAparado(src.label, 80) || 'Triagem',
    ...(opening ? { opening } : {}),
    ...(style.length > 0 ? { style } : {}),
    ...(closing ? { closing } : {}),
    fields, stages, cuts,
  };
}

function normalizeRule(raw: unknown, existe: (key: string) => boolean): WaAiCutRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (r.kind === 'field_equals') {
    const field = chaveNormalizada(r.field);
    const values = (Array.isArray(r.values) ? r.values : [])
      .map(v => textoAparado(v, 60)).filter(v => v.length > 0);
    if (!field || !existe(field) || values.length === 0) return null;
    return { kind: 'field_equals', field, values };
  }

  if (r.kind === 'older_than') {
    const field = chaveNormalizada(r.field);
    const years = Number(r.years);
    if (!field || !existe(field) || !Number.isFinite(years) || years <= 0 || years > 50) return null;
    return { kind: 'older_than', field, years };
  }

  if (r.kind === 'all_equal') {
    const fields = (Array.isArray(r.fields) ? r.fields : [])
      .map(chaveNormalizada).filter((k, i, arr) => k && existe(k) && arr.indexOf(k) === i);
    const value = textoAparado(r.value, 60);
    if (fields.length === 0 || !value) return null;
    return { kind: 'all_equal', fields, value };
  }

  return null;
}
