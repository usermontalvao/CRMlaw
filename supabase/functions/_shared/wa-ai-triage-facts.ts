/**
 * O estado estruturado da triagem — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiTriageFacts.ts
 *   supabase/functions/_shared/wa-ai-triage-facts.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiTriageFacts.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Em 12/08/2026, na campanha "Sem registro na carteira", o cliente informou
 * "Janeiro de 2020", "Já saí" e "Agosto de 2026" — e o painel terminou o
 * atendimento com treze dados gravados, NENHUM deles o período, e com
 * "mês e ano de início" de volta na lista de pendências. O agente perguntou de
 * novo o que já tinha sido respondido oito minutos antes.
 *
 * O log de `whatsapp_ai_executions` mostra a causa exata: nos três turnos em
 * que as datas foram ditas, `requested_actions` veio VAZIO. O modelo só chamou
 * `registrar_memoria` duas vezes na conversa inteira, e na última ele anotou
 * treze campos sem nenhuma das datas. A mesclagem nunca apagou nada — o dado
 * simplesmente nunca chegou. É a mesma lição do acompanhamento (ver
 * `wa-ai-followup-store.ts`): o que não pode faltar não pode depender de o
 * modelo lembrar de chamar uma ferramenta.
 *
 * As três coisas que moram aqui, todas determinísticas:
 *   1. CHAVES — o modelo escreveu `empresa` numa execução e `empregador` na
 *      seguinte, `inicio` numa e `data_inicio` na outra. Dois nomes para o
 *      mesmo dado é o mesmo que nenhum: a pendência nunca fecha;
 *   2. EXTRAÇÃO — início, saída e "ainda trabalha" lidos da própria conversa,
 *      casando a pergunta que o agente fez com a resposta que o cliente deu;
 *   3. PENDÊNCIAS — campo preenchido não volta para a lista de espera, venha o
 *      pedido de onde vier. É esta regra que o follow-up lê.
 *
 * O que este arquivo NUNCA faz: gravar vazio. Um `null`, um `undefined` ou uma
 * string em branco jamais substituem um dado que já existe.
 */

/** Teto de chaves, o mesmo de `WA_AI_KNOWN_FACTS_MAX_KEYS` (waAiRunGate.ts). */
export const WA_AI_TRIAGE_MAX_FACTS = 30;

/** Uma fala da conversa, na forma mínima de que a leitura precisa. */
export interface WaAiTriageTurn {
  /** 'in' = cliente, 'out' = agente. */
  direction: 'in' | 'out';
  /** Texto escrito ou a transcrição do áudio. */
  text: string;
  /** ISO. Só ordena — as duas pontas montam o histórico em ordens diferentes. */
  at?: string | null;
}

/** Os três campos de período que o modelo esquece. */
export type WaAiPeriodField = 'inicio' | 'ainda_trabalha' | 'saida';

// ── Texto ───────────────────────────────────────────────────────────────────

/** Sem acento e em minúsculas: é a forma em que todas as regras abaixo casam. */
function simples(text: unknown): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Chaves ──────────────────────────────────────────────────────────────────

/**
 * Os apelidos que o modelo já usou, ou usará, para os mesmos dados.
 *
 * Não é preciosismo: `empresa` e `empregador` gravados na mesma conversa viram
 * duas linhas no painel, e a pergunta "o empregador já foi informado?" responde
 * "não" com o nome da empresa na tela.
 */
