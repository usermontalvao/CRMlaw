-- ============================================================================
-- ASSINATURA PÚBLICA — três buracos, um arquivo.
--
-- Todos são do MESMO tipo: o servidor aceitava do cliente um dado que só ele
-- podia saber. Vão juntos porque separá-los deixaria metade do caminho aberto.
-- ============================================================================


-- ── 1 · O TOKEN DE OUTRO SIGNATÁRIO VAZAVA ──────────────────────────────────
--
-- `public_signing_request_signers` devolvia `s.*` — a LINHA INTEIRA de todos os
-- signatários do envelope, `public_token` inclusive. Esse token é a credencial
-- ao portador: com ele em mãos abre-se o link do outro e assina-se no lugar
-- dele. Quem tem um link legítimo do envelope tinha, de brinde, os dos demais.
--
-- Isso ficou MAIS grave com a decisão de não exigir que a conta autenticada
-- seja a da pessoa cadastrada (o Google/OTP prova que alguém controla uma
-- identidade, e o sistema apenas REGISTRA qual foi — `auth_verified_*`). Sem
-- esse confronto, o `public_token` é a única coisa que diz quem é o signatário.
--
-- O conserto é cirúrgico de propósito: a função continua devolvendo
-- `SETOF signature_signers`, com todas as colunas na mesma ordem, e apenas
-- ANULA as duas que não têm uso nenhum na tela nem no PDF. Verificado antes de
-- escrever: `public_token` e `auth_google_sub` não são lidos em lugar algum do
-- relatório (o único consumidor é `getPublicReportSigners`). O certificado sai
-- byte a byte igual.
--
-- Percorre linha a linha em vez de listar 47 colunas: coluna nova amanhã passa
-- a sair sozinha, sem ninguém precisar lembrar de acrescentá-la aqui.
create or replace function public.public_signing_request_signers(p_token uuid)
returns setof public.signature_signers
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  r public.signature_signers;
begin
  select signature_request_id into v_request_id
  from public.signature_signers
  where public_token = p_token
  limit 1;

  if v_request_id is null then
    return;
  end if;

  for r in
    select s.*
    from public.signature_signers s
    where s.signature_request_id = v_request_id
    order by s."order" asc nulls last
  loop
    -- Credencial ao portador: nunca sai desta função, nem para o próprio dono
    -- (que já a tem no endereço que está abrindo).
    r.public_token := null;
    -- Identificador estável da conta Google de outra pessoa. Não é exibido em
    -- lugar nenhum, e serve para cruzar contas fora daqui.
    r.auth_google_sub := null;
    return next r;
  end loop;
end;
$function$;


-- ── 2 · QUALQUER UM ESCREVIA NA TRILHA DE AUDITORIA ──────────────────────────
--
-- `public_log_viewed_event(p_signer_id, p_ip_address, p_user_agent)` estava
-- concedida a PUBLIC e aceitava o `signer_id` CRU — sem token, sem prova de
-- nada. Combinada com o vazamento do item 1, dava para fabricar eventos
-- "visualizado" com IP escolhido a dedo na trilha de qualquer assinatura. A
-- trilha é justamente a peça em que a defesa se apoia.
--
-- Ela não tem um único chamador: nem no app, nem em Edge Function. É código
-- morto que ficou com a porta aberta. Some.
drop function if exists public.public_log_viewed_event(uuid, text, text);


