/**
 * A TRIAGEM DE RESCISÃO INDIRETA, do primeiro "oi" até o card do Pedro.
 *
 * Mesma costura de `waAiTriagePipeline.test.ts`, aplicada ao roteiro novo:
 * resposta do modelo → atualizações normalizadas pelo tipo do campo → rede de
 * baixo (`reconcileWaAiTriageState`) → veredito do backend (pendências, etapa,
 * corte) → fechamento (`buildWaAiCompletionPlans`) → degrau do funil.
 *
 * Nada aqui fala com o banco nem com o provedor. O que entra no lugar do modelo
 * é a string que ele devolveria.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_PLAYBOOK_RESCISAO_INDIRETA,
  computeWaAiTriageNextAction,
  computeWaAiTriageProgress,
  normalizeWaAiPlaybookValue,
  normalizeWaAiPlaybook,
  waAiPlaybookField,
  waAiPlaybookFieldKeys,
} from './waAiPlaybook.ts';
import {
  buildWaAiCompletionPlans,
  renderWaAiRescisaoSummary,
  waAiRescisaoMotivoDaQualificacao,
  waAiRescisaoUrgencia,
  type WaAiCompletionAssistant,
} from './waAiCompletion.ts';
import { parseWaAiTriageReply } from './waAiTriageReply.ts';
import { pickWaAiFunnelStage, shouldMoveWaAiFunnel, type WaAiFunnelStage } from './waAiFunnel.ts';
import {
  decideAutoFollowup,
  isWithinFollowupWindow,
  localPartsInTz,
  nextFollowupAt,
  normalizeWaAiFollowupPolicy,
  type WaAiAutoFollowupContext,
  type WaAiFollowupPolicy,
} from './waAiFollowupPolicy.ts';
import { reconcileWaAiTriageState, type WaAiTriageTurn } from './waAiTriageFacts.ts';

const ROTEIRO = WA_AI_PLAYBOOK_RESCISAO_INDIRETA;
const CHAVES = waAiPlaybookFieldKeys(ROTEIRO);
const HOJE = new Date('2026-08-21T15:00:00Z');
const TZ = 'America/Cuiaba';

/** O Pedro real do CRM, com o destino já compilado como o banco o guarda. */
const PEDRO = 'Pedro Rodrigues Montalvao Neto';
const AGENTE: WaAiCompletionAssistant = {
  allowed_actions: ['transferir_atendimento', 'agendar_followup', 'cancelar_followup', 'transferir_para_humano'],
  action_refs: [{
    action: 'transferir_atendimento',
    target_type: 'user',
    target_id: 'f6b77979-d683-4afa-b9a4-482ddae74534',
    target_label: PEDRO,
    raw: `ação=transferir(${PEDRO})`,
  }],
};

const CONTATO = {
  name: 'Fulana de Teste',
  phone: '5565999990001',
  channelName: 'Rescisão Indireta',
  firstContactAt: '2026-08-21T13:00:00Z',
};

const FUNIL: WaAiFunnelStage[] = [
  { stageKey: 'novo_contato', label: 'Novo contato', labels: ['Novo contato'], position: 0, isActive: true },
  { stageKey: 'em_triagem', label: 'Em triagem', labels: ['Em triagem'], position: 1, isActive: true },
  { stageKey: 'aguardando_resposta', label: 'Aguardando resposta', labels: ['Aguardando resposta'], position: 2, isActive: true },
  { stageKey: 'qualificado', label: 'Qualificado', labels: ['Qualificado'], position: 3, isActive: true },
  { stageKey: 'transferido_pedro', label: 'Transferido ao Pedro', labels: ['Transferido ao Pedro'], position: 4, isActive: true },
  { stageKey: 'em_acompanhamento', label: 'Em acompanhamento', labels: ['Em acompanhamento'], position: 5, isActive: true },
  { stageKey: 'nao_qualificado', label: 'Não qualificado', labels: ['Não qualificado'], position: 6, isActive: true },
  { stageKey: 'encerrado', label: 'Encerrado', labels: ['Encerrado'], position: 7, isActive: true },
];

interface Estado {
  facts: Record<string, string>;
  pending: string[];
  reply: string;
  cut: string | null;
  stage: string | null;
  complete: boolean;
  proxima: ReturnType<typeof computeWaAiTriageNextAction>;
}

