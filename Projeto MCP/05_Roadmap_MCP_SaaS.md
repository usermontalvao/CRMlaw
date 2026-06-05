# Roadmap MCP + SaaS

## Diretriz principal

Nao implementar um MCP poderoso em cima de uma base ainda nao tenantizada. O caminho correto e:

1. organizar dominios;
2. formalizar autorizacao;
3. tenantizar;
4. so entao abrir write tools mais fortes.

## Fase 0 - Preparacao imediata

- consolidar esta documentacao;
- congelar nomes canonicos de dominios;
- definir IDs e payloads padrao;
- mapear quais acoes exigem aprovacao humana.

## Fase 1 - Camada de aplicacao

Objetivo: tirar o acoplamento do frontend.

- criar facade/backend por dominio;
- padronizar DTOs de entrada e saida;
- concentrar validacoes sensiveis no backend;
- criar servicos canonicos para cliente, processo, requerimento, assinatura, financeiro, cloud e portal.

Entregavel:

- `application services` reutilizaveis por UI, MCP, API e automacoes.

## Fase 2 - Autorizacao formal

- transformar papeis atuais em escopos canonicos;
- mapear `view/create/edit/delete` para escopos MCP;
- separar escopos staff, admin, portal_client e system;
- introduzir trilha de auditoria de acoes operacionais.

Entregavel:

- matriz de permissao pronta para API/MCP.

## Fase 3 - Tenantizacao SaaS

- criar `tenants` e memberships;
- adicionar `tenant_id` nas entidades;
- migrar policies RLS;
- tenantizar storage;
- tenantizar links publicos;
- tenantizar configuracoes e integrações.

Entregavel:

- plataforma multi-tenant segura.

## Fase 4 - MCP leitura

Primeiro liberar apenas consulta:

- `client.search`
- `client.get`
- `process.list`
- `process.get`
- `requirement.get`
- `deadline.list`
- `calendar.list_events`
- `financial.get_stats`
- `signature.get_request`
- `portal.get_dashboard_summary`

Entregavel:

- MCP confiavel para assistentes consultivos.

## Fase 5 - MCP escrita operacional

Liberar acoes atomicas:

- criar cliente;
- atualizar cliente;
- criar processo;
- criar tarefa;
- criar evento;
- criar requerimento;
- criar acordo;
- gerar contrato;
- criar assinatura;
- gerar link publico;
- abrir ticket;
- responder ticket.

Obrigatorio nesta fase:

- auditoria detalhada;
- escopos por tool;
- idempotencia quando possivel;
- `dry_run` em acoes sensiveis.

## Fase 6 - IA conectada por fluxo

Aqui entram os cenarios que voce descreveu:

- IA cadastra cliente;
- IA cria processo;
- IA gera contrato;
- IA cria assinatura;
- IA devolve link;
- IA solicita documentos;
- IA abre/atualiza ticket;
- IA explica andamento para o cliente.

Fluxo-alvo exemplo:

1. `client.create`
2. `process.create`
3. `template.get`
4. `generated_document.create`
5. `signature.create_request`
6. `signature.generate_public_url`
7. `portal.send_chat_message`

## Fase 7 - SaaS comercial

- onboarding automatico de tenant;
- billing;
- feature flags;
- branding;
- dominios customizados;
- quotas de IA e storage;
- contratos enterprise.

## Backlog tecnico recomendado

### Muito alto valor

- tabela de auditoria operacional unificada;
- service facade por dominio;
- tenancy model;
- policy engine central;
- convention de IDs e payloads;
- job runner padronizado para operacoes assincronas.

### Alto valor

- webhooks por tenant;
- fila de eventos de negocio;
- observabilidade por tenant;
- versionamento de contratos MCP;
- sandbox/approval para acoes sensiveis.

## Ordem curta recomendada

Se fosse executar com minima chance de retrabalho:

1. formalizar dominios e servicos;
2. formalizar autorizacao;
3. tenantizar dados e storage;
4. criar MCP read-only;
5. criar MCP write tools;
6. acoplar agentes IA;
7. comercializar como SaaS.

## Conclusao

O projeto ja tem massa critica suficiente para:

- MCP serio;
- IA operacional;
- evolucao para SaaS.

Mas a ordem faz diferenca. O melhor investimento agora e transformar a base atual em plataforma, nao apenas "abrir tools".
