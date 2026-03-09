import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Endpoint oficial Syncfusion (documentado e funcional)
const SYNCFUSION_ENDPOINT = 'https://document.syncfusion.com/web-services/docx-editor/api/documenteditor/Import';

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
    
    console.log(`[syncfusion-import] Enviando para: ${SYNCFUSION_ENDPOINT}`);
    
    const response = await fetch(SYNCFUSION_ENDPOINT, {
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
