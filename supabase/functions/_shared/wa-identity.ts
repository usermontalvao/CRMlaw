/**
 * Identidade do contato no WhatsApp — parte pura, testável fora do Deno.
 *
 * O WhatsApp endereça o mesmo contato de duas formas: pelo telefone
 * (`5565...@s.whatsapp.net`) e pelo LID (`124760310726826@lid`), um apelido
 * interno que ESCONDE o número. A Evolution costuma resolver o LID e mandar o
 * telefone junto (`key.remoteJidAlt`), mas nem sempre: em 10/08/2026 a mesma
 * mensagem chegou duas vezes com 1s de diferença — a primeira só com o LID, a
 * segunda já resolvida — e a primeira abriu uma conversa fantasma do contato
 * que já estava aberto.
 *
 * Daí as duas peças aqui:
 *  - `stanzaIdCitado`: quando a mensagem responde a outra, a citação denuncia a
 *    thread certa mesmo sem telefone nenhum;
 *  - `patchIdentidade`: quando o telefone real aparece DEPOIS, promove a
 *    conversa que nasceu com o LID — e nunca faz o caminho inverso.
 */

/** Telefone real (E.164 sem '+'): 55 + DDD + 8/9 dígitos. LID tem 15+. */
export const TELEFONE_REAL = /^\d{12,13}$/;

export function ehTelefoneReal(valor: string | null | undefined): boolean {
  return TELEFONE_REAL.test(valor || '');
}

/**
 * ID da mensagem citada (resposta), venha do nível da mensagem ou de dentro do
 * nó de conteúdo. A Evolution hoista o `contextInfo` para o topo em mensagens
 * de texto simples, mas o mantém dentro do nó em mídia e texto estendido.
 */
export function stanzaIdCitado(m: unknown, msg: unknown): string | null {
  const direto = (m as any)?.contextInfo?.stanzaId;
  if (typeof direto === 'string' && direto) return direto;
  for (const no of Object.values((msg || {}) as Record<string, unknown>)) {
    const id = (no as any)?.contextInfo?.stanzaId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

export type IdentidadeAtual = {
  contact_phone: string | null;
  contact_name: string | null;
};

export type IdentidadeRecebida = {
  /** Dígitos de `remoteJidAlt` quando resolvido; senão os dígitos do LID. */
  phone: string;
  /** Nome exibido pelo contato — só vale em mensagem RECEBIDA. */
  pushName: string | null;
  fromMe: boolean;
};

/**
 * O que gravar na conversa a partir desta mensagem.
 *
 * Telefone: só sobe de LID para telefone real. Sobrescrever um telefone real
 * com o LID da entrega seguinte quebraria envio, busca e vínculo com o cliente.
 *
 * Nome: `pushName` só é do contato quando a mensagem é RECEBIDA — em mensagem
 * própria ele é o nome do dono da conta conectada, e aplicá-lo batizava todo
 * contato novo com o nome do atendente. Fora isso, mantém o nome fresco quando
 * já sabemos que é a mesma pessoa (telefone bate).
 */
export function patchIdentidade(
  atual: IdentidadeAtual,
  recebida: IdentidadeRecebida,
): Record<string, string> {
  const patch: Record<string, string> = {};
  const guardadoReal = ehTelefoneReal(atual.contact_phone);
  const chegouReal = ehTelefoneReal(recebida.phone);

  if (chegouReal && !guardadoReal && atual.contact_phone !== recebida.phone) {
    patch.contact_phone = recebida.phone;
  }

  const mesmaPessoa = guardadoReal && atual.contact_phone === recebida.phone;
  if (
    recebida.pushName && !recebida.fromMe &&
    atual.contact_name !== recebida.pushName &&
    (!atual.contact_name || mesmaPessoa)
  ) {
    patch.contact_name = recebida.pushName;
  }

  return patch;
}
