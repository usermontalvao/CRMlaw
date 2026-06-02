import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface NotificationPayload {
  user_id: string;
  title: string;
  message: string;
  type: string;
  deadline_id?: string;
  appointment_id?: string;
  intimation_id?: string;
  process_id?: string;
  requirement_id?: string;
  metadata?: Record<string, any>;
}

async function createNotification(payload: NotificationPayload) {
  // Deduplicação:
  // - se metadata.dedupe_key existir: dedupe PERMANENTE apenas por (user_id, type, dedupe_key)
  //   NÃO adicionar condições extras de NULL — elas causam falso-negativo e re-envio.
  // - caso contrário: dedupe por 24h usando as foreign keys presentes
  const dedupeKey = payload.metadata?.dedupe_key;

  if (dedupeKey) {
    const { data: existing } = await supabase
      .from("user_notifications")
      .select("id")
      .eq("user_id", payload.user_id)
      .eq("type", payload.type)
      .filter("metadata->>dedupe_key", "eq", String(dedupeKey))
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`⏭️ Notificação duplicada ignorada: ${payload.title}`);
      return null;
    }
  } else {
    // Sem dedupe_key: janela de 24h com as colunas de FK presentes no payload
    const applyNullableEq = (
      q: ReturnType<typeof supabase.from>,
      col: string,
      val: string | undefined
    ) => (val ? (q as any).eq(col, val) : (q as any).is(col, null));

    let existingQuery = supabase
      .from("user_notifications")
      .select("id")
      .eq("user_id", payload.user_id)
      .eq("type", payload.type)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    existingQuery = applyNullableEq(existingQuery as any, "deadline_id", payload.deadline_id);
    existingQuery = applyNullableEq(existingQuery as any, "appointment_id", payload.appointment_id);
    existingQuery = applyNullableEq(existingQuery as any, "process_id", payload.process_id);
    existingQuery = applyNullableEq(existingQuery as any, "intimation_id", payload.intimation_id);
    existingQuery = applyNullableEq(existingQuery as any, "requirement_id", payload.requirement_id);

    const { data: existing } = await (existingQuery as any).limit(1);

    if (existing && existing.length > 0) {
      console.log(`⏭️ Notificação duplicada ignorada: ${payload.title}`);
      return null;
    }
  }

  const { data, error } = await supabase
    .from("user_notifications")
    .insert({
      ...payload,
      read: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar notificação:", error);
    return null;
  }

  console.log(`✅ Notificação criada: ${payload.title}`);
  return data;
}

