-- WhatsApp — uma política de SLA por canal, e um relógio só.
--
-- O QUE HAVIA. Três definições concorrentes de "está atrasado":
--   • inbox      → atenção aos 15min, vermelho aos 60min, contados em TEMPO ÚTIL
--                  do canal (`businessTime.ts`), com os números escritos à mão em
--                  cinco lugares do front;
--   • dashboard  → atenção de 2h a 4h, estouro acima de 4h, contados no RELÓGIO
--                  DE PAREDE, dentro do `whatsapp_dashboard_stats`;
--   • ninguém    → `whatsapp_instances` não tinha uma única coluna de SLA, então
--                  não havia onde a operação dizer o que ela considera atraso.
-- Resultado: a mesma conversa aparecia vermelha na fila e "dentro do prazo" no
-- painel, e o contador do dia virava às 23h porque o SQL usava São Paulo
-- enquanto o escritório (e a agenda, e o auto-close) usa Cuiabá.
--
-- A DECISÃO, tomada pelo escritório em 27/08/2026: valem os 15/60 da inbox,
-- por canal, contados só em tempo útil. Esta migration dá o lugar onde isso
-- mora (colunas) e o relógio que faltava no banco (`wa_business_elapsed_minutes`),
-- e faz o dashboard passar a ler os dois.

-- ── A política, no canal ────────────────────────────────────────────────────
-- Colunas explícitas, no mesmo estilo do `auto_close_*` que já existe aqui: são
-- lidas por SQL, por Edge Function e por tela, e um jsonb faria cada uma delas
-- reinventar a validação.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS sla_warn_minutes             integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS sla_breach_minutes           integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS sla_queue_warn_minutes       integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS sla_queue_breach_minutes     integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS sla_transfer_accept_minutes  integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS sla_abandoned_minutes        integer NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS sla_business_hours_only      boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.whatsapp_instances.sla_warn_minutes IS
  'Espera do cliente a partir da qual a conversa fica âmbar. Padrão 15.';
COMMENT ON COLUMN public.whatsapp_instances.sla_breach_minutes IS
  'Espera a partir da qual a conversa fica vermelha e conta como estourada. Padrão 60.';
COMMENT ON COLUMN public.whatsapp_instances.sla_queue_warn_minutes IS
  'Tempo em fila de setor, sem responsável, que já pede atenção. Padrão 30.';
COMMENT ON COLUMN public.whatsapp_instances.sla_queue_breach_minutes IS
  'Tempo em fila de setor que conta como gargalo. Padrão 120.';
COMMENT ON COLUMN public.whatsapp_instances.sla_transfer_accept_minutes IS
  'Transferência sem aceite por mais que isto vai para o topo da fila. Padrão 15.';
COMMENT ON COLUMN public.whatsapp_instances.sla_abandoned_minutes IS
  'Conversa COM responsável e sem resposta por mais que isto é abandono. Padrão 240 (4h).';
COMMENT ON COLUMN public.whatsapp_instances.sla_business_hours_only IS
  'O relógio do SLA só corre dentro do expediente do canal. Ligado por padrão.';

-- Ordem entre os patamares: âmbar nunca depois do vermelho. Sem isto, um canal
-- configurado ao contrário mostra "estourada" sem nunca ter mostrado "atenção",
-- e ninguém entende por quê.
ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_sla_coerente;
ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_sla_coerente CHECK (
    sla_warn_minutes            BETWEEN 1 AND 43200 AND
    sla_breach_minutes          BETWEEN 1 AND 43200 AND
    sla_queue_warn_minutes      BETWEEN 1 AND 43200 AND
    sla_queue_breach_minutes    BETWEEN 1 AND 43200 AND
    sla_transfer_accept_minutes BETWEEN 1 AND 43200 AND
    sla_abandoned_minutes       BETWEEN 1 AND 43200 AND
    sla_breach_minutes       >= sla_warn_minutes AND
    sla_queue_breach_minutes >= sla_queue_warn_minutes
  );

