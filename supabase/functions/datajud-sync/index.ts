/**
 * datajud-sync — Edge Function
 *
 * Sincroniza andamentos processuais da API pública DataJud (CNJ) para a tabela
 * datajud_movimentos e atualiza automaticamente o estágio de cada processo.
 *
 * Fluxo:
 *   1. Busca todos os processos ativos com process_code válido
 *   2. Para cada processo, consulta a API DataJud diretamente (sem CORS, server-side)
 *   3. Faz upsert dos movimentos em datajud_movimentos
 *   4. Determina o estágio pelo movimento mais recente relevante
 *   5. Atualiza processes.status se mudou
 *
 * Roda: a cada 2 dias às 06:00 via pg_cron (job #16)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br'
const DATAJUD_DEFAULT_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=='

// ── Mapeamento processo → alias do tribunal (porta de datajud.service.ts) ──────

const STATE_ALIASES: Record<number, string> = {
  1:'tjac', 2:'tjal', 3:'tjap', 4:'tjam', 5:'tjba', 6:'tjce', 7:'tjdft',
  8:'tjes', 9:'tjgo', 10:'tjma', 11:'tjmt', 12:'tjms', 13:'tjmg', 14:'tjpa',
  15:'tjpb', 16:'tjpr', 17:'tjpe', 18:'tjpi', 19:'tjrj', 20:'tjrn', 21:'tjrs',
  22:'tjro', 23:'tjrr', 24:'tjsc', 25:'tjsp', 26:'tjse', 27:'tjto',
}

const ELECTORAL_ALIASES: Record<number, string> = {
  1:'tre-ac', 2:'tre-al', 3:'tre-am', 4:'tre-ap', 5:'tre-ba',
  6:'tre-ce', 7:'tre-dft', 8:'tre-es', 9:'tre-go', 10:'tre-ma',
  11:'tre-mg', 12:'tre-ms', 13:'tre-mt', 14:'tre-pa', 15:'tre-pb',
  16:'tre-pe', 17:'tre-pi', 18:'tre-pr', 19:'tre-rj', 20:'tre-rn',
  21:'tre-ro', 22:'tre-rr', 23:'tre-rs', 24:'tre-sc', 25:'tre-se',
  26:'tre-sp', 27:'tre-to',
}

const MILITARY_STATE_ALIASES: Record<number, string> = {
  13:'tjmmg', 21:'tjmrs', 25:'tjmsp',
}

function getTribunalAlias(processCode: string): string | null {
  const digits = processCode.replace(/\D/g, '')
  if (digits.length !== 20) return null
  const j = digits[13]
  const tt = parseInt(digits.substring(14, 16), 10)
  switch (j) {
    case '8': return STATE_ALIASES[tt] ? `api_publica_${STATE_ALIASES[tt]}` : null
    case '4': return tt >= 1 && tt <= 6 ? `api_publica_trf${tt}` : null
    case '5': return tt === 0 ? 'api_publica_tst' : (tt >= 1 && tt <= 24 ? `api_publica_trt${tt}` : null)
    case '6': return tt === 0 ? 'api_publica_tse' : (ELECTORAL_ALIASES[tt] ? `api_publica_${ELECTORAL_ALIASES[tt]}` : null)
    case '3': return 'api_publica_stj'
    case '7': return 'api_publica_stm'
    case '9': return MILITARY_STATE_ALIASES[tt] ? `api_publica_${MILITARY_STATE_ALIASES[tt]}` : null
    default:  return null
  }
}

// ── Categorização de movimentos (porta de datajud.service.ts) ─────────────────

type MovimentoCategoria = 'sentenca' | 'decisao' | 'audiencia' | 'citacao' | 'recurso' | 'arquivamento' | 'despacho' | 'outro'

function categorizarMovimento(codigo: number, nome: string): MovimentoCategoria {
  const n = nome.toLowerCase()
  if ([55, 196, 848, 849, 861, 862].includes(codigo) || n.includes('sentença') || n.includes('sentenca')) return 'sentenca'
  if ([11, 22, 471, 472].includes(codigo) || n.includes('decisão') || n.includes('decisao') || n.includes('acórdão')) return 'decisao'
  if ([132, 7, 9].includes(codigo) || n.includes('despacho')) return 'despacho'
  if ([971, 972, 974].includes(codigo) || n.includes('audiência') || n.includes('audiencia') || n.includes('sessão')) return 'audiencia'
  if ([65, 159, 1259].includes(codigo) || n.includes('citação') || n.includes('citacao') || n.includes('intimação') || n.includes('intimacao')) return 'citacao'
  if ([197, 237, 238, 239, 240].includes(codigo) || n.includes('recurso') || n.includes('apelação') || n.includes('agravo')) return 'recurso'
  if ([246, 248].includes(codigo) || n.includes('arquiv') || n.includes('extinção') || n.includes('extincao')) return 'arquivamento'
  return 'outro'
}

// ── Mapeamento categoria + nome → ProcessStatus ───────────────────────────────

function detectarEstagioMovimento(categoria: MovimentoCategoria, nome: string): string | null {
  const n = nome.toLowerCase()
  switch (categoria) {
    case 'sentenca':    return 'sentenca'
    case 'recurso':     return 'recurso'
    case 'arquivamento': return 'arquivado'
    case 'citacao':     return 'citacao'
    case 'audiencia':
      if (n.includes('conciliação') || n.includes('conciliacao') || n.includes('mediação')) return 'conciliacao'
      if (n.includes('instrução') || n.includes('instrucao') || n.includes('julgamento')) return 'instrucao'
      return 'andamento'
    case 'decisao':
      if (n.includes('cumprimento') || n.includes('execução') || n.includes('liquidação')) return 'cumprimento'
      return 'andamento'
    case 'despacho':    return 'andamento'
    default:            return null
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const executionId = crypto.randomUUID().substring(0, 8)
  const startedAt = new Date().toISOString()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`🚀 [${executionId}] DATAJUD SYNC — INICIANDO`)
  console.log(`📅 ${startedAt}`)
  console.log(`${'='.repeat(60)}\n`)

  // Ler chave da API DataJud do banco (configurável pelo admin)
  let datajudApiKey = DATAJUD_DEFAULT_KEY
  try {
    const { data: settings } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'datajud_api_key')
      .maybeSingle()
    if (settings?.value && typeof settings.value === 'string' && settings.value.trim()) {
      datajudApiKey = settings.value.trim()
    }
  } catch (_) { /* usa chave padrão */ }

  // Buscar TODOS os processos com código válido (incluindo arquivados)
  const { data: processes, error: procErr } = await supabase
    .from('processes')
    .select('id, process_code, status')
    .not('process_code', 'is', null)
    .neq('process_code', '')

  if (procErr) {
    console.error('❌ Erro ao buscar processos:', procErr.message)
    return new Response(JSON.stringify({ success: false, error: procErr.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    })
  }

  const activeProcesses = (processes ?? []).filter((p: any) => {
    const digits = (p.process_code ?? '').replace(/\D/g, '')
    return digits.length === 20
  })

  console.log(`📊 [${executionId}] Processos válidos (todos os status): ${activeProcesses.length}`)

  let totalMovimentos = 0
  let totalNovos = 0
  let totalStatusUpdated = 0
  let errors = 0

  for (const proc of activeProcesses) {
    try {
      const alias = getTribunalAlias(proc.process_code)
      if (!alias) {
        console.log(`   ⚠️ Alias não encontrado para ${proc.process_code}`)
        continue
      }

      const digits = proc.process_code.replace(/\D/g, '')
      const url = `${DATAJUD_BASE_URL}/${alias}/_search`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `APIKey ${datajudApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          size: 1,
          query: { match: { numeroProcesso: digits } },
          _source: ['numeroProcesso', 'tribunal', 'grau', 'orgaoJulgador', 'movimentos'],
        }),
        signal: AbortSignal.timeout(12_000),
      })

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`   ℹ️ ${proc.process_code}: não encontrado no DataJud`)
        } else {
          console.log(`   ⚠️ ${proc.process_code}: HTTP ${response.status}`)
          errors++
        }
        await new Promise(r => setTimeout(r, 800))
        continue
      }

      const data = await response.json()
      const hit = data?.hits?.hits?.[0]

      if (!hit?._source?.movimentos?.length) {
        console.log(`   ℹ️ ${proc.process_code}: sem movimentos`)
        await new Promise(r => setTimeout(r, 500))
        continue
      }

      const src = hit._source
      const tribunal = alias.replace('api_publica_', '').toUpperCase()
      const grau = src.grau ?? null
      const movimentos: any[] = src.movimentos ?? []

      totalMovimentos += movimentos.length

      // Upsert de cada movimento
      let melhorEstagio: string | null = null
      let melhorDataHora = ''

      for (const mov of movimentos) {
        const codigo = mov.codigo ?? null
        const nome = mov.nome ?? ''
        const dataHora = mov.dataHora ?? null
        if (!nome || !dataHora) continue

        const categoria = categorizarMovimento(codigo ?? 0, nome)
        const estagio = detectarEstagioMovimento(categoria, nome)
        const orgaoJulgador = mov.orgaoJulgador?.nomeOrgao ?? null
        const complementos = mov.complementosTabelados?.length ? mov.complementosTabelados : null

        const { error: upsertErr } = await supabase
          .from('datajud_movimentos')
          .upsert({
            process_id: proc.id,
            process_code: proc.process_code,
            tribunal,
            grau,
            codigo,
            nome,
            data_hora: dataHora,
            orgao_julgador: orgaoJulgador,
            complementos,
            categoria,
            process_stage: estagio,
          }, {
            onConflict: 'process_code,codigo,data_hora',
            ignoreDuplicates: false,
          })

        if (!upsertErr) {
          totalNovos++
          // Rastrear o movimento mais recente com estágio identificado
          if (estagio && (!melhorDataHora || dataHora > melhorDataHora)) {
            melhorEstagio = estagio
            melhorDataHora = dataHora
          }
        }
      }

      // Atualizar status do processo pelo movimento mais recente relevante
      if (melhorEstagio && melhorEstagio !== proc.status) {
        const { error: statusErr } = await supabase
          .from('processes')
          .update({
            status: melhorEstagio,
            djen_synced: true,
            djen_last_sync: new Date().toISOString(),
            djen_has_data: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', proc.id)

        if (!statusErr) {
          console.log(`   📊 ${proc.process_code}: ${proc.status} → ${melhorEstagio}`)
          totalStatusUpdated++
        } else {
          console.error(`   ❌ Erro ao atualizar status ${proc.process_code}: ${statusErr.message}`)
        }
      }

      // Delay entre requisições para não sobrecarregar a API
      await new Promise(r => setTimeout(r, 1000))

    } catch (err: any) {
      errors++
      console.error(`   ❌ Erro ao processar ${proc.process_code}:`, err.message)
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`\n📈 [${executionId}] RESULTADO:`)
  console.log(`   📁 Processos verificados: ${activeProcesses.length}`)
  console.log(`   📝 Movimentos processados: ${totalMovimentos}`)
  console.log(`   ✅ Upserts realizados: ${totalNovos}`)
  console.log(`   📊 Status atualizados: ${totalStatusUpdated}`)
  console.log(`   ❌ Erros: ${errors}`)
  console.log(`${'='.repeat(60)}\n`)

  return new Response(
    JSON.stringify({
      success: true,
      stats: {
        processes: activeProcesses.length,
        movimentos: totalMovimentos,
        upserts: totalNovos,
        statusUpdated: totalStatusUpdated,
        errors,
      },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  )
})
