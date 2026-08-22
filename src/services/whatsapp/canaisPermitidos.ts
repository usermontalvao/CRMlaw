/**
 * A SEGUNDA TRANCA — a do lado do navegador.
 *
 * A tranca de verdade é do banco: `wa_can_see_conv` recorta conversa, mensagem,
 * ligação, evento de atendimento e contador ANTES de a consulta responder (ver
 * a migration `whatsapp_visibilidade_por_canal_no_backend`). Nada aqui é
 * segurança — esconder na tela o que o servidor entregou não protege ninguém,
 * porque a mesma resposta está a um F12 de distância.
 *
 * Isto aqui existe para o intervalo entre uma coisa e outra: a lista que já
 * estava na tela quando a permissão mudou, o cache de sessão de uma aba aberta
 * desde antes, um caminho de leitura que amanhã alguém acrescente sem lembrar
 * da policy. Se o banco falhar em algum desses, a lista lateral ainda assim não
 * pinta a conversa de um canal que a pessoa não pode ver.
 *
 * ── A REGRA DO VAZIO ────────────────────────────────────────────────────────
 *
 * `null` (não sei) e `[]` (nenhum canal) recebem o mesmo tratamento: NÃO
 * FILTRA. Parece o contrário do que uma trava deveria fazer, e é de propósito —
 * consulta feita antes de a sessão do Supabase ser restaurada devolve zero
 * linhas e nenhum erro, indistinguível de "o escritório não tem canal". Filtrar
 * por essa lista esvaziaria a inbox de todo mundo no boot. O custo de errar
 * para este lado é nenhum: o servidor já não teria mandado o que não pode.
 *
 * Conversa SEM canal (`instance_id` nulo) passa: ela não pertence a canal
 * nenhum, e quem decide sobre ela é a policy — que hoje a trata como visível a
 * quem é do escritório.
 *
 * Sem imports de propósito: módulo puro, para o `node --test` conseguir
 * carregá-lo sem arrastar a cadeia do cliente do Supabase.
 */

/** O mínimo que uma linha precisa ter para ser filtrada por canal. */
export interface TemCanal {
  instance_id?: string | null;
}

/**
 * Devolve só o que pertence a canal permitido.
 *
 * @param canaisPermitidos ids dos canais que o servidor entregou para este
 *        usuário; `null` ou vazio = "ainda não sei", e aí nada é filtrado.
 */
export function filtrarPorCanalPermitido<T extends TemCanal>(
  linhas: readonly T[] | null | undefined,
  canaisPermitidos: readonly string[] | null | undefined,
): T[] {
  const linhasSeguras = linhas ?? [];
  if (!canaisPermitidos || canaisPermitidos.length === 0) return [...linhasSeguras];
  const permitidos = new Set(canaisPermitidos);
  return linhasSeguras.filter(l => !l.instance_id || permitidos.has(l.instance_id));
}
