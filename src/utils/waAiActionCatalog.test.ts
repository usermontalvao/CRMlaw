import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_ACTIONS,
  WA_AI_ACTION_NAMES,
  WA_AI_MAX_ACTIONS_PER_RUN,
  WA_AI_MODELS,
  WA_AI_PROVIDERS,
  actionsUsedInPrompt,
  buildWaAiTools,
  estimateWaAiTurnCostUsd,
  getWaAiAction,
  isWaAiModelAllowed,
  normalizeWaAiAllowedActions,
  parseWaAiPromptExpressions,
  pruneWaAiActionRefs,
  resolveWaAiActionByAlias,
  targetLabelsFor,
  validateWaAiActionCall,
  validateWaAiPrompt,
  type WaAiActionRef,
} from './waAiActionCatalog.ts';

const PEDRO: WaAiActionRef = {
  action: 'transferir_atendimento',
  target_type: 'user',
  target_id: '11111111-1111-4111-8111-111111111111',
  target_label: 'Pedro Rodrigues',
  raw: 'ação=transferir(Pedro Rodrigues)',
};

const TRABALHISTA: WaAiActionRef = {
  action: 'transferir_atendimento',
  target_type: 'department',
  target_id: '22222222-2222-4222-8222-222222222222',
  target_label: 'Trabalhista',
  raw: 'ação=transferir(Trabalhista)',
};

const KIT_TRABALHISTA: WaAiActionRef = {
  action: 'enviar_documento',
  target_type: 'document_template',
  target_id: '33333333-3333-4333-8333-333333333333',
  target_label: 'Kit Trabalhista',
  raw: 'ação=enviar_documento(Kit Trabalhista)',
};

// ── O espelho ───────────────────────────────────────────────────────────────

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiActionCatalog.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-catalog.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-catalog.ts divergiu de waAiActionCatalog.ts — copie o arquivo inteiro');
});

// ── Catálogo ────────────────────────────────────────────────────────────────

test('o catálogo tem exatamente as oito ações do MVP', () => {
  assert.deepEqual(WA_AI_ACTION_NAMES, [
    'transferir_atendimento',
    'solicitar_documentos',
    'enviar_documento',
    'consultar_documentos',
    'consultar_assinatura',
    'agendar_followup',
    'cancelar_followup',
    'transferir_para_humano',
  ]);
});

test('nenhuma ação de maior risco entrou no catálogo', () => {
  const fora = ['cadastrar_cliente', 'criar_contrato', 'alterar_processo', 'pagamento'];
  for (const nome of fora) assert.equal(getWaAiAction(nome), null, `${nome} não deveria existir`);
});

test('todo nome técnico e todo alias são únicos', () => {
  const nomes = new Set(WA_AI_ACTIONS.map(a => a.name));
  const alias = new Set(WA_AI_ACTIONS.map(a => a.alias));
  assert.equal(nomes.size, WA_AI_ACTIONS.length);
  assert.equal(alias.size, WA_AI_ACTIONS.length);
});

test('o alias curto do prompt resolve para o nome técnico', () => {
  assert.equal(resolveWaAiActionByAlias('transferir')?.name, 'transferir_atendimento');
  assert.equal(resolveWaAiActionByAlias('transferir_atendimento')?.name, 'transferir_atendimento');
  assert.equal(resolveWaAiActionByAlias('TRANSFERIR')?.name, 'transferir_atendimento');
  assert.equal(resolveWaAiActionByAlias('transferir_tudo'), null);
});

test('normalizeWaAiAllowedActions descarta desconhecidas e repetidas', () => {
  assert.deepEqual(
    normalizeWaAiAllowedActions(['consultar_documentos', 'consultar_documentos', 'sql_arbitrario', '', null]),
    ['consultar_documentos'],
  );
  assert.deepEqual(normalizeWaAiAllowedActions('não é lista'), []);
});

// ── Ferramentas enviadas ao modelo ──────────────────────────────────────────

test('só as ações marcadas viram ferramenta', () => {
  const tools = buildWaAiTools(['consultar_documentos', 'consultar_assinatura'], []);
  assert.deepEqual(tools.map(t => t.function.name), ['consultar_documentos', 'consultar_assinatura']);
});

test('ação que exige destino não é oferecida sem referência compilada', () => {
  assert.deepEqual(buildWaAiTools(['transferir_atendimento'], []), []);
  const tools = buildWaAiTools(['transferir_atendimento'], [PEDRO]);
  assert.equal(tools.length, 1);
});

test('o destino vai ao modelo como enum fechado dos rótulos configurados', () => {
  const tools = buildWaAiTools(['transferir_atendimento'], [PEDRO, TRABALHISTA]);
  const destino = tools[0].function.parameters.properties.destino as { enum: string[] };
  assert.deepEqual(destino.enum, ['Pedro Rodrigues', 'Trabalhista']);
});

