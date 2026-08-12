-- O roteiro da triagem vira DADO, e o corte vira conta do backend.
--
-- POR QUÊ (12/08/2026, campanha "Sem registro na carteira"): a triagem inteira
-- morava em prosa dentro de `instructions_do` — treze informações a descobrir,
-- três cortes e oito requisitos cumulativos —, e o único canal estruturado era
-- a ferramenta `registrar_memoria`. Ferramenta é OPCIONAL para o modelo: numa
-- conversa de trinta turnos ele a chamou duas vezes, e o que ela não trouxe
-- simplesmente não existiu. Pior: o corte que descarta um cliente (saiu há mais
-- de dois anos) estava escrito como pedido de cálculo para quem não sabe que
-- dia é hoje.
--
-- O que esta migration prepara:
--   1. `whatsapp_ai_assistants.playbook` — o roteiro por agente: etapas, campos
--      com tipo e obrigatoriedade, regras de corte. É dele que sai o
--      `response_format: {type:'json_schema', strict:true}` de cada turno, com
--      a lista de chaves FECHADA — é isso que mata na origem a deriva de nomes
--      (`empresa` num turno, `empregador` no seguinte);
--   2. `whatsapp_ai_sessions.triage_*` — onde a conversa parou e por que saiu,
--      calculados pelo backend a cada turno. O painel e o agendador leem daqui:
--      cobrar horário de trabalho de quem acabou de ser dispensado pelo prazo
--      seria a pior mensagem que este agente poderia mandar;
--   3. `whatsapp_ai_executions.status = 'degraded'` — o turno em que a resposta
--      do modelo veio fora do formato e a leitura caiu de degrau. Antes disso
--      uma resposta torta virava, calada, mensagem enviada ao cliente.
--
-- Agente SEM roteiro continua funcionando exatamente como antes: sem
-- `response_format`, com a memória por ferramenta. O roteiro é o que liga o
-- motor novo, um agente de cada vez.

alter table public.whatsapp_ai_assistants
  add column if not exists playbook jsonb not null default '{}'::jsonb;

comment on column public.whatsapp_ai_assistants.playbook is
  'Roteiro da triagem: {id, label, fields[], stages[], cuts[]}. Vazio = agente sem roteiro, que responde em texto livre como antes. Lido por wa-ai-playbook.ts (normalizeWaAiPlaybook).';

alter table public.whatsapp_ai_sessions
  add column if not exists triage_stage text,
  add column if not exists triage_cut text,
  add column if not exists triage_cut_reason text;

comment on column public.whatsapp_ai_sessions.triage_stage is
  'Etapa do roteiro em que a conversa está. Calculada pelo backend a cada turno, nunca informada pelo modelo.';
comment on column public.whatsapp_ai_sessions.triage_cut is
  'Id da regra de corte que encerrou a triagem (orgao_publico, prazo_2_anos, sem_prova_nem_testemunha). NULL = segue em frente.';
comment on column public.whatsapp_ai_sessions.triage_cut_reason is
  'O motivo do corte em texto, para o painel não precisar carregar o roteiro para exibi-lo.';

-- O quarto estado de uma execução: ela respondeu, mas fora do formato.
alter table public.whatsapp_ai_executions
  drop constraint if exists whatsapp_ai_executions_status_check;
alter table public.whatsapp_ai_executions
  add constraint whatsapp_ai_executions_status_check
  check (status = any (array['ok'::text, 'skipped'::text, 'error'::text, 'test'::text, 'degraded'::text]));

