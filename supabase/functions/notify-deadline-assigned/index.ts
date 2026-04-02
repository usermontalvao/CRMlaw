import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const SMTP_HOST = 'smtp.hostinger.com';
const SMTP_PORT = 465;
const SMTP_USER = 'assinatura@advcuiaba.com';
const SMTP_PASS = 'f3a8b2c9d1e0f4a5B6c7d6e7F8a9b0c1d2e3f4a5b6c7d8e9E@';
const SMTP_FROM = 'assinatura@advcuiaba.com';
const SMTP_FROM_NAME = 'Jurius';

// Cores do sistema (mesmo padrão do email-send-otp)
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
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getPriorityLabel(p: string): string {
  return ({ urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' } as Record<string, string>)[p] || p;
}

function getPriorityColor(p: string): string {
  return ({ urgente: '#dc2626', alta: '#ea580c', media: '#d97706', baixa: '#16a34a' } as Record<string, string>)[p] || '#64748b';
}

function getTypeLabel(t: string): string {
  return ({ geral: 'Geral', processo: 'Processo', requerimento: 'Requerimento' } as Record<string, string>)[t] || t;
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
  mode: 'assigned' | 'reminder';
}): string {
  const pc = getPriorityColor(data.priority);
  const pl = getPriorityLabel(data.priority);
  const tl = getTypeLabel(data.type);
  const df = formatDate(data.dueDate);
  const dd = Math.ceil((new Date(data.dueDate).getTime() - Date.now()) / 86400000);

  let daysText = '';
  let daysColor = '#16a34a';
  if (dd < 0) { daysText = `Vencido há ${Math.abs(dd)} dia(s)`; daysColor = '#dc2626'; }
  else if (dd === 0) { daysText = 'Vence hoje!'; daysColor = '#dc2626'; }
  else if (dd === 1) { daysText = 'Vence amanhã!'; daysColor = '#ea580c'; }
  else if (dd <= 3) { daysText = `Faltam ${dd} dias`; daysColor = '#ea580c'; }
  else { daysText = `Faltam ${dd} dias`; daysColor = '#16a34a'; }

  const isReminder = data.mode === 'reminder';
  const headerTitle = isReminder ? 'Lembrete de Prazo' : 'Novo Prazo Atribuído';
  const headerSub = isReminder ? 'Você tem um prazo se aproximando' : 'Você recebeu uma nova responsabilidade';
  const headerIcon = isReminder ? '⏰' : '📅';
  const greeting = isReminder
    ? `Olá, <b>${data.responsibleName}</b>! Este é um lembrete sobre o prazo:`
    : `Olá, <b>${data.responsibleName}</b>!<br><b>${data.assignedByName}</b> atribuiu um novo prazo para você:`;

  const descHtml = data.description
    ? `<tr><td style="padding:0 20px 14px;"><p style="margin:0;font-size:13px;color:${s600};line-height:1.5;border-left:3px solid ${s200};padding-left:10px;">${data.description}</p></td></tr>`
    : '';

  const procHtml = data.processNumber
    ? `<tr><td style="padding:6px 0 0;"><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;">⚖️ Processo</span><br><span style="font-size:13px;color:${s900};font-family:monospace;">${data.processNumber}</span></td></tr>`
    : '';

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
      .padding-sm { padding:12px!important; }
      .logo-text { font-size:18px!important; }
      .logo-subtext { font-size:11px!important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${s50};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${s50};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${s200};border-radius:16px;overflow:hidden;">

          <!-- Header laranja Jurius -->
          <tr>
            <td style="background:${brandOrange};background:linear-gradient(135deg,${brandOrange} 0%,${brandOrangeDark} 100%);padding:28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td valign="middle" style="width:52px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44" height="44" style="width:44px;height:44px;background:#ffffff;border-radius:12px;">
                      <tr>
                        <td align="center" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:${brandOrangeDark};">J</td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <div class="logo-text" style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.2;font-weight:800;color:#ffffff;">Jurius</div>
                    <div class="logo-subtext" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.2;font-weight:600;color:#fff7ed;">Gestão Jurídica</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Título + Saudação -->
          <tr>
            <td class="padding" style="padding:24px 28px 8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:800;color:${s900};">${headerIcon} ${headerTitle}</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${s600};padding-top:6px;">${greeting}</div>
            </td>
          </tr>

          <!-- Card do prazo com barra de prioridade -->
          <tr>
            <td class="padding" style="padding:16px 28px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff7ed;border:1px solid #fdba74;border-radius:14px;overflow:hidden;">
                <tr><td style="height:4px;background:${pc};"></td></tr>
                <tr>
                  <td style="padding:18px 20px 6px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:800;color:${s900};line-height:1.3;">${data.title}</div>
                  </td>
                </tr>
                ${descHtml}
                <tr>
                  <td style="padding:0 20px 16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td width="50%" style="vertical-align:top;padding-right:8px;">
                          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;">Vencimento</span><br>
                          <span style="font-size:15px;font-weight:700;color:${s900};">${df}</span><br>
                          <span style="font-size:12px;font-weight:600;color:${daysColor};">${daysText}</span>
                        </td>
                        <td width="50%" style="vertical-align:top;padding-left:8px;">
                          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;">Prioridade</span><br>
                          <span style="display:inline-block;margin-top:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:${pc};">${pl}</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="vertical-align:top;padding-right:8px;padding-top:10px;">
                          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;">Tipo</span><br>
                          <span style="font-size:13px;color:${s900};font-weight:500;">${tl}</span>
                        </td>
                        <td width="50%" style="vertical-align:top;padding-left:8px;padding-top:10px;">
                          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;">Cliente</span><br>
                          <span style="font-size:13px;color:${s900};font-weight:500;">${data.clientName || 'Não definido'}</span>
                        </td>
                      </tr>
                      ${procHtml}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Botão laranja -->
          <tr>
            <td class="padding" style="padding:0 28px 24px;" align="center">
              <a href="https://jurius.com.br" style="display:inline-block;padding:14px 32px;background:${brandOrange};background:linear-gradient(135deg,${brandOrange} 0%,${brandOrangeDark} 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.3px;">Acessar Sistema →</a>
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

async function sendDeadlineEmail(
  supabase: any,
  deadlineId: string,
  assignedById: string | null,
  mode: 'assigned' | 'reminder',
) {
  const { data: deadline } = await supabase.from('deadlines').select('*').eq('id', deadlineId).single();
  if (!deadline?.responsible_id) return { success: false, error: 'Prazo sem responsável' };

  const { data: responsible } = await supabase.from('profiles').select('name, user_id').eq('id', deadline.responsible_id).single();
  if (!responsible) return { success: false, error: 'Perfil não encontrado' };

  const { data: recipientEmail } = await supabase.rpc('get_email_by_profile_id', { p_profile_id: deadline.responsible_id });
  if (!recipientEmail) return { success: false, error: 'Email não encontrado' };

  let assignedByName = 'Sistema';
  if (assignedById) {
    const { data: a } = await supabase.from('profiles').select('name').eq('user_id', assignedById).single();
    if (a) assignedByName = a.name;
  }

  let clientName: string | null = null;
  if (deadline.client_id) {
    const { data: c } = await supabase.from('clients').select('full_name').eq('id', deadline.client_id).single();
    if (c) clientName = c.full_name;
  }

  let processNumber: string | null = null;
  if (deadline.process_id) {
    const { data: p } = await supabase.from('processes').select('process_number').eq('id', deadline.process_id).single();
    if (p) processNumber = p.process_number;
  }

  const emailHtml = buildDeadlineEmailHtml({
    responsibleName: responsible.name, assignedByName, title: deadline.title,
    description: deadline.description || '', dueDate: deadline.due_date,
    priority: deadline.priority, type: deadline.type, clientName, processNumber, mode,
  });

  const subjectPrefix = mode === 'reminder' ? '⏰ Lembrete' : '📌 Novo Prazo';
  console.log(`🚀 Enviando email (${mode}) para ${recipientEmail}`);

  const smtpClient = new SMTPClient({
    connection: { hostname: SMTP_HOST, port: SMTP_PORT, tls: true, auth: { username: SMTP_USER, password: SMTP_PASS } },
  });

  await smtpClient.send({
    from: `${SMTP_FROM_NAME} <${SMTP_FROM}>`,
    to: recipientEmail,
    subject: `${subjectPrefix}: ${deadline.title}`,
    html: emailHtml,
    content: `${mode === 'reminder' ? 'Lembrete de prazo' : 'Novo prazo atribuído'}: ${deadline.title} - Vencimento: ${formatDate(deadline.due_date)}`,
  });

  await smtpClient.close();
  console.log(`✅ Email (${mode}) enviado para ${recipientEmail}`);
  return { success: true, message: `Enviado para ${recipientEmail}`, responsible_name: responsible.name };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const payload = await req.json();
    const { deadline_id, assigned_by_id, mode } = payload;

    if (!deadline_id) return jsonResponse({ success: false, error: 'deadline_id obrigatório' }, 400);

    const result = await sendDeadlineEmail(supabase, deadline_id, assigned_by_id || null, mode || 'assigned');
    return jsonResponse(result, result.success ? 200 : 500);
  } catch (err: any) {
    console.error('❌ Erro:', err?.message || err);
    return jsonResponse({ success: false, error: err?.message || 'Erro desconhecido' }, 500);
  }
});