test('template configurado vai ao modelo como enum fechado', () => {
  const tools = buildWaAiTools(['enviar_documento'], [KIT_TRABALHISTA]);
  assert.equal(tools.length, 1);
  const documento = tools[0].function.parameters.properties.documento as { enum: string[] };
  assert.deepEqual(documento.enum, ['Kit Trabalhista']);
});

test('targetLabelsFor ignora referência sem id e de outra ação', () => {
  const refs: WaAiActionRef[] = [
    PEDRO,
    { action: 'transferir_atendimento', target_type: 'user', target_id: null, target_label: 'Fantasma', raw: '' },
    { action: 'agendar_followup', target_type: 'none', target_id: null, target_label: 'X', raw: '' },
  ];
  assert.deepEqual(targetLabelsFor('transferir_atendimento', refs), ['Pedro Rodrigues']);
});

// ── Validação das chamadas (allowlist) ──────────────────────────────────────

test('ação fora da allowlist é recusada mesmo com argumentos válidos', () => {
  const r = validateWaAiActionCall(
    'transferir_atendimento',
    { destino: 'Pedro Rodrigues', resumo: 'Cliente quer falar sobre rescisão.' },
    ['consultar_documentos'],
    [PEDRO],
  );
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /não está habilitada/);
});

test('ação inexistente inventada pelo modelo é recusada', () => {
  const r = validateWaAiActionCall('executar_sql', { query: 'drop table' }, WA_AI_ACTION_NAMES, []);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /desconhecida/);
});

test('destino fora das referências é recusado', () => {
  const r = validateWaAiActionCall(
    'transferir_atendimento',
    { destino: 'Doutor Inexistente', resumo: 'Resumo suficientemente longo.' },
    ['transferir_atendimento'],
    [PEDRO],
  );
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /não está entre os destinos configurados/);
});

test('destino válido devolve a referência com o id real', () => {
  const r = validateWaAiActionCall(
    'transferir_atendimento',
    { destino: 'Pedro Rodrigues', resumo: 'Cliente quer falar sobre rescisão.' },
    ['transferir_atendimento'],
    [PEDRO, TRABALHISTA],
  );
  assert.equal(r.ok, true);
  assert.equal((r as { ref: WaAiActionRef }).ref.target_id, PEDRO.target_id);
});

test('parâmetro obrigatório ausente é recusado', () => {
  const r = validateWaAiActionCall('transferir_para_humano', {}, ['transferir_para_humano'], []);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /resumo/);
});

test('lista de documentos: limpa, deduplica e respeita o teto', () => {
  const r = validateWaAiActionCall(
    'solicitar_documentos',
    { documentos: ['  RG  ', 'RG', 'Comprovante de residência', '', 42], prazo_dias: 7 },
    ['solicitar_documentos'],
    [],
  );
  assert.equal(r.ok, true);
  assert.deepEqual((r as { args: Record<string, unknown> }).args.documentos, ['RG', 'Comprovante de residência']);
  assert.equal((r as { args: Record<string, unknown> }).args.prazo_dias, 7);
});

test('lista de documentos acima do teto é recusada', () => {
  const documentos = Array.from({ length: 11 }, (_, i) => `Documento ${i}`);
  const r = validateWaAiActionCall('solicitar_documentos', { documentos }, ['solicitar_documentos'], []);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /no máximo 10/);
});

test('prazo fora da faixa é recusado', () => {
  const r = validateWaAiActionCall(
    'solicitar_documentos',
    { documentos: ['RG'], prazo_dias: 900 },
    ['solicitar_documentos'],
    [],
  );
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /acima do máximo/);
});

test('caractere de controle é removido dos argumentos', () => {
  const r = validateWaAiActionCall(
    'transferir_para_humano',
    { resumo: 'Cliente\u0007 pediu um advogado.' },
    ['transferir_para_humano'],
    [],
  );
  assert.equal(r.ok, true);
  assert.equal((r as { args: Record<string, unknown> }).args.resumo, 'Cliente pediu um advogado.');
});

test('texto acima do teto é cortado em vez de derrubar a ação', () => {
  const r = validateWaAiActionCall(
    'agendar_followup',
    { mensagem: 'a'.repeat(2000) },
    ['agendar_followup'],
    [],
  );
  assert.equal(r.ok, true);
  assert.equal(String((r as { args: Record<string, unknown> }).args.mensagem).length, 800);
});

test('enviar documento devolve o id compilado do template e recusa link escrito pelo modelo', () => {
  const ok = validateWaAiActionCall(
    'enviar_documento',
    { documento: 'Kit Trabalhista', mensagem: 'Preencha e assine este documento, por favor.' },
    ['enviar_documento'],
    [KIT_TRABALHISTA],
  );
  assert.equal(ok.ok, true);
  assert.equal((ok as { ref: WaAiActionRef }).ref.target_id, KIT_TRABALHISTA.target_id);

  const comLink = validateWaAiActionCall(
    'enviar_documento',
    { documento: 'Kit Trabalhista', mensagem: 'Preencha em https://jurius.com.br/#/p/kit-trabalhista-28r7' },
    ['enviar_documento'],
    [KIT_TRABALHISTA],
  );
  assert.equal(comLink.ok, false);
  assert.match((comLink as { error: string }).error, /não escreva links/);
});

