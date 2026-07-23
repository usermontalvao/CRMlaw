---
name: audit-log-bloat
description: Tabela audit_log está com 3,7 GB por gravar snapshots gigantes de processos — correção adiada
metadata:
  type: project
---

A tabela `audit_log` (Supabase, projeto uajwkqipbyxzvwjpitxl) tem só ~6.700 linhas mas ocupa **3,7 GB**. Causa: o trigger `fn_audit_log_trigger` (ligado a `processes`, `clients`, `deadlines`, `calendar_events`) grava a linha INTEIRA em `old_value` E `new_value` (`to_jsonb(OLD)`/`to_jsonb(NEW)`). O campo pesado é **`processes.notes` (jsonb, média ~550 kB/processo)**; com o DataJud atualizando processos com frequência (autor "system"), cada update grava ~550 kB × 2. `processes` sozinho = 1,8 GB em new_value (5.198 linhas).

Efeito colateral: filtrar a auditoria por cliente varria esse jsonb e dava `57014 statement timeout`. Já mitigado no app via RPCs indexadas `search_audit_log`/`count_audit_log` (usam BitmapOr em idx_audit_log_entity_id + idx_audit_log_new_value_client_id), chamadas por `settings.service.ts` quando há filtro de cliente. Ver [[audit-client-filter-rpc]].

Correção da raiz (bloat) foi ADIADA pelo usuário em 2026-07-23 ("só investigar por ora"). Quando retomar: (1) alterar o trigger para `to_jsonb(NEW) - 'notes' - 'datajud_cache'`; (2) limpar histórico removendo esses campos dos registros antigos + `VACUUM FULL` (trava a tabela — rodar em baixa carga).
