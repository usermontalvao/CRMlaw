// Subscriptions de tempo real do módulo WhatsApp: mudanças de conversa/mensagem
// (lista + thread aberta) e a sessão de IA da conversa selecionada. Extraído do
// WhatsAppModule para isolar os listeners do Supabase do orquestrador.
import { useEffect, useState } from 'react';
import { whatsappService } from '../../../services/whatsapp.service';
import type {
  WhatsAppConversation, WhatsAppMessage, WhatsAppAiSession,
} from '../../../types/whatsapp.types';

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
}

/**
 * Assina os eventos realtime de conversa/mensagem e mantém a sessão de IA da
 * conversa aberta sincronizada. Não dispara fetches de bootstrap (canais,
 * setores, staff) — esses ficam no módulo; aqui é só o fluxo reativo.
 */
export function useWaRealtime({
  selectedId, loadConversations, refreshMessages,
  setConversations, setMessages, setSelectedId,
}: WaRealtimeArgs): WaRealtimeApi {
  // Fase J: sessão de IA da conversa selecionada.
  const [aiSession, setAiSession] = useState<WhatsAppAiSession | null>(null);

  useEffect(() => {
    const unsub = whatsappService.subscribe({
      // Mescla a conversa que mudou no lugar (presença, preview, contador,
      // ordem) — sem recarregar a lista nem tocar na thread aberta.
      onConversationChange: (payload) => {
        const row = payload.new as Partial<WhatsAppConversation> | undefined;
        if (payload.eventType === 'DELETE' || !row?.id) { loadConversations(); return; }
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === row.id);
          if (idx === -1) { loadConversations(); return prev; } // conversa nova → busca completa (avatar etc.)
          const next = [...prev];
          // Preserva a URL assinada do avatar (campo só do client, não vem no payload).
          next[idx] = { ...prev[idx], ...row, contact_avatar_url: prev[idx].contact_avatar_url } as WhatsAppConversation;
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
        setSelectedId(curr => { if (curr && convId === curr) refreshMessages(curr); return curr; });
      },
    });
    return unsub;
  }, [loadConversations, refreshMessages, setConversations, setMessages, setSelectedId]);

  // Fase J: sessão de IA — carrega e assina realtime quando a conversa muda.
  useEffect(() => {
    if (!selectedId) { setAiSession(null); return; }
    whatsappService.getAiSession(selectedId).then(s => setAiSession(s)).catch(() => {});
    const unsub = whatsappService.subscribeAiSession(selectedId, s => setAiSession(s));
    return unsub;
  }, [selectedId]);

  return { aiSession, setAiSession };
}
