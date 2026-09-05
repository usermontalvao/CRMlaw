// ============================================================================
// MONTAR O DOCUMENTO ASSINADO — o artefato jurídico nasce AQUI, no servidor.
// ----------------------------------------------------------------------------
// Até hoje o PDF assinado era desenhado no aparelho de quem assina. O navegador
// montava, calculava o SHA-256, criava o código de verificação e mandava tudo
// pronto; o servidor gravava e "conferia" o hash contra o valor que o próprio
// navegador enviara. Isso prova que o arquivo não mudou no caminho — e nada
// além disso. A `pades-sign`, que sela o PDF com a nossa chave, acabava
// assinando criptograficamente um conteúdo que nós não construímos.
//
// Esta função fecha esse buraco:
//
//   1. lê do Storage o PDF CONGELADO (`signature_source_files`, cujo SHA-256 o
//      servidor apurou em `signature-freeze-source`);
//   2. lê do banco os signatários, os campos, a trilha de auditoria;
//   3. monta com `_shared/montagem/` — o mesmo desenho de antes, portado;
//   4. calcula o hash sobre OS BYTES QUE ELA MESMA produziu;
//   5. grava no bucket `assinados` (upsert:false) e chama a RPC.
//
// UMA VEZ SÓ, e isso é requisito, não detalhe — mas é uma regra POR
// SIGNATÁRIO. Antes de desenhar, a função olha o ponteiro: se o artefato
// desta chave já é dela (ou é de alguém que assinou DEPOIS), devolve o que
// existe. Se é de um signatário ANTERIOR, monta de novo — a versão nova traz
// as rubricas de todos, que é o mesmo `last-signer-wins` que o banco aplica.
// Ver o passo 4.
//
// O QUE ELA NÃO ACEITA DO CLIENTE: os bytes do documento, o hash, o código de
// verificação, o caminho de destino, a lista de campos. Tudo isso é lido aqui
// dentro, a partir do `token` do signatário. Aceitar qualquer um desses
// devolveria, por outra porta, o poder que esta função existe para tirar do
// navegador.
//
// Ver `docs/assinatura-montagem-no-servidor.md`.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  LineCapStyle, PDFDocument, PDFString, StandardFonts, degrees, rgb,
} from 'npm:pdf-lib@1.17.1';
import QRCode from 'npm:qrcode@1.5.4';
import { decode as decodePng, encode as encodePng } from 'npm:fast-png@6.4.0';

import { montarDocumentoAssinado, type CampoDeAssinatura } from '../_shared/montagem/montarDocumentoAssinado.ts';
import { montarTrilhaDeEventos, type LinhaDeAuditoria } from '../_shared/montagem/trilhaDeEventos.ts';
import { paletaDoLaudo } from '../_shared/montagem/laudoDesign.ts';
import { WORDMARK_RATIO, wordmarkPngBytes } from '../_shared/montagem/wordmark.ts';
import { logoPngBytes } from '../_shared/montagem/logo.ts';
import { recortarFundoDaRubrica } from '../_shared/montagem/recorteDaRubrica.ts';
import { CORRECAO_DE_ERRO_DO_QR } from '../_shared/montagem/qr-em-retangulos.ts';
import { decidirSeMonta, instanteDaAssinatura } from '../_shared/montagem/donoDoArtefato.ts';
import { formatarDataHoraDoEscritorio } from '../_shared/montagem/dadosDoSignatario.ts';
import { seloImpressaoCurta } from '../_shared/montagem/selo.ts';
import type { SignatarioNoLaudo } from '../_shared/montagem/laudo.ts';
import type { LinhaDeSignatarioNoLaudo } from '../_shared/montagem/dossieDoSignatario.ts';

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
const BUCKET_DESTINO = 'assinados';

/**
 * Onde o site público vive, para o QR e o link dos Termos.
 *
 * A variável é `PUBLIC_APP_ORIGIN` porque é a que o resto do projeto já usa
 * (`whatsapp-signature-followup`, `whatsapp-template-fill-followup`,
 * `whatsapp-ai-agent`). Inventar um nome novo aqui daria uma função que ignora
 * em silêncio a origem já configurada — e o QR de um documento de prova
 * apontaria para outro domínio sem ninguém errar nada.
 */
const URL_PUBLICA_PADRAO = 'https://jurius.com.br';

