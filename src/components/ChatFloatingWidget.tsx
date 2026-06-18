import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BadgeCheck, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, Maximize2, MessageCircle, Mic, Paperclip, Reply, Search, Send, Smile, Trash2, Users, X, Zap, Play, Pause, PhoneOff, RotateCcw, UserCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { buildPortalFarewellMessage, chatService } from '../services/chat.service';
import { profileService, type Profile } from '../services/profile.service';
import type { ChatMessage, ChatRoom } from '../types/chat.types';
import { supabase } from '../config/supabase';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { matchesNormalizedSearch } from '../utils/search';

// No localStorage cache for chat data — all state comes from DB/realtime only.

const PETITION_EDITOR_WIDGET_STATE_KEY = 'petition-editor-widget-state';
const PETITION_EDITOR_WIDGET_STATE_EVENT = 'crm:petition_editor_widget_state';

const ATTACHMENT_PREFIX = '__anexo__:';
const ATTACHMENT_BUCKET = 'anexos_chat';

type ChatAttachmentPayload = {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  bucket?: string;
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
      .from(attachment.bucket ?? ATTACHMENT_BUCKET)
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
  // Pseudo-waveform — altura estável por índice
  const bars = Array.from({ length: 32 }, (_, i) => 20 + ((i * 41 + i * i * 3) % 80));

  return (
    <div
      className="mt-1 flex items-center gap-2 select-none"
      style={{ minWidth: '170px', maxWidth: '230px' }}
    >
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

      {/* Botão play/pause estilo WA */}
      <button
        type="button"
        onClick={toggle}
        className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-[0_3px_10px_rgba(251,146,60,.5),inset_0_1px_0_rgba(255,255,255,.2)] active:scale-95 transition-transform duration-100"
        title={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing
          ? <Pause className="w-3.5 h-3.5 text-white" />
          : <Play className="w-3.5 h-3.5 text-white ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        {/* Waveform */}
        <div
          className="flex items-end gap-[2px] h-5 cursor-pointer"
          onClick={seek}
          title="Avançar / retroceder"
        >
          {bars.map((h, i) => {
            const filled = (i / bars.length) * 100 <= progress;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors duration-75"
                style={{
                  height: `${h}%`,
                  background: filled ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.35)',
                }}
              />
            );
          })}
        </div>

        {/* Tempo + velocidade */}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-white/55 tabular-nums font-semibold">
            {playing || current > 0 ? fmtAudioTime(current) : fmtAudioTime(duration)}
          </span>
          <button
            type="button"
            onClick={cycleRate}
            className="text-[8px] font-bold text-white/55 bg-white/10 hover:bg-white/20 rounded px-1 py-0.5 transition leading-none"
            title="Velocidade de reprodução"
          >
            {rate}x
          </button>
        </div>
      </div>
    </div>
  );
};

// Galeria da conversa: caminhos das imagens em ordem, para o viewer navegar
// (slider ‹ ›) entre todas as imagens — preenchida pela lista de mensagens.
const ChatImagesContext = React.createContext<string[]>([]);

