/**
 * whatsapp-avatar — busca a foto de perfil do contato sob demanda e persiste.
 *
 * POST { conversation_id }  (JWT da equipe).
 * Resolve a instância/telefone da conversa, pergunta a URL à Evolution
 * (chat/fetchProfilePictureUrl), baixa os bytes e salva no bucket whatsapp-media
 * (cópia própria não expira como a URL CDN do WhatsApp). Persiste só o caminho;
 * o client resolve em URL assinada. Serve para backfill e para refrescar a foto.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MEDIA_BUCKET = 'whatsapp-media';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const conversationId: string | null = body?.conversation_id || null;
  if (!conversationId) return json({ error: 'conversation_id obrigatório' }, 400);

  const { data: conv } = await admin.from('whatsapp_conversations')
    .select('id, instance_id, remote_jid, contact_phone').eq('id', conversationId).maybeSingle();
  if (!conv) return json({ error: 'Conversa não encontrada' }, 404);

  const { data: channel } = await admin.from('whatsapp_instances')
    .select('instance_name').eq('id', conv.instance_id).maybeSingle();
  if (!channel?.instance_name) return json({ error: 'Canal sem instância' }, 400);

  const { data: cfgRow } = await admin.from('system_settings')
    .select('value').eq('key', 'whatsapp_evolution_config').maybeSingle();
  const server = (cfgRow?.value || {}) as { base_url?: string; api_key?: string };
  if (!server.base_url || !server.api_key) return json({ error: 'Servidor Evolution não configurado' }, 400);
  const base = server.base_url.replace(/\/+$/, '');
  const inst = encodeURIComponent(channel.instance_name);

  // Tenta pelo telefone real; se vazio, pelo remote_jid completo (@lid/@s.whatsapp.net).
  const candidates = [conv.contact_phone, conv.remote_jid].filter((x): x is string => !!x);
  let picUrl: string | null = null;
  for (const number of candidates) {
    try {
      const res = await fetch(`${base}/chat/fetchProfilePictureUrl/${inst}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: server.api_key },
        body: JSON.stringify({ number }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const out = await res.json().catch(() => ({}));
      const u = out?.profilePictureUrl || out?.profilePicUrl;
      if (u && typeof u === 'string') { picUrl = u; break; }
    } catch { /* tenta o próximo */ }
  }
  if (!picUrl) return json({ ok: true, path: null }); // contato sem foto / privacidade

  let path: string | null = null;
  try {
    const img = await fetch(picUrl, { signal: AbortSignal.timeout(20_000) });
    if (!img.ok) return json({ ok: true, path: null });
    const mime = img.headers.get('content-type') || 'image/jpeg';
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength === 0) return json({ ok: true, path: null });
    const ext = (mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg';
    path = `avatars/${conv.id}.${ext}`;
    const up = await admin.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (up.error) return json({ error: up.error.message }, 500);
    await admin.from('whatsapp_conversations').update({ contact_avatar_path: path }).eq('id', conv.id);
  } catch (err) {
    return json({ error: (err as Error).message || 'Falha ao baixar foto' }, 502);
  }

  return json({ ok: true, path });
});
