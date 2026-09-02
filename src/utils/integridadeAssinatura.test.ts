import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  conferirDocumento,
  identificadoresDoPdf,
  larguraDisponivelParaProtocolo,
  larguraEmCourier,
  mesmoHash,
  normalizarSha256,
  parecerDoDossie,
  selarPdfAssinado,
} from './integridadeAssinatura.ts';
import { afirmacaoDaConsulta, hashDoPdfAssinadoConsultado, hashDoOriginalConsultado, listarDocumentosDoEnvelope } from './assinaturaPublica.ts';

// Envelope real usado como referência: protocolo 70F1A4A0-…, três documentos,
// cada um com o seu código e o seu SHA-256 (conferidos byte a byte contra o
// Storage durante a auditoria).
const PROTOCOLO = '70F1A4A0-325C-432E-9D35-A5FDE77B7534';
const DOC_PRINCIPAL = {
  verification_code: 'A8162AF5EEAB20D8',
  signed_pdf_sha256: 'A7D95D948ABCAB3C216A275861A38499E5C46C11CFECF8EF5E0E82CF9896E7C2',
  // O hash de ORIGEM — é este que sai impresso no rodapé do PDF assinado.
  document_hash: '98B30EB2E3955A137CE6963039594C7985CE9284D3935AC0B3683C1F65887A72',
};
const ANEXO_0 = {
  verification_code: '05FBDC3C94D10F99',
  signed_pdf_sha256: '67874EAB782F534CC7EB0369EAEAEF396E584ADCDD75E02E65DDD65817571DA8',
  document_hash: '6C0D348B0F44006ECBC8837AED680883181B5137006D877D057B51E8E4103779',
};
const ANEXO_1 = {
  verification_code: '1AB93A6646AED3E3',
  signed_pdf_sha256: '224B39E37F8C2B333947A3B6D4D5EA9C3D6CE038D90A7C9B7C6A86FEACD21D97',
  document_hash: '57C280F4E59F94071E4969B99E786B439613FDCB16C650D06A5F8D23B91C948E',
};
const DOCUMENTOS = [DOC_PRINCIPAL, ANEXO_0, ANEXO_1];

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex').toUpperCase();

// ═══════════════════════════════════════════════════════════════════════════
// 1 e 2 — cada documento responde pelo SEU hash
// ═══════════════════════════════════════════════════════════════════════════

test('o código consultado seleciona o hash DAQUELE documento, não o do envelope', () => {
  // O bug que isto tranca: a tela usava sempre `signer.signed_pdf_sha256`, o
  // hash do signatário. Quem consultava o código de um ANEXO via a impressão
  // digital do documento principal e concluía, corretamente, que o sistema
  // estava mentindo sobre o arquivo que tinha em mãos.
  for (const doc of DOCUMENTOS) {
    assert.equal(
      hashDoPdfAssinadoConsultado(doc.verification_code, DOCUMENTOS, 'HASH-DO-SIGNATARIO'),
      doc.signed_pdf_sha256,
    );
  }
});

