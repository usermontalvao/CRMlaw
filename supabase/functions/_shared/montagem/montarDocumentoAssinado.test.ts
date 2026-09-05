/**
 * A montagem inteira, com pdf-lib DE VERDADE.
 *
 * O `node_modules` tem pdf-lib 1.17.1 — a MESMA versão que a Edge Function usa
 * via `npm:pdf-lib@1.17.1`. Então o que este teste exercita é o motor de
 * produção, e não uma imitação: página que cresce, rubrica que cai na folha
 * marcada, laudo que pagina.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LineCapStyle, PDFDocument, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

import {
  montarDocumentoAssinado,
  taparFaixaRevelada,
  type CampoDeAssinatura,
} from './montarDocumentoAssinado.ts';
import { ALTURA_DA_FAIXA_DO_RODAPE } from './geometria.ts';
import { paletaDoLaudo } from './laudoDesign.ts';
import { WORDMARK_RATIO, wordmarkPngBytes } from './wordmark.ts';
import { montarTrilhaDeEventos, type LinhaDeSignatario } from './trilhaDeEventos.ts';
import type { SignatarioNoLaudo } from './laudo.ts';

const A4: [number, number] = [595.28, 841.89];

/** Um PNG 1×1 opaco — o bastante para o pdf-lib embutir uma "rubrica". */
const PNG_1PX = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
), (c) => c.charCodeAt(0));

const linhaBase = (extra: Partial<LinhaDeSignatario> = {}): LinhaDeSignatario => ({
  id: 'signer-1',
  name: 'Pedro Rodrigues Montalvão Neto',
  cpf: '045.448.031-93',
  signer_ip: '200.1.2.3',
  auth_provider: 'phone',
  phone: '65984046375',
  viewed_at: '2026-09-02T23:31:00.000Z',
  terms_accepted_at: '2026-09-02T23:33:50.000Z',
  terms_version: 'v1',
  signed_at: '2026-09-02T23:34:00.000Z',
  ...extra,
});

async function bancada(opcoes: {
  paginasDeConteudo?: number;
  campos: CampoDeAssinatura[];
  signatariosDoEnvelope?: string[];
  comRubricaDe?: string[];
  comReserva?: boolean;
  linhas?: LinhaDeSignatario[];
}) {
  const quantas = opcoes.paginasDeConteudo ?? 2;
  const documento = await PDFDocument.create();
  for (let i = 0; i < quantas; i++) documento.addPage(A4);

  const rubrica = await documento.embedPng(PNG_1PX);
  const wordmark = { imagem: await documento.embedPng(wordmarkPngBytes()), ratio: WORDMARK_RATIO };

  const fontes = {
    helvetica: await documento.embedFont(StandardFonts.Helvetica),
    helveticaBold: await documento.embedFont(StandardFonts.HelveticaBold),
    courier: await documento.embedFont(StandardFonts.Courier),
    courierBold: await documento.embedFont(StandardFonts.CourierBold),
  };

  const linhas = opcoes.linhas ?? [linhaBase()];
  const signatariosDoLaudo: SignatarioNoLaudo[] = linhas.map((linha) => ({
    linha,
    rubrica: (opcoes.comRubricaDe ?? [linha.id]).includes(linha.id) ? rubrica : null,
    foto: null,
    qr: null,
    urlDeVerificacao: 'https://jurius.com.br/#/verificar/ABC123',
  }));

  const rubricaPorSignatario = new Map<string, unknown>(
    (opcoes.comRubricaDe ?? linhas.map((l) => l.id)).map((id) => [id, rubrica]),
  );

  const resultado = await montarDocumentoAssinado({
    documento: documento as any,
    ferramentas: { rgb, degrees, PDFString, pontaRedonda: LineCapStyle.Round },
    fontes,
    cores: paletaDoLaudo(rgb),
    deslocamentos: { main: 0 },
    paginasDeConteudo: quantas,
    campos: opcoes.campos,
    todosOsSignatarios: new Set(opcoes.signatariosDoEnvelope ?? linhas.map((l) => l.id)),
    rubricaPorSignatario,
    rubricaDeReserva: (opcoes.comReserva ?? true) ? rubrica : null,
    dadosDoRodape: {
      codigo: 'ABC123',
      protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
      sha256DoOriginal: 'a'.repeat(64),
      urlDeVerificacao: 'https://jurius.com.br/#/verificar/ABC123',
      assinadoEm: '02/09/2026 23:34',
      seloCurto: '3F7A21C9',
    },
    qr: null,
    wordmark,
    laudo: {
      identidade: {
        nomeDoDocumento: 'CONTRATO.docx',
        codigo: 'ABC123',
        protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
        emitidoEm: '04/09/2026 01:12',
      },
      signatarios: signatariosDoLaudo,
      eventos: montarTrilhaDeEventos({
        criadoEm: '2026-09-02T23:30:00.000Z',
        nomeDoEmissor: 'Escritório',
        signatarios: linhas,
        auditoria: [],
        urlDosTermos: (v) => `https://jurius.com.br/#/termos-assinatura/${v}`,
      }),
      sha256DoOriginal: 'a'.repeat(64),
    },
  });

  return { documento, resultado };
}

