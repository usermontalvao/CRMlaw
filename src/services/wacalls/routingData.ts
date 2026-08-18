// OS DADOS DA ESCADA — quem é responsável, qual setor, quem é da administração.
//
// A regra de para quem o telefone toca é pura e mora em `callRouting`; este
// módulo é o contrário dela: só ida ao banco, nenhum julgamento. A separação
// não é enfeite — é o que permite testar a hierarquia inteira com `node --test`
// sem cliente Supabase nenhum.
//
// Duas telas consomem daqui, e as duas precisam da MESMA escada:
//
//  · O CONVITE que está tocando (`callStore`), uma chamada por vez;
//  · O CARTÃO DE PERDIDA (`missedCallStore`), uma lista inteira de uma vez —
//    daí as buscas serem em lote (`.in(...)`) em vez de uma consulta por linha.
//
// CACHE com validade curta: canal, setor e administração mudam em dias, não em
// minutos, e a mesma chamada consulta esses três dados quatro vezes durante o
// toque. O que NÃO entra em cache é o responsável da conversa — ele muda no meio
// do atendimento, e é justamente a informação mais específica da escada.
import { supabase } from '../../config/supabase';
import {
  buildCallLadder, missedCallAudience, missedCallIsMine,
  type CallDegree, type CallDepartment,
} from './callRouting';

/** Quanto tempo os dados de estrutura (canal, setor, admin) valem. */
const CACHE_MS = 5 * 60_000;

interface Cache<T> { at: number; value: T }
const validade = <T>(c: Cache<T> | null): c is Cache<T> => !!c && Date.now() - c.at < CACHE_MS;

let adminsCache: Cache<string[]> | null = null;
let canaisCache: Cache<Map<string, { defaultAssigneeId: string | null }>> | null = null;
let canalSetoresCache: Cache<Map<string, string[]>> | null = null;
let setoresCache: Cache<Map<string, CallDepartment>> | null = null;
const nomes = new Map<string, string | null>();

/** Esquece tudo. Só para teste e para a troca de usuário. */
export function resetRoutingCache(): void {
  adminsCache = null;
  canaisCache = null;
  canalSetoresCache = null;
  setoresCache = null;
  nomes.clear();
}

/**
 * Os administradores do escritório — o penúltimo degrau.
 *
 * O cargo é texto livre no perfil (`profiles.role`), escrito pela tela de
 * usuários; a comparação é a mesma de `usePermissions`, sem diferença de
 * maiúsculas. Falhando a consulta, a lista volta VAZIA e a escada cai para
 * "todos" — perder a ligação porque a consulta do cargo falhou seria o pior
 * desfecho possível.
 */
export async function adminUserIds(): Promise<string[]> {
  if (validade(adminsCache)) return adminsCache.value;
  try {
    const { data } = await supabase.from('profiles').select('user_id, role').ilike('role', 'administrador');
    const ids = ((data ?? []) as Array<{ user_id: string | null }>)
      .map(r => r.user_id)
      .filter((id): id is string => !!id);
    adminsCache = { at: Date.now(), value: ids };
    return ids;
  } catch {
    return [];
  }
}

/** Nome de exibição de alguém, para o cartão dizer para quem está tocando. */
export async function profileNames(userIds: readonly string[]): Promise<Map<string, string | null>> {
  const faltando = Array.from(new Set(userIds.filter(id => id && !nomes.has(id))));
  if (faltando.length > 0) {
    try {
      const { data } = await supabase.from('profiles').select('user_id, name').in('user_id', faltando);
      for (const row of (data ?? []) as Array<{ user_id: string; name: string | null }>) {
        nomes.set(row.user_id, row.name ?? null);
      }
    } catch {
      // Sem nome, o cartão diz "o responsável" — a decisão de tocar não muda.
    }
    for (const id of faltando) if (!nomes.has(id)) nomes.set(id, null);
  }
  const saida = new Map<string, string | null>();
  for (const id of userIds) saida.set(id, nomes.get(id) ?? null);
  return saida;
}

