import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_FACT_ALIASES,
  canonicalizeWaAiFacts,
  extractWaAiDecisionFacts,
  extractWaAiPeriodFacts,
  findWaAiMonthYears,
  isWaAiExcludedLiquidationInstitution,
  normalizeWaAiFactValue,
  parseWaAiMonthYear,
  pruneWaAiPendingItems,
  reconcileWaAiTriageState,
  waAiAlreadyAnswered,
  type WaAiTriageTurn,
} from './waAiTriageFacts.ts';

// ── A cópia dupla ───────────────────────────────────────────────────────────

test('wa-ai-triage-facts.ts é cópia byte a byte de waAiTriageFacts.ts', () => {
  const src = readFileSync(new URL('./waAiTriageFacts.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-triage-facts.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-triage-facts.ts divergiu de waAiTriageFacts.ts — copie o arquivo inteiro');
});

// ── Datas ───────────────────────────────────────────────────────────────────

test('mês e ano em todas as formas que o cliente escreve', () => {
  assert.equal(parseWaAiMonthYear('Janeiro de 2020'), '01/2020');
  assert.equal(parseWaAiMonthYear('janeiro 2020'), '01/2020');
  assert.equal(parseWaAiMonthYear('jan/2020'), '01/2020');
  assert.equal(parseWaAiMonthYear('01/2020'), '01/2020');
  assert.equal(parseWaAiMonthYear('05/01/2020'), '01/2020');
  assert.equal(parseWaAiMonthYear('Agosto de 2026'), '08/2026');
  assert.equal(parseWaAiMonthYear('março de 2021'), '03/2021');
  assert.equal(parseWaAiMonthYear('DEZEMBRO DE 2023'), '12/2023');
});

test('erro de uma letra no mês não esconde a data do corte', () => {
  assert.equal(parseWaAiMonthYear('marcço de 2023'), '03/2023');
  assert.equal(parseWaAiMonthYear('feverero de 2024'), '02/2024');
  assert.equal(parseWaAiMonthYear('desembro de 2022'), '12/2022');
  assert.equal(parseWaAiMonthYear('trabalho de 2023'), null);
});

test('ano solto não vira data: metade da resposta não fecha a pergunta', () => {
  assert.equal(parseWaAiMonthYear('foi em 2020'), null);
  assert.equal(parseWaAiMonthYear('faz uns três anos'), null);
  assert.equal(parseWaAiMonthYear('13/2020'), null);
});

test('na ocorrência bancária, ano solto fica registrado para o relógio do backend', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Em que mês e ano isso aconteceu?'],
    ['in', 'Olha, o mês eu não me recordo, mas foi agora, em 2026.'],
  ]));
  assert.equal(facts.data_ocorrencia, '2026');
  // A regra continua restrita à pergunta da ocorrência: ano solto genérico não
  // vira início ou saída trabalhista.
  assert.equal(parseWaAiMonthYear('2026'), null);
});

test('as datas saem na ordem em que foram escritas', () => {
  const achadas = findWaAiMonthYears('de janeiro de 2020 até 12/2023');
  assert.deepEqual(achadas.map(d => d.valor), ['01/2020', '12/2023']);
  assert.ok(achadas[0].index < achadas[1].index);
});

// ── Chaves ──────────────────────────────────────────────────────────────────

test('os apelidos do modelo viram uma chave só', () => {
  const facts = canonicalizeWaAiFacts({
    empresa: 'Todimo', data_inicio: 'Janeiro de 2020', tipo_empresa: 'particular',
  });
  assert.deepEqual(facts, {
    empregador: 'Todimo', inicio: '01/2020', tipo_empregador: 'particular',
  });
});

test('chave que já existe não é sobrescrita pelo apelido', () => {
  const facts = canonicalizeWaAiFacts({ empregador: 'Todimo', empresa: 'Outra' });
  assert.equal(facts.empregador, 'Todimo');
  assert.equal(Object.keys(facts).length, 1);
});

test('"Data de Início" e data_inicio são a mesma chave', () => {
  assert.deepEqual(canonicalizeWaAiFacts({ 'Data de Início': '01/2020' }), { inicio: '01/2020' });
});

