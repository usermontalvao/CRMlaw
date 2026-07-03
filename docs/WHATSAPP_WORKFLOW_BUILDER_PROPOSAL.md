# Proposta — Builder Visual de Workflows para WhatsApp (tipo Typebot)

> Gerado em 2026-07-02. Complementa `WHATSAPP_MODULE_ANALYSIS.md` e `WHATSAPP_AGENTS_WORKFLOW.md`. Baseado no schema existente em `supabase/migrations/20260616150000_whatsapp_agents_workflow.sql` e nos types de `src/types/whatsapp.types.ts`.

# 1. Visão do produto

Um editor de fluxos dentro do CRM (aba "Automação" do módulo WhatsApp) onde o operador monta o atendimento arrastando blocos num canvas e ligando-os com setas rotuladas pela condição ("respondeu sim", "enviou documento", "sem resposta em 2h"). Cada bloco pode ser **estático** (mensagem fixa, pergunta fixa) ou **por prompt** (um agente IA com instrução própria interpreta a resposta e extrai dados) — híbrido de mensagens estáticas + prompts.

O fluxo publicado vira o "piloto automático" do canal: recebe, qualifica, coleta documentos, envia contrato/kit (reusando os follow-ups e o doc-intake que já existem) e, ao final, transfere para um usuário/setor com resumo. O atendente vê na conversa um chip "🤖 Etapa: Qualificação (FGTS)" e pode assumir a qualquer momento — handoff congela a automação. Campanhas entram depois como "porta de entrada" que injeta N contatos no nó inicial do fluxo.

Princípio de produto: **o prompt interpreta, a regra estruturada decide**. O visual mostra regras; a IA é um recurso dentro do nó, não o dono do fluxo.

# 2. Modelo conceitual

- **Workflow**: grafo versionado de nós e conexões, vinculado a canais (`whatsapp_channel_workflows`). Um default por canal (índice único já existe).
- **Nó** (= `whatsapp_workflow_steps`): unidade de execução. Tipos: `message` (estática), `question` (espera resposta), `ai_agent` (prompt interpreta/coleta), `decision` (só regras, sem envio), `documents` (integra doc-intake), `signature/kit` (integra follow-ups existentes), `wait` (timeout), `handoff`, `end`.
- **Conexão** (= `whatsapp_workflow_rules` com ação `go_to_step`): aresta rotulada por condição. No banco, a aresta É a regra — não precisa de tabela nova de edges.
- **Agente** (= `whatsapp_workflow_agents`): perfil de comportamento reutilizável — prompt base, campos a coletar, se pode enviar sozinho ou exige aprovação.
- **Prompt**: `prompt_base` do agente + `ai_config`/override por nó. O prompt do nó especializa o agente para aquela etapa.
- **Memória da conversa** (= `whatsapp_conversation_workflow_state`): etapa atual, agente, dados coletados, documentos pendentes, resumo, follow-up ativo, flags — 1 linha por conversa (ver §7).
- **Regra**: condições estruturadas (`conditions_json`, ~20 tipos já tipados em `whatsapp.types.ts`) avaliadas por prioridade; a primeira que casa executa a ação.
- **Ação** (`action_json`): `go_to_step`, `send_message`, `schedule_followup`, `handoff_human`, `set_qualification`, etc. (17 tipos já definidos).
- **Handoff**: ação terminal-para-automação — grava alvo + resumo, estado `handed_off`, cancela follow-up, congela até retomada humana explícita.
- **Follow-up**: política (`whatsapp_followup_policies` + steps) anexada a um nó; agenda `next_followup_at` no estado; cancelada por resposta/handoff/encerramento/opt-out.

# 3. Arquitetura recomendada

Três peças novas, nenhuma reescrita:

1. **Runtime (edge function `whatsapp-workflow-engine`)** — único ponto que muda estado de workflow. Invocada: (a) pelo `evolution-webhook` após persistir inbound (mesmo padrão `waitUntil` do ai-flow atual, substituindo `maybeRunAiFlow`); (b) por cron 1/min para timeouts e follow-ups vencidos (`idx_wa_conv_wf_state_followup` já existe). Entrada: `{conversation_id, trigger: 'message'|'timer'|'document'|'signature', event_id}`. Adquire lock por conversa, executa **um ciclo** (avaliar regras → no máx. 1 transição → persistir estado + log), libera.
2. **Camada de configuração (`src/services/whatsapp/workflows.ts`)** — CRUD sobre as 9 tabelas (RLS staff já pronta). O builder salva rascunho; "Publicar" valida o grafo (nó start único, sem etapa órfã, sem `go_to_step` para nó inexistente) e ativa a versão.
3. **UI (`src/components/whatsapp/workflow/`)** — canvas com **React Flow** (biblioteca madura, MIT; não reinventar canvas), painel de propriedades do nó, simulador. Fica fora do `WhatsAppModule.tsx`.

Chamadas de LLM só no runtime (server-side, mesma cadeia Groq→OpenAI já usada). A saída da IA vira **dados estruturados** (`collected_data_json`, `classified_subject`, intenção) que as regras consomem — a IA nunca chama `go_to_step`.

Integrações reusadas, não reimplementadas: envio via `evolution-send`; documentos via `doc_intake_status` + condição `document_delivered`; assinatura via `signature_requests.status`; handoff via o fluxo de atribuição existente.

# 4. Modelo de dados recomendado

**Usar o schema existente — está bem desenhado.** Ajustes mínimos:

| Entidade | Tabela | Mudança |
|---|---|---|
| Workflows | `whatsapp_workflows` | + `status ('draft'\|'published'\|'archived')`, + `canvas_json jsonb` (posições x/y dos nós — só layout, sem semântica) |
| Nós | `whatsapp_workflow_steps` | + `prompt_override text` (prompt do nó), + `static_message text` (mensagem fixa do nó `message`); `step_kind` ganha valores `message`, `question`, `ai_agent`, `wait` |
| Conexões | `whatsapp_workflow_rules` | Nenhuma — regra com `action_json.type='go_to_step'` é a aresta; `priority` ordena; `else_action_json` é a saída "default" |
| Agentes | `whatsapp_workflow_agents` | Nenhuma |
| Prompts | agente + nó | Sem tabela própria (evitar over-engineering) |
| Estado por conversa | `whatsapp_conversation_workflow_state` | + `workflow_version int`, + `last_event_id text` (idempotência), + `locked_until timestamptz` (lock leve), + `last_ai_result_json jsonb` |
| Log de transições | `whatsapp_workflow_transition_log` | Nenhuma |
| Fila follow-up | `next_followup_at` + índice parcial existente | Sem tabela de fila separada no MVP; o cron varre o índice |
| Versões/publicação | **nova** `whatsapp_workflow_versions (id, workflow_id, version, snapshot_json, published_at, published_by)` | Snapshot imutável do grafo no publish; conversas em andamento seguem a versão em que entraram |

Lock recomendado: RPC `wa_wf_acquire_lock(conversation_id)` com `UPDATE ... SET locked_until = now()+'30s' WHERE locked_until < now() RETURNING` — simples, sem infra extra. (Inferência: suficiente para volume de escritório; advisory locks se escalar.)

# 5. UI/UX do editor visual

- **Lista de workflows**: nome, tipo, canais vinculados, versão publicada, status, "conversas ativas nele".
- **Canvas** (React Flow): zoom/pan, minimap, grid snap. Nós como cards compactos: ícone do tipo + nome + resumo de 1 linha. Arestas com rótulo da condição ("= sim", "docs completos", "timeout 2h", "senão").
- **Barra lateral esquerda**: paleta de blocos arrastáveis (Mensagem, Pergunta, Agente IA, Decisão, Documentos, Assinatura/Kit, Espera, Follow-up, Handoff, Fim).
- **Painel de propriedades** (direita, ao selecionar nó): nome; mensagem estática OU agente + prompt do nó; campos a coletar (chips de `WhatsAppWorkflowFieldDefinition`); documentos exigidos; timeout; política de follow-up (dropdown das policies); toggle "exige aprovação humana"; fallback. Ao selecionar aresta: builder de condição (dropdown do tipo + operador + valor — nada de JSON cru na tela).
- **Validação inline**: nó órfão/sem saída/salto inválido marcado em vermelho; "Publicar" bloqueado até resolver.
- **Simulador** (drawer lateral): chat fake onde o operador digita como cliente; mostra a cada passo qual regra casou, estado resultante e mensagem enviada — mesmo engine em modo dry-run.
- **Status por conversa**: no painel da conversa da inbox, chip com workflow/etapa/estado + botões "Pausar automação" / "Assumir" + timeline das transições (lê o transition_log).
- **Publicação**: botão Publicar → diff simples vs versão anterior → snapshot. Rascunho editável sem afetar produção.

