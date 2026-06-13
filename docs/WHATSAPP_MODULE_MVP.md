# Documentação do MVP: Módulo WhatsApp

## Objetivo

Criar um módulo de WhatsApp dedicado ao atendimento externo, com foco em operação real de equipe, usando Evolution API como gateway de mensageria.

Este módulo **não substitui** o `ChatModule` atual.

- `ChatModule`: continua responsável por chat interno e tickets
- `WhatsAppModule`: novo módulo para atendimento via WhatsApp

O MVP deve priorizar operação, estabilidade e clareza de fluxo. A meta não é lançar automação completa, campanha ou IA avançada logo no início.

## Escopo do MVP

O MVP inclui:

- inbox de conversas
- visualização de mensagens em tempo real
- multiatendimento
- atribuição de conversa para atendente
- transferência entre atendentes
- status operacional da conversa
- notas internas
- tags
- filtros e busca
- envio e recebimento de texto
- suporte completo a anexos essenciais
- integração com Evolution API via webhook
- suporte a uma ou mais instâncias de WhatsApp

O MVP não inclui:

- campanhas
- disparos em massa
- fluxos complexos de bot
- IA de triagem avançada
- funil comercial completo
- analytics avançado
- integração profunda com leads
- templates sofisticados de automação

## Referência de produto

A referência visual e operacional do módulo deve ser o padrão de inbox do Chatwoot:

- coluna de conversas bem resolvida
- composer robusto
- anexos como parte nativa da conversa
- notas internas separadas da resposta ao cliente
- contexto operacional visível na lateral

O objetivo não é copiar o Chatwoot literalmente, mas usar seu padrão de usabilidade como benchmark para o atendimento.

## Princípios do módulo

1. O módulo precisa funcionar bem para equipe antes de ficar inteligente.
2. O operador deve saber claramente quem está atendendo cada conversa.
3. O WhatsApp deve nascer separado do chat interno para não contaminar o fluxo atual.
4. A modelagem já deve prever expansão futura para leads, clientes, processos e campanhas.

## Visão funcional

### Áreas principais

O módulo pode ser organizado em 3 áreas:

1. Lista de conversas
2. Tela da conversa
3. Painel lateral de contexto e ações

### Funcionalidades mínimas

#### Lista de conversas

- listar conversas por instância
- mostrar nome, telefone e última mensagem
- mostrar horário da última interação
- mostrar quantidade de não lidas
- mostrar responsável atual
- mostrar status da conversa
- mostrar tags
- permitir busca por nome, telefone e conteúdo recente
- permitir filtros rápidos

#### Tela da conversa

- histórico completo de mensagens
- mensagens recebidas e enviadas
- cards visuais por tipo de mídia
- envio de texto
- envio e recebimento de imagem
- envio e recebimento de vídeo
- envio e recebimento de áudio
- envio e recebimento de nota de voz
- envio e recebimento de PDF
- envio e recebimento de documentos
- atualização em tempo real
- indicador de mensagem não lida

#### Tipos de mídia obrigatórios no MVP

O MVP deve suportar estes tipos:

- `texto`
- `imagem`
- `vídeo`
- `áudio`
- `nota de voz`
- `pdf`
- `documento`

### Regras de mídia

#### Imagens

- preview inline
- abrir em tamanho ampliado
- mostrar nome do arquivo quando aplicável

#### Vídeos

- card de vídeo
- thumbnail quando disponível
- abrir ou baixar conforme suporte do canal/navegador

#### Áudios e notas de voz

- player inline
- duração visível
- estado de carregamento
- diferenciação visual entre arquivo de áudio e nota de voz

#### PDF

- card com nome do arquivo
- tamanho do arquivo
- ação de abrir/baixar

#### Documentos

Inclui formatos como:

- `.doc`
- `.docx`
- `.xls`
- `.xlsx`
- `.txt`

Cada documento deve exibir:

- nome
- extensão
- tamanho
- ação de download

#### Painel lateral

- dados básicos do contato
- instância do WhatsApp usada
- responsável atual
- status da conversa
- tags aplicadas
- notas internas
- histórico operacional

## Multiatendimento

Multiatendimento é o núcleo do MVP.

Sem isso, o módulo vira apenas uma caixa de entrada compartilhada sem controle.

### Regras mínimas

- cada conversa pode ter um `owner_id`
- conversas podem ficar sem dono
- um atendente pode assumir conversa sem dono
- um atendente com permissão pode transferir conversa
- o histórico de transferências deve ficar salvo
- a interface deve mostrar claramente quem está com a conversa
- conversas devem ter visual de status para evitar conflito operacional

