# Análise e Documentação de Implementação — Módulo WhatsApp

> Gerado em 2026-07-02 a partir de leitura direta do código (frontend, services, edge functions, migrations e docs). Onde algo é dedução e não evidência, está marcado como `Inferência`.

# 1. Resumo executivo

- O módulo operacional (inbox, multiatendimento, mídia, realtime) está **maduro e em produção** — 27 migrations de evolução incremental, fachada de serviço modularizada.
- `src/components/WhatsAppModule.tsx` tem 1.733 linhas mas já foi fatiado: ~40 arquivos em `src/components/whatsapp/` (hooks, modais, painéis).
- Integração Evolution API é sólida: webhook autenticado por token de canal, dedup por `evolution_message_id`, dedup de contato @lid por variantes do 9º dígito, auto-reconexão em `evolution-send`.
- IA existe em **dois sistemas paralelos e desconexos**: (1) playbooks/sessões (Fase J/O, `whatsapp_ai_sessions`, rodando) e (2) workflow/agentes (migration `20260616150000`, **só schema — zero runtime**).
- O `whatsapp-ai-flow` atual **não usa LLM para responder** — é um questionário sequencial (manda a pergunta N do playbook, grava a resposta crua como valor do campo N-1). O `system_prompt` do playbook não é usado.
- Follow-ups existem em **3 edge functions quase idênticas** (documentos, kit, assinatura) com lógica copiada (business hours, regex de opt-out, cadência) — nenhuma usa as `whatsapp_followup_policies` do banco.
- Automação embutida no webhook: mensagem de ausência, reabertura inteligente com IA (Groq→OpenAI), transcrição de áudio Whisper, avatar, disparo do ai-flow — tudo via `EdgeRuntime.waitUntil`.
- `whatsapp-doc-intake` (cron) casa mídia recebida com itens de documento pendentes via GPT-4o visão e reusa o pipeline `process-document-upload`.
- Retenção LGPD implementada (`whatsapp-retention`): purga conteúdo/mídia >6 meses preservando metadados, respeita `legal_hold`.
- **Lacuna crítica**: nenhum lock/serialização por conversa; webhook + crons + scheduler podem escrever concorrentemente na mesma conversa.
- **Inconsistência crítica**: `whatsapp-template-fill-followup/index.ts:19` está com cadência de **TESTE (5 min)** hardcoded — risco de spam em produção.
- Tokens de cron têm fallback hardcoded (`'wa-scheduler-2026'` etc.) — se o secret não estiver setado, o token é público no repositório.
- O doc `WHATSAPP_AGENTS_WORKFLOW.md` é fiel ao schema e define guardrails corretos; o que falta é exclusivamente o executor, o scheduler dessa camada e a administração.

# 2. Arquitetura atual

**Frontend**
- `src/components/WhatsAppModule.tsx` — orquestrador da inbox (lista, thread, painel 360, funil, dashboard).
- `src/components/whatsapp/` — 40 arquivos: hooks (`useWaRealtime`, `useWaMessages`, `useWaComposer`, `useWaAiActions`…), modais operacionais, painéis de cliente 360, `aiApprovalBanner`, `scheduledMessages`, `attendanceDashboard`, `conversationFunnelBoard`.
- `src/services/whatsapp.service.ts` — fachada que compõe 5 domínios: `conversations`, `messages`, `admin`, `client360`, `automation` sobre `src/services/whatsapp/shared.ts`. Extras: `resilientSend.ts` (auto-fila em desconexão), `reconnectDetection.ts` (testado), `muteStore.ts`.

**Edge functions**
- `evolution-webhook` — ingestão (mensagens, status, presença, conexão) + automações inline (ausência, reabertura IA, transcrição, avatar, disparo ai-flow).
- `evolution-send` — envio (texto/mídia/edição/bloqueio/presença), auto-reconexão, resolução de JID/9º dígito, persiste outbound.
- `evolution-instance` — conectar/QR/status do canal, configura webhook.
- `whatsapp-ai-flow` + `whatsapp-ai-approve` — questionário por playbook, aprovação humana (Fase O).
- Crons: `whatsapp-scheduler` (agendadas), `whatsapp-document-followup`, `whatsapp-template-fill-followup`, `whatsapp-signature-followup`, `whatsapp-doc-intake`, `whatsapp-retention`.
- `whatsapp-push` — Web Push para atendente (via trigger SQL + pg_net). `whatsapp-avatar` — resolução de avatar.

