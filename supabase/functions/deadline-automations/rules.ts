/**
 * deadline-automations/rules
 * -----------------------------------------------------------------------------
 * O miolo PURO das automações de prazo — datas, filtro e templates —, sem nenhuma
 * dependência de runtime (Deno, rede, Supabase). Isolado aqui para poder ser
 * testado sob Node (`node:test` + ts-node), como _shared/nextcloud-path.
 *
 * É a parte que mais compensa testar: um sinal trocado num offset, ou um fuso
 * lido errado, produz prazo com data errada — e prazo com data errada num
 * escritório de advocacia é perda de direito, não bug cosmético.
 */

// Espelho de src/utils/officeTime.ts. O fuso-âncora é o do foro, não o de quem
// executa: a Edge Function roda em UTC e não pode deixar isso vazar para a data.
export const OFFICE_TIME_ZONE = 'America/Cuiaba';

const DIA_MS = 86_400_000;

/**
 * A natureza de cada campo de data do catálogo, que decide como o "dia" dele é
 * lido. Não é detalhe: ler um instante como data pura erra o dia sempre que o
 * horário cair depois das 20:00 de Cuiabá.
 *
 *  - "data"     → valor é data pura, gravada como meia-noite UTC
 *                 (toUtcMidnightIso no RequirementFormModal). O dia é a parte
 *                 YYYY-MM-DD da string, sem conversão nenhuma.
 *  - "instante" → valor é compromisso com hora real (perícia às 13:00). O dia é
 *                 o dia NO FUSO DO ESCRITÓRIO.
 */
export const NATUREZA_DO_CAMPO: Record<string, 'data' | 'instante'> = {
  exigency_due_date: 'data',
  entry_date: 'data',
  pericia_medica_at: 'instante',
  pericia_social_at: 'instante',
};

/** Rótulo humano do campo, usado nos templates e no log. */
export const ROTULO_DO_CAMPO: Record<string, string> = {
  exigency_due_date: 'vencimento da exigência',
  entry_date: 'data de entrada',
  pericia_medica_at: 'perícia médica',
  pericia_social_at: 'perícia social',
};

export interface Filtro {
  field: string;
  op: string;
  value?: unknown;
}

export type LinhaFonte = Record<string, unknown> & { id: string };

// ─── Datas ───────────────────────────────────────────────────────────────────

/** O dia (YYYY-MM-DD) de um instante, no fuso informado. */
export function diaNoFuso(instante: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const bag: Record<string, string> = {};
  for (const parte of fmt.formatToParts(instante)) {
    if (parte.type !== 'literal') bag[parte.type] = parte.value;
  }
  return `${bag.year}-${bag.month}-${bag.day}`;
}

/** Hoje, em YYYY-MM-DD, no fuso do escritório. */
export function hojeNoEscritorio(agora: Date = new Date()): string {
  return diaNoFuso(agora, OFFICE_TIME_ZONE);
}

/**
 * Aritmética de calendário sobre YYYY-MM-DD. Passa por UTC de propósito: são
 * datas puras, sem hora, então não há horário de verão para atrapalhar.
 */
export function somarDias(dia: string, dias: number): string {
  const base = Date.parse(`${dia}T00:00:00Z`);
  if (Number.isNaN(base)) throw new Error(`data inválida: ${dia}`);
  return new Date(base + dias * DIA_MS).toISOString().slice(0, 10);
}

/**
 * A data-fonte que a regra procura hoje.
 *
 * A regra dispara quando (data-fonte + trigger_offset) == hoje; logo, a
 * data-fonte procurada é hoje − trigger_offset. Com trigger −10, no dia 10/09 a
 * regra procura registros cuja data seja 20/09.
 */
export function dataFonteProcurada(hoje: string, triggerOffsetDays: number): string {
  return somarDias(hoje, -triggerOffsetDays);
}

/**
 * Deixa um timestamp do Postgres digerível pelo `Date`.
 *
 * O PostgREST devolve "2026-08-03 13:00:00+00": espaço no lugar do T e offset
 * só com as horas. `new Date()` rejeita as duas coisas e devolve Invalid Date —
 * que, sem esta normalização, faria a linha ser silenciosamente ignorada pela
 * regra em vez de virar prazo.
 */
function normalizarIso(texto: string): string {
  const t = texto.trim().replace(' ', 'T');
  return t.replace(/([+-]\d{2})$/, '$1:00');
}

