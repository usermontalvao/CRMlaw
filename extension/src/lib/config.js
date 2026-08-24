// Onde o cofre mora. Trocar de projeto Supabase exige mexer em DOIS lugares:
// aqui e em `host_permissions`/`connect-src` do manifest.json — a extensão só
// consegue falar com host declarado, e isso é proposital.
export const VAULT_BASE_URL =
  'https://uajwkqipbyxzvwjpitxl.supabase.co/functions/v1/totp-vault';

/** Renova o access antes de ele vencer, para o popup nunca abrir num 401. */
export const ACCESS_REFRESH_MARGIN_SECONDS = 60;

/**
 * De quanto em quanto o service worker acorda para conferir a sessão.
 *
 * Ele NÃO renova a cada despertar — só se o access estiver perto de vencer.
 * Girar token à toa era o que derrubava o login sozinho depois de algumas
 * horas: cada rotação é uma chance de a resposta se perder.
 */
export const KEEPALIVE_MINUTES = 20;

/** Nome do alarme que mantém a sessão viva enquanto o navegador está aberto. */
export const KEEPALIVE_ALARM = 'jurius-vault-keepalive';
