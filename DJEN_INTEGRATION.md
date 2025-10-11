# 📋 Integração DJEN - Diário de Justiça Eletrônico Nacional

## ✅ Implementado

### Busca Automática de Dados do Processo

Ao cadastrar um processo, você pode buscar automaticamente os dados no DJEN:

1. **Digite o número do processo** (20 dígitos)
2. **Clique em "Buscar DJEN"**
3. **Dados preenchidos automaticamente:**
   - ✅ Vara/Órgão julgador
   - ✅ Área do processo (mapeamento inteligente)
   - ✅ Exibição das partes envolvidas

---

## 🔍 Dados Disponíveis no DJEN

A API do DJEN retorna informações riquíssimas sobre processos:

### 1. **Dados do Processo**
```typescript
{
  numero_processo: "00012345620248260100",
  numeroprocessocommascara: "0001234-56.2024.8.26.0100",
  siglaTribunal: "TJSP",
  nomeOrgao: "1ª Vara Cível de São Paulo",
  nomeClasse: "Ação de Cobrança",
  codigoClasse: "280",
  tipoDocumento: "Sentença",
  tipoComunicacao: "Intimação"
}
```

### 2. **Partes Envolvidas**
```typescript
destinatarios: [
  {
    nome: "João da Silva",
    polo: "Autor",
    cpf_cnpj: "123.456.789-00"
  },
  {
    nome: "Empresa XYZ Ltda",
    polo: "Réu",
    cpf_cnpj: "12.345.678/0001-90"
  }
]
```

### 3. **Advogados**
```typescript
destinatarioadvogados: [
  {
    advogado: {
      nome: "Dr. José Advogado",
      numero_oab: "123456",
      uf_oab: "SP",
      email: "jose@exemplo.com"
    }
  }
]
```

### 4. **Comunicações**
```typescript
{
  data_disponibilizacao: "2024-01-15",
  texto: "Fica a parte intimada para...",
  link: "https://...",
  meio: "D", // D = Diário, E = Edital
  numeroComunicacao: 12345
}
```

---

## 🚀 Possibilidades de Exploração

### 1. **Auto-Vinculação de Clientes** 🎯
**Ideia:** Quando buscar no DJEN, identificar automaticamente o cliente pelo CPF/CNPJ das partes.

```typescript
// Buscar cliente pelo CPF da parte
const parteAutor = djenData.destinatarios.find(d => d.polo === 'Autor');
if (parteAutor?.cpf_cnpj) {
  const cliente = await clientService.findByCpf(parteAutor.cpf_cnpj);
  if (cliente) {
    setFormData(prev => ({ ...prev, client_id: cliente.id }));
  }
}
```

**Benefício:** Vincula automaticamente o processo ao cliente existente.

---

### 2. **Cadastro Automático de Partes** 👥
**Ideia:** Criar automaticamente registros das partes adversas.

```typescript
// Salvar partes do processo
const partes = djenData.destinatarios.map(d => ({
  process_id: processo.id,
  nome: d.nome,
  polo: d.polo,
  cpf_cnpj: d.cpf_cnpj,
}));

await processPartsService.createMany(partes);
```

**Benefício:** Histórico completo de quem está envolvido no processo.

---

### 3. **Monitoramento de Comunicações** 📬
**Ideia:** Buscar periodicamente novas comunicações do processo.

```typescript
// Buscar comunicações do processo
const comunicacoes = await djenService.consultarComunicacoes({
  numeroProcesso: processo.process_code,
  dataDisponibilizacaoInicio: processo.created_at,
});

// Notificar sobre novas intimações
if (comunicacoes.items.length > 0) {
  await notificationService.create({
    title: 'Nova intimação',
    description: `Processo ${processo.process_code} tem nova comunicação`,
  });
}
```

**Benefício:** Nunca perca um prazo ou intimação.

---

### 4. **Identificação Automática de Prazos** ⏰
**Ideia:** Extrair prazos do texto das intimações usando IA ou regex.

```typescript
// Analisar texto da intimação
const texto = comunicacao.texto;
const prazoMatch = texto.match(/prazo de (\d+) dias/i);

if (prazoMatch) {
  const dias = parseInt(prazoMatch[1]);
  const dataBase = new Date(comunicacao.data_disponibilizacao);
  const prazoFinal = addDays(dataBase, dias);
  
  // Criar prazo automaticamente
  await deadlineService.create({
    title: `Prazo - ${processo.process_code}`,
    due_date: prazoFinal,
    process_id: processo.id,
  });
}
```

**Benefício:** Prazos criados automaticamente das intimações.

---

### 5. **Dashboard de Movimentações** 📊
**Ideia:** Visualizar timeline de todas as comunicações do processo.

