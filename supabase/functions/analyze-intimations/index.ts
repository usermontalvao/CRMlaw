import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const groqApiKey = Deno.env.get("GROQ_API_KEY") || Deno.env.get("VITE_GROQ_API_KEY");
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("VITE_OPENAI_API_KEY");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

type ProcessStage =
  | "distribuido" | "citacao" | "conciliacao" | "contestacao"
  | "instrucao" | "sentenca" | "recurso" | "cumprimento" | "arquivado"
  | null;

interface AnalysisResult {
  urgency: "baixa" | "media" | "alta" | "critica";
  deadline?: { days: number; date?: string };
  summary?: string;
  process_stage?: ProcessStage;
}

function shouldRequireAction(analysis: AnalysisResult): boolean {
  const days = analysis.deadline?.days;
  if (typeof days === 'number' && days > 0) return true;
  return analysis.urgency === 'alta' || analysis.urgency === 'critica';
}

function addDays(baseIso: string, days: number): string {
  const base = new Date(baseIso);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function analyzeWithGroq(texto: string): Promise<AnalysisResult | null> {
  if (!groqApiKey) return null;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `Você é um assistente jurídico especializado em processos trabalhistas e cíveis. Analise a intimação e retorne APENAS um JSON válido com:
{
  "urgency": "baixa" | "media" | "alta" | "critica",
  "deadline": { "days": número de dias para o prazo },
  "summary": "resumo curto da intimação em 1-2 frases",
  "process_stage": "distribuido" | "citacao" | "conciliacao" | "contestacao" | "instrucao" | "sentenca" | "recurso" | "cumprimento" | "arquivado" | null
}

Critérios de urgência:
- critica: prazo <= 2 dias
- alta: prazo <= 5 dias
- media: prazo <= 15 dias
- baixa: prazo > 15 dias ou sem prazo definido

Critérios de process_stage (estágio atual do processo):
- distribuido: apenas distribuição, sem outros atos
- citacao: réu sendo citado ou já citado
- conciliacao: audiência de conciliação designada ou realizada
- contestacao: contestação apresentada ou prazo para contestar
- instrucao: audiência de instrução, produção de provas, perícia, oitiva
- sentenca: sentença proferida (julgo procedente/improcedente/extinto/homologo)
- recurso: apelação, agravo, embargos, julgamento em tribunal/turma recursal
- cumprimento: cumprimento de sentença, fase de execução, liquidação
- arquivado: autos arquivados, baixa definitiva, processo encerrado
- null: não é possível determinar o estágio pelo texto`,
          },
          {
            role: "user",
            content: `Analise esta intimação:\n\n${texto.substring(0, 3000)}`,
          },
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
    const content = data.choices?.[0]?.message?.content || "";
    
    // Extrair JSON da resposta
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
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
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `Você é um assistente jurídico especializado em processos trabalhistas e cíveis. Analise a intimação e retorne APENAS um JSON válido com:
{
  "urgency": "baixa" | "media" | "alta" | "critica",
  "deadline": { "days": número de dias para o prazo },
  "summary": "resumo curto da intimação em 1-2 frases",
  "process_stage": "distribuido" | "citacao" | "conciliacao" | "contestacao" | "instrucao" | "sentenca" | "recurso" | "cumprimento" | "arquivado" | null
}
Estágio: distribuido=só distribuição; citacao=réu citado; conciliacao=audiência conciliação; contestacao=contestação/prazo; instrucao=instrução/provas/perícia; sentenca=sentença proferida; recurso=apelação/agravo/tribunal; cumprimento=execução/liquidação; arquivado=encerrado; null=não identificado.`,
          },
          {
            role: "user",
            content: `Analise esta intimação:\n\n${texto.substring(0, 3000)}`,
          },
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
    const content = data.choices?.[0]?.message?.content || "";
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.error("Erro ao analisar com OpenAI:", error);
    return null;
  }
}

