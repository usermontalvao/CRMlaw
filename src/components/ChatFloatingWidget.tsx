import React, { startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, BadgeCheck, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, MessageCircle, Mic, Paperclip, Plus, Reply, Search, Send, Smile, Trash2, Users, X, Zap, Play, Pause, PhoneOff, RotateCcw, UserCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { usePermissions } from '../hooks/usePermissions';
import { buildPortalFarewellMessage, chatService } from '../services/chat.service';
import { profileService, type Profile } from '../services/profile.service';
import type { ChatMessage, ChatRoom } from '../types/chat.types';
import { supabase } from '../config/supabase';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { matchesNormalizedSearch } from '../utils/search';
import WhatsAppModule from './WhatsAppModule';
import { dashboardPreferencesService, type ChatWidgetPrefs } from '../services/dashboardPreferences.service';
import { applyOutputToElement, openPreferredMicrophone } from '../utils/audioDevices';
import ChatLauncherBar from './chat/ChatLauncherBar';
import ChatChannelRail from './chat/ChatChannelRail';
import { animacaoDoPainel, animacaoDoCorpo } from './chat/panelMotion';
import { ConversationListSkeleton } from './whatsapp/skeletons';
import { lidoDaMemoriaWa } from '../services/whatsapp/sessionCache';
import { Avatar } from './chat/ChatAvatar';
import { VerifiedBadge, getVerifiedVariant } from './chat/VerifiedBadge';
import { whatsappService } from '../services/whatsapp.service';
import { criarControleDePresenca } from '../services/realtime/presenceTrack';
import { zc } from '../styles/layers';
import { ModalLayerProvider } from '../styles/modalLayer';

// Tamanho padrão do widget (usado no reset e quando não há preferência salva).
//
// A largura cresceu 56px junto com o trilho de canais: o trilho ocupa exatamente
// isso à esquerda, e sem a compensação toda conversa ficaria uma linha mais
// estreita do que era antes dele. O que sobra para a conversa continua sendo os
// mesmos 384px de sempre.
const WIDGET_DEFAULT_W = 440;
const WIDGET_DEFAULT_H = 590;
const WIDGET_MIN_W = 320;
const WIDGET_MAX_W = 720;
const WIDGET_MIN_H = 420;
const WIDGET_MAX_H = 900;
// Alturas de defaults antigos: quem tinha uma delas salva migra para o default
// atual (inclui 460/560/620 anteriores).
const LEGACY_WIDGET_DEFAULT_HEIGHTS = new Set([600, 570, 540, 500, 460, 560, 620]);

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
        onPlay={e => { setPlaying(true); void applyOutputToElement(e.currentTarget); }}
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
      // `preventDefault` marca a tecla como consumida: sem isso, o mesmo Esc
      // que fecha a imagem continuaria descendo a escada e sairia da conversa.
      if (e.key === 'Escape') { e.preventDefault(); setViewerOpen(false); }
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
            className={`fixed inset-0 ${zc.WIDGET_NESTED} bg-black/85 flex items-center justify-center p-4`}
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
  const { canView, isAdmin, loading: permLoading } = usePermissions();
  const hasWhatsAppAccess = isAdmin || (!permLoading && canView('whatsapp'));

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

  // Posição (offset de arraste a partir do canto inferior-direito) e largura/altura
  // do painel — permite mover de lado e redimensionar a largura. Sem persistência
  // (regra do widget: nada de localStorage além de imagens).
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [panelW, setPanelW] = useState(WIDGET_DEFAULT_W);
  const [panelH, setPanelH] = useState(WIDGET_DEFAULT_H);
  const dragRef = useRef<{ mode: 'move' | 'w' | 'h' | 'wh'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  // Preferência de tamanho carregada do banco (evita salvar durante o load inicial).
  const widgetPrefsLoaded = useRef(false);
  const sizeRef = useRef({ w: WIDGET_DEFAULT_W, h: WIDGET_DEFAULT_H });
  sizeRef.current = { w: panelW, h: panelH };

  // ── Carregar/salvar o tamanho do widget (preferência por usuário no banco) ──
  // IMPORTANTE: estes hooks ficam ANTES de qualquer early return do componente.
  // O retrato COMPLETO da preferência, para quem grava não apagar o que o outro
  // acabou de guardar: a coluna é um jsonb só, e gravar `{w, h}` ao soltar o
  // canto do painel levava a aba junto. Todo mundo escreve por aqui.
  const widgetPrefsRef = useRef<ChatWidgetPrefs>({ w: WIDGET_DEFAULT_W, h: WIDGET_DEFAULT_H });

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    dashboardPreferencesService.getChatWidgetPrefs(user.id).then((p) => {
      if (!alive) return;
      if (p && Number.isFinite(p.w) && Number.isFinite(p.h)) {
        const nextW = Math.max(WIDGET_MIN_W, Math.min(WIDGET_MAX_W, p.w));
        const migratedH = LEGACY_WIDGET_DEFAULT_HEIGHTS.has(p.h) ? WIDGET_DEFAULT_H : p.h;
        const nextH = Math.max(WIDGET_MIN_H, Math.min(WIDGET_MAX_H, migratedH));
        setPanelW(nextW);
        setPanelH(nextH);
        widgetPrefsRef.current = { ...widgetPrefsRef.current, ...p, w: nextW, h: nextH };
        if (nextW !== p.w || nextH !== p.h) {
          void dashboardPreferencesService.saveChatWidgetPrefs(user.id, widgetPrefsRef.current);
        }
      }
      // A aba de volta: só quando ela ainda existe para esta pessoa. Quem perdeu
      // o acesso ao WhatsApp desde a última vez cai na Equipe, sem erro.
      if (p?.tab === 'whatsapp' && hasWhatsAppAccess) setChatTab('whatsapp');
      widgetPrefsLoaded.current = true;
    }).catch(() => { widgetPrefsLoaded.current = true; });
    return () => { alive = false; };
  }, [user?.id, hasWhatsAppAccess]);

  const persistWidgetPrefs = useCallback((patch: Partial<ChatWidgetPrefs>) => {
    if (!user?.id) return;
    const proximo = { ...widgetPrefsRef.current, ...patch };
    widgetPrefsRef.current = proximo;
    void dashboardPreferencesService.saveChatWidgetPrefs(user.id, proximo);
  }, [user?.id]);

  const persistWidgetSize = useCallback((w: number, h: number) => {
    persistWidgetPrefs({ w, h });
  }, [persistWidgetPrefs]);

  const [chatTab, setChatTab] = useState<'equipe' | 'whatsapp'>('equipe');


  /**
   * Onde eu estava fica guardado.
   *
   * Vale para a troca no trilho e para a abertura programática (um "conversar no
   * WhatsApp" vindo de outra tela) — as duas terminam aqui, e por isso a
   * gravação mora no estado, não nos cliques. Nada é gravado enquanto a
   * preferência está sendo lida: senão a aba padrão sobrescreveria a guardada
   * antes de ela chegar.
   */
  useEffect(() => {
    if (!widgetPrefsLoaded.current) return;
    if (widgetPrefsRef.current.tab === chatTab) return;
    persistWidgetPrefs({ tab: chatTab });
  }, [chatTab, persistWidgetPrefs]);
  /**
   * Quantas PESSOAS do WhatsApp estão esperando resposta — o MESMO número da
   * aba "Não lidas" da inbox, lido do banco.
   *
   * Antes isto era um contador de sessão: +1 a cada aviso de mensagem nova,
   * zerado ao abrir a aba WhatsApp do widget. Três consequências, todas
   * relatadas como "o widget mente":
   *
   *   • recarregar a página zerava o número, com a fila intacta no banco;
   *   • responder a conversa pelo MÓDULO não descontava nada — o badge só
   *     crescia;
   *   • abrir a aba do widget zerava tudo de uma vez, inclusive as conversas
   *     que continuavam não lidas.
   *
   * Vindo do banco, o número é o estado real: ele desce sozinho quando alguém
   * lê a conversa em qualquer lugar, e sobrevive ao F5. O aviso de mensagem
   * nova deixou de ser a FONTE do número e virou só mais um gatilho de
   * releitura.
   */
  const [waUnread, setWaUnread] = useState(0);
  // Aba WhatsApp (modo lite): o WhatsAppModule embutido é dono da seleção; aqui
  // só guardamos a conversa ativa (deep-link ao maximizar).
  const [waActiveConvId, setWaActiveConvId] = useState<string | null>(null);
  /**
   * Rosto e nome da conversa do WhatsApp que está aberta.
   *
   * Vem junto com o id porque, minimizado, o painel está DESMONTADO: quem
   * poderia dizer de quem é a conversa guardada — o módulo — não existe mais
   * nessa hora. Guardar a identidade no momento em que ela ainda estava na
   * tela é mais barato (e mais fiel) do que ir buscá-la depois.
   */
  const [waGuardado, setWaGuardado] = useState<{ nome: string; avatarUrl: string | null } | null>(null);
  /**
   * Conversa que o widget deve ABRIR (deep-link vindo do cartão de aviso).
   *
   * Diferente de `waActiveConvId`, que é um relato — "o módulo embutido está
   * nesta conversa". Este é uma ordem, entregue ao `WhatsAppModule` pela mesma
   * porta que o módulo em tela cheia já usa (`openConversationId`), e apagada
   * assim que ele confirma ter consumido. Sem apagar, voltar para a lista
   * dentro do widget seria desfeito no render seguinte.
   */
  const [waOpenConvId, setWaOpenConvId] = useState<string | null>(null);
  /**
   * Texto que já entra escrito no compositor da conversa pedida de fora.
   *
   * O módulo cheio recebia isto desde sempre (`openConversationDraft`); o widget
   * NÃO — ele só repassava o id da conversa. Resultado: clicar em "Enviar no
   * WhatsApp" no módulo Documentos abria a conversa certa, mostrava o toast
   * dizendo "a mensagem já está escrita no compositor"… e o compositor vinha
   * vazio, sem o link da assinatura. O mesmo valia para o convite de assinatura
   * e para os modelos do requerimento sempre que a pessoa não estava no módulo
   * do WhatsApp. Ver a regra: o widget espelha o módulo.
   */
  const [waOpenDraft, setWaOpenDraft] = useState<string | null>(null);
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

  /**
   * A ESCADA DO ESC NA ABA EQUIPE.
   *
   * A mesma da inbox de WhatsApp (`inboxKeyboard`), aplicada aqui porque a
   * conversa de equipe é nossa, não do módulo: um Esc volta da conversa para a
   * lista, o seguinte fecha a janela. Um gesto, dois degraus — e nunca dois de
   * uma vez.
   *
   * Três coisas ficam de fora, e cada uma por um motivo:
   *  · tecla JÁ CONSUMIDA (`defaultPrevented`): quem estava por cima —
   *    o visualizador de imagem, um menu — já respondeu por ela;
   *  · diálogo aberto: o teclado é dele enquanto estiver na tela;
   *  · campo de texto COM CONTEÚDO: fechar a janela de quem está no meio de uma
   *    frase é perder trabalho, que é exatamente o que o Esc não pode fazer.
   *
   * Na aba WhatsApp este ouvinte se cala: lá quem desce a escada é o módulo,
   * que conhece a pilha inteira (gravação, menus, resposta, rascunho) e nos
   * devolve o gesto só no último degrau, via `onEscapeExit`.
   */
  useEffect(() => {
    if (!open) return;
    if (chatTab === 'whatsapp' && hasWhatsAppAccess) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const alvo = document.activeElement as HTMLElement | null;
      if (alvo) {
        const campo = alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement;
        const texto = campo ? alvo.value.trim() : alvo.isContentEditable ? (alvo.textContent ?? '').trim() : '';
        if (texto) return;
      }
      e.preventDefault();
      if (showNewChatModal) { setShowNewChatModal(false); return; }
      if (selectedRoomId) { setSelectedRoomId(null); return; }
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, chatTab, hasWhatsAppAccess, showNewChatModal, selectedRoomId]);
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
      // O MESMO microfone das ligações: quem escolheu o headset no painel de
      // áudio escolheu para falar, e não só para ligar.
      const stream = await openPreferredMicrophone();
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
    // A prévia da própria gravação também sai no alto-falante escolhido —
    // conferir o que se gravou pelo dispositivo errado não confere nada.
    void applyOutputToElement(audio).finally(() => { void audio.play(); });
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

    // Para salas portal_client, cria canal para broadcast de digitação ao cliente.
    // Lido de uma ref: o array `rooms` inteiro nas dependências fazia toda
    // recarga da lista derrubar e refazer o canal da sala ABERTA, no meio da
    // conversa. O que importa aqui é só se esta sala é do portal.
    const selectedRoom = roomsRef.current.find(r => r.id === selectedRoomId);
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
  }, [selectedRoomId, user?.id]);

  // Typing indicator nas salas — subscibe a todos os canais quando a lista está visível
  /**
   * Identidade estável da lista de salas: só os ids, ordenados, numa string.
   *
   * O efeito abaixo abre UM canal por sala. Com `rooms` (o array) na lista de
   * dependências, toda recarga da lista — que devolve objetos novos com o mesmo
   * conteúdo — derrubava e reabria TODOS eles de uma vez. Era a maior fonte de
   * criação e remoção de canais do CRM.
   */
  const roomIdsKey = useMemo(
    () => rooms.map((r) => r.id).sort().join(','),
    [rooms],
  );

  useEffect(() => {
    const roomIds = roomIdsKey ? roomIdsKey.split(',') : [];
    if (selectedRoomId || !user || roomIds.length === 0) {
      setRoomTypingUsers(new Map());
      return;
    }
    const channels = roomIds.map((roomId) =>
      supabase
        .channel(`typing:${roomId}`)
        .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
          const { user_id, name, action } = payload ?? {};
          if (!user_id || user_id === user.id) return;
          setRoomTypingUsers((prev) => {
            const next = new Map(prev);
            const current = next.get(roomId) ?? [];
            if (action === 'start') {
              next.set(roomId, current.includes(name) ? current : [...current, name]);
            } else {
              const filtered = current.filter((n) => n !== name);
              if (filtered.length) next.set(roomId, filtered);
              else next.delete(roomId);
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
  }, [selectedRoomId, user?.id, roomIdsKey]);

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

  /**
   * O número do WhatsApp no badge, lido do banco.
   *
   * Três gatilhos de releitura, e nenhum deles ESCREVE o número — quem sabe
   * quantas conversas estão esperando é a tabela:
   *
   *   • a montagem (e a troca de usuário), para o F5 já chegar com o total;
   *   • qualquer mudança de conversa no realtime, que é o mesmo fan-out local
   *     que o módulo usa (nenhum socket novo) — cobre tanto a mensagem que
   *     chega quanto a leitura feita em outra tela, ou por outra pessoa;
   *   • o aviso de mensagem nova, como reforço: ele dispara no INSERT da
   *     mensagem, antes do UPDATE da conversa, e adianta o badge em uma volta.
   *
   * A releitura é agrupada num pequeno atraso porque uma rajada de mensagens
   * produz uma rajada de eventos, e o total só precisa estar certo no fim dela.
   */
  useEffect(() => {
    // Sem acesso ao módulo não há fila para contar — e a consulta voltaria
    // vazia pelo RLS de qualquer forma.
    if (!user || !hasWhatsAppAccess) { setWaUnread(0); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const readNow = () => {
      whatsappService.countUnreadContacts()
        .then((n) => { if (alive) setWaUnread(n); })
        .catch(() => { /* sem número é melhor que número errado: mantém o último */ });
    };
    const scheduleRead = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(readNow, 400);
    };

    readNow();
    const unsubConv = whatsappService.subscribeConversationNotifications(scheduleRead);
    const domHandler = () => scheduleRead();
    window.addEventListener(`crm:${SYSTEM_EVENTS.WHATSAPP_NOTIFY}`, domHandler);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      unsubConv();
      window.removeEventListener(`crm:${SYSTEM_EVENTS.WHATSAPP_NOTIFY}`, domHandler);
    };
  }, [user?.id, hasWhatsAppAccess]);

  useEffect(() => {
    const map = new Map<string, Profile>();
    members.forEach((m) => map.set(m.user_id, m));
    membersByUserIdRef.current = map;
  }, [members]);

  // A lista de salas lida de dentro de efeitos que NÃO devem reagir a ela.
  // Ver o canal de digitação da sala aberta, logo abaixo.
  const roomsRef = useRef<ChatRoom[]>([]);
  roomsRef.current = rooms;

  useEffect(() => {
    if (!user) return;

    // `focus` e `visibilitychange` disparam JUNTOS ao voltar para a aba, então
    // todo retorno mandava duas presenças idênticas. A deduplicação por conteúdo
    // resolve sem precisar coordenar os dois eventos.
    const controle = criarControleDePresenca<Record<string, unknown>>({
      marca: '[Jurius Realtime][Presence][ChatWidget]',
      enviar: (payload) => { void channel.track(payload); },
    });

    const doTrack = () => {
      if (channel.state !== 'joined') return;
      const me = membersByUserIdRef.current.get(user.id);
      controle.publicar({
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
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // Reconexão: o servidor esqueceu esta sessão, então a deduplicação
        // precisa esquecer também — senão a pessoa some da lista dos colegas.
        controle.esquecer();
        doTrack();
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
      controle.encerrar();
      supabase.removeChannel(channel);
    };
    // `user?.id`/`user?.email` e não `user`: o objeto do contexto é recriado a
    // cada renovação de sessão, e com ele aqui o canal de presença era derrubado
    // e refeito sem nada ter mudado.
  }, [user?.id, user?.email]);

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

  /**
   * Mensagens já buscadas, por sala. É o que faz abrir uma conversa ser
   * INSTANTÂNEO na segunda vez.
   *
   * Antes, todo clique numa conversa mostrava "Carregando mensagens…" e
   * esperava a rede — inclusive ao voltar para a conversa de onde se tinha
   * acabado de sair, cujo conteúdo o componente havia jogado fora. Num widget
   * que se usa aos pulos (abre, responde, fecha, volta), essa espera era a maior
   * parte do tempo de uso.
   *
   * O cache não substitui a busca: ele desenha a conversa AGORA e a busca
   * continua, corrigindo por cima quando chega. Se o servidor discordar, quem
   * vence é o servidor — só que sem tela em branco no meio.
   */
  const messagesCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());
  /** Teto do cache: memória de conversa não pode crescer sem fim numa aba aberta o dia todo. */
  const MESSAGES_CACHE_MAX = 12;

  const rememberMessages = useCallback((roomId: string, list: ChatMessage[]) => {
    const cache = messagesCacheRef.current;
    cache.delete(roomId);          // reinsere no fim: o mapa vira uma fila de uso
    cache.set(roomId, list);
    while (cache.size > MESSAGES_CACHE_MAX) {
      const maisAntiga = cache.keys().next().value;
      if (maisAntiga === undefined) break;
      cache.delete(maisAntiga);
    }
  }, []);

  const loadMessages = useCallback(async (roomId: string) => {
    if (!user) return;
    const cached = messagesCacheRef.current.get(roomId);
    if (cached) {
      // Pinta na hora, sem passar pelo estado de carregando — é este ramo que
      // faz a conversa aparecer no mesmo quadro do clique.
      setMessages(cached);
      pinnedToBottomRef.current = true;
      scrollToBottom('auto');
    } else {
      setLoadingMessages(true);
    }
    try {
      const list = await chatService.listMessages({ roomId });
      rememberMessages(roomId, list);
      // A pessoa pode ter trocado de conversa enquanto a resposta vinha; sem
      // esta conferência, a lista antiga cairia dentro da conversa nova.
      if (selectedRoomIdRef.current !== roomId) return;
      setMessages(list);
      pinnedToBottomRef.current = true;
      scrollToBottom('auto');
    } finally {
      setLoadingMessages(false);
    }
  }, [user, scrollToBottom, rememberMessages]);

  /**
   * Busca as mensagens ANTES do clique, ao passar o mouse na linha da lista.
   *
   * O intervalo entre apontar e clicar é tempo morto que já pagava a viagem à
   * rede — é o truque que faz a primeira abertura também parecer instantânea.
   * Uma sala só é buscada uma vez: quem já está no cache não repete.
   */
  const prefetchRoomMessages = useCallback((roomId: string) => {
    if (!user || messagesCacheRef.current.has(roomId)) return;
    void chatService.listMessages({ roomId })
      .then((list) => rememberMessages(roomId, list))
      .catch(() => { /* era adiantamento, não obrigação */ });
  }, [user, rememberMessages]);

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

  // Cartão de aviso de mensagem nova → conversa aberta AQUI, sem trocar de tela.
  useEffect(() => {
    if (!user || !hasWhatsAppAccess) return;
    const unsub = events.on(SYSTEM_EVENTS.CHAT_WIDGET_OPEN_WHATSAPP, (payload?: any) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (!conversationId) return;
      setToast(null);
      const rascunho = String(payload?.draft ?? '').trim();
      setWaOpenDraft(rascunho || null);
      // Sai de qualquer sala da equipe que estivesse aberta: o painel tem um
      // conteúdo só, e o pedido é explícito sobre qual.
      setSelectedRoomId(null);
      setChatTab('whatsapp');
      setWaOpenConvId(conversationId);
      setOpen(true);
      ensureAudioContext();
    });
    return () => unsub();
  }, [user, hasWhatsAppAccess, ensureAudioContext]);

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

  // O cache acompanha a conversa aberta: mensagem que chega pelo realtime, ou
  // que acabou de ser enviada, entra aqui sem precisar de um gancho em cada
  // ponto que mexe em `messages`. É o que garante que voltar para a conversa
  // mostre o que já estava na tela, e não o retrato de quando ela foi buscada.
  useEffect(() => {
    if (!selectedRoomId || messages.length === 0) return;
    rememberMessages(selectedRoomId, messages);
  }, [selectedRoomId, messages, rememberMessages]);

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
        // ── Edição / exclusão (soft-delete) de mensagem refletidas ao vivo ──
        // O widget usa um canal global (sem assinatura por-sala), então UPDATE
        // entra aqui. Atualiza a mensagem na sala aberta e o preview da lista.
        onUpdate: (msg) => {
          if (msg.room_id === selectedRoomIdRef.current) {
            setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, ...msg } : m));
          }
          // Só mexe no preview quando a ÚLTIMA mensagem muda (não reordena).
          setRooms((prev) => prev.map((r) =>
            r.id === msg.room_id && (r.last_message_at ?? r.created_at) === msg.created_at
              ? { ...r, last_message_preview: msg.deleted_at ? '🗑️ Mensagem apagada' : getPreview(msg.content) }
              : r
          ));
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
          // accepted_by é null (devolvido à fila) ou == eu (transferido PARA mim):
          // em ambos a sala é visível para mim. Se já está na lista, só mescla;
          // se NÃO está (acabou de ser transferida pra mim), busca completa — o
          // payload do realtime não traz preview/membros/não-lidas.
          const exists = stableCallbacksRef.current.getRooms().some((r) => r.id === updatedRoom.id);
          if (exists) {
            setRooms((prev) =>
              prev.map((r) => (r.id === updatedRoom.id ? { ...r, ...updatedRoom } : r)),
            );
          } else {
            stableCallbacksRef.current.loadRooms();
          }
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

  /**
   * A CONVERSA GUARDADA — o que a barra segura enquanto o painel está minimizado.
   *
   * É o que separa minimizar de fechar. Sem um lugar para voltar, minimizar
   * seria fechar com outro nome: o painel some, a conversa se perde, e reabrir
   * cai na lista, na estaca zero. Aqui a barra fica com ela no bolso — e o
   * bloco que a mostra é o MESMO que o Editor de Petições minimizado já usa,
   * de propósito: um gesto só para as duas coisas que se guardam ali.
   *
   * Só existe com o painel FECHADO: aberto, a conversa está à vista, e um
   * segundo lugar dizendo o nome dela seria eco.
   */
  /* ── A ABERTURA ────────────────────────────────────────────────────────────
     O painel é `{open && …}`: clicar não revela uma janela pronta, MONTA uma.
     E o corpo dela, na aba WhatsApp, é o módulo inteiro — alguns milhares de
     linhas de componente. React monta tudo isso de uma vez, antes de o
     navegador pintar qualquer coisa: por isso o clique parecia não fazer nada
     por um instante e a janela aparecia já no lugar, sem a animação que existe
     há tempos no código.

     Agora são dois tempos. A MOLDURA (trilho, cabeçalho, superfície) monta na
     hora e é ela que entra na tela, animada. O corpo entra logo atrás, numa
     passada que o React pode interromper (`startTransition`) — o que garante
     que ele nunca segure o primeiro quadro.

     Uma coisa que este truque NÃO faz é buscar dado mais rápido; quem resolveu
     isso foi a memória de aba (`sessionCache`), que evita as onze idas ao banco
     que o módulo fazia a cada abertura. Os dois juntos é que dão "abriu". */
  const painelRef = useRef<HTMLDivElement | null>(null);
  const [corpoPronto, setCorpoPronto] = useState(false);
  useEffect(() => {
    if (open) { startTransition(() => setCorpoPronto(true)); return; }
    // Ao FECHAR, o corpo tem de continuar de pé até a saída terminar: desmontar
    // na hora faz o painel encolher vazio, e uma janela que se esvazia antes de
    // sumir parece defeito, não animação. 220ms é a saída (120ms) com folga.
    const t = window.setTimeout(() => setCorpoPronto(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  /** Já houve uma abertura nesta aba? Então não há o que esqueletar. */
  const temInboxGuardada = lidoDaMemoriaWa(user?.id, 'conversations') !== undefined;

  const semMovimento = useReducedMotion();

  const conversaGuardada = useMemo(() => {
    if (open) return null;
    if (chatTab === 'whatsapp') {
      return waActiveConvId && waGuardado
        ? { nome: waGuardado.nome, avatarUrl: waGuardado.avatarUrl }
        : null;
    }
    if (!selectedRoomId) return null;
    const sala = rooms.find((r) => r.id === selectedRoomId);
    if (!sala) return null;
    const outro = getOtherUserForRoom(sala);
    return { nome: outro?.name || sala.name, avatarUrl: outro?.avatar_url ?? null };
  }, [open, chatTab, waActiveConvId, waGuardado, selectedRoomId, rooms, getOtherUserForRoom]);

  /**
   * O relato do módulo embutido sobre qual conversa está aberta.
   *
   * Estável (`useCallback` sem dependências) porque ele é DEPENDÊNCIA de um
   * efeito lá dentro: uma função recriada a cada render faria o efeito rodar a
   * cada render, e como ele devolve um objeto novo toda vez, o par
   * módulo↔widget entraria em renderização infinita. A comparação campo a
   * campo abaixo é o segundo cinto: mesma pessoa, mesmo objeto, nada re-renderiza.
   */
  const handleWaActiveConversation = useCallback(
    (id: string | null, contato?: { nome: string; avatarUrl: string | null } | null) => {
      setWaActiveConvId(id);
      setWaGuardado((antes) => {
        const agora = contato ?? null;
        if (antes?.nome === agora?.nome && antes?.avatarUrl === agora?.avatarUrl) return antes;
        return agora;
      });
    },
    [],
  );

  // Oculto no módulo de chat interno e no WhatsApp (lá o widget cobriria o
  // campo de digitação da conversa, sobrepondo o botão de enviar).
  //
  // ATENÇÃO: este é o PRIMEIRO early return do componente — daqui para baixo
  // não pode nascer nenhum hook. Entrar no módulo de chat/WhatsApp faz o
  // widget renderizar com menos hooks do que na volta, e o React derruba a
  // árvore inteira com "Rendered fewer hooks than expected". Hook novo entra
  // ACIMA desta linha, sempre.
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
  const badgeCount = totalUnreadFromRooms + waUnread;

  /**
   * O número sozinho não diz de onde vem. Duas filas diferentes moram no mesmo
   * badge — o chat da equipe e o WhatsApp —, e "16" sem procedência foi
   * exatamente a pergunta que o widget provocou. A dica do mouse abre a conta.
   */
  const launcherTitle = badgeCount === 0
    ? 'Mensagens'
    : [
        totalUnreadFromRooms > 0
          ? `${totalUnreadFromRooms} ${totalUnreadFromRooms === 1 ? 'conversa da equipe' : 'conversas da equipe'}`
          : null,
        waUnread > 0
          ? `${waUnread} ${waUnread === 1 ? 'contato no WhatsApp' : 'contatos no WhatsApp'}`
          : null,
      ].filter(Boolean).join(' · ');
  const topUnreadUser = topUnreadRoom ? getOtherUserForRoom(topUnreadRoom) : null;


  const showToast = !!toast && (!open || !selectedRoomId || toast.roomId !== selectedRoomId);
  const headerVerified = getVerifiedVariant(otherUser);

  // ── Arrastar (mover) e redimensionar (largura/altura) o painel ──
  const onPanelDragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'move') {
      const vw = window.innerWidth, vh = window.innerHeight;
      let nx = d.ox + (e.clientX - d.sx);
      let ny = d.oy + (e.clientY - d.sy);
      nx = Math.min(0, Math.max(-(vw - panelW - 32), nx)); // não passa da borda esquerda
      ny = Math.min(0, Math.max(-(vh - panelH - 100), ny)); // nem do topo
      setPanelPos({ x: nx, y: ny });
      return;
    }
    // Ancorado no canto inferior-direito: arrastar p/ esquerda alarga; p/ cima aumenta a altura.
    if (d.mode === 'w' || d.mode === 'wh') {
      let nw = d.ow - (e.clientX - d.sx);
      nw = Math.max(WIDGET_MIN_W, Math.min(Math.min(WIDGET_MAX_W, window.innerWidth - 32), nw));
      setPanelW(nw);
    }
    if (d.mode === 'h' || d.mode === 'wh') {
      let nh = d.oh - (e.clientY - d.sy);
      nh = Math.max(WIDGET_MIN_H, Math.min(Math.min(WIDGET_MAX_H, window.innerHeight - 120), nh));
      setPanelH(nh);
    }
  };
  const onPanelDragEnd = () => {
    const wasResize = dragRef.current && dragRef.current.mode !== 'move';
    dragRef.current = null;
    window.removeEventListener('pointermove', onPanelDragMove);
    window.removeEventListener('pointerup', onPanelDragEnd);
    document.body.style.userSelect = '';
    if (wasResize) persistWidgetSize(sizeRef.current.w, sizeRef.current.h);
  };
  const startPanelDrag = (mode: 'move' | 'w' | 'h' | 'wh') => (e: React.PointerEvent) => {
    if (mode === 'move' && (e.target as HTMLElement).closest('button,a,input,textarea')) return;
    if (mode !== 'move') { e.preventDefault(); e.stopPropagation(); }
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, ox: panelPos.x, oy: panelPos.y, ow: panelW, oh: panelH };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onPanelDragMove);
    window.addEventListener('pointerup', onPanelDragEnd);
  };

  // Volta ao tamanho/posição padrão e salva a preferência.
  const resetWidgetSize = () => {
    setPanelW(WIDGET_DEFAULT_W);
    setPanelH(WIDGET_DEFAULT_H);
    setPanelPos({ x: 0, y: 0 });
    persistWidgetSize(WIDGET_DEFAULT_W, WIDGET_DEFAULT_H);
  };
  const isCustomSize = panelW !== WIDGET_DEFAULT_W || panelH !== WIDGET_DEFAULT_H || panelPos.x !== 0 || panelPos.y !== 0;

  if (hidden) return null;

  // `zc.WIDGET`, não `zc.FLOATING`: quase todo clique que traz uma conversa
  // para cá parte de um modal ABERTO (a ficha do cliente, o lead, o
  // requerimento). Na faixa das janelas flutuantes o painel subia ATRÁS desse
  // modal — a conversa abria de verdade, ninguém via, e o botão verde parecia
  // não fazer nada. Ver `styles/layers`.
  return createPortal(
    <ModalLayerProvider>
    <ChatImagesContext.Provider value={imageFilePaths}>
    <div className={`fixed bottom-5 right-4 sm:bottom-5 sm:right-5 ${zc.WIDGET} flex flex-col items-end`} style={{ isolation: 'isolate' }}>
      <style>{`
        @keyframes chatShake{0%{transform:translate(0,0) rotate(0) scale(1)}4%{transform:translate(-9px,5px) rotate(-3deg) scale(1.02)}8%{transform:translate(9px,-5px) rotate(3deg) scale(1.02)}12%{transform:translate(-9px,-5px) rotate(-3deg) scale(1.02)}16%{transform:translate(9px,5px) rotate(3deg) scale(1.02)}20%{transform:translate(-8px,-4px) rotate(-2.5deg) scale(1.01)}24%{transform:translate(8px,4px) rotate(2.5deg) scale(1.01)}28%{transform:translate(-7px,-3px) rotate(-2deg)}32%{transform:translate(7px,3px) rotate(2deg)}38%{transform:translate(-5px,-2px) rotate(-1.5deg)}44%{transform:translate(5px,2px) rotate(1.5deg)}52%{transform:translate(-3px,-1px) rotate(-1deg)}62%{transform:translate(3px,1px) rotate(0.5deg)}74%{transform:translate(-1px,0) rotate(0)}86%{transform:translate(1px,0)}100%{transform:translate(0,0) rotate(0) scale(1)}}
        @keyframes chatShakeGlow{0%,100%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.08)}8%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.5),0 0 40px 12px rgba(251,146,60,.35),inset 0 1px 0 rgba(255,255,255,.08)}22%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.4),0 0 28px 8px rgba(251,146,60,.25),inset 0 1px 0 rgba(255,255,255,.08)}40%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.25),0 0 16px 4px rgba(251,146,60,.15),inset 0 1px 0 rgba(255,255,255,.08)}65%{box-shadow:0 40px 80px -20px rgba(0,0,0,.65),0 0 0 1px rgba(251,146,60,.12),0 0 8px 2px rgba(251,146,60,.08),inset 0 1px 0 rgba(255,255,255,.08)}}
        @keyframes chatNudgeBanner{0%{opacity:0;transform:translateY(-100%) scaleX(.9)}40%{opacity:1;transform:translateY(4px) scaleX(1.01)}65%{transform:translateY(-2px) scaleX(.999)}80%{transform:translateY(1px)}100%{opacity:1;transform:translateY(0) scaleX(1)}}
        @keyframes chatNudgeRing1{0%{box-shadow:0 0 0 0 rgba(251,146,60,.65);opacity:1}100%{box-shadow:0 0 0 48px rgba(251,146,60,0);opacity:0}}
        @keyframes chatNudgeRing2{0%{box-shadow:0 0 0 0 rgba(251,146,60,.4);opacity:1}100%{box-shadow:0 0 0 72px rgba(251,146,60,0);opacity:0}}
        @keyframes chatNudgeFlash{0%{opacity:.22}100%{opacity:0}}
        @keyframes chatPanelIn{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes chatBackdropIn{from{opacity:0}to{opacity:1}}
        @keyframes chatGlowPulse{0%,100%{box-shadow:0 0 0 0 rgba(251,146,60,0)}50%{box-shadow:0 0 0 8px rgba(251,146,60,.15)}}
        @keyframes chatTypingDot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-3px);opacity:1}}
        @keyframes chatToastIn{0%{opacity:0;transform:translateY(20px) scale(.92)}55%{opacity:1;transform:translateY(-4px) scale(1.02)}75%{transform:translateY(2px) scale(.995)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes chatToastOut{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(10px) scale(.95)}}
        @keyframes chatToastProgress{0%{transform:scaleX(1)}100%{transform:scaleX(0)}}
        @keyframes chatWaveBar{0%,100%{transform:scaleY(.22);opacity:.45}50%{transform:scaleY(1);opacity:1}}
        .chat-scrollbar::-webkit-scrollbar{width:6px}
        .chat-scrollbar::-webkit-scrollbar-track{background:transparent}
        .chat-scrollbar::-webkit-scrollbar-thumb{background:rgba(15,23,42,.14);border-radius:3px}
        .chat-scrollbar::-webkit-scrollbar-thumb:hover{background:rgba(15,23,42,.26)}
        /* ── Tema CLARO do widget (escopo .cw-light) ──
           O markup foi desenhado para fundo escuro (text-white + overlays
           translúcidos brancos). Em vez de reescrever ~150 classes, remapeamos
           cada utilitário translúcido-branco para o equivalente translúcido-escuro,
           reusando o MESMO alfa para preservar a hierarquia visual. Os text-white
           SÓLIDOS (em botões/avatars coloridos) não casam estes seletores e
           permanecem brancos. Usamos seletor de atributo [class~="…"] para não
           depender de escapes de barra/colchete (que o template literal removeria). */
        .cw-light{color:#1e293b}
        .cw-light [class~="text-white/95"]{color:rgba(15,23,42,.95)}
        .cw-light [class~="text-white/85"]{color:rgba(15,23,42,.85)}
        .cw-light [class~="text-white/80"]{color:rgba(15,23,42,.8)}
        .cw-light [class~="text-white/70"]{color:rgba(15,23,42,.7)}
        .cw-light [class~="text-white/60"]{color:rgba(15,23,42,.6)}
        .cw-light [class~="text-white/55"]{color:rgba(15,23,42,.55)}
        .cw-light [class~="text-white/50"]{color:rgba(15,23,42,.5)}
        .cw-light [class~="text-white/45"]{color:rgba(15,23,42,.48)}
        .cw-light [class~="text-white/40"]{color:rgba(15,23,42,.45)}
        .cw-light [class~="text-white/35"]{color:rgba(15,23,42,.42)}
        .cw-light [class~="text-white/30"]{color:rgba(15,23,42,.38)}
        .cw-light [class~="text-white/25"]{color:rgba(15,23,42,.34)}
        .cw-light [class~="hover:text-white"]:hover{color:#0f172a}
        .cw-light [class~="hover:text-white/70"]:hover{color:rgba(15,23,42,.7)}
        .cw-light [class~="bg-white/[0.04]"],.cw-light [class~="bg-white/[0.05]"]{background-color:rgba(15,23,42,.04)}
        .cw-light [class~="bg-white/[0.06]"],.cw-light [class~="bg-white/[0.08]"]{background-color:rgba(15,23,42,.06)}
        .cw-light [class~="bg-white/10"]{background-color:rgba(15,23,42,.08)}
        .cw-light [class~="hover:bg-white/[0.04]"]:hover,.cw-light [class~="hover:bg-white/[0.05]"]:hover,.cw-light [class~="hover:bg-white/[0.06]"]:hover{background-color:rgba(15,23,42,.05)}
        .cw-light [class~="hover:bg-white/[0.10]"]:hover,.cw-light [class~="hover:bg-white/10"]:hover{background-color:rgba(15,23,42,.07)}
        .cw-light [class~="hover:bg-white/20"]:hover{background-color:rgba(15,23,42,.1)}
        .cw-light [class~="bg-[#f8f7f5]/[0.04]"]{background-color:rgba(15,23,42,.04)}
        .cw-light [class~="bg-[#f8f7f5]/[0.06]"]{background-color:rgba(15,23,42,.05)}
        .cw-light [class~="bg-[#f8f7f5]/[0.10]"]{background-color:rgba(15,23,42,.07)}
        .cw-light [class~="border-white/[0.06]"]{border-color:rgba(15,23,42,.08)}
        .cw-light [class~="border-white/[0.08]"]{border-color:rgba(15,23,42,.1)}
        .cw-light [class~="ring-white/20"],.cw-light [class~="ring-white/10"],.cw-light [class~="ring-white/5"],.cw-light [class~="ring-white/[0.08]"],.cw-light [class~="ring-white/[0.07]"],.cw-light [class~="ring-white/[0.06]"]{--tw-ring-color:rgba(15,23,42,.1)}
        .cw-light [class~="placeholder-white/40"]::placeholder,.cw-light [class~="placeholder-white/30"]::placeholder{color:rgba(15,23,42,.4)}
      `}</style>
      <AnimatePresence>
      {open && (
        <motion.div
          className="relative mb-3"
          /* Os números do movimento moram em `panelMotion` — a bancada usa os
             MESMOS, e é isso que a impede de mentir sobre a abertura. */
          style={{ transformOrigin: 'bottom right', willChange: 'transform, opacity' }}
          {...animacaoDoPainel(semMovimento)}
          onAnimationComplete={() => {
            // `will-change` é uma promessa cara: mantida depois do movimento,
            // segura uma camada de composição do tamanho do painel pelo resto
            // da sessão.
            if (painelRef.current) painelRef.current.style.willChange = 'auto';
          }}
          ref={painelRef}
        >
          {/* Anéis de pulso — expandem para fora do painel durante o shake */}
          {shaking && <>
            <div className="absolute inset-0 rounded-[24px] pointer-events-none"
              style={{ animation: 'chatNudgeRing1 0.65s ease-out both' }} />
            <div className="absolute inset-0 rounded-[24px] pointer-events-none"
              style={{ animation: 'chatNudgeRing2 0.75s 0.08s ease-out both' }} />
          </>}
        <div
          className="cw-light max-w-[calc(100vw-24px)] rounded-[24px] text-slate-800 overflow-hidden flex flex-col max-h-[calc(100vh-120px)] relative border border-slate-900/[0.10]"
          style={{
            width: panelW,
            height: panelH,
            transform: `translate(${panelPos.x}px, ${panelPos.y}px)`,
            ...(shaking
              ? { animation: 'chatShake 1s cubic-bezier(.36,.07,.19,.97) both, chatShakeGlow 1s ease-out both' }
              : {}),
            background: '#ffffff',
            // O trilho de canais é ABSOLUTO na borda esquerda, e o painel abre
            // esta faixa para ele. Sai mais barato — e sobretudo mais seguro —
            // do que embrulhar as novecentas linhas de cabeçalho e conversa numa
            // coluna nova: aqui é uma constante em dois lugares, ali seria uma
            // reindentação do arquivo inteiro. Se um dia o trilho mudar de
            // largura, os dois 56 mudam juntos.
            paddingLeft: hasWhatsAppAccess ? 56 : undefined,
            // Sem o anel branco de 6px que envolvia o painel: ele imitava uma
            // moldura de foto e brigava com a borda real do card.
            boxShadow:
              '0 24px 56px -20px rgba(15,23,42,.28), 0 8px 20px -12px rgba(15,23,42,.16), 0 0 0 1px rgba(15,23,42,.07)',
          }}
        >
          {/* O TRILHO DE CANAIS — a faixa que o paddingLeft acima reservou.
              Fica de pé o tempo todo, inclusive dentro de uma conversa: é dele
              que se lê em qual canal você está falando, e trocar de canal deixa
              de ser voltar-e-trocar-de-aba para ser um clique. */}
          {hasWhatsAppAccess && (
            <div className="absolute left-0 top-0 bottom-0 z-30 flex">
              <ChatChannelRail
                items={[
                  { key: 'whatsapp' as const, label: 'WhatsApp', icon: MessageCircle, count: waUnread, title: 'Conversas do WhatsApp' },
                  { key: 'equipe' as const, label: 'Equipe', icon: Users, count: totalUnreadFromRooms, title: 'Chat interno da equipe' },
                ]}
                value={chatTab}
                onChange={(canal) => {
                  // Trocar de canal fecha o que estava aberto DENTRO do canal
                  // anterior: voltar depois e reencontrar a conversa do outro
                  // lado meio aberta é o tipo de fantasma que faz responder a
                  // pessoa errada.
                  setChatTab(canal);
                  setSelectedRoomId(null);
                  setShowNewChatModal(false);
                }}
                onNew={chatTab === 'equipe' && !showNewChatModal
                  ? () => { setSelectedRoomId(null); setShowNewChatModal(true); }
                  : undefined}
                onDragHandlePointerDown={startPanelDrag('move')}
              />
            </div>
          )}

          {/* Pega de redimensionamento (largura) na borda esquerda */}
          <div
            onPointerDown={startPanelDrag('w')}
            className="absolute left-0 top-12 bottom-12 w-1.5 z-50 cursor-ew-resize group/resize"
            title="Arrastar para mudar a largura"
          >
            <div className="absolute inset-y-0 left-0 w-1 rounded-full bg-transparent group-hover/resize:bg-orange-400/40 transition-colors" />
          </div>
          {/* Pega de redimensionamento (altura) na borda superior */}
          <div
            onPointerDown={startPanelDrag('h')}
            className="absolute top-0 left-12 right-12 h-1.5 z-50 cursor-ns-resize group/resizeh"
            title="Arrastar para mudar a altura"
          >
            <div className="absolute inset-x-0 top-0 h-1 rounded-full bg-transparent group-hover/resizeh:bg-orange-400/40 transition-colors" />
          </div>
          {/* Canto superior-esquerdo: largura + altura juntas */}
          <div
            onPointerDown={startPanelDrag('wh')}
            className="absolute top-0 left-0 w-4 h-4 z-50 cursor-nwse-resize"
            title="Arrastar para redimensionar"
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
          <div
            onPointerDown={startPanelDrag('move')}
            /* Dois cliques devolvem o tamanho padrão. É o gesto de janela que
               todo mundo já tem no dedo, e ele libera o quarto botão que vivia
               aparecendo e sumindo do cabeçalho conforme você redimensionava. */
            onDoubleClick={() => { if (isCustomSize) resetWidgetSize(); }}
            title={isCustomSize ? 'Arraste para mover · dois cliques para voltar ao tamanho padrão' : undefined}
            className="relative px-3 py-2 flex items-center justify-between shrink-0 border-b border-white/[0.06] cursor-grab active:cursor-grabbing select-none touch-none"
          >
            <div className={`flex items-center min-w-0 ${!selectedRoomId && !showNewChatModal ? 'gap-2 shrink-0' : 'gap-2.5 flex-1'}`}>
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
                  {/* Com o trilho ao lado, o cabeçalho tem UMA coisa para dizer:
                      em qual canal você está. O ícone fica com o trilho —
                      repeti-lo aqui seria dizer duas vezes a mesma coisa. Sem
                      trilho (usuário sem acesso ao WhatsApp) não há canal a
                      nomear, e aí o painel se apresenta como sempre fez. */}
                  {!hasWhatsAppAccess && (
                    <MessageCircle className="w-[18px] h-[18px] text-slate-400 shrink-0" strokeWidth={1.9} />
                  )}
                  <span className="text-[14px] font-semibold tracking-tight text-slate-800 truncate">
                    {!hasWhatsAppAccess ? 'Mensagens' : chatTab === 'whatsapp' ? 'WhatsApp' : 'Equipe'}
                  </span>
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
              {/* ── OS TRÊS BOTÕES DA JANELA ──────────────────────────────
                  Eram três ícones que diziam outra coisa: o de "minimizar"
                  devolvia o tamanho padrão, o de "maximizar" TIRAVA você do
                  widget, e o X apagava a conversa aberta junto. Agora cada um
                  faz o que o desenho promete, e o tamanho padrão virou dois
                  cliques no cabeçalho — como em qualquer janela. */}

              {/* Abrir no módulo: é NAVEGAÇÃO, não janela. A seta que sai da
                  caixa diz "vou embora daqui"; o quadrado que cresce dizia
                  "esta janela vai aumentar", e não era isso que acontecia. */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (chatTab === 'whatsapp') {
                    navigateTo('whatsapp', (waActiveConvId ? { conversationId: waActiveConvId } : undefined) as any);
                  } else if (selectedRoomId) {
                    navigateTo('chat', { roomId: selectedRoomId } as any);
                  } else {
                    navigateTo('chat');
                  }
                }}
                className="h-8 w-8 rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center justify-center text-white/70 hover:text-white"
                title={chatTab === 'whatsapp' ? 'Abrir o módulo WhatsApp em tela cheia' : 'Abrir o Chat em tela cheia'}
              >
                <ExternalLink className="w-4 h-4" />
              </button>

              {/* Minimizar: sai da frente e NÃO esquece nada — a conversa, o
                  tamanho e a posição continuam de pé, guardados na barra. O
                  chevron é o mesmo que a barra mostra com o painel aberto:
                  duas peças, um gesto só. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-8 w-8 rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center justify-center text-white/70 hover:text-white"
                title="Minimizar — a conversa fica guardada na barra"
              >
                <ChevronDown className="w-[18px] h-[18px]" strokeWidth={2.1} />
              </button>

              {/* Fechar: encerra mesmo. Reabrir cai na lista. */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSelectedRoomId(null);
                  setWaActiveConvId(null);
                  setWaGuardado(null);
                }}
                className="h-8 w-8 rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-150 flex items-center justify-center text-white/70 hover:text-white"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* FAB "+" — nova conversa da Equipe, para quem NÃO tem o trilho.
              Com o trilho, este botão vive no pé dele: solto sobre a lista, era
              um segundo círculo laranja na mesma diagonal da barra "Fechar". */}
          {!hasWhatsAppAccess && !selectedRoomId && !showNewChatModal && chatTab === 'equipe' && (
            <button
              type="button"
              onClick={() => setShowNewChatModal(true)}
              className="absolute bottom-4 right-4 z-20 h-12 w-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-white flex items-center justify-center shadow-[0_8px_24px_-4px_rgba(251,146,60,.6)] ring-1 ring-white/20 hover:scale-105 active:scale-95 transition-transform duration-150"
              title="Nova conversa"
              aria-label="Nova conversa"
            >
              <Plus className="w-5 h-5" strokeWidth={2.5} />
            </button>
          )}

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
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-900/[0.03] border border-slate-900/[0.08] rounded-xl text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500/60 focus:bg-white transition-all"
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
              {chatTab === 'whatsapp' && hasWhatsAppAccess ? (
                // Modo lite: o WhatsAppModule real, embutido — herda todos os
                // recursos (reply, áudio, mídia/preview, transferência, lightbox…).
                <motion.div
                  key="corpo-whatsapp"
                  /* O corpo entra por dentro da moldura, não junto com ela: é o
                     que transforma o "pop" do conteúdo (que chega um quadro
                     depois) numa chegada. Vale também na troca de canal. */
                  {...animacaoDoCorpo(semMovimento)}
                  className="flex-1 min-h-0 overflow-hidden"
                >
                  {corpoPronto ? (
                    <WhatsAppModule
                      variant="embedded"
                      openConversationId={waOpenConvId ?? undefined}
                      openConversationDraft={waOpenDraft ?? undefined}
                      onParamConsumed={() => { setWaOpenConvId(null); setWaOpenDraft(null); }}
                      onActiveConversationChange={handleWaActiveConversation}
                      /* O Esc na lista fecha a janela: é o degrau que o módulo
                         não tem como dar sozinho, porque a janela é nossa. */
                      onEscapeExit={() => setOpen(false)}
                    />
                  ) : temInboxGuardada ? (
                    // Com a inbox na memória o corpo chega em um quadro: pôr um
                    // esqueleto aqui seria piscar cinza por 16ms sobre conteúdo
                    // que já existe. O vazio de um quadro ninguém vê.
                    <div className="flex-1" />
                  ) : (
                    <ConversationListSkeleton />
                  )}
                </motion.div>
              ) : (
              <motion.div
                key="corpo-equipe"
                {...animacaoDoCorpo(semMovimento)}
                className="flex-1 overflow-y-auto chat-scrollbar py-1"
              >
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
                  .filter(r => !r.portal_client_id) // equipe: sem portal (tickets saíram do widget)
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
                      onMouseEnter={() => prefetchRoomMessages(room.id)}
                      onFocus={() => prefetchRoomMessages(room.id)}
                      onClick={() => {
                        setToast(null);
                        setSelectedRoomId(room.id);
                        setRoomUnreadCounts((prev) => {
                          const next = new Map(prev);
                          next.set(room.id, 0);
                          return next;
                        });
                      }}
                      className={`group w-full mx-2 px-2.5 py-2 flex items-center gap-3 text-left rounded-xl transition-colors duration-100 ${
                        roomUnread > 0 ? 'hover:bg-slate-900/[0.05]' : 'hover:bg-slate-900/[0.04]'
                      }`}
                      style={{ width: 'calc(100% - 16px)' }}
                    >
                      {isTicketRoom ? (
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white text-[13px] font-semibold">
                            {displayName.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
                          </div>
                        </div>
                      ) : (
                        <Avatar src={avatarUrl} name={displayName} online={room.is_public ? undefined : online} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <div className={`text-[13.5px] truncate ${roomUnread > 0 ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>{displayName}</div>
                            {verified && <VerifiedBadge variant={verified} />}
                          </div>
                          <div className={`text-[11px] shrink-0 tabular-nums ${roomUnread > 0 ? 'text-orange-600 font-medium' : 'text-slate-400'}`}>
                            {room.last_message_at ? new Date(room.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-[3px]">
                          <div className={`text-[12.5px] truncate ${roomUnread > 0 ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                            {/* Preview de digitação do cliente */}
                            {isTicketRoom && (ticketTyping.get(room.id) ?? '').trim() ? (
                              <span className="flex items-center gap-1 text-orange-600 italic">
                                <span className="inline-flex gap-[2px] items-center">
                                  {[0,1,2].map(i => <span key={i} className="w-1 h-1 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                                </span>
                                {ticketTyping.get(room.id)!.slice(0, 30)}{(ticketTyping.get(room.id)?.length ?? 0) > 30 ? '…' : ''}
                              </span>
                            ) : (roomTypingUsers.get(room.id)?.length ?? 0) > 0 ? (
                              <span className="flex items-center gap-1.5 text-emerald-600">
                                {roomTypingUsers.get(room.id)!.length === 1
                                  ? 'digitando'
                                  : 'várias pessoas digitando'}
                                <span className="flex gap-[3px] items-center">
                                  {[0, 1, 2].map((i) => (
                                    <span key={i} className="block w-1 h-1 bg-emerald-500 rounded-full"
                                      style={{ animation: `chatTypingDot 1.2s ease-in-out ${i * 0.15}s infinite` }} />
                                  ))}
                                </span>
                              </span>
                            ) : (preview || subtitle)}
                          </div>
                          {roomUnread > 0 && (
                            /* Um ponto, não um número: com uma conversa por
                               linha, "3" ao lado do nome é ruído — o que importa
                               é QUE há algo por ler, e o nome em negrito já
                               carrega isso. O número exato continua no badge da
                               barra, que é onde ele decide se vale abrir. */
                            <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" aria-label={`${roomUnread} não lidas`} />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
                )}
              </motion.div>
              )}
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
                  <div className="absolute inset-2 z-10 bg-white/85 border-2 border-dashed border-orange-400 rounded-2xl flex flex-col items-center justify-center gap-2 pointer-events-none">
                    <Paperclip className="w-7 h-7 text-orange-500" />
                    <span className="text-[13px] font-medium text-slate-700">Solte para enviar</span>
                  </div>
                )}

                {loadingMessages && messages.length === 0 ? (
                  /* Esqueleto, não roda-roda: o desenho já tem a forma da
                     conversa que vai chegar, então a troca não dá o solavanco
                     de um bloco vazio virando texto. Com o cache, este estado
                     quase não aparece — ele é para a PRIMEIRA abertura. */
                  <div className="py-2 space-y-4" aria-label="Carregando mensagens">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="h-9 rounded-2xl bg-slate-900/[0.05] animate-pulse"
                          style={{ width: `${[62, 44, 72, 38][i]}%` }}
                        />
                      </div>
                    ))}
                  </div>
                ) : !loadingMessages && messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 py-16 px-6 text-center">
                    <span className="text-[13.5px] font-medium text-slate-600">Nenhuma mensagem ainda</span>
                    <span className="text-[12px] text-slate-400">Escreva abaixo para começar a conversa.</span>
                  </div>
                ) : (() => {
                  const otherReads = Array.from(readStates.entries())
                    .filter(([uid]) => uid !== user?.id)
                    .map(([, ts]) => ts)
                    .sort();
                  const otherReadAt = otherReads.length ? otherReads[otherReads.length - 1] : null;
                  let lastDayKey = '';

                  const toTitleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

                  /**
                   * Mensagens seguidas da mesma pessoa formam um BLOCO.
                   *
                   * Sem isto, quem escrevia três linhas seguidas gerava três
                   * nomes, três horários e três balões separados por espaço
                   * igual — a conversa parecia uma lista de registros, não uma
                   * fala. Dentro do bloco só o primeiro traz o nome e só o
                   * último traz o horário e o "rabinho" do balão.
                   *
                   * Cinco minutos é o corte: acima disso é outro momento, e
                   * juntar esconderia a pausa.
                   */
                  const JANELA_DO_BLOCO_MS = 5 * 60 * 1000;
                  const mesmaVoz = (a?: ChatMessage, b?: ChatMessage) =>
                    !!a && !!b && !a.is_system && !b.is_system && a.user_id === b.user_id
                    && Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < JANELA_DO_BLOCO_MS;

                  return messages.map((msg, idx) => {
                    const anterior = messages[idx - 1];
                    const proxima = messages[idx + 1];
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

                    const abreBloco = showSeparator || !mesmaVoz(anterior, msg);
                    const fechaBloco = !mesmaVoz(msg, proxima)
                      || (!!proxima && getDayKey(proxima.created_at) !== dayKey);

                    const replyMsg = msg.reply_to ? messages.find((m) => m.id === msg.reply_to) : null;
                    const replySender = replyMsg ? (membersByUserIdRef.current.get(replyMsg.user_id) || members.find((m) => m.user_id === replyMsg.user_id)) : null;

                    const isNew = newMessageIds.has(msg.id) && !isMine;

                    return (
                      <React.Fragment key={msg.id}>
                        {showSeparator && (
                          /* Uma etiqueta centralizada, sem os dois fios em
                             degradê: a data é uma marca de tempo, não uma
                             divisória de capítulo. */
                          <div className="flex justify-center py-3">
                            <span className="px-2.5 py-1 rounded-full bg-slate-900/[0.05] text-[10.5px] font-medium text-slate-500">
                              {formatDateSeparator(msg.created_at)}
                            </span>
                          </div>
                        )}
                        {/* ── Mensagem de sistema (nudge, eventos) ── */}
                        {msg.is_system ? (
                          <div className="flex items-center justify-center py-1.5 px-4 my-0.5">
                            <span className="px-2.5 py-1 rounded-full bg-amber-50 ring-1 ring-amber-200/70 text-[11px] font-medium text-amber-700">
                              {msg.content}
                            </span>
                          </div>
                        ) : (
                        <div
                          className={`group flex flex-col min-w-0 ${fechaBloco ? 'mb-2.5' : 'mb-[3px]'} ${isMine ? 'items-end' : 'items-start'} ${isNew ? 'animate-in fade-in slide-in-from-bottom-1 duration-200' : ''}`}
                        >
                          {!isMine && abreBloco && (
                            <div className="text-[11px] font-medium text-slate-500 mb-1 ml-2.5">{senderName}</div>
                          )}

                          {/* Reply preview */}
                          {replyMsg && !isDeleted && (
                            <div className={`mb-1 px-2.5 py-1.5 rounded-lg border-l-2 border-orange-400 bg-slate-900/[0.04] max-w-[80%] ${isMine ? 'mr-1' : 'ml-1'}`}>
                              <div className="text-[10.5px] font-semibold text-orange-700 truncate">
                                {replySender?.name || 'Usuário'}
                              </div>
                              <div className="text-[11.5px] text-slate-500 truncate">
                                {replyMsg.deleted_at ? 'Mensagem apagada' : getPreview(replyMsg.content)}
                              </div>
                            </div>
                          )}

                          <div className="flex items-end gap-1">
                            {!isMine && (
                              <button
                                type="button"
                                onClick={() => setReplyTo(msg)}
                                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-100 h-7 w-7 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-900/[0.06] flex items-center justify-center shrink-0 mb-1"
                                title="Responder"
                              >
                                <Reply className="w-3 h-3" />
                              </button>
                            )}
                            <div
                              /* Quem fala sou EU leva a cor da marca; quem fala
                                 comigo leva o cinza. Estava invertido — a
                                 mensagem RECEBIDA vinha num degradê laranja com
                                 halo e a minha num cinza pálido, o oposto de
                                 qualquer chat e a maior fonte de ruído da tela.
                                 Cor chapada nos dois, sem sombra colorida.
                                 O canto reto só no ÚLTIMO balão do bloco: é ele
                                 que aponta para quem falou. */
                              className={`max-w-[80%] px-3.5 py-2 text-[13.5px] leading-[1.45] overflow-hidden ${
                                isDeleted
                                  ? 'rounded-2xl bg-slate-900/[0.04] text-slate-400 italic ring-1 ring-slate-900/[0.06]'
                                  : isMine
                                    ? `bg-orange-500 text-white rounded-2xl ${fechaBloco ? 'rounded-br-md' : ''}`
                                    : `bg-slate-100 text-slate-800 ring-1 ring-slate-900/[0.05] rounded-2xl ${fechaBloco ? 'rounded-bl-md' : ''}`
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
                                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-100 h-7 w-7 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-900/[0.06] flex items-center justify-center shrink-0 mb-1"
                                title="Responder"
                              >
                                <Reply className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {/* Uma hora por BLOCO, no fim dele. Repetida a cada
                              linha, ela dobrava a altura de uma sequência de
                              respostas curtas para informar três vezes o mesmo
                              minuto. */}
                          {fechaBloco && (
                            <div className={`text-[10.5px] text-slate-400 mt-1 flex items-center gap-1 tabular-nums ${isMine ? 'mr-9' : 'ml-9'}`}>
                              {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              {msg.edited_at && !isDeleted && <span className="text-slate-300">· editada</span>}
                              {isMine && !isDeleted && (
                                <span
                                  className={`ml-0.5 ${seen ? 'text-sky-500' : 'text-slate-400'}`}
                                  title={seen ? 'Visualizada' : 'Enviada'}
                                >
                                  {seen ? '✓✓' : '✓'}
                                </span>
                              )}
                            </div>
                          )}
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
                    className="h-9 w-9 rounded-full bg-white text-slate-600 hover:text-slate-900 ring-1 ring-slate-900/10 shadow-[0_4px_14px_-4px_rgba(15,23,42,.30)] flex items-center justify-center transition-colors duration-100"
                    title="Ir para o fim"
                  >
                    <ChevronDown className="w-4 h-4" />
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

              <div className="p-3 border-t border-white/[0.06] bg-white">
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
                            style={{ height: '38px', background: 'rgba(15,23,42,0.04)', border: '1px solid rgba(15,23,42,0.08)' }}>
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
                                  style={{ height: `${18 + ((i * 43 + i * i * 7) % 82)}%`, background: 'rgba(15,23,42,0.18)' }} />
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
                          style={{ height: '40px', background: 'rgba(15,23,42,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
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
                      className="absolute bottom-14 left-0 z-20 w-[300px] rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.08] shadow-[0_20px_60px_rgba(15,23,42,.18)]"
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
                    className="min-w-0 flex-1 bg-slate-900/[0.03] border border-slate-900/[0.08] rounded-xl px-3.5 py-2 text-[13.5px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500/60 focus:bg-white focus:shadow-[0_0_0_3px_rgba(251,146,60,.12)] transition-all"
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
        </motion.div>
      )}
      </AnimatePresence>

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

      <ChatLauncherBar
        badgeCount={badgeCount}
        title={launcherTitle}
        open={open}
        peerName={topUnreadUser?.name || lastUnreadImageSender?.name || null}
        peerAvatarUrl={topUnreadUser?.avatar_url || lastUnreadImageSender?.avatarUrl || null}
        editorMinimized={petitionEditorMinimized}
        editorHasUnsavedChanges={petitionEditorHasUnsavedChanges}
        guardedName={conversaGuardada?.nome ?? null}
        guardedAvatarUrl={conversaGuardada?.avatarUrl ?? null}
        onOpenEditor={() => events.emit(SYSTEM_EVENTS.PETITION_EDITOR_MAXIMIZE)}
        onToggle={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) {
              setNotifyCount(0);
              setToast(null);
              setLastUnreadImageSender(null);
              ensureAudioContext();
              // Voltar é voltar para ONDE VOCÊ ESTAVA. A conversa guardada ganha
              // do topo da fila: quem minimizou no meio de uma conversa não quer
              // reabrir noutra, por mais urgente que a outra pareça.
              if (chatTab === 'whatsapp') {
                if (waActiveConvId) setWaOpenConvId(waActiveConvId);
              } else if (!selectedRoomId && topUnreadRoom) {
                setSelectedRoomId(topUnreadRoom.id);
              }
            } else {
              // A barra aberta é o botão de FECHAR do painel — e fechar limpa.
              // Minimizar, que guarda, é o chevron do cabeçalho.
              setSelectedRoomId(null);
              setWaActiveConvId(null);
              setWaGuardado(null);
            }
            return next;
          });
        }}
      />
    </div>
    </ChatImagesContext.Provider>
    </ModalLayerProvider>,
    document.body
  );
};

export default ChatFloatingWidget;
