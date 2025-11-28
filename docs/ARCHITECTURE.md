# Arquitetura do CRM Jurídico

## Estrutura de Pastas

```
src/
├── components/
│   ├── layout/              # Componentes de layout
│   │   ├── AppLayout.tsx    # Layout principal da aplicação
│   │   ├── Sidebar.tsx      # Sidebar desktop
│   │   ├── MobileSidebar.tsx# Sidebar mobile
│   │   ├── Header.tsx       # Header com título e ações
│   │   └── index.ts         # Exports centralizados
│   │
│   ├── dashboard/           # Componentes do Dashboard
│   │   ├── StatCard.tsx     # Card de estatística
│   │   ├── AlertBanner.tsx  # Banner de alertas urgentes
│   │   ├── QuickActions.tsx # Botões de ações rápidas
│   │   ├── FinancialCard.tsx# Card financeiro
│   │   └── index.ts         # Exports centralizados
│   │
│   ├── ui/                  # Componentes UI reutilizáveis
│   │   ├── Card.tsx         # Card genérico
│   │   ├── Badge.tsx        # Badge/tag
│   │   ├── Button.tsx       # Botão reutilizável
│   │   ├── EmptyState.tsx   # Estado vazio
│   │   ├── LoadingSpinner.tsx# Spinner de loading
│   │   └── index.ts         # Exports centralizados
│   │
│   ├── shared/              # Componentes compartilhados
│   │   └── (futuros componentes)
│   │
│   └── [Módulos]            # Módulos principais
│       ├── Dashboard.tsx
│       ├── ClientsModule.tsx
│       ├── ProcessesModule.tsx
│       └── ...
│
├── contexts/                # Contextos React
│   ├── AuthContext.tsx      # Autenticação
│   ├── NavigationContext.tsx# Navegação
│   ├── CacheContext.tsx     # Cache de dados
│   └── ToastContext.tsx     # Notificações toast
│
├── hooks/                   # Hooks customizados
│   ├── useNotifications.ts
│   ├── usePresence.ts
│   └── useDjenSync.ts
│
├── services/                # Serviços de API
│   ├── client.service.ts
│   ├── process.service.ts
│   └── ...
│
├── types/                   # Tipos TypeScript
│   ├── client.types.ts
│   ├── process.types.ts
│   └── ...
│
└── utils/                   # Utilitários
    ├── formatters.ts        # Funções de formatação
    └── pushNotifications.ts # Notificações push
```

## Padrões de Código

### Imports

```tsx
// 1. React e bibliotecas externas
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

// 2. Componentes internos (por categoria)
import { Card, Button, Badge } from '../ui';
import { StatCard, AlertBanner } from '../dashboard';

// 3. Hooks e contextos
import { useAuth } from '../../contexts/AuthContext';

// 4. Serviços e utilitários
import { clientService } from '../../services/client.service';
import { formatCurrency } from '../../utils/formatters';

// 5. Tipos
import type { Client } from '../../types/client.types';
```

### Componentes

```tsx
// Componente funcional com TypeScript
interface MyComponentProps {
  title: string;
  onClick?: () => void;
}

export const MyComponent: React.FC<MyComponentProps> = ({ title, onClick }) => {
  return (
    <div onClick={onClick}>
      {title}
    </div>
  );
};

export default MyComponent;
```

### Exports

Cada pasta de componentes deve ter um `index.ts`:

```tsx
// components/ui/index.ts
export { Card } from './Card';
export { Badge } from './Badge';
export { Button } from './Button';
```

## Componentes Reutilizáveis

### UI Components

| Componente | Descrição | Props principais |
|------------|-----------|------------------|
| `Card` | Container com borda e sombra | `padding`, `hover`, `onClick` |
| `Badge` | Tag colorida | `variant`, `size`, `pulse` |
| `Button` | Botão estilizado | `variant`, `size`, `loading`, `icon` |
| `EmptyState` | Estado vazio | `icon`, `title`, `description`, `action` |
| `LoadingSpinner` | Indicador de loading | `size`, `message`, `fullScreen` |

### Dashboard Components

| Componente | Descrição | Props principais |
|------------|-----------|------------------|
| `DashboardHeader` | Header com saudação | `onNewClient` |
| `StatCard` | Card de estatística | `icon`, `value`, `label`, `color` |
| `AlertBanner` | Banner de alertas | `alerts`, `onNavigate` |
| `QuickActions` | Ações rápidas | `onNavigate` |
| `FinancialCard` | Resumo financeiro | `stats`, `onNavigate` |
| `AgendaWidget` | Widget de agenda | `events`, `onEventClick`, `onViewAll` |
| `IntimationsWidget` | Widget de intimações | `intimacoes`, `urgencyStats`, `clientMap` |
| `DeadlinesWidget` | Widget de prazos | `deadlines`, `clientMap`, `onDeadlineClick` |
| `TasksWidget` | Widget de tarefas | `tasks`, `onTaskClick`, `onViewAll` |
| `ProcessesWidget` | Widget de processos | `processes`, `clientMap`, `onProcessClick` |

### Layout Components

| Componente | Descrição | Props principais |
|------------|-----------|------------------|
| `AppLayout` | Layout principal | `activeModule`, `onNavigate`, `children` |
| `Sidebar` | Sidebar desktop | `activeModule`, `onNavigate` |
| `MobileSidebar` | Sidebar mobile | `isOpen`, `onClose` |
| `Header` | Cabeçalho | `activeModule`, `profile` |

## Utilitários

### formatters.ts

```tsx
import { formatCurrency, formatDate, getGreeting, isToday } from '../utils/formatters';

// Exemplos
formatCurrency(1500.50)  // "R$ 1.500,50"
formatDate(new Date())   // "28/11/2025"
getGreeting()            // "Bom dia" / "Boa tarde" / "Boa noite"
isToday(someDate)        // true / false
```

## Migração Gradual

Para migrar módulos existentes:

1. **Identificar componentes repetidos** no módulo
2. **Extrair para `ui/` ou `shared/`** se for reutilizável
3. **Usar imports centralizados** do `index.ts`
4. **Testar** após cada mudança

### Exemplo de migração

Antes:
```tsx
// ProcessesModule.tsx
<div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
  {/* conteúdo */}
</div>
```

Depois:
```tsx
// ProcessesModule.tsx
import { Card } from './ui';

<Card padding="md">
  {/* conteúdo */}
</Card>
```

## Próximos Passos

1. [ ] Migrar Dashboard.tsx para usar componentes do `dashboard/`
2. [ ] Migrar App.tsx para usar `AppLayout`
3. [ ] Extrair modais para `shared/`
4. [ ] Criar componentes de formulário em `ui/`
5. [ ] Documentar props de cada componente com JSDoc