function turno(
  anterior: Record<string, string>,
  respostaDoModelo: string,
  conversa: WaAiTriageTurn[],
): Estado {
  const leitura = parseWaAiTriageReply(respostaDoModelo, CHAVES);

  const facts: Record<string, string> = { ...anterior };
  for (const [chave, valor] of Object.entries(leitura.updates)) {
    const field = waAiPlaybookField(ROTEIRO, chave);
    if (!field) continue;
    facts[field.key] = normalizeWaAiPlaybookValue(field, valor) || String(valor);
  }

  const estado = reconcileWaAiTriageState({
    knownFacts: facts, pendingItems: [], turns: conversa, playbookKeys: CHAVES,
  });
  const progresso = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: estado.knownFacts, now: HOJE, timeZone: TZ,
  });

  return {
    facts: estado.knownFacts,
    pending: progresso.pending,
    reply: leitura.message,
    cut: progresso.cut?.id ?? null,
    stage: progresso.stage,
    complete: progresso.complete,
    proxima: computeWaAiTriageNextAction(ROTEIRO, progresso),
  };
}

const fala = (pares: ['in' | 'out', string][]): WaAiTriageTurn[] =>
  pares.map(([direction, text], i) => ({
    direction, text, at: new Date(Date.UTC(2026, 7, 21, 14, i)).toISOString(),
  }));

const resposta = (mensagem: string, atualizacoes: Record<string, string>, campoAlvo = '') =>
  JSON.stringify({ mensagem_cliente: mensagem, campo_alvo: campoAlvo, atualizacoes });

// ── O roteiro ───────────────────────────────────────────────────────────────

test('o roteiro sobrevive à normalização com tudo que o motor precisa', () => {
  const normalizado = normalizeWaAiPlaybook(ROTEIRO);
  assert.ok(normalizado);
  assert.equal(normalizado!.id, 'rescisao_indireta');
  assert.equal(normalizado!.funnel, true, 'o funil da triagem é opt-in e este roteiro pediu');
  assert.ok(normalizado!.closingReply?.includes('advogado'));
  assert.equal(normalizado!.cuts.length, 1);
  assert.equal(normalizado!.cuts[0].effect, 'handoff');
  assert.ok(normalizado!.cuts[0].reply);
});

test('o JSON semeado na migration é EXATAMENTE o roteiro deste arquivo', () => {
  // As duas cópias existem porque o motor lê o roteiro do BANCO e o repositório
  // precisa poder testá-lo. Sem esta comparação elas divergiriam em silêncio, e
  // o agente em produção passaria a ser outro — sem nenhum sinal.
  const sql = readFileSync(new URL(
    '../../supabase/migrations/20260821150000_whatsapp_agente_rescisao_indireta.sql',
    import.meta.url), 'utf8');
  const bloco = /\$playbook\$([\s\S]*?)\$playbook\$/.exec(sql);
  assert.ok(bloco, 'a migration não traz o bloco $playbook$');
  assert.deepEqual(JSON.parse(bloco![1]), normalizeWaAiPlaybook(ROTEIRO));
});

test('a migration aponta o destino para o Pedro que existe no CRM', () => {
  const sql = readFileSync(new URL(
    '../../supabase/migrations/20260821150000_whatsapp_agente_rescisao_indireta.sql',
    import.meta.url), 'utf8');
  // O id NÃO é digitado na migration: ela procura o Pedro pelo e-mail e falha
  // alto se não achar, em vez de gravar um destino que não existe.
  assert.ok(sql.includes("where email = 'pedro@advcuiaba.com'"));
  assert.ok(sql.includes('raise exception'));
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(sql), false,
    'nenhum UUID literal na migration');
  // E o agente nasce sem enviar nada.
  assert.ok(sql.includes("mode        = 'test'"));
  assert.ok(sql.includes('values (v_channel, v_agent, false, 20)'));
});

