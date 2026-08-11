// Leitura do texto do WhatsApp: transforma *negrito*, _itálico_, ~riscado~ e
// ```mono``` nos trechos estilizados que a interface desenha, e tira a linha de
// assinatura do atendente (`*Dr. Pedro:*\n`) que o compositor cola no envio.
//
// Por que existe: o WhatsApp não guarda formatação — a marcação É o texto. Quem
// renderiza é o app do contato. Sem isto, tudo que passa pela barra de formatação
// aparece cru para o atendente (`*_~tudo bem~_*`) em qualquer lugar do CRM que
// mostre o conteúdo antes de ele virar bolha: fila de agendadas, retidas por
// reconexão, prévia da lista.
//
// É o par de leitura do composerFormat.ts (que escreve as marcas). Sem imports
// de propósito: mantém as funções puras testáveis pelo `npm test`.

export interface WaTextNode {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
  /** Endereço pronto para abrir (com esquema). Presente = o trecho é um link. */
  link?: string;
}

type Estilo = Omit<WaTextNode, 'text' | 'link'>;

// Ordem importa: ``` antes de ` (a mais longa ganha), e mono antes das demais —
// dentro de monoespaçado o WhatsApp não interpreta mais nada.
const MARCAS: Array<{ marca: string; chave: keyof Estilo; recursivo: boolean }> = [
  { marca: '```', chave: 'mono', recursivo: false },
  { marca: '`', chave: 'mono', recursivo: false },
  { marca: '*', chave: 'bold', recursivo: true },
  { marca: '_', chave: 'italic', recursivo: true },
  { marca: '~', chave: 'strike', recursivo: true },
];

const ehPalavra = (ch: string): boolean => !!ch && /[\p{L}\p{N}]/u.test(ch);
const ehEspaco = (ch: string): boolean => !!ch && /\s/.test(ch);

interface Abertura { inicio: number; fim: number; marca: string; chave: keyof Estilo; recursivo: boolean }

/**
 * Há marcação começando exatamente em `i`? Devolve os limites do conteúdo.
 *
 * As regras seguem o que o WhatsApp de fato renderiza: a marca não vale com
 * espaço logo depois (`* texto*`), nem sem conteúdo (`**`), e `_` só abre em
 * fronteira de palavra — senão `nome_do_arquivo_final` viraria itálico.
 */
function aberturaEm(text: string, i: number, estilo: Estilo): Abertura | null {
  for (const { marca, chave, recursivo } of MARCAS) {
    if (estilo[chave]) continue;                  // já dentro desse formato
    if (!text.startsWith(marca, i)) continue;
    const inicio = i + marca.length;
    if (ehEspaco(text[inicio]) || inicio >= text.length) continue;
    if (marca === '_' && ehPalavra(text[i - 1])) continue;

    // Fechamento: primeira ocorrência da marca com conteúdo que não termina em
    // espaço. Sem fechamento a marca é texto comum (é o que o WhatsApp faz).
    let busca = inicio + 1;
    while (busca < text.length) {
      const fim = text.indexOf(marca, busca);
      if (fim < 0) break;
      const conteudoOk = fim > inicio && !ehEspaco(text[fim - 1]);
      const bordaOk = marca !== '_' || !ehPalavra(text[fim + marca.length]);
      if (conteudoOk && bordaOk) return { inicio, fim, marca, chave, recursivo };
      busca = fim + marca.length;
    }
  }
  return null;
}

function percorrer(text: string, estilo: Estilo, out: WaTextNode[]): void {
  let plano = '';
  const despejar = () => { if (plano) { out.push({ text: plano, ...estilo }); plano = ''; } };

  let i = 0;
  while (i < text.length) {
    const ab = aberturaEm(text, i, estilo);
    if (!ab) { plano += text[i]; i += 1; continue; }
    despejar();
    const conteudo = text.slice(ab.inicio, ab.fim);
    const novo: Estilo = { ...estilo, [ab.chave]: true };
    if (ab.recursivo) percorrer(conteudo, novo, out);
    else out.push({ text: conteudo, ...novo });
    i = ab.fim + ab.marca.length;
  }
  despejar();
}

// ── Endereços ────────────────────────────────────────────────────────────────
//
// Por que o reconhecimento vem ANTES da leitura das marcas: dentro de um link há
// caracteres que também são marcação. `https://sistema.tj.br/consulta_de_autos_`
// tem dois `_` em fronteira de palavra — o leitor de estilo abriria itálico no
// meio do endereço e o link sairia partido em pedaços, sem forma de remontar.
// Achando o endereço primeiro, ele sai inteiro e só o texto ao redor é estilizado.

