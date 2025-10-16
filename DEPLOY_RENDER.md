# Deploy no Render - Guia Completo

## Problema: "Not Found" no Render

O erro "Not Found" em SPAs (Single Page Applications) no Render ocorre porque o servidor tenta buscar arquivos físicos para cada rota, mas em um SPA todas as rotas devem ser redirecionadas para o `index.html`.

## Soluções Implementadas

### 1. Arquivo `_redirects` (✅ Já configurado)
```
/*    /index.html   200
```

### 2. Arquivo `render.yaml` (✅ Atualizado)
```yaml
services:
  - type: web
    name: crm-advogado
    env: static
    buildCommand: npm install && npm run build
    staticPublishPath: ./dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

### 3. Vite Config (✅ Atualizado)
- `base: '/'` - Define o caminho base
- `assetsDir: 'assets'` - Organiza assets
- `sourcemap: false` - Reduz tamanho do build

## Checklist de Deploy

### Antes do Deploy:
- [ ] Commit todas as mudanças
- [ ] Push para o repositório Git
- [ ] Verificar variáveis de ambiente no Render

### Configuração no Render:

1. **Build Command:**
   ```bash
   npm install && npm run build
   ```

2. **Publish Directory:**
   ```
   dist
   ```

3. **Variáveis de Ambiente:**
   - `VITE_SUPABASE_URL` - URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` - Chave pública do Supabase
   - `NODE_VERSION` - 18 (já configurado no render.yaml)

### Após o Deploy:

1. **Testar Rotas:**
   - Acesse `/dashboard`
   - Acesse `/clientes`
   - Acesse `/processos`
   - Recarregue a página (F5) em cada rota
   - Todas devem funcionar sem "Not Found"

2. **Verificar Console:**
   - Abra DevTools (F12)
   - Verifique se há erros no console
   - Verifique se os assets carregaram corretamente

3. **Testar Autenticação:**
   - Faça login
   - Navegue entre páginas
   - Recarregue a página
   - Sessão deve permanecer ativa

## Troubleshooting

### Problema: Ainda aparece "Not Found"

**Solução 1:** Limpar cache do Render
```bash
# No dashboard do Render:
Settings > Clear Build Cache > Clear Cache and Deploy
```

**Solução 2:** Verificar se o arquivo `_redirects` está no `dist/`
```bash
# Adicionar ao package.json:
"build": "vite build && cp public/_redirects dist/_redirects"
```

**Solução 3:** Forçar rebuild completo
```bash
# Deletar o serviço e criar novamente
```

### Problema: Assets não carregam (404)

**Solução:** Verificar `base` no vite.config.ts
```typescript
base: '/', // Deve ser '/' para Render
```

### Problema: Sessão expira rapidamente

**Solução:** Já implementado no AuthContext:
- Heartbeat a cada 5 minutos
- Renovação automática de token
- Detecção de atividade do usuário

## Comandos Úteis

### Build local para testar:
```bash
npm run build
npm run preview
```

### Verificar tamanho do build:
```bash
npm run build
du -sh dist/
```

### Testar produção localmente:
```bash
npm install -g serve
serve -s dist -p 3000
```

## Alternativa: Vercel

Se o problema persistir no Render, use Vercel:

1. Instalar Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel --prod
```

O arquivo `vercel.json` já está configurado.

## Suporte

Se o problema persistir:
1. Verificar logs no Render Dashboard
2. Testar build localmente
3. Verificar se todas as variáveis de ambiente estão configuradas
4. Contatar suporte do Render com os logs

## Checklist Final

- [x] `_redirects` configurado
- [x] `render.yaml` configurado
- [x] `vite.config.ts` otimizado
- [x] `vercel.json` como backup
- [x] Rotas catch-all no App.tsx
- [x] AuthContext com renovação de sessão
- [ ] Variáveis de ambiente configuradas no Render
- [ ] Build testado localmente
- [ ] Deploy realizado com sucesso
