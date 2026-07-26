import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  startEditingPresence,
  subscribeNextcloudPresence,
  type EditingPresenceHandle,
  type NextcloudPresenceUser,
} from '../services/nextcloudPresence.service';

/**
 * useNextcloudPresence
 * -----------------------------------------------------------------------------
 * Presença de edição em tempo real ("quem está com o arquivo aberto agora").
 * Substituiu o antigo `useNextcloudLocks`, que dependia de heartbeat em tabela
 * e deixava o aviso pendurado depois de fechar o documento.
 */

export interface EditingPeer {
  userId: string;
  userName: string;
  /** Foto de perfil (a lista mostra a pessoa; as iniciais são só o plano B). */
  avatarUrl: string | null;
  /** Está com o teclado ativo neste instante — NÃO é prova de sincronização. */
  typing: boolean;
  /** Abriu o documento em (epoch ms). */
  since: number;
}

export type NextcloudPresenceMap = Record<string, EditingPeer[]>;

/** Junta as sessões por usuário: a mesma pessoa em duas abas aparece uma vez. */
function toMap(list: NextcloudPresenceUser[]): NextcloudPresenceMap {
  const map: NextcloudPresenceMap = {};
  for (const entry of list) {
    const peers = (map[entry.path] ||= []);
    const existing = peers.find((peer) => peer.userId === entry.userId);
    if (existing) {
      existing.typing = existing.typing || entry.typing;
      existing.avatarUrl = existing.avatarUrl || entry.avatarUrl;
      existing.since = Math.min(existing.since, entry.since);
      continue;
    }
    peers.push({
      userId: entry.userId,
      userName: entry.userName,
      avatarUrl: entry.avatarUrl,
      typing: entry.typing,
      since: entry.since,
    });
  }
  for (const peers of Object.values(map)) peers.sort((a, b) => a.since - b.since);
  return map;
}

/** Mapa `caminho -> pessoas com o arquivo aberto`, atualizado em tempo real. */
export function useNextcloudPresence() {
  const [byPath, setByPath] = useState<NextcloudPresenceMap>({});

  useEffect(() => subscribeNextcloudPresence((list) => { setByPath(toMap(list)); }), []);

  return { byPath };
}

/**
 * Anuncia que ESTE usuário está editando `path` e devolve quem mais está no
 * mesmo documento. Passe `enabled: false` (ou `path` nulo) para não anunciar.
 */
export function useEditingPresence(input: {
  path: string | null | undefined;
  userId: string | null | undefined;
  userName: string;
  userAvatarUrl?: string | null;
  enabled?: boolean;
}) {
  const { path, userId, userName, userAvatarUrl = null, enabled = true } = input;
  const [peers, setPeers] = useState<EditingPeer[]>([]);
  const handleRef = useRef<EditingPresenceHandle | null>(null);
  const active = Boolean(enabled && path && userId);

  useEffect(() => {
    if (!active || !path || !userId) {
      setPeers([]);
      return;
    }
    const handle = startEditingPresence({ path, userId, userName, avatarUrl: userAvatarUrl });
    handleRef.current = handle;
    const unsubscribe = subscribeNextcloudPresence((list) => {
      const map = toMap(list.filter((entry) => entry.path === path && entry.userId !== userId));
      setPeers(map[path] || []);
    });
    return () => {
      unsubscribe();
      handle.stop();
      handleRef.current = null;
    };
  }, [active, path, userId, userName, userAvatarUrl]);

  /** Chame a cada alteração de conteúdo: marca "digitando" para os outros. */
  const signalTyping = useCallback(() => {
    handleRef.current?.setTyping(true);
  }, []);

  const typingPeers = useMemo(() => peers.filter((peer) => peer.typing), [peers]);

  return { peers, typingPeers, signalTyping };
}
