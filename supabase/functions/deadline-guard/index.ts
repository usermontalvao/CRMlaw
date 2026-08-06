import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * deadline-guard — Edge Function (Guardião de Prazos, camada 2)
 *
 * Rede de segurança diária. Varre intimações que têm PRAZO detectado pela IA
 * (intimation_ai_analysis.deadline_due_date) mas NENHUM prazo cadastrado dentro
 * da "banda de perigo": do vencimento já vencido há até 7 dias até 7 dias no
 * futuro. Notifica os usuários ativos.
 *
 * "Nenhum prazo cadastrado" tem dois níveis. O vínculo forte é
 * deadlines.intimation_id — mas ele só é gravado quando o prazo nasce pelo card
 * da intimação, e a maioria esmagadora dos prazos nasce pelo módulo de Prazos,
 * com esse campo nulo. Olhar só para ele fazia o guardião cobrar prazo de
 * intimação que JÁ tinha prazo, todo dia, até o alerta virar ruído. Por isso o
 * vínculo fraco abaixo: mesma âncora (processo ou cliente) e vencimento na
 * janela plausível. Se um humano já cadastrou prazo para aquele cliente naquela
 * janela, não há esquecimento a denunciar.
 *
 * Complementa a trava em tempo real do IntimationsModule (que só age quando o
 * operador marca como lida). Aqui cobrimos o caso do prazo que ficou esquecido
 * — exatamente a falha que originou este guardião.
 *
 * IMPORTANTE: a estimativa da IA é em DIAS CORRIDOS. O prazo processual conta em
 * dias úteis (CPC 219). Tratamos deadline_due_date apenas como gatilho de alerta;
 * a data real deve ser confirmada ao cadastrar o prazo.
 *
 * Reutiliza o tipo de notificação `intimation_new` com discriminador em metadata
 * (original_type='deadline_guard'), seguindo o padrão já usado no projeto — assim
 * o roteamento do sino (intimation_id → módulo intimações) e o estilo já funcionam
 * sem migração de enum.
 *
 * Suporta dry-run: body { "dry_run": true } retorna o que SERIA enviado sem
 * inserir nada, para validação.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Banda de perigo (em dias) relativa a hoje
const PAST_WINDOW_DAYS = 7;   // já vencido há até N dias
const FUTURE_WINDOW_DAYS = 7; // vence dentro de N dias
// Janela de deduplicação: no máx. uma notificação-guardião por (usuário,intimação)
const DEDUPE_HOURS = 20;

// Vínculo fraco — espelho de src/utils/deadlineIntimationMatch.ts, que é onde a
// regra é documentada e testada. O Deno não enxerga src/; mexeu lá, mexa aqui.
const DIA_MS = 86400000;
const DIAS_FOLGA_ESTIMATIVA = 21;

interface DeadlineRow {
  id: string;
  process_id: string | null;
  client_id: string | null;
  intimation_id: string | null;
  status: string | null;
  due_date: string;
}

/**
 * Por onde prazo e intimação se ligam — processo quando os dois lados têm (e aí
 * processos diferentes são "não" definitivo), cliente como plano B, que é a
 * maioria dos casos: o cadastro do escritório é centrado no cliente.
 */
function ancoraDoCasamento(
  prazo: DeadlineRow,
  intimation: IntimationRow,
): "processo" | "cliente" | null {
  if (prazo.process_id && intimation.process_id) {
    return prazo.process_id === intimation.process_id ? "processo" : null;
  }
  if (prazo.client_id && intimation.client_id && prazo.client_id === intimation.client_id) {
    return "cliente";
  }
  return null;
}

