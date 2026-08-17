import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';
import { dispatchWaAiLifecycle } from '../_shared/wa-ai-lifecycle-hook.ts';
import { WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE } from '../_shared/wa-ai-doc-intake.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SRC_BUCKET  = 'client-documents';
const CLOUD_BUCKET = 'cloud-files';
const PORTAL_FOLDER_NAME = 'Documentos do Portal';

// Política de baixa híbrida: a IA aprova sozinha só quando confirma correspondência
// E a confiança passa do limite; abaixo disso vai para revisão humana (1 clique).
const AUTO_APPROVE_THRESHOLD = 0.85;
// Acima deste tamanho não enviamos o PDF à IA de visão (custo/limite) → revisão manual.
const MAX_VISION_BYTES = 18 * 1024 * 1024;
// Idem por nº de páginas — controle de token mais preciso que bytes (ex.: processo inteiro).
const MAX_VISION_PAGES = 12;

// ── helpers ──────────────────────────────────────────────────────────────────

async function downloadFile(bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Download failed: ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function imageToPdf(imgBytes: Uint8Array, mime: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const img = mime.includes('png') ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
  const { width, height } = img.scale(1);
  const A4W = 595, A4H = 842;
  const scale = Math.min(A4W / width, A4H / height);
  const page = doc.addPage([A4W, A4H]);
  page.drawImage(img, { x: (A4W - width*scale)/2, y: (A4H - height*scale)/2, width: width*scale, height: height*scale });
  return doc;
}

/**
 * Carrega um PDF que pode vir CIFRADO.
 *
 * A CTPS Digital do gov.br — o documento mais pedido do escritório — sai com
 * senha de dono (permissões), sem senha de leitura. O pdf-lib recusa esse
 * arquivo por padrão e derrubava a função inteira: o upload ficava preso em
 * "processing" para sempre, sem erro à vista, e o item do pedido nunca recebia
 * baixa.
 *
 * Com `ignoreEncryption` ele abre, mas NÃO decifra os fluxos: copiar as páginas
 * para um PDF novo produz um arquivo ilegível. Por isso quem chama precisa
 * saber que veio cifrado — ver o repasse do original abaixo.
 */
async function loadPdf(bytes: Uint8Array): Promise<{ doc: PDFDocument; encrypted: boolean }> {
  try {
    return { doc: await PDFDocument.load(bytes), encrypted: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/encrypt/i.test(msg)) throw e;
    return { doc: await PDFDocument.load(bytes, { ignoreEncryption: true }), encrypted: true };
  }
}

async function merge(pdfs: PDFDocument[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const src of pdfs) {
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return out.save();
}

function ext(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}
function mime(path: string): string {
  const map: Record<string, string> = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', pdf:'application/pdf' };
  return map[ext(path)] ?? 'application/octet-stream';
}
function sanitize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9_\-]/g,'_').replace(/_+/g,'_').slice(0,80);
}

/** base64 de Uint8Array em chunks (evita estouro de pilha no btoa com arquivos grandes). */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface Verdict {
  matches: boolean | null;
  documentType: string;
  suggestedName: string;
  confidence: number;
  reason: string;
}

/**
 * Valida COM VISÃO: envia o PDF mesclado ao gpt-4o para que ele leia o conteúdo e
 * decida se o arquivo corresponde ao documento solicitado. Em qualquer falha,
 * devolve veredito neutro (matches=null) que cai em revisão humana — nunca
 * aprova às cegas.
 */
