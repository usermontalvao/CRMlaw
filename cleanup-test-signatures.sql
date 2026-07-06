-- ============================================================================
-- LIMPEZA DE ASSINATURAS DE TESTE  (rodar no SQL Editor do Supabase)
-- Alvo: PEDRO RODRIGUES MONTALVAO NETO / NEOT + 3 arquivos de teste avulsos.
-- Clientes reais (PEDRO PAULO, etc.) NAO sao afetados.
--
-- Rode os blocos NA ORDEM. Leia o bloco 0 (preview) antes de apagar.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCO 0 — PREVIEW (somente leitura; nao altera nada). Confira o resultado.
-- ----------------------------------------------------------------------------
with cand as (
  select id, client_name, document_name, signature_model, status, created_at
  from signature_requests
  where client_name ilike '%MONTALVAO NETO%'
     or client_name ilike '%MONTALVAO NEOT%'
     or id in ('b568ccb0-0a01-4b03-96be-e0c177e3718b',
               '59b74202-3661-4bb5-a629-3b41f9ec2afe',
               '82e44435-1661-4b28-9631-554bd9286f0e')
)
select
  (select count(*) from cand)                          as total,
  (select count(*) from cand where status='signed')    as assinadas,
  (select count(*) from cand where status='pending')   as pendentes,
  (select array_agg(distinct coalesce(client_name,'(sem nome)')) from cand) as nomes;
-- Esperado: total 48, assinadas 43, pendentes 5, nomes apenas MONTALVAO NETO/NEOT + (sem nome).


-- ----------------------------------------------------------------------------
-- BLOCO 1 — STORAGE (remove os registros dos arquivos: selfies, assinaturas,
-- PDFs assinados, documentos). Precisa desabilitar o trigger de protecao.
--
-- OBS IMPORTANTE: isto apaga o REGISTRO do arquivo (fica 100% inacessivel/404).
-- Os bytes fisicos no bucket so sao removidos de fato pela Storage API — se
-- quiser o apagamento fisico completo, use o script Node (service role) em vez
-- deste bloco. Para limpeza de teste, tornar inacessivel costuma bastar.
--
-- Se a linha "set role" der "permission denied", PULE o Bloco 1 e faca o
-- storage pelo script Node; rode so o Bloco 2 aqui.
-- ----------------------------------------------------------------------------
begin;

set role supabase_storage_admin;
alter table storage.objects disable trigger protect_objects_delete;

with cand as (
  select id from signature_requests
  where client_name ilike '%MONTALVAO NETO%'
     or client_name ilike '%MONTALVAO NEOT%'
     or id in ('b568ccb0-0a01-4b03-96be-e0c177e3718b',
               '59b74202-3661-4bb5-a629-3b41f9ec2afe',
               '82e44435-1661-4b28-9631-554bd9286f0e')
),
paths as (
  select r.document_path p from signature_requests r join cand c on c.id=r.id where r.document_path is not null
  union select unnest(r.attachment_paths) from signature_requests r join cand c on c.id=r.id where r.attachment_paths is not null
  union select r.signature_image_path from signature_requests r join cand c on c.id=r.id where r.signature_image_path is not null
  union select r.facial_image_path from signature_requests r join cand c on c.id=r.id where r.facial_image_path is not null
  union select r.document_image_path from signature_requests r join cand c on c.id=r.id where r.document_image_path is not null
  union select s.signature_image_path from signature_signers s join cand c on c.id=s.signature_request_id where s.signature_image_path is not null
  union select s.facial_image_path from signature_signers s join cand c on c.id=s.signature_request_id where s.facial_image_path is not null
  union select s.document_image_path from signature_signers s join cand c on c.id=s.signature_request_id where s.document_image_path is not null
  union select s.signed_document_path from signature_signers s join cand c on c.id=s.signature_request_id where s.signed_document_path is not null
  union select d.source_file_path from signature_request_documents d join cand c on c.id=d.signature_request_id where d.source_file_path is not null
  union select d.signed_file_path from signature_request_documents d join cand c on c.id=d.signature_request_id where d.signed_file_path is not null
)
delete from storage.objects o
using paths p
where o.name = p.p
  and o.bucket_id in ('document-templates','assinados','generated-documents');

alter table storage.objects enable trigger protect_objects_delete;
reset role;

commit;


-- ----------------------------------------------------------------------------
-- BLOCO 2 — BANCO (apaga as 48 solicitacoes; o CASCADE limpa signatarios,
-- auditoria, campos, documentos per-document, OTPs e disparos de e-mail).
-- Inclui TRAVA DE SEGURANCA: aborta se algum cliente inesperado entrar no set.
-- ----------------------------------------------------------------------------
begin;

-- trava: nenhum cliente real pode estar no conjunto
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from signature_requests
  where (client_name ilike '%MONTALVAO NETO%'
         or client_name ilike '%MONTALVAO NEOT%'
         or id in ('b568ccb0-0a01-4b03-96be-e0c177e3718b',
                   '59b74202-3661-4bb5-a629-3b41f9ec2afe',
                   '82e44435-1661-4b28-9631-554bd9286f0e'))
    and client_name is not null
    and client_name !~* 'MONTALVAO\s+NE[TO]{2}'
    and id not in ('b568ccb0-0a01-4b03-96be-e0c177e3718b',
                   '59b74202-3661-4bb5-a629-3b41f9ec2afe',
                   '82e44435-1661-4b28-9631-554bd9286f0e');
  if v_bad > 0 then
    raise exception 'ABORTADO: % linha(s) com cliente inesperado no conjunto', v_bad;
  end if;
end $$;

delete from signature_requests
where client_name ilike '%MONTALVAO NETO%'
   or client_name ilike '%MONTALVAO NEOT%'
   or id in ('b568ccb0-0a01-4b03-96be-e0c177e3718b',
             '59b74202-3661-4bb5-a629-3b41f9ec2afe',
             '82e44435-1661-4b28-9631-554bd9286f0e');

commit;


-- ----------------------------------------------------------------------------
-- BLOCO 3 — CONFERENCIA (deve retornar 0)
-- ----------------------------------------------------------------------------
select count(*) as restantes
from signature_requests
where client_name ilike '%MONTALVAO NETO%'
   or client_name ilike '%MONTALVAO NEOT%'
   or id in ('b568ccb0-0a01-4b03-96be-e0c177e3718b',
             '59b74202-3661-4bb5-a629-3b41f9ec2afe',
             '82e44435-1661-4b28-9631-554bd9286f0e');
