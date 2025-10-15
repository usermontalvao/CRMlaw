/**
 * Configuração do Supabase - Advogado\Web
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uajwkqipbyxzvwjpitxl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';

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
