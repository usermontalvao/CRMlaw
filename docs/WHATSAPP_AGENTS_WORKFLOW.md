# WhatsApp Agents Workflow - Arquitetura Nativa no CRM

## Objetivo

Este documento define a arquitetura da camada de agentes, workflows e follow-up
como parte interna do CRM.

Decisao atual:

- o motor de workflow nao sera um projeto externo
- a camada nao dependera de MCP para operar
- o proprio CRM sera responsavel por persistencia, execucao e supervisao

O MCP pode existir no futuro como adaptador auxiliar, nunca como dependencia da
operacao principal.

## O que o projeto ja tem hoje

### Modulo operacional pronto

Ja existe no CRM:

- `WhatsAppModule` como inbox operacional
- `WaWorkspace` para acoes contextuais e integracao com outros modulos
- servicos de conversa, mensagens, automacao e client 360
- classificacao manual de assunto por IA
- mensagens agendadas
- fluxo de assinatura/preenchimento com acompanhamento por WhatsApp

### Fundacao tecnica ja criada

Ja existe no repositorio:

- tipos de dominio em `src/types/whatsapp.types.ts`
- nomes de tabelas em `src/services/whatsapp/shared.ts`
- migration inicial em `supabase/migrations/20260616150000_whatsapp_agents_workflow.sql`

Tabelas ja modeladas:

- `whatsapp_workflow_agents`
- `whatsapp_followup_policies`
- `whatsapp_followup_policy_steps`
- `whatsapp_workflows`
- `whatsapp_workflow_steps`
- `whatsapp_workflow_rules`
- `whatsapp_channel_workflows`
- `whatsapp_conversation_workflow_state`
- `whatsapp_workflow_transition_log`

Seeds ja previstos:

- politica `followup-padrao-campanha`
- agente `agente-atendimento-padrao`

### O que ainda nao apareceu no codigo

- executor de workflow
- scheduler geral dessa camada
- CRUD administrativo de workflows/agentes
- painel de estado do workflow por conversa
- simulador de regras

## Principio de arquitetura

O CRM sera dividido em duas faixas de responsabilidade.

### Faixa 1. Operacao de atendimento

Responsavel por:

- inbox
- conversa
- envio e recebimento
- anexos
- atribuicao
- transferencia
- encerramento
- notas e etiquetas
- painel 360

### Faixa 2. Orquestracao da conversa

Responsavel por:

- ligar canal a workflow
- definir etapa atual
- chamar agente quando necessario
- avaliar regras
- aplicar acoes
- agendar follow-up
- cancelar follow-up
- registrar transicoes
- abrir excecao ou handoff

Essas duas faixas convivem no CRM, mas nao devem ficar misturadas num unico
componente gigante.

## Modelo mental correto

Nao pensar em:

- "um bot solto por canal"

Pensar em:

- "um canal pode ter workflow padrao"
- "uma conversa pode carregar estado persistido"
- "uma etapa pode usar um agente"
- "a IA interpreta"
- "a regra estruturada decide"
- "o humano assume quando necessario"

## Hierarquia principal

1. Canal
2. Workflow
3. Etapa
4. Agente
5. Regra
6. Acao
7. Estado da conversa

## Conceitos

### Canal

Origem operacional da conversa.

Exemplos:

- campanha FGTS
- campanha BPC
- recepcao geral
- indicacoes

Cada canal pode apontar para um workflow padrao em
`whatsapp_channel_workflows`.

### Workflow

Fluxo de orquestracao da conversa.

Define:

- etapas
- regras
- criterios de transicao
- politica de follow-up
- pontos de handoff
- criterios de encerramento

Fonte de dados:

- `whatsapp_workflows`

### Etapa

Bloco operacional do workflow.

Exemplos:

- recepcao
- triagem
- qualificacao
- coleta_documentos
- envio_kit
- acompanhamento
- handoff_humano
- encerramento

Fonte de dados:

- `whatsapp_workflow_steps`

### Agente

Entidade de comportamento usada por uma etapa.

O agente:

- recebe contexto
- interpreta mensagens
- ajuda a coletar dados
- sugere ou produz resposta

O agente nao decide sozinho o fluxo.

Fonte de dados:

- `whatsapp_workflow_agents`

### Regra

Condicoes estruturadas avaliadas contra a conversa e o estado atual.

A regra:

- verifica contexto
- escolhe acao
- registra transicao

Fonte de dados:

- `whatsapp_workflow_rules`

### Acao

Resultado pratico de uma regra.

Acoes alvo da primeira fase:

- `go_to_step`
- `send_message`
- `schedule_followup`
- `cancel_followup`
- `set_subject`
- `set_department`
- `set_priority`
- `set_qualification`
- `handoff_human`
- `close_conversation`
- `raise_exception`

### Estado da conversa

Fonte unica da etapa atual da automacao.

