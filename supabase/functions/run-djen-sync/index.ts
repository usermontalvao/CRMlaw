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

// Token simples para proteger o endpoint (pode ser alterado)
const SYNC_TOKEN = Deno.env.get('DJEN_SYNC_TOKEN') || 'djen-sync-2024'

// OpenAI API Key para análise automática
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log(`📥 DJEN SYNC request: ${req.method} ${req.url}`)
    // Verificar token de segurança
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    // Varredura direcionada: ?processCode=XXX força sync histórico só desse processo
    const onlyProcessCode = (url.searchParams.get('processCode') || '').replace(/[^0-9]/g, '') || null

    const nowIso = new Date().toISOString()
    const dateRangeStart = getDateDaysAgo(7)
    const dateRangeEnd = getDateToday()

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // TEMPORÁRIO: Validação desabilitada para testes
    // TODO: Reabilitar após confirmar que funciona
    /*
    if (token !== SYNC_TOKEN) {
      try {
        await supabaseClient
          .from('djen_sync_history')
          .insert({
            id: crypto.randomUUID(),
            synced_at: nowIso,
            date_range_start: dateRangeStart,
            date_range_end: dateRangeEnd,
            items_found: 0,
            items_saved: 0,
            success: false,
            source: 'cron_supabase',
            origin: 'scheduled_trigger',
            trigger_type: 'pg_cron',
            status: 'error',
            run_started_at: nowIso,
            run_finished_at: nowIso,
            error_message: 'Token inválido',
            message: 'Execução bloqueada: token inválido'
          })
      } catch (e) {
        console.error('Falha ao registrar token inválido em djen_sync_history:', e)
      }

      return new Response(
        JSON.stringify({ error: 'Token inválido' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }
    */
    
    console.log(`🔑 Token recebido: "${token}"`)
    console.log(`🔑 Token esperado: "${SYNC_TOKEN}"`)
    console.log(`✅ Validação de token DESABILITADA (modo teste)`)

    const executionId = crypto.randomUUID().substring(0, 8)
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🚀 [${executionId}] CRON DJEN SYNC - INICIANDO`)
    console.log(`📅 Data/Hora: ${new Date().toISOString()}`)
    console.log(`${'='.repeat(60)}\n`)

    // Registrar início da execução
    const syncStartTime = new Date().toISOString()
    
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
    let errorMessage = null

    try {
      // Buscar perfis com nome DJEN configurado
      const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('lawyer_full_name')
        .not('lawyer_full_name', 'is', null)
        .neq('lawyer_full_name', '')

      // Buscar processos para tentativa de vinculação (não restringir apenas a status "andamento")
      // Importante: a vinculação por número do processo precisa funcionar também para processos arquivados, em recurso, etc.
      const { data: processes } = await supabaseClient
        .from('processes')
        .select('*')
        .limit(1000)

      // Descobrir quais processos JÁ TÊM publicações DJEN reais (texto integral).
      // Não confiar na flag djen_has_data — ela é setada também pelo datajud-sync.
      const { data: djenExistentes } = await supabaseClient
        .from('djen_comunicacoes')
        .select('process_id')
        .not('process_id', 'is', null)
      const processIdsComDjen = new Set((djenExistentes || []).map((d: any) => d.process_id))

      console.log(`\n📊 [${executionId}] DADOS ENCONTRADOS:`)
      console.log(`   👤 Perfis com advogado: ${profiles?.length || 0}`)
      console.log(`   📁 Processos: ${processes?.length || 0}`)
      console.log(`   📰 Processos com DJEN existente: ${processIdsComDjen.size}`)

      if (profiles && profiles.length > 0) {
        console.log(`\n🔄 [${executionId}] ETAPA 1: Sincronização por advogado`)
        // Sincronizar por nome do advogado
        for (const profile of profiles) {
          if (!profile.lawyer_full_name) continue

          console.log(`   🔍 Buscando: ${profile.lawyer_full_name}`)

          const params = new URLSearchParams({
            nomeAdvogado: profile.lawyer_full_name,
            dataDisponibilizacaoInicio: getDateDaysAgo(7),
            dataDisponibilizacaoFim: getDateToday(),
            meio: 'D',
            itensPorPagina: '100',
            pagina: '1'
          })

          const response = await fetch(`${DJEN_BASE_URL}/comunicacao?${params}`)
          
          if (response.ok) {
            const data = await response.json()
            if (data.items && data.items.length > 0) {
              totalFound += data.items.length
              
              // Salvar comunicações no banco
              const result = await saveCommunications(supabaseClient, data.items, processes || [])
              totalSaved += result.saved
            }
          }

          // Aguardar entre requisições
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      // Sincronizar por processos cadastrados
      if (processes && processes.length > 0) {
        console.log(`\n🔄 [${executionId}] ETAPA 2: Sincronização por processo`)

        // Separar por existência REAL de publicações DJEN (não pela flag djen_has_data)
        let validos = (processes as any[]).filter(
          p => p.process_code?.replace(/[^0-9]/g, '').length === 20
        )
        // Se varredura direcionada, restringe a um único processo e força histórico
        if (onlyProcessCode) {
          validos = validos.filter(p => p.process_code.replace(/[^0-9]/g, '') === onlyProcessCode)
          processIdsComDjen.clear() // força ramo "sem dados" (varredura histórica)
        }
        const processesSemDados = validos.filter(p => !processIdsComDjen.has(p.id))
        const processesComDados = onlyProcessCode ? [] : validos.filter(p => processIdsComDjen.has(p.id))

        console.log(`   📋 Processos sem histórico DJEN: ${processesSemDados.length}`)
        console.log(`   📋 Processos com histórico DJEN: ${processesComDados.length}`)

        // ── Processos COM dados: janela normal de 7 dias ──
        for (const proc of processesComDados) {
          const processNumber = proc.process_code.replace(/[^0-9]/g, '')
          const params = new URLSearchParams({
            numeroProcesso: processNumber,
            dataDisponibilizacaoInicio: getDateDaysAgo(7),
            dataDisponibilizacaoFim: getDateToday(),
            meio: 'D',
            itensPorPagina: '100',
            pagina: '1'
          })
          const response = await fetch(`${DJEN_BASE_URL}/comunicacao?${params}`)
          if (response.ok) {
            const data = await response.json()
            if (data.items?.length > 0) {
              totalFound += data.items.length
              const result = await saveCommunications(supabaseClient, data.items, processes)
              totalSaved += result.saved
            }
          }
          await new Promise(r => setTimeout(r, 800))
        }

        // ── Processos SEM dados: varredura histórica em janelas de 1 ANO ──
        // A API do DJEN aceita janelas amplas (testado: ano inteiro OK).
        // Varre até 4 anos atrás (1460 dias) — ~5 requisições por processo.
        const MAX_DAYS_BACK = 1460 // 4 anos
        const WINDOW = 365         // janela anual por requisição

        for (const proc of processesSemDados) {
          const processNumber = proc.process_code.replace(/[^0-9]/g, '')
          console.log(`   🔍 Histórico completo: ${processNumber.substring(0, 7)}...`)

          let foundAny = false
          let windowEnd = new Date()

          // Varrer do mais recente para o mais antigo
          while (true) {
            const windowStart = new Date(windowEnd)
            windowStart.setDate(windowStart.getDate() - WINDOW)

            // Limite máximo: não buscar além de MAX_DAYS_BACK
            const cutoff = new Date()
            cutoff.setDate(cutoff.getDate() - MAX_DAYS_BACK)
            if (windowEnd <= cutoff) break

            const inicio = windowStart < cutoff ? cutoff : windowStart

            const params = new URLSearchParams({
              numeroProcesso: processNumber,
              dataDisponibilizacaoInicio: inicio.toISOString().split('T')[0],
              dataDisponibilizacaoFim: windowEnd.toISOString().split('T')[0],
              meio: 'D',
              itensPorPagina: '100',
              pagina: '1'
            })

            const response = await fetch(`${DJEN_BASE_URL}/comunicacao?${params}`)
            if (response.ok) {
              const data = await response.json()
              if (data.items?.length > 0) {
                totalFound += data.items.length
                const result = await saveCommunications(supabaseClient, data.items, processes)
                totalSaved += result.saved
                foundAny = true
                console.log(`      ✅ ${data.items.length} publicações em ${inicio.toISOString().split('T')[0]} ~ ${windowEnd.toISOString().split('T')[0]}`)
              }
            }

            // Mover janela para o período anterior
            windowEnd = new Date(windowStart)
            windowEnd.setDate(windowEnd.getDate() - 1)

            await new Promise(r => setTimeout(r, 800))
          }

          if (!foundAny) {
            console.log(`      ℹ️  Nenhuma publicação DJEN encontrada em 4 anos`)
          }
        }
      }

    } catch (syncError: any) {
      errorMessage = syncError.message
      console.error('❌ Erro durante sincronização:', syncError)
    }

    // Atualizar log de sincronização
    const syncEndTime = new Date().toISOString()
    const finalStatus = errorMessage ? 'error' : 'success'
    const finalSuccess = !errorMessage

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
          error_message: errorMessage,
          message: errorMessage || `Sincronização concluída: ${totalSaved} intimações salvas de ${totalFound} encontradas`
        })
        .eq('id', syncLog.id)
    }

    console.log(`\n📈 [${executionId}] RESULTADO SINCRONIZAÇÃO:`)
    console.log(`   📥 Encontradas: ${totalFound}`)
    console.log(`   💾 Salvas: ${totalSaved}`)
    console.log(`   ⏱️ Status: ${finalStatus}`)

    // ========================================
    // ANÁLISE AUTOMÁTICA + NOTIFICAÇÕES (quase realtime)
    // ========================================
    let totalAnalyzed = 0
    let totalNotified = 0
    let analysisError: string | null = null

    if (totalSaved > 0) {
      console.log(`\n🤖 [${executionId}] ETAPA 3: Analisar intimações e gerar notificações (analyze-intimations)`)
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        if (!supabaseUrl) {
          throw new Error('SUPABASE_URL não configurada')
        }

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
            // Se não for JSON, só loga
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

    // Log final
    const totalDuration = ((new Date().getTime() - new Date(syncStartTime).getTime()) / 1000).toFixed(1)
    console.log(`\n${'='.repeat(60)}`)
    console.log(`✅ [${executionId}] CRON DJEN SYNC - FINALIZADO`)
    console.log(`   📥 Encontradas: ${totalFound} | 💾 Salvas: ${totalSaved} | 🤖 Analisadas: ${totalAnalyzed} | 🔔 Notificadas: ${totalNotified}`)
    console.log(`   ⏱️ Duração: ${totalDuration}s`)
    console.log(`${'='.repeat(60)}\n`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sincronização DJEN + Análise IA concluída`,
        stats: {
          found: totalFound,
          saved: totalSaved,
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
      JSON.stringify({
        success: false,
        error: error.message || 'Erro interno do servidor'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// Funções auxiliares
function getDateToday(): string {
  return new Date().toISOString().split('T')[0]
}

function getDateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().split('T')[0]
}

// Função para analisar intimação com IA
async function analyzeIntimation(texto: string, tipoComunicacao: string): Promise<any> {
  if (!OPENAI_API_KEY || !texto) return null

  const prompt = `Analise esta intimação judicial e retorne um JSON com:
- summary: resumo em 1-2 frases
- urgency: "alta", "media" ou "baixa"
- deadline_days: número de dias para prazo (se mencionado, senão null)
- action_required: true/false se requer ação imediata
- key_points: array com até 3 pontos principais

Tipo: ${tipoComunicacao || 'Intimação'}
Texto: ${texto.substring(0, 2000)}

Responda APENAS com o JSON, sem markdown.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é um assistente jurídico especializado em análise de intimações. Responda sempre em JSON válido.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      console.error('Erro OpenAI:', await response.text())
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) return null

    // Tentar parsear JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    return null
  } catch (error) {
    console.error('Erro ao analisar com IA:', error)
    return null
  }
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
        console.error('❌ Comunicação inválida (campos obrigatórios ausentes):', {
          djenId,
          hash,
          numeroComunicacao,
          dataDisponibilizacao,
        })
        continue
      }

      // Verificar se já existe (hash é UNIQUE na tabela)
      const { data: existing, error: existingError } = await supabase
        .from('djen_comunicacoes')
        .select('id')
        .eq('hash', hash)
        .maybeSingle()

      if (existingError) {
        console.error('⚠️ Erro ao verificar duplicidade por hash:', existingError)
      }

      if (existing) continue // Já existe

      // Extrair número do processo (da API ou do texto)
      let numeroProcesso = comm.numeroProcesso ?? comm.numero_processo ?? null
      
      // Se não veio da API, tentar extrair do texto
      if (!numeroProcesso && comm.texto) {
        // Padrão CNJ: 1234567-12.1234.1.12.1234 ou variações
        const processMatch = comm.texto.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/i)
        if (processMatch) {
          numeroProcesso = processMatch[1]
          console.log(`   📋 Número extraído do texto: ${numeroProcesso}`)
        }
      }

      // Tentar vincular com processo cadastrado
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

      // Salvar comunicação
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
        console.error('❌ Erro ao inserir comunicação DJEN:', {
          djenId,
          hash,
          numeroComunicacao,
          numeroProcesso: comm.numeroProcesso,
          dataDisponibilizacao,
          error,
        })
      }

      if (!error) {
        savedCount++
        
        // Se vinculou a um processo, atualizar status e flags do processo
        if (linkedProcess && processId) {
          try {
            const newStatus = detectProcessStatus(comm.texto, comm.tipoComunicacao)
            const updatePayload: any = {
              djen_synced: true,
              djen_last_sync: new Date().toISOString(),
              djen_has_data: true,
              updated_at: new Date().toISOString()
            }
            
            // Atualizar status se detectou um novo
            if (newStatus && newStatus !== linkedProcess.status) {
              updatePayload.status = newStatus
              console.log(`📊 Processo ${processId}: ${linkedProcess.status} → ${newStatus}`)
            }
            
            await supabase
              .from('processes')
              .update(updatePayload)
              .eq('id', processId)
            
            if (!processesUpdated.includes(processId)) {
              processesUpdated.push(processId)
            }
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

// Detecta status do processo baseado no texto da intimação
function detectProcessStatus(texto: string, tipoComunicacao?: string): string | null {
  if (!texto) return null
  
  const textoLower = texto.toLowerCase()
  
  // Arquivado
  if (textoLower.includes('arquivamento definitivo') || 
      textoLower.includes('autos arquivados') ||
      textoLower.includes('baixa definitiva') ||
      (textoLower.includes('arquivado') && textoLower.includes('transitado'))) {
    return 'arquivado'
  }

  // Cumprimento de sentença
  if (textoLower.includes('cumprimento de sentença') || 
      textoLower.includes('fase de cumprimento') ||
      textoLower.includes('liquidação de sentença')) {
    return 'cumprimento'
  }

  // Recurso
  if (textoLower.includes('apelação') ||
      textoLower.includes('agravo de instrumento') ||
      textoLower.includes('agravo interno') ||
      textoLower.includes('embargos de declaração') ||
      textoLower.includes('recurso especial') ||
      textoLower.includes('recurso extraordinário')) {
    return 'recurso'
  }

  // Sentença
  if (textoLower.includes('julgo procedente') || 
      textoLower.includes('julgo improcedente') ||
      textoLower.includes('julgo parcialmente procedente') ||
      textoLower.includes('extingo o processo') ||
      textoLower.includes('homologo o acordo')) {
    return 'sentenca'
  }

  // Instrução
  if (textoLower.includes('audiência de instrução') ||
      textoLower.includes('instrução e julgamento') ||
      textoLower.includes('produção de provas') ||
      textoLower.includes('oitiva de testemunhas')) {
    return 'instrucao'
  }

  // Conciliação
  if (textoLower.includes('audiência de conciliação') ||
      textoLower.includes('conciliação virtual') ||
      textoLower.includes('conciliação designada') ||
      textoLower.includes('pauta de conciliação')) {
    return 'conciliacao'
  }

  // Contestação
  if (textoLower.includes('contestação') || 
      textoLower.includes('defesa apresentada') ||
      textoLower.includes('juntada de contestação')) {
    return 'contestacao'
  }

  // Citação
  if (textoLower.includes('citação') || 
      textoLower.includes('cite-se') ||
      textoLower.includes('fica citado')) {
    return 'citacao'
  }

  // Em andamento genérico
  if (textoLower.includes('intimação') ||
      textoLower.includes('despacho') ||
      textoLower.includes('prazo') ||
      textoLower.includes('manifestação')) {
    return 'andamento'
  }

  return null
}
