import React, { useState, useEffect, useCallback } from 'react';
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
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profileService, type Profile } from '../services/profile.service';
import { feedPostsService, type FeedPost } from '../services/feedPosts.service';
import { feedPollsService, type FeedPoll } from '../services/feedPolls.service';
import { supabase } from '../config/supabase';

interface UserProfilePageProps {
  userId?: string;
  onClose?: () => void;
  onNavigateToModule?: (moduleKey: string) => void;
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
      <div
        className={`${sizeClasses[size]} rounded-full bg-cover bg-center bg-no-repeat border-4 border-white shadow-lg shrink-0`}
        style={{ backgroundImage: `url(${src})` }}
      />
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
  const [loading, setLoading] = useState(true);
  const [userPosts, setUserPosts] = useState<FeedPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postPolls, setPostPolls] = useState<Map<string, FeedPoll>>(new Map());
  const [activeTab, setActiveTab] = useState<'timeline' | 'about'>('timeline');
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const targetUserId = userId || user?.id;

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
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
    } finally {
      setLoading(false);
    }
  }, [targetUserId, user?.id]);

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

      setUserPosts(postsWithAuthors as FeedPost[]);

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
    <div className="space-y-4">
      {/* Cover Photo */}
      <div className="relative h-48 md:h-64 lg:h-80 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 rounded-b-2xl overflow-hidden">
        {profile.cover_url && (
          <img
            src={profile.cover_url}
            alt="Capa"
            className="w-full h-full object-cover"
          />
        )}
        
        {isOwnProfile && (
          <label className="absolute bottom-4 right-4 flex items-center gap-2 bg-white/90 hover:bg-white px-3 py-2 rounded-lg cursor-pointer shadow-lg transition-colors">
            <Camera className="w-4 h-4 text-slate-700" />
            <span className="text-sm font-medium text-slate-700">
              {uploadingCover ? 'Enviando...' : 'Editar capa'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadCover(file);
              }}
              disabled={uploadingCover}
            />
          </label>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 bg-black/30 hover:bg-black/50 text-white p-2 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Profile Header */}
      <div className="relative px-4 lg:px-8 -mt-16 md:-mt-20">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          {/* Avatar */}
          <div className="relative">
            <Avatar src={profile.avatar_url} name={profile.name || 'Usuário'} size="2xl" />
            {isOwnProfile && (
              <label className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow-lg cursor-pointer hover:bg-slate-50 transition-colors">
                <Camera className="w-4 h-4 text-slate-700" />
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
          <div className="flex-1 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{profile.name}</h1>
              <BadgeIcon badge={profile.badge} />
            </div>
            <p className="text-slate-600 mt-1">{profile.role || 'Membro da equipe'}</p>
            {profile.bio && (
              <p className="text-slate-700 mt-2 max-w-2xl">{profile.bio}</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pb-2">
            {isOwnProfile ? (
              <button className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium transition-colors">
                <Edit3 className="w-4 h-4" />
                Editar perfil
              </button>
            ) : (
              <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                <MessageCircle className="w-4 h-4" />
                Mensagem
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 px-4 lg:px-8">
        <nav className="flex gap-1">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'timeline'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Publicações
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'about'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Sobre
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="px-4 lg:px-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Sidebar - Info */}
        <div className="lg:col-span-1 space-y-4">
          {/* Intro Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="font-bold text-slate-900 mb-3">Informações</h3>
            <div className="space-y-3">
              {profile.role && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Briefcase className="w-5 h-5 text-slate-400" />
                  <span>{profile.role}</span>
                </div>
              )}
              {profile.oab && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Scale className="w-5 h-5 text-slate-400" />
                  <span>OAB: {profile.oab}</span>
                </div>
              )}
              {profile.email && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Mail className="w-5 h-5 text-slate-400" />
                  <span className="truncate">{profile.email}</span>
                </div>
              )}
              {profile.phone && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Phone className="w-5 h-5 text-slate-400" />
                  <span>{profile.phone}</span>
                </div>
              )}
              {profile.location && (
                <div className="flex items-center gap-3 text-slate-600">
                  <MapPin className="w-5 h-5 text-slate-400" />
                  <span>{profile.location}</span>
                </div>
              )}
              {profile.joined_at && (
                <div className="flex items-center gap-3 text-slate-600">
                  <Calendar className="w-5 h-5 text-slate-400" />
                  <span>Membro desde {new Date(profile.joined_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                </div>
              )}
            </div>
          </div>

          {/* Stats Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h3 className="font-bold text-slate-900 mb-3">Estatísticas</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-600">{userPosts.length}</p>
                <p className="text-xs text-slate-500">Publicações</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-2xl font-bold text-emerald-600">
                  {userPosts.reduce((sum, p) => sum + (p.likes_count || 0), 0)}
                </p>
                <p className="text-xs text-slate-500">Curtidas</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content - Posts */}
        <div className="lg:col-span-2 space-y-4">
          {activeTab === 'timeline' && (
            <>
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
                  <div key={post.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Post Header */}
                    <div className="p-4 pb-2 flex gap-3">
                      <Avatar src={post.author?.avatar_url} name={post.author?.name || 'Usuário'} />
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-slate-900 font-bold text-sm">{post.author?.name || 'Usuário'}</p>
                          <BadgeIcon badge={post.author?.badge} />
                        </div>
                        <p className="text-slate-500 text-xs">
                          {post.author?.role || 'Membro'} • {formatTimeAgo(post.created_at)}
                        </p>
                      </div>
                    </div>

                    {/* Post Content */}
                    <div className="px-4 py-2">
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
                            .filter((a: any) => a.kind === 'image')
                            .map((a: any) => (
                              <img
                                key={a.filePath}
                                src={a.signedUrl || ''}
                                className="h-32 w-32 object-cover rounded-lg border border-slate-200"
                                alt={a.fileName}
                              />
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Post Stats */}
                    <div className="px-4 py-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 mt-2">
                      <div className="flex items-center gap-1">
                        <div className="flex -space-x-1.5">
                          <div className="w-5 h-5 rounded-full bg-blue-500 border border-white flex items-center justify-center">
                            <ThumbsUp className="w-2.5 h-2.5 text-white" />
                          </div>
                          {(post.likes_count || 0) > 5 && (
                            <div className="w-5 h-5 rounded-full bg-red-500 border border-white flex items-center justify-center">
                              <Heart className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <span className="ml-1 font-medium text-slate-600">
                          {(post.likes_count || 0) > 0 ? `${post.likes_count} curtida${post.likes_count !== 1 ? 's' : ''}` : ''}
                        </span>
                      </div>
                      <span className="font-medium text-slate-600">
                        {post.comments_count || 0} comentário{(post.comments_count || 0) !== 1 ? 's' : ''}
                      </span>
                    </div>
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
        </div>
      </div>
    </div>
  );
};

export default UserProfilePage;
