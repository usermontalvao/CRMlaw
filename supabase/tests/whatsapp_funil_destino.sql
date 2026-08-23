-- ============================================================================
-- O destino da transferência automática do funil — a trava do banco.
--
-- Prova que `wa_funnel_destination_can_receive` e o trigger
-- `wa_funnel_entry_actions_check` recusam o que a tela também recusa. A tela é
-- conveniência; ESTE arquivo é a garantia — todos os casos abaixo passam pelo
-- PostgREST/SQL direto, sem nenhum código de front-end no caminho.
--
-- ── COMO RODAR ──────────────────────────────────────────────────────────────
--
-- O arquivo inteiro é uma transação que termina em ROLLBACK. Nada persiste.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/whatsapp_funil_destino.sql
--
-- Rode DEPOIS de aplicar `20260822100000_whatsapp_funil_destino_valido.sql`
-- (que por sua vez depende de `20260822090000_whatsapp_permissoes_nucleo.sql`).
--
-- Saída esperada: uma linha por caso, todas com `resultado = ok`.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

create temporary table t_resultado (
  n serial,
  caso text,
  esperado boolean,
  obtido boolean,
  resultado text
) on commit drop;

create or replace function pg_temp.checa(p_caso text, p_esperado boolean, p_obtido boolean)
returns void language plpgsql as $$
begin
  insert into t_resultado (caso, esperado, obtido, resultado)
  values (p_caso, p_esperado, p_obtido,
          case when p_obtido is not distinct from p_esperado then 'ok' else 'FALHOU' end);
end $$;

-- "Consegui gravar a etapa?" — é o que o trigger decide. Qualquer exceção conta
-- como recusa: a pergunta é se passou, não qual foi a mensagem.
create or replace function pg_temp.grava(p_canal uuid, p_acoes jsonb) returns boolean
language plpgsql as $$
begin
  insert into public.whatsapp_channel_funnel_stages
    (channel_id, stage_key, label, description, color, labels, position, is_active, is_default, entry_actions)
  values (p_canal, 'teste_' || substr(md5(random()::text), 1, 8), 'Etapa de teste',
          '', '#64748b', array['Etapa de teste'], 0, true, false, p_acoes);
  return true;
exception when others then
  return false;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- O cenário
--
-- Um canal restrito e um aberto. Uma pessoa dentro do canal restrito, uma
-- fora, uma administradora e uma desligada. Um setor povoado, um vazio e um
-- desativado. É o mesmo cenário do teste de front-end
-- (`funnelTransferTargets.test.ts`), de propósito: os dois lados respondem às
-- mesmas perguntas.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_dentro    uuid := gen_random_uuid();
  v_fora      uuid := gen_random_uuid();
  v_admin     uuid := gen_random_uuid();
  v_desligado uuid := gen_random_uuid();

  v_canal_restrito uuid := gen_random_uuid();
  v_canal_aberto   uuid := gen_random_uuid();

  v_setor_ok       uuid := gen_random_uuid();
  v_setor_vazio    uuid := gen_random_uuid();
  v_setor_inativo  uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'funil-' || u::text || '@exemplo.invalido', '', now(), now(), now()
    from unnest(array[v_dentro, v_fora, v_admin, v_desligado]) u;

  insert into public.profiles (user_id, name, role, email, is_active) values
    (v_dentro,    'Dentro do Canal',  'Advogado',      'd@x.invalido', true),
    (v_fora,      'Fora do Canal',    'Auxiliar',      'f@x.invalido', true),
    (v_admin,     'Administradora',   'Administrador', 'a@x.invalido', true),
    -- Desligado no CRM: continua no canal, e mesmo assim não pode receber.
    (v_desligado, 'Desligado',        'Auxiliar',      'z@x.invalido', false);

  insert into public.whatsapp_instances (id, instance_name, name, visibility_mode, is_active) values
    (v_canal_restrito, 'funil-restrito', 'Restrito', 'restricted', true),
    (v_canal_aberto,   'funil-aberto',   'Aberto',   'all',        true);

  insert into public.whatsapp_channel_members (channel_id, user_id) values
    (v_canal_restrito, v_dentro),
    (v_canal_restrito, v_desligado);

  insert into public.whatsapp_departments (id, name, is_active) values
    (v_setor_ok,      'Atendimento',   true),
    (v_setor_vazio,   'Sem ninguém',   true),
    (v_setor_inativo, 'Cobrança antiga', false);

  insert into public.whatsapp_department_members (department_id, user_id) values
    (v_setor_ok,      v_dentro),
    (v_setor_inativo, v_dentro);

  create temporary table t_ctx on commit drop as
  select v_dentro dentro, v_fora fora, v_admin admin, v_desligado desligado,
         v_canal_restrito canal_restrito, v_canal_aberto canal_aberto,
         v_setor_ok setor_ok, v_setor_vazio setor_vazio, v_setor_inativo setor_inativo;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. A função de destino, sozinha
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;

  -- Setor
  perform pg_temp.checa('setor ativo e povoado pode receber', true,
    public.wa_funnel_destination_can_receive(c.canal_restrito, null, c.setor_ok));
  perform pg_temp.checa('setor sem nenhum atendente NÃO pode receber', false,
    public.wa_funnel_destination_can_receive(c.canal_restrito, null, c.setor_vazio));
  perform pg_temp.checa('setor desativado NÃO pode receber', false,
    public.wa_funnel_destination_can_receive(c.canal_restrito, null, c.setor_inativo));
  perform pg_temp.checa('setor inexistente NÃO pode receber', false,
    public.wa_funnel_destination_can_receive(c.canal_restrito, null, gen_random_uuid()));
  perform pg_temp.checa('sem pessoa e sem setor NÃO pode receber', false,
    public.wa_funnel_destination_can_receive(c.canal_restrito, null, null));

  -- Pessoa × canal — o isolamento que o `<select>` antigo não fazia.
  perform pg_temp.checa('membro do canal restrito pode receber', true,
    public.wa_funnel_destination_can_receive(c.canal_restrito, c.dentro, null));
  perform pg_temp.checa('quem NÃO é membro do canal restrito não pode receber', false,
    public.wa_funnel_destination_can_receive(c.canal_restrito, c.fora, null));
  perform pg_temp.checa('no canal ABERTO, quem não é membro pode receber', true,
    public.wa_funnel_destination_can_receive(c.canal_aberto, c.fora, null));
  perform pg_temp.checa('administrador recebe em qualquer canal', true,
    public.wa_funnel_destination_can_receive(c.canal_restrito, c.admin, null));

  -- Desligar no CRM tira o destino, mesmo com o vínculo de canal intacto.
  perform pg_temp.checa('pessoa desativada não pode receber, mesmo sendo do canal', false,
    public.wa_funnel_destination_can_receive(c.canal_restrito, c.desligado, null));
  perform pg_temp.checa('pessoa inexistente não pode receber', false,
    public.wa_funnel_destination_can_receive(c.canal_restrito, gen_random_uuid(), null));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. O trigger — a etapa chega a ser gravada?