**Banco (27 migrations `*whatsapp*`)**
- Núcleo: `whatsapp_instances` (canais), `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_departments`, `whatsapp_transfers`, `whatsapp_internal_notes`, `whatsapp_templates`, `whatsapp_scheduled_messages`, `whatsapp_business_hours`, `whatsapp_contact_blocks`, `whatsapp_retention_log`, labels, mutes, staff_push.
- IA Fase J/O: `whatsapp_ai_channel_config`, `whatsapp_ai_playbooks`, `whatsapp_ai_sessions`.
- Workflow (schema-only): 9 tabelas em `supabase/migrations/20260616150000_whatsapp_agents_workflow.sql` com RLS `is_office_staff()`/`wa_can_see_conv()`, realtime no state, e seeds (política 2h/24h/36h + agente padrão).

**Fluxo de dados**
`Evolution API → evolution-webhook (token do canal) → tabelas → Supabase Realtime → UI`; envio: `UI → evolution-send (JWT) → Evolution → webhook confirma status`. Config do servidor Evolution centralizada em `system_settings.whatsapp_evolution_config`.

# 3. Capacidades do módulo

| Capacidade | Status | Evidência | Observação |
|---|---|---|---|
| Inbox multiatendimento (atribuição, transferência c/ aceite, setores, status) | Implementado | `whatsapp_conversations.assigned_user_id/awaiting_accept`, migrations Fase 3/4 | Ciclo de vida + SLA (`first_response_at` etc.) |
| Envio/recebimento texto + mídia (imagem, áudio, vídeo, doc, sticker) | Implementado | webhook `handleMessage`, evolution-send | Mídia em bucket privado `whatsapp-media`, URL assinada no client |
| Transcrição de áudio | Implementado | `evolution-webhook` `transcribeAudio` | Whisper Groq→OpenAI, async |
| Realtime (mensagens, presença, sessão IA, agendadas) | Implementado | `useWaRealtime`, subscribes em `automation.ts` | |
| Mensagens agendadas + retenção por reconexão | Implementado | `whatsapp-scheduler`, `hold_reason='reconnect'` | Cron 1/min, batch 25 |
| Templates/macros | Implementado | `whatsapp_templates`, `renderTemplate` em shared.ts | Escopo global/canal/setor |
| Bloqueio de contato (interno + WhatsApp) | Implementado | `handleBlock` em evolution-send, `whatsapp_contact_blocks` | Best-effort no lado WhatsApp, auditado |
| Mensagem de ausência (horário comercial, timezone) | Implementado | `maybeAutoSendAbsence`, `whatsapp_business_hours` | Cooldown 2h, `absence_suppressed` por conversa |
| Reabertura inteligente de conversa encerrada | Implementado | `classifyReopen` no webhook | Heurística + IA + pergunta ao cliente (3 vias) |
| IA de atendimento (playbook + aprovação humana) | Parcial | `whatsapp-ai-flow`, `whatsapp-ai-approve` | **Sem LLM na resposta**: só percorre perguntas fixas; `system_prompt` ignorado; sem validação de resposta |
| Intake documental por IA (visão) | Implementado | `whatsapp-doc-intake` | GPT-4o, confiança mínima 0.5, reusa `process-document-upload` |
| Follow-up documentos / kit / assinatura | Implementado (3x duplicado) | 3 edge functions de followup | Cadências e regex duplicadas; kit está em modo TESTE 5min |
| Push para atendente | Implementado | `whatsapp-push` + trigger pg_net | |
| Retenção/LGPD | Implementado | `whatsapp-retention`, `legal_hold` | Dry-run, batches de 500 |
| Cliente 360 / vínculo cliente-lead-processo | Implementado | `client360.ts`, `ClientLinkPanel`, `WaWorkspace` | Vínculo exige clique explícito (regra de produto) |
| Workflow de agentes (canal→workflow→etapa→regra→ação) | Apenas desenhado | migration 20260616150000 + types + `docs/WHATSAPP_AGENTS_WORKFLOW.md` | Schema, RLS, seeds e types completos; **zero runtime, zero CRUD, zero UI** |
| Follow-up por política configurável | Apenas desenhado | `whatsapp_followup_policies` + seed | Nenhum código lê essas tabelas |
| Executor de regras / transition log | Ausente | — | Nada grava em `whatsapp_workflow_transition_log` |
| Campanhas / disparo em massa | Ausente | — | Explicitamente adiado no MVP doc |
| Lock/serialização por conversa | Ausente | — | Exigido pelo doc de workflow (regra 2), inexistente |

