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

const OPENAI_KEY   = Deno.env.get('OPENAI_API_KEY') ?? '';
const SRC_BUCKET   = 'client-documents';
const CLOUD_BUCKET = 'cloud-files';
const PORTAL_FOLDER_NAME = 'Documentos do Portal';

// ── helpers ──────────────────────────────────────────────────────────────────

async function downloadFile(bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Download failed: ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function imageToPdf(imgBytes: Uint8Array, mimeType: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const img = mimeType.includes('png') ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
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

function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', pdf:'application/pdf' };
  return map[ext] ?? 'application/octet-stream';
}

function sanitize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9_\-]/g,'_').replace(/_+/g,'_').slice(0,80);
}

async function identify(pdfBytes: Uint8Array, clientName: string, itemLabel: string) {
  const firstName = clientName.split(' ')[0];
  const year = new Date().getFullYear();
  const fallback = { documentType: itemLabel, suggestedName: sanitize(`${itemLabel}_${firstName}_${year}`), confidence: 0.5 };
  if (!OPENAI_KEY) return fallback;
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Identifica documentos brasileiros. JSON: {"documentType":"...","suggestedName":"...","confidence":0-1}. suggestedName sem extensão, ex: "RG_${firstName}_${year}".` },
          { role: 'user', content: `Item: "${itemLabel}". Cliente: "${clientName}". ${pdfDoc.getPageCount()} pág. Escritório de advocacia. JSON apenas.` },
        ],
        max_tokens: 100,
        response_format: { type: 'json_object' },
      }),
    });
    if (resp.ok) {
      const d = await resp.json();
      const p = JSON.parse(d.choices?.[0]?.message?.content ?? '{}');
      return {
        documentType:  p.documentType  || itemLabel,
        suggestedName: p.suggestedName || fallback.suggestedName,
        confidence: Math.min(1, Math.max(0, p.confidence || 0.5)),
      };
    }
  } catch { /* fallback */ }
  return fallback;
}

/** Retorna ou cria a pasta "Documentos do Portal" do cliente no Cloud */
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
  if (error || !created) throw new Error(`Folder create: ${error?.message}`);
  return created.id;
}

/** Copia PDF para cloud-files bucket e registra em cloud_files */
async function registerInCloud(opts: {
  clientId: string; folderId: string; fileName: string; pdfBytes: Uint8Array;
}): Promise<void> {
  const cloudPath = `${opts.clientId}/portal/${opts.fileName}`;

  await supabase.storage.from(CLOUD_BUCKET).upload(cloudPath, opts.pdfBytes, {
    contentType: 'application/pdf', upsert: true,
  });

  // Remove duplicata pelo nome antes de inserir
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
      const m = mimeFromPath(path);
      if (m === 'application/pdf') pdfs.push(await PDFDocument.load(bytes));
      else if (m.startsWith('image/')) pdfs.push(await imageToPdf(bytes, m));
    }
    if (pdfs.length === 0) {
      await supabase.from('document_uploads').update({ processing_status: 'error', processing_error: 'Formato não suportado.' }).eq('id', upload_id);
      return new Response(JSON.stringify({ error: 'No convertible files' }), { status: 422, headers: CORS_HEADERS });
    }

    // 2. Merge + identificação IA
    const mergedBytes = await merge(pdfs);
    const totalPages  = pdfs.reduce((s, d) => s + d.getPageCount(), 0);
    const { documentType, suggestedName, confidence } = await identify(mergedBytes, clientName, itemLabel);
    const finalName = sanitize(suggestedName) + '.pdf';

    // 3. Salva em client-documents/processed (fonte original)
    const processedPath = `${clientId}/processed/${upload_id}_${finalName}`;
    await supabase.storage.from(SRC_BUCKET).upload(processedPath, mergedBytes, { contentType: 'application/pdf', upsert: true });

    // 4. Copia para Cloud + registra em cloud_files (aparece na ficha e no Cloud)
    const folderId = await getOrCreatePortalFolder(clientId);
    await registerInCloud({ clientId, folderId, fileName: finalName, pdfBytes: mergedBytes });

    // 5. Atualiza document_uploads
    await supabase.from('document_uploads').update({
      processed_path:    processedPath,
      ai_document_type:  documentType,
      ai_suggested_name: suggestedName,
      ai_confidence:     confidence,
      final_name:        finalName,
      pages_count:       totalPages,
      file_size_bytes:   mergedBytes.length,
      processing_status: 'ready',
      processed_at:      new Date().toISOString(),
    }).eq('id', upload_id);

    // 6. Atualiza item + request
    await supabase.from('document_request_items').update({ status: 'uploaded' }).eq('id', upload.request_item_id);
    if (requestId) {
      const { data: items } = await supabase.from('document_request_items').select('status, required').eq('request_id', requestId);
      if (items) {
        const pending = (items as any[]).filter(i => i.required && i.status === 'pending').length;
        await supabase.from('document_requests').update({ status: pending === 0 ? 'complete' : 'partial' }).eq('id', requestId);
      }
    }

    return new Response(JSON.stringify({ ok: true, finalName, documentType, confidence, pages: totalPages }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('process-document-upload v3:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: CORS_HEADERS });
  }
});
