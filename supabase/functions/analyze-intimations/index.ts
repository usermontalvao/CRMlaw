import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * analyze-intimations — Edge Function
 *
 * Analisa intimações novas com IA (Groq → OpenAI) e gera resumo/urgência/prazo
 * + notificações. Roda a cada 30 min via pg_cron (job #11).
 *
 * IMPORTANTE: NÃO grava processes.status. Antes, classificava o estágio pelo
 * palpite da IA sobre UMA intimação isolada e gravava direto em processes.status,
 * o que fazia o processo "voltar para arquivado" a cada 30 min. O estágio agora
 * é responsabilidade EXCLUSIVA da fonte única no banco (_infer_process_stage
 * sobre os movimentos DataJud).
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const groqApiKey = Deno.env.get("GROQ_API_KEY");
const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface AnalysisResult {
  urgency: "baixa" | "media" | "alta" | "critica";
  deadline?: { days: number; date?: string };
  summary?: string;
}

const SYSTEM_PROMPT = `Você é um assistente jurídico. Analise a intimação e retorne APENAS um JSON válido:
{
  "urgency": "baixa" | "media" | "alta" | "critica",
  "deadline": { "days": número de dias para o prazo },
  "summary": "resumo curto da intimação em 1-2 frases"
}
Critérios de urgência: critica = prazo <= 2 dias; alta = prazo <= 5 dias; media = prazo <= 15 dias; baixa = prazo > 15 dias ou sem prazo.`;

function addDays(baseIso: string, days: number): string {
  const base = new Date(baseIso);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function parseJson(content: string): AnalysisResult | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function analyzeWithGroq(texto: string): Promise<AnalysisResult | null> {
  if (!groqApiKey) return null;
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analise esta intimação:\n\n${texto.substring(0, 3000)}` },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });
    if (!response.ok) {
      console.error("Erro Groq:", await response.text());
      return null;
    }
    const data = await response.json();
    return parseJson(data.choices?.[0]?.message?.content || "");
  } catch (error) {
    console.error("Erro ao analisar com Groq:", error);
    return null;
  }
}

async function analyzeWithOpenAI(texto: string): Promise<AnalysisResult | null> {
  if (!openaiApiKey) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analise esta intimação:\n\n${texto.substring(0, 3000)}` },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });
    if (!response.ok) {
      console.error("Erro OpenAI:", await response.text());
      return null;
    }
    const data = await response.json();
    return parseJson(data.choices?.[0]?.message?.content || "");
  } catch (error) {
    console.error("Erro ao analisar com OpenAI:", error);
    return null;
  }
}

