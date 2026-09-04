import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * DOCUMENTO ASSINADO NASCE UMA VEZ.
 *
 * Depois de produzido, ele é lido — nunca refeito. Este arquivo não testa uma
 * função: vigia o código do módulo de assinaturas, porque a regra que ele
 * protege é fácil de reabrir sem querer e o estrago só aparece num documento
 * jurídico já assinado.
 *
 * O DEFEITO QUE ISTO IMPEDE DE VOLTAR. Ao baixar (ou abrir) um envelope, o
 * código lia `signed_document_path`, pedia a URL do arquivo e, se a URL não
 * viesse, CAÍA no bloco de geração logo abaixo. Um clique que só pedia para
 * baixar montava um segundo "documento assinado" — com bytes diferentes dos que
 * foram assinados — e ainda regravava `signed_pdf_sha256` com um hash calculado
 * naquele navegador, por cima da impressão digital do documento verdadeiro.
 *
 * A INVARIANTE: em todo lugar que lê o ponteiro do artefato, o caminho tem de
 * TERMINAR ali — com `return` ou com erro — antes de qualquer geração. Sem
 * ponteiro, gerar é legítimo: é a primeira vez, e gravar o ponteiro é o que faz
 * o clique seguinte parar.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */

const MARCA = 'if (signedSigner.signed_document_path) {';
const GERACAO = 'saveSignedPdfToStorage';

const fonteDoModulo = (): string =>
  readFileSync(new URL('../components/SignatureModule.tsx', import.meta.url), 'utf8');

/** Onde o módulo lê o ponteiro do artefato assinado. */
function posicoesDaLeitura(fonte: string): number[] {
  const posicoes: number[] = [];
  let de = fonte.indexOf(MARCA);
  while (de >= 0) {
    posicoes.push(de);
    de = fonte.indexOf(MARCA, de + MARCA.length);
  }
  return posicoes;
}

test('os lugares que leem o artefato assinado são conhecidos', () => {
  // Baixar, abrir e montar o ZIP. Um quarto lugar faz este teste falhar por
  // contagem — de propósito: quem o escrever tem de decidir conscientemente o
  // que ele faz quando o arquivo não abre.
  assert.equal(
    posicoesDaLeitura(fonteDoModulo()).length,
    3,
    'mudou a quantidade de lugares que leem o PDF assinado já salvo',
  );
});

test('com ponteiro gravado, o caminho termina — nunca cai na geração', () => {
  const fonte = fonteDoModulo();

  for (const inicio of posicoesDaLeitura(fonte)) {
    const geracao = fonte.indexOf(GERACAO, inicio);
    const ramo = fonte.slice(inicio, geracao >= 0 ? geracao : fonte.length);

    assert.ok(ramo.includes('getSignedPdfUrl'), 'o ramo deixou de pedir a URL do artefato salvo');

    // O desfecho tem de estar COLADO no aviso (ou no erro). Procurar um
    // `return` solto no trecho não serve: qualquer `return` de um bloco
    // seguinte satisfaria a busca e o teste passaria com o defeito de volta —
    // foi o que aconteceu na primeira versão deste arquivo, verificado
    // injetando a regressão de propósito.
    const paraLogoDepoisDoAviso =
      /não foi encontrado no armazenamento[\s\S]{0,300}?\);\s*return;/.test(ramo);
    const falhaEmVozAlta =
      /getSignedPdfUrl[\s\S]{0,300}?throw new Error\(/.test(ramo);

    assert.ok(
      paraLogoDepoisDoAviso || falhaEmVozAlta,
      'um caminho com ponteiro gravado voltou a poder cair na geração de um novo documento assinado',
    );
  }
});

test('quando o arquivo registrado não abre, o usuário é avisado', () => {
  const fonte = fonteDoModulo();
  // Os dois caminhos de tela (baixar e abrir). O terceiro monta o ZIP e falha
  // com exceção, que a tela já mostra.
  const avisos = fonte.split('não foi encontrado no armazenamento').length - 1;
  assert.ok(
    avisos >= 2,
    'sumiu o aviso de que o artefato está registrado mas ausente (e nada foi gerado no lugar)',
  );
});

test('a primeira geração continua possível, e anunciada', () => {
  const fonte = fonteDoModulo();
  // Sem ponteiro nunca houve artefato: produzir ali é a primeira vez, não uma
  // segunda via. Barrar também esse caso deixaria envelopes antigos sem saída.
  assert.ok(
    fonte.includes('gerando pela primeira vez'),
    'a geração legítima (primeira vez) deixou de ser anunciada ao usuário',
  );
  assert.ok(
    fonte.includes('updateSignerSignedDocumentMeta'),
    'a gravação do ponteiro sumiu — é ela que faz o clique seguinte não gerar de novo',
  );
});
