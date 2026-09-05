/**
 * A bancada do PORTE: exercita a montagem do servidor sem servidor.
 *
 * Os módulos de `supabase/functions/_shared/montagem/` são pdf-lib puro — não
 * tocam em DOM nem em Deno. Então dá para rodá-los aqui, com o pdf-lib de
 * `node_modules` (1.17.1, a MESMA versão que a Edge Function usa via
 * `npm:pdf-lib@1.17.1`), e olhar o resultado antes de subir qualquer coisa.
 *
 * Sem isto o porte seria escrito às cegas e só conferido em produção, num
 * documento que vale como prova.
 *
 * Uso:
 *   npm run montagem:servidor -- entrada.pdf saida.pdf
 *   npm run montagem:servidor                      # usa o kit de referência
 */
import { readFileSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { degrees, LineCapStyle, PDFDocument, PDFString, rgb, StandardFonts } from 'pdf-lib';

import { caixaComFaixaDoRodape } from '../supabase/functions/_shared/montagem/geometria.ts';
import { desenharRodape } from '../supabase/functions/_shared/montagem/rodape.ts';
import { wordmarkPngBytes, WORDMARK_RATIO } from '../supabase/functions/_shared/montagem/wordmark.ts';
import {
  marcasDeCanto, paletaDoLaudo, retanguloArredondado, retanguloTopoArredondado, visto,
} from '../supabase/functions/_shared/montagem/laudoDesign.ts';
import {
  FOLHA_DO_LAUDO, desenharCabecalhoDoLaudo,
} from '../supabase/functions/_shared/montagem/laudoCabecalho.ts';
import { desenharCapaDoLaudo } from '../supabase/functions/_shared/montagem/laudoCapa.ts';
import {
  desenharPaginaDoSignatario, fichaDoSignatario,
} from '../supabase/functions/_shared/montagem/laudoSignatario.ts';
import { desenharTrilha } from '../supabase/functions/_shared/montagem/laudoTrilha.ts';
import {
  PRIORIDADE, instanteDosTermos, ordenarTrilha,
} from '../supabase/functions/_shared/montagem/linhaDoTempo.ts';
import { provasDeAutenticacao, resumoDoDispositivo } from '../supabase/functions/_shared/montagem/provasDeAutenticacao.ts';
import {
  montarDocumentoAssinado, taparFaixaRevelada,
} from '../supabase/functions/_shared/montagem/montarDocumentoAssinado.ts';
import { montarTrilhaDeEventos } from '../supabase/functions/_shared/montagem/trilhaDeEventos.ts';
import { logoPngBytes } from '../supabase/functions/_shared/montagem/logo.ts';
import { desenharLaudo } from '../supabase/functions/_shared/montagem/laudo.ts';
import { seloImpressaoCurta } from '../supabase/functions/_shared/montagem/selo.ts';
import { CORRECAO_DE_ERRO_DO_QR } from '../supabase/functions/_shared/montagem/qr-em-retangulos.ts';

// ── Modo `--laudo`: a capa do certificado ────────────────────────────────────
// Dados de mentira, desenho de verdade: é o antes/depois que a bancada existe
// para permitir. O signatário 2 leva fatores compridos de propósito, para o
// cartão crescer e provar que a altura sai das LINHAS.
if (process.argv.includes('--laudo')) {
  const doc = await PDFDocument.create();
  const pag = doc.addPage([FOLHA_DO_LAUDO.largura, FOLHA_DO_LAUDO.altura]);
  const fontes = {
    helvetica: await doc.embedFont(StandardFonts.Helvetica),
    helveticaBold: await doc.embedFont(StandardFonts.HelveticaBold),
    courier: await doc.embedFont(StandardFonts.Courier),
    courierBold: await doc.embedFont(StandardFonts.CourierBold),
  };
  const cores = paletaDoLaudo(rgb);
  const wm = { imagem: await doc.embedPng(wordmarkPngBytes()), ratio: WORDMARK_RATIO };
  const emitidoEm = '04/09/2026 01:12';

  desenharCabecalhoDoLaudo({
    pagina: pag, fontes, cores,
    identidade: {
      nomeDoDocumento: 'CONTRATO DE HONORÁRIOS ADVOCATÍCIOS.docx',
      codigo: '771AC0F37B61269C',
      protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
      emitidoEm,
    },
    titulo: 'CERTIFICADO DE ASSINATURA',
    wordmark: wm,
  });

  desenharCapaDoLaudo({
    pagina: pag, fontes, cores,
    ferramentas: { rgb, pontaRedonda: LineCapStyle.Round },
    emitidoEm,
    signatarios: [
      {
        nome: 'Pedro Rodrigues Montalvão Neto',
        papel: 'Contratante',
        assinadoEm: '02/09/2026 23:34:07',
        provas: provasDeAutenticacao({
          fraseDeIdentidade: 'Identidade confirmada por código enviado ao WhatsApp',
          ip: '200.1.2.3',
          temSelfie: true,
          dispositivo: resumoDoDispositivo(['iPhone', 'Safari', 'iOS']),
        }),
      },
      {
        nome: 'Maria da Silva Souza Albuquerque Pereira',
        papel: 'Assinar',
        assinadoEm: '03/09/2026 09:02:41',
        provas: provasDeAutenticacao({
          fraseDeIdentidade: 'Autenticação via Link por E-mail (maria.silva.souza@escritorio.adv.br)',
          googleId: '118273645500192837465',
          ip: '187.45.201.9',
          coordenadas: '-15.601234567890, -56.097654321098',
          temSelfie: true,
          dispositivo: resumoDoDispositivo(['Samsung Galaxy S23 Ultra', 'Chrome 121', 'Android 14']),
        }),
      },
    ],
  });

  // ── Página 2: o signatário ──
  const qrDoLaudo = (() => {
    const q = QRCode.create('https://jurius.com.br/#/verificar/771AC0F37B61269C', { errorCorrectionLevel: CORRECAO_DE_ERRO_DO_QR });
    return { modulos: q.modules.data, tamanho: q.modules.size };
  })();

  const pag2 = doc.addPage([FOLHA_DO_LAUDO.largura, FOLHA_DO_LAUDO.altura]);
  desenharCabecalhoDoLaudo({
    pagina: pag2, fontes, cores,
    identidade: {
      nomeDoDocumento: 'CONTRATO DE HONORÁRIOS ADVOCATÍCIOS.docx',
      codigo: '771AC0F37B61269C',
      protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
      emitidoEm,
    },
    titulo: 'BIOMETRIA & VERIFICAÇÃO',
    subtitulo: 'Signatário: Pedro Rodrigues Montalvão Neto',
    wordmark: wm,
  });
  desenharPaginaDoSignatario({
    pagina: pag2, fontes, cores,
    ferramentas: { rgb, degrees },
    wordmark: wm,
    conteudo: {
      nome: 'Pedro Rodrigues Montalvão Neto',
      ficha: fichaDoSignatario({
        nome: 'Pedro Rodrigues Montalvão Neto',
        papel: 'Contratante',
        contato: 'pedro@escritorio.adv.br',
        cpf: '045.448.031-93',
        ip: '200.1.2.3',
        localizacao: '-15.601234, -56.097654',
        dispositivo: 'Safari · iOS · iPhone',
        // Comprida de propósito: é a linha que antes saía cortada em
        // "…enviad…" e agora tem de QUEBRAR inteira.
        autenticacao: 'Autenticação realizada por código enviado ao número informado (65) 98404-6375',
        termos: 'Aceitos · versão v1',
        assinadoEm: '02/09/2026 23:34:07',
      }),
      foto: null, // sem selfie: exercita o placeholder
      qr: qrDoLaudo,
      codigoDoDocumento: '771AC0F37B61269C',
      protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
      sha256DoOriginal: '5311024d031b7e9e5f6d5bacfab21abaa4f1944f7b1042327ad3714292da09dc',
      urlDeVerificacao: 'https://jurius.com.br/#/verificar/771AC0F37B61269C',
    },
  });

  // ── Página 3+: a trilha de auditoria ──
  // Eventos de sobra e um detalhe comprido de propósito: é o que força a
  // paginação e a quebra de linha dentro do cartão.
  const t0 = new Date('2026-09-02T23:30:00Z').getTime();
  const assinadoEm = t0 + 4 * 60_000;
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
  const bruto = [
    { rotulo: 'Criado', instante: t0, prioridade: PRIORIDADE.criado,
      detalhe: 'Documento emitido por Pedro Rodrigues Montalvão Neto.' },
    ...[0, 1, 2, 3].map((i) => ({
      rotulo: 'Visualizado', instante: t0 + 30_000 + i * 20_000, prioridade: PRIORIDADE.visualizado,
      detalhe: `Pedro Rodrigues Montalvão Neto, CPF: 045.448.031-93 abriu o documento por meio do IP 200.1.2.3`,
    })),
    { rotulo: 'Autenticação', instante: t0 + 2 * 60_000, prioridade: PRIORIDADE.autenticacao,
      detalhe: `Pedro Rodrigues Montalvão Neto, CPF: 045.448.031-93. Autenticação realizada por código enviado ao número informado (65) 98404-6375 por meio do IP 200.1.2.3. Dispositivo: ${ua}` },
    { rotulo: 'Biometria facial', instante: t0 + 3 * 60_000, prioridade: PRIORIDADE.biometria,
      detalhe: 'Pedro Rodrigues Montalvão Neto, CPF: 045.448.031-93 concedeu acesso à câmera e teve a selfie capturada para verificação facial.' },
    { rotulo: 'Localização', instante: t0 + 3 * 60_000 + 5_000, prioridade: PRIORIDADE.localizacao,
      detalhe: 'Pedro Rodrigues Montalvão Neto ativou a localização com coordenadas -15.601234, -56.097654 (Cuiabá - MT).' },
    // Termos gravado DEPOIS da assinatura: a trava tem de puxá-lo para antes.
    { rotulo: 'Termos', instante: instanteDosTermos(assinadoEm + 2_000, assinadoEm), prioridade: PRIORIDADE.termos,
      detalhe: 'Pedro Rodrigues Montalvão Neto declarou ter lido e aceitado os Termos de Uso (versão v1) por meio do IP 200.1.2.3. Consulte em https://jurius.com.br/termos/assinatura/v1' },
    { rotulo: 'Assinado', instante: assinadoEm, prioridade: PRIORIDADE.assinado,
      detalhe: `Pedro Rodrigues Montalvão Neto, CPF: 045.448.031-93 assinou este documento por meio do IP 200.1.2.3 localizado em -15.601234, -56.097654. Autenticação realizada por código enviado ao número informado. Dispositivo: ${ua}` },
  ];
  const eventos = ordenarTrilha(bruto.map((e) => ({
    ...e,
    quando: new Date(e.instante).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' }),
  })));

  const cabecalhoDaTrilha = (pg: typeof pag2) => {
    desenharCabecalhoDoLaudo({
      pagina: pg, fontes, cores,
      identidade: {
        nomeDoDocumento: 'CONTRATO DE HONORÁRIOS ADVOCATÍCIOS.docx',
        codigo: '771AC0F37B61269C',
        protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
        emitidoEm,
      },
      titulo: 'TRILHA DE AUDITORIA',
      wordmark: wm,
    });
    return pg;
  };

  const pag3 = cabecalhoDaTrilha(doc.addPage([FOLHA_DO_LAUDO.largura, FOLHA_DO_LAUDO.altura]));
  const { paginasUsadas } = desenharTrilha({
    paginaInicial: pag3,
    novaPagina: () => cabecalhoDaTrilha(doc.addPage([FOLHA_DO_LAUDO.largura, FOLHA_DO_LAUDO.altura])),
    fontes, cores, rgb, eventos,
    protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
  });

  const destino = 'tmp/pdfs/laudo-capa.pdf';
  writeFileSync(destino, await doc.save());
  console.log(JSON.stringify({
    modo: 'laudo', destino,
    paginas: doc.getPageCount(),
    eventos: eventos.length,
    paginasDeTrilha: paginasUsadas,
    ordemDaTrilha: eventos.map((e) => e.rotulo),
  }, null, 2));
  process.exit(0);
}

// ── Modo `--referencia`: o LAUDO A/B contra o artefato do navegador ──────────
//
// A comparação JUSTA do porte, e a única que vale alguma coisa: os mesmos dados
// desenhados pelos dois motores. Os dados abaixo foram lidos do próprio
// `kit-trabalhista-signed.pdf` (envelope 4835bfad-…, assinado pelo navegador em
// 02/09/2026), então a bancada compara laudo com laudo — e não, como antes, o
// laudo novo contra dados de mentira.
//
// Produz um PDF de 4 páginas alinhado com as páginas 3 a 6 da referência:
//
//   npm run montagem:servidor -- --referencia
//   npm run montagem:comparar -- tmp/pdfs/referencia-laudo-cliente.pdf \
//                                tmp/pdfs/referencia-laudo-servidor.pdf
//
// O que ele NÃO reproduz: a selfie e a rubrica, que são imagens que só existem
// no Storage. As duas ficam em branco dos dois lados (o recorte da referência
// tira as páginas com as imagens do caminho), e é por isso que o parecer sobre
// elas continua sendo o do olho, não o da bancada.
if (process.argv.includes('--referencia')) {
  const doc = await PDFDocument.create();
  const fontes = {
    helvetica: await doc.embedFont(StandardFonts.Helvetica),
    helveticaBold: await doc.embedFont(StandardFonts.HelveticaBold),
    courier: await doc.embedFont(StandardFonts.Courier),
    courierBold: await doc.embedFont(StandardFonts.CourierBold),
  };
  const wm = { imagem: await doc.embedPng(wordmarkPngBytes()), ratio: WORDMARK_RATIO };
  const logo = await doc.embedPng(logoPngBytes());

  const codigo = '771ac0f37b61269c';
  const protocolo = '4835bfad-8c97-4921-a366-8e13e30fbc04';
  const sha256DoOriginal = '5311024d031b7e9e5f6d5bacfab21abaa4f1944f7b1042327ad3714292da09dc';
  const urlDeVerificacao = `https://jurius.com.br/#/verificar/${codigo}`;
  const qr = (() => {
    const q = QRCode.create(urlDeVerificacao, { errorCorrectionLevel: CORRECAO_DE_ERRO_DO_QR });
    return { modulos: q.modules.data, tamanho: q.modules.size };
  })();

  const uaRef = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) CriOS/152.0.7977.64 Mobile/15E148 Safari/604.1';
  const geo = '-15.631554692174921, -55.957191974531504';
  const linhaRef = {
    id: 'signer-ref',
    name: 'PEDRO RODRIGUES MONTALVAO NETO',
    role: null,
    cpf: '045.748.031-93',
    email: 'pedro@advcuiaba.com',
    auth_provider: 'google',
    auth_email: 'pedro@advcuiaba.com',
    auth_verified_channel: 'google',
    auth_verified_identifier: 'pedro@advcuiaba.com',
    auth_at: '2026-09-03T03:33:37.000Z',
    signer_ip: '201.71.166.196',
    signer_geolocation: geo,
    signer_user_agent: uaRef,
    geolocation_captured_at: '2026-09-03T03:33:56.000Z',
    facial_image_path: 'selfies/ref.jpg',
    facial_captured_at: '2026-09-03T03:34:12.000Z',
    terms_accepted_at: '2026-09-03T03:34:17.000Z',
    terms_version: 'v2',
    signed_at: '2026-09-03T03:34:20.000Z',
  };

  // As onze aberturas da referência, no minuto e segundo em que aconteceram.
  const visitas = [
    '21:58:43', '22:02:06', '22:04:28', '22:07:29', '22:13:07', '22:13:22',
    '22:14:02', '22:20:14', '22:22:10', '23:22:01', '23:32:47',
  ].map((hora) => {
    const [h, m, sg] = hora.split(':').map(Number);
    // Cuiabá é UTC-4: a hora impressa mais quatro horas dá o instante em UTC.
    const d = new Date(Date.UTC(2026, 8, 2, h + 4, m, sg));
    return { signer_id: 'signer-ref', action: 'viewed', ip_address: '201.71.166.196',
      created_at: d.toISOString() };
  });

  const eventos = montarTrilhaDeEventos({
    criadoEm: '2026-09-03T01:58:15.000Z',
    nomeDoEmissor: 'Pedro Rodrigues Montalvao Neto',
    signatarios: [linhaRef],
    auditoria: visitas,
    urlDosTermos: (v) => `https://jurius.com.br/#/termos-assinatura/${v}`,
  });

  const resumo = desenharLaudo({
    documento: doc as any,
    fontes,
    cores: paletaDoLaudo(rgb),
    ferramentas: { rgb, degrees, pontaRedonda: LineCapStyle.Round },
    identidade: {
      nomeDoDocumento: 'KIT TRABALHISTA - PEDRO RODRIGUES MONTALVAO NETO',
      codigo: codigo.toUpperCase(),
      protocolo,
      emitidoEm: '02/09/2026, 23:34',
    },
    signatarios: [{ linha: linhaRef, rubrica: null, foto: null, qr, urlDeVerificacao }],
    eventos,
    sha256DoOriginal,
    wordmark: wm,
    logo,
  });

  // O rodapé de TODA folha do laudo, com a faixa semitransparente (as páginas
  // do laudo têm layout próprio e não recebem reserva).
  for (const pagina of doc.getPages()) {
    desenharRodape({
      pagina,
      ferramentas: { rgb, degrees, PDFString },
      helvetica: fontes.helvetica, helveticaBold: fontes.helveticaBold,
      courier: fontes.courier, courierBold: fontes.courierBold,
      wordmark: wm, qr,
      dados: {
        codigo, protocolo, sha256DoOriginal, urlDeVerificacao,
        assinadoEm: '02/09/2026, 23:34', seloCurto: seloImpressaoCurta(4),
      },
      opaco: false,
    });
  }

  const destino = 'tmp/pdfs/referencia-laudo-servidor.pdf';
  writeFileSync(destino, await doc.save());

  // O lado A: as páginas 3 a 6 da referência, recortadas para o mesmo intervalo.
  const referencia = await PDFDocument.load(readFileSync('tmp/pdfs/kit-trabalhista-signed.pdf'));
  const recorte = await PDFDocument.create();
  const total = referencia.getPageCount();
  const indices = [2, 3, 4, 5].filter((i) => i < total);
  for (const p of await recorte.copyPages(referencia, indices)) recorte.addPage(p);
  const destinoA = 'tmp/pdfs/referencia-laudo-cliente.pdf';
  writeFileSync(destinoA, await recorte.save());

  console.log(JSON.stringify({
    modo: 'referencia',
    cliente: destinoA, servidor: destino,
    paginasDoCliente: indices.length,
    paginasDoServidor: doc.getPageCount(),
    laudo: resumo,
    eventos: eventos.map((e) => `${e.rotulo} ${e.quando}`),
  }, null, 2));
  process.exit(0);
}

