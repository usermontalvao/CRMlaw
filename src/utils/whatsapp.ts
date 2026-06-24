// Helpers para normalizar telefone do escritório ao formato aceito pelo wa.me.
// Centraliza a lógica antes duplicada (portal + tela pública de assinatura).

/**
 * Normaliza um telefone BR para os dígitos aceitos por `https://wa.me/` —
 * `55` (código do país) + DDD (2) + número (8 fixo / 9 móvel).
 * Retorna `null` quando o valor é vazio/curto demais para ser um número válido.
 */
export function toWhatsappNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  // Mínimo: 55 + DDD (2) + número (8) = 12 dígitos (13 com o 9 do celular).
  return withCountry.length >= 12 ? withCountry : null;
}

/**
 * Monta uma URL `https://wa.me/...` com texto opcional já codificado.
 * Retorna `null` quando o telefone é inválido — para o chamador ocultar/
 * desabilitar o botão em vez de gerar um link quebrado.
 */
export function buildWhatsappUrl(raw: string | null | undefined, text?: string): string | null {
  const phone = toWhatsappNumber(raw);
  if (!phone) return null;
  const suffix = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${phone}${suffix}`;
}
