// Quem é o número — e quem NÃO é.
//
// Este módulo é a única autoridade do CRM sobre a pergunta "para qual número
// esta ligação vai?". Duas coisas moram aqui:
//
//  1. a tradução do telefone para o formato que o WaCalls espera;
//  2. a separação entre TELEFONE e LID — a distinção que faltava e que fez o
//     escritório discar para a Somália.
//
// O QUE ACONTECEU (17/08/2026, 23:29). O escritório ligou para a Lisliandra
// (5565 9612-8787) e desligou. Um minuto depois ela ligou de volta, e o convite
// chegou do WaCalls assim:
//
//     peer = 252677908865131@lid
//
// O `@lid` é o LID: um apelido INTERNO que o WhatsApp dá ao contato justamente
// para não expor o telefone dele. Não é um MSISDN, não tem código de país, não
// tem DDD — os dígitos não significam nada fora do WhatsApp. O código antigo
// fazia `peer.split('@')[0]`, guardava aquilo como telefone e o painel escreveu
// "+252677908865131" no lugar do nome da cliente. O registro da chamada foi
// para o banco com o LID no campo `phone`, sem cliente e sem conversa.
//
// REGRA, sem exceção: um LID NUNCA vira telefone. Não se corta, não se completa
// com 55, não se "tenta assim mesmo". Quando é tudo o que existe, a resposta
// certa é dizer que o número não foi identificado — e, no caso de uma ligação
// de saída, não discar.
//
// O caminho de volta (LID → telefone de verdade) existe, mas é uma CONSULTA a
// um mapeamento que alguém registrou (ver `services/whatsapp/lidMap.ts`), nunca
// uma conversão. É por isso que `resolveCallablePhone` recebe candidatos já
// resolvidos: a decisão de aceitar ou recusar fica em um lugar só, testável.
//
// SEM IMPORTS de propósito — é o que permite `node --test` carregar o módulo.

/** Tamanho de um MSISDN que este CRM aceita discar: 55 + DDD + 8/9 dígitos. */
const MIN_MSISDN = 12;
const MAX_MSISDN = 13;

/**
 * Converte o telefone da conversa no valor do campo `phone` do WaCalls.
 *
 * O servidor monta o JID com `types.NewJID(normalizePhone(phone), "s.whatsapp.net")`
 * e o `normalizePhone` dele apenas joga fora tudo que não é dígito (inclusive o
 * "+"). Ou seja: o campo `phone` do POST /calls é o número em dígitos com código
 * do país — `5565999999999` — exatamente como o cliente oficial envia.
 *
 * Devolve '' quando não sobra número plausível — quem chama trata como erro em
 * vez de discar para um JID quebrado. Um endereço `@lid` devolve '' SEMPRE,
 * mesmo que os dígitos dele caibam no tamanho de um telefone: o que decide não
 * é o formato, é a natureza do identificador.
 */
export function toWaCallsPhone(input: string | null | undefined): string {
  const bruto = (input || '').trim();
  if (!bruto) return '';
  if (ehLid(bruto)) return '';
  // O JID vem como "5565...@s.whatsapp.net" e, com vários aparelhos na conta,
  // com o sufixo de dispositivo ("5565...:12@..."). Os dois pedaços saem ANTES
  // de tirar a máscara: passando o `:12` pelo `replace` ele viraria dois
  // dígitos colados no fim do número.
  let d = bruto.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < MIN_MSISDN || d.length > MAX_MSISDN) return '';
  return d;
}

/** O endereço é um LID (`124760310726826@lid`)? */
export function ehLid(valor: string | null | undefined): boolean {
  return /@lid\b/i.test((valor || '').trim());
}