// ── Modo `--completo`: o ARTEFATO INTEIRO, como a Edge Function o produz ─────
//
// Este é o modo que fecha o porte. Ele chama `montarDocumentoAssinado` — o
// mesmo código que a Edge Function chama — sobre o PDF congelado de verdade, e
// grava o resultado para a bancada comparar contra a montagem do navegador.
//
//   npm run montagem:servidor -- --completo [entrada.pdf] [saida.pdf]
if (process.argv.includes('--completo')) {
  const argumentos = process.argv.filter((a) => !a.startsWith('--'));
  const entradaPdf = argumentos[2] ?? 'tmp/pdfs/kit-servidor-licenciado.pdf';
  const destino = argumentos[3] ?? 'tmp/pdfs/kit-completo-no-servidor.pdf';

  const doc = await PDFDocument.load(readFileSync(entradaPdf));
  const paginasDeConteudo = doc.getPageCount();

  const fontes = {
    helvetica: await doc.embedFont(StandardFonts.Helvetica),
    helveticaBold: await doc.embedFont(StandardFonts.HelveticaBold),
    courier: await doc.embedFont(StandardFonts.Courier),
    courierBold: await doc.embedFont(StandardFonts.CourierBold),
  };
  const wm = { imagem: await doc.embedPng(wordmarkPngBytes()), ratio: WORDMARK_RATIO };
  const logo = await doc.embedPng(logoPngBytes());
  const rubrica = await doc.embedPng(readFileSync('tmp/pdfs/rubrica-de-bancada.png'));

  const codigo = '771AC0F37B61269C';
  const protocolo = '4835bfad-8c97-4921-a366-8e13e30fbc04';
  const sha256DoOriginal = '5311024d031b7e9e5f6d5bacfab21abaa4f1944f7b1042327ad3714292da09dc';
  const urlDeVerificacao = `https://jurius.com.br/#/verificar/${codigo}`;

  const qr = (() => {
    const q = QRCode.create(urlDeVerificacao, { errorCorrectionLevel: CORRECAO_DE_ERRO_DO_QR });
    return { modulos: q.modules.data, tamanho: q.modules.size };
  })();

  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
  const linha = {
    id: 'signer-1',
    name: 'Pedro Rodrigues Montalvão Neto',
    role: 'Contratante',
    cpf: '045.448.031-93',
    phone: '65984046375',
    auth_provider: 'phone',
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565984046375',
    auth_verified_at: '2026-09-02T23:32:00.000Z',
    auth_at: '2026-09-02T23:32:00.000Z',
    signer_ip: '200.1.2.3',
    signer_geolocation: '-15.601234, -56.097654|Cuiabá - MT',
    signer_user_agent: ua,
    geolocation_captured_at: '2026-09-02T23:33:05.000Z',
    facial_image_path: null,
    viewed_at: '2026-09-02T23:30:30.000Z',
    terms_accepted_at: '2026-09-02T23:34:02.000Z',
    terms_version: 'v1',
    signed_at: '2026-09-02T23:34:00.000Z',
  };

  const eventos = montarTrilhaDeEventos({
    criadoEm: '2026-09-02T23:30:00.000Z',
    nomeDoEmissor: 'Escritório Montalvão',
    signatarios: [linha],
    auditoria: [0, 1, 2, 3].map((i) => ({
      signer_id: 'signer-1', action: 'viewed', ip_address: '200.1.2.3',
      created_at: new Date(Date.parse('2026-09-02T23:30:30.000Z') + i * 20_000).toISOString(),
    })),
    urlDosTermos: (v) => `https://jurius.com.br/#/termos-assinatura/${v}`,
  });

  const resultado = await montarDocumentoAssinado({
    documento: doc as any,
    ferramentas: { rgb, degrees, PDFString, pontaRedonda: LineCapStyle.Round },
    fontes,
    cores: paletaDoLaudo(rgb),
    deslocamentos: { main: 0 },
    paginasDeConteudo,
    campos: [
      { field_type: 'signature', signer_id: 'signer-1', document_id: 'main', page_number: paginasDeConteudo,
        x_percent: 12, y_percent: 72, w_percent: 32, h_percent: 7 },
    ],
    todosOsSignatarios: new Set(['signer-1']),
    rubricaPorSignatario: new Map([['signer-1', rubrica]]),
    rubricaDeReserva: rubrica,
    dadosDoRodape: {
      codigo, protocolo, sha256DoOriginal, urlDeVerificacao,
      assinadoEm: '02/09/2026 23:34', seloCurto: '3F7A21C9',
    },
    qr,
    wordmark: wm,
    logo,
    laudo: {
      identidade: {
        nomeDoDocumento: 'KIT TRABALHISTA.docx',
        codigo, protocolo, emitidoEm: '04/09/2026 01:12',
      },
      signatarios: [{ linha, rubrica, foto: null, qr, urlDeVerificacao }],
      eventos,
      sha256DoOriginal,
    },
  });

  writeFileSync(destino, resultado.bytes);
  console.log(JSON.stringify({
    modo: 'completo', entrada: entradaPdf, destino,
    paginasDeConteudo: resultado.paginasDeConteudo,
    paginasTotais: resultado.paginasTotais,
    laudo: resultado.laudo,
    decisoes: resultado.decisoes,
    usouPosicaoDeReserva: resultado.usouPosicaoDeReserva,
    bytes: resultado.bytes.length,
  }, null, 2));
  process.exit(0);
}

