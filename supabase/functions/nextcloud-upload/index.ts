import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  auditLog,
  authenticateStaff,
  corsHeadersFor,
  jsonResponse,
  sanitizeNextcloudPath,
} from "../_shared/nextcloud-auth.ts";

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
 * Segurança (ver ../_shared/nextcloud-auth.ts):
 *   - Exige JWT de sessão de um colaborador ATIVO (401/403).
 *   - Sanitiza o caminho (rejeita "", ".", "..", NUL, controle, backslash).
 *   - Limita o tamanho do upload (NEXTCLOUD_MAX_UPLOAD_BYTES, padrão 100 MB).
 *   - CORS restrito (NEXTCLOUD_ALLOWED_ORIGINS).
 *
 * Secrets do Nextcloud (nunca expostos ao cliente):
 *   NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD.
 */

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

function maxUploadBytes(): number {
  const raw = Number(Deno.env.get("NEXTCLOUD_MAX_UPLOAD_BYTES"));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_UPLOAD_BYTES;
}

function davRoot(url: string, user: string): string {
  return `${url.replace(/\/+$/, "")}/remote.php/dav/files/${encodeURIComponent(user)}`;
}

function davUrl(root: string, path: string): string {
  const clean = String(path || "")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return clean ? `${root}/${clean}` : `${root}/`;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req, "x-nc-path, x-nc-mime");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, cors);
  }

  // --- autenticação + autorização ------------------------------------------
  const auth = await authenticateStaff(req, cors);
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;

  const url = Deno.env.get("NEXTCLOUD_URL");
  const user = Deno.env.get("NEXTCLOUD_USER");
  const pass = Deno.env.get("NEXTCLOUD_APP_PASSWORD");
  if (!url || !user || !pass) {
    auditLog({ fn: "nextcloud-upload", userId, action: "put", result: "error", status: 500 });
    return jsonResponse({ error: "nextcloud_not_configured" }, 500, cors);
  }

  // --- caminho: decodifica o header e sanitiza ------------------------------
  const encodedPath = req.headers.get("x-nc-path");
  if (!encodedPath) return jsonResponse({ error: "x_nc_path_missing" }, 400, cors);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedPath);
  } catch {
    return jsonResponse({ error: "x_nc_path_invalid" }, 400, cors);
  }
  const path = sanitizeNextcloudPath(decoded);
  if (!path) {
    auditLog({ fn: "nextcloud-upload", userId, action: "put", path: null, result: "denied", status: 400, detail: "invalid_path" });
    return jsonResponse({ error: "invalid_path" }, 400, cors);
  }

  // --- tamanho: rejeita cedo pelo Content-Length ----------------------------
  const limit = maxUploadBytes();
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (declaredLen && declaredLen > limit) {
    auditLog({ fn: "nextcloud-upload", userId, action: "put", path, bytes: declaredLen, result: "denied", status: 413 });
    return jsonResponse({ error: "payload_too_large", limit }, 413, cors);
  }

  const mime = req.headers.get("x-nc-mime") || "application/octet-stream";
  const bytes = new Uint8Array(await req.arrayBuffer());

  // Valida o tamanho REAL recebido (Content-Length pode mentir/faltar).
  if (bytes.byteLength === 0) {
    return jsonResponse({ error: "empty_body" }, 400, cors);
  }
  if (bytes.byteLength > limit) {
    auditLog({ fn: "nextcloud-upload", userId, action: "put", path, bytes: bytes.byteLength, result: "denied", status: 413 });
    return jsonResponse({ error: "payload_too_large", limit }, 413, cors);
  }

  const root = davRoot(url, user);
  const basic = "Basic " + btoa(`${user}:${pass}`);

  // If-Match opcional: quando o cliente informa o ETag esperado, o Nextcloud
  // devolve 412 se a versão remota mudou (impede sobrescrita concorrente).
  const ifMatch = req.headers.get("if-match");
  const putHeaders: Record<string, string> = { Authorization: basic, "Content-Type": mime };
  if (ifMatch) putHeaders["If-Match"] = ifMatch;

  let res: Response;
  try {
    res = await fetch(davUrl(root, path), { method: "PUT", headers: putHeaders, body: bytes });
  } catch (err) {
    auditLog({ fn: "nextcloud-upload", userId, action: "put", path, bytes: bytes.byteLength, result: "error", status: 502, detail: String(err) });
    return jsonResponse({ error: "upstream_unreachable" }, 502, cors);
  }

  if (res.status === 412) {
    await res.text();
    auditLog({ fn: "nextcloud-upload", userId, action: "put", path, bytes: bytes.byteLength, result: "denied", status: 412, detail: "etag_mismatch" });
    return jsonResponse({ error: "version_conflict" }, 412, cors);
  }
  if (!res.ok) {
    const detail = await res.text();
    auditLog({ fn: "nextcloud-upload", userId, action: "put", path, bytes: bytes.byteLength, result: "error", status: 502, detail: `put_${res.status}` });
    return jsonResponse({ error: "put_failed", status: res.status, detail }, 502, cors);
  }

  const rawEtag = res.headers.get("oc-etag") || res.headers.get("etag");
  auditLog({ fn: "nextcloud-upload", userId, action: "put", path, bytes: bytes.byteLength, result: "ok", status: res.status });
  return jsonResponse({
    ok: true,
    status: res.status,
    sentBytes: bytes.byteLength,
    etag: rawEtag ? rawEtag.replace(/^"|"$|&quot;/g, "") : null,
  }, 200, cors);
});
