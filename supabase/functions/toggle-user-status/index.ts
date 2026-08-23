import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    const supabaseUser = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: callerData, error: callerError } = await supabaseUser.auth.getUser();
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = callerData.user.id;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json();
    const targetUserId: string | undefined = body?.user_id;
    const activate: boolean = body?.activate === true;

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetUserId === callerId) {
      return new Response(JSON.stringify({ error: "Cannot change your own status" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizeRole = (role: string) =>
      role.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("user_id", callerId)
      .maybeSingle();

    const callerRole = normalizeRole(callerProfile?.role ?? "");

    // Só administrador. Antes "advogado" também podia, e isso era uma escada:
    // desligar alguém remove vínculos, cancela transferências pendentes e
    // redistribui as conversas dele (gatilho `wa_offboard_ao_desativar`) — e um
    // advogado podia aplicar isso ao próprio administrador. Desligar é ato de
    // administração, não de operação.
    if (callerRole !== "administrador") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetProfileError) {
      return new Response(JSON.stringify({ error: targetProfileError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = String(targetProfile?.email || "").trim().toLowerCase();

    // Update profile is_active
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: activate, updated_at: new Date().toISOString() })
      .eq("user_id", targetUserId);

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ban or unban in Supabase Auth to block/allow login
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      targetUserId,
      { ban_duration: activate ? "none" : "876000h" }
    );

    if (authError) {
      // Rollback profile change
      await supabaseAdmin
        .from("profiles")
        .update({ is_active: !activate, updated_at: new Date().toISOString() })
        .eq("user_id", targetUserId);

      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // O ban do GoTrue impede LOGIN NOVO; ele não derruba a sessão já aberta, e
    // um JWT vivo vale por semanas com refresh. A porta de verdade quem fecha é
    // `is_office_staff()`, que passou a exigir `is_active` — mas deixar o
    // refresh token de pé seria confiar só nela. O endpoint de logout do GoTrue
    // revoga as sessões do usuário; best-effort, porque falhar aqui não pode
    // desfazer o desligamento que já foi gravado.
    if (!activate) {
      try {
        const logout = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${targetUserId}/logout`,
          {
            method: "POST",
            headers: {
              apikey: supabaseServiceRoleKey,
              Authorization: `Bearer ${supabaseServiceRoleKey}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (!logout.ok) {
          console.error("[toggle-user-status] logout não aplicado", logout.status, await logout.text());
        }
      } catch (e) {
        console.error("[toggle-user-status] logout falhou", e);
      }
    }

    if (activate && normalizedEmail) {
      const accountHash = await sha256Hex(`staff-login-account:account:${normalizedEmail}`);
      await supabaseAdmin.rpc("staff_login_account_reset", { p_account_hash: accountHash });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