-- ── O relógio de tempo útil, no banco ───────────────────────────────────────
-- O front já tinha o seu (`businessTime.ts`); o banco não tinha nenhum, e era
-- por isso que o dashboard contava no relógio de parede. Esta função é a
-- tradução fiel daquele: janelas por dia da semana vindas de
-- `whatsapp_business_hours`, no fuso do canal.
--
-- O FALLBACK É RELÓGIO DE PAREDE, e essa escolha é copiada de
-- `elapsedMinutesFor(null)`: canal sem expediente cadastrado (e conversa órfã
-- de canal, que existe) não pode passar a reportar "0min de espera" para
-- sempre. Um padrão 8h–18h aqui pareceria mais esperto e faria o painel
-- discordar da tela justamente no caso em que ninguém sabe o expediente.
--
-- TETO DE 180 DIAS: acima disso a conta deixa de ser SLA e vira arqueologia, e
-- cada dia a mais é uma linha a mais por conversa. Uma conversa parada há mais
-- de meio ano já está estourada por qualquer critério.
CREATE OR REPLACE FUNCTION public.wa_business_elapsed_minutes(
  p_instance_id uuid,
  p_from        timestamptz,
  p_to          timestamptz DEFAULT now()
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz    text;
  v_ini   timestamptz;
  v_total numeric;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RETURN 0;
  END IF;

  SELECT nullif(btrim(coalesce(i.timezone, '')), '')
    INTO v_tz
    FROM whatsapp_instances i
   WHERE i.id = p_instance_id;
  -- Conversa órfã de canal (existem, e quebram todo JOIN interno) cai no fuso
  -- do escritório em vez de devolver NULL.
  v_tz  := coalesce(v_tz, 'America/Cuiaba');
  v_ini := greatest(p_from, p_to - interval '180 days');

  -- Sem expediente cadastrado, relógio de parede (ver acima). Sai antes do laço
  -- de dias, que aqui não teria janela nenhuma com que cruzar.
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_business_hours bh
     WHERE bh.instance_id = p_instance_id
       AND bh.is_active
       AND bh.start_time ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$'
       AND bh.end_time   ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$'
       AND bh.end_time::time > bh.start_time::time
  ) THEN
    RETURN extract(epoch FROM (p_to - p_from)) / 60;
  END IF;

  -- `start_time`/`end_time` são TEXTO em produção (o arquivo da tabela diz TIME;
  -- o banco discorda). Duas consequências, e as duas mordem:
  --   • comparar sem converter é comparação de STRING — '9:00' > '10:00' é
  --     verdadeiro em texto e falso no relógio;
  --   • um valor malformado faria o cast estourar e derrubaria o dashboard
  --     inteiro, então só entram as linhas no formato reconhecido.
  -- '24:00' É VÁLIDO e precisa continuar valendo: é assim que o canal 24h está
  -- gravado (7 dias, 00:00–24:00), e `dia + time '24:00'` cai certinho na
  -- meia-noite seguinte.
  WITH janelas AS (
    SELECT bh.day_of_week AS dow,
           bh.start_time::time AS abre,
           bh.end_time::time   AS fecha
      FROM whatsapp_business_hours bh
     WHERE bh.instance_id = p_instance_id
       AND bh.is_active
       AND bh.start_time ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$'
       AND bh.end_time   ~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$'
       AND bh.end_time::time > bh.start_time::time
  ),
  dias AS (
    SELECT d::date AS dia
      FROM generate_series(
             date_trunc('day', v_ini AT TIME ZONE v_tz),
             date_trunc('day', p_to  AT TIME ZONE v_tz),
             interval '1 day') g(d)
  )
  SELECT coalesce(sum(
           greatest(0, extract(epoch FROM
             least(p_to,  ((dias.dia + e.fecha) AT TIME ZONE v_tz))
           - greatest(v_ini, ((dias.dia + e.abre)  AT TIME ZONE v_tz))
           )) / 60
         ), 0)
    INTO v_total
    FROM dias
    JOIN janelas e ON e.dow = extract(dow FROM dias.dia);

  RETURN coalesce(v_total, 0);
END;
$$;

COMMENT ON FUNCTION public.wa_business_elapsed_minutes(uuid, timestamptz, timestamptz) IS
  'Minutos decorridos DENTRO do expediente do canal, no fuso dele. O mesmo relógio que a inbox usa, para o painel parar de discordar da fila.';

-- Só `service_role`. Quem chama esta função é o `whatsapp_dashboard_stats`, que
-- é SECURITY DEFINER com o MESMO dono — dentro dele o usuário efetivo já é o
-- dono, então a tela continua funcionando sem que `authenticated` precise de
-- EXECUTE direto. Dar o grant "por precaução" só aumentaria a superfície e
-- somaria mais uma linha ao advisor de funções definer abertas.
REVOKE ALL ON FUNCTION public.wa_business_elapsed_minutes(uuid, timestamptz, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_business_elapsed_minutes(uuid, timestamptz, timestamptz) TO service_role;

-- ── O dashboard passa a ler a política e o relógio ──────────────────────────
-- Três mudanças, e nenhuma delas é cosmética:
--   1. os 2h/4h cravados saem; entram `sla_warn_minutes`/`sla_breach_minutes`
--      DO CANAL de cada conversa (LEFT JOIN: existem conversas órfãs de canal,
--      e um JOIN interno as sumiria da contagem sem avisar);
--   2. a espera passa a ser medida em tempo útil, o mesmo relógio da inbox —
--      é isto que faz painel e fila pararem de discordar;
--   3. o "hoje" deixa de ser São Paulo e passa a ser Cuiabá, a mesma âncora da
--      agenda e do encerramento automático. Antes, o contador do dia virava às
--      23h e a primeira hora da noite entrava no dia seguinte.
-- O TMR também vira tempo útil, pelo motivo escrito no cabeçalho do
-- `businessTime.ts`: medido no relógio de parede, ele é ficção.
--
-- `sla_warn_minutes`/`sla_breach_minutes` voltam no JSON para a tela poder
-- ESCREVER o número em vez de repetir um ">4h" que ninguém mais garante. Vêm
-- nulos quando os canais visíveis discordam entre si — aí não há um número
-- único a mostrar, e o cartão fala sem prometer.
CREATE OR REPLACE FUNCTION public.whatsapp_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_by_status       JSONB;
  v_by_agent        JSONB;
  v_sla_breached    INT;
  v_sla_warning     INT;
  v_unassigned      INT;
  v_opened_today    INT;
  v_closed_today    INT;
  v_msgs_today      INT;
  v_avg_first_resp  NUMERIC;
  v_warn_min        INT;
  v_warn_max        INT;
  v_breach_min      INT;
  v_breach_max      INT;
  v_today_start     TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'America/Cuiaba') AT TIME ZONE 'America/Cuiaba';
