import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bell, BellOff, CheckCheck, Download, FileText, Image, MessageCircle, Mic, Paperclip, Plus, Search, Send, Smile, Square, X, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { chatService } from '../services/chat.service';
import { profileService, type Profile } from '../services/profile.service';
import { supabase } from '../config/supabase';
import type { ChatMessage, ChatRoom } from '../types/chat.types';

const DEFAULT_ROOM_NAME = 'Geral';

const ATTACHMENT_PREFIX = '__anexo__:';
const ATTACHMENT_BUCKET = 'anexos_chat';
const ATTACHMENT_VALIDITY_MS = 1000 * 60 * 60 * 24 * 183; // ~6 meses

type ChatAttachmentPayload = {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
};

const isAttachmentMessage = (content: string) => content.startsWith(ATTACHMENT_PREFIX);

const parseAttachment = (content: string): ChatAttachmentPayload | null => {
  if (!isAttachmentMessage(content)) return null;
  const raw = content.slice(ATTACHMENT_PREFIX.length);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.filePath || !parsed?.fileName) return null;
    return parsed as ChatAttachmentPayload;
  } catch {
    return null;
  }
};

const formatFileSize = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const value = unitIndex === 0 ? `${Math.round(size)}` : size.toFixed(1);
  return `${value} ${units[unitIndex]}`;
};

const isExpiredAttachment = (createdAt: string) => {
  const created = new Date(createdAt).getTime();
  return Date.now() - created > ATTACHMENT_VALIDITY_MS;
};

