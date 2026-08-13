/**
 * O ROTEIRO da triagem — configuração lida pelo backend.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiPlaybook.ts
 *   supabase/functions/_shared/wa-ai-playbook.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiPlaybook.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports. É por isso que
 * o pedaço de leitura de data aparece aqui outra vez, menor: `wa-ai-now.ts` faz
 * a conta das janelas para o PROMPT, este arquivo faz para o VEREDITO.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * A campanha "Sem registro na carteira" vivia inteira dentro de
 * `instructions_do`: treze informações a descobrir, três cortes e oito
 * requisitos cumulativos, tudo em prosa, tudo dependendo de o modelo ler certo.
 * O resultado está no log: nomes de campo diferentes a cada turno, pendência
 * respondida voltando para a fila e, o pior, o corte dos dois anos entregue a
 * quem não sabe que dia é hoje.
 *
 * A divisão que este arquivo estabelece, e que não pode se perder:
 *   - O MODELO devolve texto e valores — `mensagem_cliente`, `atualizacoes`,
 *     `campo_alvo` (ver `waAiTriageReply.ts`);
 *   - O BACKEND calcula `pendencias`, `etapa_atual` e `desqualificado`. O corte
 *     descarta um cliente: é conta, e conta não se pede, se faz;
 *   - O ROTEIRO é dado — etapas, campos com tipo e obrigatoriedade, regras de
 *     corte. Fechar a lista de chaves no schema é o que mata a deriva de nomes
 *     na origem, em vez de remendá-la depois (ver `waAiTriageFacts.ts`, que
 *     continua embaixo como rede: obrigar o modelo a preencher a forma não o
 *     obriga a ler certo — ele gravou 01/2025 para quem disse 2020).
 *
 * As AÇÕES não moram aqui. Elas continuam sendo tool call, porque é o tool call
 * que passa por `validateWaAiActionCall`, pelo destino compilado no backend e
 * pelo teto de três por execução.
 */

// ── Tetos ───────────────────────────────────────────────────────────────────

export const WA_AI_PLAYBOOK_MAX_FIELDS = 40;
export const WA_AI_PLAYBOOK_MAX_STAGES = 12;
export const WA_AI_PLAYBOOK_MAX_CUTS = 8;
export const WA_AI_PLAYBOOK_MAX_OPTIONS = 12;
export const WA_AI_PLAYBOOK_KEY_MAX_CHARS = 40;
export const WA_AI_PLAYBOOK_TEXT_MAX_CHARS = 200;
export const WA_AI_PLAYBOOK_CONTEXT_MAX_CHARS = 20_000;

/** O valor que significa "o cliente ainda não disse". Ver `buildWaAiTriageSchema`. */
export const WA_AI_VAZIO = '';

/** Contexto estruturado fornecido para a campanha, preservado sem reescrita. */
export const WA_AI_CONTEXT_SEM_REGISTRO: Record<string, unknown> = {
  "agent_context": {
    "schema_version": "1.0",
    "campaign": {
      "id": "trabalhou_sem_registro",
      "name": "Trabalhou sem registro na carteira"
    },
    "scope": {
      "description": "Atendimento de pessoas que responderam à campanha Trabalhou sem registro na carteira.",
      "source_of_conversation_flow": "roteiro",
      "covered_by_playbook": [
        "abertura",
        "forma_de_conversar",
        "perguntas_de_cada_informacao",
        "ordem_das_informacoes",
        "criterios_de_encerramento",
        "orientacao_apos_encerramento"
      ],
      "purpose_of_this_context": "Definir comportamentos, exceções e regras de continuidade que não estão cobertos pelo roteiro."
    }
  },

  "authority": {
    "playbook": {
      "role": "fonte_de_verdade_do_fluxo",
      "controls": [
        "informacoes_necessarias",
        "ordem_das_perguntas",
        "primeiro_item_pendente",
        "encerramento_da_triagem",
        "motivo_do_encerramento",
        "orientacao_apos_encerramento"
      ]
    },
    "agent": {
      "must_follow_playbook": true,
      "may_override_playbook_decision": false,
      "may_reopen_closed_triage": false
    }
  },

  "triage_closure": {
    "description": "Regras aplicáveis quando o sistema informar que a triagem foi encerrada.",
    "decision_authority": "sistema",
    "decision_already_made": true,
    "date_reference": "data_real_de_hoje",
    "possible_reasons": [
      "prazo",
      "orgao_publico",
      "falta_de_elemento_minimo",
      "falta_de_prova_e_testemunha"
    ],

    "when_closed": {
      "required_behaviors": [
        {
          "action": "seguir_orientacao_do_sistema",
          "required": true
        }
      ],
      "forbidden_behaviors": [
        {
          "action": "continuar_perguntas_da_triagem",
          "forbidden": true
        },
        {
          "action": "pedir_documentos",
          "forbidden": true
        },
        {
          "action": "afirmar_que_a_pessoa_tem_direito",
          "forbidden": true
        },
        {
          "action": "afirmar_que_a_pessoa_nao_tem_direito",
          "forbidden": true
        },
        {
          "action": "afirmar_que_o_caso_e_fraco",
          "forbidden": true
        },
        {
          "action": "afirmar_que_falta_prova",
          "forbidden": true
        },
        {
          "action": "reverter_decisao_do_sistema",
          "forbidden": true
        }
      ]
    },

    "post_closure_insistence": {
      "applies_when": {
        "triage_closed_reason": "prazo",
        "client_behavior_any_of": [
          "insiste",
          "discorda",
          "pede_analise",
          "pede_para_falar_com_alguem"
        ]
      },
      "required_action": {
        "type": "transferir",
        "configuration_key": "destino_revisao_prazo",
        "exact_action": "ação=transferir({{destino_revisao_prazo}})"
      },
      "do_not": [
        "retomar_triagem",
        "fazer_novas_perguntas_da_triagem",
        "reconsiderar_encerramento"
      ]
    }
  },

  "followup": {
    "purpose": "Retomar exatamente a informação que ficou pendente no roteiro.",

    "schedule": {
      "trigger": "cliente_sumiu_com_informacao_pendente",
      "required_action": {
        "type": "agendar_followup",
        "exact_action": "ação=agendar_followup()"
      },
      "message_rules": {
        "must_reference_pending_information": true,
        "must_be_specific": true,
        "generic_messages_forbidden": true
      },
      "example": {
        "pending_information": "dias_por_semana",
        "message": "Oi, Ana! Ficou faltando só me dizer quantos dias por semana você trabalhava."
      },
      "forbidden_examples": [
        "Ainda tem interesse?"
      ]
    },

    "cancel": {
      "required_action": {
        "type": "cancelar_followup",
        "exact_action": "ação=cancelar_followup()"
      },
      "triggers_any_of": [
        "informacao_pendente_foi_respondida",
        "triagem_foi_encerrada",
        "houve_transferencia",
        "caso_nao_precisa_mais_de_acompanhamento"
      ]
    },

    "priority_rule": {
      "if_pending_question_exists": "retomar_exatamente_a_pergunta_pendente",
      "do_not_replace_with_generic_reengagement": true
    }
  },

  "out_of_scope_or_human_transfer": {
    "triggers_any_of": [
      {
        "id": "explicit_human_request",
        "condition": "pessoa_pede_para_falar_com_alguem"
      },
      {
        "id": "irritated_client",
        "condition": "pessoa_fica_irritada"
      },
      {
        "id": "different_subject",
        "condition": "pessoa_traz_assunto_que_nao_seja_trabalho_sem_registro"
      },
      {
        "id": "unanswerable_legal_question",
        "condition": "pessoa_faz_pergunta_juridica_que_o_agente_nao_pode_responder"
      },
      {
        "id": "specific_legal_analysis",
        "condition": "pessoa_pede_analise_juridica_especifica"
      }
    ],

    "default_action": {
      "type": "transferir_para_humano",
      "exact_action": "ação=transferir_para_humano()"
    },

    "minimum_context_before_transfer": {
      "principle": "Nunca transferir de mãos vazias quando ainda for possível obter contexto mínimo.",
      "enabled": true,
      "collection_style": {
        "one_question_at_a_time": true,
        "recommended_question_count": {
          "min": 2,
          "max": 3
        },
        "must_not_become_new_triage": true
      },
      "information_to_try_to_collect": [
        {
          "key": "acontecimento",
          "question_goal": "o que aconteceu"
        },
        {
          "key": "data_ou_periodo",
          "question_goal": "quando aconteceu"
        },
        {
          "key": "parte_contraria",
          "question_goal": "quem está do outro lado"
        },
        {
          "key": "objetivo",
          "question_goal": "o que ela precisa do escritório"
        }
      ]
    },

    "client_refuses_context": {
      "condition": "pessoa_nao_quer_explicar",
      "must_not_insist": true,
      "action": "transferir_com_as_informacoes_ja_disponiveis"
    },

    "message_before_transfer": {
      "required": true,
      "max_sentences": 1,
      "style": "curta",
      "purpose": "avisar_que_vai_passar_para_a_equipe"
    },

    "handoff_summary": {
      "required": true,
      "purpose": "evitar_que_o_atendente_humano_precise_recomecar_do_zero",
      "fields": [
        {
          "key": "assunto_real",
          "required": true
        },
        {
          "key": "fatos_informados",
          "required": true
        },
        {
          "key": "informacoes_faltantes",
          "required": true
        },
        {
          "key": "objetivo_do_cliente",
          "required": true
        }
      ]
    },

    "legal_opinion_restriction": {
      "must_not_give_legal_opinion": true,
      "must_not_say_has_right": true,
      "must_not_say_has_no_right": true
    }
  },

  "continuity": {
    "priority": {
      "level": "high",
      "rule": "Estas regras prevalecem sobre a abertura."
    },

    "introduction": {
      "max_times_per_conversation": 1,
      "opening_already_occurred_if": "existe_em_qualquer_momento_anterior_uma_mensagem_do_agente_de_boas_vindas",
      "repeat_opening": false
    },

    "previous_agent_question": {
      "before_replying": "verificar_a_ultima_pergunta_feita_pelo_agente",
      "if_unanswered": {
        "action": "retomar_a_mesma_informacao",
        "wording": [
          "mais_simples",
          "mais_curto"
        ],
        "do_not_advance_to_next_field": true
      }
    },

    "greeting_after_conversation_started": {
      "examples": [
        "oi",
        "opa",
        "bom dia",
        "tudo bem"
      ],
      "behavior": {
        "respond_lightly": true,
        "repeat_opening": false,
        "resume_pending_question": true
      }
    },

    "already_known_information": {
      "never_ask_name_again_if_known": true,
      "never_repeat_answered_question": true,
      "sources_to_check": [
        "conversa",
        "estado_registrado",
        "atualizacoes_anteriores"
      ]
    },

    "multiple_short_messages": {
      "condition": "cliente_envia_varias_mensagens_curtas_em_sequencia",
      "behavior": {
        "read_all_before_replying": true,
        "treat_as_single_answer": true,
        "extract_all_available_information": true
      }
    },

    "anticipated_information": {
      "condition": "cliente_responde_pergunta_atual_e_antecipa_informacoes_de_etapas_seguintes",
      "behavior": {
        "register_current_answer": true,
        "register_future_stage_information": true,
        "do_not_ask_already_answered_future_questions": true,
        "advance_to": "primeira_informacao_realmente_faltante"
      }
    }
  },

  "information_registration": {
    "current_turn": {
      "extract_all_information_provided": true,
      "do_not_extract_only_target_field": true,
      "preserve_client_meaning": true,
      "register_in": "atualizacoes"
    },

    "updates": {
      "field_name": "atualizacoes",
      "requirement": "Registrar tudo o que o cliente acabou de informar.",
      "content_rule": "Preservar as informações conforme relatadas pelo cliente, sem inventar fatos."
    }
  },

  "pre_message_validation": {
    "required": true,
    "run_before_every_outbound_message": true,

    "checks_in_order": [
      {
        "id": 1,
        "key": "already_answered",
        "question": "Essa informação já foi respondida em algum momento da conversa?",
        "if_yes": {
          "do_not_ask": true,
          "action": "avancar_para_primeiro_item_realmente_pendente"
        }
      },
      {
        "id": 2,
        "key": "triage_closed",
        "question": "O roteiro diz que o atendimento foi encerrado?",
        "if_yes": {
          "do_not_continue_triage": true,
          "do_not_ask_question": true,
          "action": "seguir_regras_de_triage_closure"
        }
      },
      {
        "id": 3,
        "key": "single_question",
        "question": "Estou fazendo apenas uma pergunta?",
        "required_answer": true
      },
      {
        "id": 4,
        "key": "first_pending_item",
        "question": "Estou perguntando o primeiro item que ainda falta no roteiro?",
        "required_answer": true
      },
      {
        "id": 5,
        "key": "updates_complete",
        "question": "Registrei em atualizacoes tudo o que o cliente acabou de informar, com as palavras dele?",
        "required_answer": true
      }
    ],

    "send_condition": {
      "all_applicable_checks_must_pass": true
    }
  },

  "global_prohibitions": [
    "nao_repetir_informacao_ja_coletada",
    "nao_repetir_abertura",
    "nao_continuar_triagem_encerrada",
    "nao_fazer_mais_de_uma_pergunta_por_vez",
    "nao_pular_o_primeiro_item_pendente",
    "nao_ignorar_informacoes_antecipadas_pelo_cliente",
    "nao_dar_opiniao_juridica_fora_do_escopo",
    "nao_reverter_decisao_de_encerramento_do_sistema"
  ],

  "action_catalog": {
    "transferir_especifico": {
      "syntax": "ação=transferir({{destino_revisao_prazo}})",
      "configuration_key": "destino_revisao_prazo"
    },
    "transferir_para_humano": {
      "syntax": "ação=transferir_para_humano()"
    },
    "agendar_followup": {
      "syntax": "ação=agendar_followup()"
    },
    "cancelar_followup": {
      "syntax": "ação=cancelar_followup()"
    }
  }
};

