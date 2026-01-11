import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  MessageCircle,
  Send,
  ThumbsUp,
  Heart,
  Loader2,
  Hash,
  AtSign,
  X,
  MoreHorizontal,
  DollarSign,
  Users,
  Gavel,
  Clock,
  Calendar,
  FileText,
  Timer,
  Image,
  Smile
} from 'lucide-react';
import { feedPostsService, type FeedPost, type PreviewData, type TagRecord } from '../services/feedPosts.service';
import { profileService, type Profile } from '../services/profile.service';
import { useAuth } from '../contexts/AuthContext';

// Avatar component
const Avatar: React.FC<{ src?: string | null; name: string; size?: 'sm' | 'md' | 'lg' }> = ({ src, name, size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  };

  if (src) {
    return <img src={src} alt={name} className={`${sizeClasses[size]} rounded-full object-cover`} />;
  }

  const initials = name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold`}>
      {initials}
    </div>
  );
};

// Formatar tempo relativo
const formatTimeAgo = (dateString: string): string => {
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
  return date.toLocaleDateString('pt-BR');
};

// Formatar moeda
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

interface FeedWidgetProps {
  moduleContext?: string; // Ex: 'clientes', 'processos', 'financeiro'
  entityId?: string; // ID da entidade específica (cliente, processo, etc)
  entityName?: string; // Nome da entidade para exibição
  compact?: boolean; // Modo compacto para sidebars
  maxPosts?: number; // Limite de posts a exibir
  onNavigate?: (module: string) => void; // Callback para navegação
}

export const FeedWidget: React.FC<FeedWidgetProps> = ({
  moduleContext,
  entityId,
  entityName,
  compact = false,
  maxPosts = 10,
  onNavigate
}) => {
  const { user } = useAuth();
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postingInProgress, setPostingInProgress] = useState(false);
  const [postText, setPostText] = useState('');
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagRecords, setTagRecords] = useState<TagRecord[]>([]);
  const [loadingTagRecords, setLoadingTagRecords] = useState(false);
  const [selectedTagForRecords, setSelectedTagForRecords] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData>({});
  const postInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ localUrl: string; attachment: any }>>([]);

  // Tags disponíveis
  const availableTags = [
    { id: 'financeiro', label: 'Financeiro', icon: DollarSign, color: 'bg-emerald-100 text-emerald-700' },
    { id: 'processo', label: 'Processo', icon: Gavel, color: 'bg-purple-100 text-purple-700' },
    { id: 'prazo', label: 'Prazo', icon: Timer, color: 'bg-red-100 text-red-700' },
    { id: 'cliente', label: 'Cliente', icon: Users, color: 'bg-blue-100 text-blue-700' },
    { id: 'agenda', label: 'Agenda', icon: Calendar, color: 'bg-amber-100 text-amber-700' },
    { id: 'documento', label: 'Documento', icon: FileText, color: 'bg-indigo-100 text-indigo-700' },
  ];

  // Carregar perfil atual e todos os perfis
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const all = await profileService.listMembers();
        setAllProfiles(all);
        // Buscar perfil atual pelo user.id
        if (user?.id) {
          const current = all.find(p => p.user_id === user.id) || null;
          setCurrentProfile(current);
        }
      } catch (error) {
        console.warn('Erro ao carregar perfis:', error);
      }
    };
    loadProfiles();
  }, [user?.id]);

  // Carregar posts do feed
  const loadFeedPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const posts = await feedPostsService.getPosts(maxPosts, 0);
      // Filtrar por contexto se especificado
      let filteredPosts = posts;
      if (moduleContext) {
        filteredPosts = posts.filter(p => 
          p.tags.includes(moduleContext) || 
          (p.entity_references && p.entity_references.some(e => e.type === moduleContext))
        );
      }
      setFeedPosts(filteredPosts);
    } catch (error) {
      console.error('Erro ao carregar posts:', error);
    } finally {
      setLoadingPosts(false);
    }
  }, [maxPosts, moduleContext]);

  useEffect(() => {
    loadFeedPosts();
  }, [loadFeedPosts]);

  // Handler para input do post com menções
  const handlePostTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setPostText(value);

    // Detectar menções (@)
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1 && lastAtIndex === value.length - 1) {
      setShowMentionDropdown(true);
      setMentionSearch('');
    } else if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      if (spaceIndex === -1 && textAfterAt.length > 0) {
        setShowMentionDropdown(true);
        setMentionSearch(textAfterAt.toLowerCase());
      } else {
        setShowMentionDropdown(false);
      }
    } else {
      setShowMentionDropdown(false);
    }

    // Detectar tags (#)
    const lastHashIndex = value.lastIndexOf('#');
    if (lastHashIndex !== -1 && lastHashIndex === value.length - 1) {
      setShowTagDropdown(true);
    } else if (lastHashIndex !== -1) {
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

  // Carregar registros reais para uma tag
  const loadTagRecords = useCallback(async (tagId: string) => {
    setLoadingTagRecords(true);
    setSelectedTagForRecords(tagId);
    try {
      const records = await feedPostsService.getRecordsForTag(tagId, '', 10);
      setTagRecords(records);
    } catch (error) {
      console.error('Erro ao carregar registros:', error);
      setTagRecords([]);
    } finally {
      setLoadingTagRecords(false);
    }
  }, []);

  // Selecionar um registro e inserir texto formatado no post
  const selectTagRecord = useCallback((record: TagRecord) => {
    setPostText(prev => {
      const newText = prev.trim() ? `${prev} ${record.formattedText}` : record.formattedText;
      return newText;
    });
    
    if (selectedTagForRecords && !selectedTags.includes(selectedTagForRecords)) {
      setSelectedTags(prev => [...prev, selectedTagForRecords]);
    }
    
    setPreviewData(prev => ({ ...prev, ...record.previewData }));
    setSelectedTagForRecords(null);
    setTagRecords([]);
    setShowTagDropdown(false);
    postInputRef.current?.focus();
  }, [selectedTagForRecords, selectedTags]);

  // Fechar dropdown de registros
  const closeTagRecordsDropdown = useCallback(() => {
    setSelectedTagForRecords(null);
    setTagRecords([]);
  }, []);

  // Toggle tag
  const toggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter(t => t !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  // Filtrar perfis para menção
  const filteredProfiles = useMemo(() => {
    if (!mentionSearch) return allProfiles.slice(0, 5);
    return allProfiles
      .filter(p => p.name?.toLowerCase().includes(mentionSearch))
      .slice(0, 5);
  }, [allProfiles, mentionSearch]);

  // Renderizar conteúdo com menções clicáveis (azul)
  const renderContentWithMentions = useCallback((content: string) => {
    const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      const matchName = match[1];
      const mentionedProfile = allProfiles.find(p => p.name?.toLowerCase() === matchName.toLowerCase());
      parts.push(
        <span
          key={`mention-${match.index}`}
          className="text-blue-600 font-semibold cursor-pointer hover:underline"
          onClick={() => {
            if (mentionedProfile && onNavigate) {
              onNavigate('perfil');
            }
          }}
        >
          @{matchName}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  }, [allProfiles, onNavigate]);

  // Publicar post
  const handlePublishPost = useCallback(async () => {
    if (!postText.trim() || postingInProgress) return;
    
    setPostingInProgress(true);
    try {
      // Extrair menções do texto (@nome)
      const mentionMatches = postText.match(/@(\w+)/g) || [];
      const mentionedNames = mentionMatches.map(m => m.slice(1).toLowerCase());
      const mentionedIds = allProfiles
        .filter(p => mentionedNames.includes(p.name?.toLowerCase() || ''))
        .map(p => p.id);
      
      // Adicionar tag do contexto do módulo se existir
      const finalTags = [...selectedTags];
      if (moduleContext && !finalTags.includes(moduleContext)) {
        finalTags.push(moduleContext);
      }
      
      // Buscar dados de preview para tags selecionadas
      let finalPreviewData = { ...previewData };
      for (const tag of finalTags) {
        if (!Object.keys(finalPreviewData).includes(tag)) {
          try {
            const tagPreview = await feedPostsService.getPreviewDataForTag(tag);
            finalPreviewData = { ...finalPreviewData, ...tagPreview };
          } catch (e) {
            // Ignorar erro de preview
          }
        }
      }
      
      const newPost = await feedPostsService.createPost({
        content: postText,
        tags: finalTags,
        mentions: mentionedIds,
        entity_references: [],
        preview_data: finalPreviewData,
        attachments: pendingAttachments.map((p) => p.attachment)
      });
      
      setFeedPosts(prev => [newPost, ...prev]);
      setPostText('');
      setSelectedTags([]);
      setPreviewData({});
      pendingAttachments.forEach((p) => {
        try {
          URL.revokeObjectURL(p.localUrl);
        } catch {}
      });
      setPendingAttachments([]);
    } catch (error) {
      console.error('Erro ao publicar post:', error);
    } finally {
      setPostingInProgress(false);
    }
  }, [postText, selectedTags, previewData, allProfiles, postingInProgress, moduleContext, pendingAttachments]);

  // Dar/remover like
  const handleToggleLike = useCallback(async (postId: string, currentlyLiked: boolean) => {
    try {
      if (currentlyLiked) {
        await feedPostsService.unlikePost(postId);
      } else {
        await feedPostsService.likePost(postId);
      }
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
  }, []);

  // Navegação
  const handleNavigate = (module: string) => {
    if (onNavigate) {
      onNavigate(module);
    }
  };

  if (compact) {
    // Modo compacto para sidebars
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-blue-500" />
            Feed
          </h3>
          <span className="text-xs text-slate-500">{feedPosts.length} posts</span>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          {loadingPosts ? (
            <div className="p-4 text-center">
              <Loader2 className="w-5 h-5 mx-auto text-blue-500 animate-spin" />
            </div>
          ) : feedPosts.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">
              Nenhum post ainda
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {feedPosts.slice(0, 5).map(post => (
                <div key={post.id} className="p-3 hover:bg-slate-50">
                  <div className="flex items-start gap-2">
                    <Avatar src={post.author?.avatar_url} name={post.author?.name || 'U'} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">{post.author?.name}</p>
                      <p className="text-xs text-slate-600 line-clamp-2">{renderContentWithMentions(post.content)}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{formatTimeAgo(post.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
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
      </div>
    );
  }

  // Modo completo
  return (
    <div className="space-y-4">
      {/* Caixa de Postagem */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4">
          <div className="flex gap-3">
            <Avatar src={currentProfile?.avatar_url} name={currentProfile?.name || 'Usuário'} size="md" />
            <div className="flex-1 relative">
              <textarea
                ref={postInputRef}
                value={postText}
                onChange={handlePostTextChange}
                rows={2}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all resize-none text-sm"
                placeholder={entityName 
                  ? `Compartilhe uma atualização sobre ${entityName}...` 
                  : "Compartilhe uma atualização... Use @ para mencionar e # para tags"}
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
                      <Hash className="w-3 h-3" /> Selecione uma categoria
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

              {/* Dropdown de Registros da Tag */}
              {selectedTagForRecords && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50 max-h-80 overflow-y-auto">
                  <div className="p-2 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                    <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                      <Hash className="w-3 h-3" /> 
                      {availableTags.find(t => t.id === selectedTagForRecords)?.label || 'Registros'}
                    </span>
                    <button onClick={closeTagRecordsDropdown} className="text-slate-400 hover:text-slate-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {loadingTagRecords ? (
                    <div className="p-4 text-center">
                      <Loader2 className="w-5 h-5 mx-auto text-blue-500 animate-spin" />
                    </div>
                  ) : tagRecords.length === 0 ? (
                    <div className="p-4 text-center text-sm text-slate-500">
                      Nenhum registro encontrado
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
                  <span key={tagId} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${tag.color}`}>
                    <tag.icon className="w-3 h-3" />
                    #{tag.label}
                    <button onClick={() => toggleTag(tagId)} className="ml-1 hover:opacity-70">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Barra de Ações */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200">
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
            disabled={!postText.trim() || postingInProgress}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-bold transition-colors shadow-sm"
          >
            {postingInProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {postingInProgress ? 'Publicando...' : 'Publicar'}
          </button>
        </div>
      </div>

      {/* Feed de Posts */}
      <div className="space-y-4">
        {loadingPosts ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center">
            <Loader2 className="w-8 h-8 mx-auto mb-2 text-blue-500 animate-spin" />
            <p className="text-slate-500 text-sm">Carregando publicações...</p>
          </div>
        ) : feedPosts.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center text-blue-500 mb-3">
              <MessageCircle className="w-6 h-6" />
            </div>
            <p className="text-slate-900 font-bold">Sem publicações ainda</p>
            <p className="text-sm text-slate-500 mt-1">
              Use a caixa acima para compartilhar uma atualização.
            </p>
          </div>
        ) : (
          feedPosts.map((post) => (
            <div key={post.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Header do Post */}
              <div className="p-4 pb-2 flex gap-3">
                <Avatar src={post.author?.avatar_url} name={post.author?.name || 'Usuário'} />
                <div className="flex flex-col flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-slate-900 font-bold text-sm">{post.author?.name || 'Usuário'}</p>
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
                <button className="ml-auto text-slate-400 hover:text-slate-600">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
              
              {/* Conteúdo do Post */}
              <div className="px-4 py-2">
                <div className="text-slate-800 text-sm leading-relaxed whitespace-pre-wrap">{renderContentWithMentions(post.content)}</div>

                {post.attachments && post.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {post.attachments
                      .filter((a) => a.kind === 'image')
                      .map((a) => (
                        <a
                          key={a.filePath}
                          href={a.signedUrl || '#'}
                          target={a.signedUrl ? '_blank' : undefined}
                          rel={a.signedUrl ? 'noopener noreferrer' : undefined}
                          className="block"
                        >
                          <img
                            src={a.signedUrl || ''}
                            className="h-28 w-28 object-cover rounded-lg border border-slate-200"
                            alt={a.fileName}
                          />
                        </a>
                      ))}
                  </div>
                )}
                
                {/* Cards de Preview */}
                {post.preview_data && Object.keys(post.preview_data).length > 0 && (
                  <div className="space-y-2 mt-3">
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
                    
                    {post.preview_data.cliente && (
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleNavigate('clientes')}
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
                    
                    {post.preview_data.processo && (
                      <div 
                        className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleNavigate('processos')}
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
                    
                    {post.preview_data.prazo && (
                      <div 
                        className="bg-gradient-to-r from-red-500 to-red-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleNavigate('prazos')}
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
                    
                    {post.preview_data.agenda && (
                      <div 
                        className="bg-gradient-to-r from-amber-500 to-amber-600 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => handleNavigate('agenda')}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white">
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-white font-bold text-sm">{post.preview_data.agenda.titulo}</p>
                            <p className="text-white/80 text-xs">{post.preview_data.agenda.data} {post.preview_data.agenda.hora && `às ${post.preview_data.agenda.hora}`}</p>
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
                  <span className="ml-1 font-medium text-slate-600">
                    {post.likes_count > 0 ? `${post.likes_count} curtida${post.likes_count !== 1 ? 's' : ''}` : 'Seja o primeiro'}
                  </span>
                </div>
                <span className="font-medium text-slate-600">
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
                <button className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-slate-100 rounded-lg text-slate-600 text-sm font-medium transition-colors">
                  <MessageCircle className="w-5 h-5" />
                  Comentar
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FeedWidget;
