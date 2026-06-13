# Modal Design System — CRM

> Referência visual para refatoração de todos os modais do frontend.
> Padrão derivado do modal **Novo Lançamento** (FinancialModule), aproximado do Bootstrap 3/Perfex CRM.

---

## 1. Padrão visual base

### Fonte
```
fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif'
```
Aplicar via `style` no elemento `<form>` ou no container principal do conteúdo do modal.
Não alterar globalmente — apenas dentro dos modais refatorados.

### Largura
| Tipo | Classe |
|------|--------|
| Formulário padrão | `max-w-3xl` (~768 px) |
| Formulário largo (muitos campos) | `max-w-[860px]` |
| Formulário estreito (< 5 campos) | `max-w-xl` |
| Task/Detalhes (duas colunas) | `max-w-4xl` |
| Fullscreen / editor | `max-w-none w-full` |

### Barra superior (accent)
```tsx
<div className="h-1.5 w-full shrink-0 bg-amber-500" />
```
Permanece em todos os modais. É a identidade visual do sistema.

---

## 2. Header

```tsx
// Modal.tsx — header já ajustado
<div className="shrink-0 border-b border-[#e7e5df] px-4 py-2 sm:px-5 sm:py-2.5">
  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
    {eyebrow}          {/* ex: "Prazos", "Financeiro" */}
  </p>
  <h2 className="text-[14px] font-semibold text-slate-900 sm:text-[15px]">
    {title}
  </h2>
</div>
```

**Regra:** eyebrow obrigatório — identifica o módulo sem precisar ler o título.

---

## 3. Body (ModalBody)

```tsx
<ModalBody className="px-5 py-4">
  <form className="flex flex-col gap-5 pb-1"
        style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
    ...
  </form>
</ModalBody>
```

### Seções internas
```tsx
<div>
  <div className="border-b border-slate-100 pb-1.5 mb-3">
    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      NOME DA SEÇÃO
    </span>
  </div>
  <div className="grid grid-cols-12 gap-x-3 gap-y-3">
    ...
  </div>
</div>
```

---

## 4. Tokens de formulário

### Labels
```tsx
// Campo obrigatório
<label className="block text-[13px] font-medium text-slate-700 mb-1">
  Título <span className="text-red-500">*</span>
</label>

// Campo opcional / secundário
<label className="block text-[13px] font-medium text-slate-500 mb-1">
  Observações <span className="font-normal">(opcional)</span>
</label>
```

### Input / Select / Date
```tsx
className="w-full rounded border border-slate-300 dark:border-zinc-600
           bg-white dark:bg-zinc-800 text-slate-900 dark:text-white
           h-[34px] px-3 text-[13px]
           focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400
           placeholder:text-slate-400 transition"
```

### Textarea
```tsx
className="w-full rounded border border-slate-300 dark:border-zinc-600
           bg-white dark:bg-zinc-800 text-slate-900 dark:text-white
           px-3 py-2 text-[13px] resize-none
           focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400
           placeholder:text-slate-400 transition"
```

### Select com chevron customizado
```tsx
<div className="relative">
  <select className="w-full rounded border border-slate-300 ... h-[34px] px-3 text-[13px] appearance-none pr-8">
    ...
  </select>
  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
</div>
```

### Toggle segmentado (Percentual / Valor fixo, À vista / Parcelado)
```tsx
<div className="flex p-0.5 bg-slate-100 rounded border border-slate-200 h-[34px] items-center">
  <button className={`flex-1 rounded px-2 py-0.5 text-[12px] font-medium transition ${
    ativo ? 'bg-white shadow-sm font-bold text-slate-900' : 'text-slate-500 hover:text-slate-800'
  }`}>
    Opção
  </button>
</div>
```

### ClientSearchSelect
Já ajustado. Input: `h-[34px] rounded border-slate-300 text-[13px]`.
Dropdown: `rounded shadow-md`, itens `py-1.5 text-[13px]`.

---

## 5. Footer

```tsx
// Modal.tsx — footer já ajustado
<div className="shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3">
  {footer}
</div>
```

