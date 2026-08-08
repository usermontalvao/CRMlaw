import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  aplicarTemplate,
  dataFonteProcurada,
  hojeNoEscritorio,
  janelaDeBusca,
  OFFICE_TIME_ZONE,
  selecionarCandidatos,
  vencimentoDoPrazo,
  type Filtro,
  type LinhaFonte,
} from "./rules.ts";

/**
 * deadline-automations — Edge Function
 *
 * Executa as regras de public.deadline_automations: "quando chegar a data X,
 * cadastre o prazo Y". Roda uma vez por dia, de madrugada, para que o prazo já
 * esteja na fila quando o escritório abrir.
 *
 * O desenho tem três decisões que valem ser lidas antes de mexer:
 *
 * 1. VARREDURA, não agendamento por linha. A regra não cria um job para cada
 *    requerimento; ela pergunta todo dia "que linhas têm a data-fonte batendo
 *    hoje?". Uma perícia remarcada é encontrada na data nova sem que ninguém
 *    precise cancelar agendamento antigo.
 *
 * 2. IDEMPOTÊNCIA pelo ledger, não por marcação no registro. Cada execução que
 *    cria prazo grava (automation_id, source_row_id, occurrence_key) em
 *    deadline_automation_runs, com índice único parcial. occurrence_key é a
 *    data-fonte resolvida: rodar duas vezes no mesmo dia não duplica, mas
 *    remarcar a perícia gera chave nova e dispara de novo.
 *
 * 3. SIMULAÇÃO como padrão. Regra com simulate_only grava o que TERIA criado e
 *    não cria. É o período em que o escritório confere se a regra faz o que
 *    promete, antes de ela passar a produzir obrigação de verdade.
 *
 * Aceita { "dry_run": true } no body: roda tudo, não escreve nada (nem log), e
 * devolve o que aconteceria. Diferente de simulate_only, que é estado da regra
 * e deixa rastro no ledger.
 */

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// As datas, o filtro e os templates moram em ./rules.ts — puros e testados sob
// node:test. Aqui fica só o que precisa de rede: ler a fonte, gravar o prazo,
// manter o ledger.

// Colunas que o runner lê da fonte. Lista explícita porque `select *` traria
// inss_password/inss_password_enc para dentro dos logs da função.
const COLUNAS_REQUIREMENTS =
  "id, protocol, beneficiary, benefit_type, status, client_id, archived, " +
  "entry_date, exigency_due_date, pericia_medica_at, pericia_social_at";

interface Automation {
  id: string;
  name: string;
  is_active: boolean;
  simulate_only: boolean;
  source_table: string;
  source_date_field: string;
  source_filter: Filtro[];
  filter_mode: "all" | "any";
  trigger_offset_days: number;
  title_template: string;
  description_template: string | null;
  deadline_type: string;
  priority: string;
  counting_type: string | null;
  due_offset_days: number;
  responsible_id: string | null;
}

// ─── Execução de uma regra ───────────────────────────────────────────────────

interface Resultado {
  automation_id: string;
  automation: string;
  dia_fonte: string;
  candidatos: number;
  criados: number;
  simulados: number;
  ja_processados: number;
  erros: number;
  preview: unknown[];
}

