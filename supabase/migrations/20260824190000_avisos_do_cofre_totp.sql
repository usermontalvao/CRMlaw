-- Avisos do cofre TOTP
--
-- Compartilhar uma chave era silencioso: a linha entrava em `totp_permissions`
-- e quem recebeu não ficava sabendo de nada — a chave só aparecia se a pessoa
-- resolvesse abrir o painel por conta própria. O acesso existia sem ninguém
-- para usá-lo.
--
-- O sino do CRM já é o lugar onde o escritório espera saber das coisas, então
-- o cofre passa a falar por ele. Três espécies, porque as três mudam o que a
-- pessoa pode fazer a partir de agora:
--
--   totp_shared      — você ganhou acesso a uma chave
--   totp_revoked     — você perdeu o acesso que tinha
--   totp_transferred — a chave passou a ser SUA (com direito de exportar)
--
-- O segredo não passa por aqui, e nem o código: a notificação diz o NOME da
-- chave e quem mexeu. Ver `totp-vault/index.ts`, que escreve estes avisos
-- fail-soft — aviso que falha não pode desfazer um compartilhamento que já
-- está auditado.

alter type public.user_notification_type add value if not exists 'totp_shared';
alter type public.user_notification_type add value if not exists 'totp_revoked';
alter type public.user_notification_type add value if not exists 'totp_transferred';
