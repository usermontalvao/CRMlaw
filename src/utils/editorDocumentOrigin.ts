/**
 * utils/editorDocumentOrigin
 * -----------------------------------------------------------------------------
 * Regras PURAS da "origem ativa" de um documento aberto no editor de petições.
 *
 * O editor pode ter chegado ao documento por caminhos muito diferentes (petição
 * do Jurius, arquivo do Nextcloud, template externo, DOCX do computador). Antes
 * dessa camada, cada fluxo mantinha o seu próprio ref — e responder "onde o
 * Ctrl+S grava?" dependia de ler três refs na ordem certa.
 *
 * Aqui fica a ÚNICA fonte de verdade dessa decisão, sem React, sem serviço e sem
 * DOM, para poder ser testada sob Node (`node --test`).
 */
import type { EditorDocSource } from './editorDocSource';

/** De onde o documento aberto veio — e, por consequência, para onde ele salva. */
export type ActiveDocumentOrigin =
  /** Documento novo/importado do computador: ainda sem destino persistente. */
  | { kind: 'new' }
  /** Petição gravada no Jurius (Supabase). */
  | { kind: 'petition'; petitionId: string }
  /** Arquivo do Nextcloud aberto por caminho (o ETag guarda a versão lida). */
  | { kind: 'nextcloud'; path: string; fileName: string; etag?: string | null }
  /** Origem externa: template principal/anexo, petição padrão, … */
  | { kind: 'external'; source: EditorDocSource; fileName: string };

export const DOCX_EXTENSION = '.docx';

/** Extensões que o editor consegue abrir hoje. */
export const SUPPORTED_EDITOR_EXTENSIONS = ['.docx'] as const;

/** Caracteres proibidos em nome de arquivo (Windows/WebDAV) + barras. */
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Limpa um nome de arquivo: remove barras e caracteres reservados, colapsa
 * espaços e corta pontos/espaços das pontas (o WebDAV rejeita "nome." e o
 * Windows não abre esses arquivos).
 */
