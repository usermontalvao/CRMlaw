/**
 * Cliente de streaming da edge function `openai-proxy`.
 *
 * `supabase.functions.invoke` não expõe o corpo como stream, então o fetch é
 * feito direto na URL da function com os mesmos headers de auth. O protocolo
 * SSE é o normalizado pelo proxy (independente do provedor que respondeu):
 *
 *   data: {"type":"meta","provider":"openai","model":"gpt-4o"}
 *   data: {"type":"delta","text":"..."}
 *   data: {"type":"done","finish_reason":"stop"}
 *   data: [DONE]
 *
 * Fallbacks:
 *  - Resposta sem `text/event-stream` (function antiga no ar durante deploy):
 *    parseia como JSON completo e emite um único onDelta.
 *  - Erro de rede/stream: o CHAMADOR decide cair no caminho não-streaming
 *    (callOpenAIViaEdgeFunction) — aqui só propagamos o erro.
 */

import { supabase } from '../config/supabase';

export interface StreamChatParams {
  messages: Array<{ role: string; content: string }>;
  model: string;
  maxTokens?: number;
  temperature?: number;
  taskKey?: string;
  /** Cancelamento (botão "Parar"). O texto parcial já emitido permanece válido. */
  signal?: AbortSignal;
  onMeta?: (meta: { provider: string; model: string }) => void;
  /** Chamado a cada chunk com o delta e o texto acumulado até aqui. */
  onDelta?: (chunk: string, fullTextSoFar: string) => void;
}

export interface StreamChatResult {
  text: string;
  provider?: string;
  /** true quando o stream foi interrompido por AbortSignal (texto parcial). */
  aborted?: boolean;
}

/** Erro emitido pelo proxy DENTRO do stream (evento {"type":"error"}). */
export class StreamProviderError extends Error {
  constructor(message: string, public readonly partialText: string) {
    super(message);
    this.name = 'StreamProviderError';
  }
}

export async function streamChatCompletion(params: StreamChatParams): Promise<StreamChatResult> {
  const { messages, model, maxTokens, temperature, taskKey, signal, onMeta, onDelta } = params;

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase não configurado.');

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token || anonKey;

  const response = await fetch(`${baseUrl}/functions/v1/openai-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      model,
      max_tokens: maxTokens,
      temperature,
      task_key: taskKey,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Edge Function HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const contentType = response.headers.get('Content-Type') || '';
  const provider = response.headers.get('X-LLM-Provider') || undefined;

  // Function antiga (sem streaming) ainda no ar: resposta JSON completa.
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    if (data?.error) throw new Error(`IA (openai-proxy) error: ${data.error}`);
    const text = String(data?.choices?.[0]?.message?.content || '');
    if (text) onDelta?.(text, text);
    return { text, provider };
  }

  if (!response.body) throw new Error('Resposta streaming sem corpo.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let resolvedProvider = provider;

  const processLine = (rawLine: string): 'continue' | 'done' => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return 'continue';
    const payload = line.slice(5).trim();
    if (!payload) return 'continue';
    if (payload === '[DONE]') return 'done';

    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      return 'continue';
    }

    if (event?.type === 'meta') {
      resolvedProvider = String(event.provider || resolvedProvider || '');
      onMeta?.({ provider: String(event.provider || ''), model: String(event.model || '') });
    } else if (event?.type === 'delta' && typeof event.text === 'string') {
      fullText += event.text;
      onDelta?.(event.text, fullText);
    } else if (event?.type === 'error') {
      throw new StreamProviderError(String(event.message || 'Erro no stream da IA.'), fullText);
    }
    return 'continue';
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (processLine(line) === 'done') {
          return { text: fullText, provider: resolvedProvider };
        }
      }
    }
    // Flush de linha final sem \n (defensivo).
    if (buffer.trim()) processLine(buffer);
    return { text: fullText, provider: resolvedProvider };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { text: fullText, provider: resolvedProvider, aborted: true };
    }
    throw err;
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}
