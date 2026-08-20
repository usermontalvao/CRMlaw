/**
 * evolution-send — envia mensagens pela Evolution e grava como outbound.
 *
 * action 'send' (padrão): { conversation_id?, phone?, channel_id?, type?, text?,
 *   storage_path?, mime_type?, file_name?, reply_to_id?, as_gif? }
 *   — type 'sticker' é o caminho do GIF: vira figurinha ANIMADA, porque a
 *   Evolution 2.3.7 não deixa passar `gifPlayback` em vídeo.
 * action 'edit':  { action:'edit', message_id, text }
 * action 'delete': { action:'delete', message_id, scope:'me'|'everyone' }
 *   — 'me' apaga só do CRM (soft delete); 'everyone' revoga também no aparelho
 *   do contato via /chat/deleteMessageForEveryone e só então marca aqui.
 * action 'react': { action:'react', message_id, emoji }
 *   — emoji vazio DESFAZ a reação. Sai para o aparelho do contato pelo
 *   /message/sendReaction e só então entra na coluna `reactions`.
 * action 'block' | 'unblock': { action, conversation_id, reason }
 *   — bloqueia no WhatsApp via /chat/updateBlockStatus pelo remote_jid, marca a
 *   conversa, registra auditoria + resposta da Evolution (wa_response) e devolve
 *   wa_blocked/wa_error para diagnóstico.
 * action 'subscribe_presence': { conversation_id }
 *
 * Servidor (base_url + api_key) global. Requer JWT (equipe).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { slimWaRaw } from '../_shared/wa-raw.ts';
import { ACTOR_ESCRITORIO, aplicarReacao, type WaReacao } from '../_shared/wa-reactions.ts';
import {
  CHANNEL_FLAP_GRACE_MS,
  applyChannelState,
  isWaConnectionFailure,
  mapWaState,
  type ChannelRow,
} from '../_shared/wa-channel-state.ts';

const MEDIA_BUCKET = 'whatsapp-media';
const EVO_TIMEOUT_MS = 30_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Intervalo mínimo entre dois /instance/connect do CRM no mesmo canal. */
const RECONNECT_COOLDOWN_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Garante que dá para enviar por este canal — sem transformar a checagem na causa.
 *
 * Duas armadilhas moram aqui, e as duas já morderam:
 *
 * 1. UMA leitura de `connectionState` não é veredito. Quando a sessão do número
 *    está sendo disputada por outro cliente logado na mesma conta, a Evolution
 *    devolve open/close/connecting alternados dentro do MESMO segundo enquanto as
 *    mensagens entram e saem normalmente. Por isso: duas leituras, e a memória do
 *    último `open` (last_open_at) como desempate — canal visto aberto há pouco
 *    envia, e quem dá o veredito final é a resposta do envio.
 *
 * 2. `/instance/connect` num canal que ainda tem socket vivo cria um SEGUNDO
 *    socket, e o WhatsApp derruba um dos dois por conflito. Chamar isso a cada
 *    envio era o socorro virando a doença. Agora só quando o canal está mesmo
 *    parado, e no máximo uma vez a cada RECONNECT_COOLDOWN_MS.
 */