// ── Forma do roteiro ────────────────────────────────────────────────────────

/**
 * O tipo diz como o valor é lido, não só como é exibido.
 *   `data_mes_ano` vira `MM/AAAA` e é o único que as regras de prazo aceitam;
 *   `bool` só existe como `sim`/`não`;
 *   `enum` só aceita uma das opções declaradas;
 *   `texto` é o que sobra — guardado como veio, sem interpretação.
 */
export type WaAiFieldType = 'data_mes_ano' | 'bool' | 'enum' | 'numero' | 'hora' | 'texto';
export type WaAiFactValue = string | number | boolean;

/** Um campo só é perguntado quando a condição vale (saída, se já saiu). */
export interface WaAiFieldCondition {
  field: string;
  value: string;
}

export interface WaAiPlaybookField {
  /** Chave canônica. É ela que entra no schema e no painel. */
  key: string;
  /** Nome curto para o painel. */
  label: string;
  type: WaAiFieldType;
  /** Só para `enum`. */
  options?: string[];
  /** Obrigatório entra na lista de pendências enquanto estiver vazio. */
  required: boolean;
  /** O texto da pendência, na voz de quem espera: "mês e ano de início". */
  ask: string;
  /**
   * A PERGUNTA, com as palavras que vão ao cliente.
   *
   * Mora aqui, e não numa seção de prosa, porque é aqui que ela serve: o
   * backend já sabe qual é o próximo campo, então entrega a frase pronta em vez
   * de esperar que o modelo ache a certa numa lista de exemplos. Sem ela, o
   * modelo escreve a pergunta com as próprias palavras — o que continua
   * valendo, só não é mais o padrão.
   */
  question?: string;
  /** Quando existir, o campo só é perguntado se a condição valer. */
  onlyWhen?: WaAiFieldCondition;
}

export interface WaAiPlaybookStage {
  id: string;
  label: string;
  /** Chaves de campo, na ordem em que se pergunta. */
  fields: string[];
}

/**
 * As regras de corte, declarativas de propósito: o backend as avalia, o modelo
 * apenas lê o veredito pronto.
 *
 *   `field_equals`  — o campo é uma das opções listadas (órgão público);
 *   `older_than`    — a data é mais velha que a janela (os dois anos);
 *   `all_equal`     — todos os campos têm o mesmo valor (sem prova E sem
 *                     testemunha; um só não corta).
 */
export type WaAiCutRule =
  | { kind: 'field_equals'; field: string; values: string[] }
  | { kind: 'older_than'; field: string; years: number }
  | { kind: 'all_equal'; fields: string[]; value: string };

export interface WaAiPlaybookCut {
  id: string;
  rule: WaAiCutRule;
  /** `disqualify` encerra o atendimento; `handoff` manda para gente. */
  effect: 'disqualify' | 'handoff';
  /** Por que o caso saiu — vai para o painel e para o resumo de transferência. */
  reason: string;
  /** O que o agente faz agora. Entra no prompt como ordem, não como cálculo. */
  guidance: string;
}

/**
 * Escolha operacional feita na tela, separada do JSON de comportamento.
 * `action` usa o nome canônico do catálogo; o placeholder aparece nos textos
 * como `{{key}}` e só é resolvido quando o prompt é montado.
 */
export interface WaAiPlaybookBinding {
  key: string;
  label: string;
  description?: string;
  action: string;
  required: boolean;
  targetType?: 'user' | 'department' | 'document_template';
  targetId?: string;
  targetLabel?: string;
  /** Migração suave: sugere a escolha antiga até o administrador confirmar. */
  suggestedTargetLabel?: string;
  trigger?: { type: 'cut_handoff'; cutId: string };
}

export interface WaAiPlaybook {
  id: string;
  label: string;
  /**
   * A primeira mensagem da conversa, quando não há histórico nenhum.
   *
   * Estas três — abertura, estilo e fechamento — existem para que o "o que este
   * agente deve fazer" não precise repetir, em prosa, o que o roteiro já
   * organiza. O prompt do agente é MONTADO a partir daqui
   * (`waAiPlaybookInstructions`); o texto livre continua existindo para o que
   * não couber em campo nenhum.
   */
  opening?: string;
  /** Como conversar: uma regra por linha, na voz de quem instrui. */
  style?: string[];
  /** O que fazer quando o roteiro fecha sem corte: documentos, resumo, entrega. */
  closing?: string;
  /**
   * Regras estruturadas complementares coladas no editor. Elas orientam
   * continuidade, follow-up, handoff e limites; campos, ordem e cortes continuam
   * nas propriedades declarativas abaixo, que o backend consegue conferir.
   */
  context?: Record<string, unknown>;
  /** Pessoas, setores e modelos escolhidos pela tela — nunca pelo texto JSON. */
  bindings?: WaAiPlaybookBinding[];
  fields: WaAiPlaybookField[];
  stages: WaAiPlaybookStage[];
  cuts: WaAiPlaybookCut[];
}

// ── O roteiro da campanha em produção ───────────────────────────────────────

/**
 * "Trabalhou sem registro na carteira" — o mesmo conteúdo que hoje está escrito
 * em prosa dentro de `instructions_do` do agente `509cc5cf…`, agora em forma de
 * dado.
 *
 * As instruções de texto CONTINUAM valendo: elas dizem como conversar, com que
 * palavras perguntar e o que nunca prometer. O que sai delas e vem para cá é só
 * o que precisa ser contado ou conferido — que é justamente o que um modelo
 * pequeno não faz de forma confiável.
 */
