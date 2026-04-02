import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function dispatchSignatureCompletedWebhook(input: {
  request: Record<string, unknown>;
  signer: Record<string, unknown>;
  totalSigners: number;
}): Promise<void> {
  const webhookUrl = (Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_URL') ?? '').trim();
  if (!webhookUrl) return;

  const webhookSecret = (Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_SECRET') ?? '').trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': 'signature.completed',
        ...(webhookSecret ? { 'X-Webhook-Secret': webhookSecret } : {}),
      },
      body: JSON.stringify({
        event: 'signature.completed',
        sent_at: new Date().toISOString(),
        document_name: input.request.document_name,
        client_name: input.request.client_name,
        process_number: input.request.process_number,
        signed_at: input.request.signed_at,
        signers: await getAllSignersWithLinks(input.request.id as string),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(`Webhook respondeu ${response.status}: ${responseText || response.statusText}`);
    }

    console.log('✅ Signature completion webhook enviado com sucesso');
  } finally {
    clearTimeout(timeout);
  }
}

async function getAllSignersWithLinks(requestId: string): Promise<Array<{
  name: string;
  email: string;
  cpf: string | null;
  phone: string | null;
  signed_at: string;
}>> {
  // Dados mock para teste - lista simples de clientes que assinaram
  return [
    {
      name: "João Silva da Costa",
      email: "joao.silva@email.com",
      cpf: "123.456.789-01",
      phone: "(11) 98765-4321",
      signed_at: new Date().toISOString(),
    },
    {
      name: "Maria Oliveira Santos",
      email: "maria.santos@email.com",
      cpf: "987.654.321-00",
      phone: "(11) 91234-5678",
      signed_at: new Date().toISOString(),
    }
  ];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Conectar ao banco
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ 
        success: false, 
        error: 'Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas' 
      }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Calcular data de 7 dias atrás
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    console.log('🔍 Buscando assinaturas dos últimos 7 dias desde:', sevenDaysAgoISO);

    // Buscar solicitações de assinatura completadas nos últimos 7 dias
    const { data: requests, error: requestsError } = await supabase
      .from('signature_requests')
      .select('*')
      .eq('status', 'signed')
      .gte('signed_at', sevenDaysAgoISO)
      .order('signed_at', { ascending: false });

    if (requestsError) {
      console.error('Erro ao buscar requests:', requestsError);
      return jsonResponse({ success: false, error: 'Erro ao buscar solicitações' }, 500);
    }

    if (!requests || requests.length === 0) {
      return jsonResponse({
        success: true,
        message: 'Nenhuma assinatura encontrada nos últimos 7 dias',
        document: null,
        signers: [],
        webhook_configured: !!Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_URL'),
      });
    }

    // Buscar todos os signatários dessas solicitações
    const requestIds = requests.map(r => r.id);
    const { data: signers, error: signersError } = await supabase
      .from('signature_signers')
      .select('*')
      .in('signature_request_id', requestIds)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false });

    if (signersError) {
      console.error('Erro ao buscar signers:', signersError);
      return jsonResponse({ success: false, error: 'Erro ao buscar signatários' }, 500);
    }

    // Montar resposta com dados reais
    const allSigners = [];
    
    for (const signer of signers || []) {
      const request = requests.find(r => r.id === signer.signature_request_id);
      
      // Gerar link do documento se tiver caminho
      let documentLink = null;
      
      // Tentar usar signed_document_path do signatário
      if (signer.signed_document_path) {
        try {
          const { data } = await supabase.storage
            .from('document-templates')
            .createSignedUrl(signer.signed_document_path, 3600);
          documentLink = data?.signedUrl || null;
        } catch {
          documentLink = null;
        }
      }
      
      // Se não tiver, tentar usar document_path da request
      if (!documentLink && request?.document_path) {
        try {
          const { data } = await supabase.storage
            .from('document-templates')
            .createSignedUrl(request.document_path, 3600);
          documentLink = data?.signedUrl || null;
        } catch {
          documentLink = null;
        }
      }
      
      // Se ainda não tiver, tentar attachment_paths
      if (!documentLink && request?.attachment_paths && Array.isArray(request.attachment_paths) && request.attachment_paths.length > 0) {
        try {
          const { data } = await supabase.storage
            .from('document-templates')
            .createSignedUrl(request.attachment_paths[0], 3600);
          documentLink = data?.signedUrl || null;
        } catch {
          documentLink = null;
        }
      }

      allSigners.push({
        name: signer.name,
        email: signer.email,
        phone: signer.phone,
        signed_at: signer.signed_at,
        document_link: documentLink?.startsWith('http') ? documentLink : `https://${documentLink}`,
        document_name: request?.document_name,
        client_name: request?.client_name,
        process_number: request?.process_number,
      });
    }

    // Tenta enviar webhook se configurado
    const webhookUrl = Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_URL');
    if (webhookUrl && allSigners.length > 0) {
      try {
        const webhookSecret = Deno.env.get('WEBHOOK_SIGNATURE_SIGNED_SECRET')?.trim();
        await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Event': 'signature.completed',
            ...(webhookSecret ? { 'X-Webhook-Secret': webhookSecret } : {}),
          },
          body: JSON.stringify({
            event: 'signature.completed',
            sent_at: new Date().toISOString(),
            document: requests[0], // Primeiro documento como exemplo
            signers: allSigners,
          }),
        });
        console.log('✅ Webhook enviado para:', webhookUrl);
      } catch (webhookErr) {
        console.error('❌ Falha no webhook:', webhookErr);
      }
    }

    return jsonResponse({
      success: true,
      message: `Encontrados ${allSigners.length} clientes que assinaram nos últimos 7 dias`,
      document: requests[0] || null, // Primeiro documento como exemplo
      signers: allSigners,
      total_requests: requests.length,
      webhook_configured: !!webhookUrl,
    });

  } catch (err) {
    console.error('Erro:', err);
    return jsonResponse({ 
      success: false, 
      error: err.message 
    }, 500);
  }
});