# 4. Fluxos operacionais

**Entrada de mensagem** — Origem: Evolution webhook (`?token=` do canal). Processamento: resolve canal → resolve/cria conversa (dedup @lid) → guarda bloqueio → reabertura inteligente se `closed` → upsert idempotente da mensagem (`onConflict: conversation_id,evolution_message_id`) → jobs async (mídia→storage, transcrição, avatar, ausência, ai-flow). Persistência: `whatsapp_conversations`, `whatsapp_messages`, bucket. Saída: realtime para UI + push ao atendente. Arquivos: `supabase/functions/evolution-webhook/index.ts`.

**Leitura/inbox** — UI consome banco via `conversationsApi`/`messagesApi` + realtime (`useWaRealtime`, `useWaMessages`); RLS `wa_can_see_conv` restringe visibilidade por canal/setor/atribuição.

**Envio** — Origem: composer (`useWaComposer` → `resilientSend`). Processamento: `evolution-send` valida JWT (ou service role p/ sistema), verifica canal (`ensureChannelReady` com auto-reconexão, flag `reconnect_pending`), resolve JID, envia, insere outbound. Se canal fora: frontend re-agenda via `scheduleMessage(holdReason:'reconnect')`. Saída: status atualizado pelo webhook (`messages.update`, sem downgrade de status).

**Agendamento** — `automationApi.scheduleMessage` → `whatsapp_scheduled_messages` → cron `whatsapp-scheduler` (1/min) → `evolution-send` com service role → `sent/failed`, ou mantém `pending`+1min se `reconnect_pending`.

**IA/aprovação (Fase J/O)** — webhook (`maybeRunAiFlow`: canal com IA, sem humano atribuído, sessão não finalizada) → `whatsapp-ai-flow`: cria/carrega sessão, grava resposta anterior em `collected_data`, envia próxima pergunta do playbook ou faz handoff (nota interna com resumo). Com `require_human_approval`: grava `pending_ai_reply` + `pending_approval`; `whatsapp-ai-approve` envia e avança; nova mensagem do cliente descarta o pendente. UI: `aiApprovalBanner`, `useWaAiActions`.

**Assinatura / kit / documentos (follow-ups)** — 3 crons independentes, mesmo padrão: seleciona pendências (`signature_requests` / `template_fill_links` / `document_requests`) → checa horário comercial (hardcoded 8–18 seg-sex America/Cuiaba) → checa opt-out por regex nas inbound desde o último lembrete → envia via `evolution-send` → incrementa contador + nota interna. Diferenças: assinatura ancora em `last_seen_at` do signatário e pula quem está ao vivo na página; kit cobre `status='pending'`, assinatura assume após `submitted` (handoff entre as duas funções documentado no código).

**Doc-intake** — cron: mídia inbound recente de conversa com `client_id` e itens pendentes → GPT-4o visão casa arquivo↔item → copia para `client-documents` → `document_uploads` → `process-document-upload` (baixa híbrida) → nota interna.

**Retenção** — cron: purga content/transcription/storage de mensagens >N meses sem `legal_hold`, loga em `whatsapp_retention_log`.

**Atribuição/handoff humano** — assumir/transferir/aceitar via `conversationsApi` (RPCs Fase 4), histórico em `whatsapp_transfers`; abortar IA via `automationApi.abortAiSession`.

# 5. Lacunas e riscos

**Lacunas funcionais (por impacto)**
1. Camada de workflow/agentes: schema pronto, nenhum executor/CRUD/UI — a promessa central dos docs não roda.
2. IA conversacional real: ai-flow não interpreta respostas (grava texto cru como valor do campo, sem validação/repergunta); `system_prompt` e tipos de pergunta (`phone`, `date`, `choice`) não são usados.
3. Follow-up configurável: políticas no banco com seed, mas cadências reais estão hardcoded em 3 funções.
4. Campanhas/disparo ativo: ausente (adiado por decisão registrada).

**Lacunas de arquitetura**
1. **Sem serialização por conversa** — webhook, 5 crons e scheduler escrevem concorrentemente; ai-flow pode processar duas mensagens em paralelo e duplicar pergunta/avançar step duas vezes (não há lock nem idempotência por evento na sessão).
2. `evolution-webhook` acumula 6 responsabilidades (ingestão + 5 automações inline) — é o "componente gigante" que o próprio doc proíbe.
3. Dois modelos de IA concorrentes (`whatsapp_ai_playbooks` vs `whatsapp_workflow_agents`) sem plano de convergência escrito.

