/**
 * `job-token` — a autenticação das rotinas internas (pg_cron e gatilhos do banco).
 *
 * O QUE ISTO SUBSTITUI
 * --------------------
 * Cada rotina tinha a sua própria linha, sempre neste molde:
 *
 *   const TOKEN = Deno.env.get('WA_SCHEDULER_TOKEN') || 'wa-scheduler-2026';
 *   if (url.searchParams.get('token') !== TOKEN) return 401;
 *
 * Duas coisas erradas aí, e a segunda é pior do que parece:
 *
 *   1. o `?token=` na URL vai para log de acesso, histórico e referrer — um
 *      segredo não viaja na linha de endereço;
 *   2. o `||` parecia um fallback de desenvolvimento, mas `WA_SCHEDULER_TOKEN`,
 *      `WA_FOLLOWUP_TOKEN` e `WA_DOC_INTAKE_TOKEN` nunca foram criados neste
 *      projeto. O literal ERA a credencial de produção — escrita no
 *      repositório — do disparo de mensagem para cliente e das três varreduras
 *      de acompanhamento.
 *
 * COMO FUNCIONA AGORA
 * -------------------
 * O segredo é sorteado dentro do banco (migration
 * `20260821250000_tokens_das_rotinas_saem_do_codigo`) e vive em
 * `private.app_secrets`, schema sem GRANT para `anon` nem `authenticated`.
 *
 *   · quem chama (cron ou gatilho) LÊ o valor na hora da chamada e o manda no
 *     header `x-job-token` — nenhum literal em SQL, nenhum segredo na URL;
 *   · quem recebe confere pela RPC `wa_job_token_ok`, concedida só ao service
 *     role, que compara em tempo constante.
 *
 * Nenhuma variável de ambiente, então: não há o que esquecer de configurar, e
 * não existe caminho em que a função "cai no padrão" e aceita o que não devia.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Escopos válidos — um por rotina, para que um token não sirva na porta da outra. */
export type JobScope =
  | 'wa_scheduler_token'
  | 'wa_followup_token'
  | 'wa_doc_intake_token'
  | 'wa_retention_token';

export async function jobTokenOk(scope: JobScope, req: Request): Promise<boolean> {
  const token = (req.headers.get('x-job-token') || '').trim();
  if (!token) return false;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin.rpc('wa_job_token_ok', { p_scope: scope, p_token: token });
  if (error) {
    console.error('[job-token] falha ao conferir o segredo:', error.message);
    return false;
  }
  return data === true;
}

/** A recusa, igual em todas as rotinas. */
export function naoAutorizado(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });
}
