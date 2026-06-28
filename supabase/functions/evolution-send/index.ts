/**
 * evolution-send — envia mensagens pela Evolution e grava como outbound.
 *
 * action 'send' (padrão): { conversation_id?, phone?, channel_id?, type?, text?,
 *   storage_path?, mime_type?, file_name?, reply_to_id? }
 * action 'edit':  { action:'edit', message_id, text }
 * action 'block' | 'unblock': { action, conversation_id, reason }
 *   — bloqueia no WhatsApp via /chat/updateBlockStatus pelo remote_jid, marca a
 *   conversa, registra auditoria + resposta da Evolution (wa_response) e devolve
 *   wa_blocked/wa_error para diagnóstico.
 * action 'subscribe_presence': { conversation_id }
 *
 * Servidor (base_url + api_key) global. Requer JWT (equipe).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MEDIA_BUCKET = 'whatsapp-media';
const EVO_TIMEOUT_MS = 30_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function mapState(state: string): string {
  if (state === 'open') return 'connected';
  if (state === 'connecting') return 'connecting';
  return 'disconnected';
}

async function persistChannelStatus(admin: any, channelId: string, state: string) {
  const mapped = mapState(state);
  await admin.from('whatsapp_instances').update({
    status: mapped,
    connected_at: mapped === 'connected' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', channelId);
}

/**
 * Evita falso "desconectado" por status local stale e tenta religar a instância
 * automaticamente quando a sessão ainda é recuperável na Evolution.
 */
async function ensureChannelReady(
  admin: any,
  evo: (path: string, init?: RequestInit) => Promise<Response>,
  channelId: string,
  instanceName: string,
  cachedStatus: string | null | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const inst = encodeURIComponent(instanceName);
  const readState = async (): Promise<string> => {
    const res = await evo(`/instance/connectionState/${inst}`);
    if (!res.ok) return cachedStatus === 'connected' ? 'open' : 'close';
    const out = await res.json().catch(() => ({}));
    return out?.instance?.state || out?.state || 'close';
  };

  let state = await readState();
  await persistChannelStatus(admin, channelId, state).catch(() => {});
  if (state === 'open') return { ok: true };

  // Tenta reconectar automaticamente. Se a sessão ainda existir, a Evolution
  // costuma voltar sem exigir QR. Se exigir QR, devolvemos erro claro.
  try {
    await evo(`/instance/connect/${inst}`, { method: 'GET' }).catch(() => null);
  } catch { /* segue para rechecagem */ }

  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    state = await readState();
    await persistChannelStatus(admin, channelId, state).catch(() => {});
    if (state === 'open') return { ok: true };
  }

  const mapped = mapState(state);
  if (mapped === 'connecting') {
    return { ok: false, message: 'Canal reconectando automaticamente. Aguarde alguns segundos e tente novamente.' };
  }
  return { ok: false, message: 'Canal desconectado e não reconectou sozinho. Abra Configurações → Integrações → WhatsApp para revalidar o número.' };
}

/** Extrai mensagem de erro legível de uma resposta da Evolution API. */
function evoError(out: any, fallback: string): string {
  // Evolution v2 coloca o detalhe em response.message (array ou string)
  const respMsg = out?.response?.message;
  if (respMsg) {
    return Array.isArray(respMsg) ? respMsg.join('; ') : String(respMsg);
  }
  return out?.message || out?.error || fallback;
}

/**
 * Resolve o melhor JID de envio para um destino.
 *
 * - Contatos @lid / grupos @g.us: não dá para verificar via onWhatsApp (o número
 *   real fica oculto). Manda direto — esses JIDs vêm de inbound já confirmado.
 * - Número normal (nova conversa por telefone digitado): consulta
 *   /chat/whatsappNumbers, que resolve a variante correta do 9º dígito brasileiro
 *   e confirma se o número existe. Devolve o JID confirmado pela Evolution.
 *
 * `exists:false` => o número não tem WhatsApp ativo (erro claro pro usuário).
 * Se o lookup falhar (rede), faz fallback otimista para o target original.
 */
