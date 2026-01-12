import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ArrowLeft,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  Loader2,
  ThumbsUp,
  Clock,
  Globe,
  Users,
  Lock,
  Shield
} from 'lucide-react';
import { feedPostsService, type FeedPost } from '../services/feedPosts.service';
import { profileService, type Profile } from '../services/profile.service';
import { useAuth } from '../contexts/AuthContext';

// Avatar component
const Avatar: React.FC<{ src?: string | null; name: string; size?: 'xs' | 'sm' | 'md' | 'lg' }> = ({ src, name, size = 'md' }) => {
  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
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

  if (diffMins < 1) return 'Agora';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

interface PostModalProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToProfile?: (userId: string) => void;
  onBackToFeed?: () => void;
  initialPost?: FeedPost | null; // Post já carregado do feed (evita nova requisição)
}

export const PostModal: React.FC<PostModalProps> = ({
  postId,
  isOpen,
  onClose,
  onNavigateToProfile,
  onBackToFeed,
  initialPost
}) => {
  const { user } = useAuth();
  const [post, setPost] = useState<FeedPost | null>(initialPost || null);
  const [loading, setLoading] = useState(!initialPost); // Se já tem post, não mostra loading
  const [error, setError] = useState<string | null>(null);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [comments, setComments] = useState<Array<{
    id: string;
    user_id: string;
    name: string;
    avatar_url?: string;
    content: string;
    created_at: string;
  }>>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [liking, setLiking] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);

  // Carregar perfis
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const profiles = await profileService.listMembers();
        setAllProfiles(profiles);
        if (user?.id) {
          const current = profiles.find(p => p.user_id === user.id) || null;
          setCurrentProfile(current);
        }
      } catch (err) {
        console.warn('Erro ao carregar perfis:', err);
      }
    };
    if (isOpen) {
      loadProfiles();
    }
  }, [isOpen, user?.id]);

  // Atualizar post quando initialPost mudar
  useEffect(() => {
    if (initialPost) {
      setPost(initialPost);
      setLoading(false);
    }
  }, [initialPost]);

  // Carregar post (só se não tiver initialPost)
  useEffect(() => {
    const loadPost = async () => {
      // Se já tem initialPost, não precisa buscar
      if (initialPost) {
        setPost(initialPost);
        setLoading(false);
        return;
      }
      
      if (!postId || !isOpen) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const fetchedPost = await feedPostsService.getPostById(postId);
        if (fetchedPost) {
          setPost(fetchedPost);
        } else {
          setError('Post não encontrado');
        }
      } catch (err) {
        console.error('Erro ao carregar post:', err);
        setError('Erro ao carregar o post');
      } finally {
        setLoading(false);
      }
    };

    loadPost();
  }, [postId, isOpen, initialPost]);

  // Carregar comentários
  useEffect(() => {
    const loadComments = async () => {
      if (!postId || !isOpen) return;
      
      setLoadingComments(true);
      try {
        const fetchedComments = await feedPostsService.getComments(postId);
        setComments(fetchedComments.map(c => ({
          id: c.id,
          user_id: c.author_id,
          name: c.author?.name || 'Usuário',
          avatar_url: c.author?.avatar_url || undefined,
          content: c.content,
          created_at: c.created_at
        })));
      } catch (err) {
        console.warn('Erro ao carregar comentários:', err);
      } finally {
        setLoadingComments(false);
      }
    };

    loadComments();
  }, [postId, isOpen]);

  // Curtir post
  const handleLike = useCallback(async () => {
    if (!post || liking) return;
    
    setLiking(true);
    try {
      if (post.liked_by_me) {
        await feedPostsService.unlikePost(post.id);
        setPost(prev => prev ? { ...prev, liked_by_me: false, likes_count: (prev.likes_count || 1) - 1 } : null);
      } else {
        await feedPostsService.likePost(post.id);
        setPost(prev => prev ? { ...prev, liked_by_me: true, likes_count: (prev.likes_count || 0) + 1 } : null);
      }
    } catch (err) {
      console.error('Erro ao curtir:', err);
    } finally {
      setLiking(false);
    }
  }, [post, liking]);

  // Enviar comentário
  const handleSubmitComment = useCallback(async () => {
    if (!newComment.trim() || submittingComment || !postId) return;
    
    setSubmittingComment(true);
    try {
      const createdComment = await feedPostsService.createComment(postId, newComment.trim());
      setComments(prev => [...prev, {
        id: createdComment.id,
        user_id: createdComment.author_id,
        name: createdComment.author?.name || currentProfile?.name || 'Você',
        avatar_url: createdComment.author?.avatar_url || currentProfile?.avatar_url || undefined,
        content: createdComment.content,
        created_at: createdComment.created_at
      }]);
      setNewComment('');
      setPost(prev => prev ? { ...prev, comments_count: (prev.comments_count || 0) + 1 } : null);
    } catch (err) {
      console.error('Erro ao comentar:', err);
    } finally {
      setSubmittingComment(false);
    }
  }, [newComment, submittingComment, postId, currentProfile]);

  // Renderizar conteúdo com menções clicáveis
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
      const mentionedProfile = allProfiles.find(p => {
        const profileName = (p.name || '').toLowerCase().trim();
        const mentionName = matchName.toLowerCase().trim();
        return profileName === mentionName || 
               profileName.includes(mentionName) || 
               mentionName.includes(profileName);
      });
      
      parts.push(
        <span
          key={`mention-${match.index}`}
          className="text-blue-600 font-semibold cursor-pointer hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            if (mentionedProfile && onNavigateToProfile) {
              onNavigateToProfile(mentionedProfile.user_id);
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
  }, [allProfiles, onNavigateToProfile]);

  // Ícone de visibilidade
  const getVisibilityIcon = () => {
    if (!post) return <Globe className="w-3 h-3" />;
    switch (post.visibility) {
      case 'private': return <Lock className="w-3 h-3" />;
      case 'team': return <Users className="w-3 h-3" />;
      default: return <Globe className="w-3 h-3" />;
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl max-h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ 
          colorScheme: 'light',
          backgroundColor: '#ffffff',
          color: '#1e293b'
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ backgroundColor: '#f8fafc', borderColor: '#e2e8f0' }}
        >
          <div className="flex items-center gap-3">
            {onBackToFeed && (
              <button
                onClick={onBackToFeed}
                className="p-1.5 rounded-full transition-colors"
                style={{ color: '#475569' }}
                title="Voltar ao Feed"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold" style={{ color: '#0f172a' }}>
              {post ? `Post de ${post.author?.name || 'Usuário'}` : 'Carregando...'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full transition-colors"
            style={{ color: '#475569' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#ffffff' }}>
          {loading ? (
            <div className="flex items-center justify-center py-20" style={{ backgroundColor: '#ffffff' }}>
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20" style={{ backgroundColor: '#ffffff', color: '#64748b' }}>
              <p>{error}</p>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Fechar
              </button>
            </div>
          ) : post ? (
            <>
              {/* Autor do post */}
              <div className="p-4" style={{ backgroundColor: '#ffffff' }}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => onNavigateToProfile?.(post.author?.user_id || '')}
                    className="flex-shrink-0"
                  >
                    <Avatar src={post.author?.avatar_url} name={post.author?.name || 'U'} size="md" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onNavigateToProfile?.(post.author?.user_id || '')}
                        className="font-semibold hover:underline"
                        style={{ color: '#0f172a' }}
                      >
                        {post.author?.name || 'Usuário'}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: '#64748b' }}>
                      <span>{formatTimeAgo(post.created_at)}</span>
                      <span>•</span>
                      {getVisibilityIcon()}
                    </div>
                  </div>
                  <button className="p-1.5 hover:bg-slate-100 rounded-full">
                    <MoreHorizontal className="w-5 h-5" style={{ color: '#94a3b8' }} />
                  </button>
                </div>

                {/* Conteúdo do post - verificar se está banido */}
                {post.banned_at ? (
                  <div className="mt-4 py-8 flex flex-col items-center justify-center bg-gradient-to-br from-red-50 to-slate-50 rounded-xl border border-red-200/50">
                    <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                      <Shield className="w-8 h-8 text-red-500" />
                    </div>
                    <p className="text-red-700 font-bold text-lg">Conteúdo Removido</p>
                    <p className="text-red-500 text-sm mt-1 text-center px-4">
                      Este post foi banido por violar as diretrizes da comunidade
                    </p>
                    <p className="text-slate-400 text-xs mt-3">
                      Banido por {(post as any).banned_by_name || 'Administrador'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap" style={{ color: '#1e293b' }}>
                      {renderContentWithMentions(post.content)}
                    </div>

                    {/* Imagens/Anexos */}
                    {post.attachments && post.attachments.length > 0 && (
                      <div className="mt-3">
                        {post.attachments.filter(a => a.kind === 'image').map((a, idx) => (
                          <a
                            key={idx}
                            href={a.signedUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <img
                              src={a.signedUrl || ''}
                              alt={a.fileName}
                              className="w-full rounded-lg border border-slate-200"
                            />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Contadores */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                      <div className="flex items-center gap-1 text-sm text-slate-500">
                        {(post.likes_count || 0) > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                              <ThumbsUp className="w-3 h-3 text-white" />
                            </span>
                            {post.likes_count}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-slate-500">
                        {(post.comments_count || 0) > 0 && (
                          <span>{post.comments_count} comentário{(post.comments_count || 0) !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>

                    {/* Botões de ação */}
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
                      <button
                        onClick={handleLike}
                        disabled={liking}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-colors ${
                          post.liked_by_me 
                            ? 'text-blue-600 hover:bg-blue-50' 
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <ThumbsUp className={`w-5 h-5 ${post.liked_by_me ? 'fill-current' : ''}`} />
                        <span className="font-medium">Curtir</span>
                      </button>
                      <button
                        onClick={() => commentInputRef.current?.focus()}
                        className="flex-1 flex items-center justify-center gap-2 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <MessageCircle className="w-5 h-5" />
                        <span className="font-medium">Comentar</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Seção de comentários - só mostra se não está banido */}
              {!post.banned_at && (
              <div style={{ borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                {/* Lista de comentários */}
                <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
                  {loadingComments ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#94a3b8' }} />
                    </div>
                  ) : comments.length === 0 ? (
                    <p className="text-center text-sm py-4" style={{ color: '#94a3b8' }}>
                      Seja o primeiro a comentar!
                    </p>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="flex gap-2">
                        <button
                          onClick={() => onNavigateToProfile?.(c.user_id)}
                          className="flex-shrink-0"
                        >
                          <Avatar src={c.avatar_url} name={c.name} size="sm" />
                        </button>
                        <div className="flex-1">
                          <div className="rounded-2xl px-3 py-2 shadow-sm" style={{ backgroundColor: '#ffffff' }}>
                            <button
                              onClick={() => onNavigateToProfile?.(c.user_id)}
                              className="text-sm font-semibold hover:underline"
                              style={{ color: '#0f172a' }}
                            >
                              {c.name}
                            </button>
                            <p className="text-sm" style={{ color: '#334155' }}>
                              {renderContentWithMentions(c.content)}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 mt-1 ml-3">
                            <span className="text-xs" style={{ color: '#94a3b8' }}>
                              {formatTimeAgo(c.created_at)}
                            </span>
                            <button className="text-xs font-semibold" style={{ color: '#64748b' }}>
                              Curtir
                            </button>
                            <button 
                              onClick={() => setNewComment(`@${c.name} `)}
                              className="text-xs font-semibold"
                              style={{ color: '#64748b' }}
                            >
                              Responder
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Input de comentário */}
                <div className="p-4" style={{ borderTop: '1px solid #e2e8f0', backgroundColor: '#ffffff' }}>
                  <div className="flex gap-2 items-center">
                    <Avatar 
                      src={currentProfile?.avatar_url} 
                      name={currentProfile?.name || 'Você'} 
                      size="sm" 
                    />
                    <div className="flex-1 flex gap-2">
                      <input
                        ref={commentInputRef}
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmitComment();
                          }
                        }}
                        placeholder="Escreva um comentário..."
                        className="flex-1 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 border border-transparent focus:border-blue-500"
                        style={{ backgroundColor: '#f1f5f9', color: '#1e293b' }}
                        disabled={submittingComment}
                      />
                      <button
                        onClick={handleSubmitComment}
                        disabled={!newComment.trim() || submittingComment}
                        className="p-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ color: '#2563eb' }}
                      >
                        {submittingComment ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Send className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </>

          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default PostModal;
