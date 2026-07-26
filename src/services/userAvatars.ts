import { supabase } from '../config/supabase';

/**
 * userAvatars
 * -----------------------------------------------------------------------------
 * Foto de perfil por id de usuário, resolvida LOCALMENTE.
 *
 * Por que não mandar a foto junto com a presença (que seria o caminho óbvio):
 * neste CRM `profiles.avatar_url` pode ser um `data:image/jpeg;base64,…`
 * embutido de MEGABYTES. Enfiar isso na mensagem de entrada da sala estoura o
 * limite de mensagem do SignalR — e o servidor não rejeita a mensagem, ele
 * DERRUBA a conexão. O mesmo vale para o Presence do Supabase, que recusa
 * payloads grandes em silêncio. Resultado nos dois casos: nenhuma foto e, pior,
 * a co-edição morrendo na entrada.
 *
 * Aqui trafega só o `userId` (36 caracteres) e cada navegador busca as fotos de
 * quem está na sala, uma vez por sessão.
 */

/** Foto já resolvida (`null` = a pessoa não tem foto). */
const cache = new Map<string, string | null>();

/** Buscas em andamento, para dois componentes não pedirem o mesmo id. */
const inFlight = new Map<string, Promise<string | null>>();

const listeners = new Set<() => void>();

/**
 * Muda a cada alteração do cache. O React usa este número para saber que
 * chegou foto nova (`useSyncExternalStore`) — o valor em si não significa nada.
 */
let version = 0;

export const getAvatarsVersion = (): number => version;

function notify(): void {
  version += 1;
  for (const listener of listeners) {
    try { listener(); } catch { /* um assinante quebrado não derruba os outros */ }
  }
}

/** Avisa quando o cache muda (novas fotos chegaram). */
export function subscribeAvatars(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Foto já conhecida, sem esperar rede. `undefined` = ainda não buscada. */
export function peekAvatar(userId: string | null | undefined): string | null | undefined {
  if (!userId) return null;
  return cache.get(userId);
}

/** Deixa uma foto conhecida sem ida ao banco (a do próprio usuário, por exemplo). */
export function primeAvatar(userId: string | null | undefined, avatarUrl: string | null): void {
  if (!userId) return;
  const current = cache.get(userId);
  if (current === avatarUrl) return;
  cache.set(userId, avatarUrl);
  notify();
}

async function fetchOne(userId: string): Promise<string | null> {
  // Só a coluna da foto: `select('*')` em profiles arrasta o avatar embutido de
  // todas as colunas junto, e são megabytes por linha.
  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.avatar_url as string | null) || null;
}

/**
 * Garante que as fotos destes usuários estejam no cache. Ids já conhecidos (ou
 * já em busca) não geram nova ida ao banco.
 */
export function ensureAvatars(userIds: Array<string | null | undefined>): void {
  const pending = Array.from(new Set(
    userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      .filter((id) => !cache.has(id) && !inFlight.has(id)),
  ));
  if (pending.length === 0) return;

  for (const userId of pending) {
    const request = fetchOne(userId)
      .then((avatarUrl) => {
        cache.set(userId, avatarUrl);
        return avatarUrl;
      })
      .catch(() => {
        // Sem foto a tela cai nas iniciais. Guardar o `null` evita ficar
        // repetindo uma consulta que já falhou a cada re-render.
        cache.set(userId, null);
        return null;
      })
      .finally(() => {
        inFlight.delete(userId);
        notify();
      });

    inFlight.set(userId, request);
  }
}

/** Esquece tudo — usado só nos testes. */
export function resetAvatarCache(): void {
  cache.clear();
  inFlight.clear();
}