async function checkDeadlineReminders() {
  console.log("📅 Verificando prazos para lembrete...");

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 180);

  const { data: deadlines, error } = await supabase
    .from("deadlines")
    .select("id, title, due_date, status, priority, notify_days_before, process_id, requirement_id, responsible_id, clients(full_name)")
    .eq("status", "pendente")
    .gte("due_date", now.toISOString())
    .lte("due_date", windowEnd.toISOString());

  if (error) {
    console.error("Erro ao buscar prazos:", error);
    return;
  }

  console.log(`📋 ${deadlines?.length || 0} prazos encontrados`);

  // Buscar mapa profile.id → user_id para resolver o responsável
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, user_id")
    .eq("is_active", true);

  const profileToUserId = new Map<string, string>();
  for (const p of profiles || []) {
    if (p.id && p.user_id) profileToUserId.set(p.id, p.user_id);
  }

  for (const deadline of deadlines || []) {
    const dueDate = new Date(deadline.due_date);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const notifyDaysBeforeRaw = deadline.notify_days_before;
    const notifyDaysBefore =
      typeof notifyDaysBeforeRaw === 'number'
        ? notifyDaysBeforeRaw
        : Number.isFinite(Number(notifyDaysBeforeRaw))
          ? Number(notifyDaysBeforeRaw)
          : null;

    if (daysUntilDue < 0) continue;
    if (notifyDaysBefore === null || notifyDaysBefore < 0) continue;
    if (daysUntilDue > notifyDaysBefore) continue;

    // Notificar apenas o responsável; sem responsável → pula
    if (!deadline.responsible_id) continue;
    const responsibleUserId = profileToUserId.get(deadline.responsible_id);
    if (!responsibleUserId) continue;

    const title =
      daysUntilDue === 0
        ? "🚨 Prazo Vence HOJE!"
        : daysUntilDue === 1
          ? "🚨 Prazo Vence AMANHÃ!"
          : `⚠️ Prazo vence em ${daysUntilDue} dias`;

    const clientName = deadline.clients?.full_name || "";
    const message = `${deadline.title}${clientName ? ` • ${clientName}` : ""} • Vence ${dueDate.toLocaleDateString("pt-BR")}`;
    const dedupeKey = `deadline_reminder_${deadline.id}_${daysUntilDue}`;

    await createNotification({
      user_id: responsibleUserId,
      title,
      message,
      type: "deadline_reminder",
      deadline_id: deadline.id,
      process_id: deadline.process_id ?? undefined,
      requirement_id: deadline.requirement_id ?? undefined,
      metadata: {
        days_until_due: daysUntilDue,
        notify_days_before: notifyDaysBefore,
        priority: deadline.priority,
        dedupe_key: dedupeKey,
      },
    });

    // 📧 Email lembrete ao responsável (1 por prazo por janela, deduplicado)
    const emailDedupeKey = `email_deadline_reminder_${deadline.id}_${daysUntilDue}`;
    const { data: alreadySent } = await supabase
      .from("user_notifications")
      .select("id")
      .eq("type", "deadline_email_reminder")
      .eq("deadline_id", deadline.id)
      .filter("metadata->>dedupe_key", "eq", emailDedupeKey)
      .limit(1);

    if (!alreadySent || alreadySent.length === 0) {
      try {
        const fnUrl = `${supabaseUrl}/functions/v1/notify-deadline-assigned`;
        const resp = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ deadline_id: deadline.id, assigned_by_id: null, mode: "reminder" }),
        });
        const result = await resp.json();
        if (result.success) {
          console.log(`📧 Email lembrete enviado: ${deadline.title}`);
          await supabase.from("user_notifications").insert({
            user_id: responsibleUserId,
            title: `📧 Email lembrete enviado`,
            message: `${deadline.title} - ${daysUntilDue} dia(s)`,
            type: "deadline_email_reminder",
            deadline_id: deadline.id,
            read: true,
            metadata: { dedupe_key: emailDedupeKey, days_until_due: daysUntilDue },
            created_at: new Date().toISOString(),
          });
        } else {
          console.error(`❌ Falha email lembrete: ${result.error}`);
        }
      } catch (emailErr: any) {
        console.error(`❌ Erro ao enviar email lembrete: ${emailErr?.message}`);
      }
    }
  }
}