-- ── 3 · O IP DA TRILHA ERA ESCOLHIDO PELO NAVEGADOR ─────────────────────────
--
-- `public_mark_signer_viewed` (esta sim é a que o app chama) gravava o IP que
-- vinha no parâmetro. E o parâmetro vinha do NAVEGADOR, que o buscava na
-- api.ipify.org — quem montasse a chamada à mão escolhia o próprio IP.
--
-- Agora o IP sai do CABEÇALHO da requisição, e a ordem foi medida contra esta
-- infraestrutura, não escolhida por gosto. Mandando `X-Forwarded-For` forjado
-- de fora, o Postgres recebeu:
--
--   x-forwarded-for  = 203.0.113.99,201.71.166.196   ← o forjado vem PRIMEIRO
--   cf-connecting-ip = 201.71.166.196                ← o real, reescrito pela CDN
--
-- Daí as duas regras: `cf-connecting-ip` primeiro (a Cloudflare o reescreve, o
-- que o cliente mandar nesse nome é descartado), e no `x-forwarded-for` vale o
-- ÚLTIMO item — cada proxy ANEXA à direita, então a ponta esquerda é a parte
-- que o cliente escreveu. Ler o primeiro seria ler exatamente o valor forjado.
--
-- O parâmetro `p_ip_address` CONTINUA na assinatura da função, e continua sendo
-- ignorado: o app publicado ainda o envia, e removê-lo agora quebraria toda
-- visualização até o deploy do front. Ele é aceito e descartado.
create or replace function public.public_mark_signer_viewed(
  p_token uuid,
  p_ip_address text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_signer_id   uuid;
  v_request_id  uuid;
  v_signer_name text;
  v_exists      boolean;
  v_description text;
  v_headers     jsonb;
  v_encadeado   text;
  v_ip          text;
begin
  if p_token is null then return; end if;

  -- Fora de uma chamada HTTP (psql, cron, um teste) não há cabeçalho nenhum, e
  -- `current_setting(..., true)` devolve null em vez de estourar.
  v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);

  v_ip := nullif(btrim(coalesce(v_headers ->> 'cf-connecting-ip', '')), '');
  if v_ip is null then
    v_ip := nullif(btrim(coalesce(v_headers ->> 'x-real-ip', '')), '');
  end if;
  if v_ip is null then
    v_encadeado := nullif(btrim(coalesce(v_headers ->> 'x-forwarded-for', '')), '');
    if v_encadeado is not null then
      -- O ÚLTIMO salto, não o primeiro. Ver o bloco acima.
      select nullif(btrim(t.parte), '')
        into v_ip
        from unnest(string_to_array(v_encadeado, ',')) with ordinality as t(parte, ord)
       where nullif(btrim(t.parte), '') is not null
       order by t.ord desc
       limit 1;
    end if;
  end if;
  -- Sem cabeçalho, o IP fica NULO. Cair de volta em `p_ip_address` desfaria o
  -- conserto: bastaria omitir os cabeçalhos para voltar a escolher o próprio.

  select ss.id, ss.signature_request_id, ss.name
    into v_signer_id, v_request_id, v_signer_name
    from public.signature_signers ss
   where ss.public_token = p_token
   limit 1;

  if v_signer_id is null then return; end if;

  update public.signature_signers
     set viewed_at = now()
   where id = v_signer_id and viewed_at is null;

  select exists(
    select 1 from public.signature_audit_log al
     where al.signature_request_id = v_request_id
       and al.signer_id = v_signer_id
       and al.action = 'viewed'
       and coalesce(al.ip_address,'') = coalesce(v_ip,'')
       and coalesce(al.user_agent,'') = coalesce(p_user_agent,'')
       and al.created_at >= (now() - interval '5 minutes')
  ) into v_exists;
  if v_exists then return; end if;

  v_description := coalesce(v_signer_name,'Signatário') || ' abriu o documento para leitura';
  if v_ip is not null then
    v_description := v_description || ' (IP: ' || v_ip || ')';
  end if;

  insert into public.signature_audit_log(signature_request_id, signer_id, action, description, ip_address, user_agent)
  values (v_request_id, v_signer_id, 'viewed', v_description, v_ip, p_user_agent);
end;
$function$;


