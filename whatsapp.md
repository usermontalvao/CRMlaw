# Modulo WhatsApp - Plano Operacional

Este documento substitui o conteudo anterior.

O objetivo agora nao e descrever visao ampla. O objetivo e guiar execucao com etapas objetivas, criterios de concluido e foco em operacao real.

O Claude deve usar este arquivo como backlog executavel.

## Varredura real do modulo

Esta secao existe para evitar backlog falso.

Antes de abrir nova etapa, o Claude deve validar se a funcionalidade ja existe no codigo e classificar em um destes estados:

- `EXISTE`: fluxo implementado e visivel no modulo
- `PARCIAL`: existe base real, mas falta automacao, fechamento de fluxo ou integracao completa
- `NAO ENCONTRADO`: nao apareceu implementacao real na varredura atual

### Resultado da varredura atual

#### 1. Macros/templates por assunto

Status: `PARCIAL`

Evidencias encontradas:

- existe cadastro de modelos de mensagem com `name`, `body` e `category`
- existe seletor de templates dentro do modulo
- existe busca por nome e categoria
- existe renderizacao com variaveis como `{{cliente.nome}}`, `{{agente.nome}}` e `{{saudacao}}`
- existe configuracao administrativa de templates/macros
- existem playbooks de IA com categoria

Limite atual:

- nao ficou comprovado acoplamento automatico entre assunto classificado da conversa e sugestao/filtragem de macro
- categoria existe, mas "por assunto" ainda parece classificacao manual/organizacional, nao roteamento inteligente

#### 2. Classificacao automatica de assunto, setor e prioridade

Status: `PARCIAL`

Evidencias encontradas:

- existe classificacao de assunto por IA via `aiService.classifySubject(...)`
- o resultado e salvo em `contact_reason`
- o assunto aparece na conversa como `Assunto (IA)`
- existe estrutura de departamentos, transferencia por setor e filtros por setor
- existe prioridade em processos, prazos e tarefas

Limite atual:

- a classificacao de assunto encontrada e disparo manual, nao automacao comprovada de entrada
- nao apareceu classificacao automatica de setor
- nao apareceu classificacao automatica de prioridade da conversa

#### 3. Criacao rapida sem sair da conversa

Status: `EXISTE`

Evidencias encontradas:

- criacao e vinculacao rapida de cliente no proprio modulo
- abertura de cliente, processo, requerimento, prazo, agenda e financeiro por workspace/modal
- acoes rapidas no painel lateral para prazo, agenda, documento e lancamento
- criacao de processo e requerimento dentro da secao de casos
- timeline de processo em modal

Observacao:

- para o escopo citado agora, esta frente ja existe no modulo e nao deve voltar como backlog generico

#### 4. Follow-up automatico quando cliente some ou nao assina

Status: `PARCIAL`

Evidencias encontradas:

- existe tracking de kit/preenchimento e assinatura
- existe leitura de `opened_at`, `last_seen_at`, `submitted_at`, `signed_at`, `refused_at`
- existe painel que mostra estados como `Pagina aberta`, `Saiu sem assinar`, `Aguardando assinatura` e `Cliente na tela`
- existe interrupcao manual do tracking
- existe agendamento de mensagens no modulo

Limite atual:

- nao apareceu regra automatica comprovada de follow-up enviando mensagem quando o cliente some
- nao apareceu automacao comprovada de cobranca/reengajamento por nao assinatura
- o modulo monitora bem, mas ainda nao fecha o ciclo automaticamente

## Regra de execucao

Cada etapa deve ser marcada com `[x]` somente quando:

- o codigo estiver implementado
- a integracao principal estiver funcional
- o fluxo estiver validado manualmente
- riscos remanescentes estiverem anotados no proprio item, se houver

Nao marcar como concluido apenas porque a UI apareceu.

## Prioridade atual

1. confiabilidade e governanca
2. sustentacao tecnica
3. fechar lacunas do que hoje esta parcial
4. integracao futura com projeto externo de automacao

## Regra de isolamento da automacao externa

A automacao por agentes/workflows deve ficar fora do modulo WhatsApp.

Regras:

- [x] manter o `WhatsAppModule` como operacao base do CRM
- [ ] nao acoplar inbox, conversa, composer e painel 360 diretamente ao motor externo
- [ ] concentrar integracao em camada separada ou MCP/API
- [ ] permitir desligar o projeto externo sem reescrever o modulo base

#### Concluido quando

- o WhatsApp continua operacional sem automacao externa
- desligar o projeto externo nao derruba atendimento manual, templates, notas, transferencias e agendamentos

## Fase atual do projeto externo de automacao

