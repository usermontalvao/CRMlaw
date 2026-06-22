/**
 * email-bridge-send — encaminha um envio de email para a ponte (email-bridge),
 * mantendo o BRIDGE_API_TOKEN do lado servidor (nunca no frontend).
 *
 * Body: { to, subject, html?, text?, cc?, inReplyTo?, threadKey?, clientId? }
 * Requer JWT (equipe). Secrets: BRIDGE_URL, BRIDGE_API_TOKEN.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Identifica o usuário (equipe) a partir do JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'não autenticado' }, 401);

  const bridgeUrl = Deno.env.get('BRIDGE_URL');
  const bridgeToken = Deno.env.get('BRIDGE_API_TOKEN');
  if (!bridgeUrl || !bridgeToken) return json({ error: 'ponte não configurada (BRIDGE_URL/BRIDGE_API_TOKEN)' }, 500);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'json inválido' }, 400);
  }
  if (!payload.to || !payload.subject || (!payload.html && !payload.text)) {
    return json({ error: 'campos obrigatórios: to, subject e (html ou text)' }, 400);
  }

  try {
    const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify({ ...payload, senderUserId: userData.user.id }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out?.error) {
      return json({ error: out?.error ?? `falha na ponte (${res.status})` }, 502);
    }
    return json({ ok: true, messageId: out.messageId });
  } catch (e) {
    return json({ error: `não foi possível alcançar a ponte: ${String(e)}` }, 502);
  }
});
