import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_CONTEXT_CONTA_BLOQUEADA,
  WA_AI_CONTEXT_SEM_REGISTRO,
  WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
  WA_AI_PLAYBOOK_SEM_REGISTRO,
  buildWaAiTriageConversationSchema,
  buildWaAiTriageExtractionSchema,
  buildWaAiTriageSchema,
  computeWaAiTriageNextAction,
  computeWaAiTriageProgress,
  evaluateWaAiCuts,
  normalizeWaAiPlaybook,
  normalizeWaAiPlaybookValue,
  resolveWaAiPlaybookBindings,
  waAiPlaybookField,
  waAiPlaybookFieldKeys,
  waAiPlaybookInstructions,
  waAiPlaybookPromptBlock,
  type WaAiPlaybook,
} from './waAiPlaybook.ts';

// ── A cópia dupla ───────────────────────────────────────────────────────────

test('wa-ai-playbook.ts é cópia byte a byte de waAiPlaybook.ts', () => {
  const src = readFileSync(new URL('./waAiPlaybook.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-playbook.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-playbook.ts divergiu de waAiPlaybook.ts — copie o arquivo inteiro');
});

const ROTEIRO = WA_AI_PLAYBOOK_SEM_REGISTRO;
const HOJE = new Date('2026-08-12T15:00:00Z');
const TZ = 'America/Cuiaba';

const progresso = (facts: Record<string, unknown>, now: Date = HOJE) =>
  computeWaAiTriageProgress({ playbook: ROTEIRO, facts, now, timeZone: TZ });

test('campanha de conta nasce completa a partir do contexto colado no editor', () => {
  const normalized = normalizeWaAiPlaybook(WA_AI_CONTEXT_CONTA_BLOQUEADA);
  assert.equal(normalized?.id, 'bloqueio_encerramento_conta');
  assert.equal(normalized?.fields.length, 14);
  assert.equal(normalized?.cuts.length, 5);
  assert.equal(normalized?.bindings?.length, 3);
  assert.deepEqual(normalized?.fields.map(field => field.key),
    WA_AI_PLAYBOOK_CONTA_BLOQUEADA.fields.map(field => field.key));
});

test('prazo da conta é calculado em tempo real e não pelo conhecimento do modelo', () => {
  const old = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { data_ocorrencia: '07/2024' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(old.cut?.id, 'prazo_2_anos_conta');
  const recent = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { data_ocorrencia: '09/2024' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(recent.cut, null);
});

test('instruções da conta preservam 40%, Réu, KIT e transferência só após assinatura', () => {
  const text = waAiPlaybookInstructions(WA_AI_PLAYBOOK_CONTA_BLOQUEADA);
  assert.match(text, /40% do valor obtido ao final/);
  assert.match(text, /campo Réu/);
  assert.match(text, /KIT CONSUMIDOR/);
  assert.match(text, /Somente quando o sistema retornar assinado/);
  assert.match(text, /escrita numa folha, assinada e enviada por foto/);
});

test('condicionais da residência mostram somente a rota escolhida', () => {
  const own = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { residencia_tipo: 'proprio' }, now: HOJE, timeZone: TZ,
  });
  assert.ok(!own.missing.includes('titular_comprovante'));
  assert.ok(!own.missing.includes('declarante_nome'));

  const third = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { residencia_tipo: 'terceiro_sem_contrato' }, now: HOJE, timeZone: TZ,
  });
  assert.ok(third.missing.includes('declarante_nome'));
  assert.ok(third.missing.includes('endereco_residencia'));
  assert.ok(third.missing.includes('declarante_tem_documento'));
});

// ── Valores ─────────────────────────────────────────────────────────────────

test('cada tipo aceita só o que sabe ler', () => {
  const inicio = waAiPlaybookField(ROTEIRO, 'inicio')!;
  assert.equal(normalizeWaAiPlaybookValue(inicio, '01/2020'), '01/2020');
  assert.equal(normalizeWaAiPlaybookValue(inicio, '1/2020'), '01/2020');
  assert.equal(normalizeWaAiPlaybookValue(inicio, 'Janeiro de 2020'), '01/2020');
  assert.equal(normalizeWaAiPlaybookValue(inicio, '05/01/2020'), '01/2020');
  // Ano solto não fecha a pergunta: falta metade da resposta.
  assert.equal(normalizeWaAiPlaybookValue(inicio, '2020'), '');
  assert.equal(normalizeWaAiPlaybookValue(inicio, 'faz uns três anos'), '');

  const ainda = waAiPlaybookField(ROTEIRO, 'ainda_trabalha')!;
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'Sim'), 'sim');
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'não'), 'não');
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'já saí'), 'não');
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'mais ou menos'), '');

  const tipo = waAiPlaybookField(ROTEIRO, 'tipo_empregador')!;
  assert.equal(normalizeWaAiPlaybookValue(tipo, 'Público'), 'publico');
  assert.equal(normalizeWaAiPlaybookValue(tipo, 'particular'), 'particular');
  assert.equal(normalizeWaAiPlaybookValue(tipo, 'prefeitura'), '');
});

