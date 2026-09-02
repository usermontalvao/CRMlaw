-- SEGURANÇA: o dossiê público vazava por dois caminhos.
--
-- Achado em auditoria e confirmado em produção antes da correção:
--
--  1) `public_verify_extras_json` estava concedida a `anon` e recebe o UUID da
--     solicitação — que é o PROTOCOLO, impresso no rodapé de toda página do
--     PDF. Um POST com a chave anônima e o protocolo devolvia CPF, telefone,
--     e-mail, IP, coordenadas de GPS, identificador de autenticação, a trilha
--     inteira e os dados de quem emitiu. Um auxiliar interno virou endpoint de
--     consulta a dado pessoal.
--
--  2) A função não olhava `blocked_at` nem `deleted_at`. Envelope BLOQUEADO
--     pelo escritório respondia `status: blocked` na tela e entregava o dossiê
--     completo no MESMO payload — o interruptor não bloqueava nada. Havia 13
--     bloqueados e 1 excluído em produção quando isto foi corrigido.
--
-- E aplica a MINIMIZAÇÃO (LGPD, arts. 6º, III e 46). O argumento que decide:
-- a prova completa já viaja dentro do PDF assinado — selfie, IP, coordenadas e
-- trilha estão na página de biometria do próprio arquivo, que é lacrado
-- criptograficamente. Quem tem direito à evidência já tem o documento. A
-- página pública não precisa ser uma segunda cópia do dossiê: o trabalho dela
-- é confirmar autenticidade e dizer quem assinou. Então sai o dado pessoal que
-- não serve a esse fim, e fica INTEIRA a prova de integridade — que é
-- justamente a parte sem dado nenhum.

-- ── As máscaras ─────────────────────────────────────────────────────────────
-- Aplicadas NA FONTE, não na tela: valem para qualquer caminho de leitura.
CREATE OR REPLACE FUNCTION public.mascarar_cpf_publico(p_cpf text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')) <> 11 THEN NULL
    ELSE '***.' || substr(regexp_replace(p_cpf, '\D', '', 'g'), 4, 3)
         || '.'  || substr(regexp_replace(p_cpf, '\D', '', 'g'), 7, 3) || '-**'
  END;
$function$;

-- Guarda a primeira letra e o domínio: dá para CASAR o endereço sem publicá-lo.
CREATE OR REPLACE FUNCTION public.mascarar_email_publico(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN coalesce(btrim(p_email), '') = '' THEN NULL
    WHEN position('@' in p_email) < 2 THEN NULL
    ELSE left(p_email, 1) || '****@' || split_part(p_email, '@', 2)
  END;
$function$;

-- ── O dossiê, com guarda e minimização ──────────────────────────────────────
-- A guarda entra AQUI DENTRO, e não só em quem chama: guarda no chamador
-- protege um caminho; guarda na fonte protege todos, inclusive os que ainda
-- não existem.
CREATE OR REPLACE FUNCTION public.public_verify_extras_json(p_request_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.signature_requests r
      WHERE r.id = p_request_id
        AND r.blocked_at IS NULL
        AND r.deleted_at IS NULL
    ) THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'signers', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'email', public.mascarar_email_publico(s.email),
            'auth_email', public.mascarar_email_publico(s.auth_email),
            'cpf', public.mascarar_cpf_publico(s.cpf),
            -- telefone e coordenadas ficam FORA da página pública; continuam no
            -- PDF assinado e no CRM, para quem tem direito à evidência.
            'role', s.role,
            'order', s."order",
            'status', s.status,
            'signed_at', s.signed_at,
            'viewed_at', coalesce(s.viewed_at, s.opened_at),
            'refused_at', s.refused_at,
            'refusal_reason', s.refusal_reason,
            'signer_ip', s.signer_ip,
            'auth_method', s.auth_method,
            'auth_provider', s.auth_provider,
            'auth_verified_channel', s.auth_verified_channel,
            'auth_verified_identifier', CASE
              WHEN position('@' in coalesce(s.auth_verified_identifier, '')) > 1
                THEN public.mascarar_email_publico(s.auth_verified_identifier)
              ELSE NULL
            END,
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
      -- O NOME do escritório identifica quem emitiu; o e-mail dele é contato,
      -- não elemento de prova.
      'creator', (
        SELECT jsonb_build_object('name', p.name, 'role', p.role)
        FROM public.signature_requests r
        JOIN public.profiles p ON p.user_id = r.created_by
        WHERE r.id = p_request_id
        LIMIT 1
      ),
      'history', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'action', a.action,
            -- A `description` carrega e-mail e coordenadas em texto corrido
            -- ("… (IP: x)", "concedeu acesso … coordenadas …"). Publicá-la
            -- desfaria a máscara aplicada acima, então a página pública recebe
            -- só o TIPO do evento e quando.
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
      'selo', (
        WITH artefatos AS (
          SELECT d.pades_signed_at
          FROM public.signature_request_documents d
          WHERE d.signature_request_id = p_request_id
            AND d.signed_file_path IS NOT NULL
          UNION ALL
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
    )
  END;
$function$;

-- ── E O ACESSO DIRETO FECHA ─────────────────────────────────────────────────
--
-- ATENÇÃO — `REVOKE ... FROM PUBLIC` NÃO FECHA NADA NESTE PROJETO. O Supabase
-- mantém privilégios padrão que concedem EXECUTE explicitamente a `anon` e
-- `authenticated` em toda função criada no schema `public`. Revogar só de
-- PUBLIC remove um grant que nem existe. Auxiliar se fecha pelos TRÊS.
REVOKE ALL ON FUNCTION public.public_verify_extras_json(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_verify_extras_json(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.public_verify_extras_json(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.mascarar_cpf_publico(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mascarar_cpf_publico(text) FROM anon;
REVOKE ALL ON FUNCTION public.mascarar_cpf_publico(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.mascarar_email_publico(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mascarar_email_publico(text) FROM anon;
REVOKE ALL ON FUNCTION public.mascarar_email_publico(text) FROM authenticated;
