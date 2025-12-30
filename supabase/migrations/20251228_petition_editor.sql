-- Migration: Editor de Petições Trabalhistas
-- Módulo isolado - pode ser removido sem afetar outros módulos
-- Para remover: DROP TABLE petition_clauses CASCADE; DROP TABLE saved_petitions CASCADE;

-- Tabela de Cláusulas/Blocos Reutilizáveis
CREATE TABLE IF NOT EXISTS petition_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'outros' CHECK (category IN ('cabecalho', 'qualificacao', 'fatos', 'direito', 'pedidos', 'citacao', 'encerramento', 'outros')),
  formatting TEXT NOT NULL DEFAULT 'paragrafo' CHECK (formatting IN ('paragrafo', 'citacao', 'titulo', 'subtitulo')),
  "order" INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de Petições Salvas
CREATE TABLE IF NOT EXISTS saved_petitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  client_id UUID,
  client_name TEXT,
  process_id UUID,
  process_number TEXT,
  content TEXT NOT NULL,
  clauses_used UUID[],
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_petition_clauses_category ON petition_clauses(category);
CREATE INDEX IF NOT EXISTS idx_petition_clauses_is_active ON petition_clauses(is_active);
CREATE INDEX IF NOT EXISTS idx_petition_clauses_is_default ON petition_clauses(is_default);
CREATE INDEX IF NOT EXISTS idx_saved_petitions_client_id ON saved_petitions(client_id);
CREATE INDEX IF NOT EXISTS idx_saved_petitions_process_id ON saved_petitions(process_id);
CREATE INDEX IF NOT EXISTS idx_saved_petitions_created_by ON saved_petitions(created_by);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_petition_editor_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_petition_clauses_updated_at ON petition_clauses;
CREATE TRIGGER trigger_petition_clauses_updated_at
  BEFORE UPDATE ON petition_clauses
  FOR EACH ROW
  EXECUTE FUNCTION update_petition_editor_updated_at();

DROP TRIGGER IF EXISTS trigger_saved_petitions_updated_at ON saved_petitions;
CREATE TRIGGER trigger_saved_petitions_updated_at
  BEFORE UPDATE ON saved_petitions
  FOR EACH ROW
  EXECUTE FUNCTION update_petition_editor_updated_at();

-- RLS (Row Level Security)
ALTER TABLE petition_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_petitions ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para petition_clauses
DROP POLICY IF EXISTS "Allow authenticated users to read petition_clauses" ON petition_clauses;
CREATE POLICY "Allow authenticated users to read petition_clauses" ON petition_clauses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert petition_clauses" ON petition_clauses;
CREATE POLICY "Allow authenticated users to insert petition_clauses" ON petition_clauses
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update petition_clauses" ON petition_clauses;
CREATE POLICY "Allow authenticated users to update petition_clauses" ON petition_clauses
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete petition_clauses" ON petition_clauses;
CREATE POLICY "Allow authenticated users to delete petition_clauses" ON petition_clauses
  FOR DELETE TO authenticated USING (true);

-- Políticas RLS para saved_petitions
DROP POLICY IF EXISTS "Allow authenticated users to read saved_petitions" ON saved_petitions;
CREATE POLICY "Allow authenticated users to read saved_petitions" ON saved_petitions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert saved_petitions" ON saved_petitions;
CREATE POLICY "Allow authenticated users to insert saved_petitions" ON saved_petitions
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update saved_petitions" ON saved_petitions;
CREATE POLICY "Allow authenticated users to update saved_petitions" ON saved_petitions
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete saved_petitions" ON saved_petitions;
CREATE POLICY "Allow authenticated users to delete saved_petitions" ON saved_petitions
  FOR DELETE TO authenticated USING (true);

-- Inserir algumas cláusulas de exemplo para petições trabalhistas
INSERT INTO petition_clauses (title, content, category, formatting, "order", is_default, is_active) VALUES
-- Cabeçalho
('Cabeçalho Padrão TRT', 'EXCELENTÍSSIMO(A) SENHOR(A) JUIZ(A) DO TRABALHO DA ___ VARA DO TRABALHO DE _______________', 'cabecalho', 'titulo', 1, true, true),

-- Qualificação
('Qualificação Reclamante PF', '[[NOME_CLIENTE]], [[NACIONALIDADE]], [[ESTADO_CIVIL]], [[PROFISSAO]], portador(a) do RG nº [[RG]] e inscrito(a) no CPF sob o nº [[CPF]], residente e domiciliado(a) na [[ENDERECO]], [[CIDADE]]/[[UF]], CEP [[CEP]], e-mail [[EMAIL]], telefone [[TELEFONE]], vem, respeitosamente, à presença de Vossa Excelência, por seu advogado infra-assinado, propor a presente', 'qualificacao', 'paragrafo', 2, true, true),

