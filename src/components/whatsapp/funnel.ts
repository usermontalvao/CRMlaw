// Etiquetas/etapas do funil do WhatsApp — fonte única usada pelo orquestrador e
// pelos painéis de etiquetas/quadro. Extraído de `WhatsAppModule` para permitir
// reuso sem import circular.
import type { FunnelLabel } from '../../services/settings.service';
import type { WhatsAppChannelFunnelStage } from '../../types/whatsapp.types';

/** Achata as etapas personalizadas de um canal para o formato usado pela UI. */
export function funnelLabelsFromChannelStages(stages: WhatsAppChannelFunnelStage[]): FunnelLabel[] {
  const out: FunnelLabel[] = [];
  const seen = new Set<string>();
  for (const stage of [...stages].sort((a, b) => a.position - b.position)) {
    if (!stage.is_active) continue;
    const labels = stage.labels?.length ? stage.labels : [stage.label];
    for (const raw of labels) {
      const key = raw.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        stageKey: stage.stage_key,
        stageLabel: stage.label,
        color: stage.color,
        bg: `${stage.color}22`,
      });
    }
  }
  return out;
}

// Fase M: etiquetas pré-definidas para escritório jurídico.
// LEGADO: a fonte única das etiquetas passou a ser o FUNIL configurado em
// Configurações → Leads (cada etapa vincula etiquetas). Este array só serve de
// paleta de fallback para conversas com etiquetas antigas que não existem mais
// no funil — assim elas ainda renderizam (sem cor da etapa) e nada quebra.
export const WA_LABELS: { key: string; color: string; bg: string }[] = [
  { key: 'Urgente',             color: '#dc2626', bg: '#fee2e2' },
  { key: 'Aguardando doc.',     color: '#d97706', bg: '#fef3c7' },
  { key: 'Proposta enviada',    color: '#2563eb', bg: '#dbeafe' },
  { key: 'Audiência próxima',   color: '#7c3aed', bg: '#ede9fe' },
  { key: 'Pagamento pendente',  color: '#ea580c', bg: '#ffedd5' },
  { key: 'Novo cliente',        color: '#059669', bg: '#d1fae5' },
  { key: 'Em negociação',       color: '#0891b2', bg: '#cffafe' },
];

// Resolve a aparência de uma etiqueta a partir do funil (cor da etapa). Se a
// etiqueta não pertencer ao funil ativo, cai no WA_LABELS legado e, por fim,
// num cinza neutro. Garante que toda etiqueta aplicada sempre renderize.
export function resolveLabelMeta(
  key: string,
  funnel: FunnelLabel[],
): { key: string; color: string; bg: string; stageLabel: string } {
  const f = funnel.find(l => l.key === key);
  if (f) return { key, color: f.color, bg: f.bg, stageLabel: f.stageLabel };
  const legacy = WA_LABELS.find(l => l.key === key);
  if (legacy) return { key, color: legacy.color, bg: legacy.bg, stageLabel: '' };
  return { key, color: '#64748b', bg: '#64748b22', stageLabel: '' };
}

/**
 * Normaliza um texto para comparar etapa por NOME (sem acento/caixa/pontuação).
 * "Aguardando Documentos" e "aguardando_documentos" viram a mesma coisa.
 */
export function normalizeStageKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolve a etiqueta que representa uma etapa dentro de um funil concreto.
 *
 * As automações do módulo pedem etapas por chave canônica (ex.: "pedir
 * documento" → `aguardando_documentos`), mas cada canal pode ter um funil
 * próprio, com chaves geradas na criação da etapa (`nova_etapa_3`). Por isso
 * casamos primeiro pela chave e, se não houver, pelo NOME da etapa normalizado —
 * assim uma etapa chamada "Aguardando Documentos" continua recebendo a
 * automação mesmo com identificador diferente. Sem correspondência, devolve
 * null e a automação vira no-op (nunca joga a conversa numa etapa errada).
 */
export function resolveStageTarget(
  funnel: FunnelLabel[],
  stageKey: string,
): FunnelLabel | null {
  const byKey = funnel.find(l => l.stageKey === stageKey);
  if (byKey) return byKey;
  const wanted = normalizeStageKey(stageKey);
  if (!wanted) return null;
  return funnel.find(l => normalizeStageKey(l.stageLabel) === wanted)
    ?? funnel.find(l => normalizeStageKey(l.stageKey) === wanted)
    ?? null;
}

/** Recorte mínimo de conversa que o quadro do funil precisa avaliar. */
export interface FunnelBoardCandidate {
  instance_id: string | null;
  status: string;
  is_blocked?: boolean | null;
  last_message_at?: string | null;
}

/**
 * O quadro de Leads é a fila VIVA do atendimento — mesmo recorte da inbox:
 * fora do canal escolhido, encerrada, contato bloqueado e rascunho de "Nova
 * conversa" sem nenhum envio não aparecem. As etiquetas de etapa continuam
 * gravadas na conversa, então reabrir/desbloquear devolve o card à mesma coluna.
 */
export function isOnFunnelBoard(conv: FunnelBoardCandidate, channelId: string): boolean {
  if (channelId && conv.instance_id !== channelId) return false;
  if (conv.status === 'closed') return false;
  if (conv.is_blocked) return false;
  if (!conv.last_message_at) return false;
  return true;
}

// Dada a lista de etiquetas aplicadas numa conversa, devolve a ETAPA do funil
// mais avançada representada por elas (espelho do avanço comercial/jurídico).
export function inferFunnelStage(
  labels: string[] | null | undefined,
  funnel: FunnelLabel[],
): { stageKey: string; stageLabel: string; color: string } | null {
  if (!labels?.length || !funnel.length) return null;
  // Ordem das etiquetas no funil reflete a ordem das etapas; pega a de maior índice.
  let best = -1; let bestMeta: FunnelLabel | null = null;
  for (const key of labels) {
    const idx = funnel.findIndex(l => l.key === key);
    if (idx > best) { best = idx; bestMeta = funnel[idx]; }
  }
  return bestMeta ? { stageKey: bestMeta.stageKey, stageLabel: bestMeta.stageLabel, color: bestMeta.color } : null;
}
