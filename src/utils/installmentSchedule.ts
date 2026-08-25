/**
 * Cronograma de parcelas — fonte única de verdade das DATAS de vencimento.
 *
 * Todo cálculo aqui é feito em data local pura (ano/mês/dia), nunca em UTC.
 * `new Date('2026-08-15')` é lido pelo JS como meia-noite UTC; em Cuiabá
 * (UTC-4) isso já é 14/08 às 20h, e formatar essa data em local devolvia o
 * dia anterior — foi assim que a agenda passou a mostrar as parcelas um dia
 * antes do vencimento registrado no financeiro.
 *
 * Módulo sem imports de propósito: é o que permite testá-lo com ts-node.
 */

export interface CustomInstallmentDate {
  due_date?: string | null;
  value?: number | string | null;
}

export interface ScheduleItem {
  number: number;
  dueDate: string;
  value: number;
}

export interface BuildScheduleParams {
  paymentType: 'upfront' | 'installments';
  totalValue: number;
  installmentsCount: number;
  firstDueDate: string;
  customInstallments?: CustomInstallmentDate[] | null;
}

/** Converte um Date para 'YYYY-MM-DD' usando os componentes locais. */
export function formatLocalISODate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Lê 'YYYY-MM-DD' (ou 'DD/MM/YYYY') como meia-noite LOCAL. */
export function parseLocalDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = s.slice(0, 10);
  if (iso.includes('-')) {
    const [y, m, d] = iso.split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  if (s.includes('/')) {
    const [d, m, y] = s.split('/').slice(0, 3).map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  return null;
}

/**
 * Soma meses a uma data 'YYYY-MM-DD' preservando o dia do vencimento.
 * Quando o mês de destino não tem aquele dia (31/01 + 1 mês), o vencimento
 * cai no último dia do mês — nunca transborda para o mês seguinte.
 */
export function addMonthsToISODate(iso: string, months: number): string {
  const base = parseLocalDate(iso);
  if (!base) return iso;
  const day = base.getDate();
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDayOfTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDayOfTarget));
  return formatLocalISODate(target);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Monta o cronograma completo do lançamento.
 *
 * Uma parcela personalizada sem data NÃO herda mais a data da primeira:
 * ela cai no mês correspondente ao seu número, que é o que o usuário espera
 * ao personalizar só alguns vencimentos.
 */
export function buildInstallmentSchedule(params: BuildScheduleParams): ScheduleItem[] {
  const { paymentType, totalValue, firstDueDate } = params;
  if (!firstDueDate) return [];

  if (paymentType === 'upfront') {
    return [{ number: 1, dueDate: firstDueDate, value: round2(totalValue) }];
  }

  const count = Math.max(1, Math.trunc(params.installmentsCount || 1));
  const custom = params.customInstallments?.length ? params.customInstallments : null;
  const defaultValue = count > 0 ? totalValue / count : totalValue;

  const schedule: ScheduleItem[] = [];
  for (let i = 0; i < count; i++) {
    const item = custom?.[i];
    const customValue = toNumber(item?.value ?? null);
    schedule.push({
      number: i + 1,
      dueDate: item?.due_date || addMonthsToISODate(firstDueDate, i),
      value: round2(customValue ?? defaultValue),
    });
  }
  return schedule;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}
