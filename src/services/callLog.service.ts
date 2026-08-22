// O registro das chamadas de voz — o que sobra da ligação depois que ela acaba.
//
// Uma chamada de telefone é a única conversa do escritório que não deixava
// rastro: nem horário, nem duração, nem quem falou. Este serviço é as duas
// pontas disso — quem ESCREVE é o `wacalls/callStore` no fim de cada chamada, e
// quem LÊ é a ficha do cliente (aba "Chamadas").
//
// A escrita passa por `wa_log_call` (RPC) em vez de um INSERT direto porque o
// registro precisa de duas coisas que só o banco resolve bem: descobrir a ficha
// do cliente pelo telefone e mesclar o que várias abas do escritório escrevem
// sobre a MESMA chamada (a que só viu tocar não pode rebaixar a de quem
// atendeu). Ver a migration `20260817233000_whatsapp_call_logs.sql`.
import { supabase } from '../config/supabase';

/** Bucket das gravações (o mesmo da mídia do WhatsApp, pasta própria). */
const RECORDINGS_BUCKET = 'whatsapp-media';
const RECORDINGS_FOLDER = 'call-recordings';

export type CallLogOutcome = 'answered' | 'missed' | 'declined' | 'failed';

export interface CallLogInput {
  callId: string;
  sessionId?: string | null;
  direction: 'inbound' | 'outbound';
  phone: string;
  clientId?: string | null;
  conversationId?: string | null;
  startedAt: number;
  answeredAt?: number | null;
  endedAt: number;
  endReason?: string | null;
  outcome: CallLogOutcome;
  /**
   * O apelido interno do WhatsApp (`<n>@lid`) do outro lado, quando a chamada
   * chegou endereçada assim. Vai num campo SÓ DELE — nunca no `phone`. É o que
   * permite reconhecer amanhã a ligação que hoje chegou anônima.
   */
  peerLid?: string | null;
  /** A ligação teve câmera em algum momento. Ver `WaCall.wasVideo`. */
  video?: boolean;
  recordingPath?: string | null;
  recordingMime?: string | null;
  recordingBytes?: number | null;
}

/** Uma linha da ficha: a ligação como ela é lida pelo escritório. */
export interface CallLogRow {
  id: string;
  callId: string;
  direction: 'inbound' | 'outbound';
  phone: string;
  /** O LID do contato, quando a chamada veio endereçada por ele. Não é telefone. */
  peerLid: string | null;
  clientId: string | null;
  conversationId: string | null;
  userId: string | null;
  /** Nome de quem atendeu, quando o perfil foi encontrado. */
  userName: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string;
  durationSeconds: number;
  endReason: string | null;
  outcome: CallLogOutcome;
  /** Foi chamada de VÍDEO. É o que separa as duas frases na conversa e na ficha. */
  isVideo: boolean;
  recordingPath: string | null;
  recordingMime: string | null;
  recordingBytes: number | null;
  /** Texto da gravação. Só existe depois que alguém pediu a transcrição. */
  transcript: string | null;
  transcriptStatus: 'pending' | 'done' | 'failed' | null;
  transcriptAt: string | null;
  /** Nome do contato, vindo da conversa. Só o histórico da inbox preenche. */
  contactName?: string | null;
  /** Caminho do avatar no bucket. Idem. */
  contactAvatarPath?: string | null;
}

const iso = (ms: number | null | undefined): string | null =>
  ms == null ? null : new Date(ms).toISOString();

function mapRow(row: Record<string, any>): CallLogRow {
  return {
    id: row.id,
    callId: row.call_id,
    direction: row.direction,
    phone: row.phone ?? '',
    peerLid: row.peer_lid ?? null,
    clientId: row.client_id ?? null,
    conversationId: row.conversation_id ?? null,
    userId: row.user_id ?? null,
    userName: null,
    startedAt: row.started_at,
    answeredAt: row.answered_at ?? null,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds ?? 0,
    endReason: row.end_reason ?? null,
    outcome: row.outcome,
    isVideo: row.is_video === true,
    recordingPath: row.recording_path ?? null,
    recordingMime: row.recording_mime ?? null,
    recordingBytes: row.recording_bytes ?? null,
    transcript: row.transcript ?? null,
    transcriptStatus: row.transcript_status ?? null,
    transcriptAt: row.transcript_at ?? null,
  };
}

