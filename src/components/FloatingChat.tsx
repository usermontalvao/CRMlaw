// Floating Chat Widget (Instagram style)
// Para remover: delete este arquivo e remova a referência em App.tsx

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageCircle,
  Send,
  Phone,
  Video,
  X,
  Minus,
  Search,
  Plus,
  Paperclip,
  Smile,
  CheckCheck,
  Loader2,
  PhoneOff,
  Mic,
  MicOff,
  VideoOff as VideoOffIcon,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { chatService } from '../services/chat.service';
import { profileService } from '../services/profile.service';
import type {
  ConversationWithParticipants,
  Message,
  CallState,
  CallType,
} from '../types/chat.types';
import type { Profile } from '../services/profile.service';

interface FloatingChatProps {
  isOpen: boolean;
  onClose: () => void;
}

const FloatingChat: React.FC<FloatingChatProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationWithParticipants[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationWithParticipants | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [callState, setCallState] = useState<CallState>({
    active: false,
    type: null,
    conversation_id: null,
    call_session_id: null,
    is_caller: false,
    remote_user_id: null,
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSubscription = useRef<any>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);

  const loadConversations = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const data = await chatService.listConversations(user.id);
      setConversations(data);
      
      // Calcular não lidas
      const unread = data.reduce((acc, conv) => acc + (conv.unread_count || 0), 0);
      setUnreadCount(unread);
    } catch (error) {
      console.error('Erro ao carregar conversas:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const data = await chatService.listMessages(conversationId);
      setMessages(data);
      scrollToBottom();
      
      if (user) {
        await chatService.markConversationAsRead(conversationId, user.id);
      }
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    }
  };

  const loadTeamMembers = async () => {
    try {
      console.log('🔍 Carregando membros da equipe...');
      const members = await profileService.listMembers();
      console.log('✅ Membros carregados:', members);
      console.log('👤 Usuário atual:', user?.id);
      
      const filtered = members.filter(m => m.user_id !== user?.id);
      console.log('📋 Membros filtrados (sem você):', filtered);
      
      setTeamMembers(filtered);
    } catch (error) {
      console.error('❌ Erro ao carregar membros:', error);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      loadConversations();
      loadTeamMembers();
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
      
      messageSubscription.current = chatService.subscribeToConversation(
        selectedConversation.id,
        (newMessage) => {
          setMessages(prev => [...prev, newMessage]);
          scrollToBottom();
        }
      );
    }

    return () => {
      if (messageSubscription.current) {
        chatService.unsubscribe(messageSubscription.current);
      }
    };
  }, [selectedConversation]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!messageInput.trim() || !selectedConversation || !user) return;

    const messageText = messageInput.trim();
    setMessageInput(''); // Limpar imediatamente

    try {
      setSending(true);
      const newMessage = await chatService.sendMessage(
        {
          conversation_id: selectedConversation.id,
          content: messageText,
        },
        user.id
      );
      
      // Adicionar mensagem localmente para aparecer imediatamente
      setMessages(prev => [...prev, newMessage]);
      scrollToBottom();
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      alert('Erro ao enviar mensagem');
      setMessageInput(messageText); // Restaurar texto em caso de erro
    } finally {
      setSending(false);
    }
  };

  const handleStartNewChat = async (memberId: string) => {
    if (!user) return;

    try {
      const conversation = await chatService.findOrCreateDirectConversation(user.id, memberId);
      await loadConversations();
      const fullConv = conversations.find(c => c.id === conversation.id);
      if (fullConv) {
        setSelectedConversation(fullConv);
      }
      setShowNewChatModal(false);
    } catch (error) {
      console.error('Erro ao criar conversa:', error);
    }
  };

  const handleStartCall = async (type: CallType) => {
    if (!selectedConversation || !user) return;

    try {
      const session = await chatService.createCallSession(
        {
          conversation_id: selectedConversation.id,
          call_type: type,
        },
        user.id
      );

      setCallState({
        active: true,
        type,
        conversation_id: selectedConversation.id,
        call_session_id: session.id,
        is_caller: true,
        remote_user_id: selectedConversation.participants?.find(p => p.user_id !== user.id)?.user_id || null,
      });

      await initializeWebRTC(type);
    } catch (error) {
      console.error('Erro ao iniciar chamada:', error);
    }
  };

  const initializeWebRTC = async (type: CallType) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video',
      });

      localStream.current = stream;

      if (localVideoRef.current && type === 'video') {
        localVideoRef.current.srcObject = stream;
      }

      const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      };

      peerConnection.current = new RTCPeerConnection(configuration);

      stream.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, stream);
      });

      peerConnection.current.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };
    } catch (error) {
      console.error('Erro ao inicializar WebRTC:', error);
      handleEndCall();
    }
  };

  const handleEndCall = async () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }

    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    if (callState.call_session_id) {
      try {
        await chatService.updateCallSession(callState.call_session_id, {
          status: 'ended',
          ended_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Erro ao finalizar sessão:', error);
      }
    }

    setCallState({
      active: false,
      type: null,
      conversation_id: null,
      call_session_id: null,
      is_caller: false,
      remote_user_id: null,
    });
    setIsMuted(false);
    setIsVideoOff(false);
  };

  const toggleMute = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const getConversationName = (conv: ConversationWithParticipants) => {
    if (conv.name) return conv.name;
    
    const otherParticipant = conv.participants?.find(p => p.user_id !== user?.id);
    const member = teamMembers.find(m => m.user_id === otherParticipant?.user_id);
    return member?.name || 'Conversa';
  };

  const filteredConversations = conversations.filter(conv => 
    getConversationName(conv).toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  // Modal de chamada (fullscreen)
  if (callState.active) {
    return (
      <div className="fixed inset-0 bg-slate-900 z-[9999] flex flex-col">
        <div className="flex-1 relative">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />

          {callState.type === 'video' && (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute top-4 right-4 w-48 h-36 rounded-lg shadow-lg object-cover border-2 border-white"
            />
          )}

          <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2">
            <p className="text-white font-medium">
              {selectedConversation && getConversationName(selectedConversation)}
            </p>
            <p className="text-white/80 text-sm">
              {callState.type === 'video' ? 'Chamada de vídeo' : 'Chamada de áudio'}
            </p>
          </div>
        </div>

        <div className="p-6 bg-slate-800 flex items-center justify-center gap-4">
          <button
            onClick={toggleMute}
            className={`p-4 rounded-full transition ${
              isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
          </button>

          {callState.type === 'video' && (
            <button
              onClick={toggleVideo}
              className={`p-4 rounded-full transition ${
                isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              {isVideoOff ? <VideoOffIcon className="w-6 h-6 text-white" /> : <Video className="w-6 h-6 text-white" />}
            </button>
          )}

          <button
            onClick={handleEndCall}
            className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Widget flutuante */}
      <div 
        className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ${
          isMinimized ? 'w-80' : 'w-96'
        }`}
        style={{ 
          height: isMinimized ? '60px' : '600px',
          maxHeight: 'calc(100vh - 100px)'
        }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 h-full flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageCircle className="w-5 h-5 text-white" />
              <div>
                <h3 className="font-semibold text-white">
                  {selectedConversation ? getConversationName(selectedConversation) : 'Mensagens'}
                </h3>
                {selectedConversation && (
                  <p className="text-xs text-blue-100">Online</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedConversation && !isMinimized && (
                <>
                  <button
                    onClick={() => handleStartCall('audio')}
                    className="p-2 rounded-lg hover:bg-white/10 transition"
                    title="Chamada de áudio"
                  >
                    <Phone className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={() => handleStartCall('video')}
                    className="p-2 rounded-lg hover:bg-white/10 transition"
                    title="Chamada de vídeo"
                  >
                    <Video className="w-4 h-4 text-white" />
                  </button>
                </>
              )}
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title={isMinimized ? 'Expandir' : 'Minimizar'}
              >
                {isMinimized ? <ChevronDown className="w-4 h-4 text-white" /> : <Minus className="w-4 h-4 text-white" />}
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title="Fechar"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          {/* Conteúdo (oculto quando minimizado) */}
          {!isMinimized && (
            <>
              {selectedConversation ? (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Botão voltar */}
                  <div className="p-2 border-b border-gray-200">
                    <button
                      onClick={() => setSelectedConversation(null)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      ← Voltar
                    </button>
                  </div>

                  {/* Mensagens */}
                  <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                    {messages.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        Nenhuma mensagem ainda
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {messages.map((msg) => {
                          const isOwn = msg.sender_id === user?.id;
                          return (
                            <div
                              key={msg.id}
                              className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                                  isOwn
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white border border-gray-200 text-slate-900'
                                }`}
                              >
                                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  <span className={`text-xs ${isOwn ? 'text-blue-100' : 'text-slate-500'}`}>
                                    {formatTime(msg.created_at)}
                                  </span>
                                  {isOwn && <CheckCheck className="w-3 h-3 text-blue-100" />}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-200 bg-white">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="p-2 rounded-lg hover:bg-gray-100 transition"
                        title="Emoji"
                      >
                        <Smile className="w-4 h-4 text-slate-600" />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-lg hover:bg-gray-100 transition"
                        title="Anexar"
                      >
                        <Paperclip className="w-4 h-4 text-slate-600" />
                      </button>
                      
                      <input
                        type="text"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        placeholder="Mensagem..."
                        className="flex-1 px-3 py-2 bg-gray-100 border-none rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={sending}
                      />
                      
                      <button
                        type="submit"
                        disabled={!messageInput.trim() || sending}
                        className="p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Search */}
                  <div className="p-3 border-b border-gray-200">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Buscar..."
                        className="w-full pl-9 pr-3 py-2 bg-gray-100 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Lista de conversas */}
                  <div className="flex-1 overflow-y-auto">
                    {loading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                      </div>
                    ) : filteredConversations.length === 0 ? (
                      <div className="p-6 text-center text-slate-500 text-sm">
                        <MessageCircle className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                        <p>Nenhuma conversa</p>
                      </div>
                    ) : (
                      filteredConversations.map((conv) => (
                        <button
                          key={conv.id}
                          onClick={() => setSelectedConversation(conv)}
                          className="w-full p-3 flex items-center gap-3 hover:bg-gray-50 transition border-b border-gray-100"
                        >
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                            {getConversationName(conv).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="font-semibold text-slate-900 text-sm truncate">
                              {getConversationName(conv)}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              Última mensagem...
                            </p>
                          </div>
                          <span className="text-xs text-slate-400">
                            {formatTime(conv.updated_at)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Botão nova conversa */}
                  <div className="p-3 border-t border-gray-200">
                    <button
                      onClick={() => setShowNewChatModal(true)}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Nova Conversa
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal de nova conversa */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full max-h-[70vh] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Nova Conversa</h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="p-1 rounded-lg hover:bg-gray-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[50vh]">
              <p className="text-sm text-slate-600 mb-3">Selecione um membro:</p>
              <div className="space-y-2">
                {teamMembers.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => handleStartNewChat(member.user_id)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-gray-50 rounded-lg transition border border-gray-200"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-slate-900 text-sm">{member.name}</p>
                      <p className="text-xs text-slate-500">{member.role}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingChat;