**Riscos de manutenção**
1. Triplicação dos follow-ups: `inBusinessHours`, `DECLINE_RE`, `BARE_NO_RE`, cadência e opt-out copiados em 3 arquivos — correção em um não propaga.
2. Lógica de telefone duplicada webhook ↔ `shared.ts` (comentário admite: "espelha src/services/whatsapp/shared.ts").
3. Horário comercial em 2 fontes: `whatsapp_business_hours` (por canal, usado na ausência) vs constantes 8–18 hardcoded (follow-ups).

**Riscos operacionais**
1. `whatsapp-template-fill-followup/index.ts:19`: `STEP_OFFSETS_MIN = [5,10,15,20,25]` com comentário "TESTE" — cliente real pode receber 5 lembretes em 25 min.
2. Tokens de cron com fallback hardcoded no código versionado (`wa-scheduler-2026`, `wa-followup-2026`, `wa-doc-intake-2026`, `wa-retention-2026`) — se o env não estiver setado, qualquer um com a URL dispara as funções.
3. `whatsapp-ai-flow` sem `WA_AI_TOKEN` setado = endpoint aberto (o check só roda `if (aiToken)`).
4. Envio automático não respeita mute/preferência do contato além de bloqueio e opt-out textual.

**Riscos de dados/consistência**
1. Sem trilha de auditoria estruturada para ações automáticas de follow-up além de notas internas (não filtrável).
2. `Inferência`: `waSendText` (reopen-ask), `sendText` do ai-flow e da ausência não inserem em `whatsapp_messages` — a mensagem só aparece quando o webhook `fromMe` ecoa. Se o eco falhar, o histórico fica incompleto.
3. Conflito docs × código: docs de workflow dizem "follow-up 2h/24h/36h por política"; o código real usa cadências próprias por domínio. O código vence hoje; a política seed nunca foi usada.

# 6. Plano de implementação organizado

**Fase 1 — Estabilização (antes de qualquer feature nova)**

| Item | Objetivo | Arquivos prováveis | Dependências | Risco | Prioridade |
|---|---|---|---|---|---|
| Corrigir cadência de teste do kit | Evitar spam real | `whatsapp-template-fill-followup/index.ts` | — | Baixo | **Alta** |
| Remover fallbacks de token hardcoded (falhar se env ausente) | Fechar endpoints de cron | 6 edge functions | setar secrets | Baixo | **Alta** |
| Persistir outbound das mensagens automáticas (ausência, reopen-ask, ai-flow) via `evolution-send` em vez de `sendText` direto | Histórico completo e um único caminho de envio | `evolution-webhook`, `whatsapp-ai-flow` | — | Médio | **Alta** |
| Lock lógico por conversa (ex.: `pg_advisory_xact_lock` em RPC, ou coluna `processing_until`) | Um executor por conversa | nova RPC + `whatsapp-ai-flow`, webhook | — | Médio | **Alta** |

**Fase 2 — Fechamento de lacunas**

| Item | Objetivo | Arquivos | Dependências | Risco | Prioridade |
|---|---|---|---|---|---|
| Unificar os 3 follow-ups num motor único lendo `whatsapp_followup_policies` | Uma cadência configurável, um código | nova edge `whatsapp-followup-engine`; aposentar as 3 atuais | Fase 1 | Médio | Alta |
| Horário comercial único (usar `whatsapp_business_hours` por canal em todos os envios automáticos) | Consistência | followups + shared helper Deno | — | Baixo | Alta |
| Extrair automações do webhook para módulos/`_shared` | Reduzir god-function | `evolution-webhook` (split em handlers) | — | Baixo | Média |
| Validação de resposta no ai-flow (tipo `phone`/`date`/`choice`, repergunta) | Dados coletados confiáveis | `whatsapp-ai-flow` | — | Baixo | Média |

**Fase 3 — Orquestração/workflows** — implementar o runtime mínimo do doc (ver `WHATSAPP_WORKFLOW_BUILDER_PROPOSAL.md`): binding canal→workflow, estado por conversa, executor de regra, transition log, follow-up por política, handoff. Prioridade Alta; depende das Fases 1–2.

