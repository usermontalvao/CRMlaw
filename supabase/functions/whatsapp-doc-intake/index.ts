// WhatsApp — triagem documental da mídia recebida (ponte WhatsApp → solicitação).
//
// Quando um cliente com solicitação de documento ABERTA envia uma imagem/PDF pela
// conversa, esta função (cron, a cada minuto) identifica COM IA a qual item pedido
// o arquivo corresponde, cria o document_upload ligado ao item e dispara a
// process-document-upload — que revalida e aplica a baixa híbrida (auto se confiança
// alta; senão deixa para o operador confirmar). Deixa nota interna na conversa.
//
// Token na query (?token=...). Aceita body { message_ids?: string[] } para triagem
// alvo (teste/forçar), ignorando a janela de tempo.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN = Deno.env.get('WA_DOC_INTAKE_TOKEN') || 'wa-doc-intake-2026';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const WA_BUCKET = 'whatsapp-media';
const SRC_BUCKET = 'client-documents';
const MATCH_FLOOR = 0.5;                 // abaixo disso não cria upload (evita anexar imagem aleatória)
const LOOKBACK_MS = 6 * 60 * 60 * 1000;  // só mídias recentes — não backfilla histórico antigo
const BATCH = 8;
const MAX_DOC_BYTES = 12 * 1024 * 1024;  // acima disso não manda para a IA (custo/token) → revisão manual

function extFromPath(p: string): string { return (p.split('.').pop() || '').toLowerCase(); }
function mimeFromExt(e: string): string {
  const m: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
  return m[e] || 'application/octet-stream';
}
function toBase64(bytes: Uint8Array): string {
  let b = ''; const c = 0x8000;
  for (let i = 0; i < bytes.length; i += c) b += String.fromCharCode(...bytes.subarray(i, i + c));
  return btoa(b);
}

interface Match { index: number | null; confidence: number; documentType: string; reason: string; aiFailed?: boolean }

/** IA: a qual item pedido este arquivo corresponde? (null = nenhum). aiFailed=true
 *  sinaliza indisponibilidade (sem chave/429/5xx/rede) — o chamador marca
 *  'ai_unavailable' e avisa; reprocessar depois é via re-disparo por message_ids. */