const campo = (extra: Partial<CampoDeAssinatura> = {}): CampoDeAssinatura => ({
  field_type: 'signature',
  x_percent: 10, y_percent: 70, w_percent: 30, h_percent: 8,
  page_number: 1, document_id: 'main',
  ...extra,
});

// ── A estrutura do artefato ─────────────────────────────────────────────────

test('o artefato sai com conteúdo + capa + página por signatário + trilha', async () => {
  const { resultado } = await bancada({ campos: [campo()] });
  assert.equal(resultado.paginasDeConteudo, 2);
  assert.equal(resultado.laudo.capa, 1);
  assert.equal(resultado.laudo.signatarios, 1);
  assert.ok(resultado.laudo.trilha >= 1);
  assert.equal(resultado.paginasTotais, 2 + resultado.laudo.total);
  assert.ok(resultado.bytes.length > 1000, 'o PDF saiu vazio');
});

test('a faixa do rodapé cresce a folha PARA BAIXO, sem mover o conteúdo', async () => {
  const { documento } = await bancada({ campos: [campo()] });
  const conteudo = documento.getPage(0).getMediaBox();
  assert.equal(conteudo.height, A4[1] + ALTURA_DA_FAIXA_DO_RODAPE);
  assert.equal(conteudo.y, -ALTURA_DA_FAIXA_DO_RODAPE);
  // A origem desceu; o topo continua onde estava, e por isso nada do conteúdo
  // original mudou de lugar.
  assert.equal(conteudo.y + conteudo.height, A4[1]);
});

test('as páginas do LAUDO não recebem a faixa — elas já nascem com espaço', async () => {
  const { documento, resultado } = await bancada({ campos: [campo()] });
  const primeiraDoLaudo = documento.getPage(resultado.paginasDeConteudo).getMediaBox();
  assert.equal(primeiraDoLaudo.height, A4[1]);
  assert.equal(primeiraDoLaudo.y, 0);
});

// ── Quem assina o quê ───────────────────────────────────────────────────────

test('cada campo é estampado na PÁGINA que alguém marcou', async () => {
  const { resultado } = await bancada({
    paginasDeConteudo: 3,
    campos: [campo({ page_number: 1 }), campo({ page_number: 3 })],
  });
  assert.deepEqual(resultado.decisoes.map((d) => d.pagina), [0, 2]);
  assert.equal(resultado.usouPosicaoDeReserva, false);
});

test('campo de quem AINDA NÃO assinou fica em branco — nunca a rubrica de outro', async () => {
  // A regra que impede o primeiro signatário de assinar pelos dois.
  const { resultado } = await bancada({
    campos: [campo({ signer_id: 'signer-1' }), campo({ signer_id: 'signer-2' })],
    signatariosDoEnvelope: ['signer-1', 'signer-2'],
    comRubricaDe: ['signer-1'],
  });
  assert.deepEqual(
    resultado.decisoes.map((d) => d.decisao),
    ['assinatura-do-titular', 'pular-ainda-nao-assinou'],
  );
  assert.equal(resultado.decisoes[1].pagina, null);
});

