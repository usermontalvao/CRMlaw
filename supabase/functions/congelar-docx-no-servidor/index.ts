// ============================================================================
// CONGELAR O `.docx` NO SERVIDOR — o passo que traz o `template-fill` para a
// montagem server-side.
// ----------------------------------------------------------------------------
// O BLOQUEIO QUE ISTO REMOVE. 241 dos 291 envelopes nascem pelo link de
// preenchimento: o `.docx` é montado NO SERVIDOR, a partir do que o cliente
// digitou. Não existe navegador nesse caminho, e o congelamento (etapa 1) mora
// no navegador — então esses envelopes nunca congelaram, e sem PDF congelado a
// montagem no servidor (etapa 2) não tem sobre o que trabalhar. Medido em
// 04/09/2026: ZERO linhas congeladas em todos os envelopes vivos.
//
// O resultado prático é que 83% do uso continuava montando PDF no celular do
// cliente — ~8 s por documento, 48 s num kit de 6.
//
// ── O QUE ELA FAZ ──────────────────────────────────────────────────────────
//
//   1. lê os arquivos do envelope no Storage;
//   2. para cada `.docx`: troca `[[ASSINATURA]]` por uma ÂNCORA invisível,
//      converte no `docs.jurius-api.com` e sobe o PDF;
//   3. lê no PDF produzido ONDE cada âncora caiu, e grava `signature_fields`;
//   4. grava `signature_source_files` com o SHA-256 que ELA apurou.
//
// ── POR QUE CONVERTER SOZINHO NÃO BASTA ────────────────────────────────────
//
// Se o `.docx` for convertido como está, o texto `[[ASSINATURA]]` é IMPRESSO na
// folha e a âncora se perde: o documento sai com um marcador visível e a rubrica
// cai no rodapé por fallback. Num documento que vale como prova.
//
// E a posição não pode ser calculada aqui: nenhum runtime de JavaScript abre um
// `.docx` e diagrama a página. A saída é não calcular — plantar uma imagem
// inline de 1×1 pt no lugar do marcador, deixar o Syncfusion diagramar, e
// PERGUNTAR AO PDF onde ela foi parar (`lerAncorasDoPdf`). A coordenada sai do
// MESMO arquivo que será congelado, então as duas não podem divergir.
//
// A âncora é de 1 pt por um motivo medido, não por elegância: com 40 pt ela
// forçava a altura da linha e o kit de teste passou de 2 para 3 páginas.
//
// Ver `docs/assinatura-montagem-no-servidor.md`.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { unzipSync, unzlibSync, zipSync } from 'npm:fflate@0.8.2';
import { encode as encodePng } from 'npm:fast-png@6.4.0';
import { PDFDocument, PDFName, PDFRawStream } from 'npm:pdf-lib@1.17.1';

import {
  docxParaPdfComAncoras, type ConversaoDoDocx,
} from '../_shared/montagem/docxParaPdf.ts';

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

/** Onde os arquivos de um envelope podem estar. Mesma lista da `signature-freeze-source`. */
const BUCKETS_CANDIDATOS = [
  'document-templates', 'generated-documents', 'cloud-files', 'assinados', 'signatures',
];
/** Onde o PDF congelado é gravado — o mesmo de `uploadSignatureDocumentPdf`. */
const BUCKET_DO_CONGELADO = 'document-templates';

const CONVERSOR_PADRAO = 'https://docs.jurius-api.com';

type Supa = ReturnType<typeof createClient>;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `main`, `attachment-0`, `attachment-1`… — a mesma convenção do resto. */
const chaveDoDocumento = (indice: number): string =>
  indice === 0 ? 'main' : `attachment-${indice - 1}`;

/** Assinatura de um ZIP (`PK\x03\x04`) — todo `.docx` é um. */
function pareceUmZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function pareceUmPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50
    && bytes[2] === 0x44 && bytes[3] === 0x46;
}

async function baixarDoStorage(supabase: Supa, path: string): Promise<Uint8Array | null> {
  for (const bucket of BUCKETS_CANDIDATOS) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) continue;
    return new Uint8Array(await data.arrayBuffer());
  }
  return null;
}

async function audit(supabase: Supa, requestId: string, action: string, descricao: string) {
  try {
    await supabase.from('signature_audit_log').insert({
      signature_request_id: requestId, action, description: descricao.slice(0, 1000),
    });
  } catch (e) { console.error('[congelar-docx] audit falhou', e); }
}

