import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ehArquivoWord,
  ehArquivoPdf,
  nomeDoOriginalCongelado,
  pareceUmPdf,
  chaveDoDocumento,
  planoDeCongelamento,
  quantosConverter,
  frasePreparandoDocumento,
} from './congelamentoDoOriginal.ts';

const bytesDe = (texto: string): Uint8Array =>
  new Uint8Array(Array.from(texto, (c) => c.charCodeAt(0)));

test('Word é reconhecido pelo que ele é, não pela caixa das letras', () => {
  assert.equal(ehArquivoWord('CONTRATO.DOCX'), true);
  assert.equal(ehArquivoWord('peticao.docx'), true);
  assert.equal(ehArquivoWord('antigo.doc'), true);
  assert.equal(ehArquivoWord('contrato.pdf'), false);
  assert.equal(ehArquivoPdf('CONTRATO.PDF'), true);
});

test('o caminho do Storage com query não engana a extensão', () => {
  // Os caminhos chegam de `createSignedUrl`, com `?token=…` pendurado.
  assert.equal(ehArquivoWord('signature-requests/abc/1725.docx?token=xyz'), true);
  assert.equal(ehArquivoPdf('signature-requests/abc/1725.pdf#page=2'), true);
});

test('congelar troca a extensão, não empilha outra', () => {
  // "contrato.docx.pdf" no cabeçalho do laudo denuncia encanamento a quem só
  // queria assinar um contrato.
  assert.equal(nomeDoOriginalCongelado('contrato.docx'), 'contrato.pdf');
  assert.equal(nomeDoOriginalCongelado('KIT CONSUMIDOR.DOCX'), 'KIT CONSUMIDOR.pdf');
  assert.equal(nomeDoOriginalCongelado('sem extensao'), 'sem extensao.pdf');
  assert.equal(nomeDoOriginalCongelado('  '), 'documento.pdf');
});

test('%PDF- é procurado no primeiro quilobyte, não exigido no byte zero', () => {
  assert.equal(pareceUmPdf(bytesDe('%PDF-1.7\n...')), true);
  // Lixo na frente acontece em arquivo real, e o Adobe abre.
  assert.equal(pareceUmPdf(bytesDe('﻿\n\n%PDF-1.4')), true);
  assert.equal(pareceUmPdf(bytesDe('PK isto é um .docx')), false);
  assert.equal(pareceUmPdf(bytesDe('')), false);
  assert.equal(pareceUmPdf(null), false);
});

test('o %PDF- longe demais do começo não conta', () => {
  // Um arquivo que só menciona "%PDF-" no meio do conteúdo não é um PDF.
  const longe = new Uint8Array(4096);
  longe.set(bytesDe('%PDF-1.7'), 2000);
  assert.equal(pareceUmPdf(longe), false);
});

test('a chave do documento é a MESMA de signature_fields.document_id', () => {
  // Inventar uma segunda numeração desalinharia o campo de assinatura marcado
  // na tela do arquivo em que ele foi marcado.
  assert.equal(chaveDoDocumento(0), 'main');
  assert.equal(chaveDoDocumento(1), 'attachment-0');
  assert.equal(chaveDoDocumento(3), 'attachment-2');
});

test('o plano diz o que converter e como o arquivo vai se chamar', () => {
  const plano = planoDeCongelamento([
    { nome: 'PROCURACAO.docx', caminho: 'generated-documents/x/proc.docx' },
    { nome: 'rg.pdf', caminho: 'signature-requests/x/rg.pdf' },
    { nome: 'declaracao.doc' },
  ]);

  assert.equal(plano.length, 3);

  assert.deepEqual(
    plano.map((p) => p.chave),
    ['main', 'attachment-0', 'attachment-1'],
  );
  assert.deepEqual(
    plano.map((p) => p.converter),
    [true, false, true],
  );
  assert.deepEqual(
    plano.map((p) => p.nomeFinal),
    ['PROCURACAO.pdf', 'rg.pdf', 'declaracao.pdf'],
  );
  assert.equal(plano[0].caminhoOriginal, 'generated-documents/x/proc.docx');
  assert.equal(plano[2].caminhoOriginal, null);
  assert.equal(quantosConverter(plano), 2);
});

