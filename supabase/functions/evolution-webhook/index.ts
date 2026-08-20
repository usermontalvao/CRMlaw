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
 * pessoa em duas threads. Quando NEM o telefone vem (a Evolution reentrega a
 * mesma mensagem, primeiro só com o LID e um segundo depois já resolvida), a
 * defesa é a idempotência por CANAL — ver `jaProcessada` — mais a citação da
 * mensagem respondida, que aponta a thread certa sem depender de telefone.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  ABSENCE_COOLDOWN_HOURS,
  absenceSuppressedByAi,
  isAbsenceCooldownActive,
} from '../_shared/absence-cooldown.ts';
import { WA_AI_RESET_COMMANDS } from '../_shared/wa-ai-reset.ts';
import { slimWaRaw } from '../_shared/wa-raw.ts';
import { triggerWaAiAfterTranscription } from '../_shared/wa-ai-transcription.ts';
import { desembrulharMensagem, lerConteudoNativo } from '../_shared/wa-native-content.ts';
import { classificarReabertura } from '../_shared/wa-reopen.ts';
import { applyChannelState } from '../_shared/wa-channel-state.ts';
import {
  ehTelefoneReal,
  enderecosContato,
  patchIdentidade,
  stanzaIdCitado,
} from '../_shared/wa-identity.ts';
import { ACTOR_CONTATO, ACTOR_ESCRITORIO, aplicarReacao, type WaReacao } from '../_shared/wa-reactions.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const MEDIA_BUCKET = 'whatsapp-media';

type ConvRow = {
  id: string; contact_avatar_path: string | null; is_blocked: boolean; status: string;
  department_id: string | null; contact_phone: string | null; contact_name: string | null;
  contact_lid: string | null;
};

const CONV_COLS = 'id, contact_avatar_path, is_blocked, status, department_id, contact_phone, contact_name, contact_lid';

/**
 * A mensagem da Evolution é única DENTRO do canal, não dentro da conversa.
 *
 * A mesma entrega pode reaparecer uma vez como telefone e outra como LID. A
 * antiga consulta por `(conversation_id, evolution_message_id)` só reconhecia
 * a reentrega depois de escolher a mesma conversa — exatamente o que ainda não
 * sabemos quando o LID chega sem `remoteJidAlt`. Aqui o ID da mensagem denuncia
 * a conversa já escolhida pela primeira entrega.
 */