const AttachmentSignedMedia: React.FC<{
  attachment: ChatAttachmentPayload;
  kind: 'audio' | 'image';
  onMediaLoaded?: () => void;
}> = ({ attachment, kind, onMediaLoaded }) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  // Lista de imagens da conversa (ordem das mensagens); fallback só a desta.
  const gallery = useContext(ChatImagesContext);
  const list = useMemo(
    () => (gallery.length ? gallery : [attachment.filePath]),
    [gallery, attachment.filePath],
  );

  const openViewer = useCallback(() => {
    const idx = list.indexOf(attachment.filePath);
    setViewerIndex(idx < 0 ? 0 : idx);
    setViewerOpen(true);
  }, [list, attachment.filePath]);

  // Assina a URL da imagem atual do viewer (sob demanda, ao navegar).
  useEffect(() => {
    if (!viewerOpen) return;
    let active = true;
    setViewerUrl(null);
    supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(list[viewerIndex], 60 * 5)
      .then(({ data }) => { if (active && data?.signedUrl) setViewerUrl(data.signedUrl); });
    return () => { active = false; };
  }, [viewerOpen, viewerIndex, list]);

  // Navegação por teclado (← → Esc) enquanto o viewer está aberto.
  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewerOpen(false);
      else if (e.key === 'ArrowRight') setViewerIndex(i => Math.min(i + 1, list.length - 1));
      else if (e.key === 'ArrowLeft') setViewerIndex(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerOpen, list.length]);

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
        {/* Thumbnail — margem negativa para preencher a bolha sem frame */}
        <button
          type="button"
          onClick={openViewer}
          className="block p-0 border-0 bg-transparent overflow-hidden rounded-[inherit]"
          style={{ margin: '-8px -14px', display: 'block' }}
          title="Ampliar imagem"
        >
          <img
            src={signedUrl}
            alt=""
            className="block"
            style={{
              width: '100%',
              maxWidth: '260px',
              maxHeight: '200px',
              objectFit: 'cover',
              display: 'block',
            }}
            loading="eager"
            onLoad={() => { onMediaLoaded?.(); }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const parent = e.currentTarget.parentElement;
              if (parent && !parent.querySelector('.img-error-msg')) {
                const msg = document.createElement('span');
                msg.className = 'img-error-msg text-xs text-white/40 italic p-3 block';
                msg.textContent = '🖼️ Imagem indisponível';
                parent.appendChild(msg);
              }
            }}
          />
        </button>

        {/* Viewer em portal para escapar do backdrop-filter stacking context do widget */}
        {viewerOpen && createPortal(
          <div
            className="fixed inset-0 z-[99999] bg-black/85 flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            onClick={() => setViewerOpen(false)}
          >
            <div className="relative max-w-[92vw] max-h-[92vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="absolute -top-4 -right-4 h-10 w-10 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center ring-1 ring-white/20 transition z-10"
                onClick={() => setViewerOpen(false)}
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Setas de navegação (slider) — só quando há mais de uma imagem */}
              {list.length > 1 && (
                <>
                  <button
                    type="button"
                    disabled={viewerIndex === 0}
                    onClick={() => setViewerIndex(i => Math.max(i - 1, 0))}
                    className="absolute left-2 sm:-left-16 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default z-10"
                    title="Imagem anterior"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <button
                    type="button"
                    disabled={viewerIndex === list.length - 1}
                    onClick={() => setViewerIndex(i => Math.min(i + 1, list.length - 1))}
                    className="absolute right-2 sm:-right-16 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default z-10"
                    title="Próxima imagem"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                  {/* Contador */}
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-semibold ring-1 ring-white/20">
                    {viewerIndex + 1} / {list.length}
                  </span>
                </>
              )}

              <img
                src={viewerUrl || signedUrl}
                alt={attachment.fileName}
                className="max-w-[92vw] max-h-[92vh] object-contain rounded-2xl shadow-[0_40px_80px_rgba(0,0,0,.8)]"
              />
            </div>
          </div>,
          document.body
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
    <AttachmentSignedMedia attachment={attachment} kind={isImage ? 'image' : 'audio'} onMediaLoaded={onMediaLoaded} />
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

const Avatar: React.FC<{ src?: string | null; name: string; online?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({ src, name, online, size = 'md' }) => {
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

  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const dotSize = size === 'sm' ? 'h-2.5 w-2.5' : size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5';

  return (
    <div className="relative shrink-0">
      {src ? (
        <img
          src={src}
          alt={name}
          className={`${dim} rounded-full object-cover ring-1 ring-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]`}
        />
      ) : (
        <div
          className={`${dim} rounded-full bg-gradient-to-br from-orange-500 via-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold ring-1 ring-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]`}
        >
          {initials}
        </div>
      )}
      {typeof online === 'boolean' && (
        <span className="absolute bottom-0 right-0 flex items-center justify-center">
          {online && (
            <span className={`absolute ${dotSize} rounded-full bg-emerald-400/60 animate-ping`} />
          )}
          <span
            className={`relative block ${dotSize} rounded-full ring-[2.5px] ring-[#0a0f1c] ${online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-slate-500'}`}
          />
        </span>
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

  const [chatTab, setChatTab] = useState<'equipe' | 'ticket'>('equipe');
  const [ticketTyping, setTicketTyping] = useState<Map<string, string>>(new Map());
  const [liveTypingText, setLiveTypingText] = useState('');
  const typingClearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchMember, setSearchMember] = useState('');
  const [readStates, setReadStates] = useState<Map<string, string>>(new Map());
  const [shaking, setShaking] = useState(false);
  const [nudgeFlash, setNudgeFlash] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [roomTypingUsers, setRoomTypingUsers] = useState<Map<string, string[]>>(new Map());
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
    getRooms: (() => [] as ChatRoom[]),
  });

  const membersByUserIdRef = useRef<Map<string, Profile>>(new Map());
  const toastTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const cancelRecordingRef = useRef(false);
  const recordingChunksRef = useRef<Blob[]>([]);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const portalAttendantTypingRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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
      recordingChunksRef.current = []; // reset chunks

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          stream.getTracks().forEach((t) => t.stop());
          if (cancelRecordingRef.current) return;
          const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
          const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
          await handleUploadAttachment(file);
        } finally {
          cancelRecordingRef.current = false;
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(200); // timeslice 200ms — garante chunks frequentes
      setIsRecording(true);
      setIsRecordingPaused(false);
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

  const cleanupPreviewAudio = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    if (previewAudioUrlRef.current) {
      URL.revokeObjectURL(previewAudioUrlRef.current);
      previewAudioUrlRef.current = null;
    }
    setPreviewPlaying(false);
  }, []);

  const handleTogglePreviewPlayback = useCallback(() => {
    // Se já tem áudio carregado, alterna play/pause
    if (previewAudioRef.current) {
      const audio = previewAudioRef.current;
      if (audio.paused) { void audio.play(); setPreviewPlaying(true); }
      else { audio.pause(); setPreviewPlaying(false); }
      return;
    }
    // Constrói o blob a partir dos chunks coletados até agora
    const chunks = recordingChunksRef.current;
    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    previewAudioUrlRef.current = url;
    const audio = new Audio(url);
    audio.onended = () => setPreviewPlaying(false);
    previewAudioRef.current = audio;
    void audio.play();
    setPreviewPlaying(true);
  }, []);

  const handleStopRecording = useCallback(() => {
    cleanupPreviewAudio();
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      if (mr.state === 'paused') mr.resume();
      mr.stop();
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, [cleanupPreviewAudio]);

  const handleCancelRecording = useCallback(() => {
    cleanupPreviewAudio();
    cancelRecordingRef.current = true;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, [cleanupPreviewAudio]);

  const handlePauseRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return;
    try { mr.requestData(); } catch { /* flush pendente */ }
    try { mr.pause(); } catch { /* browser pode não suportar */ }
    setIsRecordingPaused(true);
    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  const handleResumeRecording = useCallback(() => {
    cleanupPreviewAudio();
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return;
    try { mr.resume(); } catch { /* ignora se não suportado */ }
    setIsRecordingPaused(false);
    if (recordingIntervalRef.current) window.clearInterval(recordingIntervalRef.current);
    recordingIntervalRef.current = window.setInterval(() => {
      setRecordingTime((t) => t + 1);
    }, 1000);
  }, [cleanupPreviewAudio]);

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
    window.setTimeout(() => setShaking(false), 1050);
    window.setTimeout(() => setNudgeFlash(null), 3000);
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
      const fromName = me?.name || 'Alguém';
      await chatService.sendNudge({
        toUserId: targetId,
        fromUserId: user.id,
        fromName,
        roomId: selectedRoomId,
      });
      // Registra o nudge na conversa e adiciona ao state local imediatamente
      const sysMsg = await chatService.sendSystemMessage({
        roomId: selectedRoomId,
        userId: user.id,
        content: `⚡ ${fromName} chamou sua atenção`,
      });
      if (sysMsg) {
        setMessages((prev) => prev.some((m) => m.id === sysMsg.id) ? prev : [...prev, sysMsg]);
        pinnedToBottomRef.current = true;
        scrollToBottom('smooth');
      }
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

    // Para salas portal_client, cria canal para broadcast de digitação ao cliente
    const selectedRoom = rooms.find(r => r.id === selectedRoomId);
    if (selectedRoom?.portal_client_id) {
      const portalCh = supabase.channel(`portal-attendant-typing:${selectedRoomId}`);
      portalCh.subscribe();
      portalAttendantTypingRef.current = portalCh;
    }

    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      setTypingUsers([]);
      if (portalAttendantTypingRef.current) {
        supabase.removeChannel(portalAttendantTypingRef.current);
        portalAttendantTypingRef.current = null;
      }
    };
  }, [selectedRoomId, user, rooms]);

  // Typing indicator nas salas — subscibe a todos os canais quando a lista está visível
  useEffect(() => {
    if (selectedRoomId || !user || !rooms.length) {
      setRoomTypingUsers(new Map());
      return;
    }
    const channels = rooms.map((room) =>
      supabase
        .channel(`typing:${room.id}`)
        .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
          const { user_id, name, action } = payload ?? {};
          if (!user_id || user_id === user.id) return;
          setRoomTypingUsers((prev) => {
            const next = new Map(prev);
            const current = next.get(room.id) ?? [];
            if (action === 'start') {
              next.set(room.id, current.includes(name) ? current : [...current, name]);
            } else {
              const filtered = current.filter((n) => n !== name);
              if (filtered.length) next.set(room.id, filtered);
              else next.delete(room.id);
            }
            return next;
          });
        })
        .subscribe()
    );
    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
      setRoomTypingUsers(new Map());
    };
  }, [selectedRoomId, user, rooms]);

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
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

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

      if (list.length === 0) {
        setNotifyCount(0);
        setRoomUnreadCounts(new Map());
        setLastUnreadImageSender(null);
      }

      // Buscar última mensagem de salas sem preview
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

      // Initialize unread=1 for portal ticket rooms appearing for the first time this session.
      // These rooms don't have entries in chat_room_members (team-chat table), so loadRoomUnreadCounts
      // always returns 0 for them. Rooms the staff has already read (count=0 tracked) are kept at 0.
      setRoomUnreadCounts((prev) => {
        const next = new Map(prev);
        for (const room of list) {
          if (room.portal_client_id && !room.created_by && room.last_message_at && !prev.has(room.id)) {
            next.set(room.id, 1);
          }
        }
        return next;
      });

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

    // O banco é a fonte de verdade — substitui completamente o mapa local.
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
    void portalAttendantTypingRef.current?.send({
      type: 'broadcast', event: 'typing', payload: { typing: false },
    });
    if (typingTimeoutRef.current) { window.clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current = null; }
    setSendingMessage(true);
    const pendingReplyTo = replyTo;
    try {
      // Auto-aceita ticket ao enviar primeira mensagem (evita responder sem aceitar)
      // A mensagem de sistema "Atendimento iniciado" chega ao cliente ANTES da resposta
      if (selectedRoom?.portal_client_id && !selectedRoom?.accepted_by && !selectedRoom?.created_by) {
        await supabase.rpc('portal_accept_ticket', { p_room_id: selectedRoomId });
        const list = await chatService.listRooms(user.id);
        setRooms(list);
      }

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

  // Typing preview: subscreve aos canais de digitação das salas ticket
  useEffect(() => {
    if (!user) return;
    const ticketRooms = rooms.filter(r => r.portal_client_id && !r.created_by);
    if (!ticketRooms.length) return;

    const channels = ticketRooms.map(room => {
      const ch = supabase.channel(`portal-typing:${room.id}`);
      ch.on('broadcast', { event: 'typing' }, (payload: any) => {
        const typingText = (payload?.payload?.text ?? '').trim();

        // Cancela timer anterior
        const prev = typingClearTimers.current.get(room.id);
        if (prev) clearTimeout(prev);

        setTicketTyping(prev => { const n = new Map(prev); n.set(room.id, typingText); return n; });
        if (selectedRoomId === room.id) setLiveTypingText(typingText);

        // Auto-limpa após 4s sem atualização
        if (typingText) {
          const t = setTimeout(() => {
            setTicketTyping(prev => { const n = new Map(prev); n.set(room.id, ''); return n; });
            if (selectedRoomId === room.id) setLiveTypingText('');
          }, 4000);
          typingClearTimers.current.set(room.id, t);
        }
      }).subscribe();
      return ch;
    });

    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [rooms, user, selectedRoomId]);

  // Atualiza live typing quando troca de sala ou ticketTyping muda
  useEffect(() => {
    setLiveTypingText((ticketTyping.get(selectedRoomId ?? '') ?? '').trim());
  }, [selectedRoomId, ticketTyping]);

  // Limpa typing preview quando o cliente porta envia uma mensagem
  useEffect(() => {
    if (!selectedRoomId || !messages.length) return;
    const last = messages[messages.length - 1];
    // Só limpa quando a última mensagem é do cliente (user_id !== atendente)
    if (last?.user_id === user?.id) return;
    setLiveTypingText('');
    setTicketTyping(prev => {
      const n = new Map(prev);
      n.set(selectedRoomId, '');
      return n;
    });
  }, [messages, selectedRoomId, user?.id]);

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

  // Ao abrir o widget, rola para o fim — o painel usa {open && ...} então o DOM
  // só existe após open=true. O delay garante que o ref já está montado.
  useEffect(() => {
    if (!open || !selectedRoomId) return;
    pinnedToBottomRef.current = true;
    const t = setTimeout(() => scrollToBottom('auto'), 60);
    return () => clearTimeout(t);
  }, [open, selectedRoomId, scrollToBottom]);

  // Quando alguém começa a digitar, rola para mostrar o indicador (se estava no fim)
  useEffect(() => {
    if (!typingUsers.length) return;
    if (!pinnedToBottomRef.current) return;
    scrollToBottom('smooth');
  }, [typingUsers.length, scrollToBottom]);

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
          // Mensagens de sistema (nudge, eventos) só aparecem na conversa, sem toast/badge
          if (msg.is_system) {
            const currentRoom = selectedRoomIdRef.current;
            if (msg.room_id === currentRoom) {
              setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
              if (pinnedToBottomRef.current) stableCallbacksRef.current.scrollBottom('smooth');
            }
            return;
          }

          // ── Filtro de visibilidade: tickets aceitos por outro atendente ────
          // Portal messages têm user_id = null. Só notifica se a sala está na
          // lista visível deste usuário (accepted_by IS NULL ou accepted_by = eu).
          const visibleRooms = stableCallbacksRef.current.getRooms();
          const roomVisible = visibleRooms.some((r) => r.id === msg.room_id);
          if (!roomVisible) {
            // Sala desconhecida — recarrega sempre: pode ser ticket novo (portal)
            // ou sala de equipe criada enquanto o widget estava ativo.
            stableCallbacksRef.current.loadRooms();
            return;
          }

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
            setRooms((prev) => prev
              .map((r) => r.id === msg.room_id ? { ...r, last_message_at: msg.created_at, last_message_preview: getPreview(msg.content) } : r)
              .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))
            );
            return;
          }

          // ── Mensagem de outra sala visível ────────────────────────────────
          if (!isMine) {
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

            const profile = membersByUserIdRef.current.get(msg.user_id ?? '');
            // Para mensagens de portal (user_id = null), usa o nome da sala (nome do cliente)
            const isPortalMsg = msg.user_id === null;
            const roomForMsg = isPortalMsg ? visibleRooms.find((r) => r.id === msg.room_id) : null;
            const senderName = profile?.name || roomForMsg?.name || 'Cliente';
            const avatarUrl = profile?.avatar_url;
            const preview = getPreview(msg.content);
            const attachment = parseAttachment(msg.content);
            const isImageAttachment = !!attachment && String(attachment.mimeType || '').startsWith('image/');

            if (isImageAttachment) setLastUnreadImageSender({ name: senderName, avatarUrl });

            setToast({ id: msg.id, roomId: msg.room_id, senderUserId: msg.user_id, senderName, avatarUrl, senderRole: profile?.role, senderOab: profile?.oab, preview });
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = window.setTimeout(() => setToast(null), 7000);

            if (msg.user_id && !profile) {
              void profileService.getProfile(msg.user_id).then((p) => {
                if (!p) return;
                membersByUserIdRef.current.set(msg.user_id!, p);
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
          setRooms((prev) => prev
            .map((r) => r.id === msg.room_id ? { ...r, last_message_at: msg.created_at, last_message_preview: getPreview(msg.content) } : r)
            .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))
          );
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

  // Remove salas do widget quando outro atendente aceitar o ticket
  useEffect(() => {
    if (!user) return;
    const unsub = chatService.subscribeToTicketRoomUpdates({
      onUpdate: (updatedRoom) => {
        const acceptedByOther =
          updatedRoom.accepted_by != null &&
          updatedRoom.accepted_by !== user.id;

        if (acceptedByOther) {
          setRooms((prev) => prev.filter((r) => r.id !== updatedRoom.id));
          setSelectedRoomId((prev) => (prev === updatedRoom.id ? null : prev));
          setRoomUnreadCounts((prev) => {
            const next = new Map(prev);
            next.delete(updatedRoom.id);
            return next;
          });
          // Decrement notifyCount by what this room contributed so the badge clears.
          // We use a functional update reading the removed room's count before deletion.
          setNotifyCount((prev) => Math.max(0, prev - 1));
        } else {
          setRooms((prev) =>
            prev.map((r) => (r.id === updatedRoom.id ? { ...r, ...updatedRoom } : r)),
          );
        }
      },
    });
    return () => unsub();
  }, [user]);

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
    getRooms: () => rooms,
  };

  const getEffectiveRoomUnread = useCallback((room: ChatRoom) => {
    return Number(roomUnreadCounts.get(room.id) ?? 0);
  }, [roomUnreadCounts]);

  const totalUnreadFromRooms = useMemo(() => {
    let total = 0;
    rooms.forEach((room) => {
      total += getEffectiveRoomUnread(room);
    });
    return total;
  }, [rooms, getEffectiveRoomUnread]);

  const toastVerified = useMemo(() => {
    if (!toast) return null;
    return getVerifiedVariant({ role: toast.senderRole || '', oab: toast.senderOab ?? null });
  }, [toast]);

  // Sala não lida mais recente — usada para mostrar a foto persistente no launcher
  const topUnreadRoom = useMemo(() => {
    const unreadRooms = rooms.filter((r) => getEffectiveRoomUnread(r) > 0);
    unreadRooms.sort((a, b) => {
      const at = a.last_message_at ?? a.created_at;
      const bt = b.last_message_at ?? b.created_at;
      return bt.localeCompare(at);
    });
    return unreadRooms[0] ?? null;
  }, [rooms, getEffectiveRoomUnread]);

  // Caminhos das imagens da conversa, em ordem — alimenta o slider do viewer.
  // Declarado antes de qualquer early return para respeitar as regras de hooks.
  const imageFilePaths = useMemo(
    () => messages
      .map(m => parseAttachment(m.content))
      .filter((a): a is ChatAttachmentPayload => !!a && a.mimeType.startsWith('image/'))
      .map(a => a.filePath),
    [messages],
  );

  // Oculto no módulo de chat interno e no WhatsApp (lá o widget cobriria o
  // campo de digitação da conversa, sobrepondo o botão de enviar).
  const visible = !!user && currentModule !== 'chat' && currentModule !== 'whatsapp';
  if (!visible) return null;

  const selectedRoom = selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) : null;
  const otherUser = selectedRoom ? getOtherUserForRoom(selectedRoom) : null;
  const displayName = otherUser?.name || selectedRoom?.name || '';
  const avatarUrl = otherUser?.avatar_url || (selectedRoom as any)?.portal_client_avatar || null;
  // Para salas portal: "online" se houve mensagem nos últimos 10 min
  const portalRecentlyActive = !!selectedRoom?.portal_client_id &&
    !!selectedRoom.last_message_at &&
    (Date.now() - new Date(selectedRoom.last_message_at).getTime()) < 10 * 60 * 1000;
  const headerOnline = otherUser ? onlineUserIds.has(otherUser.user_id) : portalRecentlyActive;
  // totalUnreadFromRooms is updated optimistically by realtime handlers, so it's
  // always accurate. notifyCount is a session-only increment that can become stale
  // (e.g. after acceptedByOther removes the room), so we don't use Math.max here.
  const badgeCount = totalUnreadFromRooms;
  const topUnreadUser = topUnreadRoom ? getOtherUserForRoom(topUnreadRoom) : null;

  const showToast = !!toast && (!open || !selectedRoomId || toast.roomId !== selectedRoomId);
  const headerVerified = getVerifiedVariant(otherUser);

  if (hidden) return null;

  return createPortal(
    <ChatImagesContext.Provider value={imageFilePaths}>
    <div className="fixed bottom-5 right-4 sm:bottom-5 sm:right-5 z-[9999] flex flex-col items-end" style={{ isolation: 'isolate' }}>
      <style>{`
        @keyframes chatShake{0%{transform:translate(0,0) rotate(0) scale(1)}4%{transform:translate(-9px,5px) rotate(-3deg) scale(1.02)}8%{transform:translate(9px,-5px) rotate(3deg) scale(1.02)}12%{transform:translate(-9px,-5px) rotate(-3deg) scale(1.02)}16%{transform:translate(9px,5px) rotate(3deg) scale(1.02)}20%{transform:translate(-8px,-4px) rotate(-2.5deg) scale(1.01)}24%{transform:translate(8px,4px) rotate(2.5deg) scale(1.01)}28%{transform:translate(-7px,-3px) rotate(-2deg)}32%{transform:translate(7px,3px) rotate(2deg)}38%{transform:translate(-5px,-2px) rotate(-1.5deg)}44%{transform:translate(5px,2px) rotate(1.5deg)}52%{transform:translate(-3px,-1px) rotate(-1deg)}62%{transform:translate(3px,1px) rotate(0.5deg)}74%{transform:translate(-1px,0) rotate(0)}86%{transform:translate(1px,0)}100%{transform:translate(0,0) rotate(0) scale(1)}}
        @keyframes chatShakeGlow{0%,100%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.08)}8%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.5),0 0 40px 12px rgba(251,146,60,.35),inset 0 1px 0 rgba(255,255,255,.08)}22%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.4),0 0 28px 8px rgba(251,146,60,.25),inset 0 1px 0 rgba(255,255,255,.08)}40%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.25),0 0 16px 4px rgba(251,146,60,.15),inset 0 1px 0 rgba(255,255,255,.08)}65%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.12),0 0 8px 2px rgba(251,146,60,.08),inset 0 1px 0 rgba(255,255,255,.08)}}
        @keyframes chatNudgeBanner{0%{opacity:0;transform:translateY(-100%) scaleX(.9)}40%{opacity:1;transform:translateY(4px) scaleX(1.01)}65%{transform:translateY(-2px) scaleX(.999)}80%{transform:translateY(1px)}100%{opacity:1;transform:translateY(0) scaleX(1)}}
        @keyframes chatNudgeRing1{0%{box-shadow:0 0 0 0 rgba(251,146,60,.65);opacity:1}100%{box-shadow:0 0 0 48px rgba(251,146,60,0);opacity:0}}
        @keyframes chatNudgeRing2{0%{box-shadow:0 0 0 0 rgba(251,146,60,.4);opacity:1}100%{box-shadow:0 0 0 72px rgba(251,146,60,0);opacity:0}}
        @keyframes chatNudgeFlash{0%{opacity:.22}100%{opacity:0}}
        @keyframes chatPanelIn{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes chatGlowPulse{0%,100%{box-shadow:0 0 0 0 rgba(251,146,60,0)}50%{box-shadow:0 0 0 8px rgba(251,146,60,.15)}}
        @keyframes chatLauncherGlow{0%,100%{box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 0 0 rgba(251,146,60,.4)}50%{box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 0 12px rgba(251,146,60,0)}}
        @keyframes chatTypingDot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-3px);opacity:1}}
        @keyframes chatToastIn{0%{opacity:0;transform:translateY(20px) scale(.92)}55%{opacity:1;transform:translateY(-4px) scale(1.02)}75%{transform:translateY(2px) scale(.995)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes chatToastOut{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(10px) scale(.95)}}
        @keyframes chatToastProgress{0%{transform:scaleX(1)}100%{transform:scaleX(0)}}
        @keyframes chatWaveBar{0%,100%{transform:scaleY(.22);opacity:.45}50%{transform:scaleY(1);opacity:1}}
        .chat-scrollbar::-webkit-scrollbar{width:6px}
        .chat-scrollbar::-webkit-scrollbar-track{background:transparent}
        .chat-scrollbar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}
        .chat-scrollbar::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.15)}
      `}</style>
      {open && (
        <div className="relative mb-3">
          {/* Anéis de pulso — expandem para fora do painel durante o shake */}
          {shaking && <>
            <div className="absolute inset-0 rounded-[24px] pointer-events-none"
              style={{ animation: 'chatNudgeRing1 0.65s ease-out both' }} />
            <div className="absolute inset-0 rounded-[24px] pointer-events-none"
              style={{ animation: 'chatNudgeRing2 0.75s 0.08s ease-out both' }} />
          </>}
        <div
          className="w-[380px] max-w-[calc(100vw-24px)] rounded-[24px] text-white overflow-hidden flex flex-col h-[520px] max-h-[calc(100vh-120px)] relative"
          style={{
            ...(shaking
              ? { animation: 'chatShake 1s cubic-bezier(.36,.07,.19,.97) both, chatShakeGlow 1s ease-out both' }
              : { animation: 'chatPanelIn 360ms cubic-bezier(.22,1,.36,1) both' }),
            background:
              'linear-gradient(180deg, rgba(15,23,42,.97) 0%, rgba(10,15,28,.98) 100%)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            boxShadow:
              '0 40px 80px -20px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.06), inset 0 1px 0 rgba(255,255,255,.08)',
          }}
        >
          {/* Brilho sutil no topo */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-32"
            style={{
              background:
                'radial-gradient(80% 100% at 50% 0%, rgba(251,146,60,.12) 0%, transparent 70%)',
            }}
          />
          {/* Flash laranja no início do shake */}
          {shaking && (
            <div
              aria-hidden
              className="absolute inset-0 z-50 pointer-events-none rounded-[24px]"
              style={{
                background: 'radial-gradient(ellipse at 50% 30%, rgba(251,146,60,.28) 0%, rgba(251,146,60,.08) 60%, transparent 100%)',
                animation: 'chatNudgeFlash 0.5s ease-out both',
              }}
            />
          )}
          {nudgeFlash && (
            <div
              className="px-4 py-2.5 shrink-0 flex items-center justify-center gap-2 text-white text-xs font-bold text-center"
              style={{
                animation: 'chatNudgeBanner 0.45s cubic-bezier(.22,1,.36,1) both',
                background: 'linear-gradient(90deg, #f59e0b 0%, #f97316 50%, #f59e0b 100%)',
                backgroundSize: '200% 100%',
              }}
            >
              <Zap className="w-3.5 h-3.5" style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,.6))' }} />
              <span style={{ textShadow: '0 1px 4px rgba(0,0,0,.3)' }}>{nudgeFlash} está te chamando!</span>
              <Zap className="w-3.5 h-3.5" style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,.6))' }} />
            </div>
          )}
          <div className="relative px-4 py-3.5 flex items-center justify-between shrink-0 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {selectedRoomId ? (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedRoomId(null)}
                    className="h-9 w-9 rounded-xl hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center justify-center shrink-0 text-white/70 hover:text-white"
                    title="Voltar"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  {displayName && (
                    <Avatar
                      src={avatarUrl}
                      name={displayName}
                      online={selectedRoom?.is_public ? undefined : headerOnline}
                      size="sm"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[14px] font-semibold tracking-tight truncate max-w-[160px]">{displayName}</span>
                      {headerVerified && <VerifiedBadge variant={headerVerified} />}
                    </div>
                    {(otherUser || selectedRoom?.portal_client_id) && !selectedRoom?.is_public && (
                      <span className={`flex items-center gap-1.5 text-[11px] font-medium mt-0.5 ${headerOnline ? 'text-emerald-400' : 'text-white/40'}`}>
                        {headerOnline
                          ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.7)] animate-pulse" />Ativo agora</>
                          : selectedRoom?.portal_client_id
                            ? 'Aguardando'
                            : otherUser?.last_seen_at
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
                    className="h-9 w-9 rounded-xl hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center justify-center shrink-0 text-white/70 hover:text-white"
                    title="Voltar"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[15px] font-semibold tracking-tight truncate">Nova Conversa</span>
                </>
              ) : (
                <>
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-[0_4px_12px_rgba(251,146,60,.35)]">
                    <MessageCircle className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold tracking-tight">Mensagens</span>
                      {badgeCount > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white text-[11px] font-bold shadow-[0_2px_6px_rgba(239,68,68,.5)]">
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-white/40 font-medium">
                      {(() => {
                        const equipe = rooms.filter(r => !r.portal_client_id).length;
                        // Only count open tickets (same filter as the TICKET tab render)
                        const ticket = rooms.filter(r => !!r.portal_client_id && !r.created_by).length;
                        const parts: string[] = [];
                        if (equipe > 0) parts.push(`${equipe} equipe`);
                        if (ticket > 0) parts.push(`${ticket} ticket${ticket !== 1 ? 's' : ''}`);
                        return parts.length > 0 ? parts.join(' · ') : '0 conversas';
                      })()}
                    </span>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* Botões de ação — salas ticket */}
              {selectedRoomId && selectedRoom?.portal_client_id && (
                <>
                  {/* Aceitar ticket — só se não foi aceito ainda e está aberto */}
                  {!selectedRoom.accepted_by && !selectedRoom.created_by && (
                    <button
                      type="button"
                      title="Aceitar atendimento"
                      onClick={async () => {
                        if (!user) return;
                        await supabase.rpc('portal_accept_ticket', { p_room_id: selectedRoomId });
                        const list = await chatService.listRooms(user.id);
                        setRooms(list);
                      }}
                      className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 active:scale-95 transition-all duration-150 text-[12px] font-semibold"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Aceitar
                    </button>
                  )}
                  {/* Encerrar / Reabrir */}
                  <button
                    type="button"
                    title={selectedRoom.created_by ? 'Reabrir conversa' : 'Encerrar atendimento'}
                    onClick={async () => {
                      if (!user) return;
                      if (selectedRoom.created_by) {
                        await supabase.rpc('portal_reopen_chat_room', { p_room_id: selectedRoomId });
                      } else {
                        const farewell = buildPortalFarewellMessage(selectedRoom.name);
                        await chatService.sendMessage({ roomId: selectedRoomId, userId: user.id, content: farewell });
                        await supabase.rpc('portal_close_chat_room', { p_room_id: selectedRoomId, p_closed_by: user.id });
                      }
                      const list = await chatService.listRooms(user.id);
                      setRooms(list);
                    }}
                    className={`h-9 w-9 rounded-xl active:scale-95 transition-all duration-150 flex items-center justify-center ${
                      selectedRoom.created_by
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : 'bg-[#f8f7f5]/[0.04] text-white/50 hover:bg-rose-500/20 hover:text-rose-400'
                    }`}
                  >
                    {selectedRoom.created_by ? <RotateCcw className="w-4 h-4" /> : <PhoneOff className="w-4 h-4" />}
                  </button>
                </>
              )}
              {!selectedRoomId && !showNewChatModal && (
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  className="h-9 w-9 rounded-xl bg-[#f8f7f5]/[0.04] hover:bg-orange-500/15 hover:text-orange-300 active:scale-95 transition-all duration-150 flex items-center justify-center text-white/70"
                  title="Nova Conversa"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
              )}
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
                className="h-9 w-9 rounded-xl hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center justify-center text-white/70 hover:text-white"
                title="Abrir Chat"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSelectedRoomId(null);
                }}
                className="h-9 w-9 rounded-xl hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center justify-center text-white/70 hover:text-white"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!selectedRoomId ? (
            showNewChatModal ? (
              <>
                <div className="px-4 py-3 border-b border-white/[0.06]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                    <input
                      type="text"
                      value={searchMember}
                      onChange={(e) => setSearchMember(e.target.value)}
                      placeholder="Buscar pessoa..."
                      autoFocus
                      className="w-full pl-9 pr-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-[13px] text-white placeholder-white/30 focus:outline-none focus:border-orange-500/60 focus:bg-white/[0.06] transition-all"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto chat-scrollbar py-1">
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
                          className="w-full mx-2 px-3 py-2.5 flex items-center gap-3 text-left rounded-xl hover:bg-white/[0.06] active:scale-[0.99] transition-all duration-150"
                          style={{ width: 'calc(100% - 16px)' }}
                        >
                          <Avatar src={member.avatar_url} name={member.name} online={online} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="text-[13px] font-semibold truncate">{member.name}</div>
                              {verified && <VerifiedBadge variant={verified} />}
                            </div>
                            <div className={`text-[11px] truncate mt-0.5 ${online ? 'text-emerald-400 font-medium' : 'text-white/40'}`}>
                              {online ? '● Online' : member.role || 'Offline'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  {members.filter((m) => m.user_id !== user?.id).length === 0 && (
                    <div className="p-8 text-sm text-white/50 text-center">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      Nenhuma pessoa cadastrada
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
              {/* ── Tabs EQUIPE | TICKET ── */}
              {(() => {
                const ticketRooms = rooms.filter(r => r.portal_client_id);
                const ticketUnread = ticketRooms.reduce((s, r) => s + getEffectiveRoomUnread(r), 0);
                return (
                  <div className="flex shrink-0 border-b border-white/[0.06] mx-3 mb-1">
                    {(['equipe', 'ticket'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setChatTab(tab)}
                        className={`relative flex-1 py-2.5 text-[12px] font-semibold tracking-wide uppercase transition-colors ${
                          chatTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
                        }`}
                      >
                        {tab === 'equipe' ? 'Equipe' : 'Ticket'}
                        {tab === 'ticket' && ticketUnread > 0 && (
                          <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-white text-[9px] font-bold">
                            {ticketUnread > 9 ? '9+' : ticketUnread}
                          </span>
                        )}
                        {chatTab === tab && (
                          <span className="absolute bottom-0 left-1/4 right-1/4 h-[2px] rounded-full bg-orange-500" />
                        )}
                      </button>
                    ))}
                  </div>
                );
              })()}

              <div className="flex-1 overflow-y-auto chat-scrollbar py-1">
                {loadingRooms && rooms.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/50">
                    <div className="w-4 h-4 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
                    Carregando...
                  </div>
                ) : rooms.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 flex items-center justify-center mb-3 ring-1 ring-orange-500/20">
                      <MessageCircle className="w-7 h-7 text-orange-400/80" />
                    </div>
                    <p className="text-sm font-semibold text-white/80">Nenhuma conversa</p>
                    <p className="text-xs text-white/40 mt-1">Clique em + para iniciar</p>
                  </div>
                ) : (
                  [...rooms]
                  .filter(r => chatTab === 'ticket'
                    ? !!r.portal_client_id && !r.created_by  // ticket: só abertas
                    : !r.portal_client_id                     // equipe: sem portal
                  )
                  .sort((a, b) => {
                    const ua = getEffectiveRoomUnread(a);
                    const ub = getEffectiveRoomUnread(b);
                    if ((ua > 0) !== (ub > 0)) return ua > 0 ? -1 : 1;
                    const at = a.last_message_at ?? a.created_at;
                    const bt = b.last_message_at ?? b.created_at;
                    return bt.localeCompare(at);
                  }).map((room) => {
                  const isTicketRoom = !!room.portal_client_id;
                  const otherUser = isTicketRoom ? null : getOtherUserForRoom(room);
                  const displayName = otherUser?.name || room.name;
                  const avatarUrl = isTicketRoom ? null : otherUser?.avatar_url;
                  const online = otherUser ? onlineUserIds.has(otherUser.user_id) : false;
                  const verified = isTicketRoom ? null : getVerifiedVariant(otherUser);
                  const roomUnread = getEffectiveRoomUnread(room);
                  const subtitle = room.is_public
                    ? `${room.type === 'team' ? 'Grupo' : 'Sala'} · ${(roomMembers.get(room.id) ?? []).length || ''} membros`
                    : online
                      ? 'Online agora'
                      : otherUser?.last_seen_at
                        ? `visto ${formatLastSeen(otherUser.last_seen_at).replace(/^Online /, '').replace(/^Online$/, 'agora')}`
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
                      className={`group w-full mx-2 px-3 py-2.5 flex items-center gap-3 text-left rounded-xl active:scale-[0.99] transition-all duration-150 ${
                        roomUnread > 0
                          ? 'bg-gradient-to-r from-orange-500/[0.08] to-transparent hover:from-orange-500/[0.12]'
                          : 'hover:bg-white/[0.05]'
                      }`}
                      style={{ width: 'calc(100% - 16px)' }}
                    >
                      {isTicketRoom ? (
                        <div className="relative shrink-0">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white text-[13px] font-bold shadow-[0_2px_8px_rgba(251,146,60,.4)]">
                            {displayName.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-orange-500 border-2 border-[#1e1e2e]" />
                        </div>
                      ) : (
                        <Avatar src={avatarUrl} name={displayName} online={room.is_public ? undefined : online} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <div className={`text-[13px] truncate ${roomUnread > 0 ? 'font-bold text-white' : 'font-semibold text-white/95'}`}>{displayName}</div>
                            {verified && <VerifiedBadge variant={verified} />}
                          </div>
                          <div className={`text-[10px] shrink-0 ${roomUnread > 0 ? 'text-orange-300 font-semibold' : 'text-white/40'}`}>
                            {room.last_message_at ? new Date(room.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <div className={`text-[11.5px] truncate ${roomUnread > 0 ? 'text-white/85 font-medium' : 'text-white/50'}`}>
                            {/* Preview de digitação do cliente */}
                            {isTicketRoom && (ticketTyping.get(room.id) ?? '').trim() ? (
                              <span className="flex items-center gap-1 text-orange-400/90 font-medium italic">
                                <span className="inline-flex gap-[2px] items-center">
                                  {[0,1,2].map(i => <span key={i} className="w-1 h-1 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                                </span>
                                {ticketTyping.get(room.id)!.slice(0, 30)}{(ticketTyping.get(room.id)?.length ?? 0) > 30 ? '…' : ''}
                              </span>
                            ) : (roomTypingUsers.get(room.id)?.length ?? 0) > 0 ? (
                              <span className="flex items-center gap-1.5 text-emerald-400">
                                {roomTypingUsers.get(room.id)!.length === 1
                                  ? 'digitando'
                                  : 'várias pessoas digitando'}
                                <span className="flex gap-[3px] items-center">
                                  {[0, 1, 2].map((i) => (
                                    <span key={i} className="block w-1 h-1 bg-emerald-400 rounded-full"
                                      style={{ animation: `chatTypingDot 1.2s ease-in-out ${i * 0.15}s infinite` }} />
                                  ))}
                                </span>
                              </span>
                            ) : (preview || subtitle)}
                          </div>
                          {roomUnread > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white text-[10px] font-bold shrink-0 shadow-[0_2px_8px_rgba(251,146,60,.4)]">
                              {roomUnread > 99 ? '99+' : roomUnread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
                )}
              </div>
              </>
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
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-0.5 min-h-[200px] relative chat-scrollbar"
              >
                {/* Overlay drag & drop */}
                {isDragging && (
                  <div className="absolute inset-2 z-10 bg-orange-500/15 border-2 border-dashed border-orange-400 rounded-2xl flex flex-col items-center justify-center gap-2 pointer-events-none backdrop-blur-sm">
                    <Paperclip className="w-8 h-8 text-orange-300" />
                    <span className="text-sm font-semibold text-orange-200">Solte para enviar</span>
                  </div>
                )}

                {loadingMessages && messages.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-white/50 py-8 justify-center">
                    <div className="w-4 h-4 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
                    Carregando mensagens...
                  </div>
                ) : !loadingMessages && messages.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-white/50">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/15 to-amber-500/5 flex items-center justify-center ring-1 ring-orange-500/20">
                      <MessageCircle className="w-8 h-8 text-orange-400/70" />
                    </div>
                    <span className="text-sm font-semibold text-white/80">Nenhuma mensagem ainda</span>
                    <span className="text-xs text-white/40">Seja o primeiro a escrever 👋</span>
                  </div>
                ) : (() => {
                  const otherReads = Array.from(readStates.entries())
                    .filter(([uid]) => uid !== user?.id)
                    .map(([, ts]) => ts)
                    .sort();
                  const otherReadAt = otherReads.length ? otherReads[otherReads.length - 1] : null;
                  let lastDayKey = '';

                  const toTitleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
                  return messages.map((msg) => {
                    const isMine = msg.user_id === user?.id;
                    const isDeleted = !!msg.deleted_at;
                    const sender = membersByUserIdRef.current.get(msg.user_id) || members.find((m) => m.user_id === msg.user_id);
                    // Salas portal: mensagens do cliente têm user_id nulo — usa nome da sala
                    const isPortalClientMsg = !!selectedRoom?.portal_client_id && !msg.user_id;
                    const senderName = isMine
                      ? 'Você'
                      : sender?.name
                        || (isPortalClientMsg ? toTitleCase(selectedRoom?.name || 'Cliente') : 'Usuário');
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
                          <div className="flex items-center gap-3 py-3 my-1">
                            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                            <span className="text-[10px] text-white/40 font-semibold tracking-wider uppercase px-2 shrink-0">
                              {formatDateSeparator(msg.created_at)}
                            </span>
                            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                          </div>
                        )}
                        {/* ── Mensagem de sistema (nudge, eventos) ── */}
                        {msg.is_system ? (
                          <div className="flex items-center justify-center py-1.5 px-4 my-0.5">
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 ring-1 ring-amber-500/20">
                              <span className="text-[11px] text-amber-300/80 font-medium">{msg.content}</span>
                            </div>
                          </div>
                        ) : (
                        <div
                          className={`group flex flex-col min-w-0 mb-1.5 ${isMine ? 'items-end' : 'items-start'} ${isNew ? 'animate-in slide-in-from-left-2 fade-in duration-300' : ''}`}
                        >
                          {!isMine && (
                            <div className="text-[10px] text-white/50 font-medium mb-0.5 ml-2.5">{senderName}</div>
                          )}

                          {/* Reply preview */}
                          {replyMsg && !isDeleted && (
                            <div className={`mb-1 px-2.5 py-1.5 rounded-xl border-l-2 border-orange-400 bg-[#f8f7f5]/[0.04] max-w-[80%] ${isMine ? 'mr-1' : 'ml-1'}`}>
                              <div className="text-[10px] text-orange-300 font-semibold truncate">
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
                                className="opacity-0 group-hover:opacity-100 transition-all duration-150 h-7 w-7 rounded-full bg-[#f8f7f5]/[0.04] hover:bg-orange-500/15 hover:text-orange-300 flex items-center justify-center shrink-0 mb-1 text-white/50"
                                title="Responder"
                              >
                                <Reply className="w-3 h-3" />
                              </button>
                            )}
                            <div
                              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug transition-all overflow-hidden ${
                                isDeleted
                                  ? 'bg-[#f8f7f5]/[0.04] text-white/30 italic ring-1 ring-white/5'
                                  : isMine
                                    ? 'bg-slate-700/75 text-white rounded-br-md ring-1 ring-white/[0.07] shadow-[0_2px_8px_rgba(0,0,0,.3)]'
                                    : 'bg-gradient-to-br from-orange-500 to-amber-600 text-white rounded-bl-md shadow-[0_4px_16px_-4px_rgba(251,146,60,.55),inset_0_1px_0_rgba(255,255,255,.18)]'
                              }`}
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
                                className="opacity-0 group-hover:opacity-100 transition-all duration-150 h-7 w-7 rounded-full bg-[#f8f7f5]/[0.04] hover:bg-orange-500/15 hover:text-orange-300 flex items-center justify-center shrink-0 mb-1 text-white/50"
                                title="Responder"
                              >
                                <Reply className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          <div className={`text-[10px] text-white/35 mt-1 flex items-center gap-1 ${isMine ? 'mr-9' : 'ml-9'}`}>
                            {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {msg.edited_at && !isDeleted && <span className="text-white/25">· editada</span>}
                            {isMine && !isDeleted && (
                              <span
                                className={`ml-0.5 ${seen ? 'text-sky-400' : 'text-white/35'}`}
                                title={seen ? 'Visualizada' : 'Enviada'}
                              >
                                {seen ? '✓✓' : '✓'}
                              </span>
                            )}
                          </div>
                        </div>
                        )} {/* fecha ternário is_system */}
                      </React.Fragment>
                    );
                  });
                })()}

              </div>

              {/* Scroll to bottom button */}
              {showScrollBottom && (
                <div className="absolute bottom-[82px] right-3 z-10">
                  <button
                    type="button"
                    onClick={() => { pinnedToBottomRef.current = true; scrollToBottom('smooth'); }}
                    className="h-9 w-9 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 hover:scale-110 active:scale-95 shadow-[0_8px_24px_-4px_rgba(251,146,60,.6)] ring-1 ring-white/20 flex items-center justify-center transition-transform duration-150"
                    title="Ir para o fim"
                  >
                    <ChevronDown className="w-4 h-4 text-white" />
                  </button>
                </div>
              )}

              <div className="shrink-0">
                {/* Live typing preview do cliente portal */}
                {selectedRoom?.portal_client_id && liveTypingText.trim() && (
                  <div className="flex items-end gap-2 px-3 pt-2 pb-0.5">
                    <div className="max-w-[75%] flex flex-col items-start">
                      <span className="text-[10px] text-white/40 mb-1 ml-1">escrevendo…</span>
                      <div className="bg-slate-700 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[13px] text-white/70 italic leading-relaxed">
                        {liveTypingText.length > 80 ? liveTypingText.slice(0, 80) + '…' : liveTypingText}
                      </div>
                    </div>
                  </div>
                )}
                {/* Typing indicator — fora do scroll, sempre visível acima da barra de input */}
                {typingUsers.length > 0 && (
                  <div className="flex items-center px-3 pt-1.5 pb-0.5">
                    <div className="flex gap-1.5 items-center bg-slate-700/80 ring-1 ring-white/[0.06] rounded-2xl px-3 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,.2)]">
                      <span className="text-[11.5px] text-white/70 font-medium">
                        {typingUsers.length === 1 ? `${typingUsers[0]} está digitando` : 'Várias pessoas digitando'}
                      </span>
                      <div className="flex gap-1 items-center ml-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="block w-1.5 h-1.5 bg-orange-400 rounded-full"
                            style={{ animation: `chatTypingDot 1.2s ease-in-out ${i * 0.15}s infinite` }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Reply preview bar */}
                {replyTo && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-orange-500/[0.08] to-transparent border-t border-white/[0.06]">
                    <div className="flex-1 min-w-0 border-l-2 border-orange-400 pl-2.5">
                      <div className="text-[10px] text-orange-300 font-semibold tracking-wide">
                        Respondendo a {replyTo.user_id === user?.id ? 'você mesmo' : (membersByUserIdRef.current.get(replyTo.user_id)?.name || 'Usuário')}
                      </div>
                      <div className="text-[11px] text-white/60 truncate mt-0.5">{getPreview(replyTo.content)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="h-7 w-7 rounded-full hover:bg-white/10 active:scale-95 flex items-center justify-center shrink-0 transition-all"
                    >
                      <X className="w-3.5 h-3.5 text-white/60" />
                    </button>
                  </div>
                )}

              <div className="p-3 border-t border-white/[0.06] bg-gradient-to-t from-black/20 to-transparent">
                {/* ── Barra de gravação estilo WhatsApp ── */}
                {isRecording ? (
                  <div className="flex items-center gap-2" style={{ animation: 'chatPanelIn 220ms cubic-bezier(.22,1,.36,1) both' }}>

                    {isRecordingPaused ? (
                      /* ── ESTADO: PAUSADO ── */
                      <div className="flex flex-col gap-1.5 w-full">
                        {/* Linha 1: lixeira + waveform com play inline */}
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={handleCancelRecording}
                            className="shrink-0 h-9 w-9 rounded-full bg-[#f8f7f5]/[0.06] hover:bg-red-500/20 text-white/40 hover:text-red-400 flex items-center justify-center transition-all active:scale-90"
                            title="Cancelar gravação">
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div className="flex-1 flex items-center gap-2 rounded-2xl px-3"
                            style={{ height: '38px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                            {/* Botão play inline */}
                            <button type="button" onClick={handleTogglePreviewPlayback}
                              className="shrink-0 w-6 h-6 rounded-full bg-[#f8f7f5]/[0.10] hover:bg-orange-500/30 flex items-center justify-center transition-all active:scale-90"
                              title={previewPlaying ? 'Pausar' : 'Ouvir gravação'}>
                              {previewPlaying
                                ? <Pause className="w-3 h-3 text-orange-300" />
                                : <Play className="w-3 h-3 text-white/60 ml-[1px]" />}
                            </button>
                            <div className="flex-1 flex items-end gap-[2px]" style={{ height: '16px' }}>
                              {Array.from({ length: 32 }, (_, i) => (
                                <div key={i} className="flex-1 rounded-full"
                                  style={{ height: `${18 + ((i * 43 + i * i * 7) % 82)}%`, background: 'rgba(255,255,255,0.16)' }} />
                              ))}
                            </div>
                            <span className="text-[11px] font-mono text-white/40 font-semibold tabular-nums shrink-0">
                              {formatRecordingTime(recordingTime)}
                            </span>
                          </div>
                        </div>

                        {/* Linha 2: Retomar + Enviar */}
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={handleResumeRecording}
                            className="flex-1 h-9 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] text-white/60 hover:text-white flex items-center justify-center gap-1.5 transition-all active:scale-95 text-[11px] font-semibold"
                            title="Retomar gravação">
                            <Mic className="w-3.5 h-3.5 text-red-400" />
                            <span>Retomar</span>
                          </button>
                          <button type="button" onClick={handleStopRecording}
                            className="flex-1 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white flex items-center justify-center gap-1.5 shadow-[0_4px_12px_-2px_rgba(251,146,60,.5)] active:scale-95 transition-all text-[11px] font-semibold"
                            title="Enviar áudio">
                            <Send className="w-3.5 h-3.5" />
                            <span>Enviar</span>
                          </button>
                        </div>
                      </div>

                    ) : (
                      /* ── ESTADO: GRAVANDO ── */
                      <>
                        <button type="button" onClick={handleCancelRecording}
                          className="shrink-0 h-10 w-10 rounded-full bg-[#f8f7f5]/[0.06] hover:bg-red-500/20 text-white/45 hover:text-red-400 flex items-center justify-center transition-all active:scale-90"
                          title="Cancelar gravação">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="flex-1 flex items-center gap-2 rounded-2xl px-3"
                          style={{ height: '40px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <div className="flex-1 flex items-end gap-[2px]" style={{ height: '22px' }}>
                            {Array.from({ length: 32 }, (_, i) => {
                              const baseH = 18 + ((i * 43 + i * i * 7) % 82);
                              return (
                                <div key={i} className="flex-1 rounded-full origin-center"
                                  style={{
                                    height: `${baseH}%`,
                                    background: 'rgba(248,113,113,0.75)',
                                    animation: `chatWaveBar ${(0.45 + (i % 5) * 0.13).toFixed(2)}s ease-in-out ${((i * 0.07) % 0.88).toFixed(2)}s infinite`,
                                  }} />
                              );
                            })}
                          </div>
                          <span className="text-[11px] font-mono text-red-300/90 font-bold tabular-nums shrink-0">
                            {formatRecordingTime(recordingTime)}
                          </span>
                        </div>
                        {/* Mic pulsante */}
                        <div className="shrink-0 h-10 w-10 rounded-full bg-red-500/15 ring-1 ring-red-500/30 flex items-center justify-center">
                          <Mic className="w-[18px] h-[18px] text-red-400 animate-pulse" />
                        </div>
                        {/* Pausar */}
                        <button type="button" onClick={handlePauseRecording}
                          className="shrink-0 h-10 w-10 rounded-full bg-white/[0.06] hover:bg-white/[0.10] text-white/60 hover:text-white flex items-center justify-center transition-all active:scale-90"
                          title="Pausar gravação">
                          <Pause className="w-4 h-4" />
                        </button>
                        {/* Enviar direto */}
                        <button type="button" onClick={handleStopRecording}
                          className="shrink-0 h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-[0_4px_14px_-2px_rgba(251,146,60,.55),inset_0_1px_0_rgba(255,255,255,.2)] active:scale-95 transition-transform"
                          title="Enviar áudio">
                          <Send className="w-4 h-4 text-white" />
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                <div className="relative flex items-center gap-1.5">
                  {showEmojiPicker && (
                    <div
                      className="absolute bottom-14 left-0 z-20 w-[300px] rounded-2xl bg-[#0b1220]/95 backdrop-blur-xl p-3 ring-1 ring-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,.5)]"
                      style={{ animation: 'chatPanelIn 240ms cubic-bezier(.22,1,.36,1) both' }}
                    >
                      <div className="grid grid-cols-8 gap-0.5">
                        {['😀','😄','😁','😂','🤣','😊','😍','😘','😎','🤔','😅','😭','😡','👍','👎','🙏','👏','💪','🔥','🎉','✅','❌','⚠️','📌','📎','📞','💬','❤️','🧠','📄','🗂️','🕒'].map((e) => (
                          <button
                            key={e}
                            type="button"
                            className="h-8 w-8 rounded-lg hover:bg-orange-500/15 active:scale-90 transition-all duration-150 text-lg"
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
                    disabled={!selectedRoomId}
                    className="h-9 w-9 rounded-xl hover:bg-orange-500/15 hover:text-orange-300 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center shrink-0 text-white/70"
                    title="Emoji"
                  >
                    <Smile className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleAttachClick}
                    disabled={!selectedRoomId || uploadingAttachment}
                    className="h-9 w-9 rounded-xl hover:bg-orange-500/15 hover:text-orange-300 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center shrink-0 text-white/70"
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
                      className={`h-9 w-9 rounded-xl transition-all duration-150 flex items-center justify-center shrink-0 ${
                        nudgeCooldown
                          ? 'opacity-30 cursor-not-allowed text-amber-300'
                          : 'hover:bg-amber-500/20 active:scale-95 text-amber-300'
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
                      const isTyping = e.target.value.trim().length > 0;
                      // Salas portal_client: notifica o cliente que o atendente está escrevendo
                      if (selectedRoom?.portal_client_id) {
                        void portalAttendantTypingRef.current?.send({
                          type: 'broadcast', event: 'typing', payload: { typing: isTyping },
                        });
                      } else {
                        // Salas de equipe: broadcast normal de digitação
                        if (isTyping) {
                          broadcastTyping(true);
                          if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
                          typingTimeoutRef.current = window.setTimeout(() => broadcastTyping(false), 3000);
                        } else {
                          broadcastTyping(false);
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                      if (e.key === 'Escape' && replyTo) setReplyTo(null);
                    }}
                    placeholder={replyTo ? 'Escreva sua resposta...' : 'Digite uma mensagem...'}
                    className="min-w-0 flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-3.5 py-2 text-[13.5px] text-white placeholder-white/40 focus:outline-none focus:border-orange-500/50 focus:bg-white/[0.08] focus:shadow-[0_0_0_3px_rgba(251,146,60,.1)] transition-all"
                    disabled={sendingMessage || uploadingAttachment}
                  />

                  <button
                    type="button"
                    onClick={handleToggleRecording}
                    disabled={!selectedRoomId || uploadingAttachment}
                    className="h-9 w-9 rounded-xl hover:bg-orange-500/15 hover:text-orange-300 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center shrink-0 text-white/70"
                    title="Gravar áudio"
                  >
                    <Mic className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={handleSendMessage}
                    disabled={!selectedRoomId || !messageText.trim() || sendingMessage || uploadingAttachment}
                    className="h-9 w-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center shrink-0 shadow-[0_4px_14px_-2px_rgba(251,146,60,.5),inset_0_1px_0_rgba(255,255,255,.2)] ring-1 ring-white/10"
                    title="Enviar"
                  >
                    <Send className="w-4 h-4 text-white" />
                  </button>
                </div>
                )} {/* fim bloco normal input */}
              </div>
              </div>
            </div>
          )}
        </div>
        </div>
      )}

      {showToast && toast && (
        <div
          className="mb-3 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.96)',
            borderRadius: '20px',
            boxShadow: '0 8px 40px rgba(15,23,42,0.12), 0 2px 8px rgba(15,23,42,0.06)',
            border: '1px solid rgba(226,232,240,0.8)',
            backdropFilter: 'blur(12px)',
            animation: 'chatToastIn 420ms cubic-bezier(.34,1.56,.64,1) both, chatToastOut 550ms 6.5s ease-in both',
          }}
        >
          {/* Cabeçalho minimalista */}
          <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-0">
            <div className="h-3.5 w-3.5 rounded-full shrink-0 flex items-center justify-center bg-orange-500">
              <MessageCircle className="w-2 h-2 text-white" />
            </div>
            <span className="flex-1 text-[10.5px] font-semibold text-slate-400 tracking-wide uppercase">Mensagens</span>
            <span className="text-[10.5px] text-slate-300">agora</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (toastTimerRef.current) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
                setToast(null);
              }}
              className="ml-0.5 h-4 w-4 rounded-full flex items-center justify-center text-slate-300 hover:text-slate-500 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Corpo clicável */}
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3.5 pt-2.5 pb-3.5 text-left"
            onClick={async () => {
              if (toastTimerRef.current) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; }
              setToast(null);
              setNotifyCount(0);
              await ensureAudioContext();
              setOpen(true);
              setSelectedRoomId(toast.roomId);
            }}
          >
            {/* Avatar limpo */}
            <div className="shrink-0">
              {toast.avatarUrl ? (
                <img
                  src={toast.avatarUrl}
                  alt={toast.senderName}
                  className="h-10 w-10 rounded-full object-cover ring-1 ring-slate-100"
                />
              ) : (
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center text-white text-[13px] font-semibold ring-1 ring-slate-100"
                  style={{ background: 'linear-gradient(135deg,#fdba74,#f97316)' }}
                >
                  {toast.senderName
                    .split(' ')
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n: string) => n[0])
                    .join('')
                    .toUpperCase()}
                </div>
              )}
            </div>

            {/* Texto */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[13px] font-semibold text-slate-800 truncate leading-tight">
                  {/* Converte para Title Case se estiver em caixa alta */}
                  {/^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ\s]+$/.test(toast.senderName)
                    ? toast.senderName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
                    : toast.senderName}
                </span>
                {toastVerified && <VerifiedBadge variant={toastVerified} />}
              </div>
              <p className="text-[12px] text-slate-400 truncate mt-0.5 leading-snug">{toast.preview}</p>
            </div>
          </button>

          {/* Barra de progresso fina */}
          <div className="h-[2px] overflow-hidden" style={{ borderRadius: '0 0 20px 20px' }}>
            <div
              className="h-full w-full origin-left"
              style={{
                background: 'linear-gradient(90deg,#f97316,#fdba74)',
                animation: 'chatToastProgress 7s linear both',
              }}
            />
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
        className={`group relative rounded-full overflow-hidden transition-all duration-200 hover:scale-[1.04] active:scale-[0.97] ${
          badgeCount > 0 && !open ? 'ring-2 ring-orange-400/40' : 'ring-1 ring-white/10'
        }`}
        style={{
          boxShadow:
            badgeCount > 0 && !open
              ? '0 20px 60px rgba(0,0,0,.5), 0 0 0 0 rgba(251,146,60,0)'
              : '0 20px 60px rgba(0,0,0,.5)',
          animation: badgeCount > 0 && !open ? 'chatLauncherGlow 2.4s ease-in-out infinite' : undefined,
        }}
        title="Mensagens / Editor"
      >
        {/* Mobile — círculo compacto */}
        <div
          className="sm:hidden flex items-center justify-center h-12 w-12 text-white relative"
          style={{
            background:
              'linear-gradient(135deg, rgba(20,28,46,.98) 0%, rgba(10,15,28,.98) 100%)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          {/* Highlight superior */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 opacity-60"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,.08) 0%, transparent 100%)',
            }}
          />
          <div className="relative">
            <MessageCircle className="w-5 h-5" strokeWidth={2.4} />
            {badgeCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1.5 rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white text-[11px] font-bold flex items-center justify-center shadow-[0_2px_8px_rgba(239,68,68,.6)] ring-2 ring-[#0a0f1c]">
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </div>
        </div>

        {/* Desktop — barra horizontal */}
        <div
          className="hidden sm:flex items-stretch text-white relative"
          style={{
            background:
              'linear-gradient(135deg, rgba(20,28,46,.98) 0%, rgba(10,15,28,.98) 100%)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          {/* Highlight superior */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 opacity-70 rounded-t-full"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,.1) 0%, transparent 100%)',
            }}
          />
          <div className="flex items-center gap-2.5 px-4 h-12 relative">
            <div className="relative flex items-center justify-center h-7 w-7 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 shadow-[0_4px_10px_rgba(251,146,60,.4),inset_0_1px_0_rgba(255,255,255,.25)]">
              <MessageCircle className="w-3.5 h-3.5 text-white" strokeWidth={2.6} />
              {badgeCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-red-500 to-rose-600 text-white text-[10px] font-bold flex items-center justify-center shadow-[0_2px_6px_rgba(239,68,68,.6)] ring-2 ring-[#0a0f1c]">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </div>
            <span className="text-[13.5px] font-semibold tracking-tight">Mensagens</span>
          </div>

          {petitionEditorMinimized && (
            <>
              <div className="w-px bg-[#f8f7f5]/[0.08]" aria-hidden />
              <div
                className="relative flex items-center gap-2 px-4 h-12 text-white hover:bg-white/[0.04] transition"
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
                <FileText className="w-4 h-4 text-orange-300" />
                <span className="text-[13px] font-semibold">Editor</span>
                {petitionEditorHasUnsavedChanges && (
                  <span
                    className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full ring-2 ring-[#0a0f1c] animate-pulse"
                    title="Alterações não salvas"
                  />
                )}
              </div>
            </>
          )}

          {badgeCount > 0 && (topUnreadUser || lastUnreadImageSender) && (
            <div className="flex items-center pr-3 pl-1 h-12">
              <div className="relative">
                {(topUnreadUser?.avatar_url || lastUnreadImageSender?.avatarUrl) ? (
                  <img
                    src={(topUnreadUser?.avatar_url || lastUnreadImageSender?.avatarUrl) as string}
                    alt={topUnreadUser?.name || lastUnreadImageSender?.name || ''}
                    className="w-8 h-8 rounded-full object-cover ring-2 ring-orange-400 shadow-[0_4px_12px_rgba(251,146,60,.4)]"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 ring-2 ring-orange-300 flex items-center justify-center text-[11px] font-bold text-white shadow-[0_4px_12px_rgba(251,146,60,.4)]">
                    {(topUnreadUser?.name || lastUnreadImageSender?.name || '?').substring(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </button>
    </div>
    </ChatImagesContext.Provider>,
    document.body
  );
};

export default ChatFloatingWidget;