- [x] fase de documentacao e arquitetura
- [ ] fase de modelagem tecnica
- [ ] fase de implementacao base
- [ ] fase de builder visual
- [ ] fase de piloto com Leads integrados

---

## Frente 1 - Confiabilidade e Governanca

### Objetivo

Parar de esconder falha operacional com comportamento best-effort e transformar status, erro, retry e auditoria em partes visiveis do modulo.

### Etapa 1. Health check do canal e do numero

- [ ] Criar camada de health check por canal WhatsApp
- [ ] Exibir status tecnico do canal: conectado, instavel, desconectado, erro de autenticacao, webhook sem resposta
- [ ] Exibir ultima sincronizacao bem-sucedida
- [ ] Exibir ultima falha detectada com data/hora e motivo
- [ ] Exibir status do numero/instancia dentro do painel administrativo
- [ ] Exibir banner operacional quando o canal da conversa selecionada estiver degradado
- [ ] Criar acao manual de revalidar status do canal

#### Concluido quando

- o operador consegue identificar rapidamente se o problema esta na conversa ou no canal
- o status nao depende de abrir console ou banco
- a tela mostra data/hora da ultima verificacao

### Etapa 2. Log de falhas de envio por conversa e por canal

- [ ] Persistir log de falhas de envio de mensagem
- [ ] Registrar falhas de texto, midia, edicao e agendamento
- [ ] Salvar contexto minimo do erro: conversa, canal, tipo, payload resumido, horario, mensagem de erro
- [ ] Exibir falhas recentes dentro da conversa
- [ ] Exibir falhas agregadas por canal em painel administrativo
- [ ] Permitir filtro por periodo, canal, conversa e tipo de falha
- [ ] Destacar recorrencia de falhas iguais

#### Concluido quando

- cada falha relevante vira evento consultavel
- o time consegue responder "o que falhou, onde falhou e desde quando falha"

### Etapa 3. Retry manual de mensagens falhas

- [ ] Permitir retry manual de mensagem com status `failed`
- [ ] Permitir retry de texto sem recriar mensagem do zero
- [ ] Permitir retry de midia reaproveitando metadados e storage path quando valido
- [ ] Exibir resultado do retry: sucesso, nova falha ou erro de validacao
- [ ] Impedir retry cego quando o canal estiver desconectado
- [ ] Registrar auditoria do retry manual

#### Concluido quando

- o operador consegue recuperar envio falho sem workaround externo
- o retry nao gera duplicidade silenciosa

### Etapa 4. Auditoria operacional

- [ ] Consolidar trilha de auditoria para assumir, transferir, bloquear, desbloquear, encerrar e reabrir
- [ ] Registrar autor, data/hora, estado anterior e estado novo
- [ ] Exibir auditoria na timeline operacional da conversa
- [ ] Exibir visao administrativa filtravel por periodo e usuario
- [ ] Garantir que eventos automaticos e humanos sejam distinguiveis

#### Concluido quando

- qualquer alteracao critica da conversa pode ser auditada sem consultar banco manualmente

### Etapa 5. Runbook de desconexao e reconexao

- [ ] Criar secao no painel com procedimento operacional para canal desconectado
- [ ] Documentar sinais de falha: QR expirado, webhook parado, token invalido, instancia offline
- [ ] Documentar acao esperada para cada tipo de falha
- [ ] Adicionar comando ou botao operacional de reconexao quando a integracao suportar
- [ ] Exibir ultimo momento em que o canal esteve saudavel
- [ ] Exibir responsavel pela ultima acao operacional no canal

#### Concluido quando

- um operador consegue seguir procedimento sem depender de memoria ou suporte tecnico informal

---

## Frente 2 - Sustentacao Tecnica

### Objetivo

Reduzir risco de regressao, acoplamento e lentidao de manutencao no modulo WhatsApp.

### Diagnostico atual

- `src/components/WhatsAppModule.tsx` concentra inbox, conversa, composer, painel lateral, timeline, governanca, agendamento, IA e modais
- `src/components/WaWorkspace.tsx` concentra renderizacao e logica de multiplos fluxos operacionais
- nao existe suite de testes focada no modulo
- o build nao concluiu dentro da janela testada, indicando necessidade de medir gargalos e validar estabilidade com disciplina

### Etapa 1. Fatiar `WhatsAppModule.tsx`

- [ ] Extrair inbox/fila para componente proprio
- [ ] Extrair cabecalho e acoes da conversa
- [ ] Extrair painel 360
- [ ] Extrair composer, midia e agendamento
- [ ] Extrair notas e timeline
- [ ] Extrair governanca e SLA
- [ ] Extrair IA e playbooks
- [ ] Reduzir o componente principal a coordenacao de estado e composicao

#### Concluido quando

