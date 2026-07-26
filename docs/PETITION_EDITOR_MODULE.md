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

## Revisão de Texto (ortografia, gramática, gênero e contexto)

Duas frentes, com a mesma engrenagem por baixo:

- **Ao digitar**: sublinhado vermelho e correção no menu do botão direito —
  igual ao Word. Nenhum aviso de análise, nenhum badge, nenhum spinner.
- **Sob demanda**: botão **Revisar Texto** na aba *Revisão* do ribbon abre um
  painel com todos os apontamentos; nada é alterado sem clique do usuário.

### As quatro camadas

| Camada | Onde | O que pega | Custo |
| --- | --- | --- | --- |
| Hunspell (WASM, pt-BR) | `src/components/local-spell-checker.ts` | Ortografia palavra a palavra + sublinhado ao digitar | zero, offline |
| Curadoria local | `src/components/spelling-suggestions.ts` | Erros recorrentes resolvidos na hora ("apartir" → "a partir", acentuação esquecida) | zero, offline |
| Regras jurídicas próprias | `src/services/legalGrammarRules.ts` | Crase ("vem **à** presença"), concordância de **gênero** e **número**, impessoalidade ("houveram" → "houve", "fazem dois anos" → "faz"), regência ("implica em"), pronomes ("para mim apresentar"), homônimos forenses (mandado × mandato, seção × sessão), pontuação e vícios de redação | zero, offline |
| LanguageTool | `src/services/languageTool.service.ts` + Edge Function `languagetool-proxy` | Gramática básica, pontuação, parte da concordância | zero na API pública |
| Contexto (modelo) | `aiService.analyzeSpellingSentence` / `reviewLegalTextGrammar` | Palavra válida no dicionário, porém errada na frase; regência, ambiguidade, concordância à distância | tokens, sob orçamento (ver abaixo) |

O orquestrador (`src/services/petitionProofreader.ts`) roda as camadas,
deduplica sobreposições (regra própria > contexto > LanguageTool > Hunspell) e
ancora cada apontamento no documento por janela de texto + índice de
ocorrência, para a substituição preservar a formatação do parágrafo.

Cada cartão mostra a **regra gramatical aplicada** ("o determinante concorda em
gênero e número com o substantivo"), não só a troca sugerida.

### Economia de tokens: o portão e o orçamento

`src/services/proofContextBudget.ts` concentra a parte que custa dinheiro. Duas
regras governam a camada contextual:

1. **Só entra quando as camadas locais já acusaram algo.** Durante a digitação,
   a chamada de modelo depende de uma palavra daquela frase estar marcada no
   `errorWordCollection` do Syncfusion. Texto correto custa exatamente zero,
   por mais que se digite. As negativas do portão, em ordem de frequência:
   `sem-palavra-suspeita`, `resolvido-localmente` (a curadoria local já sabe a
   resposta), `contexto-curto`, `orcamento-esgotado`.
2. **Teto de contexto e de chamadas.** Vai ao modelo uma janela de no máximo
   `CONTEXT_WINDOW_MAX_CHARS` (320 caracteres ≈ 90 tokens) recortada em volta da
   palavra suspeita, nunca o parágrafo. A saída é limitada a 220 tokens (frase)
   e 90 (palavra), com teto redundante no `openai-proxy` para que configuração
   errada no banco não vire conta alta. A janela deslizante corta em 6
   chamadas/minuto, 90/hora e 40k tokens/hora; estourado o orçamento, a camada
   simplesmente não roda — sem mensagem na tela.

Modelo: **GPT-5 nano** com `reasoning_effort: minimal` na digitação (tasks
`spell_sentence` e `spell_context`) e **gpt-4o-mini** na revisão do documento
(`proofread_legal`), que só é chamada com a *Revisão aprofundada* ligada e
recebe no prompt o que as camadas locais já acharam, para não gastar saída
repetindo o que saiu de graça.

### Fluidez (o requisito de "rodar como o Word")

- Nenhum estado React e nenhum `reLayout` por tecla digitada. A revisão
  contextual é agendada 900 ms após a última tecla e roda em
  `requestIdleCallback`, entre os frames.
- `reLayout` acontece só quando há sublinhado novo para pintar. Palavra que o
  dicionário já marcou não é sublinhada de novo — a correção fica no cache e
  aparece no menu do sublinhado existente.
- O menu do botão direito abre com as sugestões **locais imediatamente**; se
  houver veredicto de contexto para aquela frase (normalmente há, calculado na
  pausa da digitação), a lista é substituída em silêncio. Chamada no próprio
  clique só quando o dicionário não tem nenhuma resposta.
- Cache por frase e por palavra+frase, incluindo veredicto negativo ("está
  correta"): voltar o cursor a um trecho já revisado não gera nova cobrança.

### Sugestão de palavra pelo contexto da frase

O Hunspell ordena candidatas por semelhança de letras e considera apenas se a
palavra existe, ignorando a frase. A camada contextual cobre os dois furos:

- **Ordem ruim das candidatas**: task `spell_context` decide qual cabe na frase.
- **Falso negativo do dicionário**: task `spell_sentence` encontra palavra
  válida isoladamente, mas errada no contexto ("mei amigo" → "meu amigo") — e só
  é acionada porque o Hunspell marcou algo naquela mesma frase.
- A substituição reconstrói o intervalo real do Syncfusion, preservando espaços
  e pontuação que eventualmente estejam anexados à palavra marcada.
- **Painel de revisão**: botão *Sugerir pelo contexto* nos apontamentos de
  ortografia (ação pedida pelo usuário, um por vez).

Cobertura de testes: `src/services/proofContextBudget.test.ts` (portão e
orçamento), `src/services/legalGrammarRules.test.ts` (regras offline) e
`src/components/spelling-suggestions.test.ts` (curadoria e validação da saída
do modelo).

### Configuração

Front (`.env`, opcional):

```
VITE_LANGUAGETOOL_URL=https://languagetool.seu-dominio.com   # sem isto, usa api.languagetool.org
```

Edge Function `languagetool-proxy` (opcional; sem ela o front chama o servidor
LT direto):

```
LANGUAGETOOL_URL=https://languagetool.seu-dominio.com
LANGUAGETOOL_USERNAME=...     # só para conta premium
LANGUAGETOOL_API_KEY=...
```

Deploy: `supabase functions deploy languagetool-proxy`.

Autohospedar o LanguageTool melhora privacidade e limite de requisições, mas
não a qualidade: as regras que faltam para petição estão em
`legalGrammarRules.ts`, que é onde se acrescenta erro recorrente novo (há
cobertura de testes em `src/services/legalGrammarRules.test.ts`).
