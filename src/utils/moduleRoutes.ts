/**
 * Mapa EXPLÍCITO módulo ↔ caminho da URL (roteamento de primeiro nível).
 *
 * Fonte única de verdade compartilhada por:
 *  - `main.tsx`  → decide, no boot, se o caminho é de módulo (não normaliza para
 *                  "/") e guarda o destino pretendido quando falta sessão;
 *  - `NavigationContext` → sincroniza `currentModule` com o pathname.
 *
 * REGRAS DESTE NÍVEL:
 *  - Só o MÓDULO vai para a URL. Nada de `/clientes/123` nem de parâmetros de
 *    tela: `moduleParams` continua 100% em memória.
 *  - O mapa é escrito à mão, entrada por entrada. NÃO derive o caminho do nome
 *    do módulo: um dia um módulo é renomeado e o link de alguém quebra sozinho.
 *
 * ATENÇÃO AO ADICIONAR UM CAMINHO NOVO: o App decide as rotas públicas com
 * `pathname.includes(...)` ("/assinar/", "/documento/", "/p/", "/cloud/share/",
 * "/terms", "/docs", "/privacidade", "/verificar", "/termos-assinatura",
 * "/cron/djen", "/portal", "/editor"). Um caminho de módulo NÃO pode casar com
 * nenhum desses trechos, senão o módulo abre a página pública no lugar dele.
 *
 * Também são RESERVADOS os caminhos dos apps dedicados (PWAs com escopo
 * próprio): "/editor" e "/atendimento". Um módulo com esse caminho abriria o
 * app instalado no lugar do CRM.
 */

export const MODULE_PATHS = {
  dashboard: '/dashboard',
  feed: '/feed',
  leads: '/leads',
  clientes: '/clientes',
  documentos: '/documentos',
  cloud: '/cloud',
  nextcloud: '/nextcloud',
  processos: '/processos',
  requerimentos: '/requerimentos',
  prazos: '/prazos',
  intimacoes: '/intimacoes',
  financeiro: '/financeiro',
  agenda: '/agenda',
  assinaturas: '/assinaturas',
  tarefas: '/tarefas',
  notificacoes: '/notificacoes',
  chat: '/chat',
  whatsapp: '/whatsapp',
  email: '/email',
  usuarios: '/usuarios',
  monitor: '/monitor',
  login: '/login',
  cron: '/cron',
  configuracoes: '/configuracoes',
  peticoes: '/peticoes', // Editor de Petições — módulo isolado
  perfil: '/perfil',
} as const satisfies Record<string, `/${string}`>;

export type ModuleName = keyof typeof MODULE_PATHS;

/**
 * Módulos que NÃO escrevem na URL.
 *
 * `login` não é destino: o App não renderiza tela de login própria — quando não
 * há sessão ele faz `location.replace('/')` e quem atende é o PortalLogin. Se
 * `navigateTo('login')` trocasse a URL, o caminho que o usuário pediu (ex.:
 * `/prazos`) seria perdido justamente no instante em que precisamos dele.
 */
const MODULES_WITHOUT_URL: ReadonlySet<ModuleName> = new Set<ModuleName>(['login']);

/** Destino pretendido guardado entre o boot sem sessão e o boot pós-login. */
const PENDING_MODULE_KEY = 'crm_pending_module';

const PATH_TO_MODULE: ReadonlyMap<string, ModuleName> = new Map(
  (Object.entries(MODULE_PATHS) as [ModuleName, string][]).map(([module, path]) => [path, module]),
);

/** Remove barra final e query/hash residuais: "/agenda/" → "/agenda". */
function normalizePath(pathname: string): string {
  const clean = pathname.split('?')[0].split('#')[0];
  return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

/** Caminho do módulo, ou `null` para os que não vão à URL (ver acima). */
export function moduleToPath(module: ModuleName): string | null {
  return MODULES_WITHOUT_URL.has(module) ? null : MODULE_PATHS[module];
}

/** Módulo correspondente ao caminho, ou `null` se não for caminho de módulo. */
export function pathToModule(pathname: string): ModuleName | null {
  return PATH_TO_MODULE.get(normalizePath(pathname)) ?? null;
}

export function isModulePath(pathname: string): boolean {
  return pathToModule(pathname) !== null;
}

/**
 * Guarda o destino pretendido antes de o boot mandar o visitante ao login.
 * Fica em `sessionStorage` porque o login do staff termina em
 * `location.href = '/'` — recarga completa, então estado em memória se perde.
 */
/** Prazo de validade do destino pretendido: só vale para o login logo em seguida. */
const PENDING_MODULE_TTL_MS = 10 * 60 * 1000;

export function rememberPendingModule(pathname: string): void {
  const module = pathToModule(pathname);
  if (!module || MODULES_WITHOUT_URL.has(module)) return;
  try {
    sessionStorage.setItem(PENDING_MODULE_KEY, `${module}|${Date.now()}`);
  } catch {
    /* sessionStorage bloqueado (modo restrito): sem retorno automático, só isso */
  }
}

/**
 * Lê e consome o destino pretendido. Memorizado em módulo para ser idempotente:
 * é chamado de um inicializador de `useState`, que o StrictMode roda duas vezes
 * — sem o cache, a segunda chamada devolveria vazio e o destino se perderia.
 */
let pendingModuleCache: ModuleName | null | undefined;

export function takePendingModule(): ModuleName | null {
  if (pendingModuleCache !== undefined) return pendingModuleCache;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(PENDING_MODULE_KEY);
    sessionStorage.removeItem(PENDING_MODULE_KEY);
  } catch {
    /* ignore */
  }
  pendingModuleCache = parsePendingModule(stored);
  return pendingModuleCache;
}

/** Exportada só para teste: valida módulo conhecido + prazo. */
export function parsePendingModule(stored: string | null, now: number = Date.now()): ModuleName | null {
  if (!stored) return null;
  const [module, ts] = stored.split('|');
  if (!(module in MODULE_PATHS)) return null;
  const at = Number(ts);
  if (!Number.isFinite(at) || now - at > PENDING_MODULE_TTL_MS) return null;
  return module as ModuleName;
}

/**
 * A URL está "limpa" para o CRM assumir o destino pretendido?
 *
 * Uma rota pública/especial (`#/assinar/...`, `#/documento/...`, `#/cron/djen`)
 * também monta o App — e sem esta checagem o destino guardado seria consumido e
 * escreveria `/agenda` por cima do link de assinatura que o signatário abriu.
 */
export function isCleanCrmLocation(
  pathname: string = window.location.pathname,
  hash: string = window.location.hash,
): boolean {
  const path = normalizePath(pathname);
  const naRaiz = path === '/' || path === '';
  return naRaiz && !hash.startsWith('#/');
}
