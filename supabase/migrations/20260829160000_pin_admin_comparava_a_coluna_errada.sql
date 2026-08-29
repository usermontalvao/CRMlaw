-- O PORTEIRO DE ADMIN DO PIN COMPARAVA A COLUNA ERRADA.
--
-- Duas funções decidiam "quem está chamando é administrador?" assim:
--
--     SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Administrador')
--
-- Só que `auth.uid()` é o id do usuário no Auth, e em `profiles` isso mora em
-- `user_id` — `profiles.id` é a chave da própria tabela, um UUID diferente.
-- Nenhuma das 4 linhas do acervo tem `id = user_id`, então a condição era
-- SEMPRE falsa e as duas funções levantavam "Permissão negada" para todo mundo,
-- inclusive para administradores de verdade.
--
-- O efeito visível, e o motivo desta correção: em Configurações › Equipe, a
-- ficha de qualquer colaborador dizia "PIN não configurado" mesmo para quem tem
-- PIN há semanas — o erro era engolido e virava `has_pin: false`. E o botão
-- "Resetar PIN" nunca funcionou, pelo mesmo motivo.
--
-- Falhava FECHADO, que é a direção segura: ninguém viu dado de ninguém, e
-- nenhum PIN foi resetado indevidamente. Mas o recurso estava morto desde
-- sempre, e a tela mentia sobre o estado da segurança de cada pessoa.
--
-- A comparação de cargo passa a ignorar a caixa: hoje só existe
-- "Administrador", e um dia alguém grava "administrador" em minúsculas.

CREATE OR REPLACE FUNCTION public.get_security_pin_meta(p_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target_id uuid;
  v_row       user_security_pins%ROWTYPE;
  v_is_admin  boolean;
BEGIN
  v_target_id := COALESCE(p_user_id, auth.uid());

  IF v_target_id <> auth.uid() THEN
    SELECT EXISTS(
      SELECT 1 FROM profiles
       WHERE user_id = auth.uid() AND lower(role) = 'administrador'
    ) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Permissão negada';
    END IF;
  END IF;

  SELECT * INTO v_row FROM user_security_pins WHERE user_id = v_target_id;

  IF NOT FOUND OR v_row.pin_hash = '' THEN
    RETURN jsonb_build_object(
      'has_pin', false,
      'pin_required_setup', COALESCE(v_row.pin_required_setup, false),
      'removed_at', v_row.removed_at
    );
  END IF;

  RETURN jsonb_build_object(
    'has_pin',            true,
    'pin_set_at',         v_row.pin_set_at,
    'updated_at',         v_row.updated_at,
    'failed_attempts',    v_row.failed_attempts,
    'locked_until',       v_row.locked_until,
    'last_verified_at',   v_row.last_verified_at,
    'pin_required_setup', v_row.pin_required_setup,
    'removed_at',         v_row.removed_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reset_security_pin(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM profiles
     WHERE user_id = auth.uid() AND lower(role) = 'administrador'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores podem resetar PINs';
  END IF;

  INSERT INTO user_security_pins (user_id, pin_hash, pin_required_setup, updated_at, removed_at, removed_by)
  VALUES (p_target_user_id, '', true, now(), now(), auth.uid())
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = '', failed_attempts = 0, locked_until = NULL,
        pin_required_setup = true, updated_at = now(),
        removed_at = now(), removed_by = auth.uid();

  INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
          'security_pin_admin_reset', 'user_security_pins', p_target_user_id::text,
          jsonb_build_object('target_user_id', p_target_user_id));
END;
$function$;
