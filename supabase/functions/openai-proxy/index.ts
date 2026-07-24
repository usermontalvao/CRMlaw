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

function buildProviderBody(provider: Provider, args: CallArgs, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model:       resolveModel(provider, args.model, PREMIUM_TASKS.has(String(args.task_key || ''))),
    messages:    args.messages,
    temperature: typeof args.temperature === 'number' ? args.temperature : 0.7,
  };
  if (args.max_tokens) body.max_tokens = args.max_tokens;
  if (stream) {
    body.stream = true;
    // response_format é incompatível com o protocolo streaming (markdown +
    // bloco json:actions final) — nunca enviar no modo stream.
  } else if (args.response_format) {
    // json_object é suportado por OpenAI, Groq e DeepSeek (deepseek-chat).
    body.response_format = args.response_format;
  }
  return body;
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
  const body = buildProviderBody(provider, args, false);

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

/**
 * Abre a conexão streaming com o provedor. Lança se a resposta não for OK ou
 * não tiver corpo — o failover acontece AQUI, antes do primeiro byte chegar
 * ao cliente. Depois que o repasse começa, erro vira evento SSE.
 */
async function openProviderStream(provider: Provider, apiKey: string, args: CallArgs): Promise<{ upstream: ReadableStream<Uint8Array>; model: string }> {
  const body = buildProviderBody(provider, args, true);

  const response = await fetch(endpointFor(provider), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
    // Cobre a conexão inteira, inclusive o corpo streamado.
    signal: AbortSignal.timeout(PREMIUM_TASKS.has(String(args.task_key || '')) ? 180_000 : 60_000),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${provider} HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  return { upstream: response.body, model: String(body.model) };
}

/**
 * Normaliza o SSE do provedor (formato OpenAI-compatível) para o protocolo
 * próprio deste proxy:
 *   data: {"type":"meta","provider":"openai","model":"gpt-4o"}
 *   data: {"type":"delta","text":"..."}
 *   data: {"type":"done","finish_reason":"stop"}
 *   data: [DONE]
 * Erro no meio do stream vira {"type":"error"} seguido de [DONE].
 */
function normalizeProviderStream(provider: Provider, model: string, upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sse = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse({ type: 'meta', provider, model }));
      const reader = upstream.getReader();
      let buffer = '';
      let doneSent = false;

      const sendDone = (finishReason: string) => {
        if (doneSent) return;
        doneSent = true;
        controller.enqueue(sse({ type: 'done', finish_reason: finishReason }));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const choice = json?.choices?.[0];
              const text = choice?.delta?.content;
              if (typeof text === 'string' && text.length > 0) {
                controller.enqueue(sse({ type: 'delta', text }));
              }
              if (choice?.finish_reason) {
                sendDone(String(choice.finish_reason));
              }
            } catch {
              // Linha não-JSON (comentário/keep-alive) — ignora.
            }
          }
        }
        sendDone('stop');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[openai-proxy] stream de ${provider} interrompido:`, message);
        controller.enqueue(sse({ type: 'error', message: `Conexão com ${provider} interrompida: ${message}` }));
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
    cancel() {
      try { upstream.cancel(); } catch { /* ignore */ }
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { messages, model = 'gpt-4o-mini', max_tokens, temperature, response_format, task_key, stream } = await req.json();

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

    // ── Caminho streaming (SSE) ─────────────────────────────────────────────
    if (stream === true) {
      let streamError: unknown = null;
      for (const link of chain) {
        try {
          const { upstream, model: resolvedModel } = await openProviderStream(
            link.provider,
            link.key,
            { messages, model, max_tokens, temperature, task_key },
          );
          return new Response(normalizeProviderStream(link.provider, resolvedModel, upstream), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'X-LLM-Provider': link.provider,
            },
          });
        } catch (err) {
          streamError = err;
          console.warn(`[openai-proxy] stream ${link.provider} falhou, tentando proximo:`, err instanceof Error ? err.message : String(err));
        }
      }
      const streamMessage = streamError instanceof Error ? streamError.message : String(streamError);
      throw new Error(`Todos os provedores de IA falharam (stream). Ultimo erro: ${streamMessage}`);
    }

    // ── Caminho JSON completo (comportamento original) ──────────────────────
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
