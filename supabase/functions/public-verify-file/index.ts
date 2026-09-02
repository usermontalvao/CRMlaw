import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Serve, de forma HASH-scoped, a URL assinada do PDF assinado de um documento,
// para a tela pública de VERIFICAÇÃO (que usa verification_hash, não public_token).
// O servidor (service role) valida o hash → signatário → documento assinado e
// só então gera a URL — substituindo o acesso direto do papel `anon` ao bucket
// `assinados`. Documentos bloqueados/revogados (blocked_at) não são servidos.
//
// `kind: 'original'` serve o ARQUIVO DE ORIGEM — o que foi enviado para
// assinatura, antes de qualquer carimbo. Sem ele, o SHA-256 do original que a
// página de conferência imprime é um número que ninguém consegue recalcular:
// para conferir uma impressão digital é preciso ter o dedo. O padrão continua
// sendo 'signed', com a MESMA resposta de antes ({url, bucket}), porque a
// prévia e o download do validador dependem dela.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Buckets onde o PDF assinado pode residir.
const CANDIDATE_BUCKETS = ['assinados', 'generated-documents'];
// O arquivo de ORIGEM é enviado pelo `uploadDocument` para `document-templates`
// (prefixo `signatures/`). Os outros ficam como rede de segurança para envelopes
// montados por caminhos antigos.
const SOURCE_BUCKETS = ['document-templates', 'assinados', 'generated-documents'];

