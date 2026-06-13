# Modulo Comercial de Leads

## Objetivo

Este documento define como evoluir o modulo de `Leads` do CRM para uma esteira comercial completa, inspirada no que o Perfex faz bem, mas adaptada ao contexto juridico do sistema atual.

A meta nao e apenas cadastrar leads. A meta e controlar o fluxo completo:

`lead -> atendimento inicial -> qualificacao -> proposta -> contrato -> assinatura -> cobranca -> cliente ativo`

Isso transforma o CRM em uma maquina de aquisicao, conversao e retencao.

## Contexto atual do CRM

Hoje o sistema ja possui boa base para isso:

- `leads` com estagios simples
- `clientes`
- `documentos`
- `assinaturas`
- `financeiro`
- `agenda`
- `tarefas`
- `chat`
- `portal`

Pontos fortes atuais:

- O juridico ja esta forte.
- O portal do cliente ja existe.
- O financeiro ja trabalha com acordos e parcelas.
- O sistema ja possui configuracoes, permissoes e notificacoes.

Gargalo atual:

- Falta a camada comercial entre o lead e o cliente.
- Falta proposta formal.
- Falta contrato comercial conectado ao fluxo.
- Falta intake publico estruturado.
- Falta pipeline com SLA, follow-up e metricas de conversao.

## Visao do modulo

O novo modulo deve cobrir 7 blocos:

1. Captura de lead
2. Qualificacao
3. Pipeline comercial
4. Propostas
5. Contratos comerciais
6. Conversao para cliente
7. Cobranca e onboarding

## Resultado esperado

Ao final, o escritorio deve conseguir:

- receber lead pelo site, formulario ou atendimento manual
- classificar area, urgencia e potencial comercial
- acompanhar o lead em um funil real
- registrar contatos, tarefas e proximos passos
- gerar proposta com honorarios
- converter proposta em contrato
- enviar contrato para assinatura
- gerar cobranca inicial ou parcelamento
- converter automaticamente em cliente ativo
- iniciar onboarding juridico sem retrabalho

## Diferenca entre o modelo atual e o modelo desejado

### Modelo atual

- lead com poucos campos
- conversao simples para cliente
- sem proposta
- sem historico comercial estruturado
- sem intake publico inteligente

### Modelo desejado

- lead com origem, responsavel, area juridica, score e prioridade
- pipeline comercial configuravel
- atividades comerciais e agenda de follow-up
- proposta com status e versoes
- contrato ligado a proposta
- assinatura integrada
- cobranca inicial integrada ao financeiro
- metricas completas de conversao

## Escopo funcional

### 1. Cadastro de lead reforcado

Expandir a tabela atual de leads para suportar:

- nome
- email
- telefone
- whatsapp
- cpf ou cnpj opcional
- origem
- campanha
- area juridica de interesse
- tipo de caso
- resumo do problema
- urgencia
- cidade
- estado
- faixa de valor estimada
- score comercial
- responsavel
- data do proximo contato
- motivo de perda
- status de conversao

Campos sugeridos:

```sql
alter table leads
  add column if not exists whatsapp text,
  add column if not exists cpf_cnpj text,
  add column if not exists campaign text,
  add column if not exists legal_area text,
  add column if not exists case_type text,
  add column if not exists summary text,
  add column if not exists urgency text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists estimated_value numeric(12,2),
  add column if not exists score integer default 0,
  add column if not exists owner_user_id uuid,
  add column if not exists next_contact_at timestamptz,
  add column if not exists lost_reason text,
  add column if not exists archived_at timestamptz;
```

### 2. Estagios do pipeline

O funil atual e muito curto. Recomenda-se trocar por algo mais comercial:

1. `novo`
2. `primeiro_contato`
3. `triagem`
4. `aguardando_documentos`
5. `reuniao_agendada`
6. `proposta_enviada`
7. `negociacao`
8. `contrato_enviado`
9. `convertido`
10. `perdido`

Observacoes:

