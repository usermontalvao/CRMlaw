// WhatsApp — triagem documental da mídia recebida (ponte WhatsApp → solicitação).
//
// Quando um cliente com solicitação de documento ABERTA envia uma imagem/PDF pela
// conversa, esta função (cron, a cada 3 minutos) identifica COM IA a qual item pedido
// o arquivo corresponde, cria o document_upload ligado ao item e dispara a
// process-document-upload — que revalida e aplica a baixa híbrida (auto se confiança
// alta; senão deixa para o operador confirmar). Deixa nota interna na conversa.
//
// Token na query (?token=...). Aceita body { message_ids?: string[] } para triagem
// alvo (teste/forçar), ignorando a janela de tempo e o status já gravado.
//
// A FILA: entram os arquivos nunca lidos e os `no_match` cujo veredito é mais
// VELHO que alguma solicitação aberta — porque o veredito é uma comparação com
// a lista de itens pendentes, e essa lista muda debaixo dele. Ver
// `_shared/wa-ai-doc-intake.ts` para a regra e o freio de três tentativas.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  compareWaAiResidenceHolder,
  isWaAiResidenceProofLabel,
  matchWaAiResidenceHolderToParent,
} from '../_shared/wa-ai-residence-holder.ts';
import {
  shouldReadWaAiDocIntakeAgain,
  waAiDocIntakeMarkForNoMatch,
  WA_AI_DOC_INTAKE_MAX_ATTEMPTS,
  WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE,
} from '../_shared/wa-ai-doc-intake.ts';

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
const NO_REQUEST_GRACE_MS = 30 * 60 * 1000; // espera o pedido de documentos aparecer antes de descartar

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

interface Match { index: number | null; confidence: number; documentType: string; reason: string; holderName?: string; documentHolder?: string; parentNames?: string[]; aiFailed?: boolean }

/** IA: a qual item pedido este arquivo corresponde? (null = nenhum). aiFailed=true
 *  sinaliza indisponibilidade (sem chave/429/5xx/rede) — o chamador marca
 *  'ai_unavailable' e avisa; reprocessar depois é via re-disparo por message_ids. */
