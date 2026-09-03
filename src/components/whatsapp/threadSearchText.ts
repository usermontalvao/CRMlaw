// O TRECHO que a linha de resultado mostra — e onde, dentro dele, a palavra
// procurada fica marcada.
//
// Duas coisas fazem esta conta não ser um `indexOf`:
//
// 1. ACENTO NÃO PODE SEPARAR. Quem procura digita "pericia", "duvida",
//    "orcamento" — e o que está escrito na conversa é "perícia", "dúvida",
//    "orçamento". O casamento acontece sobre o texto DOBRADO (sem acento, em
//    minúsculas), mas o recorte e a marcação têm de sair sobre o texto
//    ORIGINAL: o resultado mostra o que o cliente escreveu, não uma versão
//    achatada dele. Por isso cada posição do texto dobrado guarda de onde ela
//    veio no original.
//
// 2. A MENSAGEM PODE SER LONGA. Um áudio transcrito de dois minutos tem mil
//    caracteres, e a palavra procurada costuma estar no meio. Mostrar o começo
//    da mensagem responderia à pergunta errada — o que interessa é a frase EM
//    VOLTA da palavra. Daí a janela: alguns caracteres antes, alguns depois, e
//    reticências onde houve corte.
//
// Sem imports de propósito: este módulo tem teste, e import relativo sem
// extensão na cadeia derruba o `npm test` deste projeto.

/** Minúsculas e sem diacrítico — a forma em que a comparação acontece. */
function dobrar(valor: string): string {
  return valor.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

/** Um pedaço casado dentro do texto ORIGINAL: `[ini, fim)`. */
export interface Ocorrencia { ini: number; fim: number; }

/**
 * TODAS as posições em que `termo` aparece em `texto`, sem diferenciar acento,
 * já convertidas para os índices do texto original.
 *
 * É o que permite acender a palavra procurada dentro das bolhas da conversa
 * sem mexer no HTML delas: cada par vira um `Range`, e os Ranges vão para a
 * API de destaque do navegador (`CSS.highlights`). Nenhum nó é criado,
 * removido ou reescrito — o menu da mensagem, a seleção e o copiar continuam
 * exatamente como eram.
 */
export function ocorrenciasNoTexto(
  texto: string | null | undefined,
  termo: string,
  maximo = 200,
): Ocorrencia[] {
  const cru = String(texto ?? '');
  const agulha = dobrar(termo.trim());
  if (!cru || !agulha) return [];

  const { dobrado, ini, fim } = mapear(cru);
  const achadas: Ocorrencia[] = [];
  let de = 0;
  while (achadas.length < maximo) {
    const at = dobrado.indexOf(agulha, de);
    if (at < 0) break;
    const comeco = ini[at];
    const termino = fim[at + agulha.length - 1];
    if (comeco === undefined || termino === undefined) break;
    achadas.push({ ini: comeco, fim: termino });
    // Avança PARA DEPOIS do casamento: sem isso, procurar "aa" em "aaaa"
    // devolveria sobreposições que o navegador desenha empilhadas.
    de = at + agulha.length;
  }
  return achadas;
}

export interface TrechoDoAchado {
  /** O que vem antes da palavra, já cortado na janela. */
  antes: string;
  /** A palavra como ela aparece no texto original (com acento, com caixa). */
  achado: string;
  /** O que vem depois, já cortado na janela. */
  depois: string;
  /** Houve corte à esquerda — a linha desenha "…". */
  cortadoAntes: boolean;
  /** Houve corte à direita. */
  cortadoDepois: boolean;
}

/**
 * Mapa posição-dobrada → intervalo no original.
 *
 * Um caractere pode dobrar para vários (ou para nenhum: o acento solto do NFD
 * some), então a conta não é de um para um. Cada casa do texto dobrado aponta
 * para o pedaço do original que a produziu; um caractere que dobra para nada
 * é grudado no anterior, para não sobrar buraco no meio do recorte.
 */
function mapear(texto: string): { dobrado: string; ini: number[]; fim: number[] } {
  let dobrado = '';
  const ini: number[] = [];
  const fim: number[] = [];
  for (let i = 0; i < texto.length;) {
    const ponto = texto.codePointAt(i);
    if (ponto === undefined) break;
    const char = String.fromCodePoint(ponto);
    const proximo = i + char.length;
    const pedaco = dobrar(char);
    if (!pedaco) {
      // Acento solto: estica o alcance da casa anterior em vez de virar buraco.
      if (fim.length > 0) fim[fim.length - 1] = proximo;
    } else {
      for (let k = 0; k < pedaco.length; k += 1) { ini.push(i); fim.push(proximo); }
      dobrado += pedaco;
    }
    i = proximo;
  }
  return { dobrado, ini, fim };
}

/**
 * Recorta a janela em volta da primeira ocorrência de `termo` em `texto`.
 * Devolve `null` quando não há ocorrência — a linha então não é um resultado.
 */
export function trechoDoAchado(
  texto: string | null | undefined,
  termo: string,
  contexto = 46,
): TrechoDoAchado | null {
  const cru = String(texto ?? '').replace(/\s+/g, ' ').trim();
  const agulha = dobrar(termo.trim());
  if (!cru || !agulha) return null;

  const { dobrado, ini, fim } = mapear(cru);
  const at = dobrado.indexOf(agulha);
  if (at < 0) return null;

  const comeco = ini[at];
  const termino = fim[at + agulha.length - 1];
  if (comeco === undefined || termino === undefined) return null;

  const de = Math.max(0, comeco - contexto);
  const ate = Math.min(cru.length, termino + contexto);
  return {
    antes: cru.slice(de, comeco),
    achado: cru.slice(comeco, termino),
    depois: cru.slice(termino, ate),
    cortadoAntes: de > 0,
    cortadoDepois: ate < cru.length,
  };
}

/**
 * Tira a linha de assinatura do atendente (`*Dr. Pedro:*\n`) que o compositor
 * cola no envio manual.
 *
 * CÓPIA DELIBERADA de `stripAgentSignature` (waRichText). A regra é uma linha,
 * e importá-la daqui puxaria um módulo inteiro para dentro da cadeia de um
 * arquivo que tem teste — o que derruba o `npm test` deste projeto. O teste ao
 * lado vigia as duas redações contra os mesmos casos.
 */
export function semAssinaturaDoAgente(texto: string): string {
  return texto.replace(/^\*[^*\n]+:\*\n/, '');
}

/**
 * O texto de uma mensagem para efeito de busca e de trecho: o que foi escrito,
 * o que foi DITO no áudio, ou o nome do arquivo anexado — nessa ordem, que é a
 * ordem em que a pessoa lembra do que procura.
 */
export function textoBuscavel(m: {
  direction?: string | null;
  content?: string | null;
  transcription_text?: string | null;
  file_name?: string | null;
}): string {
  const conteudo = (m.content ?? '').trim();
  const limpo = m.direction === 'out' ? semAssinaturaDoAgente(conteudo) : conteudo;
  return limpo || (m.transcription_text ?? '').trim() || (m.file_name ?? '').trim();
}
