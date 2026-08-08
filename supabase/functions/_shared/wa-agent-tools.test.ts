import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WA_AGENT_TOOLS, checkToolCall, findTool, implementedTools, needsApproval, toolGate, toolsForAgent,
} from './wa-agent-tools.ts';

test('nomes de gatilho são únicos', () => {
  const names = WA_AGENT_TOOLS.map(t => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('todo parâmetro obrigatório existe nas properties', () => {
  for (const tool of WA_AGENT_TOOLS) {
    for (const required of tool.parameters.required ?? []) {
      assert.ok(
        required in tool.parameters.properties,
        `${tool.name}: "${required}" é obrigatório mas não foi declarado`,
      );
    }
  }
});

test('toda property tem descrição — é o que a IA lê para preencher', () => {
  for (const tool of WA_AGENT_TOOLS) {
    for (const [prop, schema] of Object.entries(tool.parameters.properties)) {
      assert.ok(schema.description.trim().length > 0, `${tool.name}.${prop} sem descrição`);
    }
  }
});

test('só oferece ao LLM o que está liberado E implementado', () => {
  const offered = toolsForAgent(['registrar_dados', 'enviar_link_assinatura', 'nao_existe']);
  const names = offered.map(t => t.function.name);
  assert.deepEqual(names, ['registrar_dados']);
});

test('porteiro barra gatilho inexistente, não implementado e não liberado', () => {
  assert.equal(checkToolCall('voar', ['voar']).ok, false);
  assert.equal(checkToolCall('enviar_link_assinatura', ['enviar_link_assinatura']).ok, false);
  assert.equal(checkToolCall('qualificar', ['registrar_dados']).ok, false);
  assert.equal(checkToolCall('qualificar', ['qualificar']).ok, true);
});

test('risco alto exige aprovação mesmo com o canal em automático', () => {
  const contrato = findTool('enviar_contrato')!;
  assert.equal(contrato.risk, 'alto');
  assert.equal(needsApproval(contrato, false), true);
});

test('leitura nunca exige aprovação, nem com o canal em modo aprovação', () => {
  const consulta = findTool('consultar_processo')!;
  assert.equal(needsApproval(consulta, true), false);
});

test('gatilho comum segue o modo do canal', () => {
  const registrar = findTool('registrar_dados')!;
  assert.equal(needsApproval(registrar, true), true);
  assert.equal(needsApproval(registrar, false), false);
});

// ── A porta: o que o motor FAZ com a chamada ────────────────────────────────
// Estes testes existem porque a versão anterior tratava "precisa de aprovação"
// como "não executa" e seguia adiante: a ação sumia, ninguém era chamado para
// decidir, e o log dizia 'aprovacao' sem que houvesse aprovação para dar.

test('contrato é segurado até o sim, em qualquer modo de canal', () => {
  const contrato = findTool('enviar_contrato')!;
  assert.equal(toolGate(contrato, false), 'bloqueia');
  assert.equal(toolGate(contrato, true), 'bloqueia');
});

test('reunião reserva na hora em vez de sumir esperando aprovação', () => {
  const reuniao = findTool('marcar_reuniao')!;
  assert.equal(toolGate(reuniao, false), 'reserva');
  assert.equal(toolGate(reuniao, true), 'reserva');
});

test('nenhum gatilho de risco alto chega a "executa" — nem com o canal solto', () => {
  for (const tool of WA_AGENT_TOOLS) {
    if (tool.risk !== 'alto') continue;
    assert.notEqual(
      toolGate(tool, false), 'executa',
      `${tool.name} passaria direto no modo automático`,
    );
  }
});

test('gatilho comum executa direto quando o canal não pede aprovação', () => {
  assert.equal(toolGate(findTool('registrar_dados')!, false), 'executa');
  assert.equal(toolGate(findTool('registrar_dados')!, true), 'bloqueia');
});

test('leitura executa mesmo com o canal em modo aprovação', () => {
  assert.equal(toolGate(findTool('consultar_processo')!, true), 'executa');
});

test('todo gatilho implementado diz onde o efeito acontece', () => {
  for (const tool of implementedTools()) {
    assert.ok(tool.landsOn.trim().length > 0, `${tool.name} sem landsOn`);
  }
});