# 6. Execução do fluxo (passo a passo do motor)

1. `evolution-webhook` persiste a mensagem (como hoje) e chama o engine com `{conversation_id, trigger:'message', event_id: evolution_message_id}`.
2. Engine: se `last_event_id == event_id` → sai (idempotência, cobre retry do webhook).
3. Adquire lock (`locked_until`); se ocupado, re-enfileira uma reavaliação (retry curto) e sai.
4. Carrega/cria o estado: sem estado → busca workflow default do canal (`whatsapp_channel_workflows`), snapshot da versão publicada, entra no nó `start`.
5. Guardas globais: `handed_off/paused/completed/cancelled/exception` → só atualiza `last_customer_reply_at` e **cancela follow-up ativo** (resposta cancela cadência), sai.
6. Conversa tem `assigned_user_id`? → handoff implícito: congela automação (mesma regra do ai-flow atual).
7. Se o nó atual é `ai_agent`/`question`: monta contexto (prompt do agente + prompt do nó + `collected_data` + últimas N mensagens + `latest_summary`), chama o LLM pedindo **JSON estruturado**: `{intent, extracted_fields, wants_human, mentions_document, reply_suggestion}`. Persiste os campos extraídos em `collected_data_json`.
8. Avalia as regras do nó por `priority` com `match_mode`; condições consomem só dados estruturados (mensagem, campos, classificação do passo 7, documentos, timeout). **Primeira que casa executa; máx. 1 `go_to_step` por ciclo.**
9. Executa a ação com os guardrails do doc (não enviar se handed_off, validar etapa destino, anti-loop A→A, follow-up único por conversa/etapa).
10. Ao entrar no novo nó: ações de entrada (enviar `static_message` ou resposta do agente — via `evolution-send`, nunca fetch direto; se agente exige aprovação → estado `waiting_internal` + pendência para o humano), agenda follow-up/timeout se configurado.
11. Persiste estado + insere `whatsapp_workflow_transition_log` (from/to/regra/ação/ator) **na mesma transação** (RPC).
12. Libera o lock. Erro em qualquer passo → estado `exception` + `exception_reason` + log; a inbox humana segue funcionando.

Trigger `timer` (cron): varre `next_followup_at <= now()` e timeouts; injeta condição `timeout_reached`/dispara o passo da política de follow-up pelo mesmo ciclo acima.

# 7. Memória por conversa

`whatsapp_conversation_workflow_state` já contém: etapa (`current_step_id`), agente (`current_agent_id`), dados coletados (`collected_data_json`), documentos pendentes (`pending_documents_json`), assunto (`primary_subject` + `detected_additional_issues`), resumo (`latest_summary`), última regra (`last_rule_id`), follow-up ativo (`active_followup_policy_id/step/next_followup_at/attempts`), exceção (`exception_reason`), handoff (`handoff_target_*`, estado `handed_off`), qualificação. Adicionar apenas `last_ai_result_json` (prompt hash + saída estruturada + confiança). Histórico de transições fica no `transition_log`, não no estado (estado = foto atual; log = filme).

Regras de robustez:
- **Só o engine escreve** no estado (service role); UI lê via realtime (publication já configurada) e muda estado apenas por ações explícitas ("pausar", "retomar", "assumir") que passam por RPC e geram log.
- Escrita de estado + log na mesma transação — nunca um sem o outro.
- `collected_data_json` é chave→valor com merge aditivo; a IA propõe, o engine grava — nunca sobrescrever campo validado por campo de confiança menor.
- Resumo acumulado: regenerado pelo agente a cada K turnos ou em handoff (é o texto que o humano lê ao assumir).
- Auditabilidade: "por que a conversa está aqui?" se responde com `transition_log` filtrado por `conversation_id` (índice já existe).

# 8. Plano de implementação por fases

