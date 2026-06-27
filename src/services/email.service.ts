import { supabase } from '../config/supabase';
import type { EmailMessage, EmailFolder, SendEmailDTO, EmailSignature, EmailSpamRule, SpamRuleKind, SpamRuleMatch } from '../types/email.types';
import { patchForInbox, patchForSpam } from '../utils/email.transitions';

const TABLE = 'email_messages';

function folderFilter(query: any, folder: EmailFolder) {
  switch (folder) {
    case 'inbox':
      return query.eq('direction', 'inbound').eq('is_spam', false).eq('is_trash', false).eq('is_draft', false);
    case 'starred':
      return query.eq('is_starred', true).eq('is_trash', false).eq('is_draft', false);
    case 'sent':
      return query.eq('direction', 'outbound').eq('is_trash', false).eq('is_draft', false);
    case 'spam':
      return query.eq('is_spam', true).eq('is_trash', false).eq('is_draft', false);
    case 'trash':
      return query.eq('is_trash', true);
    case 'drafts':
      return query.eq('is_draft', true).eq('is_trash', false);
    default:
      return query.eq('id', '00000000-0000-0000-0000-000000000000');
  }
}

class EmailService {
  async listMessages(folder: EmailFolder, search?: string, limit = 50, onlyUnread = false): Promise<EmailMessage[]> {
    let query = supabase.from(TABLE).select('*');
    query = folderFilter(query, folder);
    if (onlyUnread) query = query.eq('is_read', false);
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`subject.ilike.${term},from_text.ilike.${term},from_address.ilike.${term},to_text.ilike.${term}`);
    }
    const { data, error } = await query
      .order('sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 500)));
    if (error) throw new Error(error.message);
    return (data ?? []) as EmailMessage[];
  }

  /** Uma mensagem específica por id (usado ao abrir via notificação). */
  async getMessage(id: string): Promise<EmailMessage | null> {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as EmailMessage) ?? null;
  }

  /** Todas as mensagens de uma conversa (thread), em ordem cronológica. */
  async listThread(threadKey: string): Promise<EmailMessage[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('thread_key', threadKey)
      .eq('is_trash', false)
      .order('sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as EmailMessage[];
  }

  /** Marca como lidas todas as mensagens não lidas da pasta. Retorna quantas. */
  async markAllRead(folder: EmailFolder = 'inbox'): Promise<number> {
    let query = supabase.from(TABLE).update({ is_read: true }, { count: 'exact' }).eq('is_read', false);
    query = folderFilter(query, folder);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async countUnread(folder: EmailFolder = 'inbox'): Promise<number> {
    let query = supabase.from(TABLE).select('id', { count: 'exact', head: true }).eq('is_read', false);
    query = folderFilter(query, folder);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async markRead(id: string, isRead = true): Promise<void> {
    const { error } = await supabase.from(TABLE).update({ is_read: isRead }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Marca/desmarca estrela (importante). */
  async toggleStar(id: string, isStarred: boolean): Promise<void> {
    const { error } = await supabase.from(TABLE).update({ is_starred: isStarred }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /**
   * Mover para a Caixa de Entrada: limpa is_spam E is_trash.
   * Operação idempotente; funciona de qualquer pasta.
   */
  async moveToInbox(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).update(patchForInbox()).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /**
   * Marca como spam (move pro Spam) e, se learnSender, registra o remetente
   * para que emails futuros dele caiam direto no spam.
   * Limpa is_trash para que o item saia da lixeira se estava lá.
   */
  async markSpam(msg: EmailMessage, learnSender = true): Promise<void> {
    const { error } = await supabase.from(TABLE).update(patchForSpam()).eq('id', msg.id);
    if (error) throw new Error(error.message);
    if (learnSender && msg.from_address) {
      await supabase.from('email_spam_senders').upsert({ address: msg.from_address.toLowerCase() });
    }
  }

  /**
   * Tira do spam (move para Inbox): limpa is_spam E is_trash.
   * Garante que o item não fique preso numa pasta intermediária.
   */
  async unmarkSpam(msg: EmailMessage, forgetSender = true): Promise<void> {
    await this.moveToInbox(msg.id);
    if (forgetSender && msg.from_address) {
      await supabase.from('email_spam_senders').delete().eq('address', msg.from_address.toLowerCase());
    }
  }

  /** Zera os sinais de spam de uma mensagem (some o aviso na leitura). */
  async clearSpamSignals(id: string): Promise<void> {
    const { error } = await supabase
      .from(TABLE)
      .update({ is_spam: false, spam_score: 0, spam_reason: null, spam_checked: true })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async moveToTrash(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).update({ is_trash: true }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async restoreFromTrash(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).update({ is_trash: false }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Move vários para a lixeira de uma vez. */
  async bulkMoveToTrash(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await supabase.from(TABLE).update({ is_trash: true }).in('id', ids);
    if (error) throw new Error(error.message);
  }

  /** Marca vários como lido/não-lido. */
  async bulkMarkRead(ids: string[], isRead: boolean): Promise<void> {
    if (!ids.length) return;
    const { error } = await supabase.from(TABLE).update({ is_read: isRead }).in('id', ids);
    if (error) throw new Error(error.message);
  }

  /** Restaura vários da lixeira de uma vez (cada item volta para spam ou inbox conforme is_spam). */
  async bulkRestore(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await supabase.from(TABLE).update({ is_trash: false }).in('id', ids);
    if (error) throw new Error(error.message);
  }

  /** Move vários para a Caixa de Entrada (limpa is_spam E is_trash). */
  async bulkMoveToInbox(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { error } = await supabase.from(TABLE).update(patchForInbox()).in('id', ids);
    if (error) throw new Error(error.message);
  }

  /**
   * Marca/desmarca spam em vários de uma vez.
   * Ao marcar: limpa is_trash (sai da lixeira se estava lá).
   * Ao desmarcar: limpa is_trash também — equivale a moveToInbox em lote.
   */
  async bulkSetSpam(ids: string[], isSpam: boolean): Promise<void> {
    if (!ids.length) return;
    const patch = isSpam ? patchForSpam() : patchForInbox();
    const { error } = await supabase.from(TABLE).update(patch).in('id', ids);
    if (error) throw new Error(error.message);
  }

  /**
   * Esvazia a lixeira (exclusão permanente). scope:
   *  - 'all'    todos os itens na lixeira
   *  - 'read'   apenas os já lidos
   *  - 'unread' apenas os não lidos
   */
  async emptyTrash(scope: 'all' | 'read' | 'unread' = 'all'): Promise<number> {
    let query = supabase.from(TABLE).delete({ count: 'exact' }).eq('is_trash', true);
    if (scope === 'read') query = query.eq('is_read', true);
    if (scope === 'unread') query = query.eq('is_read', false);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async getSignature(): Promise<EmailSignature | null> {
    const { data, error } = await supabase.from('email_signatures').select('*').maybeSingle();
    if (error) throw new Error(error.message);
    return data as EmailSignature | null;
  }

  async saveSignature(sig: Partial<EmailSignature>): Promise<void> {
    const { data: u } = await supabase.auth.getUser();
    const user_id = u?.user?.id;
    if (!user_id) throw new Error('não autenticado');
    const { error } = await supabase.from('email_signatures').upsert({
      user_id,
      name: sig.name ?? null,
      signature_text: sig.signature_text ?? null,
      signature_html: sig.signature_html ?? null,
      use_html: sig.use_html ?? false,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async linkClient(id: string, clientId: string | null): Promise<void> {
    const { error } = await supabase.from(TABLE).update({ client_id: clientId }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Antispam: regras (whitelist / blocklist) ───────────────────────────
  async listSpamRules(): Promise<EmailSpamRule[]> {
    const { data, error } = await supabase
      .from('email_spam_rules')
      .select('*')
      .order('kind', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as EmailSpamRule[];
  }

  async addSpamRule(kind: SpamRuleKind, matchType: SpamRuleMatch, value: string, note?: string): Promise<void> {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('email_spam_rules').insert({
      kind,
      match_type: matchType,
      value: value.trim(),
      note: note?.trim() || null,
      created_by: u?.user?.id ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async setSpamRuleEnabled(id: string, enabled: boolean): Promise<void> {
    const { error } = await supabase.from('email_spam_rules').update({ enabled }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async deleteSpamRule(id: string): Promise<void> {
    const { error } = await supabase.from('email_spam_rules').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** URL assinada temporária para baixar um anexo do bucket privado. */
  async attachmentUrl(path: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from('email-attachments')
      .createSignedUrl(path, 60 * 10);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  /**
   * Salva (insere ou atualiza) um rascunho. Rascunho é uma linha outbound com
   * is_draft=true — a policy RLS só permite inserir nesse formato. Retorna o id.
   */
  async saveDraft(d: {
    id?: string; to: string; cc: string; bcc: string; subject: string; html: string;
    inReplyTo?: string; threadKey?: string; clientId?: string;
  }): Promise<string> {
    const { data: u } = await supabase.auth.getUser();
    const row = {
      direction: 'outbound' as const,
      is_draft: true,
      to_text: d.to.trim() || null,
      cc_text: d.cc.trim() || null,
      bcc_text: d.bcc.trim() || null,
      subject: d.subject.trim() || null,
      body_html: d.html || null,
      in_reply_to: d.inReplyTo ?? null,
      thread_key: d.threadKey ?? null,
      client_id: d.clientId ?? null,
      sender_user_id: u?.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    if (d.id) {
      const { error } = await supabase.from(TABLE).update(row).eq('id', d.id);
      if (error) throw new Error(error.message);
      return d.id;
    }
    const { data, error } = await supabase.from(TABLE)
      .insert({ ...row, mailbox: 'INBOX', message_id: `draft-${crypto.randomUUID()}` })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  async deleteDraft(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Remove rascunhos órfãos do usuário logado com o mesmo subject após um envio. */
  async purgeOrphanDrafts(subject: string): Promise<void> {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user?.id) return;
    await supabase
      .from(TABLE)
      .delete()
      .eq('is_draft', true)
      .eq('direction', 'outbound')
      .eq('sender_user_id', u.user.id)
      .eq('subject', subject.trim() || '');
  }

  /**
   * Envia email via edge function `email-send` (que guarda o token do servidor).
   * O token NUNCA fica no frontend.
   */
  async sendEmail(payload: SendEmailDTO): Promise<{ messageId: string }> {
    const { data, error } = await supabase.functions.invoke('email-bridge-send', { body: payload });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return { messageId: data?.messageId ?? '' };
  }
}

export const emailService = new EmailService();
