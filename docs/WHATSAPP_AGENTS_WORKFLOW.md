# WhatsApp Agents Workflow - Arquitetura Nativa no CRM

## Objetivo

Este documento define como a camada de agentes, workflows e follow-up deve
rodar dentro do CRM sem gerar fragilidade operacional.

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

## Regras operacionais obrigatorias

Estas regras existem para evitar os problemas classicos de automacao:
duplicidade, loop, corrida entre eventos, perda de contexto e follow-up
indevido.

### 1. O workflow nunca pode ser a unica porta de entrada

Obrigatorio:

- a conversa deve ser persistida antes de qualquer automacao
- se o runtime falhar, a inbox humana continua disponivel
- falha de automacao nunca pode impedir leitura, resposta, transferencia ou encerramento

### 2. Uma conversa so pode ter um executor por vez

Obrigatorio:

- usar processamento serial por `conversation_id`
- evitar dois eventos competindo para trocar a etapa ao mesmo tempo
- se chegar nova mensagem durante execucao, enfileirar reavaliacao

Sem isso, duas regras podem disparar em paralelo e gravar estados
inconsistentes.

### 3. Toda execucao precisa ser idempotente

Obrigatorio:

- o mesmo evento recebido duas vezes nao pode duplicar transicao
- o mesmo follow-up nao pode ser agendado duas vezes para a mesma etapa
- envio automatico precisa checar se ja existe log/efeito equivalente

O webhook da Evolution e reprocessamentos internos podem repetir eventos.

### 4. Prompt interpreta, regra decide

Obrigatorio:

- IA pode classificar, resumir, extrair dados e sugerir resposta
- IA nao pode escolher sozinha transferencia, encerramento ou qualificacao final
- decisao critica precisa virar estado estruturado ou condicao verificavel

### 5. Toda mudanca de etapa precisa deixar trilha auditavel

Obrigatorio:

- registrar etapa anterior
- registrar etapa nova
- registrar regra disparada
- registrar acao executada
- registrar ator `system`, `agent` ou `user`

Sem isso, o time nao consegue explicar porque a conversa foi movida.

### 6. Follow-up precisa ser cancelavel por estado real

Obrigatorio:

- cancelar por resposta do cliente
- cancelar por handoff humano
- cancelar por encerramento
- cancelar por opt-out
- cancelar por desqualificacao quando a politica pedir

Nao pode depender apenas do texto do prompt para parar insistencia.

### 7. Handoff congela a automacao ate nova decisao

Obrigatorio:

- conversa em handoff nao continua disparando auto-resposta
- workflow so retoma se houver acao humana explicita ou regra segura de retomada
- follow-up automatico deve ser removido ao entrar em handoff

### 8. Excecao precisa parar o fluxo, nao esconder erro

Obrigatorio:

- erro de regra, falta de contexto ou acao invalida deve marcar excecao
- excecao precisa ficar visivel para supervisao
- excecao nao pode reprocessar em loop cego

## Fluxo de execucao dentro do CRM

### Fluxo base seguro

1. webhook recebe a mensagem
2. conversa e mensagem sao persistidas
3. sistema registra um evento interno processavel
4. o runtime carrega o binding do canal
5. cria ou carrega `whatsapp_conversation_workflow_state`
6. adquire exclusao logica por conversa
7. avalia etapa atual e contexto
8. chama IA apenas se a etapa exigir interpretacao
9. converte resultado em dados estruturados
10. avalia regras da etapa em ordem de prioridade
11. executa no maximo uma transicao por ciclo
12. persiste estado final e `whatsapp_workflow_transition_log`
13. libera a conversa para o proximo ciclo

### Regra de seguranca

Se o workflow falhar:

- a conversa continua acessivel no fluxo manual
- o operador humano pode assumir
- o erro deve gerar log e, se necessario, excecao
- o sistema nao deve ficar reexecutando a mesma falha infinitamente

## Modelo de avaliacao de regras

Para evitar comportamento imprevisivel, a avaliacao precisa ser simples.

### Ordem recomendada

1. carregar etapa atual
2. buscar regras ativas da etapa ordenadas por prioridade
3. avaliar cada regra com `match_mode`
4. executar a primeira regra valida
5. encerrar o ciclo se `stop_on_match = true`
6. se nenhuma regra casar, manter etapa e registrar ausencia de transicao quando necessario

