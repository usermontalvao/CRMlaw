/**
 * evolution-webhook — recebe eventos da Evolution API (servidor → servidor).
 *
 * Sem JWT. Autentica por ?token= comparado ao webhook_token do CANAL
 * (whatsapp_instances). O canal resolvido define o instance_id das conversas.
 *
 * Fase 2: além de texto, baixa mídia (imagem/áudio/vídeo/documento), salva no
 * bucket privado whatsapp-media e transcreve áudio de forma assíncrona.
 *
 * Fase 0.2: mensagens recebidas de contatos BLOQUEADOS são ignoradas — não
 * entram na fila nem reabrem a conversa.
 *
 * Fase N: mensagem automática de ausência fora do horário comercial do canal
 * (timezone-aware, com cooldown anti-loop).
 *
 * Dedup: contatos @lid escondem o número real (vem em remoteJidAlt). Como o
 * agente pode ter aberto a conversa via <telefone>@s.whatsapp.net, casamos
 * também pelo telefone real (variantes do 9º dígito) para não duplicar a mesma
 * pessoa em duas threads.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const MEDIA_BUCKET = 'whatsapp-media';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response('Unauthorized', { status: 401 });

  // Resolve o canal pelo token
  const { data: channel } = await admin.from('whatsapp_instances')
    .select('id, instance_name').eq('webhook_token', token).maybeSingle();
  if (!channel) return new Response('Unauthorized', { status: 401 });
  const instanceId = channel.id;
  const instanceName = channel.instance_name;

  let payload: any;
  try { payload = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const event = String(payload?.event || '').toLowerCase().replace(/_/g, '.');

  try {
    if (event === 'connection.update') {
      const state = payload?.data?.state || payload?.data?.connection || payload?.state;
      const mapped = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected';
      await admin.from('whatsapp_instances').update({
        status: mapped,
        connected_at: mapped === 'connected' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', instanceId);
      return new Response('ok');
    }

    if (event === 'presence.update') {
      await handlePresence(admin, instanceId, payload?.data);
      return new Response('ok');
    }

    if (event === 'messages.update') {
      // Atualização de status de mensagem (delivered/read/etc.)
      const items = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
      for (const u of items) await handleStatusUpdate(admin, u);
      return new Response('ok');
    }

    if (event === 'messages.upsert') {
      const items = Array.isArray(payload?.data) ? payload.data
        : Array.isArray(payload?.data?.messages) ? payload.data.messages
        : payload?.data ? [payload.data] : [];
      for (const m of items) {
        await handleMessage(admin, instanceId, instanceName, m);
      }
      return new Response('ok');
    }

    return new Response('ignored');
  } catch (err) {
    console.error('evolution-webhook error', err);
    return new Response('error', { status: 500 });
  }
});

/**
 * presence.update — presença do contato (online/digitando/gravando + visto por
 * último quando o WhatsApp fornecer). Oportunista: grava o que vier.
 * Payload: { id: '<jid>', presences: { '<jid>': { lastKnownPresence, lastSeen? } } }
 */
async function handlePresence(admin: any, instanceId: string, data: any) {
  const jid: string = data?.id || '';
  if (!jid || jid.endsWith('@g.us')) return;
  const presences = data?.presences || {};
  const node = presences[jid] || Object.values(presences)[0] || {};
  const presence: string | null = node?.lastKnownPresence || null;
  if (!presence) return;
  const lastSeen = node?.lastSeen; // segundos epoch (pode não vir)

  const patch: Record<string, unknown> = {
    presence,
    presence_updated_at: new Date().toISOString(),
  };
  if (typeof lastSeen === 'number' && lastSeen > 0) {
    patch.last_seen_at = new Date(lastSeen * 1000).toISOString();
  } else if (presence === 'unavailable') {
    patch.last_seen_at = new Date().toISOString(); // ficou offline agora
  }

  await admin.from('whatsapp_conversations').update(patch)
    .eq('instance_id', instanceId).eq('remote_jid', jid);
}

async function handleStatusUpdate(admin: any, u: any) {
  const evoId = u?.key?.id || u?.keyId || null;
  if (!evoId) return;
  const raw = String(u?.status || u?.update?.status || '').toUpperCase();
  const map: Record<string, string> = {
    DELIVERY_ACK: 'delivered', DELIVERED: 'delivered',
    READ: 'read', PLAYED: 'read',
    SERVER_ACK: 'sent', SENT: 'sent',
    ERROR: 'failed', FAILED: 'failed',
  };
  const status = map[raw];
  if (!status) return;
  // Não rebaixa um status já avançado (read > delivered > sent).
  const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 0 };
  const { data: msg } = await admin.from('whatsapp_messages')
    .select('id, status').eq('evolution_message_id', evoId).maybeSingle();
  if (!msg) return;
  if (status !== 'failed' && (rank[status] ?? 0) <= (rank[msg.status] ?? 0)) return;
  await admin.from('whatsapp_messages').update({ status }).eq('id', msg.id);
}

