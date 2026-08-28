// O QUE O KIT PODE ESCREVER NA FICHA DO CLIENTE.
//
// A regra de sempre é conservadora, e por bom motivo: o kit é um formulário
// preenchido pelo cliente, e ele não pode passar por cima de uma ficha que a
// equipe montou. Por isso o preenchimento só entra em CAMPO VAZIO.
//
// A exceção é a PROMOÇÃO DO PRÉ-CADASTRO. O pré-cadastro nasce no atendimento
// do WhatsApp com o que se tinha na hora — quase sempre o primeiro nome, ou o
// apelido do perfil ("Jeniffer", "Dona Maria", "Cliente novo") e o telefone.
// Isso não é cadastro: é uma etiqueta para a conversa não ficar sem nome. Quando
// a pessoa preenche o kit, ela escreve o PRÓPRIO nome, o mesmo que vai no
// contrato que ela assina em seguida. Enquanto o nome do kit era descartado por
// "o campo já está preenchido", a promoção acontecia e o cliente continuava se
// chamando "Jeniffer" no CRM — a ficha ficava com a etiqueta do atendimento no
// lugar do nome da pessoa.
//
// PURO DE PROPÓSITO: dois objetos entram, um objeto de atualização sai. É o que
// permite testar a regra sem Supabase e sem rede.

/** Sem acento, sem caixa e sem espaço sobrando — para COMPARAR, nunca para gravar. */
function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * O nome que veio do kit acrescenta alguma coisa ao que já está na ficha?
 *
 * Duas situações, e só elas:
 *  · o que está na ficha é o COMEÇO do que veio ("Jeniffer" → "Jeniffer
 *    Aparecida Alves Rodrigues"): o kit completou o que o atendimento abreviou;
 *  · o que está na ficha não tem letra nenhuma (um telefone, um número): não é
 *    nome de gente, é o que sobrou quando ninguém sabia o nome.
 *
 * Fora disso o nome antigo fica. Um kit preenchido às pressas — só o primeiro
 * nome, o nome de outra pessoa da família — não pode apagar o nome certo.
 */
export function nomeDoKitAcrescenta(atual: string | null | undefined, doKit: string | null | undefined): boolean {
  const novo = (doKit ?? '').trim();
  if (!novo) return false;
  const velho = (atual ?? '').trim();
  if (!velho) return true;
  const a = normalizar(velho);
  const b = normalizar(novo);
  if (a === b) return false;
  if (!/[a-z]/.test(a)) return true;
  // Prefixo por PALAVRA: "ana" completa "ana paula", mas não "anastacia".
  return b.startsWith(`${a} `);
}

export interface KitClientMergeInput {
  /** A ficha como está hoje no banco. */
  atual: Record<string, unknown>;
  /** O que o kit trouxe (o `clientPayload` montado a partir do formulário). */
  doKit: Record<string, unknown>;
  /** Esta é a hora em que o pré-cadastro vira cliente? */
  promovendo: boolean;
  /** Campos que nunca saem do kit para a ficha. */
  ignorar?: readonly string[];
}

const VAZIO = (v: unknown): boolean => v === null || v === undefined || v === '';

/**
 * Os campos a gravar. Vazio significa "não há nada a atualizar".
 *
 * Note que o resultado NÃO inclui `is_pre_cadastro` nem `updated_by`: quem
 * decide promover é quem chama, e a marca da promoção é decisão dele, não do
 * formulário.
 */
export function camposParaGravar(input: KitClientMergeInput): Record<string, unknown> {
  const ignorar = new Set(input.ignorar ?? []);
  const saida: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(input.doKit)) {
    if (ignorar.has(campo)) continue;
    if (VAZIO(valor)) continue;
    const atual = input.atual[campo];
    if (VAZIO(atual)) { saida[campo] = valor; continue; }
    // O único campo que o kit pode CORRIGIR, e só no instante da promoção.
    if (input.promovendo && campo === 'full_name'
      && nomeDoKitAcrescenta(atual as string, valor as string)) {
      saida[campo] = valor;
    }
  }
  return saida;
}
