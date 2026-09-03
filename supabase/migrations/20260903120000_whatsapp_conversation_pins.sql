-- FIXAR CONVERSA NO TOPO DA PRÓPRIA LISTA.
--
-- A inbox sempre se ordenou por atividade — igual ao WhatsApp, e é a ordem
-- certa para a fila. O que faltava era a exceção: as duas ou três conversas que
-- a pessoa está TRABALHANDO agora e não pode deixar afundar sob as 286 outras
-- toda vez que alguém manda "ok". "Minhas" é um recorte grande demais para
-- isso (uma dúzia de linhas); fixar é a marca fina, feita pela própria pessoa.
--
-- POR USUÁRIO, como o silenciamento (`whatsapp_conversation_mutes`, de onde
-- esta tabela é copiada quase inteira). Fixar é uma decisão sobre a MINHA
-- ordem de trabalho; empurrar a conversa para o topo da tela dos colegas seria
-- decidir a prioridade deles.
CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Desempata a ordem entre as fixadas: a mais recentemente fixada fica em cima.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

COMMENT ON TABLE public.whatsapp_conversation_pins IS
  'Conversas fixadas no topo da lista, por usuário. A presença da linha é o estado; created_at ordena as fixadas entre si (mais nova em cima).';

CREATE INDEX IF NOT EXISTS idx_wa_conv_pins_user ON public.whatsapp_conversation_pins(user_id);

ALTER TABLE public.whatsapp_conversation_pins ENABLE ROW LEVEL SECURITY;

-- Cada usuário só enxerga e mexe nas próprias marcas.
CREATE POLICY "pins_select_own" ON public.whatsapp_conversation_pins
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pins_insert_own" ON public.whatsapp_conversation_pins
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pins_delete_own" ON public.whatsapp_conversation_pins
  FOR DELETE USING (auth.uid() = user_id);

-- SEM REALTIME, e isso é escolha.
--
-- O silenciamento entrou na publicação `supabase_realtime` para o notificador
-- global de outra aba parar de tocar na hora. Fixar não tem urgência nenhuma:
-- quem fixa é a própria pessoa, no próprio aparelho, e a tela dela já foi
-- atualizada no clique. Fixar no computador e ver aparecer no celular sem
-- recarregar não vale o que o decodificador de WAL cobra por tabela publicada
-- (ver a medição de custo do walrus em produção). A outra aba pega a mudança na
-- próxima carga da inbox.
