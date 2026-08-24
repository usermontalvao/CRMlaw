import { supabase } from '../config/supabase';
import type { EmailMessage, EmailFolder, SendEmailDTO, EmailSignature, EmailSpamRule, SpamRuleKind, SpamRuleMatch, EmailSearchFilters } from '../types/email.types';
import { patchForInbox, patchForSpam } from '../utils/email.transitions';
import { buildSearchTextVariants } from '../utils/search';

const TABLE = 'email_messages';
const EMPTY_FILTERS: EmailSearchFilters = {
  from: '',
  to: '',
  subject: '',
  hasAttachments: false,
  starredOnly: false,
  dateFrom: '',
  dateTo: '',
};

/** Resultado paginado de uma listagem: itens da página + total no servidor. */
export interface EmailPage {
  items: EmailMessage[];
  total: number;
}

/**
 * Colunas percorridas pela busca livre (campo "Pesquisar…"). Inclui o corpo da
 * mensagem para que números de processo/termos que só aparecem no texto sejam
 * encontrados.
 */
const SEARCH_COLUMNS = [
  'subject',
  'from_text',
  'from_address',
  'to_text',
  'cc_text',
  'bcc_text',
  'body_text',
] as const;

/**
 * Campos que a tela de e-mail lê de uma devolução: os quatro que alimentam o
 * `detectBounce` mais a identificação e a data. O restante da linha não é usado
 * — quem abre o relatório completo chama `getMessage`.
 */
const BOUNCE_COLUMNS = 'id, from_address, subject, body_text, body_html, sent_at, created_at';

export type BounceMessage = Pick<
  EmailMessage,
  'id' | 'from_address' | 'subject' | 'body_text' | 'body_html' | 'sent_at' | 'created_at'
>;

/**
 * Monta o valor de um padrão ILIKE seguro para uso dentro de `.or()`.
 * O PostgREST separa condições por vírgula, então envolvemos o valor em aspas
 * duplas — caracteres reservados (`,`, `.`, `(`, `)`, `:`), comuns em números
 * de processo, viram literais; barras e aspas internas são escapadas.
 */
