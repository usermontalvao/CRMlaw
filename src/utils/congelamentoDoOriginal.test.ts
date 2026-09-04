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

test('hash divergente do congelado nunca é sobrescrito', () => {
  const fonte = fonteDaEdge();
  assert.ok(fonte.includes("'integrity_violation'"), 'a violação deixou de ser registrada');
  const trechoDivergente = fonte.slice(
    fonte.indexOf('if (anterior?.sha256 && anterior.file_path === alvo.path'),
    fonte.indexOf("if (anterior?.sha256 && normalizarSha256(anterior.sha256) === normalizarSha256(sha))"),
  );
  assert.ok(trechoDivergente.length > 0, 'o ramo da divergência sumiu');
  assert.equal(
    trechoDivergente.includes('upsert('),
    false,
    'a divergência voltou a gravar por cima do hash registrado',
  );
});