### Botões padrão
```tsx
// Cancelar
<button className="px-3 py-1.5 text-[13px] font-medium text-slate-500
                   hover:text-slate-900 hover:bg-slate-200/50 rounded transition">
  Cancelar
</button>

// Ação principal (salvar / criar)
<button className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white
                   text-[13px] font-semibold rounded transition
                   disabled:opacity-50 flex items-center gap-2">
  <PlusCircle className="w-4 h-4" /> Salvar
</button>

// Ação destrutiva (excluir)
<button className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white
                   text-[13px] font-semibold rounded transition">
  Excluir
</button>
```

### Barra de resumo (quando houver cálculo ao vivo)
```tsx
<div className="bg-amber-50 border border-amber-200 rounded mb-2 px-3 py-1.5
                flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px]">
  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">
    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> Resumo
  </span>
  <span>Valor <strong>R$ 1.000,00</strong></span>
  <span className="text-slate-300">·</span>
  <span>Parcelas <strong>10×</strong></span>
</div>
```

---

## 6. Layout Task (Perfex) — Prazos e Compromissos

Usado em modais de **visualização e edição de prazo/compromisso**, inspirado no layout de task do Perfex CRM.

### Estrutura geral
```
┌─────────────────────────────────────────────────┐
│  barra amber 1.5px                               │
│  header: eyebrow + título + botão fechar         │
├──────────────────────────┬──────────────────────┤
│                          │                      │
│   Coluna principal       │   Painel lateral     │
│   (flex-1, scroll)       │   (w-64, sticky)     │
│                          │                      │
│   Título editável        │  ┌──────────────┐    │
│   Descrição              │  │ Informações  │    │
│   Checklist / subtarefas │  │ Status       │    │
│   Comentários/notas      │  │ Vencimento   │    │
│                          │  │ Prioridade   │    │
│                          │  │ Tipo         │    │
│                          │  │ Processo     │    │
│                          │  │ Responsável  │    │
│                          │  │ Notificação  │    │
│                          │  └──────────────┘    │
├──────────────────────────┴──────────────────────┤
│  footer: Cancelar | Salvar                       │
└─────────────────────────────────────────────────┘
```

### Implementação do container
```tsx
<ModalBody className="p-0">
  <div className="flex min-h-0 flex-1 overflow-hidden"
       style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>

    {/* Coluna principal */}
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 min-w-0">
      ...conteúdo principal...
    </div>

    {/* Painel lateral */}
    <div className="w-60 shrink-0 border-l border-slate-100 dark:border-zinc-800
                    overflow-y-auto bg-slate-50 dark:bg-zinc-900/50 px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
        Informações
      </p>
      ...campos do painel...
    </div>

  </div>
</ModalBody>
```

### Campo do painel lateral (linha de metadado)
```tsx
<div className="flex flex-col gap-0.5 mb-3">
  <span className="text-[11px] text-slate-400 font-medium">Status</span>
  <span className="text-[13px] text-slate-800 font-medium">Pendente</span>
</div>
```

### Campo do painel lateral (select inline)
```tsx
<div className="flex flex-col gap-0.5 mb-3">
  <span className="text-[11px] text-slate-400 font-medium">Prioridade</span>
  <select className="w-full rounded border border-slate-200 bg-white h-[30px]
                     px-2 text-[12px] text-slate-800
                     focus:outline-none focus:ring-1 focus:ring-orange-400/40">
    <option>Urgente</option>
    <option>Alta</option>
    <option>Média</option>
    <option>Baixa</option>
  </select>
</div>
```

### Badge de status
```tsx
// Pendente
<span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-yellow-100 text-yellow-800">
  Pendente
</span>
// Cumprido
<span className="... bg-green-100 text-green-800">Cumprido</span>
// Vencido
<span className="... bg-red-100 text-red-800">Vencido</span>
// Cancelado
<span className="... bg-slate-100 text-slate-600">Cancelado</span>
```

### Responsável (avatar pill)
```tsx
<div className="flex flex-col gap-1 mb-3">
  <span className="text-[11px] text-slate-400 font-medium">Responsável</span>
  <div className="flex items-center gap-2">
    <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center
                    text-[10px] font-bold text-amber-700 shrink-0">
      {iniciais}
    </div>
    <span className="text-[13px] text-slate-800 truncate">{nome}</span>
  </div>
</div>
```