export const WA_AI_PLAYBOOK_SEM_REGISTRO: WaAiPlaybook = {
  id: 'sem_registro_carteira',
  label: 'Trabalhou sem registro na carteira',
  context: WA_AI_CONTEXT_SEM_REGISTRO,
  bindings: [
    {
      key: 'destino_revisao_prazo',
      label: 'Cliente insiste após encerramento por prazo',
      description: 'Se a pessoa discordar ou pedir análise humana, transferir para:',
      action: 'transferir_atendimento', required: true,
      suggestedTargetLabel: 'Pedro Rodrigues Montalvao Neto',
    },
    {
      key: 'destino_triagem_concluida',
      label: 'Triagem concluída e qualificada',
      description: 'Depois de coletar as informações e documentos possíveis, transferir para:',
      action: 'transferir_atendimento', required: true,
      suggestedTargetLabel: 'Atendimento',
    },
  ],
  opening: 'Olá! Tudo bem? Vou fazer algumas perguntas rápidas para entender melhor o seu caso.\n\n'
    + 'Para começar, qual é o seu nome?',
  style: [
    'Uma pergunta por vez. Sempre. Espere a resposta antes da próxima.',
    'Mensagens curtas, como gente digitando no WhatsApp. Nada de parágrafo longo nem lista numerada para o cliente.',
    'Depois que souber o nome, use o nome naturalmente.',
    'Reaja ao que a pessoa contou antes de perguntar outra coisa — "entendi", "certo", "puxa, situação chata mesmo". Curto, sem drama e sem exagero.',
    'Nunca pergunte o que ela já respondeu. Se vierem duas ou mais informações de uma vez, aproveite todas e registre cada uma no campo correspondente.',
    'Se a resposta vier vaga, incompleta, confusa ou contraditória, pergunte de outro jeito antes de registrar qualquer coisa.',
    'Fale como o cliente fala. Nada de "vínculo empregatício", "pessoalidade", "habitualidade" ou "subordinação" na conversa com ele.',
    'Se perguntarem quanto vão receber, quanto demora, qual o valor da ação ou se vão ganhar, diga que isso precisa ser avaliado pelo advogado depois de analisar o caso, e siga a triagem.',
    'Não diga que a pessoa "tem direito", "vai ganhar" ou que o caso está ganho.',
    'Analise um empregador por vez. Não misture datas, pagamentos, rotina, provas ou testemunhas de empresas diferentes.',
  ],
  closing: 'Peça os documentos: diga em uma frase que o caso pode ser encaminhado para análise e que '
    + 'você vai precisar de alguns documentos, que podem ser enviados por ali mesmo. Depois registre '
    + 'ação=solicitar_documentos(), listando documento de identificação com foto, CTPS Digital e '
    + 'as provas que a própria pessoa disse possuir. Não invente documentos ou provas que ela não '
    + 'mencionou.\n'
    + 'Ela pode mandar os documentos um por vez ou todos juntos. Antes de afirmar que um documento '
    + 'chegou, está faltando ou já foi enviado, sempre confira por ação=consultar_documentos() — '
    + 'nunca diga que recebeu algo porque lembra da conversa. Se faltar documento, peça só o que '
    + 'falta, um item por vez.\n'
    + 'Quando os documentos possíveis tiverem sido recebidos ou registrados como pendentes, avise em '
    + 'uma frase curta que vai passar o caso para a equipe e faça '
    + 'ação=transferir({{destino_triagem_concluida}}).\n'
    + 'No resumo escreva, em até 800 caracteres, nesta ordem e sem enfeite:\n'
    + 'Nome | Empresa | Período | Ainda trabalha | Função | Salário aprox. | Dias e horário | '
    + 'CTPS não assinada | Pessoalidade, pagamento, habitualidade e subordinação | Testemunha | '
    + 'Provas que tem | Provas recebidas | Documentos pendentes | Observações | STATUS: LEAD QUALIFICADO\n'
    + 'Só escreva LEAD QUALIFICADO com todos estes pontos confirmados ao mesmo tempo: era a própria '
    + 'pessoa que precisava trabalhar; recebia pelo serviço; trabalhava com regularidade, e não de vez '
    + 'em quando; alguém determinava tarefas, horários ou cobrava o serviço; a carteira não foi '
    + 'assinada; existe pelo menos uma prova ou uma testemunha. Se algum ponto ficar duvidoso, faça '
    + 'uma pergunta curta para esclarecer antes de decidir — "trabalhei sem carteira" não qualifica o '
    + 'caso sozinho.',
  fields: [
    {
      key: 'nome', label: 'Nome', type: 'texto', required: true, ask: 'o nome do cliente',
      question: 'Para começar, qual é o seu nome?',
    },
    {
      key: 'empregador', label: 'Empregador', type: 'texto', required: true,
      ask: 'para quem trabalhou (empresa ou pessoa)',
      question: 'Para qual empresa ou pessoa você trabalhou sem registro?',
    },
    {
      key: 'tipo_empregador', label: 'Tipo de empregador', type: 'enum',
      options: ['particular', 'publico'], required: true,
      ask: 'se o empregador é particular ou órgão público',
      question: 'Esse trabalho era para uma empresa particular ou para prefeitura, estado, órgão público ou empresa pública?',
    },
    {
      key: 'inicio', label: 'Início', type: 'data_mes_ano', required: true,
      ask: 'mês e ano em que começou',
      question: 'Em que mês e ano você começou a trabalhar lá?',
    },
    {
      key: 'ainda_trabalha', label: 'Ainda trabalha lá', type: 'bool', required: true,
      ask: 'se ainda trabalha lá',
      question: 'Você ainda trabalha lá ou já saiu?',
    },
    {
      key: 'saida', label: 'Saída', type: 'data_mes_ano', required: true,
      ask: 'mês e ano da saída',
      question: 'Em que mês e ano você saiu?',
      onlyWhen: { field: 'ainda_trabalha', value: 'não' },
    },
    {
      key: 'funcao', label: 'Função', type: 'texto', required: true,
      ask: 'o que fazia no trabalho',
      question: 'O que você fazia nesse trabalho, no dia a dia?',
    },
    {
      key: 'pessoalidade', label: 'Tinha de ser ela', type: 'bool', required: true,
      ask: 'se era ela mesma que precisava trabalhar ou podia mandar outra pessoa',
      question: 'Era você mesmo que tinha que ir trabalhar ou, se quisesse, podia mandar outra pessoa no seu lugar?',
    },
    {
      key: 'recebia_pagamento', label: 'Recebia pelo trabalho', type: 'bool', required: true,
      ask: 'se recebia dinheiro ou outra forma de pagamento pelo trabalho',
      question: 'Você recebia algum pagamento por esse trabalho?',
    },
    {
      key: 'pagamento', label: 'Pagamento', type: 'texto', required: true,
      ask: 'quanto recebia e como era pago',
      question: 'Mais ou menos quanto você recebia, e como te pagavam?',
      onlyWhen: { field: 'recebia_pagamento', value: 'sim' },
    },
    {
      key: 'trabalho_regular', label: 'Trabalho regular', type: 'enum',
      options: ['regular', 'esporadico'], required: true,
      ask: 'se trabalhava toda semana ou apenas de vez em quando',
      question: 'Esse trabalho acontecia toda semana ou era só de vez em quando?',
    },
    {
      key: 'habitualidade', label: 'Rotina', type: 'texto', required: true,
      ask: 'quantos dias por semana, quais dias e quais horários',
      question: 'Você trabalhava quantos dias por semana, e mais ou menos em que horário?',
      onlyWhen: { field: 'trabalho_regular', value: 'regular' },
    },
    {
      key: 'subordinacao', label: 'Quem mandava', type: 'bool', required: true,
      ask: 'se alguém passava as tarefas, cobrava o serviço ou definia o horário',
      question: 'Tinha alguém que passava o que você precisava fazer ou cobrava o serviço?',
    },
    {
      key: 'tem_prova', label: 'Tem prova', type: 'bool', required: true,
      ask: 'se tem alguma prova desse trabalho',
      question: 'Você tem alguma prova desse trabalho? Pode ser Pix ou comprovante de pagamento, conversa de WhatsApp, foto ou vídeo trabalhando, crachá, uniforme ou algum papel da empresa.',
    },
    {
      key: 'provas', label: 'Quais provas', type: 'texto', required: true,
      ask: 'quais provas ela tem',
      question: 'Quais dessas você tem guardadas?',
      onlyWhen: { field: 'tem_prova', value: 'sim' },
    },
    {
      key: 'tem_testemunha', label: 'Tem testemunha', type: 'bool', required: true,
      ask: 'se tem alguém que possa testemunhar',
      question: 'E tem alguém que trabalhou com você ou via sua rotina, que poderia servir de testemunha?',
    },
    {
      key: 'outros_trabalhos', label: 'Outro sem carteira', type: 'bool', required: true,
      ask: 'se teve outro trabalho sem carteira',
      question: 'Você teve algum outro trabalho sem carteira assinada além desse?',
    },
  ],
  stages: [
    { id: 'identificacao', label: 'Quem é e para quem trabalhou', fields: ['nome', 'empregador', 'tipo_empregador'] },
    { id: 'periodo', label: 'Período do trabalho', fields: ['inicio', 'ainda_trabalha', 'saida'] },
    { id: 'vinculo', label: 'Como era o trabalho', fields: ['funcao', 'pessoalidade', 'recebia_pagamento', 'pagamento', 'trabalho_regular', 'habitualidade', 'subordinacao'] },
    { id: 'provas', label: 'Provas e testemunhas', fields: ['tem_prova', 'provas', 'tem_testemunha'] },
    { id: 'fechamento', label: 'Fechamento', fields: ['outros_trabalhos'] },
  ],
  cuts: [
    {
      id: 'orgao_publico',
      rule: { kind: 'field_equals', field: 'tipo_empregador', values: ['publico'] },
      effect: 'disqualify',
      reason: 'empregador é órgão público — fora dos critérios de atendimento do escritório',
      guidance: 'Pare a triagem. Não diga que a pessoa tem ou não tem direito e não peça documentos. '
        + 'Explique em uma frase curta que situações de trabalho para órgão público não se enquadram '
        + 'nos critérios deste atendimento e encerre de forma educada. '
        + 'Marque STATUS: NÃO QUALIFICADO — ÓRGÃO PÚBLICO.',
    },
    {
      id: 'prazo_2_anos',
      rule: { kind: 'older_than', field: 'saida', years: 2 },
      effect: 'disqualify',
      reason: 'saiu há mais de dois anos',
      guidance: 'Pare a triagem AGORA: não pergunte mais nada, não peça documentos e não trate como '
        + 'lead qualificado. Informe de forma curta e educada que, pela data em que esse trabalho '
        + 'terminou, o caso ficou fora do período analisado pelo escritório, e encerre. Se a pessoa '
        + 'insistir, discordar ou pedir para falar com alguém, transfira para o destino configurado.',
    },
    {
      id: 'sem_pessoalidade',
      rule: { kind: 'field_equals', field: 'pessoalidade', values: ['não'] },
      effect: 'disqualify',
      reason: 'outra pessoa podia realizar o trabalho livremente',
      guidance: 'Pare a triagem. Não dê opinião jurídica. Explique apenas que, pelas informações '
        + 'dadas, a situação ficou fora dos critérios desta triagem e encerre com educação.',
    },
    {
      id: 'sem_pagamento',
      rule: { kind: 'field_equals', field: 'recebia_pagamento', values: ['não'] },
      effect: 'disqualify',
      reason: 'não havia pagamento pelo trabalho',
      guidance: 'Pare a triagem. Não diga que a pessoa tem ou não tem direito. Informe de forma '
        + 'curta que a situação ficou fora dos critérios deste atendimento e encerre.',
    },
    {
      id: 'trabalho_esporadico',
      rule: { kind: 'field_equals', field: 'trabalho_regular', values: ['esporadico'] },
      effect: 'disqualify',
      reason: 'trabalho apenas esporádico, sem regularidade informada',
      guidance: 'Pare a triagem. Não use termos jurídicos nem conclua que não há direito. Diga '
        + 'somente que a situação ficou fora dos critérios desta triagem e encerre.',
    },
    {
      id: 'sem_subordinacao',
      rule: { kind: 'field_equals', field: 'subordinacao', values: ['não'] },
      effect: 'disqualify',
      reason: 'não havia pessoa dirigindo ou cobrando o trabalho',
      guidance: 'Pare a triagem. Não dê parecer jurídico. Explique em uma frase que a situação '
        + 'ficou fora dos critérios deste atendimento e encerre com educação.',
    },
    {
      id: 'sem_prova_nem_testemunha',
      rule: { kind: 'all_equal', fields: ['tem_prova', 'tem_testemunha'], value: 'não' },
      effect: 'disqualify',
      reason: 'sem prova e sem testemunha',
      guidance: 'Pare a triagem. Não peça documentos pessoais e não trate como lead qualificado. '
        + 'Encerre de forma educada, sem dizer que o caso é fraco ou que falta prova.',
    },
  ],
};

// ── Campanha: bloqueio ou encerramento de conta ────────────────────────────