test('a abertura é a mensagem combinada, e a primeira pergunta é o vínculo', () => {
  assert.ok(ROTEIRO.opening!.startsWith('Olá! Sou o assistente do Pedro Montalvão Advocacia.'));
  const vazio = computeWaAiTriageProgress({ playbook: ROTEIRO, facts: {}, now: HOJE, timeZone: TZ });
  assert.equal(vazio.nextField, 'vinculo_atual');
  const proxima = computeWaAiTriageNextAction(ROTEIRO, vazio);
  assert.equal(proxima.type, 'ask_field');
  assert.equal((proxima as { question: string }).question,
    'Para começar, você ainda está trabalhando nessa empresa?');
});

test('nenhuma PERGUNTA da triagem pede documento, CPF, senha ou dado bancário', () => {
  // O que se verifica é o que vai ao cliente: as perguntas e a abertura. O
  // texto de estilo cita "CPF" justamente para PROIBIR, e proibir é o oposto
  // de pedir — por isso ele fica de fora da varredura.
  const aoCliente = [
    ROTEIRO.opening || '',
    ROTEIRO.closingReply || '',
    ...ROTEIRO.fields.map(f => `${f.question || ''} ${f.ask}`),
    ...ROTEIRO.cuts.map(c => c.reply || ''),
  ].join(' ').toLowerCase();

  for (const proibido of ['cpf', 'senha', 'conta bancária', 'agência', 'pix', 'me envie', 'mande o arquivo']) {
    assert.equal(aoCliente.includes(proibido), false, `a triagem pede "${proibido}" ao cliente`);
  }
  // E nenhuma ação de documento entra na lista permitida deste agente.
  assert.equal(AGENTE.allowed_actions.includes('solicitar_documentos'), false);
  assert.equal(AGENTE.allowed_actions.includes('enviar_documento'), false);

  // O estilo, por sua vez, PRECISA trazer a proibição por escrito.
  const estilo = (ROTEIRO.style || []).join(' ').toLowerCase();
  assert.ok(estilo.includes('cpf'), 'o estilo tem de proibir o pedido de CPF por escrito');
});

