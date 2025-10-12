# 🤖 Integração de IA com OpenAI

## ✅ Implementado - Fase 1: Intimações

A integração com OpenAI foi implementada para análise inteligente de intimações judiciais.

---

## 🚀 Configuração

### 1. Obter API Key da OpenAI

1. Acesse: https://platform.openai.com/api-keys
2. Crie uma nova API Key
3. Copie a chave gerada

### 2. Configurar no Projeto

Crie um arquivo `.env` na raiz do projeto (ou edite o existente) e adicione:

```bash
VITE_OPENAI_API_KEY=sk-proj-your_actual_api_key_here
```

**⚠️ IMPORTANTE:**
- Nunca commite o arquivo `.env` no Git
- A chave deve começar com `sk-`
- Mantenha a chave em segredo

### 3. Reiniciar o Servidor de Desenvolvimento

```bash
npm run dev
```

---

## 📋 Funcionalidades Implementadas

### **Módulo: Intimações**

#### 1. **Análise Completa com IA** ✨

Ao clicar no botão **"Analisar IA"** em uma intimação, o sistema:

- ✅ **Resume** a intimação em 2-3 frases objetivas
- ✅ **Detecta prazos** automaticamente em **dias úteis** (excluindo sábados e domingos)
- ✅ **Calcula data de vencimento** considerando apenas dias úteis
- ✅ **Classifica urgência** (Crítica, Alta, Média, Baixa)
- ✅ **Sugere ações** específicas para o advogado
- ✅ **Extrai pontos-chave** mais relevantes

#### ⚡ **Novidade: Cálculo Correto de Prazos Processuais**

O sistema agora calcula prazos em **dias úteis** (segunda a sexta), como é correto no processo brasileiro:

- ✅ Exclui automaticamente sábados e domingos
- ✅ Exibe data de vencimento completa (ex: "sexta-feira, 25 de outubro de 2025")
- ⚠️ Aviso sobre feriados (que devem ser verificados manualmente)

#### 2. **Interface Visual**

A análise é exibida em um card destacado com:
- 🎨 Gradiente roxo/azul
- 🏷️ Badge de urgência colorido
- ⏰ Destaque para prazos detectados
- 💡 Lista de ações sugeridas
- 🎯 Pontos-chave resumidos

---

## 💰 Custos Estimados

O sistema usa o modelo **GPT-4o-mini** (mais barato e rápido):

### Preços por Análise:
- **Resumo de intimação:** ~$0.01 USD
- **Análise completa:** ~$0.02 USD

### Estimativas Mensais:

| Uso | Intimações/Mês | Custo Estimado |
|-----|----------------|----------------|
| **Escritório Pequeno** | 20-50 | $0.20 - $1.00 |
| **Escritório Médio** | 100-200 | $2.00 - $4.00 |
| **Escritório Grande** | 500+ | $10.00 - $20.00 |

**Conclusão:** Extremamente barato! 💚

---

## 🔐 Segurança & LGPD

### Boas Práticas Implementadas:

1. ✅ **Processamento no cliente:** API key configurada localmente
2. ✅ **Opt-in:** IA só funciona quando configurada
3. ✅ **Transparência:** Badge "✨ Análise com IA" visível
4. ✅ **Controle:** Usuário decide quando usar
5. ✅ **Fallback:** Sistema funciona sem IA

### Recomendações Adicionais:

- Configure **Data Retention = 0 dias** na OpenAI
- Anonimize dados sensíveis antes de enviar (se necessário)
- Deixe claro que IA é assistente, não substitui advogado
- Permita usuário desabilitar IA se preferir

---

## 📖 Como Usar

### Passo a Passo:

1. **Acesse** o módulo "Intimações"
2. **Sincronize** para buscar novas intimações do DJEN
3. **Expanda** uma intimação clicando na seta
4. **Clique** no botão **"✨ Analisar IA"** (lateral direita)
5. **Aguarde** 2-5 segundos (indicador de carregamento)
6. **Visualize** a análise completa com resumo, prazos e ações

### Vídeo Demo:
_(TODO: Adicionar GIF/vídeo demonstrativo)_

---

## 🛠️ Arquitetura Técnica

### Arquivos Criados/Modificados:

```
src/
├── types/
│   └── ai.types.ts              # Tipos TypeScript para IA
├── services/
│   └── ai.service.ts            # Serviço principal de IA
└── components/
    └── IntimationsModule.tsx    # Integração UI + IA
```

### Fluxo de Funcionamento:

```
1. Usuário clica "Analisar IA"
   ↓
2. IntimationsModule chama aiService.analyzeIntimation()
   ↓
3. aiService monta prompt otimizado para contexto jurídico
   ↓
4. Envia para OpenAI GPT-4o-mini (JSON mode)
   ↓
5. Recebe análise estruturada
   ↓
6. Exibe resultado na UI com destaque visual
```

### Modelo de Prompt:

O prompt foi otimizado para:
- ✅ **Contexto jurídico brasileiro**
- ✅ **Respostas estruturadas em JSON**
- ✅ **Baixa temperatura (0.3)** para consistência
- ✅ **Extração de prazos com confiança**
- ✅ **Classificação de urgência precisa**

---

## 🔮 Próximas Fases (Roadmap)