export const WA_AI_FACT_ALIASES: Record<string, string> = {
  // Nome do cliente
  nome_cliente: 'nome',
  nome_completo: 'nome',
  nome_do_cliente: 'nome',
  // Para quem trabalhou
  empresa: 'empregador',
  empregadora: 'empregador',
  nome_empresa: 'empregador',
  empresa_nome: 'empregador',
  nome_da_empresa: 'empregador',
  contratante: 'empregador',
  tomador: 'empregador',
  patrao: 'empregador',
  local_trabalho: 'empregador',
  local_de_trabalho: 'empregador',
  // Particular ou público
  tipo_empresa: 'tipo_empregador',
  tipo_de_empresa: 'tipo_empregador',
  empresa_tipo: 'tipo_empregador',
  natureza_empresa: 'tipo_empregador',
  natureza_empregador: 'tipo_empregador',
  tipo_empregadora: 'tipo_empregador',
  // Quando começou
  data_inicio: 'inicio',
  data_de_inicio: 'inicio',
  inicio_trabalho: 'inicio',
  inicio_do_trabalho: 'inicio',
  inicio_contrato: 'inicio',
  mes_ano_inicio: 'inicio',
  data_admissao: 'inicio',
  admissao: 'inicio',
  data_entrada: 'inicio',
  entrada: 'inicio',
  comeco: 'inicio',
  // Ainda está lá
  continua_trabalhando: 'ainda_trabalha',
  trabalha_atualmente: 'ainda_trabalha',
  esta_trabalhando: 'ainda_trabalha',
  ainda_trabalhando: 'ainda_trabalha',
  ainda_esta_trabalhando: 'ainda_trabalha',
  trabalha_ainda: 'ainda_trabalha',
  vinculo_ativo: 'ainda_trabalha',
  // Quando saiu
  data_saida: 'saida',
  data_de_saida: 'saida',
  saida_trabalho: 'saida',
  mes_ano_saida: 'saida',
  data_termino: 'saida',
  termino: 'saida',
  data_fim: 'saida',
  fim: 'saida',
  data_demissao: 'saida',
  demissao: 'saida',
  desligamento: 'saida',
  data_desligamento: 'saida',
  ultimo_dia: 'saida',
};

/** `"Data de Início"` e `data_inicio` são a MESMA chave. */
function chaveNormalizada(key: unknown): string {
  return simples(key)
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ── Valores ─────────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4,
  mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8,
  set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11,
  dez: 12, dezembro: 12,
};

// Os nomes longos vêm antes na alternância: senão `jan` casa e `janeiro` fica
// com o "eiro" sobrando, e o `\b` do fim reprova a data inteira.
const NOMES_DE_MES = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');

const RE_DATA = new RegExp(
  '\\b(?:'
  + '(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})'   // 05/01/2020
  + '|(\\d{1,2})[\\/.-](\\d{4})'                    // 01/2020
  + `|(${NOMES_DE_MES})(?:\\s+de)?[\\s\\/.-]+(\\d{4})` // janeiro de 2020, jan/2020
  + ')\\b',
  'g');

function mesAno(mes: number, ano: number): string | null {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) return null;
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

interface DataAchada { valor: string; index: number }

/**
 * Todas as datas de mês+ano do texto, na ordem em que aparecem.
 *
 * Ano solto ("foi em 2020") NÃO entra de propósito: a pendência pede mês e ano,
 * e gravar só o ano fecharia a pergunta com metade da resposta.
 */
export function findWaAiMonthYears(text: string): DataAchada[] {
  const alvo = simples(text);
  const achadas: DataAchada[] = [];
  RE_DATA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_DATA.exec(alvo)) !== null) {
    let valor: string | null = null;
    if (m[3]) valor = mesAno(Number(m[2]), Number(m[3]));
    else if (m[5]) valor = mesAno(Number(m[4]), Number(m[5]));
    else if (m[6]) valor = mesAno(MESES[m[6]], Number(m[7]));
    if (valor) achadas.push({ valor, index: m.index });
  }
  return achadas;
}

/** A primeira data de mês+ano do texto, em `MM/AAAA`. */
export function parseWaAiMonthYear(text: string): string | null {
  const achadas = findWaAiMonthYears(text);
  return achadas.length > 0 ? achadas[0].valor : null;
}

const SIM = /^(sim|s|isso|isso mesmo|exato|exatamente|correto|certo|positivo|verdade|true|ativo|continuo|ainda)\b/;
const NAO = /^(nao|n|negativo|false|ja sai|sai|saiu|encerrado|inativo|nunca)\b/;

/**
 * O valor gravado, já na forma canônica do campo.
 *
 * Datas viram `MM/AAAA` para o painel, a comparação e o bloco de datas do
 * prompt (`waAiAnnotateDates`) lerem sempre o mesmo formato. O que não for
 * reconhecido fica exatamente como veio: aparar é uma coisa, descartar o que o
 * cliente disse é outra.
 */
export function normalizeWaAiFactValue(field: string, value: unknown): string {
  const bruto = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!bruto) return '';

  if (field === 'inicio' || field === 'saida') {
    return parseWaAiMonthYear(bruto) || bruto;
  }

  if (field === 'ainda_trabalha') {
    const s = simples(bruto);
    if (NAO.test(s)) return 'não';
    if (SIM.test(s)) return 'sim';
    return bruto;
  }

  return bruto;
}