async function validate(pdfBytes: Uint8Array, clientName: string, itemLabel: string): Promise<Verdict> {
  const firstName = clientName.split(' ')[0] || 'Cliente';
  const year = new Date().getFullYear();
  const fallback: Verdict = {
    matches: null,
    documentType: itemLabel,
    suggestedName: sanitize(`${itemLabel}_${firstName}_${year}`),
    confidence: 0.5,
    reason: 'IA de visão indisponível — revisão manual necessária.',
  };
  if (!OPENAI_KEY) return fallback;
  if (pdfBytes.length > MAX_VISION_BYTES) {
    return { ...fallback, reason: 'Arquivo grande demais para análise automática — revisão manual.' };
  }
  try {
    const b64 = toBase64(pdfBytes);
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: `Você é um analista documental de um escritório de advocacia brasileiro. Recebe o documento SOLICITADO e o ARQUIVO enviado pelo cliente. Leia o conteúdo do arquivo e decida se ele corresponde ao que foi solicitado.\n\n${WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE}\n\nResponda SOMENTE JSON: {"matches":true|false,"documentType":"tipo real do documento","suggestedName":"nome_sugerido_sem_extensao","confidence":0..1,"reason":"motivo curto em português"}. Seja conservador: só use confidence alta (>0.85) quando tiver certeza visual de que o documento é o solicitado e está legível.` },
          { role: 'user', content: [
            // O nome do cliente serve SÓ para batizar o arquivo. Solto no prompt,
            // ele virava critério de aceite: em 14/08/2026 uma conta de água
            // legítima foi recusada com "o nome do cliente não está presente" —
            // exigência que ninguém fez e que a conferência de titularidade,
            // essa sim, já tinha resolvido a favor do cliente no mesmo dia.
            { type: 'text', text: `Documento solicitado: "${itemLabel}". O arquivo anexado corresponde ao TIPO solicitado? Para o campo suggestedName, e só para ele, o nome do cliente é "${clientName}" — exemplo: "RG_${firstName}_${year}".` },
            { type: 'file', file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${b64}` } },
          ] },
        ],
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });
    if (resp.ok) {
      const d = await resp.json();
      const p = JSON.parse(d.choices?.[0]?.message?.content ?? '{}');
      return {
        matches: typeof p.matches === 'boolean' ? p.matches : null,
        documentType: p.documentType || itemLabel,
        suggestedName: p.suggestedName || fallback.suggestedName,
        confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0.5)),
        reason: typeof p.reason === 'string' ? p.reason.slice(0, 500) : '',
      };
    }
    const errTxt = await resp.text().catch(() => '');
    return { ...fallback, reason: `IA indisponível (HTTP ${resp.status}) — revisão manual. ${errTxt.slice(0, 120)}` };
  } catch (_e) {
    return { ...fallback, reason: 'Falha ao analisar com IA — revisão manual.' };
  }
}

/** Retorna (ou cria) a pasta 'Documentos do Portal' do cliente no Cloud */
async function getOrCreatePortalFolder(clientId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('cloud_folders')
    .select('id')
    .eq('client_id', clientId)
    .eq('name', PORTAL_FOLDER_NAME)
    .is('parent_id', null)
    .is('archived_at', null)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('cloud_folders')
    .insert({ client_id: clientId, name: PORTAL_FOLDER_NAME, parent_id: null })
    .select('id')
    .single();
  if (error || !created) throw new Error(`Folder create failed: ${error?.message}`);
  return created.id;
}

/** Registra o arquivo no Cloud (cloud_files) e copia para cloud-files bucket */
async function registerInCloud(opts: {
  clientId: string;
  folderId: string;
  fileName: string;
  pdfBytes: Uint8Array;
}): Promise<void> {
  const cloudPath = `${opts.clientId}/portal/${opts.fileName}`;

  const { error: upErr } = await supabase.storage
    .from(CLOUD_BUCKET)
    .upload(cloudPath, opts.pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new Error(`Cloud upload: ${upErr.message}`);

  await supabase.from('cloud_files')
    .delete()
    .eq('client_id', opts.clientId)
    .eq('folder_id', opts.folderId)
    .eq('original_name', opts.fileName);

  await supabase.from('cloud_files').insert({
    folder_id:     opts.folderId,
    client_id:     opts.clientId,
    original_name: opts.fileName,
    storage_path:  cloudPath,
    mime_type:     'application/pdf',
    file_size:     opts.pdfBytes.length,
    extension:     'pdf',
  });
}

// ── handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  // Fora do try porque o catch precisa dele para registrar a falha na linha.
  let upload_id = '';
  try {
    upload_id = ((await req.json()) as { upload_id: string }).upload_id;
    if (!upload_id) return new Response(JSON.stringify({ error: 'upload_id required' }), { status: 400, headers: CORS_HEADERS });

    const { data: upload, error: ue } = await supabase
      .from('document_uploads')
      .select(`*, document_request_items(id, label, request_id, document_requests(client_id, clients(full_name)))`)
      .eq('id', upload_id)
      .single();
    if (ue || !upload) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS_HEADERS });

    const clientName: string = (upload.document_request_items as any)?.document_requests?.clients?.full_name ?? 'Cliente';
    const itemLabel:  string = (upload.document_request_items as any)?.label ?? 'Documento';
    const requestId:  string = (upload.document_request_items as any)?.request_id ?? '';
    const clientId:   string = upload.client_id;

    await supabase.from('document_uploads').update({ processing_status: 'processing' }).eq('id', upload_id);

    // 1. Converte arquivos originais → PDFs
    const paths: string[] = upload.original_paths || [];
    const pdfs: PDFDocument[] = [];
    // O original intacto do único arquivo enviado: é ele que vai adiante quando
    // não há nada para mesclar (ver `mergedBytes`).
    let solo: { bytes: Uint8Array; pdf: boolean } | null = null;
    let algumCifrado = false;
    for (const path of paths) {
      const bytes = await downloadFile(SRC_BUCKET, path);
      const m = mime(path);
      if (m === 'application/pdf') {
        const { doc, encrypted } = await loadPdf(bytes);
        if (encrypted) algumCifrado = true;
        pdfs.push(doc);
        solo = { bytes, pdf: true };
      } else if (m.startsWith('image/')) {
        pdfs.push(await imageToPdf(bytes, m));
        solo = { bytes, pdf: false };
      }
    }
    if (pdfs.length === 0) {
      await supabase.from('document_uploads').update({ processing_status: 'error', processing_error: 'Formato não suportado.' }).eq('id', upload_id);
      return new Response(JSON.stringify({ error: 'No convertible files' }), { status: 422, headers: CORS_HEADERS });
    }

    // 2. Merge e VALIDAÇÃO com visão real
    //
    // PDF sozinho não se mescla: o original segue inteiro. Além de preservar
    // assinatura, QR e metadados, é o que faz a CTPS Digital (cifrada) chegar
    // legível à visão da IA — reescrevê-la com pdf-lib devolveria páginas em
    // branco, porque ele abre o arquivo cifrado mas não decifra o conteúdo.
    const repassaOriginal = pdfs.length === 1 && paths.length === 1 && solo?.pdf === true;
    const mergedBytes = repassaOriginal ? solo!.bytes : await merge(pdfs);
    const totalPages  = pdfs.reduce((s, d) => s + d.getPageCount(), 0);
    // Cifrado E mesclado com outros: a cópia sai ilegível. Não se aprova no
    // escuro — vai para revisão humana com o motivo escrito.
    const mescladoCifrado = algumCifrado && !repassaOriginal;
    // Documento muito longo: não gasta token de visão — cai direto em revisão manual
    // (neutro, nunca aprova às cegas). Arquivo continua mesclado/salvo/registrado.
    const firstName = clientName.split(' ')[0] || 'Cliente';
    const verdict = totalPages > MAX_VISION_PAGES
      ? {
          matches: null as boolean | null,
          documentType: itemLabel,
          suggestedName: sanitize(`${itemLabel}_${firstName}_${new Date().getFullYear()}`),
          confidence: 0.5,
          reason: `Documento com ${totalPages} páginas — análise automática desativada, revisão manual.`,
        }
      : mescladoCifrado
        ? {
            matches: null as boolean | null,
            documentType: itemLabel,
            suggestedName: sanitize(`${itemLabel}_${firstName}_${new Date().getFullYear()}`),
            confidence: 0.5,
            reason: 'Arquivo protegido por senha juntado a outros — confira o conteúdo antes de dar baixa.',
          }
        : await validate(mergedBytes, clientName, itemLabel);
    const finalName = sanitize(verdict.suggestedName) + '.pdf';

    // 3. Salva em client-documents/processed
    const processedPath = `${clientId}/processed/${upload_id}_${finalName}`;
    const { error: srcErr } = await supabase.storage.from(SRC_BUCKET).upload(processedPath, mergedBytes, { contentType: 'application/pdf', upsert: true });
    if (srcErr) throw new Error(`Storage: ${srcErr.message}`);

    // 4. Registra no Cloud
    const folderId = await getOrCreatePortalFolder(clientId);
    await registerInCloud({ clientId, folderId, fileName: finalName, pdfBytes: mergedBytes });

    // 5. Política híbrida: auto-baixa só com correspondência confirmada + confiança alta.
    const autoApprove = verdict.matches === true && verdict.confidence >= AUTO_APPROVE_THRESHOLD;
    const reviewStatus = autoApprove ? 'approved' : 'pending';

    await supabase.from('document_uploads').update({
      processed_path:    processedPath,
      ai_document_type:  verdict.documentType,
      ai_suggested_name: verdict.suggestedName,
      ai_confidence:     verdict.confidence,
      ai_matches:        verdict.matches,
      ai_review_notes:   verdict.reason,
      final_name:        finalName,
      pages_count:       totalPages,
      file_size_bytes:   mergedBytes.length,
      processing_status: 'ready',
      review_status:     reviewStatus,
      reviewed_at:       autoApprove ? new Date().toISOString() : null,
      processed_at:      new Date().toISOString(),
    }).eq('id', upload_id);

    // 6. Item: aprovado (baixa) se auto-aprovado, senão aguarda revisão humana.
    await supabase.from('document_request_items')
      .update({ status: autoApprove ? 'approved' : 'uploaded' })
      .eq('id', upload.request_item_id);

    // 7. Recalcula o status (rótulo) do pedido: 'complete' só quando todos os
    //    obrigatórios estão aprovados; 'partial' se houve progresso.
    if (requestId) {
      const { data: items } = await supabase.from('document_request_items').select('status, required').eq('request_id', requestId);
      if (items) {
        const required = (items as any[]).filter(i => i.required);
        const allApproved = required.length > 0 && required.every(i => i.status === 'approved');
        const anyProgress = (items as any[]).some(i => i.status === 'approved' || i.status === 'uploaded');
        const status = allApproved ? 'complete' : anyProgress ? 'partial' : 'pending';
        await supabase.from('document_requests').update({ status }).eq('id', requestId);
        if (allApproved) {
          const { data: conversation } = await supabase.from('whatsapp_conversations')
            .select('id').eq('client_id', clientId).in('status', ['open', 'pending'])
            .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
          if (conversation?.id) {
            await dispatchWaAiLifecycle({
              supabaseUrl: SUPABASE_URL,
              serviceRole: SERVICE_ROLE,
              conversationId: conversation.id,
              trigger: 'documents_completed',
              resourceId: requestId,
            }).catch(error => console.error('wa-ai documents lifecycle:', error));
          }
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true, finalName, documentType: verdict.documentType, confidence: verdict.confidence,
      matches: verdict.matches, autoApproved: autoApprove, reason: verdict.reason,
      pages: totalPages, cloudPath: `${clientId}/portal/${finalName}`,
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('process-document-upload:', msg);
    // Sem isto o upload ficava em 'processing' para sempre: o 500 sumia no log,
    // a tela mostrava "processando" indefinidamente e ninguém sabia que havia
    // um documento parado esperando alguém. Quem falha, falha por escrito.
    if (upload_id) {
      try {
        await supabase.from('document_uploads')
          .update({ processing_status: 'error', processing_error: msg.slice(0, 500) })
          .eq('id', upload_id);
      } catch { /* o erro original é o que importa */ }
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: CORS_HEADERS });
  }
});
