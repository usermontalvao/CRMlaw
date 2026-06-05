import { supabasePortal } from '../lib/supabasePortal';

export type ScannerQuality = 'ok' | 'ruim';
export type ScannerFileKind = 'image' | 'pdf';
export type ScannerEnhancement = 'color' | 'gray' | 'document';

export interface ScannerPoint {
  x: number;
  y: number;
}

export interface ScannerQuad {
  tl: ScannerPoint;
  tr: ScannerPoint;
  br: ScannerPoint;
  bl: ScannerPoint;
}

export interface ScannerCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScannerMetrics {
  brightness: number;
  contrast: number;
  sharpness: number;
  cropRatio: number;
}

export interface ScannerItem {
  id: string;
  originalName: string;
  suggestedName: string;
  fileKind: ScannerFileKind;
  mimeType: string;
  quality: ScannerQuality;
  reason: string;
  createdAt: string;
  width: number;
  height: number;
  dataUrl: string;
  originalDataUrl?: string;
  fileBlob?: Blob;
  rotation?: number;
  enhancement?: ScannerEnhancement;
  crop?: ScannerCrop;
  quad?: ScannerQuad;
  ocrText?: string;
  metrics: ScannerMetrics;
}

interface AiScanAnalysis {
  name: string;
  quality: ScannerQuality;
  reason: string;
}

interface ProcessScanParams {
  file: File;
  index: number;
}

interface ImageVariantOptions {
  sourceDataUrl: string;
  crop?: ScannerCrop;
  quad?: ScannerQuad;
  rotation?: number;
  enhancement?: ScannerEnhancement;
}

const DETECTION_MAX_SIDE = 240;
const EXPORT_MAX_SIDE = 1800;
const MIN_CROP_SIZE = 0.15;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeName(input: string, fallback: string) {
  const normalized = (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function fileNameWithoutExtension(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function normalizeCrop(crop?: ScannerCrop): ScannerCrop {
  const rawX = clamp(crop?.x ?? 0, 0, 1);
  const rawY = clamp(crop?.y ?? 0, 0, 1);
  const rawWidth = clamp(crop?.width ?? 1, MIN_CROP_SIZE, 1);
  const rawHeight = clamp(crop?.height ?? 1, MIN_CROP_SIZE, 1);
  const width = Math.min(rawWidth, 1 - rawX);
  const height = Math.min(rawHeight, 1 - rawY);
  return {
    x: clamp(rawX, 0, 1 - MIN_CROP_SIZE),
    y: clamp(rawY, 0, 1 - MIN_CROP_SIZE),
    width: Math.max(MIN_CROP_SIZE, width),
    height: Math.max(MIN_CROP_SIZE, height),
  };
}

function clampPoint(point: ScannerPoint): ScannerPoint {
  return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
}

function cropToQuad(crop: ScannerCrop): ScannerQuad {
  const safeCrop = normalizeCrop(crop);
  return {
    tl: { x: safeCrop.x, y: safeCrop.y },
    tr: { x: safeCrop.x + safeCrop.width, y: safeCrop.y },
    br: { x: safeCrop.x + safeCrop.width, y: safeCrop.y + safeCrop.height },
    bl: { x: safeCrop.x, y: safeCrop.y + safeCrop.height },
  };
}

function normalizeQuad(quad?: ScannerQuad, fallbackCrop?: ScannerCrop): ScannerQuad {
  if (!quad) return cropToQuad(fallbackCrop || { x: 0, y: 0, width: 1, height: 1 });
  return {
    tl: clampPoint(quad.tl),
    tr: clampPoint(quad.tr),
    br: clampPoint(quad.br),
    bl: clampPoint(quad.bl),
  };
}

function distance(a: ScannerPoint, b: ScannerPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function detectScannerFileKind(file: File): ScannerFileKind | null {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.startsWith('image/')) return 'image';

  const ext = extensionOf(file.name);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler imagem.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Falha ao carregar imagem.'));
    image.src = src;
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality = 0.92) {
  return canvas.toDataURL('image/jpeg', quality);
}

function resizeDimensions(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function imageToCanvas(image: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível.');
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, ctx };
}

function detectDocumentBounds(canvas: HTMLCanvasElement) {
  const { width, height } = resizeDimensions(canvas.width, canvas.height, DETECTION_MAX_SIDE);
  const { ctx } = imageToCanvas(canvas, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const gray = new Float32Array(width * height);
  let borderSum = 0;
  let borderCount = 0;
  let total = 0;

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const grayValue = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    gray[pixel] = grayValue;
    total += grayValue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < 6 || y < 6 || x >= width - 6 || y >= height - 6) {
      borderSum += grayValue;
      borderCount += 1;
    }
  }

  const avg = total / gray.length;
  const bg = borderCount > 0 ? borderSum / borderCount : avg;
  let variance = 0;
  for (let i = 0; i < gray.length; i += 1) variance += (gray[i] - avg) ** 2;
  const stdDev = Math.sqrt(variance / gray.length);
  const threshold = Math.max(18, stdDev * 0.8);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = gray[y * width + x];
      if (Math.abs(value - bg) > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height, cropRatio: 1 };
  }

  const paddingX = Math.round((maxX - minX) * 0.06);
  const paddingY = Math.round((maxY - minY) * 0.06);
  minX = clamp(minX - paddingX, 0, width - 1);
  minY = clamp(minY - paddingY, 0, height - 1);
  maxX = clamp(maxX + paddingX, 0, width - 1);
  maxY = clamp(maxY + paddingY, 0, height - 1);

  const cropRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height);
  if (cropRatio < 0.2) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height, cropRatio: 1 };
  }

  const scaleX = canvas.width / width;
  const scaleY = canvas.height / height;
  return {
    x: Math.round(minX * scaleX),
    y: Math.round(minY * scaleY),
    width: Math.round((maxX - minX + 1) * scaleX),
    height: Math.round((maxY - minY + 1) * scaleY),
    cropRatio,
  };
}