export const WA_AI_CONTEXT_CONTA_BLOQUEADA: Record<string, unknown> = {
  agent_context: {
    schema_version: '1.0',
    campaign: {
      id: 'bloqueio_encerramento_conta',
      name: 'Bloqueio ou encerramento de conta sem aviso prévio',
    },
    scope: {
      description: 'Triagem de conta bancária bloqueada ou encerrada sem aviso prévio.',
      source_of_conversation_flow: 'roteiro',
    },
  },
  authority: {
    playbook: { role: 'fonte_de_verdade_do_fluxo' },
    agent: { must_follow_playbook: true, may_override_playbook_decision: false },
  },
  document_workflow: {
    essential_documents: [
      'documento_de_identificacao_do_cliente',
      'prova_do_bloqueio_ou_encerramento_em_print',
      'comprovante_de_residencia_aceito_conforme_a_rota',
    ],
    residence_routes: {
      own_or_family: 'Aceitar comprovante em nome próprio, esposa, esposo, pai ou mãe.',
      rented_with_contract: 'Na falta de comprovante aceito, coletar contrato de aluguel.',
      third_party_without_contract: {
        action: 'Coletar documento do declarante e transferir para o operador preparar a declaração.',
        handwritten_photo_is_accepted: true,
        declaration_template: [
          'EU [NOME DO DECLARANTE], RG [RG] e CPF [CPF], declaro que [NOME DO CLIENTE], RG [RG] e CPF [CPF], reside no endereço [ENDEREÇO COMPLETO].',
          '[ASSINATURA DO DECLARANTE]',
          '[CIDADE], [DATA REAL].',
        ],
      },
    },
  },
  commercial_terms: {
    fees: 'Honorários contratuais de 40% do valor obtido ao final.',
    must_explain_before_acceptance: true,
    may_promise_result: false,
  },
  qualified_lead_sequence: [
    'solicitar_e_conferir_documentos',
    'enviar_kit_consumidor',
    'orientar_reu_com_nome_do_banco',
    'acompanhar_preenchimento_e_assinatura',
    'conferir_assinatura_no_sistema',
    'transferir_somente_depois_de_assinado',
  ],
  followup: {
    triage: 'Retomar exatamente a primeira informação ainda pendente.',
    documents: 'Usar o acompanhamento automático da solicitação de documentos.',
    kit_and_signature: 'Usar os acompanhamentos automáticos do kit e da assinatura.',
    stop_when: ['cliente_responde', 'caso_desqualificado', 'assinatura_concluida', 'transferencia'],
    forbid_duplicate_generic_followup: true,
  },
  global_prohibitions: [
    'nao_dizer_que_o_cliente_vai_ganhar',
    'nao_afirmar_documento_recebido_sem_consultar_o_sistema',
    'nao_enviar_kit_antes_dos_documentos_essenciais',
    'nao_transferir_antes_da_assinatura_salvo_rota_de_declaracao',
    'nao_inventar_nome_do_banco',
  ],
  action_catalog: {
    kit_consumidor: 'ação=enviar_documento({{modelo_kit_consumidor}})',
    operador_declaracao: 'ação=transferir({{destino_declaracao_residencia}})',
    destino_assinado: 'ação=transferir({{destino_pos_assinatura}})',
  },
};

export const WA_AI_PLAYBOOK_CONTA_BLOQUEADA: WaAiPlaybook = {
  id: 'bloqueio_encerramento_conta',
  label: 'Bloqueio ou encerramento de conta sem aviso prévio',
  context: WA_AI_CONTEXT_CONTA_BLOQUEADA,
  bindings: [
    {
      key: 'modelo_kit_consumidor',
      label: 'KIT CONSUMIDOR',
      description: 'Documento para preencher e assinar depois que os documentos essenciais estiverem completos:',
      action: 'enviar_documento', required: true,
      suggestedTargetLabel: 'KIT CONSUMIDOR',
    },
    {
      key: 'destino_declaracao_residencia',
      label: 'Preparar declaração de residência',
      description: 'Quando a pessoa não tiver comprovante aceito nem contrato, transferir para:',
      action: 'transferir_atendimento', required: true,
      suggestedTargetLabel: 'Atendimento',
    },
    {
      key: 'destino_pos_assinatura',
      label: 'KIT CONSUMIDOR assinado',
      description: 'Depois que o sistema confirmar a assinatura, transferir para:',
      action: 'transferir_atendimento', required: true,
      suggestedTargetLabel: 'Atendimento',
    },
  ],
  opening: 'Olá! Tudo bem? Vou fazer algumas perguntas rápidas sobre o bloqueio ou encerramento da sua conta.\n\nPara começar, qual é o seu nome?',
  style: [
    'Uma pergunta por vez e mensagens curtas de WhatsApp.',
    'Use palavras simples. Se a pessoa não entender, dê exemplos e pergunte de outro jeito.',
    'Não repita o que já foi respondido, inclusive quando vier em várias mensagens curtas.',
    'Nunca prometa resultado, indenização ou prazo do processo.',
    'O banco é o réu: quando o KIT perguntar Réu, oriente a pessoa a escrever o nome do banco informado na triagem.',
    'Explique com clareza que os honorários contratuais são de 40% do valor obtido ao final.',
  ],
  closing: 'Quando a triagem terminar sem corte, NÃO transfira imediatamente. Primeiro registre '
    + 'ação=solicitar_documentos() com os documentos essenciais da rota de residência escolhida e '
    + 'o print do bloqueio ou encerramento. Antes de dizer que chegou, use ação=consultar_documentos().\n'
    + 'Se a residência for em imóvel de terceiro sem comprovante aceito nem contrato, colete documento '
    + 'do declarante. Diga que a declaração pode ser escrita numa folha, assinada e enviada por foto. '
    + 'Depois dos documentos desta rota, transfira para ação=transferir({{destino_declaracao_residencia}}) '
    + 'preparar a declaração; não envie o KIT automaticamente nessa rota.\n'
    + 'Nas demais rotas, somente quando TODOS os documentos essenciais estiverem aprovados, envie '
    + 'ação=enviar_documento({{modelo_kit_consumidor}}). Na mensagem, explique que no campo Réu deve '
    + 'colocar o nome do banco. O acompanhamento do preenchimento e da assinatura é automático.\n'
    + 'Nunca confie apenas em “assinei”: confirme por ação=consultar_assinatura(). Somente quando o '
    + 'sistema retornar assinado, avise que recebeu e faça ação=transferir({{destino_pos_assinatura}}) '
    + 'com resumo dos fatos, saldo retido, documentos e honorários aceitos.',
  fields: [
    {
      key: 'nome', label: 'Nome', type: 'texto', required: true, ask: 'o nome do cliente',
      question: 'Para começar, qual é o seu nome?',
    },
    {
      key: 'banco_reu', label: 'Banco (réu)', type: 'texto', required: true,
      ask: 'o nome do banco que bloqueou ou encerrou a conta',
      question: 'Qual é o nome do banco que bloqueou ou encerrou sua conta?',
    },
    {
      key: 'tipo_ocorrencia', label: 'O que aconteceu', type: 'enum',
      options: ['bloqueio', 'encerramento'], required: true,
      ask: 'se a conta foi bloqueada ou encerrada',
      question: 'A conta foi bloqueada ou foi encerrada de vez?',
    },
    {
      key: 'data_ocorrencia', label: 'Data do problema', type: 'data_mes_ano', required: true,
      ask: 'mês e ano do bloqueio ou encerramento',
      question: 'Em que mês e ano isso aconteceu?',
    },
    {
      key: 'aviso_previo', label: 'Recebeu aviso prévio', type: 'bool', required: true,
      ask: 'se o banco avisou antes que bloquearia ou encerraria a conta',
      question: 'Antes disso acontecer, o banco avisou que bloquearia ou encerraria a conta?',
    },
    {
      key: 'tem_print', label: 'Tem print do problema', type: 'bool', required: true,
      ask: 'se tem print, e-mail ou tela mostrando o bloqueio ou encerramento',
      question: 'Você tem algum print, e-mail ou tela do aplicativo mostrando o bloqueio ou encerramento?',
    },
    {
      key: 'saldo_retido', label: 'Tem saldo retido', type: 'bool', required: true,
      ask: 'se ficou dinheiro preso na conta',
      question: 'Ficou algum dinheiro ou saldo preso nessa conta?',
    },
    {
      key: 'valor_saldo', label: 'Valor retido', type: 'texto', required: true,
      ask: 'o valor aproximado que ficou retido',
      question: 'Mais ou menos quanto ficou preso na conta?',
      onlyWhen: { field: 'saldo_retido', value: 'sim' },
    },
    {
      key: 'residencia_tipo', label: 'Comprovante de residência', type: 'enum',
      options: ['proprio', 'familiar', 'aluguel_com_contrato', 'terceiro_sem_contrato'], required: true,
      ask: 'qual documento consegue usar para comprovar a residência',
      question: 'O comprovante de residência está no seu nome, no nome de esposa, esposo, pai ou mãe, você tem contrato de aluguel, ou não tem nenhum desses?',
    },
    {
      key: 'titular_comprovante', label: 'Titular do comprovante', type: 'texto', required: true,
      ask: 'o nome e o parentesco de quem aparece no comprovante',
      question: 'Qual é o nome dessa pessoa e qual é o parentesco dela com você?',
      onlyWhen: { field: 'residencia_tipo', value: 'familiar' },
    },
    {
      key: 'declarante_nome', label: 'Nome do declarante', type: 'texto', required: true,
      ask: 'o nome completo da pessoa que declarará a residência',
      question: 'Qual é o nome completo da pessoa que pode declarar que você mora nesse endereço?',
      onlyWhen: { field: 'residencia_tipo', value: 'terceiro_sem_contrato' },
    },
    {
      key: 'endereco_residencia', label: 'Endereço completo', type: 'texto', required: true,
      ask: 'o endereço completo para a declaração de residência',
      question: 'Qual é o endereço completo, com rua, número, bairro, cidade e CEP?',
      onlyWhen: { field: 'residencia_tipo', value: 'terceiro_sem_contrato' },
    },
    {
      key: 'declarante_tem_documento', label: 'Documento do declarante', type: 'bool', required: true,
      ask: 'se o declarante consegue enviar foto do documento de identificação',
      question: 'Essa pessoa consegue mandar uma foto do documento de identificação dela?',
      onlyWhen: { field: 'residencia_tipo', value: 'terceiro_sem_contrato' },
    },
    {
      key: 'aceita_honorarios', label: 'Aceitou honorários de 40%', type: 'bool', required: true,
      ask: 'se entendeu e concorda com os honorários de 40% do valor obtido ao final',
      question: 'Os honorários do escritório são de 40% do valor obtido ao final. Você entendeu e está de acordo?',
    },
  ],
  stages: [
    { id: 'identificacao', label: 'Cliente e banco', fields: ['nome', 'banco_reu'] },
    { id: 'ocorrencia', label: 'Bloqueio ou encerramento', fields: ['tipo_ocorrencia', 'data_ocorrencia', 'aviso_previo', 'tem_print'] },
    { id: 'saldo', label: 'Saldo retido', fields: ['saldo_retido', 'valor_saldo'] },
    { id: 'residencia', label: 'Documento de residência', fields: ['residencia_tipo', 'titular_comprovante', 'declarante_nome', 'endereco_residencia', 'declarante_tem_documento'] },
    { id: 'honorarios', label: 'Honorários', fields: ['aceita_honorarios'] },
  ],
  cuts: [
    {
      id: 'prazo_2_anos_conta',
      rule: { kind: 'older_than', field: 'data_ocorrencia', years: 2 },
      effect: 'disqualify',
      reason: 'bloqueio ou encerramento ocorreu fora da janela de dois anos',
      guidance: 'Pare a triagem, não peça documentos e não dê opinião jurídica. Explique apenas '
        + 'que, pela data informada, o caso ficou fora do período atendido pelo escritório.',
    },
    {
      id: 'houve_aviso_previo',
      rule: { kind: 'field_equals', field: 'aviso_previo', values: ['sim'] },
      effect: 'disqualify',
      reason: 'o banco informou previamente o bloqueio ou encerramento',
      guidance: 'Pare a triagem. Explique sem parecer jurídico que esta campanha atende situações '
        + 'sem aviso prévio e que o relato ficou fora dos critérios desta triagem.',
    },
    {
      id: 'sem_print_conta',
      rule: { kind: 'field_equals', field: 'tem_print', values: ['não'] },
      effect: 'disqualify',
      reason: 'não possui prova visual do bloqueio ou encerramento',
      guidance: 'Explique que o print, e-mail ou tela do aplicativo é documento essencial. Oriente '
        + 'a pessoa a obter essa imagem e voltar ao atendimento; não peça documentos pessoais agora.',
    },
    {
      id: 'declarante_sem_documento',
      rule: { kind: 'field_equals', field: 'declarante_tem_documento', values: ['não'] },
      effect: 'disqualify',
      reason: 'declarante não consegue fornecer documento de identificação',
      guidance: 'Explique que o documento do declarante é essencial para preparar a declaração e '
        + 'oriente a pessoa a retornar quando conseguir a foto do documento.',
    },
    {
      id: 'honorarios_nao_aceitos',
      rule: { kind: 'field_equals', field: 'aceita_honorarios', values: ['não'] },
      effect: 'disqualify',
      reason: 'não concordou com os honorários contratuais informados',
      guidance: 'Respeite a decisão, não tente pressionar e encerre de forma educada. Não peça documentos.',
    },
  ],
};

