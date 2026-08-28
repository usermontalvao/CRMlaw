// Camada de conversas: lista, ciclo de vida, atribuição/transferência,
// governança (bloqueio), notas internas, timeline unificada e realtime.
import { supabase } from '../../config/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { processService } from '../process.service';
import type { WhatsAppConversation, WhatsAppClientLite, TimelineEvent } from '../../types/whatsapp.types';
import {
  CONV_TABLE, MSG_TABLE, CHANNEL_TABLE, TRANSFER_TABLE, NOTES_TABLE,
  attachAvatarUrls, attachClientNames, invokeFn, normalizePhone, phoneVariants, resolveAvatarUrl,
  type WhatsAppInternalNote,
} from './shared';
import { filtrarPorCanalPermitido } from './canaisPermitidos';
import { messagesApi } from './messages';
import { subscribeWaMessageEvents, type WaMessageEvent } from './messageEvents';
import { subscribeWaConversationEvents } from './conversationEvents';
import { collapseContactThreads } from '../../components/whatsapp/contactThreads';
import { suprimirAvisoDeTransferencia } from './transferNotice';

/**
 * Os canais que o SERVIDOR entrega para este usuário — a lista de
 * `whatsapp_instances` já recortada pela policy `wa_can_see_channel`.
 *
 * É o insumo da segunda tranca (`filtrarPorCanalPermitido`), e por isso é
 * guardada por pouco tempo: perder acesso a um canal precisa refletir na lista
 * na atualização seguinte, não no próximo F5. Falha de rede devolve `null` —
 * "não sei" —, e "não sei" nunca filtra nada.
 */
const VALIDADE_CANAIS_MS = 60_000;
let canaisEm = 0;
let canaisIds: string[] | null = null;

async function canaisPermitidosIds(): Promise<string[] | null> {
  if (canaisIds && Date.now() - canaisEm < VALIDADE_CANAIS_MS) return canaisIds;
  const { data, error } = await supabase.from(CHANNEL_TABLE).select('id');
  if (error) return null;
  const ids = (data || []).map((c: any) => c.id as string).filter(Boolean);
  // Lista vazia não é resposta: pode ser a consulta que saiu antes de a sessão
  // ser restaurada. Não guarda, e devolve "não sei".
  if (ids.length === 0) return null;
  canaisIds = ids;
  canaisEm = Date.now();
  return ids;
}

/** Esquece os canais guardados — usado quando a conta muda. */
export function esqueceCanaisPermitidos(): void {
  canaisIds = null;
  canaisEm = 0;
}