/**
 * Um único nome por dado, valor aparado, nada vazio.
 *
 * O PRIMEIRO a gravar vence: quando `empresa` e `empregador` chegam juntos, o
 * que já estava na memória continua valendo. Sobrescrever o que foi coletado
 * antes por causa de um apelido novo é justamente o que não pode acontecer.
 *
 * `declaradas` são as chaves que o ROTEIRO do agente define (ver
 * `waAiPlaybook.ts`), e elas não passam pelo mapa de apelidos. O mapa nasceu
 * para uma campanha só: um roteiro futuro que chame seu campo de `empresa`
 * teria o dado renomeado para `empregador` e a pendência de `empresa` nunca
 * fecharia — o mesmo defeito, do outro lado.
 */
export function canonicalizeWaAiFacts(
  facts: Record<string, unknown> | null | undefined,
  declaradas?: string[] | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const vistos: Record<string, true> = {};

  const doRoteiro: Record<string, true> = {};
  for (const chave of (Array.isArray(declaradas) ? declaradas : [])) {
    const norm = chaveNormalizada(chave);
    if (norm) doRoteiro[norm] = true;
  }

  for (const [chaveBruta, valorBruto] of Object.entries(facts || {})) {
    if (Object.keys(out).length >= WA_AI_TRIAGE_MAX_FACTS) break;
    const norm = chaveNormalizada(chaveBruta);
    if (!norm) continue;

    const canonica = doRoteiro[norm] ? norm : (WA_AI_FACT_ALIASES[norm] || norm);
    if (vistos[canonica]) continue;

    // Só o que dá para escrever: objeto, array, null e vazio ficam de fora — e
    // ficando de fora não têm como apagar nada.
    const escrevivel = typeof valorBruto === 'string' || typeof valorBruto === 'number'
      || typeof valorBruto === 'boolean';
    if (!escrevivel) continue;

    const valor = normalizeWaAiFactValue(canonica, valorBruto);
    if (!valor) continue;

    vistos[canonica] = true;
    out[canonica] = valor;
  }

  return out;
}

// ── Extração do período ─────────────────────────────────────────────────────

const TOPICO_INICIO = /\b(comec\w*|inicio|inici\w*|admiss\w*|admitid\w*|entrou|entrei|entrada)\b/;
const TOPICO_SAIDA = /\b(saiu|sair|sai|saida|deixou|deixei|termin\w*|encerr\w*|desligad\w*|demiss\w*|demitid\w*|parou|ultimo dia)\b/;
const TOPICO_AINDA = /\b(ainda trabalha\w*|ainda esta\w*|ainda e|continua trabalhando|continua na|trabalha atualmente|trabalha ate hoje)\b/;

const MARCA_INICIO = /\b(comec\w*|inicio|inici\w*|admiss\w*|admitid\w*|entrei|entrou|entrada|desde)\b/g;
const MARCA_SAIDA = /\b(sai|saiu|saida|sair|deixei|deixou|termin\w*|encerr\w*|parei|demiss\w*|demitid\w*|desligad\w*|ate)\b/g;

const RESPOSTA_SAIU = /\b(ja sai|sai de|sai da|sai em|sai no|nao trabalho mais|nao estou mais|nao trabalho la|fui demitid\w*|me demiti|pedi demissao|fui mandado embora|parei|encerrei|deixei|desligad\w*|ja nao|sai)\b/;
const RESPOSTA_CONTINUA = /\b(ainda trabalho|continuo trabalhando|continuo la|trabalho ate hoje|estou trabalhando|ainda estou|sigo trabalhando|trabalho la ainda)\b/;
const CONFIRMACAO = /^(sim|isso|isso mesmo|exato|exatamente|correto|certo|positivo|e isso|verdade|confirmo)\b/;

/** Onde cada assunto de período aparece na pergunta, na ordem em que foi feito. */
function topicosDaPergunta(pergunta: string): WaAiPeriodField[] {
  const texto = simples(pergunta);
  const posicoes: { campo: WaAiPeriodField; at: number }[] = [];
  const inicio = texto.search(TOPICO_INICIO);
  const saida = texto.search(TOPICO_SAIDA);
  const ainda = texto.search(TOPICO_AINDA);
  if (inicio >= 0) posicoes.push({ campo: 'inicio', at: inicio });
  if (saida >= 0) posicoes.push({ campo: 'saida', at: saida });
  if (ainda >= 0) posicoes.push({ campo: 'ainda_trabalha', at: ainda });
  posicoes.sort((a, b) => a.at - b.at);
  return posicoes.map(p => p.campo);
}

/** A última marca de assunto antes da data — é ela que diz de que data se trata. */
function ultimaMarca(re: RegExp, trecho: string): number {
  re.lastIndex = 0;
  let ultima = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trecho)) !== null) ultima = m.index;
  return ultima;
}

