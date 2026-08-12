/**
 * Acompanhamento escrito em português vira configuração — REGRA PURA.
 *
 * O administrador descreve o acompanhamento como falaria com um estagiário:
 *
 *   "primeiro follow-up 2 horas, depois 4, 8, 24, 48, 7 dias, 10, 14,
 *    máximo 30 dias. Respeitar horário comercial, 08 às 18h00 de Cuiabá."
 *
 * e este módulo devolve a MESMA configuração que ele preencheria a mão:
 * a escada de intervalos, o número de tentativas, a janela do dia, os dias da
 * semana e o fuso. Nenhum campo novo, nenhuma regra nova — só uma forma mais
 * rápida de preencher os que já existem.
 *
 * O texto original continua indo para o modelo como instrução de abordagem:
 * é ele que faz cada retomada ser personalizada (bom dia/boa tarde, o que
 * ficou pendente, em que estágio a conversa parou).
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 */

export interface WaAiFollowupPlan {
  /** Escada de intervalos em horas, na ordem das tentativas. */
  hours: number[];
  /** Quantas tentativas — sempre o tamanho da escada. */
  maxAttempts: number;
  /** Minutos desde a meia-noite; null quando o texto não fala de horário. */
  startMinute: number | null;
  endMinute: number | null;
  /** Dias permitidos (0=dom). null quando o texto não fala de dias. */
  days: number[] | null;
  /** Fuso IANA; null quando o texto não cita cidade nenhuma. */
  timezone: string | null;
  /** O que foi entendido, em português, para a tela mostrar de volta. */
  notes: string[];
  /** O que foi deixado de fora, e por quê. */
  warnings: string[];
}

/** Teto absoluto de um intervalo: 30 dias. Acima disso ninguém retoma nada. */
export const WA_AI_FOLLOWUP_MAX_HOURS = 30 * 24;

/** O banco/serviço limita as tentativas em 10 — a escada respeita o mesmo teto. */
export const WA_AI_FOLLOWUP_MAX_ATTEMPTS = 10;

const CITY_TIMEZONES: { re: RegExp; tz: string; label: string }[] = [
  { re: /cuiab[áa]|mato\s*grosso|\bmt\b|manaus/i, tz: 'America/Cuiaba', label: 'Cuiabá / Manaus' },
  { re: /bras[íi]lia|s[ãa]o\s*paulo|\bsp\b|hor[áa]rio\s*de\s*bras/i, tz: 'America/Sao_Paulo', label: 'Brasília / São Paulo' },
  { re: /rio\s*branco|\bacre\b|\bac\b/i, tz: 'America/Rio_Branco', label: 'Rio Branco' },
];

const WEEKDAYS = [1, 2, 3, 4, 5];

/** Tira acento para as buscas ficarem tolerantes ao que o usuário digitou. */
function semAcento(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "2h", "1 dia", "7 dias" — como a escada aparece na tela. */
export function formatWaAiFollowupHours(hours: number[]): string {
  return hours.map(h => {
    if (h < 24) return `${Number(h.toFixed(2))}h`;
    const dias = h / 24;
    const arredondado = Number(dias.toFixed(2));
    return `${arredondado} ${arredondado === 1 ? 'dia' : 'dias'}`;
  }).join(' · ');
}

/**
 * Lê a janela do dia: "08 as 18h00", "das 8h às 18h", "entre 9:30 e 17:00".
 *
 * Um par de números só vira horário quando há sinal disso — a palavra que
 * introduz a faixa ou a forma de relógio em um dos lados. Sem essa exigência,
 * "4, 8" da escada de intervalos viraria "das 4h às 8h".
 */
function extrairJanela(textoSemAcento: string): { start: number; end: number; trecho: string } | null {
  const re = /(?:(das|de|entre|horario|horarios|comercial|expediente)\s*[:,]?\s*)?(\d{1,2})\s*(?::|h)?\s*(\d{2})?\s*(?:horas?)?\s*(?:as|ate|a|-|–|—|e)\s*(\d{1,2})\s*(?::|h)?\s*(\d{2})?\s*(?:horas?|h)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(textoSemAcento)) !== null) {
    const [trecho, introducao, h1, m1, h2, m2] = m;
    const start = Number(h1) * 60 + Number(m1 || 0);
    const end = Number(h2) * 60 + Number(m2 || 0);
    const temRelogio = m1 !== undefined || m2 !== undefined || /\d\s*h/i.test(trecho);
    if (!introducao && !temRelogio) continue;
    if (Number(h1) > 23 || Number(h2) > 23) continue;
    if (start >= end) continue;
    return { start, end, trecho };
  }
  return null;
}

/**
 * Converte a descrição escrita em configuração de acompanhamento.
 *
 * A unidade é herdada do último número que trouxe unidade: em
 * "2 horas, 4, 8, 24, 48, 7 dias, 10, 14" os quatro do meio são horas e os
 * dois do fim são dias — que é exatamente como a frase é lida em voz alta.
 */