// ── Texto ───────────────────────────────────────────────────────────────────

/** Sem acento e em minúsculas: é a forma em que as comparações abaixo casam. */
function simples(text: unknown): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function chaveNormalizada(key: unknown): string {
  return simples(key)
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, WA_AI_PLAYBOOK_KEY_MAX_CHARS);
}

function textoAparado(value: unknown, max = WA_AI_PLAYBOOK_TEXT_MAX_CHARS): string {
  const t = String(value ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Igual ao anterior, mas PRESERVANDO as quebras de linha.
 *
 * A abertura da campanha são duas mensagens — saudação, linha em branco,
 * pergunta —, e é a linha em branco que `splitWaAiReply` lê para mandar as duas
 * separadas. Colapsar espaço em branco aqui transformaria a abertura numa bolha
 * só, calada, sem ninguém notar até ver a conversa do cliente.
 */
function textoLongo(value: unknown, max: number): string {
  const t = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(linha => linha.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── Datas ───────────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4,
  mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8,
  set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11,
  dez: 12, dezembro: 12,
};

// Os nomes longos vêm antes na alternância: senão `jan` casa e `janeiro` fica
// com o "eiro" sobrando, e o `$` do fim reprova a data inteira.
const NOMES_DE_MES = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');

/**
 * O que conta como mês e ano.
 *
 * Aceitar só `MM/AAAA` seria mais limpo e estaria errado: o schema pede esse
 * formato, mas o modelo devolve "Janeiro de 2020" quando o cliente escreve
 * assim, e um campo de data que não reconhece o próprio valor fica pendente
 * para sempre — o agente perguntaria a mesma coisa a cada turno, que é o
 * defeito que este arquivo existe para acabar.
 */
const RE_MES_ANO = new RegExp(
  '^(?:'
  + '(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})'      // 05/01/2020
  + '|(\\d{1,2})[\\/.-](\\d{4})'                        // 01/2020
  + `|(${NOMES_DE_MES})(?:\\s+de)?[\\s\\/.-]+(\\d{4})`     // janeiro de 2020
  + ')$');

interface MesAno { mes: number; ano: number }

function lerMesAno(valor: unknown): MesAno | null {
  const m = RE_MES_ANO.exec(simples(valor));
  if (!m) return null;
  const mes = m[3] ? Number(m[2]) : (m[5] ? Number(m[4]) : MESES[m[6]]);
  const ano = Number(m[3] || m[5] || m[7]);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) return null;
  return { mes, ano };
}

/** O dia no fuso do escritório, não no do servidor (que roda em UTC). */
function hojeNoFuso(agora: Date, timeZone: string): { ano: number; mes: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
  const [ano, mes] = partes.split('-').map(Number);
  return { ano, mes };
}

/**
 * O mês inteiro conta A FAVOR do cliente.
 *
 * É a mesma regra que já está escrita no prompt e que o modelo aplicou errado:
 * quem diz "agosto de 2024" com a data de corte em 12/08/2024 está DENTRO da
 * janela, porque parte daquele mês ainda está dentro. Só fica de fora o mês que
 * terminou por inteiro antes do corte — daí a comparação ser estrita e por
 * (ano, mês), sem dia nenhum no meio.
 */
function maisVelhoQue(valor: string, anos: number, agora: Date, timeZone: string): boolean {
  const data = lerMesAno(valor);
  if (!data) return false;
  const hoje = hojeNoFuso(agora, timeZone);
  const corte = { ano: hoje.ano - anos, mes: hoje.mes };
  return data.ano < corte.ano || (data.ano === corte.ano && data.mes < corte.mes);
}

// ── Valores ─────────────────────────────────────────────────────────────────

const SIM = /^(sim|s|isso|isso mesmo|exato|exatamente|correto|certo|positivo|verdade|true|ativo|continuo|ainda)\b/;
const NAO = /^(nao|n|negativo|false|ja sai|sai|saiu|encerrado|inativo|nunca)\b/;

/**
 * O valor na forma que o tipo do campo exige.
 *
 * Devolve vazio quando o valor NÃO SERVE para o campo: enum fora das opções,
 * data que não é mês e ano, bool que não é sim nem não. Vazio quer dizer "ainda
 * não foi respondido", então o campo volta para a fila e a pergunta é refeita.
 * É de propósito: perguntar de novo custa uma mensagem, mas um "prefeitura"
 * guardado num campo que só entende `publico` deixaria o corte de órgão público
 * sem disparar, calado, com a triagem seguindo em frente.
 */
export function normalizeWaAiPlaybookValue(field: WaAiPlaybookField, value: unknown): string {
  const bruto = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!bruto) return WA_AI_VAZIO;

  if (field.type === 'data_mes_ano') {
    const data = lerMesAno(bruto);
    return data ? `${String(data.mes).padStart(2, '0')}/${data.ano}` : WA_AI_VAZIO;
  }

  if (field.type === 'bool') {
    const s = simples(bruto);
    if (NAO.test(s)) return 'não';
    if (SIM.test(s)) return 'sim';
    return WA_AI_VAZIO;
  }

  if (field.type === 'enum') {
    const s = simples(bruto);
    const achada = (field.options || []).find(opt => simples(opt) === s);
    return achada || WA_AI_VAZIO;
  }

  return bruto;
}

/** Valor tipado que pode ser persistido em `known_facts`. Null = inválido/vazio. */
export function normalizeWaAiPlaybookFactValue(
  field: WaAiPlaybookField, value: unknown,
): WaAiFactValue | null {
  if (value === null || value === undefined || value === '') return null;

  if (field.type === 'bool') {
    if (typeof value === 'boolean') return value;
    const normalizado = normalizeWaAiPlaybookValue(field, value);
    if (normalizado === 'sim') return true;
    if (normalizado === 'não') return false;
    return null;
  }

  if (field.type === 'numero') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const bruto = String(value).trim().replace(/\s/g, '');
    if (!bruto) return null;
    const decimal = bruto.includes(',')
      ? bruto.replace(/\./g, '').replace(',', '.')
      : bruto;
    const numero = Number(decimal);
    return Number.isFinite(numero) ? numero : null;
  }

  if (field.type === 'hora') {
    const match = /^(\d{1,2})(?::|h)(\d{2})$/.exec(String(value).trim().toLowerCase());
    if (!match) return null;
    const hora = Number(match[1]);
    const minuto = Number(match[2]);
    if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
    return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
  }

  const normalizado = normalizeWaAiPlaybookValue(field, value);
  return normalizado || null;
}

// ── Leitura do roteiro ──────────────────────────────────────────────────────

export function waAiPlaybookField(playbook: WaAiPlaybook, key: string): WaAiPlaybookField | null {
  const alvo = chaveNormalizada(key);
  return playbook.fields.find(f => f.key === alvo) || null;
}

/** As chaves na ordem das etapas — é esta ordem que vira pergunta e pendência. */
export function waAiPlaybookFieldKeys(playbook: WaAiPlaybook): string[] {
  const out: string[] = [];
  for (const stage of playbook.stages) {
    for (const key of stage.fields) {
      if (out.indexOf(key) === -1 && waAiPlaybookField(playbook, key)) out.push(key);
    }
  }
  // Campo declarado e esquecido em toda etapa continua existindo para o schema:
  // fora do schema, ele volta a ser uma chave inventada pelo modelo.
  for (const field of playbook.fields) {
    if (out.indexOf(field.key) === -1) out.push(field.key);
  }
  return out;
}

/** O campo está em jogo neste momento? (`saida` só existe para quem já saiu.) */
function campoVale(playbook: WaAiPlaybook, field: WaAiPlaybookField, facts: Record<string, unknown>): boolean {
  if (!field.onlyWhen) return true;
  const dono = waAiPlaybookField(playbook, field.onlyWhen.field);
  if (!dono) return true;
  const atual = normalizeWaAiPlaybookValue(dono, facts[dono.key]);
  return atual !== WA_AI_VAZIO && simples(atual) === simples(field.onlyWhen.value);
}

/** O valor guardado, já validado contra o tipo. Vazio = não respondido. */
function valorDoCampo(field: WaAiPlaybookField, facts: Record<string, unknown>): string {
  return normalizeWaAiPlaybookValue(field, facts[field.key]);
}

// ── Cortes ──────────────────────────────────────────────────────────────────

export interface WaAiTriageCut {
  id: string;
  effect: 'disqualify' | 'handoff';
  reason: string;
  guidance: string;
}

/**
 * O primeiro corte que dispara, ou nada.
 *
 * A ordem é a do roteiro: `orgao_publico` antes de `prazo_2_anos` porque é a
 * ordem em que as perguntas acontecem, e porque um caso de órgão público vai
 * para gente mesmo tendo saído ontem.
 *
 * Uma regra só dispara com o dado presente e VÁLIDO. Campo vazio nunca corta —
 * quem ainda não respondeu não pode ser descartado por causa da resposta que
 * não deu.
 */