async function checkAppointmentReminders() {
  console.log("📅 Verificando compromissos para lembrete...");

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setHours(windowEnd.getHours() + 24);

  const { data: appointments, error } = await supabase
    .from("calendar_events")
    .select("id, title, event_type, start_at, status, notify_minutes_before, user_id, process_id, requirement_id, clients(full_name)")
    .eq("status", "pendente")
    .gte("start_at", now.toISOString())
    .lte("start_at", windowEnd.toISOString());

  if (error) {
    console.error("Erro ao buscar compromissos:", error);
    return;
  }

  console.log(`📋 ${appointments?.length || 0} compromissos encontrados`);

  for (const appointment of appointments || []) {
    // Notificar apenas o dono do compromisso; sem user_id → pula
    if (!appointment.user_id) continue;

    const startAt = new Date(appointment.start_at);
    const minutesUntilStart = Math.ceil((startAt.getTime() - now.getTime()) / 60000);
    const notifyMinutesBeforeRaw = appointment.notify_minutes_before;
    const notifyMinutesBefore =
      typeof notifyMinutesBeforeRaw === 'number'
        ? notifyMinutesBeforeRaw
        : Number.isFinite(Number(notifyMinutesBeforeRaw))
          ? Number(notifyMinutesBeforeRaw)
          : 24 * 60;

    if (minutesUntilStart < 0) continue;
    if (minutesUntilStart > notifyMinutesBefore) continue;

    const formattedDate = startAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const formattedTime = startAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const clientName = appointment.clients?.full_name || "";

    const title = minutesUntilStart <= 60 ? '⏰ Compromisso em breve' : '📅 Lembrete de compromisso';
    const message = `${appointment.title} • ${formattedDate} ${formattedTime}${clientName ? ` • ${clientName}` : ""}`;
    const dedupeKey = `appointment_reminder_${appointment.id}_${notifyMinutesBefore}`;

    await createNotification({
      user_id: appointment.user_id,
      title,
      message,
      type: "appointment_reminder",
      appointment_id: appointment.id,
      process_id: appointment.process_id ?? undefined,
      requirement_id: appointment.requirement_id ?? undefined,
      metadata: {
        start_at: appointment.start_at,
        event_type: appointment.event_type,
        notify_minutes_before: notifyMinutesBefore,
        minutes_until_start: minutesUntilStart,
        dedupe_key: dedupeKey,
      },
    });
  }
}

async function checkUrgentIntimations() {
  console.log("📄 Verificando intimações urgentes...");

  // Buscar intimações não lidas com análise de urgência alta
  const { data: analyses, error } = await supabase
    .from("intimation_ai_analysis")
    .select("*, djen_comunicacoes(*)")
    .eq("urgency", "alta")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("Erro ao buscar análises:", error);
    return;
  }

  console.log(`📋 ${analyses?.length || 0} intimações urgentes encontradas`);

  // Apenas usuários com acesso ao módulo intimacoes (respeita role_permissions + overrides)
  const userIds = await getUsersWithModuleAccess("intimacoes");
  if (userIds.length === 0) return;

  for (const analysis of analyses || []) {
    const intimation = analysis.djen_comunicacoes;
    if (!intimation) continue;

    const prazoInfo = analysis.deadline_days
      ? `Prazo: ${analysis.deadline_days} dia(s)`
      : "Prazo não identificado";

    const title = "⚠️ Intimação Urgente";
    const message = `${prazoInfo} • Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`;

    for (const userId of userIds) {
      await createNotification({
        user_id: userId,
        title,
        message,
        type: "intimation_new",
        intimation_id: intimation.id,
        metadata: {
          urgency: analysis.urgency,
          deadline_days: analysis.deadline_days,
          tribunal: intimation.sigla_tribunal,
          dedupe_key: `urgent_intimation_${intimation.id}`,
        },
      });
    }
  }
}