test('vazio, null e objeto nunca entram — e nunca apagam', () => {
  const facts = canonicalizeWaAiFacts({
    nome: 'Neto', inicio: null, saida: undefined, empregador: '   ', extra: { a: 1 },
  });
  assert.deepEqual(facts, { nome: 'Neto' });
});

test('booleano e número permanecem tipados', () => {
  const facts = canonicalizeWaAiFacts({ provas: true, dias_semana: 5 });
  assert.deepEqual(facts, { provas: true, dias_semana: 5 });
});

test('"ainda trabalha" preserva booleano real e normaliza texto legado', () => {
  assert.equal(normalizeWaAiFactValue('ainda_trabalha', 'Já saí'), 'não');
  assert.equal(normalizeWaAiFactValue('ainda_trabalha', 'saiu'), 'não');
  assert.equal(normalizeWaAiFactValue('ainda_trabalha', false), false);
  assert.equal(normalizeWaAiFactValue('ainda_trabalha', true), true);
  assert.equal(normalizeWaAiFactValue('ainda_trabalha', 'Sim'), 'sim');
});

test('o que não é reconhecido fica como o cliente disse', () => {
  assert.equal(normalizeWaAiFactValue('inicio', 'faz uns 3 anos'), 'faz uns 3 anos');
  assert.equal(normalizeWaAiFactValue('horario_entrada', '8h'), '8h');
});

test('a tabela de apelidos aponta só para chaves canônicas', () => {
  const canonicas = new Set(Object.values(WA_AI_FACT_ALIASES));
  for (const canonica of canonicas) {
    assert.ok(!(canonica in WA_AI_FACT_ALIASES), `${canonica} é apelido e destino ao mesmo tempo`);
  }
});

// ── Extração ────────────────────────────────────────────────────────────────

function conversa(pares: [WaAiTriageTurn['direction'], string][]): WaAiTriageTurn[] {
  const base = Date.parse('2026-08-12T20:00:00Z');
  return pares.map(([direction, text], i) => ({
    direction, text, at: new Date(base + i * 60_000).toISOString(),
  }));
}

test('a conversa de 12/08/2026: as três datas que se perderam', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Pode me dizer qual mês e ano foi o início do seu trabalho na Todimo?'],
    ['in', 'Janeiro de 2020'],
    ['out', 'Você ainda trabalha na Todimo ou já saiu de lá?'],
    ['in', 'Já saí'],
    ['out', 'Pode me informar em que mês e ano você saiu da Todimo?'],
    ['in', 'Agosto de 2026'],
  ]));
  assert.deepEqual(facts, { inicio: '01/2020', ainda_trabalha: 'não', saida: '08/2026' });
});

test('data respondida à pergunta "ainda trabalha ou já saiu" é a saída', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Você ainda trabalha lá ou já saiu?'],
    ['in', 'Dezembro de 2023'],
  ]));
  assert.equal(facts.saida, '12/2023');
  assert.equal(facts.ainda_trabalha, 'não');
  assert.equal(facts.inicio, undefined);
});

test('"marcço de 2023" respondido à pergunta de saída é salvo como 03/2023', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Você ainda trabalha lá ou já saiu?'],
    ['in', 'marcço de 2023'],
  ]));
  assert.equal(facts.saida, '03/2023');
  assert.equal(facts.ainda_trabalha, 'não');
});

test('a resposta manda mais que a pergunta: "saí em dezembro" não vira início', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Em que mês e ano você começou a trabalhar lá? E quando saiu?'],
    ['in', 'Saí em dezembro de 2023'],
  ]));
  assert.equal(facts.saida, '12/2023');
  assert.equal(facts.inicio, undefined);
});

test('duas datas numa resposta só entram na ordem da pergunta', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Em que mês e ano você começou? E quando saiu?'],
    ['in', 'Janeiro de 2020 e dezembro de 2023'],
  ]));
  assert.equal(facts.inicio, '01/2020');
  assert.equal(facts.saida, '12/2023');
});

