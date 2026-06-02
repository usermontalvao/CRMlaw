/**
 * portal-push — Edge Function
 *
 * Envia push notifications para assinantes do portal do cliente.
 *
 * Chamada por trigger SQL quando uma nova portal_client_notifications é inserida,
 * ou diretamente pela plataforma para broadcast manual.
 *
 * Requer variáveis de ambiente (Supabase Edge Function Secrets):
 *   VAPID_PUBLIC_KEY  — chave pública VAPID (gerada com: npx web-push generate-vapid-keys)
 *   VAPID_PRIVATE_KEY — chave privada VAPID
 *   VAPID_SUBJECT     — mailto: ou URL do domínio (ex: mailto:contato@jurius.com.br)
 *
 * Body esperado:
 *   { portal_user_id: string, title: string, body: string, url?: string }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:contato@jurius.com.br';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── VAPID helpers (implementação manual via WebCrypto — sem dependência externa) ──

function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function makeVapidToken(audience: string): Promise<string> {
  const header  = b64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  })));
  const signing = new TextEncoder().encode(`${header}.${payload}`);

  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64urlDecode(VAPID_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signing);
  return `${header}.${payload}.${b64urlEncode(sig)}`;
}

async function sendWebPush(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}, payload: string): Promise<{ ok: boolean; status: number }> {
  const url     = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt     = await makeVapidToken(audience);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':  `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Type':   'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL':            '86400',
    },
    body: new TextEncoder().encode(payload),
  });
  return { ok: res.ok, status: res.status };
}

// ── Handler principal ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('[portal-push] VAPID keys not configured');
    return new Response(JSON.stringify({ error: 'VAPID not configured' }), { status: 500, headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      portal_user_id: string;
      title: string;
      body: string;
      url?: string;
    };

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Busca todas as subscriptions do usuário
    const { data: subs, error } = await supabase
      .from('portal_push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('portal_user_id', body.portal_user_id);

    if (error || !subs?.length) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: corsHeaders });
    }

    const notification = JSON.stringify({
      title: body.title,
      body:  body.body,
      icon:  '/icon-192.png',
      badge: '/favicon.svg',
      data:  { url: body.url ?? '/portal' },
    });

    const results = await Promise.allSettled(
      subs.map(s => sendWebPush(s, notification))
    );

    // Remove subscriptions expiradas (410 Gone)
    const expired = subs.filter((_, i) => {
      const r = results[i];
      return r.status === 'fulfilled' && r.value.status === 410;
    });
    if (expired.length > 0) {
      await supabase.from('portal_push_subscriptions')
        .delete()
        .in('endpoint', expired.map(s => s.endpoint));
    }

    const sent = results.filter(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<{ ok: boolean }>).value.ok).length;
    console.log(`[portal-push] sent=${sent}/${subs.length} user=${body.portal_user_id}`);
    return new Response(JSON.stringify({ sent, total: subs.length }), { status: 200, headers: corsHeaders });

  } catch (e) {
    console.error('[portal-push] error:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