async function checkRequirementAlerts() {
  console.log("📌 Verificando alertas de requerimentos (MS / tempo em análise)...");

  // Apenas usuários com acesso ao módulo requerimentos (respeita role_permissions + overrides)
  const userIds = await getUsersWithModuleAccess("requerimentos");
  if (userIds.length === 0) return;

  const { data: requirements, error } = await supabase
    .from("requirements")
    .select("id, protocol, beneficiary, status, analysis_started_at, entry_date, created_at")
    .eq("status", "em_analise")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Erro ao buscar requerimentos:", error);
    return;
  }

  const now = Date.now();
  const milestones = [60, 90, 120];

  for (const req of requirements || []) {
    const base = req.analysis_started_at || req.entry_date || req.created_at;
    const baseTime = base ? new Date(base).getTime() : NaN;
    if (Number.isNaN(baseTime)) continue;

    const analysisDays = Math.floor((now - baseTime) / (1000 * 60 * 60 * 24));
    const hit = milestones.filter((m) => analysisDays >= m);
    if (hit.length === 0) continue;

    // Dispara apenas o maior marco atingido (ex: se passou de 120, só manda 120)
    const milestone = hit[hit.length - 1];

    const title =
      milestone >= 120
        ? "🚨 MS: prazo crítico (120 dias)"
        : milestone >= 90
          ? "⚠️ MS RISK: requerimento há 90+ dias"
          : "🟠 Atenção: requerimento há 60+ dias";

    const messageParts = [
      req.beneficiary ? String(req.beneficiary) : "Requerimento",
      req.protocol ? `Protocolo: ${req.protocol}` : null,
      `Em análise há ${analysisDays} dias`,
    ].filter(Boolean);

    const message = messageParts.join(" • ");
    const dedupeKey = `requirement_alert_${req.id}_${milestone}`;

    for (const userId of userIds) {
      await createNotification({
        user_id: userId,
        title,
        message,
        type: "requirement_alert",
        requirement_id: req.id,
        metadata: {
          urgency: milestone >= 120 ? "critica" : milestone >= 90 ? "alta" : "media",
          analysis_days: analysisDays,
          milestone_days: milestone,
          protocol: req.protocol,
          beneficiary: req.beneficiary,
          dedupe_key: dedupeKey,
        },
      });
    }
  }
}

// Retorna os user_ids de todos os usuários ativos com acesso (can_view) ao módulo,
// respeitando role_permissions e user_module_overrides individuais.
async function getUsersWithModuleAccess(module: string): Promise<string[]> {
  // 1. Roles que têm can_view no módulo
  const { data: rolePerms } = await supabase
    .from("role_permissions")
    .select("role")
    .eq("module", module)
    .eq("can_view", true);

  const allowedRoles = new Set((rolePerms || []).map((r: any) => r.role.toLowerCase()));

  // 2. Usuários ativos cuja role está na lista permitida
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, role")
    .eq("is_active", true);

  const now = new Date().toISOString();

  // 3. Overrides individuais não expirados
  const { data: overrides } = await supabase
    .from("user_module_overrides")
    .select("user_id, can_view")
    .eq("module", module)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  const overrideMap = new Map<string, boolean>();
  for (const o of overrides || []) overrideMap.set(o.user_id, o.can_view);

  const userIds: string[] = [];
  for (const p of profiles || []) {
    if (!p.user_id) continue;
    const roleMatch = allowedRoles.has((p.role || "").toLowerCase());
    const override = overrideMap.get(p.user_id);
    // Override tem prioridade sobre a role
    const hasAccess = override !== undefined ? override : roleMatch;
    if (hasAccess) userIds.push(p.user_id);
  }

  return userIds;
}

// Busca o client_id do portal pelo email ou CPF do signatário.
// Emails do portal seguem o padrão: public+{auth_user_id}@crm.local
async function findPortalClientId(email: string, cpf?: string | null): Promise<string | null> {
  const match = email?.match(/^public\+([0-9a-f-]{36})@crm\.local$/i);
  if (match) {
    const authUserId = match[1];
    const { data } = await supabase
      .from("client_portal_users")
      .select("client_id")
      .eq("auth_user_id", authUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.client_id) return data.client_id;
  }

  if (cpf) {
    const cpfClean = cpf.replace(/\D/g, "");
    if (cpfClean.length === 11) {
      const { data } = await supabase
        .from("client_portal_users")
        .select("client_id")
        .eq("cpf", cpfClean)
        .eq("is_active", true)
        .maybeSingle();
      if (data?.client_id) return data.client_id;
    }
  }

  return null;
}