test('valor que não serve ao campo volta a ser pendência, em vez de passar batido', () => {
  // "prefeitura" não é uma das opções: se contasse como preenchido, o corte de
  // órgão público ficaria sem disparar e a triagem seguiria em frente.
  const p = progresso({ nome: 'Ana', empregador: 'Prefeitura', tipo_empregador: 'prefeitura' });
  assert.equal(p.cut, null);
  assert.equal(p.nextField, 'tipo_empregador');
});

// ── Pendências e etapas ─────────────────────────────────────────────────────

test('a conversa começa pela primeira etapa, uma pergunta por vez', () => {
  const p = progresso({});
  assert.equal(p.stage, 'identificacao');
  assert.equal(p.nextField, 'nome');
  assert.equal(p.pending[0], 'o nome do cliente');
  assert.equal(p.complete, false);
});

test('campo preenchido sai da fila e a etapa anda', () => {
  const p = progresso({ nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular' });
  assert.equal(p.stage, 'periodo');
  assert.equal(p.nextField, 'inicio');
  assert.equal(p.missing.indexOf('nome'), -1);
});

test('a saída só é perguntada de quem já saiu', () => {
  const trabalhando = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'sim',
  });
  assert.equal(trabalhando.missing.indexOf('saida'), -1);
  assert.equal(trabalhando.stage, 'vinculo');

  const saiu = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'não',
  });
  assert.equal(saiu.nextField, 'saida');
});

test('quais provas só é cobrado de quem disse ter prova', () => {
  const base = {
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'sim', funcao: 'vendedora', pessoalidade: 'sim',
    recebia_pagamento: 'sim', pagamento: 'Pix, 2000', trabalho_regular: 'regular',
    habitualidade: 'seg a sex, 8h às 17h', subordinacao: 'sim',
  };
  const semProva = progresso({ ...base, tem_prova: 'não' });
  assert.equal(semProva.missing.indexOf('provas'), -1);
  assert.equal(semProva.nextField, 'tem_testemunha');

  const comProva = progresso({ ...base, tem_prova: 'sim' });
  assert.equal(comProva.nextField, 'provas');
});

test('roteiro cumprido não deixa pendência nenhuma', () => {
  const p = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'sim', funcao: 'vendedora', pessoalidade: 'sim',
    recebia_pagamento: 'sim', pagamento: 'Pix, 2000', trabalho_regular: 'regular',
    habitualidade: 'seg a sex, 8h às 17h', subordinacao: 'sim',
    tem_prova: 'sim', provas: 'conversas de WhatsApp', tem_testemunha: 'sim',
    outros_trabalhos: 'não',
  });
  assert.equal(p.complete, true);
  assert.deepEqual(p.pending, []);
  assert.equal(p.nextField, null);
});

// ── Cortes ──────────────────────────────────────────────────────────────────

test('órgão público encerra como não qualificado, sem transferência', () => {
  const p = progresso({ nome: 'Ana', empregador: 'Prefeitura', tipo_empregador: 'publico' });
  assert.equal(p.cut?.id, 'orgao_publico');
  assert.equal(p.cut?.effect, 'disqualify');
  assert.match(p.cut?.guidance || '', /NÃO QUALIFICADO — ÓRGÃO PÚBLICO/);
  assert.deepEqual(p.pending, []);
  assert.equal(p.nextField, null);
});

test('a janela de dois anos conta o mês inteiro a favor do cliente', () => {
  // Hoje é 12/08/2026; o corte é 12/08/2024.
  const dentro = { ainda_trabalha: 'não', saida: '08/2024', tipo_empregador: 'particular' };
  const fora = { ainda_trabalha: 'não', saida: '07/2024', tipo_empregador: 'particular' };

  assert.equal(evaluateWaAiCuts(ROTEIRO, dentro, HOJE, TZ), null);
  assert.equal(evaluateWaAiCuts(ROTEIRO, fora, HOJE, TZ)?.id, 'prazo_2_anos');
});