export function evaluateWaAiCuts(
  playbook: WaAiPlaybook,
  facts: Record<string, unknown>,
  agora: Date,
  timeZone: string,
): WaAiTriageCut | null {
  for (const cut of playbook.cuts) {
    if (!disparou(playbook, cut.rule, facts, agora, timeZone)) continue;
    return { id: cut.id, effect: cut.effect, reason: cut.reason, guidance: cut.guidance };
  }
  return null;
}

function disparou(
  playbook: WaAiPlaybook,
  rule: WaAiCutRule,
  facts: Record<string, unknown>,
  agora: Date,
  timeZone: string,
): boolean {
  if (rule.kind === 'field_equals') {
    const field = waAiPlaybookField(playbook, rule.field);
    if (!field || !campoVale(playbook, field, facts)) return false;
    const valor = valorDoCampo(field, facts);
    if (!valor) return false;
    return rule.values.some(v => simples(v) === simples(valor));
  }

  if (rule.kind === 'older_than') {
    const field = waAiPlaybookField(playbook, rule.field);
    if (!field || field.type !== 'data_mes_ano' || !campoVale(playbook, field, facts)) return false;
    const valor = valorDoCampo(field, facts);
    if (!valor) return false;
    return maisVelhoQue(valor, rule.years, agora, timeZone);
  }

  // Todos, e não qualquer um: "sem prova OU sem testemunha" descartaria metade
  // dos casos bons — basta uma das duas para o requisito ficar de pé.
  const campos = rule.fields
    .map(k => waAiPlaybookField(playbook, k))
    .filter((f): f is WaAiPlaybookField => !!f);
  if (campos.length === 0 || campos.length !== rule.fields.length) return false;
  return campos.every(f => {
    if (!campoVale(playbook, f, facts)) return false;
    const valor = valorDoCampo(f, facts);
    return valor !== WA_AI_VAZIO && simples(valor) === simples(rule.value);
  });
}

// ── Progresso ───────────────────────────────────────────────────────────────

export interface WaAiTriageProgress {
  /** A etapa em que a conversa está. Null quando não há mais o que perguntar. */
  stage: string | null;
  stageLabel: string | null;
  /** As chaves obrigatórias ainda vazias, na ordem do roteiro. */
  missing: string[];
  /** As mesmas, já no texto que vira a lista de espera e a retomada. */
  pending: string[];
  /** A próxima chave a perguntar — uma só. */
  nextField: string | null;
  /** O veredito. Quando existe, não há mais pergunta a fazer. */
  cut: WaAiTriageCut | null;
  /** Todos os campos obrigatórios em jogo estão preenchidos e nenhum corte disparou. */
  complete: boolean;
}

export type WaAiTriageNextAction =
  | { type: 'ask_field'; field: string; question: string }
  | { type: 'handoff'; cutId: string; reason: string; guidance: string }
  | { type: 'disqualify'; cutId: string; reason: string; guidance: string }
  | { type: 'complete'; guidance: string }
  | { type: 'none'; reason: string };

/** A próxima ação é projeção do estado; o modelo nunca a escolhe. */
export function computeWaAiTriageNextAction(
  playbook: WaAiPlaybook, progress: WaAiTriageProgress,
): WaAiTriageNextAction {
  if (progress.cut) {
    return {
      type: progress.cut.effect === 'handoff' ? 'handoff' : 'disqualify',
      cutId: progress.cut.id,
      reason: progress.cut.reason,
      guidance: progress.cut.guidance,
    };
  }
  if (progress.complete) {
    return { type: 'complete', guidance: String(playbook.closing || '').trim() };
  }
  if (progress.nextField) {
    const field = waAiPlaybookField(playbook, progress.nextField);
    if (field) {
      return {
        type: 'ask_field', field: field.key,
        question: String(field.question || field.ask || field.label).trim(),
      };
    }
  }
  return { type: 'none', reason: 'roteiro sem próxima ação válida' };
}

/**
 * Onde a triagem está — calculado, nunca perguntado ao modelo.
 *
 * Quando um corte dispara, a lista de pendências fica VAZIA de propósito: é ela
 * que o acompanhamento lê para escrever a retomada, e cobrar o horário de
 * trabalho de quem acabou de ser dispensado pelo prazo seria a pior mensagem
 * que este agente poderia mandar.
 */
export function computeWaAiTriageProgress(input: {
  playbook: WaAiPlaybook;
  facts: Record<string, unknown> | null | undefined;
  now?: Date;
  timeZone?: string;
}): WaAiTriageProgress {
  const playbook = input.playbook;
  const facts = input.facts || {};
  const agora = input.now instanceof Date ? input.now : new Date();
  const timeZone = input.timeZone || 'America/Cuiaba';

  const cut = evaluateWaAiCuts(playbook, facts, agora, timeZone);
  if (cut) {
    return {
      stage: null, stageLabel: null, missing: [], pending: [], nextField: null, cut, complete: false,
    };
  }

  const missing: string[] = [];
  const pending: string[] = [];
  let stage: WaAiPlaybookStage | null = null;

  for (const etapa of playbook.stages) {
    for (const key of etapa.fields) {
      const field = waAiPlaybookField(playbook, key);
      if (!field || !field.required) continue;
      if (!campoVale(playbook, field, facts)) continue;
      if (valorDoCampo(field, facts)) continue;
      if (!stage) stage = etapa;
      missing.push(field.key);
      if (pending.indexOf(field.ask) === -1) pending.push(field.ask);
    }
  }

  return {
    stage: stage ? stage.id : null,
    stageLabel: stage ? stage.label : null,
    missing,
    pending,
    nextField: missing.length > 0 ? missing[0] : null,
    cut: null,
    complete: missing.length === 0,
  };
}

// ── Schema do modelo ────────────────────────────────────────────────────────

export interface WaAiTriageSchema {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
}

function descricaoDoCampo(field: WaAiPlaybookField): string {
  const base = `${field.label}: ${field.ask}.`;
  if (field.type === 'data_mes_ano') return `${base} Formato MM/AAAA.`;
  if (field.onlyWhen) return `${base} Só se aplica quando ${field.onlyWhen.field} = ${field.onlyWhen.value}.`;
  return base;
}

function esquemaDoCampo(field: WaAiPlaybookField): Record<string, unknown> {
  const description = descricaoDoCampo(field);
  if (field.type === 'bool') {
    return { type: 'string', enum: [WA_AI_VAZIO, 'sim', 'não'], description };
  }
  if (field.type === 'enum') {
    return { type: 'string', enum: [WA_AI_VAZIO, ...(field.options || [])], description };
  }
  return { type: 'string', description };
}

function esquemaTipadoDoCampo(field: WaAiPlaybookField): Record<string, unknown> {
  const description = descricaoDoCampo(field);
  if (field.type === 'bool') {
    return { type: ['boolean', 'null'], description: `${description} Null significa não mencionado.` };
  }
  if (field.type === 'numero') {
    return { type: ['number', 'null'], description: `${description} Null significa não mencionado.` };
  }
  if (field.type === 'enum') {
    return {
      anyOf: [{ type: 'string', enum: field.options || [] }, { type: 'null' }],
      description: `${description} Null significa não mencionado.`,
    };
  }
  return { type: ['string', 'null'], description: `${description} Null significa não mencionado.` };
}

/**
 * Contrato da PRIMEIRA fase: ler a fala atual e produzir somente um patch.
 * As propriedades nascem dos campos declarados no editor; não há lista de
 * campos hardcoded no agente.
 */
export function buildWaAiTriageExtractionSchema(playbook: WaAiPlaybook): WaAiTriageSchema {
  const keys = waAiPlaybookFieldKeys(playbook);
  const properties: Record<string, unknown> = {};
  for (const key of keys) {
    const field = waAiPlaybookField(playbook, key);
    if (field) properties[key] = esquemaTipadoDoCampo(field);
  }

  return {
    name: 'extracao_triagem',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['atualizacoes', 'remover_campos', 'ambiguidades'],
      properties: {
        atualizacoes: {
          type: 'object', additionalProperties: false,
          required: keys, properties,
          description: 'Tudo o que o cliente informou nesta fala. Null significa não mencionado.',
        },
        remover_campos: {
          type: 'array', items: { type: 'string', enum: keys },
          description: 'Campos antigos explicitamente corrigidos ou invalidados pela fala atual.',
        },
        ambiguidades: {
          type: 'array', items: { type: 'string' },
          description: 'Informações vagas que não podem ser salvas sem esclarecimento.',
        },
      },
    },
  };
}

/** Contrato da SEGUNDA fase: o estado já foi decidido; resta escrever. */
export function buildWaAiTriageConversationSchema(playbook: WaAiPlaybook): WaAiTriageSchema {
  const keys = waAiPlaybookFieldKeys(playbook);
  return {
    name: 'resposta_triagem',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['mensagem_cliente', 'campo_alvo'],
      properties: {
        mensagem_cliente: {
          type: 'string',
          description: 'Mensagem curta e natural em português do Brasil, com no máximo uma pergunta.',
        },
        campo_alvo: {
          type: 'string', enum: [WA_AI_VAZIO, ...keys],
          description: 'Campo determinado pelo sistema que a mensagem pergunta; vazio sem pergunta.',
        },
      },
    },
  };
}

/**
 * O contrato de resposta — `response_format: {type:'json_schema', strict:true}`.
 *
 * Ferramenta é OPCIONAL para o modelo; formato de resposta não é. Esta é a
 * diferença que motivou o arquivo inteiro: `registrar_memoria` foi chamada duas
 * vezes numa conversa de trinta turnos, e o que ela não trouxe simplesmente não
 * existiu.
 *
 * DUAS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. `atualizacoes` tem PROPRIEDADES FIXAS, uma por campo do roteiro, e
 *    `additionalProperties: false`. O modo estrito exige que todas as chaves
 *    estejam em `required`, e é exatamente esse rigor que se quer: `empresa`,
 *    `data_inicio` e `nome_do_cliente` deixam de ser escrevíveis. A deriva de
 *    nomes morre na origem, em vez de ser remendada por apelido depois.
 *
 * 2. Nada é nulo. Ausência é STRING VAZIA. O modo estrito exigiria declarar
 *    `type: ['string','null']` em todo campo opcional, e um `enum` com `null`
 *    dentro é o tipo de detalhe que faz o provedor devolver 400 — o que, aqui,
 *    seria a IA muda no atendimento inteiro. Vazio já é o que o resto do
 *    sistema entende por "não informado": `canonicalizeWaAiFacts` nunca grava
 *    vazio, então um campo que o cliente não respondeu não tem como apagar o
 *    que ele respondeu antes.
 */