BEGIN
  IF NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;

  SELECT jsonb_object_agg(status, cnt)
  INTO v_by_status
  FROM (
    SELECT status, count(*) AS cnt
    FROM whatsapp_conversations c
    WHERE status IN ('open', 'pending')
      AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    GROUP BY status
  ) s;

  SELECT jsonb_agg(row_to_json(t))
  INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.name, 'Sem nome') AS agent_name,
      count(*) AS total,
      count(*) FILTER (
        WHERE c.last_message_direction = 'in'
        AND (c.last_agent_message_at IS NULL OR c.last_agent_message_at < c.last_customer_message_at)
      ) AS waiting_reply
    FROM whatsapp_conversations c
    LEFT JOIN profiles p ON p.id = c.assigned_user_id
    WHERE c.status IN ('open', 'pending')
      AND c.assigned_user_id IS NOT NULL
      AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    GROUP BY c.assigned_user_id, p.name
    ORDER BY total DESC
    LIMIT 20
  ) t;

  SELECT
    count(*) FILTER (WHERE e.espera >= COALESCE(i.sla_breach_minutes, 60)),
    count(*) FILTER (WHERE e.espera >= COALESCE(i.sla_warn_minutes, 15)
                       AND e.espera <  COALESCE(i.sla_breach_minutes, 60))
  INTO v_sla_breached, v_sla_warning
  FROM whatsapp_conversations c
  LEFT JOIN whatsapp_instances i ON i.id = c.instance_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN COALESCE(i.sla_business_hours_only, true)
                THEN public.wa_business_elapsed_minutes(c.instance_id, c.last_customer_message_at, now())
                ELSE extract(epoch FROM (now() - c.last_customer_message_at)) / 60
           END AS espera
  ) e
  WHERE c.status IN ('open', 'pending')
    AND c.last_customer_message_at IS NOT NULL
    AND (c.last_agent_message_at IS NULL OR c.last_agent_message_at < c.last_customer_message_at)
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_unassigned
  FROM whatsapp_conversations c
  WHERE status IN ('open', 'pending') AND assigned_user_id IS NULL
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_opened_today
  FROM whatsapp_conversations c
  WHERE created_at >= v_today_start
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_closed_today
  FROM whatsapp_conversations c
  WHERE status = 'closed' AND closed_at >= v_today_start
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_msgs_today
  FROM whatsapp_messages m
  WHERE m.direction = 'out' AND m.created_at >= v_today_start
    AND public.wa_can_see_conv_id(m.conversation_id);

  SELECT avg(
           CASE WHEN COALESCE(i.sla_business_hours_only, true)
                THEN public.wa_business_elapsed_minutes(c.instance_id, c.created_at, c.first_response_at)
                ELSE extract(epoch FROM (c.first_response_at - c.created_at)) / 60
           END)
  INTO v_avg_first_resp
  FROM whatsapp_conversations c
  LEFT JOIN whatsapp_instances i ON i.id = c.instance_id
  WHERE c.first_response_at IS NOT NULL
    AND c.created_at >= now() - interval '7 days'
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT min(sla_warn_minutes), max(sla_warn_minutes), min(sla_breach_minutes), max(sla_breach_minutes)
  INTO v_warn_min, v_warn_max, v_breach_min, v_breach_max
  FROM whatsapp_instances
  WHERE COALESCE(is_active, true);

  RETURN jsonb_build_object(
    'by_status',              COALESCE(v_by_status, '{}'::jsonb),
    'by_agent',               COALESCE(v_by_agent, '[]'::jsonb),
    'sla_breached',           COALESCE(v_sla_breached, 0),
    'sla_warning',            COALESCE(v_sla_warning, 0),
    'sla_warn_minutes',       CASE WHEN v_warn_min   = v_warn_max   THEN v_warn_min   END,
    'sla_breach_minutes',     CASE WHEN v_breach_min = v_breach_max THEN v_breach_min END,
    'unassigned',             COALESCE(v_unassigned, 0),
    'opened_today',           COALESCE(v_opened_today, 0),
    'closed_today',           COALESCE(v_closed_today, 0),
    'messages_sent_today',    COALESCE(v_msgs_today, 0),
    'avg_first_response_min', v_avg_first_resp
  );
END;
$function$;