- `convertido` encerra o lead e aponta para `client_id`.
- `perdido` exige motivo de perda.
- cada movimentacao deve gerar historico.

### 3. Historico comercial

Criar tabela para registrar tudo que acontece com o lead.

Tabela sugerida: `lead_activities`

Campos:

- `id`
- `lead_id`
- `activity_type`
- `description`
- `metadata jsonb`
- `created_by`
- `created_at`

Tipos de atividade:

- `created`
- `stage_changed`
- `note_added`
- `call_made`
- `whatsapp_sent`
- `email_sent`
- `meeting_scheduled`
- `proposal_created`
- `proposal_sent`
- `proposal_viewed`
- `proposal_accepted`
- `proposal_rejected`
- `contract_created`
- `contract_sent`
- `contract_signed`
- `payment_created`
- `converted`
- `lost`

Tabela sugerida:

```sql
create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  activity_type text not null,
  description text not null,
  metadata jsonb default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
```

### 4. Tarefas e follow-up comercial

Todo lead deve ter proximo passo claro.

Criar tabela: `lead_tasks`

Campos:

- `lead_id`
- `title`
- `description`
- `due_at`
- `priority`
- `assigned_to`
- `status`
- `completed_at`

Usos:

- retornar ligacao
- cobrar documentos
- enviar proposta
- confirmar reuniao
- cobrar assinatura

Regras:

- lead sem proximo contato fica sinalizado no dashboard
- tarefa vencida gera alerta
- responsavel recebe notificacao

### 5. Intake publico

Criar formulario publico para captacao de leads, inspirado no `estimate_request` do Perfex, mas juridico.

Objetivo:

- transformar visitante em lead qualificado
- coletar documentos iniciais
- diminuir retrabalho do atendimento

Campos recomendados:

- nome
- telefone
- email
- cidade e estado
- area do problema
- resumo do caso
- existe processo em andamento
- numero do processo se houver
- anexos
- melhor horario para contato
- termo LGPD

Tabela sugerida: `lead_intake_requests`

Campos:

- `id`
- `name`
- `email`
- `phone`
- `legal_area`
- `summary`
- `has_process`
- `process_number`
- `attachments`
- `preferred_contact_time`
- `status`
- `converted_lead_id`
- `created_at`

Fluxo:

1. visitante envia formulario
2. sistema cria `lead_intake_request`
3. sistema cria `lead`
4. sistema classifica score inicial
5. sistema atribui responsavel
6. sistema gera tarefa de primeiro contato

### 6. Propostas comerciais

Criar modulo novo: `Propostas`

Tabela: `lead_proposals`

Campos:

- `id`
- `lead_id`
- `client_id` opcional
- `proposal_number`
- `title`
- `description`
- `legal_area`
- `services_scope`
- `price_model`
- `entry_value`
- `total_value`
- `installments_count`
- `installment_value`
- `valid_until`
- `status`
- `version`
- `pdf_path`
- `public_token`
- `sent_at`
- `viewed_at`
- `accepted_at`
- `rejected_at`
- `rejection_reason`
- `created_by`
- `created_at`
- `updated_at`

Status recomendados:

- `draft`
- `sent`
- `viewed`
- `negotiating`
- `accepted`
- `rejected`
- `expired`
- `converted_to_contract`

O que a proposta precisa ter:

- identificacao do escritorio
- dados do potencial cliente
- descricao do servico
- honorarios
- forma de pagamento
- vigencia da proposta
- clausulas comerciais basicas
- CTA para aceitar

Recursos importantes:

- gerar PDF
- link publico para visualizacao
- aceite digital simples
- duplicar proposta
- versionamento

### 7. Contratos comerciais

Criar modulo novo: `Contratos Comerciais`

Pode reaproveitar a base de `documentos` e `assinaturas`, mas precisa de camada comercial propria.

Tabela: `commercial_contracts`

Campos:

- `id`
- `lead_id`
- `client_id`
- `proposal_id`
- `template_id`
- `title`
- `status`
- `contract_value`
- `payment_type`
- `installments_count`
- `first_due_date`
- `signature_request_id`
- `signed_at`
- `effective_date`
- `expires_at`
- `created_by`
- `created_at`
- `updated_at`

