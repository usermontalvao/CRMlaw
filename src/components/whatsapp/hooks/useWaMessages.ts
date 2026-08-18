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

/**
 * Quantas threads ficam guardadas em memória para a volta ser instantânea.
 *
 * Dez porque é a ordem de grandeza do vaivém real de um turno — responder três
 * ou quatro pessoas alternando entre elas, voltar na de antes para conferir uma
 * data. Guardar tudo seria um vazamento lento em quem deixa a inbox aberta o dia
 * inteiro; guardar duas ou três não cobriria o vaivém e a espera voltaria.
 */
const MAX_THREADS_EM_CACHE = 10;

interface JanelaGuardada {
  /** Assinatura do grupo de linhas que gerou esta janela (ver `scopeKeyFor`). */
  scopeKey: string;
  msgs: WhatsAppMessage[];
  /** A âncora da paginação, para "carregar mais" continuar de onde parou. */
  oldestTs: string | null;
  hasMore: boolean;
}

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
  /**
   * A assinatura do grupo de linhas que alimenta a thread. É o que impede o
   * cache de servir uma janela velha depois que o contato ganhou (ou perdeu)
   * uma conversa irmã em outro número do escritório: mudou o grupo, mudou a
   * chave, e a janela guardada deixa de valer sozinha.
   */
  const scopeKeyFor = (convId: string): string => [...scopeFor(convId)].sort().join('|');

  /**
   * As últimas threads lidas, para voltar a uma conversa não custar uma ida ao
   * servidor. É a diferença entre alternar entre dois clientes como se fossem
   * duas abas e alternar assistindo a um spinner a cada clique.
   *
   * NÃO ENFRAQUECE A GUARDA DA TROCA. O que a limpeza da thread evitava era
   * mostrar as mensagens de um cliente sob o nome de outro; aqui o que se
   * mostra é a janela DAQUELA conversa, buscada com a chave dela. O conteúdo
   * está certo desde o primeiro quadro — o que ele pode estar é atrasado em
   * alguns segundos, e o `refreshMessages` disparado logo atrás costura por
   * cima em silêncio, sem piscar e sem perder a rolagem.
   *
   * A janela paginada vem junto: quem rolou para cima procurando um documento,
   * saiu para responder outra pessoa e voltou reencontra o histórico onde
   * estava, em vez de ter que rolar tudo de novo.
   */
  const cacheRef = useRef<Map<string, JanelaGuardada>>(new Map());
  // O que está NA TELA neste render. Espelhados durante o render, como
  // `activeConvRef` e `threadIdsRef` acima, porque quem os lê é a limpeza da
  // troca de conversa — e ela precisa do que ficou na tela da conversa que está
  // saindo, não do que já foi pedido para a que está entrando.
  const messagesRef = useRef<WhatsAppMessage[]>([]);
  messagesRef.current = messages;
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMoreMsgs;

  const guardar = (convId: string, janela: JanelaGuardada) => {
    const cache = cacheRef.current;
    // Regravar move a conversa para o fim do Map: a ordem de inserção é a
    // ordem de uso, e é por ela que a mais esquecida sai quando o teto chega.
    cache.delete(convId);
    cache.set(convId, janela);
    while (cache.size > MAX_THREADS_EM_CACHE) {
      const maisAntiga = cache.keys().next().value;
      if (maisAntiga === undefined) break;
      cache.delete(maisAntiga);
    }
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

  // Troca de conversa. O markRead + atualização do contador de não-lidas
  // continua no módulo (domínio de conversa).
  //
  // A JANELA É GUARDADA NA SAÍDA, e o lugar importa mais do que parece. A
  // tentação é gravar o cache a cada vez que `messages` muda, mas o render em
  // que a conversa troca tem `selectedId` já apontando para a NOVA e `messages`
  // ainda com as da ANTERIOR — gravar ali arquivaria a thread de um cliente sob
  // a chave de outro, e a volta seguinte a mostraria com a maior convicção. É
  // exatamente o vazamento que a limpeza da thread sempre existiu para evitar.
  // Na limpeza do efeito não há ambiguidade: `conv` é a conversa que está
  // saindo, e o espelho tem o que estava na tela dela.
  useEffect(() => {
    const conv = selectedId;
    // Capturado na ENTRADA, quando `threadIdsRef` ainda descreve esta conversa.
    const scopeKey = conv ? scopeKeyFor(conv) : '';

    // A saída é a mesma pelos dois caminhos (janela guardada ou busca nova):
    // o que fica na tela desta conversa é o que se leva para o cache dela.
    const aoSair = () => {
      // A thread vazia nunca é guardada: ela é o estado de quem saiu antes de a
      // conversa chegar, e gravá-la ensinaria o cache que aquela pessoa não tem
      // mensagem nenhuma — um vazio instantâneo e convincente na próxima volta.
      if (!conv || messagesRef.current.length === 0) return;
      guardar(conv, {
        scopeKey,
        msgs: messagesRef.current,
        oldestTs: oldestTsRef.current,
        hasMore: hasMoreRef.current,
      });
    };

    setLoadingMore(false);
    if (!selectedId) {
      setLoadingMsgs(false);
      setHasMoreMsgs(false); oldestTsRef.current = null; setMessages([]);
      return aoSair;
    }

    // Se esta conversa já foi lida neste turno, ela volta pronta: a janela
    // guardada entra na tela no mesmo quadro do clique e o servidor é
    // consultado atrás dela, sem spinner. É o caminho comum do vaivém entre
    // dois ou três clientes, e é onde o módulo deixa de parecer lento.
    const guardada = cacheRef.current.get(selectedId);
    if (guardada && guardada.scopeKey === scopeKey && guardada.msgs.length > 0) {
      // Apaga um spinner que pode ter ficado aceso: se a conversa anterior ainda
      // estava carregando quando se trocou, o `finally` dela não desliga a luz
      // (a guarda de resposta atrasada o impede, e com razão). Antes isso se
      // resolvia sozinho porque toda troca chamava `loadMessages`; por este
      // caminho não há busca com spinner, então a luz precisa ser apagada aqui —
      // senão a thread guardada aparece sob um carregamento que não existe.
      setLoadingMsgs(false);
      setMessages(guardada.msgs);
      setHasMoreMsgs(guardada.hasMore);
      oldestTsRef.current = guardada.oldestTs;
      refreshMessages(selectedId);
      return aoSair;
    }

    // Primeira visita: limpa ANTES de buscar. Sem isso, as mensagens da conversa
    // anterior continuavam na tela sob o nome do novo contato até a resposta
    // chegar — um piscar de conteúdo errado (e, num escritório, a conversa de um
    // cliente aparecendo brevemente na aba de outro). Aqui o spinner é honesto:
    // não há o que mostrar daquela pessoa ainda.
    setHasMoreMsgs(false); oldestTsRef.current = null;
    setMessages([]);
    loadMessages(selectedId);
    return aoSair;
  }, [selectedId, loadMessages, refreshMessages]);

  return {
    messages, setMessages,
    loadingMsgs, hasMoreMsgs, setHasMoreMsgs, loadingMore,
    oldestTsRef,
    loadMessages, loadMoreMsgs, refreshMessages,
  };
}
