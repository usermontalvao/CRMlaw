/**
 * A resposta do modelo — leitura e QUEDA.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiTriageReply.ts
 *   supabase/functions/_shared/wa-ai-triage-reply.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiTriageReply.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Com `response_format: {type:'json_schema', strict:true}` o provedor devolve o
 * objeto combinado — quando devolve. Ainda sobram: a chamada que cai no meio, o
 * modelo que embrulha o JSON numa cerca de markdown, o `max_tokens` que corta a
 * string ao meio e o dia em que a conta trocar de modelo para um que não
 * respeita o formato.
 *
 * O que NÃO pode acontecer em nenhum desses casos é o que acontecia antes: uma
 * resposta torta virar, calada, mensagem enviada ao cliente. Então a leitura
 * desce uma escada, e o degrau em que ela parar fica registrado:
 *
 *   1. JSON limpo;
 *   2. JSON dentro de cerca de markdown ou de prosa em volta;
 *   3. só o texto de `mensagem_cliente`, garimpado de um JSON quebrado;
 *   4. o texto cru — e SÓ quando ele não parece JSON.
 *
 * O degrau 4 tem um limite que parece detalhe e não é: se a resposta começou
 * como JSON e nada foi recuperado, a mensagem sai VAZIA. Mandar
 * `{"mensagem_cliente": "Olá, qual é o` para quem está do outro lado é pior do
 * que não mandar nada — sem resposta, a conversa fica na fila, visível e sem
 * dono, que é exatamente o estado em que um humano assume.
 */

/** Teto do que o modelo pode gravar num campo, o mesmo de `wa-ai-gate.ts`. */
export const WA_AI_REPLY_VALUE_MAX_CHARS = 300;

export interface WaAiTriageReply {
  /** O JSON veio inteiro e na forma combinada. */
  ok: boolean;
  /** O que enviar ao cliente. Vazio quer dizer "não há o que mandar". */
  message: string;
  /** O que o cliente informou, só com as chaves do roteiro. */
  updates: Record<string, string>;
  /** A informação que a pergunta do modelo está buscando. */
  targetField: string | null;
  /** A leitura caiu de degrau — a execução precisa ficar marcada. */
  degraded: boolean;
  /** Em que degrau caiu, em uma linha, para o log. */
  reason: string | null;
}

function vazia(reason: string | null): WaAiTriageReply {
  return { ok: false, message: '', updates: {}, targetField: null, degraded: reason !== null, reason };
}

// ── Garimpo ─────────────────────────────────────────────────────────────────

/** Tira a cerca de markdown que alguns modelos insistem em pôr em volta. */
function semCerca(texto: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(texto.trim());
  return m ? m[1].trim() : texto.trim();
}

/**
 * O primeiro objeto JSON completo do texto.
 *
 * Conta chaves respeitando string e escape: um `}` dentro de
 * `"mensagem_cliente"` não fecha objeto nenhum, e foi assim que a primeira
 * versão desta função cortou a resposta no meio de uma frase.
 */
function primeiroObjeto(texto: string): string | null {
  const inicio = texto.indexOf('{');
  if (inicio < 0) return null;

  let nivel = 0;
  let naString = false;
  let escapado = false;

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (escapado) { escapado = false; continue; }
    if (c === '\\') { escapado = true; continue; }
    if (c === '"') { naString = !naString; continue; }
    if (naString) continue;
    if (c === '{') nivel++;
    else if (c === '}') {
      nivel--;
      if (nivel === 0) return texto.slice(inicio, i + 1);
    }
  }

  return null;
}

/**
 * O valor de um campo de texto, lido de um JSON que não fecha.
 *
 * É o degrau que salva a resposta cortada pelo teto de tokens: a mensagem já
 * está escrita por inteiro dentro dela, e só falta o resto do objeto.
 */
