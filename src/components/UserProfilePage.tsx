import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Camera,
  MapPin,
  Calendar,
  Briefcase,
  Mail,
  Phone,
  Edit3,
  Users,
  FileText,
  MessageCircle,
  ThumbsUp,
  Heart,
  MoreHorizontal,
  Loader2,
  CheckCircle,
  Shield,
  Scale,
  Award,
  BarChart2,
  DollarSign,
  Clock,
  AtSign,
  Hash,
  Image,
  Smile,
  Send,
  Minus,
  Plus,
  TrendingUp,
  FolderOpen,
  Star,
  Gavel,
  Badge,
  Save,
  User,
  Key,
  Activity,
  PenTool,
  FileSignature,
  Pencil,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profileService, type Profile } from '../services/profile.service';
import { feedPostsService, type FeedPost, type EntityReference, type PreviewData, type TagRecord } from '../services/feedPosts.service';
import { feedPollsService, type FeedPoll } from '../services/feedPolls.service';
import { clientService } from '../services/client.service';
import { caseService } from '../services/case.service';
import { taskService } from '../services/task.service';
import { supabase } from '../config/supabase';
import { events, SYSTEM_EVENTS } from '../utils/events';

// Banner padrão jurídico (usado quando usuário não selecionou nenhum)
const DEFAULT_BANNER = 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1200&h=400&fit=crop';

