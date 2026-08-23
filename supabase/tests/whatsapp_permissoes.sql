-- ============================================================================
-- A matriz de permissão do WhatsApp — sete perfis contra o banco de verdade.
--
--
-- ── COMO RODAR ──────────────────────────────────────────────────────────────
--
-- O arquivo INTEIRO é uma transação que termina em ROLLBACK. Ele cria usuários,
-- canais e conversas de teste, faz as perguntas, e desfaz tudo. Nada persiste —
-- nem em `auth.users`, nem nas tabelas do WhatsApp.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/whatsapp_permissoes.sql
--
-- Saída esperada: uma linha por caso, todas com `resultado = ok`. Qualquer
-- `FALHOU` aborta com a descrição do caso.
--
-- Rode DEPOIS de aplicar, nesta ordem:
--   · 20260822090000_whatsapp_permissoes_nucleo.sql
--   · 20260822091000_whatsapp_transferencias_e_supervisao.sql
--   · 20260822092000_whatsapp_desligamento.sql
--
--
-- ── COMO A IMPERSONAÇÃO FUNCIONA ────────────────────────────────────────────
--
-- `auth.uid()` lê `request.jwt.claims`. Trocar esse GUC dentro da transação é o
-- que faz o Postgres responder "como se fosse" cada perfil, sem precisar de
-- login nem de token. `set local role authenticated` completa o quadro: sem
-- isso as policies `TO authenticated` não se aplicam e tudo passaria.
--
-- É por isso que os testes de POLICY (os que leem tabela) precisam do `set
-- local role`, e os de FUNÇÃO (que chamam `wa_can_*`) não — mas ambos precisam
-- do claim.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- Ferramentas do teste
-- ────────────────────────────────────────────────────────────────────────────

create temporary table t_resultado (
  n serial,
  caso text,
  esperado boolean,
  obtido boolean,
  resultado text
) on commit drop;

-- `pg_temp.vira` troca o papel para `authenticated` — e a partir daí o próprio
-- `checa` perde o direito de escrever aqui, porque a tabela nasce do papel
-- privilegiado. Sem estes grants o arquivo morre no primeiro caso com
-- "permission denied for table t_resultado", que parece erro de teste e é só
-- de encanamento.
grant insert, select on t_resultado to authenticated;
grant usage, select on sequence t_resultado_n_seq to authenticated;

create or replace function pg_temp.vira(p_user uuid) returns void
language plpgsql as $$
begin
  if p_user is null then
    -- Anônimo: sem claim nenhum, `auth.uid()` devolve null.
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create or replace function pg_temp.checa(p_caso text, p_esperado boolean, p_obtido boolean)
returns void language plpgsql as $$
begin
  insert into t_resultado (caso, esperado, obtido, resultado)
  values (p_caso, p_esperado, p_obtido,
          case when p_obtido is not distinct from p_esperado then 'ok' else 'FALHOU' end);
end $$;

