import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

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
          { role: 'system', content: `Você é um analista documental de um escritório de advocacia brasileiro. Recebe o documento SOLICITADO e o ARQUIVO enviado pelo cliente. Leia o conteúdo do arquivo e decida se ele corresponde ao que foi solicitado. Responda SOMENTE JSON: {"matches":true|false,"documentType":"tipo real do documento","suggestedName":"nome_sugerido_sem_extensao","confidence":0..1,"reason":"motivo curto em português"}. Seja conservador: só use confidence alta (>0.85) quando tiver certeza visual de que o documento é o solicitado e está legível.` },
          { role: 'user', content: [
            { type: 'text', text: `Documento solicitado: "${itemLabel}". Cliente: "${clientName}". O arquivo anexado corresponde ao solicitado? Exemplo de suggestedName: "RG_${firstName}_${year}".` },
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

  try {
    const { upload_id } = await req.json() as { upload_id: string };
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
    for (const path of paths) {
      const bytes = await downloadFile(SRC_BUCKET, path);
      const m = mime(path);
      if (m === 'application/pdf') pdfs.push(await PDFDocument.load(bytes));
      else if (m.startsWith('image/')) pdfs.push(await imageToPdf(bytes, m));
    }
    if (pdfs.length === 0) {
      await supabase.from('document_uploads').update({ processing_status: 'error', processing_error: 'Formato não suportado.' }).eq('id', upload_id);
      return new Response(JSON.stringify({ error: 'No convertible files' }), { status: 422, headers: CORS_HEADERS });
    }

    // 2. Merge e VALIDAÇÃO com visão real
    const mergedBytes = await merge(pdfs);
    const totalPages  = pdfs.reduce((s, d) => s + d.getPageCount(), 0);
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
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: CORS_HEADERS });
  }
});
