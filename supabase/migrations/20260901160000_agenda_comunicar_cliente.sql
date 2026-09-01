-- ── COMUNICAR O CLIENTE NO COMPROMISSO ──────────────────────────────────────
--
-- Até aqui `calendar_events` só sabia avisar QUEM CRIOU o evento:
-- `notify_minutes_before` alimenta o lembrete interno do notification-scheduler,
-- e o cliente vinculado (`client_id`, que já existe) nunca era avisado de nada.
--
-- Estas colunas são a comunicação AO CLIENTE, e são deliberadamente separadas
-- das da equipe. Os dois avisos têm dono, texto, canal e antecedência
-- diferentes: o interno é um empurrão de agenda, e este é uma mensagem que sai
-- do escritório para fora e não volta. Reaproveitar `notify_minutes_before`
-- amarraria um ao outro — mudar o lembrete da advogada mudaria a hora em que o
-- cliente é avisado, sem ninguém pedir.

alter table public.calendar_events
  -- O interruptor do painel. Nasce desligado: comunicação ao cliente é uma
  -- escolha por compromisso, nunca um padrão que pega todo mundo de surpresa.
  add column if not exists client_notify_enabled boolean not null default false,

  -- Antecedência em minutos, na mesma unidade do lembrete interno para as duas
  -- contas serem comparáveis. O painel oferece 1h/3h/1 dia/2 dias/1 semana.
  add column if not exists client_notify_minutes_before integer,

  -- O texto, já com as variáveis do escritório ({primeiro_nome}, {data},
  -- {hora}, {local}). Guardado cru: quem resolve as variáveis é o envio, com os
  -- dados do momento — o compromisso pode ser remarcado depois de salvo.
  add column if not exists client_notify_message text,

  -- Item da biblioteca de mídia do WhatsApp, opcional. `on delete set null`
  -- porque remover uma mídia da biblioteca não pode derrubar o compromisso: o
  -- envio simplesmente passa a ser só texto.
  add column if not exists client_notify_media_id uuid
    references public.whatsapp_media_library(id) on delete set null,

  -- O carimbo. NULL = ainda não saiu, e é isso que torna a comunicação
  -- cancelável: desligar o interruptor antes da hora apaga o agendamento sem
  -- deixar rastro de envio. Preenchido, fecha o assunto — e o painel passa a
  -- mostrar "já enviada" em vez de oferecer cancelamento.
  add column if not exists client_notify_sent_at timestamptz,

  -- A última falha, quando houve. Sem isto, um envio que morre na Evolution
  -- deixa o compromisso parado em "pendente" para sempre e ninguém sabe por quê
  -- — foi exatamente assim que o aviso de prazo por WhatsApp passou meses sem
  -- entregar nada.
  add column if not exists client_notify_error text;

comment on column public.calendar_events.client_notify_enabled is
  'Comunicar o cliente vinculado por WhatsApp antes do compromisso. Nasce desligado.';
comment on column public.calendar_events.client_notify_sent_at is
  'Quando a comunicação saiu. NULL = agendada e ainda cancelável.';

-- O índice que o cron usa: só os compromissos com comunicação ligada e ainda
-- não enviada interessam à varredura. Parcial de propósito — a agenda inteira
-- não precisa entrar no índice para achar as poucas linhas pendentes.
create index if not exists calendar_events_comunicacao_pendente_idx
  on public.calendar_events (start_at)
  where client_notify_enabled and client_notify_sent_at is null;
