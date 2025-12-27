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
  // - se metadata.dedupe_key existir: dedupe permanente por (user_id,type,requirement_id?,deadline_id?,appointment_id?,process_id?,intimation_id?,dedupe_key)
  // - caso contrário: dedupe por 24h (como era antes)
  const dedupeKey = payload.metadata?.dedupe_key;
  let existingQuery = supabase
    .from("user_notifications")
    .select("id")
    .eq("user_id", payload.user_id)
    .eq("type", payload.type)
    .eq("deadline_id", payload.deadline_id || null)
    .eq("appointment_id", payload.appointment_id || null)
    .eq("process_id", payload.process_id || null)
    .eq("intimation_id", payload.intimation_id || null)
    .eq("requirement_id", payload.requirement_id || null)
    .limit(1);

  if (dedupeKey) {
    existingQuery = existingQuery.filter('metadata->>dedupe_key', 'eq', String(dedupeKey));
  } else {
    existingQuery = existingQuery.gte(
      "created_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    );
  }

  const { data: existing } = await existingQuery;

  if (existing && existing.length > 0) {
    console.log(`⏭️ Notificação duplicada ignorada: ${payload.title}`);
    return null;
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
    .select("id, title, due_date, status, priority, notify_days_before, process_id, requirement_id, clients(full_name)")
    .eq("status", "pendente")
    .gte("due_date", now.toISOString())
    .lte("due_date", windowEnd.toISOString());

  if (error) {
    console.error("Erro ao buscar prazos:", error);
    return;
  }

  console.log(`📋 ${deadlines?.length || 0} prazos encontrados`);

  // Buscar todos os usuários para notificar
  const { data: users } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("is_active", true);

  if (!users || users.length === 0) return;

  for (const deadline of deadlines || []) {
    const dueDate = new Date(deadline.due_date);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const notifyDaysBeforeRaw = deadline.notify_days_before;
    const notifyDaysBefore =
      typeof notifyDaysBeforeRaw === 'number'
        ? notifyDaysBeforeRaw
        : Number.isFinite(Number(notifyDaysBeforeRaw))
          ? Number(notifyDaysBeforeRaw)
          : 2;

    if (daysUntilDue < 0) continue;
    if (daysUntilDue > notifyDaysBefore) continue;

    const title =
      daysUntilDue <= 0
        ? "🚨 Prazo Vence HOJE!"
        : daysUntilDue === 1
          ? "🚨 Prazo Vence AMANHÃ!"
          : `⚠️ Prazo vence em ${daysUntilDue} dias`;

    const clientName = deadline.clients?.full_name || "";
    const message = `${deadline.title}${clientName ? ` • ${clientName}` : ""} • Vence ${dueDate.toLocaleDateString("pt-BR")}`;
    const dedupeKey = `deadline_reminder_${deadline.id}_${daysUntilDue}`;

    for (const user of users) {
      await createNotification({
        user_id: user.user_id,
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
    .select("id, title, event_type, start_at, status, notify_minutes_before, process_id, requirement_id, clients(full_name)")
    .eq("status", "pendente")
    .gte("start_at", now.toISOString())
    .lte("start_at", windowEnd.toISOString());

  if (error) {
    console.error("Erro ao buscar compromissos:", error);
    return;
  }

  console.log(`📋 ${appointments?.length || 0} compromissos encontrados`);

  const { data: users } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("is_active", true);

  if (!users || users.length === 0) return;

  for (const appointment of appointments || []) {
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

    for (const user of users) {
      await createNotification({
        user_id: user.user_id,
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

  const { data: users } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("is_active", true);

  if (!users || users.length === 0) return;

  for (const analysis of analyses || []) {
    const intimation = analysis.djen_comunicacoes;
    if (!intimation) continue;

    const prazoInfo = analysis.deadline_days
      ? `Prazo: ${analysis.deadline_days} dia(s)`
      : "Prazo não identificado";

    const title = "⚠️ Intimação Urgente";
    const message = `${prazoInfo} • Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`;

    for (const user of users) {
      await createNotification({
        user_id: user.user_id,
        title,
        message,
        type: "intimation_new",
        intimation_id: intimation.id,
        metadata: {
          urgency: analysis.urgency,
          deadline_days: analysis.deadline_days,
          tribunal: intimation.sigla_tribunal,
        },
      });
    }
  }
}

async function checkRequirementAlerts() {
  console.log("📌 Verificando alertas de requerimentos (MS / tempo em análise)...");

  const { data: users } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("is_active", true);

  if (!users || users.length === 0) return;

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

    for (const user of users) {
      await createNotification({
        user_id: user.user_id,
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

async function checkPendingSignatures() {
  console.log("✍️ Verificando assinaturas pendentes...");

  // Buscar signatários pendentes há mais de 1 dia
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const { data: pendingSigners, error } = await supabase
    .from("signature_signers")
    .select("*, signature_requests(document_name, created_by)")
    .eq("status", "pending")
    .lte("created_at", oneDayAgo.toISOString());

  if (error) {
    console.error("Erro ao buscar assinaturas pendentes:", error);
    return;
  }

  console.log(`📋 ${pendingSigners?.length || 0} assinaturas pendentes encontradas`);

  for (const signer of pendingSigners || []) {
    const request = signer.signature_requests;
    if (!request || !request.created_by) continue;

    const title = "⏳ Assinatura Pendente";
    const message = `${signer.name} ainda não assinou "${request.document_name}"`;

    await createNotification({
      user_id: request.created_by,
      title,
      message,
      type: "process_updated",
      metadata: {
        signer_name: signer.name,
        signer_email: signer.email,
        document_name: request.document_name,
        pending_since: signer.created_at,
      },
    });
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
