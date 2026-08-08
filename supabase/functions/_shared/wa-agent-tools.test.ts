import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WA_AGENT_TOOLS, checkToolCall, findTool, implementedTools, needsApproval, toolsForAgent,
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
  const assinatura = findTool('enviar_link_assinatura')!;
  assert.equal(needsApproval(assinatura, false), true);
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

test('todo gatilho implementado diz onde o efeito acontece', () => {
  for (const tool of implementedTools()) {
    assert.ok(tool.landsOn.trim().length > 0, `${tool.name} sem landsOn`);
  }
});