function campoDeTexto(texto: string, campo: string): string | null {
  const marca = new RegExp(`"${campo}"\\s*:\\s*"`).exec(texto);
  if (!marca) return null;

  const inicio = marca.index + marca[0].length;
  let escapado = false;
  let fim = -1;

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (escapado) { escapado = false; continue; }
    if (c === '\\') { escapado = true; continue; }
    if (c === '"') { fim = i; break; }
  }

  const cru = texto.slice(inicio, fim >= 0 ? fim : texto.length);
  if (!cru) return null;
  try {
    return String(JSON.parse(`"${cru}"`));
  } catch {
    return cru.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

// ── Valores ─────────────────────────────────────────────────────────────────

/**
 * As atualizações, só com as chaves do roteiro e sem nada vazio.
 *
 * O schema já fecha a lista de chaves na origem, mas a peneira fica: a queda de
 * degrau 2 lê um JSON que ninguém validou, e o dia em que este agente rodar sob
 * outro provedor a lista fechada é só uma promessa. Chave de fora é descartada
 * em silêncio — inventar um campo novo no painel é pior do que perder o dado.
 */
function lerAtualizacoes(raw: unknown, allowedKeys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

  const permitidas: Record<string, true> = {};
  for (const key of allowedKeys) permitidas[String(key)] = true;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!permitidas[key]) continue;
    const escrevivel = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    if (!escrevivel) continue;
    const texto = String(value).replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    out[key] = texto.length > WA_AI_REPLY_VALUE_MAX_CHARS
      ? texto.slice(0, WA_AI_REPLY_VALUE_MAX_CHARS - 1)
      : texto;
  }

  return out;
}

// ── Leitura ─────────────────────────────────────────────────────────────────

/**
 * Lê o que o modelo devolveu.
 *
 * `allowedKeys` são as chaves do roteiro (`waAiPlaybookFieldKeys`) — passadas
 * por parâmetro, e não importadas, porque estes dois arquivos puros não podem
 * se enxergar.
 */
export function parseWaAiTriageReply(raw: unknown, allowedKeys: string[]): WaAiTriageReply {
  const texto = String(raw ?? '').trim();
  if (!texto) return vazia('resposta vazia do modelo');

  const limpo = semCerca(texto);
  const candidatos = [limpo];
  const objeto = primeiroObjeto(limpo);
  if (objeto && objeto !== limpo) candidatos.push(objeto);

  for (let i = 0; i < candidatos.length; i++) {
    let lido: unknown;
    try { lido = JSON.parse(candidatos[i]); } catch { continue; }
    if (!lido || typeof lido !== 'object' || Array.isArray(lido)) continue;

    const obj = lido as Record<string, unknown>;
    const mensagem = String(obj.mensagem_cliente ?? '').trim();
    const updates = lerAtualizacoes(obj.atualizacoes, allowedKeys);
    const alvoBruto = String(obj.campo_alvo ?? '').trim();
    const targetField = alvoBruto && allowedKeys.indexOf(alvoBruto) !== -1 ? alvoBruto : null;

    // Sem mensagem não há o que enviar, mas o que o cliente informou não se
    // joga fora por isso: o dado chegou, e é ele que fecha a pendência.
    if (!mensagem) {
      return {
        ok: false, message: '', updates, targetField,
        degraded: true, reason: 'JSON sem mensagem_cliente',
      };
    }

    return {
      ok: i === 0,
      message: mensagem,
      updates,
      targetField,
      degraded: i > 0,
      reason: i > 0 ? 'JSON encontrado no meio do texto' : null,
    };
  }

  // Degrau 3: o objeto não fecha, mas a mensagem está escrita lá dentro.
  const resgatada = campoDeTexto(limpo, 'mensagem_cliente');
  if (resgatada && resgatada.trim()) {
    return {
      ok: false, message: resgatada.trim(), updates: {}, targetField: null,
      degraded: true, reason: 'JSON incompleto — só a mensagem foi recuperada',
    };
  }

  // Degrau 4: texto cru. Só quando não parece JSON — ver o cabeçalho.
  if (limpo.indexOf('{') === -1 && limpo.indexOf('"mensagem_cliente"') === -1) {
    return {
      ok: false, message: limpo, updates: {}, targetField: null,
      degraded: true, reason: 'resposta em texto, fora do formato combinado',
    };
  }

  return vazia('resposta ilegível — nada foi enviado ao cliente');
}
