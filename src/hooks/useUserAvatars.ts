import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  ensureAvatars,
  getAvatarsVersion,
  peekAvatar,
  subscribeAvatars,
} from '../services/userAvatars';

/**
 * Fotos de perfil de um conjunto de pessoas, resolvidas por id.
 *
 * A presença (Supabase ou sala de co-edição) trafega só o id — a foto pode ser
 * um `data:` de megabytes e não cabe em mensagem de tempo real. Ver
 * `services/userAvatars.ts`.
 *
 * Devolve uma função `avatarOf(userId)`; enquanto a busca não volta, ela
 * responde `null` e a tela mostra as iniciais.
 */
export function useUserAvatars(userIds: Array<string | null | undefined>) {
  const key = userIds.filter(Boolean).sort().join('|');

  useEffect(() => {
    if (!key) return;
    ensureAvatars(key.split('|'));
  }, [key]);

  // Re-renderiza quando uma foto nova entra no cache global.
  const version = useSyncExternalStore(subscribeAvatars, getAvatarsVersion, getAvatarsVersion);

  return useCallback(
    (userId: string | null | undefined): string | null => peekAvatar(userId) ?? null,
    // `version` é justamente o gatilho: sem ele a função ficaria presa na
    // primeira leitura do cache.
    [version],
  );
}
