-- ─────────────────────────────────────────────────────────────────────────────
-- CONVERSA INTERNA — o aviso ao time não é atendimento.
--
-- O CRM passa a mandar aviso de prazo pelo WhatsApp para o telefone de quem é
-- responsável. Só que o Evolution não tem "mensagem avulsa": todo envio cria (ou
-- reaproveita) uma conversa, e sem marca nenhuma esses avisos entrariam na
-- caixa de entrada lado a lado com os clientes — inflando não-lidas, entrando na
-- conta do SLA e fazendo o atendente abrir uma thread que não tem ninguém do
-- outro lado esperando resposta.
--
-- `is_internal` separa as duas naturezas. A conversa continua existindo (o
-- histórico do que foi avisado tem valor, e o envio precisa de uma thread para
-- gravar a mensagem), mas some da lista, do widget e dos contadores.
--
-- NÃO é permissão: quem tem acesso ao canal continua podendo ler a conversa
-- interna se for atrás dela. É arrumação de caixa de entrada.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_conversations
  add column if not exists is_internal boolean not null default false;

comment on column public.whatsapp_conversations.is_internal is
  'Conversa de aviso ao time (prazo, sistema), não atendimento de cliente. Escondida da inbox, do widget e dos contadores.';

-- A inbox pede "as não internas, mais recentes primeiro" em toda abertura de
-- tela. O índice parcial cobre exatamente essa consulta e não paga nada pelas
-- internas, que são poucas.
create index if not exists idx_wa_conversations_inbox_nao_interna
  on public.whatsapp_conversations (last_message_at desc nulls last)
  where is_internal = false;
