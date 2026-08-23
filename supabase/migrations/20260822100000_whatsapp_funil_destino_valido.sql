-- ============================================================================
-- O destino da transferência automática do funil passa a ser validado no banco.
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- `whatsapp_channel_funnel_stages.entry_actions` é um `jsonb` com um único
-- check: "é um array". Dentro dele, a ação de transferência guardava
--
--     {"type": "transfer_to_department", "target": "<uuid>"}
--
-- e NADA conferia esse uuid. Dava para salvar uma etapa apontando para:
--
--   · um setor excluído ou desativado;
--   · um setor sem nenhum atendente dentro (a conversa entra e some da fila de
--     todo mundo — ninguém é membro, logo ninguém a vê);
--   · uma pessoa desligada do escritório;
--   · uma pessoa que não tem acesso ao canal daquele funil — o caso grave, e o
--     único que não é descuido: bastava um POST ao PostgREST para plantar, no
--     funil do canal restrito, uma etapa que joga a conversa no colo de quem
--     não deveria enxergá-la.
--
-- Nada disso dava erro na hora de salvar. O erro nascia meses depois, quando um
-- card entrasse na etapa — e aí `wa_transfer_contact_attendance` recusava com
-- um 42501 que chegava à tela como "ação pendente", sem dizer o motivo.
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
--   1. `wa_funnel_destination_can_receive(canal, pessoa, setor)` — o gêmeo de
--      `wa_destination_can_access` para quando ainda NÃO existe conversa: a
--      pergunta é sobre o canal, que é o que o funil conhece na hora de salvar;
--   2. um trigger em `whatsapp_channel_funnel_stages` que valida cada ação de
--      transferência do array antes do insert/update, com mensagem que nomeia a
--      etapa e o motivo.
--
-- A trava da EXECUÇÃO não muda: `wa_transfer_contact_attendance` continua
-- chamando `wa_destination_can_access` com a conversa em mãos. As duas são
-- necessárias — o cadastro pode ser desativado depois de a etapa ser salva.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Quem pode receber uma conversa DESTE canal
--
-- Mesmas regras de `wa_destination_can_access`, com uma diferença nomeada: lá o
-- setor de referência é o da conversa; aqui não há conversa, então o setor de
-- referência é o próprio destino. É por isso que as duas funções existem em vez
-- de uma só com parâmetro opcional — a pergunta é genuinamente outra.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_funnel_destination_can_receive(
  p_channel uuid,
  p_to_user uuid,
  p_to_department uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  -- Destino de SETOR: existir, estar ativo e ter alguém dentro. Setor vazio
  -- recebe e ninguém vê — é perder a conversa, não encaminhá-la.
  if p_to_user is null then
    if p_to_department is null then return false; end if;
    return exists (
      select 1 from public.whatsapp_departments d
       where d.id = p_to_department and coalesce(d.is_active, true)
    ) and exists (
      select 1 from public.whatsapp_department_members dm
       where dm.department_id = p_to_department
    );
  end if;

  -- Destino PESSOA: ativa no escritório…
  if not exists (
    select 1 from public.profiles p where p.user_id = p_to_user and p.is_active is true
  ) then
    return false;
  end if;

  -- …e enxergando o canal do funil (administrador vê tudo; canal 'all' é aberto).
  return
    exists (select 1 from public.profiles p
             where p.user_id = p_to_user
               and lower(translate(coalesce(p.role, ''),
                     'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ',
                     'aaaaeeiooouucAAAAEEIOOOUUC')) = 'administrador')
    or p_channel is null
    or exists (select 1 from public.whatsapp_instances i
                where i.id = p_channel and i.visibility_mode = 'all')
    or exists (select 1 from public.whatsapp_channel_members cm
                where cm.channel_id = p_channel and cm.user_id = p_to_user);
end;
$$;

comment on function public.wa_funnel_destination_can_receive(uuid, uuid, uuid) is
  'Este destino pode receber uma conversa deste CANAL? Gêmeo de wa_destination_can_access para quando ainda não há conversa (configuração do funil).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O porteiro do `entry_actions`
--
-- Roda em qualquer caminho de escrita — PostgREST, SQL direto, service_role —,
-- que é o ponto: esconder a opção na tela não impede um POST.
--
-- `destination_id` é lido primeiro e `target` é o espelho legado. Uma etapa
-- salva antes desta série só tem `target`, e é dele que a validação sai; o
-- `type` da ação é o que diz de qual tabela o uuid veio.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.wa_funnel_entry_actions_check()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_action    jsonb;
  v_type      text;
  v_dest_kind text;
  v_dest_id   uuid;
  v_dest_raw  text;
begin
  if new.entry_actions is null or jsonb_typeof(new.entry_actions) <> 'array' then
    return new;
  end if;

  for v_action in select * from jsonb_array_elements(new.entry_actions) loop
    if jsonb_typeof(v_action) <> 'object' then continue; end if;
    v_type := v_action->>'type';
    if v_type not in ('transfer_to_user', 'transfer_to_department') then continue; end if;

    -- `destination_type` manda quando existe; sem ele, o `type` da ação decide.
    v_dest_kind := v_action->>'destination_type';
    if v_dest_kind not in ('user', 'department') then
      v_dest_kind := case when v_type = 'transfer_to_department' then 'department' else 'user' end;
    end if;

    -- Tipo e destino discordando entra aqui como erro, não como palpite: um id
    -- de setor guardado como `transfer_to_user` transferiria para ninguém.
    if (v_dest_kind = 'department') <> (v_type = 'transfer_to_department') then
      raise exception
        'Etapa “%”: o tipo de destino (%) não combina com a ação (%).',
        new.label, v_dest_kind, v_type
        using errcode = '22023';
    end if;

    v_dest_raw := coalesce(nullif(btrim(coalesce(v_action->>'destination_id', '')), ''),
                           nullif(btrim(coalesce(v_action->>'target', '')), ''));
    if v_dest_raw is null then
      raise exception 'Etapa “%”: escolha o destino da transferência automática.', new.label
        using errcode = '22023';
    end if;

    begin
      v_dest_id := v_dest_raw::uuid;
    exception when others then
      raise exception 'Etapa “%”: o destino da transferência não é um cadastro válido.', new.label
        using errcode = '22023';
    end;

    if not public.wa_funnel_destination_can_receive(
         new.channel_id,
         case when v_dest_kind = 'user' then v_dest_id end,
         case when v_dest_kind = 'department' then v_dest_id end
       ) then
      raise exception
        'Etapa “%”: o destino escolhido não existe, está desativado, não tem atendentes ou não tem acesso a este canal.',
        new.label
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.wa_funnel_entry_actions_check() is
  'Valida o destino de cada ação de transferência do funil ANTES de gravar. Sem isto, o uuid dentro do jsonb nunca era conferido.';

drop trigger if exists wa_funnel_entry_actions_check on public.whatsapp_channel_funnel_stages;

create trigger wa_funnel_entry_actions_check
  before insert or update of entry_actions, channel_id
  on public.whatsapp_channel_funnel_stages
  for each row
  execute function public.wa_funnel_entry_actions_check();

grant execute on function public.wa_funnel_destination_can_receive(uuid, uuid, uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. As etapas que JÁ estão salvas apontando para o vazio
--
-- Elas não são apagadas nem "consertadas": corrigir sozinho trocaria o destino
-- de uma automação sem ninguém pedir, que é justamente o defeito que esta série
-- combate. Ficam listadas para quem for revisar — o trigger só vale para
-- escritas novas, então nenhuma etapa antiga quebra ao subir esta migration.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_linha record;
  v_total integer := 0;
begin
  for v_linha in
    select s.channel_id, s.label, a->>'type' as tipo,
           coalesce(a->>'destination_id', a->>'target') as destino
      from public.whatsapp_channel_funnel_stages s,
           lateral jsonb_array_elements(s.entry_actions) a
     where a->>'type' in ('transfer_to_user', 'transfer_to_department')
  loop
    if v_linha.destino is null
       or not public.wa_funnel_destination_can_receive(
            v_linha.channel_id,
            case when v_linha.tipo = 'transfer_to_user' then v_linha.destino::uuid end,
            case when v_linha.tipo = 'transfer_to_department' then v_linha.destino::uuid end) then
      v_total := v_total + 1;
      raise warning 'Funil: etapa "%" (canal %) transfere para um destino que não pode receber (%).',
        v_linha.label, v_linha.channel_id, coalesce(v_linha.destino, 'sem destino');
    end if;
  end loop;
  if v_total > 0 then
    raise warning 'Funil: % etapa(s) com destino inválido. Elas continuam salvas; a próxima edição vai exigir um destino válido.', v_total;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