function stretchContrast(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const histogram = new Uint32Array(256);

  for (let index = 0; index < data.length; index += 4) {
    const grayValue = Math.round(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]);
    histogram[grayValue] += 1;
  }

  const pixelCount = canvas.width * canvas.height;
  const lowCut = pixelCount * 0.02;
  const highCut = pixelCount * 0.98;
  let cumulative = 0;
  let min = 0;
  let max = 255;

  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= lowCut) {
      min = i;
      break;
    }
  }

  cumulative = 0;
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= highCut) {
      max = i;
      break;
    }
  }

  if (max <= min) return;

  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const raw = data[index + channel];
      data[index + channel] = clamp(((raw - min) * 255) / (max - min), 0, 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function applyGray(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const grayValue = Math.round(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]);
    data[index] = grayValue;
    data[index + 1] = grayValue;
    data[index + 2] = grayValue;
  }

  ctx.putImageData(imageData, 0, 0);
}

function applyDocumentEnhancement(canvas: HTMLCanvasElement) {
  applyGray(canvas);
  stretchContrast(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const grayValue = data[index];
    const normalized = grayValue > 162 ? 255 : grayValue < 104 ? 28 : grayValue;
    data[index] = normalized;
    data[index + 1] = normalized;
    data[index + 2] = normalized;
  }

  ctx.putImageData(imageData, 0, 0);
}

function computeMetrics(canvas: HTMLCanvasElement, cropRatio: number): ScannerMetrics {
  const { width, height } = resizeDimensions(canvas.width, canvas.height, 256);
  const { ctx } = imageToCanvas(canvas, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);

  let sum = 0;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const grayValue = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    gray[pixel] = grayValue;
    sum += grayValue;
  }

  const brightness = sum / gray.length;
  let variance = 0;
  let edgeAccum = 0;
  let edgeCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = gray[index];
      variance += (value - brightness) ** 2;
      if (x > 0) {
        edgeAccum += Math.abs(value - gray[index - 1]);
        edgeCount += 1;
      }
      if (y > 0) {
        edgeAccum += Math.abs(value - gray[index - width]);
        edgeCount += 1;
      }
    }
  }

  return {
    brightness,
    contrast: Math.sqrt(variance / gray.length),
    sharpness: edgeCount > 0 ? edgeAccum / edgeCount : 0,
    cropRatio,
  };
}

