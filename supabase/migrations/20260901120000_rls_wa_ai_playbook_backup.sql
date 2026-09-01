-- wa_ai_playbook_backup: cópia de segurança do roteiro da IA do WhatsApp,
-- criada à mão e esquecida sem RLS — qualquer um com a URL do projeto lia (e
-- escrevia) o prompt inteiro. Nenhum código do CRM a consulta, então ela fica
-- fechada para todo mundo: só o service_role (que ignora RLS) alcança.
alter table public.wa_ai_playbook_backup enable row level security;
alter table public.wa_ai_playbook_backup force row level security;

revoke all on public.wa_ai_playbook_backup from anon, authenticated;

comment on table public.wa_ai_playbook_backup is
  'Backup manual do roteiro da IA do WhatsApp. Sem policies e sem grants de propósito: leitura apenas por service_role.';
