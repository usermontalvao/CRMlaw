/**
 * utils/entityTag
 * -----------------------------------------------------------------------------
 * Formatação PURA de ETag para os headers condicionais do HTTP (If-Match).
 *
 * Por que isso existe: o proxy do Nextcloud devolve o ETag JÁ SEM as aspas
 * (`stat` faz `replace(/^"|"$/)`), o que é ótimo para comparar e guardar. Mas o
 * RFC 7232 define `If-Match` como uma *entity-tag*, e entity-tag é um
 * quoted-string — `"abc"` ou `W/"abc"`, nunca `abc` solto.
 *
 * Mandar o valor cru fazia o Sabre/Nextcloud comparar `abc` com `"abc"`, nunca
 * casar e responder 412 em TODO salvamento — um "conflito de versão" falso, que
 * é pior do que não ter checagem nenhuma: ensina o usuário a ignorar o aviso.
 */

/**
 * Converte um ETag guardado (com ou sem aspas) em uma entity-tag válida para
 * `If-Match`. Devolve `null` quando não há ETag utilizável — nesse caso o
 * chamador deve simplesmente omitir o header.
 */
export function toEntityTag(etag: string | null | undefined): string | null {
  const raw = String(etag ?? '').trim();
  if (!raw) return null;
  // Já veio no formato correto ("abc" ou W/"abc"): não mexe.
  if (/^(W\/)?"[^"]*"$/.test(raw)) return raw;
  // `*` é o coringa do RFC: vale para qualquer versão, e não leva aspas.
  if (raw === '*') return raw;
  // Valor cru vindo do proxy: aspas internas quebrariam o header.
  const sanitized = raw.replace(/"/g, '');
  return sanitized ? `"${sanitized}"` : null;
}

/**
 * Compara dois ETags ignorando aspas e o prefixo fraco `W/`. Usado para saber
 * se a versão remota REALMENTE mudou antes de alarmar o usuário.
 */
export function sameEntityTag(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalize = (value: string | null | undefined) =>
    String(value ?? '').trim().replace(/^W\//i, '').replace(/"/g, '');
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  return left === right;
}
