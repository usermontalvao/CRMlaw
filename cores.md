# Refatura de Cores — CRM Jurius

## Variáveis de Design

| Token | Valor | Uso |
|-------|-------|-----|
| `sidebar-bg` | `#f7f7f5` | Menu lateral |
| `topbar-bg` | `#ffffff` | Navbar topo |
| `app-bg` | `#f5f5f3` | Fundo da área de trabalho (body) |
| `card-bg` | `#ffffff` | Cards / painéis |
| `border` | `#e7e5df` | Bordas estruturais |

## Padrões de Classe

### Wrapper raiz do módulo (quando necessário)
```tsx
<div className="bg-[#f5f5f3] dark:bg-zinc-950 -mx-3 -my-4 sm:-mx-4 sm:-my-6 lg:-mx-6 xl:-mx-8 px-3 sm:px-4 lg:px-6 xl:px-8 py-5 sm:py-6 min-h-screen overflow-x-hidden">
```
> Apenas usar quando o módulo precisa ocupar toda a área (ex: Dashboard). Demais módulos herdam o `app-bg` do `body`.

### Cards / painéis principais
```tsx
className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]"
```
❌ Remover `bg-[#f4f6fb]`, `bg-slate-50`, `bg-gray-50`, `bg-blue-50` no card raiz.

### Bordas internas (estruturais)
- Usar `border-[#e7e5df]` em vez de `border-slate-200` / `border-gray-200`
- Usar `divide-[#e7e5df]` em vez de `divide-slate-200` / `divide-gray-200`
- ✅ Badges de status (vermelho, verde, âmbar) mantêm suas bordas coloridas

---

## Checklist por Módulo

| Módulo | Bordas (`border-[#e7e5df]`) | Card bg | Dark mode | Status |
|--------|---------------------------|---------|-----------|--------|
| **Dashboard** | ✅ | ✅ `bg-white` | ✅ `dark:bg-zinc-950` no wrapper | ✅ Concluído |
| **Feed** | ✅ | — | — | ✅ Bordas OK |
| **Clientes** (`ClientsModule`) | ✅ | ✅ `bg-white` | — | ✅ Bordas OK |
| **ClientDetails** | ✅ | — | — | ✅ Bordas OK |
| **ClientForm** | ✅ | — | — | ✅ Bordas OK |
| **ClientList** | ✅ | — | — | ✅ Bordas OK |
| **Processos** (`ProcessesModule`) | ✅ | ✅ `bg-white` | — | ✅ Bordas OK |
| **Financeiro** (`FinancialModule`) | ✅ | ✅ `bg-white` | — | ✅ Bordas OK |
| **Tarefas** (`TasksModule`) | ✅ | — | — | ✅ Bordas OK |
| **Prazos** (`DeadlinesModule`) | ✅ | — | — | ✅ Bordas OK |
| **Agenda** (`CalendarModule`) | ✅ | ✅ `bg-white` | — | ✅ Toolbar `#f5f5f3`, grid card branco |
| **Intimações** (`IntimationsModule`) | ✅ | ✅ `bg-white` | — | ✅ Bordas OK |
| **Requerimentos** (`RequirementsModule`) | ✅ | — | — | ✅ Bordas OK |
| **Leads** (`LeadsModule`) | ✅ | — | — | ✅ Bordas OK |
| **Documentos** (`DocumentsModule`) | ✅ | ✅ `bg-white` | — | ✅ Bordas OK |
| **Financeiro Modal** (`FinancialModal`) | ✅ | — | — | ✅ Bordas OK |
| **Configurações** (`SettingsModule`) | ✅ | — | — | ✅ Bordas OK |
| **Gestão Usuários** (`UserManagementModule`) | ✅ | — | — | ✅ Bordas OK |
| **Chat** (`ChatModule`) | ✅ | — | — | ✅ Bordas OK |
| **Cloud** (`CloudModule`) | ✅ | — | — | ✅ Bordas OK |
| **Assinaturas** (`SignatureModule`) | ✅ | — | — | ✅ Bordas OK |
| **Petições Padrão** (`StandardPetitionsModule`) | ✅ | — | — | ✅ Bordas OK |
| **Editor de Petições** (`PetitionEditorModule`) | ✅ | — | — | ✅ Bordas OK |
| **Notificações** (`NotificationsModuleNew`) | ✅ | — | — | ✅ Bordas OK |
| **UI Components** (Badge, Button, Card, Modal…) | ✅ | — | — | ✅ Bordas OK |
| **App.tsx** (sidebar, topbar) | ✅ | — | — | ✅ Bordas OK |
| **Portal** (client-facing) | ⏳ | — | — | Pendente (escopo separado) |

