-- ── OTP da assinatura: WhatsApp como canal, e a prova saindo do servidor ─────
--
-- Duas coisas nesta migration.
--
-- 1) CANAL. O código de verificação por telefone existia só por SMS (smsdev).
--    A tabela ganha `channel` para dizer por onde ele saiu — 'sms' ou
--    'whatsapp' — e `wa_message_id`, que é o id da mensagem enviada: o mesmo
--    id que aparece na conversa do cliente dentro do CRM. É o que permite ao
--    dossiê apontar para a mensagem, não só afirmar que ela existiu.
--
-- 2) PROVA. Até aqui QUEM DIZIA que a identidade foi verificada era o
--    navegador: o `public-sign-document` gravava `auth_provider` e `phone`
--    direto do corpo da requisição, sem nunca consultar as tabelas de OTP.
--    Uma assinatura podia sair afirmando "autenticado por telefone, número X"
--    sem que código nenhum tivesse sido validado — e o dossiê imprimia isso
--    como fato.
--
--    `consumed_at` fecha a outra metade: um código validado vale para UMA
--    assinatura. Sem ele, o mesmo OTP verificado serviria para assinar de novo
--    depois (ou para assinar outro documento do mesmo signatário).
--
--    As três colunas em `signature_signers` são escritas SÓ pelo servidor, a
--    partir da linha de OTP consumida — nunca do payload. São elas que o
--    relatório imprime.

-- 1. Canal do código de telefone -------------------------------------------
alter table public.signature_phone_otps
  add column if not exists channel text not null default 'sms',
  add column if not exists wa_message_id uuid null,
  add column if not exists consumed_at timestamptz null;

alter table public.signature_phone_otps
  drop constraint if exists signature_phone_otps_channel_check;
alter table public.signature_phone_otps
  add constraint signature_phone_otps_channel_check
  check (channel in ('sms', 'whatsapp'));

-- 2. Consumo do código de e-mail -------------------------------------------
alter table public.signature_email_otps
  add column if not exists consumed_at timestamptz null;

-- 3. O que o dossiê imprime como CONFIRMADO --------------------------------
alter table public.signature_signers
  add column if not exists auth_verified_at timestamptz null,
  add column if not exists auth_verified_channel text null,
  add column if not exists auth_verified_identifier text null;

comment on column public.signature_signers.auth_verified_channel is
  'Por onde a identidade foi confirmada: whatsapp | sms | email | google. Escrito só pelo servidor.';
comment on column public.signature_signers.auth_verified_identifier is
  'O telefone ou e-mail que RECEBEU e devolveu o código. Vem da linha de OTP consumida, nunca do navegador.';

-- 4. Interruptor do novo método na página pública --------------------------
insert into public.system_settings (key, value, category, description)
values (
  'public_signature_auth_whatsapp',
  'false'::jsonb,
  'assinatura',
  'Habilita autenticação por WhatsApp (OTP) na assinatura pública'
)
on conflict (key) do nothing;

-- 5. O bundle público passa a anunciar o WhatsApp --------------------------
--    Cópia fiel da função em produção, com `whatsapp` somado ao auth_config.
--    Diferente dos outros três, o padrão dele é FALSE: canal do escritório
--    pode não estar conectado, e método que não funciona não pode aparecer
--    como opção na página de quem vai assinar.
CREATE OR REPLACE FUNCTION public.get_public_signing_bundle(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_signer signature_signers;
  v_request signature_requests;
  v_creator jsonb;
  v_creator_name text;
  v_creator_active boolean;
  v_is_kit boolean;
  v_fields jsonb;
  v_auth_config jsonb;
  v_auth_google boolean;
  v_auth_email boolean;
  v_auth_phone boolean;
  v_auth_whatsapp boolean;
  v_waiting_for text := NULL;
  v_my_order int;
BEGIN
  SELECT * INTO v_signer FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_request FROM public.signature_requests WHERE id = v_signer.signature_request_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_request.archived_at IS NOT NULL OR v_request.deleted_at IS NOT NULL OR v_request.blocked_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF v_request.status IN ('cancelled', 'expired') THEN RETURN NULL; END IF;
  IF v_request.expires_at IS NOT NULL AND v_request.expires_at < now() THEN RETURN NULL; END IF;

  IF v_request.signing_order = 'sequential' THEN
    v_my_order := COALESCE((to_jsonb(v_signer)->>'order')::int, 1);
    SELECT ss.name INTO v_waiting_for
    FROM public.signature_signers ss
    WHERE ss.signature_request_id = v_request.id
      AND ss."order" < v_my_order
      AND ss.status <> 'signed'
    ORDER BY ss."order" ASC
    LIMIT 1;
  END IF;

  -- Creator mínimo: só o nome. Emissor desativado ou documento de origem KIT
  -- aparecem como "Jurius CRM" (não atribui autoria a uma pessoa).
  SELECT p.name, p.is_active INTO v_creator_name, v_creator_active
  FROM public.profiles p WHERE p.user_id = v_request.created_by LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM public.template_fill_links tfl WHERE tfl.signature_request_id = v_request.id
  ) INTO v_is_kit;

  IF v_creator_name IS NULL OR v_creator_active IS FALSE OR v_is_kit THEN
    v_creator := jsonb_build_object('name', 'Jurius CRM');
  ELSE
    v_creator := jsonb_build_object('name', v_creator_name);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.page_number ASC), '[]'::jsonb)
    INTO v_fields FROM public.signature_fields f WHERE f.signature_request_id = v_request.id;

  SELECT COALESCE((s.value #>> '{}')::boolean, true) INTO v_auth_google
  FROM public.system_settings s WHERE s.key = 'public_signature_auth_google' LIMIT 1;
  SELECT COALESCE((s.value #>> '{}')::boolean, true) INTO v_auth_email
  FROM public.system_settings s WHERE s.key = 'public_signature_auth_email' LIMIT 1;
  SELECT COALESCE((s.value #>> '{}')::boolean, true) INTO v_auth_phone
  FROM public.system_settings s WHERE s.key = 'public_signature_auth_phone' LIMIT 1;
  SELECT COALESCE((s.value #>> '{}')::boolean, false) INTO v_auth_whatsapp
  FROM public.system_settings s WHERE s.key = 'public_signature_auth_whatsapp' LIMIT 1;

  v_auth_config := jsonb_build_object(
    'google', COALESCE(v_auth_google, true),
    'email', COALESCE(v_auth_email, true),
    'phone', COALESCE(v_auth_phone, true),
    'whatsapp', COALESCE(v_auth_whatsapp, false)
  );

  RETURN jsonb_build_object(
    'signer', to_jsonb(v_signer),
    'request', to_jsonb(v_request),
    'creator', v_creator,
    'fields', v_fields,
    'auth_config', v_auth_config,
    'waiting_for', v_waiting_for
  );
END;
$function$;