### **Fase 2: Processos** (Próximo)
- Análise de histórico completo
- Sugestão de próximas ações
- Detecção de anomalias (processo parado)

### **Fase 3: Documentos**
- Busca semântica em petições
- Resumo de sentenças longas
- Extração de valores e datas

### **Fase 4: Tarefas + Leads**
- Geração automática de tarefas
- Qualificação de leads por IA
- Priorização inteligente

---

## ⚠️ Observação Importante sobre Prazos e Feriados

### **Como o Sistema Calcula Prazos:**

O sistema calcula prazos processuais da seguinte forma:

1. ✅ **Conta apenas dias úteis** (segunda a sexta)
2. ✅ **Exclui automaticamente** sábados e domingos
3. ⚠️ **NÃO considera feriados** (nacionais, estaduais ou municipais)

### **Por que não considera feriados?**

- Feriados variam por estado e município
- Seria necessário uma API externa atualizada
- Calendário de feriados muda anualmente

### **O que você deve fazer:**

1. ✅ Use a data calculada como **referência inicial**
2. ✅ **Confira o calendário oficial** do tribunal
3. ✅ **Subtraia os feriados** que caírem no período
4. ✅ Crie o prazo no sistema com a **data correta ajustada**

### **Exemplo Prático:**

```
Prazo: 10 dias úteis a partir de 11/10/2025

Sistema calcula: 27/10/2025 (segunda-feira)
  ↓
Feriados no período:
  - 12/10 (sábado) → Já excluído
  - 15/10 (Dia do Professor) → AJUSTAR MANUALMENTE
  ↓
Data correta: 28/10/2025 (terça-feira)
```

### **Recursos Úteis:**

- **Calendário TRT:** Cada tribunal publica calendário anual
- **ANBIMA:** https://www.anbima.com.br/feriados/
- **CNJ:** Consulte o site do tribunal competente

---

## 🐛 Troubleshooting

### Problema: "Serviço de IA não habilitado"

**Solução:**
1. Verifique se `VITE_OPENAI_API_KEY` está no `.env`
2. Reinicie o servidor (`npm run dev`)
3. Verifique se a chave começa com `sk-`

### Problema: "Erro ao analisar intimação"

**Possíveis causas:**
- API Key inválida ou expirada
- Sem créditos na conta OpenAI
- Rate limit excedido (muitas requisições)

**Solução:**
1. Verifique saldo em: https://platform.openai.com/usage
2. Aguarde 1 minuto entre análises em massa
3. Confira se a chave está correta

### Problema: Análise demorada (>10 segundos)

**Solução:**
- Normal em primeira requisição (cold start)
- Após primeira vez, deve levar 2-5 segundos
- Se persistir, verifique conexão com internet

---

## 📊 Monitoramento de Uso

Para monitorar gastos:

1. Acesse: https://platform.openai.com/usage
2. Veja consumo em tempo real
3. Configure alertas de orçamento
4. Limite de gastos mensal (recomendado: $20)

---

## 🎓 Exemplos de Análise

### Exemplo 1: Intimação Simples

**Entrada (texto da intimação):**
```
Fica a parte intimada para apresentar contestação no prazo de 15 dias,
sob pena de revelia e confissão quanto à matéria de fato.
```

**Saída da IA:**
```json
{
  "summary": "Intimação para apresentar contestação em 15 dias úteis sob pena de revelia.",
  "urgency": "alta",
  "deadline": {
    "days": 15,
    "dueDate": "2025-11-03",
    "description": "Prazo para contestação",
    "confidence": "alta"
  },
  "suggestedActions": [
    "Elaborar contestação completa",
    "Juntar documentos necessários",
    "Protocolar antes do prazo"
  ],
  "keyPoints": [
    "Contestação obrigatória",
    "Prazo peremptório de 15 dias úteis",
    "Consequência: revelia e confissão"
  ]
}
```

**Observação:** A data de vencimento (03/11/2025) foi calculada considerando apenas dias úteis, excluindo finais de semana.

### Exemplo 2: Sentença

**Entrada:**
```
Sentença: Julgo procedente o pedido para condenar o réu ao pagamento
de R$ 50.000,00 a título de danos morais...
```

**Saída da IA:**
```json
{
  "summary": "Sentença favorável condenando réu ao pagamento de R$ 50.000,00 por danos morais.",
  "urgency": "alta",
  "deadline": null,
  "suggestedActions": [
    "Verificar necessidade de recurso",
    "Notificar cliente sobre sentença",
    "Iniciar fase de cumprimento se for o caso"
  ],
  "keyPoints": [
    "Sentença procedente",
    "Condenação em R$ 50.000,00",
    "Título: danos morais"
  ]
}
```

---

## 📞 Suporte

Dúvidas ou problemas com a IA?

1. **Documentação OpenAI:** https://platform.openai.com/docs
2. **Código-fonte:** `src/services/ai.service.ts`
3. **Issues:** Abra uma issue no repositório

---

## 🎉 Pronto para Usar!

A integração está completa e pronta para uso. Basta configurar a API Key e começar a economizar horas de trabalho!

**Economia estimada:** 5-10 minutos por intimação analisada = **2-4 horas/dia** para escritório médio! 🚀
