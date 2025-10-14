import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';
import {
  MessageCircle,
  X,
  Send,
  Phone,
  Video,
  Loader2,
  CheckCheck,
  Plus,
  Search,
  ChevronDown,
  Maximize2,
  Smile,
  Paperclip,
  MoreVertical,
  Trash2,
  Archive,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { chatService } from '../services/chat.service';
import { supabase } from '../config/supabase';
import { profileService, type Profile } from '../services/profile.service';
import type { ConversationWithParticipants, Message } from '../types/chat.types';
import { useNotifications } from '../hooks/useNotifications';

type ConversationWithMeta = ConversationWithParticipants & {
  lastMessage?: Message | null;
};

const FloatingMessenger = () => {
  const { user } = useAuth();
  const { notify } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [conversations, setConversations] = useState<ConversationWithMeta[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [profilesByUserId, setProfilesByUserId] = useState<Record<string, Profile>>({});
  const [showNewChat, setShowNewChat] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSubscriptionRef = useRef<any>(null);

  const scrollToBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const formatRelativeTime = (iso?: string | null) => {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return 'Agora';
    if (diff < hour) return `${Math.floor(diff / minute)}m`;
    if (diff < day) return `${Math.floor(diff / hour)}h`;
    return `${Math.floor(diff / day)}d`;
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0)?.toUpperCase() ?? '')
      .join('');

  const getConversationProfile = useCallback(
    (conversation: ConversationWithParticipants) => {
      if (!user) return undefined;
      const other = conversation.participants?.find((p) => p.user_id !== user.id);
      return other ? profilesByUserId[other.user_id] : undefined;
    },
    [profilesByUserId, user]
  );

  const getConversationName = useCallback(
    (conversation: ConversationWithMeta) => {
      if (conversation.name) return conversation.name;
      const profile = getConversationProfile(conversation);
      return profile?.name ?? 'Conversa';
    },
    [getConversationProfile]
  );

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoadingConversations(true);
    try {
      const [rawConversations, members] = await Promise.all([
        chatService.listConversations(user.id),
        profileService.listMembers(),
      ]);

      const profileMap = members.reduce<Record<string, Profile>>((acc, member) => {
        acc[member.user_id] = member;
        return acc;
      }, {});
      setProfilesByUserId(profileMap);

      const enriched = await Promise.all(
        rawConversations.map(async (conversation) => {
          const latest = await chatService.listMessages(conversation.id, 1);
          return { ...conversation, lastMessage: latest[0] ?? null } as ConversationWithMeta;
        })
      );

      enriched.sort((a, b) => {
        const left = a.lastMessage?.created_at ?? a.updated_at;
        const right = b.lastMessage?.created_at ?? b.updated_at;
        return new Date(right).getTime() - new Date(left).getTime();
      });

      setConversations(enriched);
    } catch (error) {
      console.error('Erro ao carregar conversas:', error);
    } finally {
      setLoadingConversations(false);
    }
  }, [user]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!user) return;
      setLoadingMessages(true);
      try {
        const data = await chatService.listMessages(conversationId);
        setMessages(data);
        scrollToBottom();
        await chatService.markConversationAsRead(conversationId, user.id);
      } catch (error) {
        console.error('Erro ao carregar mensagens:', error);
      } finally {
        setLoadingMessages(false);
      }
    },
    [user]
  );

  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      setSelectedConversationId(conversationId);
      setIsCollapsed(false);
      await loadMessages(conversationId);
    },
    [loadMessages]
  );

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!messageInput.trim() || !selectedConversationId || !user) return;

    const content = messageInput.trim();
    setSendingMessage(true);
    setShowEmojiPicker(false);

    try {
      const newMessage = await chatService.sendMessage(
        { conversation_id: selectedConversationId, content },
        user.id
      );
      setMessageInput('');
      setMessages((prev) => [...prev, newMessage]);
      scrollToBottom();
      // Retornar foco ao input
      messageInputRef.current?.focus();
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      setMessageInput(content);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setMessageInput((prev) => prev + emojiData.emoji);
    setShowEmojiPicker(false);
    messageInputRef.current?.focus();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedConversationId || !user) return;

    setUploadingFile(true);
    try {
      const attachment = await chatService.uploadAttachment(selectedConversationId, file);
      const newMessage = await chatService.sendMessage(
        {
          conversation_id: selectedConversationId,
          content: attachment.originalName,
          message_type: file.type.startsWith('image/') ? 'image' : 'file',
          file_url: attachment.url,
          file_name: attachment.originalName,
          file_size: attachment.size,
        },
        user.id
      );
      setMessages((prev) => [...prev, newMessage]);
      scrollToBottom();
      messageInputRef.current?.focus();
    } catch (error) {
      console.error('Erro ao enviar arquivo:', error);
      alert('Erro ao enviar arquivo. Tente novamente.');
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLInputElement>) => {
    const items = event.clipboardData?.items;
    if (!items || !selectedConversationId || !user) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        setUploadingFile(true);
        try {
          const attachment = await chatService.uploadAttachment(selectedConversationId, file);
          const newMessage = await chatService.sendMessage(
            {
              conversation_id: selectedConversationId,
              content: 'Imagem colada',
              message_type: 'image',
              file_url: attachment.url,
              file_name: attachment.originalName,
              file_size: attachment.size,
            },
            user.id
          );
          setMessages((prev) => [...prev, newMessage]);
          scrollToBottom();
          messageInputRef.current?.focus();
        } catch (error) {
          console.error('Erro ao enviar imagem colada:', error);
          alert('Erro ao enviar imagem. Tente novamente.');
        } finally {
          setUploadingFile(false);
        }
        break;
      }
    }
  };

  const handleClearConversation = async () => {
    if (!selectedConversationId || !user) return;
    
    const confirmed = window.confirm('Deseja limpar todas as mensagens desta conversa? Esta ação não pode ser desfeita.');
    if (!confirmed) return;

    try {
      // Deletar todas as mensagens da conversa
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', selectedConversationId);

      if (error) throw error;

      setMessages([]);
      setShowConversationMenu(false);
      alert('Conversa limpa com sucesso!');
    } catch (error) {
      console.error('Erro ao limpar conversa:', error);
      alert('Erro ao limpar conversa. Tente novamente.');
    }
  };

  const handleArchiveConversation = async () => {
    if (!selectedConversationId) return;
    
    const confirmed = window.confirm('Deseja arquivar esta conversa?');
    if (!confirmed) return;

    try {
      // Implementar lógica de arquivamento aqui
      setShowConversationMenu(false);
      setSelectedConversationId(null);
      alert('Conversa arquivada!');
    } catch (error) {
      console.error('Erro ao arquivar conversa:', error);
      alert('Erro ao arquivar conversa. Tente novamente.');
    }
  };

  const handleStartNewChat = async (memberId: string) => {
    if (!user) return;
    
    setCreatingChat(true);
    setShowNewChat(false);
    
    try {
      // Criar ou encontrar conversa
      const conversation = await chatService.findOrCreateDirectConversation(user.id, memberId);
      
      console.log('Conversa criada/encontrada:', conversation);
      
      // Recarregar lista de conversas
      await loadConversations();
      
      // Selecionar a conversa e carregar mensagens
      setSelectedConversationId(conversation.id);
      await loadMessages(conversation.id);
    } catch (error) {
      console.error('Erro ao criar conversa:', error);
      alert('Erro ao iniciar conversa. Tente novamente.');
    } finally {
      setCreatingChat(false);
    }
  };

  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((conv) =>
      getConversationName(conv).toLowerCase().includes(term)
    );
  }, [conversations, getConversationName, searchTerm]);

  const availableMembers = useMemo(
    () => Object.values(profilesByUserId).filter((p) => p.user_id !== user?.id),
    [profilesByUserId, user]
  );

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [loadConversations, user]);

  useEffect(() => {
    if (!selectedConversationId) return;

    loadMessages(selectedConversationId);

    if (messageSubscriptionRef.current) {
      chatService.unsubscribe(messageSubscriptionRef.current);
      messageSubscriptionRef.current = null;
    }

    messageSubscriptionRef.current = chatService.subscribeToConversation(
      selectedConversationId,
      (newMessage) => {
        setMessages((prev) => {
          const alreadyExists = prev.some((message) => message.id === newMessage.id);
          if (alreadyExists) {
            return prev;
          }
          return [...prev, newMessage];
        });
        scrollToBottom();
        
        // Notificar se a mensagem não é do usuário atual
        if (user && newMessage.sender_id !== user.id) {
          const senderProfile = profilesByUserId[newMessage.sender_id];
          notify(
            senderProfile?.name || 'Nova mensagem',
            newMessage.content || 'Anexo',
            'default'
          );
        }
      }
    );

    return () => {
      if (messageSubscriptionRef.current) {
        chatService.unsubscribe(messageSubscriptionRef.current);
        messageSubscriptionRef.current = null;
      }
    };
  }, [loadMessages, selectedConversationId, user, profilesByUserId, notify]);

  if (!user) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="floating-messenger"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="w-[360px] sm:w-[400px] bg-slate-900/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 overflow-hidden"
            style={{ height: isCollapsed ? '72px' : '600px', maxHeight: 'calc(100vh - 100px)' }}
          >
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-3.5 flex items-center justify-between border-b border-white/10 shadow-lg">
              <div className="flex items-center gap-3 min-w-0">
                {selectedConversation ? (
                  (() => {
                    const profile = getConversationProfile(selectedConversation);
                    const name = getConversationName(selectedConversation);
                    const initials = getInitials(name);
                    return (
                      <div className="flex items-center gap-3 min-w-0">
                        {profile?.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt={name}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white font-semibold text-sm">
                            {initials}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{name}</p>
                          <p className={`text-xs flex items-center gap-1 ${profileService.getPresenceTextColor(profile?.presence_status)}`}>
                            <span className={`inline-block w-2 h-2 rounded-full ${profileService.getPresenceColor(profile?.presence_status)} animate-pulse`} />
                            {profileService.getPresenceLabel(profile?.presence_status)}
                          </p>
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setShowConversationMenu(!showConversationMenu)}
                            className="p-2 rounded-lg hover:bg-white/10 transition"
                          >
                            <MoreVertical className="w-4 h-4 text-white" />
                          </button>
                          {showConversationMenu && (
                            <>
                              <div
                                className="fixed inset-0 z-20"
                                onClick={() => setShowConversationMenu(false)}
                              />
                              <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 rounded-lg shadow-xl border border-white/10 py-2 z-30">
                                <button
                                  onClick={handleClearConversation}
                                  className="w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Limpar conversa
                                </button>
                                <button
                                  onClick={handleArchiveConversation}
                                  className="w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 transition flex items-center gap-2"
                                >
                                  <Archive className="w-4 h-4" />
                                  Arquivar conversa
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                      <MessageCircle className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Mensagens</p>
                      <p className="text-xs text-white/70">Equipe conectada em tempo real</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  className="w-8 h-8 rounded-full hover:bg-white/10 transition flex items-center justify-center"
                >
                  {isCollapsed ? <Maximize2 className="w-4 h-4 text-white" /> : <ChevronDown className="w-4 h-4 text-white" />}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-white/10 transition flex items-center justify-center"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>

            {!isCollapsed && (
              <div className="flex flex-col h-[calc(100%-72px)]">
                {selectedConversation ? (
                  <>
                    <div className="p-3 border-b border-white/10">
                      <button
                        onClick={() => setSelectedConversationId(null)}
                        className="text-sm text-blue-400 hover:text-blue-300 font-medium"
                      >
                        ← Voltar
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 bg-slate-950/50 space-y-3">
                      {loadingMessages ? (
                        <div className="flex items-center justify-center h-full">
                          <Loader2 className="w-6 h-6 text-white/70 animate-spin" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-white/60 text-sm gap-3">
                          <MessageCircle className="w-12 h-12 text-white/20" />
                          <p>Nenhuma mensagem ainda</p>
                          <p className="text-xs text-white/40">Envie uma mensagem para iniciar a conversa</p>
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const isOwn = msg.sender_id === user.id;
                          const isImage = msg.message_type === 'image' && msg.file_url;
                          const isFile = msg.message_type === 'file' && msg.file_url;
                          return (
                            <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                              <div
                                className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                                  isOwn
                                    ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white'
                                    : 'bg-white/10 text-white'
                                }`}
                              >
                                {isImage ? (
                                  <>
                                    <a href={msg.file_url || '#'} target="_blank" rel="noopener noreferrer">
                                      <img
                                        src={msg.file_url || ''}
                                        alt={msg.file_name || 'Imagem'}
                                        className="max-w-full max-h-64 rounded-lg mb-1 hover:opacity-90 transition"
                                      />
                                    </a>
                                    {msg.content && msg.content !== 'Imagem colada' && (
                                      <p className="text-xs mt-1 opacity-80">{msg.content}</p>
                                    )}
                                  </>
                                ) : isFile ? (
                                  <a
                                    href={msg.file_url || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-sm hover:underline transition"
                                  >
                                    <div className="p-2 bg-white/10 rounded-lg">
                                      <Paperclip className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium truncate">{msg.file_name || msg.content}</p>
                                      {msg.file_size && (
                                        <p className="text-xs opacity-60">
                                          {(msg.file_size / 1024).toFixed(1)} KB
                                        </p>
                                      )}
                                    </div>
                                  </a>
                                ) : (
                                  <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                                )}
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  <span className={`text-xs ${isOwn ? 'text-blue-100' : 'text-white/50'}`}>
                                    {formatTime(msg.created_at)}
                                  </span>
                                  {isOwn && <CheckCheck className="w-3 h-3 text-blue-100" />}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                    <form onSubmit={handleSendMessage} className="p-3 border-t border-white/10 bg-slate-900/80 relative">
                      {showEmojiPicker && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setShowEmojiPicker(false)}
                          />
                          <div className="absolute bottom-16 left-4 z-30 shadow-2xl rounded-lg overflow-hidden">
                            <EmojiPicker
                              onEmojiClick={handleEmojiClick}
                              width={320}
                              height={400}
                              previewConfig={{ showPreview: false }}
                              skinTonesDisabled
                              searchDisabled
                            />
                          </div>
                        </>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className="p-2 rounded-lg hover:bg-white/10 transition"
                          disabled={uploadingFile}
                        >
                          <Smile className="w-4 h-4 text-white/60" />
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,.pdf,.doc,.docx,.txt"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 rounded-lg hover:bg-white/10 transition"
                          disabled={uploadingFile}
                        >
                          {uploadingFile ? (
                            <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
                          ) : (
                            <Paperclip className="w-4 h-4 text-white/60" />
                          )}
                        </button>
                        <input
                          ref={messageInputRef}
                          type="text"
                          value={messageInput}
                          onChange={(e) => setMessageInput(e.target.value)}
                          onPaste={handlePaste}
                          placeholder="Mensagem..."
                          className="flex-1 px-4 py-2 bg-white/5 border-none rounded-full text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={sendingMessage || uploadingFile}
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={!messageInput.trim() || sendingMessage || uploadingFile}
                          className="p-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white transition disabled:opacity-50"
                        >
                          {sendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                      </div>
                    </form>
                  </>
                ) : (
                  <>
                    <div className="p-3 border-b border-white/10">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40 w-4 h-4" />
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Buscar..."
                          className="w-full pl-9 pr-3 py-2 bg-white/5 border-none rounded-lg text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto bg-slate-950/50">
                      {loadingConversations ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 text-white/70 animate-spin" />
                        </div>
                      ) : filteredConversations.length === 0 && conversations.length === 0 ? (
                        <div className="p-4 space-y-2">
                          <p className="text-sm text-white/70 mb-3 px-2">Membros da equipe:</p>
                          {creatingChat ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="w-6 h-6 text-white/70 animate-spin" />
                            </div>
                          ) : (
                            availableMembers.map((member) => (
                              <button
                                key={member.id}
                                onClick={() => handleStartNewChat(member.user_id)}
                                disabled={creatingChat}
                                className="w-full p-3 flex items-center gap-3 hover:bg-white/5 rounded-lg transition border border-white/10 disabled:opacity-50"
                              >
                                {member.avatar_url ? (
                                  <img src={member.avatar_url} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                                    {getInitials(member.name)}
                                  </div>
                                )}
                                <div className="text-left">
                                  <p className="font-medium text-white text-sm">{member.name}</p>
                                  <p className="text-xs text-white/60">{member.role}</p>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      ) : filteredConversations.length === 0 ? (
                        <div className="p-6 text-center text-white/60 text-sm">
                          <MessageCircle className="w-10 h-10 mx-auto mb-2 text-white/30" />
                          <p>Nenhuma conversa encontrada</p>
                        </div>
                      ) : (
                        filteredConversations.map((conv) => {
                          const profile = getConversationProfile(conv);
                          const name = getConversationName(conv);
                          const initials = getInitials(name);
                          return (
                            <button
                              key={conv.id}
                              onClick={() => handleSelectConversation(conv.id)}
                              className="w-full p-3 flex items-center gap-3 hover:bg-white/5 transition border-b border-white/5"
                            >
                              {profile?.avatar_url ? (
                                <img src={profile.avatar_url} alt={name} className="w-12 h-12 rounded-full object-cover" />
                              ) : (
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                                  {initials}
                                </div>
                              )}
                              <div className="flex-1 text-left min-w-0">
                                <p className="font-semibold text-white text-sm truncate">{name}</p>
                                <p className="text-xs text-white/60 truncate">
                                  {conv.lastMessage?.content ?? 'Sem mensagens'}
                                </p>
                              </div>
                              <span className="text-xs text-white/40">
                                {formatRelativeTime(conv.lastMessage?.created_at ?? conv.updated_at)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {conversations.length > 0 && (
                      <div className="p-3 border-t border-white/10 bg-slate-900/80">
                        <button
                          onClick={() => setShowNewChat(true)}
                          className="w-full py-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white rounded-lg font-medium text-sm transition flex items-center justify-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Nova Conversa
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setIsOpen((prev) => !prev)}
        whileTap={{ scale: 0.95 }}
        className="group flex items-center gap-3 pl-4 pr-2 py-2 rounded-full bg-slate-900 text-white shadow-2xl border border-white/10 hover:bg-slate-800 transition"
      >
        <div className="relative">
          <MessageCircle className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border border-slate-900" />
        </div>
        <div className="text-left">
          <p className="text-sm font-semibold leading-tight">Mensagens</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">Equipe conectada</p>
        </div>
        <div className="flex -space-x-2">
          {conversations.slice(0, 3).map((conv) => {
            const profile = getConversationProfile(conv);
            const name = getConversationName(conv);
            return (
              <span
                key={conv.id}
                className="w-8 h-8 rounded-full border-2 border-slate-900 overflow-hidden bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold"
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt={name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(name)
                )}
              </span>
            );
          })}
        </div>
      </motion.button>

      {showNewChat && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 rounded-2xl shadow-2xl max-w-sm w-full max-h-[70vh] overflow-hidden border border-white/10"
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-semibold text-white">Nova Conversa</h3>
              <button onClick={() => setShowNewChat(false)} className="p-1 rounded-lg hover:bg-white/10 transition">
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[50vh]">
              <p className="text-sm text-white/70 mb-3">Selecione um membro:</p>
              {creatingChat ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-white/70 animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {availableMembers.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => handleStartNewChat(member.user_id)}
                      disabled={creatingChat}
                      className="w-full p-3 flex items-center gap-3 hover:bg-white/5 rounded-lg transition border border-white/10 disabled:opacity-50"
                    >
                      {member.avatar_url ? (
                        <img src={member.avatar_url} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                          {getInitials(member.name)}
                        </div>
                      )}
                      <div className="text-left">
                        <p className="font-medium text-white text-sm">{member.name}</p>
                        <p className="text-xs text-white/60">{member.role}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default FloatingMessenger;
