import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SendEmailRequest {
  account_id: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body_html?: string
  body_text?: string
  client_id?: string
  process_id?: string
}

serve(async (req) => {
  // Handle CORS preflight
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

    // Verifica autenticação
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      throw new Error('Não autenticado')
    }

    const payload: SendEmailRequest = await req.json()

    // Busca configurações da conta de email
    const { data: account, error: accountError } = await supabaseClient
      .from('email_accounts')
      .select('*')
      .eq('id', payload.account_id)
      .eq('user_id', user.id)
      .single()

    if (accountError || !account) {
      throw new Error('Conta de email não encontrada')
    }

    // Configura cliente SMTP
    const client = new SMTPClient({
      connection: {
        hostname: account.smtp_host,
        port: account.smtp_port,
        tls: true,
        auth: {
          username: account.email,
          password: account.password, // TODO: Descriptografar se estiver criptografado
        },
      },
    })

    // Envia email
    await client.send({
      from: account.email,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      content: payload.body_text || '',
      html: payload.body_html,
    })

    await client.close()

    // Salva email enviado no banco
    const { data: savedEmail, error: saveError } = await supabaseClient
      .from('emails')
      .insert({
        account_id: payload.account_id,
        message_id: `<${Date.now()}@${account.email.split('@')[1]}>`,
        from: account.email,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        body_text: payload.body_text,
        body_html: payload.body_html,
        received_at: new Date().toISOString(),
        is_read: true,
        folder: 'sent',
        client_id: payload.client_id,
        process_id: payload.process_id,
      })
      .select()
      .single()

    if (saveError) {
      console.error('Erro ao salvar email enviado:', saveError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Email enviado com sucesso',
        email: savedEmail,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Erro ao enviar email:', error)
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
