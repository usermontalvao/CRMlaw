// Edge Function — proxy para a API pública DataJud (CNJ)
// Necessário para evitar bloqueio de CORS no browser.
// A chave de API é configurável pelo admin e enviada no body da requisição.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br';
// Chave padrão — usada como fallback se o cliente não enviar uma chave configurada
const DATAJUD_DEFAULT_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Espera body: { alias: string, numeroProcesso: string, datajudApiKey?: string }
    const { alias, numeroProcesso, datajudApiKey } = await req.json();

    if (!alias || !numeroProcesso) {
      return new Response(
        JSON.stringify({ error: 'alias e numeroProcesso são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Usa a chave enviada pelo cliente (configurada pelo admin) ou a padrão
    const apiKey = (typeof datajudApiKey === 'string' && datajudApiKey.trim())
      ? datajudApiKey.trim()
      : DATAJUD_DEFAULT_KEY;

    const url = `${DATAJUD_BASE_URL}/${alias}/_search`;
    console.log(`📡 DataJud proxy → ${url} (processo: ${numeroProcesso})`);

    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12_000); // 12s — margem acima do timeout do cliente (10s)

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `APIKey ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          size: 1,
          query: { match: { numeroProcesso } },
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(tid);
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ DataJud error (${response.status}):`, text);
      return new Response(
        JSON.stringify({ error: `Erro ${response.status} ao consultar DataJud`, details: text }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('❌ Erro no proxy DataJud:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