export function parseWaAiFollowupPlan(input: string): WaAiFollowupPlan {
  const plan: WaAiFollowupPlan = {
    hours: [], maxAttempts: 0, startMinute: null, endMinute: null,
    days: null, timezone: null, notes: [], warnings: [],
  };

  const original = String(input || '');
  if (!original.trim()) return plan;

  let texto = semAcento(original).toLowerCase();

  // 1. Fuso — antes de mexer no texto, porque some junto com a janela.
  for (const city of CITY_TIMEZONES) {
    if (city.re.test(texto)) {
      plan.timezone = city.tz;
      plan.notes.push(`Fuso: ${city.label}`);
      break;
    }
  }

  // 2. Teto ("maximo 30 dias") sai do texto para não virar mais um degrau.
  let tetoHoras = WA_AI_FOLLOWUP_MAX_HOURS;
  const teto = texto.match(/(?:no\s*)?(?:maximo|max|ate\s*no\s*maximo|limite\s*de)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(dias?|semanas?|h(?:oras?)?|meses?|mes)/);
  if (teto) {
    const valor = Number(teto[1].replace(',', '.'));
    const unidade = teto[2];
    const emHoras = /^s/.test(unidade) ? valor * 24 * 7
      : /^m/.test(unidade) ? valor * 24 * 30
        : /^d/.test(unidade) ? valor * 24
          : valor;
    tetoHoras = Math.min(WA_AI_FOLLOWUP_MAX_HOURS, emHoras);
    plan.notes.push(`Nenhum intervalo passa de ${formatWaAiFollowupHours([tetoHoras])}`);
    texto = texto.replace(teto[0], ' ');
  }

  // 3. Janela do dia e dias da semana.
  const janela = extrairJanela(texto);
  if (janela) {
    plan.startMinute = janela.start;
    plan.endMinute = janela.end;
    plan.notes.push(`Só envia entre ${hhmm(janela.start)} e ${hhmm(janela.end)}`);
    texto = texto.replace(janela.trecho, ' ');
  }

  const comercial = /comercial|util|uteis|expediente|dia\s*de\s*semana|segunda\s*a\s*sexta|seg\s*a\s*sex/.test(texto);
  if (comercial) {
    plan.days = [...WEEKDAYS];
    plan.notes.push('Dias: segunda a sexta');
    if (plan.startMinute === null) {
      plan.startMinute = 8 * 60;
      plan.endMinute = 18 * 60;
      plan.notes.push('Horário comercial assumido: 08:00 às 18:00');
    }
  } else if (/todos\s*os\s*dias|inclusive\s*(?:no\s*)?(?:fim|final)\s*de\s*semana|sabado|domingo/.test(texto)) {
    plan.days = [0, 1, 2, 3, 4, 5, 6];
    plan.notes.push('Dias: todos, inclusive fim de semana');
  }

  // 4. A escada. Ordinais e a própria palavra "follow-up" saem antes para os
  //    números deles não entrarem na conta.
  const escadaTexto = texto
    .replace(/\bfollow[\s-]*ups?\b|\bfolo?[\s-]*ups?\b|\bfalo?[\s-]*ups?\b/g, ' ')
    .replace(/\b\d+\s*[ºoa]\b/g, ' ')
    .replace(/\b(\d+)\s*(?:a|ª)\s*tentativa/g, ' ');

  const tokenRe = /(\d+(?:[.,]\d+)?)\s*(minutos?|mins?|horas?|hrs?|h|dias?|d|semanas?|sem)?/g;
  let unidadeCorrente: 'min' | 'h' | 'd' | 'sem' = 'h';
  const bruto: number[] = [];
  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(escadaTexto)) !== null) {
    const valor = Number(token[1].replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) continue;
    const unidade = token[2];
    if (unidade) {
      unidadeCorrente = /^(min|mins?|minutos?)$/.test(unidade) ? 'min'
        : /^(d|dias?)$/.test(unidade) ? 'd'
          : /^(sem|semanas?)$/.test(unidade) ? 'sem'
            : 'h';
    }
    const emHoras = unidadeCorrente === 'min' ? valor / 60
      : unidadeCorrente === 'd' ? valor * 24
        : unidadeCorrente === 'sem' ? valor * 24 * 7
          : valor;
    bruto.push(Number(emHoras.toFixed(4)));
  }

  const acimaDoTeto = bruto.filter(h => h > tetoHoras);
  let escada = bruto.filter(h => h <= tetoHoras);
  if (acimaDoTeto.length > 0) {
    plan.warnings.push(
      `${acimaDoTeto.length} intervalo(s) passavam de ${formatWaAiFollowupHours([tetoHoras])} e ficaram de fora.`);
  }
  if (escada.length > WA_AI_FOLLOWUP_MAX_ATTEMPTS) {
    plan.warnings.push(
      `A escada tinha ${escada.length} degraus; o agente aceita no máximo `
      + `${WA_AI_FOLLOWUP_MAX_ATTEMPTS} tentativas, então os últimos ficaram de fora.`);
    escada = escada.slice(0, WA_AI_FOLLOWUP_MAX_ATTEMPTS);
  }

  plan.hours = escada;
  plan.maxAttempts = escada.length;
  if (escada.length > 0) {
    plan.notes.unshift(`${escada.length} tentativa(s): ${formatWaAiFollowupHours(escada)}`);
  } else {
    plan.warnings.push('Nenhum intervalo reconhecido — escreva, por exemplo: "2 horas, depois 4, 8, 24, 48, 7 dias".');
  }

  return plan;
}

export default parseWaAiFollowupPlan;