test('PDF que já é PDF não é reconvertido', () => {
  // Reconverter degradaria o arquivo por nada: o congelamento é para quem
  // ainda não está congelado.
  const plano = planoDeCongelamento([{ nome: 'contrato.pdf' }]);
  assert.equal(plano[0].converter, false);
  assert.equal(plano[0].nomeFinal, 'contrato.pdf');
  assert.equal(quantosConverter(plano), 0);
});

test('formato estranho é sinalizado em vez de passar calado', () => {
  const plano = planoDeCongelamento([{ nome: 'foto.png' }]);
  assert.equal(plano[0].formatoDesconhecido, true);
  assert.equal(plano[0].converter, false, 'não sabemos converter, e fingir que sabemos é pior');
});

test('a espera diz qual arquivo está sendo convertido, e de quantos', () => {
  // Tela parada por segundos é indistinguível de tela travada.
  assert.equal(
    frasePreparandoDocumento(1, 1, 'CONTRATO.docx'),
    'Convertendo "CONTRATO.docx" para PDF…',
  );
  assert.equal(
    frasePreparandoDocumento(2, 3, 'anexo.docx'),
    'Convertendo "anexo.docx" para PDF (2 de 3)…',
  );
  assert.equal(frasePreparandoDocumento(0, 0), 'Preparando o documento…');
});

// ═══════════════════════════════════════════════════════════════════════════
// A CÓPIA DUPLA — o Deno não importa de `src/`, então a regra do `%PDF-` e a
// chave do documento vivem também dentro da Edge Function. Estes testes vigiam
// o arquivo real, para as duas cópias não divergirem em silêncio.
// ═══════════════════════════════════════════════════════════════════════════

const fonteDaEdge = (): string =>
  readFileSync(
    new URL('../../supabase/functions/signature-freeze-source/index.ts', import.meta.url),
    'utf8',
  );

test('a Edge Function procura o %PDF- na mesma janela que o navegador', () => {
  const fonte = fonteDaEdge();
  assert.ok(fonte.includes('function pareceUmPdf'), 'a conferência de PDF sumiu da Edge Function');
  assert.ok(fonte.includes('Math.min(bytes.length, 1024)'), 'a janela de busca do %PDF- divergiu');
  assert.ok(
    fonte.includes('[0x25, 0x50, 0x44, 0x46, 0x2d]'),
    'a assinatura de bytes do %PDF- divergiu',
  );
});

test('a chave do documento é a mesma dos dois lados', () => {
  const fonte = fonteDaEdge();
  assert.ok(fonte.includes("indiceNoEnvelope <= 0 ? 'main' : `attachment-${indiceNoEnvelope - 1}`"),
    'a numeração dos anexos divergiu entre o navegador e o servidor');
});

test('os arquivos conferidos saem do envelope, nunca do corpo da requisição', () => {
  // É a linha inteira desta função: deixar o cliente apontar o arquivo
  // devolveria por outra porta o poder que ela existe para tirar dele.
  const fonte = fonteDaEdge();
  assert.ok(
    fonte.includes("select('id, document_path, attachment_paths, document_name, deleted_at')"),
    'os caminhos deixaram de ser lidos do próprio envelope',
  );
  assert.equal(
    /body\?\.(paths|file_path|document_path|attachment_paths)/.test(fonte),
    false,
    'a função passou a aceitar caminho de arquivo vindo do cliente',
  );
});

test('congelar exige gente do escritório, logada', () => {
  const fonte = fonteDaEdge();
  assert.ok(fonte.includes('auth.getUser()'), 'o porteiro de autenticação sumiu');
  assert.ok(fonte.includes("rpc('is_office_staff')"), 'a régua de equipe sumiu');
  // E a permissão sobre ESTE envelope passa pela RLS, com o token de quem chamou.
  assert.ok(
    /userClient[\s\S]{0,200}from\('signature_requests'\)/.test(fonte),
    'a conferência de permissão do envelope deixou de passar pela RLS',
  );
});