/** Responsável padrão de cada canal. */
async function canais(): Promise<Map<string, { defaultAssigneeId: string | null }>> {
  if (validade(canaisCache)) return canaisCache.value;
  const mapa = new Map<string, { defaultAssigneeId: string | null }>();
  try {
    const { data } = await supabase.from('whatsapp_instances').select('id, default_assignee_id');
    for (const row of (data ?? []) as Array<{ id: string; default_assignee_id: string | null }>) {
      mapa.set(row.id, { defaultAssigneeId: row.default_assignee_id ?? null });
    }
    canaisCache = { at: Date.now(), value: mapa };
  } catch {
    // Vai sem canal: a escada segue para setor e administração.
  }
  return mapa;
}

/**
 * Setores de cada canal, o PADRÃO na frente.
 *
 * A ordem importa: um canal com três setores ligados toca primeiro para o que
 * o escritório marcou como padrão (`is_default`) — é a mesma escolha que o
 * webhook faz ao decidir o setor de uma conversa nova.
 */
async function setoresDoCanal(): Promise<Map<string, string[]>> {
  if (validade(canalSetoresCache)) return canalSetoresCache.value;
  const mapa = new Map<string, string[]>();
  try {
    const { data } = await supabase
      .from('whatsapp_channel_departments').select('channel_id, department_id, is_default');
    const linhas = (data ?? []) as Array<{ channel_id: string; department_id: string; is_default: boolean | null }>;
    for (const row of linhas) {
      const lista = mapa.get(row.channel_id) ?? [];
      if (row.is_default) lista.unshift(row.department_id); else lista.push(row.department_id);
      mapa.set(row.channel_id, lista);
    }
    canalSetoresCache = { at: Date.now(), value: mapa };
  } catch {
    // Sem vínculo canal↔setor, a escada pula direto para a administração.
  }
  return mapa;
}

/** Nome e membros de cada setor. */
async function setores(): Promise<Map<string, CallDepartment>> {
  if (validade(setoresCache)) return setoresCache.value;
  const mapa = new Map<string, CallDepartment>();
  try {
    const [{ data: deps }, { data: membros }] = await Promise.all([
      supabase.from('whatsapp_departments').select('id, name, is_active'),
      supabase.from('whatsapp_department_members').select('department_id, user_id'),
    ]);
    for (const d of (deps ?? []) as Array<{ id: string; name: string | null; is_active: boolean | null }>) {
      // Setor desativado não atende ligação: ele foi desligado de propósito.
      if (d.is_active === false) continue;
      mapa.set(d.id, { name: d.name ?? null, memberIds: [] });
    }
    for (const m of (membros ?? []) as Array<{ department_id: string; user_id: string }>) {
      const setor = mapa.get(m.department_id);
      if (setor) setor.memberIds = [...setor.memberIds, m.user_id];
    }
    setoresCache = { at: Date.now(), value: mapa };
  } catch {
    // Idem: a escada continua sem este degrau.
  }
  return mapa;
}

/** O que uma conversa diz sobre quem deve atendê-la. */
export interface ConversationRouting {
  assignedUserId: string | null;
  departmentId: string | null;
  instanceId: string | null;
}

/** Lê várias conversas de uma vez (o cartão de perdida traz uma lista). */
export async function conversationRouting(
  conversationIds: readonly string[],
): Promise<Map<string, ConversationRouting>> {
  const mapa = new Map<string, ConversationRouting>();
  const ids = Array.from(new Set(conversationIds.filter(Boolean)));
  if (ids.length === 0) return mapa;
  try {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('id, assigned_user_id, department_id, instance_id')
      .in('id', ids);
    for (const row of (data ?? []) as Array<{
      id: string; assigned_user_id: string | null; department_id: string | null; instance_id: string | null;
    }>) {
      mapa.set(row.id, {
        assignedUserId: row.assigned_user_id ?? null,
        departmentId: row.department_id ?? null,
        instanceId: row.instance_id ?? null,
      });
    }
  } catch {
    // Sem a conversa, a chamada é tratada como órfã (administração).
  }
  return mapa;
}

/**
 * Monta a escada de UMA chamada, com os dados já em mãos ou buscados agora.
 *
 * Quem chama com o convite tocando já sabe o responsável e o canal (a
 * identificação do contato os traz); quem chama pelo cartão de perdida vem só
 * com a conversa. Os dois caminhos entram aqui.
 */
