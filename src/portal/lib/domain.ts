/**
 * domain.ts — Fonte única de verdade do Portal do Cliente.
 *
 * Toda tradução de "linguagem jurídica → linguagem do cliente" vive aqui.
 * As páginas NUNCA devem reinventar status, fase ou cálculo de honorários:
 * sempre derivam deste módulo, garantindo paridade com o sistema principal.
 */

// ════════════════════════════════════════════════════════════════════════════
//  PROCESSOS — status (espelha process.types.ts do sistema principal)
// ════════════════════════════════════════════════════════════════════════════

export type ProcessStatus =
  | 'nao_protocolado'
  | 'distribuido'
  | 'aguardando_confeccao'
  | 'citacao'
  | 'conciliacao'
  | 'contestacao'
  | 'instrucao'
  | 'andamento'
  | 'sentenca'
  | 'recurso'
  | 'cumprimento'
  | 'arquivado';

/** Jornada macro do cliente — 5 etapas que qualquer leigo entende. */
export const JOURNEY = [
  { key: 'preparacao', label: 'Preparação' },
  { key: 'ingresso',   label: 'Ingresso' },
  { key: 'andamento',  label: 'Andamento' },
  { key: 'julgamento', label: 'Julgamento' },
  { key: 'conclusao',  label: 'Conclusão' },
] as const;

export type StatusTone = 'prep' | 'active' | 'attention' | 'decision' | 'done';

interface StatusMeta {
  /** Rótulo idêntico ao do sistema principal (advogado vê o mesmo). */
  label: string;
  /** Explicação em 1 frase para o cliente leigo. */
  explain: string;
  /** Índice da etapa macro (0–4). */
  stage: number;
  tone: StatusTone;
}

export const STATUS_MAP: Record<ProcessStatus, StatusMeta> = {
  nao_protocolado: {
    label: 'Não protocolado',
    explain: 'Seu advogado está preparando os documentos antes de entrar com o processo.',
    stage: 0, tone: 'prep',
  },
  aguardando_confeccao: {
    label: 'Em preparação',
    explain: 'A petição inicial está sendo redigida pelo seu advogado.',
    stage: 0, tone: 'prep',
  },
  distribuido: {
    label: 'Distribuído',
    explain: 'Seu processo foi protocolado e já tramita na Justiça.',
    stage: 1, tone: 'active',
  },
  citacao: {
    label: 'Citação',
    explain: 'A parte contrária está sendo oficialmente notificada sobre o processo.',
    stage: 1, tone: 'active',
  },
  conciliacao: {
    label: 'Conciliação',
    explain: 'Foi marcada uma audiência para tentar um acordo entre as partes.',
    stage: 2, tone: 'attention',
  },
  contestacao: {
    label: 'Contestação',
    explain: 'A outra parte apresentou defesa. Seu advogado vai se manifestar.',
    stage: 2, tone: 'active',
  },
  instrucao: {
    label: 'Instrução',
    explain: 'Fase de produção de provas — documentos, testemunhas e perícias.',
    stage: 2, tone: 'active',
  },
  andamento: {
    label: 'Em andamento',
    explain: 'Seu processo está tramitando normalmente na Justiça.',
    stage: 2, tone: 'active',
  },
  sentenca: {
    label: 'Sentença',
    explain: 'O juiz proferiu uma decisão. Seu advogado está avaliando os próximos passos.',
    stage: 3, tone: 'decision',
  },
  recurso: {
    label: 'Recurso',
    explain: 'Há um recurso em análise por um tribunal superior.',
    stage: 3, tone: 'decision',
  },
  cumprimento: {
    label: 'Cumprimento',
    explain: 'Fase final de cumprimento da decisão — recebimento de valores devidos.',
    stage: 4, tone: 'active',
  },
  arquivado: {
    label: 'Encerrado',
    explain: 'Este processo foi finalizado e arquivado.',
    stage: 4, tone: 'done',
  },
};

const FALLBACK: StatusMeta = {
  label: 'Em andamento',
  explain: 'Seu processo está tramitando na Justiça.',
  stage: 2, tone: 'active',
};

export function statusMeta(status?: string | null): StatusMeta {
  if (!status) return FALLBACK;
  return STATUS_MAP[status as ProcessStatus] ?? FALLBACK;
}

