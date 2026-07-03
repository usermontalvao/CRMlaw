/**
 * IMPORTANTE: Esta Edge Function deve ser deployada com verify_jwt=false
 *
 * Deploy via CLI:
 * supabase functions deploy run-djen-sync --no-verify-jwt
 *
 * Ou via Dashboard:
 * Settings > Edge Functions > run-djen-sync > JWT Verification: OFF
 *
 * A autenticação é feita via token customizado na URL (?token=xxx)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DJEN_BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1'

const SYNC_TOKEN = Deno.env.get('DJEN_SYNC_TOKEN') || 'djen-sync-2024'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log(`📥 DJEN SYNC request: ${req.method} ${req.url}`)
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    const onlyProcessCode = (url.searchParams.get('processCode') || '').replace(/[^0-9]/g, '') || null

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Autenticação: token compartilhado na URL (?token=). É o único gate
    // (verify_jwt=false) — sem ele, qualquer um dispara um job privilegiado
    // (service role) que escreve no banco, chama IA e gera notificações
    // (DoS/custo/spam). O token esperado vem de service_function_tokens
    // (rotacionável por SQL, sem redeploy); cai no env DJEN_SYNC_TOKEN/default
    // só se a tabela não tiver linha. O cron (jobid 5) envia o mesmo token.
    let expectedToken = SYNC_TOKEN
    try {
      const { data: tk } = await supabaseClient
        .from('service_function_tokens')
        .select('token')
        .eq('fn', 'run-djen-sync')
        .maybeSingle()
      if (tk?.token) expectedToken = tk.token as string
    } catch (_) { /* fallback ao env */ }

    if (!token || token !== expectedToken) {
      console.warn('🚫 Token inválido — execução negada')
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const nowIso = new Date().toISOString()
    const dateRangeStart = getDateDaysAgo(7)
    const dateRangeEnd = getDateToday()

    const executionId = crypto.randomUUID().substring(0, 8)
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🚀 [${executionId}] CRON DJEN SYNC - INICIANDO`)
    console.log(`📅 Data/Hora: ${new Date().toISOString()}`)
    console.log(`${'='.repeat(60)}\n`)

    const syncStartTime = new Date().toISOString()

    let cronLogId: string | null = null
    try {
      const { data: cronRow } = await supabaseClient
        .from('cron_job_logs')
        .insert({ job_name: 'run-djen-sync', status: 'running', started_at: syncStartTime })
        .select('id').single()
      cronLogId = cronRow?.id ?? null
    } catch (_) { /* log não é crítico */ }

    const { data: syncLog } = await supabaseClient
      .from('djen_sync_history')
      .insert({
        id: crypto.randomUUID(),
        synced_at: syncStartTime,
        date_range_start: dateRangeStart,
        date_range_end: dateRangeEnd,
        items_found: 0,
        items_saved: 0,
        success: false,
        source: 'cron_supabase',
        origin: 'scheduled_trigger',
        trigger_type: 'pg_cron',
        status: 'running',
        run_started_at: syncStartTime,
        message: `[${executionId}] Sincronização iniciada via cron Supabase`
      })
      .select()
      .single()

    console.log(`📝 [${executionId}] Log de sync criado: ${syncLog?.id || 'N/A'}`)

    let totalSaved = 0
    let totalFound = 0
    let apiErrors = 0
    let errorMessage = null

    try {
      const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('lawyer_full_name')
        .not('lawyer_full_name', 'is', null)
        .neq('lawyer_full_name', '')

      const { data: processes } = await supabaseClient
        .from('processes')
        .select('*')
        .limit(1000)

      const { data: djenExistentes } = await supabaseClient
        .from('djen_comunicacoes')
        .select('process_id')
        .not('process_id', 'is', null)
      const processIdsComDjen = new Set((djenExistentes || []).map((d: any) => d.process_id))

      console.log(`\n📊 [${executionId}] DADOS ENCONTRADOS:`)
      console.log(`   👤 Perfis com advogado: ${profiles?.length || 0}`)
      console.log(`   📁 Processos: ${processes?.length || 0}`)
      console.log(`   📰 Processos com DJEN existente: ${processIdsComDjen.size}`)

      // ── Time budget global: conta desde o início da função (inclui ETAPA 1 + ETAPA 2) ──
      const EXEC_BUDGET_MS = 120_000 // 120s → garante terminar antes do timeout HTTP de 150s
      const execStart = Date.now()
      const timeLeft = () => EXEC_BUDGET_MS - (Date.now() - execStart)

      if (profiles && profiles.length > 0) {
        console.log(`\n🔄 [${executionId}] ETAPA 1: Sincronização por advogado`)
        for (const profile of profiles) {
          if (!profile.lawyer_full_name) continue
          if (timeLeft() < 20_000) { console.log(`   ⏱️  Budget esgotado — parando ETAPA 1`); break }

          console.log(`   🔍 Buscando: ${profile.lawyer_full_name}`)

          const params = new URLSearchParams({
            nomeAdvogado: profile.lawyer_full_name,
            dataDisponibilizacaoInicio: getDateDaysAgo(7),
            dataDisponibilizacaoFim: getDateToday(),
            meio: 'D',
            itensPorPagina: '100',
            pagina: '1'
          })

          const res = await fetchDjenWithRetry(`${DJEN_BASE_URL}/comunicacao?${params}`)

          if (res.ok) {
            const data = res.data
            if (data.items && data.items.length > 0) {
              totalFound += data.items.length
              const result = await saveCommunications(supabaseClient, data.items, processes || [])
              totalSaved += result.saved
            }
          } else {
            apiErrors++
            console.warn(`   ⚠️ Falha na API DJEN (advogado ${profile.lawyer_full_name}): ${res.error}`)
          }

          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      if (processes && processes.length > 0) {
        console.log(`\n🔄 [${executionId}] ETAPA 2: Sincronização por processo`)

        let validos = (processes as any[]).filter(
          p => p.process_code?.replace(/[^0-9]/g, '').length === 20
        )
        if (onlyProcessCode) {
          validos = validos.filter(p => p.process_code.replace(/[^0-9]/g, '') === onlyProcessCode)
          processIdsComDjen.clear()
        }
        const processesSemDados = validos.filter(p => !processIdsComDjen.has(p.id))
        const processesComDados = onlyProcessCode ? [] : validos.filter(p => processIdsComDjen.has(p.id))

        console.log(`   📋 Processos sem histórico DJEN: ${processesSemDados.length}`)
        console.log(`   📋 Processos com histórico DJEN: ${processesComDados.length}`)
        console.log(`   ⏱️  Budget disponível: ${(timeLeft()/1000).toFixed(0)}s`)

        for (const proc of processesComDados) {
          if (timeLeft() < 15_000) { console.log(`   ⏱️  Budget esgotado — parando processesComDados`); break }
          const processNumber = proc.process_code.replace(/[^0-9]/g, '')
          const params = new URLSearchParams({
            numeroProcesso: processNumber,
            dataDisponibilizacaoInicio: getDateDaysAgo(7),
            dataDisponibilizacaoFim: getDateToday(),
            meio: 'D', itensPorPagina: '100', pagina: '1'
          })
          const res = await fetchDjenWithRetry(`${DJEN_BASE_URL}/comunicacao?${params}`)
          if (res.ok) {
            const data = res.data
            if (data.items?.length > 0) {
              totalFound += data.items.length
              const result = await saveCommunications(supabaseClient, data.items, processes)
              totalSaved += result.saved
            }
          } else {
            apiErrors++
            console.warn(`   ⚠️ Falha na API DJEN (processo ${processNumber.substring(0, 7)}...): ${res.error}`)
          }
          await new Promise(r => setTimeout(r, 500))
        }

        const BATCH_SIZE = onlyProcessCode ? processesSemDados.length : 15
        const MAX_DAYS_BACK = onlyProcessCode ? 1460 : 365
        const WINDOW = 365

        const dayOfMonth = new Date().getDate()
        const batchStart = (dayOfMonth * BATCH_SIZE) % Math.max(processesSemDados.length, 1)
        const batch = [
          ...processesSemDados.slice(batchStart),
          ...processesSemDados.slice(0, batchStart)
        ].slice(0, BATCH_SIZE)

        console.log(`   📦 Processando batch ${batchStart}..${batchStart + batch.length} de ${processesSemDados.length} sem dados (máx ${BATCH_SIZE}/run)`)

        for (const proc of batch) {
          if (timeLeft() < 15_000) { console.log(`   ⏱️  Budget esgotado — parando batch`); break }

          const processNumber = proc.process_code.replace(/[^0-9]/g, '')
          console.log(`   🔍 Histórico: ${processNumber.substring(0, 7)}... (restam ${(timeLeft()/1000).toFixed(0)}s)`)

          let foundAny = false
          let windowEnd = new Date()

          while (timeLeft() > 10_000) {
            const windowStart = new Date(windowEnd)
            windowStart.setDate(windowStart.getDate() - WINDOW)
            const cutoff = new Date()
            cutoff.setDate(cutoff.getDate() - MAX_DAYS_BACK)
            if (windowEnd <= cutoff) break
            const inicio = windowStart < cutoff ? cutoff : windowStart

            const params = new URLSearchParams({
              numeroProcesso: processNumber,
              dataDisponibilizacaoInicio: inicio.toISOString().split('T')[0],
              dataDisponibilizacaoFim: windowEnd.toISOString().split('T')[0],
              meio: 'D', itensPorPagina: '100', pagina: '1'
            })
            const res = await fetchDjenWithRetry(`${DJEN_BASE_URL}/comunicacao?${params}`)
            if (res.ok) {
              const data = res.data
              if (data.items?.length > 0) {
                totalFound += data.items.length
                const result = await saveCommunications(supabaseClient, data.items, processes)
                totalSaved += result.saved
                foundAny = true
                console.log(`      ✅ ${data.items.length} publ. em ${inicio.toISOString().split('T')[0]}~${windowEnd.toISOString().split('T')[0]}`)
              }
            } else {
              apiErrors++
              console.warn(`      ⚠️ Falha na API DJEN (janela ${inicio.toISOString().split('T')[0]}~${windowEnd.toISOString().split('T')[0]}): ${res.error}`)
            }
            windowEnd = new Date(windowStart)
            windowEnd.setDate(windowEnd.getDate() - 1)
            await new Promise(r => setTimeout(r, 500))
          }

          if (!foundAny) console.log(`      ℹ️  Nenhuma publicação DJEN encontrada`)
        }
      }

    } catch (syncError: any) {
      errorMessage = syncError.message
      console.error('❌ Erro durante sincronização:', syncError)
    }

    const syncEndTime = new Date().toISOString()
    // Falhas de API (5xx/timeout do PJe) NÃO podem virar "sucesso, 0 encontradas":
    // isso mascarava dias inteiros sem sincronizar. Marcamos como 'partial'.
    const apiErrorNote = apiErrors > 0
      ? `${apiErrors} consulta(s) à API do DJEN falharam (instabilidade do PJe) — sincronização parcial, será retentada no próximo ciclo.`
      : null
    const finalStatus = errorMessage ? 'error' : (apiErrors > 0 ? 'partial' : 'success')
    const finalSuccess = !errorMessage && apiErrors === 0

    if (syncLog) {
      await supabaseClient
        .from('djen_sync_history')
        .update({
          status: finalStatus,
          run_finished_at: syncEndTime,
          items_found: totalFound,
          items_saved: totalSaved,
          success: finalSuccess,
          synced_at: syncEndTime,
          date_range_start: dateRangeStart,
          date_range_end: dateRangeEnd,
          error_message: errorMessage || apiErrorNote,
          message: errorMessage
            || (apiErrorNote
              ? `Parcial: ${totalSaved} salvas de ${totalFound} encontradas. ${apiErrorNote}`
              : `Sincronização concluída: ${totalSaved} intimações salvas de ${totalFound} encontradas`)
        })
        .eq('id', syncLog.id)
    }

    console.log(`\n📈 [${executionId}] RESULTADO SINCRONIZAÇÃO:`)
    console.log(`   📥 Encontradas: ${totalFound}`)
    console.log(`   💾 Salvas: ${totalSaved}`)
    console.log(`   ⚠️ Falhas de API: ${apiErrors}`)
    console.log(`   ⏱️ Status: ${finalStatus}`)

    let totalAnalyzed = 0
    let totalNotified = 0
    let analysisError: string | null = null

    if (totalSaved > 0) {
      console.log(`\n🤖 [${executionId}] ETAPA 3: Analisar intimações e gerar notificações (analyze-intimations)`)
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        if (!supabaseUrl) throw new Error('SUPABASE_URL não configurada')

        const analyzeUrl = `${supabaseUrl}/functions/v1/analyze-intimations`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 25000)

        const response = await fetch(analyzeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: 'run-djen-sync', execution_id: executionId }),
          signal: controller.signal,
        })

        clearTimeout(timeout)

        const rawText = await response.text()
        if (!response.ok) {
          analysisError = `HTTP ${response.status}: ${rawText}`
          console.error(`   ❌ [${executionId}] Falha ao chamar analyze-intimations:`, analysisError)
        } else {
          try {
            const payload = JSON.parse(rawText)
            totalAnalyzed = Number(payload?.analyzed ?? 0)
            totalNotified = Number(payload?.notified ?? 0)
          } catch {
            console.log(`   ⚠️ [${executionId}] Resposta não-JSON de analyze-intimations: ${rawText}`)
          }
          console.log(`   ✅ [${executionId}] analyze-intimations: analisadas=${totalAnalyzed} notificações=${totalNotified}`)
        }
      } catch (aiError: any) {
        analysisError = aiError?.message || String(aiError)
        console.error(`   ❌ [${executionId}] Erro ao chamar analyze-intimations:`, aiError)
      }
    } else {
      console.log(`\nℹ️ [${executionId}] Nenhuma intimação nova salva - pulando análise/notificações imediatas`)
    }

    const totalDuration = ((new Date().getTime() - new Date(syncStartTime).getTime()) / 1000).toFixed(1)
    console.log(`\n${'='.repeat(60)}`)
    console.log(`✅ [${executionId}] CRON DJEN SYNC - FINALIZADO`)
    console.log(`   📥 Encontradas: ${totalFound} | 💾 Salvas: ${totalSaved} | 🤖 Analisadas: ${totalAnalyzed} | 🔔 Notificadas: ${totalNotified}`)
    console.log(`   ⏱️ Duração: ${totalDuration}s`)
    console.log(`${'='.repeat(60)}\n`)

    if (cronLogId) {
      await supabaseClient.from('cron_job_logs').update({
        status: errorMessage ? 'error' : (apiErrors > 0 ? 'partial' : 'success'),
        finished_at: new Date().toISOString(),
        result: { found: totalFound, saved: totalSaved, analyzed: totalAnalyzed, notified: totalNotified, api_errors: apiErrors },
      }).eq('id', cronLogId)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sincronização DJEN + Análise IA concluída`,
        stats: {
          found: totalFound,
          saved: totalSaved,
          api_errors: apiErrors,
          analyzed: totalAnalyzed,
          notified: totalNotified,
          analysis_error: analysisError,
          status: finalStatus,
          started_at: syncStartTime,
          finished_at: new Date().toISOString()
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error: any) {
    console.error('❌ Erro no endpoint de sincronização:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Erro interno do servidor' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

function getDateToday(): string {
  return new Date().toISOString().split('T')[0]
}

function getDateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().split('T')[0]
}

/**
 * A API pública do DJEN (comunicaapi.pje.jus.br) é instável: retorna 5xx e
 * chega a travar (timeout), especialmente sob chamadas repetidas do mesmo IP
 * (a edge do Supabase usa IP compartilhado). Antes, `if (response.ok)` sem
 * retry engolia essas falhas em silêncio e o sync virava "sucesso, 0 encontradas",
 * mascarando dias inteiros sem intimações. Aqui fazemos retry com backoff
 * exponencial + timeout por request; o chamador conta falhas em `apiErrors`.
 */
type DjenFetchResult = { ok: true; data: any } | { ok: false; error: string }

async function fetchDjenWithRetry(
  url: string,
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<DjenFetchResult> {
  const retries = opts.retries ?? 3
  // 12s por tentativa: resposta saudável do DJEN chega em 1-3s. Com backoff
  // (1s+2s), o pior caso de uma chamada 100% falha é ~39s — cabe na folga entre
  // o EXEC_BUDGET_MS (120s) e o timeout HTTP da função (150s).
  const timeoutMs = opts.timeoutMs ?? 12_000
  let lastError = 'desconhecido'

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'CRM-Advocacia/DJEN-Sync (contato: pedro@advcuiaba.com)',
          'Accept': 'application/json',
        },
      })
      clearTimeout(timer)

      if (response.ok) {
        return { ok: true, data: await response.json() }
      }

      lastError = `HTTP ${response.status}`
      // 4xx (exceto 429) é erro de requisição — repetir não ajuda
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return { ok: false, error: lastError }
      }
    } catch (e: any) {
      clearTimeout(timer)
      lastError = e?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : (e?.message || String(e))
    }

    if (attempt < retries) {
      const backoff = 1000 * Math.pow(2, attempt - 1) // 1s, 2s, 4s...
      await new Promise(r => setTimeout(r, backoff))
    }
  }

  return { ok: false, error: `${lastError} (após ${retries} tentativas)` }
}

