import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { SignPdf } from 'npm:@signpdf/signpdf@3.3.0';
import { pdflibAddPlaceholder } from 'npm:@signpdf/placeholder-pdf-lib@3.3.0';
import { P12Signer } from 'npm:@signpdf/signer-p12@3.3.0';

// ============================================================================
// PAdES — a assinatura criptográfica DENTRO do PDF.
// ----------------------------------------------------------------------------
// Até aqui a prova de integridade morava só no nosso banco: o SHA-256 do
// arquivo e a página de conferência. Quem abrisse o PDF no Adobe não via
// assinatura nenhuma, e a integridade só se verificava vindo ao nosso site.
//
// Com o PAdES o arquivo passa a se defender sozinho, offline, em qualquer
// leitor: mexeu um byte depois de assinado, a assinatura quebra e o leitor
// avisa — sem depender de nós.
//
// O QUE ESTE CERTIFICADO É, E O QUE NÃO É. Ele é AUTOASSINADO: prova que o
// arquivo não mudou desde que passou por aqui, e prova que quem assinou foi a
// chave cuja impressão digital publicamos. NÃO prova identidade perante quem
// não nos conhece — para isso seria preciso um e-CNPJ ICP-Brasil, e o desenho
// aqui já é o mesmo: trocar o .p12 do secret muda o nível sem tocar em código.
//
// A chave privada existe em UM lugar só: o secret `PADES_P12_BASE64`. Nunca no
// repositório, nunca no navegador, nunca em coluna de banco.
//
// ---------------------------------------------------------------------------
// O NOME CERTO DO QUE ISTO PRODUZ — e a diferença importa.
//
// O SubFilter é `adbe.pkcs7.detached`: assinatura digital de PDF do ISO 32000-1
// (Adobe), que TODO leitor valida e que detecta qualquer alteração posterior.
// Isso foi conferido com openssl: `Verification successful` no arquivo íntegro
// e `Verification failure` com um único byte trocado.
//
// NÃO é ainda PAdES-B-B no sentido estrito da ETSI. O CMS que o `signer-p12`
// monta traz apenas `contentType`, `signingTime` e `messageDigest`; falta o
// atributo `signing-certificate-v2` que o CAdES-BES exige, e o SubFilter da
// norma seria `ETSI.CAdES.detached`. Declarar o SubFilter da ETSI sem os
// atributos dela seria anunciar conformidade que não existe — exatamente o
// tipo de afirmação que cai no primeiro questionamento.
//
// Enquanto o certificado é autoassinado isso não muda nada na prática: nenhum
// validador confia na cadeia de qualquer jeito, e o que se ganha (prova de não
// adulteração) já está aqui. Quando entrar um e-CNPJ ICP-Brasil, aí sim vale
// fechar a conformidade — o Verificador de Conformidade do ITI a cobra.
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pades-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const SIGNED_BUCKET = 'assinados';
/** Onde o `dry_run` deposita o resultado sem tocar no artefato real. */
const LAB_PREFIX = 'pades-lab';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Um PDF que já traz `/ByteRange` já passou por aqui. Assinar de novo o
 *  invalidaria: a segunda assinatura mudaria os bytes cobertos pela primeira. */
