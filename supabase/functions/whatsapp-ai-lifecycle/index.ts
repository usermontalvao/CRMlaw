import { createClient } from 'jsr:@supabase/supabase-js@2';
import { dispatchWaAiLifecycle } from '../_shared/wa-ai-lifecycle-hook.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const admin = createClient(supabaseUrl, serviceRole);
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(bearer);
  if (!auth?.user) return json({ error: 'Não autorizado' }, 401);
  const { data: profile } = await admin.from('profiles')
    .select('user_id, is_active').eq('user_id', auth.user.id).maybeSingle();
  if (!profile || profile.is_active === false) return json({ error: 'Acesso negado' }, 403);

  const body = await req.json().catch(() => ({}));
  const requestId = String(body?.document_request_id || '');
  if (!requestId) return json({ error: 'document_request_id obrigatório' }, 400);
  const { data: request } = await admin.from('document_requests')
    .select('id, client_id, title').eq('id', requestId).maybeSingle();
  if (!request) return json({ error: 'Solicitação não encontrada' }, 404);
  const { data: items } = await admin.from('document_request_items')
    .select('status, required').eq('request_id', requestId);
  const required = (items || []).filter((item: any) => item.required);
  const complete = required.length > 0 && required.every((item: any) => item.status === 'approved');
  await admin.from('document_requests').update({
    status: complete ? 'complete' : (items || []).some((item: any) => item.status !== 'pending') ? 'partial' : 'pending',
  }).eq('id', requestId);
  if (!complete) return json({ ok: true, complete: false });

  const { data: conversation } = await admin.from('whatsapp_conversations')
    .select('id').eq('client_id', request.client_id).in('status', ['open', 'pending'])
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (!conversation?.id) return json({ ok: true, complete: true, skipped: 'sem conversa aberta' });
  await dispatchWaAiLifecycle({
    supabaseUrl, serviceRole, conversationId: conversation.id,
    trigger: 'documents_completed', resourceId: requestId,
  });
  return json({ ok: true, complete: true });
});
