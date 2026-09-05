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

/**
 * As variáveis de licença, na ordem em que são lidas.
 *
 * UMA POR USO, e a antiga valendo para os dois. O editor de petições e a
 * conversão Word -> PDF são coisas diferentes para quem administra o sistema —
 * podem ter contratos, validades e renovações diferentes — e uma variável só,
 * com as duas chaves grudadas, esconde qual delas venceu.
 *
 * A legada continua valendo: build que ainda tem só ela não perde licença.
 */
export const VARIAVEIS_DE_LICENCA = [
  'VITE_SYNCFUSION_LICENSE_KEY_EDITOR',
  'VITE_SYNCFUSION_LICENSE_KEY_CONVERSOR',
  'VITE_SYNCFUSION_LICENSE_KEY',
] as const;

/**
 * Uma chave do Syncfusion é base64 — e só isso.
 *
 * A checagem existe por um acidente real: o valor tinha sido colado com o nome
 * da variável junto (`SYNCFUSION_LICENSE_KEY=NxYt…`). O EJ2 não reclama de
 * chave que não decodifica, ele apenas a IGNORA e desenha o aviso de avaliação
 * por cima da página — que num PDF assinado é um documento estragado. Melhor
 * descartar aqui, com aviso dizendo qual variável está torta.
 */
export function pareceChaveDoSyncfusion(valor: string): boolean {
  // O `=` só existe como ENCHIMENTO, no fim e no máximo dois. É essa parte que
  // pega um prefixo colado (`NOME=chave…`): o `=` no meio não é base64.
  return /^[A-Za-z0-9+/]{40,}={0,2}$/.test(valor);
}

/**
 * Todas as chaves configuradas, sem repetição e sem lixo.
 *
 * Cada variável pode trazer mais de uma chave: o EJ2 aceita várias separadas
 * por `;` (ele faz `licKey.split(';')`). Espaço também é aceito na leitura
 * porque base64 não tem espaço — então espaço ali é sempre separador digitado à
 * mão, e tratá-lo como tal conserta o `.env` em vez de perder a segunda chave.
 */
export function chavesDoSyncfusion(): { chaves: string[]; descartadas: string[] } {
  return lerChaves(VARIAVEIS_DE_LICENCA.map((variavel) => ({
    variavel, valor: readEnv(variavel),
  })));
}

/**
 * A leitura em si, sem `import.meta.env` — é esta que os testes exercitam.
 */
export function lerChaves(
  entradas: ReadonlyArray<{ variavel: string; valor: string }>,
): { chaves: string[]; descartadas: string[] } {
  const chaves: string[] = [];
  const descartadas: string[] = [];

  for (const { variavel, valor } of entradas) {
    for (const pedaco of String(valor ?? '').split(/[;\s]+/)) {
      if (!pedaco) continue;
      if (!pareceChaveDoSyncfusion(pedaco)) {
        descartadas.push(variavel);
        continue;
      }
      // Sem repetir: a mesma chave nas duas variáveis (o caso de quem ainda não
      // separou os contratos) registraria duas vezes, sem ganho nenhum.
      if (!chaves.includes(pedaco)) chaves.push(pedaco);
    }
  }

  return { chaves, descartadas: [...new Set(descartadas)] };
}

/**
 * A licença como o EJ2 quer receber: as chaves numa string só, separadas por
 * `;` (string vazia quando não há nenhuma).
 *
 * POR QUE JUNTAS, e não uma chamada por chave: `registerLicense` TROCA o
 * validador inteiro (`licenseValidator = new LicenseValidator(key)`). Duas
 * chamadas não somam — a segunda apaga a primeira. Como o editor e a conversão
 * vivem na MESMA página do CRM, registrar separado deixaria um dos dois sem
 * licença, de forma silenciosa. Variáveis separadas, registro único.
 */
export function syncfusionLicenseKey(): string {
  return chavesDoSyncfusion().chaves.join(';');
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
  return chavesDoSyncfusion().chaves.length > 0;
}

/** Como dizer, em uma linha, o que falta configurar. */
export function motivoDaLicencaAusente(): string {
  const { descartadas } = chavesDoSyncfusion();
  if (descartadas.length > 0) {
    return `Chave do Syncfusion ilegível em ${descartadas.join(', ')} `
      + '(o valor não é base64 — sobrou o nome da variável colado nele?).';
  }
  return `Licença do Syncfusion não configurada (${VARIAVEIS_DE_LICENCA.join(' ou ')}).`;
}

let licenseRegistered = false;

/**
 * Registra a licença uma única vez por sessão.
 *
 * PORTA ÚNICA, de propósito: quem chamar `registerLicense` por fora registra só
 * a sua chave e apaga as outras (ver `syncfusionLicenseKey`). Editor, conversão
 * e bancadas passam todos por aqui.
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
