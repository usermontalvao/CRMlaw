-- GIF na conversa do WhatsApp.
--
-- O WhatsApp não entrega GIF como GIF: ele converte para mp4 e marca o payload
-- com `gifPlayback`. Sem persistir essa marca, o cliente não tem como separar um
-- GIF de um vídeo curto — e passava a mostrar um play parado no lugar da
-- animação. Com a coluna, a bolha toca em laço, mudo e sem controles.
--
-- Default `false` mantém todo o histórico já gravado com o comportamento atual
-- (vídeo com controles); só as mensagens novas trazem a marca.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS is_animated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_messages.is_animated IS
  'Vídeo que na verdade é um GIF (gifPlayback do WhatsApp): toca em laço, mudo e sem controles.';