async function matchItem(bytes: Uint8Array, mime: string, clientName: string, items: { id: string; label: string }[]): Promise<Match> {
  const fallback: Match = { index: null, confidence: 0, documentType: '', reason: 'IA indisponível', aiFailed: true };
  if (!OPENAI_KEY) return fallback;
  const b64 = toBase64(bytes);
  const list = items.map((it, i) => `${i}: ${it.label}`).join('\n');
  const content: any[] = [
    { type: 'text', text: `Documentos pendentes do cliente "${clientName}":\n${list}\n\nLeia o arquivo anexado e diga a QUAL desses itens ele corresponde. Avalie contra TODOS os itens da lista, não só o primeiro. Se não corresponder a nenhum, matchIndex=null. Responda SOMENTE JSON: {"matchIndex":number|null,"confidence":0..1,"documentType":"tipo real do documento","reason":"motivo curto em português"}.` },
  ];
  if (mime === 'application/pdf') content.push({ type: 'file', file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${b64}` } });
  else content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Você é analista documental de um escritório de advocacia brasileiro. Conhecimento de domínio: conta/fatura de água, luz, energia, gás, telefone, internet, TV ou extrato bancário que mostre nome e endereço SERVEM como "comprovante de residência". RG, CNH, CPF, CTPS ou passaporte servem como "documento de identificação". Seja conservador: confidence alta só com certeza visual de que o arquivo é o item pedido e está legível.' },
          { role: 'user', content },
        ],
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });
    if (!resp.ok) { const t = await resp.text().catch(() => ''); return { ...fallback, reason: `IA HTTP ${resp.status}: ${t.slice(0, 200)}` }; }
    const d = await resp.json();
    const p = JSON.parse(d.choices?.[0]?.message?.content ?? '{}');
    const idx = (typeof p.matchIndex === 'number' && p.matchIndex >= 0 && p.matchIndex < items.length) ? p.matchIndex : null;
    return {
      index: idx,
      confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)),
      documentType: p.documentType || '',
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 400) : '',
      aiFailed: false,
    };
  } catch (_e) {
    return { ...fallback, reason: 'Falha ao analisar com IA' };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('token') !== TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = await req.json().catch(() => ({}));
  const targetIds: string[] | null = Array.isArray(body?.message_ids) && body.message_ids.length ? body.message_ids : null;

  let q = admin.from('whatsapp_messages')
    .select('id, conversation_id, type, storage_path, media_mime, whatsapp_conversations(client_id)')
    .eq('direction', 'in')
    .in('type', ['image', 'document'])
    .not('storage_path', 'is', null)
    .order('wa_timestamp', { ascending: true })
    .limit(BATCH);
  if (targetIds) q = q.in('id', targetIds);
  else q = q.is('doc_intake_status', null).gte('wa_timestamp', new Date(Date.now() - LOOKBACK_MS).toISOString());

  const { data: msgs, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let matched = 0, skipped = 0, noMatch = 0, errors = 0;
  const details: any[] = [];
  for (const m of (msgs || []) as any[]) {
    const mark = (status: string) => admin.from('whatsapp_messages').update({ doc_intake_status: status }).eq('id', m.id);
    try {
      const clientId = m.whatsapp_conversations?.client_id;
      if (!clientId) { await mark('skipped'); skipped++; continue; }

      const { data: reqs } = await admin.from('document_requests')
        .select('id, document_request_items(id,label,status)')
        .eq('client_id', clientId).in('status', ['pending', 'partial']);
      const items: { id: string; label: string }[] = [];
      for (const r of (reqs || []) as any[]) for (const it of (r.document_request_items || [])) if (it.status === 'pending') items.push({ id: it.id, label: it.label });
      if (items.length === 0) { await mark('skipped'); skipped++; continue; }

      const dl = await admin.storage.from(WA_BUCKET).download(m.storage_path);
      if (dl.error || !dl.data) { await mark('error'); errors++; continue; }
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const mime = m.media_mime || mimeFromExt(extFromPath(m.storage_path));

      // Arquivo grande demais (ex.: processo inteiro): não gasta token de visão →
      // marca e avisa para revisão manual.
      if (bytes.length > MAX_DOC_BYTES) {
        await admin.from('whatsapp_internal_notes').insert({ conversation_id: m.conversation_id, author_id: null,
          body: '🤖 Documento muito grande para análise automática — revise e dê baixa manualmente.' });
        await mark('skipped'); skipped++;
        details.push({ id: m.id, result: 'too_large', bytes: bytes.length });
        continue;
      }

      const { data: cli } = await admin.from('clients').select('full_name').eq('id', clientId).maybeSingle();
      const verdict = await matchItem(bytes, mime, cli?.full_name || 'Cliente', items);

      // IA indisponível (429/5xx/rede): marca 'ai_unavailable' e avisa uma vez. Antes
      // ficava null e re-baixava o arquivo a cada ciclo do cron (egress desperdiçado,
      // sem visibilidade). Para reprocessar após a cota voltar, re-disparar por message_ids.
      if (verdict.aiFailed) {
        await admin.from('whatsapp_internal_notes').insert({ conversation_id: m.conversation_id, author_id: null,
          body: '🤖 Não consegui analisar o documento automaticamente (IA indisponível). Revise e dê baixa manualmente.' });
        await mark('ai_unavailable'); errors++;
        details.push({ id: m.id, result: 'ai_unavailable', reason: verdict.reason });
        continue;
      }
      if (verdict.index === null || verdict.confidence < MATCH_FLOOR) {
        await mark('no_match'); noMatch++;
        details.push({ id: m.id, result: 'no_match', confidence: verdict.confidence, reason: verdict.reason });
        continue;
      }

      const item = items[verdict.index];
      const ext = extFromPath(m.storage_path) || (mime === 'application/pdf' ? 'pdf' : 'jpg');
      const destPath = `${clientId}/whatsapp/${m.id}.${ext}`;
      const up = await admin.storage.from(SRC_BUCKET).upload(destPath, bytes, { contentType: mime, upsert: true });
      if (up.error) { await mark('error'); errors++; continue; }

      const { data: upRow, error: insErr } = await admin.from('document_uploads').insert({
        request_item_id: item.id, client_id: clientId, original_paths: [destPath],
        processing_status: 'pending', uploaded_at: new Date().toISOString(),
      }).select('id').single();
      if (insErr || !upRow) { await mark('error'); errors++; continue; }

      // Reuso do pipeline existente: revalida com visão e aplica a baixa híbrida.
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/process-document-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ upload_id: upRow.id }),
      });
      const pr = await resp.json().catch(() => ({} as any));

      const conf = Math.round(((pr?.confidence ?? verdict.confidence) as number) * 100);
      const auto = pr?.autoApproved === true;
      const note = auto
        ? `🤖 Documento recebido pelo WhatsApp e baixado automaticamente: "${item.label}" (${conf}%).`
        : `🤖 Documento recebido pelo WhatsApp parece ser "${item.label}" (${conf}%) — confirme e dê baixa. ${pr?.reason || verdict.reason || ''}`.trim();
      await admin.from('whatsapp_internal_notes').insert({ conversation_id: m.conversation_id, author_id: null, body: note });

      await mark('matched'); matched++;
      details.push({ id: m.id, result: 'matched', item: item.label, autoApproved: auto, confidence: conf, upload_id: upRow.id });
    } catch (e) {
      await admin.from('whatsapp_messages').update({ doc_intake_status: 'error' }).eq('id', m.id);
      errors++;
      details.push({ id: m.id, result: 'error', error: String((e as Error).message || e).slice(0, 300) });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: (msgs || []).length, matched, skipped, noMatch, errors, details }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
