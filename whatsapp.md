# Modulo WhatsApp - Plano Operacional no CRM

Este arquivo passa a refletir a decisao atual do projeto:

- o atendimento continua no `WhatsAppModule` do CRM
- agentes, workflows, follow-up e handoff passam a viver no proprio CRM
- nao vamos depender de projeto externo por MCP para a operacao principal

O objetivo deste documento e servir como backlog executavel e criterio de verdade
para a evolucao do modulo.

## Decisao registrada

Direcao escolhida:

- [x] integrar atendimento, workflow e automacao diretamente no CRM
- [x] manter o `WhatsAppModule` como cockpit principal da operacao
- [x] reutilizar a base de dados, tipos e servicos ja criados no repositorio
- [x] evitar uma segunda aplicacao para governar agentes e follow-up
- [x] manter integracao com Evolution API como gateway de mensageria
- [x] manter leads, clientes, processos, documentos e assinatura como contexto nativo do fluxo

Direcao descartada:

- [x] nao seguir com projeto externo como dependencia principal de atendimento
- [x] nao depender de MCP para a logica central do modulo

## Varredura real do projeto

Antes de planejar novas etapas, foi feita uma varredura no codigo e na base de
documentacao do repositorio.

### Arquivos e modulos encontrados

- `src/components/WhatsAppModule.tsx`
- `src/components/WaWorkspace.tsx`
- `src/services/whatsapp/*`
- `src/types/whatsapp.types.ts`
- `supabase/migrations/20260616150000_whatsapp_agents_workflow.sql`
- `docs/WHATSAPP_MODULE_MVP.md`
- `docs/WHATSAPP_AGENTS_WORKFLOW.md`
- `whatsapp.md`

### Estado atual confirmado no codigo

#### 1. Operacao manual do modulo

Status: `EXISTE`

Base confirmada:

- inbox de conversas
- atribuicao e transferencia
- fila por setor
- bloqueio, encerramento e reabertura
- notas internas
- etiquetas
- mensagens de texto e midia
- mensagens agendadas
- painel 360 com cliente, processos, agenda, documentos e assinatura
- classificacao manual de assunto por IA
- sessao de IA assistida

#### 2. Fundacao de workflow/agentes no CRM

Status: `PARCIAL`

Base confirmada:

- tipos TypeScript para agentes, workflows, etapas, regras e estado persistido
- constantes de tabelas no servico WhatsApp
- migration criando:
  - `whatsapp_workflow_agents`
  - `whatsapp_followup_policies`
  - `whatsapp_followup_policy_steps`
  - `whatsapp_workflows`
  - `whatsapp_workflow_steps`
  - `whatsapp_workflow_rules`
  - `whatsapp_channel_workflows`
  - `whatsapp_conversation_workflow_state`
  - `whatsapp_workflow_transition_log`
- seed inicial de politica padrao de follow-up
- seed inicial de agente de atendimento padrao

Limite atual:

- nao foi encontrado executor real de workflow
- nao foi encontrado scheduler operacional dessa nova camada
- nao foi encontrada UI administrativa para editar agentes/workflows
- nao foi encontrado binding real canal -> workflow em execucao

#### 3. Follow-up automatico de assinatura/preenchimento

Status: `EXISTE`

Base confirmada:

- rastreamento de abertura, abandono e assinatura
- servicos e automacoes de acompanhamento ja integrados ao CRM
- pausa manual de acompanhamento

Limite atual:

- isso existe para fluxos especificos de assinatura/preenchimento
- ainda nao existe motor geral de follow-up por etapa de workflow

#### 4. Documentacao do repositorio

Status: `PARCIAL`

Situacao encontrada:

- existe documentacao do modulo operacional
- existe documentacao de workflows/agentes assumindo projeto externo
- o codigo mais recente ja aponta para internalizacao dessa camada no CRM

Conclusao:

- a documentacao estava desalinhada com a decisao atual

## Regra de arquitetura

O CRM passa a concentrar estas responsabilidades:

- canal e inbox de atendimento
- persistencia de conversa e mensagens
- estado operacional da conversa
- estado persistido do workflow
- regras estruturadas de transicao
- follow-up progressivo
- handoff para humano, setor ou fila
- integracao com leads, clientes, processos, documentos e assinatura
- auditoria operacional e de workflow

### Separacao interna de responsabilidades

Mesmo dentro do CRM, nao misturar tudo em `WhatsAppModule.tsx`.

Camadas desejadas:

1. `WhatsAppModule`
   - cockpit operacional do atendente
   - lista de conversas, timeline, composer, painel 360

2. servicos de canal
   - Evolution webhook
   - envio/recebimento
   - anexos
   - presenca

3. servicos de workflow
   - carregar binding do canal
   - iniciar workflow
   - persistir etapa atual
   - avaliar regras
   - executar acoes
   - agendar/cancelar follow-up

4. administracao de automacao
   - CRUD de agentes
   - CRUD de workflows
   - CRUD de etapas e regras
   - politicas de follow-up
   - ligacao canal -> workflow

5. supervisao
   - excecoes
   - transicoes
   - taxa por etapa
   - filas travadas

## Logica funcional que vamos implementar

### Modelo mental correto

Pensar assim:

- cada canal pode ter um workflow padrao
- cada conversa pode carregar estado proprio de workflow
- cada workflow tem etapas
- cada etapa pode usar agente, regra e follow-up
- a IA ajuda a interpretar
- a regra estruturada decide a transicao
- o humano assume quando houver handoff, excecao ou aprovacao necessaria

### Fluxo base da conversa