('Qualificação Reclamada', 'em face de [[NOME_EMPRESA]], pessoa jurídica de direito privado, inscrita no CNPJ sob o nº [[CNPJ]], com sede na [[ENDERECO_EMPRESA]], [[CIDADE_EMPRESA]]/[[UF_EMPRESA]], CEP [[CEP_EMPRESA]], pelos fatos e fundamentos a seguir expostos:', 'qualificacao', 'paragrafo', 3, true, true),

-- Fatos
('Título Dos Fatos', 'DOS FATOS', 'fatos', 'subtitulo', 4, true, true),

('Contrato de Trabalho', 'O(A) Reclamante foi admitido(a) pela Reclamada em [[DATA_ADMISSAO]], para exercer a função de [[FUNCAO]], com salário mensal de R$ [[SALARIO]], tendo sido dispensado(a) sem justa causa em [[DATA_DEMISSAO]], conforme documentos em anexo.', 'fatos', 'paragrafo', 5, true, true),

('Jornada de Trabalho', 'Durante todo o período contratual, o(a) Reclamante laborava de segunda a sexta-feira, das [[HORA_ENTRADA]] às [[HORA_SAIDA]], com [[INTERVALO]] de intervalo intrajornada, perfazendo uma jornada semanal de [[HORAS_SEMANAIS]] horas.', 'fatos', 'paragrafo', 6, false, true),

('Horas Extras', 'Ocorre que, habitualmente, o(a) Reclamante era obrigado(a) a estender sua jornada de trabalho, laborando em média [[HORAS_EXTRAS]] horas extras diárias, sem a devida contraprestação, em flagrante violação ao disposto no art. 7º, XVI, da Constituição Federal.', 'fatos', 'paragrafo', 7, false, true),

-- Direito
('Título Do Direito', 'DO DIREITO', 'direito', 'subtitulo', 8, true, true),

('Fundamentação Horas Extras', 'Dispõe o art. 7º, XIII, da Constituição Federal que a duração do trabalho normal não superior a oito horas diárias e quarenta e quatro semanais, facultada a compensação de horários e a redução da jornada, mediante acordo ou convenção coletiva de trabalho.', 'direito', 'paragrafo', 9, false, true),

('Citação CLT Art. 58', 'Nesse sentido, estabelece o art. 58 da CLT:', 'direito', 'paragrafo', 10, false, true),

('Texto CLT Art. 58', '"Art. 58 - A duração normal do trabalho, para os empregados em qualquer atividade privada, não excederá de 8 (oito) horas diárias, desde que não seja fixado expressamente outro limite."', 'direito', 'citacao', 11, false, true),

('Fundamentação Verbas Rescisórias', 'Com a dispensa sem justa causa, faz jus o(a) Reclamante ao recebimento das verbas rescisórias previstas no art. 477 da CLT, quais sejam: saldo de salário, aviso prévio indenizado, férias proporcionais acrescidas de 1/3, 13º salário proporcional e multa de 40% sobre o FGTS.', 'direito', 'paragrafo', 12, false, true),

-- Pedidos
('Título Dos Pedidos', 'DOS PEDIDOS', 'pedidos', 'subtitulo', 13, true, true),

('Pedido Inicial', 'Diante do exposto, requer a Vossa Excelência:', 'pedidos', 'paragrafo', 14, true, true),

('Pedido Procedência', 'a) A total procedência da presente Reclamação Trabalhista, condenando a Reclamada ao pagamento das verbas a seguir discriminadas:', 'pedidos', 'paragrafo', 15, true, true),

('Pedido Horas Extras', 'b) Horas extras excedentes à 8ª diária e 44ª semanal, com adicional de 50%, e reflexos em DSR, férias + 1/3, 13º salário, aviso prévio e FGTS + 40%;', 'pedidos', 'paragrafo', 16, false, true),

('Pedido Verbas Rescisórias', 'c) Verbas rescisórias: saldo de salário, aviso prévio indenizado, férias proporcionais + 1/3, 13º salário proporcional e multa de 40% do FGTS;', 'pedidos', 'paragrafo', 17, false, true),

('Pedido Honorários', 'd) Honorários advocatícios sucumbenciais no percentual de 15% sobre o valor da condenação, nos termos do art. 791-A da CLT;', 'pedidos', 'paragrafo', 18, true, true),

('Pedido Justiça Gratuita', 'e) Os benefícios da Justiça Gratuita, nos termos do art. 790, §3º, da CLT, por não ter condições de arcar com as custas processuais sem prejuízo do sustento próprio e de sua família;', 'pedidos', 'paragrafo', 19, false, true),

-- Encerramento
('Valor da Causa', 'Dá-se à causa o valor de R$ [[VALOR_CAUSA]] ([[VALOR_CAUSA_EXTENSO]]).', 'encerramento', 'paragrafo', 20, true, true),

('Encerramento Padrão', 'Nestes termos,
Pede deferimento.

[[CIDADE]], [[DATA_EXTENSO]].


_______________________________
[[NOME_ADVOGADO]]
OAB/[[UF_OAB]] [[NUMERO_OAB]]', 'encerramento', 'paragrafo', 21, true, true)

ON CONFLICT DO NOTHING;
