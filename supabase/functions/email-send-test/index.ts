import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

// Envio de e-mail de teste para um template configurado.
// POST /functions/v1/email-send-test
// Body: { to: string, subject: string, html_body: string }
// Usa SMTP configurado via env vars (fallback: credenciais do sistema).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SMTP_HOST     = Deno.env.get('SMTP_HOST')     ?? 'smtp.hostinger.com';
const SMTP_PORT     = Number(Deno.env.get('SMTP_PORT'))   || 465;
const SMTP_USER     = Deno.env.get('SMTP_USER')     ?? 'assinatura@advcuiaba.com';
const SMTP_PASS     = Deno.env.get('SMTP_PASS')     ?? '';   // sem credencial hardcoded
const SMTP_FROM     = Deno.env.get('SMTP_FROM')     ?? 'assinatura@advcuiaba.com';
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'Jurius';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Não autorizado' }, 401);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verificar usuário interno
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Token inválido' }, 401);
    const role = user.app_metadata?.role ?? user.user_metadata?.role ?? '';
    if (role === 'portal_client') return json({ error: 'Acesso negado' }, 403);

    const body = await req.json() as { to?: string; subject?: string; html_body?: string };
    const { to, subject, html_body } = body;

    if (!to || !subject || !html_body) {
      return json({ error: 'to, subject e html_body são obrigatórios' }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) return json({ error: 'Endereço de e-mail inválido' }, 400);

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port:     SMTP_PORT,
        tls:      true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    await client.send({
      from:    `${SMTP_FROM_NAME} <${SMTP_FROM}>`,
      to:      [to],
      subject: `[TESTE] ${subject}`,
      html:    html_body,
      content: 'Este é um e-mail de teste enviado pelo painel de configurações.',
    });

    await client.close();

    return json({ success: true, message: `E-mail de teste enviado para ${to}.` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[email-send-test]', msg);
    return json({ error: `Falha ao enviar: ${msg}` }, 500);
  }
});
