# Correção: Sistema Cai Após Inatividade (Not Found)

## Problema Identificado

Após período de inatividade, a sessão do Supabase expirava mas o sistema não detectava corretamente, causando erro "not found" quando o usuário tentava navegar.

## Alterações Implementadas

### 1. Configuração do Supabase (`src/config/supabase.ts`)

**Antes:**
```typescript
export const supabase = createClient(supabaseUrl, supabaseKey);
```

**Depois:**
```typescript
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,      // Atualiza token automaticamente
    persistSession: true,         // Mantém sessão no localStorage
    detectSessionInUrl: true,     // Detecta sessão na URL
    storage: window.localStorage, // Usa localStorage para persistência
  }
});

// Interceptor para logging de eventos de autenticação
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' && !session) {
    console.log('Sessão encerrada - redirecionando para login');
  }
  if (event === 'TOKEN_REFRESHED' && session) {
    console.log('Token atualizado com sucesso');
  }
});
```

### 2. Contexto de Autenticação (`src/contexts/AuthContext.tsx`)

**Melhorias:**
- Adicionado logging detalhado de eventos de autenticação
- Tratamento explícito de eventos `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`, `SIGNED_IN`
- Melhor controle do estado de loading

### 3. App.tsx - Detecção de Expiração de Sessão

**Novo useEffect adicionado:**
```typescript
// Detectar quando usuário perde autenticação e limpar estado
useEffect(() => {
  if (!user && !loading) {
    // Limpar cache ao fazer logout/expiração de sessão
    sessionStorage.removeItem(PROFILE_CACHE_KEY);
    sessionStorage.removeItem(NOTIFICATIONS_CACHE_KEY);
    
    // Reset estado completo
    setProfile({ ... });
    setNotifications([]);
    setPendingTasksCount(0);
    setModuleParams({});
    setClientPrefill(null);
    
    // Redirecionar para raiz se estiver em uma rota protegida
    if (location.pathname !== '/' && location.pathname !== '/login') {
      navigate('/', { replace: true });
    }
  }
}, [user, loading, location.pathname, navigate]);
```

### 4. Componente ProtectedRoute (Novo)

Criado componente `src/components/ProtectedRoute.tsx` para proteger rotas (disponível para uso futuro se necessário).

## Como Funciona Agora

1. **Auto-refresh de Token:** O Supabase tentará automaticamente renovar o token antes de expirar
2. **Detecção de Expiração:** Quando a sessão expira, o evento `SIGNED_OUT` é disparado
3. **Limpeza de Estado:** O App.tsx detecta que `user` é `null` e limpa todo o estado da aplicação
4. **Redirecionamento Automático:** O usuário é automaticamente redirecionado para a página de login
5. **Logging:** Eventos de autenticação são registrados no console para debug

## Como Testar

### Teste 1: Simulação de Inatividade
1. Faça login no sistema
2. Navegue para qualquer módulo (ex: Processos)
3. Abra o DevTools (F12) → Application → Local Storage
4. Delete as chaves que começam com `supabase.auth.token`
5. Tente navegar para outro módulo
6. **Resultado esperado:** Sistema redireciona automaticamente para login

### Teste 2: Expiração Natural
1. Faça login no sistema
2. Deixe o navegador aberto sem interação por 1+ hora
3. Tente navegar ou realizar alguma ação
4. **Resultado esperado:** Sistema detecta sessão expirada e redireciona para login

### Teste 3: Console Logs
1. Faça login no sistema
2. Abra o DevTools → Console
3. Observe os logs:
   - "Auth state change: SIGNED_IN" ao fazer login
   - "Token atualizado com sucesso" durante renovações automáticas
   - "Auth state change: SIGNED_OUT" ao expirar sessão
   - "Sessão encerrada - redirecionando para login"

## Benefícios

✅ **Sem mais "Not Found"**: Redirecionamento limpo para login  
✅ **Auto-refresh**: Token renovado automaticamente durante uso  
✅ **Estado Limpo**: Cache e estado resetados ao perder sessão  
✅ **Melhor UX**: Transição suave sem erros confusos  
✅ **Debug Facilitado**: Logs claros de eventos de autenticação  

## Sessão Supabase - Configuração Padrão

- **Tempo de expiração:** 3600 segundos (1 hora)
- **Auto-refresh:** Ocorre automaticamente ~5 minutos antes da expiração
- **Persistência:** localStorage mantém sessão entre recargas de página

## Próximos Passos (Opcional)

Se ainda houver problemas:
1. Adicionar toast/notificação quando sessão expirar
2. Implementar ProtectedRoute em todas as rotas
3. Adicionar contador regressivo de sessão na UI
4. Implementar "keep-alive" com ping periódico ao backend
