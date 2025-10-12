# 💰 Módulo Financeiro - Sistema Completo

## ✅ Criado

Sistema completo de gestão financeira para acordos trabalhistas com:

### **1. Gestão de Acordos**
- ✅ Vinculação com clientes
- ✅ Vinculação opcional com processos
- ✅ Valor total do acordo
- ✅ Percentual de honorários configurável
- ✅ Cálculo automático de valores
- ✅ Parcelamento flexível

### **2. Sistema de Parcelas**
- ✅ Geração automática de parcelas
- ✅ Controle de vencimento
- ✅ Registro de pagamentos
- ✅ Múltiplas formas de pagamento
- ✅ Detecção automática de vencidas

### **3. Cálculos Automáticos**
```typescript
Exemplo:
Valor Total: R$ 100.000,00
Honorários: 30%
─────────────────────────
Honorários: R$ 30.000,00
Valor Líquido Cliente: R$ 70.000,00

10 Parcelas de R$ 10.000,00 cada
```

### **4. Status e Controle**

**Status de Acordos:**
- 🟡 **Pendente:** Aguardando aprovação
- 🟢 **Ativo:** Em andamento
- ✅ **Concluído:** Totalmente pago
- ❌ **Cancelado:** Cancelado

**Status de Parcelas:**
- ⏳ **Pendente:** Aguardando vencimento
- ✅ **Pago:** Quitada
- 🔴 **Vencido:** Atrasada
- ❌ **Cancelado:** Cancelada

---

## 📊 Estrutura de Dados

### **Tabela: agreements**
```sql
- id (UUID)
- client_id (FK → clients)
- process_id (FK → processes, opcional)
- title (título do acordo)
- description (descrição)
- agreement_date (data do acordo)
- total_value (valor total)
- fee_percentage (% honorários)
- fee_value (valor honorários)
- net_value (valor líquido)
- installments_count (nº parcelas)
- installment_value (valor parcela)
- first_due_date (primeiro vencimento)
- status
- notes
- timestamps
```

### **Tabela: installments**
```sql
- id (UUID)
- agreement_id (FK → agreements)
- installment_number (número da parcela)
- due_date (vencimento)
- value (valor)
- status
- payment_date (data pagamento)
- payment_method (forma pagamento)
- paid_value (valor pago)
- notes
- timestamps
```

---

## 💡 Funcionalidades

### **Criar Acordo:**
1. Seleciona cliente
2. Define valor total
3. Define % de honorários
4. Sistema calcula automaticamente:
   - Valor dos honorários
   - Valor líquido para o cliente
   - Valor de cada parcela
5. Define número de parcelas
6. Define data do primeiro vencimento
7. Sistema gera todas as parcelas automaticamente

### **Registrar Pagamento:**
1. Seleciona parcela
2. Informa data do pagamento
3. Seleciona forma de pagamento
4. Informa valor pago
5. Adiciona observações (opcional)
6. Sistema atualiza status automaticamente
7. Se todas parcelas pagas → acordo fica "concluído"

### **Dashboard Financeiro:**
- 📊 Total de acordos ativos
- 💰 Valor total contratado
- 💸 Total de honorários
- ✅ Total recebido
- ⏳ Total pendente
- 🔴 Parcelas vencidas
- 📈 Gráficos e estatísticas

---

## 🎨 Interface (A ser criada)

### **Layout Sugerido:**
```
┌────────────────────────────────────┐
│ 💰 Gestão Financeira          🔄  │
│                                    │
│ [R$ 500K  ] [R$ 150K  ] [R$ 200K] │
│  Contratado  Honorários   Recebido │
│                                    │
│ [5 Ativos] [12 Vencidas] [80% OK]│
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 🔍 [Buscar...] [Cliente▾] [+Novo] │
├────────────────────────────────────┤
│ 👤 João Silva                      │
│ 💼 Acordo Trabalhista - Rescisão   │
│ 💰 R$ 100.000 | 30% = R$ 30.000   │
│ 📅 10 parcelas | 3 pagas | 7 pend.│
│ [Ver Detalhes] [Registrar Pag.]   │
├────────────────────────────────────┤
│ 👤 Maria Santos                    │
│ ...                                │
└────────────────────────────────────┘
```

---

## 📁 Arquivos Criados

```
src/types/financial.types.ts
  ├─ Agreement (tipo do acordo)
  ├─ Installment (tipo da parcela)
  ├─ CreateAgreementDTO
  ├─ PayInstallmentDTO
  └─ FinancialStats

src/services/financial.service.ts
  ├─ createAgreement()
  ├─ updateAgreement()
  ├─ deleteAgreement()
  ├─ listAgreements()
  ├─ payInstallment()
  ├─ listInstallments()
  ├─ getFinancialStats()
  └─ generateInstallments() [privado]

sql/create_financial_tables.sql
  ├─ CREATE TABLE agreements
  ├─ CREATE TABLE installments
  ├─ Índices de performance
  ├─ Triggers
  ├─ RLS Policies
  └─ Comentários
```

---

## 🚀 Próximos Passos

### **1. Executar SQL no Supabase:**
```bash
# Cole o conteúdo de sql/create_financial_tables.sql
# no SQL Editor do Supabase
```

### **2. Criar Interface (Componente React):**
- Dashboard com estatísticas
- Lista de acordos
- Formulário de criação
- Modal de pagamento
- Visualização de parcelas
- Relatórios

### **3. Integração:**
- Adicionar ao menu do sistema
- Vincular com módulo de clientes
- Vincular com módulo de processos
- Sistema de notificações para vencimentos

---

## 💡 Exemplos de Uso

### **Criar Acordo:**
```typescript
await financialService.createAgreement({
  client_id: 'uuid-do-cliente',
  process_id: 'uuid-do-processo', // opcional
  title: 'Acordo Trabalhista - Rescisão',
  agreement_date: '2025-10-11',
  total_value: 100000,
  fee_percentage: 30,
  installments_count: 10,
  first_due_date: '2025-11-15',
  description: 'Acordo de rescisão contratual',
});
// Sistema calcula tudo e cria 10 parcelas automaticamente
```

### **Registrar Pagamento:**
```typescript
await financialService.payInstallment('id-da-parcela', {
  payment_date: '2025-10-15',
  payment_method: 'pix',
  paid_value: 10000,
  notes: 'Pagamento recebido via PIX',
});
// Atualiza status e verifica se acordo foi concluído
```

### **Obter Estatísticas:**
```typescript
const stats = await financialService.getFinancialStats();
console.log(stats);
// {
//   total_agreements: 15,
//   active_agreements: 12,
//   total_contracted: 500000,
//   total_fees: 150000,
//   total_received: 200000,
//   total_pending: 300000,
//   overdue_installments: 5,
//   ...
// }
```

---

## ✅ Status

**Backend:**
- [x] Tipos TypeScript
- [x] Serviço completo
- [x] SQL das tabelas
- [x] Cálculos automáticos
- [x] Geração de parcelas
- [x] Controle de status
- [x] Estatísticas

**Frontend:**
- [ ] Componente principal
- [ ] Dashboard financeiro
- [ ] Formulários
- [ ] Modals
- [ ] Listagens
- [ ] Relatórios

**Integração:**
- [ ] Menu do sistema
- [ ] Vinculação clientes
- [ ] Vinculação processos
- [ ] Notificações

---

**Quer que eu crie a interface (componente React) agora?** 🚀
