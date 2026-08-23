-- ============================================================================
-- A IA do WhatsApp: quem configura, quem controla, e o que fica registrado.
--
--
-- ── COMO RODAR ──────────────────────────────────────────────────────────────
--
-- Mesmo desenho de `whatsapp_permissoes.sql`: o arquivo inteiro é uma transação
-- que termina em ROLLBACK. Cria usuários, canais, conversas e um agente de
-- teste, faz as perguntas, e desfaz tudo.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/whatsapp_ia.sql
--
-- Rode DEPOIS de aplicar, nesta ordem:
--   · 20260822090000_whatsapp_permissoes_nucleo.sql
--   · 20260822091000_whatsapp_transferencias_e_supervisao.sql
--   · 20260822092000_whatsapp_desligamento.sql
--   · 20260822095000_whatsapp_ia_controles_operacionais.sql
--
--
-- ── O QUE ESTE ARQUIVO SEPARA ───────────────────────────────────────────────
--
-- Duas linhas que a tela não pode confundir:
--
--   · CONFIGURAR — prompt, playbook, modelo, canais atendidos, limites. É do
--     administrador, e a trava são as policies `*_escrita` das tabelas de IA;
--   · CONTROLAR  — pausar, retomar, limpar memória, cancelar retomada naquele
--     atendimento. É de quem comanda a conversa (`wa_can_manage_conv`), e a
--     trava é `wa_ai_require_control`, dentro de cada RPC.
--
-- O caso que motivou o arquivo: a RLS de `whatsapp_ai_sessions` pedia apenas
-- `wa_can_see_conv_id`, que é a régua da INBOX. Quem enxergasse a conversa
-- desligava a IA dela — inclusive o supervisor de OUTRO canal e o colaborador
-- emprestado.
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

create or replace function pg_temp.vira(p_user uuid) returns void
language plpgsql as $$
begin
  if p_user is null then
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