function prazoCasaComIntimacao(
  prazo: DeadlineRow,
  intimation: IntimationRow,
  estimativaVencimento: string,
): boolean {
  if (prazo.intimation_id && prazo.intimation_id !== intimation.id) return false;
  if (prazo.status === "cancelado") return false;
  if (!intimation.data_disponibilizacao) return false;
  if (!ancoraDoCasamento(prazo, intimation)) return false;

  const disponibilizacaoMs = new Date(intimation.data_disponibilizacao).getTime();
  const vencimentoMs = new Date(prazo.due_date).getTime();
  if ([disponibilizacaoMs, vencimentoMs].some(Number.isNaN)) return false;

  const fimMs = new Date(estimativaVencimento).getTime() + DIAS_FOLGA_ESTIMATIVA * DIA_MS;
  return vencimentoMs >= disponibilizacaoMs && vencimentoMs <= fimMs;
}

interface AnalysisRow {
  intimation_id: string;
  deadline_days: number | null;
  deadline_due_date: string;
}

interface IntimationRow {
  id: string;
  numero_processo: string | null;
  numero_processo_mascara: string | null;
  sigla_tribunal: string | null;
  process_id: string | null;
  client_id: string | null;
  data_disponibilizacao: string | null;
  lida: boolean;
}

/**
 * Âncora da intimação, emprestando das irmãs de mesmo número de processo quando
 * ela chegou sem processo E sem cliente — espelho de `resolverAncora` em
 * src/utils/deadlineIntimationMatch.ts.
 */
