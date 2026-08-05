-- Nova origem de alteração do cadastro: 'whatsapp'.
--
-- Ao vincular uma conversa a um cliente cujo número no WhatsApp é diferente do
-- que está na ficha, o atendente pode gravar o número da conversa no campo
-- Celular. Quando Celular e Telefone já estão preenchidos, o Celular é
-- substituído — e o número antigo precisa continuar consultável, como manda a
-- regra do histórico: dado novo entra, dado antigo não some.
--
-- Sem esta origem própria, a troca cairia em 'edicao' e ficaria indistinguível
-- de uma alteração feita à mão na ficha.

alter table public.client_change_history
  drop constraint if exists client_change_history_source_check;

alter table public.client_change_history
  add constraint client_change_history_source_check
  check (source in ('edicao', 'mesclagem', 'portal', 'assinatura', 'importacao', 'whatsapp'));
