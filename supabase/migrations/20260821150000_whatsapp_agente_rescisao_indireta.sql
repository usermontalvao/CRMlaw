-- ═══════════════════════════════════════════════════════════════════════════
-- Agente de triagem do canal "Rescisão Indireta"
--
-- Tudo aqui é DADO, não arquitetura nova: o agente é uma linha em
-- `whatsapp_ai_assistants` com o roteiro em `playbook` (o mesmo motor das duas
-- campanhas que já estão no ar), o quadro é `whatsapp_channel_funnel_stages` do
-- canal, e o vínculo é a linha de `whatsapp_ai_channel_config`.
--
-- IDEMPOTENTE: pode rodar quantas vezes for. Nada é apagado; o que já existe
-- com o mesmo nome/chave é atualizado no lugar.
--
-- NASCE DESLIGADO: `ai_enabled = false`. Ninguém recebe mensagem automática
-- deste agente até alguém ligar a chave em Configurações › WhatsApp.
-- ═══════════════════════════════════════════════════════════════════════════

do $migration$
declare
  v_channel  uuid;
  v_pedro    uuid;
  v_agent    uuid;
begin
  -- ── O canal ───────────────────────────────────────────────────────────────
  -- Pelo `instance_name`, que é a chave da Evolution e não muda; o `name` é só
  -- rótulo de tela e é justamente ele que tinha um erro de digitação.
  select id into v_channel
    from public.whatsapp_instances
   where instance_name = 'resc.indireta'
   limit 1;

  if v_channel is null then
    raise notice 'canal resc.indireta não existe neste banco — nada a fazer';
    return;
  end if;

  select user_id into v_pedro
    from public.profiles
   where email = 'pedro@advcuiaba.com'
   limit 1;

  if v_pedro is null then
    raise exception 'usuário Pedro (pedro@advcuiaba.com) não encontrado em profiles';
  end if;

  -- O rótulo do canal, com o "Resciaão" corrigido. Só o nome de tela; a
  -- instância da Evolution continua a mesma.
  update public.whatsapp_instances
     set name = 'Rescisão Indireta'
   where id = v_channel
     and name is distinct from 'Rescisão Indireta';

  -- ── O quadro ──────────────────────────────────────────────────────────────
  -- Mesma tabela e mesmo formato dos funis de "Comercial" e "Pedro". Os
  -- rótulos importam: é por eles que o backend reconhece cada degrau
  -- (`wa-ai-funnel.ts`), e não pela chave.
  insert into public.whatsapp_channel_funnel_stages
    (channel_id, stage_key, label, description, color, labels, position, is_active, is_default)
  values
    (v_channel, 'novo_contato',        'Novo contato',         'Contato recebido pelo canal, ainda sem triagem.',            '#64748b', array['Novo contato'],         0, true, true),
    (v_channel, 'em_triagem',          'Em triagem',           'O assistente já respondeu e está coletando a situação.',     '#3b82f6', array['Em triagem'],           1, true, false),
    (v_channel, 'aguardando_resposta', 'Aguardando resposta',  'O assistente cobrou e espera o retorno do contato.',         '#f59e0b', array['Aguardando resposta'],  2, true, false),
    (v_channel, 'qualificado',         'Qualificado',          'Triagem concluída; caso a caminho da análise do advogado.',  '#10b981', array['Qualificado'],          3, true, false),
    (v_channel, 'transferido_pedro',   'Transferido ao Pedro', 'Atendimento encaminhado ao Pedro, aguardando o aceite.',     '#0ea5e9', array['Transferido ao Pedro'], 4, true, false),
    (v_channel, 'em_acompanhamento',   'Em acompanhamento',    'Uma pessoa assumiu a conversa e segue com o contato.',       '#8b5cf6', array['Em acompanhamento'],    5, true, false),
    (v_channel, 'nao_qualificado',     'Não qualificado',      'Marcação manual: o caso não seguirá por este canal.',        '#ef4444', array['Não qualificado'],      6, true, false),
    (v_channel, 'encerrado',           'Encerrado',            'Atendimento encerrado. Pode ser retomado a qualquer tempo.', '#475569', array['Encerrado'],            7, true, false)
  on conflict (channel_id, stage_key) do update
     set label       = excluded.label,
         description = excluded.description,
         color       = excluded.color,
         labels      = excluded.labels,
         position    = excluded.position,
         is_active   = excluded.is_active,
         is_default  = excluded.is_default;

  -- A entrada do funil: é o gatilho `wa_apply_channel_initial_funnel`, que já
  -- existia, quem põe a etiqueta na conversa que nasce. Uma etiqueta só, e só
  -- quando a conversa nasce sem nenhuma — por isso não há card duplicado.
  update public.whatsapp_instances
     set funnel_enabled       = true,
         funnel_initial_stage = 'novo_contato'
   where id = v_channel;

  -- ── O agente ──────────────────────────────────────────────────────────────
  -- Identificado pelo NOME, que é o que o painel mostra. Rodar de novo atualiza
  -- a linha existente em vez de criar uma segunda.
  select id into v_agent
    from public.whatsapp_ai_assistants
   where name = 'Rescisão Indireta'
   limit 1;

  if v_agent is null then
    insert into public.whatsapp_ai_assistants (name, created_by)
    values ('Rescisão Indireta', v_pedro)
    returning id into v_agent;
  end if;

  update public.whatsapp_ai_assistants
     set description = 'Triagem curta dos contatos do canal Rescisão Indireta. Ouve a situação no trabalho, registra as respostas e encaminha o caso ao Pedro. Não dá parecer nem afirma que existe direito.',
         provider    = 'openai',
         -- Mesmo modelo das duas campanhas em produção: segue instrução
         -- cumulativa melhor que o 4o-mini pelo mesmo custo.
         model       = 'gpt-4.1-mini',
         is_active   = true,
         -- `test` registra o que FARIA sem enviar nada. Vira `auto` na tela,
         -- junto com a chave do canal, quando o escritório quiser abrir.
         mode        = 'test',
         -- Vazio de propósito: quem conduz é o roteiro (`playbook`). Ver
         -- `waAiPlaybookInstructions`.
         instructions_do   = '',
         instructions_dont = 'Não dê parecer jurídico, não afirme que a pessoa tem ou não tem direito, não conclua que existe ou não existe rescisão indireta, não prometa indenização, valor, prazo ou resultado, não use juridiquês com o contato e não peça CPF, RG, senha, dados bancários, documentos ou arquivos nesta triagem.',
         allowed_actions   = array['transferir_atendimento', 'agendar_followup', 'cancelar_followup', 'transferir_para_humano'],
         action_refs = jsonb_build_array(jsonb_build_object(
           'action',       'transferir_atendimento',
           'target_type',  'user',
           'target_id',    v_pedro::text,
           'target_label', 'Pedro Rodrigues Montalvao Neto',
           'raw',          'ação=transferir(Pedro Rodrigues Montalvao Neto)'
         )),
         -- ── Acompanhamento ──
         -- Três tentativas, horário comercial de Cuiabá, dias úteis: o mesmo
         -- desenho da campanha "Conta bloqueada", que é o padrão de 3 do
         -- escritório. A escada 2h → 24h → 72h é a pedida; `nextAllowedSlot`
         -- empurra cada uma para o próximo horário comercial disponível.
         followup_enabled        = true,
         followup_instructions   = 'Retome somente a primeira informação pendente da triagem, em uma frase. Não cobre documentos e não repita o que a pessoa já respondeu. Se ela disser que não quer continuar, não insista.',
         followup_max_attempts   = 3,
         followup_strategy       = 'custom',
         followup_custom_hours   = array[2, 24, 72]::numeric[],
         followup_interval_hours = 24,
         followup_days           = array[1, 2, 3, 4, 5],
         followup_start_minute   = 480,   -- 08:00
         followup_end_minute     = 1080,  -- 18:00
         timezone                = 'America/Cuiaba',
         followup_inactivity_minutes = 10,
         debounce_seconds = 5,
         history_limit    = 20,
         playbook  = $playbook${"id":"rescisao_indireta","label":"Rescisão indireta","funnel":true,"opening":"Olá! Sou o assistente do Pedro Montalvão Advocacia. Vou fazer algumas perguntas rápidas para entender sua situação e encaminhar seu atendimento.\n\nPara começar, você ainda está trabalhando nessa empresa?","style":["Uma pergunta por rodada. Sempre. Espere a resposta antes da próxima.","Mensagens curtas, como gente digitando no WhatsApp. Nada de parágrafo longo nem lista numerada, exceto na pergunta que já vem com os pontos escritos.","Diga que você é o assistente quando se apresentar. Nunca se passe por advogado.","Nada de juridiquês: não use \"rescisão indireta\", \"justa causa do empregador\", \"falta grave\" nem artigo de lei na conversa com a pessoa. Fale do que aconteceu com ela.","Reaja ao que a pessoa contou antes de perguntar outra coisa — \"entendi\", \"sinto muito por isso\". Curto, sem drama.","Nunca pergunte o que ela já respondeu. Se vierem várias informações de uma vez, aproveite todas.","Se a resposta vier vaga ou confusa, pergunte de outro jeito antes de registrar qualquer coisa.","NUNCA diga que a pessoa tem direito, que vai ganhar, quanto vai receber, quanto demora ou que o caso está ganho. Se perguntarem, diga que quem avalia isso é o advogado, depois de olhar o caso.","NUNCA conclua que existe ou que não existe direito a sair da empresa por culpa do empregador. Sua tarefa é ouvir e encaminhar.","Não pressione. Se a pessoa não quiser responder alguma coisa, siga em frente com o que já tem.","Não peça CPF, RG, senha, dados bancários, documentos nem arquivos nesta conversa. Se a pessoa mandar algo por conta própria, agradeça e siga — quem pede documento é a equipe, depois."],"closing":"A triagem terminou. NÃO peça documentos, arquivos nem dados pessoais, e não faça mais perguntas. NÃO diga que a pessoa tem ou não tem direito, e não prometa prazo, valor ou resultado. O encaminhamento para o advogado é registrado pelo próprio sistema — não chame ação=transferir por conta própria.\nEscreva apenas a mensagem de despedida: agradeça as informações, diga que um advogado precisa analisar os detalhes e as provas antes de indicar qualquer medida e avise que você vai encaminhar o atendimento ao Pedro.","closingReply":"Obrigado pelas informações. Pelo seu relato, é importante que um advogado analise os detalhes e as provas antes de indicar qualquer medida. Vou encaminhar seu atendimento ao Pedro para que ele possa avaliar o caso.","bindings":[{"key":"destino_triagem_concluida","label":"Triagem concluída","description":"Depois de ouvir a situação, encaminhar o atendimento para:","action":"transferir_atendimento","required":true,"targetLabel":"Pedro Rodrigues Montalvao Neto"},{"key":"destino_outro_assunto","label":"Assunto fora do tema deste canal","description":"Quando o relato não for sobre a situação no trabalho, encaminhar para:","action":"transferir_atendimento","required":true,"targetLabel":"Pedro Rodrigues Montalvao Neto","trigger":{"type":"cut_handoff","cutId":"assunto_fora_do_tema"}}],"fields":[{"key":"tipo_atendimento","label":"Tipo de atendimento","type":"enum","required":false,"ask":"identificado pelo relato, sem perguntar: vazio enquanto o assunto for a situação dela no trabalho; outro_assunto só quando ela trouxer, sozinha, um problema que não é do trabalho","options":["situacao_no_trabalho","outro_assunto"]},{"key":"vinculo_atual","label":"Ainda trabalha na empresa","type":"bool","required":true,"ask":"se ainda está trabalhando nessa empresa","question":"Para começar, você ainda está trabalhando nessa empresa?"},{"key":"data_saida","label":"Saída","type":"data_mes_ano","required":true,"ask":"mês e ano em que saiu da empresa","question":"Em que mês e ano você saiu de lá?","onlyWhen":{"field":"vinculo_atual","value":"não"}},{"key":"problema","label":"Problema relatado","type":"texto","required":true,"ask":"o que está acontecendo no trabalho","question":"E o que está acontecendo no seu trabalho?"},{"key":"duracao","label":"Há quanto tempo","type":"texto","required":true,"ask":"há quanto tempo isso acontece","question":"Há quanto tempo isso vem acontecendo?"},{"key":"tipo_falta","label":"Ponto apontado","type":"enum","required":true,"ask":"qual dos pontos da lista se parece com a situação dela","question":"A sua situação envolve algum destes pontos? Salário atrasado ou não pago; FGTS não depositado; assédio, humilhação ou ameaça; risco à saúde ou à segurança; redução de salário; outro descumprimento importante do combinado. Pode me dizer qual mais se parece com o seu caso — ou se é algo diferente disso.","options":["salario_atrasado_ou_nao_pago","fgts_nao_depositado","assedio_humilhacao_ou_ameaca","risco_a_saude_ou_seguranca","reducao_salarial","descumprimento_do_contrato","outra_falta_grave","nenhum_desses"]},{"key":"provas","label":"Possíveis provas","type":"texto","required":true,"ask":"o que ela tem que possa mostrar o que aconteceu","question":"Você tem alguma coisa que ajude a mostrar isso? Pode ser conversa, holerite, extrato, foto, documento ou alguém que tenha visto. Se não tiver nada, também pode me dizer."},{"key":"cidade_estado","label":"Cidade e estado","type":"texto","required":true,"ask":"em qual cidade e estado ela trabalha","question":"Em qual cidade e estado fica esse trabalho?"},{"key":"nome","label":"Nome","type":"texto","required":true,"ask":"o nome da pessoa","question":"Para finalizar, qual é o seu nome?"}],"stages":[{"id":"vinculo","label":"Vínculo","fields":["tipo_atendimento","vinculo_atual","data_saida"]},{"id":"situacao","label":"O que aconteceu","fields":["problema","duracao","tipo_falta"]},{"id":"elementos","label":"Possíveis provas","fields":["provas"]},{"id":"identificacao","label":"Onde e quem","fields":["cidade_estado","nome"]}],"cuts":[{"id":"assunto_fora_do_tema","rule":{"kind":"field_equals","field":"tipo_atendimento","values":["outro_assunto"]},"effect":"handoff","reason":"o relato não é sobre a situação da pessoa no trabalho","guidance":"Pare a triagem do trabalho. Não peça documentos e não opine sobre o assunto que ela trouxe. Diga em uma frase curta que você vai encaminhar o relato para avaliação de uma pessoa da equipe, que vai olhar o caso e retornar por aqui. Sem prometer prazo.","reply":"Entendi, obrigado por contar. Esse assunto foge um pouco do que eu consigo triar por aqui, então vou encaminhar seu relato para a equipe avaliar e retornar para você por esta mesma conversa."}]}$playbook$::jsonb,
         updated_at = now()
   where id = v_agent;

  -- ── O vínculo com o canal ─────────────────────────────────────────────────
  -- `ai_enabled = false`: a linha existe, o agente aparece ligado ao canal na
  -- tela, e nada é enviado até alguém virar a chave. Se a linha já existir com
  -- a IA ligada, a chave NÃO é mexida — desligar o que o escritório ligou seria
  -- pior do que não ter criado nada.
  insert into public.whatsapp_ai_channel_config (channel_id, assistant_id, ai_enabled, max_ai_turns)
  values (v_channel, v_agent, false, 20)
  on conflict (channel_id) do update
     set assistant_id = excluded.assistant_id,
         max_ai_turns = greatest(public.whatsapp_ai_channel_config.max_ai_turns, excluded.max_ai_turns),
         updated_at   = now();
