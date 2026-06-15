-- Gênero do colaborador: usado para o tratamento Dr./Dra. no atendimento WhatsApp.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT '';  -- '' | 'male' | 'female'
