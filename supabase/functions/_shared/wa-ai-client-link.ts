/**
 * Garante o apoio mínimo para ações que dependem de `clients.id`.
 *
 * Um lead novo do WhatsApp normalmente ainda não é cliente. O CRM já resolveu
 * isso com `clients.is_pre_cadastro`: a linha serve para pendurar documentos,
 * agenda e prazos sem entrar na carteira de clientes. A IA usa a mesma regra,
 * depois de qualificar a triagem, em vez de falhar exatamente no fechamento.
 */

export interface WaAiLinkableConversation {
  id: string;
  client_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

export type WaAiClientLinkResult =
  | { ok: true; clientId: string; created: boolean }
  | { ok: false; error: string };

export function normalizeWaAiClientPhone(value: unknown): string | null {
  let digits = String(value ?? '').replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length === 12 || digits.length === 13 ? digits : null;
}

/**
 * Formas equivalentes do celular brasileiro, com e sem o nono dígito.
 *
 * Esta versão vive no backend para que a vinculação não dependa da política
 * de acesso de uma RPC voltada também à interface da equipe.
 */
export function waAiClientPhoneVariants(value: unknown): string[] {
  const normalized = normalizeWaAiClientPhone(value);
  if (!normalized) return [];

  const out = new Set<string>([normalized]);
  const match = normalized.match(/^55(\d{2})(\d+)$/);
  if (!match) return [...out];

  const [, ddd, local] = match;
  if (local.length === 9 && local[0] === '9') out.add(`55${ddd}${local.slice(1)}`);
  else if (local.length === 8) out.add(`55${ddd}9${local}`);
  return [...out];
}

export type WaAiPhoneMatch = { id: string; phone?: string | null; mobile?: string | null };

/**
 * Casamento interno por telefone para Edge Functions.
 *
 * O sufixo de quatro dígitos limita a leitura no banco; a igualdade de verdade
 * é refeita em memória sobre os números normalizados. Assim formatação,
 * código do país e o nono dígito não criam duplicata, sem reabrir a RPC pública
 * que protege dados pessoais da base.
 */
export async function matchWaAiClientsByPhone(
  admin: any,
  value: unknown,
): Promise<{ data: WaAiPhoneMatch[]; error: any | null }> {
  const variants = waAiClientPhoneVariants(value);
  if (variants.length === 0) return { data: [], error: null };

  const tail = variants[0].slice(-4);
  const { data, error } = await admin
    .from('clients')
    .select('id, phone, mobile')
    .neq('status', 'arquivado')
    .is('merged_into_client_id', null)
    .or(`phone.ilike.%${tail}%,mobile.ilike.%${tail}%`)
    .limit(50);

  if (error) return { data: [], error };

  const wanted = new Set(variants);
  const matches = ((data ?? []) as WaAiPhoneMatch[]).filter((row) =>
    [...waAiClientPhoneVariants(row.phone), ...waAiClientPhoneVariants(row.mobile)]
      .some((candidate) => wanted.has(candidate)),
  );
  return { data: matches, error: null };
}

function usableName(value: unknown, phone: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text && !/^\+?\d[\d\s().-]+$/.test(text)) return text.slice(0, 160);
  return `Contato WhatsApp ${phone.slice(-4)}`;
}

async function linkConversation(admin: any, conversationId: string, clientId: string) {
  const { error } = await admin.from('whatsapp_conversations')
    .update({ client_id: clientId })
    .eq('id', conversationId);
  return error ? String(error.message || error) : null;
}

/** Casa por telefone; sem candidato cria pré-cadastro; com ambiguidade falha fechado. */
export async function ensureWaAiConversationClient(
  admin: any,
  conversation: WaAiLinkableConversation,
  preferredName?: string | null,
): Promise<WaAiClientLinkResult> {
  if (conversation.client_id) return { ok: true, clientId: conversation.client_id, created: false };

  const phone = normalizeWaAiClientPhone(conversation.contact_phone);
  if (!phone) {
    return { ok: false, error: 'O contato não possui telefone válido para criar o pré-cadastro.' };
  }

  const { data: candidates, error: matchError } = await matchWaAiClientsByPhone(admin, phone);
  if (matchError) {
    return { ok: false, error: 'Não foi possível conferir se este telefone já possui cadastro.' };
  }

  const unique = Array.from(new Set(
    (Array.isArray(candidates) ? candidates : []).map(row => String(row?.id || '')).filter(Boolean),
  ));
  if (unique.length > 1) {
    return {
      ok: false,
      error: 'Este telefone corresponde a mais de um cadastro. Passe para um atendente escolher o vínculo correto.',
    };
  }

  if (unique.length === 1) {
    const linkError = await linkConversation(admin, conversation.id, unique[0]);
    if (linkError) return { ok: false, error: 'O cadastro foi encontrado, mas não foi possível vincular a conversa.' };
    conversation.client_id = unique[0];
    return { ok: true, clientId: unique[0], created: false };
  }

  const fullName = usableName(preferredName || conversation.contact_name, phone);
  const { data: created, error: createError } = await admin.from('clients').insert({
    full_name: fullName,
    mobile: phone,
    client_type: 'pessoa_fisica',
    status: 'ativo',
    is_pre_cadastro: true,
  }).select('id').single();
  const clientId = String(created?.id || '');
  if (createError || !clientId) {
    return { ok: false, error: 'Não foi possível criar o pré-cadastro necessário para os documentos.' };
  }

  const linkError = await linkConversation(admin, conversation.id, clientId);
  if (linkError) {
    // Recuperável e seguro: a linha acabou de nascer e ainda não recebeu nenhum
    // documento. Não deixa pré-cadastro órfão por falha de vínculo.
    await admin.from('clients').delete().eq('id', clientId);
    return { ok: false, error: 'O pré-cadastro foi criado, mas não foi possível vincular a conversa.' };
  }

  conversation.client_id = clientId;
  return { ok: true, clientId, created: true };
}