function jaAssinado(bytes: Uint8Array): boolean {
  // Basta varrer o começo e o fim: o dicionário de assinatura fica no trailer.
  const janela = new TextDecoder('latin1').decode(bytes.slice(-200_000));
  return janela.includes('/ByteRange');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  try {
    // ── Porteiro ────────────────────────────────────────────────────────────
    // Esta função REESCREVE artefato assinado. O token é segredo do ambiente,
    // nunca constante no código — foi assim que a auditoria do WhatsApp fechou
    // o mesmo buraco.
    const tokenEsperado = Deno.env.get('PADES_SIGN_TOKEN') || '';
    const tokenRecebido = req.headers.get('x-pades-token') || '';
    if (!tokenEsperado || tokenRecebido !== tokenEsperado) {
      return jsonResponse({ error: 'não autorizado' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || '').trim().toUpperCase();
    const dryRun = body?.dry_run === true;
    if (!code) return jsonResponse({ error: 'code é obrigatório' }, 400);

    const p12Base64 = Deno.env.get('PADES_P12_BASE64') || '';
    const p12Senha = Deno.env.get('PADES_P12_PASSWORD') || '';
    if (!p12Base64) return jsonResponse({ error: 'PADES_P12_BASE64 não configurado' }, 503);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
    });

    // ── Acha o artefato ─────────────────────────────────────────────────────
    let caminho: string | null = null;
    let requestId: string | null = null;
    let docId: string | null = null;
    let signerId: string | null = null;

    const { data: doc } = await supabase
      .from('signature_request_documents')
      .select('id, signature_request_id, signed_file_path')
      .filter('verification_code', 'ilike', code)
      .maybeSingle();
    if ((doc as any)?.signed_file_path) {
      caminho = (doc as any).signed_file_path;
      requestId = (doc as any).signature_request_id;
      docId = (doc as any).id;
    }

    if (!caminho) {
      const { data: signer } = await supabase
        .from('signature_signers')
        .select('id, signature_request_id, signed_document_path')
        .filter('verification_hash', 'ilike', code)
        .maybeSingle();
      if ((signer as any)?.signed_document_path) {
        caminho = (signer as any).signed_document_path;
        requestId = (signer as any).signature_request_id;
        signerId = (signer as any).id;
      }
    }

    if (!caminho || !requestId) return jsonResponse({ error: 'documento assinado não encontrado' }, 404);

    // ── Lê os bytes ─────────────────────────────────────────────────────────
    const { data: blob, error: erroDownload } = await supabase.storage.from(SIGNED_BUCKET).download(caminho);
    if (erroDownload || !blob) return jsonResponse({ error: 'arquivo não encontrado no Storage' }, 404);
    const originais = new Uint8Array(await blob.arrayBuffer());
    const shaAntes = await sha256Hex(originais);

    if (jaAssinado(originais)) {
      return jsonResponse({
        status: 'ja_assinado',
        path: caminho,
        sha256: shaAntes,
        message: 'Este PDF já traz assinatura criptográfica; assinar de novo invalidaria a primeira.',
      });
    }

    // ── Placeholder + assinatura ────────────────────────────────────────────
    // `useObjectStreams: false` é obrigatório: com fluxos de objeto o ByteRange
    // some dentro de um stream comprimido e o assinador não o encontra.
    const pdfDoc = await PDFDocument.load(originais, { ignoreEncryption: true });
    pdflibAddPlaceholder({
      pdfDoc,
      reason: 'Integridade e origem do documento assinado eletronicamente',
      contactInfo: 'validacao@jurius.com.br',
      name: 'Jurius - Selo de Integridade',
      location: 'Cuiaba/MT',
    });
    const comPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

    const signer = new P12Signer(Buffer.from(p12Base64, 'base64'), { passphrase: p12Senha });
    const assinado = new Uint8Array(await new SignPdf().sign(comPlaceholder, signer));
    const shaDepois = await sha256Hex(assinado);

    // ── Grava ───────────────────────────────────────────────────────────────
    const destino = dryRun ? `${LAB_PREFIX}/${code}_${Date.now()}.pdf` : caminho;
    const { error: erroUpload } = await supabase.storage
      .from(SIGNED_BUCKET)
      .upload(destino, assinado, { contentType: 'application/pdf', upsert: true });
    if (erroUpload) return jsonResponse({ error: `falha ao gravar: ${erroUpload.message}` }, 500);

    // No ensaio nada mais é tocado: o artefato real e o hash registrado ficam
    // como estavam, e o resultado fica no laboratório para conferência.
    if (dryRun) {
      // `return_base64` existe para a CONFERÊNCIA do ensaio: o arquivo volta
      // inteiro para ser verificado por fora (openssl é a implementação de
      // referência, e nenhuma checagem escrita aqui dentro valeria tanto).
      // Só no ensaio e só com o token — nunca no caminho de produção.
      const corpo: Record<string, unknown> = {
        status: 'ensaio',
        path: destino,
        sha256_antes: shaAntes,
        sha256_depois: shaDepois,
        bytes_antes: originais.length,
        bytes_depois: assinado.length,
      };
      if (body?.return_base64 === true) {
        corpo.pdf_base64 = Buffer.from(assinado).toString('base64');
      }
      return jsonResponse(corpo);
    }

    // O hash registrado passa a ser o do arquivo QUE EXISTE no Storage. Sem
    // isto a reconferência do `finalize-signature-envelope` acusaria violação
    // de integridade no próprio arquivo que acabamos de selar.
    // `pades_signed_at` é o que permite a página de conferência DIZER que o
    // arquivo está selado. Sem o carimbo, a prova existiria e ficaria invisível.
    const seladoEm = new Date().toISOString();
    if (docId) {
      // `hash_source: 'server'` porque foi o servidor que produziu estes bytes
      // e mediu este hash. Sem isso o valor ficaria marcado como vindo do
      // cliente — justamente o contrário do que acabou de acontecer.
      await supabase.from('signature_request_documents')
        .update({ signed_pdf_sha256: shaDepois, hash_source: 'server', pades_signed_at: seladoEm })
        .eq('id', docId);
    }
    if (signerId) {
      await supabase.from('signature_signers')
        .update({ signed_pdf_sha256: shaDepois, pades_signed_at: seladoEm }).eq('id', signerId);
    }

    // O erro da auditoria é CAPTURADO e devolvido. Um insert que falha calado
    // aqui produziria o pior estado possível: arquivo selado e trilha muda —
    // que foi exatamente o que o CHECK sem `pades_signed` teria causado.
    const { error: erroAuditoria } = await supabase.from('signature_audit_log').insert({
      signature_request_id: requestId,
      signer_id: signerId,
      action: 'pades_signed',
      description: `Assinatura criptográfica PAdES aplicada ao documento. SHA-256 do arquivo selado: ${shaDepois}.`,
    });
    if (erroAuditoria) console.error('[pades-sign] auditoria falhou:', erroAuditoria);

    return jsonResponse({
      status: 'assinado',
      path: destino,
      sha256_antes: shaAntes,
      sha256_depois: shaDepois,
      bytes_depois: assinado.length,
      selado_em: seladoEm,
      auditoria: erroAuditoria ? 'falhou' : 'registrada',
    });
  } catch (err) {
    console.error('[pades-sign] erro:', err);
    return jsonResponse({ error: String((err as Error)?.message || err) }, 500);
  }
});
