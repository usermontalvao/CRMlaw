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
export type WaAiStoredFactValue = string | number | boolean;

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
export type WaAiPeriodField = 'inicio' | 'ainda_trabalha' | 'saida' | 'data_ocorrencia';
export type WaAiDecisionField = 'tipo_empregador' | 'pessoalidade' | 'recebia_pagamento'
  | 'trabalho_regular' | 'subordinacao' | 'tem_prova' | 'tem_testemunha' | 'outros_trabalhos'
  | 'tipo_ocorrencia' | 'aviso_previo' | 'tem_print' | 'saldo_retido'
  | 'residencia_tipo' | 'declarante_tem_documento' | 'aceita_honorarios';

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

// O cliente escreve no WhatsApp, não num campo de calendário. Um erro de uma
// letra no nome do mês ("marcço", "feverero", "desembro") não pode impedir
// um corte de prazo. Só comparamos nomes completos de mês e aceitamos no
// máximo uma inserção, remoção, troca ou inversão adjacente; assim "trabalho de
// 2023" continua sem ser confundido com data.
const MESES_COMPLETOS = Object.entries(MESES)
  .filter(([nome]) => nome.length >= 4)
  .filter(([nome], index, all) => all.findIndex(([, mes]) => mes === MESES[nome]) === index);

function diferePorNoMaximoUmaEdicao(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    const diferentes: number[] = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diferentes.push(i);
      if (diferentes.length > 2) return false;
    }
    if (diferentes.length === 1) return true;
    return diferentes.length === 2
      && diferentes[1] === diferentes[0] + 1
      && a[diferentes[0]] === b[diferentes[1]]
      && a[diferentes[1]] === b[diferentes[0]];
  }

  const menor = a.length < b.length ? a : b;
  const maior = a.length < b.length ? b : a;
  let i = 0;
  let j = 0;
  let pulou = false;
  while (i < menor.length && j < maior.length) {
    if (menor[i] === maior[j]) { i++; j++; continue; }
    if (pulou) return false;
    pulou = true;
    j++;
  }
  return true;
}

function mesAproximado(nome: string): number | null {
  for (const [mes, numero] of MESES_COMPLETOS) {
    if (diferePorNoMaximoUmaEdicao(nome, mes)) return numero;
  }
  return null;
}

const RE_DATA = new RegExp(
  '\\b(?:'
  + '(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})'   // 05/01/2020
  + '|(\\d{1,2})[\\/.-](\\d{4})'                    // 01/2020
  + `|(${NOMES_DE_MES})(?:\\s+de)?[\\s\\/.-]+(\\d{4})` // janeiro de 2020, jan/2020
  + ')\\b',
  'g');

const RE_DATA_COM_MES_DIGITADO = /\b([a-z]{4,12})(?:\s+de)?[\s\/.-]+(\d{4})\b/g;

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

  // Segunda passagem só para nomes com erro de digitação. As datas exatas já
  // encontradas acima vencem e não são duplicadas.
  RE_DATA_COM_MES_DIGITADO.lastIndex = 0;
  while ((m = RE_DATA_COM_MES_DIGITADO.exec(alvo)) !== null) {
    if (achadas.some(data => data.index === m!.index)) continue;
    const mes = mesAproximado(m[1]);
    const valor = mes === null ? null : mesAno(mes, Number(m[2]));
    if (valor) achadas.push({ valor, index: m.index });
  }

  return achadas.sort((a, b) => a.index - b.index);
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
export function normalizeWaAiFactValue(field: string, value: unknown): WaAiStoredFactValue | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const bruto = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!bruto) return null;

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
): Record<string, WaAiStoredFactValue> {
  const out: Record<string, WaAiStoredFactValue> = {};
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
    if (valor === null || valor === '') continue;

    vistos[canonica] = true;
    out[canonica] = valor;
  }

  return out;
}

// ── Extração do período ─────────────────────────────────────────────────────

