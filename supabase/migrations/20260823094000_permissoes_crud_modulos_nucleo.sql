-- A matriz de Configurações → Permissões passa a valer também no banco.
--
-- Antes, estas tabelas tinham uma policy FOR ALL baseada apenas em
-- is_office_staff(): qualquer funcionário autenticado podia criar, editar e
-- excluir via Data API, mesmo com a ação desmarcada para o cargo. A interface
-- agora avisa antes do PIN, mas RLS continua sendo a autoridade final.

-- ── Clientes ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em clientes" ON public.clients;
CREATE POLICY clients_staff_select_by_permission ON public.clients
  FOR SELECT TO authenticated USING (public.has_module_permission('clientes', 'view'));
CREATE POLICY clients_staff_insert_by_permission ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('clientes', 'create'));
CREATE POLICY clients_staff_update_by_permission ON public.clients
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('clientes', 'edit'))
  WITH CHECK (public.has_module_permission('clientes', 'edit'));
CREATE POLICY clients_staff_delete_by_permission ON public.clients
  FOR DELETE TO authenticated USING (public.has_module_permission('clientes', 'delete'));

-- ── Leads ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em leads" ON public.leads;
CREATE POLICY leads_staff_select_by_permission ON public.leads
  FOR SELECT TO authenticated USING (public.has_module_permission('leads', 'view'));
CREATE POLICY leads_staff_insert_by_permission ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('leads', 'create'));
CREATE POLICY leads_staff_update_by_permission ON public.leads
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('leads', 'edit'))
  WITH CHECK (public.has_module_permission('leads', 'edit'));
CREATE POLICY leads_staff_delete_by_permission ON public.leads
  FOR DELETE TO authenticated USING (public.has_module_permission('leads', 'delete'));

-- ── Processos ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em processos" ON public.processes;
CREATE POLICY processes_staff_select_by_permission ON public.processes
  FOR SELECT TO authenticated USING (public.has_module_permission('processos', 'view'));
CREATE POLICY processes_staff_insert_by_permission ON public.processes
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('processos', 'create'));
CREATE POLICY processes_staff_update_by_permission ON public.processes
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('processos', 'edit'))
  WITH CHECK (public.has_module_permission('processos', 'edit'));
CREATE POLICY processes_staff_delete_by_permission ON public.processes
  FOR DELETE TO authenticated USING (public.has_module_permission('processos', 'delete'));

-- ── Requerimentos ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em requerimentos" ON public.requirements;
CREATE POLICY requirements_staff_select_by_permission ON public.requirements
  FOR SELECT TO authenticated USING (public.has_module_permission('requerimentos', 'view'));
CREATE POLICY requirements_staff_insert_by_permission ON public.requirements
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('requerimentos', 'create'));
CREATE POLICY requirements_staff_update_by_permission ON public.requirements
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('requerimentos', 'edit'))
  WITH CHECK (public.has_module_permission('requerimentos', 'edit'));
CREATE POLICY requirements_staff_delete_by_permission ON public.requirements
  FOR DELETE TO authenticated USING (public.has_module_permission('requerimentos', 'delete'));

-- ── Prazos ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em prazos" ON public.deadlines;
CREATE POLICY deadlines_staff_select_by_permission ON public.deadlines
  FOR SELECT TO authenticated USING (public.has_module_permission('prazos', 'view'));
CREATE POLICY deadlines_staff_insert_by_permission ON public.deadlines
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('prazos', 'create'));
CREATE POLICY deadlines_staff_update_by_permission ON public.deadlines
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('prazos', 'edit'))
  WITH CHECK (public.has_module_permission('prazos', 'edit'));
CREATE POLICY deadlines_staff_delete_by_permission ON public.deadlines
  FOR DELETE TO authenticated USING (public.has_module_permission('prazos', 'delete'));

-- ── Agenda ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em eventos" ON public.calendar_events;
CREATE POLICY calendar_staff_select_by_permission ON public.calendar_events
  FOR SELECT TO authenticated USING (public.has_module_permission('agenda', 'view'));
CREATE POLICY calendar_staff_insert_by_permission ON public.calendar_events
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('agenda', 'create'));
CREATE POLICY calendar_staff_update_by_permission ON public.calendar_events
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('agenda', 'edit'))
  WITH CHECK (public.has_module_permission('agenda', 'edit'));
CREATE POLICY calendar_staff_delete_by_permission ON public.calendar_events
  FOR DELETE TO authenticated USING (public.has_module_permission('agenda', 'delete'));

-- ── Tarefas ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em tarefas" ON public.tasks;
CREATE POLICY tasks_staff_select_by_permission ON public.tasks
  FOR SELECT TO authenticated USING (public.has_module_permission('tarefas', 'view'));
CREATE POLICY tasks_staff_insert_by_permission ON public.tasks
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('tarefas', 'create'));
CREATE POLICY tasks_staff_update_by_permission ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('tarefas', 'edit'))
  WITH CHECK (public.has_module_permission('tarefas', 'edit'));
CREATE POLICY tasks_staff_delete_by_permission ON public.tasks
  FOR DELETE TO authenticated USING (public.has_module_permission('tarefas', 'delete'));

-- ── Financeiro ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em acordos" ON public.agreements;
CREATE POLICY agreements_staff_select_by_permission ON public.agreements
  FOR SELECT TO authenticated USING (public.has_module_permission('financeiro', 'view'));
CREATE POLICY agreements_staff_insert_by_permission ON public.agreements
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('financeiro', 'create'));
CREATE POLICY agreements_staff_update_by_permission ON public.agreements
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('financeiro', 'edit'))
  WITH CHECK (public.has_module_permission('financeiro', 'edit'));
CREATE POLICY agreements_staff_delete_by_permission ON public.agreements
  FOR DELETE TO authenticated USING (public.has_module_permission('financeiro', 'delete'));

DROP POLICY IF EXISTS "Permitir todas operações em parcelas" ON public.installments;
CREATE POLICY installments_staff_select_by_permission ON public.installments
  FOR SELECT TO authenticated USING (public.has_module_permission('financeiro', 'view'));
CREATE POLICY installments_staff_insert_by_permission ON public.installments
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('financeiro', 'create'));
CREATE POLICY installments_staff_update_by_permission ON public.installments
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('financeiro', 'edit'))
  WITH CHECK (public.has_module_permission('financeiro', 'edit'));
CREATE POLICY installments_staff_delete_by_permission ON public.installments
  FOR DELETE TO authenticated USING (public.has_module_permission('financeiro', 'delete'));

-- ── Intimações locais ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir todas operações em comunicações" ON public.djen_comunicacoes;
CREATE POLICY djen_staff_select_by_permission ON public.djen_comunicacoes
  FOR SELECT TO authenticated USING (public.has_module_permission('intimacoes', 'view'));
CREATE POLICY djen_staff_insert_by_permission ON public.djen_comunicacoes
  FOR INSERT TO authenticated WITH CHECK (public.has_module_permission('intimacoes', 'create'));
CREATE POLICY djen_staff_update_by_permission ON public.djen_comunicacoes
  FOR UPDATE TO authenticated
  USING (public.has_module_permission('intimacoes', 'edit'))
  WITH CHECK (public.has_module_permission('intimacoes', 'edit'));
CREATE POLICY djen_staff_delete_by_permission ON public.djen_comunicacoes
  FOR DELETE TO authenticated USING (public.has_module_permission('intimacoes', 'delete'));