test('a data que o modelo errava: quem saiu em 2020 não passa', () => {
  const p = progresso({
    nome: 'Neto', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2020', ainda_trabalha: 'não', saida: '08/2020',
  });
  assert.equal(p.cut?.id, 'prazo_2_anos');
  assert.equal(p.cut?.effect, 'disqualify');
});

test('quem ainda trabalha lá nunca é cortado pelo prazo', () => {
  const p = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2018', ainda_trabalha: 'sim',
  });
  assert.equal(p.cut, null);
});

test('campo vazio não corta ninguém', () => {
  assert.equal(evaluateWaAiCuts(ROTEIRO, {}, HOJE, TZ), null);
  assert.equal(evaluateWaAiCuts(ROTEIRO, { tem_prova: 'não' }, HOJE, TZ), null);
});

test('uma prova OU uma testemunha segura o caso; faltar as duas é que corta', () => {
  const base = { tipo_empregador: 'particular', ainda_trabalha: 'sim' };
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, tem_prova: 'não', tem_testemunha: 'sim' }, HOJE, TZ), null);
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, tem_prova: 'sim', tem_testemunha: 'não' }, HOJE, TZ), null);
  assert.equal(
    evaluateWaAiCuts(ROTEIRO, { ...base, tem_prova: 'não', tem_testemunha: 'não' }, HOJE, TZ)?.id,
    'sem_prova_nem_testemunha');
});

test('órgão público vem antes do prazo e mantém o encerramento comercial correto', () => {
  const p = progresso({ tipo_empregador: 'publico', ainda_trabalha: 'não', saida: '01/2019' });
  assert.equal(p.cut?.id, 'orgao_publico');
});

test('os quatro elementos mínimos geram cortes objetivos e independentes do modelo', () => {
  const base = { tipo_empregador: 'particular', ainda_trabalha: 'sim' };
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'não' }, HOJE, TZ)?.id, 'sem_pessoalidade');
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'sim', recebia_pagamento: 'não' }, HOJE, TZ)?.id, 'sem_pagamento');
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'sim', recebia_pagamento: 'sim', trabalho_regular: 'esporadico' }, HOJE, TZ)?.id, 'trabalho_esporadico');
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'sim', recebia_pagamento: 'sim', trabalho_regular: 'regular', subordinacao: 'não' }, HOJE, TZ)?.id, 'sem_subordinacao');
});

// ── Schema ──────────────────────────────────────────────────────────────────

test('o schema fecha a lista de chaves e não deixa inventar campo', () => {
  const schema = buildWaAiTriageSchema(ROTEIRO) as unknown as {
    strict: boolean;
    schema: { properties: Record<string, any>; required: string[]; additionalProperties: boolean };
  };
  assert.equal(schema.strict, true);
  assert.equal(schema.schema.additionalProperties, false);
  assert.deepEqual(schema.schema.required, ['mensagem_cliente', 'campo_alvo', 'atualizacoes']);

  const atualizacoes = schema.schema.properties.atualizacoes;
  assert.equal(atualizacoes.additionalProperties, false);
  // Modo estrito: TODA chave declarada tem de estar em `required`.
  assert.deepEqual(
    atualizacoes.required.slice().sort(),
    Object.keys(atualizacoes.properties).sort());
  assert.deepEqual(atualizacoes.required, waAiPlaybookFieldKeys(ROTEIRO));
  assert.equal(atualizacoes.properties.empresa, undefined);
  assert.equal(atualizacoes.properties.data_inicio, undefined);
});

test('nada no schema é nulo: ausência é string vazia', () => {
  const schema = buildWaAiTriageSchema(ROTEIRO) as unknown as { schema: { properties: Record<string, any> } };
  const props = schema.schema.properties.atualizacoes.properties;
  for (const key of Object.keys(props)) {
    assert.equal(props[key].type, 'string', `${key} deveria ser string`);
    if (props[key].enum) assert.equal(props[key].enum[0], '', `${key} deveria aceitar vazio`);
  }
  assert.deepEqual(props.ainda_trabalha.enum, ['', 'sim', 'não']);
  assert.deepEqual(props.tipo_empregador.enum, ['', 'particular', 'publico']);
  assert.equal(schema.schema.properties.campo_alvo.enum[0], '');
});