Status:

- `draft`
- `generated`
- `sent_for_signature`
- `partially_signed`
- `signed`
- `cancelled`

Fluxo:

1. proposta aceita
2. gerar contrato a partir de template
3. preencher placeholders com dados do lead
4. enviar para assinatura
5. ao assinar, criar acordo financeiro
6. converter lead em cliente

### 8. Conversao automatica para cliente

Hoje a conversao existe, mas e simples. Ela deve virar um wizard.

Fluxo de conversao recomendado:

1. escolher se vai converter agora ou apos assinatura
2. revisar dados pessoais
3. revisar area juridica e tags
4. criar cliente
5. opcionalmente criar processo ou requerimento
6. opcionalmente criar pasta no cloud
7. opcionalmente liberar portal
8. opcionalmente criar acordo financeiro

Regras:

- nunca perder o vinculo historico entre lead e cliente
- toda conversao deve gerar atividade
- se ja houver cliente duplicado, oferecer merge

### 9. Integracao com financeiro

A melhor oportunidade no seu CRM e ligar o fluxo comercial ao modulo financeiro atual.

Depois do contrato assinado:

- criar `agreement` automaticamente
- copiar valores da proposta ou contrato
- gerar parcelas
- agendar primeira cobranca
- gerar notificacao

Mapeamento sugerido:

- `proposal.total_value` -> `agreement.total_value`
- `proposal.installments_count` -> `agreement.installments_count`
- `proposal.installment_value` -> `agreement.installment_value`
- `contract.payment_type` -> `agreement.payment_type`

### 10. Integracao com assinatura

Voce ja possui uma base forte aqui. O ideal e nao reinventar.

O contrato comercial deve:

- usar template existente
- enviar pela infraestrutura de assinatura atual
- registrar `signature_request_id`
- escutar evento de assinatura concluida
- disparar automacoes de conversao

Evento principal:

- `contract_signed`

Ao ocorrer:

- atualizar contrato
- atualizar lead
- criar cliente se necessario
- criar acordo financeiro
- criar onboarding

### 11. Integracao com agenda e tarefas

Toda etapa comercial importante deve poder gerar:

- tarefa
- evento de agenda
- lembrete

Exemplos:

- reuniao inicial
- prazo para envio de documentos
- follow-up de proposta
- retorno apos visualizacao da proposta
- cobranca de assinatura pendente

### 12. Integracao com portal

Nao liberar o portal para todo lead.

Regra recomendada:

- portal e liberado apenas apos conversao em cliente
- antes disso, o lead pode acessar apenas pagina publica de proposta ou assinatura

Paginas publicas recomendadas:

- visualizacao de proposta
- aceite de proposta
- envio de documentos iniciais
- assinatura de contrato

## Estrutura de tabelas sugerida

### Novas tabelas

- `lead_activities`
- `lead_tasks`
- `lead_intake_requests`
- `lead_proposals`
- `lead_proposal_items`
- `commercial_contracts`
- `lead_loss_reasons` opcional
- `lead_tags` opcional
- `lead_tag_relations` opcional

### Tabelas existentes que vao integrar

- `leads`
- `clients`
- `agreements`
- `installments`
- `signature_requests`
- tabelas de notificacao

## Campos de configuracao recomendados

Adicionar no modulo de configuracoes:

- estagios do pipeline
- cores por estagio
- origens de lead
- areas juridicas
- motivos de perda
- templates de proposta
- templates de contrato
- SLA de primeiro contato
- regra de distribuicao de leads
- score minimo para destaque

## SLA e automacoes

### SLA comercial

Definir pelo menos:

- primeiro contato em ate `15 min`, `1 h` ou `24 h`
- proposta enviada em ate `X` dias apos qualificacao
- follow-up automatico se proposta nao for vista
- follow-up automatico se proposta for vista e nao respondida

### Automacoes recomendadas