const getMessagePreview = (content: string) => {
  if (isAttachmentMessage(content)) {
    const attachment = parseAttachment(content);
    if (attachment?.mimeType?.startsWith('image/')) return '�️ Imagem';
    if (attachment?.mimeType?.startsWith('audio/')) return '🎤 Áudio';
    return '� Anexo';
  }
  const trimmed = (content ?? '').trim();
  return trimmed ? trimmed.substring(0, 50) : 'Nenhuma mensagem ainda';
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const formatLastSeen = (value: string) => {
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Online';
  if (diffMins < 60) return `${diffMins} min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const getInitials = (name: string) => {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(n => n.length > 0)
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const Avatar: React.FC<{ 
  src?: string | null; 
  name: string; 
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showStatus?: boolean;
  isOnline?: boolean;
  className?: string;
  imageClassName?: string;
}> = ({ src, name, size = 'md', showStatus = false, isOnline = false, className, imageClassName }) => {
  const sizeClasses = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-12 w-12 text-sm',
    lg: 'h-14 w-14 text-base',
    xl: 'h-20 w-20 text-xl',
  };
  const statusSizes = {
    sm: 'h-2.5 w-2.5',
    md: 'h-3 w-3',
    lg: 'h-3.5 w-3.5',
    xl: 'h-4 w-4',
  };

  return (
    <div className={`relative shrink-0 ${className ?? ''}`.trim()}>
      {src ? (
        <img 
          src={src} 
          alt={name} 
          className={`${sizeClasses[size]} rounded-full object-cover ${imageClassName ?? 'ring-2 ring-white'}`.trim()}
        />
      ) : (
        <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-indigo-600 to-slate-700 flex items-center justify-center text-white font-semibold ring-2 ring-white`}>
          {getInitials(name)}
        </div>
      )}
      {showStatus && (
        <span className={`absolute bottom-0 right-0 block ${statusSizes[size]} rounded-full ring-2 ring-white ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
      )}
    </div>
  );
};

const AttachmentSignedMedia: React.FC<{ attachment: ChatAttachmentPayload; kind: 'audio' | 'image' }> = ({ attachment, kind }) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setSignedUrl(null);

    supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(attachment.filePath, 60 * 5)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.signedUrl) return;
        setSignedUrl(data.signedUrl);
      });

    return () => {
      active = false;
    };
  }, [attachment.filePath]);

  if (!signedUrl) {
    return (
      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Carregando...
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <>
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="mt-3 rounded-xl overflow-hidden bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 w-full text-left"
          title="Ampliar imagem"
        >
          <img
            src={signedUrl}
            alt={attachment.fileName}
            className="w-full max-h-80 object-contain"
            loading="lazy"
          />
        </button>

        {viewerOpen && (
          <div
            className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4"
            onClick={() => setViewerOpen(false)}
          >
            <div className="relative max-w-[92vw] max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="absolute -top-3 -right-3 h-10 w-10 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center ring-1 ring-white/20"
                onClick={() => setViewerOpen(false)}
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={signedUrl}
                alt={attachment.fileName}
                className="max-w-[92vw] max-h-[92vh] object-contain rounded-xl"
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="mt-3">
      <audio
        src={signedUrl}
        controls
        className="w-full h-10 rounded-lg"
        preload="metadata"
      />
    </div>
  );
};

const ChatModule: React.FC = () => {
  const { user } = useAuth();
  const { moduleParams, clearModuleParams } = useNavigation();

  const initialRoomId = useMemo(() => {
    try {
      const raw = moduleParams?.chat;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.roomId === 'string' ? parsed.roomId : null;
    } catch {
      return null;
    }
  }, [moduleParams]);

  const [loadingRooms, setLoadingRooms] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomMembers, setRoomMembers] = useState<Map<string, string[]>>(new Map());
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);

  const [membersLoading, setMembersLoading] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);

  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState('');
  const [showContactInfo, setShowContactInfo] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, { name: string; timestamp: number }>>(new Map());
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showMobileChat, setShowMobileChat] = useState(false);

  useEffect(() => {
    if (!initialRoomId) return;
    setSelectedRoomId(initialRoomId);
    clearModuleParams('chat');
  }, [initialRoomId, clearModuleParams]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingChannelRef = useRef<any | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const insertTextAtCursor = (text: string) => {
    const el = messageInputRef.current;
    if (!el) {
      setMessageText((prev) => `${prev}${text}`);
      return;
    }

    const start = el.selectionStart ?? messageText.length;
    const end = el.selectionEnd ?? messageText.length;
    const next = `${messageText.slice(0, start)}${text}${messageText.slice(end)}`;
    setMessageText(next);

    requestAnimationFrame(() => {
      try {
        el.focus();
        const pos = start + text.length;
        el.setSelectionRange(pos, pos);
      } catch {}
    });
  };

  const handlePickEmoji = (emoji: string) => {
    insertTextAtCursor(emoji);
    setShowEmojiPicker(false);
  };

  const handleAttachClick = () => {
    if (!selectedRoomId || uploadingAttachment) return;
    fileInputRef.current?.click();
  };

  const handleUploadAttachment = async (file: File) => {
    if (!user || !selectedRoomId) return;
    setUploadingAttachment(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const filePath = `chat/${selectedRoomId}/${crypto.randomUUID()}_${safeName}`;

      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(filePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });

      if (error) {
        throw new Error(error.message);
      }

      const payload: ChatAttachmentPayload = {
        filePath,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      };

      await chatService.sendMessage({
        roomId: selectedRoomId,
        userId: user.id,
        content: `${ATTACHMENT_PREFIX}${JSON.stringify(payload)}`,
      });
    } catch (err: any) {
      alert(`Falha ao enviar anexo: ${err?.message ?? 'erro desconhecido'}`);
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadAttachment = async (attachment: ChatAttachmentPayload) => {
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(attachment.filePath, 60 * 5);

    if (error || !data?.signedUrl) {
      alert('Não foi possível gerar link para download.');
      return;
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
        await handleUploadAttachment(file);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderAttachment = (msg: ChatMessage, isMine: boolean) => {
    const attachment = parseAttachment(msg.content);
    if (!attachment) return null;

    const expired = isExpiredAttachment(msg.created_at);
    const isAudio = attachment.mimeType.startsWith('audio/');
    const isImage = attachment.mimeType.startsWith('image/');

    if (isAudio || isImage) {
      return (
        <div
          className={`rounded-xl border ${
            isMine
              ? 'border-white/20 bg-white/10'
              : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'
          } p-3`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                isMine ? 'bg-white/15' : 'bg-slate-100 dark:bg-zinc-800'
              }`}
            >
              {isImage ? (
                <Image className={`w-5 h-5 ${isMine ? 'text-white' : 'text-indigo-600'}`} />
              ) : (
                <Mic className={`w-5 h-5 ${isMine ? 'text-white' : 'text-indigo-600'}`} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold truncate ${isMine ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                {attachment.fileName}
              </p>
              <p className={`text-xs ${isMine ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
                {formatFileSize(attachment.size)}
                {expired ? ' • Expirado (6 meses)' : ''}
              </p>
            </div>
            <button
              type="button"
              disabled={expired}
              onClick={() => handleDownloadAttachment(attachment)}
              className={`h-9 w-9 rounded-xl flex items-center justify-center transition ${
                expired
                  ? 'opacity-40 cursor-not-allowed'
                  : isMine
                    ? 'bg-white/15 hover:bg-white/25'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'
              }`}
              title={expired ? 'Anexo expirado' : 'Baixar'}
            >
              <Download className={`w-4 h-4 ${isMine ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`} />
            </button>
          </div>
          {!expired && <AttachmentSignedMedia attachment={attachment} kind={isImage ? 'image' : 'audio'} />}
        </div>
      );
    }

    return (
      <div
        className={`rounded-xl border ${
          isMine
            ? 'border-white/20 bg-white/10'
            : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'
        } p-3`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`h-10 w-10 rounded-xl flex items-center justify-center ${
              isMine ? 'bg-white/15' : 'bg-slate-100 dark:bg-zinc-800'
            }`}
          >
            <FileText className={`w-5 h-5 ${isMine ? 'text-white' : 'text-indigo-600'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold truncate ${isMine ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
              {attachment.fileName}
            </p>
            <p className={`text-xs ${isMine ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
              {formatFileSize(attachment.size)}
              {expired ? ' • Expirado (6 meses)' : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={expired}
            onClick={() => handleDownloadAttachment(attachment)}
            className={`h-9 w-9 rounded-xl flex items-center justify-center transition ${
              expired
                ? 'opacity-40 cursor-not-allowed'
                : isMine
                  ? 'bg-white/15 hover:bg-white/25'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'
            }`}
            title={expired ? 'Anexo expirado' : 'Baixar'}
          >
            <Download className={`w-4 h-4 ${isMine ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`} />
          </button>
        </div>
      </div>
    );
  };

  const playNotificationSound = () => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {}
  };

  const membersByUserId = useMemo(() => {
    const map = new Map<string, Profile>();
    members.forEach((m) => map.set(m.user_id, m));
    return map;
  }, [members]);

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId]
  );

  const getOtherUserForRoom = (room: ChatRoom): Profile | null => {
    if (room.is_public) return null;
    const memberIds = roomMembers.get(room.id) || [];
    const otherUserId = memberIds.find(id => id !== user?.id);
    return otherUserId ? membersByUserId.get(otherUserId) || null : null;
  };

  const selectedRoomMember = useMemo(() => {
    if (!selectedRoom) return null;
    return getOtherUserForRoom(selectedRoom);
  }, [selectedRoom, roomMembers, membersByUserId, user]);

  const filteredRooms = useMemo(() => {
    let filtered = rooms;
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      filtered = filtered.filter((r) => {
        const otherUser = getOtherUserForRoom(r);
        const displayName = otherUser?.name || r.name;
        return displayName.toLowerCase().includes(term);
      });
    }
    return filtered;
  }, [rooms, searchTerm, roomMembers, membersByUserId, user]);

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

      const roomsNeedingPreview = list.filter(
        (r) => !!r.last_message_at && !(r.last_message_preview && r.last_message_preview.trim())
      );

      if (roomsNeedingPreview.length > 0) {
        const lastMessages = await Promise.all(
          roomsNeedingPreview.map(async (r) => {
            const last = await chatService.getLastMessage({ roomId: r.id });
            return { roomId: r.id, last };
          })
        );

        const lastByRoom = new Map(lastMessages.map((x) => [x.roomId, x.last] as const));

        setRooms((prev) => {
          const updated = prev.map((r) => {
            const last = lastByRoom.get(r.id);
            if (!last) return r;
            const preview = getMessagePreview(last.content ?? '');
            if (!preview) return r;
            return {
              ...r,
              last_message_at: last.created_at ?? r.last_message_at,
              last_message_preview: preview.substring(0, 50),
            };
          });

          return updated.sort((a, b) => {
            const aTime = a.last_message_at ?? a.created_at;
            const bTime = b.last_message_at ?? b.created_at;
            return bTime.localeCompare(aTime);
          });
        });
      }

      const membersMap = new Map<string, string[]>();
      for (const room of list) {
        if (!room.is_public) {
          const memberIds = await chatService.getRoomMembers(room.id);
          membersMap.set(room.id, memberIds);
        }
      }
      setRoomMembers(membersMap);

      if (!selectedRoomId) {
        const defaultRoom = list.find((r) => r.is_public && r.name === DEFAULT_ROOM_NAME) ?? list[0] ?? null;
        setSelectedRoomId(defaultRoom?.id ?? null);
      }

      const unread = await chatService.getUnreadCount(user.id);
      setUnreadCount(unread);
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

      if (user) {
        await chatService.markAsRead({ roomId, userId: user.id });
        const unread = await chatService.getUnreadCount(user.id);
        setUnreadCount(unread);
      }
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
    if (!user) return;

    const unsubscribe = chatService.subscribeToAllMessages({
      onInsert: (msg) => {
        setRooms((prev) => {
          if (!prev.some((r) => r.id === msg.room_id)) return prev;

          const updated = prev.map((r) =>
            r.id === msg.room_id
              ? {
                  ...r,
                  last_message_at: msg.created_at,
                  last_message_preview: getMessagePreview(msg.content),
                }
              : r
          );

          return updated.sort((a, b) => {
            const aTime = a.last_message_at ?? a.created_at;
            const bTime = b.last_message_at ?? b.created_at;
            return bTime.localeCompare(aTime);
          });
        });
      },
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!selectedRoomId) return;
    loadMessages(selectedRoomId);

    const unsubscribe = chatService.subscribeToRoomMessages({
      roomId: selectedRoomId,
      onInsert: (msg) => {
        const isMine = user?.id === msg.user_id;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setRooms((prev) => {
          return prev
            .map((r) => (r.id === msg.room_id ? { 
                ...r, 
                last_message_at: msg.created_at,
                last_message_preview: getMessagePreview(msg.content)
              } : r))
            .sort((a, b) => {
              const aTime = a.last_message_at ?? a.created_at;
              const bTime = b.last_message_at ?? b.created_at;
              return bTime.localeCompare(aTime);
            });
        });

        if (!isMine && user) {
          playNotificationSound();
          setUnreadCount(prev => prev + 1);

          if ('Notification' in window && Notification.permission === 'granted') {
            const author = membersByUserId.get(msg.user_id);
            const preview = getMessagePreview(msg.content);
            new Notification('Nova mensagem', {
              body: `${author?.name || 'Usuário'}: ${preview}`,
              icon: '/favicon.ico',
            });
          }
        }
        requestAnimationFrame(scrollToBottom);
      },
    });

    return () => unsubscribe();
  }, [selectedRoomId, user]);

  const myProfile = useMemo(() => membersByUserId.get(user?.id || ''), [membersByUserId, user]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel('presence');
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const presenceMap = new Map<string, 'online' | 'offline'>();
        Object.values(state).flat().forEach((p: any) => {
          if (p.user_id) {
            presenceMap.set(p.user_id, p.status || 'offline');
          }
        });
        setMembers((prev) =>
          prev.map((member) => ({
            ...member,
            presence_status: presenceMap.get(member.id) || 'offline',
          }))
        );
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: user.id,
            name: myProfile?.name || user.email || 'Usuário',
            status: 'online',
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, myProfile]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!selectedRoomId) return;

    const channel = supabase.channel(`chat_typing_${selectedRoomId}`);
    typingChannelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const typing = new Map<string, { name: string; timestamp: number }>();

        Object.entries(state).forEach(([key, presences]) => {
          presences.forEach((p: any) => {
            if (p.user_id === user?.id) return;
            if (p.typing === true) {
              typing.set(p.user_id, { name: p.name || 'Usuário', timestamp: Date.now() });
            }
          });
        });

        setTypingUsers(typing);
      })
      .on('presence', { event: 'join' }, (payload) => {
        const state = channel.presenceState();
        const typing = new Map<string, { name: string; timestamp: number }>();

        Object.entries(state).forEach(([key, presences]) => {
          presences.forEach((p: any) => {
            if (p.user_id === user?.id) return;
            if (p.typing === true) {
              typing.set(p.user_id, { name: p.name || 'Usuário', timestamp: Date.now() });
            }
          });
        });

        setTypingUsers(typing);
      })
      .on('presence', { event: 'leave' }, (payload) => {
        const state = channel.presenceState();
        const typing = new Map<string, { name: string; timestamp: number }>();

        Object.entries(state).forEach(([key, presences]) => {
          presences.forEach((p: any) => {
            if (p.user_id === user?.id) return;
            if (p.typing === true) {
              typing.set(p.user_id, { name: p.name || 'Usuário', timestamp: Date.now() });
            }
          });
        });

        setTypingUsers(typing);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: user?.id,
            name: myProfile?.name || user?.email || 'Usuário',
            typing: false,
          });
        }
      });

    return () => {
      if (typingChannelRef.current === channel) {
        typingChannelRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [selectedRoomId, user, myProfile]);

  const handleSend = async () => {
    if (!selectedRoomId || !messageText.trim() || !user) return;
    const text = messageText.trim();
    setMessageText('');

    try {
      await chatService.sendMessage({
        roomId: selectedRoomId,
        userId: user.id,
        content: text,
      });
    } catch (err: any) {
      console.error('Erro ao enviar mensagem:', err);
      alert(err?.message ?? 'Erro ao enviar mensagem');
    }
  };

  const handleTypingStart = () => {
    if (!user || !selectedRoomId) return;

    const channel = typingChannelRef.current;
    if (!channel) return;
    channel.track({
      user_id: user.id,
      name: myProfile?.name || user.email || 'Usuário',
      typing: true,
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      channel.track({
        user_id: user.id,
        name: myProfile?.name || user.email || 'Usuário',
        typing: false,
      });
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleStartDirectMessage = async (targetUserId: string) => {
    if (!user || user.id === targetUserId) return;
    try {
      const room = await chatService.createDirectMessage({
        userId1: user.id,
        userId2: targetUserId,
      });
      const memberIds = await chatService.getRoomMembers(room.id);
      setRoomMembers(prev => new Map(prev).set(room.id, memberIds));
      setRooms(prev => [room, ...prev]);
      setSelectedRoomId(room.id);
      setShowMobileChat(true);
      setShowNewChatModal(false);
    } catch (err: any) {
      console.error('Erro ao criar DM:', err);
      alert('Erro ao iniciar conversa: ' + err.message);
    }
  };

  return (
    <div className="w-full overflow-hidden text-slate-800 dark:text-slate-100 flex flex-col" style={{ height: 'calc(100dvh - 7rem)' }}>
      <main className="w-full h-full min-h-0 bg-white dark:bg-[#202c33] rounded-xl shadow-xl flex overflow-hidden border border-[#e2e8f0] dark:border-[#2a3942]">
        <aside className={`${showMobileChat ? 'hidden' : 'flex'} w-full md:w-[350px] lg:w-[400px] md:flex min-h-0 flex-col border-r border-[#e2e8f0] dark:border-[#2a3942] bg-white dark:bg-[#111b21]`}>
          <div className="px-4 py-3 flex items-center justify-between bg-white dark:bg-[#202c33] border-b border-[#e2e8f0] dark:border-[#2a3942]">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Avatar
                  src={myProfile?.avatar_url}
                  name={myProfile?.name || user?.email || 'U'}
                  size="md"
                  showStatus
                  isOnline
                  imageClassName="ring-2 ring-offset-2 ring-indigo-600 dark:ring-offset-[#111b21]"
                />
              </div>
              <div>
                <h2 className="font-bold text-lg leading-tight dark:text-gray-100">Chat</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">{rooms.length} conversas</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-2 rounded-full transition ${soundEnabled ? 'hover:bg-gray-100 dark:hover:bg-gray-700 text-indigo-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400'}`}
                title={soundEnabled ? 'Desativar som' : 'Ativar som'}
              >
                {soundEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewChatSearch('');
                  setShowNewChatModal(true);
                }}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-md transition transform active:scale-95 flex items-center justify-center w-10 h-10"
                title="Nova conversa"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-3 border-b border-[#e2e8f0] dark:border-[#2a3942] bg-white dark:bg-[#111b21]">
            <div className="relative">
              <Search className="absolute inset-y-0 left-0 ml-3 my-auto w-5 h-5 text-gray-400 pointer-events-none" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-[#202c33] border-none rounded-lg text-sm focus:ring-2 focus:ring-indigo-600 focus:bg-white dark:focus:bg-[#2a3942] transition-all placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100"
                placeholder="Buscar conversa..."
                type="text"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {loadingRooms && rooms.length === 0 && (
              <div className="p-6 text-sm text-gray-500 dark:text-gray-400 text-center">Carregando conversas...</div>
            )}
            {!loadingRooms && filteredRooms.length === 0 && (
              <div className="p-6 text-center">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma conversa encontrada</p>
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Iniciar nova conversa
                </button>
              </div>
            )}

            {filteredRooms.map((room) => {
              const isActive = room.id === selectedRoomId;
              const lastTime = room.last_message_at ? formatLastSeen(room.last_message_at) : '';
              const preview = room.last_message_preview || 'Nenhuma mensagem ainda';
              const otherUser = getOtherUserForRoom(room);
              const displayName = otherUser?.name || room.name;
              const avatarUrl = otherUser?.avatar_url;
              const isOnline = otherUser?.presence_status === 'online';
              const roomUnreadCount = (room as any).unread_count ?? 0;

              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => {
                    setSelectedRoomId(room.id);
                    setShowMobileChat(true);
                  }}
                  className={`flex items-center gap-3 p-3 cursor-pointer transition ${
                    isActive
                      ? 'bg-indigo-600/10 dark:bg-[#2a3942]/50 border-l-4 border-indigo-600'
                      : 'hover:bg-gray-50 dark:hover:bg-[#202c33] border-b border-[#e2e8f0]/50 dark:border-[#2a3942]/50 border-l-4 border-transparent'
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    {room.is_public ? (
                      <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white text-lg font-bold shadow-sm">
                        {getInitials(room.name).slice(0, 1) || 'G'}
                      </div>
                    ) : (
                      <Avatar
                        src={avatarUrl}
                        name={displayName}
                        size="lg"
                        showStatus
                        isOnline={isOnline}
                        imageClassName={`${otherUser?.presence_status === 'offline' ? 'grayscale opacity-70' : ''} object-cover`.trim()}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <h3 className="text-sm font-semibold truncate dark:text-gray-100">{displayName}</h3>
                      <span className={`text-xs ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-400'}`}>{lastTime}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {room.is_public && (
                        <span className="bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 rounded font-medium dark:bg-slate-700 dark:text-slate-300">GRUPO</span>
                      )}
                      <p className={`text-xs truncate ${isActive ? 'text-indigo-600' : 'text-gray-500 dark:text-gray-400'}`}>{preview}</p>
                    </div>
                  </div>
                  {roomUnreadCount > 0 && (
                    <div className="w-5 h-5 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {roomUnreadCount}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <section className={`${showMobileChat ? 'flex' : 'hidden'} md:flex flex-1 min-h-0 flex-col bg-[#efeae2] dark:bg-[#0b141a] relative`}>
          {selectedRoom ? (
            <>
              <header className="h-[64px] px-4 py-2 bg-white dark:bg-[#202c33] border-b border-[#e2e8f0] dark:border-[#2a3942] flex items-center justify-between z-10 shadow-sm">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowMobileChat(false)}
                    className="md:hidden p-2 -ml-2 text-gray-500 hover:text-indigo-600 transition rounded-full"
                  >
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowContactInfo(true)}
                    className="flex items-center gap-3 cursor-pointer text-left min-w-0"
                    title="Ver informações"
                  >
                  {selectedRoom.is_public ? (
                    <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                      {getInitials(selectedRoom.name).slice(0, 1) || 'G'}
                    </div>
                  ) : (
                    <Avatar
                      src={selectedRoomMember?.avatar_url}
                      name={selectedRoomMember?.name || selectedRoom.name}
                      size="md"
                      showStatus
                      isOnline={selectedRoomMember?.presence_status === 'online'}
                    />
                  )}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">{selectedRoomMember?.name || selectedRoom.name}</h2>
                      {selectedRoom.is_public && (
                        <span className="bg-slate-100 text-slate-700 text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide uppercase dark:bg-slate-700 dark:text-slate-300">Grupo</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {typingUsers.size > 0
                        ? `${Array.from(typingUsers.values()).map((t) => t.name).join(', ')} ${typingUsers.size === 1 ? 'está' : 'estão'} digitando...`
                        : selectedRoom.is_public
                          ? `${(roomMembers.get(selectedRoom.id)?.length ?? 0)} membros`
                          : selectedRoomMember?.presence_status === 'online'
                            ? selectedRoomMember?.role || ''
                            : selectedRoomMember?.last_seen_at
                              ? formatLastSeen(selectedRoomMember.last_seen_at)
                              : 'Offline'}
                    </p>
                  </div>
                </button>
              </div>
            </header>

              <div
                ref={scrollRef}
                className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8 custom-scrollbar relative"
                style={{
                  backgroundImage:
                    "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAH0lEQVQoU2NkYGAwZWBgqGcEk4xQBSBF6AAkQx9PCQBuBwT9/1cWUAAAAABJRU5ErkJggg==')",
                  backgroundRepeat: 'repeat',
                  backgroundBlendMode: 'soft-light',
                }}
              >
                <div className="absolute inset-0 bg-[#efeae2]/90 dark:bg-[#0b141a]/95 pointer-events-none"></div>

                {loadingMessages && (
                  <div className="relative z-0 text-sm text-gray-500 dark:text-gray-400 text-center">Carregando mensagens...</div>
                )}

                {!loadingMessages && selectedRoomId && messages.length === 0 && (
                  <div className="relative z-0 text-sm text-gray-500 dark:text-gray-400 text-center py-8">Nenhuma mensagem ainda</div>
                )}

                {messages.length > 0 && (
                  <div className="relative z-0 flex justify-center mb-6">
                    <span className="bg-white dark:bg-[#202c33] text-gray-500 dark:text-gray-300 text-xs py-1 px-3 rounded-lg shadow-sm border border-[#e2e8f0] dark:border-[#2a3942]">
                      Hoje
                    </span>
                  </div>
                )}

                <div className="relative z-0">
                  {messages.map((msg) => {
                    const isMine = user?.id === msg.user_id;
                    const author = membersByUserId.get(msg.user_id);
                    const authorName = author?.name || 'Usuário';
                    const attachment = parseAttachment(msg.content);

                    if (!isMine) {
                      return (
                        <div key={msg.id} className="relative z-0 flex gap-2 mb-4 group">
                          <Avatar
                            src={author?.avatar_url}
                            name={authorName}
                            size="sm"
                            className="self-end mb-1"
                            imageClassName="object-cover shadow-sm"
                          />
                          <div className="flex flex-col gap-1 max-w-[70%]">
                            <div className="bg-white dark:bg-[#202c33] p-3 rounded-2xl rounded-bl-none shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] text-sm text-gray-800 dark:text-gray-100 relative">
                              {selectedRoom.is_public && (
                                <span className="block font-bold text-xs text-indigo-600 mb-1">{authorName}</span>
                              )}
                              {attachment ? (
                                <div className="text-sm">
                                  {renderAttachment(msg, false)}
                                </div>
                              ) : (
                                <p>{msg.content}</p>
                              )}
                              <div className="flex justify-end items-center gap-1 mt-1 select-none">
                                <span className="text-[10px] text-gray-400">{formatTime(msg.created_at)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} className="relative z-0 flex flex-col items-end gap-1 mb-2">
                        {attachment ? (
                          <div className="max-w-[70%]">
                            {renderAttachment(msg, true)}
                            <div className="flex justify-end items-center gap-1 mt-1 select-none opacity-80">
                              <span className="text-[10px] text-slate-200">{formatTime(msg.created_at)}</span>
                              <CheckCheck className="w-3 h-3 text-slate-200" />
                            </div>
                          </div>
                        ) : (
                          <div className="bg-indigo-600 dark:bg-indigo-700 p-3 rounded-2xl rounded-br-none shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] text-sm text-white max-w-[70%]">
                            <p>{msg.content}</p>
                            <div className="flex justify-end items-center gap-1 mt-1 select-none opacity-80">
                              <span className="text-[10px]">{formatTime(msg.created_at)}</span>
                              <CheckCheck className="w-3 h-3" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                </div>
              </div>

              <footer className="p-2 md:p-3 bg-white dark:bg-[#202c33] border-t border-[#e2e8f0] dark:border-[#2a3942] z-10">
                <div className="relative flex items-center gap-1.5 md:gap-2 w-full min-w-0 md:max-w-4xl md:mx-auto">
                  {showEmojiPicker && (
                    <div className="absolute bottom-14 left-0 z-20 w-[280px] rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-3">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Emojis</p>
                      <div className="grid grid-cols-8 gap-1">
                        {['😀','😄','😁','😂','🤣','😊','😍','😘','😎','🤔','😅','😭','😡','👍','👎','🙏','👏','💪','🔥','🎉','✅','❌','⚠️','📌','📎','📞','💬','❤️','🧠','📄','🗂️','🕒'].map((e) => (
                          <button
                            key={e}
                            type="button"
                            className="h-8 w-8 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition text-lg"
                            onClick={() => handlePickEmoji(e)}
                            aria-label={`Emoji ${e}`}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker((v) => !v)}
                    className="p-2 md:p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
                    title="Emoji"
                  >
                    <Smile className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleAttachClick}
                    disabled={!selectedRoomId || uploadingAttachment}
                    className="p-2 md:p-2 text-gray-500 hover:text-indigo-600 disabled:text-gray-300 disabled:hover:text-gray-300 dark:text-gray-400 dark:hover:text-indigo-400 transition rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
                    title="Anexar"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      handleUploadAttachment(file);
                    }}
                  />
                  <div className="flex-1 relative min-w-0">
                    <input
                      ref={messageInputRef}
                      type="text"
                      value={messageText}
                      onChange={(e) => {
                        setMessageText(e.target.value);
                        handleTypingStart();
                      }}
                      placeholder={selectedRoomId ? 'Digite uma mensagem...' : 'Selecione uma conversa...'}
                      disabled={!selectedRoomId || isRecording}
                      className="w-full py-2.5 md:py-3 px-3 md:px-4 bg-gray-100 dark:bg-[#2a3942] border-none rounded-xl md:rounded-2xl text-sm focus:ring-1 focus:ring-indigo-600 outline-none transition placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100 shadow-inner"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                    />
                  </div>
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={handleToggleRecording}
                      className="p-2.5 md:p-3 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-md transition transform active:scale-95 flex items-center justify-center animate-pulse shrink-0"
                      title="Parar gravação"
                    >
                      <Square className="w-5 h-5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleToggleRecording}
                      disabled={!selectedRoomId}
                      className="p-2.5 md:p-3 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white rounded-full shadow-md transition transform active:scale-95 flex items-center justify-center shrink-0"
                      title="Gravar áudio"
                    >
                      <Mic className="w-5 h-5" />
                    </button>
                  )}
                  {isRecording && (
                    <span className="text-xs font-mono text-red-500 font-bold animate-pulse">
                      {formatRecordingTime(recordingTime)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!selectedRoomId || !messageText.trim() || isRecording}
                    className="p-2.5 md:p-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-full shadow-md transition transform active:scale-95 flex items-center justify-center shrink-0"
                    title="Enviar"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
              Selecione uma conversa
            </div>
          )}
        </section>
      </main>

      {/* Modal de Nova Conversa */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              setShowNewChatModal(false);
              setNewChatSearch('');
            }}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-indigo-600" />

            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    Chat
                  </p>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Nova Conversa</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Selecione um contato</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowNewChatModal(false);
                  setNewChatSearch('');
                }}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 sm:px-8 py-4 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={newChatSearch}
                  onChange={(e) => setNewChatSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
                  placeholder="Buscar por nome..."
                  autoFocus
                />
              </div>
            </div>

            {/* Users List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 bg-white dark:bg-zinc-900">
              {membersLoading ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-3">
                  <div className="w-12 h-12 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">Carregando contatos...</p>
                </div>
              ) : (
                <>
                  {members
                    .filter((m) => m.user_id !== user?.id)
                    .filter((m) => !newChatSearch || m.name.toLowerCase().includes(newChatSearch.toLowerCase()))
                    .length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 space-y-3">
                      <div className="w-16 h-16 bg-slate-100 dark:bg-zinc-800 rounded-full flex items-center justify-center">
                        <Search className="w-8 h-8 text-slate-400" />
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum contato encontrado</p>
                    </div>
                  ) : (
                    members
                      .filter((m) => m.user_id !== user?.id)
                      .filter((m) => !newChatSearch || m.name.toLowerCase().includes(newChatSearch.toLowerCase()))
                      .map((member) => (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => handleStartDirectMessage(member.user_id)}
                          className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/10 transition-all duration-200 group active:scale-[0.98]"
                        >
                          <div className="relative">
                            <Avatar
                              src={member.avatar_url}
                              name={member.name}
                              size="md"
                              showStatus
                              isOnline={member.presence_status === 'online'}
                              imageClassName="group-hover:scale-105 transition-transform"
                            />
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 transition-colors">
                              {member.name}
                            </p>
                            {member.role && (
                              <span className="inline-block bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 rounded font-medium dark:bg-slate-700 dark:text-slate-300 mt-1">
                                {member.role}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {member.presence_status === 'online' && (
                              <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                Online
                              </span>
                            )}
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-zinc-800 group-hover:bg-indigo-600 flex items-center justify-center transition-all">
                              <MessageCircle className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
                            </div>
                          </div>
                        </button>
                      ))
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-8 py-4 bg-slate-50 dark:bg-zinc-900 border-t border-slate-200 dark:border-zinc-800">
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
                {members.filter(m => m.user_id !== user?.id).length} contatos disponíveis
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Drawer - Informações do Contato */}
      {showContactInfo && selectedRoomMember && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowContactInfo(false)}
            aria-label="Fechar"
          />
                <aside className="absolute right-0 top-0 h-full w-full md:w-[420px] bg-white dark:bg-[#202c33] border-l border-[#e2e8f0] dark:border-[#2a3942] shadow-2xl">
            <div className="p-5 border-b border-[#e2e8f0] dark:border-[#2a3942] flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Informações</h3>
              <button
                type="button"
                onClick={() => setShowContactInfo(false)}
                className="h-10 w-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition shadow-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar h-[calc(100%-72px)]">
              <div className="flex items-center gap-4 mb-6">
                <Avatar
                  src={selectedRoomMember.avatar_url}
                  name={selectedRoomMember.name}
                  size="xl"
                  showStatus
                  isOnline={selectedRoomMember.presence_status === 'online'}
                />
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">{selectedRoomMember.name}</p>
                  {selectedRoomMember.role && (
                    <span className="inline-block bg-indigo-100 text-indigo-700 text-[11px] px-2 py-0.5 rounded font-semibold dark:bg-indigo-900/30 dark:text-indigo-300 mt-1">
                      {selectedRoomMember.role}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-[#e2e8f0] dark:border-[#2a3942] p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Contato</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-slate-600 dark:text-slate-300">Telefone</span>
                      <span className="text-sm text-slate-900 dark:text-slate-100 truncate">{selectedRoomMember.phone || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-slate-600 dark:text-slate-300">Status</span>
                      <span className={`text-sm font-medium ${selectedRoomMember.presence_status === 'online' ? 'text-green-600' : 'text-slate-500 dark:text-slate-400'}`}>
                        {selectedRoomMember.presence_status === 'online' ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedRoomMember.bio && (
                  <div className="rounded-xl border border-[#e2e8f0] dark:border-[#2a3942] p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Sobre</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{selectedRoomMember.bio}</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default ChatModule;
