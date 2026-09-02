-- O validador público passa a devolver o DOSSIÊ, não só um signatário.
--
-- Até aqui `public_verify_by_hash` respondia com UM signatário — o último que
-- assinou —, e nada sobre quem emitiu o documento nem sobre o que aconteceu
-- entre a criação e a assinatura. Quem chega na página de conferência (um
-- cartório, um banco, o advogado da outra parte) precisa ver o envelope
-- inteiro: quem criou, quem faltava assinar, quem já assinou, de onde e quando.
--
-- A função existente NÃO é reescrita. Ela é clonada para
-- `public_verify_by_hash_core` (byte a byte, via `pg_get_functiondef`) e o nome
-- público vira um invólucro que acrescenta as chaves novas ao JSON. Os seis
-- pontos de retorno do núcleo — cada um com o seu `jsonb_build_object` — ficam
-- intocados, e é por isso que este caminho é mais seguro do que redigitar 200
-- linhas de SQL para pendurar três chaves no fim de cada um.

-- ── 1) As chaves novas, num lugar só ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.public_verify_extras_json(p_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    -- TODOS os signatários do envelope, na ordem de assinatura. Inclui quem
    -- ainda não assinou: "assinado por 1 de 2" só existe se o segundo aparecer.
    'signers', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'email', s.email,
          -- O `email` do pré-cadastro é um placeholder interno
          -- (`public+<uuid>@crm.local`). O endereço real da pessoa é o que
          -- recebeu o link ou o código — ver `emailPublicoDoSignatario`.
          'auth_email', s.auth_email,
          'cpf', s.cpf,
          'phone', s.phone,
          'role', s.role,
          'order', s."order",
          'status', s.status,
          'signed_at', s.signed_at,
          'viewed_at', coalesce(s.viewed_at, s.opened_at),
          'refused_at', s.refused_at,
          'refusal_reason', s.refusal_reason,
          'signer_ip', s.signer_ip,
          -- A coordenada da assinatura. Junto com o IP, é o que responde "de
          -- onde". Sem consulta reversa: a página mostra a coordenada, nunca um
          -- nome de cidade inventado.
          'signer_geolocation', s.signer_geolocation,
          'auth_method', s.auth_method,
          'auth_provider', s.auth_provider,
          'auth_verified_channel', s.auth_verified_channel,
          'auth_verified_identifier', s.auth_verified_identifier,
          -- Booleanos, nunca os caminhos: quem confere precisa saber que houve
          -- selfie, não receber a selfie.
          'has_signature_image', (s.signature_image_path IS NOT NULL),
          'has_facial_image', (s.facial_image_path IS NOT NULL),
          'has_document_image', (s.document_image_path IS NOT NULL),
          'verification_hash', s.verification_hash
        )
        ORDER BY coalesce(s."order", 0), s.created_at
      )
      FROM public.signature_signers s
      WHERE s.signature_request_id = p_request_id
    ), '[]'::jsonb),

    -- Quem emitiu. É o escritório, não o cliente — e é o que dá lastro ao
    -- documento para quem nunca ouviu falar do Jurius.
    'creator', (
      SELECT jsonb_build_object('name', p.name, 'email', p.email, 'role', p.role)
      FROM public.signature_requests r
      JOIN public.profiles p ON p.user_id = r.created_by
      WHERE r.id = p_request_id
      LIMIT 1
    ),

    -- A trilha de auditoria.
    --
    -- `cancelled` fica DE FORA de propósito: nesta base ela é o carimbo de
    -- "removida do painel" (arquivamento interno), e algumas trazem o motivo
    -- digitado pelo escritório. Publicar isso faria a página anunciar
    -- "Solicitação arquivada" embaixo de uma assinatura válida — e ainda
    -- vazaria a anotação interna. O cancelamento de verdade aparece no status
    -- do envelope, não aqui.
    'history', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'action', a.action,
          'description', a.description,
          'created_at', a.created_at,
          'ip_address', a.ip_address,
          'signer_id', a.signer_id
        )
        ORDER BY a.created_at
      )
      FROM public.signature_audit_log a
      WHERE a.signature_request_id = p_request_id
        AND a.action <> 'cancelled'
    ), '[]'::jsonb),

    -- O SELO: quantos artefatos do envelope carregam assinatura criptográfica.
    --
    -- É um RESUMO, e resumo de propósito: um envelope com 1 de 3 selados não
    -- pode ser anunciado como "selado". A página só mostra o cartão quando há
    -- selo, e diz "parcial" quando é parcial — dizer mais do que se pode provar
    -- é o erro que este validador existe para não cometer.
    'selo', (
      WITH artefatos AS (
        SELECT d.pades_signed_at
        FROM public.signature_request_documents d
        WHERE d.signature_request_id = p_request_id
          AND d.signed_file_path IS NOT NULL
        UNION ALL
        -- Modelo consolidado: o artefato é do signatário, e só entra quando não
        -- há linhas de documento (senão o mesmo arquivo contaria duas vezes).
        SELECT s.pades_signed_at
        FROM public.signature_signers s
        WHERE s.signature_request_id = p_request_id
          AND s.signed_document_path IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.signature_request_documents d2
            WHERE d2.signature_request_id = p_request_id
              AND d2.signed_file_path IS NOT NULL
          )
      )
      SELECT jsonb_build_object(
        'total', count(*),
        'selados', count(pades_signed_at),
        'selado_em', max(pades_signed_at)
      )
      FROM artefatos
    ),

    -- O envelope em si: a data de criação é o "Criado em" do cabeçalho.
    'envelope', (
      SELECT jsonb_build_object(
        'id', r.id,
        'created_at', r.created_at,
        'signed_at', r.signed_at,
        'status', r.status,
        'document_name', r.document_name,
        'client_name', r.client_name,
        'signature_model', r.signature_model,
        'signing_order', r.signing_order,
        'envelope_verification_code', r.envelope_verification_code,
        'verification_hash', r.verification_hash
      )
      FROM public.signature_requests r
      WHERE r.id = p_request_id
      LIMIT 1
    )
  );