### Modais que DEVEM usar layout Task
| Arquivo | Modal |
|---------|-------|
| `DeadlinesModule.tsx` | Detalhes do prazo |
| `DeadlineFormModal.tsx` | Novo Prazo / Editar Prazo |
| `CalendarModule.tsx` | Detalhes de compromisso / Novo Compromisso / Editar Compromisso |
| `IntimationsModule.tsx` | Criar Prazo / Adicionar Compromisso |

---

## 7. Inventário completo — status de refatoração

### Legenda
- ✅ Feito — visual já adequado
- 🔄 Pendente — precisa refatorar
- ⚡ Task layout — usar layout de duas colunas (seção 6)

---

### Base reutilizável
| Arquivo | Modal | Status |
|---------|-------|--------|
| `ui/Modal.tsx` | base Modal, ModalBody, ModalFooter | ✅ |
| `ClientModal.tsx` | shell de cliente | 🔄 |
| `LeadModal.tsx` | Novo Lead | 🔄 |
| `FinancialModal.tsx` | Detalhes do Acordo | 🔄 |
| `GlobalSearchModal.tsx` | Busca Global | 🔄 |
| `PostModal.tsx` | Post de {autor} | 🔄 |
| `ProfileModal.tsx` | modal de perfil | 🔄 |
| `SecurityPinModal.tsx` | PIN (4 variantes) | 🔄 |
| `DeadlineFormModal.tsx` | Novo Prazo / Editar Prazo | ⚡ |
| `CustomFieldsManager.tsx` | Campos Personalizados / Novo Campo / Editar Campo | 🔄 |
| `TemplateFilesManager.tsx` | Gerenciar Documentos | 🔄 |
| `SignaturePositionDesigner.tsx` | designer fullscreen | 🔄 |

### CRM interno
| Arquivo | Modal | Status |
|---------|-------|--------|
| `App.tsx` | Solicitar acesso, overlay auth/bloqueio | 🔄 |
| `BlockedAccountOverlay.tsx` | conta bloqueada | 🔄 |
| `AccessRequestsAdmin.tsx` | Aprovar/Negar acesso | 🔄 |
| `Dashboard.tsx` | quick view cliente, detalhes evento, detalhes intimação | 🔄 |
| `ClientsModule.tsx` | Mesclar Contatos Manualmente | 🔄 |
| `ClientDetails.tsx` | preview selfie, Fotos coletadas | 🔄 |
| `ClientSearchSelect.tsx` | Novo Cliente | ✅ |
| `LeadsModule.tsx` | detalhes/edição de lead | 🔄 |
| `ProcessesModule.tsx` | Novo Processo, Editar Processo, detalhes, Exportar, Mapa de Fases, timeline | 🔄 |
| `DeadlinesModule.tsx` | Relatório de Prazos, **detalhes do prazo** | ⚡ |
| `IntimationsModule.tsx` | Vincular Intimação, Execução Sobrestada, **Criar Prazo**, **Adicionar Compromisso** | ⚡ |
| `CalendarModule.tsx` | **detalhes compromisso**, **Novo Compromisso**, **Editar Compromisso**, Novo Cliente, Exportar, Log Exclusões, Correspondentes | ⚡ |
| `RepresentativesPanel.tsx` | Novo/Editar/Vincular Correspondente, Editar Vínculo, Confirmar Pagamento | 🔄 |
| `RequirementsModule.tsx` | Novo/Editar Requerimento, Novo Cliente, prazo exigência, perícia, detalhes, Template MS, comunicação WhatsApp | 🔄 |
| `FinancialModule.tsx` | **Novo Lançamento** ✅, Editar Acordo, detalhes do acordo, Baixa Avulsa, Registrar Pagamento, Editar Baixa, Relatório IR, Imposto de Renda, Histórico de Baixas | 🔄 |
| `DocumentsModule.tsx` | Adicionar/Visualizar/Editar Template, Preparando…, Documento Gerado!, Link Preenchimento, Config link público, Link Assinatura | 🔄 |
| `DocumentRequestsAdmin.tsx` | Nova solicitação | 🔄 |
| `DocumentRequestsTracker.tsx` | Selecionar cliente, Para quem?, Nova/Editar solicitação, drawer tracker | 🔄 |
| `SignatureModule.tsx` | Remover pasta, Nova pasta, Mover item, Remover documento, Documentos excluídos, detalhes assinatura, Assinar documento, Visualização | 🔄 |
| `CloudModule.tsx` | Nova pasta, Mover arquivo, Compartilhar pasta, preview arquivo, alertas/pendências, Renomear, lote, Central Transferência, overlay exclusão, Converter PDF, Ferramentas PDF | 🔄 |
| `ChatModule.tsx` | viewer imagem, Nova Conversa, drawer Informações | 🔄 |
| `ChatFloatingWidget.tsx` | viewer imagem | 🔄 |
| `Feed.tsx` | galeria imagem, Curtidas, Comentários, Quem votou | 🔄 |
| `UserProfilePage.tsx` | curtidas/comentários, galeria, Escolher Capa | 🔄 |
| `PetitionEditorModule.tsx` | Visualizar Bloco, Buscar CNPJ, Adicionar Bloco, Editar com IA, Configurar categorias, Nova Área, Editar Área, padrão/tipo petição, editor fullscreen | 🔄 |
| `PetitionEditorWidget.tsx` | overlay fullscreen editor | 🔄 |
| `SettingsModule.tsx` | overlay Configurações, Nova/Editar Regra, Novo/Editar/Remover usuário | 🔄 |
| `UserManagementModule.tsx` | Criar Novo Usuário | 🔄 |

