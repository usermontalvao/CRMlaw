-- ================================================
-- CORREÇÃO: Recriar tabela de análises de IA
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- ================================================

-- 1. Deletar tabela existente (se houver)
DROP TABLE IF EXISTS public.intimation_ai_analysis CASCADE;

-- 2. Criar tabela corrigida
CREATE TABLE public.intimation_ai_analysis (
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
  
  -- Metadados (sem foreign key para auth.users)
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  analyzed_by UUID,
  model_used TEXT DEFAULT 'gpt-4o-mini',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Garantir uma análise por intimação
  UNIQUE(intimation_id)
);

-- 3. Índices para performance
CREATE INDEX idx_intimation_ai_analysis_intimation_id 
  ON public.intimation_ai_analysis(intimation_id);

CREATE INDEX idx_intimation_ai_analysis_urgency 
  ON public.intimation_ai_analysis(urgency);

CREATE INDEX idx_intimation_ai_analysis_analyzed_at 
  ON public.intimation_ai_analysis(analyzed_at DESC);

-- 4. Trigger para atualizar updated_at
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

-- 5. Políticas RLS
ALTER TABLE public.intimation_ai_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todas operações em análises de IA"
  ON public.intimation_ai_analysis
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ================================================
-- CONCLUÍDO
-- ================================================
-- Tabela recriada sem a constraint problemática
-- ================================================
