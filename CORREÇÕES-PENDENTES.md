# 🚨 CORREÇÕES URGENTES PENDENTES

## ❌ Problema 1: RLS Policy bloqueando `agreements`

### **Erro:**
```
Failed to load resource: the server responded with a status of 403/400
```

### **Solução:**
1. Abra o **Supabase Dashboard**
2. Vá em **SQL Editor**
3. Execute o arquivo **`fix-agreements-rls.sql`**

---

## ❌ Problema 2: CORS bloqueando OpenAI API

### **Erro:**
```
Access to fetch at 'https://api.openai.com/v1/chat/completions' from origin 'http://localhost:3001' 
has been blocked by CORS policy
```

### **Status Atual:**
- ✅ Edge Function criada: `supabase/functions/openai-proxy/index.ts`
- ✅ Código do serviço atualizado para usar Edge Function
- ⏳ **PENDENTE**: Implantar Edge Function no Supabase
- ⚠️ **TEMPORÁRIO**: Edge Function desabilitada (linha 8 do `ai.service.ts`)

### **Solução Temporária (Desenvolvimento):**
A análise de IA está **temporariamente desabilitada** até você implantar a Edge Function.

### **Solução Definitiva:**

#### **Opção A: Implantar Edge Function (RECOMENDADO)**

1. **Instale o Supabase CLI** (se ainda não tiver):
```bash
npm install -g supabase
```

2. **Faça login no Supabase:**
```bash
supabase login
```

3. **Link com seu projeto:**
```bash
supabase link --project-ref uajwkqipbyxzvwjpitxl
```

4. **Implante a Edge Function:**
```bash
supabase functions deploy openai-proxy
```

5. **Configure a variável de ambiente no Supabase:**
   - Vá em **Edge Functions** > **openai-proxy** > **Settings**
   - Adicione: `OPENAI_API_KEY` = sua chave da OpenAI

6. **Habilite a Edge Function no código:**
   - Abra `src/services/ai.service.ts`
   - Linha 8: Mude `useEdgeFunction: boolean = false` para `true`

#### **Opção B: Usar chamada direta (Desenvolvimento local)**

Se você quiser testar localmente sem implantar:

1. **Instale a extensão CORS no navegador:**
   - Chrome: [Allow CORS](https://chrome.google.com/webstore/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlf)
   - Firefox: [CORS Everywhere](https://addons.mozilla.org/en-US/firefox/addon/cors-everywhere/)

2. **Ative a extensão** apenas durante o desenvolvimento

3. **Mantenha** `useEdgeFunction = false` no código

⚠️ **ATENÇÃO**: Nunca use extensões CORS em produção!

---

## 📋 Checklist de Correções

- [ ] Executar `fix-agreements-rls.sql` no Supabase
- [ ] Implantar Edge Function `openai-proxy`
- [ ] Configurar `OPENAI_API_KEY` na Edge Function
- [ ] Habilitar `useEdgeFunction = true` no código
- [ ] Testar criação de acordos financeiros
- [ ] Testar análise de intimações com IA

---

## 🎯 Prioridade

1. **URGENTE**: Fix RLS para agreements (bloqueia funcionalidade financeira)
2. **ALTA**: Implantar Edge Function (bloqueia análise de IA)

---

## 📞 Suporte

Se precisar de ajuda:
- Documentação Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Documentação OpenAI: https://platform.openai.com/docs
