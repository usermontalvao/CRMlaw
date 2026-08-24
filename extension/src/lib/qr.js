// Leitura de QR — 100% local.
//
// A imagem NUNCA sai da máquina: não há upload, não há serviço de terceiro,
// não há nada guardado. O bitmap é decodificado, o texto é usado e os dois
// são descartados na mesma função.
//
// Dois caminhos, nessa ordem:
//   1) BarcodeDetector — nativo do Chrome, sem custo de bundle;
//   2) jsQR empacotado em vendor/ — para quando o nativo não existe
//      (tipicamente Chrome no Linux).

import jsQR from '../../vendor/jsqr.js';

async function comBarcodeDetector(bitmap) {
  if (typeof BarcodeDetector === 'undefined') return null;
  try {
    const suportados = await BarcodeDetector.getSupportedFormats();
    if (!suportados.includes('qr_code')) return null;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const encontrados = await detector.detect(bitmap);
    return encontrados.map((item) => item.rawValue).filter(Boolean);
  } catch (_) {
    return null;
  }
}

function comJsQR(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const imagem = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const achado = jsQR(imagem.data, imagem.width, imagem.height, { inversionAttempts: 'attemptBoth' });
  // Ajuda o coletor: um QR de migração grande vira alguns MB de pixels.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return achado?.data ? [achado.data] : [];
}

/**
 * Tenta ler, e devolve lista VAZIA quando não acha — sem lançar.
 *
 * É esta a versão que a câmera usa: num vídeo a 30 quadros por segundo, a
 * esmagadora maioria dos quadros não tem QR nenhum, e "não achei" ali é o
 * caso comum, não um erro.
 *
 * Aceita qualquer coisa que o `createImageBitmap` engula — inclusive o próprio
 * elemento `<video>`, que é como o quadro atual é capturado sem passar por
 * arquivo nenhum.
 */
export async function tentarLerQr(origem) {
  const bitmap = origem instanceof ImageBitmap ? origem : await createImageBitmap(origem);

  try {
    const nativo = await comBarcodeDetector(bitmap);
    if (nativo && nativo.length > 0) return nativo;
    return comJsQR(bitmap);
  } finally {
    // Fechar importa MUITO no laço da câmera: sem isto, um bitmap por quadro
    // fica esperando o coletor e a memória sobe até travar a janela.
    bitmap.close?.();
  }
}

/**
 * Devolve os textos encontrados na imagem. Aceita File, Blob ou ImageBitmap.
 * Lança se não achar nada — silêncio aqui viraria "importei e não apareceu".
 */
export async function lerQrDeImagem(origem) {
  const achados = await tentarLerQr(origem);
  if (achados.length === 0) throw new Error('Nenhum QR Code foi reconhecido nesta imagem.');
  return achados;
}

/** Junta vários textos num payload só — o servidor aceita uma URI por linha. */
export function juntarPayload(textos) {
  return textos.map((t) => String(t).trim()).filter(Boolean).join('\n');
}