async function ensureChannelReady(
  admin: any,
  evo: (path: string, init?: RequestInit) => Promise<Response>,
  channel: ChannelRow & { instance_name: string; last_reconnect_attempt_at?: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const inst = encodeURIComponent(channel.instance_name);
  const readState = async (): Promise<string> => {
    try {
      const res = await evo(`/instance/connectionState/${inst}`);
      if (!res.ok) return channel.status === 'connected' ? 'open' : 'close';
      const out = await res.json().catch(() => ({}));
      return out?.instance?.state || out?.state || 'close';
    } catch {
      // Servidor fora do ar não é canal desconectado: não muda o status.
      return channel.status === 'connected' ? 'open' : 'close';
    }
  };
  // Registra o que foi visto e mantém a linha em memória em dia, para as leituras
  // seguintes desta mesma requisição decidirem com a informação nova.
  const observe = async (state: string) => {
    const decision = await applyChannelState(admin, channel, state).catch(() => null);
    if (!decision) return;
    channel.status = decision.status;
    if (decision.touchLastOpen) channel.last_open_at = new Date().toISOString();
  };

  let state = await readState();
  await observe(state);
  if (state === 'open') return { ok: true };

  await sleep(1_200);
  state = await readState();
  await observe(state);
  if (state === 'open') return { ok: true };

  const lastOpen = channel.last_open_at ? Date.parse(channel.last_open_at) : NaN;
  if (!Number.isNaN(lastOpen) && Date.now() - lastOpen < CHANNEL_FLAP_GRACE_MS) return { ok: true };

  const lastTry = channel.last_reconnect_attempt_at ? Date.parse(channel.last_reconnect_attempt_at) : NaN;
  const podeReconectar = Number.isNaN(lastTry) || Date.now() - lastTry > RECONNECT_COOLDOWN_MS;
  if (podeReconectar) {
    try {
      await admin.from('whatsapp_instances')
        .update({ last_reconnect_attempt_at: new Date().toISOString() }).eq('id', channel.id);
      channel.last_reconnect_attempt_at = new Date().toISOString();
      await evo(`/instance/connect/${inst}`, { method: 'GET' });
    } catch { /* segue para rechecagem */ }
    for (let i = 0; i < 3; i++) {
      await sleep(1_500);
      state = await readState();
      await observe(state);
      if (state === 'open') return { ok: true };
    }
  }

  if (mapWaState(state) === 'connecting') {
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
  if (body?.action === 'delete') {
    if (!user) return json({ error: 'Não autenticado' }, 401);
    return await handleDelete(admin, base, apikey, user, body);
  }
  if (body?.action === 'react') {
    if (!user) return json({ error: 'Não autenticado' }, 401);
    return await handleReact(admin, base, apikey, user, body);
  }
  if (body?.action === 'block' || body?.action === 'unblock') {
    if (!user) return json({ error: 'Não autenticado' }, 401);
    return await handleBlock(admin, base, apikey, user, body);
  }
  if (body?.action === 'subscribe_presence') return await handleSubscribePresence(admin, base, apikey, body);
  if (body?.action === 'typing') return await handleTyping(admin, base, apikey, body);

  const type: string = (body?.type || 'text').toString();
  const text = (body?.text ?? '').toString();
  if (type === 'text' && !text.trim()) return json({ error: 'Mensagem vazia' }, 400);

  let conversationId: string | null = body?.conversation_id || null;
  let instanceId: string | null = body?.channel_id || null;
  let sendTarget = '';
  // Estado da conversa ANTES do envio — é o que decide a reabertura no fim.
  let wasClosed = false;
  let hadOwner = false;

  // Conversa em que o contato JÁ escreveu: o `remote_jid` dela veio do próprio
  // WhatsApp, e é isso que dispensa a consulta de existência lá embaixo.
  let destinoJaProvado = false;

  if (conversationId) {
    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('contact_phone, instance_id, remote_jid, is_blocked, status, assigned_user_id, last_customer_message_at')
      .eq('id', conversationId).maybeSingle();
    if (!conv) return json({ error: 'Conversa não encontrada' }, 404);
    if (conv.is_blocked) return json({ error: 'Contato bloqueado. Desbloqueie para enviar mensagens.' }, 409);
    sendTarget = conv.remote_jid || conv.contact_phone;
    instanceId = conv.instance_id;
    wasClosed = conv.status === 'closed';
    hadOwner = !!conv.assigned_user_id;
    destinoJaProvado = !!conv.remote_jid && !!conv.last_customer_message_at;
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
    .select('id, instance_name, status, connected_at, last_open_at, last_reconnect_attempt_at')
    .eq('id', instanceId).maybeSingle();
  if (!channel?.instance_name) return json({ error: 'Canal sem instância configurada' }, 400);
  const ready = await ensureChannelReady(admin, evo, channel);
  if (!ready.ok) {
    // Flag estruturada: o cliente (frontend e scheduler) detecta "canal fora" sem
    // depender de casar o texto da mensagem — contrato robusto para a auto-fila.
    return json({ error: ready.message, reconnect_pending: true }, 503);
  }
  const inst = encodeURIComponent(channel.instance_name);

  // Resolve o JID correto pela Evolution (corrige 9º dígito; confirma existência).
  // Crucial em nova conversa por telefone digitado — onde o número vai cru.
  //
  // E DISPENSÁVEL quando o contato já escreveu nesta conversa: o `remote_jid`
  // dali foi entregue pelo próprio WhatsApp, então perguntar "esse número
  // existe?" é uma viagem de ida e volta até o servidor da Evolution (e dali até
  // o WhatsApp) para confirmar o que já está provado. Era isso em TODA mensagem
  // enviada — texto, áudio, figurinha —, somando no relógio de quem clicou.
  const resolved = destinoJaProvado
    ? { jid: sendTarget, exists: true }
    : await resolveSendJid(base, apikey, channel.instance_name, sendTarget);
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
  /** Texto legível do cartão de contato enviado — vira o `content` da bolha. */
  let contactText = '';
  const storagePath: string | null = body?.storage_path || null;
  const asGif: boolean = body?.as_gif === true;

  if (type === 'text') {
    endpoint = `${base}/message/sendText/${inst}`;
    reqBody = { number: sendTarget, text, ...(quoted ? { quoted } : {}) };
  } else if (type === 'contact') {
    // Cartão de contato (vCard). Sai pelo endpoint PRÓPRIO da Evolution, e não
    // como um texto com o número dentro: o que chega do outro lado é um cartão
    // de verdade — salvável na agenda com um toque, com botão de ligar e de
    // abrir conversa. Mandar "o telefone do perito é 65 9xxxx" obriga a pessoa
    // a copiar dígito por dígito, e é onde o número chega errado.
    //
    // `wuid` é o que o WhatsApp usa para reconhecer o contato como usuário do
    // aplicativo; sem ele o cartão chega mudo, sem os botões.
    const contatos = Array.isArray(body?.contacts) ? body.contacts : [];
    const lista = contatos
      .map((c: any) => {
        const digits = String(c?.phone ?? '').replace(/\D/g, '');
        const nome = String(c?.name ?? '').trim();
        if (!digits || !nome) return null;
        return {
          fullName: nome,
          wuid: digits,
          phoneNumber: `+${digits}`,
          ...(c?.organization ? { organization: String(c.organization) } : {}),
          ...(c?.email ? { email: String(c.email) } : {}),
        };
      })
      .filter(Boolean);
    if (lista.length === 0) return json({ error: 'Informe ao menos um contato com nome e telefone.' }, 400);
    endpoint = `${base}/message/sendContact/${inst}`;
    reqBody = { number: sendTarget, contact: lista, ...(quoted ? { quoted } : {}) };
    // O MESMO formato que o webhook grava para um cartão RECEBIDO (nome na
    // primeira linha, telefones abaixo, cartões separados por linha em branco).
    // É o que faz a bolha enviada e a recebida serem lidas pelo mesmo código —
    // ver `components/whatsapp/contactCard.ts`.
    contactText = lista
      .map((c: any) => `${c.fullName}\n${c.phoneNumber}`)
      .join('\n\n');
  } else if (type === 'sticker') {
    // ── GIF: figurinha animada, e não vídeo ──────────────────────────────
    //
    // O caminho natural seria `sendMedia` com `mediatype:'video'` e
    // `gifPlayback:true`, que é o que o próprio WhatsApp manda. A Evolution
    // 2.3.7 não deixa: em `prepareMediaMessage` ela escreve
    // `gifPlayback = false` para TODO vídeo, e o campo nem existe no DTO. Era
    // por isso que o GIF chegava parado, com botão de play — a marca era
    // descartada no servidor, sem erro nenhum.
    //
    // O que sobra na versão dela é a figurinha: `/message/sendSticker`
    // converte para webp ANIMADO e ainda liga o `gifPlayback` do lado de lá.
    // Do outro lado a animação roda em laço, muda e sem controles — que é o
    // que se espera de um GIF.
    //
    // Duas exigências, e as duas são silenciosas quando faltam:
    //  · tem de ser URL, não base64. A Evolution decide se anima olhando o
    //    NOME do arquivo (`.gif`), e base64 não tem nome — viraria figurinha
    //    de um quadro só.
    //  · a URL assinada é curta de vida, mas só precisa durar o download que
    //    a Evolution faz agora; ela reencoda e sobe o arquivo dela.
    //  · e o arquivo NÃO passa por aqui. Como quem baixa é a Evolution, este
    //    ramo não lê o objeto do storage nem o converte para base64 — era um
    //    megabyte subindo e descendo dentro da função só para ser descartado no
    //    fim, e no relógio de quem clicou isso é o GIF demorando a sair. O
    //    tamanho vem do cliente, que acabou de subir o arquivo.
    if (!storagePath) return json({ error: 'storage_path obrigatório para mídia' }, 400);
    const assinada = await admin.storage.from(MEDIA_BUCKET)
      .createSignedUrl(storagePath, 300);
    const url = assinada?.data?.signedUrl;
    if (!url) return json({ error: 'Não foi possível preparar o GIF para envio.' }, 500);
    const tamanhoInformado = Number(body?.media_size);
    mediaSize = Number.isFinite(tamanhoInformado) && tamanhoInformado > 0 ? tamanhoInformado : null;
    if (!mediaMime) mediaMime = 'image/gif';
    endpoint = `${base}/message/sendSticker/${inst}`;
    reqBody = { number: sendTarget, sticker: url, ...(quoted ? { quoted } : {}) };
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
        // GIF do seletor: sem `gifPlayback` o WhatsApp entrega um vídeo comum,
        // com botão de play parado no lugar da animação em laço. É a mesma
        // marca que a gente já lê na entrada para a coluna `is_animated`.
        ...(asGif && mediatype === 'video' ? { gifPlayback: true } : {}),
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
    if (!res.ok) {
      const detalhe = evoError(out, `Evolution retornou ${res.status}`);
      // Socket caído NA HORA do envio é o veredito honesto de "canal fora" — mais
      // confiável que o estado consultado. Mesmo contrato da auto-fila: a mensagem
      // é retida e sai sozinha quando o canal voltar, em vez de virar erro na tela.
      if (isWaConnectionFailure(detalhe)) {
        return json({
          error: 'Canal reconectando automaticamente. A mensagem ficou retida e sai assim que ele voltar.',
          reconnect_pending: true,
        }, 503);
      }
      return json({ error: detalhe }, 502);
    }
    evoId = out?.key?.id || out?.messageId || null;
    // Sem os blobs: a resposta da Evolution traz miniatura em base64 da mídia
    // que acabamos de enviar, e ela já está no storage. Ver _shared/wa-raw.ts.
    if (out?.key) evoRaw = slimWaRaw({ key: out.key, message: out.message });
  } catch (err) {
    return json({ error: evoNetworkError(err) }, 502);
  }

  const insertRow: Record<string, unknown> = {
    conversation_id: conversationId,
    evolution_message_id: evoId,
    direction: 'out',
    type,
    // O cartão de contato não tem arquivo nenhum: o que ele deixa na thread é o
    // texto do cartão, exatamente como o webhook grava um cartão recebido.
    content: type === 'text' ? text : type === 'contact' ? contactText : (text || null),
    media_mime: type === 'text' || type === 'contact' ? null : mediaMime,
    storage_path: type === 'text' || type === 'contact' ? null : storagePath,
    media_size: type === 'text' || type === 'contact' ? null : mediaSize,
    file_name: type === 'text' || type === 'contact' ? null : fileName,
    status: 'sent',
    // Marca o que saiu como GIF para a NOSSA bolha também tocar em laço, mudo e
    // sem controles — igual ao que já fazemos com o GIF que chega.
    is_animated: asGif && (type === 'video' || type === 'sticker'),
    sender_user_id: user?.id ?? (body?.sender_user_id ?? null),
    reply_to_id: replyToId,
    raw: evoRaw,
    wa_timestamp: new Date().toISOString(),
  };
  const { data: inserted, error: insErr } = await admin.from('whatsapp_messages')
    .insert(insertRow).select('id').single();
  if (insErr) return json({ error: insErr.message }, 500);

  // Falar com o cliente É atender: quem escreve numa conversa encerrada a traz de
  // volta para a operação. Sem isso ela seguia fora da fila, do funil e do SLA
  // enquanto o atendimento acontecia dentro dela — invisível para a gestão.
  //
  // Só vale para envio de GENTE. Duas portas de saída:
  //   · `isSystem` — cron/scheduler e followups de documento/assinatura/template
  //     autenticam com service role e escrevem sozinhos; ressuscitariam conversas
  //     que ninguém retomou.
  //   · `automated` — regra do CRM que roda no navegador do atendente (ações de
  //     etapa do funil). O JWT é de gente, mas a mensagem não é atendimento: uma
  //     etapa "encerrar + avisar" reabriria o que ela mesma acabou de fechar.
  const reopened = wasClosed && !isSystem && !!user && body?.automated !== true;
  if (reopened) {
    const patch: Record<string, unknown> = {
      status: 'open',
      reopened_at: new Date().toISOString(),
      awaiting_accept: false,
      transfer_pending_since: null,
    };
    // Quem escreveu assume o caso — reabrir jogando na fila de outra pessoa seria
    // pior que deixar encerrado. Conversa que já tem dono não é tomada: takeover
    // continua sendo ato explícito (botão Assumir), como no compositor.
    if (!hadOwner) patch.assigned_user_id = user.id;
    const { error: reopenErr } = await admin.from('whatsapp_conversations')
      .update(patch).eq('id', conversationId);
    // A mensagem já saiu: falhar a reabertura não pode falhar o envio.
    if (reopenErr) console.error('reabertura por envio manual falhou', reopenErr);
  }

  return json({
    ok: true,
    message_id: inserted?.id,
    conversation_id: conversationId,
    evolution_message_id: evoId,
    reopened,
  });
});

/**
 * Apaga uma mensagem — nos dois sentidos que o WhatsApp tem.
 *
 * scope 'me': soft delete só aqui. Vale para QUALQUER mensagem da thread,
 * inclusive as recebidas, porque o que ela faz é tirar da tela do escritório —
 * o aparelho do contato não é tocado. É o único caminho possível para mensagem
 * recebida e para mensagem antiga fora da janela de revogação.
 *
 * scope 'everyone': pede a revogação à Evolution ANTES de marcar. Se a Evolution
 * recusar (mensagem velha demais, chave perdida, instância fora do ar), nada é
 * marcado e o erro sobe — o contrário seria mentir na tela, mostrando "apagada"
 * numa mensagem que continua no celular do cliente. Só mensagem NOSSA: o
 * WhatsApp não deixa ninguém revogar o que o outro escreveu.
 */
async function handleDelete(admin: any, base: string, apikey: string, user: any, body: any) {
  const messageId: string | null = body?.message_id || null;
  const scope: string = body?.scope === 'everyone' ? 'everyone' : 'me';
  if (!messageId) return json({ error: 'message_id obrigatório' }, 400);

  const { data: msg } = await admin.from('whatsapp_messages')
    .select('id, raw, direction, conversation_id, deleted_at, evolution_message_id')
    .eq('id', messageId).maybeSingle();
  if (!msg) return json({ error: 'Mensagem não encontrada' }, 404);
  // Já apagada: devolve ok em vez de erro. Dois cliques no menu, ou o mesmo
  // clique repetido por conexão lenta, não é uma falha para mostrar ao usuário.
  if (msg.deleted_at) return json({ ok: true, message_id: messageId, already: true });

  if (scope === 'everyone') {
    if (msg.direction !== 'out') {
      return json({ error: 'Só é possível apagar para todos as mensagens enviadas por você.' }, 400);
    }
    const rkey = msg.raw?.key;
    if (!rkey?.id) return json({ error: 'Mensagem sem chave da Evolution — só dá para apagar aqui no CRM.' }, 400);

    const { data: conv } = await admin.from('whatsapp_conversations')
      .select('remote_jid, instance_id').eq('id', msg.conversation_id).maybeSingle();
    const { data: channel } = await admin.from('whatsapp_instances')
      .select('instance_name').eq('id', conv?.instance_id).maybeSingle();
    if (!channel?.instance_name) return json({ error: 'Canal não encontrado' }, 400);

    try {
      const res = await fetch(`${base}/chat/deleteMessageForEveryone/${encodeURIComponent(channel.instance_name)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', apikey },
        // `participant` é só de grupo, e o módulo não atende grupos (o webhook
        // descarta @g.us). Mandar o campo vazio quebra o endpoint — ver issue
        // #787 do evolution-api.
        body: JSON.stringify({
          id: rkey.id,
          remoteJid: rkey.remoteJid || conv?.remote_jid,
          fromMe: rkey.fromMe !== false,
        }),
        signal: AbortSignal.timeout(EVO_TIMEOUT_MS),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        return json({ error: evoError(out, `Evolution retornou ${res.status}`), can_delete_local: true }, 502);
      }
    } catch (err) {
      return json({ error: evoNetworkError(err), can_delete_local: true }, 502);
    }
  }

  await admin.from('whatsapp_messages').update({
    deleted_at: new Date().toISOString(),
    deleted_by: user.id,
    deleted_scope: scope,
  }).eq('id', messageId);

  await refreshConversationPreview(admin, msg.conversation_id);

  return json({ ok: true, message_id: messageId, scope });
}

/**
 * Corrige a prévia da conversa na lista depois de uma exclusão.
 *
 * A lista mostra `last_message_preview`, um texto congelado na linha da conversa
 * — apagar a mensagem não o toca. Sem isto, a mensagem sumia da thread e
 * continuava, por extenso, na lista de conversas: o pior dos dois mundos, porque
 * quem apagou acredita que resolveu e o texto segue à vista de todo mundo.
 *
 * Só age quando a apagada era a ÚLTIMA da conversa. Apagar uma mensagem do meio
 * do histórico não muda a prévia, e recalcular seria trabalho para nada.
 */
async function refreshConversationPreview(admin: any, conversationId: string) {
  const { data: ultima } = await admin.from('whatsapp_messages')
    .select('id, content, type, deleted_at')
    .eq('conversation_id', conversationId)
    .order('wa_timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ultima?.deleted_at) return;

  await admin.from('whatsapp_conversations')
    .update({ last_message_preview: 'Mensagem apagada' })
    .eq('id', conversationId);
}

/**
 * Reage a uma mensagem — ou desfaz a reação, quando `emoji` vem vazio.
 *
 * Duas coisas moram aqui, e a ordem entre elas importa:
 *
 * 1. A reação SAI. Não é uma marca interna do CRM: no aplicativo o contato vê
 *    o coração aparecer na mensagem dele. Por isso a Evolution vem primeiro, e
 *    a coluna só é escrita depois que ela aceitou — reação que aparece na tela
 *    do escritório sem ter chegado no aparelho é a mesma mentira do "apagar
 *    para todos" que não revogou.
 *
 * 2. Quem grava é a MESMA regra que o webhook usa (`aplicarReacao`): uma reação
 *    por ator, e emoji vazio remove. O ator daqui é o ESCRITÓRIO, não a pessoa
 *    (ver `ACTOR_ESCRITORIO`): o WhatsApp guarda uma reação por conta, e quem
 *    clicou fica registrado em `name`.
 */
async function handleReact(admin: any, base: string, apikey: string, user: any, body: any) {
  const messageId: string | null = body?.message_id || null;
  const emoji = (body?.emoji ?? '').toString().trim();
  if (!messageId) return json({ error: 'message_id obrigatório' }, 400);
  // Um emoji é curto por natureza; o limite existe para o campo não virar porta
  // de entrada de texto arbitrário na coluna.
  if (emoji.length > 16) return json({ error: 'Reação inválida' }, 400);

  const { data: msg } = await admin.from('whatsapp_messages')
    .select('id, raw, reactions, conversation_id, deleted_at, evolution_message_id, direction')
    .eq('id', messageId).maybeSingle();
  if (!msg) return json({ error: 'Mensagem não encontrada' }, 404);
  if (msg.deleted_at) return json({ error: 'Não dá para reagir a uma mensagem apagada.' }, 400);

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('remote_jid, instance_id, is_blocked').eq('id', msg.conversation_id).maybeSingle();
  if (conv?.is_blocked) return json({ error: 'Contato bloqueado.' }, 409);
  const { data: channel } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv?.instance_id).maybeSingle();
  if (!channel?.instance_name) return json({ error: 'Canal não encontrado' }, 400);

  // A chave sai do `raw` quando ele está lá; quando não está, é REMONTADA.
  // Os três campos que o WhatsApp precisa já existem em colunas próprias, e é
  // isso que salva as mensagens antigas: a rotina de enxugar o `raw` apaga o
  // payload de conversas velhas, e sem esta reconstrução reagir a uma mensagem
  // de um mês atrás seria um erro de "mensagem sem chave" sem conserto possível.
  const rkey = msg.raw?.key?.id
    ? msg.raw.key
    : msg.evolution_message_id
      ? { id: msg.evolution_message_id, remoteJid: conv?.remote_jid, fromMe: msg.direction === 'out' }
      : null;
  if (!rkey?.id) return json({ error: 'Mensagem sem chave da Evolution — não é possível reagir.' }, 400);

  const remoteJid = rkey.remoteJid || conv?.remote_jid;
  try {
    const res = await fetch(`${base}/message/sendReaction/${encodeURIComponent(channel.instance_name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({
        key: { id: rkey.id, remoteJid, fromMe: rkey.fromMe === true },
        // String vazia é como o WhatsApp representa "tirei minha reação".
        reaction: emoji,
      }),
      signal: AbortSignal.timeout(EVO_TIMEOUT_MS),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: evoError(out, `Evolution retornou ${res.status}`) }, 502);
  } catch (err) {
    return json({ error: evoNetworkError(err) }, 502);
  }

  const { data: nome } = await admin.from('profiles')
    .select('name').eq('id', user.id).maybeSingle();
  const reactions: WaReacao[] = aplicarReacao(msg.reactions as WaReacao[] | null, {
    emoji,
    from: 'out',
    actor: ACTOR_ESCRITORIO,
    name: nome?.name || null,
    at: new Date().toISOString(),
  });
  await admin.from('whatsapp_messages').update({ reactions }).eq('id', messageId);

  return json({ ok: true, message_id: messageId, reactions });
}

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

/**
 * Acende o "digitando..." no WhatsApp do contato.
 *
 * Só a presença: não envia mensagem e não espera. Quem chama é que decide por
 * quanto tempo o balão fica de pé e quando manda o texto — deixar a espera aqui
 * prenderia a invocação do `evolution-send`, que é o caminho de TODO o envio do
 * sistema, inclusive o dos atendentes humanos.
 *
 * `duration_ms` é repassado como `delay`: é o tempo que a Evolution mantém a
 * presença antes de deixá-la cair sozinha. Se a mensagem não chegar nesse
 * intervalo, o balão apaga — melhor do que "digitando..." eterno numa falha.
 *
 * Falhar aqui não é erro de envio: a resposta continua devolvendo ok, porque
 * nenhuma mensagem se perde por causa de um balão que não acendeu.
 */
async function handleTyping(admin: any, base: string, apikey: string, body: any) {
  const conversationId: string | null = body?.conversation_id || null;
  if (!conversationId) return json({ error: 'conversation_id obrigatório' }, 400);

  // Teto de 20s: acima disso o WhatsApp derruba a presença sozinho, e um valor
  // grande só serviria para mentir sobre quanto tempo o balão vai durar.
  const duracao = Math.max(1000, Math.min(20_000, Number(body?.duration_ms) || 3000));

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('remote_jid, contact_phone, instance_id').eq('id', conversationId).maybeSingle();
  if (!conv) return json({ error: 'Conversa não encontrada' }, 404);
  if ((conv.remote_jid || '').endsWith('@g.us')) return json({ ok: true, skipped: 'group' });

  const { data: channel } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv.instance_id).maybeSingle();
  if (!channel?.instance_name) return json({ error: 'Canal não encontrado' }, 400);

  const target = /^\d+$/.test(conv.contact_phone || '') ? conv.contact_phone : conv.remote_jid;
  let acendeu = false;
  try {
    const res = await fetch(`${base}/chat/sendPresence/${encodeURIComponent(channel.instance_name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ number: target, presence: 'composing', delay: duracao }),
      signal: AbortSignal.timeout(10_000),
    });
    acendeu = res.ok;
  } catch { /* best-effort: ver o comentário acima */ }
  return json({ ok: true, typing: acendeu, duration_ms: duracao });
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
