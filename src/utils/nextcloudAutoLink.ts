/**
 * utils/nextcloudAutoLink
 * -----------------------------------------------------------------------------
 * Lógica PURA de vinculação automática de pastas do Nextcloud a clientes —
 * sem dependência de serviço, Supabase ou DOM, para poder ser testada sob Node
 * e reutilizada pela UI (NextcloudBrowser).
 *
 * Regra de negócio (definida pelo usuário):
 *   • Vincula sozinho SOMENTE quando há 100% de certeza: um CPF/CNPJ contido no
 *     nome da pasta que casa com um único cliente, ou o nome da pasta idêntico
 *     (normalizado) ao nome de um único cliente.
 *   • Quando o nome sugere que "pode ser outra pessoa" (homônimos, ou casamento
 *     apenas parcial), NÃO vincula: gera um candidato para confirmação manual.
 */

/** Cliente mínimo necessário para o match (subconjunto de `Client`). */
export interface AutoLinkClient {
  id: string;
  full_name: string;
  cpf_cnpj?: string | null;
}

/** Pasta mínima necessária para o match (subconjunto de `NextcloudEntry`). */
export interface AutoLinkFolder {
  name: string;
  path: string;
}

/** Por que um cliente foi apontado como candidato/vínculo. */
export type AutoLinkReason = 'cpf' | 'name-exact' | 'name-partial';

/** Vínculo com certeza total, aplicável automaticamente. */
export interface AutoLinkMatch {
  folderPath: string;
  folderName: string;
  clientId: string;
  clientName: string;
  reason: 'cpf' | 'name-exact';
}

/** Pasta ambígua: exige confirmação do usuário entre um ou mais candidatos. */
export interface AutoLinkCandidate {
  folderPath: string;
  folderName: string;
  candidates: Array<{ clientId: string; clientName: string; reason: AutoLinkReason }>;
}

/** Resultado da varredura. */
export interface AutoLinkPlan {
  /** Aplicar imediatamente — 100% de certeza. */
  auto: AutoLinkMatch[];
  /** Apresentar ao usuário para escolha/confirmação. */
  confirm: AutoLinkCandidate[];
  /** Pastas sem nenhum candidato. */
  unmatched: string[];
}

/** Remove acentos, baixa a caixa e colapsa não-alfanuméricos em espaço. */
export function normalizeName(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Mantém apenas os dígitos (para comparar CPF/CNPJ independente de máscara). */
export function onlyDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D+/g, '');
}

/** Contenção por token inteiro: ` a b ` contém ` a ` mas "joana" não contém "ana". */
function containsWholeTokens(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Analisa as pastas contra a lista de clientes e devolve o plano de vinculação.
 * `linkedPaths` são caminhos já vinculados (ignorados). A ordem de precedência é
 * CPF/CNPJ > nome exato > nome parcial.
 */
export function planAutoLinks(
  folders: readonly AutoLinkFolder[],
  clients: readonly AutoLinkClient[],
  linkedPaths: ReadonlySet<string> = new Set(),
): AutoLinkPlan {
  const auto: AutoLinkMatch[] = [];
  const confirm: AutoLinkCandidate[] = [];
  const unmatched: string[] = [];

  // Índice de nome normalizado -> clientes (detecta homônimos).
  const byNormName = new Map<string, AutoLinkClient[]>();
  for (const c of clients) {
    const n = normalizeName(c.full_name);
    if (!n) continue;
    const bucket = byNormName.get(n);
    if (bucket) bucket.push(c);
    else byNormName.set(n, [c]);
  }

  for (const folder of folders) {
    if (linkedPaths.has(folder.path)) continue;

    const folderDigits = onlyDigits(folder.name);
    const normFolder = normalizeName(folder.name);

    // 1) CPF/CNPJ contido no nome da pasta (11 ou 14 dígitos, para evitar
    //    falsos positivos com números curtos como número de processo).
    const cpfMatches = folderDigits
      ? clients.filter((c) => {
          const d = onlyDigits(c.cpf_cnpj);
          return (d.length === 11 || d.length === 14) && folderDigits.includes(d);
        })
      : [];
    if (cpfMatches.length === 1) {
      const c = cpfMatches[0];
      auto.push({ folderPath: folder.path, folderName: folder.name, clientId: c.id, clientName: c.full_name, reason: 'cpf' });
      continue;
    }
    if (cpfMatches.length > 1) {
      confirm.push({
        folderPath: folder.path,
        folderName: folder.name,
        candidates: cpfMatches.map((c) => ({ clientId: c.id, clientName: c.full_name, reason: 'cpf' as const })),
      });
      continue;
    }

    // 2) Nome idêntico (normalizado).
    const exact = normFolder ? byNormName.get(normFolder) ?? [] : [];
    if (exact.length === 1) {
      const c = exact[0];
      auto.push({ folderPath: folder.path, folderName: folder.name, clientId: c.id, clientName: c.full_name, reason: 'name-exact' });
      continue;
    }
    if (exact.length > 1) {
      // Homônimos: exatamente o caso "pode ser outra pessoa" → confirmar.
      confirm.push({
        folderPath: folder.path,
        folderName: folder.name,
        candidates: exact.map((c) => ({ clientId: c.id, clientName: c.full_name, reason: 'name-exact' as const })),
      });
      continue;
    }

    // 3) Nome parcial (a pasta contém o nome do cliente, por tokens inteiros, ou
    //    vice-versa). Nunca automático — apenas sugestão para confirmar.
    if (normFolder.length >= 3) {
      const seen = new Set<string>();
      const partial: AutoLinkCandidate['candidates'] = [];
      for (const c of clients) {
        const n = normalizeName(c.full_name);
        if (n.length < 3 || seen.has(c.id)) continue;
        if (containsWholeTokens(normFolder, n) || containsWholeTokens(n, normFolder)) {
          seen.add(c.id);
          partial.push({ clientId: c.id, clientName: c.full_name, reason: 'name-partial' });
        }
      }
      if (partial.length > 0) {
        confirm.push({ folderPath: folder.path, folderName: folder.name, candidates: partial });
        continue;
      }
    }

    unmatched.push(folder.path);
  }

  return { auto, confirm, unmatched };
}