const TOPICO_INICIO = /\b(comec\w*|inicio|inici\w*|admiss\w*|admitid\w*|entrou|entrei|entrada)\b/;
const TOPICO_SAIDA = /\b(saiu|sair|sai|saida|deixou|deixei|termin\w*|encerr\w*|desligad\w*|demiss\w*|demitid\w*|parou|ultimo dia)\b/;
const TOPICO_AINDA = /\b(ainda trabalha\w*|ainda esta\w*|ainda e|continua trabalhando|continua na|trabalha atualmente|trabalha ate hoje)\b/;
const TOPICO_CONTA = /\b(quando isso aconteceu|mes e ano.{0,35}(?:aconteceu|bloqueio|encerramento)|isso aconteceu|data do problema|bloqueio da conta|conta bloqueada|encerramento da conta|conta encerrada)\b/;

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
  const conta = texto.search(TOPICO_CONTA);
  if (inicio >= 0) posicoes.push({ campo: 'inicio', at: inicio });
  if (saida >= 0 && conta < 0) posicoes.push({ campo: 'saida', at: saida });
  if (ainda >= 0) posicoes.push({ campo: 'ainda_trabalha', at: ainda });
  if (conta >= 0) posicoes.push({ campo: 'data_ocorrencia', at: conta });
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

    if (topicos.includes('data_ocorrencia') && datas.length > 0) {
      out.data_ocorrencia = datas[datas.length - 1].valor;
      continue;
    }

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

// ── Respostas simples que decidem o fluxo ──────────────────────────────────

/** Qual decisão a última pergunta abriu. Só casa perguntas desta campanha. */
function campoDeDecisao(pergunta: string): WaAiDecisionField | null {
  const q = simples(pergunta);
  if (/conta foi bloqueada|foi bloqueio|foi encerrada|encerrada de vez/.test(q)) return 'tipo_ocorrencia';
  if (/banco avisou|avisou antes|recebeu algum aviso|teve aviso previo/.test(q)) return 'aviso_previo';
  if (/tem algum print|tem print|email ou tela|prova do bloqueio|prova do encerramento/.test(q)) return 'tem_print';
  if (/saldo preso|dinheiro preso|saldo retido|ficou algum dinheiro/.test(q)) return 'saldo_retido';
  if (/comprovante de residencia|contrato de aluguel|nome de esposa|nome do pai|nome da mae|nenhum desses/.test(q)) return 'residencia_tipo';
  if (/pessoa consegue mandar|declarante.*documento|foto do documento de identificacao dela/.test(q)) return 'declarante_tem_documento';
  if (/honorarios.*40|40%.*valor|esta de acordo.*honorarios/.test(q)) return 'aceita_honorarios';
  if (/empresa particular|empresa privada|iniciativa privada|prefeitura|governo|orgao publico|empresa publica/.test(q)) return 'tipo_empregador';
  if (/era voce mesm|tinha que ser voce|mandar outra pessoa|colocar alguem|alguem no seu lugar|outra pessoa no seu lugar|substituir voce/.test(q)) return 'pessoalidade';
  if (/recebia algum pagamento|recebia dinheiro|pagavam pelo trabalho|ganhava alguma coisa|era pago|tinha salario/.test(q)) return 'recebia_pagamento';
  if (/toda semana|so de vez em quando|trabalho regular|com que frequencia|quantas vezes por semana|era toda hora|era um bico/.test(q)) return 'trabalho_regular';
  if (/passava o que voce precisava|cobrava o servico|quem mandava|tinha chefe|dava ordens|dizia o que fazer|controlava seu horario/.test(q)) return 'subordinacao';
  if (/alguma prova desse trabalho|tem alguma prova|ficou alguma prova|guardou alguma coisa|tem comprovante|tem conversa ou foto/.test(q)) return 'tem_prova';
  if (/servir de testemunha|tem testemunha|alguem que trabalhou com voce|alguem viu voce trabalhando|alguem pode confirmar/.test(q)) return 'tem_testemunha';
  if (/outro trabalho sem carteira|alem desse|mais algum trabalho assim|outro emprego desse jeito/.test(q)) return 'outros_trabalhos';
  return null;
}

const SIM_CURTO = /^(sim|s|isso|isso mesmo|tenho|tinha|acho que sim|com certeza)\b/;
const NAO_CURTO = /^(nao|n|nao tenho|nao tinha|acho que nao|nenhum|nenhuma|ninguem)\b/;

/**
 * Traduz a linguagem de WhatsApp para os valores fechados usados nos cortes.
 * Ambiguidade devolve null: "não entendi", "talvez" e "não sei" nunca viram
 * reprovação. Nesse caso o mesmo campo continua pendente e o agente reformula.
 */
