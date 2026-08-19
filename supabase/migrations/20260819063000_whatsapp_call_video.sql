-- A ligação lembra se foi de VÍDEO.
--
-- Sem esta coluna a chamada de vídeo virava "Chamada de voz" em todo lugar que
-- lê o registro — a linha da conversa, a ficha do cliente, o aviso de perdida —
-- porque o único lugar onde "isto é vídeo" existia era a tela, enquanto a
-- chamada estava viva. O registro nasce depois do fim da chamada e não tinha
-- como saber.
--
-- `is_video` é PEGAJOSA: uma vez verdadeira, não volta. A câmera pode entrar no
-- meio e sair antes do fim, e a ligação continua tendo sido de vídeo.
alter table public.whatsapp_call_logs
  add column if not exists is_video boolean not null default false;

-- O parâmetro novo entra com DEFAULT, mas a função velha precisa SAIR: manter as
-- duas assinaturas criaria uma sobrecarga, e o PostgREST recusa a chamada que
-- serve às duas com "could not choose the best candidate function".
drop function if exists public.wa_log_call(
  text, text, text, timestamptz, timestamptz, text, text, uuid, uuid,
  timestamptz, text, text, text, bigint, text
);

create or replace function public.wa_log_call(
  p_call_id text,
  p_direction text,
  p_phone text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_outcome text,
  p_session_id text default null,
  p_client_id uuid default null,
  p_conversation_id uuid default null,
  p_answered_at timestamptz default null,
  p_end_reason text default null,
  p_recording_path text default null,
  p_recording_mime text default null,
  p_recording_bytes bigint default null,
  p_peer_lid text default null,
  p_video boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_client_id uuid := p_client_id;
  v_digits    text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_lid       text := nullif(regexp_replace(coalesce(p_peer_lid, ''), '\D', '', 'g'), '');
  v_duration  integer;
  v_id        uuid;
BEGIN
  IF NOT public.is_office_staff() THEN
    RAISE EXCEPTION 'sem permissao para registrar chamadas';
  END IF;

  IF v_lid IS NOT NULL AND v_digits = v_lid THEN
    v_digits := '';
  END IF;
  IF length(v_digits) > 13 THEN
    IF v_lid IS NULL THEN v_lid := v_digits; END IF;
    v_digits := '';
  END IF;

  IF v_client_id IS NULL AND v_digits ~ '^\d{10,13}$' THEN
    SELECT (array_agg(t.id))[1] INTO v_client_id
      FROM (
        SELECT c.id
          FROM public.clients c
         WHERE c.merged_into_client_id IS NULL
           AND (
             right(regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
             OR right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
           )
         LIMIT 2
      ) t
     HAVING count(*) = 1;
  END IF;

  v_duration := GREATEST(0, COALESCE(
    EXTRACT(EPOCH FROM (p_ended_at - COALESCE(p_answered_at, p_ended_at)))::integer, 0));

  INSERT INTO public.whatsapp_call_logs AS l (
    call_id, session_id, direction, phone, peer_lid, client_id, conversation_id, user_id,
    started_at, answered_at, ended_at, duration_seconds, end_reason, outcome,
    recording_path, recording_mime, recording_bytes, is_video
  ) VALUES (
    p_call_id, p_session_id, p_direction, v_digits, v_lid, v_client_id, p_conversation_id,
    CASE WHEN p_answered_at IS NULL THEN NULL ELSE auth.uid() END,
    p_started_at, p_answered_at, p_ended_at, v_duration, p_end_reason, p_outcome,
    p_recording_path, p_recording_mime, p_recording_bytes, coalesce(p_video, false)
  )
  ON CONFLICT (call_id) DO UPDATE SET
    answered_at      = COALESCE(l.answered_at, EXCLUDED.answered_at),
    user_id          = COALESCE(l.user_id, EXCLUDED.user_id),
    ended_at         = GREATEST(l.ended_at, EXCLUDED.ended_at),
    duration_seconds = GREATEST(l.duration_seconds, EXCLUDED.duration_seconds),
    outcome          = CASE WHEN l.outcome = 'answered' THEN l.outcome ELSE EXCLUDED.outcome END,
    end_reason       = COALESCE(EXCLUDED.end_reason, l.end_reason),
    client_id        = COALESCE(l.client_id, EXCLUDED.client_id),
    conversation_id  = COALESCE(l.conversation_id, EXCLUDED.conversation_id),
    phone            = CASE WHEN l.phone IS NULL OR l.phone = '' THEN EXCLUDED.phone ELSE l.phone END,
    peer_lid         = COALESCE(l.peer_lid, EXCLUDED.peer_lid),
    recording_path   = COALESCE(EXCLUDED.recording_path, l.recording_path),
    recording_mime   = COALESCE(EXCLUDED.recording_mime, l.recording_mime),
    recording_bytes  = COALESCE(EXCLUDED.recording_bytes, l.recording_bytes),
    -- Pegajosa: a ligação que teve câmera em algum momento foi de vídeo.
    is_video         = l.is_video OR EXCLUDED.is_video
  RETURNING l.id INTO v_id;

  RETURN v_id;
END;
$function$;

-- O DROP levou junto os GRANTs da função anterior.
grant execute on function public.wa_log_call(
  text, text, text, timestamptz, timestamptz, text, text, uuid, uuid,
  timestamptz, text, text, text, bigint, text, boolean
) to anon, authenticated, service_role;

-- A LISTA de conversas conta a mesma história da thread: a prévia da conversa
-- lê `last_call_*`, e sem o meio ali a ligação de vídeo continuaria aparecendo
-- como "📞 Chamada de voz" na coluna da esquerda — a tela que a maioria das
-- conversas só recebe de relance.
alter table public.whatsapp_conversations
  add column if not exists last_call_is_video boolean not null default false;

create or replace function public.wa_touch_conversation_call()
returns trigger
language plpgsql
as $function$
DECLARE
  v_at timestamptz;
BEGIN
  IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;

  v_at := COALESCE(NEW.ended_at, NEW.started_at);
  IF v_at IS NULL THEN RETURN NEW; END IF;

  UPDATE public.whatsapp_conversations c
     SET last_call_at               = v_at,
         last_call_direction        = NEW.direction,
         last_call_outcome          = NEW.outcome,
         last_call_duration_seconds = NEW.duration_seconds,
         last_call_is_video         = COALESCE(NEW.is_video, false)
   WHERE c.id = NEW.conversation_id
     AND (c.last_call_at IS NULL OR v_at >= c.last_call_at)
     AND (c.last_call_at               IS DISTINCT FROM v_at
       OR c.last_call_direction        IS DISTINCT FROM NEW.direction
       OR c.last_call_outcome          IS DISTINCT FROM NEW.outcome
       OR c.last_call_duration_seconds IS DISTINCT FROM NEW.duration_seconds
       OR c.last_call_is_video         IS DISTINCT FROM COALESCE(NEW.is_video, false));

  RETURN NEW;
END;
$function$;
