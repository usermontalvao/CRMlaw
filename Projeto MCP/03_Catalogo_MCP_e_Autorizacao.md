# Catalogo MCP e Autorizacao

## 1. Principio

O MCP nao deve expor a interface; deve expor capacidades de negocio.

A recomendacao para este projeto e separar em tres camadas:

1. `Domain Services` - regras e contratos de negocio.
2. `MCP Server` - tools/resources/prompts.
3. `Policy Layer` - autorizacao, auditoria, limites e tenancy.

## 2. Niveis de autorizacao recomendados

### L0 - Publico

Sem sessao autenticada. Somente acoes por token ou link seguro.

Exemplos:

- verificar autenticidade de assinatura;
- acessar bundle publico de assinatura;
- preencher documento por permalink;
- consultar share publico do cloud;
- validar link publico de documento.

### L1 - Cliente do Portal

Sessao `portal_client`, acesso somente aos proprios dados.

Exemplos:

- listar processos proprios;
- listar requerimentos proprios;
- visualizar financeiro proprio;
- enviar mensagem ao escritorio;
- subir documentos solicitados;
- atualizar cadastro;
- ler notificacoes;
- usar scanner mobile.

### L2 - Equipe interna leitura

Staff com permissao de visualizacao.

Exemplos:

- buscar clientes;
- listar processos;
- ler timeline;
- consultar agenda;
- ver dashboards;
- consultar documentos e templates;
- ler tickets.

### L3 - Equipe interna operacao

Staff com permissao create/edit.

Exemplos:

- cadastrar cliente;
- criar processo;
- abrir requerimento;
- criar evento;
- gerar contrato;
- enviar assinatura;
- registrar pagamento;
- responder ticket;
- gerar share.

### L4 - Admin/gestao

Acesso sensivel.

Exemplos:

- alterar permissoes;
- criar colaborador;
- excluir usuario;
- configurar modulos do portal;
- alterar identidade do escritorio;
- reprocessar sincronizacoes;
- operar auditoria;
- revogar links e acessos.

### L5 - Sistema/servico

Nao deve ficar disponivel ao agente final sem forte controle.

Exemplos:

- schedulers;
- reprocessamento em lote;
- jobs DJEN/DataJud;
- notificadores;
- rotinas com service role;
- automacoes de manutencao.

## 3. Resources recomendados

### Clientes

- `crm://clients/{id}/summary`
- `crm://clients/{id}/profile`
- `crm://clients/{id}/documents`
- `crm://clients/{id}/financial`
- `crm://clients/{id}/cases`

### Processos

- `crm://processes/{id}/summary`
- `crm://processes/{id}/timeline`
- `crm://processes/{id}/deadlines`
- `crm://processes/{id}/calendar`
- `crm://processes/{id}/intimations`

### Requerimentos

- `crm://requirements/{id}/summary`
- `crm://requirements/{id}/history`
- `crm://requirements/{id}/documents`

### Assinaturas e documentos

- `crm://signature-requests/{id}`
- `crm://signature-requests/{id}/signers`
- `crm://templates/{id}`
- `crm://generated-documents/{id}`

### Financeiro

- `crm://agreements/{id}`
- `crm://agreements/{id}/installments`
- `crm://financial/stats`

### Portal

- `crm://portal/clients/{id}/dashboard`
- `crm://portal/clients/{id}/notifications`
- `crm://portal/clients/{id}/messages`

## 4. Tools recomendadas por dominio

## 4.1 Identidade e perfil

### Staff

- `staff.get_profile`
- `staff.update_profile`
- `staff.upload_avatar`

### Admin

- `admin.list_users`
- `admin.update_user_role`
- `admin.delete_user_profile`
- `admin.create_collaborator`
- `admin.delete_user`

## 4.2 Permissoes e governanca

- `admin.get_role_permissions`
- `admin.update_role_permissions`
- `admin.create_module_override`
- `admin.revoke_module_override`
- `admin.list_access_requests`
- `admin.approve_access_request`
- `admin.deny_access_request`
- `admin.get_audit_log`

## 4.3 Leads e clientes

- `lead.list`
- `lead.get`
- `lead.create`
- `lead.update`
- `lead.delete`
- `lead.convert_to_client`

