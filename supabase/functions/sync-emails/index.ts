import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Função para conectar via IMAP usando comando shell (Deno não tem biblioteca IMAP nativa)
async function fetchEmailsViaIMAP(
  host: string,
  port: number,
  email: string,
  password: string
): Promise<any[]> {
  // NOTA: Deno Edge Functions não suportam IMAP diretamente
  // Esta é uma implementação simplificada usando fetch para APIs de email
  
  // Para produção, você precisaria:
  // 1. Usar um serviço intermediário (ex: Zapier, Make.com)
  // 2. Implementar em Node.js com node-imap
  // 3. Usar API do provedor de email se disponível
  
  throw new Error('IMAP não suportado em Edge Functions. Use Node.js backend ou webhook.')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      throw new Error('Não autenticado')
    }

    const { account_id } = await req.json()

    // Busca conta de email
    const { data: account, error: accountError } = await supabaseClient
      .from('email_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('user_id', user.id)
      .single()

    if (accountError || !account) {
      throw new Error('Conta de email não encontrada')
    }

    // IMPORTANTE: Edge Functions do Deno não suportam IMAP nativamente
    // Você precisa usar uma das seguintes alternativas:
    
    // Opção 1: Webhook do provedor de email
    // Opção 2: Backend Node.js separado com node-imap
    // Opção 3: Serviço de integração (Zapier, Make.com)
    
    return new Response(
      JSON.stringify({
        success: false,
        message: 'IMAP não suportado em Edge Functions. Implemente backend Node.js separado.',
        recommendation: 'Use webhook do Hostinger ou backend Node.js com node-imap',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 501, // Not Implemented
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