const FERRAMENTAS = {
  unzip: unzipSync,
  zip: zipSync,
  inflar: (b: Uint8Array) => unzlibSync(b),
  codificarPng: (img: { width: number; height: number; data: Uint8Array }) =>
    new Uint8Array(encodePng({ ...img, channels: 4, depth: 8 } as any)),
  PDFDocument, PDFName, PDFRawStream,
  buscar: fetch,
};

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
    const baseDoConversor = (Deno.env.get('DOCS_CONVERTER_URL') || CONVERSOR_PADRAO)
      .replace(/\/+$/, '');

    // ── PORTEIRO ──
    // Dois chamadores legítimos, e nenhum deles é o público:
    //
    //   · a EQUIPE, logada, criando um envelope pelo assistente — a permissão
    //     sobre este envelope não é reimplementada aqui: a leitura passa pela
    //     RLS com o token de quem chamou, então vale a mesma régua da tela;
    //   · o `template-fill`, que é servidor e chega com a service role.
    //
    // Congelar reescreve a origem de um documento que vale como prova. Deixar
    // isso aberto seria dar a qualquer um o poder de trocar o original.
    const authHeader = req.headers.get('Authorization') || '';
    const tokenDoChamador = authHeader.replace(/^Bearer\s+/i, '').trim();
    const ehInterno = tokenDoChamador.length > 0 && tokenDoChamador === serviceKey;

    let userClient: Supa | null = null;
    if (!ehInterno) {
      userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return jsonResponse({ error: 'Não autenticado' }, 401);
      const { data: ehEquipe } = await userClient.rpc('is_office_staff');
      if (ehEquipe !== true) return jsonResponse({ error: 'Sem permissão' }, 403);
    }

    let body: any = null;
    try { body = JSON.parse((await req.text()) || '{}'); }
    catch { return jsonResponse({ error: 'JSON inválido' }, 400); }

    const requestId = String(body?.request_id ?? '').trim();
    if (!requestId) return jsonResponse({ error: 'request_id é obrigatório' }, 400);

    if (userClient) {
      const { data: visivel } = await userClient
        .from('signature_requests').select('id').eq('id', requestId).maybeSingle();
      if (!visivel) return jsonResponse({ error: 'Envelope não encontrado ou sem permissão' }, 403);
    }

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
    if (alvos.length === 0) return jsonResponse({ error: 'Envelope sem documento' }, 400);

    // Os signatários, na ordem do CONVITE — é ela que `[[ASSINATURA_2]]` cita.
    const { data: signersData } = await supabase.from('signature_signers')
      .select('id, "order"').eq('signature_request_id', requestId)
      .order('order', { ascending: true });
    const signatarios = (signersData ?? []) as Array<{ id: string; order: number | null }>;

    // Documento que já tem campo marcado A MÃO ignora o marcador automático — a
    // mesma precedência do assistente. Somar os dois daria duas assinaturas no
    // mesmo documento.
    const { data: camposExistentes } = await supabase.from('signature_fields')
      .select('document_id, field_type').eq('signature_request_id', requestId);
    const comCampoManual = new Set(
      (camposExistentes ?? [])
        .filter((f: any) => f.field_type === 'signature')
        .map((f: any) => String(f.document_id || 'main')),
    );

    const { data: jaCongelados } = await supabase.from('signature_source_files')
      .select('document_key').eq('signature_request_id', requestId);
    const congeladas = new Set((jaCongelados ?? []).map((r: any) => String(r.document_key)));

    const resultados: Array<Record<string, unknown>> = [];
    const camposParaGravar: Array<Record<string, unknown>> = [];
    /** As âncoras deste documento, para gravar JUNTO do arquivo congelado. */
    let ancorasDoDocumento: Array<Record<string, unknown>> = [];

    for (const alvo of alvos) {
      // Já congelado é intocável: recongelar reescreveria a origem de um
      // documento que talvez já tenha sido assinado.
      if (congeladas.has(alvo.chave)) {
        resultados.push({ document_key: alvo.chave, resultado: 'ja_congelado' });
        continue;
      }

      const bytes = await baixarDoStorage(supabase, alvo.path);
      if (!bytes) {
        resultados.push({ document_key: alvo.chave, path: alvo.path, resultado: 'nao_encontrado' });
        continue;
      }

      let caminhoFinal = alvo.path;
      let bytesFinais = bytes;
      let marcadores = 0;
      let localizadas = 0;
      let veioDeDocx = false;
      ancorasDoDocumento = [];

      if (pareceUmZip(bytes)) {
        // ── A TRAVA DE PAGINAÇÃO ──
        //
        // Documento com campo já marcado (pelo designer ou à mão) NÃO é
        // convertido. As coordenadas daqueles campos foram medidas contra a
        // paginação do `docx-preview`, no navegador; este PDF é paginado pelo
        // Syncfusion, que quebra por conta própria. Uma quebra em lugar
        // diferente move o campo da página 3 para a 4 — e a assinatura sai no
        // lugar errado de um documento jurídico, defeito que só aparece DEPOIS
        // de assinado.
        //
        // A âncora não tem esse problema, e é essa a diferença: a coordenada
        // dela sai do MESMO PDF que está sendo congelado, então não há duas
        // paginações para divergir. Por isso o congelamento no servidor só vale
        // para documento cuja posição vem de `[[ASSINATURA]]`.
        //
        // Ver a seção "O que ainda NÃO foi comparado" no diário: a comparação
        // de paginação `preview` × `DocIORenderer` continua pendente, e até ela
        // acontecer esta trava é o que impede um erro silencioso.
        if (comCampoManual.has(alvo.chave)) {
          resultados.push({
            document_key: alvo.chave,
            resultado: 'pulado_tem_campo_marcado',
            motivo: 'campos posicionados no designer usam a paginação do navegador; '
              + 'converter aqui poderia mover a assinatura de página',
          });
          continue;
        }

        // ── O caminho novo: `.docx` vira PDF AQUI ──
        let convertido: ConversaoDoDocx;
        try {
          convertido = await docxParaPdfComAncoras(
            bytes, `${alvo.chave}.docx`, baseDoConversor, FERRAMENTAS,
          );
        } catch (e) {
          console.error('[congelar-docx] conversão falhou', alvo.chave, e);
          resultados.push({
            document_key: alvo.chave, resultado: 'falha_na_conversao',
            detalhe: e instanceof Error ? e.message : String(e),
          });
          continue;
        }

        bytesFinais = convertido.pdf;
        veioDeDocx = true;
        marcadores = convertido.marcadores;
        localizadas = convertido.ancorasLocalizadas;

        const nomeSeguro = String(request0.document_name || alvo.chave)
          .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        caminhoFinal = `signature-requests/${requestId}/${Date.now()}_${alvo.chave}_${nomeSeguro}.pdf`;
        const { error: erroUpload } = await supabase.storage.from(BUCKET_DO_CONGELADO)
          .upload(caminhoFinal, bytesFinais, { contentType: 'application/pdf', upsert: false });
        if (erroUpload) {
          console.error('[congelar-docx] upload falhou', caminhoFinal, erroUpload);
          resultados.push({ document_key: alvo.chave, resultado: 'falha_no_upload' });
          continue;
        }

        // ── Os campos dos marcadores ──
        // Só entram se o documento NÃO tiver campo manual, e só para signatário
        // que existe: um campo com `signer_id` nulo criaria uma assinatura que
        // ninguém assina, e o envelope ficaria pendente para sempre sem motivo
        // visível.
        // As âncoras vão para a linha do congelado SEMPRE que existirem: elas
        // descrevem ESTE PDF, e é a montagem no servidor que as consome.
        ancorasDoDocumento = convertido.campos.map((c) => ({
          indiceDoAssinante: c.indiceDoAssinante,
          page_number: c.page_number,
          x_percent: c.x_percent, y_percent: c.y_percent,
          w_percent: c.w_percent, h_percent: c.h_percent,
        }));

        if (!comCampoManual.has(alvo.chave)) {
          for (const campo of convertido.campos) {
            const assinante = signatarios.find((s) => (s.order ?? 0) === campo.indiceDoAssinante)
              ?? signatarios[campo.indiceDoAssinante - 1];
            if (!assinante) {
              console.warn('[congelar-docx] marcador sem signatário correspondente',
                alvo.chave, campo.indiceDoAssinante);
              continue;
            }
            camposParaGravar.push({
              signature_request_id: requestId,
              document_id: alvo.chave,
              signer_id: assinante.id,
              field_type: 'signature',
              page_number: campo.page_number,
              x_percent: campo.x_percent,
              y_percent: campo.y_percent,
              w_percent: campo.w_percent,
              h_percent: campo.h_percent,
            });
          }
        }
      } else if (!pareceUmPdf(bytes)) {
        resultados.push({ document_key: alvo.chave, resultado: 'formato_desconhecido' });
        continue;
      }

      const sha = await sha256Hex(bytesFinais);
      // A PROVENIÊNCIA é gravada junto, e não é enfeite: o dossiê publica que o
      // arquivo conferido é um PDF que veio de um `.docx`, e por qual motor. Sem
      // isso, o laudo afirmaria um original que não é o arquivo que o autor
      // escreveu, sem dizer que houve conversão pelo caminho.
      const { error: erroLinha } = await supabase.from('signature_source_files').insert({
        signature_request_id: requestId,
        document_key: alvo.chave,
        file_path: caminhoFinal,
        sha256: sha,
        is_pdf: true,
        byte_size: bytesFinais.length,
        display_name: alvo.chave === 'main'
          ? (request0.document_name ?? null) : null,
        sort_order: alvo.indice,
        // A coordenada da âncora mora AQUI, e não em `signature_fields`: ela é
        // medida na paginação deste PDF, e o navegador pagina de outro jeito
        // (ver a migration `ancoras_da_assinatura_no_congelado`).
        signature_anchors: ancorasDoDocumento.length > 0 ? ancorasDoDocumento : null,
        frozen_at: new Date().toISOString(),
        original_path: veioDeDocx ? alvo.path : null,
        original_name: veioDeDocx ? (alvo.path.split('/').pop() ?? null) : null,
        converted_from: veioDeDocx ? 'docx' : null,
        // O motor é o DocIORenderer do `docs.jurius-api.com` — NÃO é o `preview`
        // do navegador, e a diferença importa: os dois paginam por conta própria.
        conversion_engine: veioDeDocx ? 'syncfusion-docio' : null,
        // O PDF do DocIORenderer é vetorial, com texto extraível de verdade —
        // medido em 03/09/2026: 7.506 caracteres, sem camada invisível.
        conversion_searchable: veioDeDocx ? true : null,
      });
      if (erroLinha) {
        console.error('[congelar-docx] insert de origem falhou', alvo.chave, erroLinha);
        resultados.push({ document_key: alvo.chave, resultado: 'falha_no_registro' });
        continue;
      }

      resultados.push({
        document_key: alvo.chave,
        resultado: caminhoFinal === alvo.path ? 'congelado_pdf' : 'convertido_e_congelado',
        file_path: caminhoFinal,
        sha256: sha,
        marcadores,
        ancoras_localizadas: localizadas,
      });

      // Marcador achado no `.docx` mas âncora não localizada no PDF é o sintoma
      // de que a conversão engoliu a imagem — e o documento sai SEM campo de
      // assinatura. Não é erro de execução, mas não pode ficar só no log.
      if (marcadores > localizadas) {
        await audit(supabase, requestId, 'source_frozen',
          `ATENÇÃO: ${alvo.chave} tinha ${marcadores} marcador(es) de assinatura, mas só `
          + `${localizadas} âncora(s) foram localizadas no PDF convertido. O documento pode `
          + 'ficar sem campo de assinatura.');
      }
    }

    // ── POR QUE OS CAMPOS DA ÂNCORA NÃO SÃO GRAVADOS EM `signature_fields` ──
    //
    // Eles foram medidos na paginação do PDF CONGELADO (Syncfusion). Enquanto a
    // montagem acontecer no navegador, quem usa esses campos é o `docx-preview`,
    // que pagina de outro jeito — e o defeito foi MEDIDO em produção em
    // 04/09/2026:
    //
    //   [PDF] Campos de assinatura recebidos via override: 1
    //   [PDF] Campo manual mapeado (main): page_designer=5 → section=1/1, yPct=100.0
    //
    // O campo dizia "página 5"; o navegador tinha 1 seção, grampeou em
    // `yPct=100` e a rubrica foi para o rodapé. Pior: ANTES disso o navegador
    // achava o `[[ASSINATURA]]` sozinho e acertava. Gravar o campo aqui
    // SUBSTITUI uma detecção que funciona por uma coordenada de outra
    // paginação.
    //
    // É a mesma divergência da trava de paginação lá em cima, na direção
    // inversa: lá o campo do designer não pode ir para o PDF do servidor; aqui
    // o campo do servidor não pode ir para o desenho do navegador.
    //
    // As duas coordenadas só param de brigar quando a montagem também for do
    // servidor. Até lá, os campos ficam registrados na auditoria (abaixo) e
    // NÃO entram em `signature_fields`: o congelamento continua valendo, e o
    // navegador continua achando o marcador como sempre achou.
    if (camposParaGravar.length > 0) {
      await audit(supabase, requestId, 'source_frozen',
        `ÂNCORAS localizadas (não gravadas como campos enquanto a montagem for do `
        + `navegador): ${JSON.stringify(camposParaGravar.map((c) => ({
          doc: c.document_id, pg: c.page_number,
          x: Number(c.x_percent).toFixed(2), y: Number(c.y_percent).toFixed(2),
        })))}`);
    }

    await audit(supabase, requestId, 'source_frozen',
      `Congelamento no servidor: ${resultados.length} arquivo(s), `
      + `${camposParaGravar.length} âncora(s) de assinatura localizada(s).`);

    return jsonResponse({
      success: true,
      request_id: requestId,
      ancoras_localizadas: camposParaGravar.length,
      campos_gravados: 0,
      resultados,
    });
  } catch (err) {
    console.error('[congelar-docx-no-servidor] erro:', err);
    return jsonResponse({ error: 'Erro interno' }, 500);
  }
});
