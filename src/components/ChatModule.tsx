import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Plus, Search, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { chatService } from '../services/chat.service';
import { profileService, type Profile } from '../services/profile.service';
import type { ChatMessage, ChatRoom } from '../types/chat.types';

const DEFAULT_ROOM_NAME = 'Geral';

const formatTime = (value: string) => {
  const date = new Date(value);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const ChatModule: React.FC = () => {
  const { user } = useAuth();

  const [loadingRooms, setLoadingRooms] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  const [membersLoading, setMembersLoading] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);

  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const membersByUserId = useMemo(() => {
    const map = new Map<string, Profile>();
    members.forEach((m) => {
      map.set(m.user_id, m);
    });
    return map;
  }, [members]);

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId]
  );

  const filteredRooms = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(term));
  }, [rooms, searchTerm]);

  const scrollToBottom = () => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const loadMembers = async () => {
    if (!user) return;
    setMembersLoading(true);
    try {
      const result = await profileService.listMembers();
      setMembers(result);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  const loadRooms = async () => {
    if (!user) return;
    setLoadingRooms(true);
    try {
      await chatService.getOrCreatePublicRoomByName({ name: DEFAULT_ROOM_NAME, createdBy: user.id });
      const list = await chatService.listRooms(user.id);
      setRooms(list);

      if (!selectedRoomId) {
        const defaultRoom = list.find((r) => r.is_public && r.name === DEFAULT_ROOM_NAME) ?? list[0] ?? null;
        setSelectedRoomId(defaultRoom?.id ?? null);
      }
    } finally {
      setLoadingRooms(false);
    }
  };

  const loadMessages = async (roomId: string) => {
    setLoadingMessages(true);
    try {
      const list = await chatService.listMessages({ roomId, limit: 200 });
      setMessages(list);
      requestAnimationFrame(scrollToBottom);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadMembers();
    loadRooms();
  }, [user]);

  useEffect(() => {
    if (!selectedRoomId) return;
    loadMessages(selectedRoomId);

    const unsubscribe = chatService.subscribeToRoomMessages({
      roomId: selectedRoomId,
      onInsert: (msg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setRooms((prev) => {
          return prev
            .map((r) => (r.id === msg.room_id ? { ...r, last_message_at: msg.created_at } : r))
            .sort((a, b) => {
              const aTime = a.last_message_at ?? a.created_at;
              const bTime = b.last_message_at ?? b.created_at;
              return bTime.localeCompare(aTime);
            });
        });

        requestAnimationFrame(scrollToBottom);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [selectedRoomId]);

  const handleSend = async () => {
    if (!user || !selectedRoomId) return;

    const content = messageText.trim();
    if (!content) return;

    setMessageText('');

    try {
      await chatService.sendMessage({ roomId: selectedRoomId, userId: user.id, content });
    } catch (err: any) {
      setMessageText(content);
      console.error(err);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex h-[calc(100vh-220px)] min-h-[520px]">
        <aside className="w-80 border-r border-gray-200 bg-white flex flex-col">
          <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <MessageCircle className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Chat</h2>
                <p className="text-xs text-slate-500">Equipes e conversas</p>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              onClick={loadRooms}
              disabled={loadingRooms}
              title="Atualizar"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                placeholder="Buscar salas..."
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingRooms && rooms.length === 0 && (
              <div className="p-4 text-sm text-slate-500">Carregando salas...</div>
            )}

            {!loadingRooms && filteredRooms.length === 0 && (
              <div className="p-4 text-sm text-slate-500">Nenhuma sala encontrada.</div>
            )}

            {filteredRooms.map((room) => {
              const isActive = room.id === selectedRoomId;
              const lastTime = room.last_message_at ? formatTime(room.last_message_at) : '';
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedRoomId(room.id)}
                  className={`w-full text-left px-4 py-3 border-l-4 transition ${
                    isActive
                      ? 'bg-amber-50 border-amber-500'
                      : 'bg-white border-transparent hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className={`text-sm ${isActive ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                      {room.name}
                    </p>
                    {lastTime && <span className="text-xs text-slate-400">{lastTime}</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {room.is_public ? 'Canal público' : 'Canal privado'}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex-1 flex flex-col bg-white">
          <header className="h-[72px] border-b border-gray-200 flex items-center justify-between px-6">
            <div className="min-w-0">
              <h1 className="font-bold text-slate-900 truncate">
                {selectedRoom?.name ?? 'Selecione uma sala'}
              </h1>
              <p className="text-xs text-slate-500">
                {membersLoading ? 'Carregando membros...' : `Equipe cadastrada: ${members.length} membro${members.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
            {loadingMessages && (
              <div className="text-sm text-slate-500">Carregando mensagens...</div>
            )}

            {!loadingMessages && messages.length === 0 && selectedRoomId && (
              <div className="text-sm text-slate-500">Nenhuma mensagem ainda. Envie a primeira.</div>
            )}

            {messages.map((msg) => {
              const isMine = user?.id === msg.user_id;
              const author = membersByUserId.get(msg.user_id);
              const authorName = author?.name || 'Usuário';

              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] ${isMine ? 'text-right' : 'text-left'}`}>
                    {!isMine && (
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${profileService.getPresenceColor(author?.presence_status)}`} />
                        <span className="text-[11px] font-semibold text-slate-500">{authorName}</span>
                        <span className="text-[11px] text-slate-400">{formatTime(msg.created_at)}</span>
                      </div>
                    )}
                    <div
                      className={`inline-block px-4 py-3 rounded-2xl text-sm leading-relaxed border ${
                        isMine
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-slate-50 text-slate-800 border-slate-200'
                      }`}
                    >
                      {msg.content}
                    </div>
                    {isMine && (
                      <div className="mt-1 text-[11px] text-slate-400">{formatTime(msg.created_at)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-gray-200">
            <div className="flex items-end gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200 focus-within:border-amber-300 focus-within:ring-4 ring-amber-500/10 transition-all">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={1}
                placeholder={selectedRoomId ? 'Mensagem...' : 'Selecione uma sala para conversar'}
                disabled={!selectedRoomId}
                className="w-full bg-transparent border-none p-2 text-sm focus:ring-0 resize-none max-h-32 text-slate-800 placeholder:text-slate-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!selectedRoomId || !messageText.trim()}
                className="p-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded-xl transition-all flex items-center justify-center"
                title="Enviar"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Enter envia • Shift+Enter quebra linha</p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ChatModule;
