import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BadgeCheck, ExternalLink, FileText, Maximize2, MessageCircle, Mic, Paperclip, Send, Smile, Square, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { chatService } from '../services/chat.service';
import { profileService, type Profile } from '../services/profile.service';
import type { ChatMessage, ChatRoom } from '../types/chat.types';
import { supabase } from '../config/supabase';
import { events, SYSTEM_EVENTS } from '../utils/events';

const WIDGET_OPEN_KEY = 'chat-floating-widget-open';

const WIDGET_NOTIFY_COUNT_KEY = 'chat-floating-widget-notify-count';
const WIDGET_ROOM_UNREAD_KEY = 'chat-floating-widget-room-unread';
const WIDGET_LAST_IMAGE_SENDER_KEY = 'chat-floating-widget-last-image-sender';

const PETITION_EDITOR_WIDGET_STATE_KEY = 'petition-editor-widget-state';
const PETITION_EDITOR_WIDGET_STATE_EVENT = 'crm:petition_editor_widget_state';

const ATTACHMENT_PREFIX = '__anexo__:';
const ATTACHMENT_BUCKET = 'anexos_chat';

type ChatAttachmentPayload = {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
};

const AttachmentSignedLink: React.FC<{ attachment: ChatAttachmentPayload; onResolved?: () => void }> = ({
  attachment,
  onResolved,
}) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

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
        onResolved?.();
      });

    return () => {
      active = false;
    };
  }, [attachment.filePath, onResolved]);

  if (!signedUrl) {
    return <div className="mt-2 text-xs text-white/60">Carregando...</div>;
  }

  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-indigo-200 transition"
      title="Abrir anexo"
    >
      <span>Abrir</span>
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
};

type VerifiedVariant = 'admin' | 'lawyer';

const getVerifiedVariant = (profile: Pick<Profile, 'role' | 'oab'> | null | undefined): VerifiedVariant | null => {
  if (!profile) return null;
  const role = String(profile.role || '').toLowerCase();
  const oab = (profile.oab ?? '').trim();

  if (role.includes('admin') || role.includes('administrador')) return 'admin';
  if (role.includes('advog') || role.includes('advogado') || !!oab) return 'lawyer';
  return null;
};