// ── Bloco de prompt ─────────────────────────────────────────────────────────

test('o corte chega ao modelo como ordem, não como conta a fazer', () => {
  const p = progresso({ tipo_empregador: 'particular', ainda_trabalha: 'não', saida: '07/2024' });
  const bloco = waAiPlaybookPromptBlock(ROTEIRO, p);
  assert.match(bloco, /JÁ FOI ENCERRADO/);
  assert.match(bloco, /saiu há mais de dois anos/);
  assert.doesNotMatch(bloco, /compare|calcule/i);
});

test('o bloco lista só o que falta, na ordem', () => {
  const bloco = waAiPlaybookPromptBlock(ROTEIRO, progresso({ nome: 'Ana' }));
  assert.match(bloco, /Etapa atual: Quem é e para quem trabalhou/);
  assert.match(bloco, /- para quem trabalhou/);
  assert.doesNotMatch(bloco, /o nome do cliente/);
});

// ── O prompt montado a partir do roteiro ────────────────────────────────────

test('a pergunta mora ao lado do campo que ela busca', () => {
  const bloco = waAiPlaybookPromptBlock(ROTEIRO, progresso({ nome: 'Ana' }));
  assert.match(bloco, /Para qual empresa ou pessoa você trabalhou sem registro\?/);
  // Só a da vez: listar as outras aqui seria devolver ao modelo a escolha que
  // o roteiro acabou de fazer por ele.
  assert.doesNotMatch(bloco, /Em que mês e ano você começou/);
});

test('campo sem pergunta escrita não inventa aspas no prompt', () => {
  const semPergunta: WaAiPlaybook = {
    ...ROTEIRO,
    fields: ROTEIRO.fields.map(f => ({ ...f, question: undefined })),
  };
  const p = computeWaAiTriageProgress({ playbook: semPergunta, facts: {}, now: HOJE, timeZone: TZ });
  const bloco = waAiPlaybookPromptBlock(semPergunta, p);
  assert.match(bloco, /o nome do cliente/);
  assert.doesNotMatch(bloco, /A pergunta desta vez/);
});