### Filtros operacionais

Filtros recomendados:

- `Minhas`
- `Não atribuídas`
- `Todas`
- `Novas`
- `Em atendimento`
- `Aguardando cliente`
- `Finalizadas`

## Status do MVP

Status operacionais recomendados:

- `nova`
- `em_atendimento`
- `aguardando_cliente`
- `finalizada`

### Regras de uso

- `nova`: conversa recebida e ainda não assumida
- `em_atendimento`: conversa com atuação humana em andamento
- `aguardando_cliente`: último passo depende do cliente
- `finalizada`: conversa encerrada operacionalmente

## Ações do MVP

Ações mínimas por conversa:

- `Assumir`
- `Transferir`
- `Alterar status`
- `Adicionar nota`
- `Adicionar tag`
- `Finalizar`
- `Reabrir`

## Estrutura recomendada de interface

### 1. Header do módulo

- seletor de instância
- campo de busca global
- filtros rápidos
- indicador de conexão

### 2. Coluna esquerda

- lista de conversas
- agrupamento por filtro/status

### 3. Área central

- histórico de mensagens
- composer de envio

### Composer de mensagens

O composer deve seguir um padrão de inbox madura, inspirado no Chatwoot:

- campo principal de texto
- botão de anexo
- envio por Enter
- preview do anexo antes de enviar
- estado de upload
- bloqueio visual durante envio
- tratamento de erro por arquivo

O MVP pode manter o composer simples, mas não deve tratar anexo como recurso secundário improvisado.

### 4. Coluna direita

- dados do contato
- responsável
- tags
- notas internas
- log operacional

## Arquitetura técnica

### Componentes principais

- `WhatsAppModule.tsx`
- `WhatsAppConversationList.tsx`
- `WhatsAppConversationView.tsx`
- `WhatsAppConversationSidebar.tsx`
- `WhatsAppComposer.tsx`
- `WhatsAppTransferModal.tsx`
- `WhatsAppNotesPanel.tsx`
- `WhatsAppTagsPanel.tsx`

### Backend e integração

Fluxo técnico recomendado:

1. Evolution API recebe e envia mensagens
2. Evolution API publica eventos via webhook
3. Supabase Edge Functions recebem os webhooks
4. CRM persiste conversas, mensagens e eventos operacionais
5. Frontend consome o banco e assina realtime

### Fluxo resumido

```text
WhatsApp <-> Evolution API <-> Webhooks/Edge Functions <-> Supabase <-> CRM Frontend
```

## Modelagem inicial de dados

### Tabela `whatsapp_instances`

Responsável por armazenar as conexões disponíveis.

Campos sugeridos:

- `id`
- `name`
- `provider`
- `instance_key`
- `phone_number`
- `status`
- `last_connection_at`
- `created_at`
- `updated_at`

### Tabela `whatsapp_contacts`

Representa o contato externo.

Campos sugeridos:

- `id`
- `instance_id`
- `phone_e164`
- `display_name`
- `avatar_url`
- `lead_id` nullable
- `client_id` nullable
- `process_id` nullable
- `created_at`
- `updated_at`

### Tabela `whatsapp_conversations`

Representa a conversa operacional.

Campos sugeridos:

- `id`
- `instance_id`
- `contact_id`
- `owner_id` nullable
- `status`
- `last_message_at`
- `last_message_preview`
- `unread_count`
- `archived_at` nullable
- `created_at`
- `updated_at`

### Tabela `whatsapp_messages`

Armazena as mensagens sincronizadas.

Campos sugeridos:

- `id`
- `conversation_id`
- `external_message_id`
- `direction` (`inbound` | `outbound`)
- `message_type`
- `content_text` nullable
- `media_url` nullable
- `media_storage_path` nullable
- `media_mime_type` nullable
- `media_file_name` nullable
- `media_file_size` nullable
- `media_duration_seconds` nullable
- `media_thumbnail_url` nullable
- `caption` nullable
- `sender_phone`
- `sent_at`
- `delivered_at` nullable
- `read_at` nullable
- `raw_payload` jsonb
- `created_at`

### Tabela `whatsapp_conversation_tags`

Tags aplicadas às conversas.

Campos sugeridos:

- `id`
- `conversation_id`
- `tag`
- `created_by`
- `created_at`

### Tabela `whatsapp_conversation_notes`

Notas internas da equipe.

Campos sugeridos:

- `id`
- `conversation_id`
- `author_id`
- `body`
- `created_at`

### Tabela `whatsapp_conversation_events`