/**
 * O que o cliente respondeu sobre o período, casando pergunta com resposta.
 *
 * A rota de cada data tem duas chances, nesta ordem:
 *   1. o que a PRÓPRIA resposta diz ("saí em dezembro de 2023" é saída, não
 *      importa o que tenha sido perguntado);
 *   2. o assunto da pergunta que ela responde, na ordem em que foi perguntado.
 *
 * O que fica sem rota fica de fora. Chutar uma data para um campo errado é pior
 * do que perguntar de novo: perguntar cansa, mas errar a data reprova o caso na
 * janela dos dois anos sem que ninguém perceba.
 */
export function extractWaAiPeriodFacts(turns: WaAiTriageTurn[]): Partial<Record<WaAiPeriodField, string>> {
  const ordenados = (Array.isArray(turns) ? turns : [])
    .map((t, i) => ({ t, i, ms: Date.parse(String(t?.at || '')) }))
    .sort((a, b) => {
      if (Number.isFinite(a.ms) && Number.isFinite(b.ms) && a.ms !== b.ms) return a.ms - b.ms;
      return a.i - b.i;
    })
    .map(x => x.t);

  const out: Partial<Record<WaAiPeriodField, string>> = {};
  let pergunta = '';

  for (const turn of ordenados) {
    const texto = String(turn?.text || '').trim();
    if (!texto) continue;

    if (turn.direction === 'out') {
      // A pergunta corrente é a última fala do agente. A seguinte substitui:
      // o cliente responde ao que acabou de ser perguntado.
      pergunta = texto;
      continue;
    }

    const resposta = simples(texto);
    const topicos = topicosDaPergunta(pergunta);
    const temSinal = RESPOSTA_SAIU.test(resposta) || RESPOSTA_CONTINUA.test(resposta);

    // Os destinos que a pergunta abriu, na ordem em que ela os abriu.
    // 'ainda_trabalha' vira destino de DATA quando a resposta não traz sim nem
    // não: "você ainda trabalha lá ou já saiu?" respondido com "dezembro de
    // 2023" é a data da saída, e nada mais.
    const alvos: WaAiPeriodField[] = [];
    for (const t of topicos) {
      const alvo = t === 'ainda_trabalha' ? (temSinal ? null : 'saida' as const) : t;
      if (alvo && alvos.indexOf(alvo) === -1) alvos.push(alvo);
    }

    const datas = findWaAiMonthYears(texto);
    const semRota: DataAchada[] = [];

    for (const data of datas) {
      const antes = resposta.slice(Math.max(0, data.index - 45), data.index);
      const marcaInicio = ultimaMarca(MARCA_INICIO, antes);
      const marcaSaida = ultimaMarca(MARCA_SAIDA, antes);
      if (marcaInicio < 0 && marcaSaida < 0) { semRota.push(data); continue; }
      out[marcaSaida > marcaInicio ? 'saida' : 'inicio'] = data.valor;
    }

    // O que sobrou entra na ordem em que foi perguntado.
    for (let i = 0; i < semRota.length && i < alvos.length; i++) {
      out[alvos[i]] = semRota[i].valor;
    }

    // "Você saiu em agosto de 2026, certo?" → "Sim". A data está na pergunta, e
    // só um assunto foi aberto: não há para onde errar.
    if (datas.length === 0 && CONFIRMACAO.test(resposta) && alvos.length === 1) {
      const naPergunta = findWaAiMonthYears(pergunta);
      if (naPergunta.length === 1) out[alvos[0]] = naPergunta[0].valor;
    }

    if (RESPOSTA_CONTINUA.test(resposta)) out.ainda_trabalha = 'sim';
    else if (RESPOSTA_SAIU.test(resposta)) out.ainda_trabalha = 'não';
    // Quem tem data de saída não trabalha mais lá — não é dedução, é o que a
    // data significa.
    if (out.saida) out.ainda_trabalha = 'não';
  }

  return out;
}

// ── Pendências ──────────────────────────────────────────────────────────────