test('campo de um documento que não foi mesclado não vaza para o principal', async () => {
  // Sem esta trava, o campo caía no deslocamento 0 e empilhava assinaturas de
  // arquivos diferentes na mesma folha.
  const { resultado } = await bancada({
    campos: [campo({ document_id: 'attachment-9' })],
  });
  assert.equal(resultado.decisoes[0].pagina, null);
});

test('página fora do arquivo não vira "última página" por adivinhação', async () => {
  const { resultado } = await bancada({
    paginasDeConteudo: 2,
    campos: [campo({ page_number: 7 })],
  });
  assert.equal(resultado.decisoes[0].pagina, null);
});

test('sem campo nenhum, a rubrica cai no canto da última folha de conteúdo', async () => {
  const { resultado } = await bancada({ campos: [] });
  assert.equal(resultado.usouPosicaoDeReserva, true);
});

test('a reserva NÃO dispara quando algum campo foi estampado', async () => {
  // O defeito antigo: bastava um campo falhar para a assinatura ir parar no
  // canto da última página, MESMO com campos corretamente posicionados.
  const { resultado } = await bancada({
    campos: [campo({ page_number: 1 }), campo({ page_number: 99 })],
  });
  assert.equal(resultado.usouPosicaoDeReserva, false);
});

test('campo que não é de assinatura é ignorado', async () => {
  const { resultado } = await bancada({
    campos: [campo({ field_type: 'date' }), campo({ field_type: 'signature' })],
  });
  assert.equal(resultado.decisoes.length, 1);
});

// ── Dois signatários ────────────────────────────────────────────────────────

test('dois signatários rendem duas páginas de dossiê', async () => {
  const { resultado } = await bancada({
    campos: [campo({ signer_id: 'signer-1' }), campo({ signer_id: 'signer-2' })],
    linhas: [
      linhaBase(),
      linhaBase({ id: 'signer-2', name: 'Maria Souza', signed_at: '2026-09-03T12:00:00.000Z' }),
    ],
    comRubricaDe: ['signer-1', 'signer-2'],
  });
  assert.equal(resultado.laudo.signatarios, 2);
  assert.deepEqual(
    resultado.decisoes.map((d) => d.decisao),
    ['assinatura-do-titular', 'assinatura-do-titular'],
  );
});

// ── A faixa nasce tapada ────────────────────────────────────────────────────

test('a máscara cobre a faixa inteira, ancorada na origem FÍSICA da página', () => {
  // Crescer o MediaBox não cria papel em branco: descobre o que o recorte
  // escondia. Uma página cuja última linha transborda o pé da folha — o que a
  // conversão por fatias produz o tempo todo — passava a mostrar esse
  // excedente, e o rodapé ficava por cima dele.
  const desenhos: Array<Record<string, unknown>> = [];
  const pagina = {
    getMediaBox: () => ({
      x: 0, y: -ALTURA_DA_FAIXA_DO_RODAPE,
      width: A4[0], height: A4[1] + ALTURA_DA_FAIXA_DO_RODAPE,
    }),
    drawRectangle: (r: Record<string, unknown>) => desenhos.push(r),
  };

  taparFaixaRevelada(pagina, 'branco');

  assert.equal(desenhos.length, 1);
  const [r] = desenhos;
  assert.equal(r.y, -ALTURA_DA_FAIXA_DO_RODAPE, 'com y=0 a máscara tapava o conteúdo e não a sobra');
  assert.equal(r.height, ALTURA_DA_FAIXA_DO_RODAPE);
  assert.equal(r.width, A4[0], 'de borda a borda: o transbordo acontece em qualquer x');
  assert.equal(r.color, 'branco');
});

test('a máscara acompanha a faixa se a altura dela mudar', () => {
  const desenhos: Array<Record<string, unknown>> = [];
  const pagina = {
    getMediaBox: () => ({ x: 12, y: -40, width: 500, height: 800 }),
    drawRectangle: (r: Record<string, unknown>) => desenhos.push(r),
  };
  taparFaixaRevelada(pagina, 'branco', 40);
  assert.deepEqual(desenhos, [{ x: 12, y: -40, width: 500, height: 40, color: 'branco' }]);
});
