// Canal preferido de quem atende: qual número já vem selecionado ao abrir
// "Nova conversa". Lógica pura (sem React e sem imports do projeto) para poder
// ser testada; o acesso ao localStorage fica em duas funções finas no fim.
//
// É preferência de PESSOA, não do escritório: cada atendente costuma trabalhar
// sempre pelo mesmo número, e escolher o canal a cada conversa nova é um passo
// que nunca muda de resposta. Fica no navegador pelo mesmo motivo dos filtros
// da inbox (ver `inboxFilters.ts`): a escolha vale para quem está ali, e o
// modal precisa abrir já pré-selecionado, sem esperar uma consulta.
//
// O ponto delicado é o mesmo dos filtros: o canal salvo pode ter sido removido
// — ou apenas estar desconectado hoje, e a lista que chega aqui só traz os
// conectados. Um id órfão pré-selecionaria um `<select>` vazio e o envio
// falharia com "selecione um canal" sem nada explicando o porquê. Por isso o
// valor guardado só é aceito quando ainda está entre os disponíveis.

export const PREFERRED_CHANNEL_KEY = 'wa_preferred_channel';

/**
 * Canal que abre selecionado: o preferido quando ainda existe na lista, senão
 * o primeiro disponível (o comportamento de antes). String vazia sem canais.
 */
export function pickInitialChannel(stored: string | null, channelIds: readonly string[]): string {
  if (channelIds.length === 0) return '';
  if (stored && channelIds.includes(stored)) return stored;
  return channelIds[0];
}

/** O canal escolhido é o preferido salvo (para o botão saber que já está marcado). */
export function isPreferredChannel(stored: string | null, channelId: string): boolean {
  return !!channelId && stored === channelId;
}

/**
 * O que gravar ao clicar em "usar como padrão": marca o canal atual ou, se ele
 * já era o padrão, desmarca (volta a não ter preferência). `null` = apagar.
 */
export function togglePreferred(stored: string | null, channelId: string): string | null {
  if (!channelId) return stored;
  return stored === channelId ? null : channelId;
}

// ── Acesso ao armazenamento (fino de propósito) ──────────────────────
export function readPreferredChannel(): string | null {
  try { return localStorage.getItem(PREFERRED_CHANNEL_KEY); } catch { return null; }
}

export function writePreferredChannel(channelId: string | null): void {
  try {
    if (channelId) localStorage.setItem(PREFERRED_CHANNEL_KEY, channelId);
    else localStorage.removeItem(PREFERRED_CHANNEL_KEY);
  } catch { /* storage indisponível */ }
}
