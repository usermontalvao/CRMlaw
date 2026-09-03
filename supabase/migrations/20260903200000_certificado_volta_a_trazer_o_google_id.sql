-- ============================================================================
-- O CERTIFICADO PAROU DE IMPRIMIR O "Google ID"
--
-- A migration 20260903021151 (assinatura_fecha_token_trilha_e_anexo) fechou um
-- buraco real: `public_signing_request_signers` devolvia o `public_token` dos
-- OUTROS signatários — credencial ao portador, com a qual se assina no lugar
-- deles. Esse conserto continua de pé e não é tocado aqui.
--
-- Junto dele, porém, a função passou a anular também `auth_google_sub`, com a
-- justificativa escrita de que a coluna "não é lida em lugar nenhum do
-- relatório" e de que "o certificado sai byte a byte igual". As duas
-- afirmações estão erradas, e o certificado mudou:
--
--   src/services/pdfSignature.service.ts:1458  buildAuthPoints        → "Google ID: …"
--   src/services/pdfSignature.service.ts:1461  buildAuthPoints        → "Google ID: …"
--   src/services/pdfSignature.service.ts:1996  buildTimelineAuthSummary
--   src/services/pdfSignature.service.ts:2008  buildTimelineAuthSummary
--
-- Quem GERA o PDF que fica dentro do documento é o navegador de quem assina, na
-- página pública, e ali os signatários vêm justamente desta função. Sem o
-- `sub`, a linha "Google ID" some do cartão FATORES DE AUTENTICAÇÃO e da trilha
-- de auditoria. O dado nunca deixou de ser gravado (`signature_signers` tem os
-- 137 subs), mas deixou de aparecer na prova — que é onde ele serve.
--
-- Por que devolvê-lo é seguro, e por que não desfaz o conserto anterior:
--
--   · O `sub` do Google é emitido POR APLICATIVO. O mesmo usuário tem um `sub`
--     diferente em cada client_id, então ele não cruza contas fora daqui — ao
--     contrário do que dizia o comentário original.
--   · Ele não abre porta nenhuma: não autentica, não assina, não identifica
--     sessão. O `public_token`, que sim faz isso, CONTINUA anulado abaixo.
--   · Esta mesma função já devolve, dos co-signatários, o e-mail autenticado, o
--     IP, a geolocalização e o caminho da selfie. Esconder o identificador
--     opaco e devolver o IP é a ordem inversa da sensibilidade.
--   · O certificado impresso é entregue a todas as partes do envelope de
--     qualquer forma, com o "Google ID" de cada signatário. O PDF gerado pelo
--     módulo interno já o traz; era só o gerado na página pública que não. Duas
--     versões diferentes do MESMO certificado é o pior dos mundos num documento
--     probatório.
-- ============================================================================
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
    -- (que já a tem no endereço que está abrindo). Este é o conserto de
    -- 20260903021151, e ele fica.
    r.public_token := null;
    -- `auth_google_sub` volta a sair: é o que imprime "Google ID: …" no
    -- certificado. Ver o cabeçalho deste arquivo.
    return next r;
  end loop;
end;
$function$;