async function getDefaultDepartmentForChannel(admin: any, instanceId: string): Promise<string | null> {
  const { data } = await admin.from('whatsapp_channel_departments')
    .select('department_id')
    .eq('channel_id', instanceId)
    .eq('is_default', true)
    .maybeSingle();
  return data?.department_id || null;
}

async function handleMessage(admin: any, instanceId: string, instanceName: string, m: any) {
  const key = m?.key || {};
  const remoteJid: string = key?.remoteJid || '';
  if (!remoteJid) return;
  if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

  const fromMe = !!key?.fromMe;
  const evoId: string | null = key?.id || null;

  // Telefone real: contatos @lid escondem o número; vem em remoteJidAlt.
  const altJid: string = key?.remoteJidAlt || '';
  const realJid = altJid && altJid.includes('@s.whatsapp.net') ? altJid : remoteJid;
  const phone = realJid.split('@')[0];
  // ATENÇÃO: `pushName` só representa o nome do CONTATO quando a mensagem é
  // RECEBIDA (!fromMe). Em mensagens próprias (fromMe) ele é o nome do dono da
  // conta conectada — nunca deve virar `contact_name` (ver guarda mais abaixo).
  const pushName: string | null = m?.pushName || null;

  const msg = m?.message || {};
  let type = 'text';
  let content: string | null = null;
  let mediaNode: any = null;       // nó *Message com metadados de mídia
  let mediaMime: string | null = null;
  let fileName: string | null = null;

  if (msg.conversation) { content = msg.conversation; }
  else if (msg.extendedTextMessage?.text) { content = msg.extendedTextMessage.text; }
  else if (msg.imageMessage) { type = 'image'; content = msg.imageMessage.caption || null; mediaNode = msg.imageMessage; mediaMime = msg.imageMessage.mimetype || 'image/jpeg'; }
  else if (msg.audioMessage) { type = 'audio'; mediaNode = msg.audioMessage; mediaMime = msg.audioMessage.mimetype || 'audio/ogg'; }
  else if (msg.videoMessage) { type = 'video'; content = msg.videoMessage.caption || null; mediaNode = msg.videoMessage; mediaMime = msg.videoMessage.mimetype || 'video/mp4'; }
  else if (msg.documentMessage) { type = 'document'; content = msg.documentMessage.caption || null; mediaNode = msg.documentMessage; mediaMime = msg.documentMessage.mimetype || 'application/octet-stream'; fileName = msg.documentMessage.fileName || null; }
  else if (msg.documentWithCaptionMessage?.message?.documentMessage) {
    const dm = msg.documentWithCaptionMessage.message.documentMessage;
    type = 'document'; content = dm.caption || null; mediaNode = dm; mediaMime = dm.mimetype || 'application/octet-stream'; fileName = dm.fileName || null;
  }
  else if (msg.stickerMessage) { type = 'sticker'; mediaNode = msg.stickerMessage; mediaMime = msg.stickerMessage.mimetype || 'image/webp'; }
  else { content = null; }

  const tsRaw = m?.messageTimestamp;
  const waTimestamp = tsRaw ? new Date(Number(tsRaw) * 1000).toISOString() : new Date().toISOString();

  // ── Resolve a conversa (anti-duplicação) ──
  // 1) por remote_jid exato; 2) se @lid com telefone real conhecido, por
  // contact_phone (variantes do 9º dígito) — pega a thread que o agente já criou
  // via <telefone>@s.whatsapp.net; 3) cria nova pela chave original.
  let conv: { id: string; contact_avatar_path: string | null; is_blocked: boolean; status: string; department_id: string | null } | null = null;
  {
    const { data } = await admin.from('whatsapp_conversations')
      .select('id, contact_avatar_path, is_blocked, status, department_id')
      .eq('instance_id', instanceId).eq('remote_jid', remoteJid).maybeSingle();
    conv = data || null;
  }
  if (!conv && remoteJid.includes('@lid') && /^\d{12,13}$/.test(phone)) {
    const variants = phoneVariants(phone);
    const { data } = await admin.from('whatsapp_conversations')
      .select('id, contact_avatar_path, is_blocked, status, department_id')
      .eq('instance_id', instanceId)
      .in('contact_phone', variants)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1);
    conv = data?.[0] || null;
  }
  if (!conv) {
    // Conversa nova: nasce no departamento padrão do canal (aba Roteamento).
    const defaultDepartmentId = await getDefaultDepartmentForChannel(admin, instanceId);
    const { data } = await admin.from('whatsapp_conversations').upsert({
      instance_id: instanceId,
      remote_jid: remoteJid,
      contact_phone: phone,
      department_id: defaultDepartmentId,
    }, { onConflict: 'instance_id,remote_jid' }).select('id, contact_avatar_path, is_blocked, status, department_id').single();
    conv = data || null;
  } else if (conv.department_id == null) {
    // Conversa legada sem setor: faz o backfill uma única vez (não em toda mensagem).
    const defaultDepartmentId = await getDefaultDepartmentForChannel(admin, instanceId);
    if (defaultDepartmentId) {
      await admin.from('whatsapp_conversations')
        .update({ department_id: defaultDepartmentId })
        .eq('id', conv.id)
        .is('department_id', null);
      conv = { ...conv, department_id: defaultDepartmentId };
    }
  }
  if (!conv?.id) return;

  // Contato bloqueado: mensagem recebida é descartada (não entra na fila nem
  // reabre a conversa). Mensagens próprias (fromMe) seguem normalmente.
  if (!fromMe && conv.is_blocked) return;

  // P1.2 — Reabertura INTELIGENTE de conversas encerradas.
  // Reabrir em TODA mensagem criava loop: encerro → cliente responde "obrigado"/"tá
  // bom" (cortesia de despedida) → reabre → encerro de novo. Agora classificamos a
  // intenção: só reabre se for uma NOVA demanda; cortesia mantém encerrada (sem voltar
  // à fila). Ao reabrir, LIBERA o atendente anterior (volta à triagem) e mantém o setor.
  let keptClosed = false;
  if (!fromMe && conv.status === 'closed') {
    const decision = await classifyReopen(admin, conv.id, content, type, waTimestamp);
    if (decision === 'reopen') {
      await reopenToQueue(admin, conv.id);
      conv = { ...conv, status: 'open' };
    } else if (decision === 'ask') {
      // Em dúvida (nem cortesia clara, nem demanda clara): em vez de adivinhar,
      // PERGUNTA ao cliente e mantém encerrada. Se já perguntamos há pouco e ele
      // continua ambíguo, escala para humano (reabre na fila).
      const { data: cc } = await admin.from('whatsapp_conversations')
        .select('reopen_prompt_sent_at').eq('id', conv.id).maybeSingle();
      const askedAt = cc?.reopen_prompt_sent_at ? new Date(cc.reopen_prompt_sent_at).getTime() : 0;
      const recentlyAsked = askedAt > 0 && (Date.now() - askedAt) < 6 * 3_600_000;
      if (recentlyAsked) {
        await reopenToQueue(admin, conv.id);
        conv = { ...conv, status: 'open' };
      } else {
        await waSendText(admin, instanceName, remoteJid,
          'Olá! Recebi sua mensagem. 🙂 Posso te ajudar com mais alguma coisa? '
          + 'Se precisar, me conta rapidinho o que você precisa que eu reabro seu atendimento.');
        await admin.from('whatsapp_conversations')
          .update({ reopen_prompt_sent_at: new Date().toISOString() }).eq('id', conv.id);
        keptClosed = true;
      }
    } else {
      keptClosed = true; // cortesia clara → mantém encerrada
    }
  }

  // Foto de perfil: só busca quando ainda não temos (evita chamadas excessivas).
  if (!conv.contact_avatar_path && !fromMe) {
    const job = fetchAndStoreAvatar(admin, instanceName, conv.id, realJid);
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job.catch(() => {});
  }

  // Atualiza nome/telefone reais quando ainda não temos.
  // `pushName` só vale como nome do CONTATO em mensagens recebidas: numa mensagem
  // própria (fromMe) o pushName é o nome do dono da conta conectada — aplicá-lo
  // batizava todo contato novo com o nome do atendente (ex.: a saudação automática
  // disparada ao abrir a conversa gravava "pedro" como contact_name).
  const patch: Record<string, unknown> = {};
  if (pushName && !fromMe) patch.contact_name = pushName;
  if (phone) patch.contact_phone = phone;
  if (Object.keys(patch).length) {
    await admin.from('whatsapp_conversations').update(patch)
      .eq('id', conv.id)
      .or('contact_name.is.null,contact_phone.like.%@lid%,contact_phone.eq.' + phone);
  }

  // Idempotência: se já existe a mensagem, não reprocessa mídia.
  if (evoId) {
    const { data: existing } = await admin.from('whatsapp_messages')
      .select('id').eq('conversation_id', conv.id).eq('evolution_message_id', evoId).maybeSingle();
    if (existing) return;
  }

  // ── Mídia: baixar bytes e salvar no storage ──
  let storagePath: string | null = null;
  let mediaSize: number | null = null;
  if (mediaNode) {
    try {
      const bytes = await resolveMediaBytes(instanceName, m, msg);
      if (bytes) {
        const ext = extFromMime(mediaMime, fileName);
        storagePath = `${instanceId}/${conv.id}/${evoId || crypto.randomUUID()}.${ext}`;
        const up = await admin.storage.from(MEDIA_BUCKET).upload(storagePath, bytes, {
          contentType: mediaMime || 'application/octet-stream',
          upsert: true,
        });
        if (up.error) { console.error('storage upload error', up.error); storagePath = null; }
        else mediaSize = bytes.byteLength;
      }
    } catch (err) {
      console.error('media handling error', err);
    }
  }

  const transcriptionStatus = type === 'audio' ? (storagePath ? 'pending' : 'unsupported') : null;

  const { data: inserted } = await admin.from('whatsapp_messages').upsert({
    conversation_id: conv.id,
    evolution_message_id: evoId,
    direction: fromMe ? 'out' : 'in',
    type,
    content,
    media_mime: mediaMime,
    storage_path: storagePath,
    media_size: mediaSize,
    file_name: fileName,
    transcription_status: transcriptionStatus,
    status: fromMe ? 'sent' : 'delivered',
    wa_timestamp: waTimestamp,
    raw: m,
  }, { onConflict: 'conversation_id,evolution_message_id', ignoreDuplicates: true })
    .select('id').maybeSingle();

  // ── Transcrição assíncrona (não bloqueia a resposta do webhook) ──
  if (inserted?.id && transcriptionStatus === 'pending') {
    const job = transcribeAudio(admin, inserted.id, storagePath!, mediaMime || 'audio/ogg');
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job.catch(() => {});
  }

  // ── Mensagem automática de ausência (Fase N; inbound apenas; cooldown 2h) ──
  // Regra de negócio: se o cliente mandou mensagem fora do expediente, ele deve
  // receber o comunicado comercial mesmo quando a conversa estava encerrada.
  // O cooldown por conversa já evita spam/repetição excessiva.
  if (!fromMe) {
    const job = maybeAutoSendAbsence(admin, instanceId, instanceName, conv.id, remoteJid);
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job.catch(() => {});
  }

  // ── Atendimento assistido por IA (Fase J; inbound; só sem agente humano) ──
  if (!fromMe && !conv.is_blocked && !keptClosed) {
    const msgText = content || '';
    const job = maybeRunAiFlow(admin, instanceId, conv.id, msgText);
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job.catch(() => {});
  }
}

