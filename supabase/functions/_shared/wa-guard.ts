/**
 * `wa-guard` — a ordem obrigatória antes de qualquer `service_role`.
 *
 * TODA Edge Function do WhatsApp faz a mesma coisa: recebe ids do navegador e
 * escreve com service role, que ignora RLS. Sem porteiro, o id do corpo VIRA a
 * permissão — trocar um `conversation_id` bastava para escrever (ou fazer o
 * "digitando…" aparecer) num atendimento de canal alheio.
 *
 * A ordem, e ela não é negociável:
 *
 *   1. validar o JWT (`auth.getUser` — não basta o gateway ter deixado passar:
 *      ele aceita qualquer `authenticated`, inclusive o cliente do Portal);
 *   2. confirmar que é gente da casa E ATIVA (`is_office_staff`, que desde a
 *      migration do núcleo exige `is_active`);
 *   3. consultar o recurso com o cliente DO USUÁRIO — quem responde é a mesma
 *      policy que recorta a inbox; linha que ele não pode ler volta nula;
 *   4. 403 quando nula;
 *   5. só então o service role.
 *
 * O passo 3 é o que não dá para trocar por uma verificação "equivalente"
 * escrita à mão: qualquer regra reimplementada aqui envelhece separada da
 * policy, e a divergência entre as duas é exatamente o tipo de furo que
 * ninguém encontra por leitura.
 *
 * ── SOBRE O `isSystem` ─────────────────────────────────────────────────────
 *
 * Cron e gatilho do banco chamam com a própria service role e não são um
 * "usuário". Esse caminho pula o porteiro de propósito — ele já É o privilégio.
 * O que ele NÃO pode fazer é aceitar um `Authorization` qualquer: a comparação
 * é com o segredo, e só vale quando `auth.getUser()` não devolveu ninguém.
 */
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

export interface ContextoWa {
  /** Quem chamou. `null` em chamada de sistema. */
  user: User | null;
  /** Chamada de cron/gatilho autenticada pela service role. */
  isSystem: boolean;
  /** Cliente que RESPEITA RLS — é com ele que se pergunta "posso?". */
  userClient: SupabaseClient;
  /** Cliente privilegiado — só depois de o porteiro responder. */
  admin: SupabaseClient;
}

const CORS_PADRAO = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};

export function respostaJson(body: unknown, status = 200, cors: Record<string, string> = CORS_PADRAO) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Passos 1 e 2. Devolve o contexto, ou a resposta de recusa já pronta. */
export async function abrirContexto(req: Request): Promise<ContextoWa | Response> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') || '';

  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: { user } } = await userClient.auth.getUser();

  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const isSystem = !user && bearer.length > 0 && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!user && !isSystem) return respostaJson({ error: 'Não autenticado' }, 401);

  if (user) {
    // Gente da casa E ativa. Cliente do Portal tem JWT válido e não passa aqui.
    const { data: equipe } = await userClient.rpc('is_office_staff');
    if (equipe !== true) return respostaJson({ error: 'Sem permissão' }, 403);
  }

  return { user, isSystem, userClient, admin };
}

/**
 * Passo 3 — "essa linha existe PARA MIM?".
 *
 * Pergunta feita com o cliente do usuário: a policy responde, e nula é 403.
 */
export async function podeVer(
  ctx: ContextoWa,
  tabela: string,
  id: string | null | undefined,
): Promise<boolean> {
  if (ctx.isSystem) return true;
  if (!id) return false;
  const { data } = await ctx.userClient.from(tabela).select('id').eq('id', id).maybeSingle();
  return !!data;
}

/** Ver não é responder: supervisor em "apenas acompanhar" vê e não manda. */
export async function podeResponder(ctx: ContextoWa, conversationId: string | null | undefined): Promise<boolean> {
  if (ctx.isSystem) return true;
  if (!conversationId) return false;
  const { data, error } = await ctx.userClient.rpc('wa_can_reply_conv', { p_conv: conversationId });
  if (error) return false;
  return data === true;
}

/** Mexer no atendimento (responsável, fila, bloqueio, encerramento). */
export async function podeComandar(ctx: ContextoWa, conversationId: string | null | undefined): Promise<boolean> {
  if (ctx.isSystem) return true;
  if (!conversationId) return false;
  const { data, error } = await ctx.userClient.rpc('wa_can_manage_conv', { p_conv: conversationId });
  if (error) return false;
  return data === true;
}

/** Administrador ativo. Para o que é do escritório, não do atendimento. */
export async function ehAdmin(ctx: ContextoWa): Promise<boolean> {
  if (ctx.isSystem) return true;
  const { data } = await ctx.userClient.rpc('wa_is_admin');
  return data === true;
}

export function negado(mensagem = 'Você não tem acesso a este atendimento.') {
  return respostaJson({ error: mensagem }, 403);
}