test('linha já congelada nunca é sobrescrita — nem por bytes, nem por caminho', () => {
  const fonte = fonteDaEdge();
  assert.ok(fonte.includes("'integrity_violation'"), 'a violação deixou de ser registrada');

  const trechoDivergente = fonte.slice(
    fonte.indexOf('if (anterior?.sha256) {'),
    fonte.indexOf("if (anterior?.sha256 && normalizarSha256(anterior.sha256) === normalizarSha256(sha))"),
  );
  assert.ok(trechoDivergente.length > 0, 'o ramo da divergência sumiu');
  assert.equal(
    trechoDivergente.includes('upsert('),
    false,
    'a divergência voltou a gravar por cima do hash registrado',
  );

  // A TROCA DE CAMINHO É O BURACO QUE ESTE TESTE FECHA.
  //
  // A primeira versão só acusava divergência quando `anterior.file_path ===
  // alvo.path`. Bastava apontar o `document_path` do envelope para outro
  // arquivo, de outros bytes, para o código passar reto pela conferência e cair
  // no `upsert` — trocando o "original congelado" por um novo, sem violação
  // registrada. Imutável tem de valer também quando o ponteiro muda.
  assert.ok(
    trechoDivergente.includes('trocouOCaminho'),
    'a troca de caminho voltou a escapar da conferência do congelado',
  );
  assert.ok(
    /trocouOsBytes \|\| trocouOCaminho/.test(trechoDivergente),
    'a divergência deixou de cobrir os dois casos (bytes E caminho)',
  );
  assert.equal(
    /if \(anterior\?\.sha256 && anterior\.file_path === alvo\.path/.test(fonte),
    false,
    'a conferência voltou a exigir caminho igual para acusar divergência',
  );
});

test('envelope per_document só é devolvido depois do congelamento integral', () => {
  const service = readFileSync(
    new URL('../services/signature.service.ts', import.meta.url),
    'utf8',
  );
  const createRequest = service.slice(
    service.indexOf('async createRequest('),
    service.indexOf('async updateRequest('),
  );

  assert.ok(
    createRequest.includes('await this.exigirOrigemCongeladaNoServidor('),
    'a criação deixou de esperar a confirmação dos PDFs no servidor',
  );
  assert.equal(
    createRequest.includes('void this.congelarOrigemNoServidor('),
    false,
    'o congelamento voltou a correr em segundo plano e pode perder a corrida para os campos',
  );
  assert.ok(
    createRequest.includes(".delete()\n          .eq('id', request.id)"),
    'a solicitação incompleta deixou de ser desfeita quando o congelamento falha',
  );
});

test('o módulo Documentos converte antes de criar o envelope', () => {
  const modulo = readFileSync(
    new URL('../components/DocumentsModule.tsx', import.meta.url),
    'utf8',
  );
  const inicio = modulo.indexOf('const handleSendForSignature = async () =>');
  const fim = modulo.indexOf('// Copiar link para clipboard', inicio);
  const fluxo = modulo.slice(inicio, fim);

  const converte = fluxo.indexOf('await congelarOriginais(');
  const cria = fluxo.indexOf('await signatureService.createRequest(');
  assert.ok(converte >= 0 && cria > converte,
    'Documentos voltou a criar a solicitação antes de transformar todos os arquivos em PDF');
  assert.ok(fluxo.includes('sourceProvenance: congelado.proveniencia'),
    'a proveniência da conversão deixou de acompanhar o congelamento');
});

test('falha do job server-side não cai novamente na montagem pública local', () => {
  const pagina = readFileSync(
    new URL('../components/PublicSigningPage.tsx', import.meta.url),
    'utf8',
  );
  const inicio = pagina.indexOf("} else if (assembly.failed || assembly.status === 'none') {");
  const fim = pagina.indexOf('} else {', inicio + 10);
  const falhaDoServidor = pagina.slice(inicio, fim);

  assert.ok(falhaDoServidor.includes('throw new Error('),
    'a falha server-side deixou de bloquear a geração do artefato no cliente');
  assert.equal(falhaDoServidor.includes('generatePerDocumentSignedForSigner'), false,
    'a página pública voltou a montar o documento localmente após falha do servidor');
  assert.ok(
    pagina.includes("if (request?.signature_model === 'per_document') {\n            throw new Error("),
    'a falha per_document voltou a ser engolida pelo catch interno e exibida como sucesso',
  );
});

test('a Edge só declara íntegro quando confirmou todos os documentos', () => {
  const fonte = fonteDaEdge();
  assert.ok(fonte.includes('confirmados !== esperados'),
    'uma falha isolada de gravação pode voltar a produzir parecer INTEGRO');
  assert.ok(fonte.includes("success: parecer === 'INTEGRO'"),
    'o sucesso da Edge deixou de obedecer ao parecer integral');
});

// ─────────────────────────────────────────────────────────────────────────────
// O ENVELOPE DE UM DOCUMENTO SÓ (`consolidated`) TAMBÉM MONTA NO SERVIDOR.
//
// Estas quatro guardas nasceram de um defeito medido em 04/09/2026: o envelope
// 750a3bce-58b1-4d8c-b159-c6f943d62e87 foi montado NO NAVEGADOR, e o servidor
// nunca foi chamado. A migração inteira tinha sido enganchada no modelo
// `per_document`; o envelope sem anexo, que é o que o assistente do módulo de
// Assinaturas cria, nasce `consolidated` e passava por três portas fechadas —
// congelamento, fila e página — sem que nenhuma reclamasse.
//
// São testes de FONTE, como os de cima, porque o defeito era estrutural: nada
// executava errado, faltava executar.
// ─────────────────────────────────────────────────────────────────────────────

test('a criação congela o original também no envelope de um documento só', () => {
  const service = readFileSync(
    new URL('../services/signature.service.ts', import.meta.url),
    'utf8',
  );
  const createRequest = service.slice(
    service.indexOf('async createRequest('),
    service.indexOf('async updateRequest('),
  );

  assert.ok(
    createRequest.includes("} else if ((requestData.attachment_paths?.length ?? 0) === 0) {"),
    'o envelope consolidado de um documento voltou a nascer sem original congelado',
  );
  assert.ok(
    createRequest.includes('await this.congelarOriginalNoServidor('),
    'o congelamento do consolidado deixou de ser pedido ao servidor',
  );
  // A falha aqui é MACIA de propósito: no consolidado o caminho antigo continua
  // como plano B, e derrubar a criação por causa dele trocaria um defeito
  // silencioso por uma regressão barulhenta.
  const ramo = createRequest.slice(
    createRequest.indexOf("} else if ((requestData.attachment_paths?.length ?? 0) === 0) {"),
  );
  assert.equal(ramo.includes('throw error'), false,
    'o congelamento do consolidado passou a derrubar a criação do envelope');
});

test('a página pública pergunta ao servidor antes de desenhar o consolidado', () => {
  const pagina = readFileSync(
    new URL('../components/PublicSigningPage.tsx', import.meta.url),
    'utf8',
  );

  assert.ok(pagina.includes('const montarConsolidadoNoServidor = async ('),
    'a tentativa de montagem no servidor sumiu do fluxo consolidado');

  // 1) No ato da assinatura: o `else if` tem de vir ANTES do bloco que desenha.
  const gancho = pagina.indexOf('const doServidor = await montarConsolidadoNoServidor(request);');
  const desenho = pagina.indexOf('await pdfSignatureService.saveSignedPdfToStorage({\n              request,');
  assert.ok(gancho >= 0, 'o handleSign parou de tentar o servidor no consolidado');
  assert.ok(desenho < 0 || gancho < desenho,
    'o handleSign voltou a desenhar no navegador antes de perguntar ao servidor');

  // 2) Na regeneração: mesma ordem.
  const regenerar = pagina.slice(
    pagina.indexOf('const generateSignedDocumentForSigner = async ('),
    pagina.indexOf('const waitForSignedDocumentUrl = async ('),
  );
  const perguntaNaRegeneracao = regenerar.indexOf('await montarConsolidadoNoServidor(currentRequest)');
  const desenhaNaRegeneracao = regenerar.indexOf('pdfSignatureService.saveSignedPdfToStorage');
  assert.ok(perguntaNaRegeneracao >= 0,
    'a regeneração do consolidado parou de tentar o servidor');
  assert.ok(desenhaNaRegeneracao < 0 || perguntaNaRegeneracao < desenhaNaRegeneracao,
    'a regeneração voltou a desenhar antes de perguntar ao servidor');

  // 3) O plano B continua existindo — a migração ainda não foi provada em
  //    produção, e apagar o caminho antigo agora seria apostar sem rede.
  assert.ok(regenerar.includes('pdfSignatureService.saveSignedPdfToStorage'),
    'o fluxo consolidado no navegador foi removido antes de o servidor estar provado');

  // 4) A frase que o teste de produção procura no console.
  assert.ok(pagina.includes("'[ASSINATURA] montado NO SERVIDOR —'"),
    'o log que prova a montagem no servidor mudou de texto');
});

test('o worker da fila aceita o envelope consolidado de um documento', () => {
  const worker = readFileSync(
    new URL('../../supabase/functions/montar-envelope-assinado/index.ts', import.meta.url),
    'utf8',
  );

  assert.equal(
    worker.includes("request0.signature_model !== 'per_document') {\n      await reagendar"),
    false,
    'o worker voltou a recusar tudo que não é per_document',
  );
  assert.ok(worker.includes('const modeloAceito = '),
    'a regra de qual envelope o worker monta sumiu');
  assert.ok(worker.includes('anexosDoEnvelope === 0'),
    'o worker deixou de aceitar o consolidado de um documento só');
  // Consolidado COM anexo continua fora: o artefato dele é concatenado.
  assert.ok(worker.includes("request0?.signature_model === 'per_document'\n      || anexosDoEnvelope === 0"),
    'o worker passou a aceitar consolidado com anexo, cujo artefato tem outra forma');
  // E o desempate com o plano B, que é o que impede dois artefatos.
  assert.ok(worker.includes("request0.signature_model !== 'per_document' && signer.signed_document_path"),
    'o worker deixou de desistir quando o navegador montou primeiro');
});

test('o ponteiro do consolidado é gravado uma vez só, pela RPC', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260904230500_ponteiro_do_consolidado_apos_montagem.sql', import.meta.url),
    'utf8',
  );

  // ── A PONTE ──────────────────────────────────────────────────────────────
  assert.ok(sql.includes('WHERE id = v_signer_id AND signed_document_path IS NULL'),
    'a ponte para o consolidado deixou de ser one-shot e pode sobrescrever o artefato');
  assert.ok(sql.includes("IF p_document_key = 'main'")
    && sql.includes("v_model IS DISTINCT FROM 'per_document'")
    && sql.includes('coalesce(v_attachment_count, 0) = 0'),
    'a ponte escapou do documento principal do consolidado de um arquivo só');
  assert.ok(sql.includes('IF v_gravado IS NOT DISTINCT FROM p_signed_path THEN'),
    'uma gravação recusada pelo anti-replay voltou a repontar o signatário');

  // ── AS QUATRO PROTEÇÕES QUE ESTA MIGRATION QUASE APAGOU ──────────────────
  //
  // Em 04/09/2026 a primeira versão desta migration foi escrita a partir de uma
  // cópia ANTIGA da função e substituiu o corpo INTEIRO, levando junto quatro
  // proteções que já existiam. Ficou 34 minutos assim em produção. A RPC é
  // `security definer` e quem a executa é `anon`, com o token público do
  // signatário — (a) e (b) são o que impede quem tem o link de registrar um
  // caminho arbitrário como "documento assinado".
  //
  // Estas asserções existem para que a próxima edição parta do corpo COMPLETO.
  assert.ok(sql.includes('v_deleted_at IS NOT NULL')
    && sql.includes('v_blocked_at IS NOT NULL')
    && sql.includes("v_request_status IN ('cancelled', 'canceled', 'expired', 'refused', 'rejected')"),
    '(a) sumiu: envelope na lixeira, bloqueado ou cancelado voltou a aceitar documento assinado');
  assert.ok(sql.includes("p_signed_path NOT LIKE (v_request_id::text || '/%')"),
    '(b) sumiu: o artefato voltou a poder ser gravado fora da pasta da própria solicitação');
  assert.ok(sql.includes('FROM public.signature_source_files')
    && sql.includes('coalesce(v_hash_congelado, p_document_hash)'),
    '(c) sumiu: o hash do original voltou a ser o que o NAVEGADOR mandou, e não o que o servidor apurou');
  assert.ok(sql.includes('Envelope finalizado com %s documento(s) persistido(s).'),
    '(d) sumiu: o envelope deixou de ser finalizado com registro na trilha');

  // A ponte é ANINHADA, sem `return` — um `RETURN` antes da finalização faria
  // todo envelope de anexo ou de kit parar de fechar sozinho.
  assert.equal(sql.includes('THEN RETURN; END IF;\n\n  v_expected_documents'), false,
    'a ponte voltou a sair por `return` e pula a finalização do envelope');
});