// Sem esquema e sem `www.`, só vira link com um domínio de topo conhecido. Sem
// essa lista, `contrato.pdf` e `parecer.docx` — que o escritório escreve o dia
// inteiro — virariam links quebrados.
const DOMINIOS_DE_TOPO = 'br|com|net|org|gov|edu|io|app|dev|me|info|co|tv|online|site|pt|us|uk';

// `*` e crase ficam de fora do corpo do endereço: são as marcas com que se
// envolve um link (`*https://…*`) e quase nunca aparecem dentro de um de
// verdade. `_` e `~` continuam valendo — esses SÃO comuns em URLs de sistemas.
const CORPO = '[^\\s*`<>"]';

const PADRAO_LINK = new RegExp([
  `https?:\\/\\/${CORPO}+`,                                          // com esquema
  `www\\.${CORPO}+`,                                                 // começando por www.
  '[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.\\p{L}{2,}',             // e-mail
  `[\\p{L}\\p{N}][\\p{L}\\p{N}-]*(?:\\.[\\p{L}\\p{N}-]+)*\\.(?:${DOMINIOS_DE_TOPO})(?![\\p{L}\\p{N}])(?:[\\/?#]${CORPO}*)?`,
].join('|'), 'giu');

const PARES = new Map([[')', '('], [']', '['], ['}', '{']]);
const PONTUACAO_FINAL = '.,;:!?…"\'';

/**
 * Tira do fim do endereço a pontuação da FRASE, que o casamento ganancioso
 * arrastou junto: em "veja em jurius.com.br." o ponto encerra a frase, não o
 * endereço. Fecha-parênteses só sai se não houver o abre correspondente dentro
 * do próprio endereço — senão um link de Wikipédia perderia o final.
 */
function apararFim(bruto: string): string {
  let s = bruto;
  while (s.length > 1) {
    const ultimo = s[s.length - 1];
    if (PONTUACAO_FINAL.includes(ultimo)) { s = s.slice(0, -1); continue; }
    const abre = PARES.get(ultimo);
    if (abre && s.split(ultimo).length > s.split(abre).length) { s = s.slice(0, -1); continue; }
    break;
  }
  return s;
}

/** Endereço para navegação: o que está escrito nem sempre tem esquema. */
function hrefDe(texto: string): string {
  if (/^https?:\/\//i.test(texto)) return texto;
  if (texto.includes('@') && !texto.includes('/')) return `mailto:${texto}`;
  return `https://${texto}`;
}

interface TrechoLink { inicio: number; fim: number; texto: string; href: string }

/** Endereços do texto, em ordem e sem sobreposição. */
function acharLinks(text: string): TrechoLink[] {
  const achados: TrechoLink[] = [];
  PADRAO_LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PADRAO_LINK.exec(text)) !== null) {
    const texto = apararFim(m[0]);
    if (!texto) continue;
    achados.push({ inicio: m.index, fim: m.index + texto.length, texto, href: hrefDe(texto) });
    // O recuo do `lastIndex` devolve ao texto comum a pontuação aparada — sem
    // isto, o ponto final da frase sumiria da bolha.
    PADRAO_LINK.lastIndex = m.index + texto.length;
  }
  return achados;
}

/**
 * Quebra o texto em trechos com o estilo que o WhatsApp aplicaria, com os
 * endereços isolados em nós próprios (`link`) para a interface desenhar como
 * âncora clicável.
 */
export function parseWaRich(text: string): WaTextNode[] {
  if (!text) return [];
  const out: WaTextNode[] = [];
  let cursor = 0;
  for (const l of acharLinks(text)) {
    if (l.inicio > cursor) percorrer(text.slice(cursor, l.inicio), {}, out);
    out.push({ text: l.texto, link: l.href });
    cursor = l.fim;
  }
  if (cursor < text.length) percorrer(text.slice(cursor), {}, out);
  return out;
}

/** Mesmo texto, só que sem as marcas — para prévias de uma linha. */
export function waPlainText(text: string): string {
  return parseWaRich(text).map(n => n.text).join('');
}

/**
 * Tira o `*Nome:*` que o compositor cola na primeira linha do envio manual.
 * A bolha já escondia essa linha; a fila de agendadas/retidas mostrava crua.
 */
export function stripAgentSignature(text: string): string {
  return text.replace(/^\*[^*\n]+:\*\n/, '');
}
