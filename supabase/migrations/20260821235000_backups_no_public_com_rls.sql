-- ============================================================================
-- Quatro cópias de trabalho no schema `public`, com RLS desligada.
--
-- `wa_ai_prompt_backup` (prompts do agente) e as três `djen_backup_20260817*`
-- (intimações, prazos e agenda) foram criadas como backup de uma migração e
-- ficaram para trás. Sem RLS, no schema `public`, elas eram legíveis por
-- qualquer sessão autenticada via PostgREST — e o Security Advisor do Supabase
-- as apontava como ERRO, os únicos quatro do projeto.
--
-- Nenhuma linha do repositório as consulta: backup se lê pelo painel ou com
-- service role. Ligar RLS SEM policy nenhuma é exatamente isso — `anon` e
-- `authenticated` passam a enxergar zero linhas; `service_role` continua
-- enxergando tudo, porque ignora RLS por definição. O REVOKE é a segunda
-- tranca: sem ele, criar uma policy por engano no futuro reabriria a porta.
-- ============================================================================
ALTER TABLE public.wa_ai_prompt_backup           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.djen_backup_20260817          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.djen_backup_20260817_prazos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.djen_backup_20260817_agenda   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wa_ai_prompt_backup         FROM anon, authenticated;
REVOKE ALL ON TABLE public.djen_backup_20260817        FROM anon, authenticated;
REVOKE ALL ON TABLE public.djen_backup_20260817_prazos FROM anon, authenticated;
REVOKE ALL ON TABLE public.djen_backup_20260817_agenda FROM anon, authenticated;

COMMENT ON TABLE public.wa_ai_prompt_backup IS
  'Backup dos prompts do agente. RLS ligada sem policy: só service role lê.';