- `client.list`
- `client.search`
- `client.get`
- `client.get_by_document`
- `client.create`
- `client.update`
- `client.merge`
- `client.archive_or_delete`
- `client.set_photo`

## 4.4 Processos

- `process.list`
- `process.get`
- `process.create`
- `process.update`
- `process.update_status`
- `process.delete`
- `process.sync_with_djen`
- `process.fetch_timeline`
- `process.fetch_and_analyze_timeline`
- `process.auto_update_status`

## 4.5 Requerimentos

- `requirement.list`
- `requirement.get`
- `requirement.create`
- `requirement.update`
- `requirement.update_status`
- `requirement.archive`
- `requirement.delete`
- `requirement.list_history`
- `requirement.attach_document`
- `requirement.download_document`

## 4.6 Prazos e agenda

- `deadline.list`
- `deadline.get`
- `deadline.create`
- `deadline.update`
- `deadline.update_status`
- `deadline.delete`
- `deadline.get_upcoming`
- `deadline.get_overdue`

- `calendar.list_events`
- `calendar.get_event`
- `calendar.create_event`
- `calendar.update_event`
- `calendar.delete_event`

## 4.7 Intimacoes e DataJud

- `djen.search`
- `djen.search_by_process`
- `djen.get_local_intimation`
- `djen.link_client`
- `djen.link_process`
- `djen.mark_read`
- `djen.delete_batch`
- `djen.clean_old`
- `djen.run_sync`
- `djen.list_sync_history`

- `intimation.analyze`
- `intimation.get_analysis`
- `intimation.list_analyses`
- `intimation.delete_analysis`

- `datajud.sync`
- `datajud.explain_movement`

## 4.8 Documentos, templates e peticoes

- `template.list`
- `template.get`
- `template.create`
- `template.update`
- `template.delete`
- `template.add_file`
- `template.remove_file`
- `template.reorder_files`
- `template.configure_signature_fields`
- `template.replace_custom_fields`

- `generated_document.list`
- `generated_document.create`
- `generated_document.get_signed_url`
- `generated_document.delete`

- `template_fill.generate_bundle`
- `template_fill.submit`
- `template_fill.create_permalink`
- `template_fill.list_permalinks`
- `template_fill.activate_permalink`
- `template_fill.deactivate_permalink`
- `template_fill.delete_permalink`

- `petition.block.list`
- `petition.block.create`
- `petition.block.update`
- `petition.block.delete`
- `petition.template.list`
- `petition.template.create`
- `petition.template.update`
- `petition.template.delete`
- `petition.generate_docx_content`

## 4.9 Assinatura digital

- `signature.list_requests`
- `signature.get_request`
- `signature.create_request`
- `signature.update_request`
- `signature.cancel_request`
- `signature.archive_request`
- `signature.restore_request`
- `signature.delete_request`
- `signature.add_signer`
- `signature.update_signer`
- `signature.delete_signer`
- `signature.generate_public_url`
- `signature.generate_verification_url`
- `signature.send_phone_otp`
- `signature.send_email_otp`
- `signature.verify_phone_otp`
- `signature.verify_email_otp`
- `signature.sign_document_public`
- `signature.verify_by_hash`
- `signature.get_stats`

## 4.10 Cloud e compartilhamento

- `cloud.list_folders`
- `cloud.list_files`
- `cloud.get_folder`
- `cloud.create_folder`
- `cloud.rename_folder`
- `cloud.archive_folder`
- `cloud.trash_folder`
- `cloud.restore_folder`
- `cloud.delete_folder`
- `cloud.upload_file`
- `cloud.upload_files`
- `cloud.rename_file`
- `cloud.move_file`
- `cloud.duplicate_file`
- `cloud.replace_file_contents`
- `cloud.archive_file`
- `cloud.trash_file`
- `cloud.restore_file`
- `cloud.delete_file`
- `cloud.get_signed_url`
- `cloud.create_share`
- `cloud.update_share`
- `cloud.disable_share`
- `cloud.resolve_public_share`
- `cloud.list_activity_logs`

## 4.11 Financeiro

