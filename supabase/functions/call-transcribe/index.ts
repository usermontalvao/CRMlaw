/**
 * call-transcribe — a gravação da ligação virando texto.
 *
 * POST { call_log_id: string, force?: boolean } (JWT da equipe)
 * → { status: 'done' | 'failed' | 'unsupported', text?: string, model?: string }
 *
 * Três decisões que explicam o desenho:
 *
 *  · TRANSCREVE UMA VEZ SÓ. O texto é gravado em `whatsapp_call_logs.transcript`
 *    e uma segunda chamada devolve o que já está lá sem tocar no Whisper. É o
 *    ponto do recurso: o operador clica "Transcrever" e, dali em diante, lê.
 *    `force: true` existe para o caso de uma transcrição ruim que se quer
 *    refazer, e é o ÚNICO caminho que gasta de novo.
 *
 *  · O ÁUDIO NÃO SAI DO SERVIDOR PELO NAVEGADOR. O arquivo é baixado aqui com a
 *    chave de serviço e mandado direto ao provedor; a chave do Whisper nunca
 *    chega perto do cliente.
 *
 *  · GROQ PRIMEIRO, OPENAI DEPOIS — a mesma escada da transcrição dos áudios do
 *    WhatsApp (`evolution-webhook`), pelos mesmos motivos: o Groq é barato e
 *    rápido, e a OpenAI é a rede de segurança quando ele recusa.
 *
 * Ligação é conversa com cliente: se nenhuma chave estiver configurada, a
 * resposta é 'unsupported' e a linha NÃO é marcada como falha — não houve
 * tentativa, e a tela precisa poder pedir de novo quando a chave chegar.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MEDIA_BUCKET = 'whatsapp-media';
/** O Whisper aceita 25 MB; uma ligação longa em opus fica MUITO abaixo disso. */
const MAX_BYTES = 24 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Extensão que o provedor entende — ele decide o decoder pelo nome do arquivo. */
function extFromMime(mime: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  if (base.includes('webm')) return 'webm';
  if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) return 'm4a';
  if (base.includes('ogg') || base.includes('opus')) return 'ogg';
  if (base.includes('wav')) return 'wav';
  if (base.includes('mpeg') || base.includes('mp3')) return 'mp3';
  return 'webm';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);
  // Gravação de ligação é conversa do escritório com o cliente. O cliente logado
  // no portal também é `authenticated`, e isto não é assunto dele.
  const { data: ehEquipe } = await userClient.rpc('is_office_staff');
  if (ehEquipe !== true) return json({ error: 'Sem permissão' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const callLogId = String(body?.call_log_id || '').trim();
  if (!callLogId) return json({ error: 'call_log_id obrigatório' }, 400);
  const force = body?.force === true;

  const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: row, error: rowErr } = await admin
    .from('whatsapp_call_logs')
    .select('id, recording_path, recording_mime, recording_bytes, transcript, transcript_status, transcript_model')
    .eq('id', callLogId)
    .maybeSingle();
  if (rowErr) return json({ error: rowErr.message }, 500);
  if (!row) return json({ error: 'Chamada não encontrada' }, 404);
  if (!row.recording_path) return json({ error: 'Esta chamada não tem gravação' }, 400);

  // O caminho barato: já está transcrito.
  if (!force && row.transcript_status === 'done' && row.transcript) {
    return json({ status: 'done', text: row.transcript, model: row.transcript_model, cached: true });
  }
  if (row.recording_bytes && row.recording_bytes > MAX_BYTES) {
    return json({ error: 'Gravação grande demais para transcrever' }, 413);
  }

  const groqKey = Deno.env.get('GROQ_API_KEY') || Deno.env.get('VITE_GROQ_API_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('VITE_OPENAI_API_KEY');
  const chain: { url: string; key: string; model: string }[] = [];
  if (groqKey) chain.push({ url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: groqKey, model: 'whisper-large-v3' });
  if (openaiKey) chain.push({ url: 'https://api.openai.com/v1/audio/transcriptions', key: openaiKey, model: 'whisper-1' });
  // Sem chave nenhuma não houve tentativa: a linha fica intocada para poder ser
  // pedida de novo quando a configuração aparecer.
  if (chain.length === 0) return json({ status: 'unsupported', error: 'Nenhuma chave de transcrição configurada' }, 503);

  await admin.from('whatsapp_call_logs')
    .update({ transcript_status: 'pending' })
    .eq('id', callLogId);

  try {
    const dl = await admin.storage.from(MEDIA_BUCKET).download(row.recording_path);
    if (dl.error || !dl.data) throw new Error('não foi possível baixar a gravação');
    const buf = new Uint8Array(await dl.data.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error('gravação grande demais');

    const mime = row.recording_mime || 'audio/webm';
    const ext = extFromMime(mime);
    let text: string | null = null;
    let usedModel = '';
    let lastErr = '';

    for (const link of chain) {
      try {
        const fd = new FormData();
        fd.append('file', new Blob([buf], { type: mime }), `call.${ext}`);
        fd.append('model', link.model);
        fd.append('language', 'pt');
        fd.append('response_format', 'json');
        const res = await fetch(link.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${link.key}` },
          body: fd,
          // Ligação é bem mais longa que áudio de WhatsApp: o teto aqui é maior.
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) { lastErr = `${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`; continue; }
        const out = await res.json();
        text = String(out?.text || '').trim();
        usedModel = link.model;
        break;
      } catch (err) { lastErr = err instanceof Error ? err.message : String(err); }
    }

    if (text == null) {
      console.error('call-transcribe falhou:', lastErr);
      await admin.from('whatsapp_call_logs').update({ transcript_status: 'failed' }).eq('id', callLogId);
      return json({ status: 'failed', error: lastErr || 'transcrição falhou' }, 502);
    }

    const finalText = text || '(gravação sem fala detectada)';
    await admin.from('whatsapp_call_logs').update({
      transcript: finalText,
      transcript_status: 'done',
      transcript_model: usedModel,
      transcript_at: new Date().toISOString(),
    }).eq('id', callLogId);

    return json({ status: 'done', text: finalText, model: usedModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('call-transcribe error', msg);
    await admin.from('whatsapp_call_logs').update({ transcript_status: 'failed' }).eq('id', callLogId);
    return json({ status: 'failed', error: msg }, 500);
  }
});
