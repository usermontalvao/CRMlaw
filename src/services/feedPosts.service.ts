import { supabase } from '../config/supabase';
import { profileService, type Profile } from './profile.service';
import { userNotificationService } from './userNotification.service';

const FEED_ATTACHMENT_BUCKET = 'anexos_chat';

// Tipos para referências de entidades
export interface EntityReference {
  type: 'client' | 'process' | 'requirement' | 'deadline' | 'calendar' | 'document' | 'financial' | 'petition' | 'signature';
  id: string;
  name?: string;
  number?: string;
  extra?: Record<string, unknown>;
}

// Tipos para dados de preview
export interface PreviewData {
  financeiro?: {
    recebido: number;
    pendente: number;
    atrasado: number;
  };
  cliente?: {
    id: string;
    nome: string;
    cpf?: string;
    telefone?: string;
  };
  processo?: {
    id: string;
    numero: string;
    cliente: string;
    status: string;
  };
  prazo?: {
    id: string;
    titulo: string;
    data: string;
    tipo: string;
  };
  agenda?: {
    id: string;
    titulo: string;
    data: string;
    hora: string;
  };
  documento?: {
    id: string;
    nome: string;
    tipo: string;
  };
  peticao?: {
    id: string;
    nome: string;
    tipo: string;
  };
  assinatura?: {
    id: string;
    nome: string;
    cliente: string;
    status: string;
  };
  requerimento?: {
    id: string;
    protocolo: string;
    beneficiario: string;
    tipo: string;
    status: string;
  };
}

// Visibilidade do post
export type PostVisibility = 'public' | 'private' | 'team';

// Status do post
export type PostStatus = 'published' | 'scheduled' | 'draft';

// Tipo do post
export interface FeedPost {
  id: string;
  author_id: string;
  content: string;
  tags: string[];
  mentions: string[];
  entity_references: EntityReference[];
  preview_data: PreviewData;
  attachments?: FeedPostAttachment[];
  likes_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
  // Novos campos
  visibility: PostVisibility;
  scheduled_at: string | null;
  status: PostStatus;
  allowed_user_ids?: string[];
  allowed_roles?: string[];
  // Campos de banimento
  banned_at?: string | null;
  banned_by?: string | null;
  banned_reason?: string | null;
  banned_by_name?: string; // Nome do admin que baniu (populado)
  // Campos populados
  author?: Profile;
  liked_by_me?: boolean;
}

export interface FeedPostAttachment {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'file';
  signedUrl?: string;
}

// Tipo do comentário
export interface FeedPostComment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  author?: Profile;
}

// Tipo para registro com texto formatado (para inserção no post)
export interface TagRecord {
  id: string;
  label: string;
  sublabel: string;
  formattedText: string;
  previewData: PreviewData;
}

// DTO para criar post
export interface CreateFeedPostDTO {
  content: string;
  tags?: string[];
  mentions?: string[];
  entity_references?: EntityReference[];
  preview_data?: PreviewData;
  attachments?: Omit<FeedPostAttachment, 'signedUrl'>[];
  visibility?: PostVisibility;
  scheduled_at?: string | null;
  allowed_user_ids?: string[];
  allowed_roles?: string[];
}

class FeedPostsService {
  private makeFallbackAuthor(userId: string, name?: string, role?: string): Profile {
    const now = new Date().toISOString();
    return {
      id: userId,
      user_id: userId,
      name: name || 'Usuário',
      role: role || 'Membro',
      email: '',
      avatar_url: null,
      updated_at: now,
      created_at: now,
    };
  }

  private getFallbackFromUser(user: any): { name?: string; role?: string } {
    const meta = user?.user_metadata || {};
    const name = meta?.name || meta?.full_name || meta?.display_name || user?.email;
    const role = meta?.role || meta?.cargo;
    return { name, role };
  }

  private async hydrateAttachments(post: any): Promise<any> {
    const attachmentsRaw: unknown = post?.attachments;
    if (!Array.isArray(attachmentsRaw) || attachmentsRaw.length === 0) return post;

    const attachments = await Promise.all(
      attachmentsRaw.map(async (att: any) => {
        const filePath: string | undefined = att?.filePath;
        if (!filePath) return att;
        try {
          const { data, error } = await supabase.storage
            .from(FEED_ATTACHMENT_BUCKET)
            .createSignedUrl(filePath, 60 * 5);
          if (!error && data?.signedUrl) {
            return { ...att, signedUrl: data.signedUrl };
          }
        } catch {
          // ignore
        }
        return att;
      })
    );

    return { ...post, attachments };
  }

  async uploadAttachment(file: File): Promise<Omit<FeedPostAttachment, 'signedUrl'>> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const filePath = `feed/${user.id}/${crypto.randomUUID()}_${safeName}`;

    const { error } = await supabase.storage
      .from(FEED_ATTACHMENT_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (error) throw new Error(error.message);

    const kind: FeedPostAttachment['kind'] = file.type?.startsWith('image/') ? 'image' : 'file';

    return {
      filePath,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      kind,
    };
  }

