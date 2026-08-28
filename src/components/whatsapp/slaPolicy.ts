// A política de SLA do módulo — uma só, vinda do canal.
//
// Até 27/08/2026 os números viviam em cinco lugares do front (`slaSignal`,
// `slaInternalSignal`, `abandonedSignal`, `transferAlert`, `DEFAULT_QUEUE_POLICY`)
// e um sexto, diferente, dentro do SQL do dashboard. A mesma conversa podia
// estar vermelha na fila e "dentro do prazo" no painel. Agora o canal guarda os
// patamares (colunas `sla_*` em `whatsapp_instances`), o banco tem o mesmo
// relógio de tempo útil da inbox (`wa_business_elapsed_minutes`), e este módulo
// é o único lugar do navegador que sabe converter uma linha de canal em regra.
//
// PURO DE PROPÓSITO: nenhum import, como `businessTime` e `attendanceRouting`.
// Quem precisa dos números injeta o resolvedor; ninguém aqui vai ao banco.

export interface SlaPolicy {
  /** Espera do cliente a partir da qual a conversa fica âmbar. */
  warnMinutes: number;
  /** Espera a partir da qual fica vermelha e conta como estourada. */
  breachMinutes: number;
  /** Tempo em fila de setor, sem responsável, que já pede atenção. */
  queueWarnMinutes: number;
  /** Tempo em fila de setor que conta como gargalo. */
  queueBreachMinutes: number;
  /** Transferência sem aceite por mais que isto vai para o topo da fila. */
  transferAcceptMinutes: number;
  /** Conversa COM responsável e sem resposta por mais que isto é abandono. */
  abandonedMinutes: number;
  /** O relógio só corre dentro do expediente do canal. */
  businessHoursOnly: boolean;
}

/**
 * Os mesmos padrões do `DEFAULT` das colunas no banco.
 *
 * Existe para a tela nunca ficar sem regra: canal ainda não carregado, conversa
 * órfã de canal (elas existem) ou canal removido caem aqui em vez de deixar o
 * badge sumir — um SLA que desaparece é pior que um SLA aproximado.
 */
export const DEFAULT_SLA_POLICY: SlaPolicy = {
  warnMinutes: 15,
  breachMinutes: 60,
  queueWarnMinutes: 30,
  queueBreachMinutes: 120,
  transferAcceptMinutes: 15,
  abandonedMinutes: 240,
  businessHoursOnly: true,
};

/** Resolve a política do canal de uma conversa. */
export type SlaPolicyFor = (channelId?: string | null) => SlaPolicy;

/** Linha de canal, no formato que vem do banco. Campos ausentes caem no padrão. */
export interface SlaPolicyRow {
  sla_warn_minutes?: number | null;
  sla_breach_minutes?: number | null;
  sla_queue_warn_minutes?: number | null;
  sla_queue_breach_minutes?: number | null;
  sla_transfer_accept_minutes?: number | null;
  sla_abandoned_minutes?: number | null;
  sla_business_hours_only?: boolean | null;
}

const inteiroPositivo = (v: unknown, padrao: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : padrao;
};

/**
 * Converte a linha do canal em regra, com a MESMA ordem que o CHECK do banco
 * garante: âmbar nunca depois do vermelho.
 *
 * O banco já recusa a inversão, mas a tela também precisa da trava: um canal
 * gravado antes do CHECK, ou um retrato antigo em cache, faria a conversa pular
 * de "sem sinal" direto para "estourada" sem nunca passar por "atenção" — e o
 * atendente leria isso como bug da cor, não como configuração errada.
 */
export function slaPolicyFromRow(row: SlaPolicyRow | null | undefined): SlaPolicy {
  if (!row) return DEFAULT_SLA_POLICY;
  const warn = inteiroPositivo(row.sla_warn_minutes, DEFAULT_SLA_POLICY.warnMinutes);
  const queueWarn = inteiroPositivo(row.sla_queue_warn_minutes, DEFAULT_SLA_POLICY.queueWarnMinutes);
  return {
    warnMinutes: warn,
    breachMinutes: Math.max(warn, inteiroPositivo(row.sla_breach_minutes, DEFAULT_SLA_POLICY.breachMinutes)),
    queueWarnMinutes: queueWarn,
    queueBreachMinutes: Math.max(queueWarn, inteiroPositivo(row.sla_queue_breach_minutes, DEFAULT_SLA_POLICY.queueBreachMinutes)),
    transferAcceptMinutes: inteiroPositivo(row.sla_transfer_accept_minutes, DEFAULT_SLA_POLICY.transferAcceptMinutes),
    abandonedMinutes: inteiroPositivo(row.sla_abandoned_minutes, DEFAULT_SLA_POLICY.abandonedMinutes),
    businessHoursOnly: row.sla_business_hours_only !== false,
  };
}

/**
 * Resolvedor por canal, para injetar nos sinais e na fila.
 *
 * Memoriza porque é chamado uma vez por linha da inbox a cada repintura.
 */
export function slaPolicyForChannels(
  byChannel: Readonly<Record<string, SlaPolicyRow | null | undefined>>,
): SlaPolicyFor {
  const cache = new Map<string, SlaPolicy>();
  return (channelId?: string | null) => {
    if (!channelId) return DEFAULT_SLA_POLICY;
    let p = cache.get(channelId);
    if (!p) {
      p = slaPolicyFromRow(byChannel[channelId]);
      cache.set(channelId, p);
    }
    return p;
  };
}

/**
 * O que a fila (`attendanceRouting`) precisa, no vocabulário dela.
 *
 * Aquele módulo não importa nada de propósito, então a tradução mora aqui.
 */
export function queueThresholdsFor(policyFor: SlaPolicyFor) {
  return (channelId?: string | null) => {
    const p = policyFor(channelId);
    return {
      slaWarnMinutes: p.warnMinutes,
      slaBreachMinutes: p.breachMinutes,
      queueWarnMinutes: p.queueWarnMinutes,
      transferAcceptTimeoutMinutes: p.transferAcceptMinutes,
    };
  };
}