/** Preenche o nome de quem atendeu — uma consulta para a lista inteira. */
async function withUserNames(rows: CallLogRow[]): Promise<CallLogRow[]> {
  const ids = Array.from(new Set(rows.map(r => r.userId).filter((v): v is string => !!v)));
  if (ids.length === 0) return rows;
  const { data } = await supabase.from('profiles').select('user_id, name').in('user_id', ids);
  if (!data) return rows;
  const byUser = new Map<string, string>();
  for (const p of data as Array<{ user_id: string; name: string | null }>) {
    if (p.user_id && p.name) byUser.set(p.user_id, p.name);
  }
  return rows.map(r => (r.userId ? { ...r, userName: byUser.get(r.userId) ?? null } : r));
}

/**
 * Preenche o nome e o rosto do contato — uma consulta para a lista inteira.
 *
 * Entra pela CONVERSA, que é onde o WhatsApp guarda o nome e o avatar. Uma
 * chamada sem conversa (número desconhecido, ou apelido interno que o CRM ainda
 * não aprendeu) fica sem nome de propósito: a tela diz "número não
 * identificado", que é a verdade, em vez de inventar um rótulo.
 */
async function withContacts(rows: CallLogRow[]): Promise<CallLogRow[]> {
  const ids = Array.from(new Set(
    rows.map(r => r.conversationId).filter((v): v is string => !!v),
  ));
  if (ids.length === 0) return rows;
  const { data } = await supabase
    .from('whatsapp_conversations')
    .select('id, contact_name, contact_avatar_path')
    .in('id', ids);
  if (!data) return rows;
  const byConv = new Map<string, { name: string | null; avatarPath: string | null }>();
  for (const c of data as Array<{ id: string; contact_name: string | null; contact_avatar_path: string | null }>) {
    byConv.set(c.id, { name: c.contact_name ?? null, avatarPath: c.contact_avatar_path ?? null });
  }
  return rows.map(r => {
    const c = r.conversationId ? byConv.get(r.conversationId) : undefined;
    return c ? { ...r, contactName: c.name, contactAvatarPath: c.avatarPath } : r;
  });
}

