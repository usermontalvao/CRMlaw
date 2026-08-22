-- Canal criado depois de 14/06/2026 nasce SEM expediente — e sem expediente ele
-- é lido como fechado.
--
-- A migration que criou `whatsapp_business_hours` semeou seg–sex 08h–18h para
-- as instâncias que existiam NAQUELE dia, e mais nada. O canal "Rescisão
-- Indireta", criado depois, ficou com zero linhas. A tela de Configurações
-- preenche os sete dias com 08:00–18:00 quando não acha linha, então ele
-- APARENTAVA estar configurado até as 18h; a inbox, que lê o banco, não achava
-- agenda nenhuma e mostrava a faixa "fora do horário de atendimento" o dia
-- inteiro. Ninguém tinha como ligar uma coisa na outra olhando a tela.
--
-- Duas partes: preencher quem ficou para trás e fazer o próximo canal já nascer
-- com a agenda. O padrão é o mesmo do seed original.

-- 1. Canais existentes sem NENHUMA linha de expediente.
INSERT INTO whatsapp_business_hours (instance_id, day_of_week, start_time, end_time, is_active)
SELECT i.id, g.dow, '08:00', '18:00', (g.dow BETWEEN 1 AND 5)
FROM whatsapp_instances i
CROSS JOIN generate_series(0, 6) AS g(dow)
WHERE NOT EXISTS (
  SELECT 1 FROM whatsapp_business_hours bh WHERE bh.instance_id = i.id
)
ON CONFLICT (instance_id, day_of_week) DO NOTHING;

-- 2. O próximo canal nasce com a agenda pronta.
--
-- Trigger, e não um INSERT no serviço do app: o canal é criado por mais de um
-- caminho (tela de Configurações, importação, SQL manual) e o que não pode
-- acontecer é um deles esquecer as sete linhas — porque o sintoma disso não é
-- um erro, é uma faixa laranja que ninguém sabe de onde vem.
CREATE OR REPLACE FUNCTION public.wa_seed_business_hours()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO whatsapp_business_hours (instance_id, day_of_week, start_time, end_time, is_active)
  SELECT NEW.id, g.dow, '08:00', '18:00', (g.dow BETWEEN 1 AND 5)
  FROM generate_series(0, 6) AS g(dow)
  ON CONFLICT (instance_id, day_of_week) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_seed_business_hours ON whatsapp_instances;
CREATE TRIGGER trg_wa_seed_business_hours
  AFTER INSERT ON whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.wa_seed_business_hours();

COMMENT ON FUNCTION public.wa_seed_business_hours() IS
  'Semeia os 7 dias de expediente (seg–sex 08h–18h) de um canal recém-criado. '
  'Canal sem linha nenhuma é lido como fechado pela inbox, enquanto a tela de '
  'Configurações mostra o padrão que ainda não foi gravado.';

-- 3. Plantão 24 horas é a agenda CHEIA — sete dias, 00:00 até 24:00 —, não uma
--    coluna nova. Assim o canal de plantão percorre o mesmo caminho de todos os
--    outros (SLA da fila, aviso de ausência, encerramento por inatividade) sem
--    que cada um desses pontos precise conhecer uma segunda regra. `TIME` aceita
--    a hora 24:00, e é ela — não 23:59 — que mantém o último minuto do dia
--    dentro do expediente.
COMMENT ON TABLE whatsapp_business_hours IS
  'Janela de atendimento por dia da semana, no fuso do canal (whatsapp_instances.timezone). '
  'Sete dias ativos de 00:00 a 24:00 = canal 24 horas.';
