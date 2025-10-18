// Edge Function para fazer proxy de requisições ao DJEN
// Evita problemas de CORS no frontend

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const DJEN_BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1';

serve(async (req) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { endpoint, params } = await req.json();

    if (!endpoint) {
      throw new Error('Endpoint é obrigatório');
    }

    // Construir URL com query params
    const url = new URL(`${DJEN_BASE_URL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    console.log(`📡 Proxy DJEN: ${url.toString()}`);

    // Fazer requisição ao DJEN
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Erro DJEN (${response.status}):`, errorText);
      
      return new Response(
        JSON.stringify({
          error: `Erro ao consultar DJEN: ${response.status}`,
          details: errorText,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Erro no proxy DJEN:', error);

    return new Response(
      JSON.stringify({
        error: error.message || 'Erro desconhecido',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
