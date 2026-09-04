// ============================================================================
// CONGELAR O ORIGINAL — o servidor apura a impressão digital do que vai ser
// assinado. Etapa 1 de tirar a montagem do aparelho de quem assina.
// ----------------------------------------------------------------------------
// O QUE ESTA FUNÇÃO FAZ, e por que ela é o degrau que faltava:
//
//   1. Relê do Storage CADA arquivo do envelope (principal + anexos).
//   2. Calcula o SHA-256 a partir dos bytes que ELA leu.
//   3. Confere que o arquivo é mesmo um PDF (`%PDF-`).
//   4. Grava tudo em `signature_source_files`.
//
// O `document_hash` — a impressão digital do arquivo de ORIGEM, que o dossiê
// exibe e que a defesa cita — vinha do navegador. O servidor tem o arquivo no
// Storage desde sempre; nunca tinha sido ele a olhar.
//
// O QUE ELA NÃO ACEITA DO CLIENTE, e a linha é essa: o corpo da requisição não
// diz QUAIS arquivos conferir. Os caminhos saem de `signature_requests`
// (`document_path` e `attachment_paths`), lidos aqui dentro. Deixar o cliente
// apontar o arquivo devolveria, por outra porta, exatamente o poder que esta
// função existe para tirar dele.
//
// Do cliente vem só PROVENIÊNCIA (de qual `.docx` o PDF nasceu, com qual
// motor). Isso explica o histórico a quem for auditar e não atesta nada.
//
// IDEMPOTENTE. Chamável quantas vezes for. Um arquivo já congelado com o MESMO
// hash é 'ja_congelado' e nem é rebaixado. Hash diferente para o mesmo caminho
// não sobrescreve nada: vira `integrity_violation` na trilha, porque a única
// leitura possível é que os bytes no Storage mudaram depois do congelamento.
//
// Ver `docs/assinatura-montagem-no-servidor.md`.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Onde os documentos de um envelope podem estar. Mesma lista da public-signing-file. */
const CANDIDATE_BUCKETS = ['document-templates', 'generated-documents', 'cloud-files', 'assinados', 'signatures'];

// ── Espelho puro de `src/utils/congelamentoDoOriginal.ts` ───────────────────
// O Deno não importa de `src/`, então esta regra vive em cópia dupla.
// `src/utils/congelamentoDoOriginal.test.ts` vigia que as cópias não divirjam.
//
// O `%PDF-` é procurado no primeiro quilobyte em vez de exigido no byte zero:
// a norma manda o cabeçalho no começo, mas leitores toleram lixo antes dele e
// arquivos reais nascem assim. Recusar um PDF que o Adobe abre seria pior do
// que aceitar um byte de sujeira na frente.
function pareceUmPdf(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 5) return false;
  const janela = bytes.subarray(0, Math.min(bytes.length, 1024));
  const assinatura = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  for (let i = 0; i + assinatura.length <= janela.length; i++) {
    let bate = true;
    for (let j = 0; j < assinatura.length; j++) {
      if (janela[i + j] !== assinatura[j]) { bate = false; break; }
    }
    if (bate) return true;
  }
  return false;
}

/** 'main' | 'attachment-<i>' — a mesma chave de signature_fields.document_id. */
function chaveDoDocumento(indiceNoEnvelope: number): string {
  return indiceNoEnvelope <= 0 ? 'main' : `attachment-${indiceNoEnvelope - 1}`;
}

