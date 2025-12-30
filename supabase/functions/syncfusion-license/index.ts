import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

(globalThis as any).Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const denoEnv = (globalThis as any)?.Deno?.env;
    const licenseKey =
      denoEnv?.get?.('SYNCFUSION_LICENSE_KEY') ||
      denoEnv?.get?.('SYNCFUSION_LICENSE') ||
      denoEnv?.get?.('SYNC_FUSION') ||
      '';

    if (!licenseKey) {
      return new Response(
        JSON.stringify({ error: 'Licença Syncfusion não configurada (secret ausente).' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify({ licenseKey }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