async function createPortalNotification(payload: {
  client_id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, any>;
}) {
  const dedupeKey = payload.metadata?.dedupe_key;

  if (dedupeKey) {
    const { data: existing } = await supabase
      .from("portal_client_notifications")
      .select("id")
      .eq("client_id", payload.client_id)
      .eq("type", payload.type)
      .filter("metadata->>dedupe_key", "eq", String(dedupeKey))
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`⏭️ Notificação portal duplicada ignorada para client ${payload.client_id}`);
      return null;
    }
  }

  const { data, error } = await supabase
    .from("portal_client_notifications")
    .insert({ ...payload, is_read: false, created_at: new Date().toISOString() })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar notificação portal:", error);
    return null;
  }

  console.log(`✅ Notificação portal criada: ${payload.title} → client ${payload.client_id}`);
  return data;
}

async function checkPendingSignatures() {
  console.log("✍️ Verificando assinaturas pendentes...");

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString().split("T")[0];

  // Apenas signers de requests genuinamente abertos
  const { data: pendingSigners, error } = await supabase
    .from("signature_signers")
    .select("id, name, email, cpf, created_at, signature_requests!inner(document_name, status)")
    .eq("status", "pending")
    .eq("signature_requests.status", "pending")
    .lte("created_at", oneDayAgo);

  if (error) {
    console.error("Erro ao buscar assinaturas pendentes:", error);
    return;
  }

  const signers = pendingSigners || [];
  console.log(`📋 ${signers.length} assinaturas realmente pendentes`);

  // Carregar mapa email → user_id de todos os usuários CRM ativos (para identificar se o
  // signatário é um membro da equipe que também precisa assinar)
  const { data: crmProfiles } = await supabase
    .from("profiles")
    .select("user_id, email")
    .eq("is_active", true);

  const crmEmailToUserId = new Map<string, string>();
  for (const p of crmProfiles || []) {
    if (p.email) crmEmailToUserId.set(p.email.toLowerCase(), p.user_id);
  }

  for (const signer of signers) {
    const request = (signer as any).signature_requests;
    if (!request) continue;

    const dedupeKey = `pending_sig_${signer.id}_${today}`;
    const signerEmail = (signer.email || "").toLowerCase();

    // 1. Signatário é usuário CRM? (ex: advogado que também precisa assinar)
    //    Notifica ele diretamente no CRM para que não esqueça.
    const crmUserId = signerEmail ? crmEmailToUserId.get(signerEmail) : undefined;
    if (crmUserId) {
      await createNotification({
        user_id: crmUserId,
        title: "✍️ Você ainda não assinou um documento",
        message: `Sua assinatura está pendente em "${request.document_name}"`,
        type: "signature_pending_self",
        metadata: {
          document_name: request.document_name,
          signer_id: signer.id,
          dedupe_key: dedupeKey,
        },
      });
      continue; // usuário CRM identificado — não precisa verificar portal
    }

    // 2. Signatário é cliente com conta no portal?
    //    Lembra o cliente de que ele ainda precisa assinar.
    const portalClientId = await findPortalClientId(signer.email, signer.cpf);
    if (portalClientId) {
      await createPortalNotification({
        client_id: portalClientId,
        type: "signature_pending",
        title: "📝 Documento aguardando sua assinatura",
        message: `O documento "${request.document_name}" aguarda a sua assinatura.`,
        metadata: { document_name: request.document_name, signer_id: signer.id, dedupe_key: dedupeKey },
      });
      continue;
    }

    // 3. Signatário externo sem portal → skip.
    //    O link de assinatura já foi enviado por e-mail quando o request foi criado.
    //    Não há motivo para notificar o advogado criador — ele não pode agir.
    console.log(`⏭️ Signatário externo sem portal, pulando: ${signer.name}`);
  }
}

Deno.serve(async (req: Request) => {
  try {
    console.log("🔔 Iniciando verificação de notificações...");

    await Promise.all([
      checkDeadlineReminders(),
      checkAppointmentReminders(),
      checkUrgentIntimations(),
      checkRequirementAlerts(),
      checkPendingSignatures(),
    ]);

    console.log("✅ Verificação concluída!");

    return new Response(
      JSON.stringify({ success: true, message: "Notificações verificadas" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