const VerifiedBadge: React.FC<{ variant: VerifiedVariant }> = ({ variant }) => {
  const isAdmin = variant === 'admin';
  const title = isAdmin ? 'Administrador verificado' : 'Advogado verificado';
  const cls = isAdmin
    ? 'bg-amber-400 text-amber-950 ring-1 ring-amber-200/40'
    : 'bg-sky-500 text-white ring-1 ring-sky-300/40';

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center h-[18px] w-[18px] rounded-full ${cls} shrink-0`}
      aria-label={title}
    >
      <BadgeCheck className="w-3.5 h-3.5" />
    </span>
  );
};

const parseAttachment = (content: string | null | undefined): ChatAttachmentPayload | null => {
  const raw = (content ?? '').trim();
  if (!raw.startsWith(ATTACHMENT_PREFIX)) return null;

  try {
    const payload = JSON.parse(raw.slice(ATTACHMENT_PREFIX.length));
    if (!payload?.filePath || !payload?.mimeType) return null;
    return payload as ChatAttachmentPayload;
  } catch {
    return null;
  }
};

const AttachmentSignedMedia: React.FC<{
  attachment: ChatAttachmentPayload;
  kind: 'audio' | 'image';
  onMediaLoaded?: () => void;
}> = ({ attachment, kind, onMediaLoaded }) => {
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
    return <div className="mt-2 text-xs text-white/60">Carregando...</div>;
  }

  if (kind === 'image') {
    return (
      <>
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="mt-2 rounded-xl overflow-hidden bg-white/5 border border-white/10 w-full text-left"
          title="Ampliar imagem"
        >
          <img
            src={signedUrl}
            alt={attachment.fileName}
            className="w-full max-h-64 object-contain"
            loading="lazy"
            onLoad={() => {
              onMediaLoaded?.();
            }}
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
    <div className="mt-2">
      <audio
        src={signedUrl}
        controls
        className="w-full h-10 rounded-lg"
        preload="metadata"
        onLoadedMetadata={() => {
          onMediaLoaded?.();
        }}
      />
    </div>
  );
};

const MessageBody: React.FC<{ message: ChatMessage; onMediaLoaded?: () => void }> = ({ message, onMediaLoaded }) => {
  const attachment = parseAttachment(message.content);
  if (!attachment) {
    return <div className="break-words whitespace-pre-wrap">{message.content}</div>;
  }

  const isAudio = attachment.mimeType.startsWith('audio/');
  const isImage = attachment.mimeType.startsWith('image/');

  if (!isAudio && !isImage) {
    return (
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">📎 {attachment.fileName}</div>
        <AttachmentSignedLink attachment={attachment} onResolved={onMediaLoaded} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="text-sm font-semibold truncate">{attachment.fileName}</div>
      <AttachmentSignedMedia attachment={attachment} kind={isImage ? 'image' : 'audio'} onMediaLoaded={onMediaLoaded} />
    </div>
  );
};

const getPreview = (content: string | null | undefined) => {
  const raw = (content ?? '').trim();
  if (!raw) return 'Nenhuma mensagem ainda';
  if (raw.startsWith(ATTACHMENT_PREFIX)) {
    try {
      const payload = JSON.parse(raw.slice(ATTACHMENT_PREFIX.length));
      const mime = String(payload?.mimeType || '');
      if (mime.startsWith('image/')) return '🖼️ Imagem';
      if (mime.startsWith('audio/')) return '🎤 Áudio';
      return '📎 Anexo';
    } catch {
      return '📎 Anexo';
    }
  }
  return raw.substring(0, 50);
};

const formatLastSeen = (value: string) => {
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Online';
  if (diffMins < 60) return `Online há ${diffMins} min`;
  if (diffHours < 24) return `Online há ${diffHours}h`;
  if (diffDays === 1) return 'Online ontem';
  if (diffDays < 7) return `Online há ${diffDays} dias`;
  return `Online em ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
};