export function sanitizeFileNameSegment(raw: string): string {
  return String(raw ?? '')
    .replace(INVALID_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
}

/** `true` quando o nome termina em `.docx` (ignorando maiúsculas). */
export function hasDocxExtension(name: string): boolean {
  return String(name ?? '').toLowerCase().endsWith(DOCX_EXTENSION);
}

/**
 * Normaliza o que o usuário digitou em um nome `.docx` válido:
 * remove caminho, caracteres inválidos e acrescenta a extensão quando falta.
 * Nunca devolve string vazia — cai em `fallback`.
 */
export function normalizeDocxFileName(raw: string, fallback = 'documento'): string {
  // Tira a extensão ANTES de sanitizar: assim ".docx" (nome vazio) não vira o
  // arquivo "docx.docx", e "Contrato.DOCX" não ganha uma segunda extensão.
  const stemOf = (value: string) => {
    const input = String(value ?? '').trim();
    return sanitizeFileNameSegment(hasDocxExtension(input) ? input.slice(0, -DOCX_EXTENSION.length) : input);
  };
  const stem = stemOf(raw) || stemOf(fallback) || 'documento';
  return `${stem}${DOCX_EXTENSION}`;
}

/**
 * Normaliza um caminho de PASTA relativo à raiz do Nextcloud. Remove barras
 * duplicadas, `.` e qualquer `..` (impede escapar da raiz por travessia).
 */
export function normalizeNextcloudDirPath(raw: string): string {
  return String(raw ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

/**
 * Monta o caminho completo de um arquivo no Nextcloud. Lança quando o nome não
 * sobrevive à sanitização (ex.: só barras) — melhor falhar do que gravar em um
 * caminho inesperado.
 */
export function buildNextcloudFilePath(dir: string, fileName: string): string {
  const safeName = sanitizeFileNameSegment(fileName);
  if (!safeName) throw new Error('Informe um nome de arquivo válido.');
  const safeDir = normalizeNextcloudDirPath(dir);
  return safeDir ? `${safeDir}/${safeName}` : safeName;
}

/** Diretório-pai de um caminho ("a/b/c.docx" -> "a/b"; "a.docx" -> raiz). */
export function parentPathOf(path: string): string {
  const normalized = String(path ?? '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

/** Último segmento de um caminho ("a/b/c.docx" -> "c.docx"). */
export function fileNameOf(path: string): string {
  const parts = String(path ?? '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** Segmentos cumulativos para o breadcrumb ("a/b" -> [a, a/b]). */
export function crumbsOf(path: string): Array<{ label: string; path: string }> {
  const parts = normalizeNextcloudDirPath(path).split('/').filter(Boolean);
  const acc: Array<{ label: string; path: string }> = [];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    acc.push({ label: part, path: current });
  }
  return acc;
}

/**
 * Arquivos que o editor abre. Ignora os temporários do Word (`~$…`), que são
 * `.docx` no nome mas não são documentos.
 */
export function isSupportedEditorFileName(name: string): boolean {
  const clean = String(name ?? '').trim();
  if (!clean || clean.startsWith('~$')) return false;
  const lower = clean.toLowerCase();
  return SUPPORTED_EDITOR_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Ordenação estilo explorador: pastas primeiro, depois nomes em pt-BR. */
export function compareExplorerEntries(
  a: { name: string; isDir: boolean },
  b: { name: string; isDir: boolean },
): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

// --- Decisão de destino do "Salvar" / Ctrl+S ---------------------------------

/** O que o "Salvar" deve fazer, dada a origem ativa. */
export type SaveTargetDecision =
  | { action: 'nextcloud'; path: string; fileName: string; etag: string | null }
  | { action: 'petition'; petitionId: string | null }
  | { action: 'external'; source: EditorDocSource; fileName: string }
  /** Sem destino persistente: perguntar onde salvar. */
  | { action: 'ask' };

/**
 * Regra central: onde o Ctrl+S grava.
 *
 * `hasPersistedPetition` cobre o caso do documento aberto como petição do Jurius
 * antes desta camada existir (currentPetitionId preenchido com origem 'new').
 */
export function decideSaveTarget(
  origin: ActiveDocumentOrigin,
  context: { hasPersistedPetition?: boolean } = {},
): SaveTargetDecision {
  switch (origin.kind) {
    case 'nextcloud':
      return {
        action: 'nextcloud',
        path: origin.path,
        fileName: origin.fileName,
        etag: origin.etag ?? null,
      };
    case 'external':
      return { action: 'external', source: origin.source, fileName: origin.fileName };
    case 'petition':
      return { action: 'petition', petitionId: origin.petitionId };
    case 'new':
    default:
      return context.hasPersistedPetition ? { action: 'petition', petitionId: null } : { action: 'ask' };
  }
}

/** `true` quando salvar exige antes escolher um destino (diálogo). */
export function saveNeedsDestination(
  origin: ActiveDocumentOrigin,
  context: { hasPersistedPetition?: boolean } = {},
): boolean {
  return decideSaveTarget(origin, context).action === 'ask';
}

/** "Salvar como": a origem ativa PASSA a ser o novo caminho no Nextcloud. */
export function originAfterSaveAs(
  path: string,
  etag: string | null = null,
): ActiveDocumentOrigin {
  return { kind: 'nextcloud', path, fileName: fileNameOf(path), etag };
}

/** "Salvar uma cópia": a origem ativa NÃO muda. */
export function originAfterSaveCopy(current: ActiveDocumentOrigin): ActiveDocumentOrigin {
  return current;
}

/** "Baixar uma cópia": download nunca vira origem persistente. */
export function originAfterDownloadCopy(current: ActiveDocumentOrigin): ActiveDocumentOrigin {
  return current;
}

/** Caminho ativo no Nextcloud (lock, heartbeat, rascunho local) — ou null. */
export function activeNextcloudPath(origin: ActiveDocumentOrigin): string | null {
  return origin.kind === 'nextcloud' ? origin.path : null;
}

/** ETag da versão lida do servidor (If-Match do próximo PUT) — ou null. */
export function activeNextcloudEtag(origin: ActiveDocumentOrigin): string | null {
  return origin.kind === 'nextcloud' ? (origin.etag ?? null) : null;
}

/**
 * Detecta sobrescrita: o destino já existe no diretório listado?
 * A confirmação final continua sendo feita contra o servidor (stat), mas isso
 * evita pedir uma ida à rede quando a listagem já mostra o arquivo.
 */
export function detectOverwrite(existingNames: Iterable<string>, fileName: string): boolean {
  const target = String(fileName ?? '').toLocaleLowerCase('pt-BR');
  if (!target) return false;
  for (const name of existingNames) {
    if (String(name ?? '').toLocaleLowerCase('pt-BR') === target) return true;
  }
  return false;
}

// --- Rótulos de origem para a interface --------------------------------------

export interface OriginBadge {
  /** Rótulo curto exibido no cabeçalho. */
  label: string;
  /** Detalhe (pasta/arquivo) para tooltip ou subtítulo. */
  detail: string | null;
  /** Ícone semântico escolhido pelo componente. */
  icon: 'cloud' | 'jurius' | 'local' | 'external';
}

/** Texto discreto de "de onde veio este documento". */
export function describeOrigin(origin: ActiveDocumentOrigin): OriginBadge {
  switch (origin.kind) {
    case 'nextcloud': {
      const folder = parentPathOf(origin.path);
      return {
        label: 'Nextcloud',
        detail: folder ? `${folder}/${origin.fileName}` : origin.fileName,
        icon: 'cloud',
      };
    }
    case 'petition':
      return { label: 'Jurius', detail: 'Petição salva no Jurius', icon: 'jurius' };
    case 'external':
      return { label: 'Origem externa', detail: origin.fileName, icon: 'external' };
    case 'new':
    default:
      return { label: 'Não salvo', detail: 'Arquivo local ainda sem destino', icon: 'local' };
  }
}

/** Mensagem de sucesso coerente com o destino gravado. */
export function savedLabelFor(decision: SaveTargetDecision): string {
  switch (decision.action) {
    case 'nextcloud':
      return 'Salvo no Nextcloud';
    case 'petition':
      return 'Documento salvo com sucesso';
    case 'external':
      return 'Documento salvo na origem';
    default:
      return 'Documento salvo';
  }
}
