/**
 * services/clientMergeAI
 * -----------------------------------------------------------------------------
 * Julgamento por IA de contatos possivelmente duplicados.
 *
 * A IA NÃO sai varrendo a base. Ela só é chamada depois que a heurística de
 * `clientDuplicates` já encontrou indício concreto (mesmo nome, mesmo telefone,
 * mesmo e-mail ou CPF com cara de erro de digitação) — e mesmo assim é pulada
 * quando o indício já é conclusivo sozinho (CPF idêntico não precisa de opinião).
 * Cada chamada leva um grupo inteiro, não um cliente por vez.
 *
 * O papel dela é um só: decidir se é a mesma pessoa. Ela não escolhe valores,
 * não reescreve campos e não apaga nada — a mesclagem em si continua sendo a
 * regra determinística do `clientService.mergeClients` (dado mais recente vence,
 * campo vazio não sobrescreve campo preenchido, valor antigo vai para o
 * histórico).
 */

import { aiService } from './ai.service';
import type { Client } from '../types/client.types';
import type { DuplicateGroup } from '../utils/clientDuplicates';
import { isCertainDuplicate, needsAiJudgement } from '../utils/clientDuplicates';

export interface DuplicateVerdict {
  groupKey: string;
  /** true = a IA afirma ser a mesma pessoa. */
  samePerson: boolean;
  /** 0 a 100. Abaixo de MERGE_THRESHOLD não mesclamos sozinhos. */
  confidence: number;
  reason: string;
  /** Como o veredito foi obtido. */
  decidedBy: 'regra' | 'ia' | 'erro';
}

/** Confiança mínima para mesclar sem passar pelo advogado. */
export const MERGE_THRESHOLD = 85;

const SYSTEM_PROMPT = `Você analisa cadastros de clientes de um escritório de advocacia brasileiro e decide se registros diferentes são A MESMA PESSOA.

Responda APENAS com JSON válido, sem texto fora do JSON:
{"samePerson": true|false, "confidence": 0-100, "reason": "uma frase curta em português"}

Como decidir:
- CPF idêntico => mesma pessoa, confiança alta.
- Nome idêntico + telefone idêntico ou e-mail idêntico => quase sempre a mesma pessoa cadastrada duas vezes.
- CPF diferente em 1 ou 2 dígitos, com nome idêntico e contato idêntico => erro de digitação no CPF; é a mesma pessoa. Diga no motivo qual CPF parece o correto.
- Nomes de parentes (pai/filho, "JUNIOR", "NETO", "FILHO") com CPFs diferentes => pessoas DIFERENTES.
- Homônimos sem nenhum contato em comum => NÃO afirme que é a mesma pessoa; confiança baixa.
- Datas de nascimento diferentes => pessoas diferentes.

Na dúvida, prefira samePerson=false com confiança baixa. Um cadastro mesclado por engano mistura os processos de duas pessoas.`;

const fieldLine = (label: string, value?: string | null) => {
  const text = String(value ?? '').trim();
  return text ? `  ${label}: ${text}\n` : '';
};

const describeClient = (client: Client, index: number): string =>
  `Cadastro ${index + 1}:\n` +
  fieldLine('Nome', client.full_name) +
  fieldLine('CPF/CNPJ', client.cpf_cnpj) +
  fieldLine('RG', client.rg) +
  fieldLine('Nascimento', client.birth_date) +
  fieldLine('E-mail', client.email) +
  fieldLine('Telefone', client.phone) +
  fieldLine('Celular', client.mobile) +
  fieldLine('Profissão', client.profession) +
  fieldLine('Estado civil', client.marital_status) +
  fieldLine('Endereço', [client.address_street, client.address_number, client.address_neighborhood, client.address_city, client.address_state].filter(Boolean).join(', ')) +
  fieldLine('Criado em', client.created_at) +
  fieldLine('Atualizado em', client.updated_at);

const parseVerdict = (raw: string): { samePerson: boolean; confidence: number; reason: string } | null => {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { samePerson?: unknown; confidence?: unknown; reason?: unknown };
    const confidence = Number(parsed.confidence);
    return {
      samePerson: parsed.samePerson === true,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
      reason: String(parsed.reason ?? '').trim() || 'Sem justificativa.',
    };
  } catch {
    return null;
  }
};

export const clientMergeAIService = {
  /** A IA está configurada e habilitada? */
  isAvailable(): boolean {
    return aiService.isEnabled();
  },

  /**
   * Julga UM grupo. Retorna veredito determinístico (sem IA) quando o CPF é
   * idêntico, e `null` quando o grupo nem sequer justifica uma chamada.
   */
  async judgeGroup(group: DuplicateGroup): Promise<DuplicateVerdict | null> {
    if (isCertainDuplicate(group)) {
      return {
        groupKey: group.key,
        samePerson: true,
        confidence: 100,
        reason: 'CPF/CNPJ idêntico nos dois cadastros.',
        decidedBy: 'regra',
      };
    }

    if (!needsAiJudgement(group)) return null;
    if (!aiService.isEnabled()) return null;

    const userPrompt =
      `Indícios encontrados pelo sistema: ${group.reasons.join(', ')}.\n\n` +
      group.clients.map(describeClient).join('\n') +
      '\nEsses cadastros são da mesma pessoa?';

    try {
      const raw = await aiService.generateText(SYSTEM_PROMPT, userPrompt, 300, 'client_duplicate_merge');
      const verdict = parseVerdict(raw);
      if (!verdict) {
        return { groupKey: group.key, samePerson: false, confidence: 0, reason: 'A IA respondeu em formato inesperado.', decidedBy: 'erro' };
      }
      return { groupKey: group.key, ...verdict, decidedBy: 'ia' };
    } catch (err) {
      return {
        groupKey: group.key,
        samePerson: false,
        confidence: 0,
        reason: err instanceof Error ? err.message : 'Falha ao consultar a IA.',
        decidedBy: 'erro',
      };
    }
  },

  /**
   * Julga vários grupos em sequência (não em paralelo, para não estourar o
   * limite de requisições do proxy). Grupos sem indício suficiente são pulados
   * e nem contam como chamada.
   */
  async judgeGroups(
    groups: DuplicateGroup[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, DuplicateVerdict>> {
    const out = new Map<string, DuplicateVerdict>();
    const candidates = groups.filter((g) => isCertainDuplicate(g) || needsAiJudgement(g));
    for (let i = 0; i < candidates.length; i += 1) {
      const verdict = await this.judgeGroup(candidates[i]);
      if (verdict) out.set(verdict.groupKey, verdict);
      onProgress?.(i + 1, candidates.length);
    }
    return out;
  },
};

export default clientMergeAIService;