test('quem ainda trabalha lá não ganha data de saída', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Você ainda trabalha lá ou já saiu?'],
    ['in', 'Ainda trabalho'],
  ]));
  assert.deepEqual(facts, { ainda_trabalha: 'sim' });
});

test('“não saí” corrige a compreensão anterior em vez de confirmar uma saída', () => {
  const turns = conversa([
    ['out', 'Você ainda trabalha lá ou já saiu?'],
    ['in', 'Fez eu sair de um serviço registrado pra trabalhar lá'],
    ['out', 'Entendi que você já saiu de lá. Quando saiu?'],
    ['in', 'Não saí'],
  ]);
  assert.deepEqual(extractWaAiPeriodFacts(turns), { ainda_trabalha: 'sim' });

  const estado = reconcileWaAiTriageState({
    knownFacts: { ainda_trabalha: 'não', saida: '07/2026' },
    pendingItems: [], turns, playbookKeys: ['ainda_trabalha', 'saida'],
  });
  assert.equal(estado.knownFacts.ainda_trabalha, 'sim');
  assert.equal(estado.knownFacts.saida, undefined);
});

test('a data confirmada pelo cliente conta', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Você saiu da Todimo em agosto de 2026, certo?'],
    ['in', 'Sim'],
  ]));
  assert.equal(facts.saida, '08/2026');
});

test('resposta ambígua não vira dado: "sim" sozinho não decide nada', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Você lembra em que mês e ano começou a trabalhar lá?'],
    ['in', 'Sim'],
  ]));
  assert.deepEqual(facts, {});
});

test('data sem pergunta de período é ignorada', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Você tem alguma prova desse trabalho?'],
    ['in', 'Tenho um Pix de 03/2021'],
  ]));
  assert.deepEqual(facts, {});
});

test('a fala mais nova corrige a mais velha', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Quando você começou?'],
    ['in', 'Janeiro de 2020'],
    ['out', 'Só confirmando, quando você começou mesmo?'],
    ['in', 'Na verdade comecei em março de 2021'],
  ]));
  assert.equal(facts.inicio, '03/2021');
});

test('a ordem cronológica manda, não a ordem do array', () => {
  const cronologica = conversa([
    ['out', 'Quando você começou a trabalhar lá?'],
    ['in', 'Janeiro de 2020'],
  ]);
  assert.deepEqual(
    extractWaAiPeriodFacts(cronologica.slice().reverse()),
    extractWaAiPeriodFacts(cronologica));
});

// ── Respostas de decisão em linguagem comum ────────────────────────────────

test('entende várias formas populares de responder os critérios de corte', () => {
  const casos: [string, string, string, string][] = [
    ['Era empresa privada ou prefeitura?', 'era uma loja privada normal', 'tipo_empregador', 'particular'],
    ['Era da iniciativa privada ou do governo?', 'era da prefeitura mesmo', 'tipo_empregador', 'publico'],
    ['Se você faltasse, podia colocar alguém no seu lugar?', 'não, tinha que ser eu', 'pessoalidade', 'sim'],
    ['Era você mesmo ou alguém podia substituir você?', 'meu primo ia lá por mim', 'pessoalidade', 'não'],
    ['Você ganhava alguma coisa por esse serviço?', 'uns 2 mil por mês', 'recebia_pagamento', 'sim'],
    ['Você recebia algum pagamento?', 'não, era voluntário', 'recebia_pagamento', 'não'],
    ['Com que frequência esse trabalho acontecia?', 'três vezes por semana', 'trabalho_regular', 'regular'],
    ['Era toda semana ou só de vez em quando?', 'era um bico, só quando chamava', 'trabalho_regular', 'esporadico'],
    ['Tinha chefe ou alguém que dizia o que fazer?', 'o gerente dava ordens e cobrava', 'subordinacao', 'sim'],
    ['Tinha chefe ou alguém que dizia o que fazer?', 'ninguém mandava, eu fazia meu horário', 'subordinacao', 'não'],
    ['Ficou alguma prova, comprovante ou conversa?', 'tenho recibo e extrato', 'tem_prova', 'sim'],
    ['Tem alguma prova desse trabalho?', 'não tenho nada guardado', 'tem_prova', 'não'],
    ['Alguém viu você trabalhando e pode confirmar?', 'minha esposa me viu', 'tem_testemunha', 'sim'],
    ['Tem testemunha ou alguém que trabalhou com você?', 'ninguém', 'tem_testemunha', 'não'],
    ['Além desse, teve mais algum trabalho assim?', 'foi só esse', 'outros_trabalhos', 'não'],
  ];

  for (const [pergunta, resposta, campo, esperado] of casos) {
    const facts = extractWaAiDecisionFacts(conversa([['out', pergunta], ['in', resposta]]));
    assert.equal(facts[campo as keyof typeof facts], esperado, `${pergunta} → ${resposta}`);
  }
});

