// Proxy do LanguageTool para a revisão gramatical do editor de petições.
//
// Por que um proxy e não chamar a API pública direto do browser:
//  - o texto da petição é sigiloso: o servidor pode ser trocado por um
//    LanguageTool autohospedado só mudando a env LANGUAGETOOL_URL, sem
//    republicar o front;
//  - a API pública limita por IP (20 req/min): centralizando no Edge, dá para
//    aplicar o nosso próprio teto e não vazar a chave premium (se houver);
//  - evita depender do CORS de terceiro.
//
// Envs (todas opcionais):
//   LANGUAGETOOL_URL      base do servidor (default: https://api.languagetool.org)
//   LANGUAGETOOL_USERNAME e-mail da conta premium (opcional)
//   LANGUAGETOOL_API_KEY  chave premium (opcional; exige USERNAME)
//
// Contrato: POST { text, language?, level?, disabledRules?[] }
//        -> { matches: [...], software?: {...} }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Teto por requisição. A API pública aceita 20k; ficamos abaixo de propósito
 *  para o cliente fatiar o documento e manter a latência previsível. */
const MAX_TEXT_LENGTH = 8000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método não suportado' }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const text = String(payload?.text ?? '');
    const language = String(payload?.language || 'pt-BR');
    const level = payload?.level === 'picky' ? 'picky' : 'default';
    const disabledRules: string[] = Array.isArray(payload?.disabledRules)
      ? payload.disabledRules.map((r: unknown) => String(r)).filter(Boolean).slice(0, 200)
      : [];

    if (!text.trim()) return json({ matches: [] });
    if (text.length > MAX_TEXT_LENGTH) {
      return json({ error: `Texto acima do limite de ${MAX_TEXT_LENGTH} caracteres por requisição` }, 413);
    }

    const base = (Deno.env.get('LANGUAGETOOL_URL') || 'https://api.languagetool.org').replace(/\/+$/, '');
    const endpoint = base.endsWith('/v2/check') ? base : `${base}/v2/check`;

    const form = new URLSearchParams();
    form.set('text', text);
    form.set('language', language);
    form.set('level', level);
    if (disabledRules.length) form.set('disabledRules', disabledRules.join(','));

    const username = Deno.env.get('LANGUAGETOOL_USERNAME');
    const apiKey = Deno.env.get('LANGUAGETOOL_API_KEY');
    if (username && apiKey) {
      form.set('username', username);
      form.set('apiKey', apiKey);
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      console.warn('[languagetool-proxy] upstream', upstream.status, raw.slice(0, 300));
      return json({ error: `LanguageTool respondeu ${upstream.status}`, detail: raw.slice(0, 300) }, 502);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'Resposta inválida do LanguageTool' }, 502);
    }

    // Só o necessário volta para o cliente (a resposta crua traz metadados
    // grandes e inúteis para o painel de revisão).
    const matches = Array.isArray(parsed?.matches)
      ? parsed.matches.map((m: any) => ({
          offset: m?.offset ?? 0,
          length: m?.length ?? 0,
          message: m?.message ?? '',
          shortMessage: m?.shortMessage ?? '',
          replacements: Array.isArray(m?.replacements)
            ? m.replacements.slice(0, 6).map((r: any) => String(r?.value ?? ''))
            : [],
          rule: {
            id: m?.rule?.id ?? '',
            description: m?.rule?.description ?? '',
            issueType: m?.rule?.issueType ?? '',
            categoryId: m?.rule?.category?.id ?? '',
            categoryName: m?.rule?.category?.name ?? '',
          },
        }))
      : [];

    return json({ matches, software: parsed?.software?.name ?? 'LanguageTool' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[languagetool-proxy] erro:', message);
    return json({ error: message }, 500);
  }
});
