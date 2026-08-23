/**
 * De onde sai o `WaEscopo` — quem sou eu e onde mando, lido do banco.
 *
 * As regras vivem em `waPermissions.ts` (módulo puro, testado). Este arquivo é
 * só a ligação com o Supabase: uma consulta a `whatsapp_channel_members`, uma a
 * `whatsapp_department_members` e a pergunta `wa_is_admin`.
 *
 * ── POR QUE UM STORE, E NÃO UM HOOK ────────────────────────────────────────
 *
 * A mesma resposta é necessária em lugares que não compartilham contexto: o
 * módulo, o widget flutuante, o discador e o host de chamadas. Um store externo
 * responde a todos com UMA consulta, e é o mesmo desenho já usado pela
 * permissão de discar (`dialPermissionData`).
 *
 * ── A REGRA DO "AINDA NÃO SEI" ─────────────────────────────────────────────
 *
 * Enquanto a resposta não chega, `carregado` é `false` — e é isso que separa
 * "carregando" de "sem permissão" na tela. As duas viravam a mesma inbox vazia
 * antes, e quem abria o CRM antes de a sessão ser restaurada via a mensagem de
 * quem foi barrado.
 */
import { supabase } from '../../config/supabase';
import {
  CHANNEL_MEMBER_TABLE,
  DEPT_MEMBER_TABLE,
} from './shared';
import { ESCOPO_VAZIO, type WaEscopo } from './waPermissions';

type Ouvinte = (escopo: WaEscopo) => void;

const VALIDADE_MS = 60_000;

let escopo: WaEscopo = ESCOPO_VAZIO;
let carregadoEm = 0;
let emVoo: Promise<WaEscopo> | null = null;
const ouvintes = new Set<Ouvinte>();

function publicar(novo: WaEscopo): void {
  escopo = novo;
  for (const o of ouvintes) {
    try { o(novo); } catch { /* um assinante quebrado não derruba os outros */ }
  }
}

/**
 * A coluna `role` (member/supervisor) nasce numa migration desta mesma série, e
 * migration e front-end sobem em momentos diferentes. Pedi-la a um banco que
 * ainda não a tem devolve 42703 — e um erro aqui deixaria o escopo eternamente
 * "carregando", o que na tela vira TODA ação escondida.
 *
 * Então: pergunta com `role`; se o banco disser que não existe, repete sem ela e
 * trata todo mundo como `member`. É a leitura correta para um banco anterior à
 * migration, onde supervisor de canal ainda não existia mesmo.
 */
async function membrosCom<T extends Record<string, unknown>>(
  tabela: string, coluna: string, userId: string,
): Promise<Array<T & { role?: string | null }>> {
  const comPapel = await supabase.from(tabela).select(`${coluna}, role`).eq('user_id', userId);
  if (!comPapel.error) return ((comPapel.data ?? []) as unknown) as Array<T & { role?: string | null }>;
  if (comPapel.error.code !== '42703' && !comPapel.error.message?.includes('role')) {
    throw comPapel.error;
  }
  const semPapel = await supabase.from(tabela).select(coluna).eq('user_id', userId);
  if (semPapel.error) throw semPapel.error;
  return ((semPapel.data ?? []) as unknown) as Array<T & { role?: string | null }>;
}

/**
 * Administrador? `wa_is_admin` é a resposta certa (ela também exige `is_active`),
 * mas ela só existe depois da migration. Sem ela, cai no cargo do perfil — que é
 * exatamente o que o resto do CRM já usa hoje.
 */
async function souAdmin(userId: string): Promise<boolean> {
  const rpc = await supabase.rpc('wa_is_admin');
  if (!rpc.error) return rpc.data === true;
  const { data } = await supabase
    .from('profiles').select('role, is_active').eq('user_id', userId).maybeSingle();
  const cargo = ((data as { role?: string } | null)?.role ?? '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ativo = (data as { is_active?: boolean } | null)?.is_active !== false;
  return ativo && cargo === 'administrador';
}

async function carregar(): Promise<WaEscopo> {
  const { data: sessao } = await supabase.auth.getUser();
  const userId = sessao?.user?.id ?? null;
  if (!userId) {
    // Sem sessão não há escopo — e `carregado: false` mantém a tela em
    // "carregando" em vez de acusar falta de permissão.
    const vazio = { ...ESCOPO_VAZIO };
    publicar(vazio);
    return vazio;
  }

  let linhasCanal: Array<{ channel_id: string; role?: string | null }>;
  let linhasSetor: Array<{ department_id: string; role?: string | null }>;
  let admin: boolean;
  try {
    [linhasCanal, linhasSetor, admin] = await Promise.all([
      membrosCom<{ channel_id: string }>(CHANNEL_MEMBER_TABLE, 'channel_id', userId),
      membrosCom<{ department_id: string }>(DEPT_MEMBER_TABLE, 'department_id', userId),
      souAdmin(userId),
    ]);
  } catch {
    // Erro de rede não pode virar "não tem acesso a nada": nesse caso o escopo
    // continua não carregado, e a tela segue dizendo "carregando".
    const indefinido = { ...ESCOPO_VAZIO, userId };
    publicar(indefinido);
    return indefinido;
  }

  const novo: WaEscopo = {
    userId,
    isAdmin: admin,
    canaisMembro: linhasCanal.map(l => l.channel_id).filter(Boolean),
    canaisSupervisionados: linhasCanal.filter(l => l.role === 'supervisor').map(l => l.channel_id),
    setoresMembro: linhasSetor.map(l => l.department_id).filter(Boolean),
    setoresSupervisionados: linhasSetor.filter(l => l.role === 'supervisor').map(l => l.department_id),
    carregado: true,
  };
  carregadoEm = Date.now();
  publicar(novo);
  return novo;
}

/** Carrega uma vez (ou reaproveita o recente). Chamável à vontade. */
export function garantirEscopoWa(): Promise<WaEscopo> {
  if (escopo.carregado && Date.now() - carregadoEm < VALIDADE_MS) return Promise.resolve(escopo);
  if (emVoo) return emVoo;
  emVoo = carregar().finally(() => { emVoo = null; });
  return emVoo;
}

/** O que se sabe agora — sem esperar. Para `useSyncExternalStore`. */
export function escopoWaAtual(): WaEscopo {
  return escopo;
}

export function assinarEscopoWa(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  void garantirEscopoWa();
  return () => { ouvintes.delete(ouvinte); };
}

/**
 * Esquece o que sabia. Chamado na troca de conta e quando um administrador
 * mexe nos acessos — sem isto, a permissão nova só valeria no próximo F5.
 */
export function esqueceEscopoWa(): void {
  escopo = ESCOPO_VAZIO;
  carregadoEm = 0;
  emVoo = null;
  publicar(escopo);
}

// Troca de conta invalida tudo: o escopo é de uma pessoa, não do navegador.
supabase.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT' || evento === 'SIGNED_IN' || evento === 'USER_UPDATED') {
    esqueceEscopoWa();
    void garantirEscopoWa();
  }
});
