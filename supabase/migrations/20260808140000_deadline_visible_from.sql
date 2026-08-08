-- Prazo agendado: cadastrado hoje, aparece na fila só quando a data chegar.
--
-- O problema real: o escritório já SABE do prazo do cliente com meses de
-- antecedência, mas cadastrá-lo hoje significa carregá-lo na tela de trabalho
-- todos os dias até lá. Quem não quer poluir a lista acaba não cadastrando — e
-- prazo que mora na cabeça de alguém é prazo em risco.
--
-- A solução é um adiamento de VISIBILIDADE, não de existência: o prazo é criado
-- normalmente, com todos os campos de sempre, e ganha uma data a partir da qual
-- entra na fila. Antes dela, some da lista, do kanban, das contagens e dos
-- alertas.
--
-- Repare que isto NÃO precisa de cron nem de job nenhum: o prazo "acorda"
-- sozinho porque a consulta passa a incluí-lo quando o instante chega. Não há
-- processo que possa falhar em silêncio e deixar o prazo dormindo para sempre.

alter table public.deadlines
  add column if not exists visible_from timestamptz;

comment on column public.deadlines.visible_from is
  'A partir de quando o prazo aparece na fila de trabalho. NULL = aparece imediatamente (comportamento padrao). Gravado como meia-noite no fuso do escritorio, para o prazo acordar no comeco do dia certo e nao na vespera.';

-- Os agendados são poucos e são consultados como um recorte próprio (a tela
-- "Agendados"), então o índice parcial é o que serve — e não onera as escritas
-- do caso comum, em que a coluna é nula.
create index if not exists idx_deadlines_visible_from
  on public.deadlines (visible_from)
  where visible_from is not null;

notify pgrst, 'reload schema';
