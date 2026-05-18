import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BadgeCheck, ChevronDown, ExternalLink, FileText, Maximize2, MessageCircle, Mic, Paperclip, Reply, Send, Smile, Square, X, Zap, Play, Pause } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { chatService } from '../services/chat.service';
import { profileService, type Profile } from '../services/profile.service';
import type { ChatMessage, ChatRoom } from '../types/chat.types';
import { supabase } from '../config/supabase';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { matchesNormalizedSearch } from '../utils/search';

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

const fmtAudioTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const ProAudioPlayer: React.FC<{ src: string; onReady?: () => void }> = ({ src, onReady }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { void a.play(); } else { a.pause(); }
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * duration;
    setCurrent(a.currentTime);
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  // Pseudo-waveform estável por barra
  const bars = Array.from({ length: 28 }, (_, i) => 30 + ((i * 37) % 70));

  return (
    <div className="mt-2 flex items-center gap-3 rounded-2xl bg-white/10 border border-white/15 px-3 py-2.5">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration || 0); onReady?.(); }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 w-9 h-9 rounded-full bg-white text-indigo-600 flex items-center justify-center shadow hover:scale-105 transition"
        title={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-[2px] h-7 cursor-pointer" onClick={seek}>
          {bars.map((h, i) => {
            const filled = (i / bars.length) * 100 <= progress;
            return (
              <div
                key={i}
                className={`flex-1 rounded-full transition-colors ${filled ? 'bg-white' : 'bg-white/30'}`}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-white/70 tabular-nums">{fmtAudioTime(current)} / {fmtAudioTime(duration)}</span>
          <button
            type="button"
            onClick={cycleRate}
            className="text-[10px] font-bold text-white/80 bg-white/15 rounded px-1.5 py-0.5 hover:bg-white/25 transition"
            title="Velocidade"
          >
            {rate}x
          </button>
        </div>
      </div>
    </div>
  );
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
          className="mt-2 rounded-xl overflow-hidden bg-white/5 border border-white/10 w-full text-left min-h-[60px] flex items-center justify-center"
          title="Ampliar imagem"
        >
          <img
            src={signedUrl}
            alt={attachment.fileName}
            className="w-full max-h-64 object-contain"
            loading="eager"
            onLoad={() => {
              onMediaLoaded?.();
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const parent = e.currentTarget.parentElement;
              if (parent && !parent.querySelector('.img-error-msg')) {
                const msg = document.createElement('span');
                msg.className = 'img-error-msg text-xs text-white/40 italic p-2';
                msg.textContent = 'Imagem não disponível';
                parent.appendChild(msg);
              }
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

  return <ProAudioPlayer src={signedUrl} onReady={onMediaLoaded} />;
};

const MessageBody: React.FC<{ message: ChatMessage; onMediaLoaded?: () => void }> = ({ message, onMediaLoaded }) => {
  const attachment = parseAttachment(message.content);
  if (!attachment) {
    const text = (message.content ?? '').trim();
    if (!text) {
      return <span className="italic text-white/30 text-xs">Mensagem não disponível</span>;
    }
    return <div className="break-words whitespace-pre-wrap">{text}</div>;
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
      {isImage && <div className="text-sm font-semibold truncate">{attachment.fileName}</div>}
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

const formatDateSeparator = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
};

const getDayKey = (dateStr: string): string => {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

interface ChatFloatingWidgetProps {
  hidden?: boolean;
}

const ChatFloatingWidget: React.FC<ChatFloatingWidgetProps> = ({ hidden = false }) => {
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
  
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchMember, setSearchMember] = useState('');
  const [readStates, setReadStates] = useState<Map<string, string>>(new Map());
  const [shaking, setShaking] = useState(false);
  const [nudgeFlash, setNudgeFlash] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [nudgeCooldown, setNudgeCooldown] = useState(false);
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(() => new Set());

  const openRef = useRef(open);
  const selectedRoomIdRef = useRef<string | null>(selectedRoomId);

  const audioContextRef = useRef<AudioContext | null>(null);
  // stableCallbacksRef — atualizado a cada render para evitar deps instáveis na subscription
  const stableCallbacksRef = useRef({
    loadRooms: (() => {}) as () => void,
    loadUnread: (() => {}) as () => void,
    playSound: (() => Promise.resolve()) as () => Promise<void>,
    markRead: ((_roomId: string) => Promise.resolve()) as (roomId: string) => Promise<void>,
    scrollBottom: ((_b?: ScrollBehavior) => {}) as (behavior?: ScrollBehavior) => void,
  });

  const membersByUserIdRef = useRef<Map<string, Profile>>(new Map());
  const toastTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const nudgeCooldownTimerRef = useRef<number | null>(null);

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

  const broadcastTyping = useCallback((typing: boolean) => {
    const channel = typingChannelRef.current;
    if (!channel || !user) return;
    const me = membersByUserIdRef.current.get(user.id);
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: user.id, name: me?.name || 'Alguém', action: typing ? 'start' : 'stop' },
    });
  }, [user]);

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
      const t0 = ctx.currentTime;
      // Chime moderno: duas notas ascendentes (E6 -> B6) com leve brilho
      const notes = [
        { freq: 1318.51, start: 0.0, dur: 0.18 },
        { freq: 1975.53, start: 0.10, dur: 0.28 },
      ];
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        sub.type = 'triangle';
        osc.frequency.value = n.freq;
        sub.frequency.value = n.freq / 2;
        const s = t0 + n.start;
        gain.gain.setValueAtTime(0.0001, s);
        gain.gain.exponentialRampToValueAtTime(0.22, s + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, s + n.dur);
        osc.connect(gain);
        sub.connect(gain);
        gain.connect(master);
        osc.start(s);
        sub.start(s);
        osc.stop(s + n.dur + 0.02);
        sub.stop(s + n.dur + 0.02);
      }
    } catch {
      // ignore
    }
  }, [ensureAudioContext]);

  const playNudgeSound = useCallback(async () => {
    await ensureAudioContext();
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const t0 = ctx.currentTime;
      // Buzz vibrante (3 pulsos graves) estilo MSN
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 196;
        const s = t0 + i * 0.16;
        gain.gain.setValueAtTime(0.0001, s);
        gain.gain.exponentialRampToValueAtTime(0.3, s + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(s);
        osc.stop(s + 0.14);
      }
    } catch {
      // ignore
    }
  }, [ensureAudioContext]);

  const triggerShake = useCallback((fromName?: string) => {
    setShaking(true);
    if (fromName) setNudgeFlash(fromName);
    void playNudgeSound();
    window.setTimeout(() => setShaking(false), 850);
    window.setTimeout(() => setNudgeFlash(null), 2500);
  }, [playNudgeSound]);

  const handleSendNudge = useCallback(async () => {
    if (!user || !selectedRoomId || nudgeCooldown) return;
    const memberIds = roomMembers.get(selectedRoomId) || [];
    const targetId = memberIds.find((id) => id !== user.id);
    if (!targetId) return;
    const me = membersByUserIdRef.current.get(user.id);
    setNudgeCooldown(true);
    if (nudgeCooldownTimerRef.current) window.clearTimeout(nudgeCooldownTimerRef.current);
    nudgeCooldownTimerRef.current = window.setTimeout(() => setNudgeCooldown(false), 30000);
    try {
      await chatService.sendNudge({
        toUserId: targetId,
        fromUserId: user.id,
        fromName: me?.name || 'Alguém',
        roomId: selectedRoomId,
      });
      triggerShake();
    } catch (e) {
      console.error('Erro ao chamar atenção:', e);
    }
  }, [user, selectedRoomId, roomMembers, triggerShake, nudgeCooldown]);

  // Typing indicator — canal por sala
  useEffect(() => {
    if (!selectedRoomId || !user) {
      setTypingUsers([]);
      return;
    }
    const channel = supabase
      .channel(`typing:${selectedRoomId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
        const { user_id, name, action } = payload ?? {};
        if (!user_id || user_id === user.id) return;
        setTypingUsers((prev) => {
          if (action === 'start') return prev.includes(name) ? prev : [...prev, name];
          return prev.filter((n) => n !== name);
        });
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      setTypingUsers([]);
    };
  }, [selectedRoomId, user]);

  // Recebe "chamar atenção"
  useEffect(() => {
    if (!user) return;
    const unsub = chatService.subscribeToNudges({
      userId: user.id,
      onNudge: ({ fromName, roomId }) => {
        setOpen(true);
        setSelectedRoomId(roomId);
        triggerShake(fromName);
      },
    });
    return () => unsub();
  }, [user, triggerShake]);

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
      // Nota: notifyCount NÃO é restaurado do localStorage. Ele representa
      // notificações da sessão atual e o banco já é consultado logo em seguida,
      // tornando o valor persistido obsoleto e fonte de badge fantasma.

      const rawRoom = localStorage.getItem(WIDGET_ROOM_UNREAD_KEY);
      const rawLastImage = localStorage.getItem(WIDGET_LAST_IMAGE_SENDER_KEY);

      if (rawRoom) {
        // Pré-carrega do localStorage só como placeholder visual enquanto o banco
        // não responde. loadRoomUnreadCounts() sobrescreverá com os valores reais.
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

  // notifyCount é exclusivo da sessão atual (incrementado por eventos realtime).
  // Não persiste no localStorage para evitar badge fantasma após recarregar.
  useEffect(() => {
    try {
      localStorage.removeItem(WIDGET_NOTIFY_COUNT_KEY);
    } catch {
      // ignore
    }
  }, []);

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

    const doTrack = async () => {
      if (channel.state !== 'joined') return;
      const me = membersByUserIdRef.current.get(user.id);
      await channel.track({
        user_id: user.id,
        name: me?.name || user.email || 'Usuário',
        status: 'online',
      });
    };

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
        events.emit(SYSTEM_EVENTS.PRESENCE_UPDATED, Array.from(set));
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        await doTrack();
      });

    // Re-track when tab becomes visible again (browsers throttle WS heartbeats when hidden)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void doTrack();
    };
    // Re-track on window focus as well (covers minimized window restore)
    const onFocus = () => void doTrack();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
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

      // 🔥 Limpar cache se não houver salas
      if (list.length === 0) {
        try {
          localStorage.removeItem(WIDGET_NOTIFY_COUNT_KEY);
          localStorage.removeItem(WIDGET_ROOM_UNREAD_KEY);
          localStorage.removeItem(WIDGET_LAST_IMAGE_SENDER_KEY);
          setNotifyCount(0);
          setRoomUnreadCounts(new Map());
          setLastUnreadImageSender(null);
          console.log('🧹 Cache do chat limpo automaticamente (sem salas)');
        } catch (e) {
          console.error('Erro ao limpar cache:', e);
        }
      }

      // 🔥 Buscar última mensagem de salas sem preview
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
            return {
              ...r,
              last_message_preview: getPreview(last.content),
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

    if (error) return;

    // O banco é a fonte de verdade — substituir completamente o mapa local.
    // Nunca usar Math.max: se o banco diz 0 (mensagem lida), o valor local
    // stale (vindo do localStorage) não deve sobrescrever.
    const dbMap = new Map<string, number>();
    (data ?? []).forEach((row: any) => {
      dbMap.set(String(row.room_id), Number(row.unread_count ?? 0));
    });
    // Preserva notifyCount de sessão: usa MAX para não apagar badges locais
    // que ainda não foram confirmados pelo banco (lag de trigger).
    setRoomUnreadCounts((prev) => {
      const merged = new Map<string, number>();
      dbMap.forEach((v, k) => merged.set(k, Math.max(v, prev.get(k) ?? 0)));
      // salas que existiam localmente mas não vieram do banco ficam com o valor local
      prev.forEach((v, k) => { if (!merged.has(k)) merged.set(k, v); });
      return merged;
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
    broadcastTyping(false);
    if (typingTimeoutRef.current) { window.clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current = null; }
    setSendingMessage(true);
    const pendingReplyTo = replyTo;
    try {
      await chatService.sendMessage({
        roomId: selectedRoomId,
        userId: user.id,
        content: messageText.trim(),
        replyTo: pendingReplyTo?.id ?? null,
      });
      setMessageText('');
      setReplyTo(null);
      pinnedToBottomRef.current = true;
      scrollToBottom('smooth');
      requestAnimationFrame(() => { messageInputRef.current?.focus(); });
    } finally {
      setSendingMessage(false);
    }
  }, [user, selectedRoomId, messageText, sendingMessage, scrollToBottom, replyTo, broadcastTyping]);

  const markRoomAsRead = useCallback(
    async (roomId: string) => {
      if (!user) return;
      console.log(`📖 Marcando sala ${roomId.substring(0, 8)} como lida`);
      try {
        await chatService.markAsRead({ roomId, userId: user.id });
        console.log(`✅ Sala marcada como lida no banco`);
      } catch (error) {
        console.error('❌ Erro ao marcar sala como lida:', error);
      } finally {
        setRoomUnreadCounts((prev) => {
          const next = new Map(prev);
          next.set(roomId, 0);
          console.log(`🔢 Contador da sala zerado localmente`);
          return next;
        });
        await loadUnread();
        console.log(`🔄 Contador global atualizado`);
      }
    },
    [user, loadUnread]
  );

  const handleStartNewChat = useCallback(
    async (targetUserId: string) => {
      if (!user || targetUserId === user.id) return;
      
      try {
        // Verificar se já existe uma conversa DM
        let dmRoom = await chatService.findDirectMessage(user.id, targetUserId);
        
        // Se não existir, criar nova
        if (!dmRoom) {
          dmRoom = await chatService.createDirectMessage({ userId1: user.id, userId2: targetUserId });
        }
        
        // Atualizar lista de salas
        const list = await chatService.listRooms(user.id);
        setRooms(list);
        
        // Atualizar membros da sala
        const memberIds = await chatService.getRoomMembers(dmRoom.id);
        setRoomMembers(prev => new Map(prev).set(dmRoom!.id, memberIds));
        
        // Selecionar a sala
        setSelectedRoomId(dmRoom.id);
        setShowNewChatModal(false);
        setSearchMember('');
      } catch (error) {
        console.error('Erro ao iniciar nova conversa:', error);
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user) return;
    loadMembers();
    loadRooms();
    loadUnread();
    loadRoomUnreadCounts();
    // Atualiza membros e salas periodicamente para manter last_seen_at e presença frescos
    const refreshTimer = window.setInterval(() => {
      loadMembers();
      loadRoomUnreadCounts();
    }, 30000);
    return () => window.clearInterval(refreshTimer);
  }, [user, loadMembers, loadRooms, loadUnread, loadRoomUnreadCounts]);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = events.on(SYSTEM_EVENTS.CHAT_WIDGET_OPEN_DM, async (payload?: any) => {
      const targetUserId = String(payload?.targetUserId ?? payload?.userId ?? '').trim();
      if (!targetUserId) return;
      if (targetUserId === user.id) return;

      setNotifyCount(0);
      setToast(null);
      setLastUnreadImageSender(null);
      setOpen(true);

      try {
        const list = await chatService.listRooms(user.id);
        const membersMap = new Map<string, string[]>();

        let dmRoom: ChatRoom | null = null;
        for (const room of list) {
          if (room.is_public) continue;
          if (room.type !== 'dm') continue;
          const memberIds = await chatService.getRoomMembers(room.id);
          membersMap.set(room.id, memberIds);
          if (memberIds.includes(user.id) && memberIds.includes(targetUserId)) {
            dmRoom = room;
          }
        }

        if (!dmRoom) {
          const created = await chatService.createDirectMessage({
            userId1: user.id,
            userId2: targetUserId,
          });
          const memberIds = await chatService.getRoomMembers(created.id);
          membersMap.set(created.id, memberIds);
          list.unshift(created);
          dmRoom = created;
        }

        setRooms(list);
        setRoomMembers(membersMap);
        setSelectedRoomId(dmRoom.id);
        setRoomUnreadCounts((prev) => {
          const next = new Map(prev);
          next.set(dmRoom!.id, 0);
          return next;
        });
      } catch (err) {
        console.error('Erro ao abrir DM no widget:', err);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [user]);

  // Carrega mensagens + poll de leitura ao selecionar sala (SEM subscription própria)
  useEffect(() => {
    if (!selectedRoomId) {
      setMessages([]);
      setReadStates(new Map());
      return;
    }
    loadMessages(selectedRoomId);
    markRoomAsRead(selectedRoomId);
    setNotifyCount(0);
    setRoomUnreadCounts((prev) => {
      const next = new Map(prev);
      next.set(selectedRoomId, 0);
      return next;
    });

    const roomId = selectedRoomId;
    const refreshReads = () => {
      chatService.getRoomReadStates(roomId).then(setReadStates).catch(() => {});
    };
    refreshReads();
    const readPoll = window.setInterval(refreshReads, 3000);
    return () => window.clearInterval(readPoll);
    // Intencionalmente omitindo markRoomAsRead das deps para não recriar o poll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId]);

  useEffect(() => {
    if (!selectedRoomId) return;
    if (!pinnedToBottomRef.current) return;
    scrollToBottom('auto');
  }, [selectedRoomId, messages.length, scrollToBottom]);

  // Canal único para TODAS as mensagens: notificações + atualização em-sala
  // Não usa subscribeToRoomMessages — evita interferência de canais múltiplos no Supabase
  // Quando o módulo de chat está ativo, o módulo gerencia o canal — widget pausa para evitar conflito
  useEffect(() => {
    if (!user) return;
    if (currentModule === 'chat') return;
    const myUserId = user.id;
    let unsubFn: (() => void) | null = null;
    let retryTimer: number | null = null;

    const subscribe = () => {
      unsubFn = chatService.subscribeToAllMessages({
        onInsert: (msg) => {
          const isMine = msg.user_id === myUserId;
          const currentRoom = selectedRoomIdRef.current;
          const isInThisRoom = msg.room_id === currentRoom;

          // ── Mensagem é da sala aberta no momento ──────────────────────────
          if (isInThisRoom) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            if (!isMine) {
              void stableCallbacksRef.current.markRead(msg.room_id);
            }
            if (pinnedToBottomRef.current || isMine) {
              pinnedToBottomRef.current = true;
              stableCallbacksRef.current.scrollBottom('smooth');
            }
            // Atualiza preview da sala sem notificar
            setRooms((prev) => prev
              .map((r) => r.id === msg.room_id ? { ...r, last_message_at: msg.created_at, last_message_preview: getPreview(msg.content) } : r)
              .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))
            );
            return;
          }

          // ── Mensagem de outra sala ────────────────────────────────────────
          if (!isMine) {
            // Animação de nova mensagem (destaque verde)
            setNewMessageIds((prev) => {
              const next = new Set(prev);
              next.add(msg.id);
              window.setTimeout(() => setNewMessageIds((s) => { const n = new Set(s); n.delete(msg.id); return n; }), 4000);
              return next;
            });

            stableCallbacksRef.current.loadUnread();
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

            if (isImageAttachment) setLastUnreadImageSender({ name: senderName, avatarUrl });

            // Toast: auto-dismiss em 6s, cancelado se o usuário interagir antes
            setToast({ id: msg.id, roomId: msg.room_id, senderUserId: msg.user_id, senderName, avatarUrl, senderRole: profile?.role, senderOab: profile?.oab, preview });
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = window.setTimeout(() => setToast(null), 6000);

            if (!profile) {
              void profileService.getProfile(msg.user_id).then((p) => {
                if (!p) return;
                membersByUserIdRef.current.set(msg.user_id, p);
                setToast((prev) => {
                  if (!prev || prev.id !== msg.id) return prev;
                  return { ...prev, senderName: p.name || prev.senderName, avatarUrl: p.avatar_url, senderRole: p.role, senderOab: p.oab };
                });
                if (isImageAttachment) setLastUnreadImageSender({ name: p.name || senderName, avatarUrl: p.avatar_url });
              });
            }

            void stableCallbacksRef.current.playSound();
          }

          // Atualiza lista de salas (preview + ordenação)
          setRooms((prev) => {
            const exists = prev.some((r) => r.id === msg.room_id);
            if (!exists) { stableCallbacksRef.current.loadRooms(); return prev; }
            return prev
              .map((r) => r.id === msg.room_id ? { ...r, last_message_at: msg.created_at, last_message_preview: getPreview(msg.content) } : r)
              .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
          });
        },
      });
    };

    subscribe();

    // Reconecta quando a rede volta (garante que mensagens perdidas sejam recuperadas)
    const onOnline = () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        unsubFn?.();
        subscribe();
        stableCallbacksRef.current.loadUnread();
        stableCallbacksRef.current.loadRooms();
      }, 1500);
    };
    window.addEventListener('online', onOnline);

    return () => {
      unsubFn?.();
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentModule]);

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

  // Mantém refs estáveis — atualizado em todo render, sem causar rebuild das subscriptions
  stableCallbacksRef.current = {
    loadRooms,
    loadUnread,
    playSound: playNotificationSound,
    markRead: markRoomAsRead,
    scrollBottom: scrollToBottom,
  };

  const totalUnreadFromRooms = useMemo(() => {
    let total = 0;
    roomUnreadCounts.forEach((v) => {
      total += Number(v || 0);
    });
    return total;
  }, [roomUnreadCounts]);

  const toastVerified = useMemo(() => {
    if (!toast) return null;
    return getVerifiedVariant({ role: toast.senderRole || '', oab: toast.senderOab ?? null });
  }, [toast]);

  // Sala não lida mais recente — usada para mostrar a foto persistente no launcher
  const topUnreadRoom = useMemo(() => {
    const unreadRooms = rooms.filter((r) => (roomUnreadCounts.get(r.id) ?? 0) > 0);
    unreadRooms.sort((a, b) => {
      const at = a.last_message_at ?? a.created_at;
      const bt = b.last_message_at ?? b.created_at;
      return bt.localeCompare(at);
    });
    return unreadRooms[0] ?? null;
  }, [rooms, roomUnreadCounts]);

  const visible = !!user && currentModule !== 'chat';
  if (!visible) return null;

  const selectedRoom = selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) : null;
  const otherUser = selectedRoom ? getOtherUserForRoom(selectedRoom) : null;
  const displayName = otherUser?.name || selectedRoom?.name || '';
  const avatarUrl = otherUser?.avatar_url;
  const headerOnline = otherUser ? onlineUserIds.has(otherUser.user_id) : false;
  const badgeCount = Math.max(totalUnreadFromRooms, notifyCount);
  const topUnreadUser = topUnreadRoom ? getOtherUserForRoom(topUnreadRoom) : null;

  const showToast = !!toast && (!open || !selectedRoomId || toast.roomId !== selectedRoomId);
  const headerVerified = getVerifiedVariant(otherUser);

  if (hidden) return null;

  return createPortal(
    <div className="fixed bottom-5 right-4 sm:bottom-5 sm:right-5 z-[9999] flex flex-col items-end" style={{ isolation: 'isolate' }}>
      <style>{`@keyframes chatShake{0%,100%{transform:translate(0,0) rotate(0)}10%{transform:translate(-6px,4px) rotate(-2deg)}20%{transform:translate(6px,-4px) rotate(2deg)}30%{transform:translate(-6px,-4px) rotate(-2deg)}40%{transform:translate(6px,4px) rotate(2deg)}50%{transform:translate(-4px,2px) rotate(-1deg)}60%{transform:translate(4px,-2px) rotate(1deg)}70%{transform:translate(-2px,1px)}80%{transform:translate(2px,-1px)}90%{transform:translate(-1px,0)}}`}</style>
      {open && (
        <div
          className="mb-3 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl bg-[#111827]/95 text-white shadow-[0_30px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/10 overflow-hidden flex flex-col h-[460px] max-h-[calc(100vh-120px)]"
          style={shaking ? { animation: 'chatShake 0.8s cubic-bezier(.36,.07,.19,.97) both' } : undefined}
        >
          {nudgeFlash && (
            <div className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold text-center shrink-0 flex items-center justify-center gap-2">
              <Zap className="w-3.5 h-3.5 animate-pulse" />
              <span>{nudgeFlash} está te chamando!</span>
              <Zap className="w-3.5 h-3.5 animate-pulse" />
            </div>
          )}
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
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold truncate max-w-[160px]">{displayName}</span>
                      {headerVerified && <VerifiedBadge variant={headerVerified} />}
                    </div>
                    {otherUser && !selectedRoom?.is_public && (
                      <span className={`flex items-center gap-1 text-[11px] ${headerOnline ? 'text-emerald-400' : 'text-white/40'}`}>
                        {headerOnline
                          ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Online agora</>
                          : otherUser.last_seen_at
                            ? `visto ${formatLastSeen(otherUser.last_seen_at).replace(/^Online /, '').replace(/^Online$/, 'agora')}`
                            : 'Offline'}
                      </span>
                    )}
                  </div>
                </>
              ) : showNewChatModal ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewChatModal(false);
                      setSearchMember('');
                    }}
                    className="h-8 w-8 rounded-lg hover:bg-white/10 transition flex items-center justify-center shrink-0"
                    title="Voltar"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-bold truncate">Nova Conversa</span>
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
              {!selectedRoomId && !showNewChatModal && (
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  className="h-8 w-8 rounded-lg hover:bg-white/10 transition flex items-center justify-center"
                  title="Nova Conversa"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
              )}
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
            showNewChatModal ? (
              <>
                <div className="px-4 py-3 border-b border-white/10">
                  <input
                    type="text"
                    value={searchMember}
                    onChange={(e) => setSearchMember(e.target.value)}
                    placeholder="Buscar pessoa..."
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex-1 overflow-y-auto">
                  {members
                    .filter((m) => m.user_id !== user?.id)
                    .filter((m) => {
                      if (!searchMember.trim()) return true;
                      return matchesNormalizedSearch(searchMember, [m.name, m.email, m.role]);
                    })
                    .map((member) => {
                      const online = onlineUserIds.has(member.user_id);
                      const verified = getVerifiedVariant(member);
                      
                      return (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => handleStartNewChat(member.user_id)}
                          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/5 transition"
                        >
                          <Avatar src={member.avatar_url} name={member.name} online={online} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="text-sm font-semibold truncate">{member.name}</div>
                              {verified && <VerifiedBadge variant={verified} />}
                            </div>
                            <div className="text-xs text-white/60 truncate">
                              {online ? 'Online' : member.role || 'Offline'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  {members.filter((m) => m.user_id !== user?.id).length === 0 && (
                    <div className="p-4 text-sm text-white/70 text-center">
                      Nenhuma pessoa cadastrada
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {loadingRooms && rooms.length === 0 ? (
                  <div className="p-4 text-sm text-white/70">Carregando...</div>
                ) : rooms.length === 0 ? (
                  <div className="p-4 text-sm text-white/70">Nenhuma conversa</div>
                ) : (
                  [...rooms].sort((a, b) => {
                    const ua = roomUnreadCounts.get(a.id) ?? 0;
                    const ub = roomUnreadCounts.get(b.id) ?? 0;
                    if ((ua > 0) !== (ub > 0)) return ua > 0 ? -1 : 1;
                    const at = a.last_message_at ?? a.created_at;
                    const bt = b.last_message_at ?? b.created_at;
                    return bt.localeCompare(at);
                  }).map((room) => {
                  const otherUser = getOtherUserForRoom(room);
                  const displayName = otherUser?.name || room.name;
                  const avatarUrl = otherUser?.avatar_url;
                  const online = otherUser ? onlineUserIds.has(otherUser.user_id) : false;
                  const verified = getVerifiedVariant(otherUser);
                  const roomUnread = roomUnreadCounts.get(room.id) ?? 0;
                  const subtitle = room.is_public
                    ? `${room.type === 'team' ? 'Grupo' : 'Sala'} · ${(roomMembers.get(room.id) ?? []).length || ''} membros`
                    : online
                      ? '● Online agora'
                      : otherUser?.last_seen_at
                        ? `visto ${formatLastSeen(otherUser.last_seen_at).replace(/^Online /, '').replace(/^Online$/, 'agora')}`
                        : '● Offline';

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
                      className={`w-full px-4 py-3 flex items-center gap-3 text-left transition ${roomUnread > 0 ? 'bg-white/[0.06] hover:bg-white/10' : 'hover:bg-white/5'}`}
                    >
                      <div className="relative">
                        <Avatar src={avatarUrl} name={displayName} online={room.is_public ? undefined : online} />
                        {roomUnread > 0 && (
                          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 ring-2 ring-[#111827]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <div className={`text-sm truncate ${roomUnread > 0 ? 'font-bold text-white' : 'font-semibold'}`}>{displayName}</div>
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
                        <div className={`text-xs truncate ${online && !room.is_public ? 'text-emerald-400' : 'text-white/50'}`}>{subtitle}</div>
                        <div className={`text-xs truncate mt-0.5 ${roomUnread > 0 ? 'text-white font-medium' : 'text-white/50'}`}>{preview}</div>
                      </div>
                    </button>
                  );
                })
                )}
              </div>
            )
          ) : (
            <div className="flex flex-col flex-1 overflow-hidden relative">
              <div
                ref={messagesContainerRef}
                onScroll={() => {
                  const el = messagesContainerRef.current;
                  if (!el) return;
                  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
                  pinnedToBottomRef.current = distance < 80;
                  setShowScrollBottom(distance > 200);
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file && selectedRoomId) handleUploadAttachment(file);
                }}
                className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 min-h-[200px] relative"
              >
                {/* Overlay drag & drop */}
                {isDragging && (
                  <div className="absolute inset-0 z-10 bg-indigo-600/20 border-2 border-dashed border-indigo-400 rounded-xl flex flex-col items-center justify-center gap-2 pointer-events-none">
                    <Paperclip className="w-8 h-8 text-indigo-300" />
                    <span className="text-sm font-semibold text-indigo-200">Solte para enviar</span>
                  </div>
                )}

                {loadingMessages && messages.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-white/50 py-6 justify-center">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                    Carregando mensagens...
                  </div>
                ) : !loadingMessages && messages.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-8 text-white/40">
                    <MessageCircle className="w-10 h-10 opacity-30" />
                    <span className="text-sm">Nenhuma mensagem ainda</span>
                    <span className="text-xs text-white/30">Seja o primeiro a escrever 👋</span>
                  </div>
                ) : (() => {
                  const otherReads = Array.from(readStates.entries())
                    .filter(([uid]) => uid !== user?.id)
                    .map(([, ts]) => ts)
                    .sort();
                  const otherReadAt = otherReads.length ? otherReads[otherReads.length - 1] : null;
                  let lastDayKey = '';

                  return messages.map((msg) => {
                    const isMine = msg.user_id === user?.id;
                    const isDeleted = !!msg.deleted_at;
                    const sender = membersByUserIdRef.current.get(msg.user_id) || members.find((m) => m.user_id === msg.user_id);
                    const senderName = isMine ? 'Você' : sender?.name || 'Usuário';
                    const seen = isMine && otherReadAt != null && otherReadAt >= msg.created_at;
                    const dayKey = getDayKey(msg.created_at);
                    const showSeparator = dayKey !== lastDayKey;
                    if (showSeparator) lastDayKey = dayKey;

                    const replyMsg = msg.reply_to ? messages.find((m) => m.id === msg.reply_to) : null;
                    const replySender = replyMsg ? (membersByUserIdRef.current.get(replyMsg.user_id) || members.find((m) => m.user_id === replyMsg.user_id)) : null;

                    const isNew = newMessageIds.has(msg.id) && !isMine;

                    return (
                      <React.Fragment key={msg.id}>
                        {showSeparator && (
                          <div className="flex items-center gap-3 py-2 my-1">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-[10px] text-white/40 font-medium px-2 shrink-0">
                              {formatDateSeparator(msg.created_at)}
                            </span>
                            <div className="flex-1 h-px bg-white/10" />
                          </div>
                        )}
                        <div
                          className={`group flex flex-col min-w-0 mb-1 ${isMine ? 'items-end' : 'items-start'} ${isNew ? 'animate-in slide-in-from-left-2 fade-in duration-300' : ''}`}
                        >
                          {!isMine && (
                            <div className="text-[10px] text-white/40 mb-0.5 ml-1">{senderName}</div>
                          )}

                          {/* Reply preview */}
                          {replyMsg && !isDeleted && (
                            <div className={`mb-1 px-2 py-1 rounded-lg border-l-2 border-indigo-400 bg-white/5 max-w-[80%] ${isMine ? 'mr-1' : 'ml-1'}`}>
                              <div className="text-[10px] text-indigo-300 font-semibold truncate">
                                {replySender?.name || 'Usuário'}
                              </div>
                              <div className="text-[11px] text-white/50 truncate">
                                {replyMsg.deleted_at ? '🗑️ Mensagem apagada' : getPreview(replyMsg.content)}
                              </div>
                            </div>
                          )}

                          <div className="flex items-end gap-1">
                            {!isMine && (
                              <button
                                type="button"
                                onClick={() => setReplyTo(msg)}
                                className="opacity-0 group-hover:opacity-100 transition h-6 w-6 rounded-full hover:bg-white/10 flex items-center justify-center shrink-0 mb-1"
                                title="Responder"
                              >
                                <Reply className="w-3 h-3 text-white/50" />
                              </button>
                            )}
                            <div
                              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm transition-all ${
                                isDeleted
                                  ? 'bg-slate-700/40 text-white/30 italic rounded-bl-md rounded-br-md'
                                  : isMine
                                    ? 'bg-indigo-600 text-white rounded-br-sm'
                                    : isNew
                                      ? 'bg-emerald-600 text-white rounded-bl-sm ring-1 ring-emerald-400'
                                      : 'bg-slate-700 text-white rounded-bl-sm'
                              } overflow-hidden`}
                            >
                              {isDeleted
                                ? <span className="flex items-center gap-1.5 text-xs"><span>🗑️</span> Mensagem apagada</span>
                                : <MessageBody message={msg} onMediaLoaded={handleMediaLoaded} />
                              }
                            </div>
                            {isMine && (
                              <button
                                type="button"
                                onClick={() => setReplyTo(msg)}
                                className="opacity-0 group-hover:opacity-100 transition h-6 w-6 rounded-full hover:bg-white/10 flex items-center justify-center shrink-0 mb-1"
                                title="Responder"
                              >
                                <Reply className="w-3 h-3 text-white/50" />
                              </button>
                            )}
                          </div>

                          <div className={`text-[10px] text-white/30 mt-0.5 flex items-center gap-1 ${isMine ? 'mr-8' : 'ml-8'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {msg.edited_at && !isDeleted && <span className="text-white/20">(editada)</span>}
                            {isMine && !isDeleted && (
                              <span
                                className={seen ? 'text-sky-400' : 'text-white/30'}
                                title={seen ? 'Visualizada' : 'Enviada'}
                              >
                                {seen ? '✓✓' : '✓'}
                              </span>
                            )}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  });
                })()}

                {/* Typing indicator */}
                {typingUsers.length > 0 && (
                  <div className="flex items-center gap-2 pt-1 pb-2">
                    <div className="flex gap-[3px] items-center bg-slate-700 rounded-2xl px-3 py-2">
                      <span className="text-xs text-white/60 mr-1">
                        {typingUsers.length === 1 ? `${typingUsers[0]} está digitando` : 'Várias pessoas digitando'}
                      </span>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="block w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Scroll to bottom button */}
              {showScrollBottom && (
                <div className="absolute bottom-[72px] right-3 z-10">
                  <button
                    type="button"
                    onClick={() => { pinnedToBottomRef.current = true; scrollToBottom('smooth'); }}
                    className="h-8 w-8 rounded-full bg-indigo-600 hover:bg-indigo-500 shadow-lg flex items-center justify-center transition"
                    title="Ir para o fim"
                  >
                    <ChevronDown className="w-4 h-4 text-white" />
                  </button>
                </div>
              )}

              <div className="shrink-0">
                {/* Reply preview bar */}
                {replyTo && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border-t border-white/10">
                    <div className="flex-1 min-w-0 border-l-2 border-indigo-400 pl-2">
                      <div className="text-[10px] text-indigo-300 font-semibold">
                        Respondendo a {replyTo.user_id === user?.id ? 'você mesmo' : (membersByUserIdRef.current.get(replyTo.user_id)?.name || 'Usuário')}
                      </div>
                      <div className="text-[11px] text-white/50 truncate">{getPreview(replyTo.content)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="h-6 w-6 rounded-full hover:bg-white/10 flex items-center justify-center shrink-0"
                    >
                      <X className="w-3 h-3 text-white/50" />
                    </button>
                  </div>
                )}

              <div className="p-3 border-t border-white/10">
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

                  {/* Nudge — sempre visível em DM, com cooldown */}
                  {otherUser && !selectedRoom?.is_public && (
                    <button
                      type="button"
                      onClick={handleSendNudge}
                      disabled={nudgeCooldown}
                      className={`h-9 w-9 rounded-xl transition flex items-center justify-center shrink-0 ${
                        nudgeCooldown
                          ? 'opacity-30 cursor-not-allowed'
                          : 'hover:bg-amber-500/20 text-amber-300'
                      }`}
                      title={nudgeCooldown ? 'Aguarde antes de chamar novamente' : 'Chamar atenção'}
                    >
                      <Zap className="w-4 h-4" />
                    </button>
                  )}

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
                    onChange={(e) => {
                      setMessageText(e.target.value);
                      if (e.target.value.trim()) {
                        broadcastTyping(true);
                        if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
                        typingTimeoutRef.current = window.setTimeout(() => broadcastTyping(false), 3000);
                      } else {
                        broadcastTyping(false);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!isRecording) handleSendMessage();
                      }
                      if (e.key === 'Escape' && replyTo) setReplyTo(null);
                    }}
                    placeholder={replyTo ? 'Escreva sua resposta...' : 'Digite uma mensagem...'}
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
            </div>
          )}
        </div>
      )}

      {showToast && toast && (
        <div className="mb-3 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl bg-[#0b1220]/95 text-white shadow-[0_25px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/10 overflow-hidden">
          {/* Barra de destaque colorida */}
          <div className="h-[3px] bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
          <div className="px-4 py-3 flex items-center gap-3">
            <button
              type="button"
              className="shrink-0"
              onClick={async () => {
                if (toastTimerRef.current) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
                setToast(null);
                setNotifyCount(0);
                await ensureAudioContext();
                setOpen(true);
                setSelectedRoomId(toast.roomId);
              }}
            >
              <Avatar src={toast.avatarUrl} name={toast.senderName} />
            </button>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={async () => {
                if (toastTimerRef.current) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
                setToast(null);
                setNotifyCount(0);
                await ensureAudioContext();
                setOpen(true);
                setSelectedRoomId(toast.roomId);
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="text-sm font-semibold truncate">{toast.senderName}</div>
                {toastVerified && <VerifiedBadge variant={toastVerified} />}
              </div>
              <div className="text-xs text-white/60 truncate mt-0.5">{toast.preview}</div>
            </button>
            {/* Botão fechar — cancela o timer e remove o toast */}
            <button
              type="button"
              onClick={() => {
                if (toastTimerRef.current) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
                setToast(null);
              }}
              className="shrink-0 h-7 w-7 rounded-full hover:bg-white/10 flex items-center justify-center transition"
              title="Fechar"
            >
              <X className="w-3.5 h-3.5 text-white/50" />
            </button>
          </div>
        </div>
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
              if (topUnreadRoom) setSelectedRoomId(topUnreadRoom.id);
            } else {
              setSelectedRoomId(null);
            }
            return next;
          });
        }}
        className={`rounded-full overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 transition ${
          badgeCount > 0 && !open ? 'ring-amber-400/60 shadow-amber-900/30' : 'ring-white/10'
        }`}
        title="Mensagens / Editor"
      >
        <div className="sm:hidden flex items-center justify-center h-12 w-12 bg-[#111827]/95 text-white hover:bg-[#0f172a] transition">
          <div className="relative">
            <MessageCircle className="w-5 h-5" />
            {badgeCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                {badgeCount}
              </span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex items-stretch bg-[#111827]/95 text-white hover:bg-[#0f172a] transition">
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

          {badgeCount > 0 && (topUnreadUser || lastUnreadImageSender) && (
            <div className="flex items-center pr-3 h-12">
              <div className="relative">
                {(topUnreadUser?.avatar_url || lastUnreadImageSender?.avatarUrl) ? (
                  <img
                    src={(topUnreadUser?.avatar_url || lastUnreadImageSender?.avatarUrl) as string}
                    alt={topUnreadUser?.name || lastUnreadImageSender?.name || ''}
                    className="w-8 h-8 rounded-full object-cover ring-2 ring-red-500"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white/10 ring-2 ring-red-500 flex items-center justify-center text-[11px] font-bold">
                    {(topUnreadUser?.name || lastUnreadImageSender?.name || '?').substring(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[#111827]">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              </div>
            </div>
          )}
        </div>
      </button>
    </div>,
    document.body
  );
};

export default ChatFloatingWidget;