function normalizarSha256(valor: string | null | undefined): string {
  return String(valor ?? '').trim().toLowerCase();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

type Supa = ReturnType<typeof createClient>;

async function audit(
  supabase: Supa, requestId: string, action: string, description: string,
) {
  try {
    await supabase.from('signature_audit_log').insert({
      signature_request_id: requestId, signer_id: null, action,
      description: description.slice(0, 1000),
    });
  } catch (e) { console.error('[freeze] audit insert failed', e); }
}

/** Baixa o arquivo procurando bucket a bucket. Devolve os bytes e onde estava. */
async function baixarDoStorage(
  supabase: Supa, path: string,
): Promise<{ bytes: Uint8Array; bucket: string } | null> {
  for (const bucket of CANDIDATE_BUCKETS) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) continue;
    return { bytes: new Uint8Array(await data.arrayBuffer()), bucket };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return jsonResponse({ error: 'Supabase env not configured' }, 500);
    }

    // ── PORTEIRO ──
    // Congelar não é ato público: quem cria o envelope é gente do escritório,
    // logada. E a permissão sobre ESTE envelope não é reimplementada aqui — a
    // leitura abaixo passa pela RLS com o token de quem chamou, então quem
    // manda é a mesma régua (`can_manage_signature_request`) que a tela usa.
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonResponse({ error: 'Não autenticado' }, 401);
    const { data: ehEquipe } = await userClient.rpc('is_office_staff');
    if (ehEquipe !== true) return jsonResponse({ error: 'Sem permissão' }, 403);

    let body: any = null;
    try { body = JSON.parse((await req.text()) || '{}'); }
    catch { return jsonResponse({ error: 'JSON inválido' }, 400); }

    const requestId = String(body?.request_id ?? '').trim();
    if (!requestId) return jsonResponse({ error: 'request_id é obrigatório' }, 400);

    const { data: visivel } = await userClient
      .from('signature_requests').select('id').eq('id', requestId).maybeSingle();
    if (!visivel) return jsonResponse({ error: 'Envelope não encontrado ou sem permissão' }, 403);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: request0 } = await supabase.from('signature_requests')
      .select('id, document_path, attachment_paths, document_name, deleted_at')
      .eq('id', requestId).maybeSingle();
    if (!request0) return jsonResponse({ error: 'Envelope não encontrado' }, 404);
    if (request0.deleted_at) return jsonResponse({ error: 'Envelope indisponível' }, 403);

    // ── OS ARQUIVOS SÃO OS DO ENVELOPE, não os que o corpo pediu ──
    const anexos: string[] = Array.isArray(request0.attachment_paths)
      ? (request0.attachment_paths as unknown[]).map((p) => String(p)).filter(Boolean)
      : [];
    const alvos = [String(request0.document_path ?? '').trim(), ...anexos]
      .map((path, indice) => ({ path, indice, chave: chaveDoDocumento(indice) }))
      .filter((a) => a.path.length > 0);

    if (alvos.length === 0) {
      return jsonResponse({ error: 'Envelope sem documento para congelar' }, 400);
    }

    // Proveniência declarada, por chave. Nada aqui atesta integridade.
    const proveniencia = (body?.provenance ?? {}) as Record<string, any>;

    const { data: jaCongelados } = await supabase.from('signature_source_files')
      .select('id, document_key, file_path, sha256').eq('signature_request_id', requestId);
    const porChave = new Map<string, any>((jaCongelados ?? []).map((r: any) => [String(r.document_key), r]));

    const resultados: Array<Record<string, unknown>> = [];
    let violacoes = 0;

    for (const alvo of alvos) {
      const anterior = porChave.get(alvo.chave);

      const baixado = await baixarDoStorage(supabase, alvo.path);
      if (!baixado) {
        resultados.push({ document_key: alvo.chave, path: alvo.path, resultado: 'nao_encontrado' });
        continue;
      }

      const sha = await sha256Hex(baixado.bytes);
      const ehPdf = pareceUmPdf(baixado.bytes);

      // ── A CONFERÊNCIA ──
      // Mesmo caminho, hash diferente do que já estava congelado: os bytes no
      // Storage mudaram depois. O valor registrado é PRESERVADO — sobrescrever
      // apagaria justamente a prova de que houve troca.
      if (anterior?.sha256 && anterior.file_path === alvo.path
          && normalizarSha256(anterior.sha256) !== normalizarSha256(sha)) {
        violacoes += 1;
        await audit(supabase, requestId, 'integrity_violation',
          `INTEGRIDADE: o arquivo de origem ${alvo.chave} (${alvo.path}) DIVERGE do congelado. `
          + `Registrado ${anterior.sha256}; recalculado ${sha}. O valor registrado foi preservado.`);
        resultados.push({
          document_key: alvo.chave, path: alvo.path, resultado: 'divergente',
          sha256_registrado: anterior.sha256, sha256_recalculado: sha,
        });
        continue;
      }

      if (anterior?.sha256 && normalizarSha256(anterior.sha256) === normalizarSha256(sha)) {
        resultados.push({
          document_key: alvo.chave, path: alvo.path, resultado: 'ja_congelado',
          sha256: anterior.sha256, is_pdf: ehPdf,
        });
        continue;
      }

      const p = proveniencia[alvo.chave] ?? {};
      const linha = {
        signature_request_id: requestId,
        document_key: alvo.chave,
        sort_order: alvo.indice,
        display_name: typeof p.display_name === 'string' && p.display_name.trim()
          ? p.display_name.trim()
          : (alvo.indice === 0 ? (request0.document_name ?? null) : null),
        file_path: alvo.path,
        sha256: sha,
        byte_size: baixado.bytes.length,
        is_pdf: ehPdf,
        hash_source: 'server',
        frozen_at: new Date().toISOString(),
        original_path: typeof p.original_path === 'string' ? p.original_path : null,
        original_name: typeof p.original_name === 'string' ? p.original_name : null,
        converted_from: p.converted_from === 'docx' || p.converted_from === 'doc' ? p.converted_from : null,
        conversion_engine: typeof p.conversion_engine === 'string' ? p.conversion_engine : null,
        conversion_searchable: typeof p.conversion_searchable === 'boolean' ? p.conversion_searchable : null,
      };

      const { error: upErr } = await supabase.from('signature_source_files')
        .upsert(linha, { onConflict: 'signature_request_id,document_key' });
      if (upErr) {
        console.error('[freeze] falha ao gravar', alvo.chave, upErr);
        resultados.push({ document_key: alvo.chave, path: alvo.path, resultado: 'falha', motivo: upErr.message });
        continue;
      }

      resultados.push({
        document_key: alvo.chave, path: alvo.path, resultado: 'congelado',
        sha256: sha, byte_size: baixado.bytes.length, is_pdf: ehPdf, bucket: baixado.bucket,
      });
    }

    const congelados = resultados.filter((r) => r.resultado === 'congelado').length;
    const naoPdf = resultados.filter((r) => r.is_pdf === false).length;
    const ausentes = resultados.filter((r) => r.resultado === 'nao_encontrado').length;

    if (congelados > 0) {
      // Um evento por congelamento, não um por arquivo: a trilha é lida por
      // gente, e três linhas dizendo a mesma coisa afogam o que importa.
      await audit(supabase, requestId, 'source_frozen',
        `Original congelado: ${congelados} arquivo(s) conferido(s) no servidor. `
        + resultados
          .filter((r) => r.resultado === 'congelado')
          .map((r) => `${r.document_key}: SHA-256 ${r.sha256}${r.is_pdf === false ? ' (NÃO é PDF)' : ''}`)
          .join('; '));
    }

    const parecer = violacoes > 0 ? 'NAO_INTEGRO'
      : (ausentes > 0 || naoPdf > 0) ? 'INCONCLUSIVO'
      : 'INTEGRO';

    return jsonResponse({
      success: violacoes === 0 && ausentes === 0,
      parecer, congelados, ausentes, nao_pdf: naoPdf, documentos: resultados,
    }, violacoes > 0 ? 409 : 200);
  } catch (err) {
    console.error('[signature-freeze-source] erro:', err);
    return jsonResponse({ error: 'Erro interno' }, 500);
  }
});