async function conversationByEvolutionMessage(
  admin: any,
  instanceId: string,
  evolutionMessageId: string | null,
): Promise<ConvRow | null> {
  if (!evolutionMessageId) return null;
  const { data: refs, error: refsError } = await admin.from('whatsapp_messages')
    .select('conversation_id')
    .eq('evolution_message_id', evolutionMessageId)
    .limit(20);
  if (refsError) {
    console.error('wa conversation lookup by message failed', refsError);
    return null;
  }
  const ids = [...new Set((refs || []).map((r: any) => r.conversation_id).filter(Boolean))];
  if (!ids.length) return null;
  const { data, error } = await admin.from('whatsapp_conversations')
    .select(CONV_COLS)
    .eq('instance_id', instanceId)
    .in('id', ids)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) {
    console.error('wa conversation lookup by channel failed', error);
    return null;
  }
  return data?.[0] || null;
}

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
    .select('id, instance_name, status, last_open_at, connected_at')
    .eq('webhook_token', token).maybeSingle();
  if (!channel) return new Response('Unauthorized', { status: 401 });
  const instanceId = channel.id;
  const instanceName = channel.instance_name;

  let payload: any;
  try { payload = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const event = String(payload?.event || '').toLowerCase().replace(/_/g, '.');

  try {
    if (event === 'connection.update') {
      // Um evento NÃO é um veredito. Uma sessão disputada oscila open/close/
      // connecting várias vezes por segundo enquanto entrega mensagens normalmente;
      // gravar cada respiro enchia a inbox de "esta conversa não vai enviar" e o
      // registro do canal de UPDATE inútil. A histerese vive em wa-channel-state.
      const state = payload?.data?.state || payload?.data?.connection || payload?.state;
      await applyChannelState(admin, channel, state);
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

  // Telefone real: contatos @lid escondem o número; quando conhecido, vem em
  // remoteJidAlt. Sem ele, `phone` fica vazio — LID jamais vira telefone.
  const altJid: string = key?.remoteJidAlt || '';
  const { phone, lid: lidVisto } = enderecosContato(remoteJid, altJid);
  const realJid = phone ? `${phone}@s.whatsapp.net` : remoteJid;
  // O LID visto nesta mensagem — o apelido INTERNO do contato no WhatsApp.
  // Guardá-lo é o que permite reconhecer quem está ligando quando o convite de
  // voz chega endereçado por LID em vez de por número (ver a migration
  // `20260818010000_whatsapp_lid_map.sql`). Ele NUNCA vale como telefone.
  // ATENÇÃO: `pushName` só representa o nome do CONTATO quando a mensagem é
  // RECEBIDA (!fromMe). Em mensagens próprias (fromMe) ele é o nome do dono da
  // conta conectada — nunca deve virar `contact_name` (ver guarda mais abaixo).
  const pushName: string | null = m?.pushName || null;

  const msg = desembrulharMensagem(m?.message || {});
  const quotedEvolutionId = stanzaIdCitado(m, msg);

  // ── Revogação ("apagar para todos" feito no aparelho) ──
  // Chega como uma mensagem normal cujo conteúdo é um protocolMessage REVOKE
  // apontando para a chave da mensagem original. Não é conteúdo: é uma ORDEM
  // sobre uma mensagem que já está na thread. Tratada antes de tudo, senão
  // viraria uma bolha vazia na conversa.
  //
  // deleted_by fica NULO de propósito — quem apagou foi o contato, não alguém do
  // escritório. É o que a tela usa para escrever "Esta mensagem foi apagada" em
  // vez de "Você apagou esta mensagem".
  const revoked = msg?.protocolMessage;
  if (revoked?.type === 'REVOKE' || revoked?.type === 0) {
    const targetId = revoked?.key?.id;
    if (targetId) {
      const { data: apagada } = await admin.from('whatsapp_messages')
        .update({ deleted_at: new Date().toISOString(), deleted_scope: 'everyone' })
        .eq('evolution_message_id', targetId)
        .is('deleted_at', null)
        .select('id, conversation_id')
        .maybeSingle();
      // A prévia da lista é um texto congelado na conversa: sem corrigi-la, a
      // mensagem sumiria da thread e continuaria por extenso na lista.
      if (apagada?.conversation_id) {
        const { data: ultima } = await admin.from('whatsapp_messages')
          .select('id, deleted_at')
          .eq('conversation_id', apagada.conversation_id)
          .order('wa_timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ultima?.id === apagada.id) {
          await admin.from('whatsapp_conversations')
            .update({ last_message_preview: 'Mensagem apagada' })
            .eq('id', apagada.conversation_id);
        }
      }
    }
    return;
  }

  // ── Reação ("👍" numa mensagem que já está na thread) ──
  // Como a revogação acima, isto não é conteúdo: é uma marca SOBRE outra
  // mensagem. Tratada antes da leitura de tipo porque, seguindo adiante, viraria
  // uma bolha solta escrita "Reação 👍" no meio da conversa — que foi como ela
  // aparecia até aqui. A reação não bagunça o resto: não muda a prévia da lista,
  // não conta como não lida e não reabre atendimento. No aplicativo ela também
  // não faz nada disso.
  const reagida = msg?.reactionMessage;
  if (reagida?.key?.id) {
    // Texto vazio é como o WhatsApp diz "tirei minha reação".
    const emoji = (reagida.text ?? '').toString().trim();
    const alvoId: string = reagida.key.id;
    const { data: alvo } = await admin.from('whatsapp_messages')
      .select('id, reactions')
      .eq('evolution_message_id', alvoId)
      .maybeSingle();
    // Reação a uma mensagem que este CRM não tem (anterior à conexão do canal,
    // ou já purgada): não há bolha para marcar, e inventar uma seria pior.
    if (!alvo) return;

    const atuais = (Array.isArray(alvo.reactions) ? alvo.reactions : []) as WaReacao[];
    // Quem reagiu. Do lado de cá é o NÚMERO do escritório, não a pessoa: o
    // WhatsApp guarda uma reação por conta, então dois atendentes reagindo pelo
    // mesmo canal são uma reação só — a mesma conta que `evolution-send` grava.
    const actor = fromMe ? ACTOR_ESCRITORIO : ACTOR_CONTATO;
    // Eco do que o próprio CRM acabou de enviar: a linha já está lá, e com o
    // nome de quem clicou. Regravar aqui só apagaria esse nome.
    if (fromMe && atuais.some(r => r.actor === actor && r.emoji === emoji)) return;

    const reactions = aplicarReacao(atuais, {
      emoji,
      from: fromMe ? 'out' : 'in',
      actor,
      name: fromMe ? null : (pushName || null),
      at: m?.messageTimestamp
        ? new Date(Number(m.messageTimestamp) * 1000).toISOString()
        : new Date().toISOString(),
    });
    await admin.from('whatsapp_messages').update({ reactions }).eq('id', alvo.id);
    return;
  }

  let type = 'text';
  let content: string | null = null;
  let mediaNode: any = null;       // nó *Message com metadados de mídia
  let mediaMime: string | null = null;
  let fileName: string | null = null;
  let isAnimated = false;          // GIF (vídeo com gifPlayback)

  if (msg.conversation) { content = msg.conversation; }
  else if (msg.extendedTextMessage?.text) { content = msg.extendedTextMessage.text; }
  else if (msg.imageMessage) { type = 'image'; content = msg.imageMessage.caption || null; mediaNode = msg.imageMessage; mediaMime = msg.imageMessage.mimetype || 'image/jpeg'; }
  else if (msg.audioMessage) { type = 'audio'; mediaNode = msg.audioMessage; mediaMime = msg.audioMessage.mimetype || 'audio/ogg'; }
  // `gifPlayback` é a única marca que distingue um GIF de um vídeo curto: o
  // WhatsApp converte todo GIF para mp4. Sem guardar isso, a conversa mostraria
  // um play parado no lugar da animação.
  else if (msg.videoMessage) { type = 'video'; content = msg.videoMessage.caption || null; mediaNode = msg.videoMessage; mediaMime = msg.videoMessage.mimetype || 'video/mp4'; isAnimated = msg.videoMessage.gifPlayback === true; }
  else if (msg.documentMessage) { type = 'document'; content = msg.documentMessage.caption || null; mediaNode = msg.documentMessage; mediaMime = msg.documentMessage.mimetype || 'application/octet-stream'; fileName = msg.documentMessage.fileName || null; }
  else if (msg.documentWithCaptionMessage?.message?.documentMessage) {
    const dm = msg.documentWithCaptionMessage.message.documentMessage;
    type = 'document'; content = dm.caption || null; mediaNode = dm; mediaMime = dm.mimetype || 'application/octet-stream'; fileName = dm.fileName || null;
  }
  else if (msg.stickerMessage) { type = 'sticker'; mediaNode = msg.stickerMessage; mediaMime = msg.stickerMessage.mimetype || 'image/webp'; }

  // ── Tipos NATIVOS sem arquivo ────────────────────────────────────────────
  // Tudo daqui para baixo caía no `else` final e virava `type='text'` com
  // `content=null` — a bolha branca. Contato, localização, enquete, reação e,
  // sobretudo, as mensagens de EMPRESA (botões, listas, templates, fluxos), que
  // são a maioria: loja, banco e transportadora falam por menu, não por texto
  // solto. A leitura mora em `wa-native-content.ts`, compartilhada com o
  // backfill das que já ficaram em branco no banco.
  //
  // Não há coluna nova: cada uma vira texto legível em `content`, e o `type` só
  // diz à bolha que moldura desenhar.
  else {
    const nativa = lerConteudoNativo(msg);
    if (nativa) { type = nativa.type; content = nativa.content; }
    // Nada reconhecido. Marcar como `unsupported` é melhor do que fingir que é
    // texto: a bolha diz "abra no WhatsApp" em vez de aparecer vazia, e no banco
    // fica registrado que chegou ALGUMA coisa naquele instante.
    //
    // O texto vai em `content` (e não fica nulo) porque a prévia da conversa é
    // montada por gatilho no banco a partir dessa coluna: com nulo, a linha da
    // inbox ficaria em branco do mesmo jeito que a bolha ficava.
    else { type = 'unsupported'; content = 'Mensagem não suportada'; }
  }

  // Duração de áudio/vídeo, quando a Evolution informa. Vem de graça no payload
  // e é o que permite o aviso dizer "Mensagem de voz · 0:12" em vez de deixar a
  // pessoa abrir a conversa só para descobrir se vale parar o que está fazendo.
  const rawSeconds = Number(mediaNode?.seconds);
  const mediaDuration = Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.round(rawSeconds) : null;

  const tsRaw = m?.messageTimestamp;
  const waTimestamp = tsRaw ? new Date(Number(tsRaw) * 1000).toISOString() : new Date().toISOString();

  // ── Resolve a conversa (anti-duplicação) ──
  // O endereço exato é só a primeira evidência. Se ele for um LID antigo que
  // nasceu como conversa fantasma, uma conversa com telefone real vence por:
  // contact_lid, telefone resolvido, mensagem citada ou pelo próprio ID desta
  // entrega. Só depois aceitamos a linha LID exata ou criamos outra.
  let conv: ConvRow | null = null;
  let exactConv: ConvRow | null = null;
  {
    const { data } = await admin.from('whatsapp_conversations')
      .select(CONV_COLS)
      .eq('instance_id', instanceId).eq('remote_jid', remoteJid).maybeSingle();
    exactConv = data || null;
  }

  const lidDelivery = remoteJid.endsWith('@lid');
  if (!lidDelivery) conv = exactConv;
  if (lidDelivery && lidVisto) {
    const { data } = await admin.from('whatsapp_conversations')
      .select(CONV_COLS)
      .eq('instance_id', instanceId)
      .eq('contact_lid', lidVisto)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(10);
    // Havendo duas linhas com o mesmo LID, a que conhece o telefone real é a
    // canônica. A linha inválida fica para o saneamento, nunca para outra bolha.
    conv = (data || []).find((c: ConvRow) => ehTelefoneReal(c.contact_phone)) || null;
  }

  if ((!conv || !ehTelefoneReal(conv.contact_phone)) && phone) {
    const variants = phoneVariants(phone);
    const { data } = await admin.from('whatsapp_conversations')
      .select(CONV_COLS)
      .eq('instance_id', instanceId)
      .in('contact_phone', variants)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1);
    conv = data?.[0] || null;
  }

  if (!conv || (lidDelivery && !ehTelefoneReal(conv.contact_phone))) {
    const quotedConv = await conversationByEvolutionMessage(admin, instanceId, quotedEvolutionId);
    if (quotedConv) conv = quotedConv;
  }

  if (!conv || (lidDelivery && !ehTelefoneReal(conv.contact_phone))) {
    const deliveredConv = await conversationByEvolutionMessage(admin, instanceId, evoId);
    if (deliveredConv) conv = deliveredConv;
  }

  if (!conv) conv = exactConv;
  if (!conv) {
    // Conversa nova: nasce no departamento padrão do canal (aba Roteamento).
    const defaultDepartmentId = await getDefaultDepartmentForChannel(admin, instanceId);
    const { data } = await admin.from('whatsapp_conversations').upsert({
      instance_id: instanceId,
      remote_jid: remoteJid,
      // NOT NULL no schema. Vazio significa "LID ainda não resolvido"; os
      // dígitos do apelido interno nunca mais contaminam este campo.
      contact_phone: phone || '',
      contact_lid: lidVisto,
      department_id: defaultDepartmentId,
    }, { onConflict: 'instance_id,remote_jid' }).select(CONV_COLS).single();
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
  // bom" (cortesia de despedida) → reabre → encerro de novo. Por isso classificamos
  // a intenção (ver _shared/wa-reopen.ts): cortesia clara mantém encerrada, mas
  // passadas as horas de silêncio da regra de SESSÃO qualquer mensagem — inclusive
  // um "oi" sozinho — é contato NOVO e reabre, sem IA e sem perguntar nada.
  // Ao reabrir, LIBERA o atendente anterior (volta à triagem) e mantém o setor.
  if (!fromMe && conv.status === 'closed') {
    const decision = await classifyReopen(admin, conv.id, content, type, waTimestamp);
    if (decision === 'reopen') {
      await reopenToQueue(admin, conv.id);
      conv = { ...conv, status: 'open' };
    } else if (decision === 'ask') {
      // Em dúvida (nem cortesia clara, nem demanda clara, ainda DENTRO da mesma
      // sessão): em vez de adivinhar, PERGUNTA ao cliente e mantém encerrada. Se
      // já perguntamos há pouco e ele continua ambíguo, escala para humano.
      const { data: cc } = await admin.from('whatsapp_conversations')
        .select('reopen_prompt_sent_at').eq('id', conv.id).maybeSingle();
      const askedAt = cc?.reopen_prompt_sent_at ? new Date(cc.reopen_prompt_sent_at).getTime() : 0;
      const recentlyAsked = askedAt > 0 && (Date.now() - askedAt) < 6 * 3_600_000;
      if (recentlyAsked) {
        await reopenToQueue(admin, conv.id);
        conv = { ...conv, status: 'open' };
      } else {
        const failure = await waSendText(conv.id,
          'Olá! Recebi sua mensagem. 🙂 Posso te ajudar com mais alguma coisa? '
          + 'Se precisar, me conta rapidinho o que você precisa que eu reabro seu atendimento.');
        // A marca só vale se a pergunta SAIU: marcar mesmo com falha fazia a
        // conversa achar que já perguntou e, na dúvida seguinte, escalar para a
        // fila por causa de uma pergunta que o cliente nunca viu.
        if (failure) console.error('reopen prompt não enviado', conv.id, failure);
        else {
          await admin.from('whatsapp_conversations')
            .update({ reopen_prompt_sent_at: new Date().toISOString() }).eq('id', conv.id);
        }
      }
    }
    // 'keep' (cortesia clara) → continua encerrada, sem voltar à fila.
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
  //
  // A decisão em si mora em `_shared/wa-identity.ts#patchIdentidade`, e vale a
  // pena dizer por quê: o que estava aqui era um `patch` cru guardado por um
  // filtro `.or(...)` no UPDATE. Ele tinha DOIS defeitos. O primeiro é que
  // `contact_phone.like.%@lid%` nunca casa — o `@lid` já sai no `split('@')`
  // acima, então o campo guarda os dígitos do LID, sem o sufixo. O segundo é
  // pior: bastando `contact_name` estar nulo, a condição passava e os dígitos
  // do LID SOBRESCREVIAM um telefone real já conhecido. (E `or` dentro de
  // UPDATE é, por si só, terreno onde o PostgREST já nos devolveu 42703.)
  //
  // A regra correta é a de sempre: telefone só SOBE de LID para número real,
  // nunca desce.
  const patch: Record<string, string> = patchIdentidade(
    { contact_phone: conv.contact_phone, contact_name: conv.contact_name },
    { phone, pushName, fromMe },
  );
  // O LID é informação NOVA, não substituição: ele não disputa espaço com o
  // telefone, mora na sua própria coluna e só é escrito quando muda.
  if (lidVisto && conv.contact_lid !== lidVisto) patch.contact_lid = lidVisto;
  if (Object.keys(patch).length) {
    await admin.from('whatsapp_conversations').update(patch).eq('id', conv.id);
    conv = { ...conv, ...patch } as typeof conv;
  }

  // Idempotência por CANAL: a mesma entrega pelo telefone e pelo LID não pode
  // existir em duas conversas. A consulta antiga filtrava `conversation_id` e
  // portanto só funcionava depois de acertar a identidade — tarde demais.
  if (evoId) {
    const existingConv = await conversationByEvolutionMessage(admin, instanceId, evoId);
    if (existingConv) return;
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
    media_duration_seconds: mediaDuration,
    file_name: fileName,
    is_animated: isAnimated,
    transcription_status: transcriptionStatus,
    status: fromMe ? 'sent' : 'delivered',
    wa_timestamp: waTimestamp,
    // Enxuto de propósito: os bytes da mídia já subiram para o storage acima
    // (`resolveMediaBytes` leu o base64 do `m` original). Ver _shared/wa-raw.ts.
    raw: slimWaRaw(m),
  }, { onConflict: 'conversation_id,evolution_message_id', ignoreDuplicates: true })
    .select('id').maybeSingle();

  // ── Transcrição assíncrona (não bloqueia a resposta do webhook) ──
  // Para mensagem recebida, a mesma promessa será encadeada ao disparo da IA
  // mais abaixo. Isso evita o agente ler `[áudio]` enquanto a transcrição já
  // está sendo produzida em paralelo.
  const transcriptionJob = inserted?.id && transcriptionStatus === 'pending'
    ? transcribeAudio(admin, inserted.id, storagePath!, mediaMime || 'audio/ogg')
    : null;

  // ── Mensagem automática de ausência (Fase N; inbound; cooldown 12h) ──
  // Regra de negócio: se o cliente mandou mensagem fora do expediente, ele deve
  // receber o comunicado comercial mesmo quando a conversa estava encerrada.
  // O cooldown sobrevive a encerramento/reabertura e evita repetição excessiva.
  if (!fromMe) {
    const job = maybeAutoSendAbsence(admin, instanceId, conv.id, content);
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job.catch(() => {});
  }

  // ── Assistente de IA ──
  // Só para mensagem RECEBIDA e só quando ela é NOVA (`inserted` vem nulo na
  // reentrega, que o upsert ignora): é a primeira barreira contra responder duas
  // vezes à mesma mensagem. A segunda é a chave de idempotência do próprio
  // agente, e a terceira, o `last_processed_message_id` da sessão.
  //
  // Disparo assíncrono e tolerante: quem decide se existe agente, se a IA está
  // ligada e se a conversa é dela é o `whatsapp-ai-agent`. Qualquer falha aqui é
  // registrada e ignorada — o WhatsApp precisa continuar funcionando com ou sem
  // IA, e a conversa já está na fila para um humano.
  if (!fromMe && inserted?.id) {
    const job = triggerWaAiAfterTranscription(
      transcriptionJob,
      () => dispararAgenteIA(conv.id, inserted.id),
    );
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(job);
    else await job.catch(() => {});
  } else if (transcriptionJob) {
    // Áudio enviado pelo próprio escritório também precisa ser transcrito para
    // a interface, mas não dispara o agente.
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(transcriptionJob);
    else await transcriptionJob.catch(() => {});
  }

}

/**
 * Acorda o assistente de IA para esta mensagem.
 *
 * O agente responde na hora (202) e faz o turno em segundo plano — o debounce
 * dele chega a um minuto, e segurar o webhook por isso atrasaria a gravação das
 * mensagens seguintes.
 */
async function dispararAgenteIA(conversationId: string, messageId: string) {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-ai-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ conversation_id: conversationId, trigger_message_id: messageId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error('whatsapp-ai-agent respondeu', res.status, conversationId);
  } catch (err) {
    console.error('falha ao acionar whatsapp-ai-agent', conversationId, err);
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

/**
 * Envia um texto automático PELO CAMINHO DO CRM (`evolution-send`), como os
 * followups já fazem.
 *
 * Antes daqui saía um `fetch` próprio direto para a Evolution. Ele nunca
 * entregou: o aviso de ausência marcou `absence_sent_at` 7 vezes e o prompt de
 * reabertura marcou `reopen_prompt_sent_at` 3 vezes, e não existe UMA linha
 * dessas mensagens em `whatsapp_messages` — enquanto 109 mensagens do próprio
 * celular do escritório chegaram normalmente pelo eco do webhook. Ou seja: a
 * marca de "enviado" era só a reserva, o cliente não recebia nada e ninguém
 * tinha como perceber.
 *
 * `evolution-send` resolve o JID pela própria Evolution (`resolveSendJid`), usa
 * a config do servidor e — o que mais importa aqui — GRAVA a mensagem na
 * conversa. Com service role ele entra como envio de sistema: não reabre
 * conversa encerrada nem mexe na fila.
 *
 * Devolve o motivo da falha (ou null em caso de sucesso) para quem chamou
 * decidir se desfaz a reserva.
 */
async function waSendText(convId: string, text: string): Promise<string | null> {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/evolution-send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ conversation_id: convId, sender_user_id: null, text }),
      signal: AbortSignal.timeout(30_000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out?.error) return String(out?.error || `HTTP ${res.status}`).slice(0, 300);
    return null;
  } catch (err) {
    return String(err instanceof Error ? err.message : err).slice(0, 300);
  }
}

