/**
 * nextcloud-autolink — vinculação automática (headless) de pastas do Nextcloud
 * aos clientes do CRM.
 * -----------------------------------------------------------------------------
 * IMPORTANTE: deployar com verify_jwt=false. A autenticação é por token
 * compartilhado na URL (?token=xxx), no mesmo molde de `run-djen-sync`.
 *
 * Deploy via CLI:
 *   supabase functions deploy nextcloud-autolink --no-verify-jwt
 *
 * O que faz: lista as pastas do Nextcloud (via WebDAV PROPFIND, com credenciais
 * de serviço), carrega os clientes e os vínculos já existentes e aplica SOZINHO
 * apenas os casamentos com 100% de certeza (CPF/CNPJ único, ou nome exato e
 * único). Pastas ambíguas ("pode ser outra pessoa") são deliberadamente
 * ignoradas — seguem para confirmação manual no CloudModule.
 *
 * Usa service_role → ignora a RLS de `nextcloud_folder_links` (que só permite
 * escrita ao papel `authenticated`), por isso pode rodar sem sessão de usuário.
 *
 * Secrets necessários (os mesmos do nextcloud-proxy):
 *   NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados automaticamente)
 *   NEXTCLOUD_AUTOLINK_TOKEN (opcional; senão cai em service_function_tokens)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_TOKEN = Deno.env.get('NEXTCLOUD_AUTOLINK_TOKEN') || 'djen-sync-2024';

// ── Lógica pura de vinculação (espelho de src/utils/nextcloudAutoLink.ts) ──────
interface AutoLinkClient { id: string; full_name: string; cpf_cnpj?: string | null }
interface AutoLinkFolder { name: string; path: string }
interface AutoLinkMatch { folderPath: string; folderName: string; clientId: string; clientName: string; reason: 'cpf' | 'name-exact' }
interface AutoLinkPlan { auto: AutoLinkMatch[]; confirmCount: number; unmatchedCount: number }

function normalizeName(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function onlyDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D+/g, '');
}

function containsWholeTokens(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Só produz `auto` (100% certo). Conta confirmáveis/sem-match para o relatório. */
function planAutoLinks(
  folders: readonly AutoLinkFolder[],
  clients: readonly AutoLinkClient[],
  linkedPaths: ReadonlySet<string>,
): AutoLinkPlan {
  const auto: AutoLinkMatch[] = [];
  let confirmCount = 0;
  let unmatchedCount = 0;

  const byNormName = new Map<string, AutoLinkClient[]>();
  for (const c of clients) {
    const n = normalizeName(c.full_name);
    if (!n) continue;
    const bucket = byNormName.get(n);
    if (bucket) bucket.push(c);
    else byNormName.set(n, [c]);
  }

  for (const folder of folders) {
    if (linkedPaths.has(folder.path)) continue;

    const folderDigits = onlyDigits(folder.name);
    const normFolder = normalizeName(folder.name);

    // 1) CPF/CNPJ contido no nome da pasta.
    const cpfMatches = folderDigits
      ? clients.filter((c) => {
          const d = onlyDigits(c.cpf_cnpj);
          return (d.length === 11 || d.length === 14) && folderDigits.includes(d);
        })
      : [];
    if (cpfMatches.length === 1) {
      const c = cpfMatches[0];
      auto.push({ folderPath: folder.path, folderName: folder.name, clientId: c.id, clientName: c.full_name, reason: 'cpf' });
      continue;
    }
    if (cpfMatches.length > 1) { confirmCount += 1; continue; }

    // 2) Nome idêntico (normalizado).
    const exact = normFolder ? byNormName.get(normFolder) ?? [] : [];
    if (exact.length === 1) {
      const c = exact[0];
      auto.push({ folderPath: folder.path, folderName: folder.name, clientId: c.id, clientName: c.full_name, reason: 'name-exact' });
      continue;
    }
    if (exact.length > 1) { confirmCount += 1; continue; }

    // 3) Nome parcial → nunca automático.
    if (normFolder.length >= 3) {
      let hasPartial = false;
      for (const c of clients) {
        const n = normalizeName(c.full_name);
        if (n.length < 3) continue;
        if (containsWholeTokens(normFolder, n) || containsWholeTokens(n, normFolder)) { hasPartial = true; break; }
      }
      if (hasPartial) { confirmCount += 1; continue; }
    }

    unmatchedCount += 1;
  }

  return { auto, confirmCount, unmatchedCount };
}

// ── Helpers WebDAV (espelho do nextcloud-proxy) ────────────────────────────────
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