### Regras praticas

- uma etapa nao deve executar varias transicoes contraditorias no mesmo ciclo
- `else_action` so deve existir quando a ausencia de match exigir efeito explicito
- regra de timeout deve rodar em job separado, nao no mesmo fluxo do inbound
- regra de documentos deve depender de sinal estruturado, nao de texto livre

## Guardrails por tipo de acao

### `go_to_step`

- validar se a etapa destino pertence ao mesmo workflow
- impedir salto para etapa inexistente
- impedir loop imediato `A -> A`

### `send_message`

- nao enviar se a conversa estiver `handed_off`, `paused`, `cancelled` ou `completed`
- evitar disparo repetido da mesma mensagem no mesmo contexto
- se falhar o envio, nao avancar etapa silenciosamente

### `schedule_followup`

- manter no maximo um follow-up ativo por conversa/etapa/politica
- salvar horario calculado, tentativa atual e politica aplicada
- respeitar timezone e horario comercial do canal

### `cancel_followup`

- ser idempotente
- limpar politica ativa, passo ativo e proximo disparo

### `handoff_human`

- gravar usuario ou setor alvo
- salvar resumo da conversa
- marcar estado como `handed_off`
- cancelar follow-up ativo

### `close_conversation`

- so permitir quando a etapa suportar encerramento
- registrar motivo estruturado
- impedir autoencerramento silencioso sem log

### `raise_exception`

- registrar causa tecnica e causa funcional
- bloquear retry automatico imediato
- deixar a conversa governavel pelo humano

## Retomada e reentrada

Esta e a parte que mais costuma gerar erro em producao.

### Quando o cliente responde durante follow-up

- cancelar follow-up pendente
- atualizar `last_customer_reply_at`
- reavaliar a etapa atual
- nao reiniciar workflow do zero sem regra explicita

### Quando o humano responde

- atualizar `last_agent_action_at`
- se estiver em handoff, manter automacao pausada
- se o humano sinalizar retomada automatica, registrar a retomada antes de reprocessar

### Quando a conversa ja estava encerrada

- primeiro aplicar a regra operacional do modulo para reabertura
- so depois decidir se o workflow volta a atuar
- se reabrir, retomar da etapa definida para retomada, nao necessariamente da etapa inicial

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
- trava por conversa
- idempotencia basica por evento

### Fase 2. Follow-up nativo

Entregar:

- politicas reutilizaveis
- scheduler por horario comercial
- cancelamento por resposta
- contador de tentativas
- deduplicacao por politica/etapa

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
- trilha de auditoria filtravel

## MVP recomendado agora

Para esta decisao de internalizacao, o MVP mais pragmatico e seguro e:

1. um workflow padrao por canal
2. etapa persistida por conversa
3. regra simples de transicao
4. follow-up padrao 2h / 24h / 36h
5. handoff para humano/setor
6. resumo salvo no estado e no log
7. trava por conversa
8. deduplicacao de evento

Isso resolve a maior parte do ganho operacional sem exigir builder visual na
primeira entrega.

## O que nao fazer

- nao criar projeto paralelo para rodar a operacao principal
- nao esconder regra critica em prompt solto
- nao acoplar tudo dentro de `WhatsAppModule.tsx`
- nao avancar para builder visual antes do runtime minimo existir
- nao permitir multiplas transicoes automaticas concorrentes na mesma conversa
- nao deixar follow-up sobreviver a handoff, resposta ou encerramento

## Proxima ordem de execucao

1. consolidar documentacao alinhada ao CRM
2. criar servico de workflow no app
3. criar bootstrap de estado por conversa
4. implementar exclusao logica por conversa
5. implementar executor minimo de regra
6. implementar log de transicao e deduplicacao
7. implementar follow-up nativo
8. integrar com leads e handoff
9. abrir UI administrativa

## Resumo

A base de dados e de tipos ja existe. O que falta agora nao e pensar um sistema
externo, e sim ligar essa fundacao ao runtime do proprio CRM com guardrails de
producao desde o inicio.

Resumo da direcao:

- canal recebe
- CRM persiste
- workflow organiza
- agente interpreta
- regra decide
- follow-up insiste
- humano assume quando necessario
- log explica o que aconteceu