/**
 * Classifica uma mensagem recebida numa conversa ENCERRADA em 3 vias:
 *   'keep'   = só cortesia/despedida → mantém encerrada.
 *   'reopen' = nova demanda clara    → reabre na fila.
 *   'ask'    = ambíguo               → pergunta ao cliente (na dúvida, pergunta).
 *
 * A regra pura (texto + tempo de silêncio) vive em `_shared/wa-reopen.ts` e tem
 * teste; aqui ficam só as idas ao banco e o desempate por IA.
 */
async function classifyReopen(admin: any, convId: string, text: string | null, type: string, messageTsIso?: string): Promise<ReopenDecision> {
  const silencio = await minutosDeSilencio(admin, convId, messageTsIso);
  const decisao = classificarReabertura({ texto: text, tipo: type, minutosDeSilencio: silencio });
  if (decisao !== 'ia') return decisao;

  // Ambíguo DENTRO da mesma sessão → IA classifica COM contexto (resolve
  // fragmentação: "obrigado" + "meu" + "amigo" em mensagens separadas é uma
  // despedida, não 3 novas demandas).
  return await classifyReopenWithAI(admin, convId, (text || '').trim());
}

/**
 * Há quanto tempo o CLIENTE está calado nesta conversa encerrada: conta do
 * encerramento ou da última mensagem que ele mandou depois dele, o que for mais
 * recente. Mensagens automáticas nossas (ausência, pergunta de reabertura) não
 * entram — senão elas reiniciariam o relógio e a conversa nunca envelheceria.
 *
 * Devolve null quando não dá para saber (conversa encerrada sem `closed_at`);
 * aí a decisão volta a depender só do texto e da IA.
 */