1. Lead novo:
   criar tarefa de primeiro contato

2. Lead sem responsavel:
   atribuir automaticamente por fila ou round-robin

3. Lead parado:
   alertar responsavel e administrador

4. Proposta enviada:
   agendar follow-up automatico

5. Proposta aceita:
   gerar contrato

6. Contrato assinado:
   criar cliente e financeiro

7. Lead perdido:
   exigir motivo e salvar inteligencia comercial

## Score comercial

Criar score simples de 0 a 100.

Sugestao de composicao:

- origem quente: +20
- enviou documentos: +20
- atendeu contato: +15
- marcou reuniao: +20
- abriu proposta: +10
- aceitou condicoes: +15

Score ajuda a:

- priorizar atendimento
- organizar dashboard
- alimentar metricas

## Permissoes

Criar ou ajustar permissoes para:

- visualizar leads
- criar leads
- editar leads
- excluir leads
- mover estagio
- visualizar propostas
- criar propostas
- aprovar proposta
- gerar contrato
- converter lead
- ver metricas comerciais

Separacao recomendada:

- `administrador`
- `socio`
- `advogado`
- `auxiliar comercial`
- `estagiario`

## Telas recomendadas

### 1. Pipeline de leads

Vista kanban com:

- colunas por estagio
- cards com nome, origem, area, score, proximo contato
- filtros por responsavel, origem, area, periodo

### 2. Lista tabular

Para operacao pesada:

- ordenacao
- filtros salvos
- exportacao
- acoes em lote

### 3. Detalhe do lead

A tela deve reunir tudo:

- dados cadastrais
- timeline comercial
- notas
- tarefas
- reunioes
- documentos enviados
- propostas
- contratos
- historico de conversao

### 4. Intake publico

Formulario elegante, objetivo e responsivo.

### 5. Gestao de propostas

Lista com:

- rascunhos
- enviadas
- vistas
- aceitas
- vencidas

### 6. Gestao de contratos

Lista com:

- gerados
- aguardando assinatura
- assinados
- cancelados

### 7. Dashboard comercial

KPIs principais:

- leads por periodo
- leads por origem
- taxa de resposta
- taxa de qualificacao
- taxa de envio de proposta
- taxa de aceite
- taxa de conversao em cliente
- tempo medio ate conversao
- ticket medio contratado
- perdas por motivo

## KPIs obrigatorios

O modulo precisa medir:

- total de leads no periodo
- leads por origem
- leads por area juridica
- tempo medio do primeiro contato
- taxa de leads qualificados
- taxa de propostas enviadas
- taxa de propostas aceitas
- taxa de conversao final
- valor total proposto
- valor total convertido
- ticket medio
- principais motivos de perda

## Relatorios recomendados

1. Conversao por origem
2. Conversao por responsavel
3. Conversao por area juridica
4. Propostas por status
5. Contratos por status
6. Receita prevista por propostas aceitas
7. Receita efetivada por contratos assinados
8. Leads perdidos por motivo

## Regras de negocio importantes

### Duplicidade

Ao criar lead novo, verificar duplicidade por:

- telefone
- email
- cpf_cnpj

Se houver duplicidade:

- avisar
- permitir atualizar lead existente
- permitir forcar cadastro

### Motivo de perda obrigatorio

Se lead for movido para `perdido`, exigir:

- motivo padrao
- observacao opcional

Motivos sugeridos:

- sem interesse
- sem retorno
- sem capacidade financeira
- fechou com concorrente
- caso fora de escopo
- conflito de interesse
- documentacao insuficiente

### Conversao protegida

Nao converter lead automaticamente sem revisao se faltarem:

- nome
- telefone ou email
- area juridica

### Proposta nao pode ser editada apos aceite

Ao aceitar:

- congelar versao
- criar nova versao se precisar renegociar

## Estrategia tecnica no sistema atual

### Frontend

Ajustar:

- `src/types/lead.types.ts`
- `src/services/lead.service.ts`
- `src/components/LeadsModule.tsx`

Criar:

- `src/types/proposal.types.ts`
- `src/services/proposal.service.ts`
- `src/components/ProposalsModule.tsx`
- `src/types/commercialContract.types.ts`
- `src/services/commercialContract.service.ts`
- `src/components/CommercialContractsModule.tsx`
- `src/components/LeadDetailsTimeline.tsx`
- `src/components/LeadIntakePublicPage.tsx`

Integrar com:

- `FinancialModule`
- `SignatureModule`
- `SettingsModule`
- `CalendarModule`
- `TasksModule`

### Backend Supabase

Criar:

- migrations SQL
- RLS
- indexes
- funcoes RPC para conversao
- triggers para automacoes leves

Funcoes recomendadas:

- `convert_lead_to_client`
- `create_proposal_from_lead`
- `create_contract_from_proposal`
- `create_agreement_from_contract`
- `assign_lead_owner`
- `count_leads_by_stage`

### Realtime

Usar realtime para:

- atualizacao de pipeline
- notificacao de novo lead
- mudanca de status de proposta
- confirmacao de assinatura

## Ordem recomendada de implementacao

### Fase 1. Reforco do lead atual

- expandir schema de `leads`
- adicionar timeline
- adicionar follow-up
- melhorar kanban
- adicionar filtros e score

Entrega esperada:

- modulo de leads deixa de ser simples e vira comercial basico

### Fase 2. Intake publico

- formulario publico
- criacao automatica de lead
- upload de anexos
- notificacao de novo lead

Entrega esperada:

- captacao real de oportunidades

### Fase 3. Propostas

- CRUD de propostas
- templates
- PDF
- link publico
- aceite

Entrega esperada:

- fechamento comercial controlado

### Fase 4. Contrato + assinatura

- gerar contrato a partir da proposta
- integrar com modulo de assinatura
- status de contrato

Entrega esperada:

- esteira completa ate assinatura

### Fase 5. Conversao + financeiro

- conversao automatica em cliente
- criacao de acordo financeiro
- onboarding inicial

Entrega esperada:

- fluxo fim a fim

### Fase 6. BI comercial

- dashboard
- relatorios
- metas e gargalos

Entrega esperada:

- inteligencia comercial de verdade

## MVP recomendado

Se for necessario cortar escopo, o MVP deve ter:

1. campos novos em `leads`
2. pipeline ampliado
3. timeline comercial
4. tarefas de follow-up
5. intake publico
6. propostas com PDF
7. aceite de proposta

Esse conjunto ja gera muito impacto antes mesmo de construir contratos completos.

## Criterios de aceite

O modulo sera considerado bem implementado quando:

- um lead puder entrar manualmente ou por formulario publico
- o time puder mover o lead no pipeline com historico
- cada lead tiver proximo passo e responsavel
- uma proposta puder ser gerada e enviada
- a proposta puder ser aceita por link
- um contrato puder ser gerado a partir da proposta
- a assinatura puder disparar conversao em cliente
- o financeiro puder nascer do contrato aceito
- dashboards mostrarem conversao e perdas

## O que nao fazer

- nao misturar contrato comercial com processo juridico
- nao liberar portal completo antes da conversao
- nao depender de campos livres para tudo
- nao deixar lead sem dono
- nao deixar proposta sem validade
- nao converter lead sem historico

## Melhor oportunidade de produto

O diferencial do seu CRM nao e copiar o Perfex literalmente.

O diferencial e unir:

- funil comercial estilo Perfex
- assinatura digital nativa
- financeiro juridico
- portal do cliente
- onboarding juridico

Essa combinacao e bem mais forte para escritorio de advocacia do que um CRM generico.

## Proximo passo recomendado

Comecar pela `Fase 1`, porque ela aproveita o que ja existe e gera valor rapido:

- reforcar schema de leads
- criar timeline comercial
- criar tarefas de follow-up
- ampliar estagios
- melhorar filtros e dashboard

Depois disso, o melhor segundo passo e `Propostas`, porque e a peça que fecha o ciclo comercial.
