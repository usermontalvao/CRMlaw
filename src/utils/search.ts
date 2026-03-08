export const normalizeSearchText = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const matchesNormalizedSearch = (
  search: string,
  values: Array<string | null | undefined>,
) => {
  const normalizedSearch = normalizeSearchText(search);
  if (!normalizedSearch) return true;

  return values.some((value) => normalizeSearchText(value).includes(normalizedSearch));
};