function ilikePattern(raw: string): string {
  const escaped = raw.replace(/[\\"]/g, (c) => `\\${c}`);
  return `"%${escaped}%"`;
}

/** Repete o ILIKE pelas alternativas acentuadas sem perder a paginação no banco. */
function orIlikeAccentInsensitive(term: string, columns: readonly string[]): string {
  return buildSearchTextVariants(term)
    .flatMap((variant) => columns.map((col) => `${col}.ilike.${ilikePattern(variant)}`))
    .join(',');
}

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
  /**
   * Lista mensagens de uma pasta com TODOS os filtros aplicados no servidor
   * (Postgres), com paginação real por offset e contagem total exata.
   *
   * Antes, os filtros de texto (remetente/destinatário/assunto/anexo) e a busca
   * eram aplicados no cliente sobre uma janela dos ~500 e-mails mais recentes —
   * então a busca não achava e-mails antigos e o "Carregar mais" nunca passava
   * desse teto. Agora tudo roda no banco: a busca varre toda a caixa e a
   * paginação é fiel ao total real.
   *
   * @param limit  quantidade de itens a retornar (a partir de `offset`).
   * @param offset deslocamento inicial (0 = primeira página).
   */
  async listMessages(
    folder: EmailFolder,
    search?: string,
    limit = 50,
    onlyUnread = false,
    filters?: Partial<EmailSearchFilters>,
    offset = 0,
  ): Promise<EmailPage> {
    const activeFilters = { ...EMPTY_FILTERS, ...filters };
    let query = supabase.from(TABLE).select('*', { count: 'exact' });
    query = folderFilter(query, folder);
    if (onlyUnread) query = query.eq('is_read', false);
    if (activeFilters.starredOnly) query = query.eq('is_starred', true);
    if (activeFilters.dateFrom) query = query.gte('sent_at', `${activeFilters.dateFrom}T00:00:00`);
    if (activeFilters.dateTo) query = query.lte('sent_at', `${activeFilters.dateTo}T23:59:59`);

    // Anexo: array jsonb não-vazio → primeiro elemento existe.
    if (activeFilters.hasAttachments) query = query.not('attachments->0', 'is', null);

    // Remetente: casa em from_text OU from_address.
    const fromTerm = activeFilters.from.trim();
    if (fromTerm) query = query.or(orIlikeAccentInsensitive(fromTerm, ['from_text', 'from_address']));

    // Destinatário: casa em to/cc/bcc.
    const toTerm = activeFilters.to.trim();
    if (toTerm) query = query.or(orIlikeAccentInsensitive(toTerm, ['to_text', 'cc_text', 'bcc_text']));

    // Assunto (parcial).
    const subjectTerm = activeFilters.subject.trim();
    if (subjectTerm) query = query.or(orIlikeAccentInsensitive(subjectTerm, ['subject']));

    // Busca global: assunto, remetente, destinatários e corpo.
    const searchTerm = search?.trim() || '';
    if (searchTerm) query = query.or(orIlikeAccentInsensitive(searchTerm, SEARCH_COLUMNS));

    const from = Math.max(0, offset);
    const to = from + Math.max(1, limit) - 1;
    const { data, error, count } = await query
      .order('sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return { items: (data ?? []) as EmailMessage[], total: count ?? 0 };
  }

  /**
   * Endereços com quem a caixa já trocou e-mail, em minúsculas. Serve para
   * avisar no compose quando o destinatário é inédito — é o único sinal capaz
   * de pegar erro de digitação na parte antes do @ (`fulanoo@gmail.com`), que
   * o SMTP só recusa depois, por devolução.
   */
  async listKnownAddresses(limit = 1500): Promise<Set<string>> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('direction, from_address, to_text, cc_text')
      .eq('is_draft', false)
      .eq('is_spam', false)
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const known = new Set<string>();
    const addAll = (raw: string | null) => {
      if (!raw) return;
      for (const part of raw.split(/[,;]+/)) {
        const match = part.match(/<([^>]+)>/);
        const address = (match ? match[1] : part).trim().toLowerCase();
        if (address.includes('@')) known.add(address);
      }
    };
    for (const row of (data ?? []) as Array<Pick<EmailMessage, 'direction' | 'from_address' | 'to_text' | 'cc_text'>>) {
      // De quem escreveu para nós e para quem já escrevemos: ambos contam.
      addAll(row.from_address);
      addAll(row.to_text);
      addAll(row.cc_text);
    }
    return known;
  }

  /**
   * Devoluções (bounces) recebidas. Servem para marcar como "não entregue" o
   * e-mail correspondente em Enviados — sem isso a falha fica só na caixa de
   * entrada e a mensagem enviada continua com cara de entregue.
   *
   * O reconhecimento (MAILER-DAEMON/postmaster no remetente ou relatório DSN no
   * corpo) mora na coluna gerada `is_bounce`, calculada na escrita da linha.
   * Antes ele era feito aqui, em ILIKE sobre `body_text`: 1,5 s e 350 MB de
   * buffer por chamada, varrendo os 12 mil e-mails para achar as 2 devoluções.
   */
  async listBounceMessages(limit = 200): Promise<BounceMessage[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select(BOUNCE_COLUMNS)
      .eq('is_bounce', true)
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as BounceMessage[];
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
    const { data, error } = await supabase.from(TABLE).update({ is_read: isRead }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para editá-lo.');
  }

  /** Marca/desmarca estrela (importante). */
  async toggleStar(id: string, isStarred: boolean): Promise<void> {
    const { data, error } = await supabase.from(TABLE).update({ is_starred: isStarred }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para editá-lo.');
  }

  /**
   * Mover para a Caixa de Entrada: limpa is_spam E is_trash.
   * Operação idempotente; funciona de qualquer pasta.
   */
  async moveToInbox(id: string): Promise<void> {
    const { data, error } = await supabase.from(TABLE).update(patchForInbox()).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para movê-lo.');
  }

  /**
   * Marca como spam (move pro Spam) e, se learnSender, registra o remetente
   * para que emails futuros dele caiam direto no spam.
   * Limpa is_trash para que o item saia da lixeira se estava lá.
   */
  async markSpam(msg: EmailMessage, learnSender = true): Promise<void> {
    const { data, error } = await supabase.from(TABLE).update(patchForSpam()).eq('id', msg.id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para movê-lo.');
    if (learnSender && msg.from_address) {
      const { error: senderError } = await supabase.from('email_spam_senders').upsert({ address: msg.from_address.toLowerCase() });
      if (senderError) throw new Error(senderError.message);
    }
  }

  /**
   * Tira do spam (move para Inbox): limpa is_spam E is_trash.
   * Garante que o item não fique preso numa pasta intermediária.
   */
  async unmarkSpam(msg: EmailMessage, forgetSender = true): Promise<void> {
    await this.moveToInbox(msg.id);
    if (forgetSender && msg.from_address) {
      const { error } = await supabase.from('email_spam_senders').delete().eq('address', msg.from_address.toLowerCase());
      if (error) throw new Error(error.message);
    }
  }

  /** Zera os sinais de spam de uma mensagem (some o aviso na leitura). */
  async clearSpamSignals(id: string): Promise<void> {
    const { data, error } = await supabase
      .from(TABLE)
      .update({ is_spam: false, spam_score: 0, spam_reason: null, spam_checked: true })
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para editá-lo.');
  }

  async moveToTrash(id: string): Promise<void> {
    const { data, error } = await supabase.from(TABLE).update({ is_trash: true }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para movê-lo.');
  }

  async restoreFromTrash(id: string): Promise<void> {
    const { data, error } = await supabase.from(TABLE).update({ is_trash: false }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para restaurá-lo.');
  }

  /** Move vários para a lixeira de uma vez. */
  async bulkMoveToTrash(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { data, error } = await supabase.from(TABLE).update({ is_trash: true }).in('id', ids).select('id');
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) !== ids.length) throw new Error('Nem todos os e-mails puderam ser movidos. Verifique sua permissão.');
  }

  /** Marca vários como lido/não-lido. */
  async bulkMarkRead(ids: string[], isRead: boolean): Promise<void> {
    if (!ids.length) return;
    const { data, error } = await supabase.from(TABLE).update({ is_read: isRead }).in('id', ids).select('id');
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) !== ids.length) throw new Error('Nem todos os e-mails puderam ser editados. Verifique sua permissão.');
  }

  /** Restaura vários da lixeira de uma vez (cada item volta para spam ou inbox conforme is_spam). */
  async bulkRestore(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { data, error } = await supabase.from(TABLE).update({ is_trash: false }).in('id', ids).select('id');
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) !== ids.length) throw new Error('Nem todos os e-mails puderam ser restaurados. Verifique sua permissão.');
  }

  /** Move vários para a Caixa de Entrada (limpa is_spam E is_trash). */
  async bulkMoveToInbox(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { data, error } = await supabase.from(TABLE).update(patchForInbox()).in('id', ids).select('id');
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) !== ids.length) throw new Error('Nem todos os e-mails puderam ser movidos. Verifique sua permissão.');
  }

  /**
   * Marca/desmarca spam em vários de uma vez.
   * Ao marcar: limpa is_trash (sai da lixeira se estava lá).
   * Ao desmarcar: limpa is_trash também — equivale a moveToInbox em lote.
   */
  async bulkSetSpam(ids: string[], isSpam: boolean): Promise<void> {
    if (!ids.length) return;
    const patch = isSpam ? patchForSpam() : patchForInbox();
    const { data, error } = await supabase.from(TABLE).update(patch).in('id', ids).select('id');
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) !== ids.length) throw new Error('Nem todos os e-mails puderam ser editados. Verifique sua permissão.');
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
    const { data, error } = await supabase.from('email_signatures').upsert({
      user_id,
      name: sig.name ?? null,
      signature_text: sig.signature_text ?? null,
      signature_html: sig.signature_html ?? null,
      use_html: sig.use_html ?? false,
      updated_at: new Date().toISOString(),
    }).select('user_id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('A assinatura não foi salva. Verifique sua permissão.');
  }

  async linkClient(id: string, clientId: string | null): Promise<void> {
    const { data, error } = await supabase.from(TABLE).update({ client_id: clientId }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('E-mail não encontrado ou você não tem permissão para vinculá-lo.');
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
    const { data, error } = await supabase.from('email_spam_rules').update({ enabled }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Regra não encontrada ou você não tem permissão para editá-la.');
  }

  async deleteSpamRule(id: string): Promise<void> {
    const { data, error } = await supabase.from('email_spam_rules').delete().eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Regra não encontrada ou você não tem permissão para excluí-la.');
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
      const { data, error } = await supabase.from(TABLE).update(row).eq('id', d.id).select('id');
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error('Rascunho não encontrado ou você não tem permissão para editá-lo.');
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
    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Rascunho não encontrado ou você não tem permissão para excluí-lo.');
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
