import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * nextcloud-proxy
 * -----------------------------------------------------------------------------
 * Ponte entre o CRM (front) e um servidor Nextcloud via WebDAV.
 *
 * O front NUNCA fala direto com o Nextcloud (CORS + a senha não pode vazar no
 * navegador). Ele chama esta Edge Function, que guarda a credencial nos secrets
 * do Supabase e traduz cada comando para o verbo WebDAV correspondente.
 *
 * Secrets necessários (supabase secrets set ...):
 *   NEXTCLOUD_URL           ex.: https://nextcloud.jurius-api.com
 *   NEXTCLOUD_USER          ex.: crm-integracao
 *   NEXTCLOUD_APP_PASSWORD  app-password gerado no Nextcloud (NÃO a senha da conta)
 *
 * Contrato (POST JSON):
 *   { action: 'list',   path }                    -> { entries: [...] }
 *   { action: 'read',   path }                    -> { base64, mime }
 *   { action: 'write',  path, base64, mime? }     -> { ok: true }
 *   { action: 'delete', path }                    -> { ok: true }
 *   { action: 'mkcol',  path }                    -> { ok: true }
 *   { action: 'move',   path, destination }       -> { ok: true }
 *   { action: 'ping' }                            -> { ok: true, root }  (teste de conexão)
 *   { action: 'versions',       path }            -> { versions: [{id,size,mtime}] }
 *   { action: 'restoreVersion', path, versionId } -> { ok: true }
 *   { action: 'readVersion',    path, versionId } -> { base64, mime }
 *
 * `path` é sempre relativo à raiz do usuário no Nextcloud.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// --- helpers -----------------------------------------------------------------

function davRoot(url: string, user: string): string {
  return `${url.replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(user)}`;
}

/** Raiz DAV do app de versões (histórico de arquivos). */
function davVersionsRoot(url: string, user: string): string {
  return `${url.replace(/\/+$/, '')}/remote.php/dav/versions/${encodeURIComponent(user)}`;
}