// ── Telefone (espelha src/services/whatsapp/shared.ts) ──
function normalizePhoneDigits(input: string): string {
  let d = (input || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return '';
  return d;
}
function phoneVariants(input: string): string[] {
  const d = normalizePhoneDigits(input);
  if (!d) return [];
  const out = new Set<string>([d]);
  const m = d.match(/^55(\d{2})(\d+)$/);
  if (m) {
    const [, ddd, rest] = m;
    if (rest.length === 9 && rest[0] === '9') out.add(`55${ddd}${rest.slice(1)}`); // remove o 9
    else if (rest.length === 8) out.add(`55${ddd}9${rest}`);                       // adiciona o 9
  }
  return Array.from(out);
}

/** {dow, curMins} no timezone IANA informado. Fallback p/ UTC se inválido. */
function getLocalTimeInTz(timezone: string): { dow: number; curMins: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
    const hour = +(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
    const minute = +(parts.find(p => p.type === 'minute')?.value ?? '0');
    return { dow: dayMap[weekday] ?? 0, curMins: hour * 60 + minute };
  } catch {
    const now = new Date();
    return { dow: now.getUTCDay(), curMins: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

type ReopenDecision = 'reopen' | 'keep' | 'ask';

/** Reabre a conversa devolvendo-a à fila (sem dono) e limpa o marcador de pergunta. */
async function reopenToQueue(admin: any, convId: string) {
  await admin.from('whatsapp_conversations').update({
    status: 'open',
    reopened_at: new Date().toISOString(),
    assigned_user_id: null,
    awaiting_accept: false,
    reopen_prompt_sent_at: null,
  }).eq('id', convId);
}

/** Envia um texto pelo canal (usa a config do servidor Evolution em system_settings). */
async function waSendText(admin: any, instanceName: string, remoteJid: string, text: string) {
  try {
    const { data: cfgRow } = await admin.from('system_settings')
      .select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
    const server = (cfgRow?.value || {}) as { base_url?: string; api_key?: string };
    if (!server.base_url || !server.api_key) return;
    const base = server.base_url.replace(/\/+$/, '');
    await fetch(`${base}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: server.api_key },
      body: JSON.stringify({ number: remoteJid, text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) { console.error('waSendText error', err); }
}

/**
 * Classifica uma mensagem recebida numa conversa ENCERRADA em 3 vias:
 *   'keep'   = só cortesia/despedida → mantém encerrada.
 *   'reopen' = nova demanda clara    → reabre na fila.
 *   'ask'    = ambíguo               → pergunta ao cliente (na dúvida, pergunta).
 * Heurística barata resolve o óbvio; a IA (com histórico) decide o resto.
 */
async function classifyReopen(admin: any, convId: string, text: string | null, type: string, messageTsIso?: string): Promise<ReopenDecision> {
  const raw = (text || '').trim();
  // Mídia sem legenda (foto/áudio/documento) tende a ser nova demanda → reabre.
  if (!raw) return type !== 'text' ? 'reopen' : 'keep';

  const norm = raw.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // Palavras de cortesia/agradecimento/confirmação (mensagem curta só com elas = fim).
  const COURTESY = new Set([
    'obrigado', 'obrigada', 'obg', 'obgd', 'vlw', 'valeu', 'ok', 'okay', 'blz',
    'beleza', 'isso', 'entendi', 'entendido', 'certo', 'combinado', 'perfeito',
    'otimo', 'otima', 'show', 'joia', 'grato', 'grata', 'tchau', 'agradecido',
    'agradecida', 'disponha', 'sim', 'uhum', 'aham', 'top', 'maravilha', 'gratidao',
  ]);
  // Frases curtas de despedida/confirmação (match exato do texto normalizado).
  const PHRASES = new Set([
    'ta bom', 'ta otimo', 'ta certo', 'tudo bem', 'tudo certo', 'tudo otimo',
    'de nada', 'muito obrigado', 'muito obrigada', 'isso mesmo', 'era so isso',
    'so isso', 'nada nao', 'por nada', 'ate mais', 'ate logo', 'ate breve',
    'muito obrigado mesmo', 'obrigado mesmo', 'ok obrigado', 'ta bom obrigado',
  ]);
  const GREETINGS = new Set([
    'oi', 'oii', 'oiii', 'oiiii', 'ola', 'olaa', 'olaaa', 'opa', 'eai',
    'bom dia', 'boa tarde', 'boa noite',
  ]);

  if (PHRASES.has(norm)) return 'keep';
  const words = norm.split(' ').filter(Boolean);
  if (words.length > 0 && words.length <= 4 && words.every((w) => COURTESY.has(w))) return 'keep';

  // Nova demanda explícita — não vale a pena mandar para IA.
  if (
    /^eu tenho (outra )?duvida$/.test(norm) ||
    /^tenho (outra )?duvida$/.test(norm) ||
    /^estou com (uma )?duvida$/.test(norm) ||
    /^preciso de ajuda$/.test(norm) ||
    /^quero tirar (uma )?duvida$/.test(norm) ||
    /^posso tirar (uma )?duvida$/.test(norm) ||
    /^tenho uma pergunta$/.test(norm) ||
    /^preciso falar com voces$/.test(norm)
  ) return 'reopen';

  // Pergunta explícita → quase sempre nova demanda.
  if (raw.includes('?')) return 'reopen';

  // Cumprimento enviado muito depois do encerramento (ou depois de silêncio real
  // após o encerramento) tende a ser uma nova retomada de contato.
  if (GREETINGS.has(norm)) {
    const timingDecision = await classifyGreetingByTiming(admin, convId, messageTsIso);
    if (timingDecision) return timingDecision;
  }

  // Ambíguo → IA classifica COM contexto (resolve fragmentação: "obrigado" + "meu"
  // + "amigo" em mensagens separadas é uma despedida, não 3 novas demandas).
  return await classifyReopenWithAI(admin, convId, raw);
}

/**
 * Reavalia cumprimentos simples ("oi", "olá", etc.) usando tempo:
 * - se chegaram um bom tempo após o fechamento, reabrem;
 * - se chegaram após um silêncio real depois de interações pós-fechamento, reabrem.
 * Retorna null quando o tempo não é suficiente para decidir sozinho.
 */
async function classifyGreetingByTiming(
  admin: any,
  convId: string,
  messageTsIso?: string,
): Promise<ReopenDecision | null> {
  const currentMs = messageTsIso ? new Date(messageTsIso).getTime() : Date.now();
  if (!Number.isFinite(currentMs)) return null;

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('closed_at')
    .eq('id', convId)
    .maybeSingle();
  const closedMs = conv?.closed_at ? new Date(conv.closed_at).getTime() : 0;
  if (!closedMs) return null;

  // Se o cliente volta a mandar um simples "oi" vários minutos depois do
  // encerramento, isso é retomada de contato, não cortesia.
  const minutesSinceClosed = (currentMs - closedMs) / 60_000;
  if (minutesSinceClosed >= 10) return 'reopen';

  const { data: inboundAfterClose } = await admin.from('whatsapp_messages')
    .select('wa_timestamp')
    .eq('conversation_id', convId)
    .eq('direction', 'in')
    .gt('wa_timestamp', conv.closed_at)
    .order('wa_timestamp', { ascending: false })
    .limit(1);

  const previousInboundMs = inboundAfterClose?.[0]?.wa_timestamp
    ? new Date(inboundAfterClose[0].wa_timestamp).getTime()
    : 0;

  // Se já houve mensagens pós-fechamento e agora houve nova retomada depois de
  // alguns minutos de silêncio, reabre para humano/fila.
  if (previousInboundMs && currentMs > previousInboundMs) {
    const minutesSincePreviousInbound = (currentMs - previousInboundMs) / 60_000;
    if (minutesSincePreviousInbound >= 10) return 'reopen';
  }

  return null;
}

/**
 * Classificação por IA (Groq → OpenAI), olhando o histórico recente da conversa.
 * NOVA = reabrir; CORTESIA = manter encerrada. Quando a IA não consegue decidir
 * com segurança, devolvemos `ask` para o fluxo confirmar com o cliente.
 */
async function classifyReopenWithAI(admin: any, convId: string, text: string): Promise<ReopenDecision> {
  const groqKey = Deno.env.get('GROQ_API_KEY') || Deno.env.get('VITE_GROQ_API_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('VITE_OPENAI_API_KEY');
  const chain: { url: string; key: string; model: string }[] = [];
  if (groqKey) chain.push({ url: 'https://api.groq.com/openai/v1/chat/completions', key: groqKey, model: 'llama-3.1-8b-instant' });
  if (openaiKey) chain.push({ url: 'https://api.openai.com/v1/chat/completions', key: openaiKey, model: 'gpt-4o-mini' });
  if (chain.length === 0) return 'ask'; // sem IA → perguntar é mais seguro que adivinhar

  // Histórico recente (a mensagem atual ainda não foi inserida; entra à parte).
  let context = '';
  try {
    const { data: recent } = await admin.from('whatsapp_messages')
      .select('direction, content, type, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(8);
    context = (recent || []).reverse()
      .map((r: any) => `${r.direction === 'out' ? 'Atendente' : 'Cliente'}: ${(r.content || '[' + r.type + ']').slice(0, 160)}`)
      .join('\n');
  } catch { /* sem contexto, segue só com a mensagem */ }

  const sys = 'Um atendimento de WhatsApp foi ENCERRADO e o cliente enviou uma nova mensagem. '
    + 'Considerando o HISTÓRICO recente, decida se a ÚLTIMA mensagem do cliente inicia uma NOVA demanda '
    + '(dúvida, pedido, problema ou assunto que precise de atendimento) ou é apenas CORTESIA '
    + '(agradecimento, confirmação, despedida ou fragmento dela, mesmo que em várias mensagens curtas, ex.: "obrigado" / "meu" / "amigo"). '
    + 'Responda SOMENTE uma palavra: NOVA ou CORTESIA.';
  const userMsg = `Histórico recente:\n${context || '(sem histórico)'}\n\nÚLTIMA mensagem do cliente: "${text.slice(0, 500)}"`;

  for (const link of chain) {
    try {
      const res = await fetch(link.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${link.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: link.model,
          temperature: 0,
          max_tokens: 3,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const out = await res.json();
      const ans = String(out?.choices?.[0]?.message?.content || '').toUpperCase();
      if (ans.includes('CORTESIA')) return 'keep';
      if (ans.includes('NOVA')) return 'reopen';
    } catch { /* tenta o próximo provedor */ }
  }
  return 'ask'; // todos falharam → confirmar com o cliente
}

/**
 * Fase N — Mensagem automática de ausência.
 * Disparada async para cada inbound. Cooldown: não reenvia se já enviou nos
 * últimos 120 minutos para a mesma conversa (anti-loop).
 */
async function maybeAutoSendAbsence(
  admin: any, instanceId: string, instanceName: string, convId: string, remoteJid: string,
) {
  try {
    const { data: ch } = await admin.from('whatsapp_instances')
      .select('absence_enabled, absence_message, timezone')
      .eq('id', instanceId)
      .maybeSingle();
    if (!ch?.absence_enabled || !ch?.absence_message?.trim()) return;

    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('is_blocked, absence_sent_at, absence_suppressed')
      .eq('id', convId)
      .maybeSingle();
    // absence_suppressed: o atendente pausou o aviso comercial só nesta conversa
    // (volta ao normal ao encerrar). Bloqueado também não recebe auto-mensagem.
    if (!conv || conv.is_blocked || conv.absence_suppressed) return;
    if (conv.absence_sent_at) {
      const diffH = (Date.now() - new Date(conv.absence_sent_at).getTime()) / 3_600_000;
      if (diffH < 2) return; // dentro do cooldown
    }

    const tz = ch.timezone || 'America/Cuiaba';
    const { dow, curMins } = getLocalTimeInTz(tz);

    const { data: bhRows } = await admin.from('whatsapp_business_hours')
      .select('day_of_week, start_time, end_time, is_active')
      .eq('instance_id', instanceId);
    const row = (bhRows || []).find((r: any) => r.day_of_week === dow);

    if (row && row.is_active) {
      const [sh, sm] = (row.start_time as string).split(':').map(Number);
      const [eh, em] = (row.end_time as string).split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      if (curMins >= startMins && curMins < endMins) return; // dentro do horário
    }

    const { data: cfgRow } = await admin.from('system_settings')
      .select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
    const server = (cfgRow?.value || {}) as { base_url?: string; api_key?: string };
    if (!server.base_url || !server.api_key) return;
    const base = server.base_url.replace(/\/+$/, '');

    const res = await fetch(
      `${base}/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: server.api_key },
        body: JSON.stringify({ number: remoteJid, text: ch.absence_message }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      console.error('absence auto-send failed', res.status, await res.text().catch(() => ''));
      return;
    }

    await admin.from('whatsapp_conversations')
      .update({ absence_sent_at: new Date().toISOString() })
      .eq('id', convId);
  } catch (err) {
    console.error('maybeAutoSendAbsence error', err);
  }
}

/**
 * Fase J — Atendimento assistido por IA.
 * Verifica se o canal tem IA habilitada (e se a conversa ainda não tem agente
 * humano) e invoca a edge function whatsapp-ai-flow via HTTP interno.
 * Feito como waitUntil para não atrasar a resposta do webhook.
 */
async function maybeRunAiFlow(
  admin: any, instanceId: string, convId: string, messageText: string,
) {
  try {
    // Canal com IA habilitada?
    const { data: aiCfg } = await admin.from('whatsapp_ai_channel_config')
      .select('ai_enabled').eq('channel_id', instanceId).maybeSingle();
    if (!aiCfg?.ai_enabled) return;

    // Verificar se sessão existente já foi concluída (não reprocessar).
    // pending_approval é permitido: whatsapp-ai-flow reverte para active quando
    // o cliente responde antes da aprovação do agente (descarta o pendente).
    const { data: sess } = await admin.from('whatsapp_ai_sessions')
      .select('status').eq('conversation_id', convId).maybeSingle();
    if (sess && sess.status !== 'active' && sess.status !== 'pending_approval') return;

    // Verificar se a conversa já tem agente humano (IA não interfere)
    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('assigned_user_id').eq('id', convId).maybeSingle();
    if (conv?.assigned_user_id) return;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const aiToken = Deno.env.get('WA_AI_TOKEN');
    const fnUrl = `${supabaseUrl}/functions/v1/whatsapp-ai-flow`;

    await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(aiToken ? { Authorization: `Bearer ${aiToken}` } : {}),
      },
      body: JSON.stringify({ conversation_id: convId, message_text: messageText }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error('maybeRunAiFlow error', err);
  }
}

/** Bytes da mídia: usa o base64 do webhook; senão pede à Evolution. */
async function resolveMediaBytes(instanceName: string, m: any, msg: any): Promise<Uint8Array | null> {
  const b64 = msg?.base64 || m?.message?.base64 || m?.base64;
  if (typeof b64 === 'string' && b64.length > 0) return b64ToBytes(b64);

  // Fallback: getBase64FromMediaMessage na Evolution.
  const { data: cfgRow } = await createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  ).from('system_settings').select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
  const server = (cfgRow?.value || {}) as { base_url?: string; api_key?: string };
  if (!server.base_url || !server.api_key) return null;
  const base = server.base_url.replace(/\/+$/, '');
  const res = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: server.api_key },
    body: JSON.stringify({ message: { key: m.key }, convertToMp4: false }),
  });
  if (!res.ok) return null;
  const out = await res.json().catch(() => ({}));
  const data = out?.base64 || out?.media?.base64;
  return typeof data === 'string' ? b64ToBytes(data) : null;
}

