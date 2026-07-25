import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * nextcloud-webhook  (MVP)
 * -----------------------------------------------------------------------------
 * Recebe webhooks de mudança de arquivo do Nextcloud e grava em
 * public.nextcloud_change_events. O Supabase Realtime empurra o evento para o
 * NextcloudBrowser, que atualiza a pasta afetada.
 *
 * Aceita DOIS formatos de origem:
 *   A) App oficial "webhook_listeners" (OCS)  -> { event:{class,node|source|target}, user, time }
 *   B) App community "kffl/nextcloud-webhooks" via Flow "Outgoing webhook"
 *      (fire-and-forget, NÃO depende do cron) -> { eventType, eventName, node, ... }
 *
 * Autenticação (qualquer uma serve):
 *   - header  X-Nextcloud-Webhook-Secret: <segredo>
 *   - query   ?secret=<segredo>  (ou ?token=)  -> usado pelo Flow, cuja UI só tem campo de URL
 * O segredo vem de NEXTCLOUD_WEBHOOK_SECRET. Publicada com verify_jwt=false.
 * O segredo NUNCA é registrado em log.
 */

const MAX_BODY_BYTES = 128 * 1024;

/**
 * Comparação de segredo em tempo constante (não vaza o tamanho do prefixo
 * coincidente por timing). Retorna false imediatamente só quando os tamanhos
 * diferem — informação que o próprio protocolo já expõe.
 *
 * MANUTENÇÃO OPERACIONAL: não há evidência no repositório de que o valor de
 * NEXTCLOUD_WEBHOOK_SECRET tenha sido exposto. A rotação deve ser coordenada
 * entre os secrets do Supabase e a configuração do webhook no Nextcloud, em
 * uma janela de manutenção, ou antecipada se houver indício de exposição.
 * O valor nunca deve aparecer no código, documentação, chat ou log.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Classes canônicas (event_class gravado na tabela).
const NODE_CREATED = "OCP\\Files\\Events\\Node\\NodeCreatedEvent";
const NODE_WRITTEN = "OCP\\Files\\Events\\Node\\NodeWrittenEvent";
const NODE_DELETED = "OCP\\Files\\Events\\Node\\NodeDeletedEvent";
const NODE_RENAMED = "OCP\\Files\\Events\\Node\\NodeRenamedEvent";
const NODE_COPIED = "OCP\\Files\\Events\\Node\\NodeCopiedEvent";
const NODE_RESTORED = "OCP\\Files\\Events\\Node\\NodeRestoredEvent";

const ALLOWED_EVENTS = new Set([
  NODE_CREATED, NODE_WRITTEN, NODE_DELETED, NODE_RENAMED, NODE_COPIED, NODE_RESTORED,
]);

// eventName do kffl (hooks legados) -> classe canônica.
const KFFL_EVENT_MAP: Record<string, string> = {
  "\\OCP\\Files::postCreate": NODE_CREATED,
  "\\OCP\\Files::postWrite": NODE_WRITTEN,
  "\\OCP\\Files::postDelete": NODE_DELETED,
  "\\OCP\\Files::postRename": NODE_RENAMED,
  "\\OCP\\Files::postCopy": NODE_COPIED,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Normaliza um path do Nextcloud para o formato relativo do CRM.
 *   /admin/files/PESSOAL/doc.docx  (webhook_listeners path) -> PESSOAL/doc.docx
 *   files/PESSOAL/doc.docx         (kffl internalPath)      -> PESSOAL/doc.docx
 * Tolera paths já relativos.
 */
function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  let p = raw.replace(/^\/+/, "");
  const m = p.match(/^[^/]+\/files\/(.*)$/); // "<uid>/files/<rel>"
  if (m) p = m[1];
  else if (p.startsWith("files/")) p = p.slice("files/".length); // storage-relative
  return p.replace(/\/+$/, "");
}

function parentDir(path: string | null): string | null {
  if (path === null) return null;
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : ""; // "" = raiz
}