test('dúvida, incompreensão e sim/não perigoso não viram corte', () => {
  const ambiguas: [string, string][] = [
    ['Era privada ou pública?', 'não entendi'],
    ['Era você mesmo ou podia mandar outra pessoa?', 'sim'],
    ['Era você mesmo ou podia mandar outra pessoa?', 'não'],
    ['Trabalhava toda semana ou de vez em quando?', 'não lembro'],
    ['Tinha chefe?', 'talvez'],
  ];
  for (const [pergunta, resposta] of ambiguas) {
    assert.deepEqual(
      extractWaAiDecisionFacts(conversa([['out', pergunta], ['in', resposta]])),
      {},
      `${pergunta} → ${resposta}`,
    );
  }
});

test('a fala direta do cliente vence classificação errada do modelo', () => {
  const estado = reconcileWaAiTriageState({
    knownFacts: { trabalho_regular: 'regular', subordinacao: 'sim' },
    pendingItems: [],
    turns: conversa([
      ['out', 'Era toda semana ou só de vez em quando?'],
      ['in', 'só quando chamava, era um bico'],
      ['out', 'Tinha chefe ou alguém que dizia o que fazer?'],
      ['in', 'ninguém mandava, eu fazia meu horário'],
    ]),
  });
  assert.equal(estado.knownFacts.trabalho_regular, 'esporadico');
  assert.equal(estado.knownFacts.subordinacao, 'não');
});

test('entende respostas populares da campanha de conta sem depender do modelo', () => {
  const casos: [string, string, string, string][] = [
    ['A conta foi bloqueada ou encerrada de vez?', 'o app travou tudo, não consigo mexer', 'tipo_ocorrencia', 'bloqueio'],
    ['A conta foi bloqueada ou encerrada de vez?', 'o banco fechou minha conta', 'tipo_ocorrencia', 'encerramento'],
    ['A conta foi bloqueada ou encerrada de vez?', 'encerraram a conta', 'tipo_ocorrencia', 'encerramento'],
    ['A conta foi bloqueada ou encerrada de vez?', 'bloquearam sem explicar', 'tipo_ocorrencia', 'bloqueio'],
    ['O banco enviou algum e-mail, SMS ou notificação?', 'foi do nada, só descobri no aplicativo', 'recebeu_comunicacao', 'não'],
    ['Quando essa comunicação chegou, sua conta ainda funcionava normalmente?', 'já estava bloqueada quando chegou', 'momento_comunicacao', 'posterior'],
    ['Tem algum print, e-mail ou tela?', 'tenho screenshot da mensagem do banco', 'tem_print', 'sim'],
    ['Você consegue apresentar um print do aplicativo ou da comunicação mostrando o bloqueio ou encerramento?', 'tenho sim, salvei o e-mail e tirei print da tela do aplicativo', 'tem_print', 'sim'],
    ['Ficou algum saldo preso?', 'não tinha nada lá', 'saldo_retido', 'não'],
    ['Qual comprovante de residência você tem?', 'moro de aluguel e tenho contrato', 'residencia_tipo', 'aluguel_com_contrato'],
    ['Qual comprovante de residência você tem?', 'casa de favor e não tenho contrato', 'residencia_tipo', 'terceiro_sem_contrato'],
    ['O declarante consegue mandar o documento?', 'consigo mandar sim', 'declarante_tem_documento', 'sim'],
    ['Os honorários são 40%. Está de acordo?', 'concordo', 'aceita_honorarios', 'sim'],
  ];
  for (const [question, answer, field, expected] of casos) {
    const facts = extractWaAiDecisionFacts(conversa([['out', question], ['in', answer]]));
    assert.equal(facts[field as keyof typeof facts], expected, `${question} → ${answer}`);
  }
});

