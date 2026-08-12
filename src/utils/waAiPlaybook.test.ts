import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_PLAYBOOK_SEM_REGISTRO,
  buildWaAiTriageSchema,
  computeWaAiTriageProgress,
  evaluateWaAiCuts,
  normalizeWaAiPlaybook,
  normalizeWaAiPlaybookValue,
  waAiPlaybookField,
  waAiPlaybookFieldKeys,
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

const progresso = (facts: Record<string, string>, now: Date = HOJE) =>
  computeWaAiTriageProgress({ playbook: ROTEIRO, facts, now, timeZone: TZ });

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
    inicio: '01/2025', ainda_trabalha: 'sim', pessoalidade: 'sim',
    pagamento: 'Pix, 2000', habitualidade: 'seg a sex, 8h às 17h', subordinacao: 'sim',
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
    inicio: '01/2025', ainda_trabalha: 'sim', pessoalidade: 'sim',
    pagamento: 'Pix, 2000', habitualidade: 'seg a sex, 8h às 17h', subordinacao: 'sim',
    tem_prova: 'sim', provas: 'conversas de WhatsApp', tem_testemunha: 'sim',
  });
  assert.equal(p.complete, true);
  assert.deepEqual(p.pending, []);
  assert.equal(p.nextField, null);
});

// ── Cortes ──────────────────────────────────────────────────────────────────

test('órgão público sai para gente, e sai antes das outras perguntas', () => {
  const p = progresso({ nome: 'Ana', empregador: 'Prefeitura', tipo_empregador: 'publico' });
  assert.equal(p.cut?.id, 'orgao_publico');
  assert.equal(p.cut?.effect, 'handoff');
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

test('órgão público vem antes do prazo: o caso vai para gente mesmo tendo saído há anos', () => {
  const p = progresso({ tipo_empregador: 'publico', ainda_trabalha: 'não', saida: '01/2019' });
  assert.equal(p.cut?.id, 'orgao_publico');
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