test('quem já saiu ganha a pergunta da saída; quem ficou, não', () => {
  const saiu = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: { vinculo_atual: 'não' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(saiu.nextField, 'data_saida');
  const ficou = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: { vinculo_atual: 'sim' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(ficou.nextField, 'problema');
});

// ── A conversa qualificada ──────────────────────────────────────────────────

const CONVERSA_QUALIFICADA = fala([
  ['out', 'Olá! Sou o assistente do Pedro Montalvão Advocacia. Para começar, você ainda está trabalhando nessa empresa?'],
  ['in', 'Sim, ainda estou'],
  ['out', 'E o que está acontecendo no seu trabalho?'],
  ['in', 'O salário está atrasando todo mês e o gerente vive me humilhando na frente dos outros'],
  ['out', 'Há quanto tempo isso vem acontecendo?'],
  ['in', 'Uns oito meses'],
  ['out', 'A sua situação envolve algum destes pontos?'],
  ['in', 'Salário atrasado, principalmente'],
  ['out', 'Você tem alguma coisa que ajude a mostrar isso?'],
  ['in', 'Tenho os holerites e conversas no zap, e dois colegas viram tudo'],
  ['out', 'Em qual cidade e estado fica esse trabalho?'],
  ['in', 'Cuiabá, MT'],
  ['out', 'Para finalizar, qual é o seu nome?'],
  ['in', 'Fulana de Teste'],
]);

const FATOS_QUALIFICADOS = {
  vinculo_atual: 'sim',
  problema: 'Salário atrasando todo mês e humilhação pelo gerente',
  duracao: 'cerca de 8 meses',
  tipo_falta: 'salario_atrasado_ou_nao_pago',
  provas: 'holerites, conversas de WhatsApp e dois colegas como testemunhas',
  cidade_estado: 'Cuiabá/MT',
  nome: 'Fulana de Teste',
};

test('a triagem completa fecha sem corte e com todos os fatos gravados', () => {
  const estado = turno({}, resposta(
    'Obrigado! Já tenho o que preciso.', FATOS_QUALIFICADOS,
  ), CONVERSA_QUALIFICADA);

  assert.equal(estado.cut, null);
  assert.equal(estado.complete, true, 'nada mais a perguntar');
  assert.deepEqual(estado.pending, []);
  assert.equal(estado.facts.vinculo_atual, 'sim');
  assert.equal(estado.facts.tipo_falta, 'salario_atrasado_ou_nao_pago');
  assert.equal(estado.facts.nome, 'Fulana de Teste');
  assert.equal(estado.proxima.type, 'complete');
});

test('a triagem incompleta continua perguntando, uma coisa por vez', () => {
  const parcial = turno({}, resposta('Entendi.', {
    vinculo_atual: 'sim', problema: 'salário atrasado',
  }), CONVERSA_QUALIFICADA.slice(0, 4));

  assert.equal(parcial.complete, false);
  assert.equal(parcial.proxima.type, 'ask_field');
  assert.equal((parcial.proxima as { field: string }).field, 'duracao');
  assert.equal(parcial.pending.length > 0, true);
});

test('o fechamento transfere para o Pedro — e só para ele', () => {
  const planos = buildWaAiCompletionPlans(
    AGENTE, ROTEIRO, { knownFacts: FATOS_QUALIFICADOS, pendingItems: [] },
    { documents: 'none', kit: 'none' }, CONTATO,
  );

  assert.equal(planos.length, 1, 'uma ação só: nada de documento nem de KIT');
  assert.equal(planos[0].action, 'transferir_atendimento');
  assert.equal(planos[0].ref?.target_id, 'f6b77979-d683-4afa-b9a4-482ddae74534');
  assert.equal(planos[0].args.destino, PEDRO);
});

test('sem destino configurado a conversa volta para a fila humana, nunca fica com a IA', () => {
  const semDestino = { ...ROTEIRO, bindings: [] };
  const planos = buildWaAiCompletionPlans(
    AGENTE, semDestino, { knownFacts: FATOS_QUALIFICADOS, pendingItems: [] },
    { documents: 'none', kit: 'none' }, CONTATO,
  );
  assert.equal(planos.length, 1);
  assert.equal(planos[0].action, 'transferir_para_humano');
});

// ── O resumo que o Pedro lê ─────────────────────────────────────────────────

test('o resumo separa o que o contato disse do que o assistente concluiu', () => {
  const resumo = renderWaAiRescisaoSummary({
    facts: FATOS_QUALIFICADOS, pendingItems: [], fields: ROTEIRO.fields, contact: CONTATO,
  });

  // Cabeçalho: quem, telefone, onde, de onde veio e quando.
  assert.ok(resumo.includes('Fulana de Teste'));
  assert.ok(resumo.includes('5565999990001'));
  assert.ok(resumo.includes('Cuiabá/MT'));
  assert.ok(resumo.includes('canal Rescisão Indireta'));
  assert.ok(resumo.includes('21/08/2026'));

  // Fato e inferência em blocos rotulados e distintos.
  const iFato = resumo.indexOf('Informado pelo contato:');
  const iInferencia = resumo.indexOf('Leitura do assistente (não confirmada):');
  assert.ok(iFato >= 0 && iInferencia > iFato, 'os dois blocos existem, nesta ordem');

  // O relato, a duração e as provas ficam do lado dos FATOS.
  const fatos = resumo.slice(iFato, iInferencia);
  assert.ok(fatos.includes('Problema relatado'));
  assert.ok(fatos.includes('Há quanto tempo'));
  assert.ok(fatos.includes('Possíveis provas'));
  assert.ok(fatos.includes('Ainda trabalha na empresa: sim'));

  // A urgência e o motivo ficam do lado das INFERÊNCIAS, e não há veredito.
  const inferencias = resumo.slice(iInferencia);
  assert.ok(inferencias.includes('Urgência: alta'));
  assert.ok(inferencias.includes('Encaminhado porque'));
  assert.ok(inferencias.includes('depende da análise do advogado'));
  assert.equal(resumo.length <= 800, true, 'o resumo cabe no teto de 800 do catálogo');
});

test('relato comprido não empurra a ressalva para fora do resumo', () => {
  // O caso que motivou a reserva: alguém que escreve três parágrafos sobre o
  // que vem sofrendo. Antes, o corte em 800 comia o bloco de inferência — e com
  // ele a linha que diz que aquilo é leitura de máquina, não veredito.
  const comprido = {
    ...FATOS_QUALIFICADOS,
    problema: 'x'.repeat(900),
    duracao: 'y'.repeat(400),
    provas: 'z'.repeat(400),
  };
  const resumo = renderWaAiRescisaoSummary({
    facts: comprido, fields: ROTEIRO.fields, contact: CONTATO,
  });
  assert.ok(resumo.length <= 800);
  assert.ok(resumo.includes('Leitura do assistente (não confirmada):'));
  assert.ok(resumo.includes('depende da análise do advogado'));
  assert.ok(resumo.includes('Urgência:'));
  // E o relato aparece, só que aparado — não sumiu para caber a ressalva.
  assert.ok(resumo.includes('Problema relatado: xxx'));
});

test('o resumo não promete resultado, prazo nem valor', () => {
  const resumo = renderWaAiRescisaoSummary({
    facts: FATOS_QUALIFICADOS, fields: ROTEIRO.fields, contact: CONTATO,
  }).toLowerCase();
  for (const proibido of ['tem direito', 'vai ganhar', 'indenização garantida', 'com certeza']) {
    assert.equal(resumo.includes(proibido), false, `o resumo diz "${proibido}"`);
  }
});

test('a urgência é regra fixa: vínculo ativo mais ponto grave é alta', () => {
  assert.equal(waAiRescisaoUrgencia(FATOS_QUALIFICADOS).nivel, 'alta');
  assert.equal(waAiRescisaoUrgencia({
    ...FATOS_QUALIFICADOS, tipo_falta: 'reducao_salarial',
  }).nivel, 'media');
  assert.equal(waAiRescisaoUrgencia({
    ...FATOS_QUALIFICADOS, vinculo_atual: 'não',
  }).nivel, 'baixa');
  // O `bool` chega como booleano de verdade quando vem do banco.
  assert.equal(waAiRescisaoUrgencia({ ...FATOS_QUALIFICADOS, vinculo_atual: true }).nivel, 'alta');
});

test('a falta de provas NÃO derruba o encaminhamento', () => {
  const semProva = { ...FATOS_QUALIFICADOS, provas: 'não tenho nada guardado' };
  const progresso = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: semProva, now: HOJE, timeZone: TZ,
  });
  assert.equal(progresso.cut, null, 'não existe corte por falta de prova');
  assert.equal(progresso.complete, true);

  const planos = buildWaAiCompletionPlans(
    AGENTE, ROTEIRO, { knownFacts: semProva, pendingItems: [] },
    { documents: 'none', kit: 'none' }, CONTATO,
  );
  assert.equal(planos[0].action, 'transferir_atendimento');
  // E o motivo do encaminhamento não mente dizendo que há provas.
  assert.equal(waAiRescisaoMotivoDaQualificacao(semProva).includes('elementos'), true);
});

