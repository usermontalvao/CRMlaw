// A agenda de contatos da "Nova conversa": agrupar por letra e filtrar.
//
// O painel imita a tela de novo contato do WhatsApp: a lista já vem pronta,
// separada por letra, e a busca peneira o que está na mão em vez de ir ao
// servidor a cada tecla. Isso só é possível porque a agenda inteira cabe na
// memória — são poucas centenas de linhas, não as milhares de um catálogo.
//
// Duas decisões que o WhatsApp toma e esta lista copia:
//   · a unidade da lista é o NÚMERO, não a pessoa. Cliente com celular e fixo
//     aparece duas vezes, e escolher já é escolher por onde falar — some o
//     passo "qual número usar?" que existia no modal antigo;
//   · quem não tem letra (nome começando por número, símbolo ou vazio) cai num
//     grupo "#" no fim, em vez de sumir da lista sem explicação.
//
// PURO DE PROPÓSITO: nenhum import. Ver o cabeçalho de `attendanceRouting.ts`.

/** Uma linha da agenda — um número de um cliente. */
export interface ContactEntry {
  clientId: string;
  name: string;
  /** Telefone só com dígitos, como o resto do módulo trata. */
  phone: string;
  /** De onde o número veio no cadastro. */
  phoneKind: 'mobile' | 'phone';
  doc: string | null;
  /** Foto já resolvida (do cadastro ou a do WhatsApp de uma conversa antiga). */
  avatarUrl: string | null;
  isPreCadastro: boolean;
}

export interface ContactSection {
  /** 'A'…'Z' ou '#'. */
  letter: string;
  entries: ContactEntry[];
}

/** Minúsculas, sem acento — para comparar nome digitado com nome cadastrado. */
export function fold(text: string): string {
  return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * A letra sob a qual o contato aparece. Acento não separa grupo ("Álvaro" fica
 * em A, junto de "Ana"), e o que não começa com letra vai para '#'.
 */
export function initialLetter(name: string): string {
  const first = fold(name).trim().charAt(0);
  return first >= 'a' && first <= 'z' ? first.toUpperCase() : '#';
}

/**
 * Peneira a agenda pelo que foi digitado: nome (sem acento), documento ou
 * telefone. Busca vazia devolve a agenda inteira — a lista do WhatsApp começa
 * cheia, e é isso que faz dela uma agenda em vez de um campo de busca.
 */
export function filterContacts(entries: readonly ContactEntry[], query: string): ContactEntry[] {
  const raw = fold(query).trim();
  if (!raw) return [...entries];
  const digits = query.replace(/\D/g, '');
  return entries.filter(e => {
    if (fold(e.name).includes(raw)) return true;
    if (!digits) return false;
    return e.phone.includes(digits) || (e.doc || '').replace(/\D/g, '').includes(digits);
  });
}

/**
 * Fatia a lista em seções por letra, preservando a ordem que veio do servidor
 * (alfabética por nome). O grupo '#' vai para o fim, onde não atrapalha quem
 * está percorrendo o alfabeto.
 */
export function groupByLetter(entries: readonly ContactEntry[]): ContactSection[] {
  const porLetra = new Map<string, ContactEntry[]>();
  for (const e of entries) {
    const letra = initialLetter(e.name);
    const lista = porLetra.get(letra);
    if (lista) lista.push(e);
    else porLetra.set(letra, [e]);
  }
  const letras = [...porLetra.keys()].sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return letras.map(letter => ({ letter, entries: porLetra.get(letter)! }));
}

/**
 * O que o Enter deve fazer com o que está na tela.
 *
 * Só age quando o alvo é ÓBVIO — um telefone digitado, ou um único contato
 * sobrando na peneira. Com vários resultados, escolher por conta própria
 * abriria conversa com a pessoa errada; aí a tecla não faz nada e a escolha
 * continua sendo de quem atende.
 */
export function enterTarget(
  typedPhone: string,
  filtered: readonly ContactEntry[],
): { kind: 'phone'; phone: string } | { kind: 'contact'; entry: ContactEntry } | null {
  if (typedPhone) return { kind: 'phone', phone: typedPhone };
  if (filtered.length === 1) return { kind: 'contact', entry: filtered[0] };
  return null;
}
