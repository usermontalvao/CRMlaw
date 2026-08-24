const foldSearchText = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');

export const normalizeSearchText = (value?: string | null) => foldSearchText(value).trim();

export const matchesNormalizedSearch = (
  search: string,
  values: Array<string | null | undefined>,
) => {
  const normalizedSearch = normalizeSearchText(search);
  if (!normalizedSearch) return true;

  return values.some((value) => normalizeSearchText(value).includes(normalizedSearch));
};

export const includesNormalizedSearch = (
  value: string | null | undefined,
  search: string,
) => normalizeSearchText(value).includes(normalizeSearchText(search));

/** Substitui texto sem diferenciar acentos, preservando o restante original. */
export const replaceNormalizedSearch = (value: string, search: string, replacement: string): string => {
  const needle = normalizeSearchText(search);
  if (!needle) return value;

  const spans: Array<{ start: number; end: number }> = [];
  let folded = '';
  for (let offset = 0; offset < value.length;) {
    const codePoint = value.codePointAt(offset);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const end = offset + char.length;
    const normalizedChar = foldSearchText(char);
    if (!normalizedChar && spans.length > 0) {
      spans[spans.length - 1].end = end;
    } else {
      folded += normalizedChar;
      for (let index = 0; index < normalizedChar.length; index += 1) spans.push({ start: offset, end });
    }
    offset = end;
  }

  let normalizedOffset = 0;
  let originalOffset = 0;
  let result = '';
  while (normalizedOffset <= folded.length - needle.length) {
    const match = folded.indexOf(needle, normalizedOffset);
    if (match < 0) break;
    const start = spans[match]?.start;
    const end = spans[match + needle.length - 1]?.end;
    if (start === undefined || end === undefined) break;
    result += value.slice(originalOffset, start) + replacement;
    originalOffset = end;
    normalizedOffset = match + needle.length;
  }
  return originalOffset ? result + value.slice(originalOffset) : value;
};

const PORTUGUESE_DIACRITIC_OPTIONS: Record<string, readonly string[]> = {
  a: ['ã', 'á', 'â', 'à'],
  e: ['é', 'ê'],
  i: ['í'],
  o: ['ó', 'ô', 'õ'],
  u: ['ú', 'ü'],
  c: ['ç'],
  n: ['ñ'],
};

/**
 * Cria alternativas pequenas para servidores que não oferecem comparação
 * sem acento (como PostgREST/ILIKE e WebDAV), sem gerar consultas enormes.
 */
export const buildSearchTextVariants = (value: string, maxVariants = 24): string[] => {
  const raw = String(value || '').trim().toLocaleLowerCase('pt-BR');
  if (!raw || maxVariants <= 0) return [];

  const base = normalizeSearchText(raw);
  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    if (!candidate || seen.has(candidate) || variants.length >= maxVariants) return;
    seen.add(candidate);
    variants.push(candidate);
  };

  add(raw);
  add(base);

  const substitutions: Array<{ index: number; value: string }> = [];
  const preferredSubstitutions: Array<{ index: number; value: string }> = [];
  Array.from(base).forEach((char, index) => {
    const options = PORTUGUESE_DIACRITIC_OPTIONS[char] || [];
    if (options[0]) preferredSubstitutions.push({ index, value: options[0] });
    for (const option of options) {
      substitutions.push({ index, value: option });
    }
  });

  const replaceAt = (source: string, replacements: Array<{ index: number; value: string }>) => {
    const chars = Array.from(source);
    for (const replacement of replacements) chars[replacement.index] = replacement.value;
    return chars.join('');
  };

  // Prioriza as marcas mais comuns e seus pares antes das alternativas raras.
  for (const substitution of preferredSubstitutions) add(replaceAt(base, [substitution]));
  for (let first = 0; first < preferredSubstitutions.length && variants.length < maxVariants; first += 1) {
    for (let second = first + 1; second < preferredSubstitutions.length && variants.length < maxVariants; second += 1) {
      add(replaceAt(base, [preferredSubstitutions[first], preferredSubstitutions[second]]));
    }
  }
  for (const substitution of substitutions) add(replaceAt(base, [substitution]));
  for (let first = 0; first < substitutions.length && variants.length < maxVariants; first += 1) {
    for (let second = first + 1; second < substitutions.length && variants.length < maxVariants; second += 1) {
      if (substitutions[first].index === substitutions[second].index) continue;
      add(replaceAt(base, [substitutions[first], substitutions[second]]));
    }
  }

  return variants;
};