---

## O que NÃO mudar

- Badges de status (verde, vermelho, laranja) — ficam como estão
- Ícones coloridos dentro dos cards
- Borders de destaque (`border-l-4 border-amber-400`, etc.)
- Fundo do sidebar (`#f7f7f5`)
- `hover:bg-slate-50` em botões — efeito hover, mantém
- Ícones com `bg-slate-50` (pequenos containers de ícone) — mantém

---

## Pendências Estruturais

- [x] **App.tsx container principal**: `bg-[#f5f5f3] dark:bg-zinc-950` adicionado ao `div` raiz do conteúdo (linha 2041) — todos os módulos agora herdam o fundo correto sem precisar de wrapper próprio.
- [x] **index.css `@layer base`**: `bg-gray-50` trocado por `background-color: #f5f5f3` — body e Tailwind base agora usam a mesma cor.
- [x] **CloudModule painel lateral**: `bg-slate-50` → `bg-[#f5f5f3]` (linha 6184).
- [x] **SignatureModule wizard**: `bg-slate-50` → `bg-[#f5f5f3]` (linha 3500).
- [ ] **Portal**: Fora do escopo — interface client-facing tem design próprio.

---

## Histórico de Alterações

| Data | Alteração |
|------|-----------|
| 2026-06-11 | Dashboard: wrapper `dark:bg-zinc-950` adicionado (bug dark mode) |
| 2026-06-11 | Todos os módulos: `border-slate-200` → `border-[#e7e5df]` (bordas estruturais) |
| 2026-06-11 | Todos os módulos: `border-gray-200` → `border-[#e7e5df]` |
| 2026-06-11 | Todos os módulos: `divide-slate-200` / `divide-gray-200` → `divide-[#e7e5df]` |
| 2026-06-11 | Cards: `border border-[#e7e5df] shadow-sm` → `shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]` (~80 cards) |
| 2026-06-11 | App.tsx: container de conteúdo recebeu `bg-[#f5f5f3] dark:bg-zinc-950` — fundo igual ao dashboard em todos os módulos |
| 2026-06-11 | index.css: `@layer base body` corrigido de `bg-gray-50` → `#f5f5f3` |
| 2026-06-11 | CloudModule painel lateral: `bg-slate-50` → `bg-[#f5f5f3]` |
| 2026-06-11 | SignatureModule wizard: `bg-slate-50` → `bg-[#f5f5f3]` |
| 2026-06-11 | CalendarModule toolbar: `bg-white border rounded-t-xl` → `bg-[#f5f5f3] border-b rounded-xl mb-3` |
| 2026-06-11 | CalendarModule grid: `border border-t-0 rounded-b-xl shadow-sm` → card padrão `shadow ring-1 ring-black/[0.04]` |
| 2026-06-11 | CalendarModule pills nav: `bg-slate-100` → `bg-white ring-1 ring-black/[0.06]`, segmento ativo: `bg-[#f5f5f3]` |
| 2026-06-11 | CalendarModule hover nav buttons: `hover:bg-white` → `hover:bg-[#eeede9]` |
