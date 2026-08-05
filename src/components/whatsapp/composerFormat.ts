// Formatação do texto da mensagem no padrão do WhatsApp: *negrito*, _itálico_,
// ~riscado~ e ```monoespaçado```.
//
// O WhatsApp não tem editor rico — a formatação É o texto, marcada com esses
// caracteres. Então formatar aqui é envolver (ou desenvolver) o trecho
// selecionado, e o resultado precisa devolver a nova seleção para o atendente
// continuar de onde estava, inclusive encadeando negrito + itálico.
//
// Sem imports de propósito: mantém as funções puras testáveis pelo `npm test`.

export type WaFormat = 'bold' | 'italic' | 'strike' | 'mono';

export const WA_MARKERS: Record<WaFormat, string> = {
  bold: '*',
  italic: '_',
  strike: '~',
  mono: '```',
};

export interface WaFormatResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  /** Falso quando não havia o que formatar — o chamador não mexe no campo. */
  changed: boolean;
}

/** O trecho já está entre as marcas, contando-as dentro da própria seleção? */
function marcadoPorDentro(trecho: string, marca: string): boolean {
  return trecho.length >= marca.length * 2
    && trecho.startsWith(marca) && trecho.endsWith(marca);
}

/** O trecho está entre as marcas, mas elas ficaram FORA da seleção? */
function marcadoPorFora(text: string, start: number, end: number, marca: string): boolean {
  return start >= marca.length
    && text.slice(start - marca.length, start) === marca
    && text.slice(end, end + marca.length) === marca;
}

/**
 * Aplica (ou remove) a marcação do WhatsApp no trecho selecionado.
 *
 * Espaço nas pontas da seleção fica de fora das marcas: o WhatsApp não
 * renderiza `* texto *`, e selecionar arrastando quase sempre leva um espaço
 * junto — sem esta aparagem o atendente marcaria em negrito e nada aconteceria
 * na conversa do cliente.
 *
 * Reaplicar o mesmo formato desmarca, seja a marca parte da seleção ou não:
 * clicar em "B" duas vezes tem que voltar ao texto simples.
 */
export function applyWaFormat(text: string, start: number, end: number, fmt: WaFormat): WaFormatResult {
  const marca = WA_MARKERS[fmt];
  const nada: WaFormatResult = { text, selectionStart: start, selectionEnd: end, changed: false };

  if (start > end) [start, end] = [end, start];
  if (start < 0 || end > text.length || start === end) return nada;

  // Apara os espaços das pontas antes de decidir qualquer coisa.
  const bruto = text.slice(start, end);
  const antes = bruto.length - bruto.trimStart().length;
  const depois = bruto.length - bruto.trimEnd().length;
  const ini = start + antes;
  const fim = end - depois;
  if (ini >= fim) return nada; // seleção só de espaço

  const trecho = text.slice(ini, fim);

  if (marcadoPorDentro(trecho, marca)) {
    const limpo = trecho.slice(marca.length, trecho.length - marca.length);
    return {
      text: text.slice(0, ini) + limpo + text.slice(fim),
      selectionStart: ini,
      selectionEnd: ini + limpo.length,
      changed: true,
    };
  }

  if (marcadoPorFora(text, ini, fim, marca)) {
    return {
      text: text.slice(0, ini - marca.length) + trecho + text.slice(fim + marca.length),
      selectionStart: ini - marca.length,
      selectionEnd: ini - marca.length + trecho.length,
      changed: true,
    };
  }

  return {
    text: text.slice(0, ini) + marca + trecho + marca + text.slice(fim),
    selectionStart: ini + marca.length,
    selectionEnd: ini + marca.length + trecho.length,
    changed: true,
  };
}

/** Atalho de teclado do compositor → formato. Null quando a tecla não é nossa. */
export function formatFromKey(key: string, ctrlOrMeta: boolean, shift: boolean): WaFormat | null {
  if (!ctrlOrMeta) return null;
  const k = key.toLowerCase();
  if (k === 'b') return 'bold';
  if (k === 'i') return 'italic';
  // Ctrl+Shift+X para riscado: Ctrl+X sozinho é recortar e não pode ser roubado.
  if (shift && k === 'x') return 'strike';
  return null;
}
