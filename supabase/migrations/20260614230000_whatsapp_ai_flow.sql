-- Fase J: Atendimento assistido por IA — configuração, playbooks e sessões de coleta

-- 1. Config de IA habilitada por canal (um registro por whatsapp_instances)
CREATE TABLE whatsapp_ai_channel_config (
  channel_id       UUID PRIMARY KEY REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  ai_enabled       BOOLEAN NOT NULL DEFAULT false,
  max_ai_turns     INT NOT NULL DEFAULT 5,
  playbook_id      UUID,  -- FK adicionada após tabela de playbooks
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- 2. Playbooks: roteiros de coleta estruturada com perguntas obrigatórias
CREATE TABLE whatsapp_ai_playbooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT NOT NULL DEFAULT 'intake',  -- intake | followup | documents | custom
  welcome_message  TEXT NOT NULL DEFAULT 'Olá! Sou o assistente do escritório. Como posso ajudar?',
  questions        JSONB NOT NULL DEFAULT '[]',
  -- cada elemento: {key: string, label: string, required: boolean, type: "text"|"phone"|"date"|"choice", choices?: string[]}
  handoff_message  TEXT NOT NULL DEFAULT 'Aguarde, vou encaminhar seu atendimento para um de nossos advogados.',
  system_prompt    TEXT,  -- prompt customizado para modo IA livre (sem roteiro guiado)
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- FK de config para playbook
ALTER TABLE whatsapp_ai_channel_config
  ADD CONSTRAINT fk_ai_config_playbook
  FOREIGN KEY (playbook_id) REFERENCES whatsapp_ai_playbooks(id) ON DELETE SET NULL;

-- 3. Sessões de IA: rastreiam estado do atendimento automático por conversa
CREATE TABLE whatsapp_ai_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL UNIQUE REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  playbook_id      UUID REFERENCES whatsapp_ai_playbooks(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'completed', 'handed_off', 'aborted')),
  current_step     INT NOT NULL DEFAULT 0,
  collected_data   JSONB NOT NULL DEFAULT '{}',  -- {key: resposta_do_cliente}
  turn_count       INT NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  handoff_summary  TEXT  -- resumo gerado no handoff (persiste para a nota interna)
);

-- RLS: staff apenas (service_role bypassa para o webhook/edge)
ALTER TABLE whatsapp_ai_channel_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_ai_playbooks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_ai_sessions       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_config_staff" ON whatsapp_ai_channel_config
  FOR ALL TO authenticated USING (public.is_office_staff());
CREATE POLICY "ai_playbooks_staff" ON whatsapp_ai_playbooks
  FOR ALL TO authenticated USING (public.is_office_staff());
CREATE POLICY "ai_sessions_staff" ON whatsapp_ai_sessions
  FOR ALL TO authenticated USING (public.is_office_staff());

-- Realtime para sessões (banner na UI reage a mudanças de status em tempo real)
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_ai_sessions;

-- Playbook padrão de triagem jurídica inicial
INSERT INTO whatsapp_ai_playbooks (name, description, category, welcome_message, questions, handoff_message)
VALUES (
  'Triagem inicial',
  'Coleta dados básicos antes de transferir para advogado',
  'intake',
  'Olá! Sou o assistente jurídico do escritório. Antes de conectá-lo com nossa equipe, preciso de algumas informações rápidas.',
  '[
    {"key":"nome","label":"Qual é o seu nome completo?","required":true,"type":"text"},
    {"key":"assunto","label":"Qual é o assunto do seu contato? (Ex: trabalhista, previdenciário, família, outro)","required":true,"type":"text"},
    {"key":"urgente","label":"O assunto tem prazo urgente? (Sim / Não)","required":false,"type":"text"}
  ]'::jsonb,
  'Obrigado pelas informações! Vou encaminhar seu atendimento para um de nossos advogados. Por favor aguarde.'
);
