// Domínio de dados da thread do WhatsApp: a janela de mensagens da conversa
// aberta, com carregamento inicial, paginação ("carregar mais") e refresh
// silencioso em tempo real. Extraído do WhatsAppModule para isolar o acesso ao
// serviço e a reconciliação da janela de mensagens da camada visual da thread.
// É a fonte de `refreshMessages`, consumida por useWaRealtime/useWaComposer — por
// isso vive ANTES deles na ordem de hooks do módulo.
import { useCallback, useEffect, useRef, useState } from 'react';
import { whatsappService } from '../../../services/whatsapp.service';
import type { WhatsAppMessage } from '../../../types/whatsapp.types';

const MSG_PAGE = 60; // mensagens por bloco de paginação

export interface WaMessagesApi {
  messages: WhatsAppMessage[];
  setMessages: React.Dispatch<React.SetStateAction<WhatsAppMessage[]>>;
  loadingMsgs: boolean;
  hasMoreMsgs: boolean;
  setHasMoreMsgs: React.Dispatch<React.SetStateAction<boolean>>;
  loadingMore: boolean;
  oldestTsRef: React.MutableRefObject<string | null>;
  loadMessages: (convId: string) => Promise<void>;
  loadMoreMsgs: () => Promise<void>;
  refreshMessages: (convId: string) => Promise<void>;
}

/**
 * Gerencia a lista de mensagens da conversa selecionada: carrega a página mais
 * recente ao abrir/trocar, pagina histórico mais antigo sob demanda e atualiza a
 * thread em silêncio (merge) para eventos de tempo real. Não dispara markRead nem
 * mexe na lista de conversas — isso fica no módulo (domínio de conversa).
 */
export function useWaMessages(selectedId: string | null): WaMessagesApi {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const oldestTsRef = useRef<string | null>(null);

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMsgs(true);
    try {
      const msgs = await whatsappService.listMessages(convId, { limit: MSG_PAGE });
      setMessages(msgs);
      setHasMoreMsgs(msgs.length === MSG_PAGE);
      oldestTsRef.current = msgs[0]?.wa_timestamp ?? null;
    } catch {/* */} finally { setLoadingMsgs(false); }
  }, []);

  const loadMoreMsgs = useCallback(async () => {
    if (!selectedId || !oldestTsRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await whatsappService.listMessages(selectedId, { limit: MSG_PAGE, before: oldestTsRef.current });
      if (older.length === 0) { setHasMoreMsgs(false); return; }
      oldestTsRef.current = older[0]?.wa_timestamp ?? oldestTsRef.current;
      setMessages(prev => [...older, ...prev]);
      setHasMoreMsgs(older.length === MSG_PAGE);
    } catch {/* */} finally { setLoadingMore(false); }
  }, [selectedId, loadingMore]);

  // Atualização silenciosa da thread (sem spinner) para eventos em tempo real:
  // mantém a conversa fluida, sem piscar nem perder a posição de rolagem.
  // Faz MERGE: recarrega só a página mais recente e a costura por cima do que já
  // está em memória, preservando o histórico antigo que o usuário paginou (rolou
  // para cima). Sem isso, cada mensagem recebida descartava as mensagens antigas
  // já carregadas e embaralhava o scroll de quem está lendo o histórico.
  const refreshMessages = useCallback(async (convId: string) => {
    try {
      const latest = await whatsappService.listMessages(convId, { limit: MSG_PAGE });
      setMessages(prev => {
        if (prev.length === 0 || latest.length === 0) return latest;
        // `latest` é o bloco contíguo mais novo (asc). Tudo estritamente anterior
        // ao seu início vem do que já estava paginado; a janela recente é
        // substituída por `latest` (reflete edições/exclusões/novos status).
        const cutoff = latest[0].wa_timestamp;
        const older = prev.filter(m => m.wa_timestamp < cutoff);
        return [...older, ...latest];
      });
    } catch {/* */}
  }, []);

  // Reset de paginação/mensagens ao trocar de conversa. O markRead + atualização
  // do contador de não-lidas continua no módulo (domínio de conversa).
  useEffect(() => {
    setHasMoreMsgs(false); setLoadingMore(false); oldestTsRef.current = null;
    if (!selectedId) { setMessages([]); return; }
    loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  return {
    messages, setMessages,
    loadingMsgs, hasMoreMsgs, setHasMoreMsgs, loadingMore,
    oldestTsRef,
    loadMessages, loadMoreMsgs, refreshMessages,
  };
}
