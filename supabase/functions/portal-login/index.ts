/**
 * portal-login — Login do Portal do Cliente com sessão Supabase REAL.
 *
 * Fluxo:
 *  1. Valida CPF + senha (4 últimos dígitos do telefone) via RPC portal_login
 *     (SECURITY DEFINER) usando a service role.
 *  2. Garante um usuário em auth.users vinculado ao cliente (email sintético,
 *     nunca enviado — serve só de âncora de identidade) e grava o vínculo em
 *     client_portal_users.auth_user_id.
 *  3. Mantém app_metadata.client_id / portal_user_id no usuário → vão para o JWT
 *     como claim, permitindo RLS e canais realtime privados por cliente.
 *  4. Gera um OTP (generateLink type=magiclink, sem enviar email) e devolve o
 *     token para o front concluir com supabase.auth.verifyOtp() — assim a sessão
 *     é emitida pelo próprio GoTrue (assinatura correta + refresh token).
 *
 * verify_jwt = false: este endpoint é o ponto de entrada pré-autenticação.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const onlyDigits = (v: string) => (v || "").replace(/\D/g, "");

// Email sintético determinístico por cliente. Nunca recebe correspondência —
// é só uma âncora de identidade no GoTrue. Domínio reservado para não colidir
// com emails reais de clientes/colaboradores.
const portalEmail = (clientId: string) => `portal-${clientId}@portal.jurius.local`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: "Supabase env não configurado" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => null);
    const cpf = onlyDigits(String(body?.cpf ?? ""));
    const password = onlyDigits(String(body?.password ?? ""));

    if (cpf.length !== 11) {
      return jsonResponse({ success: false, error: "CPF inválido. Digite os 11 dígitos." }, 400);
    }
    if (password.length !== 4) {
      return jsonResponse({ success: false, error: "Senha inválida. Digite os 4 últimos dígitos do seu telefone." }, 400);
    }

    // 1. Valida credenciais reusando a RPC já existente (SECURITY DEFINER).
    const { data: loginData, error: loginError } = await admin.rpc("portal_login", {
      p_cpf: cpf,
      p_password: password,
    });
    if (loginError) {
      const clean = (loginError.message || "Erro ao validar acesso.").replace(/^[A-Z0-9]+:\s*/, "");
      return jsonResponse({ success: false, error: clean }, 401);
    }
    const payload = loginData as {
      user?: { id?: string; client_id?: string };
      client?: { id?: string; nome?: string; email?: string | null; telefone?: string | null; photo_path?: string | null };
    } | null;
    const portalUserId = payload?.user?.id;
    const clientId = payload?.user?.client_id || payload?.client?.id;
    if (!portalUserId || !clientId) {
      return jsonResponse({ success: false, error: "Resposta inválida do servidor." }, 500);
    }

    const email = portalEmail(clientId);
    const appMetadata = { portal: true, client_id: clientId, portal_user_id: portalUserId };

    // 2. Resolve/garante o auth user vinculado ao portal_user.
    let authUserId: string | null = null;
    const { data: existing } = await admin
      .from("client_portal_users")
      .select("auth_user_id")
      .eq("id", portalUserId)
      .maybeSingle();
    authUserId = (existing?.auth_user_id as string | null) ?? null;

    if (authUserId) {
      // Mantém app_metadata + role atualizados (idempotente). O role=portal_client
      // é o que garante deny-by-default no PostgREST (ver migration portal_client_role).
      const { error: updErr } = await admin.auth.admin.updateUserById(authUserId, {
        app_metadata: appMetadata,
        role: "portal_client",
      });
      if (updErr) {
        // Usuário pode ter sido removido — recria abaixo.
        authUserId = null;
      }
    }

    if (!authUserId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: appMetadata,
        role: "portal_client",
      });
      if (createErr || !created?.user) {
        // Pode já existir (criado em login concorrente) — procura por email.
        const { data: list } = await admin.auth.admin.listUsers();
        const found = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (!found) {
          return jsonResponse({ success: false, error: "Falha ao preparar identidade do portal." }, 500);
        }
        authUserId = found.id;
        await admin.auth.admin.updateUserById(authUserId, { app_metadata: appMetadata, role: "portal_client" });
      } else {
        authUserId = created.user.id;
      }
      // Persiste o vínculo (best-effort).
      await admin.from("client_portal_users").update({ auth_user_id: authUserId }).eq("id", portalUserId);
    }

    // 3. Gera OTP (não envia email) para o front concluir com verifyOtp.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !linkData?.properties?.email_otp) {
      return jsonResponse({ success: false, error: "Falha ao emitir sessão do portal." }, 500);
    }

    return jsonResponse({
      success: true,
      email,
      token: linkData.properties.email_otp,
      user: { id: portalUserId, client_id: clientId, is_active: true, auth_user_id: authUserId },
      client: payload?.client ?? null,
    });
  } catch (error) {
    return jsonResponse(
      { success: false, error: (error as Error)?.message || "Erro desconhecido" },
      500,
    );
  }
});
