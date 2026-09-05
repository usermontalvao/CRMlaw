import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  atributoDoNome,
  blocosDeAssinaturaDoPdf,
  certificadoDoPdf,
  certificadosDoPkcs7,
  derDoPem,
  filhosDer,
  lerNoDer,
  impressaoDigitalDe,
  impressoesIguais,
  lerCertificado,
  montarConfronto,
} from './certificadoDoSelo.ts';
import { SELO_IMPRESSAO_DIGITAL } from '../constants/selo.ts';

/** O certificado que o servidor publica — o mesmo arquivo que a página baixa. */
const PEM_PUBLICADO = readFileSync(new URL('../../public/selo-de-integridade.crt', import.meta.url), 'utf8');
const DER_PUBLICADO = derDoPem(PEM_PUBLICADO);

// ── Um DER mínimo, para montar o PKCS#7 de mentira ─────────────────────────
// Escrito aqui, e não no módulo: o módulo só LÊ certificados. Precisar de um
// codificador para testá-lo seria sinal de que ele faz demais.

const der = (tag: number, conteudo: Uint8Array): Uint8Array => {
  const comprimento: number[] = [];
  if (conteudo.length < 0x80) {
    comprimento.push(conteudo.length);
  } else {
    const octetos: number[] = [];
    let n = conteudo.length;
    while (n > 0) { octetos.unshift(n & 0xff); n = Math.floor(n / 256); }
    comprimento.push(0x80 + octetos.length, ...octetos);
  }
  const saida = new Uint8Array(1 + comprimento.length + conteudo.length);
  saida[0] = tag;
  saida.set(comprimento, 1);
  saida.set(conteudo, 1 + comprimento.length);
  return saida;
};

const juntar = (...partes: Uint8Array[]): Uint8Array => {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let p = 0;
  for (const parte of partes) { saida.set(parte, p); p += parte.length; }
  return saida;
};

const OID_SIGNED_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
const OID_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);

/** O número de série do certificado, em bytes — para o SignerInfo apontar. */
const serieEmBytes = (certificado: Uint8Array): Uint8Array => {
  const texto = lerCertificado(certificado).serie;
  return new Uint8Array(texto.split(':').map((h) => parseInt(h, 16)));
};

/**
 * Um CMS SignedData com os certificados dados e um SignerInfo que aponta para
 * o número de série de `assinante`. É a estrutura que um PDF assinado carrega.
 */
const pkcs7Com = (certificados: Uint8Array[], assinante = certificados[0]): Uint8Array => {
  const signerInfo = der(0x30, juntar(
    der(0x02, new Uint8Array([1])),
    der(0x30, juntar(der(0x30, new Uint8Array(0)), der(0x02, serieEmBytes(assinante)))),
    der(0x30, new Uint8Array(0)),
  ));
  const signedData = der(0x30, juntar(
    der(0x02, new Uint8Array([1])),
    der(0x31, new Uint8Array(0)),
    der(0x30, der(0x06, OID_DATA)),
    der(0xa0, juntar(...certificados)),
    der(0x31, signerInfo),
  ));
  return der(0x30, juntar(der(0x06, OID_SIGNED_DATA), der(0xa0, signedData)));
};

const hexa = (bytes: Uint8Array): string =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');

const texto = (s: string): Uint8Array => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));

