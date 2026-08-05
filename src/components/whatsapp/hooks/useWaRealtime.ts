// Subscriptions de tempo real do módulo WhatsApp: mudanças de conversa/mensagem
// (lista + thread aberta) e a sessão de IA da conversa selecionada. Extraído do
// WhatsAppModule para isolar os listeners do Supabase do orquestrador.
//
// Além de assinar, este hook cuida da RESSINCRONIZAÇÃO. Eventos de realtime não
// são reenviados: tudo que acontece enquanto o socket está fora (rede oscilando,
// notebook suspenso, aba em segundo plano com timers estrangulados) se perde
// para sempre. Sem repor esse buraco por HTTP, a inbox fica parada até alguém
// forçar um fetch — que era exatamente o "sair da conversa e entrar de novo".
import { useCallback, useEffect, useRef, useState } from 'react';
import { whatsappService } from '../../../services/whatsapp.service';
import type {
  WhatsAppConversation, WhatsAppMessage, WhatsAppAiSession,
} from '../../../types/whatsapp.types';

/** De quanto em quanto tempo repomos os dados enquanto o canal está fora. */
const DOWN_POLL_MS = 15_000;

interface WaRealtimeArgs {
  selectedId: string | null;
  loadConversations: () => void;
  refreshMessages: (convId: string) => void;
  setConversations: React.Dispatch<React.SetStateAction<WhatsAppConversation[]>>;
  setMessages: React.Dispatch<React.SetStateAction<WhatsAppMessage[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface WaRealtimeApi {
  aiSession: WhatsAppAiSession | null;
  setAiSession: React.Dispatch<React.SetStateAction<WhatsAppAiSession | null>>;
  /** 'live' = recebendo eventos; 'down' = canal caído, repondo por HTTP. */
  realtimeStatus: 'live' | 'down';
}

/**
 * Assina os eventos realtime de conversa/mensagem, mantém a sessão de IA da
 * conversa aberta sincronizada e repõe o que o canal perdeu. Não dispara fetches
 * de bootstrap (canais, setores, staff) — esses ficam no módulo.
 */
export function useWaRealtime({
  selectedId, loadConversations, refreshMessages,
  setConversations, setMessages,
}: WaRealtimeArgs): WaRealtimeApi {
  // Fase J: sessão de IA da conversa selecionada.
  const [aiSession, setAiSession] = useState<WhatsAppAiSession | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'live' | 'down'>('live');

  // Refs para os callbacks e a seleção: mantêm o efeito de inscrição com
  // dependências vazias, para o canal não ser derrubado e refeito a cada render.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const loadConversationsRef = useRef(loadConversations);
  loadConversationsRef.current = loadConversations;
  const refreshMessagesRef = useRef(refreshMessages);
  refreshMessagesRef.current = refreshMessages;

  /**
   * Repõe a lista e a thread aberta por HTTP (independe do socket). Com guarda
   * de 3s porque `focus` e `visibilitychange` disparam juntos ao voltar para a
   * aba — sem ela, cada retorno faria duas rodadas de requisições.
   */
  const lastResyncRef = useRef(0);
  const resync = useCallback(() => {
    const now = Date.now();
    if (now - lastResyncRef.current < 3000) return;
    lastResyncRef.current = now;
    loadConversationsRef.current();
    const open = selectedIdRef.current;
    if (open) refreshMessagesRef.current(open);
  }, []);

  useEffect(() => {
    // `wasDown` evita ressincronizar na primeira conexão: ali o bootstrap do
    // módulo já carregou tudo, e repetir só duplicaria requisições na abertura.
    let wasDown = false;
    const unsub = whatsappService.subscribe({
      // Mescla a conversa que mudou no lugar (presença, preview, contador,
      // ordem) — sem recarregar a lista nem tocar na thread aberta.
      onConversationChange: (payload) => {
        const row = payload.new as Partial<WhatsAppConversation> | undefined;
        if (payload.eventType === 'DELETE' || !row?.id) { loadConversationsRef.current(); return; }
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === row.id);
          if (idx === -1) { loadConversationsRef.current(); return prev; } // conversa nova → busca completa (avatar etc.)
          // Trocou/desvinculou o cliente (outra aba, outro atendente): o nome do
          // cadastro não vem no payload, precisa ser resolvido de novo.
          if ('client_id' in row && row.client_id !== prev[idx].client_id) {
            loadConversationsRef.current();
            return prev;
          }
          // Mesma história com a foto. O payload traz o CAMINHO no storage, e o
          // que a tela usa é a URL assinada que o client resolve a partir dele —
          // por isso a URL é preservada no merge abaixo. Só que preservá-la
          // quando o caminho mudou congela a foto antiga para sempre: quem
          // atualizasse a foto do contato (aqui ou em outra aba) continuaria
          // vendo a anterior até recarregar a página. Sem como assinar a URL a
          // partir do evento, a saída é buscar de novo.
          if ('contact_avatar_path' in row && row.contact_avatar_path !== prev[idx].contact_avatar_path) {
            loadConversationsRef.current();
            return prev;
          }
          const next = [...prev];
          // Preserva campos resolvidos só no client (não vêm no payload).
          next[idx] = {
            ...prev[idx], ...row,
            contact_avatar_url: prev[idx].contact_avatar_url,
            client_name: prev[idx].client_name,
          } as WhatsAppConversation;
          next.sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
          return next;
        });
      },
      // Mensagem nova/alterada: atualiza só a thread aberta, em silêncio.
      // Para UPDATE de status (delivered/read), faz merge cirúrgico sem reload completo.
      onMessageChange: (payload) => {
        const convId = (payload.new as any)?.conversation_id ?? (payload.old as any)?.conversation_id;
        if (!convId) return;
        if (payload.eventType === 'UPDATE') {
          const row = payload.new as Partial<WhatsAppMessage>;
          if (row?.id && row?.status) {
            setMessages(prev => {
              const idx = prev.findIndex(m => m.id === row.id);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], status: row.status! };
              return next;
            });
            return;
          }
        }
        if (convId === selectedIdRef.current) refreshMessagesRef.current(convId);
      },
      onStatusChange: (status) => {
        setRealtimeStatus(status);
        if (status === 'down') { wasDown = true; return; }
        if (wasDown) { wasDown = false; resync(); } // voltou: repõe o buraco
      },
    });
    return unsub;
  }, [resync, setConversations, setMessages]);

  // Enquanto o canal está fora, repõe em intervalo curto: a inbox continua
  // andando mesmo sem socket (rede ruim, proxy que derruba websocket).
  useEffect(() => {
    if (realtimeStatus !== 'down') return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') resync();
    }, DOWN_POLL_MS);
    return () => window.clearInterval(id);
  }, [realtimeStatus, resync]);

  // Rede de segurança independente do estado do canal: ao voltar para a aba ou
  // recuperar a conexão, repõe. Cobre o caso em que o socket parece vivo mas
  // perdeu eventos (aba estrangulada em segundo plano é o caso clássico).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', resync);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resync);
      window.removeEventListener('focus', onVisible);
    };
  }, [resync]);

  // Fase J: sessão de IA — carrega e assina realtime quando a conversa muda.
  useEffect(() => {
    if (!selectedId) { setAiSession(null); return; }
    whatsappService.getAiSession(selectedId).then(s => setAiSession(s)).catch(() => {});
    const unsub = whatsappService.subscribeAiSession(selectedId, s => setAiSession(s));
    return unsub;
  }, [selectedId]);

  return { aiSession, setAiSession, realtimeStatus };
}