function authHeader(user: string, pass: string): string {
  return 'Basic ' + btoa(`${user}:${pass}`);
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<[^>]*${name}[^>]*>([\\s\\S]*?)</[^>]*${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** PROPFIND Depth:1 → lista de { name, path, isDir } (só o que precisamos aqui). */
function parsePropfind(xml: string, rootPathname: string, queriedPath = ''): AutoLinkFolder[] & Array<{ isDir: boolean }> {
  const entries: Array<{ name: string; path: string; isDir: boolean }> = [];
  const blocks = xml.match(/<[a-z]*:?response[\s\S]*?<\/[a-z]*:?response>/gi) || [];
  const self = String(queriedPath || '').replace(/^\/+/, '').replace(/\/+$/, '');

  for (const block of blocks) {
    const rawHref = tag(block, 'href');
    if (!rawHref) continue;
    let href = rawHref;
    try { href = decodeURIComponent(rawHref); } catch { /* mantém cru */ }

    const idx = href.indexOf(rootPathname);
    let rel = idx >= 0 ? href.slice(idx + rootPathname.length) : href;
    rel = rel.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!rel || rel === self) continue;

    const isDir = /<[a-z]*:?resourcetype>[\s\S]*collection/i.test(block);
    // `rel` já vem decodificado (o href foi decodificado acima). Um segundo
    // decode estoura URIError se o nome tiver um '%' literal — por isso o
    // try/catch com fallback para o valor cru.
    const rawName = rel.split('/').pop() || rel;
    let name = rawName;
    try { name = decodeURIComponent(rawName); } catch { name = rawName; }
    entries.push({ name, path: rel, isDir });
  }
  return entries as AutoLinkFolder[] & Array<{ isDir: boolean }>;
}

async function listDir(root: string, auth: string, rootPathname: string, path: string) {
  const res = await fetch(davUrl(root, path), {
    method: 'PROPFIND',
    headers: { Authorization: auth, Depth: '1', 'Content-Type': 'application/xml' },
  });
  if (!res.ok) throw new Error(`PROPFIND falhou em "${path}" (${res.status})`);
  const xml = await res.text();
  return parsePropfind(xml, rootPathname, path);
}

// ── Handler ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const deep = url.searchParams.get('deep') !== '0'; // padrão: varre toda a árvore

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── Gate por token compartilhado (rotacionável via service_function_tokens) ──
    let expectedToken = DEFAULT_TOKEN;
    try {
      const { data: tk } = await supabase
        .from('service_function_tokens')
        .select('token')
        .eq('fn', 'nextcloud-autolink')
        .maybeSingle();
      if (tk?.token) expectedToken = tk.token as string;
    } catch (_) { /* fallback ao env/default */ }

    if (!token || token !== expectedToken) {
      return json({ error: 'Token inválido' }, 401);
    }

    // ── Credenciais Nextcloud ───────────────────────────────────────────────────
    const ncUrl = Deno.env.get('NEXTCLOUD_URL');
    const ncUser = Deno.env.get('NEXTCLOUD_USER');
    const ncPass = Deno.env.get('NEXTCLOUD_APP_PASSWORD');
    if (!ncUrl || !ncUser || !ncPass) {
      return json({ error: 'Nextcloud não configurado (NEXTCLOUD_URL/USER/APP_PASSWORD).' }, 500);
    }
    const root = davRoot(ncUrl, ncUser);
    const rootPathname = new URL(root).pathname;
    const auth = authHeader(ncUser, ncPass);

    // ── Carregar clientes + vínculos existentes ────────────────────────────────
    const [{ data: clientsRaw, error: cErr }, { data: linksRaw, error: lErr }] = await Promise.all([
      supabase.from('clients').select('id, full_name, cpf_cnpj'),
      supabase.from('nextcloud_folder_links').select('path'),
    ]);
    if (cErr) throw new Error(`Falha ao carregar clientes: ${cErr.message}`);
    if (lErr) throw new Error(`Falha ao carregar vínculos: ${lErr.message}`);

    const clients = (clientsRaw ?? []) as AutoLinkClient[];
    if (clients.length === 0) return json({ error: 'Sem clientes — nada a vincular.' }, 200);
    const linkedPaths = new Set((linksRaw ?? []).map((r: { path: string }) => r.path));

    // ── Varrer pastas: raiz (deep=0) ou árvore inteira (BFS bounded) ────────────
    const MAX_LISTINGS = 500;
    const MAX_FOLDERS = 5000;
    const folders: AutoLinkFolder[] = [];
    const queue: string[] = [''];
    let listings = 0;
    while (queue.length > 0 && listings < MAX_LISTINGS && folders.length < MAX_FOLDERS) {
      const dir = queue.shift() as string;
      let entries;
      try { entries = await listDir(root, auth, rootPathname, dir); }
      catch (err) { console.error(String(err)); continue; }
      listings += 1;
      for (const e of entries) {
        if (!e.isDir) continue;
        folders.push({ name: e.name, path: e.path });
        if (deep) queue.push(e.path);
      }
    }

    // ── Planejar e aplicar SÓ os 100% certos ────────────────────────────────────
    const plan = planAutoLinks(folders, clients, linkedPaths);
    let applied = 0;
    let failed = 0;
    for (const m of plan.auto) {
      const { error } = await supabase
        .from('nextcloud_folder_links')
        .upsert({ path: m.folderPath, client_id: m.clientId, created_by: null }, { onConflict: 'path' });
      if (error) { failed += 1; console.error(`Falha ao vincular "${m.folderPath}": ${error.message}`); }
      else { applied += 1; console.log(`🔗 ${m.folderName} → ${m.clientName} (${m.reason})`); }
    }

    return json({
      ok: true,
      scanned_folders: folders.length,
      listings,
      linked: applied,
      failed,
      pending_confirmation: plan.confirmCount,
      unmatched: plan.unmatchedCount,
    });
  } catch (error) {
    console.error('❌ nextcloud-autolink:', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