-- Executa e diz apenas se DEIXOU ou RECUSOU. É assim que se testa autorização
-- de função que escreve: o que importa é o 42501, não o retorno.
create or replace function pg_temp.deixa(p_sql text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return true;
exception
  when insufficient_privilege then return false;
  when others then return false;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- O cenário
--
-- Um canal restrito COM IA ligada, um canal aberto sem IA, um setor, e um
-- agente de teste. Cinco pessoas: admin, supervisor do canal restrito, o
-- responsável pela conversa, um auxiliar do MESMO canal que não é o responsável,
-- e um estranho (membro só do canal aberto).
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_admin      uuid := gen_random_uuid();
  v_supervisor uuid := gen_random_uuid();
  v_dono       uuid := gen_random_uuid();
  v_colega     uuid := gen_random_uuid();
  v_estranho   uuid := gen_random_uuid();
  v_desligado  uuid := gen_random_uuid();

  v_canal_ia     uuid := gen_random_uuid();
  v_canal_sem_ia uuid := gen_random_uuid();
  v_setor        uuid := gen_random_uuid();
  v_agente       uuid := gen_random_uuid();

  v_conv_ia   uuid := gen_random_uuid();   -- IA atendendo, sem dono (fila)
  v_conv_dono uuid := gen_random_uuid();   -- com responsável nomeado
  v_conv_fora uuid := gen_random_uuid();   -- no canal aberto
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'ia-' || u::text || '@exemplo.invalido', '', now(), now(), now()
    from unnest(array[v_admin, v_supervisor, v_dono, v_colega, v_estranho, v_desligado]) u;

  insert into public.profiles (user_id, name, role, email, is_active) values
    (v_admin,      'Admin IA',      'Administrador', 'ia-a@x.invalido', true),
    (v_supervisor, 'Supervisor IA', 'Advogado',      'ia-s@x.invalido', true),
    (v_dono,       'Dono IA',       'Auxiliar',      'ia-d@x.invalido', true),
    (v_colega,     'Colega IA',     'Auxiliar',      'ia-c@x.invalido', true),
    (v_estranho,   'Estranho IA',   'Auxiliar',      'ia-e@x.invalido', true),
    (v_desligado,  'Desligado IA',  'Auxiliar',      'ia-z@x.invalido', true);

  insert into public.whatsapp_instances (id, instance_name, name, visibility_mode, is_active) values
    (v_canal_ia,     'ia-restrito', 'Restrito com IA', 'restricted', true),
    (v_canal_sem_ia, 'ia-aberto',   'Aberto sem IA',   'all',        true);

  insert into public.whatsapp_departments (id, name, is_active) values (v_setor, 'Setor IA', true);

  insert into public.whatsapp_channel_members (channel_id, user_id, role) values
    (v_canal_ia,     v_supervisor, 'supervisor'),
    (v_canal_ia,     v_dono,       'member'),
    (v_canal_ia,     v_colega,     'member'),
    (v_canal_ia,     v_desligado,  'member'),
    (v_canal_sem_ia, v_estranho,   'member');

  insert into public.whatsapp_ai_assistants (id, name, provider, model, is_active, mode)
  values (v_agente, 'Agente de Teste', 'openai', 'gpt-4o-mini', true, 'test');

  insert into public.whatsapp_ai_channel_config (channel_id, ai_enabled, assistant_id)
  values (v_canal_ia, true, v_agente);

  -- `attendance_key` NÃO entra aqui: desde a migration 20260820152055 ela é
  -- coluna GERADA a partir do telefone (`wa_attendance_key`), e escrever nela
  -- aborta o arquivo inteiro com 428C9 antes do primeiro caso. As três conversas
  -- têm telefones diferentes de propósito — aqui não se testa o leque de irmãs,
  -- e sim o controle da IA conversa a conversa.
  insert into public.whatsapp_conversations
    (id, instance_id, remote_jid, contact_phone, contact_name, status, assigned_user_id)
  values
    (v_conv_ia, v_canal_ia, '5565911110000@s.whatsapp.net', '5565911110000',
     'Cliente IA', 'open', null),
    (v_conv_dono, v_canal_ia, '5565922220000@s.whatsapp.net', '5565922220000',
     'Cliente Dono', 'open', v_dono),
    (v_conv_fora, v_canal_sem_ia, '5565933330000@s.whatsapp.net', '5565933330000',
     'Cliente Fora', 'open', v_estranho);

  insert into public.whatsapp_ai_sessions (conversation_id, assistant_id, ai_active, status) values
    (v_conv_ia,   v_agente, true,  'active'),
    (v_conv_dono, v_agente, false, 'handed_off');

  create temporary table t_ctx on commit drop as
  select v_admin admin, v_supervisor supervisor, v_dono dono, v_colega colega,
         v_estranho estranho, v_desligado desligado,
         v_canal_ia canal_ia, v_canal_sem_ia canal_sem_ia, v_setor setor, v_agente agente,
         v_conv_ia conv_ia, v_conv_dono conv_dono, v_conv_fora conv_fora;
end $$;

-- As temporárias nascem do papel privilegiado, mas TODO caso roda depois de
-- `pg_temp.vira()`, que troca o papel para `authenticated`. Sem estes grants o
-- próprio `pg_temp.checa()` leva 42501 ao gravar o resultado, e cada bloco leva
-- 42501 ao ler `t_ctx` — o arquivo morre no primeiro caso, sem chegar a
-- perguntar nada. Elas somem no rollback junto com o resto.
grant insert, select on t_resultado to authenticated;
grant usage, select on sequence t_resultado_n_seq to authenticated;
grant select on t_ctx to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Configurar a IA — administrador, e só
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;
  set local role authenticated;

  perform pg_temp.vira(c.admin);
  perform pg_temp.checa('admin edita o agente', true, pg_temp.deixa(format(
    'update public.whatsapp_ai_assistants set name = ''Renomeado'' where id = %L', c.agente)));
  perform pg_temp.checa('admin liga/desliga a IA do canal', true, pg_temp.deixa(format(
    'update public.whatsapp_ai_channel_config set ai_enabled = true where channel_id = %L', c.canal_ia)));

  perform pg_temp.vira(c.supervisor);
  perform pg_temp.checa('supervisor de canal NÃO edita o prompt do agente', false, pg_temp.deixa(format(
    'update public.whatsapp_ai_assistants set instructions_do = ''hack'' where id = %L', c.agente)));
  perform pg_temp.checa('supervisor de canal NÃO liga a IA de um canal', false, pg_temp.deixa(format(
    'update public.whatsapp_ai_channel_config set assistant_id = null where channel_id = %L', c.canal_ia)));

  perform pg_temp.vira(c.colega);
  perform pg_temp.checa('usuário comum NÃO cria agente', false, pg_temp.deixa(
    'insert into public.whatsapp_ai_assistants (name, provider, model) '
    || 'values (''Meu agente'', ''openai'', ''gpt-4o-mini'')'));
  perform pg_temp.checa('usuário comum NÃO apaga agente', false, pg_temp.deixa(format(
    'delete from public.whatsapp_ai_assistants where id = %L', c.agente)));

  -- Ler o cadastro do agente CONTINUA liberado a quem é da casa: o painel da
  -- conversa mostra o nome do agente, e escondê-lo tornaria a faixa anônima.
  perform pg_temp.vira(c.colega);
  perform pg_temp.checa('usuário comum LÊ o cadastro do agente (o nome aparece na faixa)', true,
    exists (select 1 from public.whatsapp_ai_assistants where id = c.agente));

  perform pg_temp.vira(null);
  perform pg_temp.checa('anônimo não lê agente nenhum', false,
    exists (select 1 from public.whatsapp_ai_assistants));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Controlar a IA — pausar, retomar, limpar
--
-- É onde estava o furo: a régua era "poder VER a conversa".
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;
  set local role authenticated;

  -- Conversa SEM dono é da fila: quem a enxerga pode assumi-la, e por isso
  -- também controla a IA dela.
  perform pg_temp.vira(c.colega);
  perform pg_temp.checa('membro do canal controla a IA da conversa da FILA', true,
    public.wa_can_manage_conv(c.conv_ia));

  -- Conversa COM dono: só o dono, o supervisor daquele canal e o admin.
  perform pg_temp.vira(c.dono);
  perform pg_temp.checa('o responsável controla a IA da própria conversa', true,
    public.wa_can_manage_conv(c.conv_dono));

  perform pg_temp.vira(c.colega);
  perform pg_temp.checa('colega do MESMO canal NÃO controla a IA da conversa alheia', false,
    public.wa_can_manage_conv(c.conv_dono));
  perform pg_temp.checa('e a tentativa de pausar é recusada', false, pg_temp.deixa(format(
    'select public.wa_ai_pause(%L)', c.conv_dono)));
  perform pg_temp.checa('nem por escrita direta na sessão', false, pg_temp.deixa(format(
    'update public.whatsapp_ai_sessions set ai_active = false where conversation_id = %L', c.conv_dono)));

  perform pg_temp.vira(c.supervisor);
  perform pg_temp.checa('supervisor do canal controla a IA dentro do escopo dele', true,
    pg_temp.deixa(format('select public.wa_ai_pause(%L, ''teste'')', c.conv_dono)));

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('quem não tem o canal não controla a IA de lá', false, pg_temp.deixa(format(
    'select public.wa_ai_pause(%L)', c.conv_ia)));
  perform pg_temp.checa('nem enxerga a sessão', false,
    exists (select 1 from public.whatsapp_ai_sessions where conversation_id = c.conv_ia));

  perform pg_temp.vira(c.admin);
  perform pg_temp.checa('admin intervém em qualquer canal', true, pg_temp.deixa(format(
    'select public.wa_ai_pause(%L, ''intervenção do admin'')', c.conv_ia)));

  perform pg_temp.vira(null);
  perform pg_temp.checa('anônimo não pausa nada', false, pg_temp.deixa(format(
    'select public.wa_ai_pause(%L)', c.conv_ia)));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Retomar não pode ser um UPDATE cru na conversa
--
-- O caminho antigo do navegador soltava o responsável e reabria a conversa com
-- um `update whatsapp_conversations`, sob uma policy que pede apenas "ver".
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_dono_depois uuid;
begin
  select * into c from t_ctx;
  set local role postgres;
  update public.whatsapp_conversations set assigned_user_id = c.dono, status = 'open'
   where id = c.conv_dono;
  update public.whatsapp_ai_sessions set ai_active = false, status = 'handed_off'
   where conversation_id = c.conv_dono;

  set local role authenticated;

  perform pg_temp.vira(c.colega);
  perform pg_temp.deixa(format(
    'update public.whatsapp_conversations set assigned_user_id = null where id = %L', c.conv_dono));

  set local role postgres;
  select assigned_user_id into v_dono_depois from public.whatsapp_conversations where id = c.conv_dono;
  perform pg_temp.checa('colega não consegue soltar o responsável por escrita direta', true,
    v_dono_depois = c.dono);

  set local role authenticated;
  perform pg_temp.vira(c.dono);
  perform pg_temp.checa('o responsável devolve a própria conversa para a IA', true, pg_temp.deixa(format(
    'select public.wa_ai_resume(%L)', c.conv_dono)));

  set local role postgres;
  select assigned_user_id into v_dono_depois from public.whatsapp_conversations where id = c.conv_dono;
  perform pg_temp.checa('devolver solta o responsável (a IA não atende conversa com dono)', true,
    v_dono_depois is null);
  perform pg_temp.checa('e a sessão volta a ativa', true,
    exists (select 1 from public.whatsapp_ai_sessions
             where conversation_id = c.conv_dono and ai_active and status = 'active'));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Retomar num canal com a IA desligada não promete o que não entrega
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;
  set local role postgres;
  update public.whatsapp_ai_channel_config set ai_enabled = false where channel_id = c.canal_ia;

  set local role authenticated;
  perform pg_temp.vira(c.admin);
  perform pg_temp.checa('retomar num canal com IA desligada é recusado', false, pg_temp.deixa(format(
    'select public.wa_ai_resume(%L)', c.conv_ia)));

  set local role postgres;
  update public.whatsapp_ai_channel_config set ai_enabled = true where channel_id = c.canal_ia;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Usuário DESLIGADO perde o controle na hora, com a sessão ainda válida
--
-- O JWT continua bom por semanas. O que muda é `is_office_staff()`, que passou
-- a exigir `is_active` — e `wa_can_manage_conv` depende dela.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;
  set local role postgres;
  update public.whatsapp_conversations set assigned_user_id = c.desligado where id = c.conv_ia;

  set local role authenticated;
  perform pg_temp.vira(c.desligado);
  perform pg_temp.checa('antes do desligamento, ele controla a IA da conversa dele', true,
    public.wa_can_manage_conv(c.conv_ia));

  set local role postgres;
  update public.profiles set is_active = false where user_id = c.desligado;

  set local role authenticated;
  perform pg_temp.vira(c.desligado);
  perform pg_temp.checa('desligado NÃO controla mais a IA, com o mesmo JWT', false,
    public.wa_can_manage_conv(c.conv_ia));
  perform pg_temp.checa('e a RPC recusa', false, pg_temp.deixa(format(
    'select public.wa_ai_pause(%L)', c.conv_ia)));
  perform pg_temp.checa('e ele não configura nada', false, pg_temp.deixa(format(
    'update public.whatsapp_ai_assistants set name = ''x'' where id = %L', c.agente)));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Toda ação operacional fica auditada
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_antes integer; v_depois integer;
begin
  select * into c from t_ctx;
  set local role postgres;
  update public.whatsapp_conversations set assigned_user_id = c.dono where id = c.conv_dono;
  update public.whatsapp_ai_sessions set ai_active = true, status = 'active'
   where conversation_id = c.conv_dono;
  select count(*) into v_antes from public.whatsapp_attendance_events
   where primary_conversation_id = c.conv_dono and event_type like 'ai_%';

  set local role authenticated;
  perform pg_temp.vira(c.dono);
  perform public.wa_ai_pause(c.conv_dono, 'vou responder eu');
  perform public.wa_ai_clear_memory(c.conv_dono);

  set local role postgres;
  select count(*) into v_depois from public.whatsapp_attendance_events
   where primary_conversation_id = c.conv_dono and event_type like 'ai_%';

  perform pg_temp.checa('pausar e limpar deixam DOIS eventos de auditoria', true,
    v_depois = v_antes + 2);
  perform pg_temp.checa('o evento registra QUEM agiu', true,
    exists (select 1 from public.whatsapp_attendance_events
             where primary_conversation_id = c.conv_dono
               and event_type = 'ai_paused' and actor_id = c.dono
               and reason = 'vou responder eu'));
  perform pg_temp.checa('ninguém escreve auditoria à mão', false, (
    select pg_temp.deixa(format(
      'insert into public.whatsapp_attendance_events (attendance_key, event_type, primary_conversation_id) '
      || 'values (''forjado'', ''ai_paused'', %L)', c.conv_dono))));
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. IA e atendente não respondem juntos
--
-- O gatilho antigo só via a ATRIBUIÇÃO. O "responder sem assumir" do Modo
-- supervisão não atribui — e ali os dois falavam ao mesmo tempo.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record; v_ativa boolean;
begin
  select * into c from t_ctx;
  set local role postgres;

  update public.whatsapp_conversations set assigned_user_id = c.dono where id = c.conv_dono;
  update public.whatsapp_ai_sessions set ai_active = true, status = 'active', handoff_reason = null
   where conversation_id = c.conv_dono;
  insert into public.whatsapp_ai_followups (conversation_id, attempt, scheduled_at, status, message)
  values (c.conv_dono, 1, now() + interval '2 hours', 'pending', 'oi, ainda precisa?');

  -- O SUPERVISOR responde sem assumir: a atribuição não muda.
  insert into public.whatsapp_messages
    (conversation_id, direction, type, content, status, sender_user_id, sender_role, wa_timestamp)
  values (c.conv_dono, 'out', 'text', 'Oi, aqui é o supervisor.', 'sent',
          c.supervisor, 'supervisor', now());

  select ai_active into v_ativa from public.whatsapp_ai_sessions where conversation_id = c.conv_dono;
  perform pg_temp.checa('resposta de gente SEM assumir pausa a IA', true, v_ativa is false);
  perform pg_temp.checa('e cancela a retomada agendada', true, not exists (
    select 1 from public.whatsapp_ai_followups
     where conversation_id = c.conv_dono and status = 'pending'));
  perform pg_temp.checa('e fica registrado por quê', true, exists (
    select 1 from public.whatsapp_attendance_events
     where primary_conversation_id = c.conv_dono and event_type = 'ai_paused'
       and actor_id = c.supervisor));

  -- A mensagem da PRÓPRIA IA não se auto-desliga: ela vai sem sender_user_id.
  update public.whatsapp_ai_sessions set ai_active = true, status = 'active'
   where conversation_id = c.conv_dono;
  insert into public.whatsapp_messages
    (conversation_id, direction, type, content, status, sender_user_id, sender_role, wa_timestamp)
  values (c.conv_dono, 'out', 'text', 'Resposta do agente.', 'sent', null, 'ai', now());

  select ai_active into v_ativa from public.whatsapp_ai_sessions where conversation_id = c.conv_dono;
  perform pg_temp.checa('a mensagem da própria IA não desliga a IA', true, v_ativa);

  -- Mensagem que CHEGA do cliente também não.
  insert into public.whatsapp_messages
    (conversation_id, direction, type, content, status, wa_timestamp)
  values (c.conv_dono, 'in', 'text', 'Oi!', 'received', now());

  select ai_active into v_ativa from public.whatsapp_ai_sessions where conversation_id = c.conv_dono;
  perform pg_temp.checa('mensagem recebida do cliente não desliga a IA', true, v_ativa);
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Sem regressão: transferir e enviar continuam funcionando
--
-- As policies de IA foram apertadas; o resto do atendimento não pode ter
-- entrado junto.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare c record;
begin
  select * into c from t_ctx;
  set local role postgres;
  update public.whatsapp_conversations set assigned_user_id = c.dono, status = 'open'
   where id = c.conv_dono;

  set local role authenticated;
  perform pg_temp.vira(c.dono);
  perform pg_temp.checa('o responsável ainda pode responder', true,
    public.wa_can_reply_conv(c.conv_dono));
  perform pg_temp.checa('o responsável ainda pode transferir', true,
    public.wa_can_transfer_conv(c.conv_dono));

  perform pg_temp.vira(c.supervisor);
  perform pg_temp.checa('o supervisor do canal ainda transfere', true,
    public.wa_can_transfer_conv(c.conv_dono));

  perform pg_temp.vira(c.estranho);
  perform pg_temp.checa('o estranho continua sem transferir o que não é dele', false,
    public.wa_can_transfer_conv(c.conv_dono));
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