  // Buscar perfis dos autores (opcional, não quebra se não existir)
  private async hydrateAuthors(posts: any[]): Promise<any[]> {
    if (!posts || posts.length === 0) return posts;

    // Coletar IDs de autores e admins que baniram
    const authorIds = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
    const bannedByIds = [...new Set(posts.map(p => p.banned_by).filter(Boolean))];
    const allUserIds = [...new Set([...authorIds, ...bannedByIds])];
    
    if (allUserIds.length === 0) return posts;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('user_id', allUserIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    return posts.map(post => ({
      ...post,
      author: profileMap.get(post.author_id) || this.makeFallbackAuthor(String(post.author_id)),
      banned_by_name: post.banned_by ? (profileMap.get(post.banned_by)?.name || 'Administrador') : undefined
    }));
  }

  private async hydrateCommentAuthors(comments: any[]): Promise<any[]> {
    if (!comments || comments.length === 0) return comments;

    const authorIds = [...new Set(comments.map((c) => c.author_id).filter(Boolean))];
    if (authorIds.length === 0) return comments;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('user_id', authorIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    return comments.map((comment) => ({
      ...comment,
      author: profileMap.get(comment.author_id) || this.makeFallbackAuthor(String(comment.author_id)),
    }));
  }

  // Buscar posts do feed (apenas publicados)
  async getPosts(limit = 20, offset = 0): Promise<FeedPost[]> {
    const { data: posts, error } = await supabase
      .from('feed_posts')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Erro ao buscar posts:', error);
      throw error;
    }

    // Buscar perfis dos autores
    const postsWithAuthors = await this.hydrateAuthors(posts || []);

    // Verificar se o usuário atual deu like em cada post
    const { data: { user } } = await supabase.auth.getUser();
    if (user && postsWithAuthors.length > 0) {
      const postIds = postsWithAuthors.map(p => p.id);
      const { data: likes } = await supabase
        .from('feed_post_likes')
        .select('post_id')
        .eq('user_id', user.id)
        .in('post_id', postIds);

      const likedPostIds = new Set(likes?.map(l => l.post_id) || []);

      const hydrated = await Promise.all(
        postsWithAuthors.map(async (post) => {
          const withLike = { ...post, liked_by_me: likedPostIds.has(post.id) };
          return this.hydrateAttachments(withLike);
        })
      );

      return hydrated;
    }

    const hydrated = await Promise.all(postsWithAuthors.map((post) => this.hydrateAttachments(post)));
    return hydrated;
  }

  // Buscar post por ID
  async getPostById(postId: string): Promise<FeedPost | null> {
    const { data: { user } } = await supabase.auth.getUser();
    
    const { data, error } = await supabase
      .from('feed_posts')
      .select('*')
      .eq('id', postId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar post:', error);
      return null;
    }

    if (!data) return null;

    // Hidratar autor e anexos
    const [hydrated] = await this.hydrateAuthors([data]);
    const withAttachments = await this.hydrateAttachments(hydrated);

    // Verificar se o usuário curtiu
    if (user) {
      const { data: like } = await supabase
        .from('feed_post_likes')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', user.id)
        .maybeSingle();
      
      withAttachments.liked_by_me = !!like;
    }

    return withAttachments;
  }

  // Criar novo post
  async createPost(dto: CreateFeedPostDTO): Promise<FeedPost> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    // Determinar status baseado em agendamento
    const isScheduled = dto.scheduled_at && new Date(dto.scheduled_at) > new Date();
    const status = isScheduled ? 'scheduled' : 'published';

    const { data, error } = await supabase
      .from('feed_posts')
      .insert({
        author_id: user.id,
        content: dto.content,
        tags: dto.tags || [],
        mentions: dto.mentions || [],
        entity_references: dto.entity_references || [],
        preview_data: dto.preview_data || {},
        attachments: dto.attachments || [],
        visibility: dto.visibility || 'public',
        scheduled_at: dto.scheduled_at || null,
        allowed_user_ids: dto.allowed_user_ids || [],
        allowed_roles: dto.allowed_roles || [],
        status
      })
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao criar post:', error);
      throw error;
    }

    // Criar notificações para usuários mencionados (salva no banco para o usuário mencionado ver)
    // IMPORTANTE: Em posts privados/equipe, só notifica se o mencionado está nos destinatários permitidos
    if (dto.mentions && dto.mentions.length > 0) {
      // Buscar nome do autor para a notificação
      let authorName = 'Usuário';
      try {
        const { data: authorData } = await supabase
          .from('profiles')
          .select('name')
          .eq('user_id', user.id)
          .maybeSingle();
        if (authorData?.name) authorName = authorData.name;
      } catch {
        // ignore
      }

      // Determinar quem pode ser notificado baseado na visibilidade
      const allowedUserIds = dto.allowed_user_ids || [];
      const isPublic = !dto.visibility || dto.visibility === 'public';

      for (const mentionedUserId of dto.mentions) {
        // Não notificar o próprio autor
        if (mentionedUserId === user.id) continue;

        // Se não é público, só notifica se o mencionado está na lista de destinatários
        if (!isPublic && !allowedUserIds.includes(mentionedUserId)) {
          console.log(`Menção ignorada: ${mentionedUserId} não está nos destinatários do post privado/equipe`);
          continue;
        }

        try {
          await userNotificationService.createNotification({
            user_id: mentionedUserId,
            type: 'mention',
            title: `${authorName} mencionou você`,
            message: dto.content.length > 100 
              ? dto.content.substring(0, 100) + '...' 
              : dto.content,
            metadata: {
              post_id: data.id,
              author_id: user.id,
              author_name: authorName
            }
          });
        } catch (notifError) {
          console.warn('Erro ao criar notificação de menção:', notifError);
        }
      }
    }