/** Monta a URL absoluta de um path relativo, codificando cada segmento. */
function davUrl(root: string, path: string): string {
  const clean = String(path || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return clean ? `${root}/${clean}` : `${root}/`;
}

function authHeader(user: string, pass: string): string {
  return 'Basic ' + btoa(`${user}:${pass}`);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Extrai o valor de uma tag simples (com ou sem namespace d:). */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<[^>]*${name}[^>]*>([\\s\\S]*?)</[^>]*${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

/**
 * Faz o parse de uma resposta 207 Multistatus (PROPFIND) em uma lista simples.
 * O primeiro <response> costuma ser a própria pasta consultada — filtramos ele.
 */
function parsePropfind(xml: string, rootPathname: string, queriedPath = ''): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const blocks = xml.match(/<[a-z]*:?response[\s\S]*?<\/[a-z]*:?response>/gi) || [];
  const self = String(queriedPath || '').replace(/^\/+/, '').replace(/\/+$/, '');

  for (const block of blocks) {
    const rawHref = tag(block, 'href');
    if (!rawHref) continue;

    let href = rawHref;
    try { href = decodeURIComponent(rawHref); } catch { /* mantém cru */ }

    // Path relativo à raiz do usuário.
    const idx = href.indexOf(rootPathname);
    let rel = idx >= 0 ? href.slice(idx + rootPathname.length) : href;
    rel = rel.replace(/^\/+/, '').replace(/\/+$/, '');

    // Ignora a raiz e a própria pasta consultada (PROPFIND Depth:1 inclui ela mesma).
    if (!rel || rel === self) continue;

    const isDir = /<[a-z]*:?resourcetype>[\s\S]*collection/i.test(block);
    const name = decodeURIComponent(rel.split('/').pop() || rel);

    entries.push({
      name,
      path: rel,
      isDir,
      size: Number(tag(block, 'getcontentlength') || 0),
      mime: tag(block, 'getcontenttype') || (isDir ? 'inode/directory' : 'application/octet-stream'),
      mtime: tag(block, 'getlastmodified'),
    });
  }
  return entries;
}

/** Resolve o oc:fileid numérico de um arquivo (necessário p/ o app de versões). */
async function resolveFileId(root: string, auth: string, path: string): Promise<string | null> {
  const propfindBody =
    '<?xml version="1.0"?>' +
    '<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">' +
    '<d:prop><oc:fileid/></d:prop></d:propfind>';
  const res = await fetch(davUrl(root, path), {
    method: 'PROPFIND',
    headers: { Authorization: auth, Depth: '0', 'Content-Type': 'application/xml' },
    body: propfindBody,
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const id = tag(xml, 'fileid');
  return id ? id.trim() : null;
}

/** Faz o parse das versões (PROPFIND na coleção de versões de um fileid). */
function parseVersions(xml: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const blocks = xml.match(/<[a-z]*:?response[\s\S]*?<\/[a-z]*:?response>/gi) || [];
  for (const block of blocks) {
    const rawHref = tag(block, 'href');
    if (!rawHref) continue;
    let href = rawHref;
    try { href = decodeURIComponent(rawHref); } catch { /* cru */ }
    // Ignora a própria coleção (href termina em '/').
    if (/\/$/.test(href)) continue;
    const id = href.replace(/\/+$/, '').split('/').pop() || '';
    if (!id) continue;
    out.push({
      id,
      size: Number(tag(block, 'getcontentlength') || 0),
      mtime: tag(block, 'getlastmodified'),
    });
  }
  // Mais recentes primeiro (o id é um timestamp unix).
  out.sort((a, b) => Number(b.id) - Number(a.id));
  return out;
}

// --- handler -----------------------------------------------------------------

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
    return json(
      { error: 'Nextcloud não configurado. Defina NEXTCLOUD_URL, NEXTCLOUD_USER e NEXTCLOUD_APP_PASSWORD nos secrets.' },
      500,
    );
  }

  const root = davRoot(url, user);
  const versionsRoot = davVersionsRoot(url, user);
  const rootPathname = new URL(root).pathname; // usado p/ recortar o href do PROPFIND
  const auth = authHeader(user, pass);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body inválido (esperado JSON).' }, 400);
  }

  const action = String(body.action || '');
  const path = String(body.path || '');

  try {
    switch (action) {
      case 'ping': {
        const res = await fetch(`${root}/`, {
          method: 'PROPFIND',
          headers: { Authorization: auth, Depth: '0' },
        });
        if (!res.ok) return json({ ok: false, status: res.status, error: await res.text() }, 502);
        await res.text();
        return json({ ok: true, root });
      }

      case 'list': {
        const res = await fetch(davUrl(root, path), {
          method: 'PROPFIND',
          headers: { Authorization: auth, Depth: '1', 'Content-Type': 'application/xml' },
        });
        if (!res.ok) return json({ error: `PROPFIND falhou (${res.status})`, detail: await res.text() }, 502);
        const xml = await res.text();
        return json({ entries: parsePropfind(xml, rootPathname, path) });
      }

      case 'read': {
        // Cache-busting: um GET reaberto logo após um PUT NÃO pode devolver uma
        // versão antiga. Alguns caches (Cloudflare/reverse-proxy à frente do
        // Nextcloud) IGNORAM o Cache-Control do request e servem o GET pela URL.
        // Por isso variamos a URL com uma query única a cada leitura — muda a
        // chave de cache e obriga a buscar do servidor. O Nextcloud ignora a
        // query num GET de arquivo. (PROPFIND/stat não é cacheado, por isso via.)
        const cacheBust = `nc_cb=${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const readUrl = davUrl(root, path) + (davUrl(root, path).includes('?') ? '&' : '?') + cacheBust;
        const res = await fetch(readUrl, {
          method: 'GET',
          headers: { Authorization: auth, 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' },
          cache: 'no-store',
        });
        if (!res.ok) return json({ error: `GET falhou (${res.status})` }, 502);
        const buf = new Uint8Array(await res.arrayBuffer());
        return json({
          base64: bytesToBase64(buf),
          mime: res.headers.get('content-type') || 'application/octet-stream',
          size: buf.byteLength,
          etag: res.headers.get('oc-etag') || res.headers.get('etag') || null,
        });
      }

      // Metadados de um único arquivo (PROPFIND Depth:0). Usado para confirmar,
      // após um PUT, que o servidor de fato guardou o tamanho/etag esperado.
      case 'stat': {
        const res = await fetch(davUrl(root, path), {
          method: 'PROPFIND',
          headers: { Authorization: auth, Depth: '0', 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' },
          cache: 'no-store',
        });
        if (res.status === 404) { await res.text(); return json({ exists: false }); }
        if (!res.ok) return json({ error: `PROPFIND falhou (${res.status})`, detail: await res.text() }, 502);
        const xml = await res.text();
        const rawEtag = tag(xml, 'getetag');
        return json({
          exists: true,
          size: Number(tag(xml, 'getcontentlength') || 0),
          mime: tag(xml, 'getcontenttype') || 'application/octet-stream',
          mtime: tag(xml, 'getlastmodified'),
          etag: rawEtag ? rawEtag.replace(/^"|"$|&quot;/g, '') : null,
        });
      }

      case 'write': {
        const b64 = String(body.base64 || '');
        const bytes = base64ToBytes(b64);
        const res = await fetch(davUrl(root, path), {
          method: 'PUT',
          headers: {
            Authorization: auth,
            'Content-Type': String(body.mime || 'application/octet-stream'),
          },
          body: bytes,
        });
        if (!res.ok) return json({ error: `PUT falhou (${res.status})`, detail: await res.text() }, 502);
        // Devolve o que o Nextcloud confirmou sobre a gravação. O ETag e o tamanho
        // permitem ao front provar que a versão remota é a que ele acabou de enviar.
        const rawEtag = res.headers.get('oc-etag') || res.headers.get('etag');
        return json({
          ok: true,
          status: res.status,
          sentBytes: bytes.byteLength,
          etag: rawEtag ? rawEtag.replace(/^"|"$|&quot;/g, '') : null,
        });
      }

      case 'delete': {
        const res = await fetch(davUrl(root, path), { method: 'DELETE', headers: { Authorization: auth } });
        if (!res.ok && res.status !== 404) return json({ error: `DELETE falhou (${res.status})` }, 502);
        return json({ ok: true });
      }

      case 'mkcol': {
        const res = await fetch(davUrl(root, path), { method: 'MKCOL', headers: { Authorization: auth } });
        // 405 = já existe; tratamos como sucesso idempotente.
        if (!res.ok && res.status !== 405) return json({ error: `MKCOL falhou (${res.status})` }, 502);
        return json({ ok: true });
      }

      case 'move': {
        const destination = String(body.destination || '');
        if (!destination) return json({ error: 'destination é obrigatório para move.' }, 400);
        const res = await fetch(davUrl(root, path), {
          method: 'MOVE',
          headers: { Authorization: auth, Destination: davUrl(root, destination), Overwrite: 'T' },
        });
        if (!res.ok) return json({ error: `MOVE falhou (${res.status})` }, 502);
        return json({ ok: true });
      }

      case 'copy': {
        const destination = String(body.destination || '');
        if (!destination) return json({ error: 'destination é obrigatório para copy.' }, 400);
        const res = await fetch(davUrl(root, path), {
          method: 'COPY',
          headers: { Authorization: auth, Destination: davUrl(root, destination), Overwrite: 'T' },
        });
        if (!res.ok) return json({ error: `COPY falhou (${res.status})`, detail: await res.text() }, 502);
        return json({ ok: true });
      }

      case 'search': {
        const query = String(body.query || '').trim();
        if (!query) return json({ entries: [] });
        const base = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
        const scopeSegs = base ? base.split('/').filter(Boolean).map((s) => encodeURIComponent(s)).join('/') : '';
        const scopeHref = `/files/${encodeURIComponent(user)}${scopeSegs ? '/' + scopeSegs : ''}`;
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const searchBody =
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">' +
          '<d:basicsearch>' +
          '<d:select><d:prop><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:resourcetype/></d:prop></d:select>' +
          `<d:from><d:scope><d:href>${esc(scopeHref)}</d:href><d:depth>infinity</d:depth></d:scope></d:from>` +
          `<d:where><d:like><d:prop><d:displayname/></d:prop><d:literal>%${esc(query)}%</d:literal></d:like></d:where>` +
          '<d:orderby/>' +
          '</d:basicsearch></d:searchrequest>';
        const res = await fetch(`${url.replace(/\/+$/, '')}/remote.php/dav/`, {
          method: 'SEARCH',
          headers: { Authorization: auth, 'Content-Type': 'text/xml' },
          body: searchBody,
        });
        if (!res.ok) return json({ error: `SEARCH falhou (${res.status})`, detail: await res.text() }, 502);
        // Reusa o parser do PROPFIND (hrefs vem no mesmo formato /remote.php/dav/files/user/...).
        return json({ entries: parsePropfind(await res.text(), rootPathname) });
      }

      case 'versions': {
        const fileId = await resolveFileId(root, auth, path);
        if (!fileId) return json({ error: 'Não foi possível resolver o id do arquivo (necessário para versões).' }, 502);
        const res = await fetch(`${versionsRoot}/versions/${encodeURIComponent(fileId)}`, {
          method: 'PROPFIND',
          headers: { Authorization: auth, Depth: '1', 'Content-Type': 'application/xml' },
        });
        // 404 = sem versões ainda (arquivo nunca sobrescrito) → lista vazia.
        if (res.status === 404) { await res.text(); return json({ versions: [] }); }
        if (!res.ok) return json({ error: `PROPFIND de versões falhou (${res.status})`, detail: await res.text() }, 502);
        return json({ versions: parseVersions(await res.text()) });
      }

      case 'restoreVersion': {
        const versionId = String(body.versionId || '');
        if (!versionId) return json({ error: 'versionId é obrigatório para restoreVersion.' }, 400);
        const fileId = await resolveFileId(root, auth, path);
        if (!fileId) return json({ error: 'Não foi possível resolver o id do arquivo.' }, 502);
        const src = `${versionsRoot}/versions/${encodeURIComponent(fileId)}/${encodeURIComponent(versionId)}`;
        const dest = `${versionsRoot}/restore/target`;
        const res = await fetch(src, {
          method: 'MOVE',
          headers: { Authorization: auth, Destination: dest, Overwrite: 'T' },
        });
        if (!res.ok) return json({ error: `Restauração de versão falhou (${res.status})`, detail: await res.text() }, 502);
        return json({ ok: true });
      }

      case 'readVersion': {
        const versionId = String(body.versionId || '');
        if (!versionId) return json({ error: 'versionId é obrigatório para readVersion.' }, 400);
        const fileId = await resolveFileId(root, auth, path);
        if (!fileId) return json({ error: 'Não foi possível resolver o id do arquivo.' }, 502);
        const res = await fetch(`${versionsRoot}/versions/${encodeURIComponent(fileId)}/${encodeURIComponent(versionId)}`, {
          method: 'GET', headers: { Authorization: auth },
        });
        if (!res.ok) return json({ error: `GET de versão falhou (${res.status})` }, 502);
        const buf = new Uint8Array(await res.arrayBuffer());
        return json({ base64: bytesToBase64(buf), mime: res.headers.get('content-type') || 'application/octet-stream' });
      }

      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: 'Erro ao falar com o Nextcloud.', detail: String(err) }, 500);
  }
});
