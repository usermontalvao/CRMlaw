// Etiquetas/etapas do funil do WhatsApp — fonte única usada pelo orquestrador e
// pelos painéis de etiquetas/quadro. Extraído de `WhatsAppModule` para permitir
// reuso sem import circular.
import type { FunnelLabel } from '../../services/settings.service';

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
