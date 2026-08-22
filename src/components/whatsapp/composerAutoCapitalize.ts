// Maiúscula automática no começo da frase — o que o teclado do celular faz
// sozinho (`autocapitalize="sentences"`) e o navegador no computador NÃO faz.
// Era por isso que a mensagem saía "bom dia, doutor" toda vez que o atendimento
// era feito pelo desktop, e a mesma frase saía "Bom dia" quando era pelo celular.
//
// A correção acontece NA TECLA, e só na letra que acabou de ser digitada: nunca
// reescreve o texto inteiro. Isso é o que preserva a escrita de quem já passou
// por ali — apagar a maiúscula de propósito, um "iPhone" no meio da frase, um
// nome de arquivo — em vez de o campo ficar corrigindo o passado a cada tecla.
//
// Sem imports de propósito: mantém as funções puras testáveis pelo `npm test`.

/** Marcas de formatação e aspas que podem vir ANTES da primeira letra da frase. */
const ABERTURAS = '*_~`"\'“”‘’([{«';

/** Pontuação que fecha uma frase — a próxima letra recomeça em maiúscula. */
const FIM_DE_FRASE = '.!?…';

const ESPACOS = ' \t';

/**
 * A posição `i` é o começo de uma frase?
 *
 * Vale o começo do texto, o começo de uma linha e o que vem depois de `.`, `!`,
 * `?` ou `…` seguidos de espaço. O espaço é exigido de propósito: sem ele,
 * "www.google" e "art.5" virariam "www.Google" e "art.5".
 *
 * Marcas de formatação e aspas grudadas na letra são puladas — quem escreve
 * "*bom dia*" em negrito quer a mesma maiúscula de quem escreve sem asterisco.
 * Já o "/" do atalho de modelos não está na lista, então "/kit" continua
 * minúsculo e o menu de modelos segue funcionando.
 */
function inicioDeFrase(texto: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && ABERTURAS.includes(texto[j])) j -= 1;
  if (j < 0) return true;
  if (texto[j] === '\n') return true;
  if (!ESPACOS.includes(texto[j])) return false;
  while (j >= 0 && ESPACOS.includes(texto[j])) j -= 1;
  if (j < 0) return true;
  if (texto[j] === '\n') return true;
  return FIM_DE_FRASE.includes(texto[j]);
}

/**
 * O que mudou entre `anterior` e `atual` foi UM caractere digitado na posição `i`?
 *
 * Dois casos contam como digitação:
 *  - inserção comum (o texto cresceu um caractere);
 *  - substituição de um caractere só no mesmo lugar — é o que acontece com
 *    acento morto (´ + a vira á) e com a correção do teclado do celular.
 *
 * Colar um trecho, apagar, ou qualquer mudança maior devolve `false`: texto que
 * veio pronto de outro lugar não é nosso para reescrever.
 */
function digitouUmCaractere(anterior: string, atual: string, i: number): boolean {
  if (atual.length === anterior.length + 1) {
    return atual.slice(0, i) === anterior.slice(0, i) && atual.slice(i + 1) === anterior.slice(i);
  }
  if (atual.length === anterior.length) {
    return atual[i] !== anterior[i]
      && atual.slice(0, i) === anterior.slice(0, i)
      && atual.slice(i + 1) === anterior.slice(i + 1);
  }
  return false;
}

/**
 * Devolve o texto com a letra recém-digitada em maiúscula quando ela abre uma
 * frase — ou `null` quando não há nada a corrigir (o chamador não mexe no campo).
 *
 * O resultado tem SEMPRE o mesmo comprimento da entrada: só a caixa da letra
 * muda. É isso que permite devolver o cursor exatamente onde ele estava, sem o
 * pulo para o fim do texto que estragaria a digitação no meio da frase.
 *
 * @param anterior valor que o campo tinha antes desta tecla
 * @param atual    valor que o campo tem agora
 * @param cursor   posição do cursor agora (logo depois do caractere digitado)
 */
export function autoCapitalizarDigitacao(anterior: string, atual: string, cursor: number): string | null {
  if (cursor < 1 || cursor > atual.length) return null;
  const i = cursor - 1;
  if (!digitouUmCaractere(anterior, atual, i)) return null;

  const letra = atual[i];
  const maiuscula = letra.toLocaleUpperCase('pt-BR');
  // Só letras que TÊM maiúscula de um caractere só: número, emoji e pontuação
  // ficam de fora, e o "ß" alemão (que vira "SS") não pode mudar o tamanho do
  // texto — o cursor depende disso.
  if (maiuscula === letra || maiuscula.length !== letra.length) return null;

  if (!inicioDeFrase(atual, i)) return null;
  return atual.slice(0, i) + maiuscula + atual.slice(i + 1);
}
