import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Users,
  Briefcase,
  Calendar,
  CheckSquare,
  Bell,
  FileText,
  Gavel,
  MessageCircle,
  Heart,
  Share2,
  MoreHorizontal,
  Bookmark,
  Newspaper,
  ThumbsUp,
  Loader2,
  CheckCircle,
  Timer,
  Sparkles,
  GripVertical,
  AtSign,
  Hash,
  Send,
  Image,
  Smile,
  X,
  DollarSign,
  Clock,
  Trash2,
  Pencil,
  BarChart2,
  Plus,
  Minus,
  Shield,
  Scale,
  Award,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Globe,
  Lock,
  Check,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useToastContext } from '../contexts/ToastContext';
import { usePermissions } from '../hooks/usePermissions';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { taskService } from '../services/task.service';
import { calendarService } from '../services/calendar.service';
import { djenLocalService } from '../services/djenLocal.service';
import { requirementService } from '../services/requirement.service';
import { profileService, type Profile } from '../services/profile.service';
import { financialService } from '../services/financial.service';
import { dashboardPreferencesService } from '../services/dashboardPreferences.service';
import { feedPostsService, type FeedPost, type EntityReference, type PreviewData, type TagRecord } from '../services/feedPosts.service';
import { feedPollsService, type FeedPoll, type FeedPollVoter } from '../services/feedPolls.service';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Deadline } from '../types/deadline.types';
import type { Task } from '../types/task.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { DjenComunicacaoLocal } from '../types/djen.types';
import type { FinancialStats } from '../types/financial.types';
import type { Requirement } from '../types/requirement.types';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { FinancialCard } from './dashboard/FinancialCard';
import { FinancialModal } from './FinancialModal';
import { PostModal } from './PostModal';
import { supabase } from '../config/supabase';
import { userNotificationService } from '../services/userNotification.service';

interface FeedProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, string>) => void;
  params?: Record<string, string>;
}

// Cache keys e configuração
const DASHBOARD_CACHE_KEY = 'crm-dashboard-social-cache';
const DASHBOARD_CACHE_VERSION = 1;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos (aumentado para menos reloads)
const REQUEST_TIMEOUT_MS = 10000; // 10s timeout

interface DashboardCache {
  version: number;
  timestamp: number;
  data: {
    clients: Client[];
    processes: Process[];
    deadlines: Deadline[];
    tasks: Task[];
    calendarEvents: CalendarEvent[];
    djenIntimacoes: DjenComunicacaoLocal[];
    financialStats: FinancialStats | null;
    requirementsAwaiting: Requirement[];
  };
}

// Função para carregar cache instantaneamente (síncrono)
const getInstantCache = (): DashboardCache['data'] | null => {
  try {
    const cachedData = localStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!cachedData) return null;
    const cache: DashboardCache = JSON.parse(cachedData);
    const now = Date.now();
    const isValid =
      cache?.version === DASHBOARD_CACHE_VERSION &&
      typeof cache?.timestamp === 'number' &&
      cache?.data &&
      Array.isArray(cache.data.clients) &&
      Array.isArray(cache.data.processes) &&
      Array.isArray(cache.data.deadlines) &&
      Array.isArray(cache.data.tasks) &&
      Array.isArray(cache.data.calendarEvents) &&
      Array.isArray(cache.data.djenIntimacoes) &&
      typeof cache.data.financialStats !== 'undefined' &&
      Array.isArray(cache.data.requirementsAwaiting);
    // Cache válido por 2 horas para carregamento instantâneo
    if (isValid && now - cache.timestamp < 2 * 60 * 60 * 1000) {
      return cache.data;
    }
  } catch {
    // Ignora erros de parse
  }
  return null;
};

// Cache para publicações do Feed
const FEED_POSTS_CACHE_KEY = 'crm-feed-posts-cache';
const FEED_POSTS_CACHE_VERSION = 1;

interface FeedPostsCache {
  version: number;
  timestamp: number;
  posts: FeedPost[];
}

// Função para carregar cache de posts instantaneamente (síncrono)
const getInstantPostsCache = (): FeedPost[] | null => {
  try {
    const cachedData = localStorage.getItem(FEED_POSTS_CACHE_KEY);
    if (!cachedData) return null;
    const cache: FeedPostsCache = JSON.parse(cachedData);
    const now = Date.now();
    const isValid =
      cache?.version === FEED_POSTS_CACHE_VERSION &&
      typeof cache?.timestamp === 'number' &&
      Array.isArray(cache?.posts);
    // Cache válido por 1 hora para carregamento instantâneo
    if (isValid && now - cache.timestamp < 60 * 60 * 1000) {
      return cache.posts;
    }
  } catch {
    // Ignora erros de parse
  }
  return null;
};

// Função para salvar cache de posts
const savePostsCache = (posts: FeedPost[]) => {
  try {
    const cache: FeedPostsCache = {
      version: FEED_POSTS_CACHE_VERSION,
      timestamp: Date.now(),
      posts: posts.slice(0, 20), // Limitar a 20 posts no cache
    };
    localStorage.setItem(FEED_POSTS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignora erros de quota
  }
};

// Componente de Avatar
const Avatar: React.FC<{ src?: string | null; name: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }> = ({
  src,
  name,
  size = 'md',
}) => {
  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
    xl: 'w-16 h-16 text-lg',
  };

  const initials = name
    .split(' ')
    .filter((n) => n.length > 0)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (src) {
    return (
      <div
        className={`${sizeClasses[size]} rounded-full bg-cover bg-center bg-no-repeat border-2 border-white shadow-sm shrink-0`}
        style={{ backgroundImage: `url(${src})` }}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shrink-0 shadow-sm`}
    >
      {initials || '?'}
    </div>
  );
};

// Componente de Badge para Advogado/Administrador
const BadgeIcon: React.FC<{ badge?: string | null; className?: string }> = ({ badge, className = '' }) => {
  if (!badge) return null;
  
  switch (badge) {
    case 'administrador':
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold shadow-sm ${className}`}>
          <Shield className="w-3 h-3" />
          Admin
        </span>
      );
    case 'advogado':
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[10px] font-bold shadow-sm ${className}`}>
          <Scale className="w-3 h-3" />
          Advogado
        </span>
      );
    case 'estagiario':
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-[10px] font-bold shadow-sm ${className}`}>
          <Award className="w-3 h-3" />
          Estagiário
        </span>
      );
    default:
      return null;
  }
};

// Componente de Card de Estatística
const StatCard: React.FC<{
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: number;
  hoverVariant: 'blue' | 'purple' | 'red' | 'green';
  onClick?: () => void;
}> = ({ icon, iconColor, label, value, hoverVariant, onClick }) => {
  const hoverClass =
    hoverVariant === 'blue'
      ? 'hover:border-blue-200'
      : hoverVariant === 'purple'
        ? 'hover:border-purple-200'
        : hoverVariant === 'red'
          ? 'hover:border-red-200'
          : 'hover:border-green-200';

  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-xl p-2 border border-slate-200 shadow-sm flex flex-col items-center sm:items-start ${hoverClass} transition-colors cursor-pointer`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`${iconColor} [&_svg]:w-4 [&_svg]:h-4`}>{icon}</span>
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-lg font-bold text-slate-900 leading-none">{value}</span>
    </button>
  );
};

// Componente de Item da Agenda
const AgendaItem: React.FC<{
  time: string;
  dateLabel: string;
  isToday?: boolean;
  title: string;
  subtitle: string;
  onClick?: () => void;
}> = ({ time, dateLabel, isToday, title, subtitle, onClick }) => (
  <div
    onClick={onClick}
    className="flex items-start gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer group"
  >
    <div
      className={`flex flex-col items-center justify-center min-w-[50px] rounded-lg py-2 px-1 border ${
        isToday ? 'bg-blue-50 border-blue-200' : 'bg-slate-100 border-transparent'
      }`}
    >
      <span className={`text-[10px] font-bold uppercase ${isToday ? 'text-blue-700' : 'text-slate-500'}`}>
        {dateLabel}
      </span>
      <span className={`text-lg font-bold leading-none ${isToday ? 'text-blue-900' : 'text-slate-900'}`}>{time}</span>
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-slate-900 text-sm font-semibold truncate">{title}</p>
      <p className="text-slate-500 text-xs truncate">{subtitle}</p>
    </div>
  </div>
);

// Componente de Tarefa
const TaskItem: React.FC<{
  title: string;
  dueLabel: string;
  isUrgent?: boolean;
  onToggle?: () => void;
}> = ({ title, dueLabel, isUrgent, onToggle }) => (
  <div className="flex items-start gap-3 group">
    <input
      type="checkbox"
      onChange={onToggle}
      className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
    />
    <div className="flex-1 group-hover:bg-slate-50 rounded p-1 -m-1 transition-colors">
      <p className="text-slate-800 text-sm font-medium">{title}</p>
      <p className={`text-xs font-medium ${isUrgent ? 'text-red-500' : 'text-slate-500'}`}>{dueLabel}</p>
    </div>
  </div>
);

// Componente de Notificação DJEN
const DjenNotification: React.FC<{
  processNumber: string;
  content: string;
  timeAgo: string;
  onClick?: () => void;
}> = ({ processNumber, content, timeAgo, onClick }) => (
  <div
    onClick={onClick}
    className="p-3 bg-slate-50 rounded-lg border border-slate-100 cursor-pointer hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
  >
    <div className="flex justify-between items-start mb-1">
      <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
        {processNumber}
      </span>
      <span className="text-[10px] text-slate-400">{timeAgo}</span>
    </div>
    <p className="text-xs text-slate-800 line-clamp-2">{content}</p>
  </div>
);

// Componente de Post/Atualização
const FeedPost: React.FC<{
  author: { name: string; role: string; avatar?: string | null };
  timeAgo: string;
  content: React.ReactNode;
  badge?: { label: string; color: string };
  likes?: number;
  comments?: number;
  highlight?: { icon: React.ReactNode; title: string; subtitle: string; color: string };
}> = ({ author, timeAgo, content, badge, likes = 0, comments = 0, highlight }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="p-4 pb-2 flex gap-3">
      <Avatar src={author.avatar} name={author.name} />
      <div className="flex flex-col flex-1">
        <div className="flex items-center gap-2">
          <p className="text-slate-900 font-bold text-sm">{author.name}</p>
          {badge && (
            <span className={`${badge.color} text-[10px] font-bold px-2 py-0.5 rounded-full`}>
              {badge.label}
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs">
          {author.role} • {timeAgo}
        </p>
      </div>
      <button className="ml-auto text-slate-400 hover:text-slate-600">
        <MoreHorizontal className="w-5 h-5" />
      </button>
    </div>
    <div className="px-4 py-2">
      <div className="text-slate-800 text-sm leading-relaxed mb-3">{content}</div>
      {highlight && (
        <div className={`${highlight.color} rounded-lg p-3 flex items-center gap-3`}>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white shrink-0 shadow-sm">
            {highlight.icon}
          </div>
          <div>
            <p className="text-white font-bold text-sm">{highlight.title}</p>
            <p className="text-white/80 text-xs">{highlight.subtitle}</p>
          </div>
        </div>
      )}
    </div>
    <div className="px-4 py-2 flex items-center justify-between text-xs text-slate-500 border-b border-slate-200 mt-2">
      <div className="flex items-center gap-1">
        <div className="flex -space-x-1.5">
          <div className="w-5 h-5 rounded-full bg-blue-500 border border-white flex items-center justify-center">
            <ThumbsUp className="w-2.5 h-2.5 text-white" />
          </div>
          {likes > 5 && (
            <div className="w-5 h-5 rounded-full bg-red-500 border border-white flex items-center justify-center">
              <Heart className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>
        <span className="ml-1 hover:underline cursor-pointer font-medium text-slate-600">
          {likes > 0 ? `${likes} curtidas` : 'Seja o primeiro'}
        </span>
      </div>
      <span className="hover:underline cursor-pointer font-medium text-slate-600">
        {comments} comentário{comments !== 1 ? 's' : ''}
      </span>
    </div>
    <div className="flex items-center px-2 py-1 bg-slate-50/50">
      <button className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-slate-100 rounded-lg text-slate-600 text-sm font-medium transition-colors">
        <ThumbsUp className="w-5 h-5" />
        Curtir
      </button>
      <button className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-slate-100 rounded-lg text-slate-600 text-sm font-medium transition-colors">
        <MessageCircle className="w-5 h-5" />
        Comentar
      </button>
      <button className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-slate-100 rounded-lg text-slate-600 text-sm font-medium transition-colors">
        <Share2 className="w-5 h-5" />
        Compartilhar
      </button>
    </div>
  </div>
);

// Tipos para Widgets
interface WidgetConfig {
  id: string;
  type:
    | 'agenda'
    | 'tarefas'
    | 'djen'
    | 'confeccao'
    | 'financeiro'
    | 'prazos'
    | 'navegacao'
    | 'sugestoes'
    | 'tendencias'
    | 'eventos';
  title: string;
  visible: boolean;
}

const WIDGET_ORDER_KEY = 'crm-dashboard-widget-order';

// Componente de Sidebar Droppable
const SidebarDroppable: React.FC<{
  id: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-4 transition-colors ${isOver ? 'bg-blue-50/50 rounded-xl p-2 -mx-2' : ''}`}
    >
      {children}
    </div>
  );
};

// Componente de Widget Arrastável
const SortableWidget: React.FC<{
  id: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div
        {...attributes}
        {...listeners}
        className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-white rounded-full p-1 shadow-md border border-slate-200"
      >
        <GripVertical className="w-4 h-4 text-slate-400" />
      </div>
      {children}
    </div>
  );
};

