/**
 * `whatsapp-push` — Edge Function
 *
 * Envia Web Push real para o ATENDENTE (staff) quando chega mensagem inbound
 * de uma conversa atribuída a ele. Chamada pelo trigger SQL
 * `_wa_push_on_inbound_message` (pg_net) — análoga ao `portal-push`, mas o
 * destinatário é o usuário interno (`staff_push_subscriptions.user_id`).
 *
 * verify_jwt OFF: é acionada server-side pelo trigger (mesmo padrão do
 * portal-push). Não expõe dados — só dispara notificações para quem já
 * registrou uma subscription.
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
    const body = await req.json() as {
      user_id: string;
      title: string;
      body: string;
      conversation_id?: string;
    };

    if (!body.user_id) return jsonResponse({ error: 'user_id required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

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
      title: body.title,
      body: body.body,
      icon: '/icon-192.png',
      badge: '/favicon.ico',
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