function lerDecisao(campo: WaAiDecisionField, respostaBruta: string): string | null {
  const r = simples(respostaBruta);
  if (!r || /\b(nao entendi|nao sei|nao lembro|talvez|mais ou menos|depende|acho que)\b/.test(r)
    && !/^(acho que sim|acho que nao)\b/.test(r)) return null;

  if (campo === 'tipo_empregador') {
    if (/\b(prefeitura|municipio|estado|governo|orgao publico|empresa publica|autarquia)\b/.test(r)) return 'publico';
    if (/\b(particular|privad\w*|empresa normal|loja|comercio|fazenda|pessoa fisica)\b/.test(r)) return 'particular';
    return null;
  }

  if (campo === 'tipo_ocorrencia') {
    if (/\b(bloque\w*|travou|congelou|nao consigo mexer|nao consigo usar)\b/.test(r)) return 'bloqueio';
    if (/\b(encerr\w*|fechou (?:a|minha|sua)?\s*conta|cancelou (?:a|minha|sua)?\s*conta|conta fechada)\b/.test(r)) return 'encerramento';
    return null;
  }

  if (campo === 'aviso_previo') {
    if (/\b(sem avisar|nao avisou|do nada|nenhum aviso|nao recebi aviso|so descobri depois)\b/.test(r)) return 'não';
    if (/\b(avisou|mandou aviso|recebi aviso|chegou email antes|notificou antes)\b/.test(r)
      || SIM_CURTO.test(r)) return 'sim';
    if (NAO_CURTO.test(r)) return 'não';
    return null;
  }

  if (campo === 'tem_print') {
    if (/\b(nao tenho|nao tirei|sem print|apaguei|nao consigo printar)\b/.test(r)) return 'não';
    if (/\b(print|screenshot|captura|foto da tela|email|mensagem do banco|tela do aplicativo|tela do app)\b/.test(r)
      || SIM_CURTO.test(r)) return 'sim';
    if (NAO_CURTO.test(r)) return 'não';
    return null;
  }

  if (campo === 'saldo_retido') {
    if (/\b(nao ficou|sem saldo|saldo zerado|nao tinha dinheiro|nada preso)\b/.test(r)) return 'não';
    if (/\b(ficou|esta preso|ta preso|retido|bloqueou meu dinheiro|saldo de|reais|r\$)\b/.test(r)
      || SIM_CURTO.test(r)) return 'sim';
    if (NAO_CURTO.test(r)) return 'não';
    return null;
  }

  if (campo === 'residencia_tipo') {
    if (/\b(meu nome|meu proprio nome|no meu nome|proprio)\b/.test(r)) return 'proprio';
    if (/\b(esposa|esposo|marido|mulher|meu pai|minha mae|nome do pai|nome da mae)\b/.test(r)) return 'familiar';
    if (/\b(sem contrato|nao tenho contrato|nome de terceiro|favor|emprestada|nenhum desses|casa de outra pessoa)\b/.test(r)) return 'terceiro_sem_contrato';
    if (/\b(contrato de aluguel|tenho contrato|casa alugada com contrato|alugo com contrato)\b/.test(r)) return 'aluguel_com_contrato';
    return null;
  }

  if (campo === 'declarante_tem_documento' || campo === 'aceita_honorarios') {
    if (SIM_CURTO.test(r) || /\b(concordo|de acordo|consigo mandar|pode mandar)\b/.test(r)) return 'sim';
    if (NAO_CURTO.test(r) || /\b(nao concordo|nao aceito|nao consigo mandar)\b/.test(r)) return 'não';
    return null;
  }

  if (campo === 'pessoalidade') {
    if (/\b(podia|poderia|dava para)\b.{0,35}\b(mandar|colocar|chamar|substituir)\b/.test(r)
      || /\b(outra|qualquer) pessoa\b.{0,20}\b(podia|poderia|ia)\b/.test(r)
      || /\b(irmao|irma|primo|prima|amigo|colega|alguem)\b.{0,25}\b(ia|podia ir|ficava|trabalhava)\b.{0,20}\b(no meu lugar|por mim|la)\b/.test(r)) return 'não';
    if (/\b(eu mesm[oa]|so eu|tinha que ser eu|era sempre eu)\b/.test(r)
      || /\b(nao podia|nao dava para)\b.{0,35}\b(mandar|trocar|colocar|chamar|substituir)\b/.test(r)
      || /\bninguem\b.{0,25}\b(podia|poderia)\b.{0,20}\b(ir|trabalhar|me substituir)\b/.test(r)) return 'sim';
    // "sim" e "não" sozinhos são perigosos numa pergunta com duas opções.
    return null;
  }

  if (campo === 'recebia_pagamento') {
    if (/\b(nao recebia|nunca recebi|sem pagamento|de graca|voluntari\w*)\b/.test(r)) return 'não';
    if (/\b(recebia|recebi|pagavam|pagava|ganhava|salario|pix|dinheiro|reais|r\$)\b/.test(r)
      || /\b\d{2,6}\b.{0,15}\b(por mes|por semana|por dia|mensal|semanal|diaria)\b/.test(r)
      || /\b\d+[.,]?\d*\s*mil\b/.test(r)
      || SIM_CURTO.test(r)) return 'sim';
    if (NAO_CURTO.test(r)) return 'não';
    return null;
  }

  if (campo === 'trabalho_regular') {
    if (/\b(de vez em quando|vez ou outra|quando chamava|raramente|esporadic\w*|um bico|so uma vez)\b/.test(r)) return 'esporadico';
    if (/\b(todo dia|todos os dias|toda semana|de segunda|de terca|de quarta|de quinta|de sexta|sabado|domingo|sempre|fixo|regular\w*|[1-7] dias|[1-7] vezes)\b/.test(r)
      || /\b(uma|duas|tres|quatro|cinco|seis|sete) vezes por semana\b/.test(r)) return 'regular';
    return null;
  }

  if (campo === 'subordinacao') {
    if (/\b(ninguem mandava|nao tinha chefe|sem chefe|fazia do meu jeito|eu decidia|meu proprio horario|ninguem cobrava)\b/.test(r)) return 'não';
    if (/\b(gerente|patrao|patroa|chefe|supervisor|encarregado|recebia ordens|dava ordens|mandava|cobrava|passava tarefa|dizia o que fazer|definia o horario|marcava o horario)\b/.test(r)
      || SIM_CURTO.test(r)) return 'sim';
    if (NAO_CURTO.test(r)) return 'não';
    return null;
  }

  if (campo === 'tem_prova') {
    if (/\b(nao tenho nada|nenhuma prova|nada guardado|nao tenho prova|nao tenho comprovante)\b/.test(r)) return 'não';
    if (/\b(pix|comprovante|recibo|extrato|conversa|whatsapp|foto|video|cracha|uniforme|papel|documento|audio|mensagem)\b/.test(r)
      || SIM_CURTO.test(r)) return 'sim';
    if (NAO_CURTO.test(r)) return 'não';
    return null;
  }

  if (campo === 'tem_testemunha') {
    if (/\b(ninguem|nenhuma pessoa|nao tem quem|nao tenho testemunha)\b/.test(r)) return 'não';
    if (/\b(colega|amigo|vizinho|cliente|alguem|uma pessoa|esposa|marido|irmao|irma|primo|prima|testemunha|viu eu|me viu)\b/.test(r)
      || SIM_CURTO.test(r)) return 'sim';
    if (NAO_CURTO.test(r)) return 'não';
    return null;
  }

  if (SIM_CURTO.test(r) || /\b(teve|tive|outro emprego|outro trabalho|outro bico)\b/.test(r)) return 'sim';
  if (NAO_CURTO.test(r) || /\b(foi so esse|somente esse|apenas esse)\b/.test(r)) return 'não';
  return null;
}

