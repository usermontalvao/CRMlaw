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
    
    // Verificar token de segurança
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    if (token !== SYNC_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'Token inválido' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const executionId = crypto.randomUUID().substring(0, 8)
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

              // Criar notificação para o responsável
              if (process.responsible_lawyer_id) {
                await supabaseClient
                  .from('user_notifications')
                  .insert({
                    user_id: process.responsible_lawyer_id,
                    type: 'deadline_alert',
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

  // Recurso
  if (textoLower.includes('apelação') ||
      textoLower.includes('agravo de instrumento') ||
      textoLower.includes('agravo interno') ||
      textoLower.includes('embargos de declaração') ||
      textoLower.includes('recurso especial') ||
      textoLower.includes('recurso extraordinário') ||
      textoLower.includes('recurso ordinário')) {
    return 'recurso'
  }

  // Sentença
  if (textoLower.includes('julgo procedente') || 
      textoLower.includes('julgo improcedente') ||
      textoLower.includes('julgo parcialmente procedente') ||
      textoLower.includes('extingo o processo') ||
      textoLower.includes('homologo o acordo') ||
      textoLower.includes('sentença proferida')) {
    return 'sentenca'
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
