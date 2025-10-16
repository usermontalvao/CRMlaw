# 🚀 Instruções de Deploy - Render

## ⚠️ Problema Identificado

Após inatividade, ao acessar qualquer módulo (aba) diretamente pela URL, o sistema retornava **404 Not Found**. Era necessário voltar para a home (`/dashboard`) para acessar o sistema novamente.

## 🔧 Correções Aplicadas

### 1. **Simplificação do Vite Config**
- ✅ Removido múltiplos entry points (`main` e `landing`)
- ✅ Configurado um único entry point: `index.html`
- ✅ Garantido que arquivos da pasta `public` sejam copiados para `dist`

### 2. **Atualização do Service Worker**
- ✅ Adicionada estratégia de fallback para navegação SPA
- ✅ Atualizada versão do cache para `crm-cache-v2`
- ✅ Implementado limpeza automática de caches antigos
- ✅ Interceptação de requisições de navegação para retornar `index.html`

### 3. **Melhoria no render.yaml**
- ✅ Adicionados headers de cache apropriados
- ✅ HTML sem cache (sempre fresh)
- ✅ Assets com cache de longo prazo (1 ano)
- ✅ Configuração de rewrite mantida: `/* → /index.html`

## 📋 Checklist de Deploy

### Antes do Deploy

- [ ] Commit das alterações em `vite.config.ts`
- [ ] Commit das alterações em `public/sw.js`
- [ ] Commit das alterações em `render.yaml`
- [ ] Push para o repositório Git

### Durante o Deploy

1. **Acesse o Dashboard do Render**
2. **Localize seu serviço:** `crm-advogado`
3. **Faça um Manual Deploy** ou aguarde o deploy automático
4. **Aguarde o build completar** (pode demorar 2-5 minutos)

### Após o Deploy

- [ ] Limpar cache do navegador (Ctrl + Shift + Del)
- [ ] Desregistrar Service Worker antigo:
  - Abra DevTools (F12)
  - Vá em **Application > Service Workers**
  - Clique em **Unregister** no Service Worker antigo
  - Recarregue a página (F5)

- [ ] Testar navegação:
  - [ ] Acessar `/dashboard` diretamente
  - [ ] Acessar `/clientes` diretamente
  - [ ] Acessar `/processos` diretamente
  - [ ] Aguardar 2-3 minutos (simular inatividade)
  - [ ] Recarregar qualquer rota - deve funcionar ✅

## 🧪 Como Testar

### Teste 1: Acesso Direto
```bash
# Acesse diretamente qualquer rota:
https://seu-app.onrender.com/clientes
https://seu-app.onrender.com/processos
https://seu-app.onrender.com/agenda
```
**Resultado esperado:** ✅ Deve carregar normalmente

### Teste 2: Simulação de Inatividade
1. Acesse qualquer módulo (ex: `/clientes`)
2. Aguarde 2-3 minutos sem interagir
3. Clique em F5 para recarregar
4. **Resultado esperado:** ✅ Deve carregar normalmente

### Teste 3: Cold Start (Servidor Dormindo)
1. Aguarde 15+ minutos sem acessar o app
2. Acesse diretamente: `https://seu-app.onrender.com/processos`
3. **Resultado esperado:** ✅ Deve carregar (pode demorar ~30s no primeiro acesso)

## 🔍 Troubleshooting

### Problema: Ainda aparece 404

**Solução 1: Limpar Cache**
```javascript
// Execute no Console do navegador (F12):
caches.keys().then(keys => keys.forEach(key => caches.delete(key)))
location.reload(true)
```

**Solução 2: Verificar Build**
- Conecte via SSH no Render ou verifique os logs
- Confirme que `dist/_redirects` existe:
```bash
ls -la dist/_redirects
```

**Solução 3: Forçar Re-deploy**
- No Render Dashboard, clique em "Manual Deploy"
- Selecione "Clear build cache & deploy"

### Problema: Service Worker não atualiza

```javascript
// Execute no Console:
navigator.serviceWorker.getRegistrations().then(registrations => {
  registrations.forEach(reg => reg.unregister())
})
location.reload(true)
```

## 📊 Arquivos Modificados

```
✏️  vite.config.ts           - Simplificado build config
✏️  public/sw.js             - Adicionado fallback SPA
✏️  render.yaml              - Melhorados headers de cache
✅  public/_redirects         - Já existia (correto)
```

## 💡 Explicação Técnica

### Por que acontecia o erro?

O Render (e outros servidores de sites estáticos) servem arquivos diretamente do sistema de arquivos. Quando você acessa `/clientes`, o servidor procura por um arquivo chamado `clientes` ou `clientes.html`, que não existe.

Em aplicações React com React Router (SPA), todas as rotas são gerenciadas no lado do cliente. O servidor deve **sempre** retornar `index.html` para qualquer rota, permitindo que o React Router assuma o controle.

### Soluções Implementadas

1. **`_redirects`**: Netlify/Render leem este arquivo e redirecionam todas as requisições para `index.html`
2. **`render.yaml` routes**: Configuração explícita de rewrite no nível do serviço
3. **Service Worker**: Fallback no cliente para offline/erro
4. **Cache headers**: Evitam cache agressivo do HTML principal

## 📝 Notas Importantes

- ⏰ O Render (plano gratuito) coloca o servidor em "sleep" após 15 minutos de inatividade
- 🐌 O primeiro acesso após o "sleep" pode demorar ~30 segundos
- 💾 O Service Worker agora ajuda com experiência offline
- 🔄 Headers de cache garantem que usuários sempre vejam a versão mais recente

## 🆘 Suporte

Se o problema persistir após o deploy:

1. Verifique os logs do Render
2. Teste em modo anônimo/privado
3. Teste em outro navegador
4. Verifique se o build foi concluído com sucesso

---

**Deploy feito em:** ___/___/______
**Versão:** 2.0.0
**Status:** ✅ Pronto para produção