async function minutosDeSilencio(admin: any, convId: string, messageTsIso?: string): Promise<number | null> {
  const agoraMs = messageTsIso ? new Date(messageTsIso).getTime() : Date.now();
  if (!Number.isFinite(agoraMs)) return null;

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('closed_at')
    .eq('id', convId)
    .maybeSingle();
  const fechadaMs = conv?.closed_at ? new Date(conv.closed_at).getTime() : 0;
  if (!fechadaMs) return null;

  const { data: entradasApos } = await admin.from('whatsapp_messages')
    .select('wa_timestamp')
    .eq('conversation_id', convId)
    .eq('direction', 'in')
    .gt('wa_timestamp', conv.closed_at)
    .order('wa_timestamp', { ascending: false })
    .limit(1);
  const ultimaEntradaMs = entradasApos?.[0]?.wa_timestamp
    ? new Date(entradasApos[0].wa_timestamp).getTime()
    : 0;

  const referenciaMs = Math.max(fechadaMs, Number.isFinite(ultimaEntradaMs) ? ultimaEntradaMs : 0);
  return Math.max(0, (agoraMs - referenciaMs) / 60_000);
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
 * Disparada async para cada inbound. Cooldown: não reenvia se já enviou nas
 * últimas 12 horas para a mesma conversa (anti-loop).
 */
async function maybeAutoSendAbsence(
  admin: any, instanceId: string, convId: string, inboundText: string | null = null,
) {
  try {
    // ── Comando de reinício não é pergunta de cliente ──
    // "/clear" numa conversa em `handed_off` cai aqui com a IA ainda desligada,
    // então `aiRespondeAgora()` responde "não vai ter resposta" e o aviso sai —
    // e dois segundos depois o comando religa a sessão e a IA cumprimenta. Em
    // 14/08/2026 o cliente leu "estamos fora do horário, retornaremos depois"
    // às 22:51:50 e "Olá! Tudo bem?" às 22:52:08. O silêncio que o aviso existe
    // para explicar nunca aconteceu.
    if (WA_AI_RESET_COMMANDS.includes(String(inboundText || '').trim().toLowerCase() as never)) {
      return;
    }

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
    if (isAbsenceCooldownActive(conv.absence_sent_at)) return;

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

    // ── A IA está atendendo? Então o aviso comercial está errado. ──
    // Última checagem antes de reservar o disparo, de propósito: é a mais cara
    // (três consultas) e a que menos vezes precisa acontecer — só chega aqui
    // quem já passou pelo cooldown e está mesmo fora do expediente.
    if (await aiRespondeAgora(admin, instanceId, convId)) {
      console.info('aviso de ausência suprimido: agente de IA ativo', convId);
      return;
    }

    // Reserva o disparo ANTES de chamar a Evolution: se dois webhooks da mesma
    // conversa chegarem juntos, somente um recebe a marca e o outro encerra sem
    // enviar duplicado.
    //
    // A condição inteira mora no banco (`wa_absence_claim`) de propósito. A
    // versão anterior montava o mesmo filtro aqui com `.update().or(...)`, e o
    // PostgREST responde 42703 — "column absence_sent_at does not exist" — a
    // esse par, embora o mesmo filtro funcione num `.select()`. Resultado: o
    // aviso parava de sair sem que nada além do log acusasse. Nunca voltar a
    // usar `.or()` junto de `.update()`.
    const { data: claimedAt, error: claimError } = await admin.rpc('wa_absence_claim', {
      p_conversation_id: convId,
      p_cooldown_hours: ABSENCE_COOLDOWN_HOURS,
    });
    if (claimError) {
      console.error('absence cooldown claim failed', convId, claimError);
      return;
    }
    // NULL = a conversa foi bloqueada/suprimida ou outro webhook chegou primeiro.
    if (!claimedAt) return;

    const failure = await waSendText(convId, ch.absence_message);
    if (failure) {
      console.error('absence auto-send failed', convId, failure);
      // Falha confirmada: devolve a reserva sem apagar uma marca posterior. Como
      // o envio passa pelo `evolution-send`, uma falha de verdade também deixa
      // rastro — a mensagem não é gravada e o motivo vai para o log.
      await admin.rpc('wa_absence_release', {
        p_conversation_id: convId,
        p_claimed_at: claimedAt,
        p_previous: conv.absence_sent_at || null,
      });
      return;
    }
    console.info(`absence auto-send claimed for ${ABSENCE_COOLDOWN_HOURS}h`, convId);
  } catch (err) {
    console.error('maybeAutoSendAbsence error', err);
  }
}

/**
 * O agente de IA vai responder esta mensagem?
 *
 * Consulta separada e tolerante a falha: se qualquer uma das leituras cair, a
 * resposta é "não sei" e o aviso segue o caminho de sempre. Errar para o lado
 * de mandar o comunicado é muito melhor do que errar para o lado do silêncio.
 */
async function aiRespondeAgora(admin: any, instanceId: string, convId: string): Promise<boolean> {
  try {
    const { data: config } = await admin.from('whatsapp_ai_channel_config')
      .select('ai_enabled, assistant_id').eq('channel_id', instanceId).maybeSingle();
    if (!config?.ai_enabled || !config?.assistant_id) return false;

    const [{ data: assistant }, { data: session }, { data: conv }] = await Promise.all([
      admin.from('whatsapp_ai_assistants')
        .select('is_active, mode').eq('id', config.assistant_id).maybeSingle(),
      admin.from('whatsapp_ai_sessions')
        .select('ai_active').eq('conversation_id', convId).maybeSingle(),
      admin.from('whatsapp_conversations')
        .select('assigned_user_id, awaiting_accept').eq('id', convId).maybeSingle(),
    ]);

    return absenceSuppressedByAi({
      channelAiEnabled: true,
      assistantId: String(config.assistant_id),
      assistantActive: assistant?.is_active === true,
      assistantMode: String(assistant?.mode || 'test'),
      // Conversa nova ainda não tem sessão — e é justamente a que a IA atende.
      sessionAiActive: session ? session.ai_active !== false : true,
      conversationAssignedUserId: conv?.assigned_user_id ?? null,
      awaitingAccept: conv?.awaiting_accept === true,
    });
  } catch (err) {
    console.error('aiRespondeAgora falhou', convId, err);
    return false;
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