test('o teto de ações por execução é 3', () => {
  assert.equal(WA_AI_MAX_ACTIONS_PER_RUN, 3);
});

// ── Editor de prompt ────────────────────────────────────────────────────────

test('reconhece a expressão com e sem cedilha, com e sem espaço', () => {
  const texto = 'Se for trabalhista, ação=transferir(Pedro Rodrigues).\nSenão acao = transferir (Trabalhista)';
  const exprs = parseWaAiPromptExpressions(texto);
  assert.equal(exprs.length, 2);
  assert.deepEqual(exprs.map(e => e.action), ['transferir_atendimento', 'transferir_atendimento']);
  assert.deepEqual(exprs.map(e => e.label), ['Pedro Rodrigues', 'Trabalhista']);
});

test('expressão sem destino é lida com rótulo vazio', () => {
  const exprs = parseWaAiPromptExpressions('No fim, ação=transferir_para_humano()');
  assert.equal(exprs.length, 1);
  assert.equal(exprs[0].label, '');
});

test('o trecho localizado permite destacar na tela', () => {
  const texto = 'abc ação=consultar_documentos() def';
  const [expr] = parseWaAiPromptExpressions(texto);
  assert.equal(texto.slice(expr.start, expr.end), expr.raw);
});

test('validar prompt: alias inexistente é erro', () => {
  const issues = validateWaAiPrompt('faça ação=teletransportar(Pedro)', [], WA_AI_ACTION_NAMES);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'erro');
  assert.match(issues[0].message, /não existe no catálogo/);
});

test('validar prompt: destino digitado à mão (sem referência) é erro', () => {
  const issues = validateWaAiPrompt('ação=transferir(Pedro Rodrigues)', [], ['transferir_atendimento']);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'erro');
  assert.match(issues[0].message, /não foi escolhido no menu/);
});

test('validar prompt: ação incompleta é erro', () => {
  const issues = validateWaAiPrompt('ação=transferir()', [PEDRO], ['transferir_atendimento']);
  assert.equal(issues[0].level, 'erro');
  assert.match(issues[0].message, /incompleta/);
});

test('validar prompt: ação usada no texto mas desmarcada é erro', () => {
  const issues = validateWaAiPrompt('ação=transferir(Pedro Rodrigues)', [PEDRO], []);
  assert.ok(issues.some(i => i.level === 'erro' && /não está marcada/.test(i.message)));
});

test('validar prompt: referência compilada válida não gera erro', () => {
  const texto = 'Caso trabalhista: ação=transferir(Pedro Rodrigues). Sempre ação=consultar_documentos().';
  const issues = validateWaAiPrompt(texto, [PEDRO], ['transferir_atendimento', 'consultar_documentos']);
  assert.deepEqual(issues, []);
});

test('validar prompt: destino em ação que não recebe destino é só aviso', () => {
  const issues = validateWaAiPrompt('ação=consultar_documentos(Pedro)', [], ['consultar_documentos']);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'aviso');
});

test('actionsUsedInPrompt alimenta o resumo sem repetir', () => {
  const texto = 'ação=transferir(Pedro Rodrigues) ... ação=transferir(Trabalhista) ... ação=consultar_documentos()';
  assert.deepEqual(actionsUsedInPrompt(texto), ['transferir_atendimento', 'consultar_documentos']);
});

test('referência órfã é descartada quando o trecho sai do texto', () => {
  const restantes = pruneWaAiActionRefs([PEDRO, TRABALHISTA], 'só sobrou ação=transferir(Pedro Rodrigues)', '');
  assert.deepEqual(restantes.map(r => r.target_label), ['Pedro Rodrigues']);
});

// ── Modelos ─────────────────────────────────────────────────────────────────

test('todo modelo aponta para um provedor do catálogo', () => {
  for (const m of WA_AI_MODELS) {
    assert.ok(WA_AI_PROVIDERS.some(p => p.id === m.provider), `provedor ${m.provider} não catalogado`);
  }
});

test('existe exatamente um modelo recomendado', () => {
  assert.equal(WA_AI_MODELS.filter(m => m.recommended).length, 1);
});

test('a allowlist de modelo recusa modelo fora da lista e provedor indisponível', () => {
  assert.equal(isWaAiModelAllowed('openai', 'gpt-4o-mini'), true);
  assert.equal(isWaAiModelAllowed('openai', 'gpt-inventado'), false);
  assert.equal(isWaAiModelAllowed('anthropic', 'claude-sonnet-5'), false);
});

test('a estimativa de custo usa a tabela do modelo', () => {
  const custo = estimateWaAiTurnCostUsd('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);
  assert.equal(custo, 0.75);
  assert.equal(estimateWaAiTurnCostUsd('openai', 'inexistente', 10, 10), null);
});
