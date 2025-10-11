# 🚀 Sistema de Cache Customizado

## ✅ Instalado e Configurado!

O sistema de cache está pronto para uso. Ele oferece:

- **Cache automático** de 5 minutos em memória
- **Invalidação inteligente** quando dados são atualizados
- **Loading states** automáticos
- **Suporte a wildcards** para invalidar múltiplos caches
- **Performance otimizada** sem dependências externas

---

## 📖 Como Usar

### 1. **Buscar Dados com Cache**

```typescript
import { useCachedData } from '../hooks/useQueryCache';
import { clientService } from '../services/client.service';

function ClientsModule() {
  // Busca clientes com cache automático de 5 minutos
  const { data: clients, isLoading, error, refetch } = useCachedData(
    'clients', // Cache key
    () => clientService.listClients({})
  );

  if (isLoading) return <div>Carregando...</div>;
  if (error) return <div>Erro ao carregar</div>;

  return (
    <div>
      <button onClick={refetch}>Atualizar</button>
      {clients?.map(client => (
        <div key={client.id}>{client.full_name}</div>
      ))}
    </div>
  );
}
```

### 2. **Criar/Atualizar com Invalidação Automática**

```typescript
import { useCachedMutation } from '../hooks/useQueryCache';
import { clientService } from '../services/client.service';

function CreateClientForm() {
  const { mutate: createClient, isPending, error } = useCachedMutation(
    (data: CreateClientDTO) => clientService.createClient(data),
    {
      // Invalida o cache de clientes após criar
      invalidateKeys: ['clients'],
      onSuccess: () => {
        console.log('Cliente criado e cache atualizado!');
      },
    }
  );

  const handleSubmit = async (formData: CreateClientDTO) => {
    await createClient(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* ... */}
      <button disabled={isPending}>
        {isPending ? 'Salvando...' : 'Salvar'}
      </button>
      {error && <div>Erro: {error.message}</div>}
    </form>
  );
}
```

### 3. **Invalidar Cache Manualmente**

```typescript
import { useCache } from '../contexts/CacheContext';

function SomeComponent() {
  const { invalidateCache, clearAllCache } = useCache();

  const handleRefresh = () => {
    // Invalida múltiplos caches de uma vez
    invalidateCache(['clients', 'processes', 'deadlines']);
  };

  const handleRefreshAll = () => {
    // Invalida TODOS os caches usando wildcard
    invalidateCache(['*']);
    // OU
    clearAllCache();
  };

  return (
    <>
      <button onClick={handleRefresh}>Atualizar Alguns</button>
      <button onClick={handleRefreshAll}>Limpar Tudo</button>
    </>
  );
}
```

---

## 🔑 Cache Keys Recomendadas

Use strings simples como chaves de cache:

```typescript
'clients'           // Lista de clientes
'client-{id}'       // Cliente específico
'processes'         // Lista de processos
'process-{id}'      // Processo específico
'requirements'      // Lista de requerimentos
'requirement-{id}'  // Requerimento específico
'deadlines'         // Lista de prazos
'deadline-{id}'     // Prazo específico
'calendar-events'   // Eventos do calendário
'intimations'       // Intimações
'leads'             // Leads
'tasks'             // Tarefas
'notifications'     // Notificações
'profile'           // Perfil do usuário
'members'           // Membros da equipe
```

### Wildcards

```typescript
invalidateCache(['clients*']); // Invalida 'clients', 'clients-1', 'clients-2', etc
```

---

## 🎯 Benefícios

### Antes (sem cache):
```typescript
const [clients, setClients] = useState([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const fetchClients = async () => {
    setLoading(true);
    const data = await clientService.listClients({});
    setClients(data);
    setLoading(false);
  };
  fetchClients();
}, []); // ❌ Recarrega toda vez que o componente monta
```

### Depois (com cache):
```typescript
const { data: clients, isLoading } = useCachedData(
  'clients',
  () => clientService.listClients({})
); // ✅ Cache de 5 minutos, carrega instantaneamente
```

---

## 📊 Configuração do Cache

Configurado em `src/contexts/CacheContext.tsx`:

```typescript
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutos

// Cache em memória (Map)
// Verifica expiração automaticamente ao buscar
// Suporta wildcards para invalidação em massa
```

**Características**:
- ✅ Cache em memória (não persiste ao recarregar página)
- ✅ TTL de 5 minutos por padrão
- ✅ Limpeza automática de cache expirado
- ✅ Suporte a wildcards (`clients*`)
- ✅ Zero dependências externas

---

## 🚀 Próximos Passos

Para implementar em um módulo:

1. Substitua `useState` + `useEffect` por `useCachedData`
2. Substitua funções de create/update por `useCachedMutation`
3. Use strings simples como cache keys
4. O cache será gerenciado automaticamente!

**Arquivos criados:**
- `src/contexts/CacheContext.tsx` - Provider do cache
- `src/hooks/useQueryCache.ts` - Hooks customizados
- `src/constants/queryKeys.ts` - Constantes de keys (opcional)

✅ **Sistema pronto para uso!**
