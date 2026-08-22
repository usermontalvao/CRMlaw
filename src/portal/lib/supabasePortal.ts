/**
 * supabasePortal — Client Supabase DEDICADO ao Portal do Cliente.
 *
 * Por que um client separado do `src/config/supabase.ts`?
 *  - O app do escritório (staff) usa o client padrão com storageKey
 *    `sb-<ref>-auth-token`. O roteamento de entrada em `main.tsx` decide
 *    "staff vs portal" pela presença desse token.
 *  - Se o portal gravasse a sessão na MESMA chave, o app carregaria o CRM do
 *    escritório no lugar do portal. Por isso este client usa um storageKey
 *    próprio (`jurius-portal-auth`), isolando completamente as sessões.
 *
 * A sessão é emitida pelo GoTrue (via edge function `portal-login` + verifyOtp),
 * então tem assinatura válida e refresh token — o supabase-js cuida de renovar
 * e de propagar o token para o Realtime automaticamente.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env');
}

// Mesma trava do client do escritório (ver `src/config/supabase.ts`): o módulo
// pode ser avaliado mais de uma vez, e dois GoTrueClient na mesma `storageKey`
// disputam o refresh do token.
// O tipo sai da própria expressão (ver a mesma nota em `src/config/supabase.ts`).
const criarClientPortal = () => createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: 'jurius-portal-auth',
    autoRefreshToken: true,
    persistSession: true,
    // Nunca capturar tokens da URL — isso é responsabilidade do client do staff.
    detectSessionInUrl: false,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});
type ClientDoPortal = ReturnType<typeof criarClientPortal>;

type ComCache = typeof globalThis & { __juriusSupabasePortal?: ClientDoPortal };
const raiz = globalThis as ComCache;

export const supabasePortal: ClientDoPortal =
  raiz.__juriusSupabasePortal ?? (raiz.__juriusSupabasePortal = criarClientPortal());
