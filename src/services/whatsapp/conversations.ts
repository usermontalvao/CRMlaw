// Camada de conversas: lista, ciclo de vida, atribuição/transferência,
// governança (bloqueio), notas internas, timeline unificada e realtime.
import { supabase } from '../../config/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { processService } from '../process.service';
import type { WhatsAppConversation, WhatsAppClientLite, TimelineEvent } from '../../types/whatsapp.types';
import {
  CONV_TABLE, MSG_TABLE, TRANSFER_TABLE, NOTES_TABLE,
  attachAvatarUrls, attachClientNames, invokeFn, normalizePhone, phoneVariants, resolveAvatarUrl,
  type WhatsAppInternalNote,
} from './shared';
import { messagesApi } from './messages';
import { subscribeWaMessageEvents, type WaMessageEvent } from './messageEvents';
import { subscribeWaConversationEvents } from './conversationEvents';

export const conversationsApi = {
  // ── Conversas ────────────────────────────────────────────────
  async listConversations(): Promise<WhatsAppConversation[]> {
    const { data, error } = await supabase
      .from(CONV_TABLE)
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    const convs = (data || []) as WhatsAppConversation[];
    await Promise.all([attachAvatarUrls(convs), attachClientNames(convs)]);
    return convs;
  },

  /** Busca/atualiza a foto de perfil do contato na Evolution e persiste. */
  async refreshAvatar(conversationId: string): Promise<{ path: string | null }> {
    const data = await invokeFn('whatsapp-avatar', { conversation_id: conversationId });
    return { path: data?.path ?? null };
  },

  async markRead(conversationId: string): Promise<void> {
    await supabase.from(CONV_TABLE).update({ unread_count: 0 }).eq('id', conversationId);
  },

  /**
   * Devolve a conversa à pilha de "não lidas".
   *
   * É a triagem que faltava: abrir uma conversa, ver que ela pede tempo (um
   * documento para conferir, uma resposta que depende de outra pessoa) e
   * DEIXAR MARCADA para depois. Sem isto, abrir era irreversível — o contador
   * zerava, a conversa saía da aba "Não lidas" e só voltava se o cliente
   * escrevesse de novo. Na prática, o atendente evitava abrir para não perder o
   * lugar na fila, que é o contrário do que a inbox deveria incentivar.
   *
   * Grava 1, e não a contagem real de mensagens não vistas: o número aqui é um
   * SINAL de pendência, não uma medida. Recontar quantas mensagens o atendente
   * "desleu" seria inventar precisão — ele leu todas, e escolheu voltar depois.
   */
  async markUnread(conversationId: string): Promise<void> {
    const { error } = await supabase.from(CONV_TABLE)
      .update({ unread_count: 1 }).eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  // ── Silenciar conversa (notificações), por usuário ───────────
  /** Silencia uma ou mais linhas do mesmo contato. `mutedUntil` null = sem prazo. */
  async muteConversations(conversationIds: readonly string[], mutedUntil: string | null): Promise<void> {
    const ids = [...new Set(conversationIds.filter(Boolean))];
    if (ids.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Não autenticado');
    const { error } = await supabase
      .from('whatsapp_conversation_mutes')
      .upsert(
        ids.map(conversationId => ({ conversation_id: conversationId, user_id: user.id, muted_until: mutedUntil })),
        { onConflict: 'conversation_id,user_id' },
      );
    if (error) throw new Error(error.message);
  },

  /** Compatibilidade para consumidores que operam sobre uma conversa isolada. */
  async muteConversation(conversationId: string, mutedUntil: string | null): Promise<void> {
    return conversationsApi.muteConversations([conversationId], mutedUntil);
  },

  /** Reativa as notificações de todas as linhas informadas. */
  async unmuteConversations(conversationIds: readonly string[]): Promise<void> {
    const ids = [...new Set(conversationIds.filter(Boolean))];
    if (ids.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Não autenticado');
    const { error } = await supabase
      .from('whatsapp_conversation_mutes')
      .delete()
      .in('conversation_id', ids)
      .eq('user_id', user.id);
    if (error) throw new Error(error.message);
  },

  /** Compatibilidade para consumidores que operam sobre uma conversa isolada. */
  async unmuteConversation(conversationId: string): Promise<void> {
    return conversationsApi.unmuteConversations([conversationId]);
  },

  // ── Rascunhos de mensagem, por usuário+conversa (persistidos) ─
  /** Carrega todos os rascunhos do usuário atual (mapa conversa→texto). */
  async listDrafts(): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('whatsapp_drafts')
      .select('conversation_id, content');
    if (error) throw new Error(error.message);
    const map: Record<string, string> = {};
    for (const r of (data ?? []) as { conversation_id: string; content: string }[]) {
      if (r.content) map[r.conversation_id] = r.content;
    }
    return map;
  },

  /** Salva (ou apaga, se vazio) o rascunho da conversa para o usuário atual. */
  async saveDraft(conversationId: string, content: string): Promise<void> {
    // Sem conversa não há rascunho para guardar. Um id vazio viraria
    // `conversation_id=eq.` na URL, e o Postgres devolve 400 ao tentar
    // converter "" para uuid — erro que o chamador engole no catch.
    if (!conversationId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Não autenticado');
    const text = content.trim();
    if (!text) {
      const { error } = await supabase
        .from('whatsapp_drafts')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await supabase
      .from('whatsapp_drafts')
      .upsert(
        { conversation_id: conversationId, user_id: user.id, content: text, updated_at: new Date().toISOString() },
        { onConflict: 'conversation_id,user_id' },
      );
    if (error) throw new Error(error.message);
  },

  /**
   * Pede à Evolution para entregar a presença do contato (online/visto por
   * último). Best-effort: silencioso em caso de falha, nunca atrapalha o chat.
   */
  async subscribePresence(conversationId: string): Promise<void> {
    try { await invokeFn('evolution-send', { action: 'subscribe_presence', conversation_id: conversationId }); }
    catch { /* sem presença é aceitável; não interrompe o atendimento */ }
  },

  // ── Atribuição / transferência ───────────────────────────────
  /** Transfere a conversa para um departamento e/ou pessoa, registrando o histórico. */
  async transferConversation(params: {
    conversationId: string;
    toUserId?: string | null;
    toDepartmentId?: string | null;
    note?: string;
  }): Promise<void> {
    const { conversationId, toUserId, toDepartmentId, note } = params;
    const { data: conv } = await supabase
      .from(CONV_TABLE)
      .select('assigned_user_id, department_id, awaiting_accept, transfer_pending_since')
      .eq('id', conversationId)
      .maybeSingle();

    // Transferir coloca a conversa em "aguardando aceite": o destino precisa
    // assumir explicitamente (ou a operação vê o alerta de tempo parado).
    const update: Record<string, unknown> = {
      awaiting_accept: true,
      transfer_pending_since: new Date().toISOString(),
    };
    if (toUserId !== undefined) update.assigned_user_id = toUserId;
    if (toDepartmentId !== undefined) update.department_id = toDepartmentId;
    const { error: upErr } = await supabase.from(CONV_TABLE).update(update).eq('id', conversationId);
    if (upErr) throw new Error(upErr.message);

    const { data: auth } = await supabase.auth.getUser();
    const { error: logErr } = await supabase.from(TRANSFER_TABLE).insert({
      conversation_id: conversationId,
      from_user_id: conv?.assigned_user_id ?? null,
      to_user_id: toUserId ?? null,
      from_department_id: conv?.department_id ?? null,
      to_department_id: toDepartmentId ?? null,
      note: note || null,
      performed_by: auth?.user?.id ?? null,
    });
    if (logErr) {
      // Evita deixar a conversa em estado pendente sem trilha de auditoria.
      await supabase.from(CONV_TABLE).update({
        assigned_user_id: conv?.assigned_user_id ?? null,
        department_id: conv?.department_id ?? null,
        awaiting_accept: conv?.awaiting_accept ?? false,
        transfer_pending_since: conv?.transfer_pending_since ?? null,
      }).eq('id', conversationId);
      throw new Error(logErr.message);
    }
  },

  /**
   * Aceita a transferência pendente: o usuário atual assume o atendimento,
   * limpa o estado "aguardando aceite" e carimba a transferência como aceita.
   * Validação: só o destinatário designado (ou membro do setor de destino,
   * quando não há pessoa-alvo) pode aceitar — evita "roubo" por terceiros.
   */
  async acceptTransfer(conversationId: string): Promise<void> {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    if (!uid) throw new Error('Sessão inválida.');

    // Recupera a transferência pendente mais recente para validar destinatário.
    const { data: transfer } = await supabase
      .from(TRANSFER_TABLE)
      .select('id, to_user_id, to_department_id')
      .eq('conversation_id', conversationId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (transfer) {
      if (transfer.to_user_id) {
        // Transferência direta: só o usuário-alvo aceita.
        if (transfer.to_user_id !== uid) {
          throw new Error('Esta transferência é destinada a outro atendente.');
        }
      } else if (transfer.to_department_id) {
        // Transferência por setor: o usuário deve ser membro do setor.
        const { data: membership } = await supabase
          .from('whatsapp_department_members')
          .select('user_id')
          .eq('department_id', transfer.to_department_id)
          .eq('user_id', uid)
          .maybeSingle();
        if (!membership) {
          throw new Error('Você não pertence ao setor de destino desta transferência.');
        }
      }
    }

    const { data: conv } = await supabase
      .from(CONV_TABLE)
      .select('assigned_user_id')
      .eq('id', conversationId)
      .maybeSingle();

    const patch: Record<string, unknown> = { awaiting_accept: false, transfer_pending_since: null };
    if (!conv?.assigned_user_id) patch.assigned_user_id = uid; // setor sem dono → quem aceita assume
    const { error } = await supabase.from(CONV_TABLE).update(patch).eq('id', conversationId);
    if (error) throw new Error(error.message);

    if (transfer?.id) {
      await supabase.from(TRANSFER_TABLE)
        .update({ accepted_at: new Date().toISOString(), accepted_by: uid })
        .eq('id', transfer.id);
    }
  },

  /**
   * Assume o atendimento: o usuário atual vira responsável e limpa qualquer
   * estado de "aguardando aceite". Comando direto de fila — sem passar por
   * transferência. Reabre a conversa se estiver encerrada (voltou a atender).
   */
  async assumeConversation(conversationId: string): Promise<void> {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;
    if (!uid) throw new Error('Sessão inválida.');
    const { error } = await supabase.from(CONV_TABLE).update({
      assigned_user_id: uid,
      awaiting_accept: false,
      transfer_pending_since: null,
    }).eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  /**
   * Atribui a conversa a um atendente SEM passar por aceite — é o comando de
   * distribuição da operação, não uma transferência entre pares.
   *
   * A diferença importa: `transferConversation` deixa a conversa "aguardando
   * aceite", o que é certo quando um colega passa o caso para outro (o destino
   * precisa concordar). Numa distribuição de fila isso só recria o gargalo que
   * ela veio resolver — a conversa ficaria parada esperando alguém clicar. Aqui
   * o responsável já entra valendo, e a trilha registra quem distribuiu.
   */
  async assignConversation(conversationId: string, toUserId: string, note?: string): Promise<void> {
    const { data: conv } = await supabase
      .from(CONV_TABLE)
      .select('assigned_user_id, department_id')
      .eq('id', conversationId)
      .maybeSingle();

    const { error } = await supabase.from(CONV_TABLE).update({
      assigned_user_id: toUserId,
      awaiting_accept: false,
      transfer_pending_since: null,
    }).eq('id', conversationId);
    if (error) throw new Error(error.message);

    const { data: auth } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    // Auditoria best-effort: a atribuição já valeu; perder a linha de histórico
    // não pode desfazer a distribuição e deixar a conversa órfã de novo.
    await supabase.from(TRANSFER_TABLE).insert({
      conversation_id: conversationId,
      from_user_id: conv?.assigned_user_id ?? null,
      to_user_id: toUserId,
      from_department_id: conv?.department_id ?? null,
      to_department_id: null,
      note: note || 'Distribuição da fila',
      performed_by: auth?.user?.id ?? null,
      accepted_at: now,
      accepted_by: toUserId,
    });
  },

  /**
   * Devolve a conversa para a fila: remove o responsável, mantendo setor e
   * status. Volta a ficar disponível para quem for assumir no destino.
   */
  async releaseToQueue(conversationId: string): Promise<void> {
    const { error } = await supabase.from(CONV_TABLE).update({
      assigned_user_id: null,
      awaiting_accept: false,
      transfer_pending_since: null,
    }).eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  // ── Ciclo de vida ────────────────────────────────────────────
  /**
   * Encerra a conversa: marca status/closed_*, registra quem encerrou e quando,
   * e só então manda a despedida ao cliente (best-effort).
   *
   * O encerramento vem PRIMEIRO de propósito. A despedida é uma ida à Evolution
   * e pode demorar segundos; com ela na frente, o encerramento inteiro ficava
   * pendurado no WhatsApp — a tela esperava para saber que a conversa fechou.
   * Gravando o status antes, fechar é imediato e o envio corre atrás.
   *
   * Por isso a despedida sai como `automated`: enviar numa conversa encerrada
   * reabre o atendimento (é assim que "responder é atender" funciona), e aqui
   * ela reabriria justamente o que acabou de fechar.
   */
  async closeConversation(conversationId: string, reason: string, options?: { farewell?: string }): Promise<void> {
    const note = reason.trim();
    // Motivo é opcional (interno): se vazio, encerra sem registrar motivo.
    const farewell = options?.farewell?.trim();
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from(CONV_TABLE).update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: auth?.user?.id ?? null,
      closure_reason: note || null,
      // Encerrar zera as pausas de conversa: voltam ao normal no próximo contato.
      absence_suppressed: false,
      auto_close_suppressed: false,
      // `absence_sent_at` é preservado: fechar/reabrir a conversa não pode apagar
      // o cooldown e repetir o mesmo aviso para o cliente poucos minutos depois.
    }).eq('id', conversationId);
    if (error) throw new Error(error.message);
    // Despedida depois do fechamento: falhar aqui não desfaz o encerramento.
    if (farewell) {
      try { await messagesApi.sendText({ conversationId, text: farewell, automated: true }); }
      catch { /* best-effort */ }
    }
  },

  /** Reabre manualmente uma conversa encerrada (volta para a fila). */
  async reopenConversation(conversationId: string): Promise<void> {
    const { error } = await supabase.from(CONV_TABLE).update({
      status: 'open', reopened_at: new Date().toISOString(),
    }).eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  /**
   * Limpa a conversa: apaga todas as mensagens da thread, mantendo a conversa na
   * lista (sem preview, contador zerado). Destrutivo e para toda a equipe — a UI
   * confirma antes e bloqueia quando há guarda jurídica. Mídia no storage é
   * deixada para a política de retenção (evita listagem/exclusão custosa aqui).
   */
  async clearConversation(conversationId: string): Promise<void> {
    const { error } = await supabase.from(MSG_TABLE).delete().eq('conversation_id', conversationId);
    if (error) throw new Error(error.message);
    await supabase.from(CONV_TABLE)
      .update({ last_message_preview: null, unread_count: 0 })
      .eq('id', conversationId);
  },

  /** Vincula (ou desvincula com null) a conversa a um cliente. */
  async linkClient(conversationId: string, clientId: string | null): Promise<void> {
    const { error } = await supabase
      .from(CONV_TABLE)
      .update({ client_id: clientId })
      .eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  /** Grava o motivo/assunto do contato (Fase F). Null limpa o campo. */
  async setContactReason(conversationId: string, reason: string | null): Promise<void> {
    const { error } = await supabase
      .from(CONV_TABLE)
      .update({ contact_reason: reason || null })
      .eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  /**
   * Pausa/retoma a auto-mensagem de ausência (fora do horário comercial) só desta
   * conversa. O webhook consulta este flag antes de enviar; o encerramento o limpa.
   */
  async setAbsenceSuppressed(conversationId: string, suppressed: boolean): Promise<void> {
    const { error } = await supabase
      .from(CONV_TABLE)
      .update({ absence_suppressed: suppressed })
      .eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  /**
   * Tira/devolve esta conversa ao encerramento automático por inatividade do
   * canal. Mesmo desenho da pausa de ausência: a varredura consulta o flag antes
   * de fechar, e o encerramento o limpa — a exceção morre com o atendimento.
   */
  async setAutoCloseSuppressed(conversationId: string, suppressed: boolean): Promise<void> {
    const { error } = await supabase
      .from(CONV_TABLE)
      .update({ auto_close_suppressed: suppressed })
      .eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  /** Fase L: define/remove guarda jurídica (legal_hold). */
  async setLegalHold(conversationId: string, hold: boolean, reason?: string): Promise<void> {
    const { error } = await supabase
      .from(CONV_TABLE)
      .update({ legal_hold: hold, legal_hold_reason: hold ? (reason ?? null) : null })
      .eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  /**
   * Lista as conversas anteriores de um cliente (excluindo a conversa atual),
   * limitadas às 8 mais recentes — para o painel de histórico (Fase F).
   */
  async listConversationsByClient(
    clientId: string,
    excludeId?: string,
  ): Promise<Pick<WhatsAppConversation, 'id' | 'contact_phone' | 'status' | 'last_message_at' | 'last_message_preview' | 'last_message_direction' | 'closed_at' | 'contact_reason'>[]> {
    let q = supabase
      .from(CONV_TABLE)
      .select('id, contact_phone, status, last_message_at, last_message_preview, last_message_direction, closed_at, contact_reason')
      .eq('client_id', clientId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(8);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []) as Pick<WhatsAppConversation, 'id' | 'contact_phone' | 'status' | 'last_message_at' | 'last_message_preview' | 'last_message_direction' | 'closed_at' | 'contact_reason'>[];
  },

  /**
   * Abre (ou reabre) uma conversa para um telefone num canal. Idempotente: o
   * upsert por (instance_id, remote_jid) reaproveita a thread existente em vez
   * de duplicar. Opcionalmente já vincula cliente e nome de exibição.
   */
  async openConversation(params: {
    phone: string;
    channelId: string;
    clientId?: string | null;
    contactName?: string | null;
    departmentId?: string | null;
  }): Promise<{ conversation_id: string; existed: boolean }> {
    const digits = normalizePhone(params.phone);
    if (!digits) throw new Error('Telefone inválido.');
    const remoteJid = `${digits}@s.whatsapp.net`;

    // Já existe conversa para esse número/canal? Reabre em vez de duplicar.
    // Casa por variantes com/sem o 9º dígito e por remote_jid — cobre threads
    // que entraram via `@lid` (onde o jid não traz o telefone) ou no formato
    // antigo de 8 dígitos. Prefere a conversa com atividade mais recente.
    const variants = phoneVariants(digits);
    const jids = variants.map(v => `${v}@s.whatsapp.net`);
    const { data: existing } = await supabase
      .from(CONV_TABLE)
      .select('id, last_message_at')
      .eq('instance_id', params.channelId)
      .or(`contact_phone.in.(${variants.join(',')}),remote_jid.in.(${jids.join(',')})`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1);
    const found = existing?.[0];
    if (found?.id) {
      const patch: Record<string, unknown> = {};
      if (params.clientId) patch.client_id = params.clientId;
      if (params.departmentId) patch.department_id = params.departmentId;
      if (Object.keys(patch).length) await supabase.from(CONV_TABLE).update(patch).eq('id', found.id);
      return { conversation_id: found.id, existed: true };
    }

    const { data, error } = await supabase
      .from(CONV_TABLE)
      .insert({
        instance_id: params.channelId,
        remote_jid: remoteJid,
        contact_phone: digits,
        contact_name: params.contactName || null,
        client_id: params.clientId || null,
        department_id: params.departmentId || null,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { conversation_id: data.id as string, existed: false };
  },

  /**
   * O telefone de verdade por trás de um LID.
   *
   * O LID (`252677908865131@lid`) é o apelido INTERNO do contato no WhatsApp:
   * não é um número, não pode ser discado e não pode ser mostrado como
   * telefone. Quando um convite de chamada chega endereçado assim, esta é a
   * única forma honesta de descobrir quem está ligando — uma CONSULTA ao
   * mapeamento que o CRM registrou, nunca uma conversão dos dígitos.
   *
   * Devolve `null` quando ninguém registrou aquele LID; quem chama trata como
   * "não foi possível identificar o número" e não inventa nada.
   */
  async phoneByLid(lid: string): Promise<{ phone: string; name: string | null } | null> {
    const digits = (lid || '').replace(/\D/g, '');
    if (!digits) return null;
    const { data, error } = await supabase.rpc('wa_phone_by_lid', { p_lid: digits });
    if (error) return null;
    const row = (data as Array<{ contact_phone: string; contact_name: string | null }> | null)?.[0];
    if (!row?.contact_phone) return null;
    return { phone: row.contact_phone, name: row.contact_name ?? null };
  },

  /**
   * De quem é este LID, segundo o HISTÓRICO DE CHAMADAS.
   *
   * A segunda evidência, para quando o mapeamento ainda não conhece o apelido.
   * Nós ligamos para alguém, desligamos, e a pessoa ligou de volta: o apelido
   * que chegou é o daquele número — não porque as duas ligações estão perto no
   * relógio, mas porque a MESMA sessão do WhatsApp discou aquele número e mais
   * nenhum outro na janela. As travas contra o palpite (empate de destino,
   * empate de apelido, sessão diferente, apelido já registrado) moram na
   * `wa_lid_from_callback` e estão explicadas lá.
   *
   * Devolve `null` quando a evidência não é conclusiva — e "não conclusiva" é a
   * resposta certa com muito mais frequência do que "provavelmente é fulano".
   */
  async phoneByCallback(
    lid: string,
    sessionId: string | null | undefined,
    at: number | Date = Date.now(),
  ): Promise<{ phone: string; name: string | null } | null> {
    const digits = (lid || '').replace(/\D/g, '');
    if (!digits || !sessionId) return null;
    const { data, error } = await supabase.rpc('wa_lid_from_callback', {
      p_lid: digits,
      p_session_id: sessionId,
      p_at: new Date(at).toISOString(),
    });
    if (error) return null;
    const row = (data as Array<{ contact_phone: string; contact_name: string | null }> | null)?.[0];
    if (!row?.contact_phone) return null;
    return { phone: row.contact_phone, name: row.contact_name ?? null };
  },

  /**
   * Registra que este LID é deste telefone.
   *
   * A fonte é sempre EXATA. A principal: a chamada que nós mesmos discamos —
   * sabemos para qual número ela foi e o WaCalls devolve o `peer` dela; se o
   * `peer` vier como LID, aquele LID é, por construção, o daquele número.
   * Falha em silêncio de propósito: é um ganho de reconhecimento futuro, e
   * nada nele pode atrapalhar a ligação que está acontecendo agora.
   */
  async linkLid(phone: string, lid: string): Promise<void> {
    const p = (phone || '').replace(/\D/g, '');
    const l = (lid || '').replace(/\D/g, '');
    if (!p || !l) return;
    await supabase.rpc('wa_link_lid', { p_phone: p, p_lid: l });
  },

  /**
   * Quem é o dono deste telefone? — a pergunta que uma chamada RECEBIDA faz.
   *
   * O WaCalls avisa que está tocando e só sabe o número; o operador precisa ver
   * o nome antes de atender. Casa pelas variantes com e sem o 9º dígito e pelo
   * `remote_jid` (threads que entraram por `@lid` não têm o telefone no jid), e
   * prefere a conversa com atividade mais recente — a mesma regra de
   * `openConversation`. Devolve `null` quando o número não é conhecido: aí a
   * chamada aparece só com o telefone, que é o comportamento pedido.
   */
  async findConversationByPhone(phone: string): Promise<{
    conversationId: string;
    clientId: string | null;
    name: string | null;
    avatarUrl: string | null;
    /** Responsável atual — quem recebe a chamada de voz deste contato. */
    assignedUserId: string | null;
    /** Canal por onde a conversa corre (o padrão de atendimento sai dele). */
    instanceId: string | null;
    isBlocked: boolean;
  } | null> {
    const variants = phoneVariants(phone);
    if (variants.length === 0) return null;
    const jids = variants.map(v => `${v}@s.whatsapp.net`);
    const { data } = await supabase
      .from(CONV_TABLE)
      .select('id, contact_name, contact_phone, contact_avatar_path, client_id, last_message_at, assigned_user_id, instance_id, is_blocked')
      .or(`contact_phone.in.(${variants.join(',')}),remote_jid.in.(${jids.join(',')})`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1);
    const conv = (data || [])[0] as {
      id: string; contact_name: string | null; contact_avatar_path: string | null; client_id: string | null;
      assigned_user_id: string | null; instance_id: string | null; is_blocked: boolean | null;
    } | undefined;
    if (!conv) return null;

    // Nome do CADASTRO manda no nome, como em toda a inbox (ver
    // `conversationName` em components/whatsapp/format.ts).
    let name = conv.contact_name;
    if (conv.client_id) {
      const { data: client } = await supabase
        .from('clients').select('full_name').eq('id', conv.client_id).maybeSingle();
      const fullName = (client as { full_name: string | null } | null)?.full_name;
      if (fullName) name = fullName;
    }
    const avatarUrl = await resolveAvatarUrl(conv.contact_avatar_path).catch(() => null);
    return {
      conversationId: conv.id,
      clientId: conv.client_id,
      name,
      avatarUrl,
      assignedUserId: conv.assigned_user_id ?? null,
      instanceId: conv.instance_id ?? null,
      isBlocked: conv.is_blocked === true,
    };
  },

  // ── Governança (bloqueio) ────────────────────────────────────
  /**
   * Bloqueia o contato. Vai pela edge function: bloqueia de fato no WhatsApp
   * (Evolution), marca a conversa e audita server-side. `wa_blocked=false`
   * indica que o bloqueio interno valeu, mas o WhatsApp não confirmou.
   */
  async blockContact(conversationId: string, reason: string): Promise<{ wa_blocked: boolean; wa_error: string | null }> {
    const note = reason.trim();
    if (!note) throw new Error('Informe o motivo do bloqueio.');
    const data = await invokeFn('evolution-send', { action: 'block', conversation_id: conversationId, reason: note });
    return { wa_blocked: !!data?.wa_blocked, wa_error: data?.wa_error ?? null };
  },

  /** Desbloqueia o contato no WhatsApp e internamente, com auditoria. */
  async unblockContact(conversationId: string): Promise<{ wa_blocked: boolean; wa_error: string | null }> {
    const data = await invokeFn('evolution-send', { action: 'unblock', conversation_id: conversationId });
    return { wa_blocked: !!data?.wa_blocked, wa_error: data?.wa_error ?? null };
  },

  // ── Etiquetas/tags (Fase M) ─────────────────────────────────
  async updateLabels(conversationId: string, labels: string[]): Promise<void> {
    const { error } = await supabase
      .from(CONV_TABLE)
      .update({ labels })
      .eq('id', conversationId);
    if (error) throw new Error(error.message);
  },

  // ── Notas internas (Fase 7) ──────────────────────────────────
  async listNotes(conversationId: string): Promise<WhatsAppInternalNote[]> {
    const { data, error } = await supabase
      .from(NOTES_TABLE)
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppInternalNote[];
  },

  async addNote(conversationId: string, body: string): Promise<WhatsAppInternalNote> {
    const text = body.trim();
    if (!text) throw new Error('Escreva a nota.');
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from(NOTES_TABLE)
      .insert({ conversation_id: conversationId, author_id: auth?.user?.id ?? null, body: text })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as WhatsAppInternalNote;
  },

  async deleteNote(noteId: string): Promise<void> {
    const { error } = await supabase.from(NOTES_TABLE).delete().eq('id', noteId);
    if (error) throw new Error(error.message);
  },

  // ── Timeline unificada (Fase 7) ──────────────────────────────
  /**
   * Histórico consolidado da conversa: transferências, notas internas, eventos
   * de ciclo de vida (encerrada/reaberta/bloqueada) e, se houver cliente,
   * movimentações processuais. Mesclado e ordenado do mais recente ao antigo.
   */
  async getConversationTimeline(conv: WhatsAppConversation): Promise<TimelineEvent[]> {
    const events: TimelineEvent[] = [];

    const [transfersRes, notesRes] = await Promise.all([
      supabase.from(TRANSFER_TABLE).select('*').eq('conversation_id', conv.id).order('created_at', { ascending: false }),
      supabase.from(NOTES_TABLE).select('*').eq('conversation_id', conv.id).order('created_at', { ascending: false }),
    ]);

    for (const t of (transfersRes.data || []) as any[]) {
      events.push({
        id: `tr-${t.id}`, kind: 'transfer', at: t.created_at, actorId: t.performed_by,
        title: t.accepted_at ? 'Transferência aceita' : 'Transferência',
        detail: t.note || null,
      });
    }
    for (const n of (notesRes.data || []) as any[]) {
      events.push({ id: `nt-${n.id}`, kind: 'note', at: n.created_at, actorId: n.author_id, title: 'Nota interna', detail: n.body });
    }

    // Eventos de ciclo de vida derivados das colunas da conversa.
    if (conv.closed_at) events.push({ id: `cl-${conv.id}`, kind: 'closed', at: conv.closed_at, actorId: conv.closed_by, title: 'Atendimento encerrado', detail: conv.closure_reason || null });
    if (conv.reopened_at) events.push({ id: `ro-${conv.id}`, kind: 'reopened', at: conv.reopened_at, actorId: null, title: 'Conversa reaberta', detail: null });
    if (conv.blocked_at) events.push({ id: `bl-${conv.id}`, kind: 'blocked', at: conv.blocked_at, actorId: conv.blocked_by, title: 'Contato bloqueado', detail: conv.blocked_reason || null });

    // Movimentações processuais (apenas se cliente vinculado). Usa a MESMA fonte
    // do painel de casos (listProcessMovementsBatch: todos os processos numa query,
    // até 40 movimentos cada) — evita N+1 e a leitura truncada de 5 procs × 10 movs.
    if (conv.client_id) {
      try {
        const procs = await processService.listProcesses({ client_id: conv.client_id });
        const procById = new Map(procs.map(p => [p.id, p]));
        const byProc = await processService.listProcessMovementsBatch(procs.map(p => p.id));
        for (const [procId, movs] of Object.entries(byProc)) {
          const p = procById.get(procId);
          if (!p) continue;
          for (const m of movs) {
            events.push({ id: `mv-${m.id}`, kind: 'process', at: m.data_hora, actorId: null,
              title: p.process_code || 'Processo', detail: m.nome });
          }
        }
      } catch { /* timeline processual é best-effort */ }
    }

    return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  },

  /**
   * Roster de atendentes que passaram pela conversa, em ordem cronológica de
   * envolvimento: quem transferiu, quem recebeu, quem aceitou — mais o
   * responsável atual e quem encerrou. Devolve user_ids distintos (nomes são
   * resolvidos na UI). Útil para a continuidade de atendimento (quem já tocou).
   */
  async getConversationAgents(conv: WhatsAppConversation): Promise<string[]> {
    const { data } = await supabase
      .from(TRANSFER_TABLE)
      .select('from_user_id, to_user_id, performed_by, accepted_by, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    const order: string[] = [];
    const push = (id?: string | null) => { if (id && !order.includes(id)) order.push(id); };
    for (const t of (data || []) as any[]) {
      push(t.from_user_id); push(t.performed_by); push(t.to_user_id); push(t.accepted_by);
    }
    push(conv.assigned_user_id);
    push(conv.closed_by);
    return order;
  },

  // ── Realtime ─────────────────────────────────────────────────
  /**
   * Assina mudanças em tempo real de forma granular: mensagens e conversas em
   * canais separados, para que a UI possa reagir cirurgicamente (mesclar a
   * conversa que mudou, atualizar só a thread aberta) em vez de recarregar tudo.
   */
  subscribe(handlers: {
    /**
     * Mensagem criada/alterada/removida, já normalizada. Chega pelo broadcast
     * privado `whatsapp:messages` — fonte única desde que o canal foi validado
     * em produção. Ver src/services/whatsapp/messageEvents.ts.
     */
    onMessageChange?: (evento: WaMessageEvent) => void;
    onConversationChange?: (payload: RealtimePostgresChangesPayload<Record<string, any>>) => void;
    /**
     * Saúde do canal. 'live' = recebendo eventos; 'down' = caiu e está tentando
     * voltar. Quem consome usa isso para ressincronizar por HTTP o que foi
     * perdido enquanto o canal esteve fora — nenhum evento é reenviado depois.
     *
     * Vem do canal de conversas, que segue em postgres_changes: os dois canais
     * viajam no MESMO websocket, então ele fora é o outro fora também.
     */
    onStatusChange?: (status: 'live' | 'down') => void;
  }) {
    // Uma fonte só para conversa e outra para mensagem, as duas com fan-out
    // local — este módulo e o notificador global entram nas MESMAS, sem abrir
    // socket próprio. Ver conversationEvents.ts e messageEvents.ts.
    const pararConversas = subscribeWaConversationEvents({
      onChange: p => handlers.onConversationChange?.(p),
      onStatusChange: handlers.onStatusChange,
    });
    const pararMensagens = subscribeWaMessageEvents(e => handlers.onMessageChange?.(e));
    return () => { pararConversas(); pararMensagens(); };
  },

  /**
   * Mudanças de conversa para o notificador global (sino/som de mensagem nova),
   * que vive fora do módulo. Mantém fresco o cache de atribuição
   * (assigned_user_id) usado para decidir "esta conversa é minha?".
   *
   * Entra na MESMA fonte que o módulo: antes eram dois canais postgres_changes
   * sobre a mesma tabela, sem filtro e com `event: '*'` nos dois — com o módulo
   * aberto, cada mudança de conversa era decodificada e trafegada duas vezes por
   * aba, e a linha tem ~400 bytes.
   */
  subscribeConversationNotifications(
    onChange: (payload: RealtimePostgresChangesPayload<Record<string, any>>) => void,
  ) {
    return subscribeWaConversationEvents({ onChange });
  },

  /**
   * Assina o INSERT de mensagens — o sinal MAIS CEDO de "mensagem nova" (dispara
   * assim que a linha é inserida, antes do UPDATE da conversa). Usado pelo
   * notificador para reduzir a latência percebida do aviso.
   *
   * Entra na MESMA fonte que o módulo: antes eram dois canais postgres_changes
   * separados sobre a mesma tabela, e cada mensagem era decodificada e trafegada
   * duas vezes por aba. Agora é fan-out local de um canal só.
   */
  subscribeInboundMessages(onInsert: (evento: WaMessageEvent) => void) {
    return subscribeWaMessageEvents(e => { if (e.op === 'INSERT') onInsert(e); });
  },

  /**
   * O mínimo sobre a MÍDIA de uma mensagem, para o aviso de mensagem nova poder
   * mostrar a miniatura da foto e a duração do áudio.
   *
   * Por que uma consulta em vez de mandar isso no broadcast: o broadcast chega a
   * TODA aba aberta de TODA a equipe, em toda mensagem. Engordá-lo com quatro
   * campos que só interessam à minoria das mensagens (as de mídia), e dentro
   * dessas só às que passam pelo filtro "é minha e devo avisar", seria pagar em
   * tráfego por mensagem para servir um punhado de avisos — e este projeto já
   * levou um susto de custo de realtime exatamente assim. Aqui a ida ao banco é
   * uma por AVISO, não uma por mensagem, e acontece fora do caminho crítico: o
   * cartão já está na tela quando ela volta.
   */
  async getMessageNotifyMeta(messageId: string): Promise<{
    storage_path: string | null; file_name: string | null;
    media_mime: string | null; media_duration_seconds: number | null;
  } | null> {
    const { data } = await supabase
      .from(MSG_TABLE)
      .select('storage_path, file_name, media_mime, media_duration_seconds')
      .eq('id', messageId)
      .maybeSingle();
    return (data as any) ?? null;
  },

  /** Metadados enxutos da conversa para o notificador (fallback de cache-miss). */
  async getConversationMeta(id: string): Promise<{
    id: string; assigned_user_id: string | null; contact_name: string | null;
    contact_phone: string; is_blocked: boolean; contact_avatar_path: string | null;
    client_id: string | null;
  } | null> {
    const { data } = await supabase
      .from(CONV_TABLE)
      .select('id, assigned_user_id, contact_name, contact_phone, is_blocked, contact_avatar_path, client_id')
      .eq('id', id)
      .maybeSingle();
    return (data as any) ?? null;
  },
};