async function matchItem(bytes: Uint8Array, mime: string, clientName: string, items: { id: string; label: string }[]): Promise<Match> {
  const fallback: Match = { index: null, confidence: 0, documentType: '', reason: 'IA indisponível', aiFailed: true };
  if (!OPENAI_KEY) return fallback;
  const b64 = toBase64(bytes);
  const list = items.map((it, i) => `${i}: ${it.label}`).join('\n');
  const content: any[] = [
    { type: 'text', text: `Documentos pendentes do cliente "${clientName}":\n${list}\n\nLeia o arquivo anexado e diga a QUAL desses itens ele corresponde. Avalie contra TODOS os itens da lista, não só o primeiro. Se não corresponder a nenhum, matchIndex=null.\n\nSe o arquivo for comprovante de residência (conta de luz, água, gás, telefone, internet, TV ou extrato bancário), copie em "holderName" o nome do TITULAR impresso no documento, exatamente como está escrito, sem completar nem corrigir. Se o nome estiver ilegível, cortado ou ausente, devolva "".\n\nSe o arquivo for documento de identificação (RG, CNH, CPF, CTPS ou passaporte), leia DOIS campos distintos e devolva cada um no seu lugar: "documentHolder" recebe o nome do campo NOME (o titular do documento) e "parentNames" recebe os nomes do campo FILIAÇÃO — na CNH e no RG esse campo traz pai e mãe, um em cada linha, logo abaixo do nome. Devolva os dois nomes da filiação quando os dois estiverem legíveis, ou só o que estiver. Não repita o titular dentro de "parentNames". Se o campo de filiação não existir ou estiver ilegível, devolva [].\n\nResponda SOMENTE JSON: {"matchIndex":number|null,"confidence":0..1,"documentType":"tipo real do documento","holderName":"titular do comprovante de residência ou vazio","documentHolder":"titular do documento de identificação ou vazio","parentNames":["pai","mãe"],"reason":"motivo curto em português"}.` },
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
          { role: 'system', content: `Você é analista documental de um escritório de advocacia brasileiro.\n\n${WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE}\n\nSeja conservador: confidence alta só com certeza visual de que o arquivo é o item pedido e está legível.` },
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
      holderName: typeof p.holderName === 'string' ? p.holderName.slice(0, 120) : '',
      documentHolder: typeof p.documentHolder === 'string' ? p.documentHolder.slice(0, 120) : '',
      parentNames: Array.isArray(p.parentNames)
        ? p.parentNames.map((n: unknown) => String(n || '').slice(0, 120)).filter(Boolean).slice(0, 4)
        : [],
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
    .select('id, conversation_id, type, storage_path, media_mime, wa_timestamp, created_at, doc_intake_status, doc_intake_at, doc_intake_attempts, whatsapp_conversations(client_id)')
    .eq('direction', 'in')
    .in('type', ['image', 'document'])
    .not('storage_path', 'is', null)
    .order('wa_timestamp', { ascending: true })
    .limit(BATCH);
  if (targetIds) q = q.in('id', targetIds);
  // `no_match` volta à fila porque o veredito depende da LISTA de itens
  // pendentes no instante da leitura, e essa lista muda. Quem decide se vale
  // reler é `shouldReadWaAiDocIntakeAgain`, mais abaixo, com a lista na mão;
  // aqui só entra o freio que o banco sabe aplicar sozinho.
  else {
    q = q
      .or(`doc_intake_status.is.null,and(doc_intake_status.eq.no_match,doc_intake_attempts.lt.${WA_AI_DOC_INTAKE_MAX_ATTEMPTS})`)
      .gte('wa_timestamp', new Date(Date.now() - LOOKBACK_MS).toISOString());
  }

  const { data: msgs, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let matched = 0, skipped = 0, noMatch = 0, errors = 0;
  const details: any[] = [];
  // As conversas que ganharam fato novo neste ciclo. O confronto entre o
  // comprovante e a filiação do RG é feito no FIM, com tudo lido: os arquivos
  // chegam em qualquer ordem, e no caso real o RG foi o último dos três.
  const conversasTocadas = new Set<string>();
  for (const m of (msgs || []) as any[]) {
    // O veredito passa a ser DATADO e CONTADO: sem isso não há como saber se a
    // lista de pendentes mudou depois dele nem como frear a releitura.
    const statusAnterior = String(m.doc_intake_status || '') || null;
    const mark = (status: string) => admin.from('whatsapp_messages').update({
      doc_intake_status: status,
      doc_intake_at: new Date().toISOString(),
      doc_intake_attempts: Number(m.doc_intake_attempts || 0) + 1,
    }).eq('id', m.id);
    try {
      const clientId = m.whatsapp_conversations?.client_id;
      if (!clientId) { await mark('skipped'); skipped++; continue; }

      const { data: reqs } = await admin.from('document_requests')
        .select('id, created_at, document_request_items(id,label,status)')
        .eq('client_id', clientId).in('status', ['pending', 'partial']);
      const items: { id: string; label: string }[] = [];
      for (const r of (reqs || []) as any[]) for (const it of (r.document_request_items || [])) if (it.status === 'pending') items.push({ id: it.id, label: it.label });

      // Segunda chance de um `no_match`: só quando existe pedido ABERTO criado
      // DEPOIS do veredito. Mesma lista, mesmo resultado — reler seria só custo.
      // No disparo alvo (`message_ids`) esta porta fica aberta de propósito: é
      // o botão de forçar, e quem o aperta sabe o que quer.
      if (!targetIds && !shouldReadWaAiDocIntakeAgain(
        { status: statusAnterior, attempts: m.doc_intake_attempts, intakeAt: m.doc_intake_at },
        (reqs || []).map((r: any) => r?.created_at),
      )) {
        details.push({ id: m.id, result: 'no_match_sem_lista_nova' });
        continue;
      }
      // ── Este arquivo já foi ingerido? ──
      // Vem antes de tudo o que custa — a lista de pendentes, o download, a
      // visão — porque o caminho de destino é derivado do id da mensagem e a
      // resposta não depende de ler coisa nenhuma. Um arquivo com upload
      // concluído está resolvido, HAJA OU NÃO item pendente agora: é o estado
      // em que ficaram 9ffa4f6e e e8afca60, aprovados no pedido e marcados
      // `no_match` na mensagem. Sem esta porta, cada redisparo criava outra
      // linha em `document_uploads` para o mesmo arquivo — em 14/08/2026 três
      // arquivos viraram DOZE uploads, com doze leituras de visão cobradas.
      // Processamento que FALHOU não conta: `ready` é o único estado
      // concluído, e refazê-lo é justamente para o que o disparo alvo serve.
      // O `mime` sai da própria linha (`media_mime`), não do download — então a
      // extensão pode ser calculada aqui e continua sendo LETRA A LETRA a mesma
      // que a versão anterior gravou. Se divergir, o dedupe procura um caminho
      // que não existe e o upload nasce ao lado do antigo.
      const mime = m.media_mime || mimeFromExt(extFromPath(m.storage_path));
      const ext = extFromPath(m.storage_path) || (mime === 'application/pdf' ? 'pdf' : 'jpg');
      const destPath = `${clientId}/whatsapp/${m.id}.${ext}`;
      const { data: jaIngerido } = await admin.from('document_uploads')
        .select('id')
        .contains('original_paths', [destPath])
        .eq('processing_status', 'ready')
        .limit(1).maybeSingle();
      if (jaIngerido) {
        if (statusAnterior !== 'matched') await mark('matched');
        details.push({ id: m.id, result: 'ja_ingerido', upload_id: jaIngerido.id });
        continue;
      }

      // Cliente sem pedido ABERTO ainda pode ganhar um em seguida: a triagem
      // pede as provas no mesmo minuto em que a pessoa começa a mandá-las.
      // Marcar 'skipped' aqui queimava o arquivo — ele nunca mais voltava para
      // a fila. Dentro da janela de graça o registro fica intocado e o próximo
      // ciclo tenta de novo; passada ela, aí sim vira 'skipped'.
      if (items.length === 0) {
        const idade = Date.now() - new Date(m.wa_timestamp || m.created_at || 0).getTime();
        if (idade < NO_REQUEST_GRACE_MS) {
          details.push({ id: m.id, result: 'waiting_request' });
          continue;
        }
        await mark('skipped'); skipped++; continue;
      }

      const dl = await admin.storage.from(WA_BUCKET).download(m.storage_path);
      if (dl.error || !dl.data) { await mark('error'); errors++; continue; }
      const bytes = new Uint8Array(await dl.data.arrayBuffer());

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
      // Lida ANTES do veredito: gravar `known_facts` sem os fatos que já estavam
      // lá apagaria a triagem inteira num único update.
      const { data: sessao } = await admin.from('whatsapp_ai_sessions')
        .select('known_facts').eq('conversation_id', m.conversation_id).maybeSingle();
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
        // Um redisparo relê contra a lista de AGORA, que os próprios arquivos
        // já esvaziaram. Rebaixar um `matched` aqui contava a história errada:
        // o documento aprovado no pedido e a mensagem dizendo que não serviu.
        const marca = waAiDocIntakeMarkForNoMatch(statusAnterior);
        if (marca) { await mark(marca); noMatch++; }
        details.push({ id: m.id, result: marca ? 'no_match' : 'no_match_ignorado_ja_casado',
          confidence: verdict.confidence, reason: verdict.reason });
        continue;
      }

      const item = items[verdict.index];
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

      // O pipeline pode falhar DEPOIS do upload (PDF cifrado, storage fora do
      // ar). Marcar 'matched' aqui dava por resolvido um documento que ficou
      // parado: o arquivo existia, o item continuava pendente e ninguém era
      // avisado. Falhou, está escrito — e o reprocessamento por message_ids
      // continua possível.
      if (!resp.ok) {
        await admin.from('whatsapp_internal_notes').insert({ conversation_id: m.conversation_id, author_id: null,
          body: `🤖 Recebi o documento pelo WhatsApp, mas não consegui processá-lo (${pr?.error || `HTTP ${resp.status}`}). Baixe e confira manualmente.` });
        await mark('error'); errors++;
        details.push({ id: m.id, result: 'process_failed', item: item.label, upload_id: upRow.id, error: pr?.error || resp.status });
        continue;
      }

      const conf = Math.round(((pr?.confidence ?? verdict.confidence) as number) * 100);
      const auto = pr?.autoApproved === true;
      const note = auto
        ? `🤖 Documento recebido pelo WhatsApp e baixado automaticamente: "${item.label}" (${conf}%).`
        : `🤖 Documento recebido pelo WhatsApp parece ser "${item.label}" (${conf}%) — confirme e dê baixa. ${pr?.reason || verdict.reason || ''}`.trim();
      await admin.from('whatsapp_internal_notes').insert({ conversation_id: m.conversation_id, author_id: null, body: note });

      // ── De quem é o comprovante ──
      // A triagem parou de PERGUNTAR isso e passou a LER. Quem responde de
      // memória erra de boa-fé: o caso que motivou a mudança tem um arquivo
      // chamado "COMPROVANTE DE RESIDÊNCIA EM NOME DO PAI", e a pessoa diria
      // sem hesitar que o comprovante é dela. O veredito vira fato da sessão e
      // reabre — sozinha — a pergunta sobre parentesco ou contrato de aluguel.
      // ── O que este arquivo ensina sobre a residência ──
      // Dois fatos saem daqui: de quem é o comprovante e quem são os pais do
      // cliente (a filiação impressa no RG). Ficam GRAVADOS na sessão, e o
      // confronto entre eles acontece depois do lote inteiro — a ordem de
      // chegada dos arquivos não pode decidir o resultado.
      const fatos: Record<string, unknown> = {};
      if (isWaAiResidenceProofLabel(item.label) && verdict.holderName) {
        fatos.comprovante_titular = verdict.holderName;
      }
      const filiacaoLida = (verdict.parentNames || [])
        .filter(nome => !verdict.documentHolder
          || compareWaAiResidenceHolder(verdict.documentHolder, nome) !== 'proprio');
      if (filiacaoLida.length > 0) fatos.filiacao = filiacaoLida.join(' | ');
      if (Object.keys(fatos).length > 0) {
        const atuais = (sessao?.known_facts || {}) as Record<string, unknown>;
        await admin.from('whatsapp_ai_sessions')
          .update({ known_facts: { ...atuais, ...fatos } })
          .eq('conversation_id', m.conversation_id);
        conversasTocadas.add(m.conversation_id);
      }

      await mark('matched'); matched++;
      details.push({ id: m.id, result: 'matched', item: item.label, autoApproved: auto, confidence: conf, upload_id: upRow.id });
    } catch (e) {
      await admin.from('whatsapp_messages').update({ doc_intake_status: 'error' }).eq('id', m.id);
      errors++;
      details.push({ id: m.id, result: 'error', error: String((e as Error).message || e).slice(0, 300) });
    }
  }

  // ── Confronto, depois de todo o lote ──
  const residencia: any[] = [];
  for (const conversationId of conversasTocadas) {
    try {
      const { data: sess } = await admin.from('whatsapp_ai_sessions')
        .select('known_facts').eq('conversation_id', conversationId).maybeSingle();
      const fatos = (sess?.known_facts || {}) as Record<string, unknown>;
      const titular = String(fatos.comprovante_titular || '');
      if (!titular || fatos.residencia_tipo) continue;

      const { data: conv } = await admin.from('whatsapp_conversations')
        .select('client_id').eq('id', conversationId).maybeSingle();
      const { data: dono } = conv?.client_id
        ? await admin.from('clients').select('full_name').eq('id', conv.client_id).maybeSingle()
        : { data: null };

      const veredito = compareWaAiResidenceHolder(
        [String(dono?.full_name || ''), String(fatos.nome || '')], titular);
      if (veredito === 'indefinido') continue;

      const novos: Record<string, unknown> = { ...fatos, comprovante_titularidade: veredito };
      let nota = '';
      let instrucao = '';

      if (veredito === 'proprio') {
        nota = `🤖 Comprovante de residência está no nome do próprio cliente ("${titular}").`;
      } else {
        // A filiação do RG responde sozinha o que a IA ia perguntar.
        // A filiação lida pode vir contaminada com o nome do próprio titular do
        // RG — o campo NOME fica colado no campo FILIAÇÃO, e a visão às vezes
        // junta os dois. Quem é o cliente não pode ser pai do cliente.
        const filiacao = String(fatos.filiacao || '').split('|')
          .map(item => item.trim())
          .filter(nome => nome && compareWaAiResidenceHolder(
            [String(dono?.full_name || ''), String(fatos.nome || '')], nome) !== 'proprio');
        const parente = matchWaAiResidenceHolderToParent(titular, filiacao);
        if (parente) {
          novos.residencia_tipo = 'pai_ou_mae';
          novos.titular_comprovante = parente;
          nota = `🤖 O comprovante está em nome de "${titular}", que consta como filiação no documento de identificação do cliente. Vínculo resolvido como pai ou mãe, sem precisar perguntar.`;
        } else {
          nota = `🤖 O comprovante de residência está em nome de "${titular}", que não é o cliente e não consta na filiação do documento dele. A IA vai perguntar qual é o vínculo.`;
          instrucao = `O sistema leu o comprovante de residência que o cliente enviou e o titular impresso nele é "${titular}", que não é o cliente nem aparece na filiação do documento de identificação dele. Agradeça o envio em uma frase, diga com naturalidade que viu que o comprovante está em outro nome e faça a pergunta que o roteiro indicar. Não acuse a pessoa de nada e não peça outro comprovante ainda.`;
        }
      }

      await admin.from('whatsapp_ai_sessions')
        .update({ known_facts: novos }).eq('conversation_id', conversationId);
      await admin.from('whatsapp_internal_notes')
        .insert({ conversation_id: conversationId, author_id: null, body: nota });
      residencia.push({ conversation_id: conversationId, titular, veredito, rota: novos.residencia_tipo || null });

      if (instrucao) {
        await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-ai-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({
            conversation_id: conversationId,
            nudge_trigger: 'residence_holder_mismatch',
            nudge_key: `residencia:${titular}`.slice(0, 120),
            nudge_instruction: instrucao,
          }),
        }).catch(() => {});
      }
    } catch (e) {
      residencia.push({ conversation_id: conversationId, error: String((e as Error).message || e).slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: (msgs || []).length, matched, skipped, noMatch, errors, details, residencia }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
