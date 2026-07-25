/**
 * utils/nextcloudNames
 * -----------------------------------------------------------------------------
 * Geração PURA de nomes para o módulo Nextcloud — sem dependência de serviço,
 * Supabase ou DOM, para poder ser testada sob Node e reutilizada pelo
 * resolvedor de conflitos e pela UI.
 */

/** Separa "arquivo.tar.gz" em base + extensão simples (a última). */
export function splitNameExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  // Sem ponto, ou ponto inicial (arquivo oculto sem extensão) → tudo é base.
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Gera um nome único a partir de `name`, evitando os nomes já `taken`.
 * Convenção consistente com o resto do módulo: "base (cópia).ext", depois
 * "base (cópia 2).ext", "base (cópia 3).ext"...
 */
export function nextAvailableName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const { base, ext } = splitNameExt(name);
  let candidate = `${base} (cópia)${ext}`;
  let i = 1;
  while (taken.has(candidate)) {
    i += 1;
    candidate = `${base} (cópia ${i})${ext}`;
  }
  return candidate;
}

/** Junta diretório + nome em um caminho relativo (sem barras duplicadas). */
export function joinPath(dir: string, name: string): string {
  return [dir, name].filter(Boolean).join('/');
}