test('preserva a decisão quando contexto e pergunta saem em bolhas separadas', () => {
  const facts = extractWaAiDecisionFacts(conversa([
    ['out', 'Sobre os honorários: o escritório recebe 40% sobre o êxito, incluindo FGTS e seguro-desemprego.'],
    ['out', 'Você está de acordo?'],
    ['in', 'Sim'],
  ]));
  assert.equal(facts.aceita_honorarios, 'sim');
});

test('pergunta genérica de uma nova rodada não herda decisão anterior', () => {
  const facts = extractWaAiDecisionFacts(conversa([
    ['out', 'Os honorários são 40% sobre o êxito.'],
    ['out', 'Você está de acordo?'],
    ['in', 'Sim'],
    ['out', 'Pode me explicar melhor?'],
    ['in', 'Não'],
  ]));
  assert.equal(facts.aceita_honorarios, 'sim');
});

test('lista de liquidação usa correspondência segura e deriva aviso pela cronologia', () => {
  assert.equal(isWaAiExcludedLiquidationInstitution('Banco Master'), true);
  assert.equal(isWaAiExcludedLiquidationInstitution('Will Bank'), true);
  assert.equal(isWaAiExcludedLiquidationInstitution('Banco Pleno'), true);
  assert.equal(isWaAiExcludedLiquidationInstitution('Mastercard'), false);
  assert.equal(isWaAiExcludedLiquidationInstitution('Banco Willian'), false);

  const state = reconcileWaAiTriageState({
    knownFacts: {
      banco_reu: 'Banco Master', recebeu_comunicacao: 'sim',
      momento_comunicacao: 'posterior', aviso_previo: 'sim',
    },
    pendingItems: [], turns: [],
    playbookKeys: ['banco_reu', 'instituicao_liquidada', 'recebeu_comunicacao',
      'momento_comunicacao', 'aviso_previo'],
  });
  assert.equal(state.knownFacts.instituicao_liquidada, 'sim');
  assert.equal(state.knownFacts.aviso_previo, 'não');
});

test('erro de escrita no mês da conta ainda alimenta o corte em tempo real', () => {
  const facts = extractWaAiPeriodFacts(conversa([
    ['out', 'Em que mês e ano aconteceu o bloqueio?'],
    ['in', 'foi em feverero de 2024'],
  ]));
  assert.equal(facts.data_ocorrencia, '02/2024');
});

test('“sim” sozinho em pergunta de duas opções da conta não inventa ocorrência', () => {
  assert.deepEqual(extractWaAiDecisionFacts(conversa([
    ['out', 'A conta foi bloqueada ou encerrada de vez?'], ['in', 'sim'],
  ])), {});
});

// ── Pendências ──────────────────────────────────────────────────────────────

test('pendência respondida sai da lista', () => {
  const items = pruneWaAiPendingItems(
    ['mês e ano de início', 'se ainda trabalha lá ou mês e ano de saída', 'Provas e testemunhas'],
    { inicio: '01/2020', ainda_trabalha: 'não', saida: '08/2026' });
  assert.deepEqual(items, ['Provas e testemunhas']);
});

test('pendência de dois campos só cai quando os dois existem', () => {
  const items = pruneWaAiPendingItems(
    ['se ainda trabalha lá ou mês e ano de saída'],
    { ainda_trabalha: 'não' });
  assert.deepEqual(items, ['se ainda trabalha lá ou mês e ano de saída']);
});

test('pendência que não fala de campo nenhum fica onde está', () => {
  const items = pruneWaAiPendingItems(
    ['Dias e horários de trabalho', 'Se recebia e como'], { inicio: '01/2020' });
  assert.deepEqual(items, ['Dias e horários de trabalho', 'Se recebia e como']);
});