async function saveCommunications(supabase: any, communications: any[], processes: any[]): Promise<{ saved: number, processesUpdated: string[] }> {
  let savedCount = 0
  const processesUpdated: string[] = []

  for (const comm of communications) {
    try {
      const djenId = comm.id ?? comm.djenId ?? comm.djen_id
      const hash = comm.hash ?? comm.hashComunicacao ?? comm.hash_comunicacao
      const numeroComunicacao = comm.numeroComunicacao ?? comm.numero_comunicacao ?? null
      const dataDisponibilizacao = comm.dataDisponibilizacao ?? comm.data_disponibilizacao

      if (!djenId || !hash || !dataDisponibilizacao) {
        console.error('❌ Comunicação inválida (campos obrigatórios ausentes):', { djenId, hash, numeroComunicacao, dataDisponibilizacao })
        continue
      }

      const { data: existing, error: existingError } = await supabase
        .from('djen_comunicacoes')
        .select('id')
        .eq('hash', hash)
        .maybeSingle()

      if (existingError) console.error('⚠️ Erro ao verificar duplicidade por hash:', existingError)
      if (existing) continue

      let numeroProcesso = comm.numeroProcesso ?? comm.numero_processo ?? null

      if (!numeroProcesso && comm.texto) {
        const processMatch = comm.texto.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/i)
        if (processMatch) {
          numeroProcesso = processMatch[1]
          console.log(`   📋 Número extraído do texto: ${numeroProcesso}`)
        }
      }

      let processId = null
      let clientId = null
      let linkedProcess = null

      if (numeroProcesso) {
        const processNumber = numeroProcesso.replace(/[^0-9]/g, '')
        linkedProcess = processes.find((p: any) =>
          p.process_code?.replace(/[^0-9]/g, '') === processNumber
        )
        if (linkedProcess) {
          processId = linkedProcess.id
          clientId = linkedProcess.client_id
          console.log(`   🔗 Vinculado ao processo: ${linkedProcess.process_code}`)
        }
      }

      const { error } = await supabase
        .from('djen_comunicacoes')
        .insert({
          djen_id: djenId,
          hash,
          numero_comunicacao: comm.numeroComunicacao,
          numero_processo: numeroProcesso,
          numero_processo_mascara: comm.numeroProcessoMascara,
          sigla_tribunal: comm.siglaTribunal,
          nome_orgao: comm.nomeOrgao,
          texto: comm.texto,
          tipo_comunicacao: comm.tipoComunicacao,
          tipo_documento: comm.tipoDocumento,
          meio: comm.meio,
          meio_completo: comm.meioCompleto ?? comm.meiocompleto ?? comm.meio_completo,
          link: comm.link,
          data_disponibilizacao: dataDisponibilizacao,
          process_id: processId,
          client_id: clientId,
          lida: false,
          ativo: true,
        })

      if (error) {
        console.error('❌ Erro ao inserir comunicação DJEN:', { djenId, hash, numeroComunicacao, numeroProcesso: comm.numeroProcesso, dataDisponibilizacao, error })
      }

      if (!error) {
        savedCount++

        // Atualiza APENAS flags de sincronização — status é responsabilidade exclusiva
        // do trigger trg_recompute_process_status + _infer_process_stage (movimentos DataJud).
        if (linkedProcess && processId) {
          try {
            const updatePayload: any = {
              djen_synced: true,
              djen_last_sync: new Date().toISOString(),
              djen_has_data: true,
              updated_at: new Date().toISOString()
            }
            if (comm.nomeOrgao && !linkedProcess.court) {
              updatePayload.court = comm.nomeOrgao
            }
            await supabase.from('processes').update(updatePayload).eq('id', processId)
            if (!processesUpdated.includes(processId)) processesUpdated.push(processId)
          } catch (updateError) {
            console.error(`Erro ao atualizar processo ${processId}:`, updateError)
          }
        }
      }

    } catch (saveError) {
      console.error('Erro ao salvar comunicação:', saveError)
    }
  }

  return { saved: savedCount, processesUpdated }
}