function resolverAncora(
  intimation: IntimationRow,
  irmas: readonly { numero_processo: string | null; process_id: string | null; client_id: string | null }[],
): { process_id: string | null; client_id: string | null } {
  let processId = intimation.process_id;
  let clientId = intimation.client_id;
  if ((processId && clientId) || !intimation.numero_processo) {
    return { process_id: processId, client_id: clientId };
  }

  for (const irma of irmas) {
    if (irma.numero_processo !== intimation.numero_processo) continue;
    processId = processId ?? irma.process_id;
    clientId = clientId ?? irma.client_id;
    if (processId && clientId) break;
  }

  return { process_id: processId, client_id: clientId };
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

function urgencyFor(days: number): "critica" | "alta" | "media" {
  if (days <= 0) return "critica";       // vencido / vence hoje
  if (days <= 3) return "critica";
  if (days <= 7) return "alta";
  return "media";
}

function buildAlert(intimation: IntimationRow, days: number, dueDate: string) {
  const processo = intimation.numero_processo_mascara || intimation.numero_processo || "sem número";
  const urgency = urgencyFor(days);

  let head: string;
  if (days < 0) head = `🚨 PRAZO VENCIDO SEM CADASTRO (há ${Math.abs(days)}d)`;
  else if (days === 0) head = "🚨 PRAZO VENCE HOJE SEM CADASTRO";
  else if (days <= 3) head = `🚨 PRAZO EM ${days}d SEM CADASTRO`;
  else head = `⚠️ PRAZO EM ${days}d SEM CADASTRO`;

  const dueFmt = new Date(dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const messageParts = [
    `Processo: ${processo}`,
    `Vencimento estimado (IA): ${dueFmt}`,
    "Nenhum prazo cadastrado — confira a contagem em dias úteis.",
  ];
  if (intimation.sigla_tribunal) messageParts.push(`Tribunal: ${intimation.sigla_tribunal}`);

  return {
    title: `${head}`,
    message: messageParts.join(" • "),
    urgency,
    processo,
    dueDate,
    days,
  };
}

Deno.serve(async (req: Request) => {
  try {
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
    } catch { /* sem body */ }

    console.log(`🛡️ deadline-guard iniciando${dryRun ? " (DRY RUN)" : ""}...`);

    const now = Date.now();
    const fromIso = new Date(now - PAST_WINDOW_DAYS * 86400000).toISOString();
    const toIso = new Date(now + FUTURE_WINDOW_DAYS * 86400000).toISOString();

    // 1) Análises com prazo dentro da banda de perigo
    const { data: analyses, error: aErr } = await supabase
      .from("intimation_ai_analysis")
      .select("intimation_id, deadline_days, deadline_due_date")
      .not("deadline_due_date", "is", null)
      .gte("deadline_due_date", fromIso)
      .lte("deadline_due_date", toIso);

    if (aErr) throw new Error(`análises: ${aErr.message}`);
    if (!analyses || analyses.length === 0) {
      return json({
        success: true,
        dry_run: dryRun,
        candidates: 0,
        without_link: 0,
        covered_by_existing_deadline: 0,
        unprotected: 0,
        notified: 0,
      });
    }

    const analysisByIntimation = new Map<string, AnalysisRow>();
    for (const a of analyses as AnalysisRow[]) analysisByIntimation.set(a.intimation_id, a);
    const intimationIds = Array.from(analysisByIntimation.keys());

    // 2) Quais dessas intimações JÁ têm prazo vinculado → removê-las
    const { data: linked, error: lErr } = await supabase
      .from("deadlines")
      .select("intimation_id")
      .in("intimation_id", intimationIds);
    if (lErr) throw new Error(`prazos vinculados: ${lErr.message}`);
    const linkedSet = new Set((linked ?? []).map((d: any) => d.intimation_id as string));

    const unprotectedIds = intimationIds.filter((id) => !linkedSet.has(id));
    if (unprotectedIds.length === 0) {
      return json({
        success: true,
        dry_run: dryRun,
        candidates: intimationIds.length,
        without_link: 0,
        covered_by_existing_deadline: 0,
        unprotected: 0,
        notified: 0,
      });
    }

    // 3) Dados das intimações desprotegidas
    const { data: intimationRows, error: iErr } = await supabase
      .from("djen_comunicacoes")
      .select("id, numero_processo, numero_processo_mascara, sigla_tribunal, process_id, client_id, data_disponibilizacao, lida")
      .in("id", unprotectedIds);
    if (iErr) throw new Error(`intimações: ${iErr.message}`);

    // 3b) Vínculo fraco: prazo cadastrado pelo módulo de Prazos não tem
    // intimation_id. Sem esta passada o guardião cobra prazo que já existe.
    const linhas = (intimationRows ?? []) as IntimationRow[];

    // Irmãs: intimações de mesmo número de processo que já estão vinculadas
    // emprestam a âncora para as que chegaram órfãs.
    const numeros = Array.from(new Set(linhas.map((i) => i.numero_processo).filter(Boolean))) as string[];
    let irmas: { numero_processo: string | null; process_id: string | null; client_id: string | null }[] = [];
    if (numeros.length > 0) {
      const { data, error: sErr } = await supabase
        .from("djen_comunicacoes")
        .select("numero_processo, process_id, client_id")
        .in("numero_processo", numeros)
        .or("process_id.not.is.null,client_id.not.is.null");
      if (sErr) throw new Error(`irmãs: ${sErr.message}`);
      irmas = data ?? [];
    }

    const ancoraPorIntimacao = new Map<string, { process_id: string | null; client_id: string | null }>();
    for (const intimation of linhas) {
      ancoraPorIntimacao.set(intimation.id, resolverAncora(intimation, irmas));
    }

    const idsUnicos = (campo: "process_id" | "client_id") =>
      Array.from(
        new Set(Array.from(ancoraPorIntimacao.values()).map((a) => a[campo]).filter(Boolean)),
      ) as string[];

    // Busca pelas duas âncoras: a maioria dos prazos não tem processo, só cliente.
    const prazosCandidatos: DeadlineRow[] = [];
    for (
      const [coluna, valores] of [
        ["process_id", idsUnicos("process_id")],
        ["client_id", idsUnicos("client_id")],
      ] as const
    ) {
      if (valores.length === 0) continue;
      const { data: prazos, error: pErr } = await supabase
        .from("deadlines")
        .select("id, process_id, client_id, intimation_id, status, due_date")
        .in(coluna, valores)
        .neq("status", "cancelado");
      if (pErr) throw new Error(`prazos por ${coluna}: ${pErr.message}`);
      prazosCandidatos.push(...((prazos ?? []) as DeadlineRow[]));
    }

    const intimations: IntimationRow[] = [];
    const cobertasPorVinculoFraco: string[] = [];
    for (const intimation of linhas) {
      const analysis = analysisByIntimation.get(intimation.id);
      // Casa contra a âncora resolvida, não contra a que veio na linha.
      const ancorada = { ...intimation, ...ancoraPorIntimacao.get(intimation.id) };
      const casou = analysis
        ? prazosCandidatos.some((p) =>
          prazoCasaComIntimacao(p, ancorada, analysis.deadline_due_date)
        )
        : false;
      if (casou) cobertasPorVinculoFraco.push(intimation.id);
      else intimations.push(intimation);
    }

    if (cobertasPorVinculoFraco.length > 0) {
      console.log(
        `🔗 ${cobertasPorVinculoFraco.length} intimação(ões) já têm prazo no processo sem intimation_id — sem alerta`,
      );
    }

    // 4) Usuários ativos (destinatários — mesmo modelo do analyze-intimations)
    const { data: users, error: uErr } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("is_active", true);
    if (uErr) throw new Error(`usuários: ${uErr.message}`);
    const activeUserIds = (users ?? []).map((u: any) => u.user_id).filter(Boolean);

    const dedupeSinceIso = new Date(now - DEDUPE_HOURS * 3600000).toISOString();

    const preview: any[] = [];
    let notified = 0;

    for (const intimation of intimations) {
      const analysis = analysisByIntimation.get(intimation.id);
      if (!analysis) continue;
      const days = daysUntil(analysis.deadline_due_date);
      const alert = buildAlert(intimation, days, analysis.deadline_due_date);

      if (dryRun) {
        preview.push({ intimation_id: intimation.id, ...alert, lida: intimation.lida });
        continue;
      }

      for (const userId of activeUserIds) {
        // Dedupe: já existe alerta-guardião recente para este usuário+intimação?
        const { data: recent } = await supabase
          .from("user_notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("type", "intimation_new")
          .eq("intimation_id", intimation.id)
          .eq("read", false)
          .gte("created_at", dedupeSinceIso)
          .filter("metadata->>original_type", "eq", "deadline_guard")
          .limit(1);
        if (recent && recent.length > 0) continue;

        const { error: insErr } = await supabase.from("user_notifications").insert({
          user_id: userId,
          title: alert.title,
          message: alert.message,
          type: "intimation_new",
          intimation_id: intimation.id,
          process_id: intimation.process_id,
          read: false,
          created_at: new Date().toISOString(),
          metadata: {
            original_type: "deadline_guard",
            guard: true,
            urgency: alert.urgency,
            deadline_days: analysis.deadline_days,
            deadline_due_date: analysis.deadline_due_date,
            days_until_due: days,
            processo: alert.processo,
            tribunal: intimation.sigla_tribunal,
          },
        });
        if (insErr) console.error(`insert notif (${intimation.id.slice(0, 8)}/${userId.slice(0, 8)}): ${insErr.message}`);
        else notified++;
      }
    }

    console.log(
      `🛡️ deadline-guard: ${unprotectedIds.length} sem vínculo, ${cobertasPorVinculoFraco.length} cobertas por prazo já cadastrado, ${intimations.length} realmente desprotegidas, ${notified} notificações${dryRun ? " (DRY RUN)" : ""}`,
    );

    return json({
      success: true,
      dry_run: dryRun,
      candidates: intimationIds.length,
      without_link: unprotectedIds.length,
      covered_by_existing_deadline: cobertasPorVinculoFraco.length,
      unprotected: intimations.length,
      active_users: activeUserIds.length,
      notified,
      ...(dryRun ? { preview } : {}),
    });
  } catch (error: any) {
    console.error("deadline-guard erro:", error?.message || error);
    return json({ success: false, error: error?.message || String(error) }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