- o arquivo principal deixa de ser ponto unico de tudo
- cada area relevante pode evoluir sem aumentar acoplamento global

### Etapa 2. Fatiar `WaWorkspace.tsx`

- [ ] Separar renderers por dominio: cliente, casos, prazos, agenda, financeiro, documentos, assinatura
- [ ] Extrair utilitarios e tipos para arquivos dedicados
- [ ] Padronizar interface de abertura e retorno dos modais
- [ ] Garantir que cada fluxo preserve contexto da conversa

#### Concluido quando

- o workspace deixa de ser concentrador monolitico
- cada modal pode ser alterado sem risco transversal desnecessario

### Etapa 3. Suite minima de testes do modulo

- [ ] Definir stack de testes do frontend
- [ ] Criar testes para listagem e selecao de conversa
- [ ] Criar testes para assumir, transferir e devolver para fila
- [ ] Criar testes para encerrar e reabrir conversa
- [ ] Criar testes para composer e envio otimista
- [ ] Criar testes para falha de envio e retry manual
- [ ] Criar testes para abertura do workspace e preservacao de contexto

#### Concluido quando

- os fluxos criticos do modulo possuem cobertura minima automatizada
- regressao em fluxo operacional central passa a ser detectavel antes de producao

### Etapa 4. Verificacao tecnica de build e performance

- [ ] Medir tempo de build de forma repetivel
- [ ] Identificar arquivos ou etapas que degradam compilacao
- [ ] Corrigir gargalos obvios de tipagem, importacao ou acoplamento
- [ ] Registrar baseline antes e depois das mudancas

#### Concluido quando

- o time consegue comparar evolucao tecnica do modulo com um baseline claro

---

## Ordem recomendada de execucao

### Sprint 1

- [ ] health check do canal e do numero
- [ ] log de falhas de envio
- [ ] auditoria operacional basica

### Sprint 2

- [ ] retry manual de mensagens falhas
- [ ] runbook de desconexao e reconexao
- [ ] extracao inicial do inbox/fila e cabecalho

### Sprint 3

- [ ] extracao do painel 360, composer e timeline
- [ ] fatiamento inicial do workspace
- [ ] stack de testes definida

### Sprint 4

- [ ] testes de fluxos criticos
- [ ] baseline de build e ajustes de performance
- [ ] fechamento de pendencias abertas das sprints anteriores

---

## Frente 3 - Fechar lacunas do que ja existe parcialmente

### Etapa 1. Templates realmente orientados por assunto

- [ ] Filtrar ou sugerir templates com base no `contact_reason`
- [ ] Permitir mapear categoria de template para assunto classificado
- [ ] Exibir recomendacoes de macro no composer com base na conversa atual

#### Concluido quando

- o operador nao precisa buscar tudo manualmente quando o assunto da conversa ja foi identificado

### Etapa 2. Classificacao automatica completa

- [ ] Disparar classificacao de assunto sem acao manual quando houver contexto suficiente
- [ ] Criar heuristica ou IA para sugerir setor automaticamente
- [ ] Criar heuristica ou IA para sugerir prioridade operacional da conversa
- [ ] Permitir aprovacao humana antes de gravar setor/prioridade quando necessario

#### Concluido quando

- a conversa entra melhor classificada sem depender sempre de triagem manual

### Etapa 3. Follow-up automatico real

- [ ] Criar regra automatica para cliente que abriu e saiu sem concluir
- [ ] Criar regra automatica para cliente que recebeu assinatura e nao concluiu
- [ ] Permitir janela de tempo configuravel antes do follow-up
- [ ] Registrar quando o follow-up automatico foi disparado
- [ ] Permitir pausar o follow-up por conversa ou por assinatura

#### Concluido quando

- o modulo nao apenas monitora abandono; ele reage operacionalmente com regra controlada

---

## Regras para o Claude marcar como concluido

- [ ] so marcar `[x]` apos implementacao real
- [ ] so marcar `[x]` apos validacao manual do fluxo principal
- [ ] descrever no commit ou changelog curto o que foi entregue
- [ ] se houver bloqueio tecnico, manter `[ ]` e adicionar observacao logo abaixo do item
- [ ] se entregar parcialmente, quebrar o item em subitens menores antes de marcar qualquer um

---

## Definicao de pronto do modulo

O modulo WhatsApp sera considerado mais operacional quando:

- falhas de canal e envio estiverem visiveis
- houver retry manual seguro
- a trilha de auditoria estiver acessivel
- existir procedimento claro para desconexao
- o componente principal estiver fatiado
- o workspace estiver modularizado
- os fluxos criticos tiverem testes minimos

Enquanto isso nao estiver entregue, o modulo ainda depende demais de conhecimento tacito e manutencao arriscada.