/**
 * Foto de perfil do contato: pergunta a URL à Evolution, baixa os bytes e salva
 * no bucket (cópia própria não expira como a URL CDN do WhatsApp). Persiste só o
 * caminho; o client resolve em URL assinada. Sem foto/privacidade restrita = no-op.
 */
async function fetchAndStoreAvatar(admin: any, instanceName: string, convId: string, jid: string) {
  try {
    const { data: cfgRow } = await admin.from('system_settings')
      .select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
    const server = (cfgRow?.value || {}) as { base_url?: string; api_key?: string };
    if (!server.base_url || !server.api_key) return;
    const base = server.base_url.replace(/\/+$/, '');

    const res = await fetch(`${base}/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: server.api_key },
      body: JSON.stringify({ number: jid }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return;
    const out = await res.json().catch(() => ({}));
    const picUrl: string | null = out?.profilePictureUrl || out?.profilePicUrl || null;
    if (!picUrl || typeof picUrl !== 'string') return; // contato sem foto

    const img = await fetch(picUrl, { signal: AbortSignal.timeout(20_000) });
    if (!img.ok) return;
    const mime = img.headers.get('content-type') || 'image/jpeg';
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength === 0) return;

    const ext = extFromMime(mime, null);
    const path = `avatars/${convId}.${ext}`;
    const up = await admin.storage.from(MEDIA_BUCKET).upload(path, bytes, {
      contentType: mime, upsert: true,
    });
    if (up.error) { console.error('avatar upload error', up.error); return; }
    await admin.from('whatsapp_conversations').update({ contact_avatar_path: path }).eq('id', convId);
  } catch (err) {
    console.error('fetchAndStoreAvatar error', err);
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^;]+;base64,/, ''));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function extFromMime(mime: string | null, fileName: string | null): string {
  if (fileName && fileName.includes('.')) return fileName.split('.').pop()!.slice(0, 8).toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr',
    'video/mp4': 'mp4', 'application/pdf': 'pdf',
  };
  const base = (mime || '').split(';')[0].trim();
  if (map[base]) return map[base];
  const sub = base.split('/')[1];
  return (sub || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
}

/** Transcreve áudio com Whisper (Groq → OpenAI). Atualiza a mensagem por id. */
async function transcribeAudio(admin: any, messageId: string, storagePath: string, mime: string) {
  try {
    const dl = await admin.storage.from(MEDIA_BUCKET).download(storagePath);
    if (dl.error || !dl.data) throw new Error('download falhou');
    const buf = new Uint8Array(await dl.data.arrayBuffer());

    const groqKey = Deno.env.get('GROQ_API_KEY') || Deno.env.get('VITE_GROQ_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('VITE_OPENAI_API_KEY');
    const chain: { url: string; key: string; model: string }[] = [];
    if (groqKey) chain.push({ url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: groqKey, model: 'whisper-large-v3' });
    if (openaiKey) chain.push({ url: 'https://api.openai.com/v1/audio/transcriptions', key: openaiKey, model: 'whisper-1' });
    if (chain.length === 0) {
      await admin.from('whatsapp_messages').update({ transcription_status: 'unsupported' }).eq('id', messageId);
      return;
    }

    const ext = extFromMime(mime, null);
    let text: string | null = null; let lastErr = '';
    for (const link of chain) {
      try {
        const fd = new FormData();
        fd.append('file', new Blob([buf], { type: mime }), `audio.${ext}`);
        fd.append('model', link.model);
        fd.append('language', 'pt');
        fd.append('response_format', 'json');
        const res = await fetch(link.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${link.key}` },
          body: fd,
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) { lastErr = `${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`; continue; }
        const out = await res.json();
        text = (out?.text || '').trim();
        break;
      } catch (err) { lastErr = err instanceof Error ? err.message : String(err); }
    }

    if (text != null) {
      await admin.from('whatsapp_messages')
        .update({ transcription_text: text || '(áudio sem fala detectada)', transcription_status: 'done' })
        .eq('id', messageId);
    } else {
      console.error('transcrição falhou:', lastErr);
      await admin.from('whatsapp_messages').update({ transcription_status: 'failed' }).eq('id', messageId);
    }
  } catch (err) {
    console.error('transcribeAudio error', err);
    await admin.from('whatsapp_messages').update({ transcription_status: 'failed' }).eq('id', messageId);
  }
}