test('"nenhum desses" também segue para análise humana', () => {
  const ambiguo = { ...FATOS_QUALIFICADOS, tipo_falta: 'nenhum_desses' };
  const progresso = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: ambiguo, now: HOJE, timeZone: TZ,
  });
  assert.equal(progresso.cut, null, 'situação ambígua não é descarte');
  assert.equal(progresso.complete, true);
  assert.equal(waAiRescisaoMotivoDaQualificacao(ambiguo).includes('descumprimento'), false);
});

// ── O assunto fora do tema ──────────────────────────────────────────────────

test('assunto fora do tema não é descartado em silêncio: vira handoff', () => {
  const progresso = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: { tipo_atendimento: 'outro_assunto' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(progresso.cut?.id, 'assunto_fora_do_tema');
  assert.equal(progresso.cut?.effect, 'handoff', 'handoff manda para gente; disqualify encerraria');

  const proxima = computeWaAiTriageNextAction(ROTEIRO, progresso);
  assert.equal(proxima.type, 'handoff');

  // E o destino do corte é o mesmo Pedro, declarado pelo gatilho do binding.
  const binding = ROTEIRO.bindings!.find(b => b.trigger?.type === 'cut_handoff');
  assert.equal(binding?.trigger?.cutId, 'assunto_fora_do_tema');
  assert.equal(binding?.targetLabel, PEDRO);

  // A frase que vai ao cliente avisa do encaminhamento, sem julgar o relato.
  const reply = ROTEIRO.cuts[0].reply!;
  assert.ok(reply.includes('encaminhar'));
  assert.equal(reply.includes('?'), false, 'fim de conversa não faz pergunta');
});

// ── O card ──────────────────────────────────────────────────────────────────

test('o card percorre Novo contato → Em triagem → Qualificado → Transferido', () => {
  const passos: [Parameters<typeof pickWaAiFunnelStage>[0], string, string][] = [
    ['triagem_iniciada', 'Novo contato', 'Em triagem'],
    ['qualificado', 'Em triagem', 'Qualificado'],
    ['transferido', 'Qualificado', 'Transferido ao Pedro'],
  ];
  for (const [milestone, de, para] of passos) {
    const alvo = pickWaAiFunnelStage(milestone, FUNIL);
    assert.equal(alvo?.label, para, `${milestone} deveria apontar para ${para}`);
    assert.equal(
      shouldMoveWaAiFunnel({
        milestone, target: alvo, stages: FUNIL, currentLabels: [de],
        hasHumanOwner: milestone === 'transferido',
      }),
      true,
      `o card deveria sair de ${de} para ${para}`,
    );
  }
});

test('a cobrança automática marca o card como Aguardando resposta', () => {
  const alvo = pickWaAiFunnelStage('aguardando_resposta', FUNIL);
  assert.equal(alvo?.label, 'Aguardando resposta');
  assert.equal(
    shouldMoveWaAiFunnel({
      milestone: 'aguardando_resposta', target: alvo, stages: FUNIL, currentLabels: ['Em triagem'],
    }),
    true,
  );
});

test('o card não é movido quando um humano já assumiu a conversa', () => {
  const alvo = pickWaAiFunnelStage('triagem_iniciada', FUNIL);
  assert.equal(
    shouldMoveWaAiFunnel({
      milestone: 'triagem_iniciada', target: alvo, stages: FUNIL,
      currentLabels: ['Novo contato'], hasHumanOwner: true,
    }),
    false,
  );
});

// ── Acompanhamento ──────────────────────────────────────────────────────────

/**
 * A política EXATA gravada pela migration para este agente. Se a migration
 * mudar e este objeto não, o teste abaixo (que lê o SQL) reprova.
 */
const POLITICA: WaAiFollowupPolicy = normalizeWaAiFollowupPolicy({
  enabled: true,
  maxAttempts: 3,
  strategy: 'custom',
  customHours: [2, 24, 72],
  intervalHours: 24,
  days: [1, 2, 3, 4, 5],
  startMinute: 480,
  endMinute: 1080,
  timezone: 'America/Cuiaba',
  inactivityMinutes: 10,
});

test('a política do agente é a que a migration grava', () => {
  const sql = readFileSync(new URL(
    '../../supabase/migrations/20260821150000_whatsapp_agente_rescisao_indireta.sql',
    import.meta.url), 'utf8');
  assert.ok(sql.includes('followup_max_attempts   = 3'));
  assert.ok(sql.includes("followup_strategy       = 'custom'"));
  assert.ok(sql.includes('followup_custom_hours   = array[2, 24, 72]::numeric[]'));
  assert.ok(sql.includes('followup_days           = array[1, 2, 3, 4, 5]'));
  assert.ok(sql.includes('followup_start_minute   = 480'));
  assert.ok(sql.includes('followup_end_minute     = 1080'));
  assert.ok(sql.includes("timezone                = 'America/Cuiaba'"));
});

test('sem resposta: as três cobranças caem em horário comercial de Cuiabá', () => {
  // Sexta-feira, 21/08/2026, 17:30 em Cuiabá (20:30Z) — perto do fim do dia,
  // de propósito: os três degraus atravessam a noite e o fim de semana.
  //
  // A escada é ENCADEADA, como no `ensureAutoFollowup`: cada degrau conta a
  // partir do instante em que o anterior saiu (`fromIso: new Date()`), e não
  // todos a partir da mesma origem. Calculados da mesma origem, o degrau de 2h
  // e o de 24h de uma sexta às 17:30 caem os dois na segunda às 8h — o que é
  // aritmética correta de uma escada que ninguém executa assim.
  let quandoSaiu = new Date('2026-08-21T20:30:00Z');
  const agenda: Date[] = [];
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const proxima = nextFollowupAt(POLITICA, tentativa, quandoSaiu)!;
    agenda.push(proxima);
    quandoSaiu = proxima;
  }

  for (const [i, quando] of agenda.entries()) {
    assert.ok(quando instanceof Date, `tentativa ${i + 1} não foi agendada`);
    assert.equal(isWithinFollowupWindow(quando, POLITICA), true,
      `tentativa ${i + 1} caiu fora do horário comercial: ${quando.toISOString()}`);
    const p = localPartsInTz(quando, 'America/Cuiaba');
    assert.ok(p.dow >= 1 && p.dow <= 5, `tentativa ${i + 1} caiu no fim de semana`);
    assert.ok(p.hour >= 8 && p.hour < 18, `tentativa ${i + 1} caiu às ${p.hour}h`);
  }

  // A escada anda para a frente, nunca para trás.
  assert.ok(agenda[1].getTime() > agenda[0].getTime());
  assert.ok(agenda[2].getTime() > agenda[1].getTime());

  // E a quarta não existe: o teto é três.
  assert.equal(nextFollowupAt(POLITICA, 4, agenda[2]), null);
});

