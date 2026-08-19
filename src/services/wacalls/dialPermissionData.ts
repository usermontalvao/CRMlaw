// OS DADOS DA PERMISSÃO DE DISCAR — só ida ao banco, nenhum julgamento.
//
// Mesma separação de `callRouting`/`routingData`: a regra é pura e mora em
// `dialPermission.ts`; aqui se busca o cargo, a permissão do cargo e a
// concessão individual, e se guarda a resposta.
//
// UMA RESPOSTA POR ABA, e ela é lembrada. Quem pergunta são três lugares que
// não se conhecem — o botão da barra do topo, o atalho de teclado e a porta de
// saída das ligações (`callStore.placeCall`) — e todos os três perguntam no
// mesmo instante em que a pessoa clica. Sem cache seriam quatro consultas por
// clique; com ele, quatro consultas por sessão.
//
// TRÊS RESPOSTAS, NÃO DUAS. 'unknown' não é um "não" disfarçado: é a consulta
// que ainda não voltou ou que falhou. Confundir as duas coisas faria o CRM
// mandar alguém pedir ao administrador uma permissão que ela já tem — e faria o
// botão sumir da barra a cada oscilação de rede.
import { supabase } from '../../config/supabase';
import { canDial, isAdminRole, normalizeRole, overrideIsActive } from './dialPermission';

export type DialPermission = 'allowed' | 'denied' | 'unknown';

/**
 * Quem é a pessoa, do ponto de vista da permissão — sobra desta consulta e é
 * usada pelo SEGUNDO degrau (`callLinesData`), que precisa saber quem é
 * administrador e de quem procurar a lista de canais. Sem isto, a mesma
 * consulta do perfil seria feita duas vezes na abertura do discador.
 */
export interface DialIdentity { userId: string; isAdmin: boolean }

/** O módulo cuja permissão governa o telefone. Ver o cabeçalho de `dialPermission`. */
const MODULE = 'whatsapp';

/** Dono fictício da resposta armada pela bancada. Ver `primeDialPermissionForPreview`. */
const PREVIEW_OWNER = '@preview';

let estado: DialPermission = 'unknown';
/** De quem é a resposta guardada — trocar de usuário na mesma aba refaz a conta. */
let donoDaResposta: string | null = null;
let identidade: DialIdentity | null = null;
let carregando: Promise<DialPermission> | null = null;

const listeners = new Set<() => void>();

function emit(next: DialPermission): void {
  if (next === estado) return;
  estado = next;
  for (const fn of listeners) fn();
}

/** O que sabemos AGORA, sem esperar nada. É o que a UI desenha. */
export function dialPermissionSnapshot(): DialPermission {
  return estado;
}

export function subscribeDialPermission(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Quem respondeu por último — só depois de `ensureDialPermission` ter rodado.
 * É o que o segundo degrau usa para não repetir a consulta do perfil.
 */
export function dialPermissionIdentity(): DialIdentity | null {
  return identidade;
}

/**
 * DEV-ONLY: força a resposta, para a bancada do discador (`?dialerpreview=1`).
 *
 * A bancada existe justamente para olhar o discador SEM sessão de verdade, e
 * sem esta porta ela veria o mesmo que um estranho vê: nada. Não é chamada em
 * lugar nenhum do CRM — a única entrada é `src/dev/DialerPreview.tsx`.
 */
export function primeDialPermissionForPreview(value: DialPermission, isAdmin = true): void {
  identidade = value === 'allowed' ? { userId: PREVIEW_OWNER, isAdmin } : null;
  donoDaResposta = PREVIEW_OWNER;
  emit(value);
}

/** Esquece tudo (troca de usuário, teste). */
export function resetDialPermission(): void {
  estado = 'unknown';
  donoDaResposta = null;
  identidade = null;
  carregando = null;
  for (const fn of listeners) fn();
}

async function carregar(userId: string): Promise<DialPermission> {
  const [perfil, override] = await Promise.all([
    supabase.from('profiles').select('role').eq('user_id', userId).maybeSingle(),
    supabase
      .from('user_module_overrides')
      .select('can_view, expires_at')
      .eq('user_id', userId)
      .eq('module', MODULE),
  ]);

  // Sem perfil não há cargo a consultar, e sem cargo não há permissão a ler.
  // Isso não é falha de consulta: é uma conta que não é do escritório.
  if (perfil.error) throw perfil.error;
  const role = (perfil.data as { role?: string | null } | null)?.role ?? null;

  const overrideCanView = ((override.data ?? []) as Array<{ can_view: boolean; expires_at: string | null }>)
    .some(row => row.can_view && overrideIsActive(row.expires_at, Date.now()));

  // A tabela guarda o cargo normalizado; o perfil guarda como foi digitado.
  const { data: perm, error: permErro } = await supabase
    .from('role_permissions')
    .select('can_view')
    .eq('role', normalizeRole(role))
    .eq('module', MODULE)
    .maybeSingle();
  if (permErro) throw permErro;

  identidade = { userId, isAdmin: isAdminRole(role) };

  const pode = canDial({
    role,
    moduleCanView: !!(perm as { can_view?: boolean } | null)?.can_view,
    overrideCanView,
  });
  return pode ? 'allowed' : 'denied';
}

/**
 * Pergunta (ou lembra) se esta pessoa pode discar.
 *
 * Falhando a consulta, a resposta ANTERIOR é mantida — quem já estava
 * autorizado não perde o telefone porque a rede oscilou no meio de um clique.
 * Sem resposta anterior, devolve 'unknown', e quem chamou decide o que dizer.
 */
export async function ensureDialPermission(): Promise<DialPermission> {
  // A bancada manda: nenhuma consulta desfaz o que ela armou (e sem sessão de
  // verdade a consulta responderia 'unknown', apagando a bancada inteira).
  if (donoDaResposta === PREVIEW_OWNER) return estado;
  if (carregando) return carregando;

  carregando = (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      // A bancada pode ter armado a resposta DEPOIS de esta consulta começar
      // (os efeitos do React sobem dos filhos para o pai). Confere de novo.
      if (donoDaResposta === PREVIEW_OWNER) return estado;
      const userId = data.user?.id ?? null;
      // Sem sessão não há o que discar — e nem é o caso de dizer que a pessoa
      // não tem permissão: ela não está no CRM.
      if (!userId) {
        donoDaResposta = null;
        identidade = null;
        emit('unknown');
        return 'unknown' as DialPermission;
      }
      if (donoDaResposta === userId && estado !== 'unknown') return estado;

      const resposta = await carregar(userId);
      donoDaResposta = userId;
      emit(resposta);
      return resposta;
    } catch {
      // Mantém o que já se sabia; 'unknown' quando não se sabia nada.
      return estado;
    } finally {
      carregando = null;
    }
  })();

  return carregando;
}
