-- ================================================
-- TABELA PARA ARMAZENAR ANÁLISES DE IA DAS INTIMAÇÕES
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- ================================================

-- Criar tabela de análises de IA
CREATE TABLE IF NOT EXISTS public.intimation_ai_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intimation_id UUID NOT NULL REFERENCES public.djen_comunicacoes(id) ON DELETE CASCADE,
  
  -- Análise
  summary TEXT,
  urgency TEXT CHECK (urgency IN ('baixa', 'media', 'alta', 'critica')),
  document_type TEXT,
  
  -- Prazo extraído
  deadline_days INTEGER,
  deadline_due_date TIMESTAMPTZ,
  deadline_description TEXT,
  deadline_confidence TEXT CHECK (deadline_confidence IN ('baixa', 'media', 'alta')),
  
  -- Sugestões e pontos-chave
  suggested_actions JSONB DEFAULT '[]'::jsonb,
  key_points JSONB DEFAULT '[]'::jsonb,
  
  -- Metadados
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  analyzed_by UUID,
  model_used TEXT DEFAULT 'gpt-4o-mini',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Garantir uma análise por intimação
  UNIQUE(intimation_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_intimation_ai_analysis_intimation_id 
  ON public.intimation_ai_analysis(intimation_id);

CREATE INDEX IF NOT EXISTS idx_intimation_ai_analysis_urgency 
  ON public.intimation_ai_analysis(urgency);

CREATE INDEX IF NOT EXISTS idx_intimation_ai_analysis_analyzed_at 
  ON public.intimation_ai_analysis(analyzed_at DESC);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_intimation_ai_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_intimation_ai_analysis_updated_at
  BEFORE UPDATE ON public.intimation_ai_analysis
  FOR EACH ROW
  EXECUTE FUNCTION update_intimation_ai_analysis_updated_at();

-- ================================================
-- POLÍTICAS RLS (Row Level Security)
-- ================================================

ALTER TABLE public.intimation_ai_analysis ENABLE ROW LEVEL SECURITY;

-- Permitir todas operações (ajuste conforme necessário)
CREATE POLICY "Permitir todas operações em análises de IA"
  ON public.intimation_ai_analysis
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ================================================
-- COMENTÁRIOS
-- ================================================

COMMENT ON TABLE public.intimation_ai_analysis IS 'Armazena análises de IA das intimações do DJEN';
COMMENT ON COLUMN public.intimation_ai_analysis.intimation_id IS 'Referência à intimação analisada';
COMMENT ON COLUMN public.intimation_ai_analysis.summary IS 'Resumo gerado pela IA';
COMMENT ON COLUMN public.intimation_ai_analysis.urgency IS 'Nível de urgência identificado';
COMMENT ON COLUMN public.intimation_ai_analysis.deadline_days IS 'Número de dias do prazo extraído';
COMMENT ON COLUMN public.intimation_ai_analysis.deadline_due_date IS 'Data de vencimento calculada (dias úteis)';
COMMENT ON COLUMN public.intimation_ai_analysis.suggested_actions IS 'Array JSON de ações sugeridas';
COMMENT ON COLUMN public.intimation_ai_analysis.key_points IS 'Array JSON de pontos-chave';

-- ================================================
-- CONCLUÍDO
-- ================================================
-- Execute este SQL no Supabase e depois atualize o código
-- ================================================