$function$;

-- ┌─ CORRIGIDO DEPOIS, E O ARQUIVO FOI EMENDADO DE PROPÓSITO ────────────────┐
-- │ Aqui havia `GRANT EXECUTE ... TO anon, authenticated`. Foi o furo: esta   │
-- │ função recebe o UUID do envelope — que é o PROTOCOLO impresso no rodapé   │
-- │ do PDF — e devolvia CPF, telefone, e-mail, IP, coordenadas e a trilha.    │
-- │                                                                          │
-- │ Normalmente não se edita migration já aplicada. Aqui se edita, porque     │
-- │ deixar o GRANT no arquivo significa que toda reconstrução do banco        │
-- │ REABRE o vazamento até a migration seguinte rodar. Um arquivo de          │
-- │ histórico não vale uma janela de exposição.                               │
-- │                                                                          │
-- │ Ver 20260902220000 (guarda + minimização) e 20260902220100 (núcleo).      │
-- └──────────────────────────────────────────────────────────────────────────┘
REVOKE ALL ON FUNCTION public.public_verify_extras_json(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_verify_extras_json(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.public_verify_extras_json(uuid) FROM authenticated;

-- ── 2) Clona a função atual como núcleo ─────────────────────────────────────
DO $do$
DECLARE
  d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'public_verify_by_hash';

  IF d IS NULL THEN
    RAISE EXCEPTION 'public_verify_by_hash nao encontrada';
  END IF;

  -- Reaplicar a migration não pode clonar o INVÓLUCRO por cima do núcleo: isso
  -- faria a função chamar a si mesma para sempre.
  IF position('public_verify_extras_json' in d) > 0 THEN
    RAISE NOTICE 'nucleo ja extraido; nada a clonar';
    RETURN;
  END IF;

  EXECUTE replace(
    d,
    'FUNCTION public.public_verify_by_hash(p_hash text)',
    'FUNCTION public.public_verify_by_hash_core(p_hash text)'
  );
END
$do$;

-- Só de PUBLIC NÃO BASTA neste projeto: o Supabase concede EXECUTE nominal a
-- anon/authenticated por privilégio padrão. Ver 20260902220100.
REVOKE ALL ON FUNCTION public.public_verify_by_hash_core(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_verify_by_hash_core(text) FROM anon;
REVOKE ALL ON FUNCTION public.public_verify_by_hash_core(text) FROM authenticated;

-- ── 3) O invólucro público ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.public_verify_by_hash(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
  v_request_id uuid;
BEGIN
  v_out := public.public_verify_by_hash_core(p_hash);
  IF v_out IS NULL THEN RETURN NULL; END IF;

  BEGIN
    v_request_id := nullif(v_out #>> '{request,id}', '')::uuid;
  EXCEPTION WHEN others THEN
    v_request_id := NULL;
  END;

  IF v_request_id IS NULL THEN RETURN v_out; END IF;

  RETURN v_out || public.public_verify_extras_json(v_request_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_verify_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_verify_by_hash(text) TO anon, authenticated;
