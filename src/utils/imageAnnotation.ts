// Anotação sobre a imagem antes de enviar: lápis, marca-texto, seta, retângulo,
// tarja de censura e texto.
//
// Tudo é guardado NORMALIZADO (0..1) em relação à imagem, nunca em pixels de
// tela. É isso que faz a anotação continuar no mesmo lugar quando a janela muda
// de tamanho e, principalmente, quando é achatada na resolução original da
// imagem no envio — trabalhar em coordenadas de tela produziria um resultado
// deslocado e menor no arquivo final.
//
// Sem imports de propósito: mantém as funções puras testáveis pelo `npm test`.

export type AnnotationKind = 'pen' | 'marker' | 'arrow' | 'rect' | 'redact' | 'text';

/** Ponto normalizado: 0 = borda esquerda/topo, 1 = borda direita/base. */
export interface AnnotationPoint { x: number; y: number }

interface Base { color: string; size: number }
/** Traço à mão livre. */
export interface FreehandItem extends Base { kind: 'pen' | 'marker'; points: AnnotationPoint[] }
/** Forma de dois pontos (arrastar da origem ao destino). */
export interface ShapeItem extends Base { kind: 'arrow' | 'rect' | 'redact'; from: AnnotationPoint; to: AnnotationPoint }
/** Texto solto sobre a imagem. */
export interface TextItem extends Base { kind: 'text'; at: AnnotationPoint; text: string }

export type AnnotationItem = FreehandItem | ShapeItem | TextItem;

/** Retângulo da imagem na tela (só o que `getBoundingClientRect` dá). */
export interface ScreenRect { left: number; top: number; width: number; height: number }

export const isFreehand = (i: AnnotationItem): i is FreehandItem => i.kind === 'pen' || i.kind === 'marker';
export const isShape = (i: AnnotationItem): i is ShapeItem => i.kind === 'arrow' || i.kind === 'rect' || i.kind === 'redact';
export const isText = (i: AnnotationItem): i is TextItem => i.kind === 'text';

/** Marca-texto é grosso e translúcido; o resto é opaco. */
export const KIND_ALPHA: Record<AnnotationKind, number> = {
  pen: 1, marker: 0.4, arrow: 1, rect: 1, redact: 1, text: 1,
};
export const KIND_WIDTH_FACTOR: Record<AnnotationKind, number> = {
  pen: 1, marker: 2.8, arrow: 1.3, rect: 1.3, redact: 1, text: 1,
};

/** Quanto o tamanho escolhido vira fonte, em relação à largura da imagem. */
export const TEXT_SCALE = 2.4;

export const ANNOTATION_COLORS = [
  { nome: 'Amarelo', valor: '#ffd400' },
  { nome: 'Vermelho', valor: '#ff3b30' },
  { nome: 'Verde', valor: '#34c759' },
  { nome: 'Azul', valor: '#0a84ff' },
  { nome: 'Branco', valor: '#ffffff' },
  { nome: 'Preto', valor: '#1c1c1e' },
];

export const ANNOTATION_SIZES = [
  { nome: 'Fino', valor: 0.005 },
  { nome: 'Médio', valor: 0.011 },
  { nome: 'Grosso', valor: 0.022 },
];

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Converte a posição do ponteiro na tela para coordenada normalizada da imagem.
 * Fora das bordas o ponto é grampeado: arrastar para fora encosta a anotação na
 * borda em vez de sumir ou esticar o desenho.
 */
export function pointFromPointer(clientX: number, clientY: number, rect: ScreenRect): AnnotationPoint {
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** Espessura em pixels para a largura de imagem informada (mínimo visível: 1px). */
export function strokeWidthPx(item: Pick<AnnotationItem, 'kind' | 'size'>, imageWidth: number): number {
  return Math.max(1, item.size * imageWidth * KIND_WIDTH_FACTOR[item.kind]);
}

/** Tamanho da fonte em pixels para a largura de imagem informada. */
export function fontSizePx(size: number, imageWidth: number): number {
  return Math.max(11, size * imageWidth * TEXT_SCALE);
}

/** A anotação tem conteúdo de verdade? Clique solto e texto vazio não entram. */
export function hasInk(item: AnnotationItem): boolean {
  if (isFreehand(item)) return item.points.length > 0;
  if (isText(item)) return item.text.trim().length > 0;
  // Forma "de zero área" é clique sem arrasto — não vira nada.
  return Math.abs(item.to.x - item.from.x) > 0.002 || Math.abs(item.to.y - item.from.y) > 0.002;
}

/** Remove a última anotação (desfazer). Devolve nova lista, sem mutar a original. */
export function undoLast(items: AnnotationItem[]): AnnotationItem[] {
  return items.slice(0, -1);
}

/** Mede a largura de uma linha na fonte informada (o canvas fornece isto). */
export type MedirTexto = (linha: string, fontPx: number) => number;

/** Caixa ocupada pelo texto, em pixels da imagem renderizada. */
export function textBoundsPx(
  item: TextItem, medir: MedirTexto, width: number, height: number,
): { x: number; y: number; w: number; h: number } {
  const px = fontSizePx(item.size, width);
  const linhas = item.text.split('\n');
  const w = Math.max(...linhas.map(l => medir(l, px)), 1);
  return { x: item.at.x * width, y: item.at.y * height, w, h: linhas.length * px * 1.25 };
}

/**
 * Qual texto está sob o ponto? Devolve o índice, ou null.
 *
 * Percorre de trás para frente porque o desenho é feito na ordem da lista: o
 * último é o que está por cima, e é ele que o clique deve pegar. A folga de
 * alguns pixels existe porque acertar a caixa exata de um texto fino é difícil
 * no mouse e impossível no toque.
 */
export function hitTestText(
  items: AnnotationItem[], pointX: number, pointY: number,
  medir: MedirTexto, width: number, height: number,
): number | null {
  const folga = Math.max(6, width * 0.006);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!isText(item) || !hasInk(item)) continue;
    const b = textBoundsPx(item, medir, width, height);
    if (pointX >= b.x - folga && pointX <= b.x + b.w + folga
      && pointY >= b.y - folga && pointY <= b.y + b.h + folga) return i;
  }
  return null;
}