/** Como reconhecer, no texto de uma pendência, de que campo ela fala. */
const PENDENCIA_DE: { campo: string; re: RegExp }[] = [
  { campo: 'inicio', re: /\b(inicio|inici\w*|comec\w*|admiss\w*|entrada|entrou)\b/ },
  { campo: 'saida', re: /\b(saida|saiu|sai|sair|termin\w*|desligam\w*|demiss\w*|ultimo dia)\b/ },
  { campo: 'ainda_trabalha', re: /\b(ainda trabalha\w*|ainda esta\w*|continua\w*|trabalha atualmente|vinculo ativo)\b/ },
  { campo: 'nome', re: /\bnome\b/ },
  { campo: 'empregador', re: /\b(empresa|empregador\w*|contratante|tomador)\b/ },
  { campo: 'tipo_empregador', re: /\b(particular|privad\w*|public\w*|orgao|natureza|tipo de empresa)\b/ },
];

/**
 * Este texto cobra SÓ coisas que já estão respondidas?
 *
 * Vale para os dois formatos em que uma cobrança aparece: o item da lista de
 * espera ("mês e ano de início") e a pergunta que o agente escreveu ("quando
 * você começou a trabalhar lá?"). Um texto que cita dois campos só conta como
 * respondido quando os DOIS existem — "se ainda trabalha lá ou mês e ano de
 * saída" não some porque metade dela foi respondida. O texto que não cita campo
 * nenhum ("provas", "testemunhas") nunca conta como respondido.
 */
export function waAiAlreadyAnswered(
  text: string, facts: Record<string, string> | null | undefined,
): boolean {
  const conhecidos = facts || {};
  const alvo = simples(text);
  if (!alvo) return false;
  const citados = PENDENCIA_DE.filter(p => p.re.test(alvo)).map(p => p.campo);
  return citados.length > 0
    && citados.every(campo => String(conhecidos[campo] || '').trim().length > 0);
}

/**
 * Tira da lista de espera o que já está respondido.
 *
 * É esta lista que vira o texto da retomada. Sem esta poda, o follow-up marcado
 * para as 8h da manhã seguinte ia cobrar do cliente, por escrito, o mês que ele
 * já tinha dito.
 */
export function pruneWaAiPendingItems(
  items: string[] | null | undefined, facts: Record<string, string> | null | undefined,
): string[] {
  const out: string[] = [];

  for (const bruto of (Array.isArray(items) ? items : [])) {
    const texto = String(bruto ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    if (waAiAlreadyAnswered(texto, facts)) continue;
    if (out.indexOf(texto) === -1) out.push(texto);
  }

  return out;
}

// ── A costura ───────────────────────────────────────────────────────────────

export interface WaAiTriageState {
  knownFacts: Record<string, string>;
  pendingItems: string[];
}

/**
 * O estado que vai para o banco: chaves únicas, período lido da conversa,
 * pendências sem o que já foi respondido.
 *
 * A EXTRAÇÃO GANHA do que o modelo anotou, nos três campos de período. Não é
 * desconfiança gratuita: o que sai daqui foi lido da fala do cliente, palavra
 * por palavra, enquanto o modelo já gravou "01/2025" para quem disse 2020 e
 * passou a conversa inteira sem gravar nada. E ela só ganha quando ACHOU algo —
 * uma leitura vazia nunca apaga um dado que já existe, venha ele de onde vier.
 *
 * Quando a data sai da janela de histórico, a extração devolve vazio e o valor
 * gravado antes continua de pé. É por isso que a poda é feita contra o estado
 * final, e não contra o que este turno leu.
 */
export function reconcileWaAiTriageState(input: {
  knownFacts: Record<string, unknown> | null | undefined;
  pendingItems: string[] | null | undefined;
  turns: WaAiTriageTurn[];
  /** As chaves do roteiro do agente, quando ele tem um. */
  playbookKeys?: string[] | null;
}): WaAiTriageState {
  const declaradas = Array.isArray(input.playbookKeys) ? input.playbookKeys : null;
  const facts = canonicalizeWaAiFacts(input.knownFacts, declaradas);

  for (const [campo, valor] of Object.entries(extractWaAiPeriodFacts(input.turns))) {
    const limpo = String(valor ?? '').trim();
    if (!limpo) continue;
    // Com roteiro, a extração só escreve em campo que o roteiro declara. Ela lê
    // início, saída e "ainda trabalha" da conversa: numa triagem que não
    // pergunta período, esses três seriam linhas soltas no painel de um caso
    // que nunca falou de emprego nenhum.
    if (declaradas && declaradas.indexOf(campo) === -1) continue;
    if (!(campo in facts) && Object.keys(facts).length >= WA_AI_TRIAGE_MAX_FACTS) continue;
    facts[campo] = limpo;
  }

  return { knownFacts: facts, pendingItems: pruneWaAiPendingItems(input.pendingItems, facts) };
}