test('job vivo no servidor impede a montagem no navegador', () => {
  const pagina = readFileSync(
    new URL('../components/PublicSigningPage.tsx', import.meta.url),
    'utf8',
  );

  // ── A CORRIDA QUE ESTE TESTE FECHA ───────────────────────────────────────
  //
  // A espera do navegador termina em 25 segundos; o worker confere o
  // `signed_document_path` UMA vez, antes do trabalho demorado. Passado o
  // prazo, ele pode estar no meio da montagem. Se o navegador começasse a
  // montar aí, os dois terminariam: um gravaria em `signature_signers` e o
  // outro em `signature_request_documents`. A trava one-shot barra a segunda
  // escrita do ponteiro, mas não desfaz o registro do outro lado nem apaga o
  // PDF já produzido — sobrariam dois artefatos, com hashes diferentes, para o
  // mesmo ato.
  //
  // A regra: enquanto o job VIVE, a resposta é esperar. Só `failed` — que
  // `reagendar` grava apenas quando a falha é permanente ou as tentativas
  // acabaram — libera o plano B.
  assert.ok(pagina.includes("return { tipo: 'pendente'"),
    'a montagem no servidor voltou a ter só duas respostas; o timeout cai no navegador de novo');
  assert.ok(pagina.includes('if (!assembly.failed) {'),
    'o timeout deixou de distinguir job vivo de falha terminal');

  // Os dois pontos que chamam a montagem têm de tratar `pendente` SEM desenhar.
  const regenerar = pagina.slice(
    pagina.indexOf('const generateSignedDocumentForSigner = async ('),
    pagina.indexOf('const waitForSignedDocumentUrl = async ('),
  );
  const pendenteNaRegeneracao = regenerar.indexOf("doServidor?.tipo === 'pendente'");
  const desenhaNaRegeneracao = regenerar.indexOf('pdfSignatureService.saveSignedPdfToStorage');
  assert.ok(pendenteNaRegeneracao >= 0,
    'a regeneração deixou de tratar a finalização pendente e volta a montar no navegador');
  assert.ok(desenhaNaRegeneracao < 0 || pendenteNaRegeneracao < desenhaNaRegeneracao,
    'a regeneração desenha antes de conferir se há job vivo no servidor');

  assert.ok(pagina.includes("if (doServidor.tipo === 'pendente') {"),
    'o handleSign voltou a cair no bloco de desenho com job vivo no servidor');
});

