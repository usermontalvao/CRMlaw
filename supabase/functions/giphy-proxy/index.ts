// Proxy do Giphy para o seletor de GIF do compositor do WhatsApp.
//
// A chave da API vive no secret `GIPHY` e NUNCA vai para o navegador: o Vite
// grava tudo que é `VITE_*` dentro do bundle, então uma chave no front seria
// pública para qualquer visitante. Por isso a busca passa por aqui.
//
// A resposta é enxuta de propósito. O payload do Giphy traz ~30 variações de
// cada GIF (todas as resoluções, em .gif/.webp/.mp4/.webm); devolver isso
// inteiro para montar uma grade de miniaturas é desperdício de banda no
// celular do atendente. Aqui sai só o que a grade usa e o que o envio precisa.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';
const TIMEOUT_MS = 10_000;
const LIMITE_MAX = 40;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface GiphyImagem { url?: string; width?: string; height?: string; mp4?: string }

/** Só os campos que a grade e o envio consomem. */
function enxugar(g: Record<string, any>) {
  const imgs = (g.images ?? {}) as Record<string, GiphyImagem>;
  // `fixed_width` é a miniatura da grade; `downsized_medium` é o que vai para o
  // cliente. O mp4 é preferido no envio: o WhatsApp converte GIF para mp4 de
  // qualquer jeito, e mandar o .gif original gasta muito mais dado.
  const preview = imgs.fixed_width ?? imgs.downsized ?? imgs.original;
  const envio = imgs.downsized_medium ?? imgs.original;
  return {
    id: String(g.id ?? ''),
    titulo: String(g.title ?? '').trim(),
    previewUrl: preview?.url ?? null,
    largura: Number(preview?.width ?? 0) || 0,
    altura: Number(preview?.height ?? 0) || 0,
    // mp4 quando existe; senão o .gif serve.
    mp4Url: envio?.mp4 ?? imgs.original?.mp4 ?? null,
    gifUrl: envio?.url ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405);

  // Só equipe autenticada: o seletor é ferramenta interna, e sem esta checagem
  // a função viraria um proxy aberto do Giphy à custa da nossa cota.
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Não autenticado' }, 401);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const chave = Deno.env.get('GIPHY');
  if (!chave) return json({ error: 'GIPHY não configurado nos secrets do projeto.' }, 503);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const acao = body.action === 'search' ? 'search' : 'trending';
  const q = typeof body.q === 'string' ? body.q.trim() : '';
  const limite = Math.min(Number(body.limit) || 24, LIMITE_MAX);
  const offset = Math.max(Number(body.offset) || 0, 0);

  // Busca sem termo não existe no Giphy — cai em "em alta", que é o que o
  // seletor mostra ao abrir.
  const url = new URL(`${GIPHY_BASE}/${acao === 'search' && q ? 'search' : 'trending'}`);
  url.searchParams.set('api_key', chave);
  url.searchParams.set('limit', String(limite));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('rating', 'pg-13'); // conversa com cliente: sem conteúdo adulto
  url.searchParams.set('lang', 'pt');
  if (acao === 'search' && q) url.searchParams.set('q', q);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = out?.message || out?.meta?.msg || `Giphy retornou ${res.status}`;
      return json({ error: msg }, 502);
    }
    const itens = Array.isArray(out?.data) ? out.data.map(enxugar).filter((g: any) => g.previewUrl) : [];
    return json({ itens });
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError'
      ? 'O Giphy demorou demais para responder.'
      : 'Não foi possível falar com o Giphy.';
    return json({ error: msg }, 502);
  }
});