**Fase 1 — MVP funcional (sem builder visual)** — Prioridade: Alta. Depende de: itens de estabilização da análise do módulo (lock, envio unificado, tokens, cadência do kit).
Escopo: engine (`whatsapp-workflow-engine`) com lock + idempotência; bootstrap de estado via binding canal→workflow; nós `message/question/decision/handoff/end`; condições `message_contains(_any)/equals`, `field_filled`, `timeout_reached`; ações `go_to_step/send_message/handoff_human/close_conversation`; transition log; follow-up pela política seed (cancelamento por resposta/handoff/close); workflow definido por **seed SQL** (sem UI). Chip de estado na conversa (read-only).
Risco: médio (concorrência). É o "MVP recomendado" do `WHATSAPP_AGENTS_WORKFLOW.md`.

**Fase 2 — Builder visual real** — Prioridade: Alta. Depende: Fase 1 rodando num canal piloto.
Escopo: React Flow + CRUD (`workflows.ts`) + painel de propriedades + editor de condições + validação de grafo + publicar/versionar (`whatsapp_workflow_versions`, `canvas_json`) + vínculo canal→workflow na tela de canais.
Risco: baixo (CRUD + front; o engine não muda).

**Fase 3 — Agentes e prompts avançados** — Prioridade: Média-Alta. Depende: Fase 2.
Escopo: nó `ai_agent` com extração estruturada (§6 passo 7); CRUD de agentes; prompt por nó; condições `classified_subject`, intenção, `wants_human`; aprovação humana por nó (migrando o padrão `pending_ai_reply` da Fase O); integração `documents` (condição `document_delivered` alimentada pelo doc-intake) e `signature_completed`; **migração/aposentadoria do ai-flow de playbooks** (playbook vira workflow linear gerado automaticamente — um só sistema de IA).
Risco: médio (qualidade de prompt/extração); mitigado por aprovação humana ligada por default.

**Fase 4 — Observabilidade, simulação e robustez** — Prioridade: Média.
Escopo: simulador dry-run; fila de exceções com retry manual; métricas por etapa (tempo médio, abandono, conversão para handoff/qualificado); trilha de auditoria filtrável na UI; alertas de loop/volume anômalo. Depois: **campanhas** como injetor de contatos no nó start.
Risco: baixo.

# 9. Riscos e simplificações recomendadas (o que NÃO fazer no início)

1. **Não** construir o canvas antes do engine rodar com workflow em seed.
2. **Não** criar DSL própria de condições nem editor de JSON livre — só os tipos de condição já tipados, via dropdowns.
3. **Não** deixar a IA escolher a próxima etapa (function calling para navegar) — ela só produz dados; regra decide.
4. **Não** suportar sub-workflows, paralelismo, variáveis globais ou loops configuráveis no v1 — grafo simples, uma transição por ciclo.
5. **Não** criar tabela de fila/broker de eventos — `next_followup_at` + cron + lock cobre o volume de um escritório.
6. **Não** manter dois sistemas de IA — congelar evolução do playbook (Fase J) e absorvê-lo na Fase 3.
7. **Não** habilitar envio 100% autônomo de cara — `requires_human_approval=true` por default no canal piloto; desligar com métricas na mão.
8. **Não** escrever canvas próprio — usar React Flow.

# 10. Recomendação final

Começar pelo **engine mínimo sobre o schema que já existe** (Fase 1), com um workflow de campanha simples seedado (recepção → qualificação → coleta de docs → handoff, follow-up 2h/24h/36h) rodando em **um canal piloto com aprovação humana ligada**. Isso entrega a maior parte do ganho operacional ("WhatsApp atende, qualifica e transfere sozinho") sem nenhuma UI nova, valida concorrência/idempotência em produção e des-risca o resto. O builder visual (Fase 2) vira uma camada de edição sobre um motor já confiável — a única ordem em que builders desse tipo dão certo. Pré-requisito inegociável: os 4 itens de estabilização de `WHATSAPP_MODULE_ANALYSIS.md` §6 Fase 1, porque o engine vai multiplicar o volume de envios automáticos sobre essa base.

**Assunções/pendências**: Evolution API v2 estável como gateway único; volume de escritório (dezenas de conversas simultâneas, não milhares); jobs pg_cron reais não verificados no banco.