// ── Modo `--formas`: amostra das primitivas do laudo ─────────────────────────
// Existe porque o `drawSvgPath` do pdf-lib usa origem no canto SUPERIOR
// esquerdo, com y para BAIXO — ao contrário do resto do PDF. Um cartão ancorado
// pela borda errada sai deslocado da própria altura, sem erro nenhum. Esta
// página prova a ancoragem no olho.
if (process.argv.includes('--formas')) {
  const doc = await PDFDocument.create();
  const pag = doc.addPage([400, 300]);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const cor = paletaDoLaudo(rgb);
  const ferramentasDeForma = { rgb, pontaRedonda: LineCapStyle.Round };

  pag.drawRectangle({ x: 0, y: 0, width: 400, height: 300, color: cor.bgLight });

  retanguloArredondado(pag, 20, 270, 170, 90, 10, { preenchimento: cor.white, contorno: cor.border });
  pag.drawText('cartao arredondado', { x: 30, y: 235, size: 8, font: fonte, color: cor.txtMid });

  retanguloTopoArredondado(pag, 210, 270, 170, 28, 10, cor.navy);
  retanguloArredondado(pag, 210, 242, 170, 62, 0, { preenchimento: cor.white, contorno: cor.border });
  pag.drawText('cabecalho de cartao', { x: 220, y: 254, size: 8, font: fonte, color: cor.white });

  pag.drawCircle({ x: 60, y: 140, size: 18, color: cor.emeraldSoft });
  visto(pag, 60, 140, 12, cor.emerald, ferramentasDeForma, 2);
  pag.drawText('visto', { x: 46, y: 108, size: 8, font: fonte, color: cor.txtMid });

  pag.drawRectangle({ x: 150, y: 100, width: 90, height: 80, color: cor.paper });
  marcasDeCanto(pag, 150, 100, 90, 80, 12, cor.orange);
  pag.drawText('marcas de canto', { x: 150, y: 86, size: 8, font: fonte, color: cor.txtMid });

  // Régua: os dois cartões têm de ENCOSTAR nesta linha por cima.
  pag.drawLine({ start: { x: 0, y: 270 }, end: { x: 400, y: 270 }, thickness: 0.4, color: cor.orange });
  pag.drawText('y=270 — borda de CIMA dos cartoes', { x: 20, y: 276, size: 6, font: fonte, color: cor.orange });

  const destino = 'tmp/pdfs/amostra-de-formas.pdf';
  writeFileSync(destino, await doc.save());
  console.log(JSON.stringify({ modo: 'formas', destino }, null, 2));
  process.exit(0);
}