export const conversationsApi = {
  // ── Conversas ────────────────────────────────────────────────
  async listConversations(): Promise<WhatsAppConversation[]> {
    const [resposta, canais] = await Promise.all([
      supabase
        .from(CONV_TABLE)
        .select('*')
        // Aviso ao time não é atendimento: a conversa interna existe para
        // guardar o que foi mandado, não para alguém responder. Ver
        // `is_internal` na migration `wa_conversa_interna`.
        .eq('is_internal', false)
        .order('last_message_at', { ascending: false, nullsFirst: false }),
      canaisPermitidosIds(),
    ]);
    const { data, error } = resposta;
    if (error) throw new Error(error.message);
    // A policy já recortou. Isto é a segunda tranca — ver `canaisPermitidos.ts`.
    const convs = filtrarPorCanalPermitido((data || []) as WhatsAppConversation[], canais);
    await Promise.all([attachAvatarUrls(convs), attachClientNames(convs)]);
    return convs;
  },

  /**
   * Quantas PESSOAS estão esperando resposta agora.
   *
   * É o mesmo número da aba "Não lidas" da inbox, e existe para quem está fora
   * do módulo — o widget flutuante, que precisa do total sem manter a lista de
   * conversas carregada. As três regras vêm de lá, não de uma definição nova:
   *
   *   • `unread_count > 0` é o sinal de pendência (ver `markUnread`);
   *   • bloqueada não conta — ela sai da fila normal;
   *   • ENCERRADA não conta — e esta é a regra que faltava. O `unread_count`
   *     não é zerado quando o atendimento fecha, então sobra uma marca de "não
   *     lida" em conversas resolvidas semanas atrás. Era daí que saíam os 16 do
   *     badge com a inbox mostrando 1: catorze delas estavam fechadas, a mais
   *     antiga havia quinze dias. A inbox nunca as mostrou porque o filtro de
   *     status dela nasce em "Abertas" (`hiddenByStatusFilter`);
   *   • duas linhas do mesmo contato (um por canal do escritório) são UMA
   *     pessoa, pelo mesmo `collapseContactThreads` que a lista usa.
   *
   *   • INTERNA não conta — o lembrete de prazo que o CRM manda para o próprio
   *     time não é gente esperando resposta, e o responsável já o lê no sino.
   *
   * Silenciada CONTA: silenciar cala o aviso, não resolve o atendimento.
   *
   * A consulta traz só as linhas não lidas — é um punhado, não a inbox inteira —
   * e o RLS já limita o que este usuário enxerga.
   */
  async countUnreadContacts(): Promise<number> {
    const [resposta, canais] = await Promise.all([
      supabase
        .from(CONV_TABLE)
        .select('id, instance_id, contact_phone, remote_jid, client_id, status, unread_count, is_blocked')
        .gt('unread_count', 0)
        .eq('is_blocked', false)
        .eq('is_internal', false)
        .neq('status', 'closed'),
      canaisPermitidosIds(),
    ]);
    const { data, error } = resposta;
    if (error) throw new Error(error.message);
    return collapseContactThreads(filtrarPorCanalPermitido((data || []) as any[], canais)).length;
  },

  /** Busca/atualiza a foto de perfil do contato na Evolution e persiste. */
  async refreshAvatar(conversationId: string): Promise<{ path: string | null }> {
    const data = await invokeFn('whatsapp-avatar', { conversation_id: conversationId });
    return { path: data?.path ?? null };
  },

  async markRead(conversationId: string): Promise<void> {
    const { error } = await supabase.rpc('wa_mark_contact_read', {
      p_conversation_id: conversationId,
    });
    if (error) throw new Error(error.message);
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
    const { error } = await supabase.rpc('wa_mark_contact_unread', {
      p_conversation_id: conversationId,
    });
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
    // Responsabilidade é do ATENDIMENTO, não do número pelo qual a pessoa falou.
    // A RPC trava e transfere todas as linhas irmãs numa transação, além de
    // registrar uma linha de histórico por canal antes de mudar o estado.
    const { error } = await supabase.rpc('wa_transfer_contact_attendance', {
      p_conversation_id: conversationId,
      p_to_user_id: toUserId ?? null,
      p_to_department_id: toDepartmentId ?? null,
      p_note: note || null,
    });
    if (error) throw new Error(error.message);
  },

  /**
   * QUEM passou esta conversa, e o que escreveu ao passar.
   *
   * Serve ao aviso de "a conversa caiu no seu nome": sem o nome de quem passou,
   * o cartão diria apenas que a conversa mudou de dono — e a primeira pergunta
   * de quem recebe é sempre "quem me passou isso, e por quê?". A observação vem
   * junto porque é ela que evita o retrabalho de reler a conversa inteira.
   *
   * Best-effort de propósito: falhando a consulta (ou não havendo linha de
   * transferência, que é o caso da distribuição automática de fila), o aviso
   * sai sem o nome em vez de não sair.
   */
  async getTransferOrigin(conversationId: string): Promise<{ byName: string | null; note: string | null } | null> {
    const { data, error } = await supabase
      .from(TRANSFER_TABLE)
      .select('performed_by, note, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;

    const note = ((data as any).note ?? null) as string | null;
    const performedBy = ((data as any).performed_by ?? null) as string | null;
    if (!performedBy) return { byName: null, note };

    const { data: perfil } = await supabase
      .from('profiles')
      .select('name')
      .eq('user_id', performedBy)
      .maybeSingle();

    return { byName: ((perfil as any)?.name ?? null) as string | null, note };
  },

  /**
   * Aceita a transferência pendente: o usuário atual assume o atendimento,
   * limpa o estado "aguardando aceite" e carimba a transferência como aceita.
   * Validação: só o destinatário designado (ou membro do setor de destino,
   * quando não há pessoa-alvo) pode aceitar — evita "roubo" por terceiros.
   */
  async acceptTransfer(conversationId: string, transferId?: string | null): Promise<void> {
    // Antes da RPC: a linha nova volta pelo realtime em milissegundos, e a
    // marca precisa já estar de pé quando ela chegar — senão o sistema avisa a
    // pessoa do clique que ela mesma acabou de dar.
    suprimirAvisoDeTransferencia(conversationId);
    // `p_transfer_id` é o caminho preferido: ele diz QUAL convite está sendo
    // aceito. Sem ele, a RPC resolve a transferência pendente destinada a quem
    // chamou — e não havendo nenhuma, recusa (antes ela seguia em frente e
    // atribuía a conversa assim mesmo, que era "assumir" disfarçado de aceitar).
    let { error } = await supabase.rpc('wa_accept_contact_transfer', {
      p_conversation_id: conversationId,
      p_transfer_id: transferId ?? null,
    });
    // Banco anterior à migration `whatsapp_transferencias_e_supervisao`: a RPC
    // existe, mas só com `p_conversation_id`. Migration e front-end sobem
    // separados neste projeto — sem esta queda, aceitar transferência pararia
    // de funcionar no intervalo entre os dois deploys.
    if (error && (error.code === 'PGRST202' || /function/i.test(error.message))) {
      ({ error } = await supabase.rpc('wa_accept_contact_transfer', {
        p_conversation_id: conversationId,
      }));
    }
    if (error) throw new Error(error.message);
  },

  /**
   * Recusa a transferência. A conversa VOLTA para quem a passou — nunca fica
   * no nome de quem recusou, e nunca some da fila.
   */
  async rejectTransfer(transferId: string, reason?: string): Promise<void> {
    const { error } = await supabase.rpc('wa_reject_contact_transfer', {
      p_transfer_id: transferId,
      p_reason: reason || null,
    });
    if (error) throw new Error(error.message);
  },

  /** Cancela a transferência que EU mandei (ou, como supervisor, a do canal). */
  async cancelTransfer(transferId: string, reason?: string): Promise<void> {
    const { error } = await supabase.rpc('wa_cancel_contact_transfer', {
      p_transfer_id: transferId,
      p_reason: reason || null,
    });
    if (error) throw new Error(error.message);
  },

  /**
   * As transferências PENDENTES endereçadas a mim. É o que a tela usa para
   * saber que existe um convite — e é a única forma de o histórico de
   * transferências conceder acesso hoje.
   */
  async listMyPendingTransfers(): Promise<Array<{
    id: string; conversationId: string; fromUserId: string | null; note: string | null; createdAt: string;
  }>> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from(TRANSFER_TABLE)
      .select('id, conversation_id, from_user_id, note, created_at')
      .eq('status', 'pending')
      .eq('to_user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []).map((t: any) => ({
      id: t.id,
      conversationId: t.conversation_id,
      fromUserId: t.from_user_id ?? null,
      note: t.note ?? null,
      createdAt: t.created_at,
    }));
  },

  /**
   * Empresta a conversa a um colega — acesso a ELA, com prazo, sem abrir o
   * canal. É o meio-termo que faltava entre "transferir e perder o caso" e
   * "inscrever a pessoa no canal inteiro".
   */
  async grantCollaborator(
    conversationId: string, userId: string, hours = 24, reason?: string,
  ): Promise<void> {
    const { error } = await supabase.rpc('wa_grant_conversation_collaborator', {
      p_conversation_id: conversationId,
      p_user_id: userId,
      p_hours: hours,
      p_reason: reason || null,
    });
    if (error) throw new Error(error.message);
  },

  /** Encerra o empréstimo antes do prazo. */
  async revokeCollaborator(conversationId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_conversation_collaborators')
      .update({ revoked_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (error) throw new Error(error.message);
  },

  /** As conversas que me foram emprestadas e ainda valem. */
  async listMyCollaborations(): Promise<string[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('whatsapp_conversation_collaborators')
      .select('conversation_id, expires_at')
      .eq('user_id', user.id)
      .is('revoked_at', null);
    if (error) return [];
    const agora = Date.now();
    return (data ?? [])
      .filter((c: any) => !c.expires_at || Date.parse(c.expires_at) > agora)
      .map((c: any) => c.conversation_id as string);
  },

  /**
   * Assume o atendimento: o usuário atual vira responsável e limpa qualquer
   * estado de "aguardando aceite". Comando direto de fila — sem passar por
   * transferência. Reabre a conversa se estiver encerrada (voltou a atender).
   */
  async assumeConversation(conversationId: string): Promise<void> {
    // Assumir é um clique meu — ver `acceptTransfer`.
    suprimirAvisoDeTransferencia(conversationId);
    const { error } = await supabase.rpc('wa_assume_contact_attendance', {
      p_conversation_id: conversationId,
    });
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
    const { error } = await supabase.rpc('wa_assign_contact_attendance', {
      p_conversation_id: conversationId,
      p_to_user_id: toUserId,
      p_note: note || null,
    });
    if (error) throw new Error(error.message);
  },

  /**
   * Devolve a conversa para a fila: remove o responsável, mantendo setor e
   * status. Volta a ficar disponível para quem for assumir no destino.
   */
  async releaseToQueue(conversationId: string): Promise<void> {
    const { error } = await supabase.rpc('wa_release_contact_attendance', {
      p_conversation_id: conversationId,
    });
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
    const { error } = await supabase.rpc('wa_close_contact_attendance', {
      p_conversation_id: conversationId,
      p_reason: note || null,
    });
    if (error) throw new Error(error.message);
    // Despedida depois do fechamento: falhar aqui não desfaz o encerramento.
    if (farewell) {
      try { await messagesApi.sendText({ conversationId, text: farewell, automated: true }); }
      catch { /* best-effort */ }
    }
  },

  /** Reabre manualmente uma conversa encerrada (volta para a fila). */
  async reopenConversation(conversationId: string): Promise<void> {
    const { error } = await supabase.rpc('wa_reopen_contact_attendance', {
      p_conversation_id: conversationId,
    });
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
   * QUEM É este LID — a conversa inteira, não só o telefone.
   *
   * A `phoneByLid` responde "qual o número?" e cala quando não há número: uma
   * conversa que NASCEU endereçada por LID (`remote_jid = '<n>@lid'`, sem
   * telefone no cadastro dela) tem nome, foto e cliente vinculado, e mesmo
   * assim fazia a chamada aparecer como "número não identificado" — o CRM
   * sabia de quem era e dizia que não sabia.
   *
   * Esta pergunta é a outra: "de quem é esta ligação?". O telefone vem junto
   * quando existir, e vem VAZIO quando o que está guardado ali não é telefone.
   */
  async contactByLid(lid: string): Promise<{
    conversationId: string;
    phone: string;
    clientId: string | null;
    name: string | null;
    avatarUrl: string | null;
    assignedUserId: string | null;
    instanceId: string | null;
    isBlocked: boolean;
  } | null> {
    const digits = (lid || '').replace(/\D/g, '');
    if (!digits) return null;
    const { data, error } = await supabase.rpc('wa_contact_by_lid', { p_lid: digits });
    if (error) return null;
    const row = (data as Array<{
      conversation_id: string; contact_phone: string | null; contact_name: string | null;
      contact_avatar_path: string | null; client_id: string | null; assigned_user_id: string | null;
      instance_id: string | null; is_blocked: boolean | null;
    }> | null)?.[0];
    if (!row?.conversation_id) return null;

    // Nome do CADASTRO manda, como em `findConversationByPhone` e no resto da
    // inbox (ver `conversationName` em components/whatsapp/format.ts).
    let name = row.contact_name;
    if (row.client_id) {
      const { data: client } = await supabase
        .from('clients').select('full_name').eq('id', row.client_id).maybeSingle();
      const fullName = (client as { full_name: string | null } | null)?.full_name;
      if (fullName) name = fullName;
    }
    const avatarUrl = await resolveAvatarUrl(row.contact_avatar_path).catch(() => null);
    return {
      conversationId: row.conversation_id,
      phone: row.contact_phone || '',
      clientId: row.client_id ?? null,
      name,
      avatarUrl,
      assignedUserId: row.assigned_user_id ?? null,
      instanceId: row.instance_id ?? null,
      isBlocked: row.is_blocked === true,
    };
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

  /**
   * Troca as etiquetas SÓ se a conversa ainda estiver na etiqueta esperada.
   * Devolve `true` quando foi ESTA chamada que mudou a conversa.
   *
   * Existe para as automações que disparam sozinhas, sem ninguém clicando: o
   * mesmo evento (uma solicitação de documentos que fica pronta) chega ao mesmo
   * tempo a todos os painéis abertos do escritório, e todos tentariam mover o
   * mesmo cartão. Com a condição no WHERE, o primeiro move e os outros recebem
   * zero linhas — e só quem moveu roda as ações de entrada da etapa, que podem
   * mandar mensagem ao cliente ou até encerrar o atendimento.
   */
  async updateLabelsIfStillTagged(
    conversationId: string, requiredLabel: string, labels: string[],
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from(CONV_TABLE)
      .update({ labels })
      .eq('id', conversationId)
      .contains('labels', [requiredLabel])
      .select('id');
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
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
    const { data: deleted, error } = await supabase.from(NOTES_TABLE).delete().eq('id', noteId).select('id');
    if (error) throw new Error(error.message);
    if (!deleted || deleted.length === 0) {
      throw new Error('Nota não encontrada ou você não tem permissão para excluí-la.');
    }
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