test('o "o que fazer" sai do roteiro, com abertura, estilo e fechamento', () => {
  const texto = waAiPlaybookInstructions(ROTEIRO);
  assert.match(texto, /# Como você conversa/);
  assert.match(texto, /- Uma pergunta por vez/);
  assert.match(texto, /# Abertura/);
  assert.match(texto, /Vou fazer algumas perguntas rápidas/);
  assert.match(texto, /# Como perguntar cada coisa/);
  assert.match(texto, /# Quando o roteiro estiver completo/);
  assert.match(texto, /STATUS: LEAD QUALIFICADO/);
});

test('a linha em branco da abertura sobrevive — é ela que vira duas mensagens', () => {
  const lido = normalizeWaAiPlaybook({
    fields: [{ key: 'nome', type: 'texto' }],
    opening: 'Olá! Tudo bem?\n\nQual é o seu nome?',
  }) as WaAiPlaybook;
  assert.equal(lido.opening, 'Olá! Tudo bem?\n\nQual é o seu nome?');
});

test('roteiro sem abertura nem estilo não gera cabeçalho vazio', () => {
  const magro = normalizeWaAiPlaybook({ fields: [{ key: 'nome', type: 'texto', ask: 'o nome' }] }) as WaAiPlaybook;
  assert.equal(waAiPlaybookInstructions(magro), '');
});

// ── Roteiro vindo de fora ───────────────────────────────────────────────────

test('o roteiro em produção sobrevive à própria normalização', () => {
  assert.deepEqual(normalizeWaAiPlaybook(WA_AI_PLAYBOOK_SEM_REGISTRO), WA_AI_PLAYBOOK_SEM_REGISTRO);
});

test('o que não presta sai e o que sobra funciona', () => {
  const lido = normalizeWaAiPlaybook({
    id: 'Meu Roteiro',
    label: 'Teste',
    fields: [
      { key: 'Nome Completo', label: 'Nome', type: 'texto' },
      { key: 'nome_completo', label: 'Repetido', type: 'texto' },
      { key: '', label: 'Sem chave', type: 'texto' },
      { key: 'uf', label: 'UF', type: 'enum', options: [] },
    ],
    stages: [{ id: 'e1', label: 'Etapa', fields: ['nome_completo', 'campo_que_nao_existe'] }],
    cuts: [
      { id: 'c1', rule: { kind: 'older_than', field: 'campo_que_nao_existe', years: 2 }, reason: 'x' },
      { id: 'c2', rule: { kind: 'sei_la' }, reason: 'y' },
    ],
  }) as WaAiPlaybook;

  assert.equal(lido.id, 'meu_roteiro');
  assert.deepEqual(lido.fields.map(f => f.key), ['nome_completo']);
  assert.deepEqual(lido.stages, [{ id: 'e1', label: 'Etapa', fields: ['nome_completo'] }]);
  assert.deepEqual(lido.cuts, []);
});

test('roteiro sem campo nenhum não vira roteiro', () => {
  assert.equal(normalizeWaAiPlaybook(null), null);
  assert.equal(normalizeWaAiPlaybook({ fields: [] }), null);
  assert.equal(normalizeWaAiPlaybook({ fields: [{ label: 'sem chave' }] }), null);
});

test('roteiro sem etapa ganha uma, na ordem em que os campos foram escritos', () => {
  const lido = normalizeWaAiPlaybook({
    fields: [{ key: 'a', type: 'texto' }, { key: 'b', type: 'texto' }],
  }) as WaAiPlaybook;
  assert.deepEqual(lido.stages, [{ id: 'triagem', label: 'Triagem', fields: ['a', 'b'] }]);
});

test('contexto estruturado sozinho reconhece a campanha e herda os campos declarativos', () => {
  const raw = {
    agent_context: {
      schema_version: '1.0',
      campaign: { id: 'trabalhou_sem_registro', name: 'Trabalhou sem registro na carteira' },
    },
    authority: { playbook: { role: 'fonte_de_verdade_do_fluxo' } },
    information_registration: { updates: { field_name: 'atualizacoes' } },
  };
  const lido = normalizeWaAiPlaybook(raw) as WaAiPlaybook;
  assert.ok(lido.fields.some(f => f.key === 'nome'));
  assert.ok(lido.fields.some(f => f.key === 'inicio'));
  assert.deepEqual(lido.context, raw);
  assert.match(waAiPlaybookInstructions(lido), /fonte_de_verdade_do_fluxo/);
});

test('contexto oficial da campanha já nasce ligado aos campos automáticos', () => {
  const lido = normalizeWaAiPlaybook(WA_AI_CONTEXT_SEM_REGISTRO) as WaAiPlaybook;
  assert.equal(lido.id, 'sem_registro_carteira');
  assert.deepEqual(lido.context, WA_AI_CONTEXT_SEM_REGISTRO);
  assert.equal(lido.fields.length, 17);
  assert.equal(lido.stages.length, 5);
  assert.equal(lido.cuts.length, 7);
});

test('roteiro materializado antigo recebe os novos campos e cortes ao ser lido', () => {
  const antigo = JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_SEM_REGISTRO)) as WaAiPlaybook;
  antigo.fields = antigo.fields.filter(field =>
    !['funcao', 'recebia_pagamento', 'trabalho_regular'].includes(field.key));
  antigo.cuts = antigo.cuts.filter(cut =>
    !['sem_pessoalidade', 'sem_pagamento', 'trabalho_esporadico', 'sem_subordinacao'].includes(cut.id));
  const lido = normalizeWaAiPlaybook(antigo) as WaAiPlaybook;
  assert.ok(lido.fields.some(field => field.key === 'funcao'));
  assert.ok(lido.fields.some(field => field.key === 'recebia_pagamento'));
  assert.ok(lido.fields.some(field => field.key === 'trabalho_regular'));
  assert.ok(lido.cuts.some(cut => cut.id === 'sem_subordinacao'));
});

test('agente antigo da campanha herda contexto sem migração de banco', () => {
  const { context: _oldContext, ...oldStoredPlaybook } = WA_AI_PLAYBOOK_SEM_REGISTRO;
  const lido = normalizeWaAiPlaybook(oldStoredPlaybook) as WaAiPlaybook;
  assert.deepEqual(lido.context, WA_AI_CONTEXT_SEM_REGISTRO);
});

test('nomes operacionais ficam nos vínculos, não no JSON visível', () => {
  const contextText = JSON.stringify(WA_AI_CONTEXT_SEM_REGISTRO);
  assert.doesNotMatch(contextText, /Pedro Rodrigues Montalvao Neto/);
  assert.match(contextText, /\{\{destino_revisao_prazo\}\}/);
  assert.equal(
    resolveWaAiPlaybookBindings(ROTEIRO, 'ação=transferir({{destino_revisao_prazo}})'),
    'ação=transferir(Pedro Rodrigues Montalvao Neto)',
  );
});

test('JSON antigo com pessoa fixa é elevado automaticamente para configuração da tela', () => {
  const oldContext = JSON.parse(JSON.stringify(WA_AI_CONTEXT_SEM_REGISTRO)) as any;
  oldContext.triage_closure.post_closure_insistence.required_action = {
    type: 'transferir', target: 'Pedro Rodrigues Montalvao Neto',
    exact_action: 'ação=transferir(Pedro Rodrigues Montalvao Neto)',
  };
  oldContext.action_catalog.transferir_especifico = {
    syntax: 'ação=transferir(Pedro Rodrigues Montalvao Neto)',
    target: 'Pedro Rodrigues Montalvao Neto',
  };
  const lido = normalizeWaAiPlaybook(oldContext) as WaAiPlaybook;
  const text = JSON.stringify(lido.context);
  assert.doesNotMatch(text, /Pedro Rodrigues Montalvao Neto/);
  assert.match(text, /destino_revisao_prazo/);
  assert.equal(lido.bindings?.length, 2);
});

test('agente antigo não mantém transferência configurável para órgão público', () => {
  const old = JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_SEM_REGISTRO)) as any;
  old.bindings.unshift({
    key: 'destino_orgao_publico', label: 'Órgão público',
    action: 'transferir_atendimento', required: true,
  });
  const cut = old.cuts.find((item: any) => item.id === 'orgao_publico');
  cut.effect = 'handoff';
  cut.guidance = 'Transfira para alguém.';
  const lido = normalizeWaAiPlaybook(old) as WaAiPlaybook;
  assert.equal(lido.bindings?.some(binding => binding.key === 'destino_orgao_publico'), false);
  assert.equal(lido.cuts.find(item => item.id === 'orgao_publico')?.effect, 'disqualify');
});

