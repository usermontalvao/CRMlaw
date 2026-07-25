import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
export { sanitizeNextcloudPath } from "./nextcloud-path.ts";
export type { SanitizeOptions } from "./nextcloud-path.ts";

/**
 * _shared/nextcloud-auth
 * -----------------------------------------------------------------------------
 * Guarda de segurança compartilhada pelas Edge Functions do Nextcloud
 * (`nextcloud-proxy`, `nextcloud-upload`). Centraliza:
 *
 *   - CORS restrito aos origins configurados (sem "*" quando há allow-list).
 *   - Autenticação real do chamador via JWT de sessão (auth.getUser()).
 *   - Autorização: o usuário precisa ser um colaborador ATIVO (profiles.is_active).
 *   - Sanitização de caminho WebDAV (rejeita "", ".", "..", NUL, controle, etc.).
 *   - Auditoria mínima estruturada (usuário, caminho, tamanho, resultado, hora),
 *     nunca conteúdo nem segredo.
 *
 * IMPORTANTE sobre `verify_jwt`: o Supabase aceita a própria ANON KEY (pública,
 * embutida no front) como um JWT válido. Portanto `verify_jwt=true` NÃO impede
 * um anônimo de chamar a função — só `auth.getUser()` distingue uma sessão real
 * de usuário. Por isso a verificação abaixo é obrigatória (defesa em profundidade).
 */

/** Monta os headers CORS para a requisição, restringindo o Origin.
 *
 *  `NEXTCLOUD_ALLOWED_ORIGINS` = lista separada por vírgula. Quando definida,
 *  só reflete o Origin se ele estiver na lista (senão devolve o primeiro
 *  configurado, nunca "*"). Sem a variável, reflete o Origin recebido como
 *  fallback de desenvolvimento — configure a lista em produção para travar. */
export function corsHeadersFor(req: Request, extraAllowHeaders = ""): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const configured = (Deno.env.get("NEXTCLOUD_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  let allowOrigin = "";
  if (configured.length === 0) {
    // Fallback de desenvolvimento: reflete o Origin (documente e configure em prod).
    allowOrigin = origin || "*";
  } else if (origin && configured.includes(origin)) {
    allowOrigin = origin;
  } else {
    // Origin não autorizado: usa o primeiro configurado para não vazar "*".
    allowOrigin = configured[0];
  }

  const allowHeaders = [
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    extraAllowHeaders,
  ].filter(Boolean).join(", ");

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export interface AuthResult {
  user: { id: string; email: string | null };
}

/**
 * Verifica que o chamador é um usuário autenticado e um colaborador ATIVO.
 * Retorna `{ user }` em sucesso, ou uma `Response` (401/403/500) pronta para
 * devolver. Nunca lança — o handler só precisa checar `instanceof Response`.
 */
export async function authenticateStaff(
  req: Request,
  cors: Record<string, string>,
): Promise<AuthResult | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "server_misconfigured" }, 500, cors);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ") || authHeader.length < 20) {
    return jsonResponse({ error: "unauthorized" }, 401, cors);
  }

  // Cliente com o JWT do chamador: identifica QUEM está chamando.
  const asCaller = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "unauthorized" }, 401, cors);
  }
  const user = userData.user;

  // Autorização: precisa existir um profile ativo para este usuário.
  const asAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: profile, error: profileError } = await asAdmin
    .from("profiles")
    .select("user_id, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return jsonResponse({ error: "authz_check_failed" }, 500, cors);
  }
  if (!profile || profile.is_active === false) {
    return jsonResponse({ error: "forbidden" }, 403, cors);
  }

  return { user: { id: user.id, email: user.email ?? null } };
}

/** Log de auditoria estruturado (stdout). Nunca inclui conteúdo nem segredo. */
export function auditLog(entry: {
  fn: string;
  userId: string;
  action: string;
  path?: string | null;
  bytes?: number | null;
  result: "ok" | "denied" | "error";
  status: number;
  detail?: string;
}): void {
  console.log(JSON.stringify({
    level: entry.result === "ok" ? "info" : "warn",
    ts: new Date().toISOString(),
    ...entry,
  }));
}
