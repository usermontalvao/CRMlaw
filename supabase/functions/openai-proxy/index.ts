import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Mapeia modelos OpenAI para equivalentes Groq
function mapModelToGroq(model: string): string {
  if (model.startsWith('gpt-4o-mini') || model.startsWith('gpt-3.5')) {
    return 'llama-3.1-8b-instant';
  }
  if (model.startsWith('gpt-4o') || model.startsWith('gpt-4')) {
    return 'llama-3.3-70b-versatile';
  }
  return 'llama-3.1-8b-instant';
}

// DeepSeek é OpenAI-compatível. Todas as tarefas de texto deste proxy usam o
// modelo de chat geral (deepseek-chat / V3). Visão NÃO passa por aqui.
function mapModelToDeepSeek(_model: string): string {
  return 'deepseek-chat';
}

type Provider = 'deepseek' | 'groq' | 'openai';

interface CallArgs {
  messages: unknown;
  model: string;
  max_tokens?: number;
}

function endpointFor(provider: Provider): string {
  switch (provider) {
    case 'deepseek': return 'https://api.deepseek.com/chat/completions';
    case 'groq':     return 'https://api.groq.com/openai/v1/chat/completions';
    case 'openai':   return 'https://api.openai.com/v1/chat/completions';
  }
}

function resolveModel(provider: Provider, model: string): string {
  if (provider === 'deepseek') return mapModelToDeepSeek(model);
  if (provider === 'groq')     return mapModelToGroq(model);
  return model;
}

async function callProvider(provider: Provider, apiKey: string, args: CallArgs) {
  const body: Record<string, unknown> = {
    model:       resolveModel(provider, args.model),
    messages:    args.messages,
    temperature: 0.7,
  };
  if (args.max_tokens) body.max_tokens = args.max_tokens;

  const response = await fetch(endpointFor(provider), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
    // Timeout para não travar o failover quando um provedor está pendurado.
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${provider} HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  return await response.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { messages, model = 'gpt-4o-mini', max_tokens } = await req.json();

    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    const groqApiKey   = Deno.env.get('GROQ_API_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    // Cadeia de failover para tarefas de TEXTO:
    // DeepSeek (barato/primário) -> Groq (rápido) -> OpenAI (rede de seguranca).
    const chain: { provider: Provider; key: string }[] = [];
    if (deepseekApiKey) chain.push({ provider: 'deepseek', key: deepseekApiKey });
    if (groqApiKey)     chain.push({ provider: 'groq',     key: groqApiKey });
    if (openaiApiKey)   chain.push({ provider: 'openai',   key: openaiApiKey });

    if (chain.length === 0) {
      throw new Error('Nenhuma chave de API configurada (DEEPSEEK_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY)');
    }

    let lastError: unknown = null;
    for (const link of chain) {
      try {
        const data = await callProvider(link.provider, link.key, { messages, model, max_tokens });
        return new Response(JSON.stringify(data), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            // Debug: qual provedor de fato respondeu.
            'X-LLM-Provider': link.provider,
          },
        });
      } catch (err) {
        lastError = err;
        console.warn(`[openai-proxy] ${link.provider} falhou, tentando proximo:`, err instanceof Error ? err.message : String(err));
        // continua para o próximo provedor da cadeia
      }
    }

    // Todos os provedores da cadeia falharam.
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Todos os provedores de IA falharam. Ultimo erro: ${message}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
