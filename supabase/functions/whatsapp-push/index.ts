/**
 * `whatsapp-push` — Edge Function
 *
 * Envia Web Push real para o ATENDENTE (staff) quando chega mensagem inbound
 * de uma conversa atribuída a ele. Chamada pelo trigger SQL
 * `_wa_push_on_inbound_message` (pg_net) — análoga ao `portal-push`, mas o
 * destinatário é o usuário interno (`staff_push_subscriptions.user_id`).
 *
 * verify_jwt OFF: é acionada server-side pelo trigger (mesmo padrão do
 * portal-push), e o trigger manda a chave ANÔNIMA no Authorization — que não
 * identifica ninguém. O endpoint é, na prática, público.
 *
 * POR QUE ELA NÃO LÊ MAIS O QUE RECEBE
 * ------------------------------------
 * Antes, `user_id`, `title` e `body` vinham do corpo e iam direto para o
 * telefone do funcionário. Quem descobrisse um id de usuário mandava a
 * notificação que quisesse, com a cara do CRM — engenharia social sem precisar
 * de sessão nenhuma, e sem deixar rastro no atendimento.
 *
 * Agora o corpo só APONTA o que notificar (`conversation_id`); o texto é
 * remontado aqui, a partir do banco, com service role:
 *
 *   · a conversa tem de existir, não estar bloqueada e estar ATRIBUÍDA ao
 *     `user_id` pedido — ninguém notifica pelo atendimento de outro;
 *   · tem de haver mensagem RECEBIDA nos últimos 2 minutos — é isso que
 *     transforma "id que eu chutei" em "coisa que acabou de acontecer";
 *   · título e corpo saem do nome do contato e do tipo da mensagem, pelas
 *     mesmas regras que o trigger usava.
 *
 * O pior que uma chamada forjada consegue, então, é repetir um aviso que já
 * estava saindo de qualquer forma. Não há segredo compartilhado para vazar e o
 * contrato com o trigger não muda: os campos `title`/`body` que ele continua
 * mandando são simplesmente ignorados.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contato@jurius.com.br';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** As mesmas frases que o trigger montava — agora do lado de cá. */
function previewDe(tipo: string | null, conteudo: string | null): string {
  switch (tipo) {
    case 'image':    return '[Imagem]';
    case 'audio':    return '[Audio]';
    case 'video':    return '[Video]';
    case 'document': return '[Documento]';
    case 'sticker':  return 'Figurinha';
    default:         return (conteudo || '').slice(0, 120).trim() || 'Nova mensagem';
  }
}

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('[whatsapp-push] VAPID keys not configured');
    return jsonResponse({ error: 'VAPID not configured' }, 500);
  }

  try {
    // `title` e `body` ainda chegam do trigger — e são ignorados de propósito.
    const body = await req.json() as {
      user_id: string;
      conversation_id?: string;
    };

    if (!body.user_id) return jsonResponse({ error: 'user_id required' }, 400);
    if (!body.conversation_id) return jsonResponse({ error: 'conversation_id required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    // ── O que se vai notificar sai do banco, não do corpo da requisição ─────
    const { data: conversa } = await supabase
      .from('whatsapp_conversations')
      .select('id, contact_name, contact_phone, assigned_user_id, is_blocked')
      .eq('id', body.conversation_id)
      .maybeSingle();

    if (!conversa || conversa.is_blocked || conversa.assigned_user_id !== body.user_id) {
      // 202, e não 403: quem chama é um gatilho do banco, e "não é mais para
      // notificar" (a conversa foi transferida entre o INSERT e o disparo) é
      // resultado normal — não erro para encher o log.
      return jsonResponse({ sent: 0, total: 0, skipped: 'conversa não confere' }, 202);
    }

    const desde = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: ultima } = await supabase
      .from('whatsapp_messages')
      .select('type, content, created_at')
      .eq('conversation_id', conversa.id)
      .eq('direction', 'in')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!ultima) {
      return jsonResponse({ sent: 0, total: 0, skipped: 'nada recente para avisar' }, 202);
    }

    const contato = (conversa.contact_name || '').trim() || conversa.contact_phone || 'Contato';
    const titulo = `WhatsApp - ${contato}`;
    const texto = previewDe(ultima.type, ultima.content);

    const { data: subscriptions, error } = await supabase
      .from('staff_push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', body.user_id);

    if (error) {
      console.error('[whatsapp-push] subscriptions query failed:', error);
      return jsonResponse({ error: error.message }, 500);
    }

    if (!subscriptions?.length) {
      return jsonResponse({ sent: 0, total: 0 });
    }

    const payload = JSON.stringify({
      title: titulo,
      body: texto,
      icon: '/icon-192.png',
      badge: '/favicon.svg',
      tag: body.conversation_id ? `wa:${body.conversation_id}` : undefined,
      // data.url → cold-open (service worker openWindow);
      // data.action/module/params → App.tsx navega ao focar (postMessage);
      // suppressIfFocused → não duplica com o aviso in-app quando a aba está em foco.
      data: {
        url: '/',
        action: 'navigate',
        module: 'whatsapp',
        params: body.conversation_id ? { conversationId: body.conversation_id } : undefined,
        suppressIfFocused: true,
        tag: body.conversation_id ? `wa:${body.conversation_id}` : undefined,
      },
    });

    const results = await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        const pushSubscription = {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        };
        return await webpush.sendNotification(pushSubscription, payload);
      }),
    );

    const expiredEndpoints: string[] = [];
    let sent = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sent += 1;
        return;
      }
      const statusCode = (result.reason as { statusCode?: number } | undefined)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        expiredEndpoints.push(subscriptions[index].endpoint);
      } else {
        console.error('[whatsapp-push] send failed:', result.reason);
      }
    });

    if (expiredEndpoints.length > 0) {
      await supabase.from('staff_push_subscriptions').delete().in('endpoint', expiredEndpoints);
    }

    console.log(`[whatsapp-push] sent=${sent}/${subscriptions.length} user=${body.user_id}`);
    return jsonResponse({ sent, total: subscriptions.length });
  } catch (error) {
    console.error('[whatsapp-push] error:', error);
    return jsonResponse({ error: String(error) }, 500);
  }
});
