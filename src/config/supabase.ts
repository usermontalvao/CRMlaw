/**
 * Configuração do Supabase - jurius.com.br
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env');
}

/**
 * UM client por página — e "por página" não é o mesmo que "por módulo".
 *
 * O app do escritório, o Editor (`/editor`) e o WhatsApp em janela própria
 * (`/whatsapp`) são entradas diferentes, e o bundler pode avaliar este arquivo
 * uma vez em cada chunk. Cada avaliação criava um `GoTrueClient` novo — dois
 * clients com a MESMA `storageKey`, cada um com o seu timer de refresh,
 * disputando o mesmo token no localStorage. É daí que vem o aviso "Multiple
 * GoTrueClient instances detected", e ele não é cosmético: dois refresh
 * concorrentes podem invalidar o token um do outro e derrubar a sessão no meio
 * do expediente.
 *
 * Ancorar no `globalThis` resolve independentemente de QUANTAS vezes o módulo
 * seja avaliado: a segunda avaliação reaproveita o que a primeira criou.
 */
// O tipo sai da PRÓPRIA expressão, e não de `ReturnType<typeof createClient>`:
// aquele devolve a instanciação PADRÃO dos genéricos, e com ela `.from()` passa
// a devolver `never` e `.rpc()` a recusar argumento — o app inteiro deixaria de
// compilar por causa de uma anotação.
const criarClient = () => createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  }
});
type ClientDoEscritorio = ReturnType<typeof criarClient>;

type ComCache = typeof globalThis & {
  __juriusSupabase?: ClientDoEscritorio;
  __juriusSupabaseAuthWatcher?: boolean;
};
const raiz = globalThis as ComCache;

export const supabase: ClientDoEscritorio =
  raiz.__juriusSupabase ?? (raiz.__juriusSupabase = criarClient());

// Interceptor para detectar erros de autenticação. Os avisos são só rastro de
// desenvolvimento: em produção o console fica limpo — nada aqui é acionável
// para quem está usando o CRM, e ruído constante esconde o que importa.
// A assinatura também só pode acontecer uma vez: duas avaliações do módulo
// registrariam dois ouvintes no mesmo client.
if (!raiz.__juriusSupabaseAuthWatcher) {
  raiz.__juriusSupabaseAuthWatcher = true;
  supabase.auth.onAuthStateChange((event, session) => {
  if (!import.meta.env.DEV) return;
  // Se a sessão foi removida ou expirou, garantir limpeza
  if (event === 'SIGNED_OUT' && !session) {
    console.log('Sessão encerrada - redirecionando para login');
    // A limpeza será feita pelo AuthContext
  }

  if (event === 'TOKEN_REFRESHED' && session) {
    console.log('Token atualizado com sucesso');
  }
  });
}
