/** Regras puras de evidência para fatos extraídos de uma rodada do WhatsApp. */

export interface WaAiEvidenceField {
  key: string;
  label: string;
  type: string;
  ask?: string;
  question?: string;
}

function simples(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const RESPOSTA_SEM_IDENTIDADE = /^(?:sim|nao|talvez|isso|aquilo|todos?|todas?|ninguem|empresa|pessoa|particular|publico|governo|prefeitura|um|uma|\d+)\s*(?:anos?|meses?|dias?)?$/;
const STOP = new Set(['uma', 'uns', 'umas', 'com', 'sem', 'para', 'por', 'que', 'dos', 'das', 'de', 'da', 'do', 'e', 'a', 'o']);

function tokensComConteudo(value: string): string[] {
  return simples(value).split(' ').filter(token => token.length >= 3 && !STOP.has(token));
}

/**
 * Confere somente campos de texto em que um palpite costuma avançar o fluxo.
 * Os demais tipos têm validadores próprios (enum, booleano, data, hora).
 */
export function waAiFactHasCustomerEvidence(
  field: WaAiEvidenceField, value: unknown, customerText: string,
): boolean {
  if (field.type !== 'texto') return true;
  const resposta = simples(customerText);
  const extraido = simples(value);
  if (!resposta || !extraido) return false;

  const contexto = simples(`${field.key} ${field.label} ${field.ask || ''} ${field.question || ''}`);
  const pedeIdentidade = /\b(nome|quem|empresa|empregador|pessoa|banco|instituicao|titular|declarante|envolvid)\w*\b/.test(contexto);
  if (pedeIdentidade) {
    if (RESPOSTA_SEM_IDENTIDADE.test(extraido) || RESPOSTA_SEM_IDENTIDADE.test(resposta)) return false;
    const ditos = new Set(tokensComConteudo(resposta));
    if (!tokensComConteudo(extraido).some(token => ditos.has(token))) return false;
  }

  const pedeValor = /\b(quanto|valor|salario|pagavam|recebia)\b/.test(contexto);
  if (pedeValor && !/(?:\br\$|\breais?\b|\bmil\b|\bsalario minimo\b|\b\d+[.,]?\d*\b)/.test(resposta)) {
    return false;
  }

  return true;
}