function qualityFromMetrics(metrics: ScannerMetrics) {
  // Thresholds intencionalmente permissivos: o módulo aceita documentos,
  // prints, fotos de produtos, capturas de tela e qualquer prova visual.
  // Só rejeita casos extremos que tornam a imagem literalmente inutilizável.
  if (metrics.brightness < 20) return { quality: 'ruim' as const, reason: 'Imagem muito escura.' };
  if (metrics.brightness > 252) return { quality: 'ruim' as const, reason: 'Imagem completamente estourada.' };
  if (metrics.contrast < 6)    return { quality: 'ruim' as const, reason: 'Imagem sem contraste (tela apagada?).' };
  if (metrics.sharpness < 3)   return { quality: 'ruim' as const, reason: 'Foto extremamente desfocada.' };
  return { quality: 'ok' as const, reason: 'Imagem utilizável.' };
}

function parseAiJson(content: string): AiScanAnalysis | null {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<AiScanAnalysis>;
    if (!parsed.name || !parsed.quality) return null;
    return {
      name: parsed.name,
      quality: parsed.quality === 'ruim' ? 'ruim' : 'ok',
      reason: parsed.reason || (parsed.quality === 'ruim' ? 'Imagem ruim.' : 'Documento legível.'),
    };
  } catch {
    return null;
  }
}

async function analyzeWithAi(dataUrl: string, fallbackName: string, metrics: ScannerMetrics): Promise<AiScanAnalysis | null> {
  try {
    const { data, error } = await supabasePortal.functions.invoke('openai-proxy', {
      body: {
        model: 'gpt-4o-mini',
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content: 'Você avalia imagens enviadas por clientes para um portal jurídico. As imagens podem ser: documentos, prints de conversa, fotos de produtos, comprovantes, evidências, capturas de tela, etc. Responda SOMENTE em JSON com as chaves: name, quality, reason. quality deve ser "ok" ou "ruim". name deve ser curto, em português, minúsculo, descritivo, sem espaços (use underscore). Só marque "ruim" se a imagem for REALMENTE inutilizável (completamente preta, branca, tremida ao ponto de ser ilegível). Fotos de produtos, prints e evidências visuais são válidas.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `Avalie se esta imagem tem conteúdo visível e utilizável. ` +
                  `Métricas: brilho=${metrics.brightness.toFixed(1)}, contraste=${metrics.contrast.toFixed(1)}, nitidez=${metrics.sharpness.toFixed(1)}. ` +
                  `Pode ser documento, print, foto de produto, evidência ou qualquer imagem com conteúdo relevante. ` +
                  `Só retorne quality="ruim" se for COMPLETAMENTE ilegível. ` +
                  `Sugira um nome descritivo curto em português. ` +
                  `Fallback: ${fallbackName}. Exemplo: {"name":"print_conversa","quality":"ok","reason":"Imagem com conteúdo visível."}`,
              },
              {
                type: 'image_url',
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
      },
    });

    if (error) return null;
    const content = (data as any)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return parseAiJson(content);
  } catch {
    return null;
  }
}

export async function extractScannerOcr(dataUrl: string): Promise<string | null> {
  try {
    const { data, error } = await supabasePortal.functions.invoke('openai-proxy', {
      body: {
        model: 'gpt-4o-mini',
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content: 'Extraia o texto visível da imagem. Pode ser documento, print de conversa, foto de produto, comprovante ou qualquer imagem com texto. Responda somente com o texto extraído, sem comentários adicionais.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extraia todo o texto visível desta imagem.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      },
    });

    if (error) return null;
    const content = (data as any)?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : null;
  } catch {
    return null;
  }
}

function sampleBilinear(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = clampedX - x0;
  const dy = clampedY - y0;

  const index = (px: number, py: number) => (py * width + px) * 4;
  const i00 = index(x0, y0);
  const i10 = index(x1, y0);
  const i01 = index(x0, y1);
  const i11 = index(x1, y1);

  const out = [0, 0, 0, 255];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = data[i00 + channel] * (1 - dx) + data[i10 + channel] * dx;
    const bottom = data[i01 + channel] * (1 - dx) + data[i11 + channel] * dx;
    out[channel] = top * (1 - dy) + bottom * dy;
  }
  return out;
}