test('documento principal e anexos têm códigos E hashes independentes', () => {
  const codigos = DOCUMENTOS.map((d) => d.verification_code);
  const hashes = DOCUMENTOS.map((d) => d.signed_pdf_sha256);
  assert.equal(new Set(codigos).size, 3, 'os três códigos têm de ser distintos');
  assert.equal(new Set(hashes).size, 3, 'os três hashes têm de ser distintos');
  // E nenhum código de um documento pode devolver o hash de outro.
  assert.notEqual(
    hashDoPdfAssinadoConsultado(ANEXO_0.verification_code, DOCUMENTOS, null),
    DOC_PRINCIPAL.signed_pdf_sha256,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 e 4 — o que o PDF imprime
// ═══════════════════════════════════════════════════════════════════════════

test('o PDF imprime apenas o protocolo e o código do documento', () => {
  const linhas = identificadoresDoPdf({
    protocolo: PROTOCOLO,
    codigoDoDocumento: DOC_PRINCIPAL.verification_code,
  });
  assert.deepEqual(linhas, [
    { rotulo: 'CÓDIGO DE VERIFICAÇÃO', valor: 'A8162AF5EEAB20D8' },
    { rotulo: 'PROTOCOLO', valor: '70F1A4A0-325C-432E-9D35-A5FDE77B7534' },
  ]);
});

test('o PDF não imprime código de envelope, código de signatário nem SHA-256', () => {
  const linhas = identificadoresDoPdf({
    protocolo: PROTOCOLO,
    codigoDoDocumento: DOC_PRINCIPAL.verification_code,
  });
  const impresso = JSON.stringify(linhas).toUpperCase();

  // `envelope_verification_code` real deste envelope.
  assert.equal(impresso.includes('D321CE6A3EFFCE32'), false, 'código interno do envelope vazou para o PDF');
  // Um hash de signatário qualquer.
  assert.equal(impresso.includes('HASH-DO-SIGNATARIO'), false, 'código do signatário vazou para o PDF');
  // Esta função devolve os IDENTIFICADORES; o hash do documento original é
  // desenhado à parte, com rótulo próprio. O que não pode aparecer em lugar
  // nenhum é o hash do PDF assinado (dependência circular).
  assert.equal(impresso.includes(DOC_PRINCIPAL.signed_pdf_sha256), false, 'SHA-256 do PDF assinado impresso dentro dele mesmo');
});

test('todo SHA-256 impresso no PDF diz que é DO DOCUMENTO ORIGINAL', () => {
  // O rodapé imprimia `SHA-256:` sem dizer de quê. O valor era o do documento
  // de ORIGEM, mas quem baixava o arquivo assinado, calculava o hash dele e
  // comparava com o impresso achava dois números diferentes — e concluía, com
  // razão, que nada batia. Imprimir o hash é certo; imprimir sem o rótulo é
  // que era o erro.
  const fonte = readFileSync(new URL('../services/pdfSignature.service.ts', import.meta.url), 'utf8');
  const rotulos = fonte.split('\n')
    .filter((linha) => /drawText|drawTracked/.test(linha) && /SHA-?256/i.test(linha))
    .map((linha) => (linha.match(/'([^']*SHA-?256[^']*)'/i) || [])[1])
    .filter(Boolean) as string[];

  assert.ok(rotulos.length > 0, 'o hash do documento original sumiu do PDF');
  for (const rotulo of rotulos) {
    assert.match(rotulo, /ORIGINAL/i,
      `rótulo "${rotulo}" não diz de qual documento é o hash`);
  }
});

test('o SHA-256 do PDF ASSINADO nunca é impresso dentro do próprio PDF', () => {
  // Dependência circular: escrever o hash muda os bytes e produz outro hash.
  const fonte = readFileSync(new URL('../services/pdfSignature.service.ts', import.meta.url), 'utf8');

  // ESTE TESTE JÁ DISPAROU UMA VEZ, e é bom que tenha disparado. Em 02/09/2026
  // o bloco do certificado passou a desenhar o hash por um ajudante
  // (`linhaDoCertificado`) em vez de chamar `drawText` direto, para o valor
  // poder quebrar de linha e parar de invadir o QR. A invariante continuava
  // intacta; o que quebrou foi o DETECTOR, que procurava a forma da chamada.
  //
  // A lição virou o desenho de agora: em vez de contar linhas com um formato
  // específico, o teste checa a PROCEDÊNCIA do valor. Refatorar a forma do
  // desenho deixa de dar alarme falso; trocar a origem do número — que é o
  // defeito de verdade — continua sendo pego.
  assert.match(
    fonte, /const cbOriginal = String\(integritySha256/,
    'o hash do bloco do certificado deixou de vir de `integritySha256`',
  );
  assert.match(
    fonte, /const originalHash = String\(integritySha256/,
    'o hash do rodapé deixou de vir de `integritySha256`',
  );

  // A invariante de verdade: o sha do artefato FINAL nunca é desenhado.
  // Escrevê-lo mudaria os bytes e produziria outro hash.
  assert.equal(
    /drawText\(\s*sha256|drawText\(\s*signedSha|drawText\(\s*signed_pdf_sha256/.test(fonte), false,
    'passou a imprimir o hash do PDF assinado dentro dele mesmo',
  );
  // E nenhum valor desenhado pode sair de `signed_pdf_sha256`, seja qual for o
  // caminho — direto, por ajudante ou por variável intermediária.
  const suspeitas = fonte.split('\n').filter(
    (l) => /drawText\(|linhaDoCertificado\(/.test(l) && /signed_pdf_sha256/.test(l),
  );
  assert.equal(suspeitas.length, 0, `hash do assinado chegou ao desenho: ${suspeitas.join(' | ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 e 6 — a ordem do hash e os bytes que sobem
// ═══════════════════════════════════════════════════════════════════════════

test('o SHA-256 é calculado DEPOIS do PDF finalizado, e só então o arquivo sobe', async () => {
  const ordem: string[] = [];
  const bytesFinais = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

  const { sha256: hash } = await selarPdfAssinado({
    bytesFinais,
    calcularSha256: async (b) => { ordem.push('hash'); return sha256(b); },
    enviarAoStorage: async () => { ordem.push('upload'); },
  });

  // Hashear depois de subir abriria uma janela em que o arquivo entregue e o
  // hash registrado descrevem coisas diferentes.
  assert.deepEqual(ordem, ['hash', 'upload']);
  assert.equal(hash, sha256(bytesFinais));
});

test('os bytes enviados ao Storage são exatamente os que produziram o hash', async () => {
  const bytesFinais = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  let enviados: Uint8Array | null = null;

  const { sha256: hash } = await selarPdfAssinado({
    bytesFinais,
    calcularSha256: async (b) => sha256(b),
    enviarAoStorage: async (b) => { enviados = b; },
  });

  assert.ok(enviados, 'nada foi enviado');
  // Mesma referência: não uma cópia, não uma re-serialização.
  assert.equal(enviados, bytesFinais);
  assert.equal(sha256(enviados as unknown as Uint8Array), hash);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7, 8, 9 e 10 — o parecer
// ═══════════════════════════════════════════════════════════════════════════

test('dossiê ÍNTEGRO quando a cadeia fecha e todos os hashes coincidem', () => {
  const status = DOCUMENTOS.map((d) => conferirDocumento({
    hashRegistrado: d.signed_pdf_sha256,
    hashAtual: d.signed_pdf_sha256,
  }));
  assert.deepEqual(status, ['valid', 'valid', 'valid']);
  assert.equal(parecerDoDossie({
    cadeiaVerificada: true,
    statusDosDocumentos: status,
    documentosEsperados: 3,
  }), 'ÍNTEGRO');
});

test('a diferença de UM byte no arquivo produz NÃO ÍNTEGRO', () => {
  const original = new Uint8Array([10, 20, 30, 40, 50]);
  const adulterado = new Uint8Array([10, 20, 31, 40, 50]); // um único byte
  const hashRegistrado = sha256(original);
  const hashAtual = sha256(adulterado);

  assert.notEqual(hashRegistrado, hashAtual);
  assert.equal(conferirDocumento({ hashRegistrado, hashAtual }), 'mismatch');
  assert.equal(parecerDoDossie({
    cadeiaVerificada: true,
    statusDosDocumentos: ['valid', 'mismatch', 'valid'],
    documentosEsperados: 3,
  }), 'NÃO ÍNTEGRO');
});

test('arquivo indisponível produz INCONCLUSIVO — nunca ÍNTEGRO', () => {
  // A regra que sustenta o laudo: "não foi possível verificar" não é "íntegro".
  assert.equal(conferirDocumento({
    hashRegistrado: DOC_PRINCIPAL.signed_pdf_sha256,
    hashAtual: null,
    arquivoBaixado: false,
  }), 'unavailable');

  assert.equal(parecerDoDossie({
    cadeiaVerificada: true,
    statusDosDocumentos: ['valid', 'unavailable', 'valid'],
    documentosEsperados: 3,
  }), 'INCONCLUSIVO');

  // Hash registrado ausente também não autoriza afirmar integridade.
  assert.equal(conferirDocumento({ hashRegistrado: null, hashAtual: 'ABC' }), 'unavailable');
});

test('ruptura na cadeia de auditoria produz NÃO ÍNTEGRO mesmo com hashes perfeitos', () => {
  assert.equal(parecerDoDossie({
    cadeiaVerificada: false,
    statusDosDocumentos: ['valid', 'valid', 'valid'],
    documentosEsperados: 3,
  }), 'NÃO ÍNTEGRO');
});

test('cadeia não apurada é INCONCLUSIVO, não NÃO ÍNTEGRO nem ÍNTEGRO', () => {
  assert.equal(parecerDoDossie({
    cadeiaVerificada: null,
    statusDosDocumentos: ['valid'],
    documentosEsperados: 1,
  }), 'INCONCLUSIVO');
});

test('envelope sem documento nenhum jamais é ÍNTEGRO', () => {
  // Antes, zero documentos passava por "nenhuma divergência encontrada" e o
  // laudo saía verde sem ter conferido arquivo algum.
  assert.equal(parecerDoDossie({
    cadeiaVerificada: true,
    statusDosDocumentos: [],
  }), 'INCONCLUSIVO');
});

test('faltando um documento esperado, o parecer não fecha em ÍNTEGRO', () => {
  assert.equal(parecerDoDossie({
    cadeiaVerificada: true,
    statusDosDocumentos: ['valid', 'valid'],
    documentosEsperados: 3,
  }), 'INCONCLUSIVO');
});

test('conferência em andamento diz CONFERINDO, mas divergência já provada vence', () => {
  assert.equal(parecerDoDossie({
    cadeiaVerificada: true,
    statusDosDocumentos: ['valid', 'checking'],
    documentosEsperados: 2,
  }), 'CONFERINDO');
  // Uma divergência já provada não pode ficar escondida atrás do "conferindo"
  // de outro documento.
  assert.equal(parecerDoDossie({
    cadeiaVerificada: true,
    statusDosDocumentos: ['mismatch', 'checking'],
    documentosEsperados: 2,
  }), 'NÃO ÍNTEGRO');
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 — registro legado
// ═══════════════════════════════════════════════════════════════════════════

test('registro legado continua consultável sem expor o código interno', () => {
  // Envelope antigo: sem lista de documentos, só o hash do signatário. A
  // consulta tem de continuar respondendo (links antigos não podem quebrar)…
  assert.equal(
    hashDoPdfAssinadoConsultado('CODIGO-LEGADO', undefined, 'HASH-LEGADO-DO-SIGNATARIO'),
    'HASH-LEGADO-DO-SIGNATARIO',
  );
  // …mas o PDF novo não passa a imprimir o código interno por causa disso.
  const linhas = identificadoresDoPdf({ protocolo: PROTOCOLO, codigoDoDocumento: '' });
  assert.deepEqual(linhas, [{ rotulo: 'PROTOCOLO', valor: PROTOCOLO }]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 — o UUID cabe inteiro no rodapé
// ═══════════════════════════════════════════════════════════════════════════

test('o protocolo UUID completo cabe no rodapé sem corte nem sobreposição', () => {
  const larguraDoProtocolo = larguraEmCourier(PROTOCOLO, 8.5);
  assert.equal(PROTOCOLO.length, 36);

  for (const [nome, largura] of [['A4', 595.28], ['Letter', 612], ['Legal', 612]] as const) {
    const disponivel = larguraDisponivelParaProtocolo({ larguraDaPagina: largura });
    assert.ok(
      disponivel >= larguraDoProtocolo,
      `${nome}: sobra ${disponivel.toFixed(1)}pt para um protocolo de ${larguraDoProtocolo.toFixed(1)}pt — o UUID sairia cortado`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// A armadilha da caixa das letras, e o espelho no Deno
// ═══════════════════════════════════════════════════════════════════════════

test('MAIÚSCULA e minúscula do mesmo hash são o mesmo hash', () => {
  // O cliente grava em maiúsculas; a Edge Function calcula em minúsculas.
  // Comparar cru com !== acusaria adulteração em 100% dos envelopes.
  const registrado = DOC_PRINCIPAL.signed_pdf_sha256;             // MAIÚSCULO
  const recalculado = DOC_PRINCIPAL.signed_pdf_sha256.toLowerCase(); // minúsculo
  assert.notEqual(registrado, recalculado, 'as duas formas são textos diferentes');
  assert.ok(mesmoHash(registrado, recalculado), 'e mesmo assim são o MESMO hash');
  assert.equal(conferirDocumento({ hashRegistrado: registrado, hashAtual: recalculado }), 'valid');
});

test('hash vazio nunca "confere"', () => {
  assert.equal(mesmoHash('', ''), false);
  assert.equal(mesmoHash(null, undefined), false);
  assert.equal(normalizarSha256('  ABC  '), 'abc');
});

test('a Edge Function de finalização nunca sobrescreve hash divergente', () => {
  // A cópia da regra que vive no Deno (que não importa de `src/`). Este teste
  // vigia o comportamento no arquivo real, porque o bug original era
  // exatamente um UPDATE incondicional.
  const fonte = readFileSync(
    new URL('../../supabase/functions/finalize-signature-envelope/index.ts', import.meta.url),
    'utf8',
  );
  // Compara pela regra normalizada, não com `!==` cru.
  assert.ok(fonte.includes('mesmoHash(registrado, serverHash)'), 'a comparação normalizada sumiu');
  // Divergência bloqueia a finalização e registra a violação.
  assert.ok(fonte.includes("'integrity_violation'"), 'a violação de integridade deixou de ser registrada');
  assert.ok(/throw new Error\(`Violação de integridade no documento/.test(fonte), 'a finalização não é mais bloqueada');
  // E o UPDATE que reescreve o hash só existe no ramo em que NÃO havia hash.
  const trechoComRegistro = fonte.slice(
    fonte.indexOf('if (registrado) {'),
    fonte.indexOf('} else {', fonte.indexOf('if (registrado) {')),
  );
  assert.equal(
    trechoComRegistro.includes('signed_pdf_sha256: serverHash'),
    false,
    'voltou a sobrescrever o hash já registrado',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// A lista do envelope responde ao que foi PERGUNTADO
// ═══════════════════════════════════════════════════════════════════════════

test('código de um documento mostra SÓ aquele documento, não o kit inteiro', () => {
  // A RPC devolve `documents` em todas as ramificações, inclusive na consulta
  // por código individual. Quem digitou o código do anexo perguntou pelo anexo:
  // listar os irmãos põe o hash errado ao lado do arquivo certo, e revela
  // quantos outros arquivos existem a quem só conhece um código.
  assert.equal(listarDocumentosDoEnvelope({
    tipo: 'documento',
    codigoConsultado: ANEXO_0.verification_code,
    quantidadeDeDocumentos: 3,
  }), false);
});

test('protocolo do envelope mostra todos os documentos do envelope', () => {
  assert.equal(listarDocumentosDoEnvelope({
    tipo: 'envelope',
    codigoConsultado: PROTOCOLO,
    quantidadeDeDocumentos: 3,
  }), true);
});

test('código legado de signatário também não abre o kit inteiro', () => {
  assert.equal(listarDocumentosDoEnvelope({
    tipo: 'signatario',
    codigoConsultado: 'ACE10CD02D5B7AB7',
    quantidadeDeDocumentos: 3,
  }), false);
});

test('validação por arquivo (sem código digitado) mantém a lista', () => {
  assert.equal(listarDocumentosDoEnvelope({
    tipo: 'desconhecido',
    codigoConsultado: '',
    quantidadeDeDocumentos: 3,
  }), true);
});

test('sem documentos não há lista, seja qual for o código', () => {
  for (const tipo of ['envelope', 'documento', 'signatario', 'desconhecido'] as const) {
    assert.equal(listarDocumentosDoEnvelope({
      tipo, codigoConsultado: PROTOCOLO, quantidadeDeDocumentos: 0,
    }), false);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// OS DOIS HASHES — original (impresso) e assinado (baixado)
// ═══════════════════════════════════════════════════════════════════════════

test('a consulta devolve o hash do ORIGINAL e o do ASSINADO, e eles são distintos', () => {
  // O valor impresso no PDF real do envelope 70F1A4A0 é o do ORIGINAL:
  // 98B30EB2… — conferido extraindo o texto do PDF baixado do Storage.
  const original = hashDoOriginalConsultado(DOC_PRINCIPAL.verification_code, DOCUMENTOS, null);
  const assinado = hashDoPdfAssinadoConsultado(DOC_PRINCIPAL.verification_code, DOCUMENTOS, null);

  assert.equal(original, DOC_PRINCIPAL.document_hash);
  assert.equal(assinado, DOC_PRINCIPAL.signed_pdf_sha256);
  // Que sejam diferentes não é defeito: são objetos diferentes. É exatamente
  // por isso que a tela precisa mostrar os dois, cada um com o seu rótulo.
  assert.notEqual(original, assinado);
});

test('cada documento tem o SEU hash de origem, não o do principal', () => {
  for (const doc of DOCUMENTOS) {
    assert.equal(
      hashDoOriginalConsultado(doc.verification_code, DOCUMENTOS, null),
      doc.document_hash,
    );
  }
  assert.equal(new Set(DOCUMENTOS.map((d) => d.document_hash)).size, 3);
});

test('registro legado cai no hash de origem do signatário', () => {
  assert.equal(
    hashDoOriginalConsultado('CODIGO-LEGADO', undefined, 'ORIGEM-LEGADA'),
    'ORIGEM-LEGADA',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// A tela só afirma o que conferiu
// ═══════════════════════════════════════════════════════════════════════════

test('consulta por código NÃO afirma que nada foi alterado', () => {
  // Consultar um código ENCONTRA um registro; não compara arquivo nenhum.
  // Afirmar integridade ali é a frase que um perito da parte contrária
  // derruba com uma pergunta: "com o que vocês compararam?".
  const { titulo, destaque, explicacao } = afirmacaoDaConsulta(false);
  const frase = `${titulo} ${destaque}. ${explicacao}`;

  assert.equal(/nada foi alterado/i.test(frase), false, 'voltou a afirmar integridade não verificada');
  assert.equal(/byte a byte/i.test(frase), false);
  // E diz como obter a prova de verdade.
  assert.match(explicacao, /compare o SHA-256|envie o arquivo/i);
});

test('validação por arquivo PODE afirmar que confere — ali houve comparação', () => {
  const { explicacao } = afirmacaoDaConsulta(true);
  assert.match(explicacao, /byte a byte/i);
});
