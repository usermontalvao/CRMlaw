# Melhorias de Responsividade - Processos, Requerimentos e Prazos

## ✅ Padrões a Aplicar

### Modais
```tsx
// Container do modal
className="fixed inset-0 ... p-2 sm:p-4"

// Card do modal
className="... max-w-full sm:max-w-3xl max-h-[95vh] sm:max-h-[90vh]"

// Header do modal
className="px-3 sm:px-6 py-2 sm:py-4"

// Form do modal
className="p-3 sm:p-6 space-y-3 sm:space-y-5"
```

### Grids
```tsx
// 2 colunas em desktop, 1 em mobile
className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4"

// Botões lado a lado em desktop, empilhados em mobile
className="flex flex-col sm:flex-row gap-2 sm:gap-3"
```

### Inputs e Labels
```tsx
// Labels
className="text-xs sm:text-sm font-medium"

// Inputs
className="px-2 sm:px-3 py-1.5 sm:py-2 text-sm"

// Botões
className="px-3 sm:px-4 py-1.5 sm:py-2.5 text-xs sm:text-sm"
```

### Cards e Containers
```tsx
// Cards principais
className="p-3 sm:p-4 lg:p-6"

// Espaçamentos
className="space-y-3 sm:space-y-4 lg:space-y-6"
className="gap-2 sm:gap-3 lg:gap-4"
```

### Textos
```tsx
// Títulos
className="text-base sm:text-lg lg:text-xl"

// Subtítulos
className="text-xs sm:text-sm"

// Corpo
className="text-xs sm:text-sm lg:text-base"
```

## 🎯 Áreas Críticas

### ProcessesModule
- ✅ Modal: Já tem p-2 sm:p-4
- ✅ Grid: grid-cols-1 md:grid-cols-2
- ⚠️ Botões: Precisa flex-col sm:flex-row
- ⚠️ Padding: Reduzir em mobile

### RequirementsModule
- ⚠️ Modal: Ajustar padding
- ⚠️ Grid: Verificar responsividade
- ⚠️ Autocomplete: Melhorar em mobile

### DeadlinesModule
- ⚠️ Modal: Ajustar padding
- ⚠️ Cards: Reduzir espaçamento
- ⚠️ Filtros: Empilhar em mobile

## 📱 Checklist Mobile

- [ ] Modais ocupam 100% da largura (max-w-full sm:max-w-3xl)
- [ ] Padding reduzido (p-2 sm:p-4)
- [ ] Botões empilhados (flex-col sm:flex-row)
- [ ] Textos menores (text-xs sm:text-sm)
- [ ] Touch targets mínimo 44px
- [ ] Scroll suave e funcional
- [ ] Inputs com tamanho adequado
- [ ] Labels legíveis

## 🚀 Implementação Rápida

### 1. Wrapper do Modal
```tsx
<div className="fixed inset-0 ... p-2 sm:p-4">
  <div className="... max-w-full sm:max-w-3xl">
```

### 2. Form
```tsx
<form className="p-3 sm:p-6 space-y-3 sm:space-y-5">
```

### 3. Botões de Ação
```tsx
<div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
  <button className="px-3 sm:px-4 py-1.5 sm:py-2">
```

### 4. Grid de Campos
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
```
