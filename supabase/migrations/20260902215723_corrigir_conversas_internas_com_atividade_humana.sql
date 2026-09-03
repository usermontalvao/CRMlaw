-- Repara threads humanas que um lembrete interno reaproveitou e escondeu.
--
-- `is_internal` descreve uma conversa criada EXCLUSIVAMENTE para avisos do
-- sistema. Se o contato já escreveu, existe cliente/responsável ou uma pessoa
-- do escritório já respondeu pelo CRM, a thread é atendimento e deve voltar à
-- inbox. O webhook e o evolution-send passam a manter essa transição daqui em
-- diante; este UPDATE limpa somente o passado contaminado.
update public.whatsapp_conversations c
set is_internal = false
where c.is_internal = true
  and (
    c.client_id is not null
    or c.assigned_user_id is not null
    or c.last_customer_message_at is not null
    or exists (
      select 1
      from public.whatsapp_messages m
      where m.conversation_id = c.id
        and (m.direction = 'in' or m.sender_user_id is not null)
    )
  );
