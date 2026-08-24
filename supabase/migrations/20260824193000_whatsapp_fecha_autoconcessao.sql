-- ============================================================================
-- WhatsApp — fecha a autoconcessão por `whatsapp_transfers`.
--
-- Este é um RECORTE da 20260822090000_whatsapp_permissoes_nucleo.sql, que
-- nunca foi aplicada. Ela conserta muito mais (supervisor por canal, setor,
-- colaboradores, SLA) e depende de colunas e funções que ainda não existem em
-- produção. Aqui vai só o que fecha a escalada de privilégio, escrito com as
-- colunas que a tabela TEM hoje, para poder subir sozinho e ser revisável.
--
--
-- ── O FURO, MEDIDO EM PRODUÇÃO ANTES DESTA MIGRATION ────────────────────────
--
-- Como uma Auxiliar (não administradora), contra uma conversa de canal
-- `restricted` da qual ela não era membro nem responsável:
--
--   A. antes             → enxergo=false, linhas=0, mensagens=0
--   B. depois do INSERT  → enxergo=true,  linhas=1, mensagens=8
--
-- O "INSERT" é uma linha só, com dados que a própria inbox já entrega:
--
--     insert into whatsapp_transfers (conversation_id, to_user_id)
--     values ('<uuid da conversa>', '<eu mesmo>');
--
-- Nenhum id secreto é necessário. Duas coisas se somavam:
--
--   1. `wa_can_see_conv` aceitava QUALQUER linha de `whatsapp_transfers` como
--      crachá — sem estado, sem prazo, para sempre.
--   2. A policy de INSERT dessa tabela era só `is_office_staff()`. Ou seja: o
--      crachá não precisava ser concedido por ninguém.
--
-- E um terceiro, independente dos dois:
--
--   3. `is_office_staff()` era `EXISTS (select 1 from profiles ...)`, SEM
--      `is_active`. Desligar alguém no CRM não tirava nada enquanto o JWT
--      dele valesse — e ele vale semanas, com refresh.
--
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--
--   · `is_office_staff()` passa a exigir `is_active`;
--   · o histórico de transferência deixa de conceder qualquer coisa. Só uma
--     transferência PENDENTE e no prazo concede, e ela acaba sozinha;
--   · `whatsapp_transfers` para de aceitar escrita direta pelo PostgREST.
--
-- Fechar a escrita direta é seguro porque ninguém escreve ali por fora: as sete
-- funções de atendimento (`wa_transfer_contact_attendance`,
-- `wa_accept_contact_transfer`, `wa_assign_contact_attendance`,
-- `wa_assume_contact_attendance`, `wa_release_contact_attendance`,
-- `wa_close_contact_attendance`, `wa_reopen_contact_attendance`) são todas
-- SECURITY DEFINER, e o frontend não tem uma única chamada a
-- `from('whatsapp_transfers')`. As Edge Functions usam service role, que passa
-- por cima da RLS.
--
-- Nota sobre o prazo: a migration de núcleo guarda `status` e `expires_at` em
-- colunas próprias. Aqui elas ainda não existem, então "pendente e no prazo" é
-- lido do que a tabela já tem — `accepted_at is null` e uma janela de 24h a
-- partir de `created_at`. A semântica é a mesma; quando o núcleo subir, ele
-- substitui estas funções pelas versões com coluna de estado.
-- ============================================================================

-- ── 1. Trabalhar aqui é estar ativo ─────────────────────────────────────────

create or replace function public.is_office_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid()
       and p.is_active is true
  );
$$;

comment on function public.is_office_staff() is
  'É gente da casa E está ativa. O `is_active` não é detalhe: sem ele, desligar '
  'alguém no CRM não tirava acesso nenhum enquanto o JWT valesse.';

-- ── 2. Só transferência PENDENTE concede, e ela vence sozinha ───────────────