- `financial.list_agreements`
- `financial.get_agreement`
- `financial.create_agreement`
- `financial.update_agreement`
- `financial.delete_agreement`
- `financial.list_installments`
- `financial.pay_installment`
- `financial.edit_installment_payment`
- `financial.cancel_installment`
- `financial.add_manual_entry`
- `financial.delete_manual_entry`
- `financial.get_stats`
- `financial.get_payment_audit_log`

## 4.12 Chat e tickets

- `chat.list_rooms`
- `chat.get_room_members`
- `chat.list_messages`
- `chat.send_message`
- `chat.send_system_message`
- `chat.edit_message`
- `chat.delete_message`
- `chat.toggle_reaction`
- `chat.create_room`
- `chat.create_direct_message`
- `chat.mark_as_read`
- `chat.get_unread_count`

- `portal_ticket.list_open`
- `portal_ticket.get_messages`
- `portal_ticket.reply`
- `portal_ticket.accept`
- `portal_ticket.close`
- `portal_ticket.reopen`
- `portal_ticket.assign`

## 4.13 Portal do cliente

- `portal.login`
- `portal.get_dashboard_summary`
- `portal.list_processes`
- `portal.get_process`
- `portal.list_requirements`
- `portal.get_requirement`
- `portal.list_documents`
- `portal.list_signatures_pending`
- `portal.list_financial`
- `portal.list_calendar_events`
- `portal.list_notifications`
- `portal.mark_notification_read`
- `portal.mark_all_notifications_read`
- `portal.mark_notifications_seen`
- `portal.list_deadlines`
- `portal.list_document_requests`
- `portal.upload_document_files`
- `portal.get_profile`
- `portal.request_profile_update`
- `portal.list_profile_requests`
- `portal.get_chat_messages`
- `portal.send_chat_message`
- `portal.save_push_subscription`
- `portal.remove_push_subscription`

## 4.14 IA conectada

Para sua visao futura de IA que faz cadastro, contratos e links, as tools de maior valor sao:

- `client.create`
- `process.create`
- `requirement.create`
- `template.get`
- `generated_document.create`
- `template_fill.create_permalink`
- `signature.create_request`
- `signature.generate_public_url`
- `signature.send_signature_link_email`
- `cloud.create_share`
- `portal.upload_document_files`
- `financial.create_agreement`
- `chat.send_message`

## 5. Prompts recomendados

- `novo_cliente_completo`
- `abrir_processo_novo_cliente`
- `gerar_contrato_e_enviar_assinatura`
- `solicitar_documentos_para_cliente`
- `resumir_processo_para_cliente`
- `explicar_andamento_em_linguagem_simples`
- `analisar_intimacao_e_sugerir_acao`
- `montar_peticao_base`
- `abrir_ticket_de_atendimento`
- `cobrar_documentacao_pendente`

## 6. Regras obrigatorias para ferramentas MCP de escrita

Toda tool de escrita deve:

- validar permissao por modulo e acao;
- validar posse/escopo do cliente no portal;
- registrar auditoria;
- ser idempotente quando possivel;
- devolver IDs canonicos;
- devolver links gerados de forma segura;
- bloquear acoes irreversiveis sem escopo administrativo;
- aceitar `dry_run` em ferramentas sensiveis quando fizer sentido.

## 7. Ordem recomendada das exposicoes MCP

### Fase 1 - somente leitura

- clientes
- processos
- requerimentos
- prazos
- agenda
- financeiro
- assinaturas
- notificacoes
- dashboard/portal summary

### Fase 2 - escrita operacional segura

- criar cliente
- atualizar cliente
- criar processo
- criar evento
- criar tarefa
- gerar contrato
- enviar assinatura
- criar share
- abrir/responder ticket

### Fase 3 - automacoes amplas

- gerar fluxo completo de onboarding
- renovar documentos
- reabrir atendimento
- reprocessar sincronia
- lote de notificacoes
- operacoes administrativas com aprovacao

## 8. Recomendacao final

Para a sua meta de "IA realmente conectada", o MCP deve nascer como backend operacional, nao como fachada do frontend.

A IA precisa conseguir:

1. ler contexto confiavel;
2. executar acoes atomicas;
3. encadear fluxos;
4. obter links e IDs reais;
5. respeitar autorizacao formal;
6. operar em contexto tenant-aware quando o SaaS chegar.
