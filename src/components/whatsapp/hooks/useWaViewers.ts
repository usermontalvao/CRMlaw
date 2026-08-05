// Liga a presença da inbox ao React: anuncia onde este atendente está e entrega
// quem mais está em cada conversa. Ver `inboxPresence` para o porquê de um canal
// só, e `inboxPresenceState` para as regras de leitura.
import { useEffect, useMemo, useRef, useState } from 'react';
import { inboxPresence, type Viewer } from '../../../services/whatsapp/inboxPresence';

export interface WaViewersApi {
  /** Quem mais está na conversa ABERTA (nunca inclui você). */
  hereWithMe: Viewer[];
  /** Ids das conversas com outro atendente dentro — para marcar na lista. */
  busyConversationIds: ReadonlySet<string>;
}

export function useWaViewers(
  selectedId: string | null,
  me: { id: string; name: string } | null,
): WaViewersApi {
  const [byConversation, setByConversation] = useState<Map<string, Viewer[]>>(new Map());

  useEffect(() => inboxPresence.subscribe(setByConversation), []);

  // `me` costuma ser um objeto novo a cada render; sem esta estabilização, o
  // efeito abaixo republicaria a presença em todo render — e, pior, renovaria o
  // `since` a cada vez, fazendo "está aqui há 3 minutos" nunca passar de zero.
  const myId = me?.id ?? null;
  const myName = me?.name ?? '';
  useEffect(() => {
    if (!myId) return;
    inboxPresence.setViewing(selectedId, { id: myId, name: myName });
  }, [selectedId, myId, myName]);

  // Ao sair do módulo (ou fechar a aba) o Presence já derruba a sessão sozinho;
  // isto cobre o caso de desmontar sem fechar a aba — trocar de tela no CRM.
  const desmontou = useRef(false);
  useEffect(() => () => { desmontou.current = true; inboxPresence.teardown(); }, []);

  const hereWithMe = useMemo(
    () => (selectedId ? byConversation.get(selectedId) ?? [] : []),
    [byConversation, selectedId],
  );

  // Identidade estável: a lista de conversas está atrás de um React.memo e esta
  // prop passaria por lá a cada sync do Presence, mesmo sem nada ter mudado.
  const busyRef = useRef<Set<string>>(new Set());
  const busyConversationIds = useMemo(() => {
    const next = new Set(byConversation.keys());
    const prev = busyRef.current;
    if (next.size === prev.size && [...next].every(id => prev.has(id))) return prev;
    busyRef.current = next;
    return next;
  }, [byConversation]);

  return { hereWithMe, busyConversationIds };
}
