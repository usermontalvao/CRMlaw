import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// E-mail via Resend (chave em secret RESEND_API_KEY).
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = 'noreply@jurius.com.br';
const FROM_NAME = 'Jurius';
const REPLY_TO = 'assinatura@advcuiaba.com';

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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getPriorityLabel(priority: string): string {
  return ({
    urgente: 'Urgente',
    alta: 'Alta',
    media: 'Media',
    baixa: 'Baixa',
  } as Record<string, string>)[priority] || priority;
}

function getPriorityColor(priority: string): string {
  return ({
    urgente: '#dc2626',
    alta: '#ea580c',
    media: '#d97706',
    baixa: '#16a34a',
  } as Record<string, string>)[priority] || '#64748b';
}

function getTypeLabel(type: string): string {
  return ({
    geral: 'Geral',
    processo: 'Processo',
    requerimento: 'Requerimento',
  } as Record<string, string>)[type] || type;
}

function buildDeadlineEmailHtml(data: {
  responsibleName: string;
  assignedByName: string;
  title: string;
  description: string;
  dueDate: string;
  priority: string;
  type: string;
  clientName: string | null;
  processNumber: string | null;
  mode: 'assigned' | 'reminder' | 'overdue';
}): string {
  const priorityColor = getPriorityColor(data.priority);
  const priorityLabel = getPriorityLabel(data.priority);
  const typeLabel = getTypeLabel(data.type);
  const dueDateFormatted = formatDate(data.dueDate);
  const daysDiff = Math.ceil((new Date(data.dueDate).getTime() - Date.now()) / 86400000);

  let daysText = '';
  let daysColor = '#1E8A5B';
  if (daysDiff < 0) {
    daysText = `Vencido há ${Math.abs(daysDiff)} dia(s)`;
    daysColor = '#D8442B';
  } else if (daysDiff === 0) {
    daysText = 'Vence hoje!';
    daysColor = '#D8442B';
  } else if (daysDiff === 1) {
    daysText = 'Falta 1 dia';
    daysColor = '#D98018';
  } else if (daysDiff <= 3) {
    daysText = `Faltam ${daysDiff} dias`;
    daysColor = '#D98018';
  } else {
    daysText = `Faltam ${daysDiff} dias`;
    daysColor = '#1E8A5B';
  }

  const isReminder = data.mode === 'reminder';
  const isOverdue = data.mode === 'overdue';
  const selfAssigned = data.assignedByName === data.responsibleName;

  const eyebrow = isOverdue ? 'Prazo Vencido' : isReminder ? 'Lembrete de Prazo' : 'Notificação de Prazo';
  const headerTitle = isOverdue ? 'Prazo vencido' : isReminder ? 'Lembrete de prazo' : 'Novo prazo atribuído';

  const greeting = isReminder
    ? `Olá, <strong style="color:#16213A;">${data.responsibleName}</strong>. Este é um lembrete sobre o prazo abaixo. Confira os detalhes.`
    : selfAssigned
      ? `Olá, <strong style="color:#16213A;">${data.responsibleName}</strong>. Um novo prazo foi cadastrado e atribuído a você. Confira os detalhes abaixo.`
      : `Olá, <strong style="color:#16213A;">${data.responsibleName}</strong>. <strong style="color:#16213A;">${data.assignedByName}</strong> atribuiu um novo prazo para você. Confira os detalhes abaixo.`;

  const descriptionHtml = data.description
    ? `<tr><td colspan="2" style="padding-top:16px;padding-bottom:4px;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#54607A;line-height:1.6;border-left:3px solid #F5762B;padding-left:12px;">${data.description}</p></td></tr>`
    : '';

  const processHtml = data.processNumber
    ? `<tr><td colspan="2" style="padding-top:14px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:6px;">Processo</div>
        <div style="font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:500;color:#303A52;">${data.processNumber}</div>
      </td></tr>`
    : '';

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
      .two-col td{display:block!important;width:100%!important;padding-right:0!important;padding-left:0!important;}
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
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.16em;color:#EC5A1E;text-transform:uppercase;margin-bottom:12px;">${eyebrow}</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#16213A;letter-spacing:-0.015em;">${headerTitle}</div>
          <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#54607A;">${greeting}</p>
        </td></tr>

        <tr><td style="padding:20px 36px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFF6EE;border:1px solid #FAD9C0;border-radius:16px;overflow:hidden;">
            <tr><td style="height:4px;background:linear-gradient(90deg,#F5762B,#E14E14);font-size:0;">&nbsp;</td></tr>
            <tr><td style="padding:22px 24px 24px;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#16213A;font-weight:bold;margin-bottom:20px;">${data.title}</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="two-col">
                <tr>
                  <td width="50%" valign="top" style="padding-right:12px;padding-bottom:16px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Vencimento</div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#16213A;">${dueDateFormatted}</div>
                    <div style="margin-top:5px;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${daysColor};vertical-align:middle;margin-right:5px;"></span><span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:600;color:${daysColor};vertical-align:middle;">${daysText}</span></div>
                  </td>
                  <td width="50%" valign="top" style="padding-left:12px;padding-bottom:16px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Prioridade</div>
                    <span style="display:inline-block;padding:5px 14px;border-radius:999px;background:${priorityColor};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">${priorityLabel}</span>
                  </td>
                </tr>
                <tr><td colspan="2" style="height:1px;background:#F4DCC7;padding:0;font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td width="50%" valign="top" style="padding-right:12px;padding-top:16px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Tipo</div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;color:#303A52;">${typeLabel}</div>
                  </td>
                  <td width="50%" valign="top" style="padding-left:12px;padding-top:16px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.12em;color:#B0834F;text-transform:uppercase;margin-bottom:7px;">Cliente</div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;color:#303A52;">${data.clientName || 'Não definido'}</div>
                  </td>
                </tr>
                ${descriptionHtml}
                ${processHtml}
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:28px 36px 32px;text-align:center;">
          <a href="https://jurius.com.br" style="display:inline-block;text-decoration:none;background:linear-gradient(150deg,#F5762B 0%,#E14E14 100%);color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.01em;padding:14px 36px;border-radius:12px;">Acessar Sistema &rarr;</a>
          <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#97A0B2;">Acesse o painel para visualizar o processo completo e acompanhar todas as movimentações.</p>
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
      .from('system_settings')
      .select('value')
      .eq('key', 'email_templates')
      .single();
    if (!Array.isArray(data?.value)) return null;
    const template = data.value.find((item: any) => item.trigger === trigger && item.is_custom === true);
    if (!template?.body_html) return null;
    return { subject: template.subject ?? '', bodyHtml: template.body_html };
  } catch {
    return null;
  }
}

function applyTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

async function loadOfficeName(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'office_identity')
      .single();
    return data?.value?.name ?? 'Escritorio';
  } catch {
    return 'Escritorio';
  }
}

async function sendDeadlineEmail(
  supabase: any,
  deadlineId: string,
  assignedById: string | null,
  mode: 'assigned' | 'reminder' | 'overdue',
) {
  const { data: deadline } = await supabase.from('deadlines').select('*').eq('id', deadlineId).single();
  if (!deadline?.responsible_id) return { success: false, error: 'Prazo sem responsavel' };

  const { data: responsible } = await supabase
    .from('profiles')
    .select('name, user_id')
    .eq('id', deadline.responsible_id)
    .single();
  if (!responsible) return { success: false, error: 'Perfil nao encontrado' };

  const { data: recipientEmail } = await supabase.rpc('get_email_by_profile_id', {
    p_profile_id: deadline.responsible_id,
  });
  if (!recipientEmail) return { success: false, error: 'Email nao encontrado' };

  let assignedByName = 'Sistema';
  if (assignedById) {
    const { data: assignedBy } = await supabase
      .from('profiles')
      .select('name')
      .eq('user_id', assignedById)
      .single();
    if (assignedBy) assignedByName = assignedBy.name;
  }

  let clientName: string | null = null;
  if (deadline.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('full_name')
      .eq('id', deadline.client_id)
      .single();
    if (client) clientName = client.full_name;
  }

  let processNumber: string | null = null;
  if (deadline.process_id) {
    const { data: process } = await supabase
      .from('processes')
      .select('process_number')
      .eq('id', deadline.process_id)
      .single();
    if (process) processNumber = process.process_number;
  }

  const trigger = mode === 'overdue'
    ? 'deadline_overdue'
    : mode === 'reminder'
      ? 'deadline_due'
      : 'deadline_assigned';
  const customTemplate = await loadEmailTemplate(supabase, trigger);
  const daysUntil = Math.ceil((new Date(deadline.due_date).getTime() - Date.now()) / 86400000);

  let emailHtml: string;
  let subjectLine: string;

  if (customTemplate) {
    const officeName = await loadOfficeName(supabase);
    const vars: Record<string, string> = {
      responsavel: responsible.name,
      prazo_descricao: deadline.title,
      prazo_data: formatDate(deadline.due_date),
      dias_restantes: String(Math.max(0, daysUntil)),
      cliente_nome: clientName ?? 'Nao definido',
      escritorio_nome: officeName,
    };
    const rawHtml = applyTemplateVars(customTemplate.bodyHtml, vars);
    emailHtml = rawHtml.split('\n').map((line: string) => line.trimEnd()).join('\n');
    subjectLine = customTemplate.subject
      ? applyTemplateVars(customTemplate.subject, vars)
      : mode === 'overdue'
        ? 'Prazo vencido - Jurius'
        : mode === 'reminder'
          ? 'Lembrete de prazo - Jurius'
          : 'Novo prazo cadastrado - Jurius';
  } else {
    const rawHtml = buildDeadlineEmailHtml({
      responsibleName: responsible.name,
      assignedByName,
      title: deadline.title,
      description: deadline.description || '',
      dueDate: deadline.due_date,
      priority: deadline.priority,
      type: deadline.type,
      clientName,
      processNumber,
      mode,
    });
    emailHtml = rawHtml.split('\n').map((line: string) => line.trimEnd()).join('\n');
    subjectLine = mode === 'overdue'
      ? 'Prazo vencido - Jurius'
      : mode === 'reminder'
        ? 'Lembrete de prazo - Jurius'
        : 'Novo prazo cadastrado - Jurius';
  }

  console.log(`Enviando email (${mode}) para ${recipientEmail}`);

  const { data: emailConfigRow } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'email_integration_config')
    .maybeSingle();
  const configuredFromName: string = emailConfigRow?.value?.from_name ?? '';
  const configuredFromEmail: string = emailConfigRow?.value?.from_email ?? '';
  const fromSender = (configuredFromName && configuredFromEmail && configuredFromEmail.endsWith('@jurius.com.br'))
    ? `${configuredFromName} <${configuredFromEmail}>`
    : `${FROM_NAME} <${FROM_EMAIL}>`;

  let resendKey = RESEND_API_KEY;
  if (!resendKey) {
    const { data: settings } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'notification_config')
      .single();
    resendKey = settings?.value?.weekly_digest_resend_key ?? '';
  }
  if (!resendKey) return { success: false, error: 'Resend API key nao configurada' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromSender,
      to: [recipientEmail],
      reply_to: REPLY_TO,
      subject: subjectLine,
      html: emailHtml,
      text: `${mode === 'overdue' ? 'Prazo vencido' : mode === 'reminder' ? 'Lembrete de prazo' : 'Novo prazo cadastrado'}: ${deadline.title} - Vencimento: ${formatDate(deadline.due_date)}`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    return { success: false, error: `Resend ${response.status}: ${errorText.slice(0, 200)}` };
  }

  console.log(`Email (${mode}) enviado para ${recipientEmail}`);
  return {
    success: true,
    message: `Enviado para ${recipientEmail}`,
    responsible_name: responsible.name,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const payload = await req.json();
    const { deadline_id, assigned_by_id, mode } = payload;

    if (!deadline_id) {
      return jsonResponse({ success: false, error: 'deadline_id obrigatorio' }, 400);
    }

    const result = await sendDeadlineEmail(
      supabase,
      deadline_id,
      assigned_by_id || null,
      mode || 'assigned',
    );
    return jsonResponse(result, result.success ? 200 : 500);
  } catch (error: any) {
    console.error('Erro:', error?.message || error);
    return jsonResponse({ success: false, error: error?.message || 'Erro desconhecido' }, 500);
  }
});
