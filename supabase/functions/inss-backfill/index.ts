import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Edge function de backfill: migra inss_password (plain) → inss_password_enc (AES-GCM)
// e zera o campo plain em cada registro migrado.
//
// POST /functions/v1/inss-backfill
// Headers: Authorization: Bearer <service_role_key ou admin JWT>
// Body (opcional): { batch_size?: number }   (padrão: 100)
//
// Env vars: INSS_CRYPTO_KEY (32 bytes base64), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

let _cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;
  const keyB64 = Deno.env.get('INSS_CRYPTO_KEY');
  if (!keyB64) throw new Error('INSS_CRYPTO_KEY não configurada');
  const keyBytes = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error('INSS_CRYPTO_KEY deve ter exatamente 32 bytes');
  _cachedKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  return _cachedKey;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function encryptPlaintext(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return toBase64Url(combined.buffer);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Não autorizado' }, 401);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verificar que o token pertence a um usuário interno (não portal_client)
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: 'Token inválido' }, 401);
    const role = user.app_metadata?.role ?? user.user_metadata?.role ?? '';
    if (role === 'portal_client') return json({ error: 'Acesso negado' }, 403);

    const body = await req.json().catch(() => ({})) as { batch_size?: number };
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 100, 1), 500);

    // Buscar registros que têm senha plain e ainda não foram encriptados
    const { data: records, error: fetchErr } = await supabase
      .from('requirements')
      .select('id, inss_password')
      .not('inss_password', 'is', null)
      .is('inss_password_enc', null)
      .limit(batchSize);

    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!records || records.length === 0) {
      return json({ processed: 0, failed: 0, remaining: 0, message: 'Nenhum registro para migrar.' });
    }

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const rec of records) {
      const plain = rec.inss_password as string | null;
      if (!plain) continue;
      try {
        const enc = await encryptPlaintext(plain);
        const { error: updateErr } = await supabase
          .from('requirements')
          .update({ inss_password_enc: enc, inss_password: null })
          .eq('id', rec.id);
        if (updateErr) {
          errors.push(`${rec.id}: ${updateErr.message}`);
          failed++;
        } else {
          processed++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${rec.id}: ${msg}`);
        failed++;
      }
    }

    // Contar quantos ainda restam
    const { count: remaining } = await supabase
      .from('requirements')
      .select('id', { count: 'exact', head: true })
      .not('inss_password', 'is', null)
      .is('inss_password_enc', null);

    return json({
      processed,
      failed,
      remaining: remaining ?? 0,
      errors: errors.length > 0 ? errors : undefined,
      message: `${processed} migrados, ${failed} falhou, ${remaining ?? 0} ainda pendentes.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[inss-backfill]', msg);
    return json({ error: 'Erro interno' }, 500);
  }
});
