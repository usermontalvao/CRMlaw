/**
 * check-env-keys — verifica se variáveis de ambiente estão configuradas no runtime Deno.
 *
 * Recebe POST { keys: string[] } e retorna { [key]: boolean } para cada nome enviado.
 * Só aceita chaves que constem na lista de permissão (ALLOWED_KEYS) para evitar
 * enumeração arbitrária de variáveis de ambiente sensíveis.
 */

const ALLOWED_KEYS = new Set([
  // Criptografia
  "INSS_CRYPTO_KEY",
  // E-mail
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  // DJEN / DataJud
  "DJEN_API_KEY",
  "DATAJUD_API_KEY",
  "DATAJUD_USERNAME",
  "DATAJUD_PASSWORD",
  // IA
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  // Push / Portal
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  // SMS
  "SMSDEV_API_KEY",
  // Supabase (sempre presentes nas edges, mas podem estar no registro)
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let keys: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.keys)) keys = body.keys;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result: Record<string, boolean> = {};
  for (const key of keys) {
    if (typeof key !== "string" || !ALLOWED_KEYS.has(key)) {
      result[key] = false;
      continue;
    }
    const val = Deno.env.get(key);
    result[key] = typeof val === "string" && val.trim().length > 0;
  }

  return new Response(JSON.stringify({ ok: true, results: result }), {
    headers: { "Content-Type": "application/json" },
  });
});