create or replace function public.wa_transfer_default_ttl()
returns interval
language sql
immutable
as $$ select interval '24 hours' $$;

create index if not exists whatsapp_transfers_pendentes_idx
  on public.whatsapp_transfers (conversation_id, to_user_id, created_at desc)
  where accepted_at is null;

-- Uma transferência pendente destinada a MIM (ou ao meu setor), ainda no prazo.
-- É a única forma de o histórico de transferências conceder qualquer coisa.
create or replace function public.wa_pending_transfer_for_me(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
      from public.whatsapp_transfers t
     where t.conversation_id = p_conv
       and t.accepted_at is null
       and t.created_at > now() - public.wa_transfer_default_ttl()
       and (
         t.to_user_id = auth.uid()
         or (
           t.to_user_id is null
           and t.to_department_id is not null
           and exists (
             select 1 from public.whatsapp_department_members dm
              where dm.department_id = t.to_department_id
                and dm.user_id = auth.uid()
           )
         )
       )
  );
$$;

-- Durante o pendente, a ORIGEM também precisa continuar enxergando: ela ainda
-- responde pelo atendimento até alguém aceitar, e é dela a decisão de cancelar.
-- Diferente do que havia antes, isto acaba quando o pendente acaba.
create or replace function public.wa_pending_transfer_from_me(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
      from public.whatsapp_transfers t
     where t.conversation_id = p_conv
       and t.accepted_at is null
       and t.created_at > now() - public.wa_transfer_default_ttl()
       and (t.from_user_id = auth.uid() or t.performed_by = auth.uid())
  );
$$;

-- ── 3. A conversa para de aceitar histórico como crachá ─────────────────────

create or replace function public.wa_can_see_conv(p_channel uuid, p_dept uuid, p_assigned uuid, p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_office_staff() and (
    public.wa_is_supervisor()
    or p_assigned = auth.uid()
    -- Era: existe QUALQUER linha em whatsapp_transfers com meu id.
    -- Agora: existe uma pendente, no prazo, endereçada a mim (ou saída de mim).
    or public.wa_pending_transfer_for_me(p_conv)
    or public.wa_pending_transfer_from_me(p_conv)
    or (
      (
        p_channel is null
        or exists (
          select 1
          from public.whatsapp_instances i
          where i.id = p_channel and i.visibility_mode = 'all'
        )
        or exists (
          select 1
          from public.whatsapp_channel_members cm
          where cm.channel_id = p_channel and cm.user_id = auth.uid()
        )
      )
      and (
        p_dept is null
        or not exists (
          select 1
          from public.whatsapp_department_members dm
          where dm.department_id = p_dept
        )
        or exists (
          select 1
          from public.whatsapp_department_members dm
          where dm.department_id = p_dept and dm.user_id = auth.uid()
        )
      )
    )
  );
$$;

comment on function public.wa_can_see_conv(uuid, uuid, uuid, uuid) is
  'Pode LER a conversa. Transferência ANTIGA não concede mais nada: só a '
  'pendente e no prazo, que acaba sozinha.';

-- ── 4. O crachá deixa de ser autosserviço ───────────────────────────────────
--
-- Sem escrita direta pelo PostgREST. Quem transfere é RPC SECURITY DEFINER,
-- que decide se pode; quem ingere é service role, que ignora RLS. A leitura
-- continua como estava.

drop policy if exists wa_transfers_insert on public.whatsapp_transfers;
drop policy if exists wa_transfers_update on public.whatsapp_transfers;
drop policy if exists wa_transfers_delete on public.whatsapp_transfers;

create policy wa_transfers_sem_insert_direto on public.whatsapp_transfers
  for insert to authenticated with check (false);

create policy wa_transfers_sem_update_direto on public.whatsapp_transfers
  for update to authenticated using (false) with check (false);

create policy wa_transfers_sem_delete_direto on public.whatsapp_transfers
  for delete to authenticated using (false);
