/**
 * Configuração de runtime do Syncfusion compartilhada.
 *
 * Existe para que quem NÃO é o editor de petições (hoje: a conversão Word ->
 * PDF) possa falar com o mesmo servidor de documentos e usar a mesma licença,
 * sem importar o componente inteiro do editor — que traz toolbar, co-edição e
 * corretor ortográfico junto.
 *
 * Fonte da verdade do endereço do servidor: `VITE_SYNC_FUSION`; sem ela, o
 * servidor dedicado do Jurius; e a Edge Function `syncfusion-proxy` como último
 * recurso (ela repassa para o endpoint público de demonstração, que responde
 * 403 de forma intermitente).
 */

export const DEFAULT_SYNCFUSION_SERVICE_URL = 'https://docs.jurius-api.com/api/documenteditor/';

/** Normaliza para terminar com exatamente uma barra (o EJ2 concatena "Import"). */
export function normalizeSyncfusionServiceUrl(value: unknown): string {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  return normalized ? `${normalized}/` : '';
}

/** `true` quando o serviço é uma Edge Function do Supabase (exige apikey). */
export function isSupabaseFunctionsServiceUrl(value: string): boolean {
  return /\/functions\/v1\/[^/]+\/?$/i.test(String(value || '').trim());
}

function readEnv(name: string): string {
  try {
    return String((import.meta as unknown as { env?: Record<string, unknown> }).env?.[name] || '').trim();
  } catch {
    return '';
  }
}

/** Endereço efetivo do servidor de documentos do Syncfusion. */
export function resolveSyncfusionServiceUrl(): string {
  const configured = normalizeSyncfusionServiceUrl(readEnv('VITE_SYNC_FUSION'));
  const supabaseProjectUrl = readEnv('VITE_SUPABASE_URL').replace(/\/+$/, '');
  const proxy = supabaseProjectUrl ? `${supabaseProjectUrl}/functions/v1/syncfusion-proxy/` : '';
  return configured || DEFAULT_SYNCFUSION_SERVICE_URL || proxy;
}

/** Cabeçalhos exigidos pelo serviço (só quando ele é uma Edge Function). */
export function buildSyncfusionServiceHeaders(
  serviceUrl: string,
  accessToken?: string | null,
): Record<string, string>[] {
  if (!isSupabaseFunctionsServiceUrl(serviceUrl)) return [];
  const headers: Record<string, string>[] = [];
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY');
  if (anonKey) headers.push({ apikey: anonKey });
  if (accessToken) headers.push({ Authorization: `Bearer ${accessToken}` });
  return headers;
}

/** Chave de licença configurada (string vazia quando não há). */
export function syncfusionLicenseKey(): string {
  return readEnv('VITE_SYNCFUSION_LICENSE_KEY');
}

/**
 * `true` quando há licença configurada.
 *
 * Importa muito para a conversão em PDF: instância do Syncfusion sem licença
 * desenha o aviso de avaliação por cima da página, e o aviso entraria no PDF.
 * Sem chave, quem converte deve usar outro caminho em vez de gerar um PDF
 * marcado.
 */
export function hasSyncfusionLicense(): boolean {
  return Boolean(syncfusionLicenseKey());
}

let licenseRegistered = false;

/**
 * Registra a licença uma única vez por sessão.
 *
 * Recebe a função `registerLicense` de quem já carregou `@syncfusion/ej2-base`
 * (normalmente via import dinâmico), para que este módulo não puxe o EJ2 para
 * dentro de bundles que só precisam das URLs.
 */
export function registerSyncfusionLicenseOnce(register: (key: string) => void): boolean {
  const key = syncfusionLicenseKey();
  if (!key) return false;
  if (!licenseRegistered) {
    register(key);
    licenseRegistered = true;
  }
  return true;
}
