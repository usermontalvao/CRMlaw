import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Loader2, MessageCircle, Lock, Plus } from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService } from '../services/clientPortal.service';
import { supabasePortal } from '../lib/supabasePortal';
import type { PortalChatMessage } from '../../types/chat.types';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

// Abre uma nova conversa: fecha a atual e cria uma nova
async function openNewConversation(portalUserId: string): Promise<string | null> {
  // Fecha a conversa atual via RPC (send message limpa) — na prática criamos
  // uma nova sala forçando o portal_get_or_create no backend após a existente
  // ter sido "arquivada" (set is_archived). Por ora, retornamos null e deixamos
  // o advogado reabrir se necessário.
  return null;
}

export const PortalMessages: React.FC = () => {
  const { session } = useClientAuth();
  const [messages, setMessages]   = useState<PortalChatMessage[]>([]);
  const [roomId, setRoomId]       = useState<string | null>(null);
  const [isClosed, setIsClosed]   = useState(false);
  const [loading, setLoading]     = useState(true);
  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const chatChannel  = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const typingChannel = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const typingTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior }), 50);
  }, []);

  const loadMessages = useCallback(async (showLoader = false) => {
    if (!session?.user?.id) return;
    if (showLoader) setLoading(true);
    try {
      const data = await clientPortalService.getChatMessages(session.user.id);
      if (!data) return;
      setMessages(prev => {
        // Merge: mantém msgs locais + adiciona novas do servidor
        const serverIds = new Set(data.messages.map((m: any) => m.id));
        const localOnly = prev.filter(m => !serverIds.has(m.id));
        return [...data.messages, ...localOnly].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
      setRoomId(data.room.id);
      setIsClosed(!!(data.room as any).is_closed);
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [session?.user?.id]);

  // Carga inicial
  useEffect(() => {
    loadMessages(true).then(() => scrollToBottom('instant'));
  }, [loadMessages, scrollToBottom]);

  // Polling a cada 4s — garante msgs do advogado mesmo sem realtime
  useEffect(() => {
    if (!session?.user?.id) return;
    const id = setInterval(() => loadMessages(false), 4000);
    return () => clearInterval(id);
  }, [session?.user?.id, loadMessages]);

  // Realtime: escuta novas mensagens
  useEffect(() => {
    if (!roomId) return;

    chatChannel.current = supabasePortal
      .channel(`portal-chat:${roomId}`)
      .on('postgres_changes' as any, {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `room_id=eq.${roomId}`,
      }, (payload: any) => {
        const m = payload.new;
        const newMsg: PortalChatMessage = {
          id:          m.id,
          content:     m.content,
          created_at:  m.created_at,
          from_client: !!m.portal_client_id,
          is_system:   !!m.is_system,
          sender_name: m.portal_client_id ? null : 'Advogado',
        };
        // Detecta encerramento/reabertura via mensagem de sistema
        if (m.is_system) {
          const c = (m.content || '').toLowerCase();
          if (c.includes('encerrada')) setIsClosed(true);
          if (c.includes('reaberta')) setIsClosed(false);
        }
        setMessages(prev => prev.some(x => x.id === newMsg.id) ? prev : [...prev, newMsg]);
        scrollToBottom();
      })
      .subscribe();

    return () => {
      if (chatChannel.current) {
        supabasePortal.removeChannel(chatChannel.current);
        chatChannel.current = null;
      }
    };
  }, [roomId, scrollToBottom]);

  // Typing broadcast: envia o que o cliente está digitando para o advogado
  useEffect(() => {
    if (!roomId) return;
    typingChannel.current = supabasePortal
      .channel(`portal-typing:${roomId}`)
      .subscribe();
    return () => {
      if (typingChannel.current) {
        supabasePortal.removeChannel(typingChannel.current);
        typingChannel.current = null;
      }
    };
  }, [roomId]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    // Broadcast do texto em tempo real (debounce 150ms)
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      typingChannel.current?.send({
        type: 'broadcast', event: 'typing',
        payload: { text: val },
      });
    }, 150);
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending || !session?.user?.id) return;
    setSending(true);
    setText('');
    // Limpa preview de digitação
    typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { text: '' } });
    const result = await clientPortalService.sendChatMessage(session.user.id, content);
    setSending(false);
    if (result) {
      setMessages(prev => {
        const newMsg: PortalChatMessage = {
          id: (result as any).id ?? crypto.randomUUID(),
          content, created_at: new Date().toISOString(),
          from_client: true, sender_name: null,
        };
        return prev.some(x => x.id === newMsg.id) ? prev : [...prev, newMsg];
      });
      scrollToBottom();
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Agrupa por dia
  const grouped: { day: string; msgs: PortalChatMessage[] }[] = [];
  for (const m of messages) {
    const day = formatDay(m.created_at);
    const last = grouped[grouped.length - 1];
    if (last?.day === day) last.msgs.push(m);
    else grouped.push({ day, msgs: [m] });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)]">
      <header className="shrink-0 pb-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Mensagens</h1>
        <p className="mt-0.5 text-sm text-slate-500">Fale diretamente com o escritório.</p>
      </header>

      <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-slate-200 bg-white overflow-hidden">
        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50">
                <MessageCircle className="h-6 w-6 text-orange-400" />
              </div>
              <p className="text-sm font-medium text-slate-700">Nenhuma mensagem ainda</p>
              <p className="text-xs text-slate-400">Envie uma mensagem para falar com o escritório.</p>
            </div>
          ) : (
            grouped.map(({ day, msgs }) => (
              <div key={day}>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[11px] font-medium text-slate-400 shrink-0">{day}</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
                {msgs.map((m, i) => {
                  if (m.is_system) {
                    return (
                      <div key={m.id} className="flex justify-center my-4">
                        <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2 text-[11px] font-medium text-slate-500">
                          <Lock className="h-3 w-3 shrink-0 text-slate-400" />
                          {m.content}
                        </div>
                      </div>
                    );
                  }
                  const isClient = m.from_client;
                  const prevSame = i > 0 && !msgs[i - 1].is_system && msgs[i - 1].from_client === isClient;
                  return (
                    <div key={m.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'} ${prevSame ? 'mt-1' : 'mt-3'}`}>
                      <div className={`max-w-[75%] ${isClient ? 'items-end' : 'items-start'} flex flex-col`}>
                        {!prevSame && !isClient && (
                          <span className="text-[11px] font-semibold text-slate-500 mb-1 ml-1">
                            {m.sender_name ?? 'Escritório'}
                          </span>
                        )}
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          isClient ? 'bg-orange-500 text-white rounded-br-sm' : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                        }`}>
                          {m.content}
                        </div>
                        <span className="text-[10px] text-slate-400 mt-1 mx-1 tabular-nums">{formatTime(m.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {isClosed ? (
          <div className="shrink-0 border-t border-slate-100 p-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[13px] font-medium text-slate-600 mb-1">
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                Esta conversa foi encerrada
              </div>
              <p className="text-[12px] text-slate-400 mb-3">
                Precisa de mais alguma coisa? Envie uma nova mensagem e iremos responder em breve.
              </p>
              <button
                onClick={async () => {
                  if (!session?.user?.id) return;
                  await clientPortalService.sendChatMessage(
                    session.user.id,
                    'Olá, preciso de ajuda.'
                  );
                  setIsClosed(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-orange-600"
              >
                <Plus className="h-3.5 w-3.5" />
                Iniciar nova mensagem
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 border-t border-slate-100 p-3 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="Escreva uma mensagem..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100 max-h-32 overflow-y-auto"
              style={{ minHeight: '42px' }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
              }}
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="h-[42px] w-[42px] shrink-0 flex items-center justify-center rounded-xl bg-orange-500 text-white transition hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PortalMessages;