### Portal / Público
| Arquivo | Modal | Status |
|---------|-------|--------|
| `PublicCloudSharePage.tsx` | preview público de arquivo | 🔄 |
| `PublicSigningPage.tsx` | loading overlay, Confirme identidade, Verifique telefone/e-mail, Verificação facial, Histórico assinatura | 🔄 |
| `portal/PortalLayout.tsx` | Baixe nosso aplicativo | 🔄 |
| `portal/pages/PortalScanner.tsx` | overlay envio/sucesso, câmera fullscreen, editor corte | 🔄 |

---

## 8. Checklist de refatoração por modal

Para cada modal 🔄, aplicar na ordem:

1. **Trocar** `size="xl"` / `size="lg"` → tamanho adequado da tabela §1
2. **ModalBody**: `px-5 py-4` (formulários) ou `p-0` (layout Task)
3. **Form**: `gap-5`, `fontFamily` inline
4. **Seções**: `pb-1.5 mb-3`, header `text-[11px] font-semibold uppercase tracking-wide`
5. **Inputs/selects**: `h-[34px] rounded border-slate-300 text-[13px]`
6. **Labels**: `text-[13px] font-medium mb-1`
7. **Botões footer**: `py-1.5 text-[13px]`, sem `shadow-*`, `rounded` (não `rounded-lg`)
8. **Não alterar** lógica, handlers, validações, cálculos ou estados

---

## 9. Regras gerais

- **Nunca usar** `h-10`, `h-11`, `h-12` em inputs de formulário → usar `h-[34px]`
- **Nunca usar** `rounded-lg` ou `rounded-xl` em inputs/selects → usar `rounded`
- **Nunca usar** `shadow-*` em botões de ação → remover
- **Nunca usar** `text-sm` em labels ou inputs do formulário → usar `text-[13px]`
- **Nunca usar** `gap-6`, `gap-8` entre seções do form → usar `gap-5`
- **Nunca usar** `py-2.5` ou `py-3` em botões do footer → usar `py-1.5`
- O botão principal **sempre** laranja (`bg-orange-500`) — nunca azul, verde ou cinza
- Modais de **confirmação/destrutivos** (excluir, remover): botão vermelho `bg-red-500`
- Modais de **leitura** (detalhes, preview): sem footer ou footer com apenas "Fechar"

---

## 10. Cronograma de implantação

> **Como usar:** marque `[x]` quando o modal estiver concluído.
> Cada fase pode ser feita em uma sessão separada — retome sempre pela próxima linha `[ ]`.
> Referência visual absoluta: **Novo Lançamento** em `FinancialModule.tsx` ✅

---

### ✅ Fase 0 — Fundação (concluída)
Base reutilizável e modal de referência.

