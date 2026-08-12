/**
 * O resumo de handoff é um recado operacional para quem recebeu a conversa.
 * O componente nem consulta a sessão quando esta regra devolve false.
 */
export function canShowPrivateAiHandoffSummary(input: {
  currentUserId: string | null;
  assignedUserId: string | null;
  status: string | null;
}): boolean {
  return input.status === 'handed_off'
    && !!input.currentUserId
    && input.assignedUserId === input.currentUserId;
}