/**
 * Rede determinística para as respostas que podem encerrar ou aprovar o caso.
 * Ela não tenta extrair nome, função ou narrativa: esses continuam com o
 * extrator estruturado. Aqui entram somente enums/booleanos de alto impacto.
 */
export function extractWaAiDecisionFacts(
  turns: WaAiTriageTurn[],
): Partial<Record<WaAiDecisionField, string>> {
  const ordenados = (Array.isArray(turns) ? turns : [])
    .map((t, i) => ({ t, i, ms: Date.parse(String(t?.at || '')) }))
    .sort((a, b) => Number.isFinite(a.ms) && Number.isFinite(b.ms) && a.ms !== b.ms ? a.ms - b.ms : a.i - b.i)
    .map(item => item.t);
  const out: Partial<Record<WaAiDecisionField, string>> = {};
  let campo: WaAiDecisionField | null = null;
  for (const turn of ordenados) {
    const texto = String(turn?.text || '').trim();
    if (!texto) continue;
    if (turn.direction === 'out') { campo = campoDeDecisao(texto); continue; }
    if (!campo) continue;
    const valor = lerDecisao(campo, texto);
    if (valor !== null) out[campo] = valor;
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
  { campo: 'funcao', re: /\b(funcao|cargo|atividade|o que fazia|trabalho no dia a dia)\b/ },
  { campo: 'pessoalidade', re: /\b(era voce mesmo|mandar outra pessoa|substituir)\b/ },
  { campo: 'recebia_pagamento', re: /\b(recebia algum pagamento|recebia dinheiro|pagamento pelo trabalho)\b/ },
  { campo: 'pagamento', re: /\b(quanto recebia|como era pago|como te pagavam|salario)\b/ },
  { campo: 'trabalho_regular', re: /\b(toda semana|vez em quando|trabalho regular)\b/ },
  { campo: 'habitualidade', re: /\b(dias por semana|quais dias|horario|rotina)\b/ },
  { campo: 'subordinacao', re: /\b(passava o que|cobrava o servico|quem mandava|chefe)\b/ },
  { campo: 'tem_prova', re: /\b(tem alguma prova|alguma prova desse trabalho)\b/ },
  { campo: 'provas', re: /\b(quais provas|o que tem guardado)\b/ },
  { campo: 'tem_testemunha', re: /\b(tem testemunha|servir de testemunha|alguem que trabalhou)\b/ },
  { campo: 'outros_trabalhos', re: /\b(outro trabalho sem carteira|alem desse)\b/ },
  { campo: 'banco_reu', re: /\b(nome do banco|banco que bloqueou|banco que encerrou|banco reu)\b/ },
  { campo: 'tipo_ocorrencia', re: /\b(bloqueio ou encerramento|conta foi bloqueada|conta foi encerrada|o que aconteceu)\b/ },
  { campo: 'data_ocorrencia', re: /\b(data do problema|mes e ano.*bloqueio|mes e ano.*encerramento|quando aconteceu)\b/ },
  { campo: 'aviso_previo', re: /\b(aviso previo|avisou antes|banco avisou)\b/ },
  { campo: 'tem_print', re: /\b(print|email ou tela|prova visual)\b/ },
  { campo: 'saldo_retido', re: /\b(saldo retido|dinheiro preso|saldo preso)\b/ },
  { campo: 'valor_saldo', re: /\b(valor retido|quanto ficou preso|quanto.*saldo)\b/ },
  { campo: 'residencia_tipo', re: /\b(comprovante de residencia|contrato de aluguel|nome de familiar)\b/ },
  { campo: 'titular_comprovante', re: /\b(titular do comprovante|nome e parentesco)\b/ },
  { campo: 'declarante_nome', re: /\b(nome do declarante|pessoa que.*declarar)\b/ },
  { campo: 'endereco_residencia', re: /\b(endereco completo|rua.*numero.*cep)\b/ },
  { campo: 'declarante_tem_documento', re: /\b(documento do declarante|foto do documento.*pessoa)\b/ },
  { campo: 'aceita_honorarios', re: /\b(honorarios.*40|aceitou.*40|concorda.*honorarios)\b/ },
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
  text: string, facts: Record<string, WaAiStoredFactValue> | null | undefined,
): boolean {
  const conhecidos = facts || {};
  const alvo = simples(text);
  if (!alvo) return false;
  const citados = PENDENCIA_DE.filter(p => p.re.test(alvo)).map(p => p.campo);
  return citados.length > 0
    && citados.every(campo => String(conhecidos[campo] ?? '').trim().length > 0);
}

/**
 * Tira da lista de espera o que já está respondido.
 *
 * É esta lista que vira o texto da retomada. Sem esta poda, o follow-up marcado
 * para as 8h da manhã seguinte ia cobrar do cliente, por escrito, o mês que ele
 * já tinha dito.
 */
export function pruneWaAiPendingItems(
  items: string[] | null | undefined,
  facts: Record<string, WaAiStoredFactValue> | null | undefined,
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
  knownFacts: Record<string, WaAiStoredFactValue>;
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

  for (const [campo, valor] of Object.entries(extractWaAiDecisionFacts(input.turns))) {
    const limpo = String(valor ?? '').trim();
    if (!limpo) continue;
    if (declaradas && declaradas.indexOf(campo) === -1) continue;
    if (!(campo in facts) && Object.keys(facts).length >= WA_AI_TRIAGE_MAX_FACTS) continue;
    // A fala do cliente, casada com a pergunta que acabou de ser feita, ganha
    // do palpite do modelo nas decisões de alto impacto.
    facts[campo] = limpo;
  }

  return { knownFacts: facts, pendingItems: pruneWaAiPendingItems(input.pendingItems, facts) };
}
