import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Loader2, MessageCircle } from 'lucide-react';
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

export const PortalMessages: React.FC = () => {
  const { session } = useClientAuth();
  const [messages, setMessages] = useState<PortalChatMessage[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const channelRef = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior }), 50);
  }, []);

  // Carrega mensagens
  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    setLoading(true);
    clientPortalService.getChatMessages(session.user.id).then(data => {
      if (!mounted || !data) return;
      setMessages(data.messages);
      setRoomId(data.room.id);
      setLoading(false);
      scrollToBottom('instant');
    }).catch(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [session?.user?.id, scrollToBottom]);

  // Realtime: escuta novas mensagens na sala
  useEffect(() => {
    if (!roomId) return;

    channelRef.current = supabasePortal
      .channel(`portal-chat:${roomId}`)
      .on('postgres_changes' as any, {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `room_id=eq.${roomId}`,
      }, (payload: any) => {
        const m = payload.new;
        const newMsg: PortalChatMessage = {
          id:          m.id,
          content:     m.content,
          created_at:  m.created_at,
          from_client: !!m.portal_client_id,
          sender_name: m.portal_client_id ? null : 'Advogado',
        };
        setMessages(prev => {
          if (prev.some(x => x.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        scrollToBottom();
      })
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabasePortal.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [roomId, scrollToBottom]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending || !session?.user?.id) return;
    setSending(true);
    setText('');
    const result = await clientPortalService.sendChatMessage(session.user.id, content);
    setSending(false);
    if (result) {
      // A mensagem chega via realtime, mas adicionamos localmente para resposta imediata
      setMessages(prev => {
        const newMsg: PortalChatMessage = {
          id: (result as any).id ?? crypto.randomUUID(),
          content,
          created_at: new Date().toISOString(),
          from_client: true,
          sender_name: null,
        };
        if (prev.some(x => x.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      scrollToBottom();
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Agrupa mensagens por dia
  const grouped: { day: string; msgs: PortalChatMessage[] }[] = [];
  for (const m of messages) {
    const day = formatDay(m.created_at);
    const last = grouped[grouped.length - 1];
    if (last?.day === day) last.msgs.push(m);
    else grouped.push({ day, msgs: [m] });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)]">
      {/* Header */}
      <header className="shrink-0 pb-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Mensagens</h1>
        <p className="mt-0.5 text-sm text-slate-500">Fale diretamente com o escritório.</p>
      </header>

      {/* Área de mensagens */}
      <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                {/* Separador de dia */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[11px] font-medium text-slate-400 shrink-0">{day}</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>

                {msgs.map((m, i) => {
                  const isClient = m.from_client;
                  const prevSame = i > 0 && msgs[i - 1].from_client === isClient;
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isClient ? 'justify-end' : 'justify-start'} ${prevSame ? 'mt-1' : 'mt-3'}`}
                    >
                      <div className={`max-w-[75%] ${isClient ? 'items-end' : 'items-start'} flex flex-col`}>
                        {/* Nome do remetente (primeira msg do grupo) */}
                        {!prevSame && !isClient && (
                          <span className="text-[11px] font-semibold text-slate-500 mb-1 ml-1">
                            {m.sender_name ?? 'Escritório'}
                          </span>
                        )}
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          isClient
                            ? 'bg-orange-500 text-white rounded-br-sm'
                            : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                        }`}>
                          {m.content}
                        </div>
                        <span className="text-[10px] text-slate-400 mt-1 mx-1 tabular-nums">
                          {formatTime(m.created_at)}
                        </span>
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
        <div className="shrink-0 border-t border-slate-100 p-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
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
            {sending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortalMessages;