test('a pergunta que cobra dado já gravado não vira texto de retomada', () => {
  const facts = { inicio: '01/2020', saida: '08/2026', ainda_trabalha: 'não' };
  assert.equal(
    waAiAlreadyAnswered('Para finalizar, quando você começou a trabalhar lá? Mês e ano, por favor.', facts),
    true);
  assert.equal(waAiAlreadyAnswered('Você tem alguma prova desse trabalho?', facts), false);
  assert.equal(waAiAlreadyAnswered('Quando você saiu?', { inicio: '01/2020' }), false);
  assert.equal(waAiAlreadyAnswered('', facts), false);
});

test('pendência repetida entra uma vez só', () => {
  assert.deepEqual(pruneWaAiPendingItems(['provas', 'provas', '  '], {}), ['provas']);
});

// ── A costura ───────────────────────────────────────────────────────────────

test('o turno que reproduzia o defeito: o modelo esquece, o backend não', () => {
  // O que o modelo anotou às 20:20 — treze campos, nenhuma data, e as duas
  // pendências que ele mesmo já tinha respondido oito minutos antes.
  const estado = reconcileWaAiTriageState({
    knownFacts: {
      dias: 'segunda a sexta', nome: 'Neto', provas: true, empregador: 'Todimo',
      supervisao: true, dias_semana: 5, testemunhas: true, pessoalidade: true,
      horario_saida: '17h', forma_pagamento: 'Pix', horario_entrada: '8h',
      valor_pagamento: '2000', recebia_pagamento: true,
    },
    pendingItems: ['mês e ano de início', 'se ainda trabalha lá ou mês e ano de saída'],
    turns: conversa([
      ['out', 'Pode me dizer qual mês e ano foi o início do seu trabalho na Todimo?'],
      ['in', 'Janeiro de 2020'],
      ['out', 'Você ainda trabalha na Todimo ou já saiu de lá?'],
      ['in', 'Já saí'],
      ['out', 'Pode me informar em que mês e ano você saiu da Todimo?'],
      ['in', 'Agosto de 2026'],
    ]),
  });

  assert.equal(estado.knownFacts.inicio, '01/2020');
  assert.equal(estado.knownFacts.saida, '08/2026');
  assert.equal(estado.knownFacts.ainda_trabalha, 'não');
  assert.equal(estado.knownFacts.nome, 'Neto');
  assert.equal(estado.knownFacts.empregador, 'Todimo');
  assert.deepEqual(estado.pendingItems, []);
});

test('leitura vazia não apaga o que já estava gravado', () => {
  const estado = reconcileWaAiTriageState({
    knownFacts: { inicio: '01/2020', saida: '08/2026', ainda_trabalha: 'não' },
    pendingItems: ['Provas do trabalho'],
    turns: conversa([
      ['out', 'Você tem alguma prova desse trabalho?'],
      ['in', 'Tenho sim'],
    ]),
  });
  assert.equal(estado.knownFacts.inicio, '01/2020');
  assert.equal(estado.knownFacts.saida, '08/2026');
  assert.equal(estado.knownFacts.ainda_trabalha, 'não');
});

test('a fala do cliente corrige o que o modelo anotou errado', () => {
  const estado = reconcileWaAiTriageState({
    knownFacts: { inicio: '01/2025' },
    pendingItems: [],
    turns: conversa([
      ['out', 'Em que mês e ano você começou a trabalhar lá?'],
      ['in', 'Janeiro de 2020'],
    ]),
  });
  assert.equal(estado.knownFacts.inicio, '01/2020');
});

test('sem histórico, o estado sobrevive inteiro', () => {
  const estado = reconcileWaAiTriageState({
    knownFacts: { inicio: 'Janeiro de 2020', empresa: 'Todimo' },
    pendingItems: ['mês e ano de saída'],
    turns: [],
  });
  assert.deepEqual(estado.knownFacts, { inicio: '01/2020', empregador: 'Todimo' });
  assert.deepEqual(estado.pendingItems, ['mês e ano de saída']);
});