export async function buildLadderFor(input: {
  assignedUserId?: string | null;
  departmentId?: string | null;
  instanceId?: string | null;
}): Promise<CallDegree[]> {
  const [porCanal, vinculos, listaSetores, admins] = await Promise.all([
    canais(), setoresDoCanal(), setores(), adminUserIds(),
  ]);

  const canalId = input.instanceId ?? null;
  const canalAssignee = canalId ? porCanal.get(canalId)?.defaultAssigneeId ?? null : null;
  const setorDaConversa = input.departmentId ? listaSetores.get(input.departmentId) ?? null : null;
  const setoresDoCanalDaVez = (canalId ? vinculos.get(canalId) ?? [] : [])
    // O setor da conversa não se repete lá embaixo: ele já é o degrau 2, e um
    // degrau repetido só faria a escalada parecer que andou sem ter andado.
    .filter(id => id !== input.departmentId)
    .map(id => listaSetores.get(id))
    .filter((s): s is CallDepartment => !!s);

  const paraNomear = [input.assignedUserId, canalAssignee].filter((v): v is string => !!v);
  const nomesDeles = await profileNames(paraNomear);

  return buildCallLadder({
    assignedUserId: input.assignedUserId ?? null,
    assignedName: input.assignedUserId ? nomesDeles.get(input.assignedUserId) ?? null : null,
    conversationDepartment: setorDaConversa,
    channelAssigneeId: canalAssignee,
    channelAssigneeName: canalAssignee ? nomesDeles.get(canalAssignee) ?? null : null,
    channelDepartments: setoresDoCanalDaVez,
    adminIds: admins,
  });
}

/**
 * A escada de várias chamadas perdidas de uma vez.
 *
 * Uma consulta de conversas para a lista inteira, e o resto sai do cache. Sem
 * isto, um cartão com oito perdidas faria oito rodadas de quatro consultas cada
 * — em qualquer módulo do CRM, a cada cinco minutos.
 */
export async function buildLaddersByConversation(
  conversationIds: readonly string[],
): Promise<Map<string, CallDegree[]>> {
  const rotas = await conversationRouting(conversationIds);
  const saida = new Map<string, CallDegree[]>();
  for (const [id, rota] of rotas) {
    saida.set(id, await buildLadderFor(rota));
  }
  return saida;
}

/** A escada de quem não tem conversa nenhuma: administração, e só. */
export async function orphanLadder(): Promise<CallDegree[]> {
  return buildLadderFor({});
}

/** Quem sou eu — cache de aba, porque a resposta não muda dentro dela. */
let meuId: string | null | undefined;
export async function myUserId(): Promise<string | null> {
  if (meuId !== undefined) return meuId;
  try {
    const { data } = await supabase.auth.getUser();
    meuId = data.user?.id ?? null;
  } catch {
    meuId = null;
  }
  return meuId;
}

/**
 * DAS PERDIDAS DO ESCRITÓRIO, AS QUE SÃO MINHAS.
 *
 * O aviso na tela e o distintivo da aba de Ligações precisam concordar sobre
 * isto, senão o escritório fica com um contador aceso apontando para uma
 * ligação que nenhum cartão mostra. Por isso a leitura é UMA, aqui, e as duas
 * telas chamam a mesma função.
 *
 * A ligação sem conversa (número que nunca escreveu) é da administração — a
 * mesma escada do toque, parada no primeiro degrau (ver `missedCallAudience`).
 *
 * Falhando a consulta, NADA é escondido: um aviso a mais é ruído, um aviso a
 * menos é cliente sem retorno.
 */
export async function missedCallsForMe<T extends { conversationId: string | null }>(
  rows: readonly T[],
): Promise<T[]> {
  if (rows.length === 0) return [];
  try {
    const comConversa = rows
      .map(r => r.conversationId)
      .filter((id): id is string => !!id);
    const [me, escadas, orfa] = await Promise.all([
      myUserId(),
      buildLaddersByConversation(comConversa),
      rows.some(r => !r.conversationId) ? orphanLadder() : Promise.resolve(null),
    ]);
    return rows.filter(row => {
      const escada = row.conversationId ? escadas.get(row.conversationId) : orfa;
      if (!escada) return true;
      return missedCallIsMine(missedCallAudience(escada), me);
    });
  } catch {
    return [...rows];
  }
}