const entrada = process.argv[2] ?? 'tmp/pdfs/kit-servidor-licenciado.pdf';
const saida = process.argv[3] ?? 'tmp/pdfs/kit-montado-no-servidor.pdf';

const original = readFileSync(entrada);
const pdf = await PDFDocument.load(original);

const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);
const courier = await pdf.embedFont(StandardFonts.Courier);
const courierBold = await pdf.embedFont(StandardFonts.CourierBold);
const wordmarkImagem = await pdf.embedPng(wordmarkPngBytes());

// `QRCode.create()` é PURO — só monta a matriz, sem canvas. É por isso que ele
// roda no Deno e no Node igual, e é a razão de o QR ter deixado de prender a
// montagem no navegador.
const qrMatriz = (() => {
  const q = QRCode.create(
    'https://jurius.com.br/#/verificar/771AC0F37B61269C',
    { errorCorrectionLevel: CORRECAO_DE_ERRO_DO_QR },
  );
  return { modulos: q.modules.data, tamanho: q.modules.size };
})();

const dados = {
  codigo: '771AC0F37B61269C',
  protocolo: '4835bfad-8c97-4921-a366-8e13e30fbc04',
  sha256DoOriginal: '5311024d031b7e9e5f6d5bacfab21abaa4f1944f7b1042327ad3714292da09dc',
  urlDeVerificacao: 'https://jurius.com.br/#/verificar/771AC0F37B61269C',
  assinadoEm: '02/09/2026 23:34',
  seloCurto: '3F7A21C9',
};

