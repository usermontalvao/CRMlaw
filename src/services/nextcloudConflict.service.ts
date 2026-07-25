import { nextcloudService } from './nextcloud.service';
import { joinPath, nextAvailableName } from '../utils/nextcloudNames';

export { joinPath, nextAvailableName, splitNameExt } from '../utils/nextcloudNames';

/**
 * nextcloudConflict.service
 * -----------------------------------------------------------------------------
 * Resolvedor ÚNICO de conflitos de nome no Nextcloud. Regra central:
 * a existência do destino é sempre verificada contra o SERVIDOR real (stat),
 * nunca apenas contra a lista exibida na tela — que pode estar desatualizada.
 *
 * Usado por upload, arrastar, copiar, mover, conversões, divisão, extração,
 * mesclagem e salvamento de PDF para garantir "manter ambos" sem sobrescrever.
 */

/**
 * Verifica no SERVIDOR se `dir/name` já existe.
 * Retorna `true` quando o destino está ocupado.
 */
export async function destinationExists(dir: string, name: string): Promise<boolean> {
  const { exists } = await nextcloudService.stat(joinPath(dir, name));
  return exists;
}

/**
 * Resolve um nome livre no diretório `dir` consultando o servidor a cada
 * tentativa. Começa em `desiredName` e aplica a convenção "(cópia N)".
 * `reserved` são nomes já escolhidos NESTA operação (ainda não existem no
 * servidor, mas não podem colidir entre si).
 *
 * `maxProbes` limita as idas ao servidor (proteção contra loop em diretórios
 * enormes) — se estourar, lança em vez de arriscar sobrescrever.
 */
export async function resolveFreeName(
  dir: string,
  desiredName: string,
  reserved: ReadonlySet<string> = new Set(),
  maxProbes = 100,
): Promise<string> {
  // `blocked` cresce a cada colisão: nomes reservados nesta operação + os que
  // o servidor já reportou como existentes. nextAvailableName sempre devolve um
  // nome fora desse conjunto, então o loop progride de forma garantida.
  const blocked = new Set(reserved);
  for (let probe = 0; probe < maxProbes; probe += 1) {
    const candidate = nextAvailableName(desiredName, blocked);
    const exists = await destinationExists(dir, candidate);
    if (!exists) return candidate;
    blocked.add(candidate);
  }
  throw new Error(
    `Não foi possível encontrar um nome livre para "${desiredName}" em "${dir || '/'}" após ${maxProbes} tentativas.`,
  );
}