// Banners jurídicos para seleção
const LEGAL_BANNERS = [
  { id: 1, url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1200&h=400&fit=crop', name: 'Biblioteca Jurídica' },
  { id: 2, url: 'https://images.unsplash.com/photo-1505664194779-8beaceb93744?w=1200&h=400&fit=crop', name: 'Livros de Direito' },
  { id: 3, url: 'https://images.unsplash.com/photo-1436450412740-6b988f486c6b?w=1200&h=400&fit=crop', name: 'Escritório Advocacia' },
  { id: 4, url: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1200&h=400&fit=crop', name: 'Biblioteca Clássica' },
  { id: 5, url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1200&h=400&fit=crop', name: 'Tribunal' },
  { id: 6, url: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=1200&h=400&fit=crop', name: 'Mesa de Trabalho' },
  { id: 7, url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=400&fit=crop', name: 'Escritório Moderno' },
  { id: 8, url: 'https://images.unsplash.com/photo-1568992687947-868a62a9f521?w=1200&h=400&fit=crop', name: 'Reunião Executiva' },
  { id: 9, url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&h=400&fit=crop', name: 'Documentos' },
  { id: 10, url: 'https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=1200&h=400&fit=crop', name: 'Profissional' },
];

const AVAILABLE_TAGS = [
  { id: 'financeiro', label: 'Financeiro', icon: DollarSign, color: 'bg-emerald-50 text-emerald-700 border border-emerald-200/70' },
  { id: 'processo', label: 'Processo', icon: Gavel, color: 'bg-purple-50 text-purple-700 border border-purple-200/70' },
  { id: 'prazo', label: 'Prazo', icon: Clock, color: 'bg-red-50 text-red-700 border border-red-200/70' },
  { id: 'cliente', label: 'Cliente', icon: Users, color: 'bg-blue-50 text-blue-700 border border-blue-200/70' },
  { id: 'agenda', label: 'Agenda', icon: Calendar, color: 'bg-amber-50 text-amber-700 border border-amber-200/70' },
  { id: 'documento', label: 'Documento', icon: FileText, color: 'bg-indigo-50 text-indigo-700 border border-indigo-200/70' },
  { id: 'peticao', label: 'Petição', icon: FileSignature, color: 'bg-cyan-50 text-cyan-700 border border-cyan-200/70' },
  { id: 'assinatura', label: 'Assinatura', icon: PenTool, color: 'bg-pink-50 text-pink-700 border border-pink-200/70' },
  { id: 'requerimento', label: 'Requerimento', icon: Briefcase, color: 'bg-orange-50 text-orange-700 border border-orange-200/70' },
];
const availableTags = AVAILABLE_TAGS;

interface UserProfilePageProps {
  userId?: string;
  onClose?: () => void;
  onNavigateToModule?: (moduleKey: string, params?: Record<string, string>) => void;
}

const Avatar: React.FC<{ src?: string | null; name: string; size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' }> = ({
  src,
  name,
  size = 'md',
}) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
    xl: 'w-20 h-20 text-xl',
    '2xl': 'w-32 h-32 text-3xl',
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
      <div className={`${sizeClasses[size]} rounded-full overflow-hidden border-4 border-white shadow-lg shrink-0 bg-slate-100`}>
        <img
          src={src}
          alt={name}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shrink-0 shadow-lg border-4 border-white`}
    >
      {initials || '?'}
    </div>
  );
};

const BadgeIcon: React.FC<{ badge?: string | null; className?: string }> = ({ badge, className = '' }) => {
  if (!badge) return null;
  
  switch (badge) {
    case 'administrador':
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold shadow-sm ${className}`}>
          <Shield className="w-3 h-3" />
          Administrador
        </span>
      );
    case 'advogado':
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-sm ${className}`}>
          <Scale className="w-3 h-3" />
          Advogado
        </span>
      );
    case 'estagiario':
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold shadow-sm ${className}`}>
          <Award className="w-3 h-3" />
          Estagiário
        </span>
      );
    case 'secretario':
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold shadow-sm ${className}`}>
          <Briefcase className="w-3 h-3" />
          Secretário(a)
        </span>
      );
    default:
      return null;
  }
};

const formatTimeAgo = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'agora';
  if (diffMins < 60) return `${diffMins}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

export const UserProfilePage: React.FC<UserProfilePageProps> = ({ userId, onClose, onNavigateToModule }) => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [openPostMenu, setOpenPostMenu] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [userPosts, setUserPosts] = useState<FeedPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postPolls, setPostPolls] = useState<Map<string, FeedPoll>>(new Map());
  const [activeTab, setActiveTab] = useState<'timeline' | 'about' | 'dados' | 'security' | 'stats'>('timeline');
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: '',
    email: '',
    cpf: '',
    phone: '',
    oab: '',
    bio: '',
    role: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [stats, setStats] = useState({
    totalClients: 0,
    totalCases: 0,
    totalTasks: 0,
    completedTasks: 0,
    totalEvents: 0,
    totalIntimacoes: 0,
  });
  
  // Estados para criar posts
  const [postText, setPostText] = useState('');
  const [postingInProgress, setPostingInProgress] = useState(false);

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
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(true);
  const [pollExpiresIn, setPollExpiresIn] = useState<string>('24h');
  const [pollParticipants, setPollParticipants] = useState<string[]>([]);
  const [interactionModal, setInteractionModal] = useState<{
    open: boolean;
    type: 'likes' | 'comments';
    postId: string | null;
    users: Array<{ user_id: string; name: string; avatar_url?: string; content?: string; created_at?: string }>;
    loading: boolean;
    newComment: string;
    submitting: boolean;
  }>({ open: false, type: 'likes', postId: null, users: [], loading: false, newComment: '', submitting: false });
  
  // Comentários inline (abaixo do post) - alinhado com Dashboard
  const [expandedComments, setExpandedComments] = useState<Record<string, {
    comments: Array<{ user_id: string; name: string; avatar_url?: string; content: string; created_at: string }>;
    loading: boolean;
    newComment: string;
    submitting: boolean;
  }>>({});
  const [selectedEntities, setSelectedEntities] = useState<EntityReference[]>([]);
  const [previewData, setPreviewData] = useState<PreviewData>({});
  const [tagRecords, setTagRecords] = useState<TagRecord[]>([]);
  const [loadingTagRecords, setLoadingTagRecords] = useState(false);
  const [selectedTagForRecords, setSelectedTagForRecords] = useState<string | null>(null);
  const [tagRecordSearch, setTagRecordSearch] = useState('');
  const [financialDetailsByPostId, setFinancialDetailsByPostId] = useState<Record<string, {
    agreement_id: string;
    client_name: string;
    description?: string | null;
    total_value?: number | null;
    installments_count?: number | null;
    installment_value?: number | null;
    status?: string | null;
  }>>({});
  const [imageGalleryModal, setImageGalleryModal] = useState<{
    open: boolean;
    images: Array<{ url: string; fileName: string }>;
    currentIndex: number;
  }>({ open: false, images: [], currentIndex: 0 });

  const targetUserId = userId || user?.id;

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

  const filteredProfiles = useMemo(() => {
    if (!mentionSearch) return allProfiles;
    return allProfiles.filter((p) => (p.name || '').toLowerCase().includes(mentionSearch.toLowerCase()));
  }, [mentionSearch, allProfiles]);

  const myProfile = useMemo(() => {
    if (!user?.id) return undefined;
    return allProfiles.find((p) => p.user_id === user.id);
  }, [allProfiles, user?.id]);

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

  const handlePostTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setPostText(value);

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

  const insertMention = (p: Profile) => {
    const lastAtIndex = postText.lastIndexOf('@');
    const newText = postText.slice(0, lastAtIndex) + `@${p.name} `;
    setPostText(newText);
    setShowMentionDropdown(false);
    postInputRef.current?.focus();
  };

  const toggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

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

  const selectTagRecord = useCallback((record: TagRecord) => {
    setPostText((prev) => {
      const newText = prev.trim() ? `${prev} ${record.formattedText}` : record.formattedText;
      return newText;
    });

    if (selectedTagForRecords && !selectedTags.includes(selectedTagForRecords)) {
      setSelectedTags((prev) => [...prev, selectedTagForRecords]);
    }

    if (selectedTagForRecords === 'financeiro') {
      setSelectedEntities((prev) => [
        ...prev.filter((e) => !(e.type === 'financial' && e.id === record.id)),
        { type: 'financial', id: record.id, name: record.label },
      ]);
    }

    setPreviewData((prev) => ({ ...prev, ...record.previewData }));

    setSelectedTagForRecords(null);
    setTagRecords([]);
    setShowTagDropdown(false);
    postInputRef.current?.focus();
  }, [selectedTagForRecords, selectedTags]);

  const closeTagRecordsDropdown = useCallback(() => {
    setSelectedTagForRecords(null);
    setTagRecords([]);
    setTagRecordSearch('');
  }, []);

  const handleTagRecordSearch = useCallback((search: string) => {
    setTagRecordSearch(search);
    if (selectedTagForRecords) {
      loadTagRecords(selectedTagForRecords, search);
    }
  }, [selectedTagForRecords, loadTagRecords]);

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

  const loadProfile = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle();
      
      setProfile(data as Profile | null);
      setIsOwnProfile(targetUserId === user?.id);
      
      // Carregar dados no formulário
      if (data) {
        setProfileForm({
          name: data.name || '',
          email: data.email || '',
          cpf: data.cpf || '',
          phone: data.phone || '',
          oab: data.oab || '',
          bio: data.bio || '',
          role: data.role || '',
        });
      }
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
    } finally {
      setLoading(false);
    }
  }, [targetUserId, user?.id]);

  const handleProfileChange = (field: string, value: string) => {
    setProfileForm(prev => ({ ...prev, [field]: value }));
  };

  const formatCpf = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    return numbers
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
      .replace(/(-\d{2})\d+?$/, '$1');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !isOwnProfile) return;
    
    setSaving(true);
    setMessage(null);
    
    try {
      await supabase
        .from('profiles')
        .update({
          name: profileForm.name,
          email: profileForm.email,
          cpf: profileForm.cpf,
          phone: profileForm.phone,
          oab: profileForm.oab,
          bio: profileForm.bio,
        })
        .eq('user_id', user.id);
      
      setProfile(prev => prev ? { ...prev, ...profileForm } : null);
      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
    } catch (error) {
      console.error('Erro ao salvar perfil:', error);
      setMessage({ type: 'error', text: 'Erro ao salvar perfil.' });
    } finally {
      setSaving(false);
    }
  };

  const loadStats = useCallback(async () => {
    if (!isOwnProfile) return;
    try {
      // Carregar clientes
      const { count: clientsCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      // Carregar processos
      const { count: casesCount } = await supabase
        .from('cases')
        .select('*', { count: 'exact', head: true });

      // Carregar tarefas
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('status');
      
      const totalTasks = tasksData?.length || 0;
      const completedTasks = tasksData?.filter(t => t.status === 'completed').length || 0;

      // Carregar eventos da agenda
      const { count: eventsCount } = await supabase
        .from('calendar_events')
        .select('*', { count: 'exact', head: true });

      // Carregar intimações
      const { count: intimacoesCount } = await supabase
        .from('djen_intimations')
        .select('*', { count: 'exact', head: true });

      setStats({
        totalClients: clientsCount || 0,
        totalCases: casesCount || 0,
        totalTasks,
        completedTasks,
        totalEvents: eventsCount || 0,
        totalIntimacoes: intimacoesCount || 0,
      });
    } catch (error) {
      console.error('Erro ao carregar estatísticas:', error);
    }
  }, [isOwnProfile]);

  useEffect(() => {
    if (isOwnProfile && activeTab === 'stats') {
      loadStats();
    }
  }, [isOwnProfile, activeTab, loadStats]);

  // Publicar post
  const handlePublishPost = useCallback(async () => {
    const hasPoll = showPollCreator && pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2;
    if ((!postText.trim() && !hasPoll) || postingInProgress || !user?.id) return;
    
    setPostingInProgress(true);
    try {
      const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
      const mentionMatches: string[] = [];
      let match;
      while ((match = mentionRegex.exec(postText)) !== null) {
        mentionMatches.push(match[1].toLowerCase());
      }

      const mentionedIds = allProfiles
        .filter(p => {
          const profileName = p.name?.toLowerCase() || '';
          return mentionMatches.some(mentioned => profileName === mentioned || profileName.includes(mentioned));
        })
        .map(p => p.user_id);

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
          const tagPreview = await feedPostsService.getPreviewDataForTag(tag);
          finalPreviewData = { ...finalPreviewData, ...tagPreview };
        }
      }

      const postContent = postText.trim() || (hasPoll ? `📊 ${pollQuestion}` : '');

      const newPost = await feedPostsService.createPost({
        content: postContent,
        tags: selectedTags,
        mentions: mentionedIds,
        entity_references: selectedEntities,
        preview_data: finalPreviewData,
        attachments: pendingAttachments.map((p) => p.attachment),
      });

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
        setPostPolls(prev => new Map(prev).set(newPost.id, poll));
      }
      
      // Adicionar post ao início da lista
      setUserPosts(prev => [newPost, ...prev]);
      
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
  }, [postText, selectedTags, selectedEntities, previewData, allProfiles, postingInProgress, pendingAttachments, showPollCreator, pollQuestion, pollOptions, pollAllowMultiple, pollExpiresIn, pollParticipants, calculatePollExpiration, user?.id]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage({ type: 'error', text: 'As senhas não coincidem.' });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    
    setSaving(true);
    setMessage(null);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });
      
      if (error) throw error;
      
      setPasswordForm({ newPassword: '', confirmPassword: '' });
      setMessage({ type: 'success', text: 'Senha atualizada com sucesso!' });
    } catch (error) {
      console.error('Erro ao atualizar senha:', error);
      setMessage({ type: 'error', text: 'Erro ao atualizar senha.' });
    } finally {
      setSaving(false);
    }
  };

  const loadUserPosts = useCallback(async () => {
    if (!targetUserId) return;
    setLoadingPosts(true);
    try {
      const { data, error } = await supabase
        .from('feed_posts')
        .select('*')
        .eq('author_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const posts = data as FeedPost[];
      
      const postsWithAuthors = await Promise.all(
        posts.map(async (post) => {
          const { data: authorData } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', post.author_id)
            .maybeSingle();
          
          return {
            ...post,
            author: authorData as Profile | undefined,
          };
        })
      );

      // Verificar se o usuário atual deu like em cada post
      if (user?.id && postsWithAuthors.length > 0) {
        const postIds = postsWithAuthors.map(p => p.id);
        const { data: likes } = await supabase
          .from('feed_post_likes')
          .select('post_id')
          .eq('user_id', user.id)
          .in('post_id', postIds);

        const likedPostIds = new Set((likes || []).map((l: any) => l.post_id));
        setUserPosts(postsWithAuthors.map((p: any) => ({ ...p, liked_by_me: likedPostIds.has(p.id) })) as FeedPost[]);
      } else {
        setUserPosts(postsWithAuthors as FeedPost[]);
      }

      const financialRefs: Array<{ postId: string; agreementId: string }> = [];
      for (const p of postsWithAuthors as any[]) {
        const ref = (p.entity_references || []).find((r: any) => r?.type === 'financial' && r?.id);
        if (ref?.id) financialRefs.push({ postId: p.id, agreementId: String(ref.id) });
      }

      if (financialRefs.length > 0) {
        const agreementIds = Array.from(new Set(financialRefs.map((r) => r.agreementId)));
        const { data: agreements } = await supabase
          .from('agreements')
          .select('id, client_id, description, total_value, installments_count, installment_value, status')
          .in('id', agreementIds);

        const clientIds = Array.from(
          new Set(
            (agreements || [])
              .map((a: any) => a.client_id)
              .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
          )
        );
        let clientsMap = new Map<string, { full_name?: string | null }>();
        if (clientIds.length > 0) {
          const { data: clientsData } = await supabase
            .from('clients')
            .select('id, full_name')
            .in('id', clientIds);
          if (clientsData) {
            clientsMap = new Map(clientsData.map((c: any) => [String(c.id), { full_name: c.full_name }]));
          }
        }

        const agreementMap = new Map<string, any>((agreements || []).map((a: any) => [String(a.id), a]));
        const nextDetails: Record<string, any> = {};
        for (const r of financialRefs) {
          const a = agreementMap.get(r.agreementId);
          if (!a) continue;
          nextDetails[r.postId] = {
            agreement_id: String(a.id),
            client_name: clientsMap.get(String(a.client_id))?.full_name || 'Cliente',
            description: a.description,
            total_value: a.total_value,
            installments_count: a.installments_count,
            installment_value: a.installment_value,
            status: a.status,
          };
        }
        setFinancialDetailsByPostId(nextDetails);
      } else {
        setFinancialDetailsByPostId({});
      }

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
  }, [targetUserId]);

  const handleToggleLike = useCallback(async (postId: string, currentlyLiked: boolean) => {
    try {
      if (currentlyLiked) {
        await feedPostsService.unlikePost(postId);
      } else {
        await feedPostsService.likePost(postId);
      }

      setUserPosts(prev => prev.map(p => {
        if (p.id === postId) {
          const currentLikes = p.likes_count || 0;
          return {
            ...p,
            liked_by_me: !currentlyLiked,
            likes_count: currentlyLiked ? Math.max(0, currentLikes - 1) : currentLikes + 1,
          };
        }
        return p;
      }));
    } catch (error) {
      console.error('Erro ao dar/remover like:', error);
    }
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

      const mappedUsers = (profiles as any[] || []).map((p: any) => ({
        user_id: p.user_id,
        name: p.name,
        avatar_url: p.avatar_url || undefined,
      }));
      setInteractionModal(prev => ({
        ...prev,
        users: mappedUsers,
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
      setUserPosts(prev => prev.map(p => 
        p.id === interactionModal.postId 
          ? { ...p, comments_count: (p.comments_count || 0) + 1 }
          : p
      ));
    } catch (error) {
      console.error('Erro ao criar comentário:', error);
      setInteractionModal(prev => ({ ...prev, submitting: false }));
    }
  }, [interactionModal.postId, interactionModal.newComment]);

  // Expandir/colapsar comentários inline
  const toggleInlineComments = useCallback(async (postId: string) => {
    if (expandedComments[postId]) {
      setExpandedComments((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
      return;
    }

    setExpandedComments((prev) => ({
      ...prev,
      [postId]: { comments: [], loading: true, newComment: '', submitting: false },
    }));

    try {
      const comments = await feedPostsService.getComments(postId);
      const mapped = comments.map((c) => ({
        user_id: c.author_id,
        name: c.author?.name || 'Usuário',
        avatar_url: c.author?.avatar_url || undefined,
        content: c.content,
        created_at: c.created_at,
      }));
      setExpandedComments((prev) => ({
        ...prev,
        [postId]: { ...prev[postId], comments: mapped, loading: false },
      }));
    } catch (error) {
      console.error('Erro ao carregar comentários:', error);
      setExpandedComments((prev) => ({
        ...prev,
        [postId]: { ...prev[postId], loading: false },
      }));
    }
  }, [expandedComments]);

  // Criar comentário inline
  const handleCreateInlineComment = useCallback(async (postId: string) => {
    const state = expandedComments[postId];
    if (!state || !state.newComment.trim()) return;

    setExpandedComments((prev) => ({
      ...prev,
      [postId]: { ...prev[postId], submitting: true },
    }));

    try {
      const newComment = await feedPostsService.createComment(postId, state.newComment.trim());
      const commentData = {
        user_id: newComment.author_id,
        name: newComment.author?.name || myProfile?.name || 'Você',
        avatar_url: newComment.author?.avatar_url || myProfile?.avatar_url || undefined,
        content: newComment.content,
        created_at: newComment.created_at,
      };

      setExpandedComments((prev) => ({
        ...prev,
        [postId]: {
          ...prev[postId],
          comments: [...prev[postId].comments, commentData],
          newComment: '',
          submitting: false,
        },
      }));

      setUserPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p))
      );
    } catch (error) {
      console.error('Erro ao criar comentário:', error);
      setExpandedComments((prev) => ({
        ...prev,
        [postId]: { ...prev[postId], submitting: false },
      }));
    }
  }, [expandedComments, myProfile?.avatar_url, myProfile?.name]);

  // Abrir modal de curtidas ou comentários
  const openInteractionModal = useCallback((type: 'likes' | 'comments', postId: string) => {
    // Comentários agora são inline abaixo do post
    if (type === 'comments') {
      toggleInlineComments(postId);
      return;
    }

    setInteractionModal({ open: true, type, postId, users: [], loading: true, newComment: '', submitting: false });
    fetchLikes(postId);
  }, [fetchLikes, toggleInlineComments]);

  // Fechar modal
  const closeInteractionModal = useCallback(() => {
    setInteractionModal({ open: false, type: 'likes', postId: null, users: [], loading: false, newComment: '', submitting: false });
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

  const handleDeletePost = async (postId: string) => {
    if (!user) return;
    if (!confirm('Tem certeza que deseja excluir este post?')) return;
    try {
      await feedPostsService.deletePost(postId);
      setUserPosts(prev => prev.filter(p => p.id !== postId));
    } catch (error) {
      console.error('Erro ao excluir post:', error);
    }
  };

  const handleNavigate = useCallback(
    (moduleKey: string, params?: Record<string, string>) => {
      onNavigateToModule?.(moduleKey, params);
    },
    [onNavigateToModule]
  );

  useEffect(() => {
    loadProfile();
    loadUserPosts();
  }, [loadProfile, loadUserPosts]);

  const handleUploadCover = async (file: File) => {
    if (!user?.id || !isOwnProfile) return;
    setUploadingCover(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `cover_${user.id}_${Date.now()}.${fileExt}`;
      const filePath = `covers/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('anexos_chat')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('anexos_chat')
        .getPublicUrl(filePath);

      await supabase
        .from('profiles')
        .update({ cover_url: urlData.publicUrl })
        .eq('user_id', user.id);

      setProfile(prev => prev ? { ...prev, cover_url: urlData.publicUrl } : null);
    } catch (error) {
      console.error('Erro ao fazer upload da capa:', error);
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSelectCover = async (coverUrl: string) => {
    if (!user?.id || !isOwnProfile) return;
    try {
      await supabase
        .from('profiles')
        .update({ cover_url: coverUrl })
        .eq('user_id', user.id);

      setProfile(prev => prev ? { ...prev, cover_url: coverUrl } : null);
      setShowCoverModal(false);
    } catch (error) {
      console.error('Erro ao selecionar capa:', error);
    }
  };

  const handleUploadAvatar = async (file: File) => {
    if (!user?.id || !isOwnProfile) return;
    setUploadingAvatar(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `avatar_${user.id}_${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('anexos_chat')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('anexos_chat')
        .getPublicUrl(filePath);

      await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('user_id', user.id);

      setProfile(prev => prev ? { ...prev, avatar_url: urlData.publicUrl } : null);
    } catch (error) {
      console.error('Erro ao fazer upload do avatar:', error);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const renderContentWithMentions = (content: string) => {
    const mentionRegex = /@(\w+(?:\s+\w+)*)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      parts.push(
        <span key={match.index} className="text-blue-600 font-semibold cursor-pointer hover:underline">
          @{match[1]}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
        <Users className="w-12 h-12 mb-4" />
        <p className="text-lg font-medium">Perfil não encontrado</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-950 min-h-full">
      {/* Cover Photo com gradiente premium */}
      <div className="relative h-48 bg-gradient-to-r from-blue-600 to-indigo-700 overflow-hidden rounded-b-2xl">
        <img
          src={(profile.cover_url && profile.cover_url.trim() !== '') ? profile.cover_url : DEFAULT_BANNER}
          alt="Capa"
          className="w-full h-full object-cover mix-blend-overlay opacity-60"
        />
        
        {isOwnProfile && (
          <button
            onClick={() => setShowCoverModal(true)}
            className="absolute bottom-4 right-4 z-10 flex items-center gap-2 bg-black/30 hover:bg-black/50 text-white px-4 py-2 rounded-lg cursor-pointer backdrop-blur-md transition-all pointer-events-auto"
          >
            <Camera className="w-4 h-4" />
            <span className="text-sm font-medium">Editar capa</span>
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 bg-black/30 hover:bg-black/50 text-white p-2 rounded-full transition-colors backdrop-blur-md"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Profile Header */}
      <div className="relative px-8 pb-6 flex flex-col md:flex-row items-end gap-6 -mt-16">
        {/* Avatar com borda e sombra premium */}
        <div className="relative">
          <img 
            src={profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name || 'U')}&size=128&background=3b82f6&color=fff`}
            alt={profile.name || 'Usuário'}
            className="w-32 h-32 rounded-2xl border-4 border-white dark:border-slate-900 object-cover shadow-xl bg-white"
          />
          {isOwnProfile && (
            <label className="absolute bottom-2 right-2 p-1.5 bg-blue-600 text-white rounded-lg shadow-lg cursor-pointer hover:bg-blue-700 transition-colors">
              <Camera className="w-4 h-4" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadAvatar(file);
                }}
                disabled={uploadingAvatar}
              />
            </label>
          )}
        </div>

        {/* Name and Info */}
        <div className="flex-grow mb-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{profile.name}</h1>
            <BadgeIcon badge={profile.badge} />
          </div>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            {profile.role || 'Membro da equipe'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mb-2">
          {isOwnProfile ? (
            <button
              onClick={() => setActiveTab('dados')}
              className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20"
            >
              <Edit3 className="w-4 h-4" />
              Editar Perfil
            </button>
          ) : (
            <button
              onClick={() => {
                const targetId = String(profile?.user_id || '').trim();
                if (!targetId) return;
                events.emit(SYSTEM_EVENTS.CHAT_WIDGET_OPEN_DM, { targetUserId: targetId });
              }}
              className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20"
            >
              <MessageCircle className="w-4 h-4" />
              Mensagem
            </button>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="border-t border-slate-100 dark:border-slate-800 px-8 overflow-x-auto">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'timeline'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-blue-600'
            }`}
          >
            <Activity className="w-4 h-4" />
            Atividade
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'about'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-blue-600'
            }`}
          >
            <Award className="w-4 h-4" />
            Sobre
          </button>
          {isOwnProfile && (
            <>
              <button
                onClick={() => setActiveTab('dados')}
                className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'dados'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-blue-600'
                }`}
              >
                <User className="w-4 h-4" />
                Dados Pessoais
              </button>
              <button
                onClick={() => setActiveTab('security')}
                className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'security'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-blue-600'
                }`}
              >
                <Shield className="w-4 h-4" />
                Segurança
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'stats'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-blue-600'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                Estatísticas
              </button>
            </>
          )}
        </nav>
      </div>

      {/* Content Grid */}
      <div className="px-4 lg:px-8 py-6 grid grid-cols-12 gap-6">
        {/* Sidebar */}
        <aside className="col-span-12 lg:col-span-4 space-y-6">
          {/* Contato Profissional */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold mb-4 flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Badge className="w-5 h-5 text-blue-600" /> Contato Profissional
            </h3>
            <ul className="space-y-4">
              {profile.role && (
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div className="text-sm">
                    <p className="text-slate-400 text-xs font-medium">Cargo</p>
                    <p className="font-semibold text-slate-900 dark:text-white">{profile.role}</p>
                  </div>
                </li>
              )}
              {profile.oab && (
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center text-purple-600">
                    <Scale className="w-4 h-4" />
                  </div>
                  <div className="text-sm">
                    <p className="text-slate-400 text-xs font-medium">OAB</p>
                    <p className="font-semibold text-slate-900 dark:text-white">{profile.oab}</p>
                  </div>
                </li>
              )}
              {profile.email && (
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="text-sm">
                    <p className="text-slate-400 text-xs font-medium">E-mail</p>
                    <p className="font-semibold truncate max-w-[180px] text-slate-900 dark:text-white">{profile.email}</p>
                  </div>
                </li>
              )}
              {profile.phone && (
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center text-teal-600">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div className="text-sm">
                    <p className="text-slate-400 text-xs font-medium">Telefone</p>
                    <p className="font-semibold text-slate-900 dark:text-white">{profile.phone}</p>
                  </div>
                </li>
              )}
              {profile.location && (
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center text-orange-600">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="text-sm">
                    <p className="text-slate-400 text-xs font-medium">Localização</p>
                    <p className="font-semibold text-xs text-slate-900 dark:text-white">{profile.location}</p>
                  </div>
                </li>
              )}
            </ul>
          </div>

        </aside>

        {/* Main Content */}
        <main className="col-span-12 lg:col-span-8 space-y-4">
          {activeTab === 'timeline' && (
            <>
              {/* Box de Criar Post (apenas para o próprio perfil) */}
              {isOwnProfile && (
                <div className="bg-gradient-to-br from-white to-slate-50 rounded-2xl border border-slate-200/80 shadow-lg shadow-slate-200/50 overflow-visible">
                  {/* Header do Post */}
                  <div className="p-4 pb-3">
                    <div className="flex gap-3">
                      <div className="relative">
                        <Avatar src={profile?.avatar_url} name={profile?.name || 'Usuário'} size="md" />
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
                            {filteredProfiles.map((p) => (
                              <button
                                key={p.user_id}
                                onClick={() => insertMention(p)}
                                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                                type="button"
                              >
                                <Avatar src={p.avatar_url} name={p.name} size="sm" />
                                <div>
                                  <p className="text-sm font-medium text-slate-900">{p.name}</p>
                                  <p className="text-xs text-slate-500">{p.role}</p>
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
                                  type="button"
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
                                type="button"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

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
                                      type="button"
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
                                type="button"
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
                            type="button"
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
                                    type="button"
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
                              type="button"
                            >
                              <Plus className="w-4 h-4" />
                              Adicionar opção
                            </button>
                          )}
                        </div>

                        {/* Configurações */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                          <div
                            className="flex items-center gap-2 p-3 bg-white rounded-xl border-2 border-slate-100 hover:border-blue-200 transition-all cursor-pointer"
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
                            {allProfiles.map((p) => (
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
              )}

              {loadingPosts ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : userPosts.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
                  <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">Nenhuma publicação ainda</p>
                </div>
              ) : (
                userPosts.map((post) => (
                  <div key={post.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Post Header */}
                    <div className="p-3 pb-2 flex gap-3">
                      <Avatar src={post.author?.avatar_url} name={post.author?.name || 'Usuário'} />
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button 
                            onClick={() => handleNavigate('perfil', { userId: post.author_id })}
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
                                  <span
                                    key={tag}
                                    className={`${tagConfig.color} text-[10px] font-medium px-2 py-0.5 rounded-full`}
                                  >
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

                    {/* Post Content */}
                    <div className="px-3 py-2">
                      <div className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">
                        {renderContentWithMentions(post.content)}
                      </div>

                      {/* Poll */}
                      {postPolls.has(post.id) && (() => {
                        const poll = postPolls.get(post.id)!;
                        const totalVotes = poll.total_votes || 0;
                        return (
                          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100 mt-3">
                            <div className="flex items-center gap-2 mb-3">
                              <BarChart2 className="w-5 h-5 text-indigo-600" />
                              <span className="font-bold text-indigo-900">{poll.question}</span>
                            </div>
                            <div className="space-y-2">
                              {poll.options.map((opt, idx) => {
                                const percentage = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                                const hasVoted = poll.user_votes?.includes(idx);
                                return (
                                  <div
                                    key={idx}
                                    className={`relative overflow-hidden rounded-lg border ${
                                      hasVoted ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'
                                    }`}
                                  >
                                    <div
                                      className={`absolute inset-y-0 left-0 ${hasVoted ? 'bg-indigo-200' : 'bg-slate-100'}`}
                                      style={{ width: `${percentage}%` }}
                                    />
                                    <div className="relative flex items-center justify-between px-3 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
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
                                  </div>
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

                      {/* Attachments */}
                      {post.attachments && post.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {post.attachments
                            .filter((a: any) => a.kind === 'image' && a.signedUrl && a.signedUrl.trim() !== '')
                            .map((a: any, idx: number) => (
                              <button
                                key={a.filePath}
                                onClick={() => openImageGallery(post.attachments || [], idx)}
                                className="h-32 w-32 object-cover rounded-lg border border-slate-200 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all"
                              >
                                <img
                                  src={a.signedUrl}
                                  className="h-full w-full object-cover rounded-lg"
                                  alt={a.fileName}
                                />
                              </button>
                            ))}
                        </div>
                      )}

                      {post.preview_data && Object.keys(post.preview_data).length > 0 && (
                        <div className="space-y-2 mt-3">
                          {post.preview_data.financeiro && (
                            <div
                              className="bg-emerald-50 border border-emerald-200 border-l-4 border-l-emerald-500 rounded-lg p-3 cursor-pointer hover:bg-emerald-100/60 transition-colors"
                              onClick={() => handleNavigate('financeiro')}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2">
                                  <DollarSign className="w-4 h-4 text-emerald-600 mt-0.5" />
                                  <div>
                                    <p className="text-emerald-900 font-semibold text-sm">
                                      {financialDetailsByPostId[post.id]?.client_name ? `Acordo Financeiro • ${financialDetailsByPostId[post.id]?.client_name}` : 'Resumo Financeiro'}
                                    </p>
                                    {financialDetailsByPostId[post.id]?.description && (
                                      <p className="text-slate-600 text-xs mt-0.5">
                                        {String(financialDetailsByPostId[post.id]?.description)}
                                      </p>
                                    )}
                                    {financialDetailsByPostId[post.id]?.total_value != null ? (
                                      <p className="text-slate-600 text-xs mt-0.5">
                                        Total {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financialDetailsByPostId[post.id]?.total_value || 0)}
                                        {financialDetailsByPostId[post.id]?.installments_count && (financialDetailsByPostId[post.id]?.installments_count || 0) > 1
                                          ? ` • ${(financialDetailsByPostId[post.id]?.installments_count || 0)}x de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(financialDetailsByPostId[post.id]?.installment_value || 0)}`
                                          : ''}
                                      </p>
                                    ) : (
                                      <p className="text-slate-600 text-xs mt-0.5">
                                        Recebido {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(post.preview_data.financeiro.recebido || 0)}
                                        • Pendente {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(post.preview_data.financeiro.pendente || 0)}
                                        • Atrasado {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(post.preview_data.financeiro.atrasado || 0)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {financialDetailsByPostId[post.id]?.status && (
                                  <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/70 border border-emerald-200/80 text-emerald-700">
                                    {String(financialDetailsByPostId[post.id]?.status)}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {post.preview_data.cliente && (
                            <div
                              className="bg-blue-50 border border-blue-200 border-l-4 border-l-blue-500 rounded-lg p-3 cursor-pointer hover:bg-blue-100/60 transition-colors"
                              onClick={() => handleNavigate('clientes', { selectedId: post.preview_data.cliente?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                                  <Users className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.cliente.nome}</p>
                                  <p className="text-slate-600 text-xs">
                                    {post.preview_data.cliente.cpf || post.preview_data.cliente.telefone || 'Cliente'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {post.preview_data.processo && (
                            <div
                              className="bg-purple-50 border border-purple-200 border-l-4 border-l-purple-500 rounded-lg p-3 cursor-pointer hover:bg-purple-100/60 transition-colors"
                              onClick={() => handleNavigate('processos', { selectedId: post.preview_data.processo?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600">
                                  <Gavel className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.processo.numero}</p>
                                  <p className="text-slate-600 text-xs">{post.preview_data.processo.cliente} • {post.preview_data.processo.status}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {post.preview_data.prazo && (
                            <div
                              className="bg-red-50 border border-red-200 border-l-4 border-l-red-500 rounded-lg p-3 cursor-pointer hover:bg-red-100/60 transition-colors"
                              onClick={() => handleNavigate('prazos', { selectedId: post.preview_data.prazo?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center text-red-600">
                                  <Clock className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.prazo.titulo}</p>
                                  <p className="text-slate-600 text-xs">{post.preview_data.prazo.data} • {post.preview_data.prazo.tipo}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {post.preview_data.agenda && (
                            <div
                              className="bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 rounded-lg p-3 cursor-pointer hover:bg-amber-100/60 transition-colors"
                              onClick={() => handleNavigate('agenda', { selectedId: post.preview_data.agenda?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600">
                                  <Calendar className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.agenda.titulo}</p>
                                  <p className="text-slate-600 text-xs">{post.preview_data.agenda.data} {post.preview_data.agenda.hora && `às ${post.preview_data.agenda.hora}`}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {post.preview_data.documento && (
                            <div
                              className="bg-indigo-50 border border-indigo-200 border-l-4 border-l-indigo-500 rounded-lg p-3 cursor-pointer hover:bg-indigo-100/60 transition-colors"
                              onClick={() => handleNavigate('documentos', { selectedId: post.preview_data.documento?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                                  <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.documento.nome}</p>
                                  <p className="text-slate-600 text-xs">{post.preview_data.documento.tipo || 'Documento'}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {post.preview_data.peticao && (
                            <div
                              className="bg-cyan-50 border border-cyan-200 border-l-4 border-l-cyan-500 rounded-lg p-3 cursor-pointer hover:bg-cyan-100/60 transition-colors"
                              onClick={() => handleNavigate('peticoes', { selectedId: post.preview_data.peticao?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-cyan-100 rounded-lg flex items-center justify-center text-cyan-600">
                                  <FileSignature className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.peticao.nome}</p>
                                  <p className="text-slate-600 text-xs">{post.preview_data.peticao.tipo || 'Petição'}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {post.preview_data.assinatura && (
                            <div
                              className="bg-pink-50 border border-pink-200 border-l-4 border-l-pink-500 rounded-lg p-3 cursor-pointer hover:bg-pink-100/60 transition-colors"
                              onClick={() => handleNavigate('assinaturas', { selectedId: post.preview_data.assinatura?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-pink-100 rounded-lg flex items-center justify-center text-pink-600">
                                  <PenTool className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.assinatura.nome}</p>
                                  <p className="text-slate-600 text-xs">
                                    {post.preview_data.assinatura.cliente || 'Assinatura'} • {post.preview_data.assinatura.status === 'signed' ? 'Assinado' : 'Pendente'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {post.preview_data.requerimento && (
                            <div
                              className="bg-orange-50 border border-orange-200 border-l-4 border-l-orange-500 rounded-lg p-3 cursor-pointer hover:bg-orange-100/60 transition-colors"
                              onClick={() => handleNavigate('requerimentos', { selectedId: post.preview_data.requerimento?.id || '' })}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600">
                                  <Briefcase className="w-5 h-5" />
                                </div>
                                <div>
                                  <p className="text-slate-900 font-semibold text-sm">{post.preview_data.requerimento.protocolo || post.preview_data.requerimento.beneficiario}</p>
                                  <p className="text-slate-600 text-xs">{post.preview_data.requerimento.tipo} • {post.preview_data.requerimento.status}</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Ações (minimalista) */}
                    <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500 border-t border-slate-100 bg-slate-50/40">
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => handleToggleLike(post.id, (post as any).liked_by_me || false)}
                          className={`inline-flex items-center gap-1.5 hover:text-blue-600 transition-colors ${(post as any).liked_by_me ? 'text-blue-600' : 'text-slate-600'}`}
                        >
                          <ThumbsUp className={`w-4 h-4 ${(post as any).liked_by_me ? 'fill-current' : ''}`} />
                          {(post as any).liked_by_me ? 'Gostei' : 'Curtir'}
                        </button>
                        <button 
                          onClick={() => toggleInlineComments(post.id)}
                          className={`inline-flex items-center gap-1.5 hover:text-blue-600 transition-colors ${expandedComments[post.id] ? 'text-blue-600' : 'text-slate-600'}`}
                        >
                          <MessageCircle className="w-4 h-4" />
                          Comentar
                        </button>
                      </div>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => openInteractionModal('likes', post.id)}
                          className="hover:text-slate-700 transition-colors"
                        >
                          {(post.likes_count || 0) > 0
                            ? `${post.likes_count} curtida${post.likes_count !== 1 ? 's' : ''}`
                            : 'Seja o primeiro'}
                        </button>
                        <button
                          onClick={() => toggleInlineComments(post.id)}
                          className="hover:text-slate-700 transition-colors"
                        >
                          {post.comments_count || 0} comentário{(post.comments_count || 0) !== 1 ? 's' : ''}
                        </button>
                      </div>
                    </div>

                    {/* Comentários inline (abaixo do post) */}
                    {expandedComments[post.id] && (
                      <div className="border-t border-slate-100">
                        <div className="px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
                          {expandedComments[post.id].loading ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                            </div>
                          ) : expandedComments[post.id].comments.length === 0 ? (
                            <p className="text-slate-400 text-sm text-center py-2">Seja o primeiro a comentar!</p>
                          ) : (
                            expandedComments[post.id].comments.map((c, idx) => (
                              <div key={`${c.user_id}-${idx}`} className="flex gap-2">
                                <button
                                  onClick={() => handleNavigate('perfil', { userId: c.user_id })}
                                  className="flex-shrink-0"
                                >
                                  <Avatar src={c.avatar_url} name={c.name} size="sm" />
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
                                  <div className="flex items-center gap-3 mt-1 ml-2">
                                    <span className="text-[10px] text-slate-400">
                                      {new Date(c.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setExpandedComments((prev) => ({
                                          ...prev,
                                          [post.id]: { ...prev[post.id], newComment: `@${c.name} ` },
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

                        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                          <div className="flex gap-2 items-center">
                            <Avatar src={myProfile?.avatar_url || profile?.avatar_url} name={myProfile?.name || profile?.name || 'Você'} size="sm" />
                            <input
                              type="text"
                              value={expandedComments[post.id]?.newComment || ''}
                              onChange={(e) =>
                                setExpandedComments((prev) => ({
                                  ...prev,
                                  [post.id]: { ...prev[post.id], newComment: e.target.value },
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleCreateInlineComment(post.id);
                                }
                              }}
                              placeholder={`Comente como ${myProfile?.name || profile?.name || 'você'}...`}
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

                    {/* Modal de curtidas */}
                    {interactionModal.open && interactionModal.type === 'likes' && (
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
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Modal de galeria de imagens */}
                    {imageGalleryModal.open && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100/95 p-4">
                        <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
                          <div className="flex items-center justify-between p-4 border-b border-slate-200">
                            <h3 className="font-bold text-slate-900">
                              {imageGalleryModal.currentIndex + 1} de {imageGalleryModal.images.length}
                            </h3>
                            <button onClick={closeImageGallery} className="text-slate-400 hover:text-slate-600">
                              <X className="w-6 h-6" />
                            </button>
                          </div>
                          <div className="flex-1 flex items-center justify-center p-6 bg-slate-50/50">
                            <div className="relative w-full h-full flex items-center justify-center">
                              {imageGalleryModal.images.length > 1 && (
                                <button
                                  onClick={prevImage}
                                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 rounded-full p-2 shadow-lg border border-slate-200 transition-all"
                                >
                                  <ChevronLeft className="w-6 h-6" />
                                </button>
                              )}
                              <img
                                src={imageGalleryModal.images[imageGalleryModal.currentIndex]?.url}
                                alt={imageGalleryModal.images[imageGalleryModal.currentIndex]?.fileName}
                                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-md"
                              />
                              {imageGalleryModal.images.length > 1 && (
                                <button
                                  onClick={nextImage}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white text-slate-700 hover:text-slate-900 rounded-full p-2 shadow-lg border border-slate-200 transition-all"
                                >
                                  <ChevronRight className="w-6 h-6" />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="p-4 border-t border-slate-200 bg-slate-50/50">
                            <p className="text-sm text-slate-600 text-center truncate">
                              {imageGalleryModal.images[imageGalleryModal.currentIndex]?.fileName}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === 'about' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h3 className="font-bold text-slate-900 mb-4">Sobre {profile.name}</h3>
              
              {profile.bio ? (
                <p className="text-slate-700 mb-6">{profile.bio}</p>
              ) : (
                <p className="text-slate-500 italic mb-6">Nenhuma biografia adicionada.</p>
              )}

              <div className="space-y-4">
                <h4 className="font-semibold text-slate-800">Informações de contato</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {profile.email && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <Mail className="w-5 h-5 text-slate-400" />
                      <div>
                        <p className="text-xs text-slate-500">Email</p>
                        <p className="text-sm text-slate-700">{profile.email}</p>
                      </div>
                    </div>
                  )}
                  {profile.phone && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <Phone className="w-5 h-5 text-slate-400" />
                      <div>
                        <p className="text-xs text-slate-500">Telefone</p>
                        <p className="text-sm text-slate-700">{profile.phone}</p>
                      </div>
                    </div>
                  )}
                  {profile.oab && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <Scale className="w-5 h-5 text-slate-400" />
                      <div>
                        <p className="text-xs text-slate-500">OAB</p>
                        <p className="text-sm text-slate-700">{profile.oab}</p>
                      </div>
                    </div>
                  )}
                  {profile.role && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <Briefcase className="w-5 h-5 text-slate-400" />
                      <div>
                        <p className="text-xs text-slate-500">Cargo</p>
                        <p className="text-sm text-slate-700">{profile.role}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab Dados Pessoais */}
          {activeTab === 'dados' && isOwnProfile && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
              <h3 className="font-bold text-slate-900 dark:text-white mb-6">Dados Pessoais</h3>
              
              {message && (
                <div className={`mb-6 p-4 rounded-xl border ${
                  message.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-200'
                    : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200'
                }`}>
                  <p className="text-sm font-medium">{message.text}</p>
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Nome Completo
                    </label>
                    <input
                      type="text"
                      value={profileForm.name}
                      onChange={(e) => handleProfileChange('name', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => handleProfileChange('email', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      CPF
                    </label>
                    <input
                      type="text"
                      value={profileForm.cpf}
                      onChange={(e) => handleProfileChange('cpf', formatCpf(e.target.value))}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="000.000.000-00"
                      maxLength={14}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Telefone
                    </label>
                    <input
                      type="tel"
                      value={profileForm.phone}
                      onChange={(e) => handleProfileChange('phone', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      OAB
                    </label>
                    <input
                      type="text"
                      value={profileForm.oab}
                      onChange={(e) => handleProfileChange('oab', e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      placeholder="UF 123456"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Cargo
                    </label>
                    <input
                      type="text"
                      value={profileForm.role}
                      disabled
                      className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-400 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Biografia
                  </label>
                  <textarea
                    value={profileForm.bio}
                    onChange={(e) => handleProfileChange('bio', e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                    placeholder="Fale sobre sua formação, especializações e áreas de atuação..."
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Salvar Alterações
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab Segurança */}
          {activeTab === 'security' && isOwnProfile && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
              <h3 className="font-bold text-slate-900 dark:text-white mb-6">Segurança</h3>
              
              {message && (
                <div className={`mb-6 p-4 rounded-xl border ${
                  message.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-200'
                    : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200'
                }`}>
                  <p className="text-sm font-medium">{message.text}</p>
                </div>
              )}

              <div className="space-y-8">
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Alterar Senha</h4>
                  <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Nova Senha
                      </label>
                      <input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Confirmar Senha
                      </label>
                      <input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {saving ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Atualizando...
                          </>
                        ) : (
                          <>
                            <Shield className="w-4 h-4" />
                            Atualizar Senha
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                  <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Detalhes da Conta</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">ID do Usuário</p>
                      <p className="text-sm font-mono text-slate-900 dark:text-white truncate">{user?.id}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Criado em</p>
                      <p className="text-sm text-slate-900 dark:text-white">
                        {user?.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab Estatísticas */}
          {activeTab === 'stats' && isOwnProfile && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
              <h3 className="font-bold text-slate-900 dark:text-white mb-6">Estatísticas do Sistema</h3>
              
              {/* Estatísticas do Feed */}
              <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Feed & Engajamento</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-blue-500 rounded-lg">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{userPosts.length}</span>
                  </div>
                  <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">Publicações</p>
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-emerald-500 rounded-lg">
                      <ThumbsUp className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {userPosts.reduce((sum, p) => sum + (p.likes_count || 0), 0)}
                    </span>
                  </div>
                  <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">Curtidas Recebidas</p>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-500 rounded-lg">
                      <MessageCircle className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {userPosts.reduce((sum, p) => sum + (p.comments_count || 0), 0)}
                    </span>
                  </div>
                  <p className="text-sm text-purple-700 dark:text-purple-300 font-medium">Comentários</p>
                </div>

              </div>

              {/* Estatísticas do Sistema */}
              <h4 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Dados do Escritório</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/20 dark:to-indigo-800/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-indigo-500 rounded-lg">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.totalClients}</span>
                  </div>
                  <p className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">Clientes</p>
                </div>

                <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-900/20 dark:to-cyan-800/20 border border-cyan-200 dark:border-cyan-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-cyan-500 rounded-lg">
                      <Briefcase className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">{stats.totalCases}</span>
                  </div>
                  <p className="text-sm text-cyan-700 dark:text-cyan-300 font-medium">Processos</p>
                </div>

                <div className="bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-900/20 dark:to-teal-800/20 border border-teal-200 dark:border-teal-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-teal-500 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-teal-600 dark:text-teal-400">{stats.completedTasks}/{stats.totalTasks}</span>
                  </div>
                  <p className="text-sm text-teal-700 dark:text-teal-300 font-medium">Tarefas Concluídas</p>
                </div>

                <div className="bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/20 dark:to-rose-800/20 border border-rose-200 dark:border-rose-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-rose-500 rounded-lg">
                      <Calendar className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">{stats.totalEvents}</span>
                  </div>
                  <p className="text-sm text-rose-700 dark:text-rose-300 font-medium">Compromissos</p>
                </div>

                <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-orange-500 rounded-lg">
                      <Gavel className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">{stats.totalIntimacoes}</span>
                  </div>
                  <p className="text-sm text-orange-700 dark:text-orange-300 font-medium">Intimações DJEN</p>
                </div>
              </div>

              <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <strong>Dica:</strong> Estas estatísticas refletem os dados reais do sistema. Mantenha seu perfil atualizado e participe ativamente para melhorar sua visibilidade na equipe.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modal de Seleção de Capa */}
      {showCoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Escolher Capa</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Selecione uma capa predefinida para seu perfil</p>
              </div>
              <button
                onClick={() => setShowCoverModal(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {LEGAL_BANNERS.map((banner) => (
                  <button
                    key={banner.id}
                    onClick={() => handleSelectCover(banner.url)}
                    className="relative group rounded-xl overflow-hidden border-2 border-transparent hover:border-blue-500 transition-all"
                  >
                    <img
                      src={banner.url}
                      alt={banner.name}
                      className="w-full h-32 object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                      <span className="text-white text-sm font-medium">{banner.name}</span>
                    </div>
                    {profile.cover_url === banner.url && (
                      <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full p-1">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfilePage;
