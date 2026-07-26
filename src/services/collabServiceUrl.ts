/**
 * collabServiceUrl
 * -----------------------------------------------------------------------------
 * Decide QUAL servidor de coedição usar — e existe por causa de um apagão real.
 *
 * Em 26/07/2026 a produção foi publicada com o código de coedição certo e a
 * variável `VITE_SYNCFUSION_COLLAB_URL` VAZIA: o pipeline que constrói o site
 * não lê o `[build.environment]` do netlify.toml nem o render.yaml (esses
 * arquivos só valem quando o próprio host constrói a partir deles). Resultado:
 * `isCollabEnabled()` falso, cada navegador com a sua cópia do .docx e nenhum
 * aviso — o sintoma clássico de "as pessoas aparecem, o texto não atravessa".
 *
 * Por isso, EM PRODUÇÃO o endereço do serviço tem um padrão embutido por
 * hostname. Ele é público (está versionado no render.yaml pelo mesmo motivo) e
 * a variável de build continua mandando quando existir — inclusive para
 * apontar um ambiente de teste.
 *
 * Fora dos domínios de produção NÃO há padrão: um `npm run dev` sem a variável
 * não deve ficar batendo no servidor de produção (o CORS recusaria e cada
 * abertura de documento pagaria uma falha antes de cair no caminho sem sala).
 */

export const PRODUCTION_COLLAB_URL = 'https://collab.jurius-api.com';

/** Domínios que recebem o padrão de produção quando a variável de build falta. */
export const PRODUCTION_HOSTNAMES = new Set(['jurius.com.br', 'www.jurius.com.br']);

/**
 * Resolve a URL do serviço de coedição.
 * A variável de build vence sempre que estiver preenchida; sem ela, só os
 * domínios de produção ganham o padrão embutido.
 */
export function resolveCollabServiceUrl(
  envValue: string | null | undefined,
  hostname: string | null | undefined,
): string {
  const configured = (envValue || '').trim();
  if (configured) return configured;
  if (hostname && PRODUCTION_HOSTNAMES.has(hostname)) return PRODUCTION_COLLAB_URL;
  return '';
}
