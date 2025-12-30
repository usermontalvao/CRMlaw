# Editor de Petições Trabalhistas

Módulo isolado para criação de petições trabalhistas com cláusulas reutilizáveis.

## Características

- **Cláusulas organizadas por categoria**: Cabeçalho, Qualificação, Fatos, Direito, Pedidos, Encerramento
- **Formatação específica**:
  - Parágrafo: margem esquerda 4cm
  - Citação: margem esquerda 6cm, itálico
  - Título: centralizado, negrito, maiúsculas
  - Subtítulo: negrito
- **Cláusulas padrão**: 20+ cláusulas pré-cadastradas para petições trabalhistas
- **Editor visual**: arrastar e soltar blocos, editar conteúdo inline
- **Exportação**: DOC e PDF/Impressão
- **Salvar/Carregar**: petições salvas no banco de dados

## Arquivos do Módulo

```
src/
├── types/petitionEditor.types.ts      # Tipos TypeScript
├── services/petitionEditor.service.ts # Service CRUD
├── components/PetitionEditorModule.tsx # Componente principal

supabase/migrations/
└── 20251228_petition_editor.sql       # Migration SQL

src/contexts/NavigationContext.tsx     # Adicionado 'peticoes' ao ModuleName
src/App.tsx                            # Lazy import + botão menu + renderização
```

## Como Usar

1. **Executar a migration** no Supabase:
   ```bash
   # Via Supabase CLI
   supabase db push
   
   # Ou executar manualmente o SQL em:
   # supabase/migrations/20251228_petition_editor.sql
   ```

2. **Acessar o módulo**: Clique em "Petições" no menu lateral

3. **Criar petição**:
   - As cláusulas padrão são carregadas automaticamente
   - Clique em uma cláusula à esquerda para adicionar ao documento
   - Edite o conteúdo diretamente no editor
   - Use os botões de formatação para ajustar cada bloco

4. **Gerenciar cláusulas**:
   - Aba "Cláusulas" para ver todas
   - Criar novas cláusulas
   - Definir quais são padrão (aparecem em novas petições)

## Como Remover o Módulo

Se o módulo não funcionar bem ou não for mais necessário, siga estes passos:

### 1. Remover do App.tsx

Remova estas linhas:

```tsx
// Linha ~64: Remover lazy import
const PetitionEditorModule = lazy(() => import('./components/PetitionEditorModule'));

// Linhas ~897-907: Remover botão do menu
{/* Editor de Petições - Módulo isolado (remover este bloco para desativar) */}
<button
  onClick={() => { setClientPrefill(null); setIsMobileNavOpen(false); navigateTo('peticoes'); }}
  ...
</button>

// Linha ~1260: Remover renderização
{activeModule === 'peticoes' && <PetitionEditorModule />}
```

### 2. Remover do NavigationContext.tsx

```tsx
// Linha ~21: Remover do tipo ModuleName
| 'peticoes'; // Editor de Petições - Módulo isolado
```

### 3. Deletar arquivos

```bash
rm src/types/petitionEditor.types.ts
rm src/services/petitionEditor.service.ts
rm src/components/PetitionEditorModule.tsx
rm docs/PETITION_EDITOR_MODULE.md
```

### 4. (Opcional) Remover tabelas do banco

```sql
DROP TABLE IF EXISTS saved_petitions CASCADE;
DROP TABLE IF EXISTS petition_clauses CASCADE;
DROP FUNCTION IF EXISTS update_petition_editor_updated_at();
```

## Variáveis de Cláusulas

Use `[[NOME_CAMPO]]` para criar variáveis que serão substituídas:

- `[[NOME_CLIENTE]]` - Nome do cliente
- `[[CPF]]` - CPF do cliente
- `[[ENDERECO]]` - Endereço completo
- `[[DATA_ADMISSAO]]` - Data de admissão
- `[[DATA_DEMISSAO]]` - Data de demissão
- `[[FUNCAO]]` - Função exercida
- `[[SALARIO]]` - Salário mensal
- `[[VALOR_CAUSA]]` - Valor da causa
- `[[NOME_ADVOGADO]]` - Nome do advogado
- `[[NUMERO_OAB]]` - Número da OAB

## Cláusulas Padrão Incluídas

1. **Cabeçalho**: Endereçamento ao juiz
2. **Qualificação Reclamante**: Dados pessoais do autor
3. **Qualificação Reclamada**: Dados da empresa
4. **Dos Fatos**: Contrato de trabalho, jornada, horas extras
5. **Do Direito**: Fundamentação legal, citações da CLT
6. **Dos Pedidos**: Procedência, horas extras, verbas rescisórias, honorários
7. **Encerramento**: Valor da causa, local/data, assinatura
