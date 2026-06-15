# WhatsApp 360 - Implementacao Real no CRM

Este documento substitui integralmente o planejamento anterior.

O modulo WhatsApp precisa deixar de ser um painel lateral com atalhos soltos e virar uma estacao de trabalho juridica 360 dentro do CRM.

O objetivo nao e "ter contexto". O objetivo e operar o escritorio sem sair da conversa.

## Diagnostico do CRM hoje

### O que o CRM ja tem e pode ser reaproveitado

- modulo de clientes
- modulo de processos com modal de criacao, edicao, visualizacao e timeline
- modulo de requerimentos com modal de criacao e edicao
- modulo de prazos com `DeadlineFormModal`
- modulo de agenda com modal de criacao e edicao
- modulo financeiro com modais de criacao, edicao, detalhes e baixa
- modulo de documentos com modais de templates, preview, edicao e geracao
- modulo de assinaturas com `prefillData` e `focusRequestId`
- servicos de processos, prazos, agenda, financeiro, documentos e assinaturas
- modulo WhatsApp com conversa, notas, etiquetas, vinculo de cliente, quick actions e paineis de contexto

### O que o modulo WhatsApp faz hoje

- lista conversas e mensagens
- envia texto e midia
- mostra cliente vinculado
- mostra processos, prazos, compromissos, pendencias, assinaturas e acordos em formato resumido
- possui notas internas, etiquetas, timeline operacional e algumas acoes rapidas

### Onde ele falha hoje

- o contexto e superficial e fragmentado
- varias acoes ainda jogam o usuario para outro modulo em vez de abrir dentro do WhatsApp
- a timeline processual visivel na lateral e mini e baseada so em movimentacoes locais
- nao existe uma visao unificada de casos do cliente
- nao existe um workspace modal para criar e editar tudo sem sair da conversa
- templates e geracao de contratos nao estao integrados ao fluxo da conversa
- o modulo nao opera como cockpit juridico; opera como inbox com cards auxiliares

## Direcao obrigatoria

O WhatsApp passa a ser um shell de operacao.

Tudo que for necessario para atender o cliente deve abrir em modal, drawer ou overlay dentro do proprio modulo WhatsApp.

Nao deve ser necessario navegar para Clientes, Processos, Requerimentos, Prazos, Agenda, Financeiro, Documentos ou Assinaturas para executar o fluxo principal do atendimento.

## Regra principal

- tudo criar em modal
- tudo editar em modal
- tudo visualizar em modal
- tudo vincular em modal
- tudo gerar em modal
- toda acao deve preservar o contexto da conversa aberta
- fechar modal deve devolver o usuario exatamente para a conversa onde estava

## Experiencia alvo

Ao abrir uma conversa, o operador deve conseguir:

- identificar e editar o cliente
- vincular ou trocar cliente
- criar cliente novo
- abrir todos os casos do cliente
- criar processo
- criar requerimento
- editar processo e requerimento
- ver timeline processual completa
- criar prazo
- editar prazo
- criar compromisso de agenda
- editar compromisso
- abrir financeiro do cliente
- criar acordo ou lancamento
- gerar contrato ou documento a partir de template
- mandar para assinatura
- acompanhar documentos ja gerados
- registrar nota interna
- classificar assunto e contexto

Tudo isso sem sair do WhatsApp.

## Estrutura funcional obrigatoria

### 1. Cabecalho da conversa

Deve mostrar:

- nome do contato
- telefone
- canal
- responsavel
- setor
- assunto
- status operacional
- sinal de SLA

Deve ter acoes:

- assumir
- transferir
- encerrar
- reabrir
- bloquear
- abrir painel 360

### 2. Coluna lateral 360

Deve virar um painel juridico real, com secoes:

- cliente
- casos
- prazos
- agenda
- documentos e contratos
- assinaturas
- financeiro
- notas internas
- etiquetas
- governanca

### 3. Workspace modal do WhatsApp

Toda acao relevante deve abrir um modal padronizado sobre o modulo WhatsApp.

Esse workspace modal sera a base para:

- cadastro e edicao de cliente
- processo
- requerimento
- prazo
- compromisso
- financeiro
- contrato
- assinatura
- historico completo

## Casos: unificacao obrigatoria

O modulo nao deve exibir apenas "Processos".

Precisa existir a secao `Casos`, reunindo:

- processos
- requerimentos

Cada item deve mostrar:

- tipo do caso
- identificador
- status
- area
- responsavel
- alertas criticos
- proximos eventos e prazos

Cada caso deve ter acoes em modal:

- ver detalhes
- editar
- ver timeline
- criar prazo
- criar compromisso
- vincular documento

## Timeline processual: obrigatoria e completa

O resumo atual de movimentacoes nao basta.

### Regra

Ao clicar em timeline de processo no WhatsApp, deve abrir a timeline processual completa em modal, reutilizando a infraestrutura existente de timeline do CRM.

### Implementacao esperada

- parar de depender apenas da mini timeline local de `listProcessMovements`
- abrir um modal completo por processo
- usar o componente/servico de timeline processual do CRM como fonte principal
- manter a mini timeline apenas como preview
- permitir abrir a timeline completa sem sair da conversa

### Resultado esperado

O operador enxerga:

- movimentacoes
- analise
- contexto temporal
- leitura juridica da evolucao do caso

## Cliente: operacao completa em modal

O card de cliente deve deixar de ser apenas resumo.

### Deve permitir

- ver cadastro completo em modal
- editar cadastro em modal
- trocar cliente em modal
- desvincular cliente
- criar cliente novo em modal
- adicionar telefone da conversa ao cadastro

### Regras

- nao navegar para o modulo Clientes como fluxo padrao
- usar prefill da conversa
- manter o card lateral sincronizado apos salvar

## Prazos: integracao total

O operador precisa criar e editar prazos dentro do WhatsApp.

### Implementacao

- reutilizar `DeadlineFormModal`
- abrir com `client_id`, `process_id` ou `requirement_id` predefinidos
- permitir criar prazo a partir de:
  - conversa
  - mensagem
  - caso selecionado

### Vista lateral

Os prazos devem mostrar:

- titulo
- vencimento
- status
- caso relacionado
- acao de editar em modal

## Agenda: integracao total

O operador precisa criar compromisso sem sair da conversa.

### Implementacao

- reutilizar modal de criacao/edicao do modulo Agenda
- permitir prefill por cliente, processo ou requerimento
- permitir tipos como:
  - audiencia
  - reuniao
  - pericia
  - compromisso interno

### Vista lateral

Deve mostrar:

- proximos compromissos
- data e hora
- tipo
- caso vinculado
- acao de editar em modal

## Financeiro: integracao total

Hoje o WhatsApp so "abre financeiro".

Isso e insuficiente.

### O WhatsApp deve permitir

- ver resumo financeiro do cliente
- abrir detalhes de acordo em modal
- criar novo acordo ou lancamento em modal
- editar acordo em modal
- registrar pagamento em modal

### Regras

- usar os modais do modulo Financeiro
- abrir filtrado pelo cliente da conversa
- permitir atalho por caso quando necessario

## Documentos e contratos: integracao real

Esta e uma das partes mais importantes.

O operador precisa gerar contrato ou documento ali mesmo dentro da conversa.

### O WhatsApp deve permitir

- acessar templates cadastrados
- buscar template por nome e categoria
- abrir preview do template
- preencher variaveis do template
- gerar documento
- salvar documento gerado
- abrir documento gerado
- transformar documento em fluxo de assinatura

### Regras

- tudo em modal
- sem mandar o usuario para o modulo Documentos como fluxo principal
- aproveitar `DocumentsModule`, `documentTemplate.service` e `templateFill.service`
- manter vinculacao com cliente, processo ou requerimento

## Assinaturas: integracao total

Nao basta um botao "Solicitar assinatura".

### O WhatsApp deve permitir

- iniciar assinatura com documento ja gerado
- abrir modal com dados prefill do cliente
- acompanhar assinaturas pendentes
- abrir requisicao existente em modal
- copiar ou reenviar link
- registrar nota interna automatica quando houver disparo relevante

### Regras

- reutilizar `SignatureModule` com `prefillData` e `focusRequestId`
- abrir como workspace modal dentro do WhatsApp

## Requerimentos: integracao total

O WhatsApp precisa tratar requerimentos como caso de primeira classe.

### O modulo deve permitir

- criar requerimento em modal
- editar requerimento em modal
- ver detalhes em modal
- criar prazo vinculado ao requerimento
- criar compromisso vinculado ao requerimento
- abrir exigencia e pericia quando aplicavel

## Acoes rapidas obrigatorias

As acoes rapidas atuais devem virar gatilhos reais de workspace modal.

### Acoes minimas

- novo cliente
- editar cliente
- novo processo
- novo requerimento
- novo prazo
- novo compromisso
- gerar contrato
- solicitar assinatura
- novo lancamento financeiro
- solicitar documento

## Padrao de modal

Todos os modais do WhatsApp 360 devem seguir o mesmo comportamento.