/** Um PDF de mentira com um campo de assinatura de verdade lá dentro. */
const pdfCom = (pkcs7: Uint8Array, enchimento = 512): Uint8Array => juntar(
  texto('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
  texto('7 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 1000 2000 3000] /Contents <'),
  texto(hexa(pkcs7)),
  texto('0'.repeat(enchimento)),
  texto('>>>\nendobj\n%%EOF\n'),
);

/**
 * O mesmo certificado com o CN trocado — o cenário do selo substituído.
 *
 * A troca é feita nas DUAS ocorrências do nome (emissor e titular, que num
 * autoassinado são o mesmo DN) e com uma letra de mesmo comprimento, para não
 * mexer nos comprimentos DER. O número de série também muda, senão os dois
 * certificados seriam indistinguíveis para o SignerInfo. A assinatura interna
 * passa a não fechar, e isso não atrapalha: este módulo lê campos, não valida
 * cadeia.
 */
const CERTIFICADO_TROCADO = (() => {
  const copia = DER_PUBLICADO.slice();
  const agulha = texto('Jurius - Selo de Integridade');
  let trocas = 0;
  for (let i = 0; i < copia.length - agulha.length; i += 1) {
    let casou = true;
    for (let k = 0; k < agulha.length; k += 1) {
      if (copia[i + k] !== agulha[k]) { casou = false; break; }
    }
    if (casou) { copia[i + 1] = 'X'.charCodeAt(0); trocas += 1; }
  }
  if (trocas < 2) throw new Error('o CN esperado não foi achado nos dois lugares do certificado');
  const tbs = filhosDer(copia, lerNoDer(copia, 0))[0];
  const campos = filhosDer(copia, tbs);
  const serie = campos[0].classe === 2 ? campos[1] : campos[0];
  copia[serie.fim - 1] ^= 0xff;
  return copia;
})();

// ── O certificado publicado ────────────────────────────────────────────────

test('o nome do selo é TRANSCRITO do certificado, com o "(autoassinado)" e tudo', () => {
  // A página escrevia "Jurius — Selo de Integridade" à mão. O CN de verdade
  // traz o "(autoassinado)" — que é justamente o que um cartório precisa ver,
  // e o que a versão escrita à mão omitia.
  const cert = lerCertificado(DER_PUBLICADO);
  assert.equal(cert.nome, 'Jurius - Selo de Integridade (autoassinado)');
  assert.equal(atributoDoNome(cert.titular, 'O'), 'Jurius');
  assert.equal(atributoDoNome(cert.titular, 'OU'), 'Validador Publico');
  assert.equal(atributoDoNome(cert.titular, 'L'), 'Cuiaba');
  assert.equal(atributoDoNome(cert.titular, 'ST'), 'Mato Grosso');
  assert.equal(atributoDoNome(cert.titular, 'C'), 'BR');
});

test('titular igual a emissor é o que define autoassinado — ninguém digita isso', () => {
  const cert = lerCertificado(DER_PUBLICADO);
  assert.equal(cert.autoassinado, true);
  assert.equal(cert.emissor.texto, cert.titular.texto);
});

test('a validade sai do campo, nos dois extremos', () => {
  const cert = lerCertificado(DER_PUBLICADO);
  assert.equal(cert.validoDe, '2026-09-02T16:00:54.000Z');
  assert.equal(cert.validoAte, '2036-08-30T16:00:54.000Z');
});

test('a impressão digital calculada bate com a constante publicada', async () => {
  // ESTE é o teste que impede a divergência que `constants/selo.ts` teme: se
  // o .crt for trocado sem trocar a constante (ou o contrário), a página
  // passaria a afirmar um certificado e a entregar outro. Aqui isso não passa.
  assert.equal(await impressaoDigitalDe(DER_PUBLICADO), SELO_IMPRESSAO_DIGITAL);
});

// ── O certificado que viaja dentro do PDF ──────────────────────────────────

test('o certificado é extraído do PKCS#7 do /Contents', () => {
  const pdf = pdfCom(pkcs7Com([DER_PUBLICADO]));
  const achado = certificadoDoPdf(pdf);
  assert.ok(achado, 'o certificado tinha de ser achado');
  assert.equal(hexa(achado), hexa(DER_PUBLICADO));
});

test('o enchimento de zeros do placeholder não estraga a leitura', () => {
  // O /Contents é reservado com tamanho fixo e sobra zero no fim. Se o parser
  // engasgasse com isso, nenhum PDF real seria lido — todos têm enchimento.
  const pdf = pdfCom(pkcs7Com([DER_PUBLICADO]), 4096);
  assert.ok(certificadoDoPdf(pdf));
});

test('havendo vários certificados, vale o que o SignerInfo aponta', () => {
  // A cadeia pode viajar inteira dentro do PKCS#7. Pegar "o primeiro" mostraria
  // a raiz onde deveria estar a folha, e o confronto acusaria divergência num
  // arquivo perfeitamente íntegro.
  const cms = pkcs7Com([CERTIFICADO_TROCADO, DER_PUBLICADO], DER_PUBLICADO);
  const achado = certificadoDoPdf(pdfCom(cms));
  assert.ok(achado);
  assert.equal(lerCertificado(achado).nome, 'Jurius - Selo de Integridade (autoassinado)');
});

test('valendo a ÚLTIMA assinatura quando o PDF foi selado mais de uma vez', () => {
  const pdf = juntar(
    pdfCom(pkcs7Com([CERTIFICADO_TROCADO])),
    pdfCom(pkcs7Com([DER_PUBLICADO])),
  );
  const achado = certificadoDoPdf(pdf);
  assert.ok(achado);
  assert.equal(hexa(achado), hexa(DER_PUBLICADO));
});

test('PDF sem assinatura não inventa certificado', () => {
  assert.equal(certificadoDoPdf(texto('%PDF-1.7\nnada aqui\n%%EOF')), null);
  assert.deepEqual(blocosDeAssinaturaDoPdf(texto('%PDF /Contents nada')), []);
});

test('lixo no lugar do PKCS#7 devolve lista vazia, não exceção', () => {
  assert.deepEqual(certificadosDoPkcs7(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01])), []);
});

