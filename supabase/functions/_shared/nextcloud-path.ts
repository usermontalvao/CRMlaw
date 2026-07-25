/**
 * _shared/nextcloud-path
 * -----------------------------------------------------------------------------
 * Sanitização PURA de caminhos WebDAV — sem nenhuma dependência de runtime
 * (Deno, rede, Supabase). Isolada aqui para poder ser testada sob Node
 * (`node:test` + ts-node) e reutilizada pelas Edge Functions.
 */

export interface SanitizeOptions {
  /** Se `true`, aceita caminho vazio (a raiz). Padrão: false. */
  allowRoot?: boolean;
}

/**
 * Sanitiza um caminho WebDAV relativo à raiz do usuário Nextcloud.
 * Rejeita: caminho vazio (salvo allowRoot), bytes NUL, caracteres de controle,
 * segmentos "." ou "..", barra invertida e caminhos absurdamente longos.
 * Retorna o caminho normalizado (sem barras nas pontas) ou `null` se inválido.
 */
export function sanitizeNextcloudPath(
  raw: unknown,
  opts: SanitizeOptions = {},
): string | null {
  if (typeof raw !== "string") return null;

  // NUL e caracteres de controle nunca são válidos em nomes de arquivo.
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) return null;
  // Barra invertida seria interpretada como separador em alguns backends.
  if (raw.includes("\\")) return null;
  // Limite defensivo de tamanho do caminho inteiro.
  if (raw.length > 4096) return null;

  const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return opts.allowRoot ? "" : null;

  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return null;
    if (segment.length > 255) return null; // limite de nome por segmento
  }
  return segments.join("/");
}