async function executarRegra(regra: Automation, hoje: string, dryRun: boolean): Promise<Resultado> {
  const campo = regra.source_date_field;

  const diaFonte = dataFonteProcurada(hoje, regra.trigger_offset_days);

  const resultado: Resultado = {
    automation_id: regra.id,
    automation: regra.name,
    dia_fonte: diaFonte,
    candidatos: 0,
    criados: 0,
    simulados: 0,
    ja_processados: 0,
    erros: 0,
    preview: [],
  };

  // Janela larga de propósito: o recorte fino do dia é feito em rules.ts, que é
  // quem sabe a natureza do campo (data pura x instante no fuso do escritório).
  const { de, ate } = janelaDeBusca(diaFonte);

  const { data: linhas, error } = await supabase
    .from(regra.source_table)
    .select(COLUNAS_REQUIREMENTS)
    .not(campo, "is", null)
    .gte(campo, de)
    .lt(campo, ate);

  if (error) throw new Error(`fonte ${regra.source_table}.${campo}: ${error.message}`);

  const candidatos = selecionarCandidatos(
    (linhas ?? []) as LinhaFonte[],
    campo,
    diaFonte,
    regra.source_filter,
    regra.filter_mode,
  );

  resultado.candidatos = candidatos.length;
  if (candidatos.length === 0) return resultado;

  // Quem já foi atendido nesta ocorrência. Uma consulta só, não uma por linha.
  const { data: jaFeitos } = await supabase
    .from("deadline_automation_runs")
    .select("source_row_id, status")
    .eq("automation_id", regra.id)
    .eq("occurrence_key", diaFonte)
    .in("source_row_id", candidatos.map((c) => c.id));

  const criadosAntes = new Set(
    (jaFeitos ?? []).filter((r) => r.status === "criado").map((r) => r.source_row_id),
  );
  const simuladosAntes = new Set(
    (jaFeitos ?? []).filter((r) => r.status === "simulado").map((r) => r.source_row_id),
  );

  for (const linha of candidatos) {
    // Já virou prazo nesta ocorrência: não recria. Vale inclusive quando o prazo
    // foi depois excluído — apagar um prazo é decisão humana, e ressuscitá-lo no
    // dia seguinte transformaria a automação em briga com o usuário.
    if (criadosAntes.has(linha.id)) {
      resultado.ja_processados++;
      continue;
    }

    const titulo = aplicarTemplate(regra.title_template, linha, diaFonte, campo);
    const descricao = regra.description_template
      ? aplicarTemplate(regra.description_template, linha, diaFonte, campo)
      : null;

    const prazo = {
      title: titulo,
      description: descricao,
      due_date: vencimentoDoPrazo(diaFonte, regra.due_offset_days),
      status: "pendente",
      priority: regra.priority,
      type: regra.deadline_type,
      counting_type: regra.counting_type,
      client_id: linha.client_id ?? null,
      requirement_id: regra.source_table === "requirements" ? linha.id : null,
      responsible_id: regra.responsible_id,
      origin: "automation",
    };

    if (dryRun) {
      resultado.preview.push({ requirement_id: linha.id, prazo });
      regra.simulate_only ? resultado.simulados++ : resultado.criados++;
      continue;
    }

    // ── Modo simulação: registra a intenção, não cria o prazo ────────────────
    if (regra.simulate_only) {
      if (simuladosAntes.has(linha.id)) {
        resultado.ja_processados++;
        continue;
      }
      const { error: logErr } = await supabase.from("deadline_automation_runs").insert({
        automation_id: regra.id,
        source_row_id: linha.id,
        occurrence_key: diaFonte,
        status: "simulado",
        details: { motivo: "regra em modo simulação", prazo },
      });
      if (logErr) resultado.erros++;
      else resultado.simulados++;
      continue;
    }

    // ── Modo real ────────────────────────────────────────────────────────────
    const { data: criado, error: prazoErr } = await supabase
      .from("deadlines")
      .insert(prazo)
      .select("id")
      .single();

    if (prazoErr || !criado) {
      resultado.erros++;
      await supabase.from("deadline_automation_runs").insert({
        automation_id: regra.id,
        source_row_id: linha.id,
        occurrence_key: diaFonte,
        status: "erro",
        details: { erro: prazoErr?.message ?? "insert sem retorno", prazo },
      });
      continue;
    }

    const { error: ledgerErr } = await supabase.from("deadline_automation_runs").insert({
      automation_id: regra.id,
      source_row_id: linha.id,
      occurrence_key: diaFonte,
      status: "criado",
      deadline_id: criado.id,
      details: { prazo },
    });

    if (ledgerErr) {
      // O índice único do ledger é a trava contra duplicata. Se ele recusou, um
      // outro processo criou o prazo desta ocorrência entre o SELECT e o INSERT:
      // o prazo recém-inserido é o duplicado e sai de cena.
      await supabase.from("deadlines").delete().eq("id", criado.id);
      resultado.ja_processados++;
      continue;
    }

    resultado.criados++;
  }

  return resultado;
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const iniciadoEm = new Date().toISOString();
  let logId: string | null = null;

  try {
    let dryRun = false;
    let somenteRegra: string | null = null;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
      somenteRegra = typeof body?.automation_id === "string" ? body.automation_id : null;
    } catch { /* sem body */ }

    const hoje = hojeNoEscritorio();
    console.log(`⏱️ deadline-automations: hoje=${hoje} (${OFFICE_TIME_ZONE})${dryRun ? " DRY RUN" : ""}`);

    if (!dryRun) {
      const { data: logRow } = await supabase
        .from("cron_job_logs")
        .insert({ job_name: "deadline-automations", status: "running", started_at: iniciadoEm })
        .select("id")
        .single();
      logId = logRow?.id ?? null;
    }

    let query = supabase
      .from("deadline_automations")
      .select("*")
      .eq("is_active", true);
    if (somenteRegra) query = query.eq("id", somenteRegra);

    const { data: regras, error: regrasErr } = await query;
    if (regrasErr) throw new Error(`regras: ${regrasErr.message}`);

    const resultados: Resultado[] = [];
    for (const regra of (regras ?? []) as Automation[]) {
      try {
        resultados.push(await executarRegra(regra, hoje, dryRun));
      } catch (e: any) {
        console.error(`regra ${regra.name}: ${e?.message ?? e}`);
        resultados.push({
          automation_id: regra.id,
          automation: regra.name,
          dia_fonte: "",
          candidatos: 0,
          criados: 0,
          simulados: 0,
          ja_processados: 0,
          erros: 1,
          preview: [],
        });
      }
    }

    const total = resultados.reduce(
      (acc, r) => ({
        criados: acc.criados + r.criados,
        simulados: acc.simulados + r.simulados,
        ja_processados: acc.ja_processados + r.ja_processados,
        erros: acc.erros + r.erros,
      }),
      { criados: 0, simulados: 0, ja_processados: 0, erros: 0 },
    );

    console.log(
      `⏱️ deadline-automations: ${regras?.length ?? 0} regras · ` +
      `${total.criados} criados · ${total.simulados} simulados · ` +
      `${total.ja_processados} já processados · ${total.erros} erros`,
    );

    if (logId) {
      await supabase
        .from("cron_job_logs")
        .update({
          status: total.erros > 0 ? "failed" : "success",
          finished_at: new Date().toISOString(),
          result: { hoje, ...total, regras: resultados.length },
        })
        .eq("id", logId);
    }

    return json({ success: true, dry_run: dryRun, hoje, ...total, resultados });
  } catch (error: any) {
    const mensagem = error?.message ?? String(error);
    console.error("deadline-automations erro:", mensagem);
    if (logId) {
      await supabase
        .from("cron_job_logs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error: mensagem })
        .eq("id", logId);
    }
    return json({ success: false, error: mensagem }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
