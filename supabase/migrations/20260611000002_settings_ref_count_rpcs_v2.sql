-- RPCs de contagem de vínculos — complemento v2.
-- Cobre listas que ainda não tinham countRef:
--   requirements.benefit_type, processes.practice_area,
--   clients.marital_status, tasks.priority

-- Requerimentos por tipo de benefício
CREATE OR REPLACE FUNCTION public.count_requirements_by_benefit_type(p_benefit_type text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.requirements WHERE benefit_type::text = p_benefit_type
$$;

-- Processos por área do direito
CREATE OR REPLACE FUNCTION public.count_processes_by_practice_area(p_area text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.processes WHERE practice_area = p_area
$$;

-- Clientes por estado civil
CREATE OR REPLACE FUNCTION public.count_clients_by_marital_status(p_marital text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.clients WHERE marital_status = p_marital
$$;

-- Tarefas por prioridade
CREATE OR REPLACE FUNCTION public.count_tasks_by_priority(p_priority text)
  RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FROM public.tasks WHERE priority = p_priority
$$;

GRANT EXECUTE ON FUNCTION public.count_requirements_by_benefit_type(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_processes_by_practice_area(text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_clients_by_marital_status(text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_tasks_by_priority(text)            TO authenticated;
