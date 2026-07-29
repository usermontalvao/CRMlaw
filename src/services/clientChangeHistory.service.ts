/**
 * services/clientChangeHistory
 * -----------------------------------------------------------------------------
 * Trilha de alterações do cadastro do cliente.
 *
 * Regra do escritório: dado novo entra, dado antigo não some. Quando um campo é
 * sobrescrito — na edição manual, ao aprovar uma solicitação do portal, ao
 * importar o que o cliente informou na assinatura ou ao mesclar dois cadastros
 * da mesma pessoa — o valor anterior fica registrado aqui, junto com a origem.
 *
 * O registro nunca derruba a operação principal: se a gravação do histórico
 * falhar, a alteração do cadastro continua valendo (o erro só vai ao console).
 */

import { supabase } from '../config/supabase';

export type ClientChangeSource = 'edicao' | 'mesclagem' | 'portal' | 'assinatura' | 'importacao';

export interface ClientChangeEntry {
  id: string;
  client_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: ClientChangeSource;
  source_client_id: string | null;
  source_label: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface ClientChangeInput {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
  sourceClientId?: string | null;
  sourceLabel?: string | null;
}

/** Rótulos legíveis das colunas — usados na ficha e nos relatórios. */
export const CLIENT_FIELD_LABELS: Record<string, string> = {
  full_name: 'Nome completo',
  cpf_cnpj: 'CPF/CNPJ',
  rg: 'RG',
  birth_date: 'Nascimento',
  nationality: 'Nacionalidade',
  marital_status: 'Estado civil',
  profession: 'Profissão',
  client_type: 'Tipo de pessoa',
  email: 'E-mail',
  phone: 'Telefone',
  mobile: 'Celular',
  address_street: 'Rua',
  address_number: 'Número',
  address_complement: 'Complemento',
  address_neighborhood: 'Bairro',
  address_city: 'Cidade',
  address_state: 'UF',
  address_zip_code: 'CEP',
  notes: 'Observações',
  status: 'Status',
};

export const CLIENT_CHANGE_SOURCE_LABELS: Record<ClientChangeSource, string> = {
  edicao: 'Edição manual',
  mesclagem: 'Mesclagem de duplicados',
  portal: 'Solicitação do portal',
  assinatura: 'Dados da assinatura',
  importacao: 'Importação',
};

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

export const clientChangeHistoryService = {
  /**
   * Grava um lote de alterações. Entradas em que o valor não mudou de verdade
   * são descartadas — o histórico só guarda mudança real.
   */
  async record(clientId: string, source: ClientChangeSource, changes: ClientChangeInput[]): Promise<void> {
    const rows = changes
      .map((change) => ({
        client_id: clientId,
        field: change.field,
        old_value: asText(change.oldValue),
        new_value: asText(change.newValue),
        source,
        source_client_id: change.sourceClientId ?? null,
        source_label: change.sourceLabel ?? null,
      }))
      .filter((row) => row.old_value !== row.new_value);

    if (rows.length === 0) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const changedBy = userData?.user?.id ?? null;
      const { error } = await supabase
        .from('client_change_history')
        .insert(rows.map((row) => ({ ...row, changed_by: changedBy })));
      if (error) throw new Error(error.message);
    } catch (err) {
      // Histórico é trilha, não é bloqueio: a alteração do cadastro já aconteceu.
      console.error('Não foi possível registrar o histórico do cadastro:', err);
    }
  },

  /**
   * Compara dois estados do cadastro e devolve só o que mudou, pronto para
   * `record`. Usado pela edição manual e pela mesclagem.
   */
  diff(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
    fields: string[],
  ): ClientChangeInput[] {
    if (!before || !after) return [];
    const out: ClientChangeInput[] = [];
    for (const field of fields) {
      const oldValue = asText(before[field]);
      const newValue = asText(after[field]);
      if (oldValue !== newValue) out.push({ field, oldValue, newValue });
    }
    return out;
  },

  async list(clientId: string, limit = 100): Promise<ClientChangeEntry[]> {
    const { data, error } = await supabase
      .from('client_change_history')
      .select('*')
      .eq('client_id', clientId)
      .order('changed_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as ClientChangeEntry[];
  },
};

export default clientChangeHistoryService;
