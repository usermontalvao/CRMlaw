-- ── ONDE O COMPROMISSO ACONTECE ─────────────────────────────────────────────
--
-- A Agenda nunca teve campo de endereço. Quem precisava escrevia nas
-- Observações, junto com todo o resto, e não havia como uma mensagem automática
-- dizer ao cliente PARA ONDE ir — foi por isso que a comunicação ao cliente
-- nasceu sem a variável `{local}`.
--
-- Um compromisso presencial sem endereço é a informação que falta justamente
-- para a pessoa que mais precisa dela: o cliente, que vai sair de casa.
--
-- Texto livre, e não um endereço estruturado, porque é isso que o escritório
-- escreve: "8ª Vara do Trabalho de Cuiabá, Av. Historiador Rubens de Mendonça,
-- 4º andar, sala 12". Estruturar em CEP/rua/número obrigaria a preencher
-- campos que ninguém tem à mão ao marcar uma audiência a partir de uma
-- intimação.
alter table public.calendar_events
  add column if not exists location text;

comment on column public.calendar_events.location is
  'Onde o compromisso acontece (texto livre). Alimenta {local} na comunicação ao cliente. Só faz sentido em compromissos presenciais.';
