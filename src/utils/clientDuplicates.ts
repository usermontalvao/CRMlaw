import type { Client } from '../types/client.types';
import { normalizeSearchText } from './search';
import { isCertainDuplicate, looksLikeCpfTypo, needsAiJudgement } from './clientDuplicateGating';

// A decisão de quando acionar a IA mora em `clientDuplicateGating` (módulo sem
// dependências, coberto por testes) e é reexportada daqui por conveniência.
export { isCertainDuplicate, needsAiJudgement, cpfTypoDistance } from './clientDuplicateGating';

export type DuplicateReason =
  | 'CPF igual'
  | 'Telefone igual'
  | 'Nome igual'
  | 'E-mail igual'
  /** Mesma pessoa provável com CPF digitado errado (difere por 1 ou 2 dígitos). */
  | 'CPF parecido';

export interface DuplicateGroup {
  key: string;
  clientIds: string[];
  clients: Client[];
  reasons: DuplicateReason[];
  primaryId: string;
  confidence: 'alta' | 'media' | 'baixa';
}

const isBlank = (value?: string | null) => !value || !String(value).trim();

const normalizeDigits = (value?: string | null) => String(value || '').replace(/\D/g, '');

const getPrimaryPhone = (client: Client) => normalizeDigits(client.phone || client.mobile || '');

const getClientCompletenessScore = (client: Client) => {
  const fields = [
    client.full_name,
    client.cpf_cnpj,
    client.rg,
    client.birth_date,
    client.nationality,
    client.marital_status,
    client.profession,
    client.email,
    client.phone,
    client.mobile,
    client.address_street,
    client.address_number,
    client.address_complement,
    client.address_neighborhood,
    client.address_city,
    client.address_state,
    client.address_zip_code,
    client.notes,
  ];

  return fields.reduce((total, field) => total + (isBlank(String(field || '')) ? 0 : 1), 0);
};

export const pickPrimaryClient = (clients: Client[]) => {
  return [...clients].sort((a, b) => {
    // 1. Completeness first — the record with more data wins regardless of status.
    //    A complete-but-inactive record is more valuable than an empty-but-active one.
    const completenessDiff = getClientCompletenessScore(b) - getClientCompletenessScore(a);
    if (completenessDiff !== 0) return completenessDiff;

    // 2. Among equally complete records, prefer active > suspenso > inativo.
    const statusScoreA = a.status === 'ativo' ? 2 : a.status === 'suspenso' ? 1 : 0;
    const statusScoreB = b.status === 'ativo' ? 2 : b.status === 'suspenso' ? 1 : 0;
    if (statusScoreB !== statusScoreA) return statusScoreB - statusScoreA;

    // 3. Tie-break by most recently updated.
    return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
  })[0];
};