// ── O confronto ────────────────────────────────────────────────────────────

test('mesmo certificado nos dois lados: confere', async () => {
  const confronto = await montarConfronto(PEM_PUBLICADO, pdfCom(pkcs7Com([DER_PUBLICADO])));
  assert.equal(confronto.veredicto, 'confere');
  assert.equal(confronto.servidor?.impressao, SELO_IMPRESSAO_DIGITAL);
  assert.equal(confronto.documento?.impressao, SELO_IMPRESSAO_DIGITAL);
  assert.equal(confronto.documento?.nome, 'Jurius - Selo de Integridade (autoassinado)');
});

test('certificado trocado no documento: DIVERGE, e a página tem de poder dizer isso', async () => {
  // O caso que a página existe para pegar. Se este teste virar "confere",
  // a conferência inteira vira enfeite.
  const confronto = await montarConfronto(PEM_PUBLICADO, pdfCom(pkcs7Com([CERTIFICADO_TROCADO])));
  assert.equal(confronto.veredicto, 'diverge');
  assert.notEqual(confronto.documento?.impressao, confronto.servidor?.impressao);
  assert.equal(confronto.documento?.nome, 'JXrius - Selo de Integridade (autoassinado)');
});

test('sem os bytes do PDF, o confronto não finge que houve confronto', async () => {
  // Consulta por código, ou CORS barrando o download: há um lado só. Dizer
  // "confere" aí seria a mentira mais fácil de contar nesta tela.
  const confronto = await montarConfronto(PEM_PUBLICADO, null);
  assert.equal(confronto.veredicto, 'so-servidor');
  assert.equal(confronto.documento, null);
  assert.ok(confronto.servidor);
});

test('sem nenhum dos lados, indisponível', async () => {
  const confronto = await montarConfronto(null, null);
  assert.equal(confronto.veredicto, 'indisponivel');
});

test('PEM ilegível não derruba a página', async () => {
  const confronto = await montarConfronto('isto não é um PEM', pdfCom(pkcs7Com([DER_PUBLICADO])));
  assert.equal(confronto.servidor, null);
  assert.equal(confronto.veredicto, 'indisponivel');
});

test('impressões se comparam sem dois-pontos e sem caixa', () => {
  assert.equal(impressoesIguais(SELO_IMPRESSAO_DIGITAL, SELO_IMPRESSAO_DIGITAL.replace(/:/g, '').toLowerCase()), true);
  assert.equal(impressoesIguais(SELO_IMPRESSAO_DIGITAL, `${SELO_IMPRESSAO_DIGITAL.slice(0, -1)}1`), false);
  // Vazio contra vazio não é igualdade: seria "confere" sem ter conferido nada.
  assert.equal(impressoesIguais('', ''), false);
  assert.equal(impressoesIguais('82:96', '82:96'), false);
});