- [x] `ui/Modal.tsx` — header `py-2.5`, title `text-[14px]`, footer `px-5 py-3`
- [x] `FinancialModule.tsx` — **Novo Lançamento** (padrão de referência)
- [x] `ClientSearchSelect.tsx` — input `h-[34px] rounded`, dropdown compacto

---

### 🔵 Fase 1 — Modais simples e de alta frequência
Formulários pequenos, sem lógica complexa. Estimativa: 1 sessão.

- [ ] `SecurityPinModal.tsx` — Confirme PIN / Criar PIN / Alterar PIN / Remover PIN
- [ ] `LeadModal.tsx` — Novo Lead
- [ ] `LeadsModule.tsx` — detalhes/edição de lead
- [ ] `ProfileModal.tsx` — modal de perfil
- [ ] `GlobalSearchModal.tsx` — Busca Global
- [ ] `PostModal.tsx` — Post de {autor}
- [ ] `ClientModal.tsx` — shell de cliente
- [ ] `UserManagementModule.tsx` — Criar Novo Usuário

---

### 🟡 Fase 2 — Formulários de cadastro principais
Formulários médios a grandes, grid 12 colunas, múltiplas seções. Estimativa: 1–2 sessões.

- [ ] `ProcessesModule.tsx` — Novo Processo
- [ ] `ProcessesModule.tsx` — Editar Processo
- [ ] `ProcessesModule.tsx` — Exportar Processos / Mapa de Fases
- [ ] `RequirementsModule.tsx` — Novo Requerimento
- [ ] `RequirementsModule.tsx` — Editar Requerimento
- [ ] `RequirementsModule.tsx` — modal comunicação WhatsApp / perícia / prazo exigência
- [ ] `CustomFieldsManager.tsx` — Campos Personalizados / Novo Campo / Editar Campo
- [ ] `RepresentativesPanel.tsx` — Novo/Editar/Vincular Correspondente / Confirmar Pagamento
- [ ] `SettingsModule.tsx` — Nova/Editar Regra / Novo/Editar/Remover usuário

---

### 🟠 Fase 3 — Modais Task layout (Prazos e Compromissos) ⚡
Layout de duas colunas (seção 6 deste doc). São os mais trabalhosos — cada um tem painel lateral.

- [ ] `DeadlineFormModal.tsx` — Novo Prazo (layout Task)
- [ ] `DeadlineFormModal.tsx` — Editar Prazo (layout Task)
- [ ] `DeadlinesModule.tsx` — Detalhes do prazo (layout Task, modo leitura)
- [ ] `DeadlinesModule.tsx` — Relatório de Prazos
- [ ] `CalendarModule.tsx` — Novo Compromisso (layout Task)
- [ ] `CalendarModule.tsx` — Editar Compromisso (layout Task)
- [ ] `CalendarModule.tsx` — Detalhes de compromisso (layout Task, modo leitura)
- [ ] `CalendarModule.tsx` — Exportar Agenda / Log de Exclusões / Correspondentes
- [ ] `IntimationsModule.tsx` — Vincular Intimação / Execução Sobrestada
- [ ] `IntimationsModule.tsx` — Criar Prazo (layout Task)
- [ ] `IntimationsModule.tsx` — Adicionar Compromisso (layout Task)

---

### 🟣 Fase 4 — Financeiro restante
Os outros modais de `FinancialModule.tsx` além do Novo Lançamento.

- [ ] `FinancialModule.tsx` — Editar Acordo
- [ ] `FinancialModule.tsx` — Detalhes do Acordo (`FinancialModal.tsx`)
- [ ] `FinancialModule.tsx` — Baixa Avulsa
- [ ] `FinancialModule.tsx` — Registrar Pagamento
- [ ] `FinancialModule.tsx` — Editar Baixa
- [ ] `FinancialModule.tsx` — Histórico de Baixas
- [ ] `FinancialModule.tsx` — Relatório Mensal para IR / Imposto de Renda

---

### 🔴 Fase 5 — Documentos e Assinaturas
Modais com lógica de geração de arquivo. Estimativa: 1–2 sessões.