type Supa = ReturnType<typeof createClient>;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 16 hexadecimais MINÚSCULOS, igual ao `generateVerificationHash` do cliente.
 *
 * Minúsculo é a forma canônica: é ela que vai para o banco e para a URL do QR.
 * A maiúscula existe só na folha, para ser lida e digitada.
 */
function novoCodigoDeVerificacao(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function baixarDoStorage(supabase: Supa, path: string): Promise<Uint8Array | null> {
  for (const bucket of BUCKETS_CANDIDATOS) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) continue;
    return new Uint8Array(await data.arrayBuffer());
  }
  return null;
}

async function audit(supabase: Supa, requestId: string, signerId: string | null, action: string, description: string) {
  try {
    await supabase.from('signature_audit_log').insert({
      signature_request_id: requestId, signer_id: signerId, action,
      description: description.slice(0, 1000),
    });
  } catch (e) { console.error('[montar] audit insert failed', e); }
}

/**
 * Embute uma imagem do Storage no documento.
 *
 * A rubrica passa pelo recorte de fundo branco; a selfie, não — apagar o branco
 * de uma foto de rosto comeria o fundo da parede junto com parte da pessoa.
 *
 * FALHA MACIA em tudo: imagem que não baixa, formato que o pdf-lib recusa, PNG
 * que o codec não entende. A montagem segue sem ela — um documento sem selfie é
 * um documento; um envelope travado no meio da assinatura não é nada.
 */
async function embutirImagem(
  supabase: Supa, doc: PDFDocument, path: string | null | undefined, recortarFundo: boolean,
): Promise<{ imagem: any; largura: number; altura: number } | null> {
  const caminho = String(path ?? '').trim();
  if (!caminho) return null;
  try {
    const bytes = await baixarDoStorage(supabase, caminho);
    if (!bytes) return null;

    const ehPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    let finais = bytes;
    if (ehPng && recortarFundo) {
      const r = recortarFundoDaRubrica(bytes, {
        decodificar: (b) => decodePng(b) as any,
        codificar: (img) => new Uint8Array(encodePng({
          width: img.width, height: img.height, data: img.data as any, channels: 4, depth: 8,
        })),
      });
      if (!r.recortado && r.motivo === 'apagou-demais') {
        console.warn('[montar] recorte apagaria a rubrica inteira — usando a original', caminho);
      }
      finais = r.png;
    }

    const imagem = ehPng ? await doc.embedPng(finais) : await doc.embedJpg(finais);
    return { imagem, largura: imagem.width, altura: imagem.height };
  } catch (e) {
    console.warn('[montar] imagem ignorada', caminho, e);
    return null;
  }
}

