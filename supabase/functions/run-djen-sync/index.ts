import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DJEN_BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1'

// Token simples para proteger o endpoint (pode ser alterado)
const SYNC_TOKEN = Deno.env.get('DJEN_SYNC_TOKEN') || 'djen-sync-2024'

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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

    console.log('🚀 Iniciando sincronização DJEN via link público...')

    // Registrar início da execução
    const syncStartTime = new Date().toISOString()
    
    const { data: syncLog } = await supabaseClient
      .from('djen_sync_history')
      .insert({
        source: 'public_link',
        origin: 'manual_trigger',
        trigger_type: 'http_request',
        status: 'running',
        run_started_at: syncStartTime,
        message: 'Sincronização iniciada via link público'
      })
      .select()
      .single()

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

      // Buscar processos em andamento
      const { data: processes } = await supabaseClient
        .from('processes')
        .select('*')
        .eq('status', 'andamento')
        .limit(50)

      if (profiles && profiles.length > 0) {
        // Sincronizar por nome do advogado
        for (const profile of profiles) {
          if (!profile.lawyer_full_name) continue

          console.log(`🔍 Buscando intimações para: ${profile.lawyer_full_name}`)

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
              const saved = await saveCommunications(supabaseClient, data.items, processes || [])
              totalSaved += saved
            }
          }

          // Aguardar entre requisições
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      // Sincronizar por processos cadastrados
      if (processes && processes.length > 0) {
        const processNumbers = processes
          .map(p => p.process_code?.replace(/\D/g, ''))
          .filter(code => code && code.length === 20)

        for (const processNumber of processNumbers.slice(0, 10)) { // Limitar a 10 processos
          console.log(`🔍 Buscando intimações para processo: ${processNumber}`)

          const params = new URLSearchParams({
            numeroProcesso: processNumber,
            dataDisponibilizacaoInicio: getDateDaysAgo(30),
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
              const saved = await saveCommunications(supabaseClient, data.items, processes)
              totalSaved += saved
            }
          }

          // Aguardar entre requisições
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

    } catch (syncError: any) {
      errorMessage = syncError.message
      console.error('❌ Erro durante sincronização:', syncError)
    }

    // Atualizar log de sincronização
    const syncEndTime = new Date().toISOString()
    const finalStatus = errorMessage ? 'error' : 'success'

    if (syncLog) {
      await supabaseClient
        .from('djen_sync_history')
        .update({
          status: finalStatus,
          run_finished_at: syncEndTime,
          items_found: totalFound,
          items_saved: totalSaved,
          error_message: errorMessage,
          message: errorMessage || `Sincronização concluída: ${totalSaved} intimações salvas de ${totalFound} encontradas`
        })
        .eq('id', syncLog.id)
    }

    console.log(`✅ Sincronização concluída: ${totalSaved} intimações salvas de ${totalFound} encontradas`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sincronização DJEN concluída`,
        stats: {
          found: totalFound,
          saved: totalSaved,
          status: finalStatus,
          started_at: syncStartTime,
          finished_at: syncEndTime
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

async function saveCommunications(supabase: any, communications: any[], processes: any[]): Promise<number> {
  let savedCount = 0

  for (const comm of communications) {
    try {
      // Verificar se já existe
      const { data: existing } = await supabase
        .from('djen_comunicacoes_local')
        .select('id')
        .eq('numero_comunicacao', comm.numeroComunicacao)
        .single()

      if (existing) continue // Já existe

      // Tentar vincular com processo
      let processId = null
      let clientId = null

      if (comm.numeroProcesso) {
        const processNumber = comm.numeroProcesso.replace(/\D/g, '')
        const process = processes.find(p => 
          p.process_code?.replace(/\D/g, '') === processNumber
        )
        
        if (process) {
          processId = process.id
          clientId = process.client_id
        }
      }

      // Salvar comunicação
      const { error } = await supabase
        .from('djen_comunicacoes_local')
        .insert({
          numero_comunicacao: comm.numeroComunicacao,
          numero_processo: comm.numeroProcesso,
          numero_processo_mascara: comm.numeroProcessoMascara,
          sigla_tribunal: comm.siglaTribunal,
          nome_orgao: comm.nomeOrgao,
          texto: comm.texto,
          tipo_comunicacao: comm.tipoComunicacao,
          tipo_documento: comm.tipoDocumento,
          meio: comm.meio,
          meio_completo: comm.meiocompleto,
          link: comm.link,
          data_disponibilizacao: comm.data_disponibilizacao,
          process_id: processId,
          client_id: clientId,
          lida: false
        })

      if (!error) {
        savedCount++
      }

    } catch (saveError) {
      console.error('Erro ao salvar comunicação:', saveError)
    }
  }

  return savedCount
}