- [ ] `DocumentsModule.tsx` — Adicionar Template
- [ ] `DocumentsModule.tsx` — Visualizar / Editar Template
- [ ] `DocumentsModule.tsx` — Documento Gerado! / Link de Preenchimento / Config link público
- [ ] `DocumentsModule.tsx` — Link de Assinatura / Preparando documentos…
- [ ] `DocumentRequestsAdmin.tsx` — Nova solicitação
- [ ] `DocumentRequestsTracker.tsx` — Selecionar cliente / Nova/Editar solicitação / drawer
- [ ] `SignatureModule.tsx` — Nova pasta / Remover pasta / Mover item / Remover documento
- [ ] `SignatureModule.tsx` — Documentos excluídos / Detalhes / Assinar / Visualização
- [ ] `TemplateFilesManager.tsx` — Gerenciar Documentos
- [ ] `SignaturePositionDesigner.tsx` — designer fullscreen

---

### ⚫ Fase 6 — Cloud, Chat e Feed
Modais de mídia e comunicação. Estimativa: 1–2 sessões.

- [ ] `CloudModule.tsx` — Nova pasta / Mover arquivo / Compartilhar pasta
- [ ] `CloudModule.tsx` — Renomear / Renomear em lote / Mover em lote
- [ ] `CloudModule.tsx` — Marcar alerta/pendência / Central de Transferência
- [ ] `CloudModule.tsx` — preview de arquivo / overlay de exclusão
- [ ] `CloudModule.tsx` — Converter imagens em PDF / Ferramentas de PDF fullscreen
- [ ] `ChatModule.tsx` — Nova Conversa / drawer Informações / viewer imagem
- [ ] `ChatFloatingWidget.tsx` — viewer imagem
- [ ] `Feed.tsx` — galeria imagem / Curtidas / Comentários / Quem votou
- [ ] `UserProfilePage.tsx` — curtidas/comentários / galeria / Escolher Capa

---

### ⬜ Fase 7 — Editor de Petições e overlays de sistema
Os mais complexos e menos urgentes. Estimativa: 1–2 sessões.

- [ ] `PetitionEditorModule.tsx` — Visualizar Bloco / Buscar CNPJ / Adicionar Bloco
- [ ] `PetitionEditorModule.tsx` — Editar com IA / Configurar categorias / Nova/Editar Área
- [ ] `PetitionEditorModule.tsx` — editor fullscreen Novo Bloco / Editar Bloco
- [ ] `PetitionEditorWidget.tsx` — overlay fullscreen editor
- [ ] `App.tsx` — Solicitar acesso / overlay auth / overlay de bloqueio
- [ ] `BlockedAccountOverlay.tsx` — conta bloqueada
- [ ] `AccessRequestsAdmin.tsx` — Aprovar/Negar acesso
- [ ] `Dashboard.tsx` — quick view cliente / detalhes evento / detalhes intimação
- [ ] `ClientsModule.tsx` — Mesclar Contatos Manualmente
- [ ] `ClientDetails.tsx` — preview selfie / Fotos coletadas

---

### 🌐 Fase 8 — Portal e páginas públicas
Contexto diferente (cliente externo), ajustar com cuidado para não quebrar UX pública.

- [ ] `PublicCloudSharePage.tsx` — preview público de arquivo
- [ ] `PublicSigningPage.tsx` — loading overlay / Confirme identidade / Verifique telefone/e-mail
- [ ] `PublicSigningPage.tsx` — Verificação facial / Histórico da assinatura
- [ ] `portal/PortalLayout.tsx` — Baixe nosso aplicativo
- [ ] `portal/pages/PortalScanner.tsx` — overlay envio/sucesso / câmera / editor corte

---

### 📊 Progresso geral

| Fase | Total | Concluídos | Restam |
|------|-------|-----------|--------|
| 0 — Fundação | 3 | 3 | 0 |
| 1 — Simples/frequentes | 8 | 0 | 8 |
| 2 — Cadastro principais | 9 | 0 | 9 |
| 3 — Task layout (Prazos) | 11 | 0 | 11 |
| 4 — Financeiro restante | 7 | 0 | 7 |
| 5 — Documentos/Assinaturas | 10 | 0 | 10 |
| 6 — Cloud/Chat/Feed | 9 | 0 | 9 |
| 7 — Petições/Sistema | 10 | 0 | 10 |
| 8 — Portal/Público | 5 | 0 | 5 |
| **Total** | **72** | **3** | **69** |

> Atualize a tabela acima após cada sessão de trabalho.
