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
export function useWaMessages(selectedId: string | null, threadIds?: readonly string[]): WaMessagesApi {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const oldestTsRef = useRef<string | null>(null);

  // Qual conversa está aberta AGORA. Toda busca daqui é assíncrona, e a resposta
  // não tem obrigação de chegar antes da próxima troca de conversa: quem clica em
  // dois contatos em sequência (ou responde um e já pula para o seguinte) pode ter
  // a resposta da conversa anterior chegando depois. Sem esta guarda, esse
  // `setMessages` atrasado escrevia a thread de um cliente sob o nome de outro —
  // exatamente o vazamento que a limpeza da thread na troca tenta evitar. Como
  // ref e não estado: precisa valer já no mesmo render em que a seleção muda.
  const activeConvRef = useRef<string | null>(selectedId);
  activeConvRef.current = selectedId;
  /** A resposta que acabou de chegar ainda é da conversa que está na tela? */
  const stale = (convId: string) => activeConvRef.current !== convId;

  // Quais linhas alimentam a thread. Quando o mesmo contato tem conversa em mais
  // de um canal do escritório, a janela é a união delas — é uma pessoa só, e o
  // histórico dela não se parte porque a mensagem entrou por outro número nosso.
  // Guardado em ref (e não em dep de callback) porque a lista chega recalculada a
  // cada render da inbox; o que importa para invalidar é a conversa aberta.
  const threadIdsRef = useRef<readonly string[]>([]);
  threadIdsRef.current = threadIds && threadIds.length > 0 ? threadIds : (selectedId ? [selectedId] : []);
  /** Alvo de busca para a conversa pedida: ela sozinha, ou o grupo de irmãs. */
  const scopeFor = (convId: string): string[] => {
    const ids = threadIdsRef.current;
    return ids.includes(convId) ? [...ids] : [convId];
  };

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMsgs(true);
    try {
      const msgs = await whatsappService.listMessages(scopeFor(convId), { limit: MSG_PAGE });
      if (stale(convId)) return;
      setMessages(msgs);
      setHasMoreMsgs(msgs.length === MSG_PAGE);
      oldestTsRef.current = msgs[0]?.wa_timestamp ?? null;
    } catch {/* */} finally {
      // O spinner pertence à conversa aberta: uma resposta atrasada não pode
      // apagar o carregamento da conversa que entrou no lugar dela.
      if (!stale(convId)) setLoadingMsgs(false);
    }
  }, []);

  const loadMoreMsgs = useCallback(async () => {
    const convId = selectedId;
    if (!convId || !oldestTsRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await whatsappService.listMessages(scopeFor(convId), { limit: MSG_PAGE, before: oldestTsRef.current });
      if (stale(convId)) return;
      if (older.length === 0) { setHasMoreMsgs(false); return; }
      oldestTsRef.current = older[0]?.wa_timestamp ?? oldestTsRef.current;
      setMessages(prev => [...older, ...prev]);
      setHasMoreMsgs(older.length === MSG_PAGE);
    } catch {/* */} finally { if (!stale(convId)) setLoadingMore(false); }
  }, [selectedId, loadingMore]);

  // Atualização silenciosa da thread (sem spinner) para eventos em tempo real:
  // mantém a conversa fluida, sem piscar nem perder a posição de rolagem.
  // Faz MERGE: recarrega só a página mais recente e a costura por cima do que já
  // está em memória, preservando o histórico antigo que o usuário paginou (rolou
  // para cima). Sem isso, cada mensagem recebida descartava as mensagens antigas
  // já carregadas e embaralhava o scroll de quem está lendo o histórico.
  const refreshMessages = useCallback(async (convId: string) => {
    try {
      const latest = await whatsappService.listMessages(scopeFor(convId), { limit: MSG_PAGE });
      // Mesma guarda do carregamento inicial, e aqui ela pega um caso a mais: o
      // envio dispara `refreshMessages` da conversa em que se escreveu, e trocar
      // de conversa logo após enviar é rotina. A resposta que chegava depois
      // costurava as mensagens de quem acabou de receber por cima da thread já
      // aberta de outra pessoa.
      if (stale(convId)) return;
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
    // Limpa a thread ANTES de buscar: sem isso, as mensagens da conversa
    // anterior continuavam na tela sob o nome do novo contato até a resposta
    // chegar — um piscar de conteúdo errado (e, num escritório, a conversa de um
    // cliente aparecendo brevemente na aba de outro). Prefere-se o spinner.
    setMessages([]);
    loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  return {
    messages, setMessages,
    loadingMsgs, hasMoreMsgs, setHasMoreMsgs, loadingMore,
    oldestTsRef,
    loadMessages, loadMoreMsgs, refreshMessages,
  };
}
