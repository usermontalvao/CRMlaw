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

// Tarefas em que a QUALIDADE manda (redação jurídica): usam o melhor provedor
// primeiro (OpenAI), com os baratos apenas como fallback. As demais tarefas
// seguem a cadeia econômica (DeepSeek -> Groq -> OpenAI).
const PREMIUM_TASKS = new Set(['petition_chat', 'edit_legal_text']);

interface CallArgs {
  messages: unknown;
  model: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: unknown;
  task_key?: string;
}

function endpointFor(provider: Provider): string {
  switch (provider) {
    case 'deepseek': return 'https://api.deepseek.com/chat/completions';
    case 'groq':     return 'https://api.groq.com/openai/v1/chat/completions';
    case 'openai':   return 'https://api.openai.com/v1/chat/completions';
  }
}

function resolveModel(provider: Provider, model: string, isPremiumTask = false): string {
  if (provider === 'deepseek') return mapModelToDeepSeek(model);
  if (provider === 'groq')     return mapModelToGroq(model);
  // Tarefa premium nunca roda em modelo "mini" na OpenAI.
  if (isPremiumTask && (model.startsWith('gpt-4o-mini') || model.startsWith('gpt-3.5'))) {
    return 'gpt-4o';
  }
  return model;
}

async function callProvider(provider: Provider, apiKey: string, args: CallArgs) {
  const body: Record<string, unknown> = {
    model:       resolveModel(provider, args.model, PREMIUM_TASKS.has(String(args.task_key || ''))),
    messages:    args.messages,
    temperature: typeof args.temperature === 'number' ? args.temperature : 0.7,
  };
  if (args.max_tokens) body.max_tokens = args.max_tokens;
  // json_object é suportado por OpenAI, Groq e DeepSeek (deepseek-chat).
  if (args.response_format) {
    body.response_format = args.response_format;
  }

  const response = await fetch(endpointFor(provider), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
    // Timeout para não travar o failover quando um provedor está pendurado.
    // Tarefas premium geram respostas longas (petições) e precisam de folga.
    signal: AbortSignal.timeout(PREMIUM_TASKS.has(String(args.task_key || '')) ? 120_000 : 30_000),
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
    const { messages, model = 'gpt-4o-mini', max_tokens, temperature, response_format, task_key } = await req.json();

    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    const groqApiKey   = Deno.env.get('GROQ_API_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    // Cadeia de failover para tarefas de TEXTO.
    // Padrão (econômica): DeepSeek -> Groq -> OpenAI.
    // Premium (petition_chat etc.): OpenAI -> DeepSeek -> Groq — a redação
    // jurídica vai sempre para o melhor modelo disponível.
    const isPremium = PREMIUM_TASKS.has(String(task_key || ''));
    const chain: { provider: Provider; key: string }[] = [];
    if (isPremium) {
      if (openaiApiKey)   chain.push({ provider: 'openai',   key: openaiApiKey });
      if (deepseekApiKey) chain.push({ provider: 'deepseek', key: deepseekApiKey });
      if (groqApiKey)     chain.push({ provider: 'groq',     key: groqApiKey });
    } else {
      if (deepseekApiKey) chain.push({ provider: 'deepseek', key: deepseekApiKey });
      if (groqApiKey)     chain.push({ provider: 'groq',     key: groqApiKey });
      if (openaiApiKey)   chain.push({ provider: 'openai',   key: openaiApiKey });
    }

    if (chain.length === 0) {
      throw new Error('Nenhuma chave de API configurada (DEEPSEEK_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY)');
    }

    let lastError: unknown = null;
    for (const link of chain) {
      try {
        const data = await callProvider(link.provider, link.key, { messages, model, max_tokens, temperature, response_format, task_key });
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
