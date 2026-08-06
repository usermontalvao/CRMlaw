-- Tira do PUBLIC o EXECUTE de ops.purge_cron_history.
--
-- Corretiva de 20260805235500_cron_history_retention.sql, que já está
-- aplicada — por isso vem em migration nova, e não editando aquela.
--
-- Na prática ninguém de fora conseguia chamar: `anon` e `authenticated` não
-- têm USAGE no schema `ops`, e o PostgREST só expõe `public`. Mas o EXECUTE
-- vinha de graça pelo PUBLIC, e uma função que apaga histórico não tem por que
-- ficar ao alcance de quem quer que seja além do cron. Quem roda o job é o
-- dono (postgres), que não depende deste grant.

revoke all on function ops.purge_cron_history(int, int) from public;
revoke all on function ops.purge_cron_history(int, int) from anon, authenticated;
