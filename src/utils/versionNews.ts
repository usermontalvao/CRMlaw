/**
 * O AVISO DE VERSÃO — as regras, sem tela e sem navegador.
 *
 * Quando alguém recarrega o CRM e o pacote que chega é de uma versão que essa
 * pessoa ainda não viu, um painel entra pela direita contando o que mudou. As
 * decisões de "aparece ou não" e "o que entra na lista" moram aqui, longe do
 * React, porque são exatamente as que precisam de teste.
 *
 * Este arquivo NÃO IMPORTA NADA de propósito: o `npm test` roda com
 * `ts-node/esm` e qualquer import relativo sem extensão na cadeia derruba a
 * suíte inteira. Os formatos abaixo são cópias estruturais do que vem de
 * `data/releases.ts` — o TypeScript confere a compatibilidade no ponto de uso.
 */

export interface NewsChange {
  type: string;
  title: string;
  description?: string;
}

export interface NewsModule {
  moduleId: string;
  changes: NewsChange[];
}

export interface NewsRelease {
  version: string;
  date: string;
  summary?: string;
  modules: NewsModule[];
}

/**
 * Teto de versões mostradas de uma vez.
 *
 * Um push leva vários commits e cada commit é uma versão: quem passa duas
 * semanas fora pode voltar com trinta. O painel mostra as dez mais recentes e
 * manda o resto para o Changelog — a alternativa é uma lista que ninguém lê.
 */
export const MAX_VERSIONS_SHOWN = 10;

/**
 * O aviso só existe em produção.
 *
 * Em `localhost` o pacote muda a cada salvamento: sem esta trava, o painel
 * abriria em cima do trabalho a cada recarga. Preview de build e domínio de
 * teste entram na mesma regra — quem anuncia versão é o site de verdade.
 */
export function isProductionHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return host === 'jurius.com.br' || host === 'www.jurius.com.br';
}

function parseVersion(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compara duas versões `MAJOR.MINOR.PATCH`: negativo se `a` é mais antiga,
 * positivo se é mais nova, zero se são a mesma.
 *
 * Comparar como texto não serve — `'1.10.9'` é maior que `'1.10.338'` em ordem
 * alfabética, e o aviso mostraria as versões erradas justamente depois de uma
 * sequência longa de patches. Versão que não estiver no formato esperado é
 * tratada como a mais antiga possível, para nunca inventar novidade.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va && !vb) return 0;
  if (!va) return -1;
  if (!vb) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (va[i] !== vb[i]) return va[i] - vb[i];
  }
  return 0;
}

/**
 * As versões que esta pessoa ainda não viu, da mais nova para a mais antiga.
 *
 * `lastSeen` nulo é a PRIMEIRA VEZ: devolve lista vazia de propósito. Quem
 * nunca viu o aviso não pode receber trezentas versões na cara — quem chama
 * grava a versão atual e fica quieto.
 *
 * O corte de cima existe porque a lista de releases pode estar à frente do
 * pacote que está no ar (uma versão já escrita mas ainda não publicada): só
 * entra o que é ao mesmo tempo mais novo que o visto e não mais novo que o
 * pacote em execução.
 */
export function pickUnseenReleases(
  allReleases: readonly NewsRelease[],
  lastSeen: string | null,
  currentVersion: string,
  max: number = MAX_VERSIONS_SHOWN,
): NewsRelease[] {
  if (!lastSeen) return [];
  if (compareVersions(currentVersion, lastSeen) <= 0) return [];

  const unseen = allReleases.filter(
    (release) =>
      compareVersions(release.version, lastSeen) > 0 &&
      compareVersions(release.version, currentVersion) <= 0,
  );

  unseen.sort((a, b) => compareVersions(b.version, a.version));
  return unseen.slice(0, Math.max(0, max));
}

/**
 * Quantas versões ficaram de fora do teto — o número que o painel usa para
 * dizer "e mais N no Changelog" em vez de fingir que aquilo é tudo.
 */