export const callLogService = {
  /**
   * Sobe a gravação e devolve o caminho no bucket.
   *
   * O nome do arquivo é o `callId`: idempotente por natureza (uma gravação por
   * chamada) e sem nada do cliente no caminho — o vínculo com a ficha é a
   * linha do registro, não o nome do arquivo.
   */
  async uploadRecording(callId: string, blob: Blob, mime: string): Promise<string> {
    const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const path = `${RECORDINGS_FOLDER}/${callId}.${extension}`;
    const { error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .upload(path, blob, { contentType: mime, upsert: true });
    if (error) throw new Error(error.message);
    return path;
  },

  /** Registra (ou completa) a chamada. Devolve o id da linha. */
  async logCall(input: CallLogInput): Promise<string | null> {
    const { data, error } = await supabase.rpc('wa_log_call', {
      p_call_id: input.callId,
      p_direction: input.direction,
      p_phone: input.phone,
      p_started_at: iso(input.startedAt),
      p_ended_at: iso(input.endedAt),
      p_outcome: input.outcome,
      p_session_id: input.sessionId ?? null,
      p_client_id: input.clientId ?? null,
      p_conversation_id: input.conversationId ?? null,
      p_answered_at: iso(input.answeredAt ?? null),
      p_end_reason: input.endReason ?? null,
      p_recording_path: input.recordingPath ?? null,
      p_recording_mime: input.recordingMime ?? null,
      p_recording_bytes: input.recordingBytes ?? null,
      p_peer_lid: input.peerLid ?? null,
      p_video: input.video ?? false,
    });
    if (error) throw new Error(error.message);
    return (data as string) ?? null;
  },

  /**
   * As chamadas da ficha de um cliente.
   *
   * Casa por `client_id` E pelos telefones do cadastro: uma ligação registrada
   * antes de o número entrar na ficha (ou para um segundo número da pessoa)
   * continua aparecendo onde ela precisa aparecer.
   */
  async listByClient(clientId: string, phones: string[] = [], limit = 100): Promise<CallLogRow[]> {
    const digits = Array.from(new Set(
      phones.map(p => (p ?? '').replace(/\D/g, '')).filter(p => p.length >= 8),
    ));
    let query = supabase
      .from('whatsapp_call_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    query = digits.length > 0
      // `like` pelos 8 últimos dígitos cobre o nono dígito do celular, a mesma
      // tolerância usada na agenda de contatos.
      ? query.or([`client_id.eq.${clientId}`, ...digits.map(d => `phone.like.%${d.slice(-8)}`)].join(','))
      : query.eq('client_id', clientId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return withUserNames((data ?? []).map(mapRow));
  },

  /**
   * As chamadas de UMA CONVERSA — o que a thread do WhatsApp desenha no meio
   * das mensagens.
   *
   * Casa por `conversation_id` E pelo telefone, e o segundo não é redundância:
   * uma chamada só ganha `conversation_id` quando o CRM reconheceu o número na
   * hora em que ela tocou. Quem ligou antes de a conversa existir, ou enquanto
   * a consulta ao banco ainda não tinha voltado, entra pelo telefone — que é
   * justamente o histórico mais antigo, o que mais falta faz.
   *
   * `ascending` porque a thread lê de cima para baixo; a ficha lê ao contrário.
   */
  async listByConversation(
    conversationId: string,
    phones: Array<string | null | undefined> = [],
    limit = 200,
  ): Promise<CallLogRow[]> {
    const digits = Array.from(new Set(
      phones.map(p => (p ?? '').replace(/\D/g, '')).filter(p => p.length >= 8),
    ));
    let query = supabase
      .from('whatsapp_call_logs')
      .select('*')
      .order('started_at', { ascending: true })
      .limit(limit);
    query = digits.length > 0
      // Os 8 últimos dígitos: a mesma tolerância ao nono dígito do celular que
      // a agenda de contatos e a ficha do cliente usam.
      ? query.or([
        `conversation_id.eq.${conversationId}`,
        ...digits.map(d => `phone.like.%${d.slice(-8)}`),
      ].join(','))
      : query.eq('conversation_id', conversationId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return withUserNames((data ?? []).map(mapRow));
  },

  /**
   * O HISTÓRICO DE LIGAÇÕES do escritório — a aba de chamadas da inbox.
   *
   * A pergunta que ela responde é a que nenhuma outra tela respondia: "quem
   * ligou e ninguém atendeu?". A ficha do cliente só sabe das ligações DAQUELE
   * cliente e a thread só das daquela conversa; uma chamada perdida de alguém
   * que ninguém abriu depois não aparecia em lugar nenhum — o escritório só
   * descobria pelo WhatsApp do celular, se descobrisse.
   *
   * Traz o nome e o rosto junto porque uma lista de telefones não é histórico
   * de ligação: são duas consultas (as chamadas, depois as conversas delas), e
   * não um `join` no PostgREST.
   *
   * O RECORTE É DO BANCO. Esta lista já foi "todas as chamadas do escritório", e
   * era por onde o telefone, o nome, o rosto e o horário de contatos de um canal
   * restrito apareciam para quem não podia abrir aquela conversa — a aba de
   * Ligações contando o que a thread se recusava a mostrar. Hoje a policy
   * `wa_can_see_call` responde por linha: a ligação aparece se for SUA, se
   * pertencer a um atendimento que você enxerga, ou se o número não for de
   * conversa nenhuma. Nada disso é decidido aqui.
   */
  async listRecent(limit = 80): Promise<CallLogRow[]> {
    const { data, error } = await supabase
      .from('whatsapp_call_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map(mapRow);
    return withContacts(await withUserNames(rows));
  },

  /**
   * AS PERDIDAS RECENTES — o que alimenta o cartão que fica na tela.
   *
   * Uma consulta curta e específica, e não a `listRecent` inteira, porque esta
   * roda em QUALQUER módulo do CRM (o cartão é global) e a outra é da inbox: o
   * filtro é do banco, o teto é pequeno e a janela é de horas.
   *
   * Ela existe por causa da mesa do colega: uma ligação que tocou no navegador
   * dele não gera evento nenhum aqui dentro, e sem esta releitura a perdida do
   * escritório só apareceria para quem estava com a inbox aberta. Traz nome e
   * rosto junto — um aviso de chamada perdida com um telefone cru obriga a
   * pessoa a abrir outra tela para saber quem ligou.
   */
  async listRecentMissed(sinceMs: number, limit = 20): Promise<CallLogRow[]> {
    const { data, error } = await supabase
      .from('whatsapp_call_logs')
      .select('*')
      .eq('direction', 'inbound')
      .eq('outcome', 'missed')
      .gte('started_at', new Date(sinceMs).toISOString())
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return withContacts((data ?? []).map(mapRow));
  },

  /**
   * Só as chamadas que deixaram gravação — a aba "Gravações".
   *
   * A mesma consulta da aba "Chamadas" com um filtro a mais. Vale a viagem
   * separada porque as duas abas respondem a perguntas diferentes: uma é o
   * histórico de contato, a outra é o acervo de áudio.
   */
  async listRecordingsByClient(clientId: string, phones: string[] = [], limit = 100): Promise<CallLogRow[]> {
    const rows = await this.listByClient(clientId, phones, limit);
    return rows.filter(r => !!r.recordingPath);
  },

  /**
   * Transcreve a gravação — uma vez.
   *
   * Quem fala com o Whisper é a Edge Function `call-transcribe`: a chave é dela,
   * e o texto fica gravado na linha da chamada. Chamar de novo devolve o que já
   * está lá sem gastar nada; `force` é o único caminho que transcreve outra vez.
   */
  async transcribe(callLogId: string, force = false): Promise<{ status: string; text?: string; error?: string }> {
    const { data, error } = await supabase.functions.invoke('call-transcribe', {
      body: { call_log_id: callLogId, force },
    });
    if (error) {
      // A Edge Function responde 4xx/5xx com um JSON explicando; o supabase-js
      // transforma isso em erro e esconde o corpo, que é justamente a parte que
      // a tela precisa mostrar.
      const detail = await (error as any)?.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message || 'Falha ao transcrever');
    }
    return (data as any) ?? { status: 'failed' };
  },

  /** Apaga só o texto. A gravação continua, e pode ser transcrita de novo. */
  async deleteTranscript(callLogId: string): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_call_logs')
      .update({ transcript: null, transcript_status: null, transcript_model: null, transcript_at: null })
      .eq('id', callLogId);
    if (error) throw new Error(error.message);
  },

  /**
   * Apaga a gravação: o áudio, a transcrição — e só isso. A ligação continua no
   * histórico com horário, duração e desfecho.
   *
   * São duas metades, e as duas são travadas no servidor para administrador: a
   * RPC recusa quem não é, e a política do bucket idem. O botão escondido na
   * tela é conveniência, não permissão.
   */
  async deleteRecording(callLogId: string): Promise<void> {
    const { data: path, error } = await supabase.rpc('wa_delete_call_recording', {
      p_call_log_id: callLogId,
    });
    if (error) throw new Error(error.message);
    if (path) {
      const { error: rmError } = await supabase.storage.from(RECORDINGS_BUCKET).remove([path as string]);
      // O arquivo órfão é um problema menor do que travar a tela: a linha já não
      // aponta para ele e ninguém mais chega no áudio pelo CRM.
      if (rmError) console.warn('gravação removida do registro, mas não do bucket:', rmError.message);
    }
  },

  /** É administrador? Só ele pode apagar gravação. */
  async canDeleteRecordings(): Promise<boolean> {
    const { data, error } = await supabase.rpc('is_office_admin');
    if (error) return false;
    return data === true;
  },

  /**
   * Devolve identidade às chamadas que ficaram registradas só com o apelido.
   *
   * Roda depois de o CRM APRENDER um LID (pela chamada de saída ou pelo
   * callback). O que estava anônimo no histórico ganha telefone, conversa e
   * cliente de uma vez — inclusive as ligações antigas da mesma pessoa.
   *
   * Falha em silêncio: é ganho retroativo, nunca um erro na cara de quem está
   * no meio de uma chamada.
   */
  async resolveLids(lid?: string | null): Promise<number> {
    const { data, error } = await supabase.rpc('wa_resolve_call_lids', {
      p_lid: (lid || '').replace(/\D/g, '') || null,
    });
    if (error) return 0;
    return Number(data) || 0;
  },

  /** URL assinada para ouvir/baixar a gravação. */
  async recordingUrl(path: string, expiresIn = 3600): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  },
};

export default callLogService;
