/**
 * Resolve o canal exibido no quadro de Leads a partir do recorte da inbox.
 * "Todos" existe apenas na inbox, pois o Kanban precisa de um funil concreto.
 */
export function nextLeadChannelFilter(
  currentLeadChannel: string,
  inboxChannel: string,
  funnelChannelIds: string[],
): string {
  if (inboxChannel !== 'all' && funnelChannelIds.includes(inboxChannel)) return inboxChannel;
  if (funnelChannelIds.includes(currentLeadChannel)) return currentLeadChannel;
  return funnelChannelIds[0] || '';
}
