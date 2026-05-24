/**
 * weekly-digest — Supabase Edge Function
 *
 * Envia resumo semanal personalizado para cada membro da equipe.
 * Respeita permissões por cargo (role_permissions) e overrides individuais
 * (user_module_overrides). Envia via Resend API.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Chave Resend pode vir do .env ou do banco (admin settings)
const RESEND_KEY_ENV       = Deno.env.get('RESEND_API_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────────

const ptBR = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', opts);
};

const fmtCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtTime = (d: string | null | undefined) => {
  if (!d) return '';
  const dt = new Date(d);
  if (dt.getHours() === 0 && dt.getMinutes() === 0) return '';
  return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const weekdayShort = (d: string) =>
  new Date(d).toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')
    .toUpperCase();

const weekRange = () => {
  const now = new Date();
  const dom = new Date(now);
  dom.setDate(now.getDate() - now.getDay());
  const sab = new Date(dom);
  sab.setDate(dom.getDate() + 6);
  const next7 = new Date(now.getTime() + 7 * 86_400_000);
  return {
    start: now.toISOString(),
    end:   next7.toISOString(),
    label: `${ptBR(dom.toISOString(), { day: '2-digit', month: 'short' })} – ${ptBR(sab.toISOString(), { day: '2-digit', month: 'short', year: 'numeric' })}`,
  };
};

const normalizeRole = (role: string) =>
  (role ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Template HTML ─────────────────────────────────────────────────────────────

type Section = {
  emoji: string;
  title: string;
  items: Array<{ left: string; right?: string; tag?: string; tagColor?: string }>;
  empty: string;
};

function buildHtml(opts: {
  userName: string;
  officeName: string;
  weekLabel: string;
  sections: Section[];
}): string {
  const { userName, officeName, weekLabel, sections } = opts;

  // ── cada seção
  const renderSection = (sec: Section) => {
    const bodyRows = sec.items.length === 0
      ? `<tr>
           <td colspan="2" style="padding:18px 20px;font-size:13px;color:#94a3b8;font-style:italic;text-align:center;">
             ${sec.empty}
           </td>
         </tr>`
      : sec.items.map((item, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#fafafa';
          const tag = item.tag
            ? `<span style="
                display:inline-block;
                padding:2px 8px;
                border-radius:999px;
                font-size:10px;
                font-weight:700;
                letter-spacing:.04em;
                background:${item.tagColor ?? '#f1f5f9'};
                color:${item.tagColor ? '#fff' : '#64748b'};
                white-space:nowrap;
              ">${item.tag}</span>`
            : '';
          return `<tr style="background:${bg};">
            <td style="padding:12px 20px;font-size:13px;color:#334155;line-height:1.55;border-bottom:1px solid #f1f5f9;">
              ${item.left}${tag ? '&nbsp;&nbsp;' + tag : ''}
            </td>
            ${item.right ? `<td style="padding:12px 20px 12px 0;font-size:12px;color:#64748b;white-space:nowrap;text-align:right;border-bottom:1px solid #f1f5f9;">${item.right}</td>` : '<td></td>'}
          </tr>`;
        }).join('');

    return `
    <!-- SEÇÃO: ${sec.title} -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin-bottom:28px;border-radius:14px;overflow:hidden;
             border:1px solid #e2e8f0;border-collapse:separate;
             box-shadow:0 1px 4px rgba(0,0,0,.05);">
      <!-- Cabeçalho da seção -->
      <tr style="background:linear-gradient(90deg,#fff7ed 0%,#ffffff 100%);">
        <td colspan="2" style="padding:13px 20px;border-bottom:1px solid #fed7aa;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:18px;padding-right:10px;line-height:1;">${sec.emoji}</td>
              <td style="font-size:12px;font-weight:800;color:#9a3412;letter-spacing:.08em;text-transform:uppercase;">${sec.title}</td>
            </tr>
          </table>
        </td>
      </tr>
      ${bodyRows}
    </table>`;
  };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Resumo Semanal — ${officeName}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;-webkit-font-smoothing:antialiased;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="min-height:100vh;">
    <tr>
      <td align="center" style="padding:36px 16px 48px;">

        <!-- ══ Wrapper 600px ══ -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="max-width:600px;width:100%;">

          <!-- ══ PRÉ-HEADER (visível em clientes de email) -->
          <tr>
            <td style="font-size:0;max-height:0;overflow:hidden;mso-hide:all;">
              Resumo semanal do escritório ${officeName} — semana de ${weekLabel}
            </td>
          </tr>

          <!-- ══ HEADER CARD ══ -->
          <tr>
            <td style="border-radius:20px 20px 0 0;overflow:hidden;
                       background:linear-gradient(135deg,#ea580c 0%,#f97316 45%,#f59e0b 100%);
                       padding:0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">

                <!-- Linha decorativa topo -->
                <tr>
                  <td height="4" style="background:rgba(255,255,255,.25);font-size:0;line-height:0;">&nbsp;</td>
                </tr>

                <tr>
                  <td style="padding:32px 36px 28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td>
                          <!-- Logo / nome -->
                          <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                            <tr>
                              <td style="
                                width:42px;height:42px;
                                background:rgba(255,255,255,.2);
                                border-radius:12px;
                                text-align:center;vertical-align:middle;
                                font-size:22px;
                              ">⚖️</td>
                              <td style="padding-left:12px;">
                                <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:.12em;text-transform:uppercase;">Jurius CRM</div>
                                <div style="font-size:17px;font-weight:800;color:#ffffff;letter-spacing:-.01em;">${officeName}</div>
                              </td>
                            </tr>
                          </table>

                          <!-- Título resumo -->
                          <div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:-.02em;line-height:1.1;margin-bottom:8px;">
                            Resumo Semanal
                          </div>
                          <div style="font-size:13px;color:rgba(255,255,255,.85);font-weight:500;">
                            📆&nbsp;&nbsp;${weekLabel}
                          </div>
                        </td>

                        <!-- Decoração direita -->
                        <td align="right" valign="top" style="padding-left:20px;">
                          <div style="
                            width:80px;height:80px;
                            border-radius:50%;
                            background:rgba(255,255,255,.12);
                            display:inline-block;
                            text-align:center;line-height:80px;
                            font-size:36px;
                          ">📋</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Saudação pessoal -->
                <tr>
                  <td style="
                    background:rgba(0,0,0,.12);
                    padding:14px 36px;
                    font-size:14px;
                    color:rgba(255,255,255,.9);
                    border-top:1px solid rgba(255,255,255,.15);
                  ">
                    Olá, <strong style="color:#fff;">${userName}</strong> 👋 — aqui está o que merece sua atenção esta semana.
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- ══ BODY CARD ══ -->
          <tr>
            <td style="background:#ffffff;padding:32px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              ${sections.map(renderSection).join('\n')}
            </td>
          </tr>

          <!-- ══ FOOTER ══ -->
          <tr>
            <td style="
              background:#1e293b;
              border-radius:0 0 20px 20px;
              padding:24px 36px;
              overflow:hidden;
            ">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size:12px;color:#94a3b8;line-height:1.6;">
                      Você recebeu este email por fazer parte da equipe <strong style="color:#cbd5e1;">${officeName}</strong>.<br/>
                      Somente informações que você tem permissão de visualizar foram incluídas.
                    </div>
                    <div style="margin-top:10px;font-size:11px;color:#475569;">
                      Enviado automaticamente pelo <strong style="color:#f97316;">Jurius CRM</strong> &nbsp;·&nbsp; ${weekLabel}
                    </div>
                  </td>
                  <td align="right" valign="bottom" style="padding-left:20px;">
                    <div style="
                      font-size:10px;font-weight:800;
                      letter-spacing:.12em;text-transform:uppercase;
                      color:#f97316;
                    ">JURIUS</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Wrapper -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ── Permissões ────────────────────────────────────────────────────────────────

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

    // Override individual vigente
    const ov = overrides.find(
      (o) => o.user_id === profile.user_id && o.module === module,
    );
    if (ov?.can_view) {
      if (!ov.expires_at || new Date(ov.expires_at) > now) return true;
    }

    // Permissão do cargo
    const perm = rolePermissions.find(
      (p) => p.role === normalized && p.module === module,
    );
    return perm?.can_view === true;
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async () => {
  try {
    const now  = new Date();
    const week = weekRange();

    // ── 1. Configurações do sistema
    const { data: settingRow } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'notification_config')
      .single();

    const config        = settingRow?.value ?? {};
    const resendKey: string = config.weekly_digest_resend_key || RESEND_KEY_ENV;

    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: 'Resend API key não configurada.' }),
        { status: 400 },
      );
    }

    // ── 2. Nome do escritório
    const { data: officeRow } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'office_identity')
      .single();
    const officeName: string = officeRow?.value?.name ?? 'Escritório';

    // ── 3. Membros ativos
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, name, role, email')
      .not('email', 'is', null);

    if (!profiles?.length) {
      return new Response(JSON.stringify({ sent: 0, reason: 'Nenhum membro com email.' }), { status: 200 });
    }

    // ── 4. Permissões globais
    const { data: rolePerms   } = await supabase.from('role_permissions').select('role, module, can_view');
    const { data: userOverrides } = await supabase.from('user_module_overrides').select('user_id, module, can_view, expires_at');

    // ── 5. Dados da semana (buscados uma vez para todos)
    const [
      { data: deadlines     },
      { data: calEvents     },
      { data: installments  },
      { data: requirements  },
      { data: processes     },
    ] = await Promise.all([
      // Prazos que vencem nos próximos 7 dias
      supabase.from('deadlines')
        .select('id, title, due_date, status')
        .eq('status', 'pendente')
        .gte('due_date', now.toISOString())
        .lte('due_date', week.end)
        .order('due_date'),

      // Compromissos dos próximos 7 dias
      supabase.from('calendar_events')
        .select('id, title, event_type, start_at, status')
        .eq('status', 'pendente')
        .gte('start_at', now.toISOString())
        .lte('start_at', week.end)
        .order('start_at'),

      // Parcelas pendentes (financeiro)
      supabase.from('payment_installments')
        .select('id, value, due_date, status')
        .eq('status', 'pendente')
        .order('due_date')
        .limit(10),

      // Requerimentos em aberto
      supabase.from('requirements')
        .select('id, title, status, created_at')
        .in('status', ['pendente', 'em_andamento'])
        .order('created_at', { ascending: false })
        .limit(8),

      // Processos ativos
      supabase.from('processes')
        .select('id, number, client_name, status, hearing_date')
        .eq('status', 'ativo')
        .order('created_at', { ascending: false })
        .limit(8),
    ]);

    const sent:   string[] = [];
    const errors: string[] = [];

    const EVENT_LABEL: Record<string, string> = {
      hearing:     'Audiência',
      pericia:     'Perícia',
      meeting:     'Reunião',
      deadline:    'Prazo',
      requirement: 'Requerimento',
      payment:     'Pagamento',
      appointment: 'Compromisso',
      other:       'Evento',
    };

    // ── 6. Para cada membro, montar e enviar email personalizado
    for (const profile of profiles) {
      if (!profile.email) continue;

      const can = makeChecker(rolePerms ?? [], userOverrides ?? [], profile, now);
      const sections: Section[] = [];

      // ─ COMPROMISSOS (agenda)
      if (can('agenda') && calEvents?.length) {
        sections.push({
          emoji: '📅',
          title: 'Compromissos desta semana',
          empty: 'Nenhum compromisso agendado para os próximos 7 dias.',
          items: calEvents.map((e: any) => {
            const time = fmtTime(e.start_at);
            const wd   = weekdayShort(e.start_at);
            const tipo = e.title || EVENT_LABEL[e.event_type] || 'Evento';
            return {
              left:  `<strong style="color:#1e293b;">${tipo}</strong>`,
              right: `<span style="font-size:11px;font-weight:700;color:#f97316;">${wd}</span>&nbsp; ${ptBR(e.start_at)}${time ? ' · ' + time : ''}`,
            };
          }),
        });
      }

      // ─ PRAZOS (prazos)
      if (can('prazos') && deadlines?.length) {
        sections.push({
          emoji: '⚖️',
          title: 'Prazos que vencem em 7 dias',
          empty: 'Nenhum prazo vencendo nos próximos 7 dias.',
          items: deadlines.map((d: any) => {
            const daysLeft = Math.ceil(
              (new Date(d.due_date).getTime() - now.getTime()) / 86_400_000,
            );
            let tag      = `${daysLeft}d`;
            let tagColor = '#64748b';
            if (daysLeft <= 1) { tag = 'HOJE/AMANHÃ'; tagColor = '#ef4444'; }
            else if (daysLeft <= 3) { tag = `${daysLeft} DIAS`; tagColor = '#f97316'; }
            else if (daysLeft <= 5) { tag = `${daysLeft} dias`;  tagColor = '#f59e0b'; }

            return {
              left:     `<strong style="color:#1e293b;">${d.title || 'Prazo'}</strong>`,
              right:    ptBR(d.due_date),
              tag,
              tagColor,
            };
          }),
        });
      }

      // ─ FINANCEIRO (financeiro)
      if (can('financeiro') && installments?.length) {
        sections.push({
          emoji: '💰',
          title: 'Parcelas pendentes',
          empty: 'Nenhuma parcela pendente no momento.',
          items: installments.map((i: any) => ({
            left:  `<span style="font-weight:700;color:#1e293b;font-size:14px;">${fmtCurrency(Number(i.value ?? 0))}</span>`,
            right: `Vence em ${ptBR(i.due_date)}`,
          })),
        });
      }

      // ─ REQUERIMENTOS (requerimentos)
      if (can('requerimentos') && requirements?.length) {
        const STATUS_COLOR: Record<string, string> = {
          pendente:     '#f97316',
          em_andamento: '#3b82f6',
        };
        sections.push({
          emoji: '📋',
          title: 'Requerimentos em andamento',
          empty: 'Nenhum requerimento pendente.',
          items: requirements.map((r: any) => ({
            left:     `<strong style="color:#1e293b;">${r.title || 'Requerimento'}</strong>`,
            right:    ptBR(r.created_at),
            tag:      r.status === 'em_andamento' ? 'Em andamento' : 'Pendente',
            tagColor: STATUS_COLOR[r.status] ?? '#64748b',
          })),
        });
      }

      // ─ PROCESSOS (processos)
      if (can('processos') && processes?.length) {
        sections.push({
          emoji: '📁',
          title: 'Processos ativos',
          empty: 'Nenhum processo ativo.',
          items: processes.map((p: any) => ({
            left:  `<strong style="color:#1e293b;">${p.number || p.id}</strong>&nbsp;<span style="color:#94a3b8;font-size:12px;">${p.client_name || ''}</span>`,
            right: p.hearing_date ? `Audiência: ${ptBR(p.hearing_date)}` : '',
          })),
        });
      }

      // Pular se não há nenhuma seção visível
      if (sections.length === 0) continue;

      const html = buildHtml({
        userName:  profile.name || 'Membro',
        officeName,
        weekLabel: week.label,
        sections,
      });

      // ── Enviar via Resend
      const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    `${officeName} <onboarding@resend.dev>`,
          to:      [profile.email],
          subject: `📋 Resumo da Semana — ${week.label} | ${officeName}`,
          html,
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

    return new Response(
      JSON.stringify({ ok: true, sent: sent.length, sent_to: sent, errors }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    console.error('weekly-digest fatal error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 },
    );
  }
});