-- O roteiro da campanha que está no ar, exatamente como ele existe em
-- `WA_AI_PLAYBOOK_SEM_REGISTRO` (src/utils/waAiPlaybook.ts). A partir daqui a
-- verdade é a linha do banco: a constante fica como modelo para o próximo
-- agente nascer preenchido, não como cópia viva desta.
update public.whatsapp_ai_assistants
   set playbook = '{
  "id": "sem_registro_carteira",
  "label": "Trabalhou sem registro na carteira",
  "fields": [
    {
      "key": "nome",
      "label": "Nome",
      "type": "texto",
      "required": true,
      "ask": "o nome do cliente"
    },
    {
      "key": "empregador",
      "label": "Empregador",
      "type": "texto",
      "required": true,
      "ask": "para quem trabalhou (empresa ou pessoa)"
    },
    {
      "key": "tipo_empregador",
      "label": "Tipo de empregador",
      "type": "enum",
      "options": [
        "particular",
        "publico"
      ],
      "required": true,
      "ask": "se o empregador é particular ou órgão público"
    },
    {
      "key": "inicio",
      "label": "Início",
      "type": "data_mes_ano",
      "required": true,
      "ask": "mês e ano em que começou"
    },
    {
      "key": "ainda_trabalha",
      "label": "Ainda trabalha lá",
      "type": "bool",
      "required": true,
      "ask": "se ainda trabalha lá"
    },
    {
      "key": "saida",
      "label": "Saída",
      "type": "data_mes_ano",
      "required": true,
      "ask": "mês e ano da saída",
      "onlyWhen": {
        "field": "ainda_trabalha",
        "value": "não"
      }
    },
    {
      "key": "pessoalidade",
      "label": "Tinha de ser ela",
      "type": "bool",
      "required": true,
      "ask": "se era ela mesma que precisava trabalhar ou podia mandar outra pessoa"
    },
    {
      "key": "pagamento",
      "label": "Pagamento",
      "type": "texto",
      "required": true,
      "ask": "se recebia pelo serviço, quanto e como era pago"
    },
    {
      "key": "habitualidade",
      "label": "Rotina",
      "type": "texto",
      "required": true,
      "ask": "quantos dias por semana, quais dias e quais horários"
    },
    {
      "key": "subordinacao",
      "label": "Quem mandava",
      "type": "bool",
      "required": true,
      "ask": "se alguém passava as tarefas, cobrava o serviço ou definia o horário"
    },
    {
      "key": "tem_prova",
      "label": "Tem prova",
      "type": "bool",
      "required": true,
      "ask": "se tem alguma prova desse trabalho"
    },
    {
      "key": "provas",
      "label": "Quais provas",
      "type": "texto",
      "required": true,
      "ask": "quais provas ela tem",
      "onlyWhen": {
        "field": "tem_prova",
        "value": "sim"
      }
    },
    {
      "key": "tem_testemunha",
      "label": "Tem testemunha",
      "type": "bool",
      "required": true,
      "ask": "se tem alguém que possa testemunhar"
    },
    {
      "key": "outros_trabalhos",
      "label": "Outro sem carteira",
      "type": "bool",
      "required": false,
      "ask": "se teve outro trabalho sem carteira"
    }
  ],
  "stages": [
    {
      "id": "identificacao",
      "label": "Quem é e para quem trabalhou",
      "fields": [
        "nome",
        "empregador",
        "tipo_empregador"
      ]
    },
    {
      "id": "periodo",
      "label": "Período do trabalho",
      "fields": [
        "inicio",
        "ainda_trabalha",
        "saida"
      ]
    },
    {
      "id": "vinculo",
      "label": "Como era o trabalho",
      "fields": [
        "pessoalidade",
        "pagamento",
        "habitualidade",
        "subordinacao"
      ]
    },
    {
      "id": "provas",
      "label": "Provas e testemunhas",
      "fields": [
        "tem_prova",
        "provas",
        "tem_testemunha"
      ]
    },
    {
      "id": "fechamento",
      "label": "Fechamento",
      "fields": [
        "outros_trabalhos"
      ]
    }
  ],
  "cuts": [
    {
      "id": "orgao_publico",
      "rule": {
        "kind": "field_equals",
        "field": "tipo_empregador",
        "values": [
          "publico"
        ]
      },
      "effect": "handoff",
      "reason": "empregador é órgão público — análise específica",
      "guidance": "Pare a triagem. Não diga se a pessoa tem ou não tem direito, não peça documentos, explique em uma frase que esse tipo de situação precisa de análise específica por advogado e transfira para o Atendimento, marcando no resumo STATUS: ANÁLISE ESPECÍFICA — ÓRGÃO PÚBLICO."
    },
    {
      "id": "prazo_2_anos",
      "rule": {
        "kind": "older_than",
        "field": "saida",
        "years": 2
      },
      "effect": "disqualify",
      "reason": "saiu há mais de dois anos",
      "guidance": "Pare a triagem AGORA: não pergunte mais nada, não peça documentos e não trate como lead qualificado. Informe de forma curta e educada que, pela data em que esse trabalho terminou, o caso ficou fora do período analisado pelo escritório, e encerre. Se a pessoa insistir, discordar ou pedir para falar com alguém, transfira para Pedro Rodrigues Montalvao Neto."
    },
    {
      "id": "sem_prova_nem_testemunha",
      "rule": {
        "kind": "all_equal",
        "fields": [
          "tem_prova",
          "tem_testemunha"
        ],
        "value": "não"
      },
      "effect": "disqualify",
      "reason": "sem prova e sem testemunha",
      "guidance": "Pare a triagem. Não peça documentos pessoais e não trate como lead qualificado. Encerre de forma educada, sem dizer que o caso é fraco ou que falta prova."
    }
  ]
}
'::jsonb
 where id = '509cc5cf-25eb-4fca-ae5a-05f7ec07e69b'
   and playbook = '{}'::jsonb;
