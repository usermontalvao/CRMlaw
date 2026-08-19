// O QUE FOI DIGITADO NO DISCADOR — as regras, sem tela nenhuma em volta.
//
// O campo do discador aceita as duas coisas que a pessoa pode ter em mãos: um
// NÚMERO (do papel, do e-mail, do processo) e um NOME (o cliente que ela sabe
// de cabeça). Quem decide qual dos dois chegou é este módulo, e a decisão vale
// para tudo o que a tela faz depois: como escrever o que está sendo digitado,
// se a agenda deve ser peneirada, e se o botão verde pode acender.
//
// TRÊS COISAS MORAM AQUI, e nenhuma delas é desenho:
//
//  1. É TELEFONE OU É NOME? Um dígito no meio de um nome ("João 2") não
//     transforma a busca em discagem, e um número com parênteses e traço não
//     deixa de ser telefone por causa da pontuação.
//
//  2. COMO SE ESCREVE ENQUANTO SE DIGITA. "(65) 99612-8787" nasce dígito a
//     dígito, sem que o cursor pule e sem que o texto encolha quando alguém
//     apaga. Formatar só no fim faria o campo dar um solavanco no 11º dígito.
//
//  3. DÁ PARA DISCAR? A resposta é `false` até o número estar inteiro — e o
//     motivo é escrito, porque um botão apagado sem explicação faz a pessoa
//     clicar de novo achando que a tela travou.
//
// O QUE NÃO MORA AQUI: a decisão final sobre para onde a chamada vai. Essa é de
// `resolveCallablePhone` (ver `phone.ts`), que é quem recusa LID e escolhe
// entre os candidatos. Este módulo só prepara o que o operador escreveu.
//
// SEM IMPORTS de propósito — é o que permite `node --test` carregar o módulo
// (ver o cabeçalho de `attendanceRouting.ts`).

/** Dígitos de um número brasileiro completo, sem o código do país. */
const NACIONAL_MIN = 10; // fixo: DDD + 8
const NACIONAL_MAX = 11; // celular: DDD + 9

/** Teto do campo: 55 + DDD + 9 dígitos, com folga para quem cola com o "+55". */
export const DIAL_MAX_DIGITS = 13;

/** Só os dígitos do que foi digitado ou colado. */
export function onlyDigits(input: string | null | undefined): string {
  return (input || '').replace(/\D/g, '');
}

/**
 * Os dígitos NACIONAIS do que foi digitado — o "55" da frente sai.
 *
 * Colar "+55 65 99612-8787" e digitar "65996128787" têm de dar no mesmo
 * número; sem isto, o primeiro vira um telefone de 13 dígitos que o campo
 * escreveria como se o 55 fosse o DDD.
 */
export function nationalDigits(input: string | null | undefined): string {
  const d = onlyDigits(input).slice(0, DIAL_MAX_DIGITS);
  // O corte só acontece quando o que sobra tem cara de número nacional: "5565"
  // (um começo de digitação de DDD 55, que existe no RS) não pode virar "65".
  if (d.startsWith('55') && d.length >= NACIONAL_MIN + 2) return d.slice(2);
  return d;
}

/**
 * "(65) 99612-8787" — escrito dígito a dígito, do jeito que se digita.
 *
 * Cada tamanho tem a sua forma: dois dígitos já ganham os parênteses, e o traço
 * entra quando existe o que separar. Números maiores que um telefone brasileiro
 * voltam crus, sem máscara — inventar formato para um número estrangeiro é a
 * mentira que `formatCallPhone` também recusa (ver `callHistory.ts`).
 */
export function formatDialed(input: string | null | undefined): string {
  const d = nationalDigits(input);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  if (resto.length <= 8) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  if (resto.length === 9) return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
  return d;
}

/**
 * O que foi escrito é uma tentativa de telefone?
 *
 * Uma letra decide que não — inclusive uma letra sozinha no meio dos dígitos.
 * Pontuação de telefone (parênteses, traço, ponto, espaço e o "+") não conta
 * contra, e é isso que faz um número colado do e-mail continuar sendo número.
 */
export function isPhoneQuery(input: string | null | undefined): boolean {
  const bruto = (input || '').trim();
  if (!bruto) return false;
  if (/[^\d\s()+.\-]/.test(bruto)) return false;
  return onlyDigits(bruto).length >= 3;
}

/**
 * O número pronto para o WaCalls (55 + DDD + número), ou '' quando ainda não dá.
 *
 * Aceita o que já vem com o código do país e completa quem digitou só o
 * nacional. Não tenta adivinhar DDD: um número de 8 ou 9 dígitos sem DDD é
 * exatamente o caso em que discar erra a cidade.
 */
export function dialableDigits(input: string | null | undefined): string {
  const nacional = nationalDigits(input);
  if (nacional.length < NACIONAL_MIN || nacional.length > NACIONAL_MAX) return '';
  return `55${nacional}`;
}

/** Por que o botão verde está apagado — ou `null` quando ele pode acender. */
export type DialBlock =
  /** Campo vazio: o discador ainda não sabe para onde ir. */
  | 'vazio'
  /** Nome digitado: quem escolhe é a lista, não o botão. */
  | 'nome'
  /** Faltam dígitos para o número estar inteiro. */
  | 'curto'
  /** Dígitos demais para um telefone brasileiro. */
  | 'longo';

export interface DialState {
  /** Como o campo aparece na tela. */
  text: string;
  /** Dígitos prontos para discar, ou '' enquanto não dá. */
  phone: string;
  /** O botão verde pode acender? */
  ready: boolean;
  /** O que impede, quando não dá. */
  block: DialBlock | null;
  /** O que foi digitado é nome (e portanto peneira a agenda)? */
  searching: boolean;
}

/**
 * O estado inteiro do campo, numa leitura só.
 *
 * A tela não recalcula "é nome?", "está pronto?" e "como escrevo?" em três
 * lugares diferentes: pergunta uma vez e desenha. Foi o que evitou, no painel
 * "Nova conversa", o campo dizer uma coisa e o botão fazer outra.
 */
export function readDial(input: string | null | undefined): DialState {
  const bruto = (input || '').trim();
  if (!bruto) {
    return { text: '', phone: '', ready: false, block: 'vazio', searching: false };
  }
  if (!isPhoneQuery(bruto)) {
    return { text: bruto, phone: '', ready: false, block: 'nome', searching: true };
  }
  const nacional = nationalDigits(bruto);
  const phone = dialableDigits(bruto);
  if (phone) {
    return { text: formatDialed(bruto), phone, ready: true, block: null, searching: false };
  }
  return {
    text: formatDialed(bruto),
    phone: '',
    ready: false,
    block: nacional.length > NACIONAL_MAX ? 'longo' : 'curto',
    searching: false,
  };
}

/** O recado do rodapé para cada impedimento. Vazio quando o botão pode acender. */
export function dialBlockMessage(block: DialBlock | null, input?: string | null): string {
  switch (block) {
    case 'vazio': return 'Digite um número ou procure pelo nome.';
    case 'nome': return 'Escolha um contato da lista para ligar.';
    case 'curto': {
      const faltam = NACIONAL_MIN - nationalDigits(input).length;
      return faltam > 0
        ? `Faltam ${faltam} dígito${faltam > 1 ? 's' : ''} — com DDD.`
        : 'Falta um dígito para o número ficar completo.';
    }
    case 'longo': return 'Dígitos demais para um número brasileiro.';
    default: return '';
  }
}