test('a tela mostra o artefato que ficou REGISTRADO, não o que ela acabou de montar', () => {
  const service = readFileSync(
    new URL('../services/signature.service.ts', import.meta.url),
    'utf8',
  );
  const pagina = readFileSync(
    new URL('../components/PublicSigningPage.tsx', import.meta.url),
    'utf8',
  );

  const anexar = service.slice(
    service.indexOf('async attachSignedPdfPublic('),
    service.indexOf('// ==================== DOCUMENTOS DO ENVELOPE'),
  );

  // Erro de banco era um `console.warn` e a tela comemorava assim mesmo.
  assert.ok(anexar.includes('throw new Error('),
    'a persistência do consolidado voltou a falhar em silêncio');
  // E, mesmo sem erro, a RPC é one-shot: pode não ter gravado nada.
  assert.ok(anexar.includes('getPublicSigningBundle'),
    'a persistência deixou de reler o ponteiro e volta a supor que gravou');
  assert.ok(anexar.includes('foiOMeu'),
    'quem chama perdeu a informação de qual artefato ficou valendo');

  // A página tem de usar o ponteiro vigente para montar a URL — nos DOIS
  // pontos que persistem o consolidado.
  assert.equal(
    /getPublicFileUrl\(token\s*,\s*signedPdfPath\)/.test(pagina),
    false,
    'a tela voltou a exibir o caminho que ela mesma escreveu, sem conferir o registro',
  );
});

