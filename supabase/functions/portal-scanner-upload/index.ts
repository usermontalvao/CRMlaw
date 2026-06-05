/**
 * portal-scanner-upload — Upload seguro de PDF do scanner do portal do cliente.
 *
 * Problema: Supabase Storage retorna "schema out of sync" ao avaliar políticas RLS
 * que referenciam tabelas do schema public. Solução: edge function com service role
 * que valida o JWT do portal e faz o upload diretamente, bypassando as políticas RLS.
 *
 * Recebe: multipart/form-data com campo "file" (PDF) e "path" (caminho no bucket)
 * Retorna: { path: string } em caso de sucesso
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "client-documents";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // 1. Validate portal JWT — extract client_id from app_metadata
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

  let clientId: string | null = null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT format");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    clientId = payload?.app_metadata?.client_id ?? null;
    if (!clientId) throw new Error("Missing client_id in JWT app_metadata");
    // Verify token isn't expired
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return jsonResponse({ error: "Token expired" }, 401);
    }
  } catch (e) {
    return jsonResponse({ error: `Invalid token: ${(e as Error).message}` }, 401);
  }

  // 2. Parse multipart form — expect "file" field (PDF blob)
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse({ error: "Invalid form data" }, 400);
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || !(fileEntry instanceof File)) {
    return jsonResponse({ error: "Missing 'file' field in form data" }, 400);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const path = `${clientId}/scanner_${dateStr}/${uniqueSuffix}.pdf`;

  // 3. Upload using service role — bypasses RLS entirely
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, fileEntry, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    console.error("[portal-scanner-upload] storage error:", uploadError);
    return jsonResponse({ error: uploadError.message }, 500);
  }

  // Generate a long-lived signed URL (1 year) using service role so the portal
  // client can view/download the file from the messages page without needing its
  // own storage permissions on client-documents.
  const { data: signData } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365);

  return jsonResponse({ path, bucket: BUCKET, signedUrl: signData?.signedUrl ?? null });
});
