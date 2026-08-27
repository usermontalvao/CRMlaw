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
      "falta_de_prova_e_testemunha",
      "honorarios_nao_aceitos"
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

/**
 * Um campo só é perguntado quando a condição vale (saída, se já saiu).
 *
 * `value` aceita LISTA porque rotas diferentes desembocam no mesmo documento:
 * quem mora com companheiro e quem mora em imóvel de terceiro precisam, os
 * dois, da declaração de residência — e do mesmo declarante.
 */
export interface WaAiFieldCondition {
  field: string;
  value: string | string[];
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
  /**
   * A frase que vai AO CLIENTE quando este corte fecha a conversa.
   *
   * Existe porque a reserva do backend é uma só para todos os roteiros, e ela
   * não pode dizer a coisa certa em todos: "precisa de uma análise específica"
   * serve a um corte e mente em outro. Vazio mantém a reserva de antes.
   */
  reply?: string;
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
   * A frase que vai AO CLIENTE no fechamento, quando o modelo não escreve a
   * dele (é o que acontece sempre que o backend executa uma ação terminal: o
   * texto do modelo foi redigido antes de ele saber o que aconteceu).
   *
   * `closing` instrui o MODELO; esta instrui o backend sobre o que dizer. Vazio
   * mantém a reserva genérica que já existia.
   */
  closingReply?: string;
  /**
   * Regras estruturadas complementares coladas no editor. Elas orientam
   * continuidade, follow-up, handoff e limites; campos, ordem e cortes continuam
   * nas propriedades declarativas abaixo, que o backend consegue conferir.
   */
  context?: Record<string, unknown>;
  /** Pessoas, setores e modelos escolhidos pela tela — nunca pelo texto JSON. */
  bindings?: WaAiPlaybookBinding[];
  /**
   * Liga o acompanhamento do CARD durante a triagem: "Em triagem", "Aguardando
   * resposta", "Qualificado" e "Não qualificado" (ver `waAiFunnel.ts`).
   *
   * É opt-in, e não padrão, porque o funil é do CANAL e não do roteiro. Ligar
   * para todo mundo faria os agentes que já estão no ar começarem a mover cards
   * de outros canais — que é justamente a mudança que ninguém pediu. Os degraus
   * de documento, KIT e transferência continuam valendo sempre: esses o backend
   * já movia antes desta chave existir.
   */
  funnel?: boolean;
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
  closing: 'A qualificação terminou, as provas já foram pedidas e a pessoa concordou com os '
    + 'honorários. NÃO peça documento de identificação, CTPS Digital nem qualquer outro documento '
    + 'pessoal: quem faz isso, quando for o caso, é a equipe depois da análise. O pedido formal das '
    + 'provas é registrado pelo próprio sistema — não repita ação=solicitar_documentos() por conta '
    + 'própria.\n'
    + 'Diga em uma frase curta que vai passar o caso para a equipe analisar e que as provas podem '
    + 'ser enviadas por ali mesmo, a qualquer momento. Antes de afirmar que uma prova chegou, está '
    + 'faltando ou já foi enviada, sempre confira por ação=consultar_documentos() — nunca diga que '
    + 'recebeu algo porque lembra da conversa.\n'
    + 'No resumo escreva, em até 800 caracteres, nesta ordem e sem enfeite:\n'
    + 'Nome | Empresa | Período | Ainda trabalha | Função | Salário aprox. | Dias e horário | '
    + 'CTPS não assinada | Pessoalidade, pagamento, habitualidade e subordinação | Testemunha | '
    + 'Provas que tem | Provas recebidas | Honorários 40% aceitos | Observações | '
    + 'STATUS: LEAD QUALIFICADO\n'
    + 'Só escreva LEAD QUALIFICADO com todos estes pontos confirmados ao mesmo tempo: era a própria '
    + 'pessoa que precisava trabalhar; recebia pelo serviço; trabalhava com regularidade, e não de vez '
    + 'em quando; alguém determinava tarefas, horários ou cobrava o serviço; a carteira não foi '
    + 'assinada; existe pelo menos uma prova ou uma testemunha. Se algum ponto ficar duvidoso, faça '
    + 'uma pergunta curta para esclarecer antes de decidir — "trabalhei sem carteira" não qualifica o '
    + 'caso sozinho.',
  fields: [
    {
      key: 'nome', label: 'Nome', type: 'texto', required: true, ask: 'o seu nome',
      question: 'Para começar, qual é o seu nome?',
    },
    {
      key: 'empregador', label: 'Empregador', type: 'texto', required: true,
      ask: 'para quem você trabalhou (empresa ou pessoa)',
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
      ask: 'o mês e o ano em que você começou',
      question: 'Em que mês e ano você começou a trabalhar lá?',
    },
    {
      key: 'ainda_trabalha', label: 'Ainda trabalha lá', type: 'bool', required: true,
      ask: 'se ainda trabalha lá',
      question: 'Você ainda trabalha lá ou já saiu?',
    },
    {
      key: 'saida', label: 'Saída', type: 'data_mes_ano', required: true,
      ask: 'o mês e o ano em que você saiu',
      question: 'Em que mês e ano você saiu?',
      onlyWhen: { field: 'ainda_trabalha', value: 'não' },
    },
    {
      key: 'funcao', label: 'Função', type: 'texto', required: true,
      ask: 'o que você fazia no trabalho',
      question: 'O que você fazia nesse trabalho, no dia a dia?',
    },
    {
      key: 'pessoalidade', label: 'Tinha de ser ela', type: 'bool', required: true,
      ask: 'se era você mesma quem precisava trabalhar ou se podia mandar outra pessoa',
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
      ask: 'quais provas você tem',
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
    {
      key: 'envio_provas', label: 'Vai enviar as provas', type: 'bool', required: true,
      ask: 'se consegue enviar as provas por aqui para o advogado analisar',
      question: 'Perfeito. Você consegue me enviar essas provas por aqui mesmo, para o advogado '
        + 'analisar o seu caso?',
      onlyWhen: { field: 'tem_prova', value: 'sim' },
    },
    {
      key: 'aceita_honorarios', label: 'Aceitou honorários de 40%', type: 'bool', required: true,
      ask: 'se concorda com os honorários de 40% sobre o êxito',
      question: 'Sobre os honorários: o escritório recebe 40% sobre o êxito, ou seja, sobre o que '
        + 'você receber ao final, incluindo o FGTS e o seguro-desemprego. Você está de acordo?',
    },
  ],
  stages: [
    { id: 'identificacao', label: 'Quem é e para quem trabalhou', fields: ['nome', 'empregador', 'tipo_empregador'] },
    { id: 'periodo', label: 'Período do trabalho', fields: ['inicio', 'ainda_trabalha', 'saida'] },
    { id: 'vinculo', label: 'Como era o trabalho', fields: ['funcao', 'pessoalidade', 'recebia_pagamento', 'pagamento', 'trabalho_regular', 'habitualidade', 'subordinacao'] },
    { id: 'provas', label: 'Provas e testemunhas', fields: ['tem_prova', 'provas', 'tem_testemunha'] },
    { id: 'fechamento', label: 'Fechamento', fields: ['outros_trabalhos'] },
    { id: 'envio_das_provas', label: 'Envio das provas', fields: ['envio_provas'] },
    { id: 'honorarios', label: 'Honorários', fields: ['aceita_honorarios'] },
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
    {
      id: 'honorarios_nao_aceitos',
      rule: { kind: 'field_equals', field: 'aceita_honorarios', values: ['não'] },
      effect: 'disqualify',
      reason: 'não concordou com os honorários de 40% sobre o êxito',
      guidance: 'Respeite a decisão: não pressione, não negocie percentual e não peça documentos. '
        + 'Agradeça em uma frase, encerre com educação e diga que o escritório fica à disposição '
        + 'caso ela mude de ideia. Marque STATUS: NÃO QUALIFICADO — HONORÁRIOS NÃO ACEITOS.',
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
    starts_after: 'concordancia_com_os_honorarios',
    essential_documents: [
      'documento_de_identificacao_do_cliente',
      'prova_do_bloqueio_ou_encerramento_em_print',
      'comprovante_de_residencia_aceito_conforme_a_rota',
    ],
    requested_by: 'backend_deterministico',
    ai_must_not_request_documents: false,
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
    fees: 'Honorários contratuais de 40% somente sobre o êxito, calculados sobre o valor efetivamente recebido pelo cliente ao final.',
    timing: 'Depois de confirmar os critérios da triagem, informar a viabilidade jurídica sem prometer resultado, explicar os honorários e colher a concordância.',
    must_explain_before_acceptance: true,
    may_promise_result: false,
  },
  qualified_lead_sequence: [
    'concluir_qualificacao_do_caso',
    'informar_viabilidade_juridica_sem_prometer_resultado',
    'explicar_honorarios_de_40_por_cento_sobre_o_exito',
    'registrar_concordancia_com_os_honorarios',
    'definir_a_rota_do_comprovante_de_residencia',
    'solicitar_os_documentos_essenciais_da_rota',
    'enviar_o_kit_consumidor_quando_os_documentos_estiverem_completos',
    'transferir_somente_depois_da_assinatura_ou_pela_rota_de_declaracao',
  ],
  followup: {
    recommended_schedule: '2h, 4h, 8h, 24h, 48h, 7 dias, 10 dias e 14 dias, somente de segunda a sexta, das 08h às 18h de Cuiabá.',
    triage: 'Retomar exatamente a primeira informação ainda pendente.',
    documents: 'Usar o acompanhamento automático da solicitação de documentos; não agendar retomada para isso.',
    kit_and_signature: 'Usar os acompanhamentos automáticos do kit e da assinatura.',
    stop_when: ['cliente_responde', 'caso_desqualificado', 'assinatura_concluida', 'transferencia'],
    forbid_duplicate_generic_followup: true,
  },
  objection_handling: {
    general_rule: 'Acolher a objeção, responder com transparência em uma mensagem curta e fazer no máximo uma pergunta. Não pressionar nem discutir.',
    fees: 'Explicar que os 40% incidem somente sobre o valor efetivamente recebido ao final e que, sem êxito financeiro, não há honorários de êxito. Depois perguntar se a pessoa concorda. Só registrar recusa quando ela disser claramente que não aceita.',
    trust_or_privacy: 'Explicar para que cada informação será usada, não prometer segurança que o sistema não comprovou e oferecer atendimento humano se a pessoa continuar desconfortável.',
    time_or_result: 'Nunca prometer prazo, indenização ou vitória. Informar que a análise jurídica e os próximos passos serão confirmados pela equipe.',
    stop: 'Se a pessoa disser claramente que não quer continuar, respeitar, cancelar as retomadas e encerrar sem tentar convencê-la.',
  },
  out_of_scope_or_human_transfer: {
    rule: 'Se a pessoa trouxer outro assunto com possível relevância jurídica, não descarte e não continue forçando as perguntas de conta.',
    minimum_context: [
      'o que aconteceu',
      'quando aconteceu ou em que período',
      'quem está envolvido ou contra quem é a questão',
      'o que a pessoa precisa ou espera resolver',
    ],
    conversation: 'Colete somente esse contexto mínimo, uma pergunta por vez, sem dar parecer jurídico e sem pedir documentos.',
    transfer: 'Depois do contexto mínimo, faça ação=transferir_para_humano() com resumo e motivo. Se o assunto não tiver nenhuma relevância jurídica aparente, encerre com educação sem transferir.',
  },
  global_prohibitions: [
    'nao_dizer_que_o_cliente_vai_ganhar',
    'nao_anunciar_ao_cliente_que_a_qualificacao_ou_etapa_foi_concluida',
    'nao_inventar_nome_do_banco',
    'nao_afirmar_documento_recebido_sem_consultar_o_sistema',
    'nao_pedir_documentos_antes_da_concordancia_com_os_honorarios',
    'nao_enviar_kit_antes_dos_documentos_essenciais',
    'nao_mencionar_o_kit_ao_cliente_antes_de_o_sistema_envia_lo',
    'nao_perguntar_de_quem_e_o_comprovante_antes_de_o_arquivo_chegar',
    'nao_transferir_antes_da_assinatura_salvo_rota_de_declaracao',
  ],
  liquidated_institutions: {
    rule: 'Excluir somente por correspondência segura com a lista; nomes apenas parecidos não bastam.',
    aliases: [
      'Banco Master', 'Master', 'Master Investimentos', 'Master Múltiplo', 'Letsbank',
      'Lets Bank', 'Master Corretora', 'Will Bank', 'Will', 'Willbank', 'Banco Will',
      'Will Financeira', 'Dank', 'Dank SCD', 'CBSF', 'CBSF DTVM', 'Banco Pleno',
      'Pleno', 'Pleno DTVM', 'Advanced', 'Advanced Corretora', 'Frente',
      'Frente Corretora', 'Frente Corretora de Câmbio', 'Creditag',
    ],
  },
  action_catalog: {
    kit_consumidor: 'ação=enviar_documento({{modelo_kit_consumidor}})',
    operador_declaracao: 'ação=transferir({{destino_declaracao_residencia}})',
    destino_assinado: 'ação=transferir({{destino_pos_assinatura}})',
    outro_assunto_juridico: 'ação=transferir_para_humano()',
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
    'Nunca pergunte se o atendimento é sobre a conta ou sobre outro assunto: quem chegou aqui veio pela campanha da conta. Só mude de rota se a própria pessoa trouxer outro problema.',
    'Nunca prometa resultado, indenização ou prazo do processo.',
    'Não diga ao cliente que a qualificação, a triagem ou uma etapa foi concluída.',
    'Depois de confirmar os critérios, diga que o caso possui viabilidade jurídica para seguir com a análise, sem prometer vitória, indenização ou resultado.',
    'Na mesma etapa, explique que os honorários contratuais são de 40% sobre o êxito e peça a concordância.',
    'Ao pedir documentos, escreva UM POR LINHA, cada linha começando com "• ". Nunca emende os documentos numa frase corrida.',
    'Nunca prometa, anuncie ou cite o KIT CONSUMIDOR antes de o sistema enviá-lo. Ao pedir os documentos, fale só dos documentos.',
    'O banco é o réu: quando o KIT perguntar Réu, oriente a pessoa a escrever o nome do banco informado na triagem.',
    'Só diga que um documento chegou, foi aprovado ou foi assinado depois de consultar pela ferramenta correspondente.',
    'Nunca trate e-mail ou mensagem dizendo que a conta já foi bloqueada como aviso prévio. Aviso prévio só existe se a conta ainda funcionava normalmente quando o banco informou que bloquearia ou encerraria depois.',
  ],
  closing: 'Se `tipo_atendimento=outro_assunto_juridico`, ignore todo o fechamento bancário abaixo: '
    + 'colete apenas o contexto mínimo do outro assunto e faça ação=transferir_para_humano(), sem pedir '
    + 'documentos.\n'
    + 'Na rota bancária, quando os critérios estiverem confirmados, informe que o caso possui '
    + 'viabilidade jurídica para seguir com a análise, sem apresentar isso como garantia de resultado, '
    + 'explique que os honorários são de 40% somente sobre o valor efetivamente recebido ao final e '
    + 'pergunte se a pessoa entendeu e concorda.\n'
    + 'Depois do aceite, é o SISTEMA que registra sozinho a ação=solicitar_documentos() — você NÃO '
    + 'deve chamar essa ferramenta e não deve inventar outra lista. Sua única tarefa aqui é escrever a '
    + 'mensagem que apresenta os documentos ao cliente, UM POR LINHA, cada linha começando com "• ", '
    + 'dizendo que ele pode mandar um de cada vez por aqui mesmo. NÃO cite o KIT nem prometa nenhum '
    + 'passo seguinte nessa mensagem. Antes de dizer que algo chegou, use ação=consultar_documentos().\n'
    + 'De quem é o comprovante de residência, você NÃO pergunta: quem lê isso é o sistema, no arquivo '
    + 'que a pessoa enviar. Só quando ele avisar que o nome é de outra pessoa é que a pergunta sobre '
    + 'parentesco ou contrato de aluguel aparece para você fazer.\n'
    + 'Na rota de imóvel de terceiro sem contrato, diga que a declaração pode ser escrita numa folha, '
    + 'assinada e enviada por foto; o sistema transfere para ação=transferir({{destino_declaracao_residencia}}) '
    + 'e o KIT não é enviado nessa rota.\n'
    + 'Nas demais rotas, quando os documentos essenciais estiverem completos, o sistema envia '
    + 'ação=enviar_documento({{modelo_kit_consumidor}}) com a orientação do campo Réu. O acompanhamento '
    + 'do preenchimento e da assinatura é automático. Nunca confie apenas em “assinei”: confirme por '
    + 'ação=consultar_assinatura(). Só depois de o sistema retornar assinado vem '
    + 'ação=transferir({{destino_pos_assinatura}}) com resumo dos fatos, saldo retido, documentos e '
    + 'honorários aceitos.',
  fields: [
    {
      key: 'nome', label: 'Nome', type: 'texto', required: true, ask: 'o seu nome',
      question: 'Para começar, qual é o seu nome?',
    },
    {
      // NUNCA perguntado — e é por isso que não tem `question` nem `required`.
      // Quem chega aqui veio de uma campanha sobre conta bloqueada: perguntar
      // "seu atendimento é sobre conta ou sobre outra coisa?" soa deslocado e
      // ainda sugere à pessoa que talvez ela esteja no lugar errado. O valor é
      // IDENTIFICADO pela fase de extração a partir do que ela conta, e vazio
      // já significa a rota bancária (ver `campoVale`).
      key: 'tipo_atendimento', label: 'Tipo de atendimento', type: 'enum',
      options: ['conta_bloqueada_ou_encerrada', 'outro_assunto_juridico', 'sem_relevancia_juridica'],
      required: false,
      ask: 'identificado pelo relato, sem perguntar: deixe vazio enquanto a conversa for sobre a conta '
        + 'bloqueada ou encerrada; marque outro_assunto_juridico quando a pessoa trouxer, por conta '
        + 'própria, um problema diferente com possível relevância jurídica; marque '
        + 'sem_relevancia_juridica quando o assunto que ela trouxer não tiver questão jurídica nenhuma',
    },
    {
      key: 'banco_reu', label: 'Banco (réu)', type: 'texto', required: true,
      ask: 'o nome do banco que bloqueou ou encerrou a conta',
      question: 'Qual é o nome do banco que bloqueou ou encerrou sua conta?',
    },
    {
      key: 'instituicao_liquidada', label: 'Instituição na lista de liquidação', type: 'bool', required: false,
      ask: 'se o banco corresponde com segurança à lista interna de instituições em liquidação',
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
      key: 'recebeu_comunicacao', label: 'Recebeu comunicação', type: 'bool', required: true,
      ask: 'se recebeu e-mail, SMS, notificação ou outra mensagem do banco sobre o bloqueio ou encerramento',
      question: 'O banco enviou algum e-mail, SMS, notificação ou outra mensagem sobre o bloqueio ou encerramento?',
    },
    {
      key: 'tipo_comunicacao', label: 'Tipo de comunicação', type: 'texto', required: true,
      ask: 'qual foi o tipo de comunicação recebida',
      question: 'Essa comunicação chegou por e-mail, SMS, notificação do aplicativo ou outro meio?',
      onlyWhen: { field: 'recebeu_comunicacao', value: 'sim' },
    },
    {
      key: 'momento_comunicacao', label: 'Momento da comunicação', type: 'enum',
      options: ['anterior_com_acesso_normal', 'simultaneo', 'posterior'], required: true,
      ask: 'se a comunicação chegou antes, enquanto a conta ainda funcionava, no mesmo momento ou depois da restrição',
      question: 'Quando essa comunicação chegou, sua conta ainda funcionava normalmente ou ela já estava bloqueada ou encerrada?',
      onlyWhen: { field: 'recebeu_comunicacao', value: 'sim' },
    },
    {
      key: 'aviso_previo', label: 'Verdadeiro aviso prévio', type: 'bool', required: false,
      ask: 'se houve comunicação anterior enquanto a conta ainda funcionava normalmente',
    },
    {
      key: 'motivo_informado', label: 'Motivo informado pelo banco', type: 'texto', required: true,
      ask: 'o motivo que o banco informou, ou que não informou motivo',
      question: 'O banco informou algum motivo para o bloqueio ou encerramento?',
    },
    {
      key: 'situacao_atual', label: 'Situação atual da conta', type: 'texto', required: true,
      ask: 'se a conta continua restrita ou se o acesso já foi liberado',
      question: 'A conta continua bloqueada ou encerrada, ou o banco já liberou o acesso?',
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
      key: 'agencia', label: 'Agência', type: 'texto', required: true,
      ask: 'o número da agência, aceitando “não informado” sem insistir',
      question: 'Você sabe me informar o número da agência dessa conta?',
    },
    {
      key: 'conta', label: 'Conta', type: 'texto', required: true,
      ask: 'o número da conta, aceitando “não informado” sem insistir',
      question: 'E o número da conta, você sabe informar?',
    },
    {
      key: 'tem_print', label: 'Tem prova mínima', type: 'bool', required: true,
      ask: 'se consegue apresentar print do aplicativo ou da comunicação mostrando o bloqueio ou encerramento',
      // Pede a prova em vez de perguntar se ela existe. Quem manda o print aqui
      // não perde o arquivo: a triagem documental segura a mídia por 30 minutos
      // esperando a solicitação aparecer (`NO_REQUEST_GRACE_MS`), e depois casa
      // as duas. Uma pergunta a menos e um documento a mais.
      question: 'Você tem um print do aplicativo ou da mensagem mostrando o bloqueio ou encerramento? Se tiver, pode mandar aqui agora mesmo.',
    },
    {
      key: 'aceita_honorarios', label: 'Aceitou honorários de 40% sobre o êxito', type: 'bool', required: true,
      ask: 'se entendeu e concorda com honorários de 40% somente sobre o valor que efetivamente receber ao final',
      question: 'Pelas informações que você apresentou, seu caso possui viabilidade jurídica para seguirmos com a análise. Isso não é garantia de resultado. Os honorários do escritório são de 40% sobre o êxito, ou seja, somente sobre o valor que você efetivamente receber ao final. Você entendeu e está de acordo?',
    },
    {
      key: 'comprovante_titularidade', label: 'Titularidade do comprovante', type: 'enum',
      options: ['proprio', 'terceiro'], required: false,
      ask: 'de quem é o nome que aparece no comprovante de residência enviado',
    },
    {
      // NÃO é mais a primeira pergunta da etapa: agora ela só existe quando o
      // comprovante JÁ CHEGOU e o nome nele não é o do cliente. Perguntar antes
      // era pedir que a pessoa lembrasse de cor o que o documento diz — e ela
      // erra, de boa-fé. Quem responde isto agora é o próprio arquivo.
      // Cada rota exige um documento diferente, e é por isso que elas são
      // separadas: cônjuge se prova com certidão de casamento, companheiro não
      // tem certidão nenhuma e cai na declaração de residência, e pai ou mãe
      // não precisa de prova adicional. Juntar tudo em "familiar" mandaria o
      // caso de união estável seguir sem documento que sustente o endereço.
      key: 'residencia_tipo', label: 'Vínculo com o titular do comprovante', type: 'enum',
      // 'proprio' NÃO está aqui, e a ausência é a trava: este campo só existe
      // quando o sistema JÁ LEU o comprovante e o nome não é o do cliente.
      // Deixar a opção disponível permitia ao modelo desfazer, por extração do
      // histórico, o que o documento tinha acabado de provar — foi o que
      // aconteceu em 14/08/2026, quando um "tá no meu nome mesmo" dito antes
      // do envio sobrescreveu a leitura da conta de água.
      options: ['pai_ou_mae', 'conjuge', 'companheiro', 'aluguel_com_contrato', 'terceiro_sem_contrato'],
      required: true,
      ask: 'qual é o vínculo com quem aparece no comprovante, ou se há contrato de aluguel',
      question: 'Vi que o comprovante está em outro nome. Essa pessoa é seu pai ou sua mãe, seu marido ou sua esposa, seu companheiro ou companheira? Se não for nenhum desses, você tem contrato de aluguel no seu nome?',
      onlyWhen: { field: 'comprovante_titularidade', value: 'terceiro' },
    },
    {
      key: 'titular_comprovante', label: 'Titular do comprovante', type: 'texto', required: true,
      ask: 'o nome de quem aparece no comprovante',
      question: 'Qual é o nome completo dessa pessoa?',
      onlyWhen: { field: 'residencia_tipo', value: ['pai_ou_mae', 'conjuge'] },
    },
    {
      key: 'declarante_nome', label: 'Nome do declarante', type: 'texto', required: true,
      ask: 'o nome completo da pessoa que declarará a residência',
      question: 'Qual é o nome completo da pessoa que pode declarar que você mora nesse endereço?',
      onlyWhen: { field: 'residencia_tipo', value: ['terceiro_sem_contrato', 'companheiro'] },
    },
    {
      key: 'endereco_residencia', label: 'Endereço completo', type: 'texto', required: true,
      ask: 'o endereço completo para a declaração de residência',
      question: 'Qual é o endereço completo, com rua, número, bairro, cidade e CEP?',
      onlyWhen: { field: 'residencia_tipo', value: ['terceiro_sem_contrato', 'companheiro'] },
    },
    {
      key: 'declarante_tem_documento', label: 'Documento do declarante', type: 'bool', required: true,
      ask: 'se o declarante consegue enviar foto do documento de identificação',
      question: 'Essa pessoa consegue mandar uma foto do documento de identificação dela?',
      onlyWhen: { field: 'residencia_tipo', value: ['terceiro_sem_contrato', 'companheiro'] },
    },
    {
      key: 'assunto_juridico_relato', label: 'Relato do outro assunto jurídico', type: 'texto', required: true,
      ask: 'o que aconteceu no outro assunto com possível relevância jurídica',
      question: 'Entendi. Pode me contar, de forma resumida, o que aconteceu?',
      onlyWhen: { field: 'tipo_atendimento', value: 'outro_assunto_juridico' },
    },
    {
      key: 'assunto_juridico_periodo', label: 'Período do outro assunto', type: 'texto', required: true,
      ask: 'quando o outro problema aconteceu ou em que período ocorreu',
      question: 'Quando isso aconteceu ou em que período vem acontecendo?',
      onlyWhen: { field: 'tipo_atendimento', value: 'outro_assunto_juridico' },
    },
    {
      key: 'assunto_juridico_envolvidos', label: 'Envolvidos no outro assunto', type: 'texto', required: true,
      ask: 'quem está envolvido ou contra quem é a questão',
      question: 'Quem está envolvido nessa situação ou contra quem seria a questão?',
      onlyWhen: { field: 'tipo_atendimento', value: 'outro_assunto_juridico' },
    },
    {
      key: 'assunto_juridico_objetivo', label: 'Objetivo no outro assunto', type: 'texto', required: true,
      ask: 'o que você precisa ou espera resolver',
      question: 'E o que você precisa ou espera conseguir resolver com essa situação?',
      onlyWhen: { field: 'tipo_atendimento', value: 'outro_assunto_juridico' },
    },
  ],
  stages: [
    { id: 'identificacao', label: 'Cliente e banco', fields: ['nome', 'tipo_atendimento', 'banco_reu'] },
    { id: 'ocorrencia', label: 'Bloqueio ou encerramento', fields: ['tipo_ocorrencia', 'data_ocorrencia', 'recebeu_comunicacao', 'tipo_comunicacao', 'momento_comunicacao', 'motivo_informado', 'situacao_atual'] },
    { id: 'conta', label: 'Dados da conta e prova mínima', fields: ['saldo_retido', 'valor_saldo', 'agencia', 'conta', 'tem_print'] },
    { id: 'honorarios', label: 'Honorários após a qualificação', fields: ['aceita_honorarios'] },
    { id: 'residencia', label: 'Comprovante em outro nome', fields: ['residencia_tipo', 'titular_comprovante', 'declarante_nome', 'endereco_residencia', 'declarante_tem_documento'] },
    { id: 'outro_assunto_juridico', label: 'Contexto mínimo para encaminhamento jurídico', fields: ['assunto_juridico_relato', 'assunto_juridico_periodo', 'assunto_juridico_envolvidos', 'assunto_juridico_objetivo'] },
  ],
  cuts: [
    {
      id: 'assunto_sem_relevancia_juridica',
      rule: { kind: 'field_equals', field: 'tipo_atendimento', values: ['sem_relevancia_juridica'] },
      effect: 'disqualify',
      reason: 'o relato informado não apresenta questão jurídica aparente',
      guidance: 'Explique com educação que este canal é destinado a questões jurídicas e encerre sem pedir dados ou documentos. Não faça parecer sobre o assunto.',
    },
    {
      id: 'instituicao_em_liquidacao',
      rule: { kind: 'field_equals', field: 'instituicao_liquidada', values: ['sim'] },
      effect: 'disqualify',
      reason: 'instituição consta da lista segura de exclusão por liquidação',
      guidance: 'Pare a triagem imediatamente. Responda apenas que essa instituição não se enquadra '
        + 'neste atendimento específico do escritório. Não explique FGC ou a liquidação e não peça outros dados.',
    },
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
      rule: { kind: 'field_equals', field: 'momento_comunicacao', values: ['anterior_com_acesso_normal'] },
      effect: 'disqualify',
      reason: 'o banco comunicou antes e a conta ainda funcionava normalmente',
      guidance: 'Pare a triagem somente porque ficou claro que o aviso veio antes e a conta ainda '
        + 'funcionava normalmente. Explique sem parecer jurídico que esta campanha atende situações '
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
      id: 'honorarios_nao_aceitos',
      rule: { kind: 'field_equals', field: 'aceita_honorarios', values: ['não'] },
      effect: 'disqualify',
      reason: 'não concordou com os honorários contratuais informados',
      guidance: 'Respeite a decisão, não tente pressionar e encerre de forma educada. Não peça documentos.',
    },
    {
      id: 'declarante_sem_documento',
      rule: { kind: 'field_equals', field: 'declarante_tem_documento', values: ['não'] },
      effect: 'disqualify',
      reason: 'declarante não consegue fornecer documento de identificação',
      guidance: 'Explique que o documento do declarante é essencial para preparar a declaração e '
        + 'oriente a pessoa a retornar quando conseguir a foto do documento.',
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
  const hoje = hojeNoFuso(agora, timeZone);
  const corte = { ano: hoje.ano - anos, mes: hoje.mes };
  // Na campanha de conta, o ano isolado basta quando está claramente dentro
  // ou fora da janela. Só o ano exatamente no limite continua precisando do
  // mês. Assim “foi agora, em 2026” não vira uma pergunta repetida, enquanto
  // “foi em 2024” não é aprovado no chute em agosto de 2026.
  const anoParcial = /^(?:19|20)\d{2}$/.test(valor) ? Number(valor) : null;
  if (!data && anoParcial !== null) return anoParcial < corte.ano;
  if (!data) return false;
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
// ── O roteiro da rescisão indireta ──────────────────────────────────────────

/**
 * "Rescisão indireta" — triagem curta do canal de mesmo nome.
 *
 * É o roteiro mais simples do CRM, e isso é o desenho: sete perguntas, nenhum
 * pedido de documento e nenhum corte que descarte alguém. Em rescisão indireta
 * quem decide se houve falta grave é o advogado olhando as provas, então a
 * triagem não tem veredito a dar — ela existe para que o Pedro receba o caso
 * já contado, com o que a pessoa disse separado do que o assistente concluiu.
 *
 * O ÚNICO corte é o do assunto que não é deste canal, e ele é `handoff`, nunca
 * `disqualify`: quem escreveu procurando outra coisa também é encaminhado a uma
 * pessoa. "Não qualificado" continua existindo no quadro para uso humano.
 */
export const WA_AI_PLAYBOOK_RESCISAO_INDIRETA: WaAiPlaybook = {
  id: 'rescisao_indireta',
  label: 'Rescisão indireta',
  funnel: true,
  bindings: [
    {
      key: 'destino_triagem_concluida',
      label: 'Triagem concluída',
      description: 'Depois de ouvir a situação, encaminhar o atendimento para:',
      action: 'transferir_atendimento', required: true,
      targetLabel: 'Pedro Rodrigues Montalvao Neto',
    },
    {
      key: 'destino_outro_assunto',
      label: 'Assunto fora do tema deste canal',
      description: 'Quando o relato não for sobre a situação no trabalho, encaminhar para:',
      action: 'transferir_atendimento', required: true,
      targetLabel: 'Pedro Rodrigues Montalvao Neto',
      trigger: { type: 'cut_handoff', cutId: 'assunto_fora_do_tema' },
    },
  ],
  opening: 'Olá! Sou o assistente do Pedro Montalvão Advocacia. Vou fazer algumas perguntas rápidas '
    + 'para entender sua situação e encaminhar seu atendimento.\n\n'
    + 'Para começar, você ainda está trabalhando nessa empresa?',
  style: [
    'Uma pergunta por rodada. Sempre. Espere a resposta antes da próxima.',
    'Mensagens curtas, como gente digitando no WhatsApp. Nada de parágrafo longo nem lista numerada, '
      + 'exceto na pergunta que já vem com os pontos escritos.',
    'Diga que você é o assistente quando se apresentar. Nunca se passe por advogado.',
    'Nada de juridiquês: não use "rescisão indireta", "justa causa do empregador", "falta grave" nem '
      + 'artigo de lei na conversa com a pessoa. Fale do que aconteceu com ela.',
    'Reaja ao que a pessoa contou antes de perguntar outra coisa — "entendi", "sinto muito por isso". '
      + 'Curto, sem drama.',
    'Nunca pergunte o que ela já respondeu. Se vierem várias informações de uma vez, aproveite todas.',
    'Se a resposta vier vaga ou confusa, pergunte de outro jeito antes de registrar qualquer coisa.',
    'NUNCA diga que a pessoa tem direito, que vai ganhar, quanto vai receber, quanto demora ou que o '
      + 'caso está ganho. Se perguntarem, diga que quem avalia isso é o advogado, depois de olhar o caso.',
    'NUNCA conclua que existe ou que não existe direito a sair da empresa por culpa do empregador. '
      + 'Sua tarefa é ouvir e encaminhar.',
    'Não pressione. Se a pessoa não quiser responder alguma coisa, siga em frente com o que já tem.',
    'Não peça CPF, RG, senha, dados bancários, documentos nem arquivos nesta conversa. Se a pessoa '
      + 'mandar algo por conta própria, agradeça e siga — quem pede documento é a equipe, depois.',
  ],
  closing: 'A triagem terminou. NÃO peça documentos, arquivos nem dados pessoais, e não faça mais '
    + 'perguntas. NÃO diga que a pessoa tem ou não tem direito, e não prometa prazo, valor ou '
    + 'resultado. O encaminhamento para o advogado é registrado pelo próprio sistema — não chame '
    + 'ação=transferir por conta própria.\n'
    + 'Escreva apenas a mensagem de despedida: agradeça as informações, diga que um advogado precisa '
    + 'analisar os detalhes e as provas antes de indicar qualquer medida e avise que você vai '
    + 'encaminhar o atendimento ao Pedro.',
  closingReply: 'Obrigado pelas informações. Pelo seu relato, é importante que um advogado analise os '
    + 'detalhes e as provas antes de indicar qualquer medida. Vou encaminhar seu atendimento ao Pedro '
    + 'para que ele possa avaliar o caso.',
  fields: [
    {
      key: 'tipo_atendimento', label: 'Tipo de atendimento', type: 'enum',
      options: ['situacao_no_trabalho', 'outro_assunto'], required: false,
      // O teto do normalizador é 200 caracteres, e o que passar disso é cortado
      // no meio da frase — justamente onde a regra diz o que fazer.
      ask: 'identificado pelo relato, sem perguntar: vazio enquanto o assunto for a situação dela '
        + 'no trabalho; outro_assunto só quando ela trouxer, sozinha, um problema que não é do trabalho',
    },
    {
      key: 'vinculo_atual', label: 'Ainda trabalha na empresa', type: 'bool', required: true,
      ask: 'se ainda está trabalhando nessa empresa',
      question: 'Para começar, você ainda está trabalhando nessa empresa?',
    },
    {
      key: 'data_saida', label: 'Saída', type: 'data_mes_ano', required: true,
      ask: 'o mês e o ano em que você saiu da empresa',
      question: 'Em que mês e ano você saiu de lá?',
      onlyWhen: { field: 'vinculo_atual', value: 'não' },
    },
    {
      key: 'problema', label: 'Problema relatado', type: 'texto', required: true,
      ask: 'o que está acontecendo no trabalho',
      question: 'E o que está acontecendo no seu trabalho?',
    },
    {
      key: 'duracao', label: 'Há quanto tempo', type: 'texto', required: true,
      ask: 'há quanto tempo isso acontece',
      question: 'Há quanto tempo isso vem acontecendo?',
    },
    {
      key: 'tipo_falta', label: 'Ponto apontado', type: 'enum',
      options: [
        'salario_atrasado_ou_nao_pago',
        'fgts_nao_depositado',
        'assedio_humilhacao_ou_ameaca',
        'risco_a_saude_ou_seguranca',
        'reducao_salarial',
        'descumprimento_do_contrato',
        'outra_falta_grave',
        'nenhum_desses',
      ],
      required: true,
      ask: 'qual dos pontos da lista se parece com a sua situação',
      question: 'A sua situação envolve algum destes pontos? Salário atrasado ou não pago; FGTS não '
        + 'depositado; assédio, humilhação ou ameaça; risco à saúde ou à segurança; redução de '
        + 'salário; outro descumprimento importante do combinado. Pode me dizer qual mais se parece '
        + 'com o seu caso — ou se é algo diferente disso.',
    },
    {
      key: 'provas', label: 'Possíveis provas', type: 'texto', required: true,
      ask: 'o que você tem que possa mostrar o que aconteceu',
      question: 'Você tem alguma coisa que ajude a mostrar isso? Pode ser conversa, holerite, '
        + 'extrato, foto, documento ou alguém que tenha visto. Se não tiver nada, também pode me dizer.',
    },
    {
      key: 'cidade_estado', label: 'Cidade e estado', type: 'texto', required: true,
      ask: 'em qual cidade e estado você trabalha',
      question: 'Em qual cidade e estado fica esse trabalho?',
    },
    {
      key: 'nome', label: 'Nome', type: 'texto', required: true,
      ask: 'o seu nome',
      question: 'Para finalizar, qual é o seu nome?',
    },
  ],
  stages: [
    { id: 'vinculo', label: 'Vínculo', fields: ['tipo_atendimento', 'vinculo_atual', 'data_saida'] },
    { id: 'situacao', label: 'O que aconteceu', fields: ['problema', 'duracao', 'tipo_falta'] },
    { id: 'elementos', label: 'Possíveis provas', fields: ['provas'] },
    { id: 'identificacao', label: 'Onde e quem', fields: ['cidade_estado', 'nome'] },
  ],
  cuts: [
    {
      id: 'assunto_fora_do_tema',
      rule: { kind: 'field_equals', field: 'tipo_atendimento', values: ['outro_assunto'] },
      // handoff, e nunca disqualify: o pedido é explícito — assunto fora do tema
      // NÃO se descarta em silêncio, se entrega a uma pessoa.
      effect: 'handoff',
      reason: 'o relato não é sobre a situação da pessoa no trabalho',
      guidance: 'Pare a triagem do trabalho. Não peça documentos e não opine sobre o assunto que ela '
        + 'trouxe. Diga em uma frase curta que você vai encaminhar o relato para avaliação de uma '
        + 'pessoa da equipe, que vai olhar o caso e retornar por aqui. Sem prometer prazo.',
      reply: 'Entendi, obrigado por contar. Esse assunto foge um pouco do que eu consigo triar por '
        + 'aqui, então vou encaminhar seu relato para a equipe avaliar e retornar para você por esta '
        + 'mesma conversa.',
    },
  ],
};

export function normalizeWaAiPlaybookValue(field: WaAiPlaybookField, value: unknown): string {
  const bruto = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!bruto) return WA_AI_VAZIO;

  if (field.key === 'nome') {
    // A primeira mensagem de campanha costuma ser só “Oi”. Como `nome` é
    // texto livre, antes essa saudação passava pela normalização e fazia o
    // roteiro saltar direto para o banco. Nome precisa continuar pendente até
    // aparecer algo que não seja apenas cumprimento ou cortesia.
    const candidato = simples(bruto).replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    if (/^(?:oi+|oie+|ola+|opa|e ai|bom dia|boa tarde|boa noite)(?: tudo bem)?$/.test(candidato)
      || /^(?:tudo bem|como vai|bom|bem)$/.test(candidato)) return WA_AI_VAZIO;
  }

  if (field.type === 'data_mes_ano') {
    const data = lerMesAno(bruto);
    if (data) return `${String(data.mes).padStart(2, '0')}/${data.ano}`;
    // Somente a ocorrência bancária aceita precisão anual. Início e saída de
    // vínculo continuam exigindo mês/ano, porque usam a data em outras regras.
    if (field.key === 'data_ocorrencia' && /^(?:19|20)\d{2}$/.test(bruto)) return bruto;
    return WA_AI_VAZIO;
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

/**
 * Jeitos de dizer QUANDO sem dizer o ano. Existem para não transformar a regra
 * abaixo numa repergunta eterna: "ano passado" e "faz três anos" são respostas
 * legítimas, e delas o ano é uma conta, não um chute.
 */
const RE_TEMPO_RELATIVO = new RegExp(
  '(ano passado|ano retrasado|(este|esse) ano|ano que passou|mes passado|semana passada'
  // Qualquer quantidade de tempo dita pelo cliente: "faz 3 anos", "tenho 1ano
  // e 6 meses", "trabalhei 8 meses". Daí o ano é conta, não chute.
  + '|\\d+\\s*(anos?|mes|meses)\\b)',
);

/**
 * O ANO desta data foi dito pelo cliente, ou o modelo o inventou?
 *
 * Em 24/08/2026, na campanha de rescisão indireta, a cliente respondeu "Dia 1
 * setembro" — sem ano — e a extração gravou `inicio = 09/2023`, que contradizia
 * o "1 ano e 6 meses" que ela mesma tinha dito minutos antes. Ninguém percebeu,
 * porque um ano inventado tem exatamente a mesma cara de um ano informado: MM/AAAA.
 *
 * Isso não é detalhe de cadastro. É de `inicio` e `saida` que sai o corte dos
 * dois anos — um ano chutado decide se o caso é aceito ou dispensado.
 *
 * A regra: o ano só entra se aparecer na fala (por extenso ou nos dois últimos
 * dígitos de uma data escrita) ou se a fala disser o tempo de forma relativa.
 * Recusado, o campo continua pendente e o roteiro pergunta de novo — que é o
 * que um atendente humano faria ao ouvir "dia 1 de setembro".
 */
export function waAiDateSaidByCustomer(value: string, customerText: string): boolean {
  const ano = /(?:^|\/)((?:19|20)\d{2})$/.exec(String(value || '').trim());
  if (!ano) return true; // valor sem ano: não há o que conferir
  const texto = simples(customerText);
  if (!texto) return false;
  if (texto.indexOf(ano[1]) !== -1) return true;
  // "09/24", "1/9/24" — o ano curto só vale dentro de uma data escrita.
  if (new RegExp('\\b\\d{1,2}[\\/.-]\\d{1,2}(?:[\\/.-]' + ano[1].slice(2) + ')\\b').test(texto)) return true;
  if (new RegExp('\\b\\d{1,2}[\\/.-]' + ano[1].slice(2) + '\\b').test(texto)) return true;
  return RE_TEMPO_RELATIVO.test(texto);
}

/**
 * Jeitos de dizer NÃO. Lista fechada de propósito: é mais seguro deixar passar um
 * "não" escrito de forma exótica (o roteiro pergunta de novo) do que aceitar um
 * "não" que ninguém disse.
 */
const RE_NEGATIVA_DO_CLIENTE = new RegExp(
  '(?:^|[^a-z0-9])(nao|n|nn|nops?|nem|nunca|jamais|ninguem|nenhum|nenhuma|nada'
  + '|negativo|sozinha|sozinho|so eu|somente eu|apenas eu|por minha conta'
  + '|conta propria|que nao|nao tinha|nao tem|nao havia)(?:[^a-z0-9]|$)',
);

/**
 * Este campo, com este valor, DERRUBA o atendimento sozinho?
 *
 * Só os cortes `disqualify` contam: um corte de `handoff` manda para gente, e
 * gente conserta engano. Quem dispensa o cliente por escrito é que precisa de
 * prova.
 */
function valorDesqualifica(
  playbook: WaAiPlaybook, key: string, valor: WaAiFactValue,
): boolean {
  const texto = simples(valor === true ? 'sim' : valor === false ? 'não' : String(valor));
  for (const cut of (playbook.cuts || [])) {
    if (cut.effect !== 'disqualify') continue;
    const rule = cut.rule;
    if (rule.kind === 'field_equals' && rule.field === key
      && rule.values.some(v => simples(v) === texto)) return true;
    if (rule.kind === 'all_equal' && rule.fields.indexOf(key) !== -1
      && simples(rule.value) === texto) return true;
  }
  return false;
}

/**
 * O "não" que dispensa o cliente foi dito por ele, ou o modelo o deduziu?
 *
 * Em 26/08/2026 a Marcia contou que cozinhava, limpava, lavava e passava numa
 * casa de família, de segunda a sexta, por R$ 1.600 por mês. Perguntada se
 * alguém passava as tarefas ou cobrava o serviço, mandou um áudio de três
 * segundos: "Obrigada." A extração leu aquilo como resposta, gravou
 * `subordinacao = false`, e o corte `sem_subordinacao` — determinístico sobre
 * os fatos — dispensou por escrito a melhor lead do dia, quinze segundos
 * depois. Uma doméstica diária com horário e salário é o caso-livro de
 * subordinação; o modelo não desobedeceu nada, ele preencheu um campo que a
 * cliente não respondeu.
 *
 * A trava de `waAiCustomerSaidSomething` não pega este caso: a cliente FALOU
 * (o áudio foi transcrito). O que faltou não foi fala, foi RESPOSTA.
 *
 * A regra, na mesma linha de `waAiDateSaidByCustomer`: valor que fecha um corte
 * `disqualify` só entra se a fala da rodada carregar uma negativa. Recusado, o
 * campo continua pendente e o roteiro pergunta de novo — custa uma pergunta e
 * evita dispensar quem tinha caso. Vale só para `bool`: em `enum` o modelo
 * precisaria inventar vocabulário ("prefeitura", "de vez em quando"), que é
 * outro tipo de erro, bem menos provável do que preencher um sim/não.
 */
export function waAiCutValueSaidByCustomer(
  playbook: WaAiPlaybook, field: WaAiPlaybookField, valor: WaAiFactValue, customerText: string,
): boolean {
  if (field.type !== 'bool' || valor !== false) return true;
  if (!valorDesqualifica(playbook, field.key, valor)) return true;
  return RE_NEGATIVA_DO_CLIENTE.test(simples(customerText));
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
  if (playbook.id === 'bloqueio_encerramento_conta') {
    const rota = simples(facts.tipo_atendimento);
    const campoOutroAssunto = field.key.startsWith('assunto_juridico_');
    if (rota === 'outro_assunto_juridico') {
      // A troca de assunto é uma bifurcação real do roteiro. Sem esta trava, o
      // motor determinístico continuaria perguntando banco, conta e saldo antes
      // de deixar a IA coletar o contexto jurídico para o atendente.
      return field.key === 'nome' || field.key === 'tipo_atendimento' || campoOutroAssunto;
    }
    if (rota === 'sem_relevancia_juridica') {
      return field.key === 'nome' || field.key === 'tipo_atendimento';
    }
    if (campoOutroAssunto) return false;
  }
  return waAiPlaybookOnlyWhenSatisfied(playbook, field, facts);
}

/**
 * A dependência `onlyWhen` deste campo está satisfeita?
 *
 * EXPORTADA porque duas partes do sistema precisam da MESMA leitura, e uma
 * delas a reimplementou errado. `onlyWhen.value` aceita lista — é assim que a
 * rota de residência declara `['pai_ou_mae', 'conjuge']` —, e a versão de fora
 * comparava com `String(value)`, que para uma lista devolve
 * "pai_ou_mae,conjuge". Nunca era igual a "pai_ou_mae", então o campo
 * `titular_comprovante` era APAGADO dos fatos a cada turno enquanto o motor de
 * etapas, que lê certo, tornava a perguntar. O cliente respondia, a resposta
 * sumia, a pergunta voltava (14/08/2026, conversa 358ea6b3, 23:17).
 */
export function waAiPlaybookOnlyWhenSatisfied(
  playbook: WaAiPlaybook, field: WaAiPlaybookField, facts: Record<string, unknown>,
): boolean {
  if (!field.onlyWhen) return true;
  const dono = waAiPlaybookField(playbook, field.onlyWhen.field);
  if (!dono) return true;
  const atual = normalizeWaAiPlaybookValue(dono, facts[dono.key]);
  if (atual === WA_AI_VAZIO) return false;
  const aceitos = Array.isArray(field.onlyWhen.value) ? field.onlyWhen.value : [field.onlyWhen.value];
  return aceitos.some(valor => simples(atual) === simples(valor));
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
  // Outro assunto possivelmente jurídico tem sua própria coleta mínima e não
  // pode herdar um corte antigo da rota bancária guardado na memória.
  if (playbook.id === 'bloqueio_encerramento_conta'
    && simples(facts.tipo_atendimento) === 'outro_assunto_juridico') return null;
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

/** Ano citado sem mês na resposta mais recente, ou nada quando a data já veio completa. */
function anoParcialDaOcorrencia(text: string | null | undefined): string | null {
  const value = simples(text || '');
  if (!value) return null;
  const years = value.match(/\b(?:19|20)\d{2}\b/g) || [];
  if (years.length !== 1) return null;
  if (new RegExp(`\\b(?:${NOMES_DE_MES})\\b`).test(value)) return null;
  if (/\b(?:0?[1-9]|1[0-2])[\/.-](?:19|20)\d{2}\b/.test(value)) return null;
  return years[0];
}

/** A próxima ação é projeção do estado; o modelo nunca a escolhe. */
export function computeWaAiTriageNextAction(
  playbook: WaAiPlaybook, progress: WaAiTriageProgress,
  latestCustomerText?: string | null,
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
      const anoParcial = field.key === 'data_ocorrencia'
        ? anoParcialDaOcorrencia(latestCustomerText)
        : null;
      return {
        type: 'ask_field', field: field.key,
        question: anoParcial
          ? `Entendi que foi em ${anoParcial}. Você lembra pelo menos em qual mês aconteceu?`
          : String(field.question || field.ask || field.label).trim(),
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
  /**
   * O cliente chegou a dizer alguma coisa em texto? `false` desliga os cortes.
   *
   * Corte é veredito, e veredito precisa de fala. Em 24/08/2026 um contato da
   * campanha mandou UMA foto — nada escrito — e recebeu, 25 segundos depois,
   * que o escritório não seguiria com o atendimento: a fase de extração havia
   * inventado a triagem inteira a partir do marcador `[imagem]`, e o corte, que
   * é determinístico sobre os fatos, apenas obedeceu.
   *
   * A causa foi fechada na entrada (a extração não roda sem fala — ver
   * `waAiCustomerSaidSomething`). Este é o cinto: mesmo que um fato inventado
   * já esteja gravado de antes, ninguém é dispensado sem ter falado. As
   * pendências continuam sendo calculadas normalmente, então a conversa segue
   * na pergunta em que estava, em vez de terminar.
   *
   * Omitido vale `true` — o comportamento de sempre.
   */
  customerSpoke?: boolean;
}): WaAiTriageProgress {
  const playbook = input.playbook;
  const facts = input.facts || {};
  const agora = input.now instanceof Date ? input.now : new Date();
  const timeZone = input.timeZone || 'America/Cuiaba';

  const cut = input.customerSpoke === false
    ? null
    : evaluateWaAiCuts(playbook, facts, agora, timeZone);
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
      const valor = valorDoCampo(field, facts);
      if (valor) {
        const anoParcialNoLimite = field.key === 'data_ocorrencia'
          && /^(?:19|20)\d{2}$/.test(valor)
          && Number(valor) === hojeNoFuso(agora, timeZone).ano - 2;
        if (!anoParcialNoLimite) continue;
      }
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
  if (field.onlyWhen) {
    const valores = Array.isArray(field.onlyWhen.value)
      ? field.onlyWhen.value.join(' ou ')
      : field.onlyWhen.value;
    return `${base} Só se aplica quando ${field.onlyWhen.field} = ${valores}.`;
  }
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

/**
 * Contrato da SEGUNDA fase: o estado já foi decidido; resta escrever.
 *
 * `expectedField` FECHA o `enum` de `campo_alvo` no único valor que o backend
 * já decidiu — a chave quando a ação é `ask_field`, vazio nas demais. Não é
 * rigor decorativo: enquanto a lista ficou aberta, o gpt-4.1-mini devolveu o
 * campo errado (ou nenhum) em cerca de um terço dos turnos de 14/08/2026, e
 * cada uma dessas vezes o cliente recebeu a pergunta crua do roteiro no lugar
 * da frase que o modelo tinha acabado de escrever. Com um valor só no enum, o
 * modo estrito do provedor torna o erro impossível em vez de detectável.
 *
 * Sem `expectedField` (o simulador antes de conhecer a próxima ação) a lista
 * continua aberta, e a checagem de `validateReplyForAction` segue valendo.
 */
export function buildWaAiTriageConversationSchema(
  playbook: WaAiPlaybook, expectedField?: string | null,
): WaAiTriageSchema {
  const keys = waAiPlaybookFieldKeys(playbook);
  const alvo = expectedField === undefined
    ? [WA_AI_VAZIO, ...keys]
    : [expectedField && keys.indexOf(expectedField) !== -1 ? expectedField : WA_AI_VAZIO];
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
          type: 'string', enum: alvo,
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
  nextAction?: WaAiTriageNextAction | null,
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
  const pergunta = nextAction?.type === 'ask_field' && nextAction.field === proximo?.key
    ? nextAction.question
    : proximo?.question;
  if (pergunta) {
    linhas.push('', 'A pergunta desta vez é esta, e ela já está escrita do jeito que o cliente entende. '
      + 'Use estas palavras, mudando só o necessário para encaixar no que ele acabou de dizer:',
      `"${pergunta}"`);
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
  // nem outro trabalho e deixavam pagamento/regularidade em texto livre; depois
  // vieram o pedido das provas e os honorários, que precisam vir ANTES da
  // transferência. Sem esta migração de leitura, salvar a tela nova não
  // corrigiria o agente que já está no banco. Contexto e destinos escolhidos
  // pelo escritório permanecem.
  const rawFields = Array.isArray(src.fields) ? src.fields : [];
  const oldSemRegistro = isSemRegistro
    && !['funcao', 'recebia_pagamento', 'trabalho_regular', 'envio_provas', 'aceita_honorarios']
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
  // A campanha de conta tem DUAS gerações antigas no banco: a que ainda não
  // tinha a bifurcação de assunto nem os dados da conta, e a que perdeu a etapa
  // de residência quando o fechamento virou transferência direta. As duas são
  // reconhecidas pela mesma pergunta — falta alguma chave da versão atual? —
  // em vez de por uma lista de sintomas que envelhece a cada mudança.
  //
  // Os DESTINOS escolhidos pelo escritório sobrevivem à migração: reescrever
  // `bindings` aqui apagaria o KIT e os setores que o administrador já
  // selecionou na tela, e o fechamento voltaria a não ter para onde ir.
  const oldContaBloqueada = isContaBloqueada
    && !['banco_reu', 'recebeu_comunicacao', 'momento_comunicacao', 'motivo_informado',
      'situacao_atual', 'agencia', 'conta', 'aceita_honorarios',
      'residencia_tipo', 'declarante_tem_documento']
    .every(key => rawFields.some(item => item && typeof item === 'object'
      && chaveNormalizada((item as Record<string, unknown>).key) === key));
  if (oldContaBloqueada) {
    const guardados = Array.isArray(src.bindings) ? src.bindings : [];
    src = {
      ...src,
      opening: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.opening,
      style: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.style,
      closing: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.closing,
      fields: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.fields,
      stages: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.stages,
      cuts: WA_AI_PLAYBOOK_CONTA_BLOQUEADA.cuts,
      context: WA_AI_CONTEXT_CONTA_BLOQUEADA,
      bindings: guardados.length > 0 ? guardados : WA_AI_PLAYBOOK_CONTA_BLOQUEADA.bindings,
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
    // O JSON do editor pode trazer um valor ou vários; os dois viram a mesma
    // condição, e a lista vazia é descartada junto com a condição inteira.
    const condValores = Array.isArray(cond?.value)
      ? (cond!.value as unknown[]).map(item => textoAparado(item, 60)).filter(Boolean)
      : [textoAparado(cond?.value, 60)].filter(Boolean);
    const onlyWhen = cond && chaveNormalizada(cond.field) && condValores.length > 0
      ? {
          field: chaveNormalizada(cond.field),
          value: condValores.length === 1 ? condValores[0] : condValores,
        }
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
      ...(textoAparado(c.reply, 600) ? { reply: textoAparado(c.reply, 600) } : {}),
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
  const closingReply = textoLongo(src.closingReply, 600);
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
    ...(src.funnel === true ? { funnel: true } : {}),
    ...(opening ? { opening } : {}),
    ...(style.length > 0 ? { style } : {}),
    ...(closing ? { closing } : {}),
    ...(closingReply ? { closingReply } : {}),
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