test('selo PAdES sem metadados gravados não se declara assinado', () => {
  const fonte = readFileSync(
    new URL('../../supabase/functions/pades-sign/index.ts', import.meta.url),
    'utf8',
  );

  // Os updates viviam soltos, com o `error` ignorado, e a função devolvia
  // `status: assinado` mesmo se os três falhassem. Como o PDF já passa a trazer
  // `/ByteRange`, a tentativa seguinte respondia `ja_assinado` e ia embora: o
  // arquivo ficava selado com hash antigo no banco, para sempre.
  assert.ok(fonte.includes('async function carimbarMetadados('),
    'o carimbo dos metadados voltou a ser três updates soltos');
  assert.ok(fonte.includes("status: 'metadados_pendentes'"),
    'a selagem voltou a se declarar concluída com o registro do selo faltando');
  assert.ok(fonte.includes('if (falhasDoCarimbo.length > 0)'),
    'o erro dos updates voltou a ser ignorado');

  // E o ramo do PDF já selado tem de REPARAR, senão o estado ruim é definitivo.
  const jaAssinadoTrecho = fonte.slice(
    fonte.indexOf('if (jaAssinado(originais)) {'),
    fonte.indexOf('// ── Placeholder + assinatura ─'),
  );
  assert.ok(jaAssinadoTrecho.includes('carimbarMetadados('),
    'o ramo `ja_assinado` voltou a ser saída seca e não conserta metadados atrasados');
  assert.ok(jaAssinadoTrecho.includes('carimboExistente ?? new Date().toISOString()'),
    'o reparo passou a reescrever a data do selo, que é a de quando ele foi aplicado');
});

