-- ============================================================================
-- WhatsApp — a agenda de "Nova conversa" para de vir inteira de uma vez.
--
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- `whatsapp_contact_book()` não tem parâmetro nenhum: abrir "Nova conversa"
-- baixava NOME + TELEFONE de todo cliente não arquivado do escritório, numa
-- resposta só, para depois filtrar no navegador.
--
-- O CPF já saiu dessa resposta (migration `whatsapp_contact_book_sem_cpf`), e
-- era ele o dado sensível. O que sobra é volume: a lista cresce com a carteira,
-- e uma agenda inteira numa resposta é uma resposta que fica cara justamente
-- quando o escritório cresce — e é baixada de novo a cada abertura do painel,
-- do discador e do "enviar contato".
--
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
-- A mesma função ganha `p_query` e `p_limit`:
--
--   · sem `p_query`, devolve a PRIMEIRA página em ordem alfabética. É o que o
--     painel carrega na abertura, e é o que dá o filtro instantâneo enquanto se
--     digita — a decisão de peneirar no navegador continua valendo, ela só
--     deixou de ser "peneirar TUDO";
--   · com `p_query` (2+ caracteres), procura no servidor por nome ou por
--     dígitos do telefone. É a rede para quem está além da primeira página.
--
-- A tela usa os dois: página na abertura, busca no servidor a partir da segunda
-- letra, e junta os dois conjuntos. Quem digita continua vendo resultado no
-- mesmo quadro; quem tem 40 mil clientes deixa de baixar 40 mil linhas para
-- achar um.
--
-- O DEFAULT do limite é grande de propósito (500). Ele não é uma trava de
-- segurança — é o ponto em que a resposta deixa de ser instantânea. A trava
-- continua sendo `is_office_staff()`, dentro da função.
-- ============================================================================

begin;

drop function if exists public.whatsapp_contact_book();

create or replace function public.whatsapp_contact_book(
  p_query text default null,
  p_limit integer default 500
)
returns table (
  client_id uuid,
  full_name text,
  phone text,
  phone_kind text,
  photo_path text,
  wa_avatar_path text,
  is_pre_cadastro boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  with q as (
    select btrim(coalesce(p_query, '')) as raw,
           regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digitos,
           least(greatest(coalesce(p_limit, 500), 1), 2000) as teto
  ),
  numeros as (
    select c.id, c.full_name, c.photo_path, c.is_pre_cadastro,
           t.kind,
           regexp_replace(t.raw, '\D', '', 'g') as digitos
      from clients c, q
      cross join lateral (values (c.mobile, 'mobile'), (c.phone, 'phone')) as t(raw, kind)
     where public.is_office_staff()
       and c.status <> 'arquivado'
       and c.merged_into_client_id is null
       and t.raw is not null
       -- Busca sob demanda: só quando há pelo menos 2 caracteres. Abaixo disso
       -- toda agenda casaria, e o "filtro" seria a lista inteira de novo.
       and (
         length(q.raw) < 2
         or c.full_name ilike '%' || q.raw || '%'
         or (q.digitos <> '' and regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g') like '%' || q.digitos || '%')
         or (q.digitos <> '' and regexp_replace(coalesce(c.phone,  ''), '\D', '', 'g') like '%' || q.digitos || '%')
       )
  ),
  unicos as (
    select distinct on (id, digitos) *
      from numeros
     where length(digitos) >= 10
     order by id, digitos, kind
  )
  select u.id, u.full_name, u.digitos, u.kind, u.photo_path,
         (select w.contact_avatar_path
            from whatsapp_conversations w
           where w.contact_avatar_path is not null
             and right(regexp_replace(w.contact_phone, '\D', '', 'g'), 8) = right(u.digitos, 8)
             and public.wa_can_see_conv(w.instance_id, w.department_id, w.assigned_user_id, w.id)
           order by w.last_message_at desc nulls last
           limit 1),
         u.is_pre_cadastro
    from unicos u, q
   order by u.full_name, u.kind
   limit (select teto from q);
$$;

revoke all on function public.whatsapp_contact_book(text, integer) from public, anon;
grant execute on function public.whatsapp_contact_book(text, integer) to authenticated, service_role;

commit;
