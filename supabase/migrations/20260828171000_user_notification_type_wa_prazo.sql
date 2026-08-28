-- ─────────────────────────────────────────────────────────────────────────────
-- O CARIMBO DO AVISO DE PRAZO POR WHATSAPP.
--
-- `user_notifications.type` é um ENUM, não texto livre — coisa que só aparece na
-- primeira gravação, porque o `insert` do scheduler não confere o erro que
-- volta. Sem esta linha o efeito seria o pior possível: a mensagem SAI, o
-- carimbo de "já avisei" não entra, e o dedupe deixa passar de novo na hora
-- seguinte. O responsável receberia o mesmo lembrete 24 vezes por dia.
--
-- Descoberto antes de o primeiro aviso sair porque a configuração nasce
-- desligada — foi a consulta de conferência que esbarrou no enum.
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.user_notification_type add value if not exists 'deadline_whatsapp_notice';