export function buildWaAiTriageSchema(playbook: WaAiPlaybook): WaAiTriageSchema {
  const keys = waAiPlaybookFieldKeys(playbook);
  const properties: Record<string, unknown> = {};
  for (const key of keys) {
    const field = waAiPlaybookField(playbook, key);
    if (field) properties[key] = esquemaDoCampo(field);
  }

  return {
    name: 'triagem',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mensagem_cliente', 'campo_alvo', 'atualizacoes'],
      properties: {
        mensagem_cliente: {
          type: 'string',
          description: 'O que enviar ao cliente agora, em português do Brasil, curto como mensagem '
            + 'de WhatsApp e com no máximo uma pergunta. É o único texto que ele vai ler.',
        },
        campo_alvo: {
          type: 'string',
          enum: [WA_AI_VAZIO, ...keys],
          description: 'A informação que a sua pergunta está buscando agora. Vazio quando você não '
            + 'está perguntando nada.',
        },
        atualizacoes: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(properties),
          properties,
          description: 'O que o cliente informou. Preencha APENAS o que ele disse, com as palavras '
            + 'dele; deixe vazio todo campo que ele ainda não respondeu. Nunca deduza e nunca repita '
            + 'aqui um dado que você mesmo supôs.',
        },
      },
    },
  };
}

// ── Bloco de prompt ─────────────────────────────────────────────────────────

/**
 * O roteiro escrito para o modelo — estado, não cálculo.
 *
 * Ele recebe onde a conversa está e o que falta, já decidido. Quando um corte
 * disparou, recebe a ordem do corte e mais nada: é o mesmo princípio de
 * `waAiDateBlock`, que só conseguiu segurar a janela dos dois anos quando parou
 * de pedir a conta e passou a entregar o resultado.
 */
export function waAiPlaybookPromptBlock(
  playbook: WaAiPlaybook, progress: WaAiTriageProgress,
): string {
  const linhas: string[] = ['# Roteiro da triagem'];

  if (progress.cut) {
    linhas.push(
      `Este atendimento JÁ FOI ENCERRADO pelo sistema: ${progress.cut.reason}.`,
      progress.cut.guidance,
      'Não faça mais nenhuma pergunta da triagem e não volte atrás nesta decisão.',
    );
    return linhas.join('\n');
  }

  if (progress.complete) {
    linhas.push('Todas as informações do roteiro já foram coletadas. Siga para o fechamento previsto '
      + 'nas suas instruções.');
    return linhas.join('\n');
  }

  if (progress.stageLabel) linhas.push(`Etapa atual: ${progress.stageLabel}.`);
  linhas.push('Ainda falta descobrir, nesta ordem:');
  for (const item of progress.pending) linhas.push(`- ${item}`);
  linhas.push('Pergunte apenas o primeiro item da lista. Os demais ficam para as próximas mensagens, '
    + 'e o que o cliente já respondeu não aparece aqui — não torne a perguntar.');

  // A frase exata, quando o roteiro traz uma. Entregar a pergunta pronta é
  // diferente de listar exemplos e torcer para o modelo achar o certo: ele erra
  // menos quando não precisa escolher.
  const proximo = progress.nextField ? waAiPlaybookField(playbook, progress.nextField) : null;
  if (proximo?.question) {
    linhas.push('', 'A pergunta desta vez é esta, e ela já está escrita do jeito que o cliente entende. '
      + 'Use estas palavras, mudando só o necessário para encaixar no que ele acabou de dizer:',
      `"${proximo.question}"`);
  }

  return linhas.join('\n');
}

/**
 * O "o que este agente deve fazer", MONTADO a partir do roteiro.
 *
 * Antes disto, a mesma coisa estava escrita nos dois lugares: o roteiro sabia
 * que o próximo campo era `tipo_empregador`, e a frase para perguntá-lo vivia
 * numa lista de exemplos, em prosa, longe do campo. Duas fontes para o mesmo
 * dado é o mesmo problema de `empresa` e `empregador` — só que na configuração
 * em vez de na memória.
 *
 * O que continua no texto livre do agente: tudo o que não é do roteiro —
 * transferência para humano, acompanhamento, continuidade da conversa. E as
 * expressões `ação=`, que o backend compila a partir dos textos.
 */
export function waAiPlaybookInstructions(playbook: WaAiPlaybook): string {
  const partes: string[] = [];

  if (playbook.context && Object.keys(playbook.context).length > 0) {
    partes.push(
      '# Contexto estruturado do agente\n'
      + 'Estas regras complementam o roteiro. Elas não podem criar campos, ações ou destinos que o '
      + 'sistema não tenha declarado:\n'
      + resolveWaAiPlaybookBindings(playbook, JSON.stringify(playbook.context, null, 2)),
    );
  }

  const estilo = (playbook.style || []).map(s => String(s || '').trim()).filter(Boolean);
  if (estilo.length > 0) {
    partes.push(`# Como você conversa\n${estilo.map(s => `- ${s}`).join('\n')}`);
  }

  const abertura = String(playbook.opening || '').trim();
  if (abertura) {
    partes.push(
      '# Abertura\n'
      + 'Se esta conversa ainda não tem nenhuma mensagem sua, comece assim, aproximadamente do '
      + `mesmo tamanho:\n\n"${abertura}"\n\n`
      + 'Se você já falou alguma vez nesta conversa, a abertura já aconteceu: não a repita.');
  }

  // As perguntas de todos os campos, na ordem — o modelo vê a que precisa no
  // bloco do roteiro, mas ler a conversa inteira de antemão é o que faz uma
  // pergunta encaixar na anterior em vez de soar avulsa.
  const comPergunta = playbook.fields.filter(f => String(f.question || '').trim());
  if (comPergunta.length > 0) {
    partes.push(
      '# Como perguntar cada coisa\n'
      + 'Estas são as perguntas do roteiro, na voz do escritório. Pergunte UMA por vez, e só a que '
      + 'o roteiro indicar:\n'
      + comPergunta.map(f => `- ${f.label}: "${String(f.question).trim()}"`).join('\n'));
  }

  const fechamento = String(playbook.closing || '').trim();
  if (fechamento) {
    partes.push(`# Quando o roteiro estiver completo\n${resolveWaAiPlaybookBindings(playbook, fechamento)}`);
  }

  return partes.join('\n\n');
}

/** Substitui apenas placeholders declarados; texto desconhecido permanece visível e falha na validação. */
export function resolveWaAiPlaybookBindings(playbook: WaAiPlaybook, text: string): string {
  const byKey = new Map((playbook.bindings || []).map(binding => [binding.key, binding]));
  return String(text || '').replace(/\{\{([a-z0-9_]{1,40})\}\}/gi, (raw, key: string) => {
    const binding = byKey.get(chaveNormalizada(key));
    const label = String(binding?.targetLabel || binding?.suggestedTargetLabel || '').trim();
    return label || raw;
  });
}

// ── Leitura de um roteiro vindo de fora ─────────────────────────────────────

/**
 * Lê um roteiro escrito por gente (ou guardado no banco) e devolve só o que é
 * utilizável — ou `null`, quando não sobra roteiro nenhum.
 *
 * Nada aqui confia no formato: o roteiro vai ser digitado numa tela, e um campo
 * sem chave, uma etapa apontando para um campo que não existe ou um corte com
 * regra desconhecida não podem derrubar o atendimento. O que não presta sai; o
 * que sobra funciona.
 */
