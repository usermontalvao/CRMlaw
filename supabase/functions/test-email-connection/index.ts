import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Busca conta
    const { data: account, error: accountError } = await supabaseClient
      .from('email_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('user_id', user.id)
      .single()

    if (accountError || !account) {
      throw new Error('Conta de email não encontrada')
    }

    const results = {
      smtp: { success: false, message: '' },
      imap: { success: false, message: '' },
    }

    // Testa SMTP
    try {
      const smtpClient = new SMTPClient({
        connection: {
          hostname: account.smtp_host,
          port: account.smtp_port,
          tls: true,
          auth: {
            username: account.email,
            password: account.password,
          },
        },
      })

      // Tenta conectar
      await smtpClient.send({
        from: account.email,
        to: account.email, // Envia para si mesmo como teste
        subject: 'Teste de Conexão SMTP',
        content: 'Este é um email de teste para verificar a conexão SMTP.',
      })

      await smtpClient.close()

      results.smtp = {
        success: true,
        message: `Conexão SMTP bem-sucedida com ${account.smtp_host}:${account.smtp_port}`,
      }
    } catch (smtpError) {
      results.smtp = {
        success: false,
        message: `Erro SMTP: ${smtpError.message}`,
      }
    }

    // Testa IMAP (limitado em Edge Functions)
    try {
      // Edge Functions não suportam IMAP nativamente
      // Apenas verifica se as configurações estão presentes
      if (account.imap_host && account.imap_port) {
        results.imap = {
          success: false,
          message: `IMAP configurado (${account.imap_host}:${account.imap_port}) mas não suportado em Edge Functions. Use backend Node.js.`,
        }
      } else {
        results.imap = {
          success: false,
          message: 'Configurações IMAP não encontradas',
        }
      }
    } catch (imapError) {
      results.imap = {
        success: false,
        message: `Erro IMAP: ${imapError.message}`,
      }
    }

    return new Response(
      JSON.stringify({
        success: results.smtp.success,
        results,
        account: {
          email: account.email,
          smtp_host: account.smtp_host,
          smtp_port: account.smtp_port,
          imap_host: account.imap_host,
          imap_port: account.imap_port,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
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
