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
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
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
import { feedPollsService, type FeedPoll } from '../services/feedPolls.service';
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
import { supabase } from '../config/supabase';
import { userNotificationService } from '../services/userNotification.service';

interface DashboardProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, string>) => void;
  params?: Record<string, string>;
}

// Cache keys e configuração
const DASHBOARD_CACHE_KEY = 'crm-dashboard-social-cache';
const DASHBOARD_CACHE_VERSION = 1;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutos
const REQUEST_TIMEOUT_MS = 15000;

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
    <div className="flex flex-col items-center justify-center min-w-[50px] bg-slate-100 rounded-lg py-2 px-1">
      <span className={`text-[10px] font-bold uppercase ${isToday ? 'text-red-500' : 'text-slate-500'}`}>
        {dateLabel}
      </span>
      <span className="text-lg font-bold text-slate-900 leading-none">{time}</span>
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
  type: 'agenda' | 'tarefas' | 'djen' | 'confeccao' | 'financeiro' | 'navegacao';
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

const Dashboard: React.FC<DashboardProps> = ({ onNavigateToModule, params }) => {
  const { user } = useAuth();
  const { confirmDelete } = useDeleteConfirm();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [djenIntimacoes, setDjenIntimacoes] = useState<DjenComunicacaoLocal[]>([]);
  const [financialStats, setFinancialStats] = useState<FinancialStats | null>(null);
  const [requirementsAwaiting, setRequirementsAwaiting] = useState<Requirement[]>([]);
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
  
  // Feed posts state
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postingInProgress, setPostingInProgress] = useState(false);
  const [openPostMenu, setOpenPostMenu] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const inlineEditRef = useRef<HTMLTextAreaElement | null>(null);
  const [showMentionDropdownInline, setShowMentionDropdownInline] = useState(false);
  const [showTagDropdownInline, setShowTagDropdownInline] = useState(false);
  const [inlineMentionQuery, setInlineMentionQuery] = useState('');
  const [inlineTagQuery, setInlineTagQuery] = useState('');
  
  // Estado para comentários inline (expandidos abaixo do post)
  const [expandedComments, setExpandedComments] = useState<Record<string, {
    comments: Array<{ user_id: string; name: string; avatar_url?: string; content: string; created_at: string }>;
    loading: boolean;
    newComment: string;
    submitting: boolean;
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
  
  // Modal do acordo financeiro
  const [showFinancialModal, setShowFinancialModal] = useState(false);
  const [selectedFinancialAgreementId, setSelectedFinancialAgreementId] = useState<string | null>(null);
  
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
  
  // Widget order state
  const [leftWidgets, setLeftWidgets] = useState<string[]>(['agenda', 'tarefas', 'djen', 'confeccao']);
  const [rightWidgets, setRightWidgets] = useState<string[]>(['financeiro', 'prazos', 'navegacao']);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [imageGalleryModal, setImageGalleryModal] = useState<{
    open: boolean;
    images: Array<{ url: string; fileName: string }>;
    currentIndex: number;
  }>({ open: false, images: [], currentIndex: 0 });
  
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
        setLoading(true);

        // Carregar perfil do usuário
        if (user?.id && !currentProfile) {
          const profile = await profileService.getProfile(user.id);
          setCurrentProfile(profile);
        }

        // Tentar carregar do cache primeiro
        if (!forceRefresh) {
          const cachedData = localStorage.getItem(DASHBOARD_CACHE_KEY);
          if (cachedData) {
            try {
              const cache: DashboardCache = JSON.parse(cachedData);
              const now = Date.now();
              const cacheValid =
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

              if (cacheValid && now - cache.timestamp < CACHE_DURATION) {
                console.log('📊 Dashboard Social: carregando do cache');
                setClients(cache.data.clients);
                setProcesses(cache.data.processes);
                setDeadlines(cache.data.deadlines);
                setTasks(cache.data.tasks);
                setCalendarEvents(cache.data.calendarEvents);
                setDjenIntimacoes(cache.data.djenIntimacoes);
                setFinancialStats(cache.data.financialStats);
                setRequirementsAwaiting(cache.data.requirementsAwaiting);
                setLoading(false);
                return;
              }
            } catch {
              console.warn('Cache inválido, recarregando dados');
            }
          }
        }

        console.log('📊 Dashboard Social: carregando da API');

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
    [safeFetch, user?.id, currentProfile]
  );

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

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
          setLeftWidgets(preferences.left_widgets);
          setRightWidgets(preferences.right_widgets);
        }
        setPreferencesLoaded(true);
      } catch (error) {
        console.warn('Erro ao carregar preferências do dashboard:', error);
        setPreferencesLoaded(true);
      }
    };
    loadPreferences();
  }, [user?.id]);

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
    const newText = postText.slice(0, lastAtIndex) + `@${profile.name} `;
    setPostText(newText);
    setShowMentionDropdown(false);
    postInputRef.current?.focus();
  };

  // Inserir tag no texto
  const insertTag = (tagId: string) => {
    const lastHashIndex = postText.lastIndexOf('#');
    const newText = postText.slice(0, lastHashIndex) + `#${tagId} `;
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

  // Carregar posts do feed
  const loadFeedPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const posts = await feedPostsService.getPosts(20, 0);
      setFeedPosts(posts);
      // Carregar enquetes dos posts
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
    } catch (error) {
      console.error('Erro ao carregar posts:', error);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

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
      // Extrair menções do texto (@nome) - suporta acentos e nomes compostos
      const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
      const mentionMatches: string[] = [];
      let match;
      while ((match = mentionRegex.exec(postText)) !== null) {
        mentionMatches.push(match[1].toLowerCase());
      }
      
      // Buscar user_id dos perfis mencionados pelo nome
      const mentionedIds = allProfiles
        .filter(p => {
          const profileName = p.name?.toLowerCase() || '';
          return mentionMatches.some(mentioned => profileName === mentioned || profileName.includes(mentioned));
        })
        .map(p => p.user_id);
      
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
      
      const newPost = await feedPostsService.createPost({
        content: postContent,
        tags: selectedTags,
        mentions: mentionedIds,
        entity_references: selectedEntities,
        preview_data: finalPreviewData,
        attachments: pendingAttachments.map((p) => p.attachment)
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
      }
      
      // Adicionar post ao início da lista
      setFeedPosts(prev => [newPost, ...prev]);
      
      // Limpar formulário
      setPostText('');
      setSelectedTags([]);
      setSelectedEntities([]);
      setPreviewData({});
      pendingAttachments.forEach((p) => {
        try {
          URL.revokeObjectURL(p.localUrl);
        } catch {}
      });
      setPendingAttachments([]);
      
      // Limpar enquete
      setShowPollCreator(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollAllowMultiple(true);
      setPollExpiresIn('24h');
      setPollParticipants([]);
    } catch (error) {
      console.error('Erro ao publicar post:', error);
    } finally {
      setPostingInProgress(false);
    }
  }, [postText, selectedTags, selectedEntities, previewData, allProfiles, postingInProgress, pendingAttachments, showPollCreator, pollQuestion, pollOptions, pollAllowMultiple, pollExpiresIn, pollParticipants, calculatePollExpiration]);

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

  // Dar/remover like
  const handleToggleLike = useCallback(async (postId: string, currentlyLiked: boolean) => {
    try {
      if (currentlyLiked) {
        await feedPostsService.unlikePost(postId);
      } else {
        await feedPostsService.likePost(postId);
        
        // Notificar o autor do post (se não for o próprio usuário)
        const post = feedPosts.find(p => p.id === postId);
        if (post && post.author_id !== user?.id && currentProfile?.name) {
          try {
            await userNotificationService.createNotification({
              user_id: post.author_id,
              type: 'feed_like',
              title: `${currentProfile.name} curtiu sua publicação`,
              message: post.content.substring(0, 100) + (post.content.length > 100 ? '...' : ''),
              metadata: { post_id: postId }
            });
          } catch (notifError) {
            console.error('Erro ao criar notificação de curtida:', notifError);
          }
        }
      }
      // Atualizar estado local
      setFeedPosts(prev => prev.map(p => {
        if (p.id === postId) {
          return {
            ...p,
            liked_by_me: !currentlyLiked,
            likes_count: currentlyLiked ? p.likes_count - 1 : p.likes_count + 1
          };
        }
        return p;
      }));
    } catch (error) {
      console.error('Erro ao dar/remover like:', error);
    }
  }, [feedPosts, user?.id, currentProfile?.name]);

  // Salvar edição de post
  const handleSaveEdit = useCallback(async (postId: string) => {
    if (!editingContent.trim()) return;
    try {
      const updatedPost = await feedPostsService.updatePost(postId, { content: editingContent.trim() });
      setFeedPosts(prev => prev.map(p => p.id === postId ? updatedPost : p));
      setEditingPostId(null);
      setEditingContent('');
    } catch (error) {
      console.error('Erro ao salvar edição:', error);
    }
  }, [editingContent]);

  // Cancelar edição
  const handleCancelEdit = useCallback(() => {
    setEditingPostId(null);
    setEditingContent('');
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
        [postId]: { comments: [], loading: true, newComment: '', submitting: false }
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
          [postId]: { ...prev[postId], comments: mappedComments, loading: false }
        }));
      } catch (error) {
        console.error('Erro ao carregar comentários:', error);
        setExpandedComments(prev => ({
          ...prev,
          [postId]: { ...prev[postId], loading: false }
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
          submitting: false
        }
      }));
      // Atualizar contador
      setFeedPosts(prev => prev.map(p => 
        p.id === postId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p
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
    } catch (error) {
      console.error('Erro ao criar comentário:', error);
      setExpandedComments(prev => ({
        ...prev,
        [postId]: { ...prev[postId], submitting: false }
      }));
    }
  }, [expandedComments, feedPosts, user?.id, currentProfile?.name]);

  // Renderizar conteúdo com menções em azul e referências financeiras clicáveis
  const renderContentWithMentions = useCallback((content: string, entityReferences?: EntityReference[]) => {
    // Regex para encontrar menções @nome - suporta acentos e caracteres Unicode
    const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    // Processar menções
    while ((match = mentionRegex.exec(content)) !== null) {
      // Adicionar texto antes da menção
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      // Adicionar menção estilizada em azul - clicável para ir ao perfil
      const mentionName = match[1];
      const mentionedProfile = allProfiles.find(p => p.name.toLowerCase() === mentionName.toLowerCase());
      parts.push(
        <span 
          key={match.index} 
          className="text-blue-600 font-semibold cursor-pointer hover:underline"
          onClick={() => {
            if (mentionedProfile) {
              handleNavigate('perfil', { odId: mentionedProfile.id });
            }
          }}
        >
          @{match[1]}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    // Adicionar texto restante
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    // Se não houver menções, retornar o conteúdo original
    if (parts.length === 0) {
      return content;
    }

    // Processar referências financeiras para torná-las clicáveis
    if (entityReferences && entityReferences.length > 0) {
      const financialRefs = entityReferences.filter(e => e.type === 'financial');
      if (financialRefs.length > 0) {
        // Para cada referência financeira, encontrar o texto correspondente e torná-lo clicável
        const newParts: React.ReactNode[] = [];
        let currentText = content;
        
        for (const ref of financialRefs) {
          const refText = ref.name || '';
          const refIndex = currentText.indexOf(refText);
          
          if (refIndex !== -1) {
            // Adicionar texto antes da referência
            if (refIndex > 0) {
              newParts.push(currentText.slice(0, refIndex));
            }
            
            // Adicionar referência clicável em azul
            newParts.push(
              <span
                key={`fin-${ref.id}`}
                className="text-blue-600 font-semibold cursor-pointer hover:underline"
                onClick={() => handleOpenFinancialModal(ref.id)}
              >
                {refText}
              </span>
            );
            
            // Atualizar texto restante
            currentText = currentText.slice(refIndex + refText.length);
          }
        }
        
        // Adicionar texto restante
        if (currentText.length > 0) {
          newParts.push(currentText);
        }
        
        return newParts.length > 0 ? newParts : parts;
      }
    }

    return parts.length > 0 ? parts : content;
  }, []);

  // Carregar posts do feed ao montar
  useEffect(() => {
    loadFeedPosts();
  }, [loadFeedPosts]);

  // Scroll até o post quando params?.scrollToPost for passado
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
  }, [params?.scrollToPost, feedPosts]);

  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;

  const activeClients = clients.length;
  const activeProcesses = processes.length;
  const pendingDeadlines = deadlines.filter((d) => d.status === 'pendente').length;

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

  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const manualEvents = calendarEvents
      .filter((e) => {
        if (!e.start_at) return false;
        const eventDate = new Date(e.start_at);
        return eventDate >= today;
      })
      .map((e) => ({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        type: e.event_type || 'meeting',
        client_id: e.client_id,
      }));

    const hearingEvents = processes
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
      });

    return [...manualEvents, ...hearingEvents]
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 10);
  }, [calendarEvents, processes, clients]);

  const handleNavigate = (moduleKey: string, params?: Record<string, string>) => {
    onNavigateToModule?.(moduleKey, params);
  };

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

  const getDateLabel = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Hoje';
    if (date.toDateString() === tomorrow.toDateString()) return 'Amanhã';
    return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
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
      
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-500" />
              Aguardando Confecção
            </h3>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
              {awaitingDraftProcesses.length + requirementsAwaiting.length}
            </span>
          </div>
          
          {!hasItems ? (
            <div className="text-center py-4 text-slate-500 text-sm">
              <FileText className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              Nada aguardando
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Processos */}
              <button
                onClick={() => handleNavigate('processos', { statusFilter: 'aguardando_confeccao' })}
                className="text-left rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
                      <Briefcase className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">Processos</div>
                      <div className="text-[10px] text-slate-500 truncate">Aguardando confecção</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700 flex-shrink-0">
                    {awaitingDraftProcesses.length}
                  </div>
                </div>

                <div className="mt-2 flex flex-col gap-1">
                  {awaitingDraftProcesses.length === 0 ? (
                    <div className="text-[10px] text-slate-500">Nenhum processo</div>
                  ) : (
                    <>
                      {awaitingDraftProcesses.slice(0, 2).map((process) => {
                        const client = process.client_id ? clientMap.get(process.client_id) : null;
                        const primary = client?.full_name || 'Cliente não vinculado';
                        const secondary = process.process_code || 'Processo';
                        return (
                          <div key={process.id} className="flex items-start gap-1.5">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-slate-800 truncate">{primary}</div>
                              <div className="text-[10px] text-slate-500 truncate">{secondary}</div>
                            </div>
                          </div>
                        );
                      })}
                      {awaitingDraftProcesses.length > 2 && (
                        <div className="text-[10px] text-indigo-700 font-semibold">+{awaitingDraftProcesses.length - 2} processos</div>
                      )}
                    </>
                  )}
                </div>
              </button>

              {/* Requerimentos */}
              <button
                onClick={() => handleNavigate('requerimentos', { statusTab: 'aguardando_confeccao' })}
                className="text-left rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 flex-shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">Requerimentos</div>
                      <div className="text-[10px] text-slate-500 truncate">Aguardando confecção</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700 flex-shrink-0">
                    {requirementsAwaiting.length}
                  </div>
                </div>

                <div className="mt-2 flex flex-col gap-1">
                  {requirementsAwaiting.length === 0 ? (
                    <div className="text-[10px] text-slate-500">Nenhum requerimento</div>
                  ) : (
                    <>
                      {requirementsAwaiting.slice(0, 2).map((req) => {
                        const primary = req.beneficiary || 'Beneficiário não informado';
                        const secondary = (req.benefit_type || 'Requerimento').replace(/_/g, ' ');
                        return (
                          <div key={req.id} className="flex items-start gap-1.5">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-slate-800 truncate">{primary}</div>
                              <div className="text-[10px] text-slate-500 truncate">{secondary}</div>
                            </div>
                          </div>
                        );
                      })}
                      {requirementsAwaiting.length > 2 && (
                        <div className="text-[10px] text-purple-700 font-semibold">+{requirementsAwaiting.length - 2} requerimentos</div>
                      )}
                    </>
                  )}
                </div>
              </button>

              {/* Mostrar mais se houver muitos itens */}
              {(awaitingDraftProcesses.length + requirementsAwaiting.length) > 4 && (
                <button
                  onClick={() => handleNavigate('processos', { statusFilter: 'aguardando_confeccao' })}
                  className="text-xs text-center text-indigo-600 hover:text-indigo-700 font-semibold py-1"
                >
                  Ver todos ({awaitingDraftProcesses.length + requirementsAwaiting.length})
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
      const urgentDeadlines = deadlines.filter(d => {
        if (d.status === 'cumprido' || d.status === 'cancelado') return false;
        const dueDate = new Date(d.due_date);
        const today = new Date();
        const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 3;
      }).slice(0, 5);
      
      return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-red-600" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Prazos Urgentes</h3>
            </div>
            <button
              onClick={() => handleNavigate('prazos')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Ver todos
            </button>
          </div>
          {urgentDeadlines.length === 0 ? (
            <p className="text-slate-400 text-xs text-center py-4">Nenhum prazo urgente</p>
          ) : (
            <div className="space-y-2">
              {urgentDeadlines.map((d) => {
                const dueDate = new Date(d.due_date);
                const today = new Date();
                const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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
          <button
            onClick={() => handleNavigate('processos')}
            className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
          >
            <Briefcase className="w-5 h-5" />
            Meus Processos
          </button>
          <button
            onClick={() => handleNavigate('agenda')}
            className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
          >
            <Calendar className="w-5 h-5" />
            Agenda
          </button>
          <button
            onClick={() => handleNavigate('clientes')}
            className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
          >
            <Users className="w-5 h-5" />
            Clientes
          </button>
          <button
            onClick={() => handleNavigate('documentos')}
            className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-xl font-medium transition-colors"
          >
            <Bookmark className="w-5 h-5" />
            Documentos
          </button>
        </nav>
      );
    }
    return null;
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          {/* Sidebar Esquerda - Widgets Arrastáveis */}
          <aside className="hidden lg:flex lg:col-span-3 flex-col sticky top-4 order-1">
            <SidebarDroppable id="sidebar-left">
              <SortableContext items={leftWidgets} strategy={rectSortingStrategy}>
                {leftWidgets.map((widgetId) => (
                  <SortableWidget key={widgetId} id={widgetId}>
                    {renderWidget(widgetId)}
                  </SortableWidget>
                ))}
              </SortableContext>
            </SidebarDroppable>
          </aside>

        {/* Feed Central */}
        <main className="col-span-1 lg:col-span-9 xl:col-span-6 flex flex-col gap-6 order-2">
          {/* Barra de Indicadores */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-2.5 flex items-center justify-between gap-2 overflow-x-auto">
            <button 
              onClick={() => handleNavigate('clientes')}
              className="flex items-center gap-1.5 hover:bg-slate-50 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              <Users className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-bold text-slate-700">CLIENTES:</span>
              <span className="text-sm font-bold text-blue-600">{activeClients}</span>
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <button 
              onClick={() => handleNavigate('processos')}
              className="flex items-center gap-1.5 hover:bg-slate-50 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              <Briefcase className="w-4 h-4 text-indigo-500" />
              <span className="text-xs font-bold text-slate-700">PROCESSOS:</span>
              <span className="text-sm font-bold text-indigo-600">{activeProcesses}</span>
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <button 
              onClick={() => handleNavigate('requerimentos')}
              className="flex items-center gap-1.5 hover:bg-slate-50 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              <FileText className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-bold text-slate-700">REQUERIMENTOS:</span>
              <span className="text-sm font-bold text-amber-600">{requirementsAwaiting.length}</span>
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <button 
              onClick={() => handleNavigate('prazos')}
              className="flex items-center gap-1.5 hover:bg-slate-50 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              <Clock className="w-4 h-4 text-red-500" />
              <span className="text-xs font-bold text-slate-700">PRAZOS:</span>
              <span className="text-sm font-bold text-red-600">{pendingDeadlines}</span>
            </button>
            <div className="w-px h-4 bg-slate-200" />
            <button 
              onClick={() => handleNavigate('tarefas')}
              className="flex items-center gap-1.5 hover:bg-slate-50 px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
            >
              <CheckSquare className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold text-slate-700">TAREFAS:</span>
              <span className="text-sm font-bold text-emerald-600">{tasks.filter(t => t.status === 'pending').length}</span>
            </button>
          </div>

          {/* Caixa de Postagem - Design Premium */}
          <div className="bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200/80 shadow-lg shadow-slate-200/50 overflow-visible">
            {/* Header do Post */}
            <div className="p-4 pb-3">
              <div className="flex gap-3">
                <div className="relative">
                  <Avatar src={currentProfile?.avatar_url} name={currentProfile?.name || 'Usuário'} size="md" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white" />
                </div>
                <div className="flex-1 relative">
                  <textarea
                    ref={postInputRef}
                    value={postText}
                    onChange={handlePostTextChange}
                    rows={2}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 focus:shadow-lg focus:shadow-blue-500/10 transition-all resize-none text-sm leading-relaxed"
                    placeholder="O que você gostaria de compartilhar? Use @ para mencionar e # para tags..."
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
                <div className="flex flex-wrap gap-2 mt-3 ml-13">
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
                <div className="mt-3 ml-13">
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((att) => (
                      <div key={att.attachment.filePath} className="relative">
                        <img src={att.localUrl} className="h-20 w-20 object-cover rounded-lg border border-slate-200" />
                        <button
                          type="button"
                          className="absolute -top-2 -right-2 bg-white rounded-full border border-slate-200 shadow p-1"
                          onClick={() => {
                            try { URL.revokeObjectURL(att.localUrl); } catch {}
                            setPendingAttachments((prev) => prev.filter((p) => p.attachment.filePath !== att.attachment.filePath));
                          }}
                          aria-label="Remover anexo"
                        >
                          <X className="w-3 h-3 text-slate-600" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Barra de Ações */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100/50 border-t border-slate-200/80">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setPostText(postText + '@');
                    setShowMentionDropdown(true);
                    postInputRef.current?.focus();
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-sm font-medium"
                >
                  <AtSign className="w-4 h-4 text-blue-500" />
                  <span className="hidden sm:inline">Mencionar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPostText(postText + '#');
                    setShowTagDropdown(true);
                    postInputRef.current?.focus();
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-sm font-medium"
                >
                  <Hash className="w-4 h-4 text-emerald-500" />
                  <span className="hidden sm:inline">Tag</span>
                </button>
                <button
                  type="button"
                  onClick={handleAttachClick}
                  disabled={uploadingAttachment}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-sm font-medium"
                >
                  <Image className="w-4 h-4 text-purple-500" />
                  <span className="hidden sm:inline">Foto</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors text-sm font-medium"
                >
                  <Smile className="w-4 h-4 text-amber-500" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowPollCreator((v) => !v)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium ${showPollCreator ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-200'}`}
                >
                  <BarChart2 className="w-4 h-4 text-indigo-500" />
                  <span className="hidden sm:inline">Enquete</span>
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
              <button
                type="button"
                onClick={handlePublishPost}
                disabled={(!postText.trim() && !showPollCreator) || postingInProgress}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/30 hover:-translate-y-0.5"
              >
                {postingInProgress ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {postingInProgress ? 'Publicando...' : 'Publicar'}
              </button>
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

          {/* Filtros do Feed */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button className="px-4 py-2 rounded-full bg-slate-800 text-white text-sm font-semibold whitespace-nowrap border border-transparent shadow-sm hover:bg-slate-700 transition-colors">
              Todas Atualizações
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-colors flex items-center gap-1.5 ${
                  selectedTags.includes(tag.id)
                    ? `${tag.color} border-transparent`
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <tag.icon className="w-3.5 h-3.5" />
                #{tag.label}
              </button>
            ))}
          </div>

          {/* Feed de Posts */}
          <div className="flex flex-col gap-6">
            {loadingPosts ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-2 text-blue-500 animate-spin" />
                <p className="text-slate-500 text-sm">Carregando publicações...</p>
              </div>
            ) : feedPosts.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center text-blue-500 mb-4">
                  <MessageCircle className="w-8 h-8" />
                </div>
                <p className="text-slate-900 font-bold text-lg">Sem publicações ainda</p>
                <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                  Use a caixa acima para compartilhar uma atualização. Mencione colegas com <span className="font-semibold text-blue-600">@nome</span> e categorize com tags como <span className="font-semibold text-emerald-600">#financeiro</span> ou <span className="font-semibold text-purple-600">#processo</span>.
                </p>
              </div>
            ) : (
              feedPosts.map((post) => (
                <div key={post.id} data-post-id={post.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-md shadow-slate-200/50 overflow-hidden hover:shadow-lg hover:shadow-slate-200/60 transition-shadow">
                  {/* Header do Post */}
                  <div className="p-4 pb-2 flex gap-3">
                    <button 
                      onClick={() => onNavigateToModule?.('perfil', { userId: post.author_id })}
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                    >
                      <Avatar src={post.author?.avatar_url} name={post.author?.name || 'Usuário'} />
                    </button>
                    <div className="flex flex-col flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button 
                          onClick={() => onNavigateToModule?.('perfil', { userId: post.author_id })}
                          className="text-slate-900 font-bold text-sm hover:underline cursor-pointer"
                        >
                          {post.author?.name || 'Usuário'}
                        </button>
                        <BadgeIcon badge={post.author?.badge} />
                        {post.tags.length > 0 && (
                          <div className="flex gap-1">
                            {post.tags.slice(0, 2).map(tag => {
                              const tagConfig = availableTags.find(t => t.id === tag);
                              return tagConfig ? (
                                <span key={tag} className={`${tagConfig.color} text-[10px] font-bold px-2 py-0.5 rounded-full`}>
                                  #{tagConfig.label}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                      <p className="text-slate-500 text-xs">
                        {post.author?.role || 'Membro'} • {formatTimeAgo(post.created_at)}
                      </p>
                    </div>
                    {/* Menu de ações do post (só para autor) */}
                    {user?.id === post.author_id && (
                      <div className="ml-auto relative">
                        <button 
                          onClick={() => setOpenPostMenu(openPostMenu === post.id ? null : post.id)}
                          className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"
                        >
                          <MoreHorizontal className="w-5 h-5" />
                        </button>
                        {openPostMenu === post.id && (
                          <div className="absolute right-0 top-8 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20 min-w-[140px]">
                            <button
                              onClick={() => {
                                setEditingPostId(post.id);
                                setEditingContent(post.content);
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
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Conteúdo do Post */}
                  <div className="px-4 py-2">
                    {editingPostId === post.id ? (
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
                        <div className="text-slate-800 text-sm leading-relaxed mb-3 whitespace-pre-wrap">
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

                    {/* Enquete */}
                    {postPolls.has(post.id) && (() => {
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
                            <span>{totalVotes} voto{totalVotes !== 1 ? 's' : ''}</span>
                            {poll.expires_at && (
                              <span className={poll.is_expired ? 'text-red-500' : ''}>
                                {poll.is_expired ? 'Encerrada' : `Encerra em ${formatTimeAgo(poll.expires_at)}`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Imagens estilo Instagram - ocupam toda a largura */}
                    {post.attachments && post.attachments.length > 0 && (() => {
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
                    
                    {/* Cards de Preview de Dados */}
                    {post.preview_data && Object.keys(post.preview_data).length > 0 && (
                      <div className="space-y-2">
                        {/* Preview Financeiro */}
                        {post.preview_data.financeiro && (
                          <div 
                            className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('financeiro')}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <DollarSign className="w-4 h-4 text-white" />
                              <span className="text-white font-bold text-sm">Resumo Financeiro</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-white/20 rounded-lg p-2 text-center">
                                <p className="text-white/80 text-[10px]">Recebido</p>
                                <p className="text-white font-bold text-sm">{formatCurrency(post.preview_data.financeiro.recebido)}</p>
                              </div>
                              <div className="bg-white/20 rounded-lg p-2 text-center">
                                <p className="text-white/80 text-[10px]">Pendente</p>
                                <p className="text-white font-bold text-sm">{formatCurrency(post.preview_data.financeiro.pendente)}</p>
                              </div>
                              <div className="bg-white/20 rounded-lg p-2 text-center">
                                <p className="text-white/80 text-[10px]">Atrasado</p>
                                <p className="text-white font-bold text-sm">{formatCurrency(post.preview_data.financeiro.atrasado)}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Cliente */}
                        {post.preview_data.cliente && (
                          <div 
                            className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('clientes', { selectedId: post.preview_data.cliente?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white">
                                <Users className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.cliente.nome}</p>
                                <p className="text-white/80 text-xs">{post.preview_data.cliente.cpf || post.preview_data.cliente.telefone || 'Cliente'}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Processo */}
                        {post.preview_data.processo && (
                          <div 
                            className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('processos', { selectedId: post.preview_data.processo?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white">
                                <Gavel className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.processo.numero}</p>
                                <p className="text-white/80 text-xs">{post.preview_data.processo.cliente} • {post.preview_data.processo.status}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Prazo */}
                        {post.preview_data.prazo && (
                          <div 
                            className="bg-gradient-to-r from-red-500 to-red-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('prazos', { selectedId: post.preview_data.prazo?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white">
                                <Clock className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.prazo.titulo}</p>
                                <p className="text-white/80 text-xs">{post.preview_data.prazo.data} • {post.preview_data.prazo.tipo}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Agenda */}
                        {post.preview_data.agenda && (
                          <div 
                            className="bg-gradient-to-r from-amber-500 to-amber-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('agenda', { selectedId: post.preview_data.agenda?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center text-white">
                                <Calendar className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.agenda.titulo}</p>
                                <p className="text-white/80 text-xs">{post.preview_data.agenda.data} {post.preview_data.agenda.hora && `às ${post.preview_data.agenda.hora}`}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Documento */}
                        {post.preview_data.documento && (
                          <div 
                            className="bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('documentos', { selectedId: post.preview_data.documento?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center text-white">
                                <FileText className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.documento.nome}</p>
                                <p className="text-white/80 text-xs">{post.preview_data.documento.tipo || 'Documento'}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Petição */}
                        {post.preview_data.peticao && (
                          <div 
                            className="bg-gradient-to-r from-cyan-500 to-cyan-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('peticoes', { selectedId: post.preview_data.peticao?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center text-white">
                                <ScrollText className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.peticao.nome}</p>
                                <p className="text-white/80 text-xs">{post.preview_data.peticao.tipo || 'Petição'}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Assinatura */}
                        {post.preview_data.assinatura && (
                          <div 
                            className="bg-gradient-to-r from-pink-500 to-pink-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('assinaturas', { selectedId: post.preview_data.assinatura?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center text-white">
                                <Pencil className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.assinatura.nome}</p>
                                <p className="text-white/80 text-xs">
                                  {post.preview_data.assinatura.cliente || 'Assinatura'} • {post.preview_data.assinatura.status === 'signed' ? 'Assinado' : 'Pendente'}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Preview Requerimento */}
                        {post.preview_data.requerimento && (
                          <div 
                            className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => handleNavigate('requerimentos', { selectedId: post.preview_data.requerimento?.id || '' })}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center text-white">
                                <Briefcase className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-white font-bold text-sm">{post.preview_data.requerimento.protocolo || post.preview_data.requerimento.beneficiario}</p>
                                <p className="text-white/80 text-xs">
                                  {post.preview_data.requerimento.beneficiario} • {post.preview_data.requerimento.tipo || post.preview_data.requerimento.status || 'Requerimento'}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Contadores */}
                  <div className="px-4 py-2 flex items-center justify-between text-xs text-slate-500 border-b border-slate-200 mt-2">
                    <div className="flex items-center gap-1">
                      <div className="flex -space-x-1.5">
                        <div className="w-5 h-5 rounded-full bg-blue-500 border border-white flex items-center justify-center">
                          <ThumbsUp className="w-2.5 h-2.5 text-white" />
                        </div>
                        {post.likes_count > 5 && (
                          <div className="w-5 h-5 rounded-full bg-red-500 border border-white flex items-center justify-center">
                            <Heart className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </div>
                      <span className="ml-1 hover:underline cursor-pointer font-medium text-slate-600">
                        {post.likes_count > 0 ? `${post.likes_count} curtida${post.likes_count !== 1 ? 's' : ''}` : 'Seja o primeiro'}
                      </span>
                    </div>
                    <span className="hover:underline cursor-pointer font-medium text-slate-600">
                      {post.comments_count} comentário{post.comments_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  
                  {/* Ações */}
                  <div className="flex items-center px-2 py-1 bg-slate-50/50">
                    <button 
                      onClick={() => handleToggleLike(post.id, post.liked_by_me || false)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors ${post.liked_by_me ? 'text-blue-600' : 'text-slate-600'}`}
                    >
                      <ThumbsUp className={`w-5 h-5 ${post.liked_by_me ? 'fill-current' : ''}`} />
                      {post.liked_by_me ? 'Curtido' : 'Curtir'}
                    </button>
                    <button 
                      onClick={() => toggleInlineComments(post.id)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors ${expandedComments[post.id] ? 'text-blue-600' : 'text-slate-600'}`}
                    >
                      <MessageCircle className="w-5 h-5" />
                      Comentar
                    </button>
                  </div>
                  
                  {/* Seção de comentários inline (estilo Facebook/Instagram) */}
                  {expandedComments[post.id] && (
                    <div className="border-t border-slate-100">
                      {/* Lista de comentários */}
                      <div className="px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
                        {expandedComments[post.id].loading ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                          </div>
                        ) : expandedComments[post.id].comments.length === 0 ? (
                          <p className="text-slate-400 text-sm text-center py-2">Seja o primeiro a comentar!</p>
                        ) : (
                          expandedComments[post.id].comments.map((c, idx) => (
                            <div key={`${c.user_id}-${idx}`} className="flex gap-2 group">
                              <button
                                onClick={() => handleNavigate('perfil', { userId: c.user_id })}
                                className="flex-shrink-0"
                              >
                                <Avatar src={c.avatar_url} name={c.name} size="xs" />
                              </button>
                              <div className="flex-1">
                                <div className="bg-slate-100 rounded-2xl px-3 py-2">
                                  <button
                                    onClick={() => handleNavigate('perfil', { userId: c.user_id })}
                                    className="text-xs font-semibold text-slate-900 hover:underline"
                                  >
                                    {c.name}
                                  </button>
                                  <p className="text-sm text-slate-700">{c.content}</p>
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
                          <Avatar src={currentProfile?.avatar_url} name={currentProfile?.name || 'Você'} size="xs" />
                          <input
                            type="text"
                            value={expandedComments[post.id]?.newComment || ''}
                            onChange={(e) => setExpandedComments(prev => ({
                              ...prev,
                              [post.id]: { ...prev[post.id], newComment: e.target.value }
                            }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleCreateInlineComment(post.id);
                              }
                            }}
                            placeholder={`Comente como ${currentProfile?.name || 'você'}...`}
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                            disabled={expandedComments[post.id]?.submitting}
                          />
                          {expandedComments[post.id]?.submitting && (
                            <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </main>

        {/* Sidebar Direita - Widgets Arrastáveis */}
        <aside className="hidden xl:flex xl:col-span-3 flex-col sticky top-4 order-3">
          <SidebarDroppable id="sidebar-right">
            <SortableContext items={rightWidgets} strategy={rectSortingStrategy}>
              {rightWidgets.map((widgetId) => (
                <SortableWidget key={widgetId} id={widgetId}>
                  {renderWidget(widgetId)}
                </SortableWidget>
              ))}
            </SortableContext>
          </SidebarDroppable>
        </aside>
      </div>
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
                          <p className="text-sm text-slate-700">{u.content}</p>
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
                <Avatar src={currentProfile?.avatar_url} name={currentProfile?.name || 'Você'} size="sm" />
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
    </DndContext>
  );
};

export default Dashboard;
