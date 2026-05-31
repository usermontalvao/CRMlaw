/**
 * process-document-upload
 *
 * Recebe um upload_id, busca os arquivos originais no Storage,
 * converte para PDF, faz merge, chama GPT-4 Vision para identificar
 * o tipo do documento, renomeia e salva o PDF final.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const BUCKET = 'client-documents';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Baixa um arquivo do Storage como ArrayBuffer */
async function downloadFile(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Download failed: ${path} — ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Converte imagem (JPEG/PNG/WEBP) para uma página PDF via pdf-lib */
async function imageToPdfPage(imgBytes: Uint8Array, mimeType: string): Promise<PDFDocument> {
  const pdfDoc = await PDFDocument.create();
  let image;
  if (mimeType.includes('png')) {
    image = await pdfDoc.embedPng(imgBytes);
  } else {
    image = await pdfDoc.embedJpg(imgBytes);
  }
  const { width, height } = image.scale(1);
  // A4 proporcional
  const A4W = 595, A4H = 842;
  const scale = Math.min(A4W / width, A4H / height);
  const page = pdfDoc.addPage([A4W, A4H]);
  page.drawImage(image, {
    x: (A4W - width * scale) / 2,
    y: (A4H - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  });
  return pdfDoc;
}

/** Merge de vários PDFs em um único */
async function mergePdfs(pdfs: PDFDocument[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const src of pdfs) {
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  return merged.save();
}

/** Detecta mime type pela extensão */
function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

/** Chama GPT-4 Vision para identificar o tipo do documento */
async function identifyDocument(pdfBytes: Uint8Array, clientName: string): Promise<{
  documentType: string;
  suggestedName: string;
  confidence: number;
}> {
  if (!OPENAI_KEY) {
    return { documentType: 'Documento', suggestedName: 'Documento', confidence: 0 };
  }

  // Converte as primeiras 2 páginas para base64 para enviar para IA
  // Usamos apenas a primeira página como imagem de referência
  const pdfDoc = await PDFDocument.load(pdfBytes);
  // Extraímos metadados da primeira página para contexto
  const pageCount = pdfDoc.getPageCount();

  // Para identificação visual, enviamos o PDF em base64 como texto de contexto
  const b64 = btoa(String.fromCharCode(...pdfBytes.slice(0, 50000)));

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um assistente jurídico especialista em identificar tipos de documentos brasileiros.
Analise o contexto e responda com JSON: {"documentType": "...", "suggestedName": "...", "confidence": 0.0-1.0}
Tipos comuns: RG, CPF, CNH, Passaporte, Comprovante de Residência, Contrato de Trabalho, Carteira de Trabalho,
Certidão de Nascimento, Certidão de Casamento, Laudo Médico, Exame, Procuração, Contrato, Nota Fiscal, Outros.
suggestedName deve ser em formato de arquivo sem extensão, ex: "RG_${clientName.split(' ')[0]}_2026"`,
          },
          {
            role: 'user',
            content: `Documento PDF com ${pageCount} página(s) enviado pelo cliente "${clientName}".
Identifique o tipo mais provável baseado no contexto (escritório de advocacia, cliente enviando documentos pessoais).
Responda apenas o JSON.`,
          },
        ],
        max_tokens: 150,
        response_format: { type: 'json_object' },
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return {
          documentType: parsed.documentType || 'Documento',
          suggestedName: parsed.suggestedName || 'Documento',
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        };
      }
    }
  } catch { /* fallback */ }

  return { documentType: 'Documento', suggestedName: `Documento_${clientName.split(' ')[0]}`, confidence: 0.3 };
}

/** Sanitiza nome de arquivo */
function sanitizeName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  try {
    const { upload_id } = await req.json() as { upload_id: string };
    if (!upload_id) return new Response(JSON.stringify({ error: 'upload_id required' }), { status: 400 });

    // 1. Busca o upload + dados do cliente
    const { data: upload, error: ue } = await supabase
      .from('document_uploads')
      .select(`*, document_request_items(label, document_requests(client_id, clients(full_name)))`)
      .eq('id', upload_id)
      .single();
    if (ue || !upload) return new Response(JSON.stringify({ error: 'Upload not found' }), { status: 404 });

    const clientName: string = (upload.document_request_items as any)
      ?.document_requests?.clients?.full_name ?? 'Cliente';
    const itemLabel: string = (upload.document_request_items as any)?.label ?? 'Documento';

    // 2. Marca como "processing"
    await supabase.from('document_uploads').update({ processing_status: 'processing' }).eq('id', upload_id);

    // 3. Baixa e converte cada arquivo original para PDF
    const paths: string[] = upload.original_paths || [];
    const pdfs: PDFDocument[] = [];

    for (const path of paths) {
      const bytes = await downloadFile(path);
      const mime = mimeFromPath(path);

      if (mime === 'application/pdf') {
        const doc = await PDFDocument.load(bytes);
        pdfs.push(doc);
      } else if (mime.startsWith('image/')) {
        const doc = await imageToPdfPage(bytes, mime);
        pdfs.push(doc);
      }
      // DOCX e outros formatos: salva como está por ora
    }

    if (pdfs.length === 0) {
      await supabase.from('document_uploads').update({
        processing_status: 'error',
        processing_error: 'Nenhum arquivo convertível encontrado.',
      }).eq('id', upload_id);
      return new Response(JSON.stringify({ error: 'No convertible files' }), { status: 422 });
    }

    // 4. Merge de todas as páginas
    const mergedBytes = await mergePdfs(pdfs);
    const totalPages = pdfs.reduce((sum, doc) => sum + doc.getPageCount(), 0);

    // 5. IA identifica o tipo
    const { documentType, suggestedName, confidence } = await identifyDocument(mergedBytes, clientName);

    // 6. Nome final: sugestão da IA ou label da solicitação
    const year = new Date().getFullYear();
    const baseName = suggestedName || sanitizeName(`${itemLabel}_${clientName.split(' ')[0]}_${year}`);
    const finalName = sanitizeName(baseName) + '.pdf';

    // 7. Salva PDF final no Storage
    const processedPath = `${upload.client_id}/processed/${upload_id}_${finalName}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(processedPath, mergedBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    // 8. Atualiza o banco
    await supabase.from('document_uploads').update({
      processed_path:   processedPath,
      ai_document_type: documentType,
      ai_suggested_name: suggestedName,
      ai_confidence:    confidence,
      final_name:       finalName,
      pages_count:      totalPages,
      file_size_bytes:  mergedBytes.length,
      processing_status: 'ready',
      processed_at:     new Date().toISOString(),
    }).eq('id', upload_id);

    // 9. Atualiza status do item
    await supabase.from('document_request_items')
      .update({ status: 'uploaded' })
      .eq('id', upload.request_item_id);

    // 10. Verifica se todos os itens foram enviados → atualiza request
    const { data: items } = await supabase
      .from('document_request_items')
      .select('status, required')
      .eq('request_id', (upload.document_request_items as any)?.request_id ?? '');

    if (items) {
      const pending = items.filter(i => i.required && i.status === 'pending').length;
      const requestStatus = pending === 0 ? 'complete' : 'partial';
      await supabase.from('document_requests')
        .update({ status: requestStatus })
        .eq('id', (upload.document_request_items as any)?.request_id ?? '');
    }

    return new Response(JSON.stringify({
      ok: true,
      finalName,
      documentType,
      confidence,
      pages: totalPages,
      processedPath,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('process-document-upload error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