const Avatar: React.FC<{ src?: string | null; name: string; online?: boolean }> = ({ src, name, online }) => {
  const initials = useMemo(() => {
    if (!name) return '?';
    return name
      .split(' ')
      .filter((n) => n.length > 0)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, [name]);

  return (
    <div className="relative shrink-0">
      {src ? (
        <img src={src} alt={name} className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-600 to-slate-700 flex items-center justify-center text-white text-xs font-bold">
          {initials}
        </div>
      )}
      {typeof online === 'boolean' && (
        <span
          className={`absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-[#111827] ${online ? 'bg-green-500' : 'bg-slate-500'}`}
        />
      )}
    </div>
  );
};

const ChatFloatingWidget: React.FC = () => {
  const { user } = useAuth();
  const { currentModule, navigateTo } = useNavigation();

  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifyCount, setNotifyCount] = useState(0);
  const [roomUnreadCounts, setRoomUnreadCounts] = useState<Map<string, number>>(new Map());
  const [lastUnreadImageSender, setLastUnreadImageSender] = useState<{ name: string; avatarUrl?: string | null } | null>(
    null
  );

  const [toast, setToast] = useState<{
    id: string;
    roomId: string;
    senderUserId: string;
    senderName: string;
    avatarUrl?: string | null;
    senderRole?: string;
    senderOab?: string | null;
    preview: string;
  } | null>(null);

  const [petitionEditorMinimized, setPetitionEditorMinimized] = useState(false);
  const [petitionEditorHasUnsavedChanges, setPetitionEditorHasUnsavedChanges] = useState(false);

  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(() => new Set());

  const [members, setMembers] = useState<Profile[]>([]);
  const [roomMembers, setRoomMembers] = useState<Map<string, string[]>>(new Map());

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const openRef = useRef(open);
  const selectedRoomIdRef = useRef<string | null>(selectedRoomId);

  const audioContextRef = useRef<AudioContext | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const membersByUserIdRef = useRef<Map<string, Profile>>(new Map());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, []);

  const handleMediaLoaded = useCallback(() => {
    if (!pinnedToBottomRef.current) return;
    scrollToBottom('auto');
  }, [scrollToBottom]);

  const formatRecordingTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, []);

  const insertTextAtCursor = useCallback((text: string) => {
    const el = messageInputRef.current;
    if (!el) {
      setMessageText((prev) => prev + text);
      return;
    }
    const start = el.selectionStart ?? messageText.length;
    const end = el.selectionEnd ?? messageText.length;
    const nextValue = messageText.slice(0, start) + text + messageText.slice(end);
    setMessageText(nextValue);
    requestAnimationFrame(() => {
      el.focus();
      const nextPos = start + text.length;
      el.setSelectionRange(nextPos, nextPos);
    });
  }, [messageText]);

  const handlePickEmoji = useCallback((emoji: string) => {
    insertTextAtCursor(emoji);
    setShowEmojiPicker(false);
  }, [insertTextAtCursor]);

  const handleAttachClick = useCallback(() => {
    if (!selectedRoomId || uploadingAttachment) return;
    fileInputRef.current?.click();
  }, [selectedRoomId, uploadingAttachment]);

  const handleUploadAttachment = useCallback(async (file: File) => {
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
  }, [user, selectedRoomId]);

  const handleStartRecording = useCallback(async () => {
    try {
      if (!selectedRoomId || uploadingAttachment) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
          await handleUploadAttachment(file);
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      if (recordingIntervalRef.current) {
        window.clearInterval(recordingIntervalRef.current);
      }
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch {
      setIsRecording(false);
      setRecordingTime(0);
    }
  }, [selectedRoomId, uploadingAttachment, handleUploadAttachment]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isRecording, handleStartRecording, handleStopRecording]);

  const ensureAudioContext = useCallback(async () => {
    try {
      if (!audioContextRef.current) {
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
        if (!Ctx) return;
        audioContextRef.current = new Ctx();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      void ensureAudioContext();
    };
    window.addEventListener('pointerdown', handler, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handler);
    };
  }, [ensureAudioContext]);

  const playNotificationSound = useCallback(async () => {
    await ensureAudioContext();
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch {
      // ignore
    }
  }, [ensureAudioContext]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WIDGET_OPEN_KEY);
      setOpen(saved === '1');
    } catch {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    try {
      const rawNotify = localStorage.getItem(WIDGET_NOTIFY_COUNT_KEY);
      const rawRoom = localStorage.getItem(WIDGET_ROOM_UNREAD_KEY);
      const rawLastImage = localStorage.getItem(WIDGET_LAST_IMAGE_SENDER_KEY);

      if (rawNotify) {
        const parsed = Number(rawNotify);
        if (!Number.isNaN(parsed) && parsed > 0) {
          setNotifyCount(parsed);
        }
      }

      if (rawRoom) {
        const obj = JSON.parse(rawRoom) as Record<string, number>;
        const next = new Map<string, number>();
        Object.entries(obj || {}).forEach(([roomId, count]) => {
          const n = Number(count);
          if (!Number.isNaN(n) && n > 0) {
            next.set(String(roomId), n);
          }
        });
        if (next.size > 0) {
          setRoomUnreadCounts(next);
        }
      }

      if (rawLastImage) {
        const parsed = JSON.parse(rawLastImage) as { name?: string; avatarUrl?: string | null };
        if (parsed?.name) {
          setLastUnreadImageSender({ name: String(parsed.name), avatarUrl: parsed.avatarUrl ?? null });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    openRef.current = open;
    try {
      localStorage.setItem(WIDGET_OPEN_KEY, open ? '1' : '0');
    } catch {
      // ignore
    }
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDGET_NOTIFY_COUNT_KEY, String(notifyCount || 0));
    } catch {
      // ignore
    }
  }, [notifyCount]);

  useEffect(() => {
    try {
      const obj: Record<string, number> = {};
      roomUnreadCounts.forEach((count, roomId) => {
        const n = Number(count);
        if (!Number.isNaN(n) && n > 0) {
          obj[String(roomId)] = n;
        }
      });
      localStorage.setItem(WIDGET_ROOM_UNREAD_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }, [roomUnreadCounts]);

  useEffect(() => {
    try {
      if (!lastUnreadImageSender) {
        localStorage.removeItem(WIDGET_LAST_IMAGE_SENDER_KEY);
      } else {
        localStorage.setItem(WIDGET_LAST_IMAGE_SENDER_KEY, JSON.stringify(lastUnreadImageSender));
      }
    } catch {
      // ignore
    }
  }, [lastUnreadImageSender]);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

  useEffect(() => {
    const map = new Map<string, Profile>();
    members.forEach((m) => map.set(m.user_id, m));
    membersByUserIdRef.current = map;
  }, [members]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel('presence_widget');
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const set = new Set<string>();
        Object.values(state)
          .flat()
          .forEach((p: any) => {
            if (p?.user_id) set.add(String(p.user_id));
          });
        setOnlineUserIds(set);
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        const me = membersByUserIdRef.current.get(user.id);
        await channel.track({
          user_id: user.id,
          name: me?.name || user.email || 'Usuário',
          status: 'online',
        });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const membersByUserId = useMemo(() => {
    const map = new Map<string, Profile>();
    members.forEach((m) => map.set(m.user_id, m));
    return map;
  }, [members]);

  const getOtherUserForRoom = useCallback(
    (room: ChatRoom): Profile | null => {
      if (room.is_public) return null;
      const memberIds = roomMembers.get(room.id) || [];
      const otherUserId = memberIds.find((id) => id !== user?.id);
      return otherUserId ? membersByUserId.get(otherUserId) || null : null;
    },
    [membersByUserId, roomMembers, user]
  );

  const loadRooms = useCallback(async () => {
    if (!user) return;
    setLoadingRooms(true);
    try {
      const list = await chatService.listRooms(user.id);
      setRooms(list);

      const membersMap = new Map<string, string[]>();
      for (const room of list) {
        if (!room.is_public) {
          const memberIds = await chatService.getRoomMembers(room.id);
          membersMap.set(room.id, memberIds);
        }
      }
      setRoomMembers(membersMap);
    } finally {
      setLoadingRooms(false);
    }
  }, [user]);

  const loadUnread = useCallback(async () => {
    if (!user) return;
    const count = await chatService.getUnreadCount(user.id);
    setUnreadCount(count);
  }, [user]);

  const loadRoomUnreadCounts = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('chat_room_members')
      .select('room_id, unread_count')
      .eq('user_id', user.id);

    if (error) {
      return;
    }

    const dbMap = new Map<string, number>();
    (data ?? []).forEach((row: any) => {
      dbMap.set(String(row.room_id), Number(row.unread_count ?? 0));
    });

    setRoomUnreadCounts((prev) => {
      const next = new Map(prev);
      dbMap.forEach((count, roomId) => {
        next.set(roomId, Math.max(next.get(roomId) ?? 0, count));
      });
      return next;
    });
  }, [user]);

  const loadMembers = useCallback(async () => {
    try {
      const list = await profileService.listMembers();
      setMembers(list);
    } catch {
      setMembers([]);
    }
  }, []);

  const loadMessages = useCallback(async (roomId: string) => {
    if (!user) return;
    setLoadingMessages(true);
    try {
      const list = await chatService.listMessages({ roomId });
      setMessages(list);
      pinnedToBottomRef.current = true;
      scrollToBottom('auto');
    } finally {
      setLoadingMessages(false);
    }
  }, [user, scrollToBottom]);

  const handleSendMessage = useCallback(async () => {
    if (!user || !selectedRoomId || !messageText.trim() || sendingMessage) return;
    setSendingMessage(true);
    try {
      await chatService.sendMessage({ roomId: selectedRoomId, userId: user.id, content: messageText.trim() });
      setMessageText('');
      pinnedToBottomRef.current = true;
      scrollToBottom('smooth');
      requestAnimationFrame(() => {
        messageInputRef.current?.focus();
      });
    } finally {
      setSendingMessage(false);
    }
  }, [user, selectedRoomId, messageText, sendingMessage, scrollToBottom]);

  const markRoomAsRead = useCallback(
    async (roomId: string) => {
      if (!user) return;
      try {
        await chatService.markAsRead({ roomId, userId: user.id });
      } catch {
        // ignore
      } finally {
        setRoomUnreadCounts((prev) => {
          const next = new Map(prev);
          next.set(roomId, 0);
          return next;
        });
        loadUnread();
      }
    },
    [user, loadUnread]
  );

  useEffect(() => {
    if (!user) return;
    loadMembers();
    loadRooms();
    loadUnread();
    loadRoomUnreadCounts();
  }, [user, loadMembers, loadRooms, loadUnread, loadRoomUnreadCounts]);

  useEffect(() => {
    if (!selectedRoomId) {
      setMessages([]);
      return;
    }
    loadMessages(selectedRoomId);
    markRoomAsRead(selectedRoomId);

    const unsubscribe = chatService.subscribeToRoomMessages({
      roomId: selectedRoomId,
      onInsert: (msg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        if (msg.user_id !== user?.id) {
          markRoomAsRead(selectedRoomId);
        }

        if (pinnedToBottomRef.current || msg.user_id === user?.id) {
          pinnedToBottomRef.current = true;
          scrollToBottom('smooth');
        }
      },
    });

    return () => unsubscribe();
  }, [selectedRoomId, loadMessages, scrollToBottom, user?.id, markRoomAsRead]);

  useEffect(() => {
    if (!selectedRoomId) return;
    if (!pinnedToBottomRef.current) return;
    scrollToBottom('auto');
  }, [selectedRoomId, messages.length, scrollToBottom]);

  useEffect(() => {
    if (!user) return;

    const myUserId = user.id;
    const unsubscribe = chatService.subscribeToAllMessages({
      onInsert: (msg) => {
        const isMine = msg.user_id === myUserId;
        if (!isMine) {
          loadUnread();

          const isWidgetOpen = openRef.current;
          const currentRoom = selectedRoomIdRef.current;
          const inCurrentOpenRoom = isWidgetOpen && !!currentRoom && msg.room_id === currentRoom;
          if (!inCurrentOpenRoom) {
            setNotifyCount((prev) => prev + 1);

            setRoomUnreadCounts((prev) => {
              const next = new Map(prev);
              next.set(msg.room_id, (next.get(msg.room_id) ?? 0) + 1);
              return next;
            });

            const profile = membersByUserIdRef.current.get(msg.user_id);
            const senderName = profile?.name || 'Nova mensagem';
            const avatarUrl = profile?.avatar_url;
            const preview = getPreview(msg.content);
            const attachment = parseAttachment(msg.content);
            const isImageAttachment = !!attachment && String(attachment.mimeType || '').startsWith('image/');

            if (isImageAttachment) {
              setLastUnreadImageSender({ name: senderName, avatarUrl });
            }
            setToast({
              id: msg.id,
              roomId: msg.room_id,
              senderUserId: msg.user_id,
              senderName,
              avatarUrl,
              senderRole: profile?.role,
              senderOab: profile?.oab,
              preview,
            });

            if (!profile) {
              void profileService.getProfile(msg.user_id).then((p) => {
                if (!p) return;
                membersByUserIdRef.current.set(msg.user_id, p);
                setToast((prev) => {
                  if (!prev || prev.id !== msg.id) return prev;
                  return {
                    ...prev,
                    senderName: p.name || prev.senderName,
                    avatarUrl: p.avatar_url,
                    senderRole: p.role,
                    senderOab: p.oab,
                  };
                });

                if (isImageAttachment) {
                  setLastUnreadImageSender({ name: p.name || senderName, avatarUrl: p.avatar_url });
                }
              });
            }

            void playNotificationSound();

            if (toastTimerRef.current) {
              window.clearTimeout(toastTimerRef.current);
            }
            toastTimerRef.current = window.setTimeout(() => {
              setToast(null);
            }, 4500);
          }
        }

        setRooms((prev) => {
          const exists = prev.some((r) => r.id === msg.room_id);
          if (!exists) {
            loadRooms();
            return prev;
          }

          const updated = prev
            .map((r) =>
              r.id === msg.room_id
                ? {
                    ...r,
                    last_message_at: msg.created_at,
                    last_message_preview: getPreview(msg.content),
                  }
                : r
            )
            .sort((a, b) => {
              const aTime = a.last_message_at ?? a.created_at;
              const bTime = b.last_message_at ?? b.created_at;
              return bTime.localeCompare(aTime);
            });

          return updated;
        });
      },
    });

    return () => unsubscribe();
  }, [user, loadRooms, loadUnread, playNotificationSound]);

  useEffect(() => {
    const readEditorState = () => {
      try {
        const raw = localStorage.getItem(PETITION_EDITOR_WIDGET_STATE_KEY);
        if (!raw) {
          setPetitionEditorMinimized(false);
          setPetitionEditorHasUnsavedChanges(false);
          return;
        }
        const parsed = JSON.parse(raw);
        const nextState = String(parsed?.state ?? 'closed');
        setPetitionEditorMinimized(nextState === 'minimized');
      } catch {
        setPetitionEditorMinimized(false);
        setPetitionEditorHasUnsavedChanges(false);
      }
    };

    readEditorState();

    const onState = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      const nextState = String(detail?.state ?? 'closed');
      setPetitionEditorMinimized(nextState === 'minimized');
      setPetitionEditorHasUnsavedChanges(!!detail?.hasUnsavedChanges);
    };

    window.addEventListener(PETITION_EDITOR_WIDGET_STATE_EVENT, onState as EventListener);
    return () => {
      window.removeEventListener(PETITION_EDITOR_WIDGET_STATE_EVENT, onState as EventListener);
    };
  }, []);

  const visible = !!user && currentModule !== 'chat';
  if (!visible) return null;

  const selectedRoom = selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) : null;
  const otherUser = selectedRoom ? getOtherUserForRoom(selectedRoom) : null;
  const displayName = otherUser?.name || selectedRoom?.name || '';
  const avatarUrl = otherUser?.avatar_url;
  const headerOnline = otherUser ? onlineUserIds.has(otherUser.user_id) : false;
  const totalUnreadFromRooms = useMemo(() => {
    let total = 0;
    roomUnreadCounts.forEach((v) => {
      total += Number(v || 0);
    });
    return total;
  }, [roomUnreadCounts]);

  const badgeCount = Math.max(totalUnreadFromRooms, notifyCount);
  const showToast = !!toast && (!open || !selectedRoomId || toast.roomId !== selectedRoomId);
  const headerVerified = getVerifiedVariant(otherUser);
  const toastVerified = useMemo(() => {
    if (!toast) return null;
    return getVerifiedVariant({ role: toast.senderRole || '', oab: toast.senderOab ?? null });
  }, [toast]);

  return createPortal(
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col items-end" style={{ isolation: 'isolate' }}>
      {open && (
        <div className="mb-3 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl bg-[#111827]/95 text-white shadow-[0_30px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/10 overflow-hidden flex flex-col h-[460px] max-h-[calc(100vh-120px)]">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {selectedRoomId ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedRoomId(null)}
                    className="h-8 w-8 rounded-lg hover:bg-white/10 transition flex items-center justify-center shrink-0"
                    title="Voltar"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  {displayName && (
                    <Avatar
                      src={avatarUrl}
                      name={displayName}
                      online={selectedRoom?.is_public ? undefined : headerOnline}
                    />
                  )}
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="text-sm font-bold truncate max-w-[180px]">{displayName}</span>
                    {headerVerified && <VerifiedBadge variant={headerVerified} />}
                  </div>
                </>
              ) : (
                <>
                  <span className="text-sm font-bold truncate">Mensagens</span>
                  {badgeCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold">
                      {badgeCount}
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSelectedRoomId(null);
                }}
                className="h-8 w-8 rounded-lg hover:bg-white/10 transition flex items-center justify-center"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (selectedRoomId) {
                    navigateTo('chat', { roomId: selectedRoomId } as any);
                  } else {
                    navigateTo('chat');
                  }
                }}
                className="h-8 w-8 rounded-lg hover:bg-white/10 transition flex items-center justify-center"
                title="Abrir Chat"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!selectedRoomId ? (
            <div className="flex-1 overflow-y-auto">
              {loadingRooms && rooms.length === 0 ? (
                <div className="p-4 text-sm text-white/70">Carregando...</div>
              ) : rooms.length === 0 ? (
                <div className="p-4 text-sm text-white/70">Nenhuma conversa</div>
              ) : (
                rooms.map((room) => {
                  const otherUser = getOtherUserForRoom(room);
                  const displayName = otherUser?.name || room.name;
                  const avatarUrl = otherUser?.avatar_url;
                  const online = otherUser ? onlineUserIds.has(otherUser.user_id) : false;
                  const verified = getVerifiedVariant(otherUser);
                  const roomUnread = roomUnreadCounts.get(room.id) ?? 0;
                  const subtitle = room.is_public
                    ? `${room.type === 'team' ? 'Grupo' : 'Sala'}`
                    : online
                      ? 'Online'
                      : otherUser?.last_seen_at
                        ? formatLastSeen(otherUser.last_seen_at)
                        : 'Offline';

                  const preview = getPreview((room as any).last_message_preview);

                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => {
                        setToast(null);
                        setSelectedRoomId(room.id);
                        setRoomUnreadCounts((prev) => {
                          const next = new Map(prev);
                          next.set(room.id, 0);
                          return next;
                        });
                      }}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/5 transition"
                    >
                      <Avatar src={avatarUrl} name={displayName} online={room.is_public ? undefined : online} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <div className="text-sm font-semibold truncate">{displayName}</div>
                            {verified && <VerifiedBadge variant={verified} />}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {roomUnread > 0 && (
                              <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                                {roomUnread > 99 ? '99+' : roomUnread}
                              </span>
                            )}
                            <div className="text-[11px] text-white/50">
                              {room.last_message_at ? new Date(room.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-white/60 truncate">{subtitle}</div>
                        <div className="text-xs text-white/70 truncate mt-0.5">{preview}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div
                ref={messagesContainerRef}
                onScroll={() => {
                  const el = messagesContainerRef.current;
                  if (!el) return;
                  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
                  pinnedToBottomRef.current = distance < 80;
                }}
                className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-h-[200px]"
              >
                {loadingMessages ? (
                  <div className="text-sm text-white/70">Carregando mensagens...</div>
                ) : messages.length === 0 ? (
                  <div className="text-sm text-white/70">Nenhuma mensagem ainda</div>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.user_id === user?.id;
                    const sender = members.find((m) => m.user_id === msg.user_id);
                    const senderName = isMine ? 'Você' : sender?.name || 'Usuário';

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col min-w-0 ${isMine ? 'items-end' : 'items-start'}`}
                      >
                        <div className="text-[10px] text-white/40 mb-1">{senderName}</div>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                            isMine
                              ? 'bg-indigo-600 text-white rounded-br-md'
                              : 'bg-white/10 text-white rounded-bl-md'
                          } overflow-hidden`}
                        >
                          <MessageBody message={msg} onMediaLoaded={handleMediaLoaded} />
                        </div>
                        <div className="text-[10px] text-white/30 mt-1">
                          {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-3 border-t border-white/10 shrink-0">
                <div className="relative flex items-center gap-2">
                  {showEmojiPicker && (
                    <div className="absolute bottom-14 left-0 z-20 w-[280px] rounded-2xl border border-white/10 bg-[#0b1220]/95 shadow-xl p-3">
                      <div className="grid grid-cols-8 gap-1">
                        {['😀','😄','😁','😂','🤣','😊','😍','😘','😎','🤔','😅','😭','😡','👍','👎','🙏','👏','💪','🔥','🎉','✅','❌','⚠️','📌','📎','📞','💬','❤️','🧠','📄','🗂️','🕒'].map((e) => (
                          <button
                            key={e}
                            type="button"
                            className="h-8 w-8 rounded-lg hover:bg-white/10 transition text-lg"
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
                    disabled={!selectedRoomId || isRecording}
                    className="h-9 w-9 rounded-xl hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center shrink-0"
                    title="Emoji"
                  >
                    <Smile className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleAttachClick}
                    disabled={!selectedRoomId || uploadingAttachment || isRecording}
                    className="h-9 w-9 rounded-xl hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center shrink-0"
                    title="Anexar"
                  >
                    <Paperclip className="w-4 h-4" />
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

                  <input
                    ref={messageInputRef}
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!isRecording) handleSendMessage();
                      }
                    }}
                    placeholder="Digite uma mensagem..."
                    className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-indigo-500/50"
                    disabled={sendingMessage || uploadingAttachment || isRecording}
                  />

                  <button
                    type="button"
                    onClick={handleToggleRecording}
                    disabled={!selectedRoomId || uploadingAttachment}
                    className={`h-9 w-9 rounded-xl transition flex items-center justify-center shrink-0 ${
                      isRecording ? 'bg-red-600 hover:bg-red-500' : 'hover:bg-white/10'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    title={isRecording ? 'Parar' : 'Gravar áudio'}
                  >
                    {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  {isRecording && (
                    <span className="text-xs font-mono text-red-400 font-bold shrink-0">
                      {formatRecordingTime(recordingTime)}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={handleSendMessage}
                    disabled={!selectedRoomId || !messageText.trim() || sendingMessage || uploadingAttachment || isRecording}
                    className="h-9 w-9 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center shrink-0"
                    title="Enviar"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showToast && (
        <button
          type="button"
          onClick={async () => {
            setToast(null);
            setNotifyCount(0);
            await ensureAudioContext();
            setOpen(true);
            setSelectedRoomId(toast!.roomId);
          }}
          className="mb-3 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl bg-[#0b1220]/95 text-white shadow-[0_25px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/10 overflow-hidden"
        >
          <div className="px-4 py-3 flex items-center gap-3">
            <Avatar src={toast!.avatarUrl} name={toast!.senderName} />
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="text-sm font-semibold truncate">{toast!.senderName}</div>
                {toastVerified && <VerifiedBadge variant={toastVerified} />}
              </div>
              <div className="text-xs text-white/70 truncate">{toast!.preview}</div>
            </div>
          </div>
        </button>
      )}

      <button
        data-chat-floating-widget-launcher="1"
        type="button"
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) {
              setNotifyCount(0);
              setToast(null);
              setLastUnreadImageSender(null);
              ensureAudioContext();
            } else {
              setSelectedRoomId(null);
            }
            return next;
          });
        }}
        className="rounded-full overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/10"
        title="Mensagens / Editor"
      >
        <div className="flex items-stretch bg-[#111827]/95 text-white hover:bg-[#0f172a] transition">
          <div className="flex items-center gap-3 px-4 h-12">
            <div className="relative">
              <MessageCircle className="w-5 h-5" />
              {badgeCount > 0 && (
                <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                  {badgeCount}
                </span>
              )}
            </div>
            <span className="text-sm font-semibold">Mensagens</span>
          </div>

          {petitionEditorMinimized && (
            <>
              <div className="w-[3px] bg-gradient-to-b from-orange-400 via-orange-500 to-amber-400" aria-hidden />
              <div
                className="relative flex items-center gap-2 px-4 h-12 text-white"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  events.emit(SYSTEM_EVENTS.PETITION_EDITOR_MAXIMIZE);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    events.emit(SYSTEM_EVENTS.PETITION_EDITOR_MAXIMIZE);
                  }
                }}
                title="Abrir Editor"
              >
                <FileText className="w-4 h-4" />
                <span className="text-sm font-semibold">Editor</span>
                {petitionEditorHasUnsavedChanges && (
                  <span
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full ring-2 ring-white animate-pulse"
                    title="Alterações não salvas"
                  />
                )}
              </div>
            </>
          )}

          {lastUnreadImageSender && badgeCount > 0 && (
            <div className="flex items-center pr-3 h-12">
              {lastUnreadImageSender.avatarUrl ? (
                <img
                  src={lastUnreadImageSender.avatarUrl}
                  alt={lastUnreadImageSender.name}
                  className="w-7 h-7 rounded-full object-cover ring-1 ring-white/20"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-white/10 ring-1 ring-white/20 flex items-center justify-center text-[10px] font-bold">
                  {lastUnreadImageSender.name.substring(0, 1).toUpperCase()}
                </div>
              )}
            </div>
          )}
        </div>
      </button>
    </div>,
    document.body
  );
};

export default ChatFloatingWidget;