async function createNotification(
  userId: string,
  intimation: any,
  analysis: AnalysisResult
) {
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

  if (existing && existing.length > 0) {
    console.log(`⏭️ Notificação já existe para intimação ${intimation.id.substring(0, 8)}`);
    return;
  }

  // Buscar partes (destinatários) da intimação
  const { data: destinatarios } = await supabase
    .from("djen_destinatarios")
    .select("nome, polo")
    .eq("comunicacao_id", intimation.id);

  // Formatar partes para exibição
  let partesInfo = "";
  const partesList: { nome: string; polo: string }[] = [];
  if (destinatarios && destinatarios.length > 0) {
    for (const d of destinatarios) {
      partesList.push({ nome: d.nome, polo: d.polo || "" });
    }
    // Resumo das partes (máx 2 nomes)
    const nomes = destinatarios.slice(0, 2).map((d: any) => d.nome).join(", ");
    partesInfo = destinatarios.length > 2 
      ? `${nomes} e +${destinatarios.length - 2}` 
      : nomes;
  }

  // Montar título e mensagem enriquecidos
  const urgencyLabels: Record<string, string> = {
    critica: "🚨 CRÍTICA",
    alta: "⚠️ Urgente",
    media: "📋 Atenção",
    baixa: "📄 Nova",
  };
  const urgencyLabel = urgencyLabels[analysis.urgency] || "📄 Nova";
  const title = `${urgencyLabel}: ${analysis.summary?.substring(0, 50) || "Nova Intimação"}`;
  
  const messageParts = [
    prazoInfo,
    `Processo: ${intimation.numero_processo_mascara || intimation.numero_processo}`,
  ];
  if (partesInfo) {
    messageParts.push(`Partes: ${partesInfo}`);
  }
  if (intimation.sigla_tribunal) {
    messageParts.push(`Tribunal: ${intimation.sigla_tribunal}`);
  }
  const message = messageParts.join(" • ");

  const { error } = await supabase.from("user_notifications").insert({
    user_id: userId,
    title,
    message,
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

  if (error) {
    console.error("Erro ao criar notificação:", error);
  } else {
    console.log(`✅ Notificação criada para intimação ${intimation.id.substring(0, 8)} (partes: ${partesList.length})`);
  }
}

Deno.serve(async (req: Request) => {
  try {
    console.log("🤖 Iniciando análise automática de intimações...");

    if (!groqApiKey && !openaiApiKey) {
      console.error("❌ GROQ_API_KEY/OPENAI_API_KEY não configuradas nos secrets do Supabase");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Configure GROQ_API_KEY e/ou OPENAI_API_KEY em Settings > Functions > Secrets",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Buscar IDs de intimações que já têm análise
    const { data: analyzedIds } = await supabase
      .from("intimation_ai_analysis")
      .select("intimation_id");
    
    const analyzedIdSet = new Set((analyzedIds || []).map((a: any) => a.intimation_id));

    // Buscar todas as intimações
    const { data: allIntimations, error: intError } = await supabase
      .from("djen_comunicacoes")
      .select("id, texto, numero_processo, numero_processo_mascara, sigla_tribunal, data_disponibilizacao, process_id")
      .order("data_disponibilizacao", { ascending: false })
      .limit(50);

    if (intError) {
      console.error("Erro ao buscar intimações:", intError);
      return new Response(JSON.stringify({ error: intError.message }), { status: 500 });
    }

    // Filtrar apenas as que não têm análise
    const intimations = (allIntimations || []).filter((i: any) => !analyzedIdSet.has(i.id)).slice(0, 10);

    console.log(`📋 ${intimations?.length || 0} intimações sem análise encontradas`);

    if (!intimations || intimations.length === 0) {
      return new Response(JSON.stringify({ success: true, analyzed: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Buscar usuários ativos para notificar
    const { data: users } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("is_active", true);

    let analyzed = 0;
    let notified = 0;

    for (const intimation of intimations) {
      console.log(`🔄 Analisando intimação ${intimation.id.substring(0, 8)}...`);

      // Tentar Groq primeiro, depois OpenAI
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

      console.log(`✅ Análise: urgência=${analysis.urgency}, prazo=${analysis.deadline?.days || "N/A"} dias`);

      const analyzedAt = new Date().toISOString();
      const deadlineDays = typeof analysis.deadline?.days === "number" ? analysis.deadline.days : null;
      const baseDateIso = (intimation.data_disponibilizacao || intimation.created_at || analyzedAt) as string;
      const deadlineDueDate = deadlineDays ? addDays(baseDateIso, deadlineDays) : null;

      const actionRequired = shouldRequireAction(analysis);

      // Formato compatível com o frontend (ProcessTimelineService.fetchTimelineFromDatabase)
      const timelineAiAnalysis = {
        summary: analysis.summary ?? null,
        urgency: analysis.urgency,
        action_required: actionRequired,
        key_points: [],
        deadline_days: deadlineDays,
        deadline_due_date: deadlineDueDate,
        process_stage: analysis.process_stage ?? null,
        analyzed_at: analyzedAt,
        model_used: modelUsed,
      };

      // Salvar análise no banco (somente colunas existentes na tabela)
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

      // Também persistir no registro principal para evitar re-análise ao abrir a timeline
      const { error: updateCommError } = await supabase
        .from('djen_comunicacoes')
        .update({
          ai_analysis: timelineAiAnalysis,
          updated_at: analyzedAt,
        })
        .eq('id', intimation.id);

      if (updateCommError) {
        console.error(`⚠️ Falha ao atualizar djen_comunicacoes.ai_analysis (${intimation.id.substring(0, 8)}): ${updateCommError.message}`);
      }

      // Atualizar estágio do processo vinculado (evento-driven — acontece na hora)
      if (intimation.process_id && analysis.process_stage) {
        const { data: proc } = await supabase
          .from('processes')
          .select('id, status')
          .eq('id', intimation.process_id)
          .single();

        if (proc && proc.status !== analysis.process_stage) {
          const { error: stageErr } = await supabase
            .from('processes')
            .update({
              status: analysis.process_stage,
              djen_synced: true,
              djen_last_sync: analyzedAt,
              djen_has_data: true,
              updated_at: analyzedAt,
            })
            .eq('id', intimation.process_id);

          if (stageErr) {
            console.error(`⚠️ Erro ao atualizar estágio do processo ${intimation.process_id}: ${stageErr.message}`);
          } else {
            console.log(`📊 Processo ${intimation.numero_processo_mascara || intimation.numero_processo}: ${proc.status} → ${analysis.process_stage}`);
          }
        }
      }

      analyzed++;

      // Criar notificação para TODAS as novas intimações (não apenas urgentes)
      for (const user of users || []) {
        if (user.user_id) {
          await createNotification(user.user_id, intimation, analysis);
          notified++;
        }
      }

      // Delay para não sobrecarregar a API
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`✅ Análise concluída: ${analyzed} analisadas, ${notified} notificações criadas`);

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