test('o worker confere o desempate DUAS vezes, e a segunda é depois do preparo', () => {
  const worker = readFileSync(
    new URL('../../supabase/functions/montar-envelope-assinado/index.ts', import.meta.url),
    'utf8',
  );

  // A primeira conferência acontece antes de congelar, converter e montar —
  // trabalho de dezenas de segundos. Sozinha, ela deixa a janela em que o
  // navegador termina no meio e os dois artefatos acabam registrados.
  const primeira = worker.indexOf("if (request0.signature_model !== 'per_document' && signer.signed_document_path)");
  const segunda = worker.indexOf('montado no navegador durante o preparo');
  const montagem = worker.indexOf("stage: 'montando documentos assinados'");

  assert.ok(primeira >= 0, 'o desempate inicial com o plano B sumiu do worker');
  assert.ok(segunda >= 0, 'o worker voltou a montar sem reconferir o ponteiro depois do preparo');
  assert.ok(primeira < segunda && segunda < montagem,
    'a reconferência saiu do lugar: ela tem de vir depois do preparo e ANTES da montagem');
});

test('as duas RPCs de anexar artefato exigem as mesmas provas', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260904233000_endurecer_anexo_do_artefato_assinado.sql', import.meta.url),
    'utf8',
  );

  // ── O CONSOLIDADO ────────────────────────────────────────────────────────
  //
  // `public_attach_signed_pdf` é `security definer`, executável por `anon`, e
  // recebia o caminho do arquivo do navegador SEM conferir nada além da trava
  // one-shot — que impede a segunda escrita, não a primeira. Com o token do
  // signatário (que não é revogado depois de assinar) dava para registrar como
  // artefato oficial o caminho de OUTRO envelope; e como o `public-signing-file`
  // soma o `signed_document_path` ao conjunto que o token pode ler, isso também
  // tornava o arquivo alheio legível.
  const consolidado = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.public_attach_signed_pdf'),
    sql.indexOf('CREATE OR REPLACE FUNCTION public.public_attach_signed_document'),
  );
  assert.ok(consolidado.length > 0, 'a RPC do consolidado saiu da migration');
  assert.ok(consolidado.includes("p_path NOT LIKE (v_request_id::text || '/%')"),
    'o consolidado voltou a aceitar caminho fora da pasta da solicitação');
  assert.ok(consolidado.includes('v_deleted_at IS NOT NULL')
    && consolidado.includes("v_request_status IN ('cancelled', 'canceled', 'expired', 'refused', 'rejected')"),
    'o consolidado voltou a aceitar artefato em envelope cancelado, bloqueado ou na lixeira');
  assert.ok(consolidado.includes("o.bucket_id = 'assinados' AND o.name = p_path"),
    'o consolidado voltou a registrar caminho sem conferir se o arquivo existe');
  assert.ok(consolidado.includes('coalesce(v_hash_congelado, p_integrity_sha256, integrity_sha256)'),
    'o consolidado voltou a preferir o hash do original mandado pelo navegador');
  assert.ok(consolidado.includes('signed_document_path IS NULL'),
    'a trava one-shot do consolidado sumiu');

  // ── O PER_DOCUMENT: a chave tem de existir no envelope ───────────────────
  //
  // Aceitava qualquer string não vazia. Cada chave inventada virava linha com o
  // código de verificação escolhido por quem chamou E entrava na conta que
  // decide a finalização automática — dava para fechar o envelope com o
  // documento de verdade ainda faltando.
  const perDoc = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.public_attach_signed_document'));
  assert.ok(perDoc.includes("p_document_key !~ '^attachment-[0-9]+$'"),
    'a chave do documento voltou a aceitar qualquer string');
  assert.ok(perDoc.includes('v_indice >= coalesce(v_attachment_count, 0)'),
    'a chave voltou a aceitar anexo que não existe no envelope');
  assert.ok(perDoc.includes("o.bucket_id = 'assinados' AND o.name = p_signed_path"),
    'o per_document voltou a registrar caminho sem conferir se o arquivo existe');

  // E a contagem da finalização não pode voltar a somar chave inválida — há
  // envelopes que podem ter recebido uma antes desta migration.
  const contagem = perDoc.slice(perDoc.indexOf('INTO v_persisted_documents'));
  assert.ok(contagem.includes("d.document_key = 'main'")
    && contagem.includes("d.document_key ~ '^attachment-[0-9]+$'"),
    'a finalização voltou a contar documento de chave inventada');
});

