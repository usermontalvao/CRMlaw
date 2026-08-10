import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Servidor de documentos PRÓPRIO do escritório — o mesmo que o editor usa
// (VITE_SYNC_FUSION). O endpoint público de demonstração da Syncfusion não
// serve aqui por dois motivos: as peças convertidas carregam dado de cliente, e
// ele responde 403 de forma intermitente por ser ambiente de demonstração.
//
// `SYNCFUSION_SERVICE_URL` (secret da função) sobrepõe o padrão, para apontar
// para outro servidor sem novo deploy do código.
const DEFAULT_SERVICE_URL = 'https://docs.jurius-api.com/api/documenteditor/';

const serviceUrl = (): string => {
  const configured = String((globalThis as any).Deno.env.get('SYNCFUSION_SERVICE_URL') || '').trim();
  const base = (configured || DEFAULT_SERVICE_URL).replace(/\/+$/, '');
  return `${base}/Import`;
};

(globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await req.formData();
    const endpoint = serviceUrl();

    console.log(`[syncfusion-import] Enviando para: ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[syncfusion-import] Erro ${response.status}: ${errorText}`);
      return new Response(
        JSON.stringify({ 
          error: `Syncfusion retornou ${response.status}`,
          details: errorText
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const sfdt = await response.text();
    console.log(`[syncfusion-import] Conversão bem-sucedida, ${sfdt.length} bytes`);
    
    return new Response(sfdt, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[syncfusion-import] Erro:', error);
    return new Response(
      JSON.stringify({ error: error?.message || String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
