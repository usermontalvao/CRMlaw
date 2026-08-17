-- O que a agenda da "Nova conversa" sabe sobre um número ANTES de alguém falar
-- com ele: se aquele número tem WhatsApp e qual é a foto de perfil dele.
--
-- A agenda já nascia com rosto para quem o escritório JÁ atendeu — a foto vinha
-- de `whatsapp_conversations.contact_avatar_path`. Só que a maior parte da
-- agenda é gente com quem nunca se conversou por ali: cadastro antigo, cliente
-- de processo, telefone anotado no atendimento presencial. Para esses a lista
-- mostrava iniciais e, pior, não dizia o que o atendente mais precisa saber
-- antes de clicar: se aquele número sequer tem WhatsApp.
--
-- Esta tabela é o CACHE dessa pergunta. Quem responde é a Evolution
-- (`/chat/whatsappNumbers` e `/chat/fetchProfilePictureUrl`), pela Edge Function
-- `whatsapp-contact-probe`, e ela só é consultada para os números que aparecem
-- na tela — rolar a agenda inteira não dispara uma varredura no servidor do
-- WhatsApp, que é exatamente o tipo de tráfego que derruba instância.
--
-- A chave é o telefone NORMALIZADO (dígitos com o 55 na frente), o mesmo
-- formato que `normalizePhone` produz no navegador e que a Evolution devolve no
-- jid. Guardar o número como está no cadastro faria a mesma pessoa ser sondada
-- de novo a cada variação de formatação.

CREATE TABLE IF NOT EXISTS public.whatsapp_contact_probes (
  phone        text PRIMARY KEY,
  -- NULL enquanto a resposta não veio (lookup fora do ar). Só false quando a
  -- Evolution disse, com todas as letras, que o número não existe.
  has_whatsapp boolean,
  -- JID confirmado: já vem com a variante certa do nono dígito brasileiro.
  jid          text,
  -- Cópia da foto no bucket whatsapp-media. A URL do CDN do WhatsApp expira em
  -- horas; o caminho aqui é assinado na hora de mostrar, como o resto do módulo.
  avatar_path  text,
  checked_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_contact_probes IS
  'Cache por número: tem WhatsApp? qual a foto de perfil? Preenchido sob demanda pela Edge Function whatsapp-contact-probe a partir da Evolution.';

CREATE INDEX IF NOT EXISTS whatsapp_contact_probes_checked_idx
  ON public.whatsapp_contact_probes (checked_at DESC);

ALTER TABLE public.whatsapp_contact_probes ENABLE ROW LEVEL SECURITY;

-- Leitura para quem atende; escrita só pela Edge Function (service role, que
-- não passa por RLS). Ninguém no navegador inventa "este número tem WhatsApp".
DROP POLICY IF EXISTS whatsapp_contact_probes_select ON public.whatsapp_contact_probes;
CREATE POLICY whatsapp_contact_probes_select ON public.whatsapp_contact_probes
  FOR SELECT TO authenticated
  USING (public.is_office_staff());
