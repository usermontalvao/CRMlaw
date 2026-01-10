import { supabase } from '../config/supabase';
import { profileService, type Profile } from './profile.service';
import { userNotificationService } from './userNotification.service';

const FEED_ATTACHMENT_BUCKET = 'anexos_chat';

// Tipos para referências de entidades
export interface EntityReference {
  type: 'client' | 'process' | 'requirement' | 'deadline' | 'calendar' | 'document' | 'financial';
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
}

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

    const authorIds = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
    if (authorIds.length === 0) return posts;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('user_id', authorIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    return posts.map(post => ({
      ...post,
      author: profileMap.get(post.author_id) || this.makeFallbackAuthor(String(post.author_id))
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

  // Buscar posts do feed
  async getPosts(limit = 20, offset = 0): Promise<FeedPost[]> {
    const { data: posts, error } = await supabase
      .from('feed_posts')
      .select('*')
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

  // Criar novo post
  async createPost(dto: CreateFeedPostDTO): Promise<FeedPost> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('feed_posts')
      .insert({
        author_id: user.id,
        content: dto.content,
        tags: dto.tags || [],
        mentions: dto.mentions || [],
        entity_references: dto.entity_references || [],
        preview_data: dto.preview_data || {},
        attachments: dto.attachments || []
      })
      .select('*')
      .single();

    if (error) {
      console.error('Erro ao criar post:', error);
      throw error;
    }

    // Criar notificações para usuários mencionados (salva no banco para o usuário mencionado ver)
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

      for (const mentionedUserId of dto.mentions) {
        // Não notificar o próprio autor
        if (mentionedUserId !== user.id) {
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

  // Atualizar post
  async updatePost(postId: string, updates: Partial<CreateFeedPostDTO>): Promise<FeedPost> {
    const { data, error } = await supabase
      .from('feed_posts')
      .update({
        content: updates.content,
        tags: updates.tags,
        mentions: updates.mentions,
        entity_references: updates.entity_references,
        preview_data: updates.preview_data,
        attachments: updates.attachments,
        updated_at: new Date().toISOString()
      })
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
            .select('id, full_name, cpf, phone')
            .eq('id', entityId)
            .single();
          if (client) {
            previewData.cliente = {
              id: client.id,
              nome: client.full_name,
              cpf: client.cpf,
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
            .select(`
              id, 
              process_code, 
              status,
              client:clients!client_id(full_name)
            `)
            .eq('id', entityId)
            .single();
          if (process) {
            previewData.processo = {
              id: process.id,
              numero: process.process_code,
              cliente: (process.client as any)?.full_name || 'N/A',
              status: process.status
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
            .select('id, title, start_date, start_time')
            .eq('id', entityId)
            .single();
          if (event) {
            previewData.agenda = {
              id: event.id,
              titulo: event.title,
              data: event.start_date,
              hora: event.start_time || ''
            };
          }
        }
        break;
      }

      case 'documento': {
        if (entityId) {
          const { data: doc } = await supabase
            .from('documents')
            .select('id, name, type')
            .eq('id', entityId)
            .single();
          if (doc) {
            previewData.documento = {
              id: doc.id,
              nome: doc.name,
              tipo: doc.type
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
            description,
            total_amount,
            installments_count,
            installment_value,
            status,
            client:clients!client_id(id, full_name)
          `)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        if (data) {
          for (const agreement of data) {
            const clientName = (agreement.client as any)?.full_name || 'Cliente';
            const totalFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(agreement.total_amount || 0);
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
                  pendente: agreement.total_amount || 0,
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
            start_date,
            start_time,
            end_time,
            event_type,
            client:clients!client_id(id, full_name)
          `)
          .gte('start_date', new Date().toISOString().split('T')[0])
          .order('start_date', { ascending: true })
          .limit(limit);
        
        if (data) {
          for (const event of data) {
            const clientName = (event.client as any)?.full_name || '';
            const dateFormatted = new Date(event.start_date + 'T12:00:00').toLocaleDateString('pt-BR');
            const timeFormatted = event.start_time ? event.start_time.slice(0, 5) : '';
            
            let formattedText = `compromisso "${event.title}" no dia ${dateFormatted}`;
            if (timeFormatted) formattedText += ` às ${timeFormatted}`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            if (event.event_type) formattedText += ` (${event.event_type})`;
            
            records.push({
              id: event.id,
              label: event.title,
              sublabel: `${dateFormatted}${timeFormatted ? ` às ${timeFormatted}` : ''}${clientName ? ` • ${clientName}` : ''}`,
              formattedText,
              previewData: {
                agenda: {
                  id: event.id,
                  titulo: event.title,
                  data: event.start_date,
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
          .select('id, full_name, cpf, phone, status')
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
              sublabel: client.cpf || client.phone || 'Cliente ativo',
              formattedText,
              previewData: {
                cliente: {
                  id: client.id,
                  nome: client.full_name,
                  cpf: client.cpf,
                  telefone: client.phone
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
            process_code,
            action_type,
            status,
            client:clients!client_id(id, full_name)
          `)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        if (data) {
          for (const process of data) {
            const clientName = (process.client as any)?.full_name || 'Cliente';
            
            let formattedText = `processo nº ${process.process_code}`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            if (process.action_type) formattedText += ` (${process.action_type})`;
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
            client:clients!client_id(id, full_name)
          `)
          .eq('status', 'pendente')
          .gte('due_date', new Date().toISOString().split('T')[0])
          .order('due_date', { ascending: true })
          .limit(limit);
        
        if (data) {
          for (const deadline of data) {
            const clientName = (deadline.client as any)?.full_name || '';
            const dateFormatted = new Date(deadline.due_date + 'T12:00:00').toLocaleDateString('pt-BR');
            
            let formattedText = `prazo "${deadline.title}" para ${dateFormatted}`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            if (deadline.type) formattedText += ` (${deadline.type})`;
            
            records.push({
              id: deadline.id,
              label: deadline.title,
              sublabel: `${dateFormatted}${clientName ? ` • ${clientName}` : ''} • ${deadline.type || 'Prazo'}`,
              formattedText,
              previewData: {
                prazo: {
                  id: deadline.id,
                  titulo: deadline.title,
                  data: deadline.due_date,
                  tipo: deadline.type || ''
                }
              }
            });
          }
        }
        break;
      }

      case 'documento': {
        // Buscar documentos
        const { data } = await supabase
          .from('documents')
          .select(`
            id,
            name,
            type,
            client:clients!client_id(id, full_name)
          `)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        if (data) {
          for (const doc of data) {
            const clientName = (doc.client as any)?.full_name || '';
            
            let formattedText = `documento "${doc.name}"`;
            if (doc.type) formattedText += ` (${doc.type})`;
            if (clientName) formattedText += `, cliente ${clientName.toUpperCase()}`;
            
            records.push({
              id: doc.id,
              label: doc.name,
              sublabel: `${doc.type || 'Documento'}${clientName ? ` • ${clientName}` : ''}`,
              formattedText,
              previewData: {
                documento: {
                  id: doc.id,
                  nome: doc.name,
                  tipo: doc.type || ''
                }
              }
            });
          }
        }
        break;
      }
    }

    return records;
  }

  // Buscar entidades para autocomplete
  async searchEntities(tag: string, search: string, limit = 5): Promise<EntityReference[]> {
    const results: EntityReference[] = [];

    switch (tag) {
      case 'cliente': {
        const { data } = await supabase
          .from('clients')
          .select('id, full_name')
          .ilike('full_name', `%${search}%`)
          .limit(limit);
        if (data) {
          results.push(...data.map(c => ({
            type: 'client' as const,
            id: c.id,
            name: c.full_name
          })));
        }
        break;
      }

      case 'processo': {
        const { data } = await supabase
          .from('processes')
          .select('id, process_code, client:clients!client_id(full_name)')
          .or(`process_code.ilike.%${search}%`)
          .limit(limit);
        if (data) {
          results.push(...data.map(p => ({
            type: 'process' as const,
            id: p.id,
            number: p.process_code,
            name: (p.client as any)?.full_name
          })));
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
          results.push(...data.map(d => ({
            type: 'deadline' as const,
            id: d.id,
            name: d.title,
            extra: { due_date: d.due_date }
          })));
        }
        break;
      }

      case 'agenda': {
        const { data } = await supabase
          .from('calendar_events')
          .select('id, title, start_date')
          .ilike('title', `%${search}%`)
          .limit(limit);
        if (data) {
          results.push(...data.map(e => ({
            type: 'calendar' as const,
            id: e.id,
            name: e.title,
            extra: { start_date: e.start_date }
          })));
        }
        break;
      }

      case 'documento': {
        const { data } = await supabase
          .from('documents')
          .select('id, name, type')
          .ilike('name', `%${search}%`)
          .limit(limit);
        if (data) {
          results.push(...data.map(d => ({
            type: 'document' as const,
            id: d.id,
            name: d.name,
            extra: { type: d.type }
          })));
        }
        break;
      }
    }

    return results;
  }
}

export const feedPostsService = new FeedPostsService();
