-- Instruções personalizadas de cada perícia.
--
-- O aviso ao cliente já diz o que TODA perícia daquele tipo pede — laudos e
-- exames na médica, comprovantes de despesa na social. Isto aqui é o que só
-- AQUELA perícia pede: chegar 30 minutos antes, levar acompanhante, o exame
-- que o médico ainda vai entregar, o telefone para remarcar.
--
-- Fica no requerimento, e não no texto do aviso, porque é informação do caso:
-- sobrevive ao reagendamento, aparece na ficha e entra sozinha na mensagem.

ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS pericia_social_instrucoes text NULL,
  ADD COLUMN IF NOT EXISTS pericia_medica_instrucoes text NULL;

COMMENT ON COLUMN public.requirements.pericia_social_instrucoes IS 'Instruções extras da perícia social, escritas à mão; entram no aviso ao cliente.';
COMMENT ON COLUMN public.requirements.pericia_medica_instrucoes IS 'Instruções extras da perícia médica, escritas à mão; entram no aviso ao cliente.';
