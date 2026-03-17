-- =====================================================
-- MÓDULO DE PREPOSTOS (Representatives)
-- Cadastro de prepostos e vinculação a compromissos
-- =====================================================

-- Tabela de Prepostos
CREATE TABLE IF NOT EXISTS public.representatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  cpf TEXT,
  phone TEXT,
  email TEXT,
  pix_key TEXT,
  bank_name TEXT,
  bank_agency TEXT,
  bank_account TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Tabela de Vínculo Preposto-Compromisso
CREATE TABLE IF NOT EXISTS public.representative_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id UUID NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  calendar_event_id UUID NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  
  -- Dados do serviço
  service_date DATE NOT NULL,
  service_description TEXT,
  
  -- Status do serviço
  service_status TEXT NOT NULL DEFAULT 'agendado' CHECK (service_status IN ('agendado', 'confirmado', 'realizado', 'cancelado', 'nao_compareceu')),
  
  -- Dados financeiros
  service_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente', 'pago', 'cancelado')),
  payment_date DATE,
  payment_method TEXT CHECK (payment_method IN ('pix', 'transferencia', 'dinheiro', 'cheque', 'outro')),
  payment_receipt TEXT,
  payment_notes TEXT,
  
  -- Metadados
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  
  -- Evitar duplicatas
  UNIQUE(representative_id, calendar_event_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_representatives_status ON public.representatives(status);
CREATE INDEX IF NOT EXISTS idx_representatives_full_name ON public.representatives(full_name);
CREATE INDEX IF NOT EXISTS idx_representative_appointments_representative_id ON public.representative_appointments(representative_id);
CREATE INDEX IF NOT EXISTS idx_representative_appointments_calendar_event_id ON public.representative_appointments(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_representative_appointments_service_date ON public.representative_appointments(service_date);
CREATE INDEX IF NOT EXISTS idx_representative_appointments_service_status ON public.representative_appointments(service_status);
CREATE INDEX IF NOT EXISTS idx_representative_appointments_payment_status ON public.representative_appointments(payment_status);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_representatives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_representatives_updated_at
  BEFORE UPDATE ON public.representatives
  FOR EACH ROW
  EXECUTE FUNCTION update_representatives_updated_at();

CREATE TRIGGER trigger_representative_appointments_updated_at
  BEFORE UPDATE ON public.representative_appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_representatives_updated_at();

-- RLS (Row Level Security)
ALTER TABLE public.representatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.representative_appointments ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para representatives
CREATE POLICY "representatives_select_authenticated" ON public.representatives
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "representatives_insert_authenticated" ON public.representatives
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "representatives_update_authenticated" ON public.representatives
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "representatives_delete_authenticated" ON public.representatives
  FOR DELETE TO authenticated USING (true);

-- Políticas RLS para representative_appointments
CREATE POLICY "representative_appointments_select_authenticated" ON public.representative_appointments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "representative_appointments_insert_authenticated" ON public.representative_appointments
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "representative_appointments_update_authenticated" ON public.representative_appointments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "representative_appointments_delete_authenticated" ON public.representative_appointments
  FOR DELETE TO authenticated USING (true);

-- Comentários
COMMENT ON TABLE public.representatives IS 'Cadastro de prepostos para audiências e compromissos';
COMMENT ON TABLE public.representative_appointments IS 'Vínculo entre prepostos e compromissos da agenda, com controle financeiro';
COMMENT ON COLUMN public.representatives.pix_key IS 'Chave PIX para pagamento do preposto';
COMMENT ON COLUMN public.representative_appointments.service_value IS 'Valor cobrado pelo serviço do preposto';
COMMENT ON COLUMN public.representative_appointments.payment_status IS 'Status do pagamento: pendente, pago, cancelado';
COMMENT ON COLUMN public.representative_appointments.payment_receipt IS 'Comprovante de pagamento (URL ou referência)';
