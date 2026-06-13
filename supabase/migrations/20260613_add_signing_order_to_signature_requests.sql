-- Ordem de assinatura por solicitação:
--   parallel   → qualquer signatário pode assinar a qualquer momento (comportamento legado/default)
--   sequential → o signatário de "order" N só pode assinar após todos os de "order" menor terem assinado
-- Solicitações existentes recebem 'parallel' (sem mudança de comportamento).

alter table public.signature_requests
  add column if not exists signing_order text not null default 'parallel';

alter table public.signature_requests
  drop constraint if exists signature_requests_signing_order_check;

alter table public.signature_requests
  add constraint signature_requests_signing_order_check
  check (signing_order in ('parallel','sequential'));

comment on column public.signature_requests.signing_order is
  'Ordem de assinatura: parallel (qualquer signatário a qualquer momento) ou sequential (cada signatário só assina após os de order menor).';