--
-- Aqui está o ponto do exercício: mesmo com service_role, mesmo por SQL direto,
-- uma etapa apontando para destino não autorizado não entra na tabela.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;

  perform pg_temp.checa('grava etapa com setor válido', true,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_department',
      'destination_type', 'department',
      'destination_id', c.setor_ok))));

  perform pg_temp.checa('grava etapa com pessoa do canal', true,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_user',
      'destination_type', 'user',
      'destination_id', c.dentro))));

  perform pg_temp.checa('RECUSA etapa apontando para quem não tem acesso ao canal', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_user',
      'destination_type', 'user',
      'destination_id', c.fora))));

  perform pg_temp.checa('RECUSA etapa apontando para setor desativado', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_department',
      'destination_type', 'department',
      'destination_id', c.setor_inativo))));

  perform pg_temp.checa('RECUSA etapa apontando para setor sem atendentes', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_department',
      'destination_type', 'department',
      'destination_id', c.setor_vazio))));

  perform pg_temp.checa('RECUSA etapa apontando para pessoa desativada', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_user',
      'destination_type', 'user',
      'destination_id', c.desligado))));

  perform pg_temp.checa('RECUSA transferência sem destino nenhum', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_department'))));

  perform pg_temp.checa('RECUSA destino que não é uuid', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_department',
      'destination_id', 'Atendimento'))));

  -- Tipo e destino discordando: id de setor guardado como transferência para
  -- pessoa. Transferiria para ninguém, em silêncio.
  perform pg_temp.checa('RECUSA tipo e destino que não combinam', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_user',
      'destination_type', 'department',
      'destination_id', c.setor_ok))));

  -- O formato antigo (só `target`) continua sendo aceito quando é válido — e
  -- recusado quando não é. Nenhuma etapa legítima quebra ao subir a migration.
  perform pg_temp.checa('formato antigo com `target` válido continua gravando', true,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_department', 'target', c.setor_ok))));

  perform pg_temp.checa('formato antigo com `target` inválido é recusado', false,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_user', 'target', c.fora))));

  -- O mesmo destino, no canal aberto, passa. É a prova do isolamento por canal:
  -- o que muda entre os dois casos é só o canal da etapa.
  perform pg_temp.checa('o MESMO destino é aceito no canal aberto', true,
    pg_temp.grava(c.canal_aberto, jsonb_build_array(jsonb_build_object(
      'type', 'transfer_to_user',
      'destination_type', 'user',
      'destination_id', c.fora))));

  -- Ações que não transferem passam intocadas pelo trigger.
  perform pg_temp.checa('etapa só com mensagem não é afetada pelo trigger', true,
    pg_temp.grava(c.canal_restrito, jsonb_build_array(jsonb_build_object(
      'type', 'send_message', 'message', 'Olá!'))));

  perform pg_temp.checa('etapa sem ação nenhuma continua válida', true,
    pg_temp.grava(c.canal_restrito, '[]'::jsonb));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- O veredito
-- ────────────────────────────────────────────────────────────────────────────

select n, resultado, caso, esperado, obtido from t_resultado order by n;

do $$
declare v_falhas integer;
begin
  select count(*) into v_falhas from t_resultado where resultado <> 'ok';
  if v_falhas > 0 then
    raise exception '% caso(s) FALHARAM — veja a tabela acima.', v_falhas;
  end if;
  raise notice 'Todos os % casos passaram.', (select count(*) from t_resultado);
end $$;

-- Nada persiste. É o ponto do arquivo.
rollback;
