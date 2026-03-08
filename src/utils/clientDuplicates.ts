import type { Client } from '../types/client.types';
import { normalizeSearchText } from './search';

export type DuplicateReason = 'CPF igual' | 'Telefone igual' | 'Nome igual';

export interface DuplicateGroup {
  key: string;
  clientIds: string[];
  clients: Client[];
  reasons: DuplicateReason[];
  primaryId: string;
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
    const statusScoreA = a.status === 'ativo' ? 2 : a.status === 'suspenso' ? 1 : 0;
    const statusScoreB = b.status === 'ativo' ? 2 : b.status === 'suspenso' ? 1 : 0;
    if (statusScoreB !== statusScoreA) return statusScoreB - statusScoreA;

    const completenessDiff = getClientCompletenessScore(b) - getClientCompletenessScore(a);
    if (completenessDiff !== 0) return completenessDiff;

    return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
  })[0];
};

export const buildDuplicateGroups = (clients: Client[]): DuplicateGroup[] => {
  const activeClients = clients.filter((client) => client.status !== 'inativo');
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

  for (const client of activeClients) {
    parent.set(client.id, client.id);
  }

  for (let i = 0; i < activeClients.length; i += 1) {
    for (let j = i + 1; j < activeClients.length; j += 1) {
      const a = activeClients[i];
      const b = activeClients[j];
      const reasons: DuplicateReason[] = [];

      const sameCpf = normalizeDigits(a.cpf_cnpj) !== '' && normalizeDigits(a.cpf_cnpj) === normalizeDigits(b.cpf_cnpj);
      const samePhone = getPrimaryPhone(a) !== '' && getPrimaryPhone(a) === getPrimaryPhone(b);
      const sameName = normalizeSearchText(a.full_name) !== '' && normalizeSearchText(a.full_name) === normalizeSearchText(b.full_name);

      if (sameCpf) reasons.push('CPF igual');
      if (samePhone) reasons.push('Telefone igual');
      if (sameName) reasons.push('Nome igual');

      const shouldGroup = sameCpf || reasons.length >= 2;
      if (!shouldGroup) continue;

      union(a.id, b.id);
      const pairKey = [a.id, b.id].sort().join(':');
      pairReasons.set(pairKey, new Set(reasons));
    }
  }

  const grouped = new Map<string, Client[]>();
  for (const client of activeClients) {
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

      const primary = pickPrimaryClient(groupClients);

      return {
        key,
        clientIds: groupClients.map((client) => client.id),
        clients: groupClients,
        reasons: Array.from(reasons),
        primaryId: primary.id,
      };
    })
    .sort((a, b) => b.clientIds.length - a.clientIds.length);
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