/** O LID em dígitos, ou `null` quando o endereço não é um LID. */
export function lidDeJid(valor: string | null | undefined): string | null {
  if (!ehLid(valor)) return null;
  const digitos = (valor || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return digitos || null;
}

/** Um endereço do WhatsApp separado no que ele é de fato. */
export interface WaPeerIdentity {
  /** Telefone em dígitos, pronto para discar. '' quando o endereço não tem um. */
  phone: string;
  /** O LID, quando o endereço é `<n>@lid`. NUNCA é telefone. */
  lid: string | null;
}

/**
 * O `peer` que o WaCalls devolve nos eventos, lido pelo que ele é.
 *
 * Três formas chegam: `5565...@s.whatsapp.net` (telefone), `<n>@lid` (apelido
 * interno) e, no meio de uma sessão com vários aparelhos, o sufixo de
 * dispositivo `5565...:12@s.whatsapp.net`.
 */
export function parseWaPeer(peer: string | null | undefined): WaPeerIdentity {
  const bruto = (peer || '').trim();
  const lid = lidDeJid(bruto);
  if (lid) return { phone: '', lid };
  return { phone: toWaCallsPhone(bruto), lid: null };
}

/**
 * O JID que o WaCalls devolve nos eventos → dígitos do telefone.
 *
 * Continua existindo para quem só quer o número, mas agora devolve '' quando o
 * endereço é um LID — era exatamente aqui que o apelido interno virava
 * "telefone" e seguia para o painel, para o registro e para a ficha.
 */
export function phoneFromWaCallsPeer(peer: string | null | undefined): string {
  return parseWaPeer(peer).phone;
}

// ── Resolução do destinatário ────────────────────────────────────────────────

/**
 * De onde saiu o número. A ordem desta lista É a prioridade — do dado mais
 * específico e mais recentemente confirmado para o mais indireto.
 */
export type CallablePhoneSource =
  /** Telefone escrito no cartão de contato (vCard) que o cliente mandou. */
  | 'vcard'
  /** Telefone da conversa/canal em que o atendimento acontece. */
  | 'conversation'
  /** Telefone do cadastro do cliente vinculado. */
  | 'client'
  /** JID `@s.whatsapp.net`, que carrega o MSISDN de verdade. */
  | 'jid'
  /** Mapeamento LID → telefone já registrado pelo CRM. */
  | 'lid-map';

export interface CallablePhoneCandidate {
  source: CallablePhoneSource;
  /** Telefone, JID ou o que a camada tiver em mãos. Pode ser um LID. */
  value: string | null | undefined;
}

/** Por que não deu para discar. */
export type CallablePhoneFailure =
  /** Nenhum candidato trouxe coisa alguma. */
  | 'empty'
  /** Só havia LID — e LID não é telefone. */
  | 'lid-only'
  /** Veio algo, mas não é um número discável. */
  | 'invalid';

export interface CallablePhoneResult {
  /** Dígitos prontos para o WaCalls. '' quando não foi possível resolver. */
  phone: string;
  /** Qual candidato venceu. `null` quando nenhum venceu. */
  source: CallablePhoneSource | null;
  /** O LID visto no caminho — serve para procurar o mapeamento depois. */
  lid: string | null;
  failure: CallablePhoneFailure | null;
}

/** O recado que o operador lê quando o número não pôde ser identificado. */
export const CALLABLE_PHONE_UNKNOWN =
  'Não foi possível identificar com segurança o número deste contato.';

/**
 * Escolhe o número para o qual a chamada vai — ou recusa a chamada.
 *
 * PONTO ÚNICO de propósito. Antes cada tela fazia a sua própria leitura do que
 * era "o telefone do contato": o cabeçalho da conversa usava `contact_phone`, o
 * convite recebido usava o `peer` cru, o registro da chamada usava o que
 * sobrasse. Bastou um deles aceitar um LID para o escritório discar um número
 * que não existe, e para a gravação e o registro irem parar em lugar nenhum.
 *
 * Percorre os candidatos NA ORDEM em que vieram e devolve o primeiro que der um
 * telefone de verdade. LID encontrado no caminho é guardado (quem chama pode
 * consultar o mapeamento e tentar de novo), mas jamais convertido.
 */
export function resolveCallablePhone(
  candidates: readonly CallablePhoneCandidate[],
): CallablePhoneResult {
  let lid: string | null = null;
  let viuAlgo = false;

  for (const candidato of candidates || []) {
    const bruto = (candidato?.value || '').trim();
    if (!bruto) continue;
    viuAlgo = true;

    const apelido = lidDeJid(bruto);
    if (apelido) {
      // Primeiro LID visto é o que vale para a consulta ao mapeamento: ele veio
      // da fonte de maior prioridade que tinha alguma coisa.
      if (!lid) lid = apelido;
      continue;
    }

    const phone = toWaCallsPhone(bruto);
    if (phone) return { phone, source: candidato.source, lid, failure: null };
  }

  if (lid) return { phone: '', source: null, lid, failure: 'lid-only' };
  return { phone: '', source: null, lid: null, failure: viuAlgo ? 'invalid' : 'empty' };
}
