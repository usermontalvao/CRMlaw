import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// AES-GCM 256-bit encrypt/decrypt edge function.
// Env vars required:
//   INSS_CRYPTO_KEY  — 32 bytes encoded in base64 (use: openssl rand -base64 32)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — automáticos no Supabase
//
// POST body: { action: 'encrypt', plaintext: string }
//         or { action: 'decrypt', ciphertext: string }
// Response: { result: string }
//
// Wire format: base64url( iv[12] || ciphertext )

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

// ── key management ─────────────────────────────────────────────────────────────

let _cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;

  const keyB64 = Deno.env.get('INSS_CRYPTO_KEY');
  if (!keyB64) throw new Error('INSS_CRYPTO_KEY não configurada');

  const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error('INSS_CRYPTO_KEY deve ter exatamente 32 bytes');

  _cachedKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return _cachedKey;
}

// ── encode/decode helpers ──────────────────────────────────────────────────────

function toBase64Url(bytes: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

// ── encrypt / decrypt ──────────────────────────────────────────────────────────

async function encryptPlaintext(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );

  // Concatenate iv + ciphertext
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return toBase64Url(combined.buffer);
}

async function decryptCiphertext(ciphertext: string): Promise<string> {
  const key = await getKey();
  const combined = fromBase64Url(ciphertext);

  if (combined.length < 13) throw new Error('Ciphertext inválido');

  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted,
  );

  return new TextDecoder().decode(plainBuf);
}

// ── handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  // Verificar autenticação (requer JWT válido de usuário interno — não portal_client)
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Não autorizado' }, 401);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verificar que o token pertence a um usuário interno (não portal)
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: 'Token inválido' }, 401);

    // Rejeitar usuários portal (role = portal_client)
    const role = user.app_metadata?.role ?? user.user_metadata?.role ?? '';
    if (role === 'portal_client') return json({ error: 'Acesso negado' }, 403);

    const body = await req.json() as { action?: string; plaintext?: string; ciphertext?: string };
    const { action, plaintext, ciphertext } = body;

    if (action === 'encrypt') {
      if (typeof plaintext !== 'string' || plaintext.length === 0) {
        return json({ error: 'plaintext obrigatório' }, 400);
      }
      const result = await encryptPlaintext(plaintext);
      return json({ result });
    }

    if (action === 'decrypt') {
      if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
        return json({ error: 'ciphertext obrigatório' }, 400);
      }
      const result = await decryptCiphertext(ciphertext);
      return json({ result });
    }

    return json({ error: 'action deve ser "encrypt" ou "decrypt"' }, 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[inss-crypto]', msg);
    // Não revelar detalhes internos em produção
    return json({ error: 'Erro ao processar operação criptográfica' }, 500);
  }
});
