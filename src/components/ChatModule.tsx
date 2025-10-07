// Chat Module Component
// Para remover: delete este arquivo e remova a referência em App.tsx

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageCircle,
  Send,
  Phone,
  Video,
  MoreVertical,
  Search,
  Plus,
  Image as ImageIcon,
  Paperclip,
  Smile,
  X,
  Check,
  CheckCheck,
  Loader2,
  PhoneOff,
  Mic,
  MicOff,
  VideoOff as VideoOffIcon,
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

const ChatModule: React.FC = () => {
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSubscription = useRef<any>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);

  // Carregar conversas
  const loadConversations = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const data = await chatService.listConversations(user.id);
      setConversations(data);
    } catch (error) {
      console.error('Erro ao carregar conversas:', error);
    } finally {
      setLoading(false);
    }
  };

  // Carregar mensagens da conversa selecionada
  const loadMessages = async (conversationId: string) => {
    try {
      const data = await chatService.listMessages(conversationId);
      setMessages(data);
      scrollToBottom();
      
      // Marcar como lida
      if (user) {
        await chatService.markConversationAsRead(conversationId, user.id);
      }
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    }
  };

  // Carregar membros da equipe
  const loadTeamMembers = async () => {
    try {
      const members = await profileService.listMembers();
      setTeamMembers(members.filter(m => m.user_id !== user?.id));
    } catch (error) {
      console.error('Erro ao carregar membros:', error);
    }
  };

  useEffect(() => {
    loadConversations();
    loadTeamMembers();
  }, [user]);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
      
      // Subscribe to new messages
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

    try {
      setSending(true);
      await chatService.sendMessage(
        {
          conversation_id: selectedConversation.id,
          content: messageInput.trim(),
        },
        user.id
      );
      setMessageInput('');
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      alert('Erro ao enviar mensagem');
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
      alert('Erro ao criar conversa');
    }
  };

  const handleStartCall = async (type: CallType) => {
    if (!selectedConversation || !user) return;

    try {
      // Criar sessão de chamada
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

      // Iniciar WebRTC
      await initializeWebRTC(type);
    } catch (error) {
      console.error('Erro ao iniciar chamada:', error);
      alert('Erro ao iniciar chamada');
    }
  };

  const initializeWebRTC = async (type: CallType) => {
    try {
      // Obter stream local
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video',
      });

      localStream.current = stream;

      if (localVideoRef.current && type === 'video') {
        localVideoRef.current.srcObject = stream;
      }

      // Criar peer connection
      const configuration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      };

      peerConnection.current = new RTCPeerConnection(configuration);

      // Adicionar tracks locais
      stream.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, stream);
      });

      // Lidar com tracks remotos
      peerConnection.current.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // TODO: Implementar signaling via Supabase Realtime
      // Aqui você precisaria enviar/receber offers, answers e ICE candidates

    } catch (error) {
      console.error('Erro ao inicializar WebRTC:', error);
      alert('Erro ao acessar câmera/microfone');
      handleEndCall();
    }
  };

  const handleEndCall = async () => {
    // Parar streams
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }

    // Fechar peer connection
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    // Atualizar sessão
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-140px)] bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Sidebar - Lista de conversas */}
      <div className="w-full md:w-96 border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900">Mensagens</h2>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="p-2 rounded-lg hover:bg-gray-100 transition"
              title="Nova conversa"
            >
              <Plus className="w-5 h-5 text-slate-600" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar conversas..."
              className="w-full pl-10 pr-4 py-2 bg-gray-100 border-none rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Lista de conversas */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Nenhuma conversa ainda</p>
              <p className="text-xs mt-1">Clique no + para iniciar</p>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversation(conv)}
                className={`w-full p-4 flex items-center gap-3 hover:bg-gray-50 transition border-b border-gray-100 ${
                  selectedConversation?.id === conv.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                  {getConversationName(conv).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold text-slate-900 truncate">
                      {getConversationName(conv)}
                    </p>
                    <span className="text-xs text-slate-500">
                      {formatTime(conv.updated_at)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 truncate">
                    Última mensagem...
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Área de chat */}
      {selectedConversation ? (
        <div className="flex-1 flex flex-col">
          {/* Header do chat */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold">
                {getConversationName(selectedConversation).charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  {getConversationName(selectedConversation)}
                </h3>
                <p className="text-xs text-slate-500">Online</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleStartCall('audio')}
                className="p-2 rounded-lg hover:bg-gray-100 transition"
                title="Chamada de áudio"
              >
                <Phone className="w-5 h-5 text-slate-600" />
              </button>
              <button
                onClick={() => handleStartCall('video')}
                className="p-2 rounded-lg hover:bg-gray-100 transition"
                title="Chamada de vídeo"
              >
                <Video className="w-5 h-5 text-slate-600" />
              </button>
              <button className="p-2 rounded-lg hover:bg-gray-100 transition">
                <MoreVertical className="w-5 h-5 text-slate-600" />
              </button>
            </div>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                <div className="text-center">
                  <MessageCircle className="w-16 h-16 mx-auto mb-3 text-slate-300" />
                  <p>Nenhuma mensagem ainda</p>
                  <p className="text-sm mt-1">Envie a primeira mensagem!</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => {
                  const isOwn = msg.sender_id === user?.id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2 ${
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
                          {isOwn && (
                            <CheckCheck className="w-3 h-3 text-blue-100" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input de mensagem */}
          <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-200 bg-white">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition"
                title="Adicionar emoji"
              >
                <Smile className="w-5 h-5 text-slate-600" />
              </button>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition"
                title="Anexar arquivo"
              >
                <Paperclip className="w-5 h-5 text-slate-600" />
              </button>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition"
                title="Enviar imagem"
              >
                <ImageIcon className="w-5 h-5 text-slate-600" />
              </button>
              
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Digite uma mensagem..."
                className="flex-1 px-4 py-2 bg-gray-100 border-none rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={sending}
              />
              
              <button
                type="submit"
                disabled={!messageInput.trim() || sending}
                className="p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-slate-500">
            <MessageCircle className="w-20 h-20 mx-auto mb-4 text-slate-300" />
            <p className="text-lg font-medium">Selecione uma conversa</p>
            <p className="text-sm mt-1">Escolha uma conversa para começar a mensagem</p>
          </div>
        </div>
      )}

      {/* Modal de nova conversa */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nova Conversa</h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-slate-600 mb-4">Selecione um membro da equipe:</p>
              <div className="space-y-2">
                {teamMembers.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => handleStartNewChat(member.user_id)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-gray-50 rounded-lg transition border border-gray-200"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-slate-900">{member.name}</p>
                      <p className="text-xs text-slate-500">{member.role}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de chamada */}
      {callState.active && (
        <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
          {/* Vídeos */}
          <div className="flex-1 relative">
            {/* Vídeo remoto (tela cheia) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />

            {/* Vídeo local (PiP) */}
            {callState.type === 'video' && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute top-4 right-4 w-48 h-36 rounded-lg shadow-lg object-cover border-2 border-white"
              />
            )}

            {/* Info da chamada */}
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2">
              <p className="text-white font-medium">
                {getConversationName(selectedConversation!)}
              </p>
              <p className="text-white/80 text-sm">
                {callState.type === 'video' ? 'Chamada de vídeo' : 'Chamada de áudio'}
              </p>
            </div>
          </div>

          {/* Controles */}
          <div className="p-6 bg-slate-800 flex items-center justify-center gap-4">
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full transition ${
                isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              {isMuted ? (
                <MicOff className="w-6 h-6 text-white" />
              ) : (
                <Mic className="w-6 h-6 text-white" />
              )}
            </button>

            {callState.type === 'video' && (
              <button
                onClick={toggleVideo}
                className={`p-4 rounded-full transition ${
                  isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                {isVideoOff ? (
                  <VideoOffIcon className="w-6 h-6 text-white" />
                ) : (
                  <Video className="w-6 h-6 text-white" />
                )}
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
      )}
    </div>
  );
};

export default ChatModule;
