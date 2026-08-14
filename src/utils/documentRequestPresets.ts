const MAX_PRESETS = 50;
const MAX_PRESET_LENGTH = 120;

const comparableLabel = (label: string) => label.trim().toLocaleLowerCase('pt-BR');

/** Limpa a lista antes de exibi-la ou persistir: sem vazios e duplicatas. */
export function normalizeDocumentRequestPresets(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawLabel of labels) {
    const label = rawLabel.trim().slice(0, MAX_PRESET_LENGTH);
    const key = comparableLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(label);
    if (normalized.length === MAX_PRESETS) break;
  }

  return normalized;
}

export function addDocumentRequestPreset(labels: readonly string[], label: string): string[] {
  return normalizeDocumentRequestPresets([...labels, label]);
}

export function removeDocumentRequestPreset(labels: readonly string[], label: string): string[] {
  const target = comparableLabel(label);
  return normalizeDocumentRequestPresets(labels.filter(current => comparableLabel(current) !== target));
}
