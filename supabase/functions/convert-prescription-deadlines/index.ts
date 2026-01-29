import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().split("T")[0];

    // Buscar eventos de prescrição que chegaram na data de alerta (start_at <= hoje)
    // e que ainda não foram convertidos
    const { data: prescriptionEvents, error: fetchError } = await supabase
      .from("calendar_events")
      .select("*")
      .like("title", "%Prescrição (Execução Sobrestada)%")
      .like("description", "%Data-base do sobrestamento%")
      .not("description", "like", "%[CONVERTIDO EM PRAZO]%")
      .lte("start_at", todayISO + "T23:59:59")
      .eq("status", "pendente");

    if (fetchError) {
      console.error("Erro ao buscar eventos de prescrição:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!prescriptionEvents || prescriptionEvents.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum evento de prescrição para converter", converted: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Encontrados ${prescriptionEvents.length} evento(s) de prescrição para converter`);

    let convertedCount = 0;
    const errors: string[] = [];

    for (const event of prescriptionEvents) {
      try {
        // Extrair data-base da descrição
        const baseDateMatch = event.description?.match(/Data-base do sobrestamento: (\d{2}\/\d{2}\/\d{4})/);
        if (!baseDateMatch) {
          console.warn(`⚠️ Evento ${event.id}: não foi possível extrair data-base`);
          continue;
        }

        const baseDateStr = baseDateMatch[1];
        const [dd, mm, yyyy] = baseDateStr.split("/");
        const baseDate = new Date(`${yyyy}-${mm}-${dd}`);

        // Calcular data de prescrição (base + 24 meses)
        const addMonths = (date: Date, months: number) => {
          const d = new Date(date);
          const day = d.getDate();
          d.setDate(1);
          d.setMonth(d.getMonth() + months);
          const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
          d.setDate(Math.min(day, lastDay));
          return d;
        };

        const prescriptionDate = addMonths(baseDate, 24);

        // Extrair código do processo do título
        const processCode = event.title.split(" • ")[1] || "";

        // Criar prazo
        const deadlineData = {
          title: `Prescrição (Execução Sobrestada) - ${processCode}`,
          description: event.description,
          due_date: prescriptionDate.toISOString().split("T")[0],
          priority: "alta",
          status: "pendente",
          type: "geral",
          client_id: event.client_id,
          process_id: event.process_id,
        };

        const { error: deadlineError } = await supabase
          .from("deadlines")
          .insert(deadlineData);

        if (deadlineError) {
          console.error(`❌ Erro ao criar prazo para evento ${event.id}:`, deadlineError);
          errors.push(`Evento ${event.id}: ${deadlineError.message}`);
          continue;
        }

        // Atualizar evento como convertido
        const { error: updateError } = await supabase
          .from("calendar_events")
          .update({
            status: "concluido",
            description: event.description + "\n\n[CONVERTIDO EM PRAZO AUTOMATICAMENTE]",
          })
          .eq("id", event.id);

        if (updateError) {
          console.error(`❌ Erro ao atualizar evento ${event.id}:`, updateError);
          errors.push(`Evento ${event.id}: ${updateError.message}`);
          continue;
        }

        console.log(`✅ Evento ${event.id} convertido em prazo com vencimento em ${prescriptionDate.toLocaleDateString("pt-BR")}`);
        convertedCount++;
      } catch (err: any) {
        console.error(`❌ Erro ao processar evento ${event.id}:`, err);
        errors.push(`Evento ${event.id}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        message: `Conversão concluída`,
        total: prescriptionEvents.length,
        converted: convertedCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Erro geral:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
