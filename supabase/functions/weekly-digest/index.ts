/**
 * weekly-digest — Supabase Edge Function  (v8)
 *
 * Envia resumo semanal personalizado para cada membro da equipe.
 * Respeita permissões por cargo (role_permissions) e overrides individuais
 * (user_module_overrides). Envia via Resend API.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY_ENV       = Deno.env.get('RESEND_API_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────

const TZ = 'America/Cuiaba'; // UTC-4 — horário do escritório

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: TZ })
    .replace('.', '');
};

const fmtTime = (d: string | null | undefined) => {
  if (!d) return '';
  const t = new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  return t === '00:00' ? '' : t; // suprime meia-noite (eventos de dia inteiro)
};

const fmtCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtShort = (v: number) => {
  if (v >= 1000) return 'R$ ' + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + 'k';
  return fmtCurrency(v);
};

const fmtBenefit = (s: string | null | undefined) =>
  (s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const weekday = (d: string) =>
  new Date(d).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: TZ }).replace('.', '');

const daysUntil = (d: string, now: Date) =>
  Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);

const weekRange = () => {
  const now = new Date();
  const next7 = new Date(now.getTime() + 7 * 86_400_000);
  return {
    end: next7.toISOString(),
    label: `${now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: TZ }).replace('.', '')} – ${next7.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }).replace('.', '')}`,
  };
};

const normalizeRole = (role: string) =>
  (role ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || 'Equipe';

// ── Templates ─────────────────────────────────────────────────────────────────

async function loadEmailTemplate(
  sb: any,
  trigger: string,
): Promise<{ subject: string; bodyHtml: string } | null> {
  try {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'email_templates').single();
    if (!Array.isArray(data?.value)) return null;
    const tpl = data.value.find((t: any) => t.trigger === trigger && t.is_custom === true);
    if (!tpl?.body_html) return null;
    return { subject: tpl.subject ?? '', bodyHtml: tpl.body_html };
  } catch {
    return null;
  }
}

function applyTemplateVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

async function loadOfficeName(sb: any): Promise<string> {
  try {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'office_identity').single();
    return data?.value?.name ?? 'Escritório';
  } catch {
    return 'Escritório';
  }
}

// ── Permissões ───────────────────────────────────────────────────────────────

function makeChecker(
  rolePermissions: any[],
  overrides: any[],
  profile: { user_id: string; role: string | null },
  now: Date,
) {
  const normalized = normalizeRole(profile.role ?? '');
  const isAdmin = normalized === 'administrador';

  return (module: string): boolean => {
    if (isAdmin) return true;
    const ov = overrides.find((o) => o.user_id === profile.user_id && o.module === module);
    if (ov?.can_view && (!ov.expires_at || new Date(ov.expires_at) > now)) return true;
    const perm = rolePermissions.find((p) => p.role === normalized && p.module === module);
    return perm?.can_view === true;
  };
}

// ── Template editorial ────────────────────────────────────────────────────────

type Row = {
  main: string;      // texto principal, 14px bold
  sub?: string;      // linha secundária, 12px cinza (ex: nome do cliente)
  meta?: string;     // coluna direita, 12px
  accent?: boolean;  // meta em vermelho
  highlight?: boolean; // borda esquerda vermelha + fundo — para alertas urgentes
};

type Block =
  | { kind: 'stat'; items: Array<{ label: string; value: string; sub?: string }> }
  | { kind: 'list'; rows: Row[] };

type Section = {
  eyebrow: string;
  title: string;
  meta?: string;
  blocks: Block[];
};

function buildHtml(opts: {
  userFirstName: string;
  officeName: string;
  weekLabel: string;
  intro: string;
  sections: Section[];
}): string {
  const { userFirstName, officeName, weekLabel, intro, sections } = opts;

  const renderBlock = (block: Block): string => {
    if (block.kind === 'stat') {
      const cells = block.items.map((it, i) => {
        const border = i === 0 ? '' : 'border-left:1px solid #ececec;';
        return `<td valign="top" style="${border}padding:0 18px;">
          <div style="font-size:10px;font-weight:700;color:#9a9a9a;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px;">${it.label}</div>
          <div style="font-size:24px;font-weight:800;color:#111;line-height:1.1;letter-spacing:-.02em;">${it.value}</div>
          ${it.sub ? `<div style="font-size:11px;color:#888;margin-top:4px;">${it.sub}</div>` : ''}
        </td>`;
      }).join('');
      return `<table cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 22px;"><tr>${cells}</tr></table>`;
    }
    // list — layout: main (left) + meta (right), sub abaixo do main
    return block.rows.map((row, idx) => {
      const isLast = idx === block.rows.length - 1;
      const metaColor = row.accent ? 'color:#c2410c;font-weight:700;' : 'color:#888;';
      if (row.highlight) {
        // Destaque urgente: fundo levemente vermelho + borda esquerda laranja-vermelho
        return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:${isLast ? '10px 0 0' : '10px 0'};${isLast ? '' : 'border-bottom:1px solid #f0f0f0;'}">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="background:#fff5f5;border-left:3px solid #c2410c;padding:10px 12px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="font-size:14px;font-weight:700;color:#111;line-height:1.4;padding-right:16px;">${row.main}</td>
                    ${row.meta ? `<td align="right" valign="top" style="white-space:nowrap;font-size:13px;font-weight:700;color:#c2410c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${row.meta}</td>` : ''}
                  </tr>
                  ${row.sub ? `<tr><td colspan="2" style="font-size:12px;color:#888;padding-top:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${row.sub}</td></tr>` : ''}
                </table>
              </td>
            </tr></table>
          </td></tr>
        </table>`;
      }
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:11px 0;${isLast ? '' : 'border-bottom:1px solid #f0f0f0;'}">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:14px;font-weight:600;color:#111;line-height:1.4;padding-right:16px;">${row.main}</td>
              ${row.meta ? `<td align="right" valign="top" style="white-space:nowrap;font-size:12px;${metaColor}font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${row.meta}</td>` : ''}
            </tr>
            ${row.sub ? `<tr><td colspan="2" style="font-size:12px;color:#999;padding-top:3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${row.sub}</td></tr>` : ''}
          </table>
        </td></tr>
      </table>`;
    }).join('');
  };

  const renderSection = (sec: Section) => `
    <tr><td style="padding:34px 0 0;">
      <div style="font-size:9px;font-weight:800;color:#c2410c;letter-spacing:.18em;text-transform:uppercase;">${sec.eyebrow}</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tr>
        <td><div style="font-size:20px;font-weight:800;color:#111;letter-spacing:-.02em;line-height:1.15;">${sec.title}</div></td>
        ${sec.meta ? `<td align="right" valign="bottom"><div style="font-size:11px;color:#999;font-weight:500;white-space:nowrap;">${sec.meta}</div></td>` : ''}
      </tr></table>
      <div style="height:28px;border-bottom:1px solid #111;margin-bottom:0;"></div>
      ${sec.blocks.map(renderBlock).join('')}
    </td></tr>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${officeName} — Resumo semanal</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;700&family=Space+Grotesk:wght@600&display=swap');
    @media screen and (max-width:600px){
      .container{width:100%!important;border-radius:0!important;}
      .card-pad{padding-left:22px!important;padding-right:22px!important;}
      .greeting{font-size:26px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#EEF0F4;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">

  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${intro.replace(/<[^>]+>/g, '')}</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF0F4;">
    <tr><td align="center" style="padding:32px 16px 48px;">

      <table class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px -20px rgba(20,28,52,0.22),0 4px 14px -6px rgba(20,28,52,0.10);">

        <!-- Brand bar -->
        <tr><td style="height:5px;background:linear-gradient(90deg,#F5762B 0%,#E14E14 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Header / Logo -->
        <tr><td class="card-pad" style="padding:28px 36px;border-bottom:1px solid #F0F1F4;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" width="52">
                <img src="https://jurius.com.br/logo.png" width="52" height="52" alt="Jurius" style="display:block;border:0;border-radius:14px;">
              </td>
              <td width="28" style="padding:0 14px;"><div style="width:1px;height:36px;background:#E7E9EE;"></div></td>
              <td valign="middle">
                <div style="font-family:'Spectral',Georgia,'Times New Roman',serif;font-size:26px;line-height:1;letter-spacing:-.012em;"><span style="color:#211C18;font-weight:700;">jurius</span><span style="color:#E45C12;font-weight:700;">.</span><span style="font-weight:400;color:#A0958C;">com.br</span></div>
                <div style="margin-top:6px;font-family:'Space Grotesk',Arial,Helvetica,sans-serif;font-size:8px;font-weight:600;letter-spacing:0.28em;color:#A0958C;text-transform:uppercase;">GESTÃO JURÍDICA INTELIGENTE</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Editorial header row (week label) -->
        <tr><td class="card-pad" style="padding:28px 36px 0;font-family:Arial,Helvetica,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td><div style="font-size:10px;font-weight:800;color:#EC5A1E;letter-spacing:0.22em;text-transform:uppercase;">Resumo Semanal</div></td>
            <td align="right"><div style="font-size:10px;color:#9AA2B2;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">${weekLabel}</div></td>
          </tr></table>
        </td></tr>

        <!-- Greeting -->
        <tr><td class="card-pad" style="padding:16px 36px 0;">
          <div class="greeting" style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:#16213A;line-height:1.15;letter-spacing:-0.02em;">Olá, ${userFirstName}.</div>
          <div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#54607A;line-height:1.7;">${intro}</div>
        </td></tr>

        <!-- Editorial sections content -->
        <tr><td class="card-pad" style="padding:0 36px 32px;font-family:Arial,Helvetica,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${sections.map(renderSection).join('')}
          </table>
        </td></tr>

        <!-- Footer editorial note -->
        <tr><td class="card-pad" style="padding:0 36px 28px;border-top:1px solid #F0F1F4;font-family:Arial,Helvetica,sans-serif;background:#F8F9FB;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr>
            <td>
              <div style="font-size:11px;color:#9AA2B2;line-height:1.6;">
                Você recebeu este resumo por fazer parte da equipe <span style="color:#303A52;font-weight:600;">${officeName}</span>.<br/>
                Apenas itens dos módulos com sua permissão foram incluídos.
              </div>
            </td>
            <td align="right" valign="top" style="padding-left:16px;">
              <div style="font-size:10px;color:#EC5A1E;font-weight:800;letter-spacing:0.2em;">JURIUS</div>
            </td>
          </tr></table>
        </td></tr>

        <!-- Footer brand -->
        <tr><td style="padding:16px 24px 16px;border-top:1px solid #F0F1F4;text-align:center;background:#F8F9FB;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5C667C;font-weight:600;">Jurius &bull; Gestão Jurídica Inteligente</div>
          <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.6;color:#9AA2B2;">Este e-mail foi enviado automaticamente. Não responda esta mensagem.<br/>© 2026 Jurius. Todos os direitos reservados.</div>
        </td></tr>

      </table>

    </td></tr>
  </table>

</body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const startedAt = new Date().toISOString();
  let logId: string | null = null;
  const { data: logRow } = await supabase
    .from('cron_job_logs')
    .insert({ job_name: 'weekly-digest', status: 'running', started_at: startedAt })
    .select('id')
    .single();
  logId = logRow?.id ?? null;

  try {
    const now    = new Date();
    const week   = weekRange();
    const next7  = new Date(now.getTime() + 7  * 86_400_000).toISOString();
    const next30 = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    const next14 = new Date(now.getTime() + 14 * 86_400_000).toISOString();
    const last7  = new Date(now.getTime() - 7  * 86_400_000).toISOString();

    // Permite envio apenas para um e-mail específico via { to: 'email@x.com' }
    // Ou bypass do gate de dia/hora via { force: true }
    let onlyTo: string | null = null;
    let forceRun = false;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.to && typeof body.to === 'string') onlyTo = body.to;
      if (body?.force === true) forceRun = true;
    } catch { /* sem body */ }

    // ── Settings
    const { data: settingRow } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'notification_config')
      .single();

    const config = settingRow?.value ?? {};
    const resendKey: string = config.weekly_digest_resend_key || RESEND_KEY_ENV;

    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'Resend API key não configurada.' }), { status: 400 });
    }

    // ── Gate: verifica se digest está habilitado e se este é o momento certo
    // O cron roda a cada hora; a função decide se envia baseada nas settings da UI.
    // Timezone do escritório: America/Cuiaba (UTC-4, sem horário de verão)
    if (!forceRun) {
      const digestEnabled: boolean = config.weekly_digest === true;
      if (!digestEnabled) {
        return new Response(JSON.stringify({ skipped: true, reason: 'Digest desabilitado nas configurações.' }), { status: 200 });
      }

      const configuredDay:  number = config.weekly_digest_day  ?? 0;      // 0=Dom … 6=Sáb
      const configuredHour: string = config.weekly_digest_hour ?? '08:00'; // "HH:MM"

      // Horário atual no fuso do escritório
      const localStr = now.toLocaleString('en-US', { timeZone: TZ, hour12: false,
        weekday: 'short', hour: '2-digit', minute: '2-digit' });
      // Extrai dia da semana e hora local
      const localDate = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
      const localDay  = localDate.getDay();   // 0=Dom … 6=Sáb
      const localHour = localDate.getHours();
      const localMin  = localDate.getMinutes();
      const [cfgH, cfgM] = configuredHour.split(':').map(Number);

      if (localDay !== configuredDay || localHour !== cfgH || localMin !== cfgM) {
        return new Response(JSON.stringify({
          skipped: true,
          reason: `Fora do horário configurado. Agora: ${localDay}/${localHour}:${String(localMin).padStart(2,'0')} | Configurado: ${configuredDay}/${configuredHour}`,
        }), { status: 200 });
      }
    }

    const [{ data: officeRow }, { data: emailCfgRow }] = await Promise.all([
      supabase.from('system_settings').select('value').eq('key', 'office_identity').single(),
      supabase.from('system_settings').select('value').eq('key', 'email_integration_config').single(),
    ]);
    const officeName: string = officeRow?.value?.name ?? 'Escritório';
    const configuredFromName: string = emailCfgRow?.value?.from_name ?? '';
    const configuredFromEmail: string = emailCfgRow?.value?.from_email ?? '';
    const senderFrom = (configuredFromName && configuredFromEmail)
      ? `${configuredFromName} <${configuredFromEmail}>`
      : 'Jurius CRM <noreply@jurius.com.br>';

    const customTpl = await loadEmailTemplate(supabase, 'weekly_digest');

    // ── Profiles
    let profilesQuery = supabase
      .from('profiles')
      .select('user_id, name, role, email')
      .not('email', 'is', null)
      .eq('is_active', true); // digest enviado para todos os membros ativos

    if (onlyTo) profilesQuery = profilesQuery.eq('email', onlyTo);

    const { data: profiles } = await profilesQuery;

    if (!profiles?.length) {
      return new Response(JSON.stringify({ sent: 0, reason: 'Nenhum membro encontrado.' }), { status: 200 });
    }

    const { data: rolePerms }  = await supabase.from('role_permissions').select('role, module, can_view');
    const { data: overrides }  = await supabase.from('user_module_overrides').select('user_id, module, can_view, expires_at');

    // ── Dados gerais — todos em paralelo
    const [
      { data: calEvents },
      { data: deadlines },
      { data: instOverdue },
      { data: instUpcoming },
      { data: reqsExigency },
      { data: reqsAnalysis },
      { data: pericias },
    ] = await Promise.all([
      // Compromissos da agenda nos próximos 7 dias
      supabase.from('calendar_events')
        .select('id, title, event_type, start_at, status, client_id')
        .eq('status', 'pendente')
        .gte('start_at', now.toISOString())
        .lte('start_at', next7)
        .order('start_at'),

      // Prazos vencendo em 7 dias
      supabase.from('deadlines')
        .select('id, title, due_date, client_id')
        .eq('status', 'pendente')
        .gte('due_date', now.toISOString())
        .lte('due_date', next7)
        .order('due_date'),

      // Parcelas vencidas (honorários)
      supabase.from('installments')
        .select('id, value, due_date, status, agreement_id, agreements(title, client_id)')
        .eq('status', 'vencido')
        .order('due_date'),

      // Parcelas a vencer em 30 dias (honorários)
      supabase.from('installments')
        .select('id, value, due_date, status, agreement_id, agreements(title, client_id)')
        .eq('status', 'pendente')
        .gte('due_date', now.toISOString().slice(0, 10))
        .lte('due_date', next30.slice(0, 10))
        .order('due_date'),

      // Requerimentos em exigência (urgente)
      supabase.from('requirements')
        .select('id, protocol, beneficiary, benefit_type, status, exigency_due_date, client_id')
        .eq('status', 'em_exigencia')
        .order('exigency_due_date', { ascending: true, nullsFirst: false }),

      // Requerimentos em análise
      supabase.from('requirements')
        .select('id, protocol, beneficiary, benefit_type, status, analysis_started_at, client_id')
        .eq('status', 'em_analise')
        .order('analysis_started_at', { ascending: false })
        .limit(8),

      // Perícias agendadas nos próximos 14 dias
      supabase.from('requirements')
        .select('id, beneficiary, benefit_type, pericia_medica_at, pericia_social_at, client_id')
        .or(`pericia_medica_at.gte.${now.toISOString()},pericia_social_at.gte.${now.toISOString()}`)
        .limit(20),
    ]);

    // ── Lookup de nomes de clientes (batch único)
    const allIds = new Set<string>();
    (calEvents    ?? []).forEach((e: any) => e.client_id  && allIds.add(e.client_id));
    (deadlines    ?? []).forEach((d: any) => d.client_id  && allIds.add(d.client_id));
    (instOverdue  ?? []).forEach((i: any) => i.agreements?.client_id && allIds.add(i.agreements.client_id));
    (instUpcoming ?? []).forEach((i: any) => i.agreements?.client_id && allIds.add(i.agreements.client_id));
    (reqsExigency ?? []).forEach((r: any) => r.client_id  && allIds.add(r.client_id));
    (reqsAnalysis ?? []).forEach((r: any) => r.client_id  && allIds.add(r.client_id));
    (pericias     ?? []).forEach((r: any) => r.client_id  && allIds.add(r.client_id));

    let clientMap: Record<string, string> = {};
    if (allIds.size > 0) {
      const { data: cd } = await supabase
        .from('clients')
        .select('id, full_name')
        .in('id', [...allIds]);
      clientMap = Object.fromEntries((cd ?? []).map((c: any) => [c.id, c.full_name]));
    }
    const cn = (id: string | null | undefined): string | undefined =>
      id ? clientMap[id] ?? undefined : undefined;

    // Totais financeiros
    const overdueTotal  = (instOverdue  ?? []).reduce((s: number, i: any) => s + Number(i.value ?? 0), 0);
    const upcomingTotal = (instUpcoming ?? []).reduce((s: number, i: any) => s + Number(i.value ?? 0), 0);

    const EVENT_LABEL: Record<string, string> = {
      hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião',
      deadline: 'Prazo', requirement: 'Requerimento', payment: 'Pagamento',
      appointment: 'Compromisso', other: 'Evento',
    };

    const sent: string[]   = [];
    const errors: string[] = [];

    for (const profile of profiles) {
      if (!profile.email) continue;

      const can = makeChecker(rolePerms ?? [], overrides ?? [], profile, now);
      const sections: Section[] = [];
      const introParts: string[] = [];

      // ─ AGENDA (exclui deadline e payment — já aparecem nos módulos próprios)
      if (can('agenda') && (calEvents ?? []).length > 0) {
        const agendaEvents = (calEvents ?? []).filter((e: any) =>
          e.event_type !== 'deadline' && e.event_type !== 'payment'
        );
        const rows: Row[] = agendaEvents.map((e: any) => {
          const time = fmtTime(e.start_at);
          const tipo = e.title || EVENT_LABEL[e.event_type] || 'Evento';
          const cliente = cn(e.client_id);
          return {
            main: tipo,
            sub:  cliente ?? undefined,
            meta: `${weekday(e.start_at)} · ${fmtDate(e.start_at)}${time ? ' · ' + time : ''}`,
          };
        });
        if (rows.length > 0) {
          sections.push({
            eyebrow: 'Agenda',
            title:   'Compromissos da semana',
            meta:    `${rows.length} ${rows.length === 1 ? 'item' : 'itens'}`,
            blocks:  [{ kind: 'list', rows }],
          });
          introParts.push(`<strong>${rows.length}</strong> ${rows.length === 1 ? 'compromisso' : 'compromissos'}`);
        }
      }

      // ─ PRAZOS
      if (can('prazos') && (deadlines ?? []).length > 0) {
        const rows: Row[] = (deadlines ?? []).map((d: any) => {
          const dl     = daysUntil(d.due_date, now);
          const urgent = dl <= 2;
          const cliente = cn(d.client_id);
          return {
            main:   d.title || 'Prazo',
            sub:    cliente ?? undefined,
            meta:   `${fmtDate(d.due_date)} · ${dl === 0 ? 'hoje' : dl === 1 ? 'amanhã' : dl + ' dias'}`,
            accent: urgent,
          };
        });
        sections.push({
          eyebrow: 'Prazos',
          title:   'A vencer em 7 dias',
          meta:    `${(deadlines ?? []).length} ${(deadlines ?? []).length === 1 ? 'prazo' : 'prazos'}`,
          blocks:  [{ kind: 'list', rows }],
        });
        introParts.push(`<strong>${(deadlines ?? []).length}</strong> ${(deadlines ?? []).length === 1 ? 'prazo' : 'prazos'}`);
      }

      // ─ HONORÁRIOS
      if (can('financeiro')) {
        const overdueCount  = (instOverdue  ?? []).length;
        const upcomingCount = (instUpcoming ?? []).length;

        if (overdueCount + upcomingCount > 0) {
          const blocks: Block[] = [];

          blocks.push({
            kind: 'stat',
            items: [
              { label: 'A receber 30d', value: fmtShort(upcomingTotal), sub: `${upcomingCount} ${upcomingCount === 1 ? 'parcela' : 'parcelas'}` },
              ...(overdueCount > 0 ? [{ label: 'Vencidas', value: fmtShort(overdueTotal), sub: `${overdueCount} ${overdueCount === 1 ? 'parcela' : 'parcelas'}` }] : []),
            ],
          });

          if (overdueCount > 0) {
            const rows: Row[] = (instOverdue ?? []).slice(0, 5).map((i: any) => ({
              main:   cn(i.agreements?.client_id) ?? i.agreements?.title ?? 'Acordo',
              meta:   `${fmtDate(i.due_date)} · ${fmtCurrency(Number(i.value ?? 0))}`,
              accent: true,
            }));
            blocks.push({ kind: 'list', rows });
          }

          if (upcomingCount > 0) {
            const rows: Row[] = (instUpcoming ?? []).slice(0, 6).map((i: any) => ({
              main: cn(i.agreements?.client_id) ?? i.agreements?.title ?? 'Acordo',
              meta: `${fmtDate(i.due_date)} · ${fmtCurrency(Number(i.value ?? 0))}`,
            }));
            blocks.push({ kind: 'list', rows });
          }

          sections.push({
            eyebrow: 'Honorários',
            title:   overdueCount > 0 ? 'Parcelas vencidas e a vencer' : 'Parcelas a vencer',
            meta:    `${overdueCount + upcomingCount} no total`,
            blocks,
          });
          introParts.push(`<strong>${fmtShort(upcomingTotal)}</strong> a receber`);
        }
      }

      // ─ REQUERIMENTOS
      if (can('requerimentos')) {
        const exig = reqsExigency ?? [];
        const anal = reqsAnalysis ?? [];
        const per  = (pericias ?? []).filter((p: any) =>
          (p.pericia_medica_at && new Date(p.pericia_medica_at) >= now && new Date(p.pericia_medica_at) <= new Date(next14)) ||
          (p.pericia_social_at && new Date(p.pericia_social_at) >= now && new Date(p.pericia_social_at) <= new Date(next14))
        );

        if (exig.length || anal.length || per.length) {
          const blocks: Block[] = [];

          blocks.push({
            kind: 'stat',
            items: [
              { label: 'Em exigência', value: String(exig.length), sub: 'requer ação' },
              { label: 'Em análise',   value: String(anal.length), sub: 'aguardando INSS' },
              ...(per.length ? [{ label: 'Perícias', value: String(per.length), sub: 'próx. 14 dias' }] : []),
            ],
          });

          if (exig.length) {
            const rows: Row[] = exig.slice(0, 6).map((r: any) => {
              const days = r.exigency_due_date ? daysUntil(r.exigency_due_date, now) : null;
              const tipo = fmtBenefit(r.benefit_type);
              const prazoLabel = days !== null
                ? `Prazo: ${fmtDate(r.exigency_due_date)}${days >= 0 ? ' · ' + days + 'd' : ' · VENCIDO'}`
                : 'sem prazo definido';
              return {
                main:      r.beneficiary || 'Beneficiário',
                sub:       tipo || undefined,
                meta:      prazoLabel,
                highlight: true,
              };
            });
            blocks.push({ kind: 'list', rows });
          }

          if (anal.length) {
            const rows: Row[] = anal.slice(0, 5).map((r: any) => {
              const tipo = fmtBenefit(r.benefit_type);
              return {
                main: r.beneficiary || 'Beneficiário',
                sub:  tipo || undefined,
                meta: r.analysis_started_at ? `desde ${fmtDate(r.analysis_started_at)}` : undefined,
              };
            });
            blocks.push({ kind: 'list', rows });
          }

          sections.push({
            eyebrow: 'Requerimentos',
            title:   'Status atual',
            meta:    `${exig.length + anal.length} em aberto`,
            blocks,
          });
          if (exig.length) introParts.push(`<strong>${exig.length}</strong> em exigência`);
        }
      }

      if (sections.length === 0) continue;

      // Monta intro narrativa
      const intro = introParts.length
        ? `Esta semana você tem ${introParts.slice(0, -1).join(', ')}${introParts.length > 1 ? ' e ' : ''}${introParts[introParts.length - 1]}. Aqui está o que merece sua atenção.`
        : 'Aqui está o resumo da sua semana.';

      const userFirstName = firstName(profile.name || '');
      let emailHtml: string;
      let emailSubject: string;

      if (customTpl) {
        const vars: Record<string, string> = {
          nome:            userFirstName,
          escritorio_nome: officeName,
          semana:          week.label,
          intro,
        };
        emailHtml    = applyTemplateVars(customTpl.bodyHtml, vars);
        emailSubject = customTpl.subject
          ? applyTemplateVars(customTpl.subject, vars)
          : `Resumo da semana · ${week.label}`;
      } else {
        emailHtml    = buildHtml({ userFirstName, officeName, weekLabel: week.label, intro, sections });
        emailSubject = `Resumo da semana · ${week.label}`;
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    senderFrom,
          to:      [profile.email],
          subject: emailSubject,
          html:    emailHtml,
        }),
      });

      if (res.ok) {
        sent.push(profile.email);
      } else {
        const err = await res.text();
        errors.push(`${profile.email}: ${err}`);
        console.error(`Erro ao enviar para ${profile.email}:`, err);
      }
    }

    if (logId) {
      await supabase.from('cron_job_logs').update({ status: 'success', finished_at: new Date().toISOString(), result: { sent: sent.length, errors: errors.length } }).eq('id', logId);
    }

    return new Response(
      JSON.stringify({ ok: true, sent: sent.length, sent_to: sent, errors }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    console.error('weekly-digest fatal error:', err);
    if (logId) {
      await supabase.from('cron_job_logs').update({ status: 'failed', finished_at: new Date().toISOString(), error: err.message }).eq('id', logId);
    }
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
