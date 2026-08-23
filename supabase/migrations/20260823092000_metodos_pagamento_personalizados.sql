-- Métodos de pagamento deixam de ser uma lista fechada.
--
-- O escritório passa a criar os seus (boleto, carnê, convênio) em
-- Configurações → Módulos → Financeiro. O CHECK antigo listava os seis nativos
-- na unha: o método novo aparecia na tela de baixa e estourava só na hora de
-- salvar, com erro de constraint — o pior lugar possível para descobrir.
--
-- No lugar da lista fixa, uma regra de formato: é a mesma chave que
-- slugifyPaymentMethod() gera no front (minúsculas, dígitos e _, até 40).

ALTER TABLE public.installments
  DROP CONSTRAINT IF EXISTS installments_payment_method_check;

ALTER TABLE public.installments
  ADD CONSTRAINT installments_payment_method_check
  CHECK (payment_method IS NULL OR payment_method ~ '^[a-z0-9_]{1,40}$');