/** A matriz do QR. `QRCode.create` é puro — só monta a matriz, sem canvas. */
function matrizDoQr(url: string): { modulos: ArrayLike<number>; tamanho: number } | null {
  try {
    const q = QRCode.create(url, { errorCorrectionLevel: CORRECAO_DE_ERRO_DO_QR });
    return { modulos: q.modules.data, tamanho: q.modules.size };
  } catch (e) {
    console.warn('[montar] QR não gerado', e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: 'Supabase env not configured' }, 500);
    }
    const baseUrlPublica = (Deno.env.get('PUBLIC_APP_ORIGIN') || URL_PUBLICA_PADRAO).replace(/\/+$/, '');

    let body: any = null;
    try { body = JSON.parse((await req.text()) || '{}'); }
    catch { return jsonResponse({ error: 'JSON inválido' }, 400); }

    const token = String(body?.token ?? '').trim();
    const chaveDoDocumento = String(body?.document_key ?? 'main').trim() || 'main';
    if (!token) return jsonResponse({ error: 'token é obrigatório' }, 400);

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
    });

    // ── 1. O token diz quem é o signatário e qual é o envelope ──
    const { data: signer } = await supabase.from('signature_signers')
      .select('id, signature_request_id, status')
      .eq('public_token', token).maybeSingle();
    if (!signer) return jsonResponse({ error: 'Token inválido' }, 403);
    if (signer.status !== 'signed') {
      // Montar antes de assinar produziria um artefato que afirma um ato que
      // não aconteceu. A ordem é: assina, depois monta.
      return jsonResponse({ error: 'Assinatura ainda não registrada' }, 409);
    }

    const requestId = String(signer.signature_request_id);
    const signerId = String(signer.id);

    // ── 2. O envelope ainda está em circulação? ──
    const { data: request0 } = await supabase.from('signature_requests')
      .select('id, document_name, document_path, attachment_paths, created_at, created_by, '
        + 'status, deleted_at, archived_at, blocked_at, expires_at')
      .eq('id', requestId).maybeSingle();
    if (!request0) return jsonResponse({ error: 'Solicitação não encontrada' }, 404);
    if (request0.deleted_at || request0.archived_at || request0.blocked_at) {
      return jsonResponse({ error: 'Este documento não está mais disponível.' }, 403);
    }
    if (request0.status === 'cancelled' || request0.status === 'expired') {
      return jsonResponse({ error: 'Esta solicitação foi cancelada ou expirou.' }, 403);
    }
    if (request0.expires_at && new Date(request0.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: 'O prazo para assinatura deste documento expirou.' }, 403);
    }

    // ── 3. Quem é do envelope, e quando cada um assinou ──
    // Vem antes do ponteiro porque é a resposta de quem assinou por último que
    // decide se há o que montar (ver o passo 4). É uma consulta barata perto de
    // baixar e desenhar um PDF.
    const { data: signersData } = await supabase.from('signature_signers')
      .select('*').eq('signature_request_id', requestId).order('order', { ascending: true });
    const todos = (signersData ?? []) as LinhaDeSignatarioNoLaudo[];
    const assinados = todos.filter((s: any) => s.status === 'signed');
    const assinouEm = (id: string | null): number =>
      instanteDaAssinatura(todos.find((s) => s.id === id)?.signed_at);

    // ── 4. O PONTEIRO ──
    //
    // "Uma vez só" é requisito — e é uma regra POR SIGNATÁRIO, não por
    // documento. Ler o ponteiro e sair sempre que ele existe parece a leitura
    // segura, e é justamente a que produz o pior defeito possível aqui:
    //
    //   num envelope de dois, o primeiro assina e o artefato nasce com a
    //   rubrica dele. O segundo assina, esta função vê o ponteiro, devolve o
    //   arquivo do PRIMEIRO — e o envelope fecha com um documento em que a
    //   assinatura do segundo não existe. Ninguém erra, nada falha, e o que
    //   fica arquivado é um documento incompleto que afirma estar assinado.
    //
    // O que o banco faz é `last-signer-wins`: a RPC `public_attach_signed_document`
    // só troca a linha quando quem chega assinou DEPOIS de quem está lá. Esta
    // função tem de concordar com aquilo, e a regra sai igual:
    //
    //   · o artefato é MEU  → devolvo o que existe (é o segundo clique);
    //   · o dono assinou DEPOIS de mim → devolvo o dele (a RPC recusaria o meu,
    //     e montar produziria um arquivo órfão no bucket);
    //   · o dono assinou ANTES de mim → MONTO, e a minha versão traz as duas
    //     rubricas, porque `rubricaPorSignatario` é montado com todo mundo que
    //     já assinou.
    const { data: documentoExistente } = await supabase.from('signature_request_documents')
      .select('id, signer_id, signed_file_path, verification_code, signed_pdf_sha256, page_count')
      .eq('signature_request_id', requestId).eq('document_key', chaveDoDocumento).maybeSingle();

    const devolverOExistente = () => jsonResponse({
      success: true, ja_montado: true,
      signed_file_path: documentoExistente!.signed_file_path,
      verification_code: documentoExistente!.verification_code,
      signed_pdf_sha256: documentoExistente!.signed_pdf_sha256,
      page_count: documentoExistente!.page_count,
    });

    if (documentoExistente?.signed_file_path) {
      // A regra vive em `donoDoArtefato.ts`, com teste próprio: ela erra em
      // silêncio nos dois sentidos, e é a mesma que o banco aplica.
      const decisao = decidirSeMonta({
        donoAtual: documentoExistente.signer_id ? String(documentoExistente.signer_id) : null,
        quemPede: signerId,
        assinouEm,
      });
      if (!decisao.montar) {
        console.log('[montar] devolvendo o artefato registrado de', chaveDoDocumento,
          '—', decisao.motivo);
        return devolverOExistente();
      }
      console.log('[montar] refazendo', chaveDoDocumento,
        '— o artefato é de um signatário anterior e esta versão traz mais uma rubrica');
    }

    // ── 5. O ORIGINAL CONGELADO ──
    // A montagem só acontece sobre o arquivo que o SERVIDOR conferiu. Sem linha
    // congelada não há sobre o que montar — e cair no arquivo cru do Storage
    // devolveria a confiança que o congelamento existe para remover.
    const { data: congelado } = await supabase.from('signature_source_files')
      .select('document_key, file_path, sha256, is_pdf, display_name, sort_order, signature_anchors')
      .eq('signature_request_id', requestId).eq('document_key', chaveDoDocumento).maybeSingle();

    if (!congelado) {
      return jsonResponse({
        error: 'Documento de origem ainda não foi congelado pelo servidor.',
        codigo: 'sem_original_congelado',
      }, 409);
    }
    if (congelado.is_pdf === false) {
      return jsonResponse({
        error: 'O documento de origem congelado não é um PDF.',
        codigo: 'original_nao_e_pdf',
      }, 409);
    }

    const bytesDoOriginal = await baixarDoStorage(supabase, String(congelado.file_path));
    if (!bytesDoOriginal) {
      return jsonResponse({ error: 'Documento de origem não encontrado no Storage' }, 404);
    }

    // A CONFERÊNCIA, e ela é barata: os bytes lidos agora têm de bater com o
    // que foi congelado. Se não batem, o Storage mudou depois do congelamento —
    // e montar sobre um arquivo trocado produziria um documento assinado cuja
    // origem o próprio laudo declararia errada.
    const shaAgora = await sha256Hex(bytesDoOriginal);
    const shaCongelado = String(congelado.sha256 ?? '').trim().toLowerCase();
    if (shaCongelado && shaAgora !== shaCongelado) {
      await audit(supabase, requestId, signerId, 'integrity_violation',
        `INTEGRIDADE: a origem ${chaveDoDocumento} (${congelado.file_path}) mudou depois do `
        + `congelamento. Registrado ${shaCongelado}; lido agora ${shaAgora}. Montagem recusada.`);
      return jsonResponse({
        error: 'O documento de origem mudou depois de congelado.',
        codigo: 'origem_divergente',
      }, 409);
    }

    // ── 6. O que foi marcado e o que aconteceu ──
    const { data: fieldsData } = await supabase.from('signature_fields')
      .select('field_type, signer_id, document_id, page_number, x_percent, y_percent, w_percent, h_percent')
      .eq('signature_request_id', requestId);
    // Cada arquivo do kit recebe SÓ os campos com o SEU document_key. Sem este
    // filtro, um campo do principal vazaria e seria estampado também no anexo.
    let campos = ((fieldsData ?? []) as CampoDeAssinatura[])
      .filter((f) => (f.document_id || 'main') === chaveDoDocumento);

    // ── AS ÂNCORAS DO `[[ASSINATURA]]`, quando não há campo marcado ──
    //
    // Documento que veio de `.docx` teve o marcador trocado por uma âncora no
    // congelamento, e a posição dela ficou gravada em `signature_source_files`
    // — não em `signature_fields`. O motivo está na migration
    // `ancoras_da_assinatura_no_congelado`: aquela coordenada é da paginação
    // DESTE PDF, e o navegador, que pagina de outro jeito, colocaria a rubrica
    // no lugar errado se a lesse.
    //
    // Sem esta leitura, o efeito foi MEDIDO em 04/09/2026: a montagem não achava
    // campo nenhum e a rubrica ia para a posição de reserva, no canto da última
    // folha — longe da linha de assinatura, num documento que vale como prova.
    //
    // Campo marcado à mão tem precedência: se ele existe, a âncora não entra.
    // Somar os dois daria duas rubricas no mesmo documento.
    if (campos.length === 0 && Array.isArray(congelado.signature_anchors)) {
      const porOrdem = new Map(todos.map((s: any) => [Number(s.order ?? 0), String(s.id)]));
      const ancoras = congelado.signature_anchors as Array<Record<string, number>>;
      campos = ancoras.flatMap((a, i) => {
        const signerId = porOrdem.get(Number(a.indiceDoAssinante))
          ?? (todos[Number(a.indiceDoAssinante) - 1]?.id ?? null);
        // Âncora que aponta para um signatário inexistente é descartada: um
        // campo sem dono viraria uma assinatura que ninguém assina.
        if (!signerId) {
          console.warn('[montar] âncora sem signatário', chaveDoDocumento, a.indiceDoAssinante);
          return [];
        }
        return [{
          field_type: 'signature',
          signer_id: String(signerId),
          document_id: chaveDoDocumento,
          page_number: Number(a.page_number),
          x_percent: Number(a.x_percent), y_percent: Number(a.y_percent),
          w_percent: Number(a.w_percent), h_percent: Number(a.h_percent),
        } as CampoDeAssinatura];
      });
      console.log('[montar] campos vindos das âncoras de [[ASSINATURA]]:', campos.length,
        'em', chaveDoDocumento);
    }

    const { data: auditData } = await supabase.from('signature_audit_log')
      .select('signer_id, action, ip_address, created_at')
      .eq('signature_request_id', requestId).order('created_at', { ascending: true });

    let nomeDoEmissor: string | null = null;
    if (request0.created_by) {
      const { data: perfil } = await supabase.from('profiles')
        .select('name').eq('id', request0.created_by).maybeSingle();
      nomeDoEmissor = (perfil?.name as string | null) ?? null;
    }

    // ── 7. A identidade deste documento ──
    //
    // O CÓDIGO TEM DUAS FORMAS, e confundi-las quebra a conferência: o valor
    // GRAVADO (e o que vai na URL do QR) é o cru, minúsculo, exatamente como o
    // cliente sempre gerou; o MAIÚSCULO existe só para ser lido na folha. Se a
    // URL saísse em maiúsculas, o link impresso no laudo deixaria de casar com
    // a linha do banco — e o QR de um documento de prova apontaria para o nada.
    const codigo = String(documentoExistente?.verification_code || '').trim()
      || novoCodigoDeVerificacao();
    const codigoParaLeitura = codigo.toUpperCase();
    const urlDeVerificacao = `${baseUrlPublica}/#/verificar/${codigo}`;
    const nomeDoDocumento = String(congelado.display_name || request0.document_name || '').trim() || null;

    // ── 8. Montar ──
    const doc = await PDFDocument.load(bytesDoOriginal);
    const paginasDeConteudo = doc.getPageCount();

    const fontes = {
      helvetica: await doc.embedFont(StandardFonts.Helvetica),
      helveticaBold: await doc.embedFont(StandardFonts.HelveticaBold),
      courier: await doc.embedFont(StandardFonts.Courier),
      courierBold: await doc.embedFont(StandardFonts.CourierBold),
    };
    const wordmark = { imagem: await doc.embedPng(wordmarkPngBytes()), ratio: WORDMARK_RATIO };
    // O "J" do papel timbrado. Falha macia: sem ele o cabeçalho ainda sai, com
    // o wordmark sozinho — que é o que o cliente já faz quando o fetch falha.
    const logo = await doc.embedPng(logoPngBytes()).catch(() => null);
    const qr = matrizDoQr(urlDeVerificacao);

    const rubricaPorSignatario = new Map<string, unknown>();
    const signatariosDoLaudo: SignatarioNoLaudo[] = [];
    for (const s of assinados) {
      const rubrica = await embutirImagem(supabase, doc, (s as any).signature_image_path, true);
      const selfie = await embutirImagem(supabase, doc, s.facial_image_path, false);
      if (rubrica) rubricaPorSignatario.set(s.id, rubrica.imagem);
      signatariosDoLaudo.push({
        linha: s,
        rubrica: rubrica?.imagem ?? null,
        foto: selfie,
        qr,
        urlDeVerificacao,
      });
    }

    const eventos = montarTrilhaDeEventos({
      criadoEm: request0.created_at,
      nomeDoEmissor,
      signatarios: assinados,
      auditoria: (auditData ?? []) as LinhaDeAuditoria[],
      urlDosTermos: (versao) => `${baseUrlPublica}/#/termos-assinatura/${versao}`,
    });

    const assinadoEm = assinados.find((s) => s.id === signerId)?.signed_at
      ?? assinados[assinados.length - 1]?.signed_at ?? null;
    // O FUSO VAI JUNTO, pela mesma razão do carimbo da folha de conteúdo.
    // `emitidoEm` é a ÚNICA hora que aparece na capa e no alto de TODAS as
    // folhas do laudo — e era a única que saía sem dizer de onde é. A nota que
    // explica o fuso mora só no pé da trilha; quem lê a capa, ou fotografa o
    // cabeçalho, não a leva junto. Num documento que vira prova, hora sem fuso
    // é afirmação ambígua, e a ambiguidade cai justamente sobre quando o
    // certificado foi emitido.
    const emitidoEm = `${formatarDataHoraDoEscritorio(new Date())} (Cuiabá)`;

    const resultado = await montarDocumentoAssinado({
      documento: doc as any,
      ferramentas: { rgb, degrees, PDFString, pontaRedonda: LineCapStyle.Round },
      fontes,
      cores: paletaDoLaudo(rgb),
      // Um arquivo por montagem: a chave em escopo mapeada em 0. Não existe
      // 'main' genérico junto, senão um campo do principal vazaria para o anexo.
      deslocamentos: { [chaveDoDocumento]: 0 },
      paginasDeConteudo,
      campos,
      todosOsSignatarios: new Set(todos.map((s) => s.id)),
      rubricaPorSignatario,
      rubricaDeReserva: rubricaPorSignatario.get(signerId) ?? null,
      dadosDoRodape: {
        // O rodapé maiusculiza por conta própria (ver `rodape.ts`).
        codigo,
        protocolo: requestId,
        sha256DoOriginal: shaAgora,
        urlDeVerificacao,
        // O FUSO VAI JUNTO. Este carimbo é a única marca de hora nas folhas de
        // CONTEÚDO — a nota de fuso da trilha está lá no fim, e a folha solta
        // que alguém fotografa não a leva junto. "17:57" sem origem, num
        // documento que vira prova, é uma afirmação ambígua sobre a hora de um
        // ato jurídico. Conferido que cabe: 515 pt de 694 disponíveis.
        assinadoEm: `${formatarDataHoraDoEscritorio(assinadoEm)} (Cuiabá)`,
        seloCurto: seloImpressaoCurta(4),
      },
      qr,
      wordmark,
      logo,
      laudo: {
        identidade: { nomeDoDocumento, codigo: codigoParaLeitura, protocolo: requestId, emitidoEm },
        signatarios: signatariosDoLaudo,
        eventos,
        sha256DoOriginal: shaAgora,
      },
    });

    // ── 9. O hash é dos bytes que ESTA função produziu ──
    const shaDoAssinado = await sha256Hex(resultado.bytes);
    const caminhoDestino = `${requestId}/signed_${chaveDoDocumento}_${signerId}_${Date.now()}.pdf`;

    const { error: erroDeUpload } = await supabase.storage.from(BUCKET_DESTINO)
      .upload(caminhoDestino, resultado.bytes, {
        contentType: 'application/pdf',
        // upsert:false — o bucket `assinados` nunca sobrescreve. Defesa em
        // profundidade junto do ponteiro conferido no passo 3.
        upsert: false,
      });
    if (erroDeUpload) {
      console.error('[montar] falha no upload', erroDeUpload);
      return jsonResponse({ error: 'Falha ao gravar o documento assinado' }, 500);
    }

    // ── 10. O registro ──
    const ehPrincipal = chaveDoDocumento === 'main';
    const { error: erroDaRpc } = await supabase.rpc('public_attach_signed_document', {
      p_token: token,
      p_document_key: chaveDoDocumento,
      p_document_type: ehPrincipal ? 'main' : 'attachment',
      p_display_name: nomeDoDocumento,
      p_source_file_path: congelado.file_path,
      p_signed_path: caminhoDestino,
      p_verification_code: codigo,
      p_sha256: shaDoAssinado,
      p_document_hash: shaAgora,
      p_page_count: resultado.paginasDeConteudo,
      p_sort_order: Number(congelado.sort_order ?? 0),
    });
    if (erroDaRpc) {
      // Persistir o documento é requisito jurídico e NÃO pode falhar em
      // silêncio: o arquivo está no Storage, mas sem ponteiro ele não existe
      // para ninguém.
      console.error('[montar] RPC falhou', erroDaRpc);
      return jsonResponse({
        error: 'Falha ao registrar o documento assinado',
        signed_file_path: caminhoDestino,
      }, 500);
    }

    if (resultado.usouPosicaoDeReserva) {
      // Envelope que cai na reserva perdeu a âncora do campo. Não é erro, mas
      // merece investigação — e um documento de prova não guarda isso só no log.
      await audit(supabase, requestId, signerId, 'signed',
        `MONTAGEM: nenhum campo de assinatura foi aproveitado em ${chaveDoDocumento}; `
        + 'a rubrica foi para a posição de reserva (canto da última folha).');
    }

    return jsonResponse({
      success: true,
      ja_montado: false,
      signed_file_path: caminhoDestino,
      verification_code: codigo,
      signed_pdf_sha256: shaDoAssinado,
      document_hash: shaAgora,
      page_count: resultado.paginasDeConteudo,
      total_pages: resultado.paginasTotais,
      laudo: resultado.laudo,
      usou_posicao_de_reserva: resultado.usouPosicaoDeReserva,
    });
  } catch (err) {
    console.error('[montar-documento-assinado] erro:', err);
    return jsonResponse({ error: 'Erro interno' }, 500);
  }
});