/** Extrai o primeiro path presente em um objeto de node do payload. */
function nodePath(node: unknown): { path: string | null; id: number | null } {
  if (!node || typeof node !== "object") return { path: null, id: null };
  const n = node as Record<string, unknown>;
  const path = normalizePath(n.path ?? n.internalPath ?? null);
  const idRaw = n.id ?? n.fileId ?? null;
  const id = typeof idRaw === "number" ? idRaw
    : typeof idRaw === "string" && /^\d+$/.test(idRaw) ? Number(idRaw)
    : null;
  return { path, id };
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  const correlationId = crypto.randomUUID();

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // --- autenticação: header OU secret/token na query -----------------------
  const secret = Deno.env.get("NEXTCLOUD_WEBHOOK_SECRET");
  if (!secret) {
    console.error(JSON.stringify({ correlationId, level: "error", msg: "secret_not_configured" }));
    return json({ error: "not_configured" }, 500);
  }
  const requestUrl = new URL(req.url);
  const provided = req.headers.get("X-Nextcloud-Webhook-Secret")
    ?? requestUrl.searchParams.get("secret")
    ?? requestUrl.searchParams.get("token")
    ?? "";
  if (!timingSafeEqual(provided, secret)) {
    console.warn(JSON.stringify({ correlationId, level: "warn", msg: "invalid_secret" }));
    return json({ error: "unauthorized" }, 401);
  }

  // --- body -----------------------------------------------------------------
  // Não exigimos Content-Type: o Flow do kffl dispara via exec(curl) e pode não
  // enviar application/json. A autenticação já é garantida pelo segredo acima;
  // aqui só validamos tamanho e se o corpo é JSON parseável.
  const lenHeader = Number(req.headers.get("content-length") ?? "0");
  if (lenHeader && lenHeader > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // --- detecta formato e extrai campos -------------------------------------
  let eventClass = "";
  let simple = { path: null as string | null, id: null as number | null };
  let source = { path: null as string | null, id: null as number | null };
  let target = { path: null as string | null, id: null as number | null };
  let actorUid: string | null = null;
  let actorName: string | null = null;
  let eventTime: number | null = null;
  let rawEvent: unknown = body;

  const evt = body.event as Record<string, unknown> | undefined;

  if (evt && typeof evt === "object" && typeof evt.class === "string") {
    // Formato A: webhook_listeners
    eventClass = evt.class;
    simple = nodePath(evt.node);
    source = nodePath(evt.source ?? evt.oldNode);
    target = nodePath(evt.target ?? evt.newNode);
    const usr = (body.user as Record<string, unknown> | undefined) ?? {};
    actorUid = typeof usr.uid === "string" ? usr.uid : null;
    actorName = typeof usr.displayName === "string" ? usr.displayName : null;
    eventTime = typeof body.time === "number" ? body.time : null;
    rawEvent = evt;
  } else if (typeof body.eventName === "string") {
    // Formato B: kffl/nextcloud-webhooks (Flow)
    eventClass = KFFL_EVENT_MAP[body.eventName] ?? "";
    simple = nodePath(body.node);
    const usr = (body.user as Record<string, unknown> | undefined) ?? {};
    actorUid = typeof usr.uid === "string" ? usr.uid
      : typeof body.user === "string" ? body.user : null;
    eventTime = typeof body.time === "number" ? body.time : null;
  } else {
    return json({ error: "invalid_envelope" }, 400);
  }

  if (!ALLOWED_EVENTS.has(eventClass)) {
    // Aceita e ignora eventos fora da lista (ex.: "arquivo acessado", etiqueta).
    console.log(JSON.stringify({
      correlationId, level: "info", msg: "ignored_event",
      raw_event: typeof body.eventName === "string" ? body.eventName : (evt?.class ?? null),
    }));
    return json({ ok: true, ignored: true });
  }

  const nodePathVal = simple.path ?? target.path ?? source.path;
  const nodeId = simple.id ?? target.id ?? source.id;
  const affectedDirs = new Set<string | null>();
  affectedDirs.add(parentDir(nodePathVal));
  if (source.path) affectedDirs.add(parentDir(source.path));
  if (target.path) affectedDirs.add(parentDir(target.path));
  const affectedDirectory = parentDir(target.path ?? simple.path ?? source.path);

  // --- insere via service role ---------------------------------------------
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { error } = await supabase.from("nextcloud_change_events").insert({
    event_class: eventClass,
    actor_uid: actorUid,
    actor_name: actorName,
    node_path: nodePathVal,
    source_path: source.path,
    target_path: target.path,
    affected_directory: affectedDirectory,
    node_id: nodeId,
    // `raw` guarda o evento cru (bounded pelo MAX_BODY) para diagnóstico do MVP:
    // se a extração de path divergir da forma real, dá para inspecionar aqui.
    payload: { event_time: eventTime, affected_dirs: [...affectedDirs], correlationId, raw: rawEvent },
  });

  const latencyMs = Date.now() - started;

  if (error) {
    console.error(JSON.stringify({
      correlationId, level: "error", msg: "insert_failed",
      eventClass, affectedDirectory, latencyMs, code: error.code,
    }));
    return json({ error: "insert_failed" }, 500);
  }

  console.log(JSON.stringify({
    correlationId, level: "info", msg: "event_stored",
    eventClass, affectedDirectory, latencyMs,
  }));

  return json({ ok: true });
});