Deve guardar pelo menos:

- workflow atual
- etapa atual
- agente atual
- assunto principal
- assuntos adicionais
- dados coletados
- documentos pendentes
- setor sugerido
- prioridade sugerida
- status de qualificacao
- follow-up ativo
- proximo follow-up
- ultima regra disparada
- resumo para handoff
- motivo de excecao

Fonte de dados:

- `whatsapp_conversation_workflow_state`

## Fluxo de execucao dentro do CRM

### Fluxo base

1. webhook recebe a mensagem
2. conversa e mensagem sao persistidas
3. modulo identifica o canal da conversa
4. sistema procura workflow padrao do canal
5. cria ou carrega estado da conversa
6. etapa atual fornece contexto para o agente
7. IA interpreta quando necessario
8. regras da etapa sao avaliadas
9. acao e executada
10. transicao e log sao persistidos
11. a UI do CRM reflete o novo estado

### Regra de seguranca

Se o workflow falhar:

- a conversa continua acessivel no fluxo manual
- o operador humano pode assumir
- o erro deve gerar log e, se necessario, excecao

## Integracao nativa com outros modulos

O valor dessa camada esta justamente em nascer dentro do CRM.

### Leads

O workflow deve conseguir:

- vincular lead existente
- criar lead quando a regra pedir
- atualizar qualificacao
- registrar desqualificacao
- refletir handoff comercial

### Clientes

O workflow deve conseguir:

- localizar cliente vinculado
- aproveitar historico
- atualizar contexto da conversa

### Processos, documentos e assinatura

O workflow deve conseguir:

- consultar processos e pendencias
- pedir documentos obrigatorios por etapa
- acompanhar kit/preenchimento
- acompanhar assinatura
- decidir follow-up baseado nesses estados

### Setores e usuarios

O workflow deve conseguir:

- sugerir setor
- transferir para setor
- transferir para usuario
- gerar resumo para o humano assumir

## Regras de produto

### 1. Atendimento manual nao pode depender do workflow

Obrigatorio:

- se a automacao estiver desligada, a inbox continua funcionando

### 2. Prompt nao pode ser a regra de negocio

Obrigatorio:

- prompt interpreta
- regra estruturada decide

### 3. Follow-up nao fica enterrado no prompt

Obrigatorio:

- follow-up deve ser politica configuravel

### 4. Etapa atual precisa ser persistida

Obrigatorio:

- refresh, troca de operador ou nova abertura nao podem reiniciar a conversa

### 5. Handoff e excecao precisam ser auditaveis

Obrigatorio:

- toda transicao relevante precisa gerar log

## Fases recomendadas

### Fase 1. Runtime minimo

Entregar:

- binding canal -> workflow
- inicializacao de estado por conversa
- carregamento de etapa atual
- executor simples de regra
- transicao de etapa
- log de transicao

### Fase 2. Follow-up nativo

Entregar:

- politicas reutilizaveis
- scheduler por horario comercial
- cancelamento por resposta
- contador de tentativas

### Fase 3. Integracao profunda com CRM

Entregar:

- qualificacao de lead
- handoff com resumo
- documentos obrigatorios por etapa
- leitura de assinatura/preenchimento
- prioridades e setores sugeridos

### Fase 4. Administracao

Entregar:

- CRUD de agentes
- CRUD de workflows
- CRUD de etapas e regras
- vinculacao canal -> workflow
- painel simples de estado da conversa

### Fase 5. Supervisao

Entregar:

- fila de excecao
- gargalos por etapa
- metricas por workflow
- simulador de fluxo

## MVP recomendado agora

Para esta decisao de internalizacao, o MVP mais pragmatico e:

1. um workflow padrao por canal
2. etapa persistida por conversa
3. regra simples de transicao
4. follow-up padrao 2h / 24h / 36h
5. handoff para humano/setor
6. resumo salvo no estado e no log

Isso ja resolve a maior parte do ganho operacional sem exigir builder visual na
primeira entrega.

## O que nao fazer

- nao criar projeto paralelo para rodar a operacao principal
- nao esconder regra critica em prompt solto
- nao acoplar tudo dentro de `WhatsAppModule.tsx`
- nao avancar para builder visual antes do runtime minimo existir

## Proxima ordem de execucao

1. consolidar documentacao alinhada ao CRM
2. criar servico de workflow no app
3. criar bootstrap de estado por conversa
4. implementar executor minimo de regra
5. implementar follow-up nativo
6. integrar com leads e handoff
7. abrir UI administrativa

## Resumo

A base de dados e de tipos ja existe. O que falta agora nao e "pensar um sistema
externo", e sim ligar essa fundacao ao runtime do proprio CRM.

Resumo da direcao:

- canal recebe
- CRM persiste
- workflow organiza
- agente interpreta
- regra decide
- follow-up insiste
- humano assume quando necessario