test('a primeira cobrança de quem escreveu à noite espera as 8h do dia útil', () => {
  // Sábado, 22/08/2026, 23:00 em Cuiabá (02:00Z de domingo).
  const madrugadaDeSabado = new Date('2026-08-23T02:00:00Z');
  const primeira = nextFollowupAt(POLITICA, 1, madrugadaDeSabado)!;
  const p = localPartsInTz(primeira, 'America/Cuiaba');
  assert.equal(p.dow, 1, 'a retomada de sábado à noite espera a segunda-feira');
  assert.equal(p.hour, 8);
  assert.equal(p.minute, 0);
});

/** O turno normal: o agente respondeu, ninguém assumiu, a triagem continua. */
const contextoBase: WaAiAutoFollowupContext = {
  mode: 'auto',
  replySent: true,
  policyEnabled: POLITICA.enabled,
  maxAttempts: POLITICA.maxAttempts,
  attemptsDone: 0,
  assistantActive: true,
  channelAiEnabled: true,
  aiActive: true,
  sessionStatus: 'active',
  conversationStatus: 'open',
  conversationBlocked: false,
  assignedUserId: null,
  awaitingAccept: false,
  handedOff: false,
  followupCancelled: false,
  optedOut: false,
};

test('a retomada é cancelada por transferência, por atendimento humano e por opt-out', () => {
  assert.equal(decideAutoFollowup(contextoBase).schedule, true, 'o caso normal agenda');

  const paradas: [string, Partial<typeof contextoBase>][] = [
    ['transferência da IA', { handedOff: true }],
    ['humano assumiu', { assignedUserId: 'f6b77979-d683-4afa-b9a4-482ddae74534' }],
    ['aguardando aceite', { awaitingAccept: true }],
    ['conversa encerrada', { conversationStatus: 'closed' }],
    ['contato bloqueado', { conversationBlocked: true }],
    ['o contato pediu para parar', { optedOut: true }],
    ['a IA foi desligada nesta conversa', { aiActive: false }],
    ['a sessão já foi entregue', { sessionStatus: 'handed_off' }],
    ['o próprio agente cancelou', { followupCancelled: true }],
    ['a chave do canal está desligada', { channelAiEnabled: false }],
    ['nada foi entregue ao cliente', { replySent: false }],
    ['teto de tentativas', { attemptsDone: 3 }],
  ];
  for (const [porque, patch] of paradas) {
    const decisao = decideAutoFollowup({ ...contextoBase, ...patch });
    assert.equal(decisao.schedule, false, `deveria parar: ${porque}`);
  }
});

test('no modo de teste nada é agendado — e nada sai', () => {
  // É o estado em que o agente nasce: registra o que FARIA e não toca em nada.
  assert.equal(decideAutoFollowup({ ...contextoBase, mode: 'test' }).schedule, false);
});

test('o cliente que responde volta ao degrau seguinte, não ao primeiro', () => {
  // `attemptsDone` conta cobranças ENVIADAS: responder cancela a pendente, mas
  // não devolve a escada ao começo — senão quem responde e some várias vezes
  // receberia cobrança sem fim.
  const segunda = decideAutoFollowup({ ...contextoBase, attemptsDone: 1 });
  assert.equal(segunda.schedule, true);
  assert.equal(segunda.schedule === true ? segunda.attempt : -1, 2);
});
