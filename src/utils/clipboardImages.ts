// Imagens vindas da área de transferência (print da tela, "copiar imagem" no
// navegador, copiar um arquivo no Finder/Explorer).
//
// Um print colado no compositor chega como arquivo sem nome útil: o Chrome
// entrega "image.png" para todo print, e o Safari às vezes entrega nome vazio.
// Se isso for direto para o WhatsApp, o cliente recebe vários anexos chamados
// "image.png" e o histórico do CRM fica impossível de ler. Por isso o nome é
// reescrito com a data e a hora da colagem.
//
// Sem imports de propósito: mantém as funções puras testáveis pelo `npm test`.

/** O item colado é uma imagem que faz sentido enviar como anexo? */
export function isPastedImage(mime: string | null | undefined): boolean {
  const t = (mime || '').toLowerCase();
  // SVG cola como imagem mas o WhatsApp não renderiza — vira documento inútil.
  return t.startsWith('image/') && t !== 'image/svg+xml';
}

/** Extensão a partir do MIME, com os tipos que o WhatsApp aceita como imagem. */
export function extensionForImage(mime: string | null | undefined): string {
  const t = (mime || '').toLowerCase();
  if (t === 'image/jpeg' || t === 'image/jpg') return 'jpg';
  if (t === 'image/webp') return 'webp';
  if (t === 'image/gif') return 'gif';
  if (t === 'image/heic') return 'heic';
  return 'png';
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/**
 * Nome final do anexo colado. Nomes genéricos ("image.png", "", "unknown")
 * viram `print-AAAA-MM-DD-HH-mm-ss.ext`; um nome de verdade (arquivo copiado do
 * Finder, por exemplo) é preservado.
 */
export function pastedImageName(originalName: string | null | undefined, mime: string, now: Date): string {
  const nome = (originalName || '').trim();
  const generico = !nome || /^(image|imagem|unknown|screenshot|captura)(\s*\(\d+\))?\.\w+$/i.test(nome);
  if (!generico) return nome;
  const carimbo = [
    now.getFullYear(), doisDigitos(now.getMonth() + 1), doisDigitos(now.getDate()),
    doisDigitos(now.getHours()), doisDigitos(now.getMinutes()), doisDigitos(now.getSeconds()),
  ].join('-');
  return `print-${carimbo}.${extensionForImage(mime)}`;
}

/**
 * Só o que a colagem tem de imagem — texto e demais tipos ficam de fora.
 *
 * Lê `files` E `items`: um print da tela nem sempre aparece nos dois. Dependendo
 * do navegador e do sistema, `clipboardData.files` vem vazio e a imagem só
 * existe em `clipboardData.items` (kind 'file'), que é o caminho clássico para
 * captura de tela. Ler só um dos dois faz a colagem falhar em silêncio.
 */
export function imagesFromClipboard(data: DataTransfer | null, now: Date = new Date()): File[] {
  if (!data) return [];
  let brutos = Array.from(data.files || []).filter(f => isPastedImage(f.type));
  if (brutos.length === 0) {
    brutos = Array.from(data.items || [])
      .filter(it => it.kind === 'file' && isPastedImage(it.type))
      .map(it => it.getAsFile())
      .filter((f): f is File => !!f);
  }
  return brutos.map(f => {
    const nome = pastedImageName(f.name, f.type, now);
    return nome === f.name ? f : new File([f], nome, { type: f.type });
  });
}