/** Nome de arquivo legível a partir do caminho no Storage. */
function nomeDoCaminho(caminho: string): string {
  const ultimo = String(caminho || '').split('/').pop() || '';
  return ultimo || 'documento';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    const { hash, expiresIn, kind } = await req.json().catch(() => ({}));
    if (!hash || typeof hash !== 'string') {
      return jsonResponse({ error: 'hash é obrigatório' }, 400);
    }
    const code = hash.trim().toUpperCase();
    const querOriginal = String(kind || '').trim().toLowerCase() === 'original';

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
    });

    const ttl = Math.min(Math.max(Number(expiresIn) || 3600, 60), 3600);

    /** Assina a URL no primeiro bucket em que o arquivo realmente existe. */
    const assinarUrl = async (caminho: string, buckets: string[]) => {
      for (const bucket of buckets) {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, ttl);
        if (error || !data?.signedUrl) continue;
        try {
          const head = await fetch(data.signedUrl, { method: 'HEAD' });
          if (head.ok) return { url: data.signedUrl, bucket };
        } catch { /* tenta o próximo bucket */ }
      }
      return null;
    };

    // ── ARQUIVO DE ORIGEM ────────────────────────────────────────────────────
    if (querOriginal) {
      type Origem = {
        name: string;
        path: string;
        document_type: 'main' | 'attachment';
        sha256: string | null;
      };
      let origens: Origem[] = [];
      let requestId: string | null = null;
      // 'file' = o SHA-256 impresso é o DESTE arquivo, e o download reproduz o
      // número. 'set' = o hash é da concatenação do conjunto (envelopes
      // consolidados com anexos), e nenhum arquivo isolado o reproduz.
      let escopoDoHash: 'file' | 'set' = 'file';

      // 1) Código de um documento individual (modelo per_document).
      const { data: docRow } = await supabase
        .from('signature_request_documents')
        .select('signature_request_id, source_file_path, display_name, document_type, document_hash')
        .filter('verification_code', 'ilike', code)
        .maybeSingle();

      if ((docRow as any)?.source_file_path) {
        requestId = (docRow as any).signature_request_id;
        origens = [{
          name: (docRow as any).display_name || nomeDoCaminho((docRow as any).source_file_path),
          path: (docRow as any).source_file_path,
          document_type: ((docRow as any).document_type === 'attachment' ? 'attachment' : 'main'),
          sha256: (docRow as any).document_hash ?? null,
        }];
      }

      // 2) Código de signatário / de solicitação / protocolo do envelope.
      if (origens.length === 0) {
        const { data: signer } = await supabase
          .from('signature_signers')
          .select('signature_request_id')
          .filter('verification_hash', 'ilike', code)
          .maybeSingle();
        requestId = (signer as any)?.signature_request_id ?? null;

        if (!requestId) {
          const { data: porCodigo } = await supabase
            .from('signature_requests')
            .select('id')
            .or(`verification_hash.ilike.${code},envelope_verification_code.ilike.${code}`)
            .maybeSingle();
          requestId = (porCodigo as any)?.id ?? null;
        }
        if (!requestId && /^[0-9a-f-]{36}$/i.test(code)) {
          const { data: porId } = await supabase
            .from('signature_requests')
            .select('id').eq('id', code.toLowerCase()).maybeSingle();
          requestId = (porId as any)?.id ?? null;
        }
        if (!requestId) return jsonResponse({ error: 'Documento não encontrado' }, 404);

        // No per_document as origens têm linha própria, cada uma com o seu hash.
        const { data: docs } = await supabase
          .from('signature_request_documents')
          .select('source_file_path, display_name, document_type, document_hash, sort_order')
          .eq('signature_request_id', requestId)
          .not('source_file_path', 'is', null)
          .order('sort_order', { ascending: true });

        if (Array.isArray(docs) && docs.length > 0) {
          origens = docs.map((d: any) => ({
            name: d.display_name || nomeDoCaminho(d.source_file_path),
            path: d.source_file_path,
            document_type: d.document_type === 'attachment' ? 'attachment' : 'main',
            sha256: d.document_hash ?? null,
          }));
        } else {
          // Consolidado (legado): principal + anexos na própria solicitação. O
          // hash de integridade cobre a CONCATENAÇÃO, então com anexo nenhum
          // arquivo sozinho reproduz o número — e a resposta diz isso.
          const { data: reqRow } = await supabase
            .from('signature_requests')
            .select('document_path, document_name, attachment_paths')
            .eq('id', requestId)
            .maybeSingle();
          const principal = (reqRow as any)?.document_path;
          if (!principal) return jsonResponse({ error: 'Arquivo de origem não encontrado' }, 404);

          const anexos: string[] = Array.isArray((reqRow as any)?.attachment_paths)
            ? (reqRow as any).attachment_paths
            : [];
          origens = [
            {
              name: (reqRow as any)?.document_name || nomeDoCaminho(principal),
              path: principal,
              document_type: 'main',
              sha256: null,
            },
            ...anexos.map((caminho: string) => ({
              name: nomeDoCaminho(caminho),
              path: caminho,
              document_type: 'attachment' as const,
              sha256: null,
            })),
          ];
          escopoDoHash = anexos.length > 0 ? 'set' : 'file';
        }
      }

      if (origens.length === 0 || !requestId) {
        return jsonResponse({ error: 'Arquivo de origem não encontrado' }, 404);
      }

      // Bloqueio vale para a origem exatamente como vale para o assinado.
      const { data: request } = await supabase
        .from('signature_requests').select('blocked_at').eq('id', requestId).maybeSingle();
      if (request?.blocked_at) return jsonResponse({ error: 'Validação pública desativada' }, 403);

      const arquivos = [];
      for (const origem of origens) {
        const assinada = await assinarUrl(origem.path, SOURCE_BUCKETS);
        if (!assinada) continue;
        arquivos.push({
          name: origem.name,
          url: assinada.url,
          bucket: assinada.bucket,
          document_type: origem.document_type,
          sha256: origem.sha256,
        });
      }
      if (arquivos.length === 0) return jsonResponse({ error: 'Arquivo não encontrado' }, 404);

      return jsonResponse({ files: arquivos, hash_scope: escopoDoHash });
    }

    // ── PDF ASSINADO (comportamento original, intocado) ───────────────────────
    // 1) hash → signatário (e a solicitação, para checar bloqueio)
    const { data: signer } = await supabase
      .from('signature_signers')
      .select('signature_request_id, signed_document_path')
      .filter('verification_hash', 'ilike', code)
      .maybeSingle();

    let signedPath: string | null = signer?.signed_document_path ?? null;
    let requestId: string | null = signer?.signature_request_id ?? null;

    // Fallback: assinatura única no nível da solicitação
    if (!signedPath) {
      const { data: reqRow } = await supabase
        .from('signature_requests')
        .select('id, signed_document_path')
        .filter('verification_hash', 'ilike', code)
        .maybeSingle();
      signedPath = (reqRow as any)?.signed_document_path ?? null;
      requestId = (reqRow as any)?.id ?? requestId;
    }

    // Fallback (modelo per_document): código de verificação de um documento individual
    // do envelope → arquivo assinado próprio. Aditivo; não afeta os hashes legados.
    if (!signedPath) {
      const { data: docRow } = await supabase
        .from('signature_request_documents')
        .select('signature_request_id, signed_file_path')
        .filter('verification_code', 'ilike', code)
        .maybeSingle();
      signedPath = (docRow as any)?.signed_file_path ?? null;
      requestId = (docRow as any)?.signature_request_id ?? requestId;
    }

    if (!signedPath || !requestId) return jsonResponse({ error: 'Documento não encontrado' }, 404);

    // 2) recusa documentos bloqueados/revogados
    const { data: request } = await supabase
      .from('signature_requests')
      .select('blocked_at')
      .eq('id', requestId)
      .maybeSingle();
    if (request?.blocked_at) return jsonResponse({ error: 'Validação pública desativada' }, 403);

    // 3) gera URL assinada (confirma existência com HEAD)
    const assinada = await assinarUrl(signedPath, CANDIDATE_BUCKETS);
    if (assinada) return jsonResponse({ url: assinada.url, bucket: assinada.bucket });

    return jsonResponse({ error: 'Arquivo não encontrado' }, 404);
  } catch (err) {
    console.error('[public-verify-file] erro:', err);
    return jsonResponse({ error: 'Erro interno' }, 500);
  }
});
