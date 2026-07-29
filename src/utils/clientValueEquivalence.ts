/**
 * utils/clientValueEquivalence
 * -----------------------------------------------------------------------------
 * Diz se dois valores de um mesmo campo do cadastro são o MESMO dado escrito de
 * outro jeito — "Advogado" e "advogado", "65984046375" e "(65) 98404-6375",
 * "casado" e "casado(a)".
 *
 * Serve para a mesclagem de duplicados não trocar seis por meia dúzia: se o
 * valor que viria do outro cadastro é equivalente ao que já está lá, nada é
 * sobrescrito e nada entra no histórico de alterações. Histórico é para mudança
 * de verdade.
 *
 * Módulo sem dependências de propósito, para ser testável isolado.
 */

/** Campos em que só os dígitos importam. */
const DIGIT_ONLY_FIELDS = new Set([
  'cpf_cnpj',
  'phone',
  'mobile',
  'address_zip_code',
  'rg',
]);

const stripAccents = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Normaliza texto para comparação: sem acento, sem caixa, sem pontuação e sem
 * as marcações de gênero que o pessoal digita de formas diferentes —
 * "brasileiro (a)", "brasileiro(a)" e "brasileiro" são a mesma coisa.
 */
export const normalizeClientText = (value: string): string =>
  stripAccents(String(value))
    .toLowerCase()
    .replace(/\(\s*[ao]s?\s*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const onlyDigits = (value: string) => String(value).replace(/\D/g, '');

export const isBlankValue = (value: unknown): boolean =>
  value === null || value === undefined || String(value).trim() === '';

/**
 * `true` quando os dois valores representam o mesmo dado. Dois brancos são
 * equivalentes; branco e preenchido, não.
 */
export const areClientValuesEquivalent = (field: string, a: unknown, b: unknown): boolean => {
  const aBlank = isBlankValue(a);
  const bBlank = isBlankValue(b);
  if (aBlank && bBlank) return true;
  if (aBlank || bBlank) return false;

  if (DIGIT_ONLY_FIELDS.has(field)) {
    const da = onlyDigits(String(a));
    const db = onlyDigits(String(b));
    // Campo de documento sem nenhum dígito (RG antigo com letras, por exemplo)
    // cai na comparação de texto.
    if (da !== '' || db !== '') return da === db;
  }

  return normalizeClientText(String(a)) === normalizeClientText(String(b));
};