export const buildDuplicateGroups = (clients: Client[], includeInactive = false): DuplicateGroup[] => {
  // By default only consider non-inativo clients, but allow caller to include all
  const pool = includeInactive ? clients : clients.filter((client) => client.status !== 'inativo');
  const parent = new Map<string, string>();
  const pairReasons = new Map<string, Set<DuplicateReason>>();

  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current !== id) {
      const root = find(current);
      parent.set(id, root);
      return root;
    }
    return current;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  for (const client of pool) {
    parent.set(client.id, client.id);
  }

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i];
      const b = pool[j];
      const reasons: DuplicateReason[] = [];

      const cpfA = normalizeDigits(a.cpf_cnpj);
      const cpfB = normalizeDigits(b.cpf_cnpj);
      // CPFs must be at least 11 digits to count (avoid matching empty strings)
      const sameCpf = cpfA.length >= 11 && cpfA === cpfB;
      const bothHaveCpf = cpfA.length >= 11 && cpfB.length >= 11;
      const differentCpf = bothHaveCpf && cpfA !== cpfB;

      const samePhone = getPrimaryPhone(a) !== '' && getPrimaryPhone(a) === getPrimaryPhone(b);
      const sameName = normalizeSearchText(a.full_name) !== '' && normalizeSearchText(a.full_name) === normalizeSearchText(b.full_name);
      const sameEmail =
        !isBlank(a.email) &&
        !isBlank(b.email) &&
        a.email!.toLowerCase().trim() === b.email!.toLowerCase().trim();

      // CPF diferente normalmente significa gente diferente — mas quando o nome
      // bate exatamente E o contato bate, o mais provável é CPF digitado errado
      // (um dígito trocado). Esse caso não é decidido no chute: entra no grupo
      // marcado como suspeita, para a IA julgar antes de qualquer mesclagem.
      const likelyCpfTypo =
        differentCpf && looksLikeCpfTypo({ cpfA, cpfB, sameName, sameContact: samePhone || sameEmail });
      if (differentCpf && !likelyCpfTypo) continue;

      if (sameCpf) reasons.push('CPF igual');
      if (likelyCpfTypo) reasons.push('CPF parecido');
      if (samePhone) reasons.push('Telefone igual');
      if (sameName) reasons.push('Nome igual');
      if (sameEmail) reasons.push('E-mail igual');

      // Group when:
      // • Same CPF (strong signal)
      // • Same name + another signal (phone or email)
      // • Same name alone — very common in legal systems with same person entered multiple times
      const shouldGroup = sameCpf || sameEmail || (sameName && samePhone) || sameName || likelyCpfTypo;
      if (!shouldGroup) continue;

      union(a.id, b.id);
      const pairKey = [a.id, b.id].sort().join(':');
      pairReasons.set(pairKey, new Set(reasons));
    }
  }

  const grouped = new Map<string, Client[]>();
  for (const client of pool) {
    const root = find(client.id);
    const current = grouped.get(root) ?? [];
    current.push(client);
    grouped.set(root, current);
  }

  return Array.from(grouped.entries())
    .filter(([, groupClients]) => groupClients.length > 1)
    .map(([key, groupClients]) => {
      const reasons = new Set<DuplicateReason>();
      for (let i = 0; i < groupClients.length; i += 1) {
        for (let j = i + 1; j < groupClients.length; j += 1) {
          const pairKey = [groupClients[i].id, groupClients[j].id].sort().join(':');
          const pair = pairReasons.get(pairKey);
          if (!pair) continue;
          pair.forEach((reason) => reasons.add(reason));
        }
      }

      const reasonsArr = Array.from(reasons);

      // Confidence: alta if CPF or email match, media if name+phone, baixa if name only.
      // 'CPF parecido' nunca é alta: é suspeita de erro de digitação, não certeza.
      let confidence: 'alta' | 'media' | 'baixa' = 'baixa';
      if (reasonsArr.includes('CPF parecido')) {
        confidence = 'media';
      } else if (reasonsArr.includes('CPF igual') || reasonsArr.includes('E-mail igual')) {
        confidence = 'alta';
      } else if (reasonsArr.includes('Telefone igual')) {
        confidence = 'media';
      }

      const primary = pickPrimaryClient(groupClients);

      return {
        key,
        clientIds: groupClients.map((client) => client.id),
        clients: groupClients,
        reasons: reasonsArr,
        primaryId: primary.id,
        confidence,
      };
    })
    .sort((a, b) => {
      // Sort by confidence (alta first), then by group size
      const confOrder = { alta: 0, media: 1, baixa: 2 };
      const confDiff = confOrder[a.confidence] - confOrder[b.confidence];
      if (confDiff !== 0) return confDiff;
      return b.clientIds.length - a.clientIds.length;
    });
};

export const buildDuplicateSummaryMap = (groups: DuplicateGroup[]) => {
  const map = new Map<string, { count: number; reasons: string[]; partnerNames: string[] }>();
  for (const group of groups) {
    for (const client of group.clients) {
      const partners = group.clients.filter((item) => item.id !== client.id).map((item) => item.full_name);
      map.set(client.id, {
        count: partners.length,
        reasons: group.reasons,
        partnerNames: partners,
      });
    }
  }
  return map;
};