export function normalizeWaAiPlaybook(raw: unknown): WaAiPlaybook | null {
  const original = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : null;
  if (!original) return null;

  // O JSON de contexto pode ser colado sozinho. Quando ele identifica a
  // campanha conhecida, herdamos o roteiro declarativo padrão e guardamos o
  // objeto colado como contexto complementar. Assim o texto não precisa repetir
  // treze definições de campo para ativar o motor determinístico.
  const campaign = original.agent_context && typeof original.agent_context === 'object'
    ? (original.agent_context as Record<string, unknown>).campaign
    : null;
  const campaignId = campaign && typeof campaign === 'object'
    ? chaveNormalizada((campaign as Record<string, unknown>).id)
    : '';
  const semRegistroContext = campaignId === 'trabalhou_sem_registro'
    || campaignId === 'sem_registro_carteira';
  const contaContext = campaignId === 'bloqueio_encerramento_conta'
    || campaignId === 'conta_bloqueada_encerrada'
    || campaignId === 'bloqueio_ou_encerramento_de_conta';
  const contextOnly = !Array.isArray(original.fields) && (semRegistroContext || contaContext);
  let src: Record<string, unknown> = contextOnly
    ? {
        ...(contaContext ? WA_AI_PLAYBOOK_CONTA_BLOQUEADA : WA_AI_PLAYBOOK_SEM_REGISTRO),
        context: original,
      }
    : original;
  const normalizedId = chaveNormalizada(src.id);
  const isSemRegistro = normalizedId === 'sem_registro_carteira'
    || normalizedId === 'trabalhou_sem_registro';
  const isContaBloqueada = normalizedId === 'bloqueio_encerramento_conta'
    || normalizedId === 'conta_bloqueada_encerrada'
    || normalizedId === 'bloqueio_ou_encerramento_de_conta';

  // Atualiza automaticamente o roteiro estrutural antigo desta campanha. Os
  // primeiros agentes materializados tinham 14 campos, não perguntavam função
  // nem outro trabalho e deixavam pagamento/regularidade em texto livre. Sem
  // esta migração de leitura, salvar a tela nova não corrigiria o agente que já
  // está no banco. Contexto e destinos escolhidos pelo escritório permanecem.
  const rawFields = Array.isArray(src.fields) ? src.fields : [];
  const oldSemRegistro = isSemRegistro && !['funcao', 'recebia_pagamento', 'trabalho_regular']
    .every(key => rawFields.some(item => item && typeof item === 'object'
      && chaveNormalizada((item as Record<string, unknown>).key) === key));
  if (oldSemRegistro) {
    src = {
      ...src,
      closing: WA_AI_PLAYBOOK_SEM_REGISTRO.closing,
      fields: WA_AI_PLAYBOOK_SEM_REGISTRO.fields,
      stages: WA_AI_PLAYBOOK_SEM_REGISTRO.stages,
      cuts: WA_AI_PLAYBOOK_SEM_REGISTRO.cuts,
      context: src.context ?? WA_AI_CONTEXT_SEM_REGISTRO,
      bindings: src.bindings ?? WA_AI_PLAYBOOK_SEM_REGISTRO.bindings,
    };
  }
  const oldContaBloqueada = isContaBloqueada && !['banco_reu', 'data_ocorrencia', 'residencia_tipo', 'aceita_honorarios']
    .every(key => rawFields.some(item => item && typeof item === 'object'
      && chaveNormalizada((item as Record<string, unknown>).key) === key));
  if (oldContaBloqueada) {
    src = {
      ...src,
      opening: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.opening,
      style: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.style,
      closing: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.closing,
      fields: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.fields,
      stages: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.stages,
      cuts: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.cuts,
      context: src.context ?? WA_AI_CONTEXT_CONTA_BLOQUEADA,
      bindings: src.bindings ?? WA_AI_PLAYBOOK_CONTA_BLOQUEADA.bindings,
    };
  }

  const fields: WaAiPlaybookField[] = [];
  const vistos: Record<string, true> = {};

  for (const item of (Array.isArray(src.fields) ? src.fields : [])) {
    if (fields.length >= WA_AI_PLAYBOOK_MAX_FIELDS) break;
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;

    const key = chaveNormalizada(f.key);
    if (!key || vistos[key]) continue;

    const type: WaAiFieldType = f.type === 'data_mes_ano' || f.type === 'bool' || f.type === 'enum'
      || f.type === 'numero' || f.type === 'hora'
      ? f.type : 'texto';

    const options = type === 'enum'
      ? (Array.isArray(f.options) ? f.options : [])
        .map(o => textoAparado(o, WA_AI_PLAYBOOK_KEY_MAX_CHARS))
        .filter(o => o.length > 0)
        .slice(0, WA_AI_PLAYBOOK_MAX_OPTIONS)
      : undefined;
    // Enum sem opção não restringe nada e ainda quebraria o schema: vira texto.
    if (type === 'enum' && (!options || options.length === 0)) continue;

    const label = textoAparado(f.label, 60) || key;
    const ask = textoAparado(f.ask) || label;

    const cond = (f.onlyWhen && typeof f.onlyWhen === 'object') ? f.onlyWhen as Record<string, unknown> : null;
    const onlyWhen = cond && chaveNormalizada(cond.field) && textoAparado(cond.value, 60)
      ? { field: chaveNormalizada(cond.field), value: textoAparado(cond.value, 60) }
      : undefined;

    // A pergunta é a única coisa daqui que vai INTEIRA para o cliente, então
    // ela tem um teto próprio, bem maior que o dos rótulos.
    const question = textoAparado(f.question, 400);

    vistos[key] = true;
    fields.push({
      key, label, type, required: f.required !== false, ask,
      ...(question ? { question } : {}),
      ...(options ? { options } : {}),
      ...(onlyWhen ? { onlyWhen } : {}),
    });
  }

  if (fields.length === 0) return null;
  const existe = (key: string) => fields.some(f => f.key === key);

  const stages: WaAiPlaybookStage[] = [];
  for (const item of (Array.isArray(src.stages) ? src.stages : [])) {
    if (stages.length >= WA_AI_PLAYBOOK_MAX_STAGES) break;
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const id = chaveNormalizada(s.id);
    if (!id || stages.some(e => e.id === id)) continue;
    const campos = (Array.isArray(s.fields) ? s.fields : [])
      .map(chaveNormalizada)
      .filter((k, i, arr) => k && existe(k) && arr.indexOf(k) === i);
    if (campos.length === 0) continue;
    stages.push({ id, label: textoAparado(s.label, 60) || id, fields: campos });
  }

  // Sem etapa não há ordem de pergunta, e sem ordem a "próxima pergunta" seria
  // aleatória. Uma etapa única, na ordem em que os campos foram escritos, é o
  // mínimo honesto.
  if (stages.length === 0) {
    stages.push({ id: 'triagem', label: 'Triagem', fields: fields.map(f => f.key) });
  }

  const cuts: WaAiPlaybookCut[] = [];
  for (const item of (Array.isArray(src.cuts) ? src.cuts : [])) {
    if (cuts.length >= WA_AI_PLAYBOOK_MAX_CUTS) break;
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const id = chaveNormalizada(c.id);
    const rule = normalizeRule(c.rule, existe);
    if (!id || !rule || cuts.some(x => x.id === id)) continue;
    const publicOfficeCut = isSemRegistro && id === 'orgao_publico';
    cuts.push({
      id,
      rule,
      effect: publicOfficeCut ? 'disqualify' : (c.effect === 'handoff' ? 'handoff' : 'disqualify'),
      reason: publicOfficeCut
        ? 'empregador é órgão público — fora dos critérios de atendimento do escritório'
        : (textoAparado(c.reason) || id),
      // A orientação vai inteira para o prompt; aparar em 200 cortaria a ordem
      // no meio, que é justamente a parte que não pode ficar pela metade.
      guidance: publicOfficeCut
        ? 'Pare a triagem. Não diga que a pessoa tem ou não tem direito e não peça documentos. '
          + 'Explique em uma frase curta que situações de trabalho para órgão público não se enquadram '
          + 'nos critérios deste atendimento e encerre de forma educada. '
          + 'Marque STATUS: NÃO QUALIFICADO — ÓRGÃO PÚBLICO.'
        : textoAparado(c.guidance, 800),
    });
  }

  const style = (Array.isArray(src.style) ? src.style : [])
    .map(s => textoAparado(s, 300))
    .filter(s => s.length > 0)
    .slice(0, 30);

  // Abertura e fechamento vão inteiros para o prompt: aparar no meio cortaria a
  // instrução justamente onde ela diz o que fazer.
  const opening = textoLongo(src.opening, 800);
  const rawClosing = textoLongo(src.closing, 3000);
  // Agentes criados antes do editor estruturado já têm os campos e o id desta
  // campanha, mas não têm `context`. Herdar o contexto aqui faz a nova tela e
  // a Edge Function enxergarem a configuração nova imediatamente, sem exigir
  // migração de banco. No próximo salvamento ele é materializado no JSONB.
  const normalizedContext = normalizeWaAiPlaybookContext(
    src.context ?? (isSemRegistro
      ? WA_AI_CONTEXT_SEM_REGISTRO
      : (isContaBloqueada ? WA_AI_CONTEXT_CONTA_BLOQUEADA : null)),
  );
  const context = normalizedContext && isSemRegistro
    ? liftSemRegistroOperationalChoices(normalizedContext)
    : normalizedContext;
  const closing = isSemRegistro
    ? rawClosing.replace(/ação=transferir\(Atendimento\)/g,
      'ação=transferir({{destino_triagem_concluida}})')
    : rawClosing;
  const declaredBindings = normalizeWaAiPlaybookBindings(
    src.bindings ?? (isSemRegistro
      ? WA_AI_PLAYBOOK_SEM_REGISTRO.bindings
      : (isContaBloqueada ? WA_AI_PLAYBOOK_CONTA_BLOQUEADA.bindings : null)),
  ).filter(binding => !(isSemRegistro && binding.key === 'destino_orgao_publico'));
  const bindings = discoverWaAiPlaybookBindings(
    `${context ? JSON.stringify(context) : ''}\n${closing}`,
    declaredBindings,
  );

  return {
    id: chaveNormalizada(src.id) || 'roteiro',
    label: textoAparado(src.label, 80) || 'Triagem',
    ...(opening ? { opening } : {}),
    ...(style.length > 0 ? { style } : {}),
    ...(closing ? { closing } : {}),
    ...(context ? { context } : {}),
    ...(bindings.length > 0 ? { bindings } : {}),
    fields, stages, cuts,
  };
}

/** Remove escolhas antigas do JSON comportamental e deixa só a chave configurável. */
function liftSemRegistroOperationalChoices(context: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(context)) as Record<string, any>;
  const requiredAction = clone?.triage_closure?.post_closure_insistence?.required_action;
  if (requiredAction && typeof requiredAction === 'object') {
    delete requiredAction.target;
    requiredAction.configuration_key = 'destino_revisao_prazo';
    requiredAction.exact_action = 'ação=transferir({{destino_revisao_prazo}})';
  }
  const catalog = clone?.action_catalog?.transferir_especifico;
  if (catalog && typeof catalog === 'object') {
    delete catalog.target;
    catalog.configuration_key = 'destino_revisao_prazo';
    catalog.syntax = 'ação=transferir({{destino_revisao_prazo}})';
  }
  return clone;
}

function normalizeWaAiPlaybookBindings(raw: unknown): WaAiPlaybookBinding[] {
  if (!Array.isArray(raw)) return [];
  const result: WaAiPlaybookBinding[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const key = chaveNormalizada(source.key);
    const action = chaveNormalizada(source.action);
    if (!key || !action || result.some(binding => binding.key === key)) continue;
    const targetType = source.targetType === 'user' || source.targetType === 'department'
      || source.targetType === 'document_template' ? source.targetType : undefined;
    const triggerRaw = source.trigger && typeof source.trigger === 'object'
      ? source.trigger as Record<string, unknown> : null;
    const cutId = triggerRaw?.type === 'cut_handoff' ? chaveNormalizada(triggerRaw.cutId) : '';
    result.push({
      key,
      label: textoAparado(source.label, 100) || key,
      ...(textoAparado(source.description, 240) ? { description: textoAparado(source.description, 240) } : {}),
      action,
      required: source.required !== false,
      ...(targetType ? { targetType } : {}),
      ...(textoAparado(source.targetId, 120) ? { targetId: textoAparado(source.targetId, 120) } : {}),
      ...(textoAparado(source.targetLabel, 120) ? { targetLabel: textoAparado(source.targetLabel, 120) } : {}),
      ...(textoAparado(source.suggestedTargetLabel, 120)
        ? { suggestedTargetLabel: textoAparado(source.suggestedTargetLabel, 120) } : {}),
      ...(cutId ? { trigger: { type: 'cut_handoff' as const, cutId } } : {}),
    });
  }
  return result;
}

/**
 * Qualquer `ação=alias({{chave}})` ganha automaticamente um seletor. Assim um
 * novo template ou destino não exige alterar o componente — basta declarar o
 * placeholder no roteiro.
 */
function discoverWaAiPlaybookBindings(
  text: string, declared: WaAiPlaybookBinding[],
): WaAiPlaybookBinding[] {
  const result = declared.slice();
  const aliases: Record<string, string> = {
    transferir: 'transferir_atendimento',
    transferir_atendimento: 'transferir_atendimento',
    enviar_documento: 'enviar_documento',
  };
  const pattern = /ação=([a-z0-9_]+)\(\{\{([a-z0-9_]{1,40})\}\}\)/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    const key = chaveNormalizada(match[2]);
    if (!key || result.some(binding => binding.key === key)) continue;
    const words = key.replace(/_/g, ' ');
    result.push({
      key,
      label: words.charAt(0).toUpperCase() + words.slice(1),
      description: `Escolha usada quando o roteiro executar ação=${match[1]}.`,
      action: aliases[chaveNormalizada(match[1])] || chaveNormalizada(match[1]),
      required: true,
    });
  }
  return result.slice(0, 20);
}

function normalizeWaAiPlaybookContext(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    const text = JSON.stringify(raw);
    if (!text || text.length > WA_AI_PLAYBOOK_CONTEXT_MAX_CHARS) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeRule(raw: unknown, existe: (key: string) => boolean): WaAiCutRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (r.kind === 'field_equals') {
    const field = chaveNormalizada(r.field);
    const values = (Array.isArray(r.values) ? r.values : [])
      .map(v => textoAparado(v, 60)).filter(v => v.length > 0);
    if (!field || !existe(field) || values.length === 0) return null;
    return { kind: 'field_equals', field, values };
  }

  if (r.kind === 'older_than') {
    const field = chaveNormalizada(r.field);
    const years = Number(r.years);
    if (!field || !existe(field) || !Number.isFinite(years) || years <= 0 || years > 50) return null;
    return { kind: 'older_than', field, years };
  }

  if (r.kind === 'all_equal') {
    const fields = (Array.isArray(r.fields) ? r.fields : [])
      .map(chaveNormalizada).filter((k, i, arr) => k && existe(k) && arr.indexOf(k) === i);
    const value = textoAparado(r.value, 60);
    if (fields.length === 0 || !value) return null;
    return { kind: 'all_equal', fields, value };
  }

  return null;
}