-- Executa uma RPC e diz apenas se ela DEIXOU ou RECUSOU. É assim que se testa
-- autorização de função que escreve: o que importa é o 42501, não o retorno.
create or replace function pg_temp.deixa(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return true;
exception
  when insufficient_privilege then return false;
  when others then
    -- Erro de regra de negócio (destino inválido, nada a fazer) conta como
    -- recusa: o teste pergunta "conseguiu?", não "por que não".
    return false;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- O cenário
--
-- Dois canais (um restrito, um aberto), um setor, e um contato com conversa
-- nos DOIS canais — as "irmãs" que o `attendance_key` agrupa. É esse par que
-- prova se o leque respeita o canal.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_admin      uuid := gen_random_uuid();
  v_supervisor uuid := gen_random_uuid();
  v_auxiliar   uuid := gen_random_uuid();
  v_estranho   uuid := gen_random_uuid();
  v_destino    uuid := gen_random_uuid();
  v_desligado  uuid := gen_random_uuid();
  v_portal     uuid := gen_random_uuid();

  v_canal_restrito uuid := gen_random_uuid();
  v_canal_aberto   uuid := gen_random_uuid();
  v_setor          uuid := gen_random_uuid();

  v_conv_restrita uuid := gen_random_uuid();
  v_conv_irma     uuid := gen_random_uuid();
  v_conv_fila     uuid := gen_random_uuid();
  v_chave         text := 'teste:5565999990000';
begin
  -- auth.users: `profiles.user_id` referencia. Sem senha nem e-mail real — a
  -- linha existe só para a FK aceitar.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'teste-' || u::text || '@exemplo.invalido', '', now(), now(), now()
    from unnest(array[v_admin, v_supervisor, v_auxiliar, v_estranho,
                      v_destino, v_desligado, v_portal]) u;

  insert into public.profiles (user_id, name, role, email, is_active) values
    (v_admin,      'Admin Teste',      'Administrador', 'a@x.invalido', true),
    (v_supervisor, 'Supervisor Teste', 'Advogado',      's@x.invalido', true),
    (v_auxiliar,   'Auxiliar Teste',   'Auxiliar',      'x@x.invalido', true),
    (v_estranho,   'Estranho Teste',   'Auxiliar',      'e@x.invalido', true),
    (v_destino,    'Destino Teste',    'Auxiliar',      'd@x.invalido', true),
    (v_desligado,  'Desligado Teste',  'Auxiliar',      'z@x.invalido', true);
  -- v_portal NÃO tem profile: é o cliente do Portal, com JWT válido e sem
  -- crachá de escritório.

  insert into public.whatsapp_instances (id, instance_name, name, visibility_mode, is_active) values
    (v_canal_restrito, 'teste-restrito', 'Restrito', 'restricted', true),
    (v_canal_aberto,   'teste-aberto',   'Aberto',   'all',        true);

  insert into public.whatsapp_departments (id, name, is_active) values (v_setor, 'Setor Teste', true);

  insert into public.whatsapp_channel_members (channel_id, user_id, role) values
    (v_canal_restrito, v_supervisor, 'supervisor'),
    (v_canal_restrito, v_auxiliar,   'member'),
    (v_canal_restrito, v_desligado,  'member'),
    (v_canal_aberto,   v_estranho,   'member');

  -- `attendance_key` é coluna GERADA (`20260820152055_whatsapp_atendimento_por_pessoa`):
  -- escrevê-la explicitamente aborta com 428C9. As duas "irmãs" continuam irmãs
  -- porque a chave sai do telefone, que é o mesmo nas duas.
  insert into public.whatsapp_conversations
    (id, instance_id, remote_jid, contact_phone, contact_name, status, assigned_user_id)
  values
    (v_conv_restrita, v_canal_restrito, '5565999990000@s.whatsapp.net', '5565999990000',
     'Contato Teste', 'open', v_auxiliar),
    (v_conv_irma, v_canal_aberto, '5565999990000@s.whatsapp.net', '5565999990000',
     'Contato Teste', 'open', v_estranho),
    (v_conv_fila, v_canal_restrito, '5565988880000@s.whatsapp.net', '5565988880000',
     'Fila Teste', 'open', null);

  -- Guarda os ids para os blocos seguintes.
  create temporary table t_ctx on commit drop as
  select v_admin admin, v_supervisor supervisor, v_auxiliar auxiliar,
         v_estranho estranho, v_destino destino, v_desligado desligado, v_portal portal,
         v_canal_restrito canal_restrito, v_canal_aberto canal_aberto, v_setor setor,
         v_conv_restrita conv_restrita, v_conv_irma conv_irma, v_conv_fila conv_fila;
end $$;

-- Mesmo motivo dos grants de `t_resultado`: cada bloco abaixo começa lendo o
-- `t_ctx` já com o papel `authenticated` deixado pelo bloco anterior.
grant select on t_ctx to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Visibilidade — quem enxerga o quê
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;

  perform pg_temp.vira(c.admin);
  perform pg_temp.checa('admin vê conversa do canal restrito', true,
    public.wa_can_see_conv_id(c.conv_restrita));

  perform pg_temp.vira(c.supervisor);
  perform pg_temp.checa('supervisor do canal vê a conversa dele', true,
    public.wa_can_see_conv_id(c.conv_restrita));
  perform pg_temp.checa('supervisor NÃO vê conversa de canal que não supervisiona nem participa', false,
    public.wa_can_see_conv_id(c.conv_irma));

  perform pg_temp.vira(c.auxiliar);
  perform pg_temp.checa('auxiliar membro vê a fila do canal dele', true,
    public.wa_can_see_conv_id(c.conv_fila));

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('auxiliar de OUTRO canal não vê a conversa restrita', false,
    public.wa_can_see_conv_id(c.conv_restrita));
  perform pg_temp.checa('uuid arbitrário não contorna nada', false,
    public.wa_can_see_conv_id(gen_random_uuid()));

  perform pg_temp.vira(c.portal);
  perform pg_temp.checa('cliente do portal (JWT válido, sem profile) não vê nada', false,
    public.wa_can_see_conv_id(c.conv_restrita));

  perform pg_temp.vira(null);
  perform pg_temp.checa('anônimo não vê nada', false,
    coalesce(public.wa_can_see_conv_id(c.conv_restrita), false));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Transferência histórica NÃO concede acesso
--
-- O caso que motivou a série inteira.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_t uuid;
begin
  select * into c from t_ctx;
  set local role postgres;

  -- Transferência ENCERRADA (aceita há muito tempo) envolvendo o estranho.
  insert into public.whatsapp_transfers
    (conversation_id, from_user_id, to_user_id, performed_by, status,
     accepted_at, accepted_by, resolved_at, created_at)
  values (c.conv_restrita, c.auxiliar, c.estranho, c.auxiliar, 'accepted',
          now() - interval '90 days', c.estranho, now() - interval '90 days',
          now() - interval '90 days');

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('transferência ACEITA há 90 dias não dá mais acesso à conversa', false,
    public.wa_can_see_conv_id(c.conv_restrita));
  perform pg_temp.checa('e muito menos ao canal inteiro', false,
    public.wa_can_see_channel(c.canal_restrito, 'restricted'));

  -- Transferência EXPIRADA.
  set local role postgres;
  update public.whatsapp_transfers
     set status = 'expired', accepted_at = null, accepted_by = null
   where conversation_id = c.conv_restrita and to_user_id = c.estranho;

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('transferência EXPIRADA não dá acesso', false,
    public.wa_can_see_conv_id(c.conv_restrita));

  -- Transferência PENDENTE, no prazo: aí sim, e só a conversa.
  set local role postgres;
  update public.whatsapp_transfers
     set status = 'pending', expires_at = now() + interval '4 hours'
   where conversation_id = c.conv_restrita and to_user_id = c.estranho;

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('transferência PENDENTE dá acesso à conversa', true,
    public.wa_can_see_conv_id(c.conv_restrita));
  perform pg_temp.checa('mas NÃO à outra conversa do mesmo canal', false,
    public.wa_can_see_conv_id(c.conv_fila));

  -- Pendente VENCIDA pelo relógio, sem ninguém ter mexido.
  set local role postgres;
  update public.whatsapp_transfers
     set expires_at = now() - interval '1 minute'
   where conversation_id = c.conv_restrita and to_user_id = c.estranho;

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('pendente VENCIDA pelo relógio para de conceder sozinha', false,
    public.wa_can_see_conv_id(c.conv_restrita));

  set local role postgres;
  delete from public.whatsapp_transfers where conversation_id = c.conv_restrita;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Escrever à mão em `whatsapp_transfers` — o autosserviço de crachá
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_ok boolean;
begin
  select * into c from t_ctx;
  perform pg_temp.vira(c.estranho);
  set local role authenticated;

  v_ok := pg_temp.deixa(format(
    'insert into public.whatsapp_transfers (conversation_id, to_user_id, performed_by, status)
     values (%L, %L, %L, ''pending'')', c.conv_restrita, c.estranho, c.estranho));
  perform pg_temp.checa('INSERT direto em whatsapp_transfers é recusado', false, v_ok);
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. As RPCs de atendimento
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_ok boolean;
begin
  select * into c from t_ctx;

  -- Assumir conversa de canal alheio, com o uuid na mão.
  perform pg_temp.vira(c.estranho);
  v_ok := pg_temp.deixa(format(
    'select public.wa_assume_contact_attendance(%L)', c.conv_restrita));
  perform pg_temp.checa('assumir conversa de canal alheio por uuid é recusado', false, v_ok);

  -- Assumir da fila do próprio canal: rotina, tem de passar.
  perform pg_temp.vira(c.auxiliar);
  v_ok := pg_temp.deixa(format(
    'select public.wa_assume_contact_attendance(%L)', c.conv_fila));
  perform pg_temp.checa('auxiliar do canal assume a fila dele', true, v_ok);

  -- Tomar a conversa de um colega: só supervisor.
  perform pg_temp.vira(c.auxiliar);
  v_ok := pg_temp.deixa(format(
    'select public.wa_assume_contact_attendance(%L)', c.conv_irma));
  perform pg_temp.checa('auxiliar não toma a conversa de outro atendente', false, v_ok);

  perform pg_temp.vira(c.supervisor);
  v_ok := pg_temp.deixa(format(
    'select public.wa_assume_contact_attendance(%L)', c.conv_restrita));
  perform pg_temp.checa('supervisor do canal PODE intervir no atendimento do canal dele', true, v_ok);

  -- Distribuir para terceiro: ato de supervisor.
  set local role postgres;
  update public.whatsapp_conversations set assigned_user_id = (select auxiliar from t_ctx)
   where id = c.conv_restrita;

  perform pg_temp.vira(c.auxiliar);
  v_ok := pg_temp.deixa(format(
    'select public.wa_assign_contact_attendance(%L, %L)', c.conv_fila, c.destino));
  perform pg_temp.checa('auxiliar não distribui para terceiro sem acesso ao canal', false, v_ok);

  -- Destino sem acesso ao canal: recusado mesmo para o supervisor.
  perform pg_temp.vira(c.supervisor);
  v_ok := pg_temp.deixa(format(
    'select public.wa_transfer_contact_attendance(%L, %L)', c.conv_restrita, c.destino));
  perform pg_temp.checa('transferir para quem não enxerga o canal é recusado', false, v_ok);

  -- Destino COM acesso: passa.
  set local role postgres;
  insert into public.whatsapp_channel_members (channel_id, user_id, role)
  values (c.canal_restrito, c.destino, 'member') on conflict do nothing;

  perform pg_temp.vira(c.supervisor);
  v_ok := pg_temp.deixa(format(
    'select public.wa_transfer_contact_attendance(%L, %L)', c.conv_restrita, c.destino));
  perform pg_temp.checa('transferir para membro do canal é aceito', true, v_ok);
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Aceitar — exige convite, e só o seu
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_ok boolean; v_t uuid;
begin
  select * into c from t_ctx;

  -- Sem transferência pendente para ele, o estranho não "aceita" nada.
  perform pg_temp.vira(c.estranho);
  v_ok := pg_temp.deixa(format(
    'select public.wa_accept_contact_transfer(%L)', c.conv_fila));
  perform pg_temp.checa('aceitar SEM transferência pendente é recusado', false, v_ok);

  -- O convite é do destino; o auxiliar não pode pegá-lo.
  perform pg_temp.vira(c.auxiliar);
  v_ok := pg_temp.deixa(format(
    'select public.wa_accept_contact_transfer(%L)', c.conv_restrita));
  perform pg_temp.checa('aceitar transferência endereçada a OUTRA pessoa é recusado', false, v_ok);

  -- O destino aceita.
  perform pg_temp.vira(c.destino);
  v_ok := pg_temp.deixa(format(
    'select public.wa_accept_contact_transfer(%L)', c.conv_restrita));
  perform pg_temp.checa('o destino aceita a transferência dele', true, v_ok);

  -- E aceitar de novo é inofensivo.
  perform pg_temp.vira(c.destino);
  v_ok := pg_temp.deixa(format(
    'select public.wa_accept_contact_transfer(%L)', c.conv_restrita));
  perform pg_temp.checa('aceite duplicado não estoura', true, v_ok);

  -- Depois de aceita, a transferência não concede mais nada a quem a mandou
  -- (o supervisor mantém acesso pelo canal, então quem se testa é o auxiliar).
  set local role postgres;
  select id into v_t from public.whatsapp_transfers
   where conversation_id = c.conv_restrita order by created_at desc limit 1;
  perform pg_temp.checa('a transferência ficou marcada como accepted', true,
    exists (select 1 from public.whatsapp_transfers where id = v_t and status = 'accepted'));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. O leque por `attendance_key` não atravessa canal
--
-- As duas conversas têm a MESMA chave. Encerrar pela do canal aberto não pode
-- encerrar a do canal restrito.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_ok boolean; v_status text;
begin
  select * into c from t_ctx;
  set local role postgres;
  update public.whatsapp_conversations set status = 'open' where id in (c.conv_restrita, c.conv_irma);

  perform pg_temp.vira(c.estranho);   -- membro só do canal aberto
  v_ok := pg_temp.deixa(format(
    'select public.wa_close_contact_attendance(%L, %L)', c.conv_irma, 'teste'));
  perform pg_temp.checa('encerrar a irmã do canal que ele tem é permitido', true, v_ok);

  set local role postgres;
  select status into v_status from public.whatsapp_conversations where id = c.conv_restrita;
  perform pg_temp.checa('a irmã do canal RESTRITO continua aberta', true, v_status <> 'closed');
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Colaborador temporário
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_ok boolean;
begin
  select * into c from t_ctx;
  set local role postgres;
  update public.whatsapp_conversations
     set status = 'open', assigned_user_id = (select auxiliar from t_ctx)
   where id = c.conv_restrita;

  perform pg_temp.vira(c.auxiliar);
  v_ok := pg_temp.deixa(format(
    'select public.wa_grant_conversation_collaborator(%L, %L, 24, %L)',
    c.conv_restrita, c.estranho, 'olhar este caso'));
  perform pg_temp.checa('o responsável empresta a própria conversa', true, v_ok);

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('o colaborador vê a conversa emprestada', true,
    public.wa_can_see_conv_id(c.conv_restrita));
  perform pg_temp.checa('o colaborador PODE responder', true,
    public.wa_can_reply_conv(c.conv_restrita));
  perform pg_temp.checa('o colaborador NÃO comanda o atendimento', false,
    public.wa_can_manage_conv(c.conv_restrita));
  perform pg_temp.checa('e não ganhou o canal junto', false,
    public.wa_can_see_conv_id(c.conv_fila));

  -- Encerrar a conversa encerra o empréstimo.
  set local role postgres;
  update public.whatsapp_conversations set status = 'closed' where id = c.conv_restrita;
  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('encerrar o atendimento encerra o empréstimo', false,
    public.wa_collaborator_active(c.conv_restrita, c.estranho));

  set local role postgres;
  update public.whatsapp_conversations set status = 'open' where id = c.conv_restrita;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Desligamento
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_assigned uuid; v_vinculos integer;
begin
  select * into c from t_ctx;
  set local role postgres;

  update public.whatsapp_conversations
     set assigned_user_id = c.desligado, status = 'open' where id = c.conv_fila;

  -- Enquanto ativo, ele enxerga.
  perform pg_temp.vira(c.desligado);
  perform pg_temp.checa('atendente ativo enxerga a conversa dele', true,
    public.wa_can_see_conv_id(c.conv_fila));

  -- Desliga (o gatilho faz o resto).
  set local role postgres;
  update public.profiles set is_active = false where user_id = c.desligado;

  -- O JWT dele continua "válido" — o claim não mudou. E mesmo assim:
  perform pg_temp.vira(c.desligado);
  perform pg_temp.checa('desligado com JWT vivo perde o acesso na hora', false,
    public.wa_can_see_conv_id(c.conv_fila));
  perform pg_temp.checa('e deixa de ser equipe', false, public.is_office_staff());

  set local role postgres;
  select assigned_user_id into v_assigned from public.whatsapp_conversations where id = c.conv_fila;
  perform pg_temp.checa('a conversa dele NÃO ficou no nome dele', true,
    v_assigned is distinct from c.desligado);

  select count(*) into v_vinculos from public.whatsapp_channel_members where user_id = c.desligado;
  perform pg_temp.checa('os vínculos de canal foram removidos', true, v_vinculos = 0);

  -- E ela não sumiu: alguém do canal continua enxergando.
  perform pg_temp.vira(c.auxiliar);
  perform pg_temp.checa('a conversa devolvida continua visível para a equipe', true,
    public.wa_can_see_conv_id(c.conv_fila));

  -- Idempotente.
  set local role postgres;
  perform public.wa_offboard_user(c.desligado);
  perform pg_temp.checa('desligar de novo é inofensivo', true, true);
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Ligações e mídia herdam a conversa
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;
  set local role postgres;
  insert into public.whatsapp_call_logs
    (call_id, direction, phone, conversation_id, instance_id, started_at, outcome)
  values ('teste-call-1', 'in', '5565999990000', c.conv_restrita, c.canal_restrito, now(), 'answered');

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('ligação de conversa que ele não vê fica invisível', false,
    public.wa_can_see_call_row(c.conv_restrita, '5565999990000', null, c.canal_restrito));

  perform pg_temp.vira(c.auxiliar);
  perform pg_temp.checa('ligação da conversa dele aparece', true,
    public.wa_can_see_call_row(c.conv_restrita, '5565999990000', null, c.canal_restrito));

  -- Telefone SEM conversa nenhuma: antes era visível para o escritório inteiro.
  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('ligação sem conversa herda o CANAL, não fica aberta a todos', false,
    public.wa_can_see_call_row(null, '5511000000000', null, c.canal_restrito));
  perform pg_temp.checa('e quem tem o canal, vê', true,
    public.wa_can_see_call_row(null, '5511000000000', null, c.canal_aberto));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Broadcast por canal
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;

  perform pg_temp.vira(c.auxiliar);
  perform pg_temp.checa('membro lê o broadcast do canal dele', true,
    public.wa_can_read_channel_broadcast('whatsapp:messages:' || c.canal_restrito::text));

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('quem não tem o canal não lê o broadcast dele', false,
    public.wa_can_read_channel_broadcast('whatsapp:messages:' || c.canal_restrito::text));
  perform pg_temp.checa('tópico malformado não vira permissão', false,
    public.wa_can_read_channel_broadcast('whatsapp:messages:qualquer-coisa'));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- N. A LISTA de canais — o que o seletor "Todos os canais" mostra
--
-- Os blocos acima perguntam quem vê cada CONVERSA. Este pergunta quem vê a
-- LINHA DO CANAL, que é outra coisa e tinha outra resposta: era por aqui que
-- uma auxiliar sem vínculo nenhum enxergava dois canais no seletor.
--
-- O cenário é próprio (canais e usuários novos) porque os canais lá de cima já
-- têm membros e um deles é `all`, o que borraria justamente o caso que importa:
-- "membro de UM canal não enxerga o outro".
--
-- O caso decisivo é o do `u_hist`: conversa ENCERRADA mais transferência antiga
-- no canal B, e nenhum vínculo. Antes, cada uma dessas duas linhas de histórico
-- entregava o canal INTEIRO, para sempre. "Todos os canais" passou a querer
-- dizer "todos os canais do escritório" para quem um dia passou por perto.
-- ────────────────────────────────────────────────────────────────────────────

reset role;

-- Enxerga a linha do canal pela POLICY (`wa_inst_select`), que é exatamente o
-- caminho de `listChannels()`. Perguntar à função diretamente testaria menos:
-- é a policy que o navegador atravessa.
create or replace function pg_temp.lista_canal(p_canal uuid) returns boolean
language plpgsql as $$
declare v integer;
begin
  select count(*) into v from public.whatsapp_instances where id = p_canal;
  return v > 0;
end $$;

do $$
declare
  u_admin uuid := gen_random_uuid();
  u_um    uuid := gen_random_uuid();
  u_dois  uuid := gen_random_uuid();
  u_zero  uuid := gen_random_uuid();
  u_hist  uuid := gen_random_uuid();
  u_vivo  uuid := gen_random_uuid();
  c_a uuid := gen_random_uuid();
  c_b uuid := gen_random_uuid();
  c_aberto uuid := gen_random_uuid();
  v_conv_morta uuid := gen_random_uuid();
  v_conv_viva  uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'lista-' || u::text || '@exemplo.invalido', '', now(), now(), now()
    from unnest(array[u_admin, u_um, u_dois, u_zero, u_hist, u_vivo]) u;

  insert into public.profiles (user_id, name, role, email, is_active) values
    (u_admin, 'Admin Lista',    'Administrador', 'la@x.invalido', true),
    (u_um,    'Um Canal',       'Auxiliar',      'l1@x.invalido', true),
    (u_dois,  'Dois Canais',    'Auxiliar',      'l2@x.invalido', true),
    (u_zero,  'Nenhum Canal',   'Auxiliar',      'l0@x.invalido', true),
    (u_hist,  'So Historico',   'Auxiliar',      'lh@x.invalido', true),
    (u_vivo,  'Conversa Viva',  'Auxiliar',      'lv@x.invalido', true);

  insert into public.whatsapp_instances (id, instance_name, name, visibility_mode, is_active) values
    (c_a,      'lista-a',      'Canal A da lista', 'restricted', true),
    (c_b,      'lista-b',      'Canal B da lista', 'restricted', true),
    (c_aberto, 'lista-aberto', 'Canal aberto',     'all',        true);

  insert into public.whatsapp_channel_members (channel_id, user_id) values
    (c_a, u_um), (c_a, u_dois), (c_b, u_dois);

  -- Sem vínculo: só o passado. É o caso que regride se alguém reintroduzir o
  -- atalho do histórico em `wa_can_see_channel`.
  insert into public.whatsapp_conversations
    (id, instance_id, remote_jid, contact_phone, contact_name, status, assigned_user_id)
  values (v_conv_morta, c_b, '5565911110000@s.whatsapp.net', '5565911110000',
          'Encerrada', 'closed', u_hist);
  insert into public.whatsapp_transfers (conversation_id, from_user_id, to_user_id)
  values (v_conv_morta, u_admin, u_hist);

  -- Sem vínculo, mas com trabalho EM ABERTO: precisa do rótulo do canal para a
  -- tela da conversa dele fazer sentido. Ver o comentário de `wa_can_see_channel`.
  insert into public.whatsapp_conversations
    (id, instance_id, remote_jid, contact_phone, contact_name, status, assigned_user_id)
  values (v_conv_viva, c_b, '5565922220000@s.whatsapp.net', '5565922220000',
          'Aberta', 'open', u_vivo);

  create temporary table t_lista on commit drop as
  select u_admin admin, u_um um, u_dois dois, u_zero zero, u_hist hist, u_vivo vivo,
         c_a canal_a, c_b canal_b, c_aberto canal_aberto;
end $$;

grant select on t_lista to authenticated;

do $$
declare c record;
begin
  select * into c from t_lista;

  -- Administrador: a organização inteira.
  perform pg_temp.vira(c.admin);
  perform pg_temp.checa('admin lista o canal A', true, pg_temp.lista_canal(c.canal_a));
  perform pg_temp.checa('admin lista o canal B', true, pg_temp.lista_canal(c.canal_b));

  -- Um canal só: vê o dele e o aberto, e NÃO vê o outro restrito.
  perform pg_temp.vira(c.um);
  perform pg_temp.checa('membro de um canal lista o canal dele', true,
    pg_temp.lista_canal(c.canal_a));
  perform pg_temp.checa('membro de um canal NÃO lista o canal alheio', false,
    pg_temp.lista_canal(c.canal_b));
  perform pg_temp.checa('canal visibility_mode=all aparece para qualquer um da casa', true,
    pg_temp.lista_canal(c.canal_aberto));

  -- Vários canais: os dois, e nada além.
  perform pg_temp.vira(c.dois);
  perform pg_temp.checa('membro de vários lista o primeiro', true, pg_temp.lista_canal(c.canal_a));
  perform pg_temp.checa('membro de vários lista o segundo', true, pg_temp.lista_canal(c.canal_b));

  -- Nenhum canal: estado vazio de verdade, e não uma lista com o que é dos outros.
  perform pg_temp.vira(c.zero);
  perform pg_temp.checa('sem vínculo não lista o canal A', false, pg_temp.lista_canal(c.canal_a));
  perform pg_temp.checa('sem vínculo não lista o canal B', false, pg_temp.lista_canal(c.canal_b));

  -- O caso que originou tudo isto.
  perform pg_temp.vira(c.hist);
  perform pg_temp.checa('conversa ENCERRADA + transferência antiga não dão o canal inteiro', false,
    pg_temp.lista_canal(c.canal_b));

  -- E o limite do corte: trabalho vivo continua concedendo o rótulo.
  perform pg_temp.vira(c.vivo);
  perform pg_temp.checa('conversa VIVA concede o rótulo do canal', true,
    pg_temp.lista_canal(c.canal_b));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- O veredito
-- ────────────────────────────────────────────────────────────────────────────

reset role;

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
