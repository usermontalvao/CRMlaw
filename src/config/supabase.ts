/**
 * Configuração do Supabase - Advogado\Web
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Variáveis de ambiente do Supabase não configuradas. Verifique o arquivo .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  }
});

// Interceptor para detectar erros de autenticação
supabase.auth.onAuthStateChange((event, session) => {
  // Se a sessão foi removida ou expirou, garantir limpeza
  if (event === 'SIGNED_OUT' && !session) {
    console.log('Sessão encerrada - redirecionando para login');
    // A limpeza será feita pelo AuthContext
  }
  
  if (event === 'TOKEN_REFRESHED' && session) {
    console.log('Token atualizado com sucesso');
  }
});