const paginas = pdf.getPages();
for (const pagina of paginas) {
  // 1) abrir a faixa embaixo, sem mover o conteúdo
  const mb = pagina.getMediaBox();
  const nova = caixaComFaixaDoRodape(mb);
  pagina.setMediaBox(nova.x, nova.y, nova.width, nova.height);
  if ((pagina.node as any).CropBox?.()) {
    const cb = pagina.getCropBox();
    const novaCb = caixaComFaixaDoRodape(cb);
    pagina.setCropBox(novaCb.x, novaCb.y, novaCb.width, novaCb.height);
  }

  // 2) tapar o que a faixa DESCOBRIU — crescer a caixa não cria papel em
  //    branco, revela o que o recorte escondia (ver `taparFaixaRevelada`)
  taparFaixaRevelada(pagina, rgb(1, 1, 1));

  // 3) desenhar o rodapé ancorado na origem física
  desenharRodape({
    pagina,
    ferramentas: { rgb, degrees, PDFString },
    helvetica, helveticaBold, courier, courierBold,
    wordmark: { imagem: wordmarkImagem, ratio: WORDMARK_RATIO },
    qr: qrMatriz,
    dados,
    opaco: true,
  });
}

const bytes = await pdf.save();
writeFileSync(saida, bytes);

const antes = await PDFDocument.load(original);
const g0 = antes.getPage(0).getMediaBox();
const g1 = pdf.getPage(0).getMediaBox();
console.log(JSON.stringify({
  entrada, saida,
  paginas: paginas.length,
  paginasPreservadas: antes.getPageCount() === pdf.getPageCount(),
  alturaAntes: g0.height,
  alturaDepois: g1.height,
  cresceu: g1.height - g0.height,
  origemDesceu: g0.y - g1.y,
  bytes: bytes.length,
}, null, 2));
