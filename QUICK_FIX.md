# 🚀 Fix Rápido - Erro 404 no Render

## ✅ Correções Aplicadas

1. **vite.config.ts** - Adicionado `copyPublicDir: true`
2. **index.html** - Corrigido favicon para `/icon-192.png`
3. **render.yaml** - Atualizado para Node 20 e `npm ci`
4. **package.json** - Script para copiar `_redirects`

## 📋 Próximos Passos

### 1. Commit e Push
```bash
git add .
git commit -m "fix: corrigir erro 404 no Render - adicionar copyPublicDir"
git push origin main
```

### 2. No Render Dashboard
1. Acesse: https://dashboard.render.com
2. Selecione o serviço `crm-advogado`
3. Clique em **Settings**
4. Role até **Build & Deploy**
5. Clique em **Clear Build Cache**
6. Clique em **Manual Deploy** → **Deploy latest commit**

### 3. Aguarde o Build
- ⏱️ Tempo estimado: 3-5 minutos
- 📊 Acompanhe os logs em tempo real
- ✅ Aguarde aparecer "Build successful"

### 4. Teste a Aplicação
Acesse: https://crmlaw1.onrender.com/dashboard

**Teste estas rotas:**
- ✅ `/dashboard`
- ✅ `/clientes`
- ✅ `/processos`
- ✅ `/peticoes`
- ✅ Recarregue (F5) em cada página

## 🔍 Verificar se Funcionou

### Console do Navegador (F12)
```
✅ Sem erros 404
✅ Favicon carrega
✅ Assets carregam
✅ Rotas funcionam
```

### Teste de Navegação
1. Faça login
2. Navegue entre páginas
3. Recarregue a página (F5)
4. Volte/Avance no navegador
5. Abra link direto (ex: /clientes)

## ❌ Se Ainda Não Funcionar

### Opção 1: Rebuild Completo
```bash
# No Render Dashboard:
Settings → Delete Service
# Criar novo serviço apontando para o mesmo repositório
```

### Opção 2: Verificar Logs
```bash
# No Render Dashboard:
Logs → Ver últimas 100 linhas
# Procurar por erros de build
```

### Opção 3: Testar Localmente
```bash
npm run build
npm run preview
# Abrir http://localhost:4173
# Testar todas as rotas
```

## 📝 Checklist

- [ ] Commit feito
- [ ] Push para repositório
- [ ] Cache limpo no Render
- [ ] Deploy manual iniciado
- [ ] Build completado com sucesso
- [ ] Site acessível
- [ ] Todas as rotas funcionam
- [ ] Favicon aparece
- [ ] Sem erros 404 no console

## 🆘 Suporte

Se o problema persistir após seguir todos os passos:

1. **Verificar variáveis de ambiente:**
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

2. **Verificar arquivo `dist/_redirects`:**
   ```bash
   # Após build local:
   cat dist/_redirects
   # Deve mostrar: /*    /index.html   200
   ```

3. **Verificar arquivos públicos:**
   ```bash
   # Após build local:
   ls dist/
   # Deve conter: icon-192.png, icon-512.png, manifest.webmanifest
   ```

## 🎯 Resultado Esperado

✅ Site carrega em https://crmlaw1.onrender.com
✅ Todas as rotas funcionam
✅ Favicon aparece
✅ Sem erros 404
✅ Navegação fluida
✅ Sessão permanece ativa

---

**Última atualização:** 15/10/2025 22:36