export function countHiddenReleases(
  allReleases: readonly NewsRelease[],
  lastSeen: string | null,
  currentVersion: string,
  max: number = MAX_VERSIONS_SHOWN,
): number {
  if (!lastSeen) return 0;
  const total = allReleases.filter(
    (release) =>
      compareVersions(release.version, lastSeen) > 0 &&
      compareVersions(release.version, currentVersion) <= 0,
  ).length;
  return Math.max(0, total - Math.max(0, max));
}

export type NewsTypeKey = 'feature' | 'improvement' | 'fix' | 'security' | 'breaking';

/** A ordem em que os tipos aparecem dentro de cada versão. */
export const NEWS_TYPE_ORDER: NewsTypeKey[] = ['feature', 'improvement', 'fix', 'security', 'breaking'];

/**
 * As mudanças de uma versão achatadas e agrupadas por tipo, guardando de qual
 * módulo cada uma veio. O painel lê "Novo / Melhoria / Correção", não "módulo
 * WhatsApp, módulo Sistema" — para quem usa, o que importa é se aquilo é coisa
 * nova ou conserto.
 */
export function groupChangesByType(
  release: NewsRelease,
): Array<{ type: NewsTypeKey; changes: Array<NewsChange & { moduleId: string }> }> {
  const buckets = new Map<string, Array<NewsChange & { moduleId: string }>>();

  for (const mod of release.modules || []) {
    for (const change of mod.changes || []) {
      const list = buckets.get(change.type) || [];
      list.push({ ...change, moduleId: mod.moduleId });
      buckets.set(change.type, list);
    }
  }

  const ordered: Array<{ type: NewsTypeKey; changes: Array<NewsChange & { moduleId: string }> }> = [];
  for (const type of NEWS_TYPE_ORDER) {
    const changes = buckets.get(type);
    if (changes && changes.length > 0) ordered.push({ type, changes });
  }

  // Tipo desconhecido (escrito errado numa release antiga) não pode sumir do
  // aviso: entra no fim, com o rótulo genérico que a tela decide.
  for (const [type, changes] of buckets) {
    if (!NEWS_TYPE_ORDER.includes(type as NewsTypeKey) && changes.length > 0) {
      ordered.push({ type: type as NewsTypeKey, changes });
    }
  }

  return ordered;
}

/** Quantas mudanças de cada tipo em todas as versões do aviso, para o resumo. */
export function countChangesByType(releasesToShow: readonly NewsRelease[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const release of releasesToShow) {
    for (const mod of release.modules || []) {
      for (const change of mod.changes || []) {
        counts[change.type] = (counts[change.type] || 0) + 1;
      }
    }
  }
  return counts;
}

/**
 * O MODO DE ENSAIO: `?novidades=1` na URL abre o painel na hora.
 *
 * Sem isto, ver o painel exigia esperar o próximo deploy e ainda ter a marca de
 * "já vi" na versão anterior — ou seja, uma chance por versão, por pessoa. Com
 * o parâmetro, o painel abre com as últimas versões e NÃO grava marca nenhuma,
 * então dá para abrir quantas vezes for preciso.
 *
 * `?novidades=1.10.330` simula "a última versão que eu vi foi a 1.10.330", que
 * é como se confere o empilhamento de várias versões de uma vez.
 *
 * Continua valendo o resto: só quem já vê o aviso (hoje, o admin) consegue
 * abrir o ensaio — o parâmetro não é uma porta para quem não veria.
 */
export function parsePreviewRequest(search: string | null | undefined): { active: boolean; since: string | null } {
  if (!search) return { active: false, since: null };
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get('novidades');
  } catch {
    return { active: false, since: null };
  }
  if (value === null) return { active: false, since: null };
  const trimmed = value.trim();
  // Uma versão bem formada vira o "última vista"; qualquer outra coisa
  // (`1`, `sim`, vazio) apenas liga o ensaio com as versões mais recentes.
  return { active: true, since: /^\d+\.\d+\.\d+$/.test(trimmed) ? trimmed : null };
}

/** Quantas versões o ensaio mostra quando não se diz desde quando. */
export const PREVIEW_VERSIONS = 3;

/** A chave do "já vi" — uma por usuário, porque o aviso é de cada pessoa. */
export function seenStorageKey(userId: string | null | undefined): string {
  return `jurius:version-news:seen:${userId || 'anon'}`;
}