function drawFreehand(ctx: CanvasRenderingContext2D, item: FreehandItem, w: number, h: number): void {
  const pts = item.points.map(p => ({ x: p.x * w, y: p.y * h }));
  ctx.lineWidth = strokeWidthPx(item, w);
  // Toque único: um ponto vira bolinha, senão não apareceria nada.
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // A curva passa pelos pontos médios: ligar ponto a ponto com retas deixa o
  // traço serrilhado nos movimentos rápidos, quando o navegador entrega poucos
  // eventos de ponteiro.
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const meio = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, meio.x, meio.y);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

function drawShape(ctx: CanvasRenderingContext2D, item: ShapeItem, w: number, h: number): void {
  const a = { x: item.from.x * w, y: item.from.y * h };
  const b = { x: item.to.x * w, y: item.to.y * h };
  ctx.lineWidth = strokeWidthPx(item, w);

  if (item.kind === 'rect' || item.kind === 'redact') {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const cw = Math.abs(b.x - a.x), ch = Math.abs(b.y - a.y);
    // Tarja de censura é preenchida: serve para cobrir dado sensível do print,
    // então não pode deixar o conteúdo aparecendo por dentro.
    if (item.kind === 'redact') ctx.fillRect(x, y, cw, ch);
    else ctx.strokeRect(x, y, cw, ch);
    return;
  }

  // Seta: haste + duas barbas proporcionais à espessura.
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const barba = Math.max(ctx.lineWidth * 3.2, 8);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - barba * Math.cos(ang - Math.PI / 6), b.y - barba * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(b.x - barba * Math.cos(ang + Math.PI / 6), b.y - barba * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawText(ctx: CanvasRenderingContext2D, item: TextItem, w: number, h: number): void {
  const px = fontSizePx(item.size, w);
  ctx.font = `600 ${px}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = 'top';
  const linhas = item.text.split('\n');
  // Contorno escuro atrás do texto: sem ele, texto claro sobre print claro
  // (ou escuro sobre escuro) fica ilegível.
  ctx.lineWidth = Math.max(2, px * 0.14);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineJoin = 'round';
  linhas.forEach((linha, i) => {
    const x = item.at.x * w;
    const y = item.at.y * h + i * px * 1.25;
    ctx.strokeText(linha, x, y);
    ctx.fillText(linha, x, y);
  });
}

/** Pinta as anotações num contexto 2D de `width` x `height` pixels. */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  items: AnnotationItem[],
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of items) {
    if (!hasInk(item)) continue;
    ctx.globalAlpha = KIND_ALPHA[item.kind];
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    if (isFreehand(item)) drawFreehand(ctx, item, width, height);
    else if (isShape(item)) drawShape(ctx, item, width, height);
    else drawText(ctx, item, width, height);
  }
  ctx.restore();
}

/**
 * Achata imagem + anotações num arquivo novo, na resolução original da imagem.
 * Sem anotação nenhuma devolve o arquivo intacto — não recodifica à toa.
 */
export async function flattenAnnotations(file: File, items: AnnotationItem[]): Promise<File> {
  if (items.filter(hasInk).length === 0) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler a imagem para achatar a anotação.'));
      el.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0);
    drawAnnotations(ctx, items, canvas.width, canvas.height);

    // PNG preserva o traço sem artefato de compressão; JPEG borraria as bordas
    // e — pior — deixaria fantasma legível sob a tarja de censura.
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
    if (!blob) return file;

    const nome = file.name.replace(/\.[^.]+$/, '') + '.png';
    return new File([blob], nome, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
