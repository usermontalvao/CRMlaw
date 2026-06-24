import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// E-mail via Resend (chave em secret RESEND_API_KEY). Remetente no domínio
// verificado jurius.com.br; nenhuma credencial fica no código.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = 'noreply@jurius.com.br';
const FROM_NAME  = 'Jurius';
const REPLY_TO   = 'assinatura@advcuiaba.com';

const brandOrange = '#f97316';
const brandOrangeDark = '#ea580c';
const s900 = '#0f172a';
const s600 = '#475569';
const s200 = '#e2e8f0';
const s50 = '#f8fafc';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMentionEmailHtml(data: {
  mentionedName: string;
  authorName: string;
  deadlineTitle: string;
  commentText: string;
}): string {
  const safeComment = escapeHtml(data.commentText).replace(/\n/g, '<br>');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <style>
    @media only screen and (max-width:600px) {
      .container { width:100%!important; max-width:100%!important; }
      .padding { padding:16px!important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${s50};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${s50};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${s200};border-radius:16px;overflow:hidden;">

          <!-- Header Jurius (logo oficial) -->
          <tr>
            <td style="padding:24px 28px;background:#ffffff;border-bottom:1px solid #f1ece6;">
              <img src="https://jurius.com.br/email-header.png" alt="jurius.com.br — Gestão Jurídica Inteligente" width="280" style="display:block;border:0;outline:none;text-decoration:none;height:auto;" />
            </td>
          </tr>

          <!-- Título + Saudação -->
          <tr>
            <td class="padding" style="padding:24px 28px 8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:800;color:${s900};">💬 Você foi mencionado</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${s600};padding-top:6px;">
                Olá, <b>${escapeHtml(data.mentionedName)}</b>!<br>
                <b>${escapeHtml(data.authorName)}</b> mencionou você em um comentário no prazo:
              </div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td class="padding" style="padding:16px 28px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff7ed;border:1px solid #fdba74;border-radius:14px;overflow:hidden;">
                <tr><td style="height:4px;background:${brandOrange};"></td></tr>
                <tr>
                  <td style="padding:18px 20px 8px;">
                    <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;">Prazo</span><br>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;color:${s900};line-height:1.3;padding-top:2px;">${escapeHtml(data.deadlineTitle)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 20px 18px;">
                    <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;">Comentário</span>
                    <p style="margin:6px 0 0;font-size:14px;color:${s600};line-height:1.6;border-left:3px solid ${brandOrange};padding-left:12px;">${safeComment}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Botão -->
          <tr>
            <td class="padding" style="padding:0 28px 24px;" align="center">
              <a href="https://jurius.com.br" style="display:inline-block;padding:14px 32px;background:${brandOrange};background:linear-gradient(135deg,${brandOrange} 0%,${brandOrangeDark} 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.3px;">Ver no Sistema →</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="padding" style="padding:18px 28px;border-top:1px solid ${s200};background:${s50};">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:${s600};text-align:center;">
                <b style="color:${s900};">Jurius</b> • Gestão Jurídica
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#94a3b8;text-align:center;padding-top:4px;">
                Este e-mail foi enviado automaticamente. Não responda.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function loadEmailTemplate(
  supabase: any,
  trigger: string,
): Promise<{ subject: string; bodyHtml: string } | null> {
  try {
    const { data } = await supabase
      .from('system_settings').select('value').eq('key', 'email_templates').single();
    if (!Array.isArray(data?.value)) return null;
    const tpl = data.value.find((t: any) => t.trigger === trigger && t.is_custom === true);
    if (!tpl?.body_html) return null;
    return { subject: tpl.subject ?? '', bodyHtml: tpl.body_html };
  } catch { return null; }
}

function applyTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

async function loadOfficeName(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('system_settings').select('value').eq('key', 'office_identity').single();
    return data?.value?.name ?? 'Escritório';
  } catch { return 'Escritório'; }
}

async function sendMentionEmail(
  supabase: any,
  deadlineId: string,
  mentionedProfileId: string,
  authorName: string,
  commentText: string,
) {
  const { data: deadline } = await supabase.from('deadlines').select('title').eq('id', deadlineId).single();
  if (!deadline) return { success: false, error: 'Prazo não encontrado' };

  const { data: mentioned } = await supabase.from('profiles').select('name').eq('id', mentionedProfileId).single();
  if (!mentioned) return { success: false, error: 'Perfil mencionado não encontrado' };

  const { data: recipientEmail } = await supabase.rpc('get_email_by_profile_id', { p_profile_id: mentionedProfileId });
  if (!recipientEmail) return { success: false, error: 'Email do mencionado não encontrado' };

  const customTpl = await loadEmailTemplate(supabase, 'comment_mention');
  let emailHtml: string;
  let subjectLine: string;

  if (customTpl) {
    const officeName = await loadOfficeName(supabase);
    const vars: Record<string, string> = {
      mencionado: mentioned.name,
      autor: authorName || 'Um colega',
      prazo_titulo: deadline.title,
      comentario: commentText,
      escritorio_nome: officeName,
    };
    emailHtml = applyTemplateVars(customTpl.bodyHtml, vars);
    subjectLine = customTpl.subject
      ? applyTemplateVars(customTpl.subject, vars)
      : 'Você foi mencionado em um comentário - Jurius';
  } else {
    emailHtml = buildMentionEmailHtml({
      mentionedName: mentioned.name,
      authorName: authorName || 'Um colega',
      deadlineTitle: deadline.title,
      commentText,
    });
    subjectLine = 'Voce foi mencionado em um comentario - Jurius';
  }

  const { data: emailCfgRow } = await supabase
    .from('system_settings').select('value').eq('key', 'email_integration_config').maybeSingle();
  const cfgFromName: string = emailCfgRow?.value?.from_name ?? '';
  const cfgFromEmail: string = emailCfgRow?.value?.from_email ?? '';
  const fromSender = (cfgFromName && cfgFromEmail && cfgFromEmail.endsWith('@jurius.com.br'))
    ? `${cfgFromName} <${cfgFromEmail}>`
    : `${FROM_NAME} <${FROM_EMAIL}>`;

  // Chave do Resend: secret ou fallback em system_settings (igual weekly-digest)
  let resendKey = RESEND_API_KEY;
  if (!resendKey) {
    const { data: s } = await supabase.from('system_settings').select('value').eq('key', 'notification_config').single();
    resendKey = s?.value?.weekly_digest_resend_key ?? '';
  }
  if (!resendKey) return { success: false, error: 'Resend API key não configurada' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromSender,
      to: [recipientEmail],
      reply_to: REPLY_TO,
      subject: subjectLine,
      html: emailHtml,
      text: `${authorName || 'Alguem'} mencionou voce em um comentario no prazo "${deadline.title}": ${commentText}`,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { success: false, error: `Resend ${res.status}: ${errText.slice(0, 200)}` };
  }
  return { success: true, message: `Enviado para ${recipientEmail}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const payload = await req.json();
    const { deadline_id, mentioned_profile_id, author_name, comment_text } = payload;

    if (!deadline_id || !mentioned_profile_id) {
      return jsonResponse({ success: false, error: 'deadline_id e mentioned_profile_id obrigatórios' }, 400);
    }

    const result = await sendMentionEmail(
      supabase, deadline_id, mentioned_profile_id, author_name || '', comment_text || '',
    );
    return jsonResponse(result, result.success ? 200 : 500);
  } catch (err: any) {
    console.error('❌ Erro:', err?.message || err);
    return jsonResponse({ success: false, error: err?.message || 'Erro desconhecido' }, 500);
  }
});