1. mensagem entra pela Evolution
2. webhook persiste conversa/mensagem no CRM
3. sistema identifica canal e procura workflow padrao
4. se houver workflow ativo para o canal:
   - cria ou atualiza `whatsapp_conversation_workflow_state`
   - define etapa atual
   - roda classificacao/interpretacao quando necessario
   - avalia regras da etapa
   - executa acao resultante
5. se nao houver workflow:
   - conversa segue fluxo manual normal do modulo
6. operador humano pode assumir, pausar, transferir ou encerrar a qualquer momento

### Principios obrigatorios

- a conversa manual nunca pode quebrar porque o workflow falhou
- workflow deve ser opt-in por canal
- etapa atual precisa ser persistida
- follow-up precisa ser cancelavel por resposta, opt-out, encerramento ou handoff
- acoes automaticas precisam gerar log auditavel
- prompts nao podem ser a unica fonte da logica

## Frentes de implementacao

### Frente 1 - Documentacao alinhada ao CRM

- [x] reescrever `whatsapp.md` para a estrategia nativa
- [x] reescrever `docs/WHATSAPP_AGENTS_WORKFLOW.md` para remover dependencia externa
- [ ] revisar `README.md` para refletir o estado real do CRM e do modulo WhatsApp
- [ ] revisar changelog/guia interno se necessario

#### Concluido quando

- nao houver mais documento orientando o time a construir a camada principal fora do CRM

### Frente 2 - Fundacao de dominio

- [x] tipos TypeScript de workflow/agentes existentes
- [x] migration inicial das tabelas existente
- [ ] criar servico `workflow` no frontend com leitura/escrita dessas tabelas
- [ ] criar mapeadores e validadores de regra/acao/etapa
- [ ] criar bootstrap para iniciar estado de workflow por conversa
- [ ] criar binding real de canal -> workflow em runtime

#### Concluido quando

- o CRM consegue carregar e persistir um workflow real por conversa, sem UI visual ainda

### Frente 3 - Motor operacional

- [ ] criar executor de regras
- [ ] criar maquina simples de estados da conversa no workflow
- [ ] persistir transicoes em `whatsapp_workflow_transition_log`
- [ ] implementar acoes:
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
- [ ] bloquear loops obvios e retries cegos

#### Concluido quando

- uma conversa entra, percorre etapas e deixa rastro auditavel sem depender de intervencao manual em cada transicao

### Frente 4 - Follow-up nativo do workflow

- [ ] reaproveitar a experiencia ja existente de agendamento no modulo
- [ ] implementar politica de follow-up por workflow/etapa
- [ ] respeitar timezone e horario comercial do canal
- [ ] cancelar follow-up por resposta, opt-out, encerramento e handoff
- [ ] registrar tentativas e proximo disparo em `whatsapp_conversation_workflow_state`

#### Concluido quando

- o CRM tiver um motor geral de follow-up, nao apenas automacoes pontuais de assinatura

### Frente 5 - Integracao nativa com CRM

- [ ] integrar workflow com `LeadsModule`
- [ ] vincular qualificacao/desqualificacao ao lead quando existir
- [ ] permitir criar lead automaticamente conforme regra do canal
- [ ] usar cliente, processo, requerimento, documentos e assinatura como contexto de etapa
- [ ] permitir handoff para usuario ou setor do proprio CRM

#### Concluido quando

- a automacao deixa de ser um fluxo isolado e passa a usar o contexto juridico/comercial do CRM

### Frente 6 - UI administrativa

- [ ] criar area de configuracao para agentes
- [ ] criar area de configuracao para workflows
- [ ] criar editor de etapas e regras
- [ ] criar configuracao visual de documentos obrigatorios
- [ ] criar configuracao de politicas de follow-up
- [ ] criar vinculo canal -> workflow

#### Concluido quando

- a equipe consegue configurar a automacao sem editar SQL ou JSON manualmente

### Frente 7 - Supervisao e excecao

- [ ] criar painel de estado do workflow por conversa
- [ ] criar fila de excecao
- [ ] exibir motivo da excecao
- [ ] exibir ultima regra disparada
- [ ] exibir etapa atual e proximos follow-ups
- [ ] permitir pausa, retomada e handoff manual

#### Concluido quando

- a operacao consegue governar automacao em producao sem depender de consulta direta ao banco

## Ordem recomendada

### Sprint 1

- [x] alinhar documentacao
- [ ] criar servico de workflow
- [ ] criar bootstrap de estado por conversa
- [ ] carregar binding canal -> workflow

### Sprint 2

- [ ] implementar executor minimo de regras
- [ ] implementar transicao de etapa
- [ ] registrar logs de transicao
- [ ] implementar `send_message` e `handoff_human`

### Sprint 3

- [ ] implementar follow-up nativo
- [ ] cancelar follow-up por resposta
- [ ] integrar com setor, prioridade e qualificacao
- [ ] criar painel simples de estado da conversa

### Sprint 4

- [ ] integrar com leads
- [ ] criar CRUD administrativo de agentes/workflows
- [ ] criar fila de excecao
- [ ] fechar lacunas operacionais e testes

## Regras para marcar como concluido

- [ ] so marcar `[x]` com implementacao real no codigo
- [ ] so marcar `[x]` com fluxo manualmente validado
- [ ] se houver apenas tabela/tipo sem runtime, manter como `PARCIAL`
- [ ] se houver bloqueio, anotar no item correspondente

## Definicao de pronto

Esta frente estara madura quando:

- o atendimento manual continuar estavel
- cada canal puder apontar para um workflow interno do CRM
- a conversa tiver etapa persistida
- regras e follow-up rodarem no proprio CRM
- handoff para humano/setor funcionar sem gambiarra
- leads e contexto juridico forem reaproveitados
- a operacao conseguir supervisionar excecoes e logs

Enquanto isso nao estiver entregue, a fundacao existe, mas a orquestracao ainda
nao esta operacional.
