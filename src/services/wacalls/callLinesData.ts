// OS DADOS DAS LINHAS — os canais do CRM e a lista de membros de cada um.
//
// Mesma divisão do resto do módulo: a regra é pura e mora em `callLine.ts`;
// aqui só se busca. Duas consultas, as duas com cache curto — canal e membro
// mudam em dias, não em minutos, e a mesma pergunta é feita toda vez que o
// serviço de voz reanuncia as contas pareadas.
import { supabase } from '../../config/supabase';
import { buildLines, type CallLine, type ChannelRow, type SessionRow } from './callLine';
import { dialPermissionIdentity, ensureDialPermission } from './dialPermissionData';

const CACHE_MS = 5 * 60_000;

interface Cache<T> { at: number; value: T }
const valido = <T>(c: Cache<T> | null): c is Cache<T> => !!c && Date.now() - c.at < CACHE_MS;

let canaisCache: Cache<ChannelRow[]> | null = null;
let membrosCache: Cache<{ dono: string; canais: Set<string> }> | null = null;

/** Esquece tudo (troca de usuário, cadastro de membro, teste). */
export function resetCallLines(): void {
  canaisCache = null;
  membrosCache = null;
}

/**
 * Os canais do CRM, com número e regra de visibilidade.
 *
 * LISTA VAZIA NUNCA É GUARDADA, e essa regra vale ouro aqui. A política de
 * leitura de `whatsapp_instances` é `wa_can_see_channel(...)`, que começa em
 * `is_office_staff()` — quer dizer: uma consulta feita ANTES de a sessão do
 * Supabase ser restaurada volta com ZERO LINHAS E NENHUM ERRO. É indistinguível,
 * no código, de "este escritório não tem canal nenhum".
 *
 * Guardar esse vazio por cinco minutos foi exatamente o que fez o discador ficar
 * repetindo "Nenhum canal disponível" até alguém recarregar a página: a consulta
 * certa nunca era refeita, porque o cache dizia que a resposta já era conhecida.
 * Vazio agora é tratado como "ainda não sei", que é o que ele de fato é.
 */
async function canais(): Promise<ChannelRow[]> {
  if (valido(canaisCache)) return canaisCache.value;
  try {
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .select('id, name, phone_number, visibility_mode');
    if (error) throw error;
    const linhas = ((data ?? []) as Array<{
      id: string; name: string | null; phone_number: string | null; visibility_mode: string | null;
    }>).map<ChannelRow>(row => ({
      id: row.id,
      name: row.name,
      phone: row.phone_number,
      visibility: row.visibility_mode,
    }));
    if (linhas.length > 0) canaisCache = { at: Date.now(), value: linhas };
    return linhas;
  } catch {
    return [];
  }
}

/** Os canais em que ESTA pessoa está cadastrada como membro. */
async function membros(userId: string): Promise<Set<string>> {
  if (valido(membrosCache) && membrosCache.value.dono === userId) return membrosCache.value.canais;
  try {
    const { data, error } = await supabase
      .from('whatsapp_channel_members')
      .select('channel_id')
      .eq('user_id', userId);
    if (error) throw error;
    const conjunto = new Set(
      ((data ?? []) as Array<{ channel_id: string }>).map(row => row.channel_id),
    );
    // Aqui o vazio PODE ser guardado: "não sou membro de canal nenhum" é uma
    // resposta legítima e comum. O que não pode é ser de outra pessoa — daí o
    // dono no cache.
    membrosCache = { at: Date.now(), value: { dono: userId, canais: conjunto } };
    return conjunto;
  } catch {
    return new Set();
  }
}

/**
 * As contas pareadas no serviço de voz, vestidas de LINHA: com o nome do canal,
 * o número e o direito de usá-la.
 *
 * Sem sessão de usuário nenhuma, devolve as linhas sem autorização — não é o
 * caso de inventar permissão para quem nem está no CRM.
 */
export class LinesNotReady extends Error {
  constructor(readonly motivo: 'sem-sessao' | 'sem-canais') {
    super(`linhas ainda não podem ser resolvidas: ${motivo}`);
    this.name = 'LinesNotReady';
  }
}

export async function resolveLines(sessions: readonly SessionRow[]): Promise<CallLine[]> {
  // SEM contas pareadas ainda há linhas: os canais do CRM, cada um dizendo que
  // não tem voz. É o que faz a faixa do discador nomear um canal em vez de
  // cair num texto genérico quando o serviço de voz está fora.
  await ensureDialPermission();
  const identidade = dialPermissionIdentity();
  // SEM SESSÃO NÃO SE RESPONDE NADA. Toda consulta daqui passa por RLS ancorada
  // em `auth.uid()`: sem usuário, o banco devolve vazio sem reclamar, e esse
  // vazio viraria "você não tem canal nenhum" na cara de quem tem todos.
  if (!identidade?.userId) throw new LinesNotReady('sem-sessao');

  const [lista, meus] = await Promise.all([canais(), membros(identidade.userId)]);
  // Mesma história: zero canais com sessão de pé é possível (escritório novo),
  // mas é MUITO mais provável ser a consulta que ainda não pôde ser feita. Quem
  // chamou fica com as linhas que já tinha em vez de perdê-las.
  if (lista.length === 0) throw new LinesNotReady('sem-canais');

  return buildLines({
    sessions,
    channels: lista,
    isAdmin: !!identidade.isAdmin,
    memberOf: meus,
  });
}
