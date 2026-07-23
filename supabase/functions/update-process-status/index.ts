import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DJEN_BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1'

// Token para proteger o endpoint
const SYNC_TOKEN = Deno.env.get('DJEN_SYNC_TOKEN') || 'djen-sync-2024'

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log(`📥 UPDATE-PROCESS-STATUS request: ${req.method} ${req.url}`)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    // Validação de token desabilitada para cron do Supabase
    // const url = new URL(req.url)
    // const token = url.searchParams.get('token')
    // if (token !== SYNC_TOKEN) { ... }

    const executionId = crypto.randomUUID().substring(0, 8)
    const syncStartTime = new Date().toISOString()
    let syncLogId: string | null = null

    try {
      const { data: logRow } = await supabaseClient
        .from('djen_sync_history')
        .insert({
          id: crypto.randomUUID(),
          source: 'process_status_cron',
          origin: 'scheduled_trigger',
          trigger_type: 'update_process_status',
          status: 'running',
          run_started_at: syncStartTime,
          synced_at: syncStartTime,
          items_found: 0,
          items_saved: 0,
          success: false,
          message: `[${executionId}] Atualização automática de status iniciada`
        })
        .select('id')
        .single()

      syncLogId = logRow?.id ?? null
    } catch (logErr) {
      console.error('Falha ao criar log inicial de update-process-status:', logErr)
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`🚀 [${executionId}] UPDATE-PROCESS-STATUS - INICIANDO`)
    console.log(`📅 Data/Hora: ${new Date().toISOString()}`)
    console.log(`${'='.repeat(60)}\n`)

    // Buscar processos que NÃO estão arquivados
    const { data: processes, error: processError } = await supabaseClient
      .from('processes')
      .select('*')
      .neq('status', 'arquivado')
      .not('process_code', 'is', null)
      .neq('process_code', '')

    if (processError) {
      throw new Error(`Erro ao buscar processos: ${processError.message}`)
    }

    console.log(`📊 [${executionId}] Processos ativos encontrados: ${processes?.length || 0}`)

    let updated = 0
    let checked = 0
    let errors = 0
    const updates: Array<{ processId: string; processCode: string; oldStatus: string; newStatus: string }> = []
    const archivedWithDeadlines: Array<{ processId: string; processCode: string; deadlineCount: number }> = []

    for (const process of processes || []) {
      try {
        checked++
        const processNumber = process.process_code?.replace(/\D/g, '')
        
        if (!processNumber || processNumber.length !== 20) {
          continue
        }

        // Buscar última comunicação do processo no DJEN
        const params = new URLSearchParams({
          numeroProcesso: processNumber,
          itensPorPagina: '5',
          pagina: '1'
        })

        const response = await fetch(`${DJEN_BASE_URL}/comunicacao?${params}`)
        
        if (!response.ok) {
          console.log(`   ⚠️ Erro DJEN para ${process.process_code}: ${response.status}`)
          continue
        }

        const data = await response.json()
        
        if (!data.items || data.items.length === 0) {
          continue
        }

        // Analisar as últimas comunicações para detectar status
        let detectedStatus: string | null = null
        
        for (const comm of data.items) {
          const texto = (comm.texto || '').toLowerCase()
          const tipoComunicacao = (comm.tipoComunicacao || '').toLowerCase()
          
          // Detectar status baseado no texto
          detectedStatus = detectProcessStatus(texto, tipoComunicacao)
          
          if (detectedStatus) {
            break // Usar o primeiro status detectado (mais recente)
          }
        }

        // Se detectou um status diferente do atual, atualizar
        if (detectedStatus && detectedStatus !== process.status) {
          console.log(`   📊 ${process.process_code}: ${process.status} → ${detectedStatus}`)
          
          await supabaseClient
            .from('processes')
            .update({
              status: detectedStatus,
              djen_synced: true,
              djen_last_sync: new Date().toISOString(),
              djen_has_data: true,
              updated_at: new Date().toISOString()
            })
            .eq('id', process.id)

          updates.push({
            processId: process.id,
            processCode: process.process_code,
            oldStatus: process.status,
            newStatus: detectedStatus
          })
          
          updated++

          // Se o processo foi arquivado, verificar prazos pendentes
          if (detectedStatus === 'arquivado') {
            const { data: deadlines } = await supabaseClient
              .from('deadlines')
              .select('id')
              .eq('process_id', process.id)
              .eq('status', 'pendente')

            if (deadlines && deadlines.length > 0) {
              archivedWithDeadlines.push({
                processId: process.id,
                processCode: process.process_code,
                deadlineCount: deadlines.length
              })

              // Criar notificação para o responsável.
              // responsible_lawyer_id referencia profiles.id, mas
              // user_notifications.user_id exige auth.users.id — mapear via
              // profiles.user_id (senão a inserção falha por FK). O tipo também
              // precisa ser um valor válido do enum user_notification_type.
              if (process.responsible_lawyer_id) {
                const { data: prof } = await supabaseClient
                  .from('profiles')
                  .select('user_id')
                  .eq('id', process.responsible_lawyer_id)
                  .maybeSingle()
                const notifyUserId = prof?.user_id ?? null

                if (notifyUserId) {
                  await supabaseClient
                    .from('user_notifications')
                    .insert({
                      user_id: notifyUserId,
                      type: 'process_updated',
                      title: '⚠️ Processo arquivado com prazos pendentes',
                      message: `O processo ${process.process_code} foi arquivado mas possui ${deadlines.length} prazo(s) pendente(s). Verifique se os prazos devem ser concluídos ou cancelados.`,
                      process_id: process.id,
                      metadata: {
                        old_status: process.status,
                        new_status: 'arquivado',
                        pending_deadlines: deadlines.length
                      }
                    })

                  console.log(`   🔔 Notificação enviada: processo arquivado com ${deadlines.length} prazo(s) pendente(s)`)
                }
              }
            }
          }
        }

        // Delay entre requisições para não sobrecarregar a API
        await new Promise(resolve => setTimeout(resolve, 500))

      } catch (err: any) {
        errors++
        console.error(`   ❌ Erro ao processar ${process.process_code}:`, err.message)
      }
    }

    console.log(`\n📈 [${executionId}] RESULTADO:`)
    console.log(`   ✅ Verificados: ${checked}`)
    console.log(`   📊 Atualizados: ${updated}`)
    console.log(`   ⚠️ Arquivados com prazos: ${archivedWithDeadlines.length}`)
    console.log(`   ❌ Erros: ${errors}`)
    console.log(`${'='.repeat(60)}\n`)

    if (syncLogId) {
      try {
        await supabaseClient
          .from('djen_sync_history')
          .update({
            status: errors > 0 ? 'error' : 'success',
            run_finished_at: new Date().toISOString(),
            synced_at: new Date().toISOString(),
            items_found: checked,
            items_saved: updated,
            success: errors === 0,
            error_message: errors > 0 ? `${errors} erro(s) durante a execução` : null,
            message: `[${executionId}] Verificados: ${checked} | Atualizados: ${updated} | Erros: ${errors}`
          })
          .eq('id', syncLogId)
      } catch (logErr) {
        console.error('Falha ao finalizar log de update-process-status:', logErr)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Atualização de status concluída',
        stats: {
          checked,
          updated,
          errors,
          archivedWithDeadlines: archivedWithDeadlines.length,
          updates,
          archivedWithDeadlinesDetails: archivedWithDeadlines
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error: any) {
    console.error('❌ Erro no endpoint:', error)

    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      const now = new Date().toISOString()
      await supabaseClient
        .from('djen_sync_history')
        .insert({
          id: crypto.randomUUID(),
          source: 'process_status_cron',
          origin: 'scheduled_trigger',
          trigger_type: 'update_process_status',
          status: 'error',
          run_started_at: now,
          run_finished_at: now,
          synced_at: now,
          items_found: 0,
          items_saved: 0,
          success: false,
          error_message: error.message || 'Erro interno do servidor',
          message: 'Falha na atualização automática de status'
        })
    } catch (logErr) {
      console.error('Falha ao registrar erro no djen_sync_history:', logErr)
    }
    
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

// Detecta status do processo baseado no texto da intimação
function detectProcessStatus(texto: string, tipoComunicacao?: string): string | null {
  if (!texto) return null
  
  const textoLower = texto.toLowerCase()
  
  // Arquivado
  if (textoLower.includes('arquivamento definitivo') || 
      textoLower.includes('autos arquivados') ||
      textoLower.includes('baixa definitiva') ||
      textoLower.includes('arquivem-se os autos') ||
      textoLower.includes('arquive-se definitivamente') ||
      (textoLower.includes('arquivado') && textoLower.includes('transitado'))) {
    return 'arquivado'
  }

  // Cumprimento de sentença
  if (textoLower.includes('cumprimento de sentença') || 
      textoLower.includes('fase de cumprimento') ||
      textoLower.includes('liquidação de sentença') ||
      textoLower.includes('execução de título')) {
    return 'cumprimento'
  }

  // Sentença de mérito (1º grau) — VERIFICADA ANTES de recurso/acórdão porque
  // sentenças costumam CITAR jurisprudência de "Turma Recursal", "apelação",
  // "embargos" etc. no corpo. Detectar o mérito primeiro evita classificar
  // erroneamente a própria sentença como recurso. Robusta a variações do
  // dispositivo ("parcial procedência", "opino pela procedência", projeto de
  // sentença de Juiz Leigo).
  if (/julgo\s+(parcialmente\s+|totalmente\s+|integralmente\s+)?(procedent|improcedent)/.test(textoLower) ||
      /pela\s+(parcial\s+)?proced[êe]ncia/.test(textoLower) ||
      /parcial\s+proced[êe]ncia/.test(textoLower) ||
      /proced[êe]ncia\s+parcial/.test(textoLower) ||
      /projeto\s+de\s+senten[çc]a/.test(textoLower) ||
      textoLower.includes('homologo o acordo') ||
      textoLower.includes('extingo o processo') ||
      textoLower.includes('julgo extinto') ||
      textoLower.includes('resolvo o mérito') ||
      textoLower.includes('sentença proferida')) {
    return 'sentenca'
  }

  // Acórdão / decisão de instância recursal (Turma Recursal, Câmara).
  if (/ac[óo]rd[ãa]o|turma recursal|c[âa]mara c[íi]vel|(dou|nego|deram|negaram|dar|negar)\s+provimento|recurso\s+(conhecido|provido|improvido|desprovido)/.test(textoLower)) {
    return 'recurso'
  }

  // Recurso em trâmite/interposição — fallback após a sentença de mérito, com
  // contexto de recurso real (evita falso positivo por citação no corpo).
  if (textoLower.includes('recurso inominado') ||
      textoLower.includes('agravo de instrumento') ||
      textoLower.includes('agravo interno') ||
      textoLower.includes('recurso especial') ||
      textoLower.includes('recurso extraordinário') ||
      textoLower.includes('recurso ordinário') ||
      (textoLower.includes('apelação') && (textoLower.includes('interpos') || textoLower.includes('recebid') || textoLower.includes('razões')))) {
    return 'recurso'
  }

  // Instrução
  if (textoLower.includes('audiência de instrução') ||
      textoLower.includes('instrução e julgamento') ||
      textoLower.includes('produção de provas') ||
      textoLower.includes('oitiva de testemunhas') ||
      textoLower.includes('perícia designada')) {
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

  // Distribuído
  if (textoLower.includes('distribuído') ||
      textoLower.includes('distribuição')) {
    return 'distribuido'
  }

  return null
}