const Feed: React.FC<FeedProps> = ({ onNavigateToModule, params }) => {
  const { user } = useAuth();
  const { canView, isAdmin, loading: permissionsLoading } = usePermissions();
  const { confirmDelete } = useDeleteConfirm();
  const toast = useToastContext();
  const avatarSyncedRef = useRef(false);
  
  // Carregar cache instantaneamente para evitar loading visível
  const instantCache = useMemo(() => getInstantCache(), []);
  const hasInstantCache = !!instantCache;
  
  const [loading, setLoading] = useState(!hasInstantCache); // Sem loading se tiver cache
  const [clients, setClients] = useState<Client[]>(instantCache?.clients || []);
  const [processes, setProcesses] = useState<Process[]>(instantCache?.processes || []);
  const [deadlines, setDeadlines] = useState<Deadline[]>(instantCache?.deadlines || []);
  const [tasks, setTasks] = useState<Task[]>(instantCache?.tasks || []);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(instantCache?.calendarEvents || []);
  const [djenIntimacoes, setDjenIntimacoes] = useState<DjenComunicacaoLocal[]>(instantCache?.djenIntimacoes || []);
  const [financialStats, setFinancialStats] = useState<FinancialStats | null>(instantCache?.financialStats || null);
  const [requirementsAwaiting, setRequirementsAwaiting] = useState<Requirement[]>(instantCache?.requirementsAwaiting || []);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [postText, setPostText] = useState('');
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const postInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ localUrl: string; attachment: any }>>([]);

  const resolvedCurrentAvatarUrl = useMemo(() => {
    const meta: any = (user as any)?.user_metadata || {};
    return (
      currentProfile?.avatar_url ||
      meta?.avatar_url ||
      meta?.picture ||
      meta?.avatarUrl ||
      meta?.photoURL ||
      null
    );
  }, [currentProfile?.avatar_url, user]);

  useEffect(() => {
    if (!user?.id) return;
    if (!currentProfile) return;
    if (avatarSyncedRef.current) return;
    if (currentProfile.avatar_url) return;

    const meta: any = (user as any)?.user_metadata || {};
    const metaAvatar = meta?.avatar_url || meta?.picture || meta?.avatarUrl || meta?.photoURL;
    if (!metaAvatar) return;

    avatarSyncedRef.current = true;
    profileService
      .upsertProfile(user.id, {
        name: currentProfile.name || meta?.full_name || meta?.name || 'Usuário',
        email: currentProfile.email || user.email || '',
        role: currentProfile.role || 'Membro',
        avatar_url: metaAvatar,
      })
      .then((updated) => setCurrentProfile(updated))
      .catch(() => {
        avatarSyncedRef.current = false;
      });
  }, [currentProfile, user]);

  const insertTextAtCursor = useCallback(
    (text: string) => {
      const el = postInputRef.current;
      if (!el) {
        setPostText((prev) => `${prev}${text}`);
        return;
      }

      const start = el.selectionStart ?? postText.length;
      const end = el.selectionEnd ?? postText.length;
      const next = `${postText.slice(0, start)}${text}${postText.slice(end)}`;
      setPostText(next);

      requestAnimationFrame(() => {
        try {
          el.focus();
          const pos = start + text.length;
          el.setSelectionRange(pos, pos);
        } catch {}
      });
    },
    [postText]
  );

  const handlePickEmoji = useCallback(
    (emoji: string) => {
      insertTextAtCursor(emoji);
      setShowEmojiPicker(false);
    },
    [insertTextAtCursor]
  );

  const handleAttachClick = useCallback(() => {
    if (uploadingAttachment) return;
    fileInputRef.current?.click();
  }, [uploadingAttachment]);

  const handleUploadAttachment = useCallback(async (file: File) => {
    setUploadingAttachment(true);
    try {
      const localUrl = URL.createObjectURL(file);
      const attachment = await feedPostsService.uploadAttachment(file);
      setPendingAttachments((prev) => [...prev, { localUrl, attachment }]);
    } catch (err: any) {
      console.error('Falha ao enviar anexo:', err);
      alert(`Falha ao enviar anexo: ${err?.message ?? 'erro desconhecido'}`);
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  // Feed posts state - carregar cache instantaneamente
  const instantPostsCache = useMemo(() => getInstantPostsCache(), []);
  const hasInstantPostsCache = !!instantPostsCache && instantPostsCache.length > 0;
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>(instantPostsCache || []);
  const [loadingPosts, setLoadingPosts] = useState(!hasInstantPostsCache);
  const feedPostsInFlightRef = useRef(false);
  const feedPostsCountRef = useRef(0);
  useEffect(() => {
    feedPostsCountRef.current = feedPosts.length;
  }, [feedPosts.length]);
  const [postingInProgress, setPostingInProgress] = useState(false);
  const [openPostMenu, setOpenPostMenu] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingVisibility, setEditingVisibility] = useState<'public' | 'private' | 'team'>('public');
  const [editingAudienceUserIds, setEditingAudienceUserIds] = useState<string[]>([]);
  const [editingAudienceRoles, setEditingAudienceRoles] = useState<string[]>([]);
  const [editingAudienceSearch, setEditingAudienceSearch] = useState('');
  const inlineEditRef = useRef<HTMLTextAreaElement | null>(null);
  const [showMentionDropdownInline, setShowMentionDropdownInline] = useState(false);
  const [showTagDropdownInline, setShowTagDropdownInline] = useState(false);
  const [inlineMentionQuery, setInlineMentionQuery] = useState('');
  const [inlineTagQuery, setInlineTagQuery] = useState('');
  
  // Visibilidade e agendamento do post
  const [postVisibility, setPostVisibility] = useState<'public' | 'private' | 'team'>('public');
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  // Audiência (destinatários) para posts privados/equipe
  const [audienceUserIds, setAudienceUserIds] = useState<string[]>([]);
  const [audienceRoles, setAudienceRoles] = useState<string[]>([]);
  const [audienceSearch, setAudienceSearch] = useState('');
  const [isMobileComposerActionsExpanded, setIsMobileComposerActionsExpanded] = useState(false);

  const availableAudienceRoles = useMemo(() => {
    const roles = Array.from(
      new Set(
        (allProfiles || [])
          .map((p) => (p.role || '').trim())
          .filter((r) => r.length > 0)
      )
    );
    roles.sort((a, b) => a.localeCompare(b));
    return roles;
  }, [allProfiles]);

  const filteredAudienceProfiles = useMemo(() => {
    const q = audienceSearch.trim().toLowerCase();
    if (!q) return allProfiles;
    return allProfiles.filter((p) => (p.name || '').toLowerCase().includes(q));
  }, [audienceSearch, allProfiles]);

  const filteredEditingAudienceProfiles = useMemo(() => {
    const q = editingAudienceSearch.trim().toLowerCase();
    if (!q) return allProfiles;
    return allProfiles.filter((p) => (p.name || '').toLowerCase().includes(q));
  }, [editingAudienceSearch, allProfiles]);

  useEffect(() => {
    if (postVisibility === 'public') {
      setAudienceUserIds([]);
      setAudienceRoles([]);
      setAudienceSearch('');
    }
  }, [postVisibility]);

  useEffect(() => {
    if (editingVisibility === 'public') {
      setEditingAudienceUserIds([]);
      setEditingAudienceRoles([]);
      setEditingAudienceSearch('');
    }
  }, [editingVisibility]);

  // Estado para comentários inline (expandidos abaixo do post)
  const [expandedComments, setExpandedComments] = useState<Record<string, {
    comments: Array<{ user_id: string; name: string; avatar_url?: string; content: string; created_at: string }>;
    loading: boolean;
    newComment: string;
    submitting: boolean;
    showMentionDropdown: boolean;
    mentionSearch: string;
  }>>({});

  // Available tags (definido antes dos filtros inline que dependem dele)
  const availableTags = [
    { id: 'financeiro', label: 'Financeiro', icon: DollarSign, color: 'bg-emerald-100 text-emerald-700' },
    { id: 'processo', label: 'Processo', icon: Gavel, color: 'bg-purple-100 text-purple-700' },
    { id: 'prazo', label: 'Prazo', icon: Clock, color: 'bg-red-100 text-red-700' },
    { id: 'cliente', label: 'Cliente', icon: Users, color: 'bg-blue-100 text-blue-700' },
    { id: 'agenda', label: 'Agenda', icon: Calendar, color: 'bg-amber-100 text-amber-700' },
    { id: 'documento', label: 'Documento', icon: FileText, color: 'bg-indigo-100 text-indigo-700' },
    { id: 'peticao', label: 'Petição', icon: ScrollText, color: 'bg-cyan-100 text-cyan-700' },
    { id: 'assinatura', label: 'Assinatura', icon: Pencil, color: 'bg-pink-100 text-pink-700' },
    { id: 'requerimento', label: 'Requerimento', icon: Briefcase, color: 'bg-orange-100 text-orange-700' },
  ];

  // Filtrar perfis para menção (composer)
  const filteredProfiles = useMemo(() => {
    if (!mentionSearch) return allProfiles;
    return allProfiles.filter((profile) =>
      profile.name.toLowerCase().includes(mentionSearch.toLowerCase())
    );
  }, [mentionSearch, allProfiles]);

  // ===== Editor inline (edição no próprio post) =====
  // Importante: NÃO reutiliza estados/handlers do composer, para não editar os dois campos.
  const filteredProfilesInline = useMemo(() => {
    const q = inlineMentionQuery.trim().toLowerCase();
    if (!q) return allProfiles;
    return allProfiles.filter((profile) => profile.name.toLowerCase().includes(q));
  }, [inlineMentionQuery, allProfiles]);

  const filteredTagsInline = useMemo(() => {
    const q = inlineTagQuery.trim().toLowerCase();
    if (!q) return availableTags;
    return availableTags.filter((tag) => tag.label.toLowerCase().includes(q));
  }, [inlineTagQuery, availableTags]);

  const handleInlineEditChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setEditingContent(value);

    const cursorPos = e.target.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursorPos);

    const mentionMatch = beforeCursor.match(/@([^\s@#]*)$/);
    const tagMatch = beforeCursor.match(/#([^\s@#]*)$/);

    if (mentionMatch) {
      setInlineMentionQuery(mentionMatch[1] || '');
      setShowMentionDropdownInline(true);
      setShowTagDropdownInline(false);
      return;
    }

    if (tagMatch) {
      setInlineTagQuery(tagMatch[1] || '');
      setShowTagDropdownInline(true);
      setShowMentionDropdownInline(false);
      return;
    }

    setShowMentionDropdownInline(false);
    setShowTagDropdownInline(false);
    setInlineMentionQuery('');
    setInlineTagQuery('');
  }, []);

  const insertMentionInline = useCallback((profile: Profile) => {
    const el = inlineEditRef.current;
    const content = editingContent;
    const token = `@${profile.name} `;

    if (!el) {
      setEditingContent((prev) => prev + token);
      setShowMentionDropdownInline(false);
      setInlineMentionQuery('');
      return;
    }

    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const before = content.slice(0, start);
    const after = content.slice(end);

    const match = before.match(/@([^\s@#]*)$/);
    const replaceFrom = match ? before.length - match[0].length : before.length;
    const newText = content.slice(0, replaceFrom) + token + after;

    setEditingContent(newText);
    setShowMentionDropdownInline(false);
    setInlineMentionQuery('');

    requestAnimationFrame(() => {
      const pos = replaceFrom + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, [editingContent]);

  const insertTagInline = useCallback((tagId: string) => {
    const tag = availableTags.find((t) => t.id === tagId);
    if (!tag) return;

    const el = inlineEditRef.current;
    const content = editingContent;
    const token = `#${tag.label} `;

    if (!el) {
      setEditingContent((prev) => prev + token);
      setShowTagDropdownInline(false);
      setInlineTagQuery('');
      return;
    }

    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const before = content.slice(0, start);
    const after = content.slice(end);

    const match = before.match(/#([^\s@#]*)$/);
    const replaceFrom = match ? before.length - match[0].length : before.length;
    const newText = content.slice(0, replaceFrom) + token + after;

    setEditingContent(newText);
    setShowTagDropdownInline(false);
    setInlineTagQuery('');

    requestAnimationFrame(() => {
      const pos = replaceFrom + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, [availableTags, editingContent]);

  // Poll (enquete) state
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(true);
  const [pollExpiresIn, setPollExpiresIn] = useState<string>('24h');
  const [pollParticipants, setPollParticipants] = useState<string[]>([]);
  const [postPolls, setPostPolls] = useState<Map<string, FeedPoll>>(new Map());

  // Event creator state
  const [showEventCreator, setShowEventCreator] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [eventLocation, setEventLocation] = useState('');

  // Article creator state
  const [showArticleCreator, setShowArticleCreator] = useState(false);
  const [articleTitle, setArticleTitle] = useState('');
  const [articleContent, setArticleContent] = useState('');
  const [articleCategory, setArticleCategory] = useState('');

  // Modal do acordo financeiro
  const [showFinancialModal, setShowFinancialModal] = useState(false);
  const [selectedFinancialAgreementId, setSelectedFinancialAgreementId] = useState<string | null>(null);

  // Modal do post individual (estilo Facebook)
  const [showPostModal, setShowPostModal] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  // Entity selection state (para tags integradas)
  const [showEntityDropdown, setShowEntityDropdown] = useState(false);
  const [entitySearchTag, setEntitySearchTag] = useState<string | null>(null);
  const [entitySearchTerm, setEntitySearchTerm] = useState('');
  const [entityResults, setEntityResults] = useState<EntityReference[]>([]);
  const [selectedEntities, setSelectedEntities] = useState<EntityReference[]>([]);
  const [previewData, setPreviewData] = useState<PreviewData>({});

  // Tag records state (registros reais para inserir no post)
  const [tagRecords, setTagRecords] = useState<TagRecord[]>([]);
  const [loadingTagRecords, setLoadingTagRecords] = useState(false);
  const [selectedTagForRecords, setSelectedTagForRecords] = useState<string | null>(null);
  const [tagRecordSearch, setTagRecordSearch] = useState('');

  // Widget order state - Distribuição equilibrada entre sidebars
  const [leftWidgets, setLeftWidgets] = useState<string[]>([
    'metricas',
    'topicos',
    'destaque',
  ]);
  const [rightWidgets, setRightWidgets] = useState<string[]>([
    'sugestoes',
    'eventos',
    'atividade',
    'conexoes',
  ]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [isXlScreen, setIsXlScreen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 1280px)').matches;
  });
  const [imageGalleryModal, setImageGalleryModal] = useState<{
    open: boolean;
    images: Array<{ url: string; fileName: string }>;
    currentIndex: number;
  }>({ open: false, images: [], currentIndex: 0 });

  const [pollVotersModal, setPollVotersModal] = useState<{
    open: boolean;
    pollId: string | null;
    voters: FeedPollVoter[];
    loading: boolean;
  }>({ open: false, pollId: null, voters: [], loading: false });

  // Modal de interação (curtidas/comentários)
  const [interactionModal, setInteractionModal] = useState<{
    open: boolean;
    type: 'likes' | 'comments';
    postId: string | null;
    users: Array<{ user_id: string; name: string; avatar_url?: string; content?: string; created_at?: string }>;
    loading: boolean;
    newComment: string;
    submitting: boolean;
  }>({ open: false, type: 'likes', postId: null, users: [], loading: false, newComment: '', submitting: false });

  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [feedTagFilter, setFeedTagFilter] = useState<string | null>(null);
  const [feedSortOrder, setFeedSortOrder] = useState<'relevant' | 'recent'>('relevant');
  const [postReactions, setPostReactions] = useState<Record<string, { type: string; count: number }>>({});
  const [savedPosts, setSavedPosts] = useState<Set<string>>(new Set());

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  const withTimeout = useCallback(<T,>(promise: Promise<T>, label: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} excedeu ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }, []);

  const safeFetch = useCallback(
    <T,>(factory: () => Promise<T>, fallback: T, label: string): Promise<T> => {
      return withTimeout(factory(), label).catch((error: unknown) => {
        console.warn(`Dashboard: ${label} indisponível`, error);
        return fallback;
      });
    },
    [withTimeout]
  );

  const loadDashboardData = useCallback(
    async (forceRefresh = false) => {
      try {
        // Só mostra loading se não tiver cache instantâneo
        if (!hasInstantCache) {
          setLoading(true);
        }

        // Carregar perfil do usuário em background
        if (user?.id && !currentProfile) {
          profileService.getProfile(user.id).then(setCurrentProfile).catch(() => {});
        }

        // Se já carregou do cache instantâneo e não é forceRefresh, 
        // verifica se precisa atualizar em background
        if (!forceRefresh && hasInstantCache) {
          const cachedData = localStorage.getItem(DASHBOARD_CACHE_KEY);
          if (cachedData) {
            try {
              const cache: DashboardCache = JSON.parse(cachedData);
              const now = Date.now();
              // Se cache ainda é válido (< 30min), não precisa recarregar
              if (cache?.timestamp && now - cache.timestamp < CACHE_DURATION) {
                setLoading(false);
                return;
              }
            } catch {}
          }
        }

        // Atualizar dados em background (sem mostrar loading se já tem cache)
        console.log('📊 Dashboard: atualizando em background');

        const [clientsData, processesData, deadlinesData, tasksData, calendarEventsData, djenIntimacoesData, financialStatsData, requirementsAwaitingData] =
          await Promise.all([
            safeFetch(
              () => clientService.listClients().then((c) => c.filter((x) => x.status === 'ativo')),
              [],
              'Clientes'
            ),
            safeFetch(
              () => processService.listProcesses().then((p) => p.filter((x) => x.status !== 'arquivado').slice(0, 100)),
              [],
              'Processos'
            ),
            safeFetch(
              () => deadlineService.listDeadlines().then((d) => d.filter((x) => x.status === 'pendente').slice(0, 50)),
              [],
              'Prazos'
            ),
            safeFetch(
              () => taskService.listTasks().then((t) => t.filter((x) => x.status === 'pending').slice(0, 50)),
              [],
              'Tarefas'
            ),
            safeFetch(
              () =>
                calendarService.listEvents().then((e) => {
                  const now = new Date();
                  now.setHours(0, 0, 0, 0);
                  const futureDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
                  return e
                    .filter((ev) => {
                      if (!ev.start_at) return false;
                      const eventDate = new Date(ev.start_at);
                      return eventDate >= now && eventDate <= futureDate;
                    })
                    .slice(0, 100);
                }),
              [],
              'Agenda'
            ),
            safeFetch(() => djenLocalService.listComunicacoes({ lida: false }), [], 'Intimações DJEN'),
            safeFetch(() => financialService.getFinancialStats(new Date().toISOString().slice(0, 7)), null, 'Financeiro'),
            safeFetch(() => requirementService.listRequirements({ status: 'aguardando_confeccao' }), [], 'Requerimentos'),
          ]);

        setClients(clientsData);
        setProcesses(processesData);
        setDeadlines(deadlinesData);
        setTasks(tasksData);
        setCalendarEvents(calendarEventsData);
        setDjenIntimacoes(djenIntimacoesData);
        setFinancialStats(financialStatsData);
        setRequirementsAwaiting(requirementsAwaitingData);

        // Salvar no cache (com tratamento de erro de quota)
        try {
          const cacheData: DashboardCache = {
            version: DASHBOARD_CACHE_VERSION,
            timestamp: Date.now(),
            data: {
              clients: clientsData,
              processes: processesData,
              deadlines: deadlinesData,
              tasks: tasksData,
              calendarEvents: calendarEventsData,
              djenIntimacoes: djenIntimacoesData,
              financialStats: financialStatsData,
              requirementsAwaiting: requirementsAwaitingData,
            },
          };
          localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cacheData));
        } catch (quotaError: any) {
          if (quotaError?.name === 'QuotaExceededError') {
            console.warn('LocalStorage quota exceeded, limpando cache antigo...');
            // Limpar cache antigo para liberar espaço
            localStorage.removeItem(DASHBOARD_CACHE_KEY);
            // Tentar salvar novamente sem dados pesados
            try {
              const minimalCache = {
                version: DASHBOARD_CACHE_VERSION,
                timestamp: Date.now(),
                data: {
                  clients: clientsData.slice(0, 10),
                  processes: processesData.slice(0, 10),
                  deadlines: deadlinesData.slice(0, 10),
                  tasks: tasksData.slice(0, 10),
                  calendarEvents: calendarEventsData.slice(0, 10),
                  djenIntimacoes: djenIntimacoesData.slice(0, 5),
                  financialStats: financialStatsData,
                  requirementsAwaiting: requirementsAwaitingData.slice(0, 10),
                },
              };
              localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(minimalCache));
            } catch (retryError) {
              console.warn('Não foi possível salvar cache mesmo após limpar:', retryError);
            }
          } else {
            throw quotaError;
          }
        }
      } catch (error) {
        console.error('Erro ao carregar dados do dashboard:', error);
      } finally {
        setLoading(false);
      }
    },
    [safeFetch, user?.id, currentProfile, hasInstantCache]
  );

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1280px)');
    const handler = (event: MediaQueryListEvent) => setIsXlScreen(event.matches);
    setIsXlScreen(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, () => {
      console.log('🔄 Dashboard: Mudança detectada, recarregando...');
      loadDashboardData(true);
    });

    return () => unsubscribe();
  }, [loadDashboardData]);

  // Carregar todos os perfis para menções
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const profiles = await profileService.listMembers();
        setAllProfiles(profiles);
      } catch (error) {
        console.warn('Erro ao carregar perfis:', error);
      }
    };
    loadProfiles();
  }, []);

  // Carregar preferências do dashboard do banco de dados
  useEffect(() => {
    const loadPreferences = async () => {
      if (!user?.id) return;

      try {
        const preferences = await dashboardPreferencesService.getPreferences(user.id);
        if (preferences) {
          const isAdmin = (currentProfile?.role || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') === 'administrador';

          const loadedLeft = Array.isArray(preferences.left_widgets)
            ? preferences.left_widgets.filter(w => ['sugestoes', 'eventos', 'atividade', 'conexoes', 'metricas', 'topicos', 'destaque'].includes(w))
            : ['metricas', 'topicos', 'destaque'];
          const loadedRight = Array.isArray(preferences.right_widgets)
            ? preferences.right_widgets.filter(w => ['sugestoes', 'eventos', 'atividade', 'conexoes', 'metricas', 'topicos', 'destaque'].includes(w))
            : ['sugestoes', 'eventos', 'atividade', 'conexoes'];

          // Garantir que widgets essenciais estejam presentes
          const leftEssential = ['metricas', 'topicos', 'destaque'];
          const rightEssential = ['sugestoes', 'eventos', 'atividade', 'conexoes'];
          
          leftEssential.forEach(widget => {
            if (!loadedLeft.includes(widget)) {
              loadedLeft.push(widget);
            }
          });
          
          rightEssential.forEach(widget => {
            if (!loadedRight.includes(widget)) {
              loadedRight.push(widget);
            }
          });

          if (isAdmin) {
            const all = new Set<string>([...loadedLeft, ...loadedRight]);
            if (!all.has('prazos')) loadedRight.push('prazos');
          }

          setLeftWidgets(loadedLeft);
          setRightWidgets(loadedRight);
        } else {
          // Fallback se não houver preferências salvas - sem duplicação
          setLeftWidgets(['metricas', 'topicos', 'destaque']);
          setRightWidgets(['sugestoes', 'eventos', 'atividade', 'conexoes']);
        }
        setPreferencesLoaded(true);
      } catch (error) {
        console.warn('Erro ao carregar preferências do dashboard:', error);
        // Fallback em caso de erro - sem duplicação
        setLeftWidgets(['metricas', 'topicos', 'destaque']);
        setRightWidgets(['sugestoes', 'eventos', 'atividade', 'conexoes']);
        setPreferencesLoaded(true);
      }
    };
    loadPreferences();
  }, [user?.id, currentProfile?.role]);

  const canSeeWidget = useCallback(
    (widgetId: string) => {
      // Todos os widgets sociais são permitidos no feed (exceto tendências duplicado)
      const socialWidgets = [
        'sugestoes', 
        'eventos',
        'atividade',
        'conexoes', 
        'metricas',
        'topicos',
        'destaque'
      ];
      return socialWidgets.includes(widgetId);
    },
    []
  );

  const visibleLeftWidgets = useMemo(() => leftWidgets.filter(canSeeWidget), [leftWidgets, canSeeWidget]);
  const visibleRightWidgets = useMemo(() => rightWidgets.filter(canSeeWidget), [rightWidgets, canSeeWidget]);

  const suggestedPeople = useMemo(() => {
    const self = user?.id;
    return (allProfiles || [])
      .filter((p) => p.user_id !== self)
      .slice(0, 6);
  }, [allProfiles, user?.id]);

  const trendingTags = useMemo(() => {
    const counts = new Map<string, number>();
    feedPosts.forEach((post) => {
      (post.tags || []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    return sorted.map(([tagId, count]) => {
      const tagConfig = availableTags.find((t) => t.id === tagId);
      return {
        id: tagId,
        label: tagConfig?.label || tagId,
        color: tagConfig?.color || 'bg-slate-100 text-slate-700',
        count,
      };
    });
  }, [feedPosts, availableTags]);

  const displayedFeedPosts = useMemo(() => {
    if (!feedTagFilter) return feedPosts;
    return feedPosts.filter((p) => (p.tags || []).includes(feedTagFilter));
  }, [feedPosts, feedTagFilter]);

  const handleReaction = useCallback((postId: string, type: 'like' | 'love' | 'haha') => {
    setPostReactions(prev => {
      const current = prev[postId] || { type: '', count: 0 };
      if (current.type === type) {
        const { [postId]: removed, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [postId]: { type, count: (current.type ? current.count : 0) + 1 }
      };
    });
  }, []);

  const toggleSavePost = useCallback((postId: string) => {
    setSavedPosts(prev => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }, []);

  const sharePost = useCallback((postId: string) => {
    toast.info('Compartilhar', 'Link copiado para a área de transferência.');
  }, [toast]);

  // Placeholder dinâmico baseado no contexto
  const getDynamicPlaceholder = useCallback(() => {
    const placeholders = [
      "Compartilhe uma atualização importante...",
      "O que está acontecendo no escritório?",
      "Alguma novidade sobre algum processo?",
      "Use @ para mencionar colegas e # para categorizar",
      "Compartilhe uma vitória ou desafio recente...",
      "Atualize a equipe sobre um projeto em andamento...",
      "Dê uma dica útil para os colegas...",
      "Celebre uma conquista da equipe!"
    ];
    
    // Se há menções ou tags sendo digitadas, dar contexto específico
    if (postText.includes('@') && postText.lastIndexOf('@') > postText.lastIndexOf(' ')) {
      return "Digite o nome da pessoa para mencionar...";
    }
    if (postText.includes('#') && postText.lastIndexOf('#') > postText.lastIndexOf(' ')) {
      return "Selecione uma categoria ou digite para buscar...";
    }
    
    // Placeholder aleatório para engajamento
    return placeholders[Math.floor(Math.random() * placeholders.length)];
  }, [postText]);

  // Preview de anexos
  const getAttachmentPreview = useCallback((attachment: FeedAttachment) => {
    if (attachment.file_type.startsWith('image/')) {
      return (
        <div className="relative group">
          <img 
            src={attachment.file_url} 
            alt={attachment.file_name}
            className="w-16 h-16 object-cover rounded-lg border border-slate-200"
          />
          <button
            onClick={() => removeAttachment(attachment.id)}
            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      );
    }
    
    return (
      <div className="relative group flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 border border-slate-200">
        <Paperclip className="w-4 h-4 text-slate-500" />
        <span className="text-xs text-slate-700 truncate max-w-[120px]">{attachment.file_name}</span>
        <button
          onClick={() => removeAttachment(attachment.id)}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <X className="w-2 h-2" />
        </button>
      </div>
    );
  }, []);

  // Removido o useEffect que estava filtrando widgets indevidamente

  // Handler único para drag-and-drop entre sidebars (salva no banco de dados)
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !user?.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Verificar se está movendo para mesma sidebar
    const inLeft = leftWidgets.includes(activeId);
    const inRight = rightWidgets.includes(activeId);
    const overInLeft = leftWidgets.includes(overId);
    const overInRight = rightWidgets.includes(overId);

    // Mover dentro da mesma sidebar
    if ((inLeft && overInLeft) || (inRight && overInRight)) {
      const sourceWidgets = inLeft ? leftWidgets : rightWidgets;
      const oldIndex = sourceWidgets.indexOf(activeId);
      const newIndex = sourceWidgets.indexOf(overId);

      if (oldIndex !== newIndex) {
        const newOrder = arrayMove(sourceWidgets, oldIndex, newIndex);
        if (inLeft) {
          setLeftWidgets(newOrder);
        } else {
          setRightWidgets(newOrder);
        }
        // Salvar no banco de dados
        dashboardPreferencesService.savePreferences(user.id, inLeft ? newOrder : leftWidgets, inRight ? newOrder : rightWidgets);
      }
    }
    // Mover entre sidebars
    else if (inLeft && overInRight) {
      const newLeft = leftWidgets.filter(id => id !== activeId);
      const newRight = [...rightWidgets, activeId];
      setLeftWidgets(newLeft);
      setRightWidgets(newRight);
      // Salvar no banco de dados
      dashboardPreferencesService.savePreferences(user.id, newLeft, newRight);
    }
    else if (inRight && overInLeft) {
      const newRight = rightWidgets.filter(id => id !== activeId);
      const newLeft = [...leftWidgets, activeId];
      setRightWidgets(newRight);
      setLeftWidgets(newLeft);
      // Salvar no banco de dados
      dashboardPreferencesService.savePreferences(user.id, newLeft, newRight);
    }
  };

  // Handler para input do post com menções
  const handlePostTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setPostText(value);

    // Detectar @ para menções
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      if (spaceIndex === -1 && textAfterAt.length > 0) {
        setMentionSearch(textAfterAt.toLowerCase());
        setShowMentionDropdown(true);
      } else {
        setShowMentionDropdown(false);
      }
    } else {
      setShowMentionDropdown(false);
    }

    // Detectar # para tags
    const lastHashIndex = value.lastIndexOf('#');
    if (lastHashIndex !== -1) {
      const textAfterHash = value.slice(lastHashIndex + 1);
      const spaceIndex = textAfterHash.indexOf(' ');
      if (spaceIndex === -1 && textAfterHash.length >= 0) {
        setShowTagDropdown(true);
      } else {
        setShowTagDropdown(false);
      }
    } else {
      setShowTagDropdown(false);
    }
  };

  // Inserir menção no texto
  const insertMention = (profile: Profile) => {
    const lastAtIndex = postText.lastIndexOf('@');
    if (lastAtIndex === -1) return;
    
    // Encontrar o fim da query de menção (próximo espaço ou fim do texto)
    const textAfterAt = postText.slice(lastAtIndex + 1);
    const spaceIndex = textAfterAt.search(/\s/);
    const queryEnd = spaceIndex === -1 ? postText.length : lastAtIndex + 1 + spaceIndex;
    
    // Preservar texto antes do @, inserir menção, e preservar texto após a query
    const beforeAt = postText.slice(0, lastAtIndex);
    const afterQuery = postText.slice(queryEnd);
    const newText = beforeAt + `@${profile.name} ` + afterQuery.trimStart();
    
    setPostText(newText);
    setShowMentionDropdown(false);
    postInputRef.current?.focus();
  };

  // Inserir tag no texto
  const insertTag = (tagId: string) => {
    const lastHashIndex = postText.lastIndexOf('#');
    if (lastHashIndex === -1) return;
    
    // Encontrar o fim da query de tag (próximo espaço ou fim do texto)
    const textAfterHash = postText.slice(lastHashIndex + 1);
    const spaceIndex = textAfterHash.search(/\s/);
    const queryEnd = spaceIndex === -1 ? postText.length : lastHashIndex + 1 + spaceIndex;
    
    // Preservar texto antes do #, inserir tag, e preservar texto após a query
    const beforeHash = postText.slice(0, lastHashIndex);
    const afterQuery = postText.slice(queryEnd);
    const newText = beforeHash + `#${tagId} ` + afterQuery.trimStart();
    
    setPostText(newText);
    if (!selectedTags.includes(tagId)) {
      setSelectedTags([...selectedTags, tagId]);
    }
    setShowTagDropdown(false);
    postInputRef.current?.focus();
  };

  // Toggle tag
  const toggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter(t => t !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  // Carregar registros reais para uma tag
  const loadTagRecords = useCallback(async (tagId: string, search = '') => {
    setLoadingTagRecords(true);
    setSelectedTagForRecords(tagId);
    setTagRecordSearch(search);
    try {
      const records = await feedPostsService.getRecordsForTag(tagId, search, 10);
      setTagRecords(records);
    } catch (error) {
      console.error('Erro ao carregar registros da tag:', error);
      setTagRecords([]);
    } finally {
      setLoadingTagRecords(false);
    }
  }, []);

  // Selecionar um registro e inserir texto formatado no post
  const selectTagRecord = useCallback((record: TagRecord) => {
    // Inserir texto formatado no post
    setPostText(prev => {
      const newText = prev.trim() ? `${prev} ${record.formattedText}` : record.formattedText;
      return newText;
    });

    // Adicionar tag se não estiver selecionada
    if (selectedTagForRecords && !selectedTags.includes(selectedTagForRecords)) {
      setSelectedTags(prev => [...prev, selectedTagForRecords]);
    }

    // Adicionar referência da entidade para tornar clicável
    if (selectedTagForRecords === 'financeiro') {
      setSelectedEntities(prev => [
        ...prev.filter(e => !(e.type === 'financial' && e.id === record.id)),
        { type: 'financial', id: record.id, name: record.label }
      ]);
    }

    // Adicionar dados de preview
    setPreviewData(prev => ({ ...prev, ...record.previewData }));

    // Fechar dropdown
    setSelectedTagForRecords(null);
    setTagRecords([]);
    setShowTagDropdown(false);
    postInputRef.current?.focus();
  }, [selectedTagForRecords, selectedTags]);

  // Fechar dropdown de registros
  const closeTagRecordsDropdown = useCallback(() => {
    setSelectedTagForRecords(null);
    setTagRecords([]);
    setTagRecordSearch('');
  }, []);

  // Handler para busca em registros de tag
  const handleTagRecordSearch = useCallback((search: string) => {
    setTagRecordSearch(search);
    if (selectedTagForRecords) {
      loadTagRecords(selectedTagForRecords, search);
    }
  }, [selectedTagForRecords, loadTagRecords]);

  // Carregar posts do feed - atualiza em background se já tem cache
  const loadFeedPosts = useCallback(async () => {
    if (feedPostsInFlightRef.current) return;
    feedPostsInFlightRef.current = true;
    try {
      // Só mostra loading se não tem cache e ainda não há posts no estado
      if (!hasInstantPostsCache && feedPostsCountRef.current === 0) {
        setLoadingPosts(true);
      }

      // Timeout garante que nunca ficará preso em "Carregando publicações..."
      const posts = await withTimeout(feedPostsService.getPosts(20, 0), 'Publicações');
      setFeedPosts(posts);
      savePostsCache(posts);
      setLoadingPosts(false);

      // Enquetes carregam em background (não bloqueia UI)
      void (async () => {
        const pollResults = await Promise.allSettled(
          posts.map(async (post) => {
            try {
              const poll = await withTimeout(feedPollsService.getPollByPostId(post.id), 'Enquete');
              return poll ? { postId: post.id, poll } : null;
            } catch {
              return null;
            }
          })
        );

        const pollMap = new Map<string, FeedPoll>();
        pollResults.forEach((r) => {
          if (r.status === 'fulfilled' && r.value) {
            pollMap.set(r.value.postId, r.value.poll);
          }
        });
        setPostPolls(pollMap);
      })();
    } catch (error) {
      console.error('Erro ao carregar posts:', error);
      setLoadingPosts(false);
    } finally {
      setLoadingPosts(false);
      feedPostsInFlightRef.current = false;
    }
  }, [hasInstantPostsCache, withTimeout]);

  // Buscar entidades para autocomplete
  const searchEntities = useCallback(async (tag: string, search: string) => {
    if (!search || search.length < 2) {
      setEntityResults([]);
      return;
    }
    try {
      const results = await feedPostsService.searchEntitiesForTag(tag, search, 5);
      setEntityResults(results);
    } catch (error) {
      console.error('Erro ao buscar entidades:', error);
      setEntityResults([]);
    }
  }, []);

  // Selecionar entidade
  const selectEntity = useCallback(async (entity: EntityReference) => {
    // Adicionar à lista de entidades selecionadas
    setSelectedEntities(prev => {
      if (prev.some(e => e.id === entity.id && e.type === entity.type)) return prev;
      return [...prev, entity];
    });

    // Buscar dados de preview para a entidade
    const tagType = entity.type === 'client' ? 'cliente' :
                    entity.type === 'process' ? 'processo' :
                    entity.type === 'deadline' ? 'prazo' :
                    entity.type === 'calendar' ? 'agenda' :
                    entity.type === 'document' ? 'documento' : entity.type;

    try {
      const preview = await feedPostsService.getPreviewDataForTag(tagType, entity.id);
      setPreviewData(prev => ({ ...prev, ...preview }));
    } catch (error) {
      console.error('Erro ao buscar preview:', error);
    }

    // Inserir referência no texto
    const entityLabel = entity.name || entity.number || entity.id;
    setPostText(prev => prev + `[${tagType}:${entityLabel}] `);

    // Fechar dropdown
    setShowEntityDropdown(false);
    setEntitySearchTag(null);
    setEntitySearchTerm('');
    setEntityResults([]);
    postInputRef.current?.focus();
  }, []);

  // Remover entidade selecionada
  const removeEntity = useCallback((entityId: string) => {
    setSelectedEntities(prev => prev.filter(e => e.id !== entityId));
  }, []);

  // Calcular data de expiração da enquete
  const calculatePollExpiration = useCallback((expiresIn: string): string | null => {
    if (expiresIn === 'never') return null;
    const now = new Date();
    switch (expiresIn) {
      case '1h': now.setHours(now.getHours() + 1); break;
      case '6h': now.setHours(now.getHours() + 6); break;
      case '24h': now.setHours(now.getHours() + 24); break;
      case '3d': now.setDate(now.getDate() + 3); break;
      case '7d': now.setDate(now.getDate() + 7); break;
      default: return null;
    }
    return now.toISOString();
  }, []);

  // Publicar post
  const handlePublishPost = useCallback(async () => {
    // Permitir publicar se tem texto OU se tem enquete válida
    const hasPoll = showPollCreator && pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2;
    if ((!postText.trim() && !hasPoll) || postingInProgress) return;

    setPostingInProgress(true);
    try {
      // Extrair menções do texto - buscar nomes exatos de perfis
      const mentionedIds: string[] = [];
      for (const profile of allProfiles) {
        if (!profile.name) continue;
        const mentionPattern = `@${profile.name}`;
        const foundIndex = postText.indexOf(mentionPattern);
        if (foundIndex !== -1) {
          // Verificar se após o nome há um caractere que não seja letra
          const afterMention = postText[foundIndex + mentionPattern.length];
          const isValidEnd = !afterMention || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(afterMention);
          if (isValidEnd && !mentionedIds.includes(profile.user_id)) {
            mentionedIds.push(profile.user_id);
          }
        }
      }

      const allowedUserIds = Array.from(new Set([...(audienceUserIds || []), ...(mentionedIds || [])]));
      const allowedRoles = [...(audienceRoles || [])];

      if (postVisibility !== 'public' && allowedUserIds.length === 0 && allowedRoles.length === 0) {
        alert('Selecione pelo menos uma pessoa ou departamento para publicar como Privado/Equipe.');
        return;
      }

      // Buscar dados de preview para tags selecionadas (sem entidade específica)
      let finalPreviewData = { ...previewData };
      for (const tag of selectedTags) {
        if (!selectedEntities.some(e => {
          const tagType = e.type === 'client' ? 'cliente' :
                          e.type === 'process' ? 'processo' :
                          e.type === 'deadline' ? 'prazo' :
                          e.type === 'calendar' ? 'agenda' :
                          e.type === 'document' ? 'documento' : e.type;
          return tagType === tag;
        })) {
          // Tag sem entidade específica - buscar dados gerais
          const tagPreview = await feedPostsService.getPreviewDataForTag(tag);
          finalPreviewData = { ...finalPreviewData, ...tagPreview };
        }
      }

      // Conteúdo do post (se não tiver texto mas tiver enquete, usar a pergunta)
      const postContent = postText.trim() || (hasPoll ? `📊 ${pollQuestion}` : '');

      // Montar data de agendamento se definida
      const scheduledAt = showScheduler && scheduledDate && scheduledTime
        ? `${scheduledDate}T${scheduledTime}:00`
        : null;

      const newPost = await feedPostsService.createPost({
        content: postContent,
        tags: selectedTags,
        mentions: mentionedIds,
        entity_references: selectedEntities,
        preview_data: finalPreviewData,
        attachments: pendingAttachments.map((p) => p.attachment),
        visibility: postVisibility,
        scheduled_at: scheduledAt,
        allowed_user_ids: postVisibility === 'public' ? [] : allowedUserIds,
        allowed_roles: postVisibility === 'public' ? [] : allowedRoles
      });

      // Criar enquete se ativa
      if (hasPoll) {
        const validOptions = pollOptions.filter(o => o.trim());
        const expiresAt = calculatePollExpiration(pollExpiresIn);
        const poll = await feedPollsService.createPoll({
          post_id: newPost.id,
          question: pollQuestion,
          options: validOptions,
          expires_at: expiresAt,
          allow_multiple: pollAllowMultiple,
          participants: pollParticipants.filter(p => p),
        });
        // Salvar enquete no mapa local
        setPostPolls(prev => new Map(prev).set(newPost.id, poll));

        setShowPollCreator(false);
        setPollQuestion('');
        setPollOptions(['', '']);
        setPollAllowMultiple(true);
        setPollExpiresIn('24h');
        setPollParticipants([]);
      }

      // Adicionar post ao início da lista e atualizar cache
      setFeedPosts(prev => {
        const updated = [newPost, ...prev];
        savePostsCache(updated);
        return updated;
      });

      // Limpar formulário
      setPostText('');
      setSelectedTags([]);
      setSelectedEntities([]);
      setPreviewData({});
      setPostVisibility('public');
      setShowScheduler(false);
      setScheduledDate('');
      setScheduledTime('');
      setAudienceUserIds([]);
      setAudienceRoles([]);
      setAudienceSearch('');
      pendingAttachments.forEach((p) => {
        try {
          URL.revokeObjectURL(p.localUrl);
        } catch {}
      });
      setPendingAttachments([]);

      if (hasPoll) {
        toast.success('Enquete criada', 'Sua enquete foi publicada com sucesso.');
      } else {
        toast.success('Publicado', 'Sua publicação foi criada com sucesso.');
      }
    } catch (error) {
      console.error('Erro ao publicar post:', error);
      toast.error('Erro ao publicar', 'Não foi possível publicar. Tente novamente.');
    } finally {
      setPostingInProgress(false);
    }
  }, [postText, selectedTags, selectedEntities, previewData, allProfiles, postingInProgress, pendingAttachments, showPollCreator, pollQuestion, pollOptions, pollAllowMultiple, pollExpiresIn, pollParticipants, calculatePollExpiration, postVisibility, showScheduler, scheduledDate, scheduledTime, audienceUserIds, audienceRoles]);

  // Votar em enquete
  const handlePollVote = useCallback(async (pollId: string, optionIndex: number) => {
    try {
      await feedPollsService.vote(pollId, optionIndex);
      // Atualizar enquete local
      const updatedPoll = await feedPollsService.getPollByPostId(
        Array.from(postPolls.entries()).find(([_, p]) => p.id === pollId)?.[0] || ''
      );
      if (updatedPoll) {
        setPostPolls(prev => {
          const newMap = new Map(prev);
          const postId = Array.from(prev.entries()).find(([_, p]) => p.id === pollId)?.[0];
          if (postId) newMap.set(postId, updatedPoll);
          return newMap;
        });
      }
    } catch (error) {
      console.error('Erro ao votar:', error);
    }
  }, [postPolls]);

  // Carregar enquetes dos posts
  const loadPollsForPosts = useCallback(async (posts: FeedPost[]) => {
    const pollMap = new Map<string, FeedPoll>();
    for (const post of posts) {
      try {
        const poll = await feedPollsService.getPollByPostId(post.id);
        if (poll) pollMap.set(post.id, poll);
      } catch {
        // ignore
      }
    }
    setPostPolls(pollMap);
  }, []);

  // Toggle like com optimistic update
  const handleToggleLike = useCallback(async (postId: string, currentlyLiked: boolean) => {
    // Optimistic update - atualiza UI imediatamente
    setFeedPosts(prev => prev.map(p =>
      p.id === postId
        ? { ...p, liked_by_me: !currentlyLiked, likes_count: currentlyLiked ? p.likes_count - 1 : p.likes_count + 1 }
        : p
    ));

    try {
      if (currentlyLiked) {
        await feedPostsService.unlikePost(postId);
      } else {
        await feedPostsService.likePost(postId);

        // Notificar o autor do post (se não for o próprio usuário)
        const post = feedPosts.find(p => p.id === postId);
        if (post && post.author_id !== user?.id && currentProfile?.name) {
          userNotificationService.createNotification({
            user_id: post.author_id,
            type: 'feed_like',
            title: `${currentProfile.name} curtiu sua publicação`,
            message: post.content.length > 100 
              ? post.content.substring(0, 100) + '...' 
              : post.content,
            metadata: {
              post_id: postId,
              author_id: user?.id,
              author_name: currentProfile.name
            }
          }).catch(() => {});
        }
      }
    } catch (error) {
      // Reverter optimistic update em caso de erro
      setFeedPosts(prev => prev.map(p =>
        p.id === postId
          ? { ...p, liked_by_me: currentlyLiked, likes_count: currentlyLiked ? p.likes_count + 1 : p.likes_count - 1 }
          : p
      ));
      console.error('Erro ao dar/remover like:', error);
    }
  }, [feedPosts, user?.id, currentProfile?.name]);

  // Salvar edição de post
  const handleSaveEdit = useCallback(async (postId: string) => {
    if (!editingContent.trim()) return;

    // Validar destinatários para posts privados/equipe
    if (editingVisibility !== 'public' && editingAudienceUserIds.length === 0 && editingAudienceRoles.length === 0) {
      toast.error('Erro', 'Selecione pelo menos um destinatário para posts privados/equipe.');
      return;
    }

    try {
      const updatedPost = await feedPostsService.updatePost(postId, { 
        content: editingContent.trim(),
        visibility: editingVisibility,
        allowed_user_ids: editingVisibility !== 'public' ? editingAudienceUserIds : [],
        allowed_roles: editingVisibility !== 'public' ? editingAudienceRoles : [],
      });
      setFeedPosts(prev => prev.map(p => p.id === postId ? updatedPost : p));
      setEditingPostId(null);
      setEditingContent('');
      setEditingVisibility('public');
      setEditingAudienceUserIds([]);
      setEditingAudienceRoles([]);
      setEditingAudienceSearch('');
    } catch (error) {
      console.error('Erro ao salvar edição:', error);
    }
  }, [editingContent, editingVisibility, editingAudienceUserIds, editingAudienceRoles]);

  // Cancelar edição
  const handleCancelEdit = useCallback(() => {
    setEditingPostId(null);
    setEditingContent('');
    setEditingVisibility('public');
    setEditingAudienceUserIds([]);
    setEditingAudienceRoles([]);
    setEditingAudienceSearch('');
    setShowMentionDropdownInline(false);
    setShowTagDropdownInline(false);
    setInlineMentionQuery('');
    setInlineTagQuery('');
  }, []);

  // Excluir post
  const handleDeletePost = useCallback(async (postId: string) => {
    const confirmed = await confirmDelete({
      title: 'Excluir publicação',
      message: 'Tem certeza que deseja excluir esta publicação? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
    });
    if (!confirmed) return;
    try {
      await feedPostsService.deletePost(postId);
      setFeedPosts(prev => prev.filter(p => p.id !== postId));
      setOpenPostMenu(null);
    } catch (error) {
      console.error('Erro ao excluir post:', error);
    }
  }, [confirmDelete]);

  // Handler para abrir modal do acordo financeiro
  const handleOpenFinancialModal = useCallback((agreementId: string) => {
    setSelectedFinancialAgreementId(agreementId);
    setShowFinancialModal(true);
  }, []);

  // Handler para fechar modal do acordo financeiro
  const handleCloseFinancialModal = useCallback(() => {
    setShowFinancialModal(false);
    setSelectedFinancialAgreementId(null);
  }, []);

  // Abrir galeria de imagens
  const openImageGallery = useCallback((attachments: any[], startIndex: number = 0) => {
    const images = attachments
      .filter((a: any) => a.kind === 'image' && a.signedUrl && a.signedUrl.trim() !== '')
      .map((a: any) => ({ url: a.signedUrl, fileName: a.fileName }));
    if (images.length > 0) {
      setImageGalleryModal({ open: true, images, currentIndex: startIndex });
    }
  }, []);

  // Fechar galeria de imagens
  const closeImageGallery = useCallback(() => {
    setImageGalleryModal({ open: false, images: [], currentIndex: 0 });
  }, []);

  // Navegar para imagem anterior
  const prevImage = useCallback(() => {
    setImageGalleryModal(prev => ({
      ...prev,
      currentIndex: prev.currentIndex > 0 ? prev.currentIndex - 1 : prev.images.length - 1,
    }));
  }, []);

  // Navegar para próxima imagem
  const nextImage = useCallback(() => {
    setImageGalleryModal(prev => ({
      ...prev,
      currentIndex: (prev.currentIndex + 1) % prev.images.length,
    }));
  }, []);

  // Buscar quem curtiu
  const fetchLikes = useCallback(async (postId: string) => {
    setInteractionModal(prev => ({ ...prev, loading: true, users: [] }));
    try {
      const { data: likes, error } = await supabase
        .from('feed_post_likes')
        .select('user_id')
        .eq('post_id', postId);

      if (error) throw error;

      if (!likes || likes.length === 0) {
        setInteractionModal(prev => ({ ...prev, loading: false }));
        return;
      }

      const userIds = (likes as any[]).map(l => l.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name, avatar_url')
        .in('user_id', userIds);

      setInteractionModal(prev => ({
        ...prev,
        users: (profiles as any[]) || [],
        loading: false,
      }));
    } catch (error) {
      console.error('Erro ao buscar curtidas:', error);
      setInteractionModal(prev => ({ ...prev, loading: false }));
    }
  }, []);

  // Buscar quem comentou
  const fetchComments = useCallback(async (postId: string) => {
    setInteractionModal(prev => ({ ...prev, loading: true, users: [] }));
    try {
      const comments = await feedPostsService.getComments(postId);
      const users = comments.map(c => ({
        user_id: c.author_id,
        name: c.author?.name || 'Usuário',
        avatar_url: c.author?.avatar_url || undefined,
        content: c.content,
        created_at: c.created_at,
      }));
      setInteractionModal(prev => ({ ...prev, users, loading: false }));
    } catch (error) {
      console.error('Erro ao buscar comentários:', error);
      setInteractionModal(prev => ({ ...prev, loading: false }));
    }
  }, []);

  // Criar novo comentário
  const handleCreateComment = useCallback(async () => {
    if (!interactionModal.postId || !interactionModal.newComment.trim()) return;
    setInteractionModal(prev => ({ ...prev, submitting: true }));
    try {
      const newComment = await feedPostsService.createComment(interactionModal.postId, interactionModal.newComment.trim());
      const commentUser = {
        user_id: newComment.author_id,
        name: newComment.author?.name || 'Você',
        avatar_url: newComment.author?.avatar_url || undefined,
        content: newComment.content,
        created_at: newComment.created_at,
      };
      setInteractionModal(prev => ({
        ...prev,
        users: [...prev.users, commentUser],
        newComment: '',
        submitting: false,
      }));
      // Atualizar contador de comentários no post
      setFeedPosts(prev => prev.map(p =>
        p.id === interactionModal.postId
          ? { ...p, comments_count: (p.comments_count || 0) + 1 }
          : p
      ));
    } catch (error) {
      console.error('Erro ao criar comentário:', error);
      setInteractionModal(prev => ({ ...prev, submitting: false }));
    }
  }, [interactionModal.postId, interactionModal.newComment]);

  // Abrir modal de curtidas ou comentários
  const openInteractionModal = useCallback((type: 'likes' | 'comments', postId: string) => {
    setInteractionModal({ open: true, type, postId, users: [], loading: true, newComment: '', submitting: false });
    if (type === 'likes') {
      fetchLikes(postId);
    } else {
      fetchComments(postId);
    }
  }, [fetchLikes, fetchComments]);

  // Fechar modal de interação
  const closeInteractionModal = useCallback(() => {
    setInteractionModal({ open: false, type: 'likes', postId: null, users: [], loading: false, newComment: '', submitting: false });
  }, []);

  // Handler para mudança no input de comentário inline (detectar @)
  const handleCommentInputChange = useCallback((postId: string, value: string) => {
    const lastAtIndex = value.lastIndexOf('@');
    const afterAt = lastAtIndex >= 0 ? value.slice(lastAtIndex + 1) : '';
    
    // Detectar se está digitando uma menção
    const isMentioning = lastAtIndex >= 0 && (afterAt === '' || !afterAt.includes(' '));
    
    setExpandedComments(prev => ({
      ...prev,
      [postId]: {
        ...prev[postId],
        newComment: value,
        showMentionDropdown: isMentioning,
        mentionSearch: afterAt
      }
    }));
  }, []);

  // Handler para selecionar perfil mencionado no comentário
  const handleSelectCommentMention = useCallback((postId: string, profile: Profile) => {
    const state = expandedComments[postId];
    if (!state) return;

    const lastAtIndex = state.newComment.lastIndexOf('@');
    const newText = state.newComment.slice(0, lastAtIndex) + `@${profile.name} `;

    setExpandedComments(prev => ({
      ...prev,
      [postId]: {
        ...prev[postId],
        newComment: newText,
        showMentionDropdown: false,
        mentionSearch: ''
      }
    }));
  }, [expandedComments]);

  // Expandir/colapsar comentários inline
  const toggleInlineComments = useCallback(async (postId: string) => {
    if (expandedComments[postId]) {
      // Colapsar
      setExpandedComments(prev => {
        const newState = { ...prev };
        delete newState[postId];
        return newState;
      });
    } else {
      // Expandir e carregar comentários
      setExpandedComments(prev => ({
        ...prev,
        [postId]: { comments: [], loading: true, newComment: '', submitting: false, showMentionDropdown: false, mentionSearch: '' }
      }));
      try {
        const comments = await feedPostsService.getComments(postId);
        const mappedComments = comments.map(c => ({
          user_id: c.author_id,
          name: c.author?.name || 'Usuário',
          avatar_url: c.author?.avatar_url || undefined,
          content: c.content,
          created_at: c.created_at,
        }));
        setExpandedComments(prev => ({
          ...prev,
          [postId]: { ...prev[postId], comments: mappedComments, loading: false, showMentionDropdown: false, mentionSearch: '' }
        }));
      } catch (error) {
        console.error('Erro ao carregar comentários:', error);
        setExpandedComments(prev => ({
          ...prev,
          [postId]: { ...prev[postId], loading: false, showMentionDropdown: false, mentionSearch: '' }
        }));
      }
    }
  }, [expandedComments]);

  // Criar comentário inline
  const handleCreateInlineComment = useCallback(async (postId: string) => {
    const state = expandedComments[postId];
    if (!state || !state.newComment.trim()) return;

    setExpandedComments(prev => ({
      ...prev,
      [postId]: { ...prev[postId], submitting: true }
    }));

    try {
      const newComment = await feedPostsService.createComment(postId, state.newComment.trim());
      const commentData = {
        user_id: newComment.author_id,
        name: newComment.author?.name || 'Você',
        avatar_url: newComment.author?.avatar_url || undefined,
        content: newComment.content,
        created_at: newComment.created_at,
      };
      setExpandedComments(prev => ({
        ...prev,
        [postId]: {
          ...prev[postId],
          comments: [...prev[postId].comments, commentData],
          newComment: '',
          submitting: false,
          showMentionDropdown: false,
          mentionSearch: ''
        }
      }));
      // Atualizar contador
      setFeedPosts(prev => prev.map(p =>
        p.id === postId
          ? { ...p, comments_count: (p.comments_count || 0) + 1 }
          : p
      ));

      // Notificar o autor do post (se não for o próprio usuário)
      const post = feedPosts.find(p => p.id === postId);
      if (post && post.author_id !== user?.id && currentProfile?.name) {
        try {
          await userNotificationService.createNotification({
            user_id: post.author_id,
            type: 'feed_comment',
            title: `${currentProfile.name} comentou sua publicação`,
            message: state.newComment.trim().substring(0, 100) + (state.newComment.trim().length > 100 ? '...' : ''),
            metadata: { post_id: postId }
          });
        } catch (notifError) {
          console.error('Erro ao criar notificação de comentário:', notifError);
        }
      }

      // Notificar usuários mencionados com @ no comentário
      const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
      const mentions = state.newComment.match(mentionRegex);
      if (mentions && currentProfile?.name) {
        const mentionedNames = mentions.map(m => m.slice(1).trim().toLowerCase());
        const mentionedProfiles = allProfiles.filter(p => 
          mentionedNames.some(name => p.name.toLowerCase().startsWith(name)) && p.id !== user?.id
        );
        for (const mentionedProfile of mentionedProfiles) {
          try {
            await userNotificationService.createNotification({
              user_id: mentionedProfile.id,
              type: 'mention',
              title: `${currentProfile.name} mencionou você em um comentário`,
              message: state.newComment.trim().substring(0, 100) + (state.newComment.trim().length > 100 ? '...' : ''),
              metadata: { post_id: postId }
            });
          } catch (notifError) {
            console.error('Erro ao criar notificação de menção:', notifError);
          }
        }
      }
    } catch (error) {
      console.error('Erro ao criar comentário:', error);
      setExpandedComments(prev => ({
        ...prev,
        [postId]: { ...prev[postId], submitting: true, showMentionDropdown: false, mentionSearch: '' }
      }));
    }
  }, [expandedComments, feedPosts, user?.id, currentProfile?.name, allProfiles]);

  // Handler de navegação (definido antes de renderContentWithMentions para poder ser usado nele)
  const handleNavigate = useCallback((moduleKey: string, params?: Record<string, string>) => {
    console.log('🧭 handleNavigate chamado:', moduleKey, params);
    onNavigateToModule?.(moduleKey, params);
  }, [onNavigateToModule]);

  // Renderizar conteúdo com menções e referências de entidades clicáveis
  const renderContentWithMentions = useCallback((content: string, entityReferences?: EntityReference[]) => {
    // Regex para referências [tipo:nome]
    const entityRefRegex = /\[(cliente|processo|prazo|agenda|documento|peticao|assinatura|requerimento|financeiro):([^\]]+)\]/g;
    
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    // Primeiro, processar referências de entidades [tipo:nome]
    const entityMatches: { index: number; length: number; type: string; name: string; ref?: EntityReference }[] = [];
    let entityMatch;
    while ((entityMatch = entityRefRegex.exec(content)) !== null) {
      const type = entityMatch[1];
      const name = entityMatch[2];
      const ref = entityReferences?.find(e => e.name === name || e.number === name);
      entityMatches.push({
        index: entityMatch.index,
        length: entityMatch[0].length,
        type,
        name,
        ref
      });
    }

    // Processar menções @nome - buscar nomes reais de perfis no conteúdo
    const mentionMatches: { index: number; length: number; name: string; profile: typeof allProfiles[0] }[] = [];
    
    // Para cada perfil, verificar se existe uma menção @NomeDoPerfil no conteúdo
    for (const profile of allProfiles) {
      if (!profile.name) continue;
      const mentionPattern = `@${profile.name}`;
      let searchIndex = 0;
      while (true) {
        const foundIndex = content.indexOf(mentionPattern, searchIndex);
        if (foundIndex === -1) break;
        
        // Verificar se após o nome há um caractere que não seja letra (para evitar match parcial)
        const afterMention = content[foundIndex + mentionPattern.length];
        const isValidEnd = !afterMention || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(afterMention);
        
        if (isValidEnd) {
          mentionMatches.push({
            index: foundIndex,
            length: mentionPattern.length,
            name: profile.name,
            profile
          });
        }
        searchIndex = foundIndex + 1;
      }
    }
    
    // Remover duplicatas (mesmo índice) e ordenar por índice
    const uniqueMentions = mentionMatches.filter((m, i, arr) => 
      arr.findIndex(x => x.index === m.index) === i
    );

    // Combinar e ordenar todos os matches
    const allMatches = [
      ...entityMatches.map(m => ({ ...m, matchType: 'entity' as const, profile: undefined as typeof allProfiles[0] | undefined })),
      ...uniqueMentions.map(m => ({ ...m, matchType: 'mention' as const }))
    ].sort((a, b) => a.index - b.index);

    // Processar matches em ordem
    for (const match of allMatches) {
      // Adicionar texto antes do match
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }

      if (match.matchType === 'mention') {
        // Menção de usuário - perfil já foi encontrado na busca
        const mentionedProfile = match.profile;
        
        parts.push(
          <span
            key={`mention-${match.index}`}
            className="text-blue-600 font-semibold cursor-pointer hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              console.log('🔵 Clique em menção:', match.name, 'Perfil encontrado:', mentionedProfile);
              if (mentionedProfile) {
                handleNavigate('perfil', { userId: mentionedProfile.user_id });
              } else {
                console.warn('⚠️ Perfil não encontrado para:', match.name);
              }
            }}
          >
            @{match.name}
          </span>
        );
      } else {
        // Referência de entidade
        const entityMatch = match as typeof entityMatches[0];
        const typeColors: Record<string, string> = {
          cliente: 'text-blue-600 bg-blue-50',
          processo: 'text-purple-600 bg-purple-50',
          prazo: 'text-red-600 bg-red-50',
          agenda: 'text-amber-600 bg-amber-50',
          documento: 'text-indigo-600 bg-indigo-50',
          peticao: 'text-cyan-600 bg-cyan-50',
          assinatura: 'text-pink-600 bg-pink-50',
          requerimento: 'text-orange-600 bg-orange-50',
          financeiro: 'text-emerald-600 bg-emerald-50'
        };
        const color = typeColors[entityMatch.type] || 'text-slate-600 bg-slate-50';
        
        parts.push(
          <span
            key={`entity-${match.index}`}
            className={`${color} font-medium px-1.5 py-0.5 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity`}
            onClick={() => {
              // Navegar para o módulo correspondente
              if (entityMatch.ref?.id) {
                const moduleMap: Record<string, string> = {
                  cliente: 'clientes',
                  processo: 'processos',
                  prazo: 'prazos',
                  agenda: 'agenda',
                  documento: 'documentos',
                  peticao: 'peticoes',
                  assinatura: 'assinaturas',
                  requerimento: 'requerimentos',
                  financeiro: 'financeiro'
                };
                const module = moduleMap[entityMatch.type];
                if (module) {
                  if (entityMatch.type === 'financeiro') {
                    handleOpenFinancialModal(entityMatch.ref.id);
                  } else {
                    onNavigateToModule?.(module, { id: entityMatch.ref.id });
                  }
                }
              }
            }}
            title={`${entityMatch.type}: ${entityMatch.name}`}
          >
            {entityMatch.name}
          </span>
        );
      }

      lastIndex = match.index + match.length;
    }

    // Adicionar texto restante
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  }, [allProfiles, handleOpenFinancialModal, handleNavigate]);

  // Carregar posts do feed ao montar
  useEffect(() => {
    loadFeedPosts();
  }, [loadFeedPosts]);

  // Abrir modal do post quando params?.openPostModal for passado
  useEffect(() => {
    if (params?.openPostModal) {
      const postId = params.openPostModal;
      console.log('📬 Abrindo modal do post:', postId);
      setSelectedPostId(postId);
      setShowPostModal(true);
    }
  }, [params?.openPostModal]);

  // Scroll até o post quando params?.scrollToPost for passado (fallback)
  useEffect(() => {
    if (params?.scrollToPost) {
      const scrollToPostId = params.scrollToPost;
      const scrollToPost = () => {
        const postElement = document.querySelector(`[data-post-id="${scrollToPostId}"]`);
        if (postElement) {
          postElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          postElement.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
          setTimeout(() => {
            postElement.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
          }, 2000);
          
          // Expandir comentários automaticamente quando aberto via menção
          if (!expandedComments[scrollToPostId]) {
            setExpandedComments(prev => ({
              ...prev,
              [scrollToPostId]: { comments: [], loading: true, newComment: '', submitting: false, showMentionDropdown: false, mentionSearch: '' }
            }));
            // Carregar comentários
            feedPostsService.getComments(scrollToPostId).then(comments => {
              const mappedComments = comments.map(c => ({
                user_id: c.author_id,
                name: c.author?.name || 'Usuário',
                avatar_url: c.author?.avatar_url || undefined,
                content: c.content,
                created_at: c.created_at,
              }));
              setExpandedComments(prev => ({
                ...prev,
                [scrollToPostId]: { ...prev[scrollToPostId], comments: mappedComments, loading: false }
              }));
            }).catch(() => {
              setExpandedComments(prev => ({
                ...prev,
                [scrollToPostId]: { ...prev[scrollToPostId], loading: false }
              }));
            });
          }
        }
      };

      // Esperar os posts carregarem antes de tentar scrollar
      if (feedPosts.length > 0) {
        scrollToPost();
      } else {
        const timeoutId = setTimeout(() => {
          scrollToPost();
        }, 1000);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [params?.scrollToPost, feedPosts, expandedComments]);

  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;

  const activeClients = clients.length;
  const activeProcesses = processes.length;
  const pendingDeadlines = deadlines.filter((d) => d.status === 'pendente').length;
  const canSeeIndicators = useMemo(() => {
    if (permissionsLoading) {
      return {
        clientes: true,
        processos: true,
        requerimentos: true,
        prazos: true,
        tarefas: true,
      };
    }
    if (isAdmin) {
      return {
        clientes: true,
        processos: true,
        requerimentos: true,
        prazos: true,
        tarefas: true,
      };
    }
    return {
      clientes: canView('clientes'),
      processos: canView('processos'),
      requerimentos: canView('requerimentos'),
      prazos: canView('prazos'),
      tarefas: canView('tarefas'),
    };
  }, [permissionsLoading, isAdmin, canView]);

  const awaitingDraftProcesses = useMemo(
    () => processes.filter((p) => p.status === 'aguardando_confeccao'),
    [processes]
  );

  const formatCurrency = useCallback((value: number): string => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }, []);

  const upcomingDeadlines = useMemo(
    () =>
      deadlines
        .filter((d) => d.status === 'pendente' && d.due_date)
        .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
        .slice(0, 5),
    [deadlines]
  );

  const recentTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'pending')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5),
    [tasks]
  );

  // Mapeia event_type para módulo de permissão
  const canViewEventType = useCallback((eventType: string) => {
    if (permissionsLoading) return true;
    if (isAdmin) return true;
    switch (eventType) {
      case 'payment':
        return canView('financeiro');
      case 'hearing':
        return canView('processos');
      case 'deadline':
        return canView('prazos');
      case 'requirement':
      case 'pericia':
        return canView('requerimentos');
      case 'meeting':
      case 'task':
      default:
        return canView('agenda');
    }
  }, [permissionsLoading, isAdmin, canView]);

  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const manualEvents = calendarEvents
      .filter((e) => {
        if (!e.start_at) return false;
        const eventDate = new Date(e.start_at);
        if (eventDate < today) return false;
        // Filtrar por permissão do módulo de origem
        return canViewEventType(e.event_type || 'meeting');
      })
      .map((e) => ({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        type: e.event_type || 'meeting',
        client_id: e.client_id,
      }));

    // Audiências só aparecem se tiver permissão de processos
    const hearingEvents = (isAdmin || canView('processos'))
      ? processes
          .filter((p) => p.hearing_scheduled && p.hearing_date)
          .filter((p) => {
            const hearingDate = new Date(p.hearing_date!);
            return hearingDate >= today;
          })
          .map((p) => {
            const client = clients.find((c) => c.id === p.client_id);
            const clientName = client?.full_name || 'Sem cliente';
            return {
              id: `hearing-${p.id}`,
              title: `Audiência - ${clientName}`,
              start_at: p.hearing_time ? `${p.hearing_date}T${p.hearing_time}` : p.hearing_date!,
              type: 'hearing',
              client_id: p.client_id,
            };
          })
      : [];

    return [...manualEvents, ...hearingEvents]
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 10);
  }, [calendarEvents, processes, clients, canViewEventType, isAdmin, canView]);

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Agora';
    if (diffMins < 60) return `${diffMins}m atrás`;
    if (diffHours < 24) return `${diffHours}h atrás`;
    if (diffDays === 1) return 'Ontem';
    return `${diffDays}d atrás`;
  };

  const formatTimeUntil = (date: string) => {
    const now = new Date();
    const d = new Date(date);
    const diffMs = d.getTime() - now.getTime();

    if (diffMs <= 60000) return 'em instantes';

    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins < 60) return `em ${diffMins}m`;

    const diffHours = Math.ceil(diffMs / 3600000);
    if (diffHours < 24) return `em ${diffHours}h`;

    const diffDays = Math.ceil(diffMs / 86400000);
    if (diffDays === 1) return 'amanhã';
    return `em ${diffDays}d`;
  };

  const openPollVotersModal = useCallback(async (pollId: string) => {
    setPollVotersModal({ open: true, pollId, voters: [], loading: true });
    try {
      const voters = await feedPollsService.getVoters(pollId);
      setPollVotersModal({ open: true, pollId, voters, loading: false });
    } catch (err) {
      console.error('Erro ao carregar votantes:', err);
      setPollVotersModal({ open: true, pollId, voters: [], loading: false });
      toast.error('Erro', 'Não foi possível carregar quem votou.');
    }
  }, [toast]);

  const closePollVotersModal = useCallback(() => {
    setPollVotersModal({ open: false, pollId: null, voters: [], loading: false });
  }, []);

  const pollForVotersModal = useMemo(() => {
    if (!pollVotersModal.pollId) return null;
    return Array.from(postPolls.values()).find((p) => p.id === pollVotersModal.pollId) || null;
  }, [pollVotersModal.pollId, postPolls]);

  const getDateLabel = (date: Date) => {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const getDueLabel = (dueDate?: string | null) => {
    if (!dueDate) return 'Sem prazo';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);

    if (diffDays < 0) return `Atrasado ${Math.abs(diffDays)}d`;
    if (diffDays === 0) return 'Vence Hoje';
    if (diffDays === 1) return 'Vence Amanhã';
    return `Vence em ${diffDays}d`;
  };

  const parseDateOnly = (value?: string | null): Date | null => {
    if (!value) return null;
    const datePart = value.includes('T') ? value.split('T')[0] : value;
    const parts = datePart.split('-').map((part) => Number.parseInt(part, 10));
    if (parts.length === 3 && parts.every((num) => Number.isFinite(num))) {
      const [year, month, day] = parts;
      return new Date(year, month - 1, day);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          <p className="text-slate-600 font-medium">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  // Função para renderizar widget por ID
  const renderWidget = (widgetId: string) => {
    if (widgetId === 'sugestoes') {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-500" />
              Pessoas
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">Sugestões</span>
          </div>
          {suggestedPeople.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <Users className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Nenhuma sugestão
            </div>
          ) : (
            <div className="space-y-2">
              {suggestedPeople.slice(0, 5).map((p) => (
                <div key={p.user_id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigateToModule?.('perfil', { userId: p.user_id })}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-slate-50 rounded-lg px-2 py-1.5 transition-colors"
                  >
                    <Avatar src={p.avatar_url} name={p.name} size="sm" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{p.role || 'Membro'}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => toast.info('Conectar', 'Funcionalidade de conexão pode ser habilitada em seguida.')}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                  >
                    Conectar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'eventos') {
      // Criar eventos de exemplo se não houver eventos reais
      const exampleEvents = upcomingEvents.length === 0 ? [
        {
          id: 'example-1',
          title: 'Reunião de equipe',
          start_at: new Date(Date.now() + 86400000).toISOString(), // Amanhã
          type: 'meeting' as const,
        },
        {
          id: 'example-2', 
          title: 'Revisão de processos',
          start_at: new Date(Date.now() + 172800000).toISOString(), // Depois de amanhã
          type: 'meeting' as const,
        },
        {
          id: 'example-3',
          title: 'Prazo final - Documentos',
          start_at: new Date(Date.now() + 259200000).toISOString(), // 3 dias
          type: 'deadline' as const,
        }
      ] : [];

      const displayEvents = upcomingEvents.length > 0 ? upcomingEvents : exampleEvents;
      
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              Próximos Eventos
            </h3>
            <button
              type="button"
              onClick={() => handleNavigate('agenda')}
              className="text-[10px] font-bold text-blue-600 hover:underline"
            >
              Ver
            </button>
          </div>
          <div className="space-y-2">
            {displayEvents.slice(0, 4).map((event) => {
              const eventDate = new Date(event.start_at);
              const label = eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
              const time = eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              const isExample = event.id.toString().startsWith('example-');
              
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => handleNavigate('agenda')}
                  className={`w-full text-left p-2 rounded-lg border transition-colors ${
                    isExample 
                      ? 'bg-blue-50 border-blue-200 hover:bg-blue-100' 
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className={`text-xs font-semibold truncate ${isExample ? 'text-blue-700' : 'text-slate-800'}`}>
                        {event.title}
                        {isExample && (
                          <span className="ml-1 text-[10px] text-blue-600 font-normal">(Exemplo)</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500">{label} • {time}</div>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${isExample ? 'text-blue-400' : 'text-slate-400'}`} />
                  </div>
                </button>
              );
            })}
          </div>
          {upcomingEvents.length === 0 && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-500 text-center">
                Nenhum evento agendado. Adicione eventos na agenda para vê-los aqui.
              </p>
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'atividade') {
      // Posts recentes dos colegas da equipe
      const teamActivity = feedPosts
        .filter(post => post.author_id !== user?.id) // Excluir próprios posts
        .slice(0, 5); // Últimos 5 posts

      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-purple-600" />
              Atividade da Equipe
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">Recente</span>
          </div>
          {teamActivity.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <MessageCircle className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Nenhuma atividade recente
            </div>
          ) : (
            <div className="space-y-3">
              {teamActivity.map((post) => (
                <div key={post.id} className="flex gap-2 p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                     onClick={() => {
                       setSelectedPostId(post.id);
                       setShowPostModal(true);
                     }}>
                  <Avatar src={post.author?.avatar_url} name={post.author?.name || 'Usuário'} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs font-semibold text-slate-800 truncate">
                        {post.author?.name || 'Usuário'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {formatTimeAgo(post.created_at)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 line-clamp-2">
                      {post.content.length > 60 ? post.content.slice(0, 60) + '...' : post.content}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        <ThumbsUp className="w-3 h-3" />
                        {post.likes_count || 0}
                      </span>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {post.comments_count || 0}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'conexoes') {
      // Pessoas com mais interações no feed
      const topConnections = useMemo(() => {
        const interactions = new Map<string, { name: string; avatar_url?: string; role?: string; interactions: number }>();
        
        feedPosts.forEach(post => {
          if (post.author_id !== user?.id) {
            const current = interactions.get(post.author_id) || { 
              name: post.author?.name || 'Usuário', 
              avatar_url: post.author?.avatar_url,
              role: post.author?.role,
              interactions: 0 
            };
            current.interactions += (post.likes_count || 0) + (post.comments_count || 0);
            interactions.set(post.author_id, current);
          }
        });

        return Array.from(interactions.values())
          .sort((a, b) => b.interactions - a.interactions)
          .slice(0, 4);
      }, [feedPosts, user?.id]);

      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-green-600" />
              Conexões em Destaque
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">Top</span>
          </div>
          {topConnections.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <Users className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Nenhuma conexão
            </div>
          ) : (
            <div className="space-y-2">
              {topConnections.map((person, index) => (
                <div key={person.name} className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-[10px] font-bold">
                    {index + 1}
                  </div>
                  <Avatar src={person.avatar_url} name={person.name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate">{person.name}</div>
                    <div className="text-[10px] text-slate-500">{person.role || 'Membro'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-green-600">{person.interactions}</div>
                    <div className="text-[9px] text-slate-400">interações</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'metricas') {
      // Estatísticas do feed
      const totalPosts = feedPosts.length;
      const totalLikes = feedPosts.reduce((sum, post) => sum + (post.likes_count || 0), 0);
      const totalComments = feedPosts.reduce((sum, post) => sum + (post.comments_count || 0), 0);
      const avgEngagement = totalPosts > 0 ? Math.round(((totalLikes + totalComments) / totalPosts) * 10) / 10 : 0;

      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
              Métricas do Feed
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">Hoje</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-100">
              <div className="flex items-center justify-between mb-1">
                <FileText className="w-4 h-4 text-blue-600" />
                <span className="text-[10px] text-blue-600 font-medium">Posts</span>
              </div>
              <div className="text-lg font-bold text-blue-900">{totalPosts}</div>
              <div className="text-[9px] text-slate-500">publicados</div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-pink-50 rounded-lg p-3 border border-red-100">
              <div className="flex items-center justify-between mb-1">
                <Heart className="w-4 h-4 text-red-600" />
                <span className="text-[10px] text-red-600 font-medium">Curtidas</span>
              </div>
              <div className="text-lg font-bold text-red-900">{totalLikes}</div>
              <div className="text-[9px] text-slate-500">totais</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 border border-green-100">
              <div className="flex items-center justify-between mb-1">
                <MessageCircle className="w-4 h-4 text-green-600" />
                <span className="text-[10px] text-green-600 font-medium">Coment.</span>
              </div>
              <div className="text-lg font-bold text-green-900">{totalComments}</div>
              <div className="text-[9px] text-slate-500">totais</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg p-3 border border-purple-100">
              <div className="flex items-center justify-between mb-1">
                <TrendingUp className="w-4 h-4 text-purple-600" />
                <span className="text-[10px] text-purple-600 font-medium">Engaj.</span>
              </div>
              <div className="text-lg font-bold text-purple-900">{avgEngagement}</div>
              <div className="text-[9px] text-slate-500">médio</div>
            </div>
          </div>
        </div>
      );
    }
    if (widgetId === 'topicos') {
      // Tópicos mais populares com visual gráfico
      const topTopics = useMemo(() => {
        const counts = new Map<string, number>();
        feedPosts.forEach((post) => {
          (post.tags || []).forEach((tag) => {
            counts.set(tag, (counts.get(tag) || 0) + 1);
          });
        });
        return Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
      }, [feedPosts]);

      const maxCount = Math.max(...topTopics.map(([, count]) => count), 1);

      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <Hash className="w-4 h-4 text-orange-600" />
              Tópicos Quentes
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">Top 5</span>
          </div>
          {topTopics.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <Hash className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Sem tópicos
            </div>
          ) : (
            <div className="space-y-2">
              {topTopics.map(([tagId, count]) => {
                const tagConfig = availableTags.find((t) => t.id === tagId);
                const percentage = (count / maxCount) * 100;
                
                return (
                  <button
                    key={tagId}
                    type="button"
                    onClick={() => setFeedTagFilter(tagId)}
                    className="w-full group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${tagConfig?.color || 'bg-slate-100 text-slate-700'}`}>
                        #{tagConfig?.label || tagId}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">{count}</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${
                          feedTagFilter === tagId 
                            ? 'bg-gradient-to-r from-orange-500 to-red-500' 
                            : 'bg-gradient-to-r from-orange-400 to-orange-500 group-hover:from-orange-500 group-hover:to-orange-600'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'destaque') {
      // Post mais curtido da semana
      const topPost = useMemo(() => {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return feedPosts
          .filter(post => new Date(post.created_at) >= oneWeekAgo)
          .sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0))[0];
      }, [feedPosts]);

      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <Award className="w-4 h-4 text-yellow-600" />
              Post em Destaque
            </h3>
            <span className="text-[10px] text-slate-500 font-medium">Semana</span>
          </div>
          {!topPost ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <Award className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Nenhum post esta semana
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                    <Award className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Avatar src={topPost.author?.avatar_url} name={topPost.author?.name || 'Usuário'} size="sm" />
                    <span className="text-xs font-semibold text-slate-800">{topPost.author?.name || 'Usuário'}</span>
                  </div>
                  <div className="text-xs text-slate-600 line-clamp-3 mb-2">
                    {topPost.content.length > 100 ? topPost.content.slice(0, 100) + '...' : topPost.content}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-red-600 font-medium flex items-center gap-1">
                      <Heart className="w-3 h-3 fill-current" />
                      {topPost.likes_count || 0} curtidas
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatTimeAgo(topPost.created_at)}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedPostId(topPost.id);
                      setShowPostModal(true);
                    }}
                    className="mt-2 w-full text-xs text-blue-600 font-medium hover:text-blue-700 transition-colors"
                  >
                    Ver post completo
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'agenda') {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col max-h-[320px]">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              Agenda Jurídica
            </h3>
            <button
              onClick={() => handleNavigate('agenda')}
              className="text-xs text-blue-600 font-medium hover:underline"
            >
              Ver Agenda
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {upcomingEvents.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-sm">
                <Calendar className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                Nenhum compromisso
              </div>
            ) : (
              <div className="flex flex-col">
                {upcomingEvents.slice(0, 4).map((event) => {
                  const eventDate = new Date(event.start_at);
                  const isToday = eventDate.toDateString() === new Date().toDateString();
                  const client = event.client_id ? clientMap.get(event.client_id) : null;
                  return (
                    <AgendaItem
                      key={event.id}
                      time={eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      dateLabel={getDateLabel(eventDate)}
                      isToday={isToday}
                      title={event.title}
                      subtitle={client?.full_name || (event.type === 'payment' ? 'Pagamento' : event.type === 'hearing' ? 'Audiência' : event.type === 'deadline' ? 'Prazo' : event.type === 'meeting' ? 'Reunião' : event.type === 'task' ? 'Tarefa' : event.type === 'other' ? 'Outro' : event.type)}
                      onClick={() => handleNavigate('agenda')}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }
    if (widgetId === 'tarefas') {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-orange-500" />
              Tarefas Pendentes
            </h3>
            {recentTasks.filter((t) => {
              const due = t.due_date ? new Date(t.due_date) : null;
              return due && due <= new Date();
            }).length > 0 && (
              <div className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold">
                {recentTasks.filter((t) => {
                  const due = t.due_date ? new Date(t.due_date) : null;
                  return due && due <= new Date();
                }).length}{' '}
                Urgente
              </div>
            )}
          </div>
          {recentTasks.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-sm">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              Nenhuma tarefa pendente
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recentTasks.slice(0, 4).map((task) => {
                const dueDate = task.due_date ? new Date(task.due_date) : null;
                const isUrgent = !!(dueDate && dueDate <= new Date());
                return (
                  <TaskItem
                    key={task.id}
                    title={task.title}
                    dueLabel={getDueLabel(task.due_date)}
                    isUrgent={isUrgent}
                  />
                );
              })}
            </div>
          )}
          <button
            onClick={() => handleNavigate('tarefas')}
            className="w-full mt-4 py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 text-xs hover:bg-slate-50 transition-colors font-medium"
          >
            + Nova Tarefa
          </button>
        </div>
      );
    }
    if (widgetId === 'djen') {
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-blue-500" />
              Intimações DJEN
            </h3>
            {djenIntimacoes.length > 0 && (
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold">
                {djenIntimacoes.length} Nova{djenIntimacoes.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {djenIntimacoes.length === 0 ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <Bell className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Nenhuma intimação
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {djenIntimacoes.slice(0, 2).map((int) => (
                <DjenNotification
                  key={int.id}
                  processNumber={int.numero_processo || 'Sem número'}
                  content={int.texto || 'Sem conteúdo'}
                  timeAgo={formatTimeAgo(int.data_disponibilizacao || new Date().toISOString())}
                  onClick={() => handleNavigate('intimacoes')}
                />
              ))}
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'confeccao') {
      const hasItems = awaitingDraftProcesses.length > 0 || requirementsAwaiting.length > 0;
      const canViewProcesses = isAdmin || canView('processos');
      const canViewRequirements = isAdmin || canView('requerimentos');
      
      const totalItems = awaitingDraftProcesses.length + requirementsAwaiting.length;
      
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-500" />
              Aguardando Confecção
            </h3>
            {totalItems > 0 && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                {totalItems}
              </span>
            )}
          </div>

          {!hasItems || (!canViewProcesses && !canViewRequirements) ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <CheckCircle className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Nada aguardando
            </div>
          ) : (
            <div className="space-y-2">
              {/* Processos */}
              {canViewProcesses && awaitingDraftProcesses.length > 0 && (
                <button
                  onClick={() => handleNavigate('processos', { statusFilter: 'aguardando_confeccao' })}
                  className="w-full text-left group"
                >
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                          <Briefcase className="w-3.5 h-3.5 text-indigo-600" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-800">Processos</div>
                          <div className="text-[10px] text-slate-500">Aguardando confecção</div>
                        </div>
                      </div>
                      <span className="text-xs font-bold bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700">
                        {awaitingDraftProcesses.length}
                      </span>
                    </div>

                    <div className="space-y-1 pl-9">
                      {awaitingDraftProcesses.slice(0, 2).map((process) => {
                        const client = process.client_id ? clientMap.get(process.client_id) : null;
                        const primary = client?.full_name || 'Cliente não vinculado';
                        const secondary = process.process_code || 'Processo';
                        return (
                          <div key={process.id} className="flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-indigo-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-slate-700 truncate">{primary}</div>
                              <div className="text-[10px] text-slate-500 truncate">{secondary}</div>
                            </div>
                          </div>
                        );
                      })}
                      {awaitingDraftProcesses.length > 2 && (
                        <div className="text-[10px] text-indigo-600 font-semibold">+{awaitingDraftProcesses.length - 2} processos</div>
                      )}
                    </div>
                  </div>
                </button>
              )}

              {/* Requerimentos */}
              {canViewRequirements && requirementsAwaiting.length > 0 && (
                <button
                  onClick={() => handleNavigate('requerimentos', { statusTab: 'aguardando_confeccao' })}
                  className="w-full text-left group"
                >
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 hover:border-purple-300 hover:bg-purple-50/50 transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
                          <ScrollText className="w-3.5 h-3.5 text-purple-600" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-800">Requerimentos</div>
                          <div className="text-[10px] text-slate-500">Aguardando confecção</div>
                        </div>
                      </div>
                      <span className="text-xs font-bold bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700">
                        {requirementsAwaiting.length}
                      </span>
                    </div>

                    <div className="space-y-1 pl-9">
                      {requirementsAwaiting.slice(0, 2).map((req) => {
                        const primary = req.beneficiary || 'Beneficiário não informado';
                        const secondary = (req.benefit_type || 'Requerimento').replace(/_/g, ' ');
                        return (
                          <div key={req.id} className="flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-purple-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-slate-700 truncate">{primary}</div>
                              <div className="text-[10px] text-slate-500 truncate">{secondary}</div>
                            </div>
                          </div>
                        );
                      })}
                      {requirementsAwaiting.length > 2 && (
                        <div className="text-[10px] text-purple-600 font-semibold">+{requirementsAwaiting.length - 2} requerimentos</div>
                      )}
                    </div>
                  </div>
                </button>
              )}

              {/* Botão Ver Todos */}
              {totalItems > 0 && (
                <button
                  onClick={() => handleNavigate('processos', { statusFilter: 'aguardando_confeccao' })}
                  className="w-full py-2 text-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  Ver todos ({totalItems})
                </button>
              )}
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'financeiro') {
      return (
        <FinancialCard
          stats={financialStats}
          onNavigate={() => handleNavigate('financeiro')}
        />
      );
    }
    if (widgetId === 'prazos') {
      const nextDeadlines = deadlines
        .filter((d) => d.status === 'pendente' && d.due_date)
        .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
        .slice(0, 5);

      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Prazos</h3>
            </div>
            <button
              onClick={() => handleNavigate('prazos')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Ver todos
            </button>
          </div>
          {nextDeadlines.length === 0 ? (
            <p className="text-slate-400 text-xs text-center py-4">Nenhum prazo pendente</p>
          ) : (
            <div className="space-y-2">
              {nextDeadlines.map((d) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const due = parseDateOnly(d.due_date);
                const diffDays = due ? Math.floor((due.getTime() - today.getTime()) / 86400000) : 0;
                const isOverdue = diffDays < 0;

                return (
                  <div
                    key={d.id}
                    onClick={() => handleNavigate('prazos')}
                    className={`p-2 rounded-lg cursor-pointer transition-colors ${
                      isOverdue ? 'bg-red-50 hover:bg-red-100' : 'bg-amber-50 hover:bg-amber-100'
                    }`}
                  >
                    <p className="text-xs font-medium text-slate-900 truncate">{d.title}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className={`text-[10px] font-medium ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                        {isOverdue ? `Atrasado ${Math.abs(diffDays)} dia(s)` : diffDays === 0 ? 'Hoje' : `${diffDays} dia(s)`}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        d.priority === 'urgente' ? 'bg-red-200 text-red-700' :
                        d.priority === 'alta' ? 'bg-orange-200 text-orange-700' :
                        'bg-slate-200 text-slate-600'
                      }`}>
                        {d.priority}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    if (widgetId === 'navegacao') {
      return (
        <nav className="flex flex-col gap-2">
          <button
            onClick={() => handleNavigate('dashboard')}
            className="flex items-center gap-3 px-4 py-3 bg-blue-50 text-blue-600 border border-blue-100 rounded-xl font-medium transition-all shadow-sm"
          >
            <Sparkles className="w-5 h-5" />
            Feed de Notícias
          </button>
          {(isAdmin || canView('processos')) && (
            <button
              onClick={() => handleNavigate('processos')}
              className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
            >
              <Briefcase className="w-5 h-5" />
              Meus Processos
            </button>
          )}
          {(isAdmin || canView('agenda')) && (
            <button
              onClick={() => handleNavigate('agenda')}
              className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
            >
              <Calendar className="w-5 h-5" />
              Agenda
            </button>
          )}
          {(isAdmin || canView('clientes')) && (
            <button
              onClick={() => handleNavigate('clientes')}
              className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
            >
              <Users className="w-5 h-5" />
              Clientes
            </button>
          )}
          {(isAdmin || canView('documentos')) && (
            <button
              onClick={() => handleNavigate('documentos')}
              className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
            >
              <Bookmark className="w-5 h-5" />
              Documentos
            </button>
          )}
        </nav>
      );
    }
    return null;
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Main Content */}
      <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) => {
            try {
              setActiveWidgetId(String(event.active.id));
            } catch {
              setActiveWidgetId(null);
            }
          }}
          onDragEnd={(event) => {
            setActiveWidgetId(null);
            handleDragEnd(event);
          }}
          onDragCancel={() => setActiveWidgetId(null)}
        >
          <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px] gap-4 lg:items-start">
            {/* Sidebar Esquerda - Widgets de Análise */}
            <aside className="hidden lg:block">
              <div className="sticky top-4 space-y-4">
                <SidebarDroppable id="left-sidebar">
                  <SortableContext items={visibleLeftWidgets} strategy={rectSortingStrategy}>
                    {visibleLeftWidgets.map((id) => (
                      <SortableWidget key={id} id={id}>
                        {renderWidget(id)}
                      </SortableWidget>
                    ))}
                  </SortableContext>
                </SidebarDroppable>
              </div>
            </aside>

            {/* Feed Central */}
            <main className="w-full min-w-0 max-w-2xl mx-auto flex flex-col gap-4 sm:gap-6">
          {/* Caixa de Postagem - Design Premium */}
          <div className="bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200/80 shadow-lg shadow-slate-200/50 overflow-visible">
            {/* Header do Post */}
            <div className="p-3 sm:p-4 pb-2 sm:pb-3">
              <div className="flex gap-3">
                <div className="relative">
                  <Avatar src={resolvedCurrentAvatarUrl} name={currentProfile?.name || 'Usuário'} size="md" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white" />
                </div>
                <div className="flex-1 relative">
                  <textarea
                    ref={postInputRef}
                    value={postText}
                    onChange={handlePostTextChange}
                    rows={2}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 focus:shadow-lg focus:shadow-blue-500/10 transition-all resize-none text-sm leading-relaxed"
                    placeholder={getDynamicPlaceholder()}
                  />

                  {showEmojiPicker && (
                    <div className="absolute bottom-14 left-0 z-20 w-[280px] rounded-2xl border border-slate-200 bg-white shadow-xl p-3">
                      <p className="text-xs font-semibold text-slate-500 mb-2">Emojis</p>
                      <div className="grid grid-cols-8 gap-1">
                        {['😀','😄','😁','😂','🤣','😊','😍','😘','😎','🤔','😅','😭','😡','👍','👎','🙏','👏','💪','🔥','🎉','✅','❌','⚠️','📌','📎','📞','💬','❤️','🧠','📄','🗂️','🕒'].map((e) => (
                          <button
                            key={e}
                            type="button"
                            className="h-8 w-8 rounded-lg hover:bg-slate-100 transition text-lg"
                            onClick={() => handlePickEmoji(e)}
                            aria-label={`Emoji ${e}`}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Dropdown de Menções */}
                  {showMentionDropdown && filteredProfiles.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50 max-h-48 overflow-y-auto">
                      <div className="p-2 border-b border-slate-100">
                        <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                          <AtSign className="w-3 h-3" /> Mencionar usuário
                        </span>
                      </div>
                      {filteredProfiles.map((profile) => (
                        <button
                          key={profile.id}
                          onClick={() => insertMention(profile)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                        >
                          <Avatar src={profile.avatar_url} name={profile.name} size="sm" />
                          <div>
                            <p className="text-sm font-medium text-slate-900">{profile.name}</p>
                            <p className="text-xs text-slate-500">{profile.role}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Dropdown de Tags */}
                  {showTagDropdown && !selectedTagForRecords && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50">
                      <div className="p-2 border-b border-slate-100">
                        <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                          <Hash className="w-3 h-3" /> Selecione uma categoria para ver registros
                        </span>
                      </div>
                      <div className="p-2 grid grid-cols-2 gap-1">
                        {availableTags.map((tag) => (
                          <button
                            key={tag.id}
                            onClick={() => loadTagRecords(tag.id)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tag.color} hover:opacity-80`}
                          >
                            <tag.icon className="w-4 h-4" />
                            {tag.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dropdown de Registros da Tag Selecionada */}
                  {selectedTagForRecords && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50 max-h-80 overflow-y-auto">
                      <div className="p-2 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                        <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                          <Hash className="w-3 h-3" /> 
                          {availableTags.find(t => t.id === selectedTagForRecords)?.label || 'Registros'}
                        </span>
                        <button 
                          onClick={closeTagRecordsDropdown}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      
                      {/* Campo de busca */}
                      <div className="p-2 border-b border-slate-100">
                        <input
                          type="text"
                          placeholder="Buscar..."
                          value={tagRecordSearch}
                          onChange={(e) => handleTagRecordSearch(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500/20 focus:border-slate-400 outline-none"
                          autoFocus
                        />
                      </div>
                       
                      {loadingTagRecords ? (
                        <div className="p-4 text-center">
                          <Loader2 className="w-5 h-5 mx-auto text-blue-500 animate-spin" />
                          <p className="text-xs text-slate-500 mt-1">Carregando...</p>
                        </div>
                      ) : tagRecords.length === 0 ? (
                        <div className="p-4 text-center">
                          <p className="text-sm text-slate-500">Nenhum registro encontrado</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {tagRecords.map((record) => {
                            const tagConfig = availableTags.find(t => t.id === selectedTagForRecords);
                            return (
                              <button
                                key={record.id}
                                onClick={() => selectTagRecord(record)}
                                className="w-full p-3 text-left hover:bg-slate-50 transition-colors"
                              >
                                <div className="flex items-start gap-3">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tagConfig?.color || 'bg-slate-100'}`}>
                                    {tagConfig && <tagConfig.icon className="w-4 h-4" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 truncate">{record.label}</p>
                                    <p className="text-xs text-slate-500 truncate">{record.sublabel}</p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Tags Selecionadas */}
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 ml-[52px]">
                  {selectedTags.map((tagId) => {
                    const tag = availableTags.find(t => t.id === tagId);
                    if (!tag) return null;
                    return (
                      <span
                        key={tagId}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${tag.color}`}
                      >
                        <tag.icon className="w-3 h-3" />
                        #{tag.label}
                        <button
                          onClick={() => toggleTag(tagId)}
                          className="ml-1 hover:opacity-70"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {pendingAttachments.length > 0 && (
                <div className="mt-3 ml-[52px]">
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((att) => (
                      <div key={att.attachment.filePath} className="relative group">
                        {att.attachment.file_type.startsWith('image/') ? (
                          <div className="relative">
                            <img 
                              src={att.localUrl} 
                              alt={att.attachment.file_name}
                              className="h-20 w-20 object-cover rounded-lg border border-slate-200 shadow-sm group-hover:shadow-md transition-shadow" 
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 border border-slate-200 h-20 w-32 group-hover:bg-slate-200 transition-colors">
                            <Paperclip className="w-4 h-4 text-slate-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-slate-700 truncate font-medium">{att.attachment.file_name}</p>
                              <p className="text-[10px] text-slate-500">
                                {(att.attachment.file_size / 1024).toFixed(1)} KB
                              </p>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg flex items-center justify-center hover:bg-red-600"
                          onClick={() => {
                            try { URL.revokeObjectURL(att.localUrl); } catch {}
                            setPendingAttachments((prev) => prev.filter((p) => p.attachment.filePath !== att.attachment.filePath));
                          }}
                          aria-label="Remover anexo"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Barra de Ações - Layout responsivo em 2 linhas */}
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-gradient-to-r from-slate-50 to-slate-100/50 border-t border-slate-200/80 space-y-2">
              {/* Linha 1: Ações principais */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      insertTextAtCursor('@');
                      setShowMentionDropdown(true);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-xs sm:text-sm font-medium"
                  >
                    <AtSign className="w-4 h-4 text-blue-500" />
                    <span className="hidden sm:inline text-xs">Mencionar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      insertTextAtCursor('#');
                      setShowTagDropdown(true);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-xs sm:text-sm font-medium"
                  >
                    <Hash className="w-4 h-4 text-emerald-500" />
                    <span className="hidden sm:inline text-xs">Tag</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsMobileComposerActionsExpanded((v) => !v)}
                    className="sm:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-xs font-medium"
                    aria-label={isMobileComposerActionsExpanded ? 'Recolher ações' : 'Expandir ações'}
                    title={isMobileComposerActionsExpanded ? 'Recolher' : 'Expandir'}
                  >
                    {isMobileComposerActionsExpanded ? (
                      <Minus className="w-4 h-4 text-slate-600" />
                    ) : (
                      <Plus className="w-4 h-4 text-slate-600" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setPostVisibility((prev) => (prev === 'public' ? 'team' : prev === 'team' ? 'private' : 'public'))
                    }
                    className={`sm:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors text-xs font-medium whitespace-nowrap border ${
                      postVisibility === 'public'
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : postVisibility === 'team'
                          ? 'bg-blue-100 text-blue-700 border-blue-200'
                          : 'bg-amber-100 text-amber-700 border-amber-200'
                    }`}
                    title={`Visibilidade: ${postVisibility === 'public' ? 'Público' : postVisibility === 'team' ? 'Equipe' : 'Privado'}`}
                  >
                    {postVisibility === 'public' ? (
                      <Globe className="w-3.5 h-3.5" />
                    ) : postVisibility === 'team' ? (
                      <Users className="w-3.5 h-3.5" />
                    ) : (
                      <Lock className="w-3.5 h-3.5" />
                    )}
                    <span>{postVisibility === 'public' ? 'Público' : postVisibility === 'team' ? 'Equipe' : 'Privado'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowScheduler((v) => !v)}
                    className={`sm:hidden flex items-center justify-center p-2 rounded-lg transition-colors text-xs font-medium border flex-none ${
                      showScheduler
                        ? 'bg-orange-100 text-orange-700 border-orange-200'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                    aria-label="Agendar publicação"
                    title="Agendar publicação"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>

                  <div className="hidden sm:flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleAttachClick}
                    disabled={uploadingAttachment}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-xs sm:text-sm font-medium"
                  >
                    <Image className="w-4 h-4 text-purple-500" />
                    <span className="hidden sm:inline text-xs">Foto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker((v) => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-xs sm:text-sm font-medium"
                  >
                    <Smile className="w-4 h-4 text-amber-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPollCreator((v) => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-xs sm:text-sm font-medium ${showPollCreator ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <BarChart2 className="w-4 h-4 text-indigo-500" />
                    <span className="hidden sm:inline text-xs">Enquete</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEventCreator((v) => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-xs sm:text-sm font-medium ${showEventCreator ? 'bg-green-100 text-green-700' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <Calendar className="w-4 h-4 text-green-500" />
                    <span className="hidden sm:inline text-xs">Evento</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowArticleCreator((v) => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-xs sm:text-sm font-medium ${showArticleCreator ? 'bg-orange-100 text-orange-700' : 'text-slate-600 hover:bg-slate-200'}`}
                  >
                    <FileText className="w-4 h-4 text-orange-500" />
                    <span className="hidden sm:inline text-xs">Artigo</span>
                  </button>
                  </div>
                  </div>

                  {isMobileComposerActionsExpanded && (
                    <div className="sm:hidden flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleAttachClick}
                        disabled={uploadingAttachment}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-xs font-medium"
                        aria-label="Adicionar foto"
                        title="Foto"
                      >
                        <Image className="w-4 h-4 text-purple-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker((v) => !v)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-xs font-medium"
                        aria-label="Emojis"
                        title="Emojis"
                      >
                        <Smile className="w-4 h-4 text-amber-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPollCreator((v) => !v)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-xs font-medium ${showPollCreator ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-200'}`}
                        aria-label="Enquete"
                        title="Enquete"
                      >
                        <BarChart2 className="w-4 h-4 text-indigo-500" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Botão Publicar */}
                <button
                  type="button"
                  onClick={handlePublishPost}
                  disabled={!(
                    postText.trim() ||
                    (showPollCreator && pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2)
                  ) || postingInProgress}
                  className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed text-white px-3 sm:px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/30 hover:-translate-y-0.5"
                >
                  {postingInProgress ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : showScheduler && scheduledDate && scheduledTime ? (
                    <Clock className="w-4 h-4" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {postingInProgress ? 'Publicando...' : showScheduler && scheduledDate && scheduledTime ? 'Agendar' : 'Publicar'}
                  </span>
                </button>
              </div>

              {/* Linha 2: Visibilidade e Agendamento */}
              <div className="hidden sm:flex items-center gap-2">
                {/* Visibilidade */}
                <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 px-1 py-0.5 flex-none">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPostVisibility('public')}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium whitespace-nowrap ${
                        postVisibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      title="Público - todos veem"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Público</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostVisibility('team')}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium whitespace-nowrap ${
                        postVisibility === 'team' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      title="Equipe - só colaboradores"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Equipe</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPostVisibility('private')}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium whitespace-nowrap ${
                        postVisibility === 'private' ? 'bg-amber-100 text-amber-700' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      title="Privado - selecione quem pode ver"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Privado</span>
                    </button>
                  </div>
                </div>

                {/* Agendar */}
                <button
                  type="button"
                  onClick={() => setShowScheduler((v) => !v)}
                  className={`flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 rounded-lg transition-colors text-xs font-medium border whitespace-nowrap flex-none ${
                    showScheduler 
                      ? 'bg-orange-100 text-orange-700 border-orange-200' 
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                  title="Agendar publicação"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Agendar</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    handleUploadAttachment(file);
                  }}
                />
              </div>

              {/* Destinatários (Privado/Equipe) */}
              {postVisibility !== 'public' && (
                <div className="bg-white rounded-xl border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-700">
                      {postVisibility === 'private' ? 'Privado para:' : 'Equipe (selecionar):'}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Selecione pessoas e/ou departamentos
                    </span>
                  </div>

                  {/* Roles (departamentos via Cargo) */}
                  {availableAudienceRoles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {availableAudienceRoles.map((role) => {
                        const active = audienceRoles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => {
                              setAudienceRoles((prev) =>
                                prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
                              );
                            }}
                            className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                              active
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                            title={role}
                          >
                            {role}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Pessoas */}
                  <div className="mt-2">
                    <input
                      value={audienceSearch}
                      onChange={(e) => setAudienceSearch(e.target.value)}
                      placeholder="Buscar pessoas..."
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    <div className="flex flex-wrap gap-1 mt-2">
                      {audienceUserIds.map((uid) => {
                        const p = allProfiles.find((x) => x.user_id === uid);
                        const label = p?.name || 'Usuário';
                        return (
                          <button
                            key={uid}
                            type="button"
                            onClick={() => setAudienceUserIds((prev) => prev.filter((x) => x !== uid))}
                            className="text-[11px] px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                            title="Remover"
                          >
                            {label} ✕
                          </button>
                        );
                      })}
                    </div>
                    {audienceSearch.trim().length > 0 && (
                      <div className="mt-2 max-h-40 overflow-auto border border-slate-200 rounded-lg bg-white">
                        {filteredAudienceProfiles
                          .filter((p) => !audienceUserIds.includes(p.user_id))
                          .slice(0, 10)
                          .map((p) => (
                            <button
                              key={p.user_id}
                              type="button"
                              onClick={() => {
                                setAudienceUserIds((prev) => [...prev, p.user_id]);
                                setAudienceSearch('');
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                            >
                              <span className="font-medium text-slate-900">{p.name}</span>
                              <span className="text-xs text-slate-500">{p.role ? ` • ${p.role}` : ''}</span>
                            </button>
                          ))}
                        {filteredAudienceProfiles.length === 0 && (
                          <div className="px-3 py-2 text-sm text-slate-500">Nenhum usuário encontrado</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Agendamento inline */}
              {showScheduler && (
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 rounded-lg border border-orange-200">
                  <Clock className="w-4 h-4 text-orange-500" />
                  <span className="text-xs text-orange-700 font-medium">Agendar para:</span>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="px-2 py-1 text-xs rounded border border-orange-200 bg-white focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400"
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="px-2 py-1 text-xs rounded border border-orange-200 bg-white focus:ring-2 focus:ring-orange-500/30 focus:border-orange-400"
                  />
                  <button
                    type="button"
                    onClick={() => { setShowScheduler(false); setScheduledDate(''); setScheduledTime(''); }}
                    className="ml-auto text-orange-500 hover:text-orange-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Criador de Enquete */}
            {showPollCreator && (
              <div className="px-4 pb-4 border-t border-slate-100 pt-4 mt-2">
                <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-2xl p-5 border border-blue-100 shadow-lg shadow-blue-100/30">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md shadow-blue-500/25">
                        <BarChart2 className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <span className="font-bold text-slate-900 text-base">Criar Enquete</span>
                        <p className="text-xs text-slate-500">Faça uma pergunta e adicione opções</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowPollCreator(false)}
                      className="w-8 h-8 rounded-lg bg-white/80 hover:bg-white text-slate-500 hover:text-slate-700 flex items-center justify-center transition-all shadow-sm hover:shadow-md"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Pergunta */}
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Pergunta *</label>
                    <input
                      type="text"
                      value={pollQuestion}
                      onChange={(e) => setPollQuestion(e.target.value)}
                      placeholder="Ex: Qual sua cor favorita?"
                      className="w-full bg-white border-2 border-blue-100 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all placeholder:text-slate-400"
                    />
                  </div>

                  {/* Opções */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-slate-600">Opções *</label>
                      <span className="text-xs text-slate-400">{pollOptions.filter(o => o.trim()).length}/6</span>
                    </div>
                    <div className="space-y-2">
                      {pollOptions.map((opt, idx) => (
                        <div key={idx} className="flex items-center gap-2 group">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-100 to-cyan-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 border border-blue-200">
                            {idx + 1}
                          </div>
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const newOpts = [...pollOptions];
                              newOpts[idx] = e.target.value;
                              setPollOptions(newOpts);
                            }}
                            placeholder={`Opção ${idx + 1}`}
                            className="flex-1 bg-white border-2 border-slate-100 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all placeholder:text-slate-400"
                          />
                          {pollOptions.length > 2 && (
                            <button
                              onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                              className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {pollOptions.length < 6 && (
                      <button
                        onClick={() => setPollOptions([...pollOptions, ''])}
                        className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-50 hover:border-blue-300 transition-all"
                      >
                        <Plus className="w-4 h-4" />
                        Adicionar opção
                      </button>
                    )}
                  </div>

                  {/* Configurações */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    {/* Múltiplas opções */}
                    <div className="flex items-center gap-2 p-3 bg-white rounded-xl border-2 border-slate-100 hover:border-blue-200 transition-all cursor-pointer"
                      onClick={() => setPollAllowMultiple(!pollAllowMultiple)}
                    >
                      <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${pollAllowMultiple ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                        {pollAllowMultiple && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-slate-700">Permitir múltiplas</p>
                        <p className="text-[10px] text-slate-400">Votar em mais de uma opção</p>
                      </div>
                    </div>

                    {/* Expiração */}
                    <div className="flex items-center gap-2 p-3 bg-white rounded-xl border-2 border-slate-100">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <select
                        value={pollExpiresIn}
                        onChange={(e) => setPollExpiresIn(e.target.value)}
                        className="flex-1 bg-transparent text-sm font-medium text-slate-700 focus:outline-none cursor-pointer"
                      >
                        <option value="1h">1 hora</option>
                        <option value="6h">6 horas</option>
                        <option value="24h">24 horas</option>
                        <option value="3d">3 dias</option>
                        <option value="7d">7 dias</option>
                        <option value="never">Sem expiração</option>
                      </select>
                    </div>
                  </div>

                  {/* Participantes */}
                  <div className="p-3 bg-white rounded-xl border-2 border-slate-100">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-semibold text-slate-700">Participantes</span>
                      {pollParticipants.length > 0 && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                          {pollParticipants.length} selecionado{pollParticipants.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={pollParticipants.length === 0}
                          onChange={(e) => {
                            if (e.target.checked) setPollParticipants([]);
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500/20"
                        />
                        <span className="text-xs text-slate-600">Todos podem votar</span>
                      </label>
                      {allProfiles.map(p => (
                        <label key={p.user_id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            checked={pollParticipants.includes(p.user_id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPollParticipants([...pollParticipants, p.user_id]);
                              } else {
                                setPollParticipants(pollParticipants.filter(id => id !== p.user_id));
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500/20"
                          />
                          <span className="text-xs text-slate-600">{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Feed de Posts */}
          <div className="flex flex-col gap-4 sm:gap-5">
            {/* Filtro do Feed - Estilo LinkedIn */}
            <div className="bg-white rounded-lg border border-slate-200/60 shadow-sm p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-slate-900 font-semibold text-[15px]">Feed</h3>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                    <button
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        feedSortOrder === 'relevant' 
                          ? 'bg-white text-slate-900 shadow-sm' 
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      onClick={() => setFeedSortOrder('relevant')}
                    >
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        Mais Relevantes
                      </span>
                    </button>
                    <button
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        feedSortOrder === 'recent' 
                          ? 'bg-white text-slate-900 shadow-sm' 
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      onClick={() => setFeedSortOrder('recent')}
                    >
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Recentes
                      </span>
                    </button>
                  </div>
                </div>
                {feedTagFilter && (
                  <button
                    onClick={() => setFeedTagFilter(null)}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-sm font-medium hover:bg-blue-100 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    {availableTags.find(t => t.id === feedTagFilter)?.label || feedTagFilter}
                  </button>
                )}
              </div>
            </div>
            {loadingPosts ? (
              <>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-4 flex gap-3">
                      <div className="w-12 h-12 rounded-full bg-slate-200 animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-slate-200 rounded w-32 animate-pulse" />
                        <div className="h-3 bg-slate-100 rounded w-24 animate-pulse" />
                      </div>
                    </div>
                    <div className="px-4 pb-4 space-y-2">
                      <div className="h-4 bg-slate-200 rounded animate-pulse" />
                      <div className="h-4 bg-slate-200 rounded w-3/4 animate-pulse" />
                      <div className="h-4 bg-slate-200 rounded w-1/2 animate-pulse" />
                    </div>
                    <div className="px-4 py-3 border-t border-slate-100 flex gap-4">
                      <div className="h-8 w-20 bg-slate-100 rounded-lg animate-pulse" />
                      <div className="h-8 w-20 bg-slate-100 rounded-lg animate-pulse" />
                      <div className="h-8 w-20 bg-slate-100 rounded-lg animate-pulse" />
                    </div>
                  </div>
                ))}
              </>
            ) : displayedFeedPosts.length === 0 ? (
              <div className="bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-100 shadow-lg shadow-slate-200/40 p-10 text-center">
                <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white mb-5 shadow-lg shadow-blue-500/25">
                  <MessageCircle className="w-10 h-10" />
                </div>
                <p className="text-slate-900 font-bold text-xl">Sem publicações ainda</p>
                <p className="text-sm text-slate-500 mt-3 max-w-md mx-auto leading-relaxed">
                  Use a caixa acima para compartilhar uma atualização. Mencione colegas com <span className="font-semibold text-blue-600">@nome</span> e categorize com tags como <span className="font-semibold text-emerald-600">#financeiro</span> ou <span className="font-semibold text-purple-600">#processo</span>.
                </p>
              </div>
            ) : (
              displayedFeedPosts.map((post) => (
                <div key={post.id} data-post-id={post.id} className="bg-white rounded-lg border border-slate-200/60 shadow-sm hover:shadow-md transition-shadow duration-200">
                  {/* Header do Post */}
                  <div className="p-4 pb-3 flex gap-3">
                    <button 
                      onClick={() => onNavigateToModule?.('perfil', { userId: post.author_id })}
                      className="cursor-pointer hover:scale-105 transition-transform duration-200"
                    >
                      <Avatar src={post.author?.avatar_url} name={post.author?.name || 'Usuário'} size="md" />
                    </button>
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button 
                          onClick={() => onNavigateToModule?.('perfil', { userId: post.author_id })}
                          className="text-slate-900 font-semibold text-[15px] hover:text-blue-600 transition-colors cursor-pointer truncate max-w-[180px] sm:max-w-none"
                        >
                          {post.author?.name || 'Usuário'}
                        </button>
                        <BadgeIcon badge={post.author?.badge} />
                        {/* Badge de visibilidade */}
                        {post.visibility && post.visibility !== 'public' && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold ${
                            post.visibility === 'private' ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-blue-50 text-blue-600 border border-blue-200'
                          }`}>
                            {post.visibility === 'private' ? <Lock className="w-2.5 h-2.5" /> : <Users className="w-2.5 h-2.5" />}
                            {post.visibility === 'private' ? 'Privado' : 'Equipe'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-slate-400 text-xs font-medium">{post.author?.role || 'Membro'}</span>
                        <span className="text-slate-300">•</span>
                        <button 
                          onClick={() => {
                            setSelectedPostId(post.id);
                            setShowPostModal(true);
                          }}
                          className="text-slate-400 text-xs hover:text-blue-500 transition-colors"
                        >
                          {formatTimeAgo(post.created_at)}
                        </button>
                        {post.tags.length > 0 && (
                          <>
                            <span className="text-slate-300">•</span>
                            <div className="flex gap-1">
                              {post.tags.slice(0, 2).map(tag => {
                                const tagConfig = availableTags.find(t => t.id === tag);
                                return tagConfig ? (
                                  <span key={tag} className={`${tagConfig.color} text-[10px] font-bold px-2 py-0.5 rounded-lg`}>
                                    #{tagConfig.label}
                                  </span>
                                ) : null;
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Menu de ações do post (autor ou admin) */}
                    {(user?.id === post.author_id || isAdmin) && (
                      <div className="ml-auto relative">
                        <button 
                          onClick={() => setOpenPostMenu(openPostMenu === post.id ? null : post.id)}
                          className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"
                        >
                          <MoreHorizontal className="w-5 h-5" />
                        </button>
                        {openPostMenu === post.id && (
                          <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20 min-w-[160px]">
                            {/* Opções do autor - não permite editar/excluir posts banidos */}
                            {user?.id === post.author_id && !post.banned_at && (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingPostId(post.id);
                                    setEditingContent(post.content);
                                    setEditingVisibility((post.visibility as 'public' | 'private' | 'team') || 'public');
                                    setEditingAudienceUserIds(post.allowed_user_ids || []);
                                    setEditingAudienceRoles(post.allowed_roles || []);
                                    setEditingAudienceSearch('');
                                    setOpenPostMenu(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                  <Pencil className="w-4 h-4" />
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleDeletePost(post.id)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Excluir
                                </button>
                              </>
                            )}
                            {/* Opções do admin */}
                            {isAdmin && user?.id !== post.author_id && (
                              <>
                                {!post.banned_at ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        await feedPostsService.banPost(post.id);
                                        setFeedPosts(prev => prev.map(p => 
                                          p.id === post.id 
                                            ? { ...p, banned_at: new Date().toISOString(), banned_by: user?.id, banned_by_name: currentProfile?.name || 'Administrador' }
                                            : p
                                        ));
                                        toast.success('Post banido com sucesso');
                                      } catch (err) {
                                        console.error('Erro ao banir post:', err);
                                        toast.error('Erro ao banir post');
                                      }
                                      setOpenPostMenu(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                  >
                                    <Shield className="w-4 h-4" />
                                    Banir Post
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      onClick={async () => {
                                        try {
                                          await feedPostsService.unbanPost(post.id);
                                          setFeedPosts(prev => prev.map(p => 
                                            p.id === post.id 
                                              ? { ...p, banned_at: null, banned_by: null, banned_by_name: undefined }
                                              : p
                                          ));
                                          toast.success('Post desbanido com sucesso');
                                        } catch (err) {
                                          console.error('Erro ao desbanir post:', err);
                                          toast.error('Erro ao desbanir post');
                                        }
                                        setOpenPostMenu(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50"
                                    >
                                      <Shield className="w-4 h-4" />
                                      Desbanir Post
                                    </button>
                                    <button
                                      onClick={async () => {
                                        const confirmed = await confirmDelete({
                                          title: 'Remover Post Banido',
                                          message: 'Tem certeza que deseja remover permanentemente este post banido? Esta ação não pode ser desfeita.',
                                          confirmLabel: 'Remover',
                                          cancelLabel: 'Cancelar',
                                        });
                                        if (!confirmed) return;
                                        
                                        try {
                                          await feedPostsService.deletePost(post.id);
                                          setFeedPosts(prev => prev.filter(p => p.id !== post.id));
                                          setOpenPostMenu(null);
                                          toast.success('Post removido com sucesso');
                                        } catch (err) {
                                          console.error('Erro ao remover post:', err);
                                          toast.error('Erro ao remover post');
                                        }
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      Remover Post
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                            {/* Admin pode banir próprio post também */}
                            {isAdmin && user?.id === post.author_id && (
                              <>
                                <div className="border-t border-slate-100 my-1" />
                                {!post.banned_at ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        await feedPostsService.banPost(post.id);
                                        setFeedPosts(prev => prev.map(p => 
                                          p.id === post.id 
                                            ? { ...p, banned_at: new Date().toISOString(), banned_by: user?.id, banned_by_name: currentProfile?.name || 'Administrador' }
                                            : p
                                        ));
                                        toast.success('Post banido com sucesso');
                                      } catch (err) {
                                        console.error('Erro ao banir post:', err);
                                        toast.error('Erro ao banir post');
                                      }
                                      setOpenPostMenu(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                  >
                                    <Shield className="w-4 h-4" />
                                    Banir Post
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      onClick={async () => {
                                        try {
                                          await feedPostsService.unbanPost(post.id);
                                          setFeedPosts(prev => prev.map(p => 
                                            p.id === post.id 
                                              ? { ...p, banned_at: null, banned_by: null, banned_by_name: undefined }
                                              : p
                                          ));
                                          toast.success('Post desbanido com sucesso');
                                        } catch (err) {
                                          console.error('Erro ao desbanir post:', err);
                                          toast.error('Erro ao desbanir post');
                                        }
                                        setOpenPostMenu(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-600 hover:bg-emerald-50"
                                    >
                                      <Shield className="w-4 h-4" />
                                      Desbanir Post
                                    </button>
                                    <button
                                      onClick={async () => {
                                        const confirmed = await confirmDelete({
                                          title: 'Remover Post Banido',
                                          message: 'Tem certeza que deseja remover permanentemente este post banido? Esta ação não pode ser desfeita.',
                                          confirmLabel: 'Remover',
                                          cancelLabel: 'Cancelar',
                                        });
                                        if (!confirmed) return;
                                        
                                        try {
                                          await feedPostsService.deletePost(post.id);
                                          setFeedPosts(prev => prev.filter(p => p.id !== post.id));
                                          setOpenPostMenu(null);
                                          toast.success('Post removido com sucesso');
                                        } catch (err) {
                                          console.error('Erro ao remover post:', err);
                                          toast.error('Erro ao remover post');
                                        }
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      Remover Post
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Conteúdo do Post */}
                  <div className="px-3 sm:px-4 py-2">
                    {/* Post Banido - Ocultar completamente todo o conteúdo */}
                    {post.banned_at ? (
                      <div className="py-8 flex flex-col items-center justify-center bg-gradient-to-br from-red-50 to-slate-50 rounded-xl border border-red-200/50">
                        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                          <Shield className="w-8 h-8 text-red-500" />
                        </div>
                        <p className="text-red-700 font-bold text-lg">Conteúdo Removido</p>
                        <p className="text-red-500 text-sm mt-1">
                          Este post foi banido por violar as diretrizes da comunidade
                        </p>
                        <p className="text-slate-400 text-xs mt-3">
                          Banido por {post.banned_by_name || 'Administrador'}
                        </p>
                      </div>
                    ) : editingPostId === post.id ? (
                      <div className="bg-slate-50 rounded-xl p-3 border-2 border-slate-200">
                        <div className="relative">
                          <textarea
                            ref={inlineEditRef}
                            value={editingContent}
                            onChange={handleInlineEditChange}
                            rows={4}
                            className="w-full bg-white border-2 border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-500/20 focus:border-slate-400 resize-none"
                            placeholder="Edite seu post... Use @ para mencionar e # para tags"
                          />
                          
                          {/* Dropdown de Menções no Editor Inline */}
                          {showMentionDropdownInline && filteredProfilesInline.length > 0 && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50 max-h-48 overflow-y-auto">
                              <div className="p-2 border-b border-slate-100">
                                <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                                  <AtSign className="w-3 h-3" /> Mencionar usuário
                                </span>
                              </div>
                              {filteredProfilesInline.map((profile) => (
                                <button
                                  key={profile.id}
                                  onClick={() => insertMentionInline(profile)}
                                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                                >
                                  <Avatar src={profile.avatar_url} name={profile.name} size="sm" />
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">{profile.name}</p>
                                    <p className="text-xs text-slate-500">{profile.role}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Dropdown de Tags no Editor Inline */}
                          {showTagDropdownInline && filteredTagsInline.length > 0 && (
                            <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50 max-h-48 overflow-y-auto">
                              <div className="p-2 border-b border-slate-100">
                                <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                                  <Hash className="w-3 h-3" /> Adicionar tag
                                </span>
                              </div>
                              {filteredTagsInline.map((tag: any) => (
                                <button
                                  key={tag.id}
                                  onClick={() => insertTagInline(tag.id)}
                                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                                >
                                  <tag.icon className="w-4 h-4" />
                                  <span className="text-sm font-medium text-slate-900">#{tag.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Visibilidade */}
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <div className="flex items-center gap-1 mb-2">
                            <span className="text-xs font-medium text-slate-500">Visibilidade:</span>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setEditingVisibility('public')}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                                editingVisibility === 'public'
                                  ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500/30'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              <Globe className="w-3.5 h-3.5" />
                              Público
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingVisibility('team')}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                                editingVisibility === 'team'
                                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500/30'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              <Users className="w-3.5 h-3.5" />
                              Equipe
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingVisibility('private')}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                                editingVisibility === 'private'
                                  ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-500/30'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              <Lock className="w-3.5 h-3.5" />
                              Privado
                            </button>
                          </div>
                        </div>

                        {/* Seleção de Destinatários (para privado/equipe) */}
                        {editingVisibility !== 'public' && (
                          <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200">
                            <p className="text-xs font-semibold text-slate-700 mb-2">
                              Selecione os destinatários:
                            </p>
                            
                            {/* Cargos/Departamentos */}
                            <div className="mb-2">
                              <p className="text-[10px] text-slate-500 mb-1">Por cargo/departamento:</p>
                              <div className="flex flex-wrap gap-1">
                                {availableAudienceRoles.map((role) => (
                                  <button
                                    key={role}
                                    type="button"
                                    onClick={() => {
                                      setEditingAudienceRoles((prev) =>
                                        prev.includes(role)
                                          ? prev.filter((r) => r !== role)
                                          : [...prev, role]
                                      );
                                    }}
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                                      editingAudienceRoles.includes(role)
                                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-400'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    {role}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Pessoas específicas */}
                            <div>
                              <p className="text-[10px] text-slate-500 mb-1">Pessoas específicas:</p>
                              <input
                                type="text"
                                value={editingAudienceSearch}
                                onChange={(e) => setEditingAudienceSearch(e.target.value)}
                                placeholder="Buscar pessoa..."
                                className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg mb-1"
                              />
                              <div className="max-h-24 overflow-y-auto space-y-0.5">
                                {filteredEditingAudienceProfiles.slice(0, 10).map((profile) => (
                                  <button
                                    key={profile.user_id}
                                    type="button"
                                    onClick={() => {
                                      setEditingAudienceUserIds((prev) =>
                                        prev.includes(profile.user_id)
                                          ? prev.filter((id) => id !== profile.user_id)
                                          : [...prev, profile.user_id]
                                      );
                                    }}
                                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left transition-all ${
                                      editingAudienceUserIds.includes(profile.user_id)
                                        ? 'bg-emerald-50 ring-1 ring-emerald-400'
                                        : 'hover:bg-slate-50'
                                    }`}
                                  >
                                    <Avatar src={profile.avatar_url} name={profile.name} size="xs" />
                                    <span className="text-xs text-slate-700 truncate">{profile.name}</span>
                                    {editingAudienceUserIds.includes(profile.user_id) && (
                                      <Check className="w-3 h-3 text-emerald-600 ml-auto" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Resumo */}
                            {(editingAudienceUserIds.length > 0 || editingAudienceRoles.length > 0) && (
                              <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500">
                                {editingAudienceRoles.length > 0 && (
                                  <span>Cargos: {editingAudienceRoles.join(', ')}</span>
                                )}
                                {editingAudienceRoles.length > 0 && editingAudienceUserIds.length > 0 && ' • '}
                                {editingAudienceUserIds.length > 0 && (
                                  <span>{editingAudienceUserIds.length} pessoa(s)</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2 mt-3">
                          <button
                            onClick={handleCancelEdit}
                            className="px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 text-sm font-medium transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleSaveEdit(post.id)}
                            className="px-4 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium transition-colors shadow-sm"
                          >
                            Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-slate-900 text-[15px] leading-[1.4] mb-3 whitespace-pre-wrap break-words">
                          {renderContentWithMentions(post.content, post.entity_references)}
                        </div>
                        {post.created_at !== post.updated_at && (
                          <div className="flex items-center gap-1 text-xs text-slate-400 mb-3">
                            <Pencil className="w-3 h-3" />
                            <span>editado</span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Enquete - só mostra se post não está banido */}
                    {!post.banned_at && postPolls.has(post.id) && (() => {
                      const poll = postPolls.get(post.id)!;
                      const totalVotes = poll.total_votes || 0;
                      return (
                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100 mb-3">
                          <div className="flex items-center gap-2 mb-3">
                            <BarChart2 className="w-5 h-5 text-indigo-600" />
                            <span className="font-bold text-indigo-900">{poll.question}</span>
                          </div>
                          
                          <div className="space-y-2">
                            {poll.options.map((opt, idx) => {
                              const percentage = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                              const hasVoted = poll.user_votes?.includes(idx);
                              const canVote = !poll.is_expired && (poll.participants.length === 0 || poll.participants.includes(user?.id || ''));
                              const isMultiple = poll.allow_multiple;
                              
                              return (
                                <button
                                  key={idx}
                                  onClick={() => canVote && handlePollVote(poll.id, idx)}
                                  disabled={!canVote || (hasVoted && !isMultiple)}
                                  className={`w-full relative overflow-hidden rounded-lg border transition-all ${
                                    hasVoted 
                                      ? 'border-indigo-400 bg-indigo-50' 
                                      : canVote 
                                        ? 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50 cursor-pointer' 
                                        : 'border-slate-200 bg-slate-50 cursor-not-allowed'
                                  }`}
                                >
                                  {/* Barra de progresso */}
                                  <div 
                                    className={`absolute inset-y-0 left-0 transition-all ${hasVoted ? 'bg-indigo-200' : 'bg-slate-100'}`}
                                    style={{ width: `${percentage}%` }}
                                  />
                                  
                                  <div className="relative flex items-center justify-between px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                      {/* Checkbox para múltiplas, Radio para única */}
                                      <span className={`w-5 h-5 ${isMultiple ? 'rounded-md' : 'rounded-full'} border-2 flex items-center justify-center ${
                                        hasVoted ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'
                                      }`}>
                                        {hasVoted && <CheckCircle className="w-3 h-3 text-white" />}
                                      </span>
                                      <span className={`text-sm font-medium ${hasVoted ? 'text-indigo-900' : 'text-slate-700'}`}>
                                        {opt.text}
                                      </span>
                                    </div>
                                    <span className={`text-sm font-bold ${hasVoted ? 'text-indigo-600' : 'text-slate-500'}`}>
                                      {percentage}%
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                          
                          <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
                            {totalVotes > 0 ? (
                              <button
                                type="button"
                                onClick={() => openPollVotersModal(poll.id)}
                                className="hover:underline font-medium"
                              >
                                {totalVotes} voto{totalVotes !== 1 ? 's' : ''}
                              </button>
                            ) : (
                              <span>{totalVotes} voto{totalVotes !== 1 ? 's' : ''}</span>
                            )}
                            {poll.expires_at && (
                              <span className={poll.is_expired ? 'text-red-500' : ''}>
                                {poll.is_expired ? 'Encerrada' : `Encerra ${formatTimeUntil(poll.expires_at)}`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Imagens estilo Instagram - só mostra se post não está banido */}
                    {!post.banned_at && post.attachments && post.attachments.length > 0 && (() => {
                      const images = post.attachments.filter((a) => a.kind === 'image' && a.signedUrl && a.signedUrl.trim() !== '');
                      if (images.length === 0) return null;
                      
                      return (
                        <div className="-mx-4 mb-3">
                          {images.length === 1 ? (
                            // Uma imagem: ocupa toda a largura
                            <button
                              onClick={() => openImageGallery(post.attachments || [], 0)}
                              className="w-full block cursor-pointer"
                            >
                              <img
                                src={images[0].signedUrl || ''}
                                className="w-full max-h-[500px] object-cover"
                                alt={images[0].fileName}
                              />
                            </button>
                          ) : (
                            // Múltiplas imagens: grid estilo Instagram
                            <div className={`grid gap-0.5 ${images.length === 2 ? 'grid-cols-2' : images.length === 3 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                              {images.slice(0, 4).map((a, idx) => (
                                <button
                                  key={a.filePath}
                                  onClick={() => openImageGallery(post.attachments || [], idx)}
                                  className={`relative block cursor-pointer overflow-hidden ${
                                    images.length === 3 && idx === 0 ? 'row-span-2' : ''
                                  }`}
                                >
                                  <img
                                    src={a.signedUrl || ''}
                                    className={`w-full object-cover ${
                                      images.length === 3 && idx === 0 ? 'h-full' : 'h-48'
                                    }`}
                                    alt={a.fileName}
                                  />
                                  {/* Overlay para +N imagens */}
                                  {idx === 3 && images.length > 4 && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                      <span className="text-white text-2xl font-bold">+{images.length - 4}</span>
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    
                    {/* Cards de Preview de Dados - só mostra se post não está banido */}
                    {!post.banned_at && post.preview_data && Object.keys(post.preview_data).length > 0 && (
                      <div className="space-y-2">
                        {/* Preview Financeiro */}
                        {post.preview_data.financeiro && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-emerald-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const agreementId = post.entity_references?.find((e) => e.type === 'financial')?.id;
                              if (agreementId) {
                                handleNavigate('financeiro', { entityId: agreementId });
                                return;
                              }
                              handleNavigate('financeiro');
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2">
                                <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                                  <DollarSign className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">Resumo Financeiro</p>
                                  <p className="text-slate-500 text-xs">Clique para ver detalhes</p>
                                </div>
                              </div>
                              <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                                Financeiro
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                                <p className="text-slate-500 text-[10px] font-medium">Recebido</p>
                                <p className="text-emerald-600 font-bold text-sm">{formatCurrency(post.preview_data.financeiro.recebido)}</p>
                              </div>
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                                <p className="text-slate-500 text-[10px] font-medium">Pendente</p>
                                <p className="text-amber-600 font-bold text-sm">{formatCurrency(post.preview_data.financeiro.pendente)}</p>
                              </div>
                              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                                <p className="text-slate-500 text-[10px] font-medium">Atrasado</p>
                                <p className="text-red-600 font-bold text-sm">{formatCurrency(post.preview_data.financeiro.atrasado)}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Cliente */}
                        {post.preview_data.cliente && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-blue-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const clientId = post.preview_data?.cliente?.id;
                              if (clientId) {
                                handleNavigate('clientes', { mode: 'details', entityId: clientId });
                                return;
                              }
                              handleNavigate('clientes');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700">
                                <Users className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.cliente.nome}</p>
                                <p className="text-slate-500 text-xs">{post.preview_data.cliente.cpf || post.preview_data.cliente.telefone || 'Cliente'}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Processo */}
                        {post.preview_data.processo && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-indigo-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const processId = post.preview_data?.processo?.id;
                              if (processId) {
                                handleNavigate('processos', { entityId: processId });
                                return;
                              }
                              handleNavigate('processos');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700">
                                <Gavel className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.processo.numero}</p>
                                <p className="text-slate-500 text-xs">{post.preview_data.processo.cliente} • {post.preview_data.processo.status}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Prazo */}
                        {post.preview_data.prazo && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-red-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const deadlineId = post.preview_data?.prazo?.id;
                              if (deadlineId) {
                                handleNavigate('prazos', { entityId: deadlineId });
                                return;
                              }
                              handleNavigate('prazos');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center text-red-700">
                                <Clock className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.prazo.titulo}</p>
                                <p className="text-slate-500 text-xs">{post.preview_data.prazo.data} • {post.preview_data.prazo.tipo}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Agenda */}
                        {post.preview_data.agenda && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-amber-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const calendarEventId = post.preview_data?.agenda?.id;
                              if (calendarEventId) {
                                handleNavigate('agenda', { entityId: calendarEventId });
                                return;
                              }
                              handleNavigate('agenda');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center text-amber-700">
                                <Calendar className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.agenda.titulo}</p>
                                <p className="text-slate-500 text-xs">{post.preview_data.agenda.data} {post.preview_data.agenda.hora && `às ${post.preview_data.agenda.hora}`}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Documento */}
                        {post.preview_data.documento && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-indigo-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const docId = post.preview_data?.documento?.id;
                              if (docId) {
                                handleNavigate('documentos', { entityId: docId });
                                return;
                              }
                              handleNavigate('documentos');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-700">
                                <FileText className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.documento.nome}</p>
                                <p className="text-slate-500 text-xs">{post.preview_data.documento.tipo || 'Documento'}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Petição */}
                        {post.preview_data.peticao && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-cyan-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const petId = post.preview_data?.peticao?.id;
                              if (petId) {
                                handleNavigate('peticoes', { entityId: petId });
                                return;
                              }
                              handleNavigate('peticoes');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-cyan-100 rounded-lg flex items-center justify-center text-cyan-700">
                                <ScrollText className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.peticao.nome}</p>
                                <p className="text-slate-500 text-xs">{post.preview_data.peticao.tipo || 'Petição'}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Assinatura */}
                        {post.preview_data.assinatura && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-pink-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const requestId = post.preview_data?.assinatura?.id;
                              if (requestId) {
                                handleNavigate('assinaturas', { mode: 'details', requestId });
                                return;
                              }
                              handleNavigate('assinaturas');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-pink-100 rounded-lg flex items-center justify-center text-pink-700">
                                <Pencil className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.assinatura.nome}</p>
                                <p className="text-slate-500 text-xs">
                                  {post.preview_data.assinatura.cliente || 'Assinatura'} • {post.preview_data.assinatura.status === 'signed' ? 'Assinado' : 'Pendente'}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Requerimento */}
                        {post.preview_data.requerimento && (
                          <div 
                            className="bg-white border border-slate-200 border-l-4 border-l-orange-500 rounded-lg p-3 cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            onClick={() => {
                              const reqId = post.preview_data?.requerimento?.id;
                              if (reqId) {
                                handleNavigate('requerimentos', { entityId: reqId });
                                return;
                              }
                              handleNavigate('requerimentos');
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-orange-100 rounded-lg flex items-center justify-center text-orange-700">
                                <Briefcase className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm">{post.preview_data.requerimento.protocolo || post.preview_data.requerimento.beneficiario}</p>
                                <p className="text-slate-500 text-xs">
                                  {post.preview_data.requerimento.beneficiario} • {post.preview_data.requerimento.tipo || post.preview_data.requerimento.status || 'Requerimento'}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Contadores - Estilo LinkedIn */}
                  <div className="px-4 py-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1">
                        {postReactions[post.id]?.type === 'love' ? (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-red-500 to-pink-500 border-2 border-white flex items-center justify-center">
                            <Heart className="w-2.5 h-2.5 text-white" />
                          </div>
                        ) : postReactions[post.id]?.type === 'haha' ? (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 border-2 border-white flex items-center justify-center">
                            <span className="text-white text-[10px] font-bold">😂</span>
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 border-2 border-white flex items-center justify-center">
                            <ThumbsUp className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                        {post.likes_count > 5 && (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-red-500 to-pink-500 border-2 border-white flex items-center justify-center">
                            <Heart className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </div>
                      <span className="hover:underline cursor-pointer text-slate-600 font-medium">
                        {post.likes_count > 0 ? `${post.likes_count}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleInlineComments(post.id)}
                      className="hover:underline cursor-pointer text-slate-500 hover:text-blue-600 transition-colors"
                    >
                      {post.comments_count > 0 && `${post.comments_count} comentário${post.comments_count !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                  
                  {/* Ações - Estilo LinkedIn/Facebook */}
                  <div className="flex items-center justify-around py-2 border-t border-slate-100">
                    <div className="relative group/reaction">
                      <button
                        onClick={() => handleReaction(post.id, 'like')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                          postReactions[post.id]?.type === 'like'
                            ? 'text-blue-600 hover:bg-blue-50'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <ThumbsUp className={`w-4 h-4 ${postReactions[post.id]?.type === 'like' ? 'fill-current' : ''}`} />
                        <span>Curtir</span>
                      </button>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-lg shadow-lg border border-slate-200 p-1 opacity-0 invisible group-hover/reaction:opacity-100 group-hover/reaction:visible transition-all z-10">
                        <div className="flex gap-1">
                          {[
                            { type: 'like', icon: ThumbsUp, label: 'Curtir' },
                            { type: 'love', icon: Heart, label: 'Amei' },
                            { type: 'haha', icon: () => <span className="text-sm">😂</span>, label: 'Haha' },
                          ].map(({ type, icon: Icon, label }) => (
                            <button
                              key={type}
                              onClick={() => handleReaction(post.id, type as any)}
                              className="p-2 hover:bg-slate-100 rounded transition-colors"
                              title={label}
                            >
                              {typeof Icon === 'function' ? <Icon /> : <Icon className="w-4 h-4" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleInlineComments(post.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        expandedComments[post.id]
                          ? 'text-blue-600 hover:bg-blue-50'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>Comentar</span>
                    </button>
                    <button
                      onClick={() => sharePost(post.id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                      <span>Compartilhar</span>
                    </button>
                    <button
                      onClick={() => toggleSavePost(post.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        savedPosts.has(post.id)
                          ? 'text-amber-600 hover:bg-amber-50'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Bookmark className={`w-4 h-4 ${savedPosts.has(post.id) ? 'fill-current' : ''}`} />
                      <span>Salvar</span>
                    </button>
                  </div>
                  
                  {/* Seção de comentários inline - Design Premium */}
                  {expandedComments[post.id] && (
                    <div className="border-t border-slate-100 overflow-visible bg-gradient-to-b from-slate-50/50 to-white">
                      {/* Lista de comentários */}
                      <div className="px-5 py-4 space-y-4 max-h-72 overflow-y-auto overflow-x-visible">
                        {expandedComments[post.id].loading ? (
                          <div className="flex items-center justify-center py-6">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                              <Loader2 className="w-4 h-4 text-white animate-spin" />
                            </div>
                          </div>
                        ) : expandedComments[post.id].comments.length === 0 ? (
                          <div className="text-center py-4">
                            <MessageCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                            <p className="text-slate-400 text-sm font-medium">Seja o primeiro a comentar!</p>
                          </div>
                        ) : (
                          expandedComments[post.id].comments.map((c, idx) => (
                            <div key={`${c.user_id}-${idx}`} className="flex gap-3 group">
                              <button
                                onClick={() => handleNavigate('perfil', { userId: c.user_id })}
                                className="flex-shrink-0 hover:scale-105 transition-transform"
                              >
                                <Avatar src={c.avatar_url} name={c.name} size="sm" />
                              </button>
                              <div className="flex-1">
                                <div className="bg-slate-100/80 rounded-2xl px-4 py-2.5 hover:bg-slate-100 transition-colors">
                                  <button
                                    onClick={() => handleNavigate('perfil', { userId: c.user_id })}
                                    className="text-[13px] font-bold text-slate-900 hover:text-blue-600 transition-colors"
                                  >
                                    {c.name}
                                  </button>
                                  <p className="text-sm text-slate-700 leading-relaxed">{renderContentWithMentions(c.content)}</p>
                                </div>
                                {/* Ações do comentário */}
                                <div className="flex items-center gap-3 mt-1 ml-2">
                                  <span className="text-[10px] text-slate-400">
                                    {new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <button 
                                    onClick={() => {
                                      setExpandedComments(prev => ({
                                        ...prev,
                                        [post.id]: { ...prev[post.id], newComment: `@${c.name} ` }
                                      }));
                                    }}
                                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                                  >
                                    Responder
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      
                      {/* Input para novo comentário */}
                      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                        <div className="flex gap-2 items-center">
                          <Avatar src={resolvedCurrentAvatarUrl} name={currentProfile?.name || 'Você'} size="xs" />
                          <div className="flex-1">
                            <input
                              type="text"
                              value={expandedComments[post.id]?.newComment || ''}
                              onChange={(e) => handleCommentInputChange(post.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleCreateInlineComment(post.id);
                                }
                              }}
                              placeholder={`Comente como ${currentProfile?.name || 'você'}... Use @ para mencionar`}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                              disabled={expandedComments[post.id]?.submitting}
                            />
                          </div>
                          {expandedComments[post.id]?.submitting && (
                            <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                          )}
                        </div>
                      </div>
                      
                      {/* Dropdown de Menções no Comentário - fora do container com overflow */}
                      {expandedComments[post.id]?.showMentionDropdown && allProfiles.length > 0 && (
                        <div className="px-4 pb-2">
                          <div className="bg-white rounded-lg border border-slate-200 shadow-lg max-h-48 overflow-y-auto">
                            <div className="p-2 border-b border-slate-100">
                              <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                                <AtSign className="w-3 h-3" /> Mencionar usuário
                              </span>
                            </div>
                            {allProfiles
                              .filter(p => {
                                const search = (expandedComments[post.id]?.mentionSearch || '').toLowerCase();
                                return search === '' || p.name.toLowerCase().includes(search);
                              })
                              .slice(0, 10)
                              .map((profile) => (
                                <button
                                  key={profile.id}
                                  onClick={() => handleSelectCommentMention(post.id, profile)}
                                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                                >
                                  <Avatar src={profile.avatar_url} name={profile.name} size="sm" />
                                  <div>
                                    <p className="text-sm font-medium text-slate-900">{profile.name}</p>
                                    <p className="text-xs text-slate-500">{profile.role}</p>
                                  </div>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </main>

            {/* Sidebar Direita */}
            <aside className="hidden lg:block">
              <div className="sticky top-4 space-y-4">
                <SidebarDroppable id="right-sidebar">
                  <SortableContext items={visibleRightWidgets} strategy={rectSortingStrategy}>
                    {visibleRightWidgets.map((id) => (
                      <SortableWidget key={id} id={id}>
                        {renderWidget(id)}
                      </SortableWidget>
                    ))}
                  </SortableContext>
                </SidebarDroppable>
              </div>
            </aside>
          </div>

          <DragOverlay>
            {activeWidgetId ? <div className="w-[320px]">{renderWidget(activeWidgetId)}</div> : null}
          </DragOverlay>
        </DndContext>
      </div>

    {/* Modal do Acordo Financeiro */}
    {showFinancialModal && selectedFinancialAgreementId && (
      <FinancialModal
        agreementId={selectedFinancialAgreementId!}
        onClose={handleCloseFinancialModal}
      />
    )}

    {/* Modal de galeria de imagens - estilo Instagram */}
    {imageGalleryModal.open && (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        onClick={closeImageGallery}
      >
        <div 
          className="relative max-w-lg w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Botão fechar */}
          <button 
            onClick={closeImageGallery} 
            className="absolute -top-10 right-0 text-white/80 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
          
          {/* Imagem */}
          <div className="relative">
            {imageGalleryModal.images.length > 1 && (
              <button
                onClick={prevImage}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-all"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <img
              src={imageGalleryModal.images[imageGalleryModal.currentIndex]?.url}
              alt={imageGalleryModal.images[imageGalleryModal.currentIndex]?.fileName}
              className="w-full max-h-[70vh] object-contain rounded-lg"
            />
            {imageGalleryModal.images.length > 1 && (
              <button
                onClick={nextImage}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-all"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
            
            {/* Contador */}
            {imageGalleryModal.images.length > 1 && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                {imageGalleryModal.currentIndex + 1} / {imageGalleryModal.images.length}
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Modal de quem curtiu/comentou */}
    {interactionModal.open && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h3 className="font-bold text-slate-900">
              {interactionModal.type === 'likes' ? 'Curtidas' : 'Comentários'}
            </h3>
            <button onClick={closeInteractionModal} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {interactionModal.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            ) : interactionModal.type === 'likes' ? (
              interactionModal.users.length === 0 ? (
                <p className="text-slate-500 text-center py-8">Ninguém curtiu ainda.</p>
              ) : (
                <div className="space-y-3">
                  {interactionModal.users.map((u) => (
                    <div
                      key={u.user_id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                      onClick={() => {
                        handleNavigate('perfil', { userId: u.user_id });
                        closeInteractionModal();
                      }}
                    >
                      <Avatar src={u.avatar_url} name={u.name} size="sm" />
                      <span className="text-sm font-medium text-slate-900">{u.name}</span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-4">
                {interactionModal.users.length === 0 ? (
                  <p className="text-slate-500 text-center py-4">Seja o primeiro a comentar!</p>
                ) : (
                  <div className="space-y-3">
                    {interactionModal.users.map((u, idx) => (
                      <div key={`${u.user_id}-${idx}`} className="flex gap-3">
                        <div 
                          className="cursor-pointer"
                          onClick={() => {
                            handleNavigate('perfil', { userId: u.user_id });
                            closeInteractionModal();
                          }}
                        >
                          <Avatar src={u.avatar_url} name={u.name} size="sm" />
                        </div>
                        <div className="flex-1 bg-slate-100 rounded-xl px-3 py-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span 
                              className="text-sm font-semibold text-slate-900 cursor-pointer hover:underline"
                              onClick={() => {
                                handleNavigate('perfil', { userId: u.user_id });
                                closeInteractionModal();
                              }}
                            >
                              {u.name}
                            </span>
                            {u.created_at && (
                              <span className="text-xs text-slate-400">
                                {new Date(u.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-700">{u.content ? renderContentWithMentions(u.content) : ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Input para novo comentário */}
          {interactionModal.type === 'comments' && (
            <div className="p-4 border-t border-slate-200 bg-slate-50">
              <div className="flex gap-3">
                <Avatar src={resolvedCurrentAvatarUrl} name={currentProfile?.name || 'Você'} size="sm" />
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={interactionModal.newComment}
                    onChange={(e) => setInteractionModal(prev => ({ ...prev, newComment: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleCreateComment();
                      }
                    }}
                    placeholder="Escreva um comentário..."
                    className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400"
                    disabled={interactionModal.submitting}
                  />
                  <button
                    onClick={handleCreateComment}
                    disabled={!interactionModal.newComment.trim() || interactionModal.submitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-full text-sm font-medium transition-colors"
                  >
                    {interactionModal.submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Modal: Quem votou na enquete */}
    {pollVotersModal.open && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closePollVotersModal}>
        <div
          className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 truncate">Quem votou</h3>
              {pollForVotersModal?.question && (
                <p className="text-xs text-slate-500 truncate">{pollForVotersModal.question}</p>
              )}
            </div>
            <button onClick={closePollVotersModal} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {pollVotersModal.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            ) : pollVotersModal.voters.length === 0 ? (
              <p className="text-slate-500 text-center py-8">Ainda não há votos.</p>
            ) : (
              <div className="space-y-3">
                {pollVotersModal.voters.map((v) => {
                  const labels = (v.option_indices || [])
                    .map((idx) => pollForVotersModal?.options?.[idx]?.text)
                    .filter(Boolean) as string[];

                  return (
                    <div
                      key={v.user_id}
                      className="flex items-start gap-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer"
                      onClick={() => {
                        handleNavigate('perfil', { userId: v.user_id });
                        closePollVotersModal();
                      }}
                    >
                      <Avatar src={v.avatar_url || undefined} name={v.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 truncate">{v.name}</p>
                          {v.role && <span className="text-[10px] text-slate-500 truncate">{v.role}</span>}
                        </div>
                        {labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {labels.map((label, i) => (
                              <span
                                key={`${v.user_id}-${i}`}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Modal do Post Individual (estilo Facebook) */}
    {showPostModal && selectedPostId && (
      <PostModal
        postId={selectedPostId}
        isOpen={showPostModal}
        initialPost={feedPosts.find(p => p.id === selectedPostId) || null}
        onClose={() => {
          setShowPostModal(false);
          setSelectedPostId(null);
        }}
        onNavigateToProfile={(userId) => {
          setShowPostModal(false);
          setSelectedPostId(null);
          handleNavigate('perfil', { userId });
        }}
        onBackToFeed={() => {
          setShowPostModal(false);
          setSelectedPostId(null);
        }}
      />
    )}
    </div>
  );
};

export default Feed;