/** O dia (YYYY-MM-DD) que um valor da fonte representa, conforme sua natureza. */
export function diaDoValor(valor: unknown, campo: string): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor);

  if (NATUREZA_DO_CAMPO[campo] === 'data') {
    // "2026-09-20" ou "2026-09-20 00:00:00+00" → o dia é literal.
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(texto.trim());
    return match ? match[1] : null;
  }

  const instante = new Date(normalizarIso(texto));
  if (Number.isNaN(instante.getTime())) return null;
  return diaNoFuso(instante, OFFICE_TIME_ZONE);
}

// ─── Filtro da fonte ─────────────────────────────────────────────────────────

export function comparar(atual: unknown, op: string, esperado: unknown): boolean {
  const vazio = atual === null || atual === undefined || atual === '';
  const a = vazio ? '' : String(atual).toLowerCase();
  const b = esperado === null || esperado === undefined ? '' : String(esperado).toLowerCase();

  switch (op) {
    case 'eq':       return a === b;
    case 'neq':      return a !== b;
    case 'contains': return a.includes(b);
    case 'is_null':  return vazio;
    case 'not_null': return !vazio;
    case 'in':       return Array.isArray(esperado)
                      && esperado.map((v) => String(v).toLowerCase()).includes(a);
    default:         return false;
  }
}

export function passaNoFiltro(
  linha: LinhaFonte,
  filtros: Filtro[],
  modo: 'all' | 'any',
): boolean {
  if (!Array.isArray(filtros) || filtros.length === 0) return true;
  const resultados = filtros.map((f) => comparar(linha[f.field], f.op, f.value));
  return modo === 'any' ? resultados.some(Boolean) : resultados.every(Boolean);
}

// ─── Template ────────────────────────────────────────────────────────────────

export function formatarBr(dia: string): string {
  const [y, m, d] = dia.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Substitui {{variaveis}} no template. Um token desconhecido fica literal de
 * propósito: some com o texto é pior do que mostrar que o admin errou o nome.
 */
export function aplicarTemplate(
  template: string,
  linha: LinhaFonte,
  diaFonte: string,
  campo: string,
): string {
  const valores: Record<string, string> = {
    cliente: String(linha.beneficiary ?? '').trim() || 'sem nome',
    protocolo: String(linha.protocol ?? '').trim() || 'sem protocolo',
    beneficio: String(linha.benefit_type ?? '').trim() || 'não informado',
    data: formatarBr(diaFonte),
    evento: ROTULO_DO_CAMPO[campo] ?? campo,
  };

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (original, chave: string) =>
    chave in valores ? valores[chave] : original
  );
}

// ─── Seleção dos candidatos ──────────────────────────────────────────────────

/**
 * Entre as linhas trazidas pela janela larga do banco, quais realmente casam.
 * O recorte fino do dia é feito aqui, e não no SQL, porque só aqui se sabe a
 * natureza do campo — data pura ou instante no fuso do escritório.
 */
export function selecionarCandidatos(
  linhas: LinhaFonte[],
  campo: string,
  diaFonte: string,
  filtros: Filtro[],
  modo: 'all' | 'any',
): LinhaFonte[] {
  return linhas.filter((linha) => {
    if (linha.archived === true) return false;
    if (diaDoValor(linha[campo], campo) !== diaFonte) return false;
    return passaNoFiltro(linha, filtros, modo);
  });
}

/**
 * A janela que o banco precisa varrer para o dia procurado: um dia de folga de
 * cada lado, porque o dia UTC e o dia de Cuiabá não coincidem nas pontas.
 */
export function janelaDeBusca(diaFonte: string): { de: string; ate: string } {
  return {
    de: `${somarDias(diaFonte, -1)}T00:00:00Z`,
    ate: `${somarDias(diaFonte, 2)}T00:00:00Z`,
  };
}

/**
 * O vencimento do prazo criado, no formato que o módulo de prazos usa.
 *
 * Meia-noite UTC é a convenção do módulo: o formulário grava
 * `new Date('YYYY-MM-DD').toISOString()` e `formatDate` lê os 10 primeiros
 * caracteres. Gravar em outro fuso faria o prazo automático aparecer um dia
 * fora de lugar ao lado dos manuais.
 */
export function vencimentoDoPrazo(diaFonte: string, dueOffsetDays: number): string {
  return `${somarDias(diaFonte, dueOffsetDays)}T00:00:00.000Z`;
}
