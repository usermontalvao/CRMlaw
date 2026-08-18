// Vincular um número a um cadastro: a decisão, sem tocar no banco.
//
// A pergunta é sempre a mesma e aparece em dois lugares — ao vincular o cliente
// da conversa e ao vincular um número de um CARTÃO DE CONTATO recebido: este
// telefone entra na ficha? em qual campo? por cima de quê?
//
// Três respostas, e a do meio é a que existe para não estragar cadastro:
//   · NADA A FAZER — a ficha já tem este número. E "já tem" inclui a outra
//     forma do mesmo número: `5565992216459` no WhatsApp e `65992216459` na
//     ficha são a MESMA pessoa. Comparar literalmente fazia o painel oferecer
//     "adicionar" o que já estava lá.
//   · ADICIONAR — há campo vazio (celular, depois fixo). É o caso comum.
//   · SUBSTITUIR — os dois campos estão preenchidos e nenhum é este número.
//     O número novo entra no celular e o antigo SAI da ficha. Isto apaga um
//     dado, então quem chama precisa DIZER isso ao operador — daí `replaced`
//     vir separado de `added`.
//
// PURO DE PROPÓSITO: nenhum import (ver o cabeçalho de `attendanceRouting.ts`).
// A regra do 9º dígito é a mesma de `services/whatsapp/shared.ts`, repetida
// aqui porque este módulo precisa ficar sem imports para os testes carregá-lo.

/** Normaliza para E.164 brasileiro só com dígitos. '' quando não é telefone. */
export function linkPhoneDigits(input: string | null | undefined): string {
  const bruto = (input || '').trim();
  // Identificador interno do WhatsApp nunca entra num cadastro como telefone.
  if (!bruto || /@lid\b/i.test(bruto)) return '';
  let d = bruto.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 13 ? d : '';
}

/** As formas do mesmo número com e sem o 9º dígito de celular. */
export function linkPhoneVariants(input: string | null | undefined): string[] {
  const d = linkPhoneDigits(input);
  if (!d) return [];
  const out = new Set<string>([d]);
  const m = d.match(/^55(\d{2})(\d+)$/);
  if (m) {
    const [, ddd, rest] = m;
    if (rest.length === 9 && rest[0] === '9') out.add(`55${ddd}${rest.slice(1)}`);
    else if (rest.length === 8) out.add(`55${ddd}9${rest}`);
  }
  return Array.from(out);
}

/** Os dois telefones são da mesma pessoa? */
export function sameLinkPhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = linkPhoneVariants(a);
  if (va.length === 0) return false;
  const vb = new Set(linkPhoneVariants(b));
  return va.some(v => vb.has(v));
}

export interface ClientPhonesNow {
  mobile: string | null;
  phone: string | null;
}

export interface PhoneLinkPlan {
  /** O que fazer com a ficha. */
  action: 'none' | 'add' | 'replace';
  /** Onde gravar. `null` quando não há o que gravar. */
  field: 'mobile' | 'phone' | null;
  /** O número em dígitos, como ele deve ir para a ficha. */
  value: string;
  /** O número que SAI da ficha, quando a gravação apaga algum. */
  replaced: string | null;
}

const NADA: PhoneLinkPlan = { action: 'none', field: null, value: '', replaced: null };

/** O que fazer para pôr `novo` na ficha que hoje tem `atual`. */
export function planPhoneLink(atual: ClientPhonesNow, novo: string | null | undefined): PhoneLinkPlan {
  const value = linkPhoneDigits(novo);
  if (!value) return NADA;
  if (sameLinkPhone(atual?.mobile, value) || sameLinkPhone(atual?.phone, value)) return NADA;

  if (!atual?.mobile) return { action: 'add', field: 'mobile', value, replaced: null };
  if (!atual?.phone) return { action: 'add', field: 'phone', value, replaced: null };
  // Ficha cheia: o celular é o campo que o escritório usa para falar, então é
  // ele que recebe o número novo — e o antigo sai.
  return { action: 'replace', field: 'mobile', value, replaced: atual.mobile };
}