-- ── 4 · O ANEXO ASSINADO NÃO OLHAVA O ESTADO NEM O CAMINHO ──────────────────
--
-- `public_attach_signed_document` conferia só que o SIGNATÁRIO estava 'signed'.
-- Faltavam duas travas:
--
--  a) Ciclo de vida. O `public-sign-document` passou a recusar assinatura em
--     documento na lixeira, arquivado, bloqueado, cancelado ou vencido — mas
--     esta função é OUTRA porta para a mesma casa, e ficou sem a tranca que a
--     vizinha ganhou. Dava para anexar documento a envelope cancelado.
--
--  b) Onde o arquivo mora. `p_signed_path` vinha inteiro do cliente e era
--     gravado como veio; podia apontar para qualquer chave do bucket, inclusive
--     o PDF assinado de outro processo. Conferido nos dados reais: todo
--     `signed_file_path` já começa com `<signature_request_id>/`, então exigir
--     esse prefixo não recusa nada que seja legítimo.
--
-- O que este arquivo NÃO conserta, e é o trabalho maior: `p_verification_code`,
-- `p_sha256` e `p_document_hash` continuam vindo do cliente. Não dá para o
-- servidor gerá-los aqui porque o código já foi CARIMBADO dentro do PDF pelo
-- navegador antes desta chamada — passar a gerá-lo no servidor exige mudar a
-- ordem do fluxo, o que é redesenho e não remendo. Fica anotado, não esquecido.
create or replace function public.public_attach_signed_document(
  p_token uuid,
  p_document_key text,
  p_document_type text,
  p_display_name text,
  p_source_file_path text,
  p_signed_path text,
  p_verification_code text,
  p_sha256 text default null,
  p_document_hash text default null,
  p_page_count integer default null,
  p_sort_order integer default 0
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_signer_id  uuid;
  v_request_id uuid;
  v_status     text;
  v_signed_at  timestamptz;
  v_request_status text;
  v_attachment_count int;
  v_expected_documents int;
  v_persisted_documents int;
  v_all_signed boolean;
  v_deleted_at timestamptz;
  v_archived_at timestamptz;
  v_blocked_at timestamptz;
  v_expires_at timestamptz;
BEGIN
  IF p_token IS NULL OR p_document_key IS NULL OR btrim(p_document_key) = '' THEN RETURN; END IF;
  IF p_signed_path IS NULL OR btrim(p_signed_path) = '' THEN RETURN; END IF;

  SELECT id, signature_request_id, status, signed_at
    INTO v_signer_id, v_request_id, v_status, v_signed_at
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  IF v_status <> 'signed' THEN RETURN; END IF;

  SELECT status, deleted_at, archived_at, blocked_at, expires_at,
         coalesce(array_length(attachment_paths, 1), 0)
    INTO v_request_status, v_deleted_at, v_archived_at, v_blocked_at, v_expires_at, v_attachment_count
    FROM public.signature_requests
   WHERE id = v_request_id;
  IF v_request_id IS NULL OR v_request_status IS NULL THEN RETURN; END IF;

  -- (a) Documento fora de circulação não recebe anexo. `signed` continua
  -- passando: os documentos de um envelope chegam um a um, e o último deles
  -- costuma chegar DEPOIS de a solicitação já ter virado 'signed'.
  --
  -- `archived_at` e o RELÓGIO de `expires_at` ficaram DE FORA da trava, embora
  -- o `public-sign-document` os recuse na hora de assinar. Lá eles impedem uma
  -- assinatura de começar; aqui barrariam o anexo de uma assinatura que JÁ
  -- aconteceu — arquivar (ou o relógio virar) no segundo entre assinar e anexar
  -- custaria o PDF de um ato válido. Fica o que significa "isto não pode
  -- receber dado": lixeira, bloqueio e cancelamento/recusa.
  IF v_deleted_at IS NOT NULL
     OR v_blocked_at IS NOT NULL
     OR v_request_status IN ('cancelled', 'canceled', 'expired', 'refused', 'rejected')
  THEN
    RAISE EXCEPTION 'Documento nao esta em estado que aceite anexos assinados.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) O arquivo tem de morar na pasta desta solicitação.
  IF p_signed_path NOT LIKE (v_request_id::text || '/%') THEN
    RAISE EXCEPTION 'Caminho do documento assinado nao pertence a esta solicitacao.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.signature_request_documents (
    signature_request_id, signer_id, document_type, document_key, display_name,
    source_file_path, signed_file_path, verification_code, signed_pdf_sha256,
    document_hash, page_count, sort_order, status, updated_at
  ) VALUES (
    v_request_id, v_signer_id, coalesce(p_document_type, 'attachment'), p_document_key, p_display_name,
    p_source_file_path, p_signed_path, p_verification_code, p_sha256,
    p_document_hash, p_page_count, coalesce(p_sort_order, 0), 'signed', now()
  )
  ON CONFLICT (signature_request_id, document_key) DO UPDATE SET
    signer_id         = EXCLUDED.signer_id,
    document_type     = coalesce(EXCLUDED.document_type, public.signature_request_documents.document_type),
    display_name      = coalesce(EXCLUDED.display_name, public.signature_request_documents.display_name),
    source_file_path  = coalesce(EXCLUDED.source_file_path, public.signature_request_documents.source_file_path),
    signed_file_path  = EXCLUDED.signed_file_path,
    verification_code = EXCLUDED.verification_code,
    signed_pdf_sha256 = EXCLUDED.signed_pdf_sha256,
    document_hash     = EXCLUDED.document_hash,
    page_count        = coalesce(EXCLUDED.page_count, public.signature_request_documents.page_count),
    sort_order        = coalesce(EXCLUDED.sort_order, public.signature_request_documents.sort_order),
    status            = 'signed',
    updated_at        = now()
  WHERE
    public.signature_request_documents.signer_id IS DISTINCT FROM EXCLUDED.signer_id
    AND (
      public.signature_request_documents.signer_id IS NULL
      OR COALESCE(
           (SELECT s_old.signed_at FROM public.signature_signers s_old
             WHERE s_old.id = public.signature_request_documents.signer_id),
           'epoch'::timestamptz)
         < COALESCE(v_signed_at, now())
    );

  UPDATE public.signature_requests
     SET envelope_verification_code = upper(replace(gen_random_uuid()::text, '-', ''))
   WHERE id = v_request_id AND envelope_verification_code IS NULL;

  v_expected_documents := 1 + coalesce(v_attachment_count, 0);

  SELECT count(*)
    INTO v_persisted_documents
  FROM public.signature_request_documents
  WHERE signature_request_id = v_request_id
    AND signed_file_path IS NOT NULL;

  SELECT coalesce(bool_and(status = 'signed'), false)
    INTO v_all_signed
  FROM public.signature_signers
  WHERE signature_request_id = v_request_id;

  IF coalesce(v_request_status, 'pending') <> 'signed'
     AND v_all_signed
     AND v_persisted_documents >= v_expected_documents THEN
    UPDATE public.signature_requests
       SET status = 'signed',
           signed_at = now()
     WHERE id = v_request_id
       AND status <> 'signed';

    INSERT INTO public.signature_audit_log (
      signature_request_id,
      signer_id,
      action,
      description
    ) VALUES (
      v_request_id,
      v_signer_id,
      'finalized',
      format('Envelope finalizado com %s documento(s) persistido(s).', v_persisted_documents)
    );
  END IF;
END;
$function$;


-- As permissões são reafirmadas porque `create or replace` de uma função que
-- MUDOU de assinatura cria outra; e porque, neste projeto, função nova nasce
-- com EXECUTE para PUBLIC por concessão padrão do Postgres — foi assim que o
-- bypass do núcleo se abriu da primeira vez.
revoke all on function public.public_signing_request_signers(uuid) from public;
revoke all on function public.public_mark_signer_viewed(uuid, text, text) from public;
revoke all on function public.public_attach_signed_document(uuid, text, text, text, text, text, text, text, text, integer, integer) from public;

grant execute on function public.public_signing_request_signers(uuid) to anon, authenticated, service_role;
grant execute on function public.public_mark_signer_viewed(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.public_attach_signed_document(uuid, text, text, text, text, text, text, text, text, integer, integer) to anon, authenticated, service_role;
