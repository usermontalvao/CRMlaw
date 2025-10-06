-- Script para adicionar emails de teste
-- Execute este SQL após ter uma conta de email cadastrada

-- Insere emails de teste na caixa de entrada
-- IMPORTANTE: Substitua 'SEU_ACCOUNT_ID_AQUI' pelo ID real da sua conta de email
-- Para pegar o ID: SELECT id FROM email_accounts WHERE email = 'pedro@advcuiaba.com';

DO $$
DECLARE
  v_account_id UUID;
BEGIN
  -- Pega o ID da primeira conta de email ativa
  SELECT id INTO v_account_id FROM email_accounts WHERE is_active = true LIMIT 1;
  
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma conta de email encontrada. Adicione uma conta primeiro.';
  END IF;

  -- Email 1: Não lido, com anexo
  INSERT INTO emails (
    account_id,
    message_id,
    "from",
    "to",
    subject,
    body_text,
    body_html,
    received_at,
    is_read,
    is_starred,
    has_attachments,
    folder
  ) VALUES (
    v_account_id,
    '<test-001@advcuiaba.com>',
    'João Silva <joao.silva@exemplo.com>',
    ARRAY['pedro@advcuiaba.com'],
    'Consulta sobre processo trabalhista',
    'Prezado Dr. Pedro,

Gostaria de agendar uma consulta para discutir um processo trabalhista. Tenho algumas dúvidas sobre rescisão indireta.

Quando poderia me atender?

Atenciosamente,
João Silva',
    '<p>Prezado Dr. Pedro,</p><p>Gostaria de agendar uma consulta para discutir um processo trabalhista. Tenho algumas dúvidas sobre rescisão indireta.</p><p>Quando poderia me atender?</p><p>Atenciosamente,<br>João Silva</p>',
    NOW() - INTERVAL '2 hours',
    false,
    false,
    true,
    'inbox'
  );

  -- Email 2: Lido, favorito
  INSERT INTO emails (
    account_id,
    message_id,
    "from",
    "to",
    subject,
    body_text,
    received_at,
    is_read,
    is_starred,
    has_attachments,
    folder
  ) VALUES (
    v_account_id,
    '<test-002@advcuiaba.com>',
    'Maria Santos <maria.santos@tribunal.jus.br>',
    ARRAY['pedro@advcuiaba.com'],
    'Intimação - Processo 0001234-56.2024.5.23.0001',
    'Senhor Advogado,

Fica Vossa Senhoria intimado para apresentar contrarrazões no prazo de 15 dias.

Processo: 0001234-56.2024.5.23.0001
Prazo: 15 dias úteis

Atenciosamente,
Secretaria da 1ª Vara do Trabalho',
    NOW() - INTERVAL '1 day',
    true,
    true,
    false,
    'inbox'
  );

  -- Email 3: Não lido, urgente
  INSERT INTO emails (
    account_id,
    message_id,
    "from",
    "to",
    cc,
    subject,
    body_text,
    received_at,
    is_read,
    is_starred,
    has_attachments,
    folder
  ) VALUES (
    v_account_id,
    '<test-003@advcuiaba.com>',
    'Carlos Oliveira <carlos@cliente.com>',
    ARRAY['pedro@advcuiaba.com'],
    ARRAY['assistente@advcuiaba.com'],
    'URGENTE: Audiência remarcada para amanhã',
    'Dr. Pedro,

A audiência do processo 0007890-12.2024.5.23.0002 foi remarcada para AMANHÃ às 14h.

Por favor, confirme o recebimento.

Carlos Oliveira',
    NOW() - INTERVAL '30 minutes',
    false,
    false,
    false,
    'inbox'
  );

  -- Email 4: Enviado
  INSERT INTO emails (
    account_id,
    message_id,
    "from",
    "to",
    subject,
    body_text,
    received_at,
    is_read,
    is_starred,
    has_attachments,
    folder
  ) VALUES (
    v_account_id,
    '<test-004@advcuiaba.com>',
    'pedro@advcuiaba.com',
    ARRAY['cliente@exemplo.com'],
    'Re: Documentação do processo',
    'Prezado Cliente,

Segue em anexo a documentação solicitada.

Qualquer dúvida estou à disposição.

Atenciosamente,
Dr. Pedro Montalvão',
    NOW() - INTERVAL '3 hours',
    true,
    false,
    true,
    'sent'
  );

  -- Email 5: Spam na lixeira
  INSERT INTO emails (
    account_id,
    message_id,
    "from",
    "to",
    subject,
    body_text,
    received_at,
    is_read,
    is_starred,
    has_attachments,
    folder
  ) VALUES (
    v_account_id,
    '<test-005@advcuiaba.com>',
    'marketing@spam.com',
    ARRAY['pedro@advcuiaba.com'],
    'Promoção imperdível!',
    'Clique aqui para ganhar prêmios...',
    NOW() - INTERVAL '2 days',
    true,
    false,
    false,
    'trash'
  );

  -- Email 6: Não lido, com múltiplos destinatários
  INSERT INTO emails (
    account_id,
    message_id,
    "from",
    "to",
    cc,
    subject,
    body_text,
    received_at,
    is_read,
    is_starred,
    has_attachments,
    folder
  ) VALUES (
    v_account_id,
    '<test-006@advcuiaba.com>',
    'Secretaria TRT <secretaria@trt23.jus.br>',
    ARRAY['pedro@advcuiaba.com', 'outro.advogado@oab.com'],
    ARRAY['coordenacao@trt23.jus.br'],
    'Pauta de julgamento - Sessão 15/01/2025',
    'Senhores Advogados,

Segue pauta de julgamento da sessão ordinária do dia 15/01/2025.

Processo: 0001234-56.2024.5.23.0001
Horário previsto: 10h30

Atenciosamente,
Secretaria do TRT 23ª Região',
    NOW() - INTERVAL '5 hours',
    false,
    true,
    true,
    'inbox'
  );

  RAISE NOTICE 'Emails de teste inseridos com sucesso para account_id: %', v_account_id;
END $$;
