# Planejamento SaaS

## 1. Diagnostico atual

O sistema esta forte como produto operacional, mas os sinais atuais apontam para arquitetura de escritorio unico:

- nao foi encontrado uso transversal de `tenant_id`, `organization_id`, `office_id` ou equivalente nos dominios principais;
- configuracoes aparecem orientadas ao escritorio atual (`office_identity`);
- permissoes estao centradas em cargos internos e portal, nao em tenancy;
- links, storage e entidades aparentam operar sem separacao tenant-first declarada.

Conclusao: o produto ainda nao esta modelado como SaaS multi-tenant nativo.

## 2. Recomendacao de arquitetura SaaS

### Modelo recomendado

Para este produto, a recomendacao inicial e:

- `shared database`
- `shared schema`
- `tenant_id` obrigatorio em praticamente todas as tabelas de negocio
- RLS tenant-aware
- storage segregado por tenant
- auditoria por tenant

### Por que esse modelo

- menor custo operacional que schema-por-tenant;
- mais simples para analytics cruzado e operacao;
- encaixa melhor com Supabase;
- reduz explosao de migracoes;
- facilita MCP futuro com escopo por tenant.

### Quando considerar isolamento maior

Para clientes enterprise ou exigencias reguladas:

- tenant dedicado por banco/projeto;
- storage isolado;
- dominio customizado;
- integrações e secrets dedicados.

## 3. Mudancas estruturais necessarias

## 3.1 Tenant model

Criar conceitos formais:

- `tenants`
- `tenant_users`
- `tenant_memberships`
- `tenant_settings`
- `tenant_modules`
- `tenant_billing_accounts`
- `tenant_audit_logs`

## 3.2 Tenant em entidades de negocio

Adicionar `tenant_id` nas tabelas principais, por exemplo:

- clients
- leads
- processes
- process_timeline caches
- requirements
- requirement_documents
- deadlines
- calendar_events
- agreements
- installments
- chat_rooms
- chat_messages
- document_templates
- generated_documents
- signature_requests
- signers
- cloud_folders
- cloud_files
- feed_posts
- notifications
- settings correlatas
- portal_client_users
- portal_client_notifications

## 3.3 RLS por tenant

Toda policy deve combinar:

- pertencimento ao tenant;
- permissao funcional;
- ownership quando aplicavel;
- perfil `portal_client` restrito ao proprio cliente e tenant.

## 3.4 Storage por tenant

Padrao recomendado:

- bucket compartilhado com prefixo `tenant/{tenant_id}/...`
ou
- buckets separados por dominio, sempre com prefixo por tenant.

Exemplos:

- `tenant/{tenant_id}/cloud/...`
- `tenant/{tenant_id}/templates/...`
- `tenant/{tenant_id}/generated-documents/...`
- `tenant/{tenant_id}/portal-uploads/...`
- `tenant/{tenant_id}/signatures/...`

## 4. Camadas funcionais do SaaS

### Camada 1 - Produto base

- CRM juridico principal
- portal do cliente
- assinatura
- documentos
- financeiro

### Camada 2 - Tenant admin

- configuracao do escritorio
- permissao de modulos
- branding
- usuarios
- politicas internas
- integrações por tenant

### Camada 3 - Billing

- plano
- limites
- consumo
- upgrade/downgrade
- trial
- bloqueios por inadimplencia

### Camada 4 - Marketplace/API/MCP

- MCP tools por tenant
- webhooks
- API externa
- automacoes
- agentes IA

## 5. Billing e empacotamento

## 5.1 Planos sugeridos

- `Starter`
- `Professional`
- `Business`
- `Enterprise`

## 5.2 Eixos de monetizacao

- usuarios internos
- clientes do portal
- armazenamento
- assinatura digital/volume
- uso de IA
- mensagens/notificacoes
- integrações premium
- white-label
- tenant dedicado

## 5.3 Feature flags por plano

Controlar por tenant:

- portal ativo
- scanner ativo
- cloud publico
- assinatura digital
- editor de peticoes
- IA de intimações
- IA de explicacao processual
- DataJud
- DJEN
- webhooks
- MCP write tools

## 6. Branding e white-label

Para virar SaaS de verdade, e desejavel prever:

- nome e logo por tenant;
- paleta por tenant;
- dominio/subdominio por tenant;
- templates de email por tenant;
- identidade do portal do cliente por tenant;
- links publicos e paginas publicas tenant-aware.

## 7. Integracoes por tenant

Hoje o sistema ja sinaliza varias integracoes. Para SaaS, elas devem virar configuracoes por tenant:

- OpenAI
- provedores email
- OTP/SMS
- DataJud
- DJEN
- Syncfusion/licencas quando aplicavel
- push notifications

Isso implica:

- secret storage por tenant;
- health checks por tenant;
- logs de falha por tenant;
- quotas por tenant.

## 8. Observabilidade e operacao

### Minimo recomendado

- audit log tenant-aware;
- request log com actor e tool;
- error tracking;
- metrics por tenant;
- rastreio de consumo de IA;
- rastreio de jobs;
- health dashboard de integrações.

### Importante para MCP/IA

Cada chamada MCP precisa gravar:

- tenant;
- ator;
- tool;
- payload resumido;
- resultado;
- IDs afetados;
- aprovacao/consentimento;
- custo e latencia.

## 9. Seguranca e compliance

Antes de abrir o produto como SaaS, tratar:

- segregacao forte de dados por tenant;
- revisao de RLS em tabelas e storage;
- rotacao de secrets;
- logs de auditoria imutaveis ou de alta confiabilidade;
- trilha de consentimento para IA;
- mascaramento de dados sensiveis;
- controles de exportacao e revogacao de links;
- backup e restore por tenant quando possivel.

## 10. Ordem de transformacao para SaaS

### Fase A - Fundacao

- criar entidades tenant;
- mapear tabelas afetadas;
- introduzir `tenant_id`;
- ajustar RLS;
- adaptar storage.

### Fase B - Backoffice SaaS

- cadastro de tenant;
- onboarding do tenant;
- convites de usuarios;
- configuracao de modulos;
- branding;
- billing base.

### Fase C - Portal multi-tenant

- resolver tenant por dominio/subdominio/path;
- tenant-aware auth no portal;
- paginas publicas tenant-aware;
- links publicos tenant-aware.

### Fase D - API e MCP

- autenticao por tenant;
- escopos;
- auditoria;
- quotas;
- exposicao progressiva de tools.

## 11. Riscos principais

- migracao de dados sem tenant_id;
- policies RLS complexas e propensas a falhas;
- storage legado sem separacao por tenant;
- URLs publicas antigas sem contexto de tenant;
- Edge Functions com service role precisando de revalidacao de isolamento;
- custos de IA e notificacoes sem rate limiting por tenant.

## 12. Conclusao

O projeto pode virar SaaS, mas o passo critico e tornar o modelo de dados e autorizacao tenant-first.

Se isso nao vier antes da abertura ampla de MCP e agentes de IA, o risco de vazamento cruzado e de automacao indevida sobe muito.