test('fechamento antigo também passa a usar a escolha configurável', () => {
  const lido = normalizeWaAiPlaybook({
    ...WA_AI_PLAYBOOK_SEM_REGISTRO,
    closing: 'Ao terminar faça ação=transferir(Atendimento).',
  }) as WaAiPlaybook;
  assert.equal(lido.closing, 'Ao terminar faça ação=transferir({{destino_triagem_concluida}}).');
  assert.match(waAiPlaybookInstructions(lido), /ação=transferir\(Atendimento\)/);
});

test('placeholder de template cria seletor sem precisar alterar a tela', () => {
  const lido = normalizeWaAiPlaybook({
    id: 'contrato',
    fields: [{ key: 'nome', type: 'texto' }],
    closing: 'Envie ação=enviar_documento({{modelo_contrato}}).',
  }) as WaAiPlaybook;
  assert.deepEqual(lido.bindings, [{
    key: 'modelo_contrato',
    label: 'Modelo contrato',
    description: 'Escolha usada quando o roteiro executar ação=enviar_documento.',
    action: 'enviar_documento',
    required: true,
  }]);
});

test('schema de extração nasce dos campos e diferencia false de null', () => {
  const schema = buildWaAiTriageExtractionSchema(ROTEIRO).schema as any;
  const updates = schema.properties.atualizacoes;
  assert.deepEqual(updates.properties.ainda_trabalha.type, ['boolean', 'null']);
  assert.ok(updates.required.includes('nome'));
  assert.equal(updates.additionalProperties, false);

  const conversation = buildWaAiTriageConversationSchema(ROTEIRO).schema as any;
  assert.deepEqual(conversation.required, ['mensagem_cliente', 'campo_alvo']);
  assert.equal('atualizacoes' in conversation.properties, false);
});

test('ação seguinte é derivada do primeiro campo pendente', () => {
  const p = progresso({ nome: 'Ana' });
  const action = computeWaAiTriageNextAction(ROTEIRO, p);
  assert.equal(action.type, 'ask_field');
  if (action.type === 'ask_field') assert.equal(action.field, 'empregador');
});

test('fato condicional antigo não dispara corte quando deixou de se aplicar', () => {
  const cut = evaluateWaAiCuts(
    ROTEIRO,
    { ainda_trabalha: true, saida: '01/2020' },
    HOJE,
    TZ,
  );
  assert.equal(cut, null);
});
