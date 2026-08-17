/**
 * Contagem de prazo processual a partir de uma intimação do DJEN.
 *
 * POR QUE ESTE MÓDULO EXISTE
 * A conta antiga (`ai.service.ts`, `addBusinessDays`) misturava fuso local e UTC
 * na mesma volta do laço: decidia se era fim de semana com `getDay()` (local) e
 * procurava feriado com `toISOString()` (UTC). Como o DJEN grava a
 * disponibilização à meia-noite UTC, no navegador do escritório (America/Cuiaba,
 * UTC-4) a data local recuava um dia: 17/08/2026 é SEGUNDA, e `getDay()`
 * devolvia 0 (domingo). Efeitos medidos em produção:
 *   • 120 dos 403 vencimentos estimados (30%) caíam em sábado ou domingo — numa
 *     função cujo trabalho inteiro é contar dia ÚTIL;
 *   • o feriado era procurado no dia seguinte ao que estava sendo contado, então
 *     o feriado de verdade entrava na conta como dia útil;
 *   • a mesma intimação dava vencimentos diferentes no navegador e no servidor.
 *
 * A CONTA CERTA (CPC)
 *   • art. 224, §2º — publicação = primeiro dia ÚTIL seguinte à disponibilização;
 *   • art. 224, caput — o dia do começo não se conta: a contagem abre no primeiro
 *     dia útil seguinte à publicação;
 *   • art. 219 — prazo processual conta-se só em dias úteis.
 * Somando: vencimento = o N-ésimo dia útil depois da data de publicação.
 *
 * Isto é ESTIMATIVA para triagem e para pré-preencher o formulário de prazo —
 * não substitui a conferência do advogado. Prazo material (decadência,
 * prescrição) corre em dias corridos e não passa por aqui.
 *
 * Tudo em texto 'YYYY-MM-DD' e aritmética em UTC de propósito: data de prazo é
 * dia de calendário, não instante. Nenhum `Date` local encosta na conta, que é
 * exatamente o defeito que este módulo veio consertar.
 *
 * Módulo puro e sem imports (o ts-node do `npm test` carrega sem arrastar
 * a cadeia de imports do serviço).
 */

export type PrioridadeDePrazo = 'baixa' | 'media' | 'alta' | 'urgente';

/** Feriados forenses no formato 'YYYY-MM-DD'. */
export type Feriados = ReadonlySet<string> | readonly string[] | null | undefined;

const DIA_MS = 86400000;

const temFeriado = (feriados: Feriados, dia: string): boolean => {
  if (!feriados) return false;
  if (Array.isArray(feriados)) return feriados.includes(dia);
  return (feriados as ReadonlySet<string>).has(dia);
};

/**
 * Extrai o dia de calendário de uma data do DJEN.
 *
 * Aceita 'YYYY-MM-DD' e ISO completo. O corte nos 10 primeiros caracteres é
 * proposital: a disponibilização chega como meia-noite UTC, e reinterpretá-la
 * em fuso local é justamente o erro que derrubava a contagem.
 */
export const diaDeCalendario = (valor?: string | Date | null): string | null => {
  if (!valor) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  const direto = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direto) return direto[1];
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
};

const paraMs = (dia: string): number => {
  const [ano, mes, d] = dia.split('-').map(Number);
  return Date.UTC(ano, mes - 1, d);
};

const paraDia = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Dia útil = não é sábado, não é domingo, não é feriado forense. */
export const ehDiaUtil = (dia: string, feriados?: Feriados): boolean => {
  const semana = new Date(paraMs(dia)).getUTCDay();
  if (semana === 0 || semana === 6) return false;
  return !temFeriado(feriados, dia);
};

/** Primeiro dia útil DEPOIS de `dia` (nunca o próprio `dia`). */
export const proximoDiaUtil = (dia: string, feriados?: Feriados): string => {
  let ms = paraMs(dia) + DIA_MS;
  while (!ehDiaUtil(paraDia(ms), feriados)) ms += DIA_MS;
  return paraDia(ms);
};

/** Avança `quantidade` dias úteis a partir de `dia` (o próprio `dia` não conta). */
export const somarDiasUteis = (dia: string, quantidade: number, feriados?: Feriados): string => {
  let atual = dia;
  for (let i = 0; i < Math.max(0, Math.trunc(quantidade)); i++) {
    atual = proximoDiaUtil(atual, feriados);
  }
  return atual;
};

/** Publicação = primeiro dia útil seguinte à disponibilização (CPC 224, §2º). */
export const dataDePublicacao = (disponibilizacao: string, feriados?: Feriados): string =>
  proximoDiaUtil(disponibilizacao, feriados);

/** Primeiro dia contado: o dia do começo não se conta (CPC 224, caput). */
export const inicioDaContagem = (disponibilizacao: string, feriados?: Feriados): string =>
  proximoDiaUtil(dataDePublicacao(disponibilizacao, feriados), feriados);

export interface ContagemDePrazo {
  /** Data de publicação presumida. */
  publicacao: string;
  /** Primeiro dia efetivamente contado. */
  inicio: string;
  /** Último dia do prazo — sempre dia útil. */
  vencimento: string;
}

/**
 * Contagem completa, ou `null` quando faltam dados para contar.
 *
 * `dias` é o número que a IA leu LITERALMENTE no texto ("prazo de 15 dias").
 */
export const contarPrazoDaIntimacao = (
  disponibilizacao?: string | Date | null,
  dias?: number | null,
  feriados?: Feriados,
): ContagemDePrazo | null => {
  const base = diaDeCalendario(disponibilizacao);
  if (!base) return null;
  if (!dias || !Number.isFinite(dias) || dias <= 0) return null;

  const publicacao = dataDePublicacao(base, feriados);
  const inicio = proximoDiaUtil(publicacao, feriados);
  // O início já é o 1º dia contado; faltam os outros (dias - 1).
  const vencimento = somarDiasUteis(inicio, Math.trunc(dias) - 1, feriados);
  return { publicacao, inicio, vencimento };
};

/**
 * Prioridade do prazo a partir da urgência lida pela IA.
 *
 * Havia duas cópias divergentes desta regra no módulo de intimações: uma
 * devolvia 'alta' até para urgência 'baixa', a outra devolvia 'baixa'. O mesmo
 * botão dava prioridades diferentes conforme o caminho da tela. Aqui a urgência
 * declarada é respeitada, e só a AUSÊNCIA de urgência cai em 'alta' — sem
 * informação, o conservador para um escritório é tratar como urgente.
 */
export const prioridadePorUrgencia = (urgencia?: string | null): PrioridadeDePrazo => {
  switch (urgencia) {
    case 'critica': return 'urgente';
    case 'alta': return 'alta';
    case 'media': return 'media';
    case 'baixa': return 'baixa';
    default: return 'alta';
  }
};

/**
 * Data sugerida para o prazo INTERNO: um dia útil antes do vencimento.
 *
 * A margem existe para o escritório protocolar com folga. Ela era de um dia
 * corrido, o que jogava o controle para sábado sempre que o vencimento caía na
 * segunda; um dia útil antes cai na sexta, que é quando alguém trabalha.
 */
export const dataInternaDoPrazo = (vencimento?: string | Date | null, feriados?: Feriados): string => {
  const dia = diaDeCalendario(vencimento);
  if (!dia) return '';
  let ms = paraMs(dia) - DIA_MS;
  while (!ehDiaUtil(paraDia(ms), feriados)) ms -= DIA_MS;
  return paraDia(ms);
};
