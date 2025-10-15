# Correção: Navegação da Agenda para Processos

## Problema Identificado

Ao clicar em uma audiência na agenda para ir ao módulo de processos, o sistema redirecionava para o dashboard em vez de abrir o processo específico.

## Causas Raiz

### 1. Parâmetros Incorretos
O `CalendarModule` estava passando os parâmetros de navegação com a estrutura:
```typescript
{ mode: 'edit', entityId: 'xxx' }
```

Mas o `ProcessesModule` esperava receber apenas:
```typescript
{ entityId: 'xxx' }
```

### 2. Mapeamento de Rotas Incorreto (PRINCIPAL)
O `CalendarModule` usa nomes internos de módulos:
- `'cases'` para processos
- `'deadlines'` para prazos
- `'requirements'` para requerimentos

Mas as rotas reais no App.tsx são:
- `/processos`
- `/prazos`
- `/requerimentos`

Quando navegava para `/${module}` com `module='cases'`, ia para `/cases` que não existe, então redirecionava para `/dashboard` pela rota catch-all `*`.

## Solução Implementada

### Arquivo: `src/App.tsx`

**Antes:**
```typescript
<CalendarModule 
  onNavigateToModule={({ module, entityId }) => {
    if (entityId) {
      setModuleParams(prev => ({
        ...prev,
        [module]: JSON.stringify({ mode: 'edit', entityId }),  // ❌ Problema aqui
      }));
    }
    navigate(`/${module}`);
  }}
/>
```

**Depois:**
```typescript
<CalendarModule 
  onNavigateToModule={({ module, entityId }) => {
    // Mapear nomes de módulos internos para rotas
    const moduleRouteMap: Record<string, string> = {
      'cases': 'processos',           // ✅ Mapeamento adicionado
      'deadlines': 'prazos',          // ✅ Mapeamento adicionado
      'requirements': 'requerimentos', // ✅ Mapeamento adicionado
    };
    
    const targetRoute = moduleRouteMap[module] || module;
    
    if (entityId) {
      setModuleParams(prev => ({
        ...prev,
        [module]: JSON.stringify({ entityId }),  // ✅ Sem 'mode'
      }));
    }
    navigate(`/${targetRoute}`);  // ✅ Usa rota mapeada
  }}
/>
```

## Como Funciona Agora

1. **Usuário clica em audiência na agenda**
2. `CalendarModule` identifica que é uma audiência vinculada a um processo
3. Chama `onNavigateToModule` com:
   - `module: 'cases'`
   - `entityId: 'id-do-processo'`
4. `App.tsx` mapeia `'cases'` → `'processos'` usando `moduleRouteMap`
5. Armazena em `moduleParams['cases']` apenas `{ entityId: 'xxx' }`
6. Navega para `/processos` (rota correta)
7. `ProcessesModule` recebe `entityId` via props e abre o processo específico
8. Usuário vê os detalhes do processo com a audiência agendada

## Módulos Afetados

Esta correção afeta a navegação da agenda para:
- ✅ **Processos** (audiências)
- ✅ **Requerimentos** (exigências)
- ✅ **Prazos** (deadlines)

Todos agora navegam corretamente para o item específico.

## Teste

### Como Testar:
1. Acesse o módulo **Processos**
2. Crie ou edite um processo
3. Marque uma audiência (data, hora, modo)
4. Salve o processo
5. Vá para **Agenda**
6. Clique na audiência criada
7. **Resultado esperado:** Abre o módulo de processos com o processo específico em visualização/edição

### Antes da Correção:
- ❌ Tentava navegar para `/cases` (rota inexistente)
- ❌ Redirecionava para `/dashboard` pela rota catch-all
- ❌ Não abria o processo específico

### Depois da Correção:
- ✅ Mapeia `'cases'` → `/processos` corretamente
- ✅ Navega para a rota correta `/processos`
- ✅ Abre automaticamente o processo vinculado à audiência
- ✅ Usuário vê todos os detalhes do processo

## Benefícios

- 🎯 **Navegação contextual**: Clique direto no evento e vá para o item relacionado
- ⚡ **Produtividade**: Menos cliques para acessar informações
- 🔗 **Integração**: Agenda totalmente integrada com processos, prazos e requerimentos
- ✨ **UX melhorada**: Fluxo de trabalho mais intuitivo

## Código Validado

✅ TypeScript compilado sem erros
✅ Navegação testada
✅ Parâmetros corretos passados entre módulos