test('o reparo do PAdES olha todos os lados e garante a trilha', () => {
  const fonte = readFileSync(
    new URL('../../supabase/functions/pades-sign/index.ts', import.meta.url),
    'utf8',
  );

  // O reparo olhava SÓ a linha do documento. Se o update dela tivesse dado
  // certo e o do signatário não, a segunda chamada via a linha certa, concluía
  // "em dia" e ia embora — o signatário ficava para sempre com o hash de antes
  // do selo e `pades_signed_at` nulo.
  assert.ok(fonte.includes('async function conferirMetadados('),
    'a conferência voltou a ser feita num lado só');
  const conferir = fonte.slice(
    fonte.indexOf('async function conferirMetadados('),
    fonte.indexOf('async function garantirTrilhaPades('),
  );
  assert.ok(conferir.includes("registrar(data, 'signature_request_documents')"),
    'a conferência parou de olhar a linha do documento');
  assert.ok(conferir.includes("'signature_signers (por caminho)'"),
    'a conferência parou de olhar o ponteiro do signatário casado pelo caminho');
  assert.ok(conferir.includes("'signature_signers (por id)'"),
    'a conferência parou de olhar o signatário casado pelo id');

  // A trilha do selo era `console.error` + HTTP 200. O finalizador contava a
  // selagem como concluída e a chamada seguinte caía em `ja_assinado` sem
  // tentar de novo: o evento ficava ausente para sempre.
  assert.ok(fonte.includes('async function garantirTrilhaPades('),
    'a trilha do selo voltou a ser um insert solto');
  assert.equal(fonte.includes('erroAuditoria'), false,
    'o erro da trilha voltou a ser engolido num aviso de console');
  assert.equal((fonte.match(/garantirTrilhaPades\(supabase/g) ?? []).length, 2,
    'a trilha deixou de ser garantida nos DOIS caminhos (selagem nova e reparo)');
  // Duplicata é conferida pelo SHA do arquivo: um envelope per_document tem um
  // evento por documento, e todos são legítimos.
  assert.ok(/ilike\('description', `%\$\{sha\}%`\)/.test(fonte),
    'a conferência de duplicata da trilha deixou de ser pelo SHA do arquivo selado');
});

test('prazo ligado sem data não cria envelope', () => {
  const modulo = readFileSync(
    new URL('../components/SignatureModule.tsx', import.meta.url),
    'utf8',
  );

  // O interruptor podia ficar ligado com a data vazia: os botões seguiam
  // habilitados, `fimDoDiaNoEscritorio('')` devolvia null e o envelope nascia
  // SEM prazo — com a tela dizendo que estava bloqueado.
  assert.ok(modulo.includes('const prazoIncompleto = settings.blockAfterDeadline'),
    'a conferência do prazo sumiu do assistente');
  assert.ok(modulo.includes('fimDoDiaNoEscritorio(settings.expiresAt) === null'),
    'a conferência voltou a ser por string vazia e deixa passar data impossível');

  // Os DOIS botões — "Criar sem enviar" e "Criar e enviar".
  assert.equal(
    (modulo.match(/disabled=\{wizardLoading \|\| prazoIncompleto\}/g) ?? []).length,
    2,
    'um dos botões de criar voltou a aceitar envelope com prazo prometido e não definido',
  );
});