async function resolveSendJid(
  base: string, apikey: string, instanceName: string, target: string,
): Promise<{ jid: string; exists: boolean }> {
  if (target.includes('@lid') || target.includes('@g.us')) return { jid: target, exists: true };
  const digits = target.replace(/@.*/, '').replace(/\D/g, '');
  if (!digits) return { jid: target, exists: true };
  try {
    const res = await fetch(`${base}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ numbers: [digits] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const arr = await res.json().catch(() => []);
      const hit = Array.isArray(arr) ? arr[0] : null;
      if (hit?.exists && hit?.jid) return { jid: hit.jid, exists: true };
      if (hit && hit.exists === false) return { jid: target, exists: false };
    }
  } catch { /* lookup indisponível — segue com o target original (fallback otimista) */ }
  return { jid: target, exists: true };
}

/** Formata um JID/telefone para exibição amigável (+55 (DD) ...). */
function prettyTarget(target: string): string {
  const d = target.replace(/@.*/, '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : (d || target);
}

/** Detecta se o erro é de rede (Evolution inacessível) e devolve mensagem amigável. */
function evoNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes('refused') ||
    lower.includes('econnrefused') ||
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('connect')
  ) {
    return 'Servidor Evolution inacessível. Verifique se a URL configurada em Integrações → WhatsApp é pública (não localhost) e está ativa.';
  }
  return msg || 'Falha ao enviar';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') || '';

  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  // Chamada de sistema (cron/scheduler) autentica com o service role — que não é um
  // "usuário". Aceitamos esse caso para envios automáticos; a atribuição do remetente
  // vem de body.sender_user_id (quem agendou).
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const isSystem = !user && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!user && !isSystem) return json({ error: 'Não autenticado' }, 401);

  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Servidor Evolution
  const { data: cfgRow } = await admin.from('system_settings').select('value')
    .eq('key', 'whatsapp_evolution_config').maybeSingle();
  const server = (cfgRow?.value || {}) as { base_url?: string; api_key?: string };
  if (!server.base_url || !server.api_key) {
    return json({ error: 'Servidor Evolution não configurado. Acesse Configurações → Integrações → WhatsApp para configurar.' }, 400);
  }
  const base = server.base_url.replace(/\/+$/, '');
  const apikey = server.api_key!;
  const evo = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', apikey, ...(init?.headers || {}) },
    });

  if (body?.action === 'edit') return await handleEdit(admin, base, apikey, body);
  if (body?.action === 'block' || body?.action === 'unblock') {
    if (!user) return json({ error: 'Não autenticado' }, 401);
    return await handleBlock(admin, base, apikey, user, body);
  }
  if (body?.action === 'subscribe_presence') return await handleSubscribePresence(admin, base, apikey, body);

  const type: string = (body?.type || 'text').toString();
  const text = (body?.text ?? '').toString();
  if (type === 'text' && !text.trim()) return json({ error: 'Mensagem vazia' }, 400);

  let conversationId: string | null = body?.conversation_id || null;
  let instanceId: string | null = body?.channel_id || null;
  let sendTarget = '';

  if (conversationId) {
    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('contact_phone, instance_id, remote_jid, is_blocked').eq('id', conversationId).maybeSingle();
    if (!conv) return json({ error: 'Conversa não encontrada' }, 404);
    if (conv.is_blocked) return json({ error: 'Contato bloqueado. Desbloqueie para enviar mensagens.' }, 409);
    sendTarget = conv.remote_jid || conv.contact_phone;
    instanceId = conv.instance_id;
  } else {
    const phone = (body?.phone || '').toString().replace(/\D/g, '');
    if (!phone) return json({ error: 'Informe conversation_id ou phone' }, 400);
    if (!instanceId) return json({ error: 'Informe channel_id para nova conversa' }, 400);
    const remoteJid = `${phone}@s.whatsapp.net`;
    sendTarget = remoteJid;
    const { data: conv } = await admin.from('whatsapp_conversations').upsert({
      instance_id: instanceId, remote_jid: remoteJid, contact_phone: phone,
    }, { onConflict: 'instance_id,remote_jid' }).select('id').single();
    conversationId = conv?.id || null;
  }
  if (!conversationId || !instanceId) return json({ error: 'Falha ao resolver conversa/canal' }, 500);
  if (!sendTarget) return json({ error: 'Destino do envio não pôde ser resolvido.' }, 400);

  const { data: channel } = await admin.from('whatsapp_instances')
    .select('instance_name, status').eq('id', instanceId).maybeSingle();
  if (!channel?.instance_name) return json({ error: 'Canal sem instância configurada' }, 400);
  const ready = await ensureChannelReady(admin, evo, instanceId, channel.instance_name, channel.status);
  if (!ready.ok) {
    // Flag estruturada: o cliente (frontend e scheduler) detecta "canal fora" sem
    // depender de casar o texto da mensagem — contrato robusto para a auto-fila.
    return json({ error: ready.message, reconnect_pending: true }, 503);
  }
  const inst = encodeURIComponent(channel.instance_name);

  // Resolve o JID correto pela Evolution (corrige 9º dígito; confirma existência).
  // Crucial em nova conversa por telefone digitado — onde o número vai cru.
  const resolved = await resolveSendJid(base, apikey, channel.instance_name, sendTarget);
  if (!resolved.exists) {
    return json({ error: `O número ${prettyTarget(sendTarget)} não possui WhatsApp ativo. Confira se está correto.` }, 422);
  }
  // Se a Evolution resolveu um JID diferente (variante do 9º dígito), persiste na
  // conversa para os próximos envios e para o casamento de status do webhook.
  if (resolved.jid !== sendTarget && conversationId) {
    const newPhone = resolved.jid.replace(/@.*/, '').replace(/\D/g, '');
    await admin.from('whatsapp_conversations')
      .update({ remote_jid: resolved.jid, ...(newPhone ? { contact_phone: newPhone } : {}) })
      .eq('id', conversationId);
  }
  sendTarget = resolved.jid;

  let quoted: any = undefined;
  const replyToId: string | null = body?.reply_to_id || null;
  if (replyToId) {
    const { data: rt } = await admin.from('whatsapp_messages')
      .select('raw, evolution_message_id, content').eq('id', replyToId).maybeSingle();
    const rkey = rt?.raw?.key;
    if (rkey) quoted = { key: rkey, message: rt?.raw?.message };
  }

  let endpoint = '';
  let reqBody: any = {};
  let mediaMime: string | null = body?.mime_type || null;
  let fileName: string | null = body?.file_name || null;
  let mediaSize: number | null = null;
  const storagePath: string | null = body?.storage_path || null;

  if (type === 'text') {
    endpoint = `${base}/message/sendText/${inst}`;
    reqBody = { number: sendTarget, text, ...(quoted ? { quoted } : {}) };
  } else {
    if (!storagePath) return json({ error: 'storage_path obrigatório para mídia' }, 400);
    const dl = await admin.storage.from(MEDIA_BUCKET).download(storagePath);
    if (dl.error || !dl.data) return json({ error: 'Arquivo não encontrado no storage' }, 400);
    const buf = new Uint8Array(await dl.data.arrayBuffer());
    mediaSize = buf.byteLength;
    const b64 = bytesToB64(buf);
    if (!mediaMime) mediaMime = (dl.data as any).type || 'application/octet-stream';

    if (type === 'audio') {
      endpoint = `${base}/message/sendWhatsAppAudio/${inst}`;
      reqBody = { number: sendTarget, audio: b64, ...(quoted ? { quoted } : {}) };
    } else {
      const mediatype = type === 'image' ? 'image' : type === 'video' ? 'video' : 'document';
      endpoint = `${base}/message/sendMedia/${inst}`;
      reqBody = {
        number: sendTarget, mediatype, mimetype: mediaMime, media: b64,
        ...(text ? { caption: text } : {}),
        ...(fileName ? { fileName } : {}),
        ...(quoted ? { quoted } : {}),
      };
    }
  }

  let evoId: string | null = null;
  let evoRaw: any = null;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(EVO_TIMEOUT_MS),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: evoError(out, `Evolution retornou ${res.status}`) }, 502);
    evoId = out?.key?.id || out?.messageId || null;
    if (out?.key) evoRaw = { key: out.key, message: out.message };
  } catch (err) {
    return json({ error: evoNetworkError(err) }, 502);
  }

  const insertRow: Record<string, unknown> = {
    conversation_id: conversationId,
    evolution_message_id: evoId,
    direction: 'out',
    type,
    content: type === 'text' ? text : (text || null),
    media_mime: type === 'text' ? null : mediaMime,
    storage_path: type === 'text' ? null : storagePath,
    media_size: type === 'text' ? null : mediaSize,
    file_name: type === 'text' ? null : fileName,
    status: 'sent',
    sender_user_id: user?.id ?? (body?.sender_user_id ?? null),
    reply_to_id: replyToId,
    raw: evoRaw,
    wa_timestamp: new Date().toISOString(),
  };
  const { data: inserted, error: insErr } = await admin.from('whatsapp_messages')
    .insert(insertRow).select('id').single();
  if (insErr) return json({ error: insErr.message }, 500);

  return json({ ok: true, message_id: inserted?.id, conversation_id: conversationId, evolution_message_id: evoId });
});

async function handleEdit(admin: any, base: string, apikey: string, body: any) {
  const messageId: string | null = body?.message_id || null;
  const newText = (body?.text ?? '').toString();
  if (!messageId || !newText.trim()) return json({ error: 'message_id e text obrigatórios' }, 400);

  const { data: msg } = await admin.from('whatsapp_messages')
    .select('id, raw, type, direction, conversation_id').eq('id', messageId).maybeSingle();
  if (!msg) return json({ error: 'Mensagem não encontrada' }, 404);
  if (msg.direction !== 'out') return json({ error: 'Só é possível editar mensagens enviadas por você' }, 400);
  if (msg.type !== 'text') return json({ error: 'Só é possível editar mensagens de texto' }, 400);
  const rkey = msg.raw?.key;
  if (!rkey) return json({ error: 'Mensagem sem chave da Evolution (não editável)' }, 400);

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('remote_jid, instance_id').eq('id', msg.conversation_id).maybeSingle();
  const { data: channel } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv?.instance_id).maybeSingle();
  if (!channel?.instance_name) return json({ error: 'Canal não encontrado' }, 400);

  try {
    const res = await fetch(`${base}/chat/updateMessage/${encodeURIComponent(channel.instance_name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ number: conv?.remote_jid, key: rkey, text: newText }),
      signal: AbortSignal.timeout(EVO_TIMEOUT_MS),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: evoError(out, `Evolution retornou ${res.status}`) }, 502);
  } catch (err) {
    return json({ error: evoNetworkError(err) }, 502);
  }

  await admin.from('whatsapp_messages')
    .update({ content: newText, edited_at: new Date().toISOString() }).eq('id', messageId);
  return json({ ok: true, message_id: messageId });
}