```typescript
// Buscar histórico completo
const historico = await djenService.consultarTodasComunicacoes({
  numeroProcesso: processo.process_code,
});

// Exibir timeline
historico.items.map(item => ({
  data: item.data_disponibilizacao,
  tipo: item.tipoComunicacao,
  conteudo: item.texto,
  link: item.link,
}));
```

**Benefício:** Visão completa da movimentação processual.

---

### 6. **Sincronização Automática** 🔄
**Ideia:** Buscar atualizações de todos os processos periodicamente.

```typescript
// Cron job diário
async function sincronizarProcessos() {
  const processos = await processService.listProcesses({ status: 'andamento' });
  
  for (const processo of processos) {
    const comunicacoes = await djenService.consultarComunicacoes({
      numeroProcesso: processo.process_code,
      dataDisponibilizacaoInicio: processo.last_sync_date,
    });
    
    // Salvar novas comunicações
    await saveComunicacoes(comunicacoes.items, processo.id);
  }
}
```

**Benefício:** Sistema sempre atualizado automaticamente.

---

### 7. **Análise de Advogados Adversos** 🔍
**Ideia:** Manter histórico de advogados que você enfrenta.

```typescript
// Identificar advogado da parte contrária
const advogadoReu = djenData.destinatarioadvogados
  .find(da => da.advogado.polo === 'Réu');

if (advogadoReu) {
  await adverseLayerService.createOrUpdate({
    nome: advogadoReu.advogado.nome,
    oab: advogadoReu.advogado.numero_oab,
    uf: advogadoReu.advogado.uf_oab,
    processos_contra: [processo.id],
  });
}
```

**Benefício:** Conhecer o histórico de quem você enfrenta.

---

### 8. **Alertas Inteligentes** 🔔
**Ideia:** Notificar sobre tipos específicos de comunicações.

```typescript
// Alertas personalizados
const alertas = {
  'Sentença': { prioridade: 'alta', notificar: 'imediato' },
  'Intimação': { prioridade: 'média', notificar: 'diário' },
  'Despacho': { prioridade: 'baixa', notificar: 'semanal' },
};

if (comunicacao.tipoDocumento in alertas) {
  const config = alertas[comunicacao.tipoDocumento];
  await sendAlert(config.prioridade, comunicacao);
}
```

**Benefício:** Priorização automática de comunicações importantes.

---

### 9. **Relatórios Automáticos** 📈
**Ideia:** Gerar relatórios de movimentação para o cliente.

```typescript
// Relatório mensal para o cliente
const relatorio = {
  cliente: processo.client_name,
  processo: processo.process_code,
  periodo: 'Janeiro/2024',
  movimentacoes: comunicacoes.map(c => ({
    data: c.data_disponibilizacao,
    tipo: c.tipoComunicacao,
    resumo: c.texto.substring(0, 200),
  })),
};

await emailService.sendReport(cliente.email, relatorio);
```

**Benefício:** Cliente sempre informado automaticamente.

---

### 10. **Integração com Calendário** 📅
**Ideia:** Criar eventos de audiência automaticamente.

```typescript
// Detectar audiências no texto
if (comunicacao.texto.includes('audiência')) {
  const dataMatch = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
  const horaMatch = texto.match(/(\d{2}:\d{2})/);
  
  if (dataMatch && horaMatch) {
    await calendarService.createEvent({
      title: `Audiência - ${processo.process_code}`,
      start_at: `${dataMatch[1]} ${horaMatch[1]}`,
      process_id: processo.id,
      event_type: 'hearing',
    });
  }
}
```

**Benefício:** Audiências no calendário automaticamente.

---

## 🛠️ Implementação Recomendada

### Prioridade Alta (Implementar Primeiro):
1. ✅ **Busca de dados básicos** (FEITO)
2. 🎯 **Auto-vinculação de clientes**
3. ⏰ **Identificação de prazos**
4. 📬 **Monitoramento de comunicações**

### Prioridade Média:
5. 👥 **Cadastro de partes**
6. 📊 **Dashboard de movimentações**
7. 🔔 **Alertas inteligentes**

### Prioridade Baixa (Futuro):
8. 🔄 **Sincronização automática**
9. 🔍 **Análise de advogados**
10. 📈 **Relatórios automáticos**

---

## 📝 Próximos Passos

Para implementar qualquer uma dessas funcionalidades:

1. **Criar tabelas** necessárias no Supabase
2. **Criar services** para manipular os dados
3. **Adicionar UI** para visualizar/gerenciar
4. **Configurar automações** (cron jobs, webhooks)

---

## 🔗 Recursos

- **API DJEN:** `https://comunicaapi.pje.jus.br/api/v1`
- **Serviço:** `src/services/djen.service.ts`
- **Tipos:** `src/types/djen.types.ts`
- **Implementação:** `src/components/ProcessesModule.tsx`

✅ **Sistema pronto para expansão!**