    // Buscar/criar perfil do autor pelo user_id (evita 406 quando não existe)
    let authorProfile: Profile | null = null;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      authorProfile = (data as Profile) ?? null;
    } catch {
      authorProfile = null;
    }

    if (!authorProfile) {
      try {
        const fallback = this.getFallbackFromUser(user);
        const payload = {
          name: fallback.name || 'Usuário',
          email: user.email || '',
          role: fallback.role || 'Membro',
        };
        authorProfile = await profileService.upsertProfile(user.id, payload);
      } catch {
        const fallback = this.getFallbackFromUser(user);
        authorProfile = this.makeFallbackAuthor(user.id, fallback.name, fallback.role);
      }
    }

    const postWithAuthor = {
      ...data,
      liked_by_me: false,
      author: authorProfile || this.makeFallbackAuthor(user.id)
    };

    const hydrated = await this.hydrateAttachments(postWithAuthor);
    return hydrated;
  }

  // Deletar post
  async deletePost(postId: string): Promise<void> {
    const { error } = await supabase
      .from('feed_posts')
      .delete()
      .eq('id', postId);

    if (error) {
      console.error('Erro ao deletar post:', error);
      throw error;
    }
  }

  // Banir post (somente admin)
  async banPost(postId: string, reason?: string): Promise<FeedPost> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('feed_posts')
      .update({
        banned_at: new Date().toISOString(),
        banned_by: user.id,
        banned_reason: reason || null
      })
      .eq('id', postId)
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao banir post:', error);
      throw error;
    }

    // Hidratar autor
    const [hydrated] = await this.hydrateAuthors([data]);
    return hydrated;
  }

  // Desbanir post (somente admin)
  async unbanPost(postId: string): Promise<FeedPost> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('feed_posts')
      .update({
        banned_at: null,
        banned_by: null,
        banned_reason: null
      })
      .eq('id', postId)
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao desbanir post:', error);
      throw error;
    }

    // Hidratar autor
    const [hydrated] = await this.hydrateAuthors([data]);
    return hydrated;
  }

  // Atualizar post
  async updatePost(postId: string, updates: Partial<CreateFeedPostDTO>): Promise<FeedPost> {
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };
    
    if (updates.content !== undefined) updatePayload.content = updates.content;
    if (updates.tags !== undefined) updatePayload.tags = updates.tags;
    if (updates.mentions !== undefined) updatePayload.mentions = updates.mentions;
    if (updates.entity_references !== undefined) updatePayload.entity_references = updates.entity_references;
    if (updates.preview_data !== undefined) updatePayload.preview_data = updates.preview_data;
    if (updates.attachments !== undefined) updatePayload.attachments = updates.attachments;
    if (updates.visibility !== undefined) updatePayload.visibility = updates.visibility;
    if (updates.allowed_user_ids !== undefined) updatePayload.allowed_user_ids = updates.allowed_user_ids;
    if (updates.allowed_roles !== undefined) updatePayload.allowed_roles = updates.allowed_roles;

    const { data, error } = await supabase
      .from('feed_posts')
      .update(updatePayload)
      .eq('id', postId)
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao atualizar post:', error);
      throw error;
    }

    // Buscar autor do post atualizado
    const { data: authorData } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', data.author_id)
      .maybeSingle();

    const postWithAuthor = {
      ...data,
      author: authorData || this.makeFallbackAuthor(String(data.author_id))
    };

    const hydrated = await this.hydrateAttachments(postWithAuthor);
    return hydrated;
  }

  // Dar like em um post
  async likePost(postId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { error } = await supabase
      .from('feed_post_likes')
      .insert({
        post_id: postId,
        user_id: user.id
      });

    if (error && error.code !== '23505') { // Ignora erro de duplicata
      console.error('Erro ao dar like:', error);
      throw error;
    }
  }

  // Remover like de um post
  async unlikePost(postId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { error } = await supabase
      .from('feed_post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Erro ao remover like:', error);
      throw error;
    }
  }

  // Buscar comentários de um post
  async getComments(postId: string): Promise<FeedPostComment[]> {
    const { data, error } = await supabase
      .from('feed_post_comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Erro ao buscar comentários:', error);
      throw error;
    }

    const hydrated = await this.hydrateCommentAuthors(data || []);
    return hydrated;
  }

  // Criar comentário
  async createComment(postId: string, content: string): Promise<FeedPostComment> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('feed_post_comments')
      .insert({
        post_id: postId,
        author_id: user.id,
        content
      })
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao criar comentário:', error);
      throw error;
    }

    // Buscar o autor do post para evitar notificação duplicada
    // (se o mencionado é o autor do post, ele já receberá notificação de "comentou sua publicação")
    let postAuthorId: string | null = null;
    try {
      const { data: postData } = await supabase
        .from('feed_posts')
        .select('author_id')
        .eq('id', postId)
        .maybeSingle();
      postAuthorId = postData?.author_id || null;
    } catch {
      // ignore
    }

    // Processar menções no comentário e criar notificações
    const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
    const mentionMatches: string[] = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentionMatches.push(match[1].toLowerCase());
    }

    console.log('📝 Comentário criado, processando menções...');
    console.log('📝 Conteúdo:', content);
    console.log('📝 Menções encontradas:', mentionMatches);
    console.log('📝 Autor do post:', postAuthorId);

    if (mentionMatches.length > 0) {
      try {
        // Buscar todos os perfis para encontrar os mencionados
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, name');

        if (profilesError) {
          console.error('❌ Erro ao buscar perfis:', profilesError);
        }

        console.log('👥 Perfis encontrados:', profiles?.length || 0);

        if (profiles && profiles.length > 0) {
          // Buscar nome do autor para a notificação
          let authorName = 'Usuário';
          const authorProfile = profiles.find(p => p.user_id === user.id);
          if (authorProfile?.name) authorName = authorProfile.name;

          // Encontrar user_ids dos mencionados - busca flexível
          const mentionedProfiles = profiles.filter(p => {
            const profileName = (p.name || '').toLowerCase().trim();
            return mentionMatches.some(mentioned => {
              const mentionedTrimmed = mentioned.trim();
              const isMatch = profileName === mentionedTrimmed || 
                             profileName.includes(mentionedTrimmed) || 
                             mentionedTrimmed.includes(profileName);
              if (isMatch) {
                console.log(`✅ Match encontrado: "${mentioned}" -> "${p.name}"`);
              }
              return isMatch;
            });
          });

          console.log('🎯 Perfis mencionados encontrados:', mentionedProfiles.map(p => p.name));

          // Criar notificação para cada mencionado
          for (const mentionedProfile of mentionedProfiles) {
            // Não notificar o próprio autor do comentário
            if (mentionedProfile.user_id === user.id) {
              console.log('⏭️ Ignorando auto-menção:', mentionedProfile.name);
              continue;
            }

            // Não notificar o autor do post (ele já recebe notificação de "comentou sua publicação")
            if (mentionedProfile.user_id === postAuthorId) {
              console.log('⏭️ Ignorando menção ao autor do post (já receberá notificação de comentário):', mentionedProfile.name);
              continue;
            }

            try {
              console.log('📤 Criando notificação para:', mentionedProfile.name, mentionedProfile.user_id);
              await userNotificationService.createNotification({
                user_id: mentionedProfile.user_id,
                type: 'mention',
                title: `${authorName} mencionou você em um comentário`,
                message: content.length > 100 
                  ? content.substring(0, 100) + '...' 
                  : content,
                metadata: {
                  post_id: postId,
                  comment_id: data.id,
                  author_id: user.id,
                  author_name: authorName
                }
              });
              console.log(`🔔 Notificação de menção criada para: ${mentionedProfile.name}`);
            } catch (notifError) {
              console.error('❌ Erro ao criar notificação de menção em comentário:', notifError);
            }
          }
        }
      } catch (profileError) {
        console.error('❌ Erro ao processar menções no comentário:', profileError);
      }
    } else {
      console.log('ℹ️ Nenhuma menção encontrada no comentário');
    }

    const hydratedArr = await this.hydrateCommentAuthors([data]);
    return hydratedArr[0];
  }

  // Deletar comentário
  async deleteComment(commentId: string): Promise<void> {
    const { error } = await supabase
      .from('feed_post_comments')
      .delete()
      .eq('id', commentId);

    if (error) {
      console.error('Erro ao deletar comentário:', error);
      throw error;
    }
  }

  // Buscar dados de preview para uma tag específica
  async getPreviewDataForTag(tag: string, entityId?: string): Promise<PreviewData> {
    const previewData: PreviewData = {};

    switch (tag) {
      case 'financeiro': {
        // Buscar resumo financeiro
        const { data: stats } = await supabase.rpc('get_financial_stats');
        if (stats) {
          previewData.financeiro = {
            recebido: stats.monthly_fees_received || 0,
            pendente: stats.monthly_fees_pending || 0,
            atrasado: stats.total_overdue || 0
          };
        }
        break;
      }

      case 'cliente': {
        if (entityId) {
          const { data: client } = await supabase
            .from('clients')
            .select('id, full_name, cpf_cnpj, phone')
            .eq('id', entityId)
            .single();
          if (client) {
            previewData.cliente = {
              id: client.id,
              nome: client.full_name,
              cpf: (client as any).cpf_cnpj,
              telefone: client.phone
            };
          }
        }
        break;
      }

      case 'processo': {
        if (entityId) {
          const { data: process } = await supabase
            .from('processes')
            .select('id, client_id, process_code, status')
            .eq('id', entityId)
            .single();
          if (process) {
            let clientName = 'N/A';
            if ((process as any).client_id) {
              const { data: client } = await supabase
                .from('clients')
                .select('full_name')
                .eq('id', (process as any).client_id)
                .single();
              clientName = (client as any)?.full_name || clientName;
            }

            previewData.processo = {
              id: process.id,
              numero: (process as any).process_code,
              cliente: clientName,
              status: (process as any).status
            };
          }
        }
        break;
      }

      case 'prazo': {
        if (entityId) {
          const { data: deadline } = await supabase
            .from('deadlines')
            .select('id, title, due_date, type')
            .eq('id', entityId)
            .single();
          if (deadline) {
            previewData.prazo = {
              id: deadline.id,
              titulo: deadline.title,
              data: deadline.due_date,
              tipo: deadline.type
            };
          }
        }
        break;
      }

      case 'agenda': {
        if (entityId) {
          const { data: event } = await supabase
            .from('calendar_events')
            .select('id, title, start_at')
            .eq('id', entityId)
            .single();
          if (event) {
            const startAt = (event as any).start_at as string;
            const startDate = startAt ? new Date(startAt) : null;
            const hora = startDate
              ? startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : '';

            previewData.agenda = {
              id: event.id,
              titulo: event.title,
              data: startAt,
              hora
            };
          }
        }
        break;
      }

      case 'documento': {
        if (entityId) {
          const { data: doc, error } = await supabase
            .from('generated_petition_documents')
            .select('id, file_name, petition_name, client_name')
            .eq('id', entityId)
            .single();
          if (error) {
            console.warn('Erro ao carregar preview do documento:', error);
          }
          if (doc) {
            previewData.documento = {
              id: doc.id,
              nome: doc.file_name,
              tipo: doc.petition_name
            };
          }
        }
        break;
      }

      case 'peticao': {
        if (entityId) {
          const { data: pet, error } = await supabase
            .from('saved_petitions')
            .select('id, title, client_name')
            .eq('id', entityId)
            .single();
          if (error) {
            console.warn('Erro ao carregar preview da petição:', error);
          }
          if (pet) {
            previewData.peticao = {
              id: pet.id,
              nome: (pet as any).title || 'Sem título',
              tipo: (pet as any).client_name || 'Petição'
            };
          }
        }
        break;
      }

      case 'assinatura': {
        if (entityId) {
          const { data: sig, error } = await supabase
            .from('signature_requests')
            .select('id, document_name, client_name, status')
            .eq('id', entityId)
            .single();
          if (error) {
            console.warn('Erro ao carregar preview da assinatura:', error);
          }
          if (sig) {
            previewData.assinatura = {
              id: sig.id,
              nome: (sig as any).document_name || 'Documento',
              cliente: (sig as any).client_name || '',
              status: (sig as any).status || 'pending'
            };
          }
        }
        break;
      }

      case 'requerimento': {
        if (entityId) {
          const { data: req, error } = await supabase
            .from('requirements')
            .select('id, protocol, beneficiary, benefit_type, status')
            .eq('id', entityId)
            .single();
          if (error) {
            console.warn('Erro ao carregar preview do requerimento:', error);
          }
          if (req) {
            previewData.requerimento = {
              id: req.id,
              protocolo: (req as any).protocol || '',
              beneficiario: (req as any).beneficiary || '',
              tipo: (req as any).benefit_type || '',
              status: (req as any).status || ''
            };
          }
        }
        break;
      }
    }

    return previewData;
  }

  // Buscar registros reais para uma tag (para inserir no post)
  async getRecordsForTag(tag: string, search = '', limit = 10): Promise<TagRecord[]> {
    const records: TagRecord[] = [];

    switch (tag) {
      case 'financeiro': {
        // Buscar acordos financeiros
        const { data } = await supabase
          .from('agreements')
          .select(`
            id,
            client_id,
            description,
            total_value,
            installments_count,
            installment_value,
            status
          `)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        let clientsMap = new Map<string, { full_name?: string | null }>();
        if (data && data.length > 0) {
          const clientIds = Array.from(
            new Set(
              data
                .map((a: any) => a.client_id)
                .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
            )
          );

          if (clientIds.length > 0) {
            const { data: clientsData } = await supabase
              .from('clients')
              .select('id, full_name')
              .in('id', clientIds);

            if (clientsData) {
              clientsMap = new Map(
                clientsData.map((c: any) => [c.id as string, { full_name: c.full_name }])
              );
            }
          }
        }

        if (data) {
          for (const agreement of data) {
            const clientName = clientsMap.get((agreement as any).client_id)?.full_name || 'Cliente';
            const totalFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(agreement.total_value || 0);
            const installmentFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(agreement.installment_value || 0);
            
            let formattedText = `acordo financeiro do cliente ${clientName.toUpperCase()}, valor total ${totalFormatted}`;
            if (agreement.installments_count > 1) {
              formattedText += ` (${agreement.installments_count}x de ${installmentFormatted})`;
            }
            
            records.push({
              id: agreement.id,
              label: `${clientName} - ${totalFormatted}`,
              sublabel: agreement.installments_count > 1 
                ? `${agreement.installments_count}x de ${installmentFormatted} • ${agreement.status}`
                : `À vista • ${agreement.status}`,
              formattedText,
              previewData: {
                financeiro: {
                  recebido: 0,
                  pendente: agreement.total_value || 0,
                  atrasado: 0
                }
              }
            });
          }
        }
        break;
      }

      case 'agenda': {
        // Buscar compromissos da agenda
        const { data } = await supabase
          .from('calendar_events')
          .select(`
            id,
            title,
            event_type,
            start_at,
            end_at,
            client_id
          `)
          .gte('start_at', new Date().toISOString())
          .order('start_at', { ascending: true })
          .limit(limit);
        
        // Mapeamento de tradução de event_type
        const eventTypeMap: Record<string, string> = {
          hearing: 'audiência',
          meeting: 'reunião',
          appointment: 'compromisso',
          deadline: 'prazo',
          reminder: 'lembrete',
          task: 'tarefa',
          other: 'outro',
        };

        let clientsMap = new Map<string, { full_name?: string | null }>();
        if (data && data.length > 0) {
          const clientIds = Array.from(
            new Set(
              data
                .map((e: any) => e.client_id)
                .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
            )
          );

          if (clientIds.length > 0) {
            const { data: clientsData } = await supabase
              .from('clients')
              .select('id, full_name')
              .in('id', clientIds);

            if (clientsData) {
              clientsMap = new Map(
                clientsData.map((c: any) => [c.id as string, { full_name: c.full_name }])
              );
            }
          }
        }

        if (data) {
          for (const event of data) {
            const clientName = clientsMap.get((event as any).client_id)?.full_name || '';
            const startAt = (event as any).start_at as string;
            const startDate = startAt ? new Date(startAt) : null;
            const dateFormatted = startDate ? startDate.toLocaleDateString('pt-BR') : '';
            const timeFormatted = startDate ? startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
            const eventTypeRaw = (event as any).event_type as string;
            const eventTypeTranslated = eventTypeRaw ? eventTypeMap[eventTypeRaw.toLowerCase()] || eventTypeRaw : '';
            
            let formattedText = `compromisso "${event.title}" no dia ${dateFormatted}`;
            if (timeFormatted) formattedText += ` às ${timeFormatted}`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            if (eventTypeTranslated) formattedText += ` (${eventTypeTranslated})`;
            
            records.push({
              id: event.id,
              label: event.title,
              sublabel: `${dateFormatted}${timeFormatted ? ` às ${timeFormatted}` : ''}${clientName ? ` • ${clientName}` : ''}`,
              formattedText,
              previewData: {
                agenda: {
                  id: event.id,
                  titulo: event.title,
                  data: startAt,
                  hora: timeFormatted
                }
              }
            });
          }
        }
        break;
      }

      case 'cliente': {
        // Buscar clientes
        const query = supabase
          .from('clients')
          .select('id, full_name, cpf_cnpj, phone, status')
          .eq('status', 'ativo')
          .order('full_name', { ascending: true })
          .limit(limit);
        
        if (search) {
          query.ilike('full_name', `%${search}%`);
        }
        
        const { data } = await query;
        
        if (data) {
          for (const client of data) {
            const formattedText = `cliente ${client.full_name.toUpperCase()}`;
            
            records.push({
              id: client.id,
              label: client.full_name,
              sublabel: (client as any).cpf_cnpj || (client as any).phone || 'Cliente ativo',
              formattedText,
              previewData: {
                cliente: {
                  id: client.id,
                  nome: client.full_name,
                  cpf: (client as any).cpf_cnpj,
                  telefone: (client as any).phone
                }
              }
            });
          }
        }
        break;
      }

      case 'processo': {
        // Buscar processos
        const { data } = await supabase
          .from('processes')
          .select(`
            id,
            client_id,
            process_code,
            status,
            practice_area
          `)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        let clientsMap = new Map<string, { full_name?: string | null }>();
        if (data && data.length > 0) {
          const clientIds = Array.from(
            new Set(
              data
                .map((p: any) => p.client_id)
                .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
            )
          );

          if (clientIds.length > 0) {
            const { data: clientsData } = await supabase
              .from('clients')
              .select('id, full_name')
              .in('id', clientIds);

            if (clientsData) {
              clientsMap = new Map(
                clientsData.map((c: any) => [c.id as string, { full_name: c.full_name }])
              );
            }
          }
        }

        if (data) {
          for (const process of data) {
            const clientName = clientsMap.get((process as any).client_id)?.full_name || 'Cliente';
            
            let formattedText = `processo nº ${process.process_code}`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            if ((process as any).practice_area) formattedText += ` (${(process as any).practice_area})`;
            formattedText += ` - status: ${process.status}`;
            
            records.push({
              id: process.id,
              label: process.process_code,
              sublabel: `${clientName} • ${process.status}`,
              formattedText,
              previewData: {
                processo: {
                  id: process.id,
                  numero: process.process_code,
                  cliente: clientName,
                  status: process.status
                }
              }
            });
          }
        }
        break;
      }

      case 'prazo': {
        // Buscar prazos
        const { data } = await supabase
          .from('deadlines')
          .select(`
            id,
            title,
            due_date,
            type,
            status,
            client_id
          `)
          .eq('status', 'pendente')
          .gte('due_date', new Date().toISOString())
          .order('due_date', { ascending: true })
          .limit(limit);
        
        let clientsMap = new Map<string, { full_name?: string | null }>();
        if (data && data.length > 0) {
          const clientIds = Array.from(
            new Set(
              data
                .map((d: any) => d.client_id)
                .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
            )
          );

          if (clientIds.length > 0) {
            const { data: clientsData } = await supabase
              .from('clients')
              .select('id, full_name')
              .in('id', clientIds);

            if (clientsData) {
              clientsMap = new Map(
                clientsData.map((c: any) => [c.id as string, { full_name: c.full_name }])
              );
            }
          }
        }

        if (data) {
          for (const deadline of data) {
            const clientName = clientsMap.get((deadline as any).client_id)?.full_name || '';
            const dueDate = (deadline as any).due_date as string;
            const dueDateObj = dueDate ? new Date(dueDate) : null;
            const dateFormatted = dueDateObj && !Number.isNaN(dueDateObj.getTime())
              ? dueDateObj.toLocaleDateString('pt-BR')
              : '';
            
            let formattedText = `prazo "${deadline.title}" para ${dateFormatted}`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            if (deadline.type) formattedText += ` (${deadline.type})`;
            
            records.push({
              id: deadline.id,
              label: deadline.title,
              sublabel: `${dateFormatted || 'Sem data'}${clientName ? ` • ${clientName}` : ''} • ${deadline.type || 'Prazo'}`,
              formattedText,
              previewData: {
                prazo: {
                  id: deadline.id,
                  titulo: deadline.title,
                  data: dueDate,
                  tipo: deadline.type || ''
                }
              }
            });
          }
        }
        break;
      }

      case 'documento': {
        const query = supabase
          .from('generated_petition_documents')
          .select('id, file_name, petition_name, client_name')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (search) {
          query.ilike('file_name', `%${search}%`);
        }

        const { data, error } = await query;

        if (error) {
          console.warn('Erro ao carregar registros da tag documento:', error);
        }

        if (data) {
          for (const doc of data) {
            const clientName = (doc as any).client_name || '';
            const petitionName = (doc as any).petition_name || '';
            let formattedText = `documento "${(doc as any).file_name}"`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            if (petitionName) formattedText += ` (${petitionName})`;

            records.push({
              id: doc.id,
              label: (doc as any).file_name,
              sublabel: clientName
                ? `${clientName} • ${petitionName || 'Documento'}`
                : (petitionName || 'Documento'),
              formattedText,
              previewData: {
                documento: {
                  id: doc.id,
                  nome: (doc as any).file_name,
                  tipo: petitionName,
                },
              },
            });
          }
        }
        break;
      }

      case 'peticao': {
        const query = supabase
          .from('saved_petitions')
          .select('id, title, client_name, updated_at')
          .order('updated_at', { ascending: false })
          .limit(limit);

        if (search) {
          query.or(`title.ilike.%${search}%,client_name.ilike.%${search}%`);
        }

        const { data, error } = await query;

        if (error) {
          console.warn('Erro ao carregar registros da tag peticao:', error);
        }

        if (data) {
          for (const pet of data) {
            const clientName = (pet as any).client_name || '';
            const nome = (pet as any).title || 'Sem título';
            let formattedText = `petição "${nome}"`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;

            records.push({
              id: pet.id,
              label: nome,
              sublabel: clientName || 'Petição',
              formattedText,
              previewData: {
                peticao: {
                  id: pet.id,
                  nome,
                  tipo: clientName || 'Petição',
                },
              },
            });
          }
        }
        break;
      }

      case 'assinatura': {
        const query = supabase
          .from('signature_requests')
          .select('id, document_name, client_name, status, created_at')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (search) {
          query.or(`document_name.ilike.%${search}%,client_name.ilike.%${search}%`);
        }

        const { data, error } = await query;

        if (error) {
          console.warn('Erro ao carregar registros da tag assinatura:', error);
        }

        if (data) {
          for (const sig of data) {
            const clientName = (sig as any).client_name || '';
            const docName = (sig as any).document_name || 'Documento';
            const status = (sig as any).status || 'pending';
            const statusLabel = status === 'signed' ? 'Assinado' : status === 'pending' ? 'Pendente' : status;
            let formattedText = `assinatura "${docName}"`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            formattedText += ` (${statusLabel})`;

            records.push({
              id: sig.id,
              label: docName,
              sublabel: `${clientName || 'Sem cliente'} • ${statusLabel}`,
              formattedText,
              previewData: {
                assinatura: {
                  id: sig.id,
                  nome: docName,
                  cliente: clientName,
                  status,
                },
              },
            });
          }
        }
        break;
      }

      case 'requerimento': {
        const query = supabase
          .from('requirements')
          .select('id, protocol, beneficiary, benefit_type, status, created_at')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (search) {
          query.or(`protocol.ilike.%${search}%,beneficiary.ilike.%${search}%,benefit_type.ilike.%${search}%`);
        }

        const { data, error } = await query;

        if (error) {
          console.warn('Erro ao carregar registros da tag requerimento:', error);
        }

        if (data) {
          for (const req of data) {
            const beneficiary = (req as any).beneficiary || '';
            const protocol = (req as any).protocol || '';
            const benefitType = (req as any).benefit_type || '';
            const status = (req as any).status || '';
            let formattedText = `requerimento ${protocol ? `"${protocol}"` : ''}`;
            if (beneficiary) formattedText += `, beneficiário ${beneficiary.toUpperCase()}`;
            if (benefitType) formattedText += ` (${benefitType})`;

            records.push({
              id: req.id,
              label: protocol || beneficiary || 'Requerimento',
              sublabel: `${beneficiary} • ${benefitType || status || 'Requerimento'}`,
              formattedText,
              previewData: {
                requerimento: {
                  id: req.id,
                  protocolo: protocol,
                  beneficiario: beneficiary,
                  tipo: benefitType,
                  status,
                },
              },
            });
          }
        }
        break;
      }

      default:
        break;
    }

    return records;
  }

  // Buscar entidades para dropdown de seleção (tags integradas)
  async searchEntitiesForTag(tag: string, search = '', limit = 10): Promise<EntityReference[]> {
    const results: EntityReference[] = [];

    switch (tag) {
      case 'cliente': {
        const { data } = await supabase
          .from('clients')
          .select('id, full_name')
          .ilike('full_name', `%${search}%`)
          .limit(limit);
        if (data) {
          for (const c of data) results.push({ type: 'client', id: c.id, name: (c as any).full_name });
        }
        break;
      }

      case 'processo': {
        const { data } = await supabase
          .from('processes')
          .select('id, process_code')
          .or(`process_code.ilike.%${search}%`)
          .limit(limit);
        if (data) {
          for (const p of data) results.push({ type: 'process', id: p.id, name: (p as any).process_code });
        }
        break;
      }

      case 'prazo': {
        const { data } = await supabase
          .from('deadlines')
          .select('id, title, due_date')
          .ilike('title', `%${search}%`)
          .limit(limit);
        if (data) {
          for (const d of data) results.push({ type: 'deadline', id: d.id, name: (d as any).title });
        }
        break;
      }

      case 'agenda': {
        const { data } = await supabase
          .from('calendar_events')
          .select('id, title, start_at')
          .ilike('title', `%${search}%`)
          .limit(limit);
        if (data) {
          for (const e of data) results.push({ type: 'calendar', id: e.id, name: (e as any).title });
        }
        break;
      }

      case 'documento': {
        const { data, error } = await supabase
          .from('generated_petition_documents')
          .select('id, file_name, petition_name')
          .ilike('file_name', `%${search}%`)
          .limit(limit);
        if (error) {
          console.warn('Erro ao buscar entidades para tag documento:', error);
        }
        if (data) {
          for (const doc of data) results.push({ type: 'document', id: doc.id, name: (doc as any).file_name });
        }
        break;
      }

      case 'peticao': {
        const { data, error } = await supabase
          .from('saved_petitions')
          .select('id, title, client_name')
          .or(`title.ilike.%${search}%,client_name.ilike.%${search}%`)
          .limit(limit);
        if (error) {
          console.warn('Erro ao buscar entidades para tag peticao:', error);
        }
        if (data) {
          for (const pet of data) {
            const nome = (pet as any).title || 'Sem título';
            results.push({ type: 'petition', id: pet.id, name: nome });
          }
        }
        break;
      }

      case 'assinatura': {
        const { data, error } = await supabase
          .from('signature_requests')
          .select('id, document_name, client_name')
          .or(`document_name.ilike.%${search}%,client_name.ilike.%${search}%`)
          .limit(limit);
        if (error) {
          console.warn('Erro ao buscar entidades para tag assinatura:', error);
        }
        if (data) {
          for (const sig of data) {
            results.push({ type: 'signature', id: sig.id, name: (sig as any).document_name || 'Documento' });
          }
        }
        break;
      }

      case 'requerimento': {
        const { data, error } = await supabase
          .from('requirements')
          .select('id, protocol, beneficiary')
          .or(`protocol.ilike.%${search}%,beneficiary.ilike.%${search}%`)
          .limit(limit);
        if (error) {
          console.warn('Erro ao buscar entidades para tag requerimento:', error);
        }
        if (data) {
          for (const req of data) {
            results.push({ type: 'requirement', id: req.id, name: (req as any).protocol || (req as any).beneficiary || 'Requerimento' });
          }
        }
        break;
      }

      default:
        break;
    }

    return results;
  }
}

export const feedPostsService = new FeedPostsService();
