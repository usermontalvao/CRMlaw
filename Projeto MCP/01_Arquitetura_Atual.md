# Arquitetura Atual

## 1. Resumo do produto

O projeto e um CRM juridico full-stack chamado Jurius, com:

- area interna do escritorio;
- portal do cliente isolado;
- experiencias publicas de assinatura, preenchimento, verificacao e compartilhamento;
- backend em Supabase;
- automacoes e integracoes em Edge Functions;
- uso de IA para analise documental, intimações e processos.

## 2. Stack tecnica

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Lucide React
- FullCalendar
- Syncfusion Document Editor
- Quill
- Framer Motion

### Backend/plataforma

- Supabase Postgres
- Supabase Auth
- Supabase Realtime
- Supabase Storage
- Supabase Edge Functions
- RPCs SQL e politicas RLS

### Bibliotecas de documento/assinatura/exportacao

- docx
- docx-preview
- docxtemplater
- mammoth
- pdf-lib
- react-pdf
- html2canvas
- jspdf
- xlsx
- qrcode

### IA e integracoes

- SDK `openai`
- proxies/Edge Functions para OpenAI
- DataJud
- DJEN
- envio email
- OTP por email e SMS

## 3. Estrategia de entrada do app

O projeto nao usa um roteador tradicional como fronteira principal. A entrada em `src/main.tsx` opera assim:

- se existir sessao staff do Supabase, sobe o CRM interno;
- se o hash indicar rota publica do CRM, sobe o CRM interno;
- se nao houver sessao staff e nao for rota publica, sobe o Portal do Cliente.

Isso cria tres superficies reais:

1. `App` interno do escritorio;
2. `PortalApp` do cliente;
3. paginas publicas renderizadas no app principal.

## 4. Superficies funcionais do sistema

### 4.1 Area interna do escritorio

Controlada por `src/App.tsx`, com modulos lazy-loaded e permissao por cargo/modulo.

Modulos principais identificados:

- dashboard
- feed
- leads
- clientes
- documentos
- cloud
- processos
- requerimentos
- prazos
- intimacoes
- financeiro
- agenda
- assinaturas
- tarefas
- notificacoes
- chat
- usuarios
- configuracoes
- peticoes
- perfil
- cron/monitor publico controlado

### 4.2 Portal do Cliente

Modulo isolado em `src/portal/`, com:

- autenticacao separada do app interno;
- roteamento proprio;
- dashboard;
- casos (processos + requerimentos);
- scanner mobile;
- documentos;
- assinaturas;
- financeiro;
- agenda;
- mensagens;
- notificacoes;
- perfil.

### 4.3 Experiencias publicas

Rotas publicas identificadas em `src/main.tsx`:

- `#/assinar/...`
- `#/p/...`
- `#/preencher/...`
- `#/cloud/share/...`
- `#/verificar`
- `#/documento/...`
- `#/terms`
- `#/privacidade`
- `#/privacy`
- `#/docs`
- `#/cron/djen`

Essas rotas provam que o produto ja expõe capacidades externas, mesmo antes de MCP.

## 5. Modelo de autenticacao atual

### Staff interno

- Supabase Auth padrao.
- Sessao persistida no navegador.
- Perfil complementar em `profiles`.

### Portal do cliente

- contexto separado em `ClientAuthContext`.
- sessao persistida em `jurius_portal_session`.
- validacao por sessao JWT real no `supabasePortal`.
- login via CPF e OTPs.
- role Postgres dedicada `portal_client`.

### Publico

- links tokenizados para assinatura, verificacao, preenchimento e compartilhamento.

## 6. Modelo de autorizacao atual

O produto ja possui base para autorizacao fina:

- tabela/estrutura `role_permissions`;
- overrides individuais em `user_module_overrides`;
- hook `usePermissions`;
- checagem por `can_view`, `can_create`, `can_edit`, `can_delete`;
- administradores com acesso total;
- portal com modulo habilitavel/desabilitavel;
- RLS em tabelas e storage.

Isso e um excelente ponto de partida para MCP, porque o mesmo modelo pode virar:

- escopos de ferramenta;
- escopos por tenant;
- politicas por ator;
- aprovacao para acoes sensiveis.

## 7. Dominios de negocio observados

A partir dos modulos, servicos, tipos, migracoes e funcoes, os dominios reais do sistema sao:

- identidade/autenticacao
- perfil/permissoes
- leads
- clientes
- processos
- timeline processual
- requerimentos
- documentos e templates
- cloud/storage/share
- assinatura digital e verificacao
- financeiro
- agenda/calendario
- prazos
- intimacoes DJEN
- movimentos DataJud
- feed social interno
- notificacoes
- tarefas
- chat interno
- chat portal/tickets
- representantes/agenda terceirizada
- editor de peticoes
- portal do cliente
- IA/analises e explicacoes
- configuracoes do escritorio

## 8. Caracteristicas arquiteturais importantes para MCP

### Pontos fortes

- o sistema ja esta modularizado por dominio;
- os servicos concentram boa parte do acesso a dados;
- existem DTOs/tipos por modulo;
- ha superficies publicas e portal, ou seja, a ideia de "consumidor externo" nao e nova;
- existem Edge Functions para capacidades que nao devem ficar no frontend;
- o sistema ja opera com RLS e papeis.

### Pontos de atencao

- parte relevante da logica ainda vive no frontend/service layer do app;
- nao existe um "application API facade" unica para todos os dominios;
- o produto aparenta ser single-tenant;
- nomenclaturas de permissao e dominios ainda precisam de padronizacao para exposicao externa;
- algumas integracoes parecem acopladas diretamente ao contexto atual do escritorio.

## 9. Diagnostico objetivo

### O que ja permite MCP

- existe capacidade funcional suficiente;
- existe granularidade de dominio;
- existe autorizacao inicial;
- existem fluxos que ja geram links publicos e acoes externas;
- existe portal com identidade de cliente separada.

### O que ainda falta antes de um MCP "de plataforma"

- padronizar contrato de servico por dominio;
- introduzir tenancy real para SaaS;
- definir escopos formais de autorizacao;
- criar trilha de auditoria de chamadas MCP;
- mover operacoes sensiveis para camada backend dedicada;
- impedir que tools MCP dependam de comportamento visual do frontend.
