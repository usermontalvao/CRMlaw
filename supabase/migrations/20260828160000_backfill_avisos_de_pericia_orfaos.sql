-- Adota os avisos de perícia que nasceram órfãos.
--
-- Os primeiros lembretes agendados saíram ANTES de `requirement_id` existir.
-- O resultado era o pior estado possível: o aviso estava vivo na fila do
-- WhatsApp e a tela do requerimento dizia "cliente não será avisado" e o
-- interruptor aparecia desligado — duas telas do mesmo sistema afirmando o
-- contrário uma da outra, e a correção da data não desarmaria nada.
--
-- O casamento é pelo PROTOCOLO impresso no corpo da mensagem ("Protocolo:
-- 1506198639"), não pelo cliente: cliente pode ter mais de um requerimento, e
-- ligar ao errado seria pior do que deixar órfão. Sem protocolo no corpo, a
-- linha continua órfã de propósito.
--
-- Idempotente: só toca em quem ainda está sem vínculo.

UPDATE public.whatsapp_scheduled_messages s
SET requirement_id = r.id,
    pericia_kind = CASE
      WHEN s.body ILIKE '%perícia social%' THEN 'social'
      WHEN s.body ILIKE '%perícia médica%' THEN 'medica'
    END
FROM public.requirements r
WHERE s.requirement_id IS NULL
  AND s.status IN ('pending', 'failed')
  AND s.body ILIKE '%Passando para lembrar da sua *perícia%'
  AND (s.body ILIKE '%perícia social%' OR s.body ILIKE '%perícia médica%')
  AND r.protocol IS NOT NULL
  AND length(r.protocol) >= 6
  AND s.body LIKE '%Protocolo: ' || r.protocol || '%';