### Regras obrigatorias

- fecha com `Esc`
- fecha no backdrop quando seguro
- nao perde a conversa ao fechar
- salva e atualiza o painel lateral sem recarregar o modulo inteiro
- permite abrir modal filho somente quando houver stack controlada
- nao deixa overlays presos
- deve existir padrao unico de header, footer e acoes

## Integracao tecnica desejada

### Camada de shell do WhatsApp

O modulo WhatsApp deve controlar:

- conversa selecionada
- cliente selecionado
- caso selecionado
- modal aberto
- payload de prefill
- refresh segmentado por dominio

### Tipos de modal a suportar

- `client_view`
- `client_edit`
- `client_create`
- `case_process_create`
- `case_process_edit`
- `case_requirement_create`
- `case_requirement_edit`
- `timeline_process`
- `deadline_create`
- `deadline_edit`
- `calendar_create`
- `calendar_edit`
- `financial_create`
- `financial_view`
- `financial_edit`
- `document_generate`
- `document_preview`
- `signature_create`
- `signature_view`

### Regra de refresh

Ao fechar um modal com sucesso:

- atualizar so os dados impactados
- nao recarregar toda a inbox
- manter scroll e selecao da conversa

## Mapa de reaproveitamento do CRM

### Reaproveitar diretamente

- `ProcessesModule`
- `RequirementsModule`
- `DeadlinesModule`
- `DeadlineFormModal`
- `CalendarModule`
- `FinancialModule`
- `DocumentsModule`
- `SignatureModule`
- `ProcessTimeline`
- `processTimelineService`

### Reaproveitar via servicos

- `processService`
- `requirementService`
- `deadlineService`
- `calendar.service`
- `financialService`
- `documentTemplate.service`
- `templateFill.service`
- `signatureService`

### Adaptacoes obrigatorias

- expor variantes embutiveis dos modulos que hoje assumem navegacao de pagina
- criar wrappers especificos para uso dentro do WhatsApp
- reduzir dependencias de hash navigation quando a acao vier do modal shell

## Itens que devem deixar de existir como fluxo padrao

- botao que so navega para outro modulo
- ver cadastro fora do WhatsApp como acao principal
- abrir financeiro fora do WhatsApp como acao principal
- timeline processual resumida como experiencia final
- painel lateral apenas informativo sem capacidade de acao

## Fases da implementacao

### Fase 1 - Fundacao do shell modal

- [ ] criar controlador central de `workspace modal` no WhatsApp
- [ ] padronizar abertura, fechamento e stack de overlays
- [ ] criar contrato unico de `prefill` e `onSaved`
- [ ] garantir refresh segmentado sem perder conversa

### Fase 2 - Cliente e casos

- [ ] transformar cliente em CRUD modal completo
- [ ] unificar `Casos` com processos e requerimentos
- [ ] abrir processo e requerimento em modal
- [ ] criar processo e requerimento em modal a partir da conversa

### Fase 3 - Timeline, prazos e agenda

- [ ] substituir timeline mini por abertura da timeline completa em modal
- [ ] integrar criacao e edicao de prazo em modal
- [ ] integrar criacao e edicao de compromisso em modal
- [ ] permitir criar prazo e compromisso a partir de caso e mensagem

### Fase 4 - Documentos, contratos e assinaturas

- [ ] abrir biblioteca de templates em modal
- [ ] permitir gerar contrato/documento na conversa
- [ ] salvar e listar documentos gerados no contexto do cliente/caso
- [ ] disparar assinatura em modal com fluxo completo

### Fase 5 - Financeiro e consolidacao 360

- [ ] integrar resumo financeiro real no lateral
- [ ] criar e editar acordo/lancamento em modal
- [ ] registrar pagamento em modal
- [ ] consolidar quick actions para abrir cada fluxo correto dentro do shell

## Criterios de aceite

Esta implementacao so sera considerada pronta quando:

- o operador conseguir atender sem sair do WhatsApp
- os modulos do CRM abrirem embutidos em modal a partir da conversa
- processos e requerimentos aparecerem como `Casos`
- a timeline processual completa abrir dentro do WhatsApp
- for possivel gerar contrato por template dentro da conversa
- for possivel iniciar assinatura sem sair da conversa
- for possivel criar cliente, processo, requerimento, prazo, compromisso e financeiro em modal
- o contexto lateral atualizar apos cada salvamento

## Regra final

O modulo WhatsApp nao pode mais ser tratado como inbox com widgets.

Ele deve virar a mesa central de operacao juridica do CRM.