Auditoria operacional.

Campos sugeridos:

- `id`
- `conversation_id`
- `event_type`
- `actor_id` nullable
- `payload` jsonb
- `created_at`

Exemplos de `event_type`:

- `conversation_created`
- `assigned`
- `transferred`
- `status_changed`
- `tag_added`
- `tag_removed`
- `note_added`
- `message_received`
- `message_sent`

## Webhooks esperados

Os webhooks da Evolution devem ser usados para manter o CRM sincronizado.

Eventos mais relevantes para o MVP:

- `MESSAGES_UPSERT`
- `MESSAGES_UPDATE`
- `SEND_MESSAGE`
- `CONNECTION_UPDATE`
- `CONTACTS_UPDATE`
- `CHATS_UPDATE`

## Fluxos do MVP

### Fluxo 1: entrada de nova mensagem

1. cliente envia mensagem
2. Evolution API dispara webhook
3. sistema identifica instância e contato
4. se não houver conversa aberta, cria uma
5. mensagem é persistida
6. `unread_count` é atualizado
7. conversa aparece na inbox em tempo real

### Fluxo 2: atendente assume conversa

1. usuário clica em `Assumir`
2. sistema define `owner_id`
3. status muda para `em_atendimento`
4. evento operacional é registrado
5. a interface reflete o novo responsável

### Fluxo 3: transferência

1. atendente abre modal de transferência
2. seleciona novo responsável
3. sistema atualiza `owner_id`
4. registra evento `transferred`
5. conversa passa para a fila do novo atendente

### Fluxo 4: finalização

1. atendente marca conversa como `finalizada`
2. sistema registra evento
3. conversa some dos filtros principais, mas permanece no histórico

### Fluxo 5: envio de mídia

1. atendente seleciona arquivo ou grava nota de voz
2. sistema faz upload controlado
3. frontend exibe preview e estado de envio
4. mensagem é enviada pela Evolution API
5. webhook ou retorno da ação confirma persistência
6. card da mídia aparece no histórico com metadados corretos

## Permissões recomendadas

Perfis mínimos:

- `admin`
- `supervisor`
- `atendente`

Regras sugeridas:

- `admin`: configura instâncias, vê tudo, transfere tudo
- `supervisor`: vê tudo, transfere tudo, gerencia operação
- `atendente`: atende conversas, assume, transfere conforme regra

## Integrações futuras previstas

Mesmo fora do MVP, o módulo deve nascer preparado para:

- vínculo com `Leads`
- vínculo com `Clients`
- vínculo com `Processes`
- campanhas
- bot por fluxo
- IA de triagem
- respostas sugeridas
- SLA e dashboards

## Itens propositalmente adiados

Para não travar o MVP, adiar:

- chatbot avançado
- roteamento inteligente
- templates por jornada
- campanha ativa
- automação jurídica completa
- lead scoring
- analytics comercial

## Backlog sugerido

### Fase 1: base técnica

- criar tabelas do módulo
- criar edge functions de webhook
- mapear eventos da Evolution
- persistir instâncias, conversas e mensagens

### Fase 2: inbox

- construir tela principal do módulo
- listar conversas
- exibir mensagens
- atualizar em tempo real
- criar busca e filtros

### Fase 3: operação

- assumir conversa
- transferir conversa
- alterar status
- notas internas
- tags
- histórico operacional

### Fase 4: anexos e polimento

- envio de imagem, vídeo, áudio, nota de voz, PDF e documentos
- preview de imagem
- player inline de áudio/voz
- cards de PDF e documentos
- estados vazios
- indicadores de loading e erro
- refinamento visual

## Decisão sobre voz

Para evitar ambiguidade, ficam separados dois conceitos:

- `nota de voz`: faz parte do MVP
- `chamada de voz`: fora do MVP inicial

O MVP deve suportar troca de mensagens em áudio e nota de voz, mas não precisa implementar chamadas de voz em tempo real nesta primeira fase.

## Critérios de sucesso do MVP

O MVP será bem-sucedido se:

- a equipe conseguir atender WhatsApp com múltiplos usuários sem conflito
- o sistema persistir histórico de conversa com confiabilidade
- for possível saber quem está atendendo cada contato
- transferências e status funcionarem sem ambiguidade
- o módulo operar separado do `ChatModule`

## Decisão de produto registrada

Fica definido que:

- o `ChatModule` atual não será alterado para virar WhatsApp
- o WhatsApp será um novo módulo
- o foco inicial é atendimento operacional com multiatendimento
- campanhas, IA avançada e automações complexas ficam para etapas futuras