**Fase 4 — Observabilidade e robustez**

| Item | Objetivo | Risco | Prioridade |
|---|---|---|---|
| Fila de exceções visível (estado `exception` + painel) | Supervisão | Baixo | Alta |
| Métricas por workflow/etapa (gargalos, conversão) | Gestão | Baixo | Média |
| Dead-letter/retry estruturado para envios automáticos falhos | Robustez | Médio | Média |
| Simulador de regras | Qualidade de configuração | Baixo | Baixa |

# 7. Documento final consolidado

**Visão geral** — Módulo de atendimento WhatsApp do CRM jurídico, separado do chat interno, usando Evolution API como gateway. Inbox operacional completa em produção; camada de automação parcial (questionário IA, follow-ups fixos); camada de orquestração por workflow apenas modelada.

**Objetivos do módulo** — Multiatendimento sem conflito; histórico confiável; integração nativa com clientes, leads, processos, documentos e assinatura; automação progressiva (triagem IA → workflows → campanhas) sem nunca bloquear o atendimento humano.

**Arquitetura** — 3 camadas: (1) Frontend React (`WhatsAppModule` + `src/components/whatsapp/**` + fachada `whatsappService` em 5 domínios); (2) Edge Functions Deno (ingestão `evolution-webhook`, envio `evolution-send`, canal `evolution-instance`, IA `whatsapp-ai-flow/approve`, 5 crons); (3) Postgres com RLS (`is_office_staff`, `wa_can_see_conv`) + Realtime + Storage (`whatsapp-media`). Config Evolution em `system_settings`.

**Entidades e persistência** — Núcleo: `whatsapp_instances`, `whatsapp_conversations` (status open/pending/closed, SLA, bloqueio, legal_hold, labels), `whatsapp_messages` (idempotente por `conversation_id+evolution_message_id`, transcrição, `doc_intake_status`, `retention_purged_at`), `whatsapp_transfers`, `whatsapp_internal_notes`, `whatsapp_templates`, `whatsapp_scheduled_messages`, `whatsapp_business_hours`, `whatsapp_departments`. IA: `whatsapp_ai_channel_config`, `whatsapp_ai_playbooks`, `whatsapp_ai_sessions`. Workflow (dormente): `whatsapp_workflow_agents`, `whatsapp_workflows`, `_steps`, `_rules`, `whatsapp_channel_workflows`, `whatsapp_conversation_workflow_state`, `whatsapp_workflow_transition_log`, `whatsapp_followup_policies(_steps)`.

**Fluxos principais** — Inbound: webhook→dedup→persistência→automações async→realtime. Outbound: composer→evolution-send (auto-reconexão; fallback para fila agendada). IA: sessão por conversa, perguntas de playbook, aprovação humana opcional, handoff com resumo em nota. Follow-ups: 3 crons por domínio (documentos/kit/assinatura) com opt-out textual. Doc-intake: visão IA casa mídia↔item pendente. Retenção: purga >6 meses exceto legal_hold.

**Integrações** — Evolution API (Baileys); Groq/OpenAI (Whisper, classificação de reabertura, visão documental); módulos internos: clients, leads, processes, document_requests/uploads, signature_requests, template_fill_links; Web Push staff.

**Regras operacionais** — Conversa persiste antes de qualquer automação; contato bloqueado não entra na fila; IA só atua sem humano atribuído e para em `handed_off/aborted`; status de mensagem nunca rebaixa; encerramento com reabertura inteligente; RLS por canal/setor/atribuição; retenção respeita guarda jurídica.

**Lacunas atuais** — Runtime de workflow inexistente; follow-ups não configuráveis e triplicados; ai-flow sem interpretação LLM real; sem lock por conversa; cadência de teste em produção no kit; tokens fallback hardcoded; mensagens automáticas enviadas fora do caminho persistente.

**Próximos passos recomendados** — Executar Fase 1 (4 itens de estabilização) imediatamente; unificar follow-ups sobre `whatsapp_followup_policies`; só então construir o runtime de workflow (ver proposta do builder), reaproveitando o schema existente.

**Assunções/pendências** — Evolution API v2 como gateway único; volume de escritório (dezenas de conversas simultâneas); jobs pg_cron reais não verificados no banco (frequências citadas vêm de comentários do código); `whatsapp-ai-approve` e `whatsapp-avatar` avaliados por cabeçalho/uso, não linha a linha.
