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
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;700&family=Space+Grotesk:wght@600&display=swap');
    @media only screen and (max-width:600px){
      .container{width:100%!important;border-radius:0!important;}
      .card-pad{padding:24px 20px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#EEF0F4;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EEF0F4;">
    <tr><td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px -20px rgba(20,28,52,0.22),0 4px 14px -6px rgba(20,28,52,0.10);">

        <tr><td style="height:5px;background:linear-gradient(90deg,#F5762B 0%,#E14E14 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td class="card-pad" style="padding:28px 36px;border-bottom:1px solid #F0F1F4;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" width="52">
                <img src="https://uajwkqipbyxzvwjpitxl.supabase.co/storage/v1/object/public/profile-banners/logo.png" width="52" height="52" alt="Jurius" style="display:block;border:0;border-radius:14px;">
              </td>
              <td width="28" style="padding:0 14px;"><div style="width:1px;height:36px;background:#E7E9EE;"></div></td>
              <td valign="middle">
                <div style="font-family:'Spectral',Georgia,'Times New Roman',serif;font-size:26px;line-height:1;letter-spacing:-.012em;"><span style="color:#211C18;font-weight:700;">jurius</span><span style="color:#E45C12;font-weight:700;">.</span><span style="font-weight:400;color:#A0958C;">com.br</span></div>
                <div style="margin-top:6px;font-family:'Space Grotesk',Arial,Helvetica,sans-serif;font-size:8px;font-weight:600;letter-spacing:0.28em;color:#A0958C;text-transform:uppercase;">GESTÃO JURÍDICA INTELIGENTE</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td class="card-pad" style="padding:32px 36px 12px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.16em;color:#EC5A1E;text-transform:uppercase;margin-bottom:12px;">Nova Menção</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#16213A;letter-spacing:-0.015em;">Você foi mencionado</div>
          <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#54607A;">Olá, <strong style="color:#16213A;">${escapeHtml(data.mentionedName)}</strong>. <strong style="color:#16213A;">${escapeHtml(data.authorName)}</strong> mencionou você em um comentário. Veja o contexto abaixo.</p>
        </td></tr>

        <tr><td style="padding:20px 36px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFF6EE;border:1px solid #FAD9C0;border-radius:16px;overflow:hidden;">
            <tr><td style="height:4px;background:linear-gradient(90deg,#F5762B,#E14E14);font-size:0;">&nbsp;</td></tr>
            <tr><td style="padding:22px 24px 24px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Prazo</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#16213A;font-weight:bold;margin-bottom:20px;">${escapeHtml(data.deadlineTitle)}</div>
              <div style="height:1px;background:#F4DCC7;margin-bottom:20px;font-size:0;">&nbsp;</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:10px;">Comentário</div>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#54607A;line-height:1.7;border-left:3px solid #F5762B;padding-left:14px;">${safeComment}</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 36px 32px;text-align:center;">
          <a href="https://jurius.com.br" style="display:inline-block;text-decoration:none;background:linear-gradient(150deg,#F5762B 0%,#E14E14 100%);color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.01em;padding:14px 36px;border-radius:12px;">Ver no Sistema &rarr;</a>
          <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#97A0B2;">Acesse o painel para visualizar e responder ao comentário.</p>
        </td></tr>

        <tr><td style="padding:18px 24px 16px;border-top:1px solid #F0F1F4;text-align:center;background:#F8F9FB;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5C667C;font-weight:600;">Jurius &bull; Gestão Jurídica Inteligente</div>
          <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.6;color:#9AA2B2;">Este e-mail foi enviado automaticamente. Não responda esta mensagem.<br/>© 2026 Jurius. Todos os direitos reservados.</div>
        </td></tr>

      </table>
    </td></tr>
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