end
$migration$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Os dois degraus que acontecem FORA da Edge Function
--
-- "Em acompanhamento" e "Encerrado" não são decisão do agente: um é a pessoa
-- aceitando a conversa na inbox, o outro é o atendimento sendo fechado. Os dois
-- são eventos de banco, então quem os observa é gatilho de banco.
--
-- SEGURO POR CONSTRUÇÃO: só move o card quando o canal TEM uma etapa com esse
-- rótulo. Nenhum funil de hoje tem "Em acompanhamento" ou "Encerrado" além
-- deste, então nenhum outro canal é afetado — e o dia em que alguém criar uma
-- etapa com esse nome, é porque quis o comportamento.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.wa_funnel_stage_label(p_channel uuid, p_needle text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(nullif(s.labels[1], ''), s.label)
    from public.whatsapp_channel_funnel_stages s
   where s.channel_id = p_channel
     and s.is_active
     and lower(btrim(s.label)) = p_needle
   order by s.position
   limit 1;
$$;

comment on function public.wa_funnel_stage_label(uuid, text) is
  'A etiqueta da etapa cujo RÓTULO é exatamente p_needle, em minúsculas. Null quando o canal não tem essa etapa.';

create or replace function public.wa_funnel_on_conversation_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_needle text;
  v_label  text;
  v_enabled boolean;
begin
  if new.instance_id is null then
    return null;
  end if;

  -- Encerrar vence assumir: uma conversa fechada não está "em acompanhamento".
  if new.status = 'closed' and old.status is distinct from 'closed' then
    v_needle := 'encerrado';
  elsif new.assigned_user_id is not null
    and new.awaiting_accept is not true
    and (old.assigned_user_id is distinct from new.assigned_user_id
         or old.awaiting_accept is true) then
    v_needle := 'em acompanhamento';
  else
    return null;
  end if;

  select funnel_enabled into v_enabled
    from public.whatsapp_instances where id = new.instance_id;
  if v_enabled is distinct from true then
    return null;
  end if;

  v_label := public.wa_funnel_stage_label(new.instance_id, v_needle);
  -- Canal sem essa etapa: não inventa etiqueta nenhuma.
  if v_label is null or new.labels @> array[v_label] then
    return null;
  end if;

  update public.whatsapp_conversations
     set labels = array[v_label]
   where id = new.id;
  return null;
end;
$$;

drop trigger if exists trg_wa_funnel_on_conversation_event on public.whatsapp_conversations;
create trigger trg_wa_funnel_on_conversation_event
after update on public.whatsapp_conversations
for each row
when (
  (new.status = 'closed' and old.status is distinct from 'closed')
  or (new.assigned_user_id is not null
      and new.awaiting_accept is not true
      and (old.assigned_user_id is distinct from new.assigned_user_id
           or old.awaiting_accept is true))
)
execute function public.wa_funnel_on_conversation_event();

-- Mesma postura das outras funções de funil do projeto
-- (`wa_apply_channel_initial_funnel`, `wa_sync_channel_funnel_conversations`):
-- nenhuma delas é chamável pelo navegador. O gatilho continua disparando
-- normalmente — o Postgres confere o EXECUTE ao CRIAR o gatilho, não a cada
-- disparo —, e as duas somem do `/rest/v1/rpc`.
revoke all on function public.wa_funnel_stage_label(uuid, text) from public, anon, authenticated;
revoke all on function public.wa_funnel_on_conversation_event() from public, anon, authenticated;
grant execute on function public.wa_funnel_stage_label(uuid, text) to service_role;
grant execute on function public.wa_funnel_on_conversation_event() to service_role;
