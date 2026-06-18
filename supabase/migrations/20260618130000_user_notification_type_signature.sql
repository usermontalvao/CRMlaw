-- Faltava o valor de enum para notificações de assinatura. A UI (NotificationBell)
-- já trata 'signature_completed' (badge "CONCLUÍDA", barra de progresso, navegação
-- p/ assinaturas), mas os INSERTs com type='signature_completed' falhavam em
-- silêncio (valor inválido no enum user_notification_type) — por isso nenhuma
-- notificação de assinatura aparecia.
--
-- ADD VALUE precisa ser feito numa transação separada da que USA o valor.
ALTER TYPE public.user_notification_type ADD VALUE IF NOT EXISTS 'signature_completed';