async function createNotification(userId: string, intimation: any, analysis: AnalysisResult) {
  const prazoInfo = analysis.deadline?.days
    ? `Prazo: ${analysis.deadline.days} dia(s)`
    : "Prazo não identificado";

  const { data: existing } = await supabase
    .from("user_notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "intimation_new")
    .eq("intimation_id", intimation.id)
    .limit(1);

  if (existing && existing.length > 0) return;

  const { data: destinatarios } = await supabase
    .from("djen_destinatarios")
    .select("nome, polo")
    .eq("comunicacao_id", intimation.id);

  let partesInfo = "";
  const partesList: { nome: string; polo: string }[] = [];
  if (destinatarios && destinatarios.length > 0) {
    for (const d of destinatarios) partesList.push({ nome: d.nome, polo: d.polo || "" });
    const nomes = destinatarios.slice(0, 2).map((d: any) => d.nome).join(", ");
    partesInfo = destinatarios.length > 2 ? `${nomes} e +${destinatarios.length - 2}` : nomes;
  }

  const urgencyLabels: Record<string, string> = {
    critica: "🚨 CRÍTICA", alta: "⚠️ Urgente", media: "📋 Atenção", baixa: "📄 Nova",
  };
  const urgencyLabel = urgencyLabels[analysis.urgency] || "📄 Nova";
  const title = `${urgencyLabel}: ${analysis.summary?.substring(0, 50) || "Nova Intimação"}`;

  const messageParts = [
    prazoInfo,
    `Processo: ${intimation.numero_processo_mascara || intimation.numero_processo}`,
  ];
  if (partesInfo) messageParts.push(`Partes: ${partesInfo}`);
  if (intimation.sigla_tribunal) messageParts.push(`Tribunal: ${intimation.sigla_tribunal}`);

  const { error } = await supabase.from("user_notifications").insert({
    user_id: userId,
    title,
    message: messageParts.join(" • "),
    type: "intimation_new",
    intimation_id: intimation.id,
    read: false,
    created_at: new Date().toISOString(),
    metadata: {
      urgency: analysis.urgency,
      deadline_days: analysis.deadline?.days,
      tribunal: intimation.sigla_tribunal,
      summary: analysis.summary,
      partes: partesList,
      processo: intimation.numero_processo_mascara || intimation.numero_processo,
    },
  });

  if (error) console.error("Erro ao criar notificação:", error);
}

Deno.serve(async (_req: Request) => {
  try {
    console.log("🤖 Iniciando análise automática de intimações...");

    if (!groqApiKey && !openaiApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Configure GROQ_API_KEY e/ou OPENAI_API_KEY nos secrets" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const { data: analyzedIds } = await supabase
      .from("intimation_ai_analysis")
      .select("intimation_id");
    const analyzedIdSet = new Set((analyzedIds || []).map((a: any) => a.intimation_id));

    const { data: allIntimations, error: intError } = await supabase
      .from("djen_comunicacoes")
      .select("id, texto, numero_processo, numero_processo_mascara, sigla_tribunal, data_disponibilizacao, process_id")
      .order("data_disponibilizacao", { ascending: false })
      .limit(50);

    if (intError) {
      console.error("Erro ao buscar intimações:", intError);
      return new Response(JSON.stringify({ error: intError.message }), { status: 500 });
    }

    const intimations = (allIntimations || []).filter((i: any) => !analyzedIdSet.has(i.id)).slice(0, 10);
    console.log(`📋 ${intimations.length} intimações sem análise encontradas`);

    if (intimations.length === 0) {
      return new Response(JSON.stringify({ success: true, analyzed: 0, notified: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: users } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("is_active", true);

    let analyzed = 0;
    let notified = 0;

    for (const intimation of intimations) {
      let modelUsed = "groq";
      let analysis = await analyzeWithGroq(intimation.texto);
      if (!analysis) {
        modelUsed = "openai";
        analysis = await analyzeWithOpenAI(intimation.texto);
      }
      if (!analysis) {
        console.log(`⚠️ Não foi possível analisar intimação ${intimation.id.substring(0, 8)}`);
        continue;
      }

      const analyzedAt = new Date().toISOString();
      const deadlineDays = typeof analysis.deadline?.days === "number" ? analysis.deadline.days : null;
      const baseDateIso = (intimation.data_disponibilizacao || analyzedAt) as string;
      const deadlineDueDate = deadlineDays ? addDays(baseDateIso, deadlineDays) : null;

      const { error: saveError } = await supabase.from("intimation_ai_analysis").insert({
        intimation_id: intimation.id,
        summary: analysis.summary ?? null,
        urgency: analysis.urgency,
        deadline_days: deadlineDays,
        deadline_due_date: deadlineDueDate,
        analyzed_at: analyzedAt,
        model_used: modelUsed,
        created_at: analyzedAt,
        updated_at: analyzedAt,
      });

      if (saveError) {
        console.error(`❌ Erro ao salvar análise (${intimation.id.substring(0, 8)}): ${saveError.message}`);
        continue;
      }

      // NÃO gravamos processes.status aqui — ver cabeçalho.
      analyzed++;

      for (const user of users || []) {
        if (user.user_id) {
          await createNotification(user.user_id, intimation, analysis);
          notified++;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`✅ Análise concluída: ${analyzed} analisadas, ${notified} notificações`);

    return new Response(
      JSON.stringify({ success: true, analyzed, notified }),
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
