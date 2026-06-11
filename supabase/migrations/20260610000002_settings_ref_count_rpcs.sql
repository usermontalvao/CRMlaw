-- RPCs de contagem de vínculos para bloqueio de exclusão em listas configuráveis.
-- Chamadas pelo SettingsModule antes de excluir um item (countRef callback).
-- Retornam BIGINT; se > 0, a exclusão é bloqueada com mensagem ao usuário.

-- Processos por status
CREATE OR REPLACE FUNCTION public.count_processes_by_status(p_status text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.processes WHERE status = p_status
$$;

-- Prazos por status
CREATE OR REPLACE FUNCTION public.count_deadlines_by_status(p_status text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.deadlines WHERE status = p_status
$$;

-- Prazos por prioridade
CREATE OR REPLACE FUNCTION public.count_deadlines_by_priority(p_priority text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.deadlines WHERE priority = p_priority
$$;

-- Leads por estágio
CREATE OR REPLACE FUNCTION public.count_leads_by_stage(p_stage text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.leads WHERE stage = p_stage
$$;

-- Clientes por status
CREATE OR REPLACE FUNCTION public.count_clients_by_status(p_status text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.clients WHERE status = p_status
$$;

-- Requerimentos por status
CREATE OR REPLACE FUNCTION public.count_requirements_by_status(p_status text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.requirements WHERE status::text = p_status
$$;

-- Compromissos por tipo (calendar_events)
CREATE OR REPLACE FUNCTION public.count_calendar_events_by_type(p_type text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.calendar_events WHERE event_type = p_type
$$;

-- Prazos por tipo
CREATE OR REPLACE FUNCTION public.count_deadlines_by_type(p_type text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.deadlines WHERE type = p_type
$$;

-- GRANTS: permitir que usuários autenticados chamem estas funções
GRANT EXECUTE ON FUNCTION public.count_processes_by_status(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_deadlines_by_status(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_deadlines_by_priority(text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_leads_by_stage(text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_clients_by_status(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_requirements_by_status(text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_calendar_events_by_type(text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_deadlines_by_type(text)         TO authenticated;
