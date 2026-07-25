import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * nextcloud-upload
 * -----------------------------------------------------------------------------
 * Upload BINÁRIO rápido para o Nextcloud. Complementa o `nextcloud-proxy`
 * (que trafega base64 em JSON — bom para o controle, ruim para arquivos):
 * aqui o front envia o arquivo CRU (Content-Type: application/octet-stream) e
 * a função faz o PUT WebDAV direto. Evita inflar o corpo em ~33% (base64) e o
 * parse de uma string JSON gigante — deixa o envio de imagens/arquivos rápido.
 *
 * O caminho vai no header X-Nc-Path (percent-encoded, pois headers só aceitam
 * ASCII e pastas podem ter acento) e o mime em X-Nc-Mime.
 *
 * Mesmos secrets do proxy: NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nc-path, x-nc-mime',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function davRoot(url: string, user: string): string {
  return `${url.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(user)}`;
}

function davUrl(root: string, path: string): string {
  const clean = String(path || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return clean ? `${root}/${clean}` : `${root}/`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = Deno.env.get('NEXTCLOUD_URL');
  const user = Deno.env.get('NEXTCLOUD_USER');
  const pass = Deno.env.get('NEXTCLOUD_APP_PASSWORD');
  if (!url || !user || !pass) {
    return json({ error: 'Nextcloud não configurado (NEXTCLOUD_URL/USER/APP_PASSWORD).' }, 500);
  }

  const encodedPath = req.headers.get('x-nc-path');
  if (!encodedPath) return json({ error: 'X-Nc-Path ausente.' }, 400);
  let path: string;
  try { path = decodeURIComponent(encodedPath); } catch { return json({ error: 'X-Nc-Path inválido.' }, 400); }
  if (!path.replace(/\/+$/, '')) return json({ error: 'X-Nc-Path vazio.' }, 400);

  const mime = req.headers.get('x-nc-mime') || 'application/octet-stream';
  const bytes = new Uint8Array(await req.arrayBuffer());

  const root = davRoot(url, user);
  const auth = 'Basic ' + btoa(`${user}:${pass}`);

  const res = await fetch(davUrl(root, path), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': mime },
    body: bytes,
  });
  if (!res.ok) {
    return json({ error: `PUT falhou (${res.status})`, detail: await res.text() }, 502);
  }
  const rawEtag = res.headers.get('oc-etag') || res.headers.get('etag');
  return json({
    ok: true,
    status: res.status,
    sentBytes: bytes.byteLength,
    etag: rawEtag ? rawEtag.replace(/^"|"$|&quot;/g, '') : null,
  });
});