function warpQuadToCanvas(image: HTMLImageElement, quad: ScannerQuad) {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) throw new Error('Canvas indisponível.');
  sourceCtx.drawImage(image, 0, 0);
  const sourceImage = sourceCtx.getImageData(0, 0, image.width, image.height);

  const pixelQuad = {
    tl: { x: quad.tl.x * image.width, y: quad.tl.y * image.height },
    tr: { x: quad.tr.x * image.width, y: quad.tr.y * image.height },
    br: { x: quad.br.x * image.width, y: quad.br.y * image.height },
    bl: { x: quad.bl.x * image.width, y: quad.bl.y * image.height },
  };

  const topWidth = distance(pixelQuad.tl, pixelQuad.tr);
  const bottomWidth = distance(pixelQuad.bl, pixelQuad.br);
  const leftHeight = distance(pixelQuad.tl, pixelQuad.bl);
  const rightHeight = distance(pixelQuad.tr, pixelQuad.br);
  const outputWidth = Math.max(1, Math.round((topWidth + bottomWidth) / 2));
  const outputHeight = Math.max(1, Math.round((leftHeight + rightHeight) / 2));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outputWidth;
  outCanvas.height = outputHeight;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Canvas indisponível.');
  const outImage = outCtx.createImageData(outputWidth, outputHeight);

  for (let y = 0; y < outputHeight; y += 1) {
    const v = outputHeight === 1 ? 0 : y / (outputHeight - 1);
    for (let x = 0; x < outputWidth; x += 1) {
      const u = outputWidth === 1 ? 0 : x / (outputWidth - 1);
      const sx =
        pixelQuad.tl.x * (1 - u) * (1 - v) +
        pixelQuad.tr.x * u * (1 - v) +
        pixelQuad.br.x * u * v +
        pixelQuad.bl.x * (1 - u) * v;
      const sy =
        pixelQuad.tl.y * (1 - u) * (1 - v) +
        pixelQuad.tr.y * u * (1 - v) +
        pixelQuad.br.y * u * v +
        pixelQuad.bl.y * (1 - u) * v;
      const rgba = sampleBilinear(sourceImage.data, image.width, image.height, sx, sy);
      const destIndex = (y * outputWidth + x) * 4;
      outImage.data[destIndex] = rgba[0];
      outImage.data[destIndex + 1] = rgba[1];
      outImage.data[destIndex + 2] = rgba[2];
      outImage.data[destIndex + 3] = rgba[3];
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  return outCanvas;
}

async function buildImageVariant({ sourceDataUrl, crop, quad, rotation = 0, enhancement = 'color' }: ImageVariantOptions) {
  const image = await loadImage(sourceDataUrl);
  const safeCrop = normalizeCrop(crop);
  const safeQuad = normalizeQuad(quad, safeCrop);
  const cropCanvas = warpQuadToCanvas(image, safeQuad);

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotatedCanvas = document.createElement('canvas');
  const swapSides = normalizedRotation === 90 || normalizedRotation === 270;
  rotatedCanvas.width = swapSides ? cropCanvas.height : cropCanvas.width;
  rotatedCanvas.height = swapSides ? cropCanvas.width : cropCanvas.height;
  const rotatedCtx = rotatedCanvas.getContext('2d');
  if (!rotatedCtx) throw new Error('Canvas indisponível.');

  rotatedCtx.save();
  rotatedCtx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  rotatedCtx.rotate((normalizedRotation * Math.PI) / 180);
  rotatedCtx.drawImage(cropCanvas, -cropCanvas.width / 2, -cropCanvas.height / 2);
  rotatedCtx.restore();

  if (enhancement === 'gray') applyGray(rotatedCanvas);
  if (enhancement === 'document') applyDocumentEnhancement(rotatedCanvas);
  if (enhancement === 'color') stretchContrast(rotatedCanvas);

  const metrics = computeMetrics(rotatedCanvas, safeCrop.width * safeCrop.height);
  const localQuality = qualityFromMetrics(metrics);

  return {
    dataUrl: canvasToDataUrl(rotatedCanvas, 0.92),
    width: rotatedCanvas.width,
    height: rotatedCanvas.height,
    metrics,
    quality: localQuality.quality,
    reason: localQuality.reason,
    rotation: normalizedRotation,
    enhancement,
    crop: safeCrop,
    quad: safeQuad,
  };
}

export async function processScanFile({ file, index }: ProcessScanParams): Promise<ScannerItem> {
  if (detectScannerFileKind(file) !== 'image') throw new Error('Envie imagem JPG, PNG, WEBP ou HEIC.');

  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const resized = resizeDimensions(image.width, image.height, EXPORT_MAX_SIDE);
  const { canvas: baseCanvas } = imageToCanvas(image, resized.width, resized.height);
  const resizedSourceDataUrl = canvasToDataUrl(baseCanvas, 0.94);
  const bounds = detectDocumentBounds(baseCanvas);
  const crop: ScannerCrop = normalizeCrop({
    x: bounds.x / baseCanvas.width,
    y: bounds.y / baseCanvas.height,
    width: bounds.width / baseCanvas.width,
    height: bounds.height / baseCanvas.height,
  });
  const quad = cropToQuad(crop);

  const initialVariant = await buildImageVariant({
    sourceDataUrl: resizedSourceDataUrl,
    crop,
    quad,
    rotation: 0,
    enhancement: 'color',
  });

  const fallbackBaseName = `scanner_${String(index).padStart(3, '0')}`;

  return {
    id: makeId(),
    originalName: file.name,
    suggestedName: fallbackBaseName,
    fileKind: 'image',
    mimeType: 'image/jpeg',
    quality: initialVariant.quality,
    reason: initialVariant.reason,
    createdAt: new Date().toISOString(),
    width: initialVariant.width,
    height: initialVariant.height,
    dataUrl: initialVariant.dataUrl,
    originalDataUrl: resizedSourceDataUrl,
    rotation: initialVariant.rotation,
    enhancement: initialVariant.enhancement,
    crop: initialVariant.crop,
    quad: initialVariant.quad,
    metrics: initialVariant.metrics,
  };
}

export async function enrichScanItemWithAi(item: ScannerItem): Promise<Partial<ScannerItem>> {
  if (item.fileKind !== 'image' || !item.dataUrl) return {};
  const aiResult = await analyzeWithAi(item.dataUrl, item.suggestedName, item.metrics);
  if (!aiResult) return {};
  return {
    quality: aiResult.quality,
    reason: aiResult.reason,
    suggestedName: sanitizeName(aiResult.name, item.suggestedName),
  };
}

export async function updateScannerImage(
  item: ScannerItem,
  updates: { rotation?: number; enhancement?: ScannerEnhancement; crop?: ScannerCrop; quad?: ScannerQuad },
) {
  if (item.fileKind !== 'image') return item;
  const sourceDataUrl = item.originalDataUrl || item.dataUrl;
  const next = await buildImageVariant({
    sourceDataUrl,
    crop: updates.crop ?? item.crop,
    quad: updates.quad ?? item.quad,
    rotation: updates.rotation ?? item.rotation ?? 0,
    enhancement: updates.enhancement ?? item.enhancement ?? 'color',
  });

  return {
    ...item,
    dataUrl: next.dataUrl,
    width: next.width,
    height: next.height,
    metrics: next.metrics,
    quality: next.quality,
    reason: next.reason,
    rotation: next.rotation,
    enhancement: next.enhancement,
    crop: next.crop,
    quad: next.quad,
    originalDataUrl: sourceDataUrl,
  };
}

export async function processPdfFile({ file, index }: ProcessScanParams): Promise<ScannerItem> {
  if (detectScannerFileKind(file) !== 'pdf') throw new Error('Envie um PDF válido.');

  const fallbackBaseName = `arquivo_${String(index).padStart(3, '0')}`;
  const suggestedName = sanitizeName(fileNameWithoutExtension(file.name), fallbackBaseName);

  return {
    id: makeId(),
    originalName: file.name,
    suggestedName,
    fileKind: 'pdf',
    mimeType: file.type || 'application/pdf',
    quality: 'ok',
    reason: 'PDF enviado.',
    createdAt: new Date().toISOString(),
    width: 0,
    height: 0,
    dataUrl: '',
    fileBlob: file,
    metrics: { brightness: 0, contrast: 0, sharpness: 0, cropRatio: 0 },
  };
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, body] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