/**
 * Bloqueia/desbloqueia no WhatsApp via /chat/updateBlockStatus (alvo = remote_jid;
 * telefone puro dá bad-request). Grava estado + auditoria com a resposta crua da
 * Evolution (wa_response) para diagnóstico. Best-effort: bloqueio interno sempre
 * vale; wa_blocked/wa_error sinalizam o lado WhatsApp.
 */
async function handleBlock(admin: any, base: string, apikey: string, user: any, body: any) {
  const conversationId: string | null = body?.conversation_id || null;
  const block = body?.action === 'block';
  const reason = (body?.reason ?? '').toString().trim();
  if (!conversationId) return json({ error: 'conversation_id obrigatório' }, 400);
  if (block && !reason) return json({ error: 'Informe o motivo do bloqueio.' }, 400);

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('remote_jid, contact_phone, instance_id').eq('id', conversationId).maybeSingle();
  if (!conv) return json({ error: 'Conversa não encontrada' }, 404);

  const { data: channel } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv.instance_id).maybeSingle();

  let waBlocked = false;
  let waResponse: any = null;
  const target = conv.remote_jid || conv.contact_phone;
  if (!channel?.instance_name || !target) {
    waResponse = { error: 'canal ou alvo ausente', target, instance: channel?.instance_name ?? null };
  } else {
    try {
      const res = await fetch(`${base}/chat/updateBlockStatus/${encodeURIComponent(channel.instance_name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey },
        body: JSON.stringify({ number: target, status: block ? 'block' : 'unblock' }),
        signal: AbortSignal.timeout(15_000),
      });
      const out = await res.json().catch(() => ({}));
      waResponse = { status: res.status, body: out, target };
      waBlocked = res.ok && (out?.block === 'success' || out?.block === 'unblock success' || out?.block === true);
      if (!waBlocked) console.error('updateBlockStatus falhou', res.status, JSON.stringify(out).slice(0, 300));
    } catch (err) {
      waResponse = { error: (err as Error).message, target };
      console.error('updateBlockStatus erro', err);
    }
  }

  const patch = block
    ? { is_blocked: true, blocked_at: new Date().toISOString(), blocked_by: user.id, blocked_reason: reason }
    : { is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null };
  const { error: upErr } = await admin.from('whatsapp_conversations').update(patch).eq('id', conversationId);
  if (upErr) return json({ error: upErr.message }, 500);

  await admin.from('whatsapp_contact_blocks').insert({
    conversation_id: conversationId,
    contact_phone: conv.contact_phone ?? null,
    action: block ? 'block' : 'unblock',
    reason: reason || null,
    performed_by: user.id,
    wa_response: waResponse,
  });

  // Mensagem de erro legível para o front (sem confirmar o bloqueio no WhatsApp).
  let waError: string | null = null;
  if (!waBlocked) {
    const msgs = waResponse?.body?.response?.message;
    waError = Array.isArray(msgs) ? msgs.join(' ') : (waResponse?.error || waResponse?.body?.message || `Evolution status ${waResponse?.status ?? '?'}`);
  }
  return json({ ok: true, wa_blocked: waBlocked, wa_error: waError });
}

async function handleSubscribePresence(admin: any, base: string, apikey: string, body: any) {
  const conversationId: string | null = body?.conversation_id || null;
  if (!conversationId) return json({ error: 'conversation_id obrigatório' }, 400);

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('remote_jid, contact_phone, instance_id').eq('id', conversationId).maybeSingle();
  if (!conv) return json({ error: 'Conversa não encontrada' }, 404);
  if ((conv.remote_jid || '').endsWith('@g.us')) return json({ ok: true, skipped: 'group' });

  const { data: channel } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv.instance_id).maybeSingle();
  if (!channel?.instance_name) return json({ error: 'Canal não encontrado' }, 400);

  const target = /^\d+$/.test(conv.contact_phone || '') ? conv.contact_phone : conv.remote_jid;
  try {
    await fetch(`${base}/chat/sendPresence/${encodeURIComponent(channel.instance_name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ number: target, presence: 'available', delay: 1000 }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* best-effort */ }
  return json({ ok: true });
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