/**
 * Tons de status — paleta SÓBRIA (banco digital). Laranja é o acento da marca;
 * os demais tons são neutros/semânticos de baixa saturação. Nada de pastel
 * gritante nem azul. Use `dot` para o ponto de status, `text` para rótulo,
 * `soft`/`ring` para realces discretos e `bar` para a régua fina do topo.
 */
export const TONE_CLASSES: Record<
  StatusTone,
  { dot: string; text: string; soft: string; ring: string; bar: string }
> = {
  prep:      { dot: 'bg-slate-400',   text: 'text-slate-600',   soft: 'bg-slate-50',    ring: 'ring-slate-200',   bar: 'bg-slate-300' },
  active:    { dot: 'bg-orange-500',  text: 'text-orange-700',  soft: 'bg-orange-50',   ring: 'ring-orange-200',  bar: 'bg-orange-500' },
  attention: { dot: 'bg-amber-500',   text: 'text-amber-700',   soft: 'bg-amber-50',    ring: 'ring-amber-200',   bar: 'bg-amber-400' },
  decision:  { dot: 'bg-slate-900',   text: 'text-slate-800',   soft: 'bg-slate-100',   ring: 'ring-slate-300',   bar: 'bg-slate-800' },
  done:      { dot: 'bg-emerald-500', text: 'text-emerald-700', soft: 'bg-emerald-50',  ring: 'ring-emerald-200', bar: 'bg-emerald-500' },
};

// ════════════════════════════════════════════════════════════════════════════
//  FINANCEIRO — dois fluxos de dinheiro distintos
// ════════════════════════════════════════════════════════════════════════════

export interface AgreementLike {
  total_value?: number;       // acordo: valor da causa | fixo: = honorários
  fee_type?: string;          // 'percentage' | 'fixed'
  fee_percentage?: number;    // ex: 40
  fee_value?: number;         // honorários do advogado
  net_value?: number;         // líquido do cliente (em acordos %)
  paid_total?: number;        // soma bruta das parcelas pagas
  pending_total?: number;
  overdue_total?: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export interface AgreementView {
  isAcordo: boolean;          // true = acordo % (cliente recebe) | false = honorários fixos (cliente paga)
  total: number;              // valor do acordo (acordo) ou honorários (fixo)
  fee: number;                // honorários do advogado
  net: number;                // líquido do cliente (acordo)
  percentage: number;         // % de honorários
  feeRatio: number;           // proporção honorários / total (normaliza parcelas → honorários)
  /** Honorários já pagos/quitados (proporcional). */
  feePaid: number;
  feePending: number;
  feeOverdue: number;
  /** % de honorários já quitados. */
  feeProgress: number;
  // ── Perspectiva do CLIENTE (acordo) ──
  /** Quanto o cliente já recebeu (líquido, descontados honorários). */
  clientReceived: number;
  /** Quanto o cliente ainda tem a receber. */
  clientToReceive: number;
  /** % do líquido já recebido. */
  clientProgress: number;
}

export function agreementView(a: AgreementLike): AgreementView {
  const total = n(a.total_value);
  const fee   = n(a.fee_value) || total;     // fixo: fee == total
  const net   = n(a.net_value);
  const isAcordo = a.fee_type === 'percentage';
  const feeRatio = total > 0 ? fee / total : 1;
  const clientRatio = Math.max(0, 1 - feeRatio); // parte que fica com o cliente

  const feePaid    = n(a.paid_total)    * feeRatio;
  const feePending = n(a.pending_total) * feeRatio;
  const feeOverdue = n(a.overdue_total) * feeRatio;
  const feeProgress = fee > 0 ? Math.min(100, Math.round((feePaid / fee) * 100)) : 0;

  const clientReceived  = n(a.paid_total) * clientRatio;
  const clientToReceive = (n(a.pending_total) + n(a.overdue_total)) * clientRatio;
  const clientProgress  = net > 0 ? Math.min(100, Math.round((clientReceived / net) * 100)) : 0;

  return {
    isAcordo, total, fee, net,
    percentage: n(a.fee_percentage),
    feeRatio, feePaid, feePending, feeOverdue, feeProgress,
    clientReceived, clientToReceive, clientProgress,
  };
}

/** Honorários correspondentes a uma parcela (valor pago × proporção). */
export function installmentFee(value: number, feeRatio: number): number {
  return n(value) * feeRatio;
}

export function formatBRL(v: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n(v));
}
