// Guarda de divergência entre o catálogo do MOTOR e a cópia de exibição da TELA.
//
// Existe porque as duas listas moram em pastas diferentes (o rootDir do tsconfig
// é src/, então a tela não importa o arquivo do motor). Sem esta guarda, alguém
// acrescenta um gatilho no motor, esquece a tela, e o gatilho fica invisível para
// quem configura — ou pior: aparece na tela um gatilho que o motor vai barrar.
import assert from 'node:assert/strict';
import test from 'node:test';
import { WA_AGENT_TOOLS } from './wa-agent-tools.ts';
import { WA_AGENT_TOOLS_DISPLAY } from '../../../src/shared/waAgentTools.ts';

test('tela e motor listam exatamente os mesmos gatilhos, na mesma ordem', () => {
  assert.deepEqual(
    WA_AGENT_TOOLS_DISPLAY.map(t => t.name),
    WA_AGENT_TOOLS.map(t => t.name),
  );
});

test('risco, execução e menção batem entre tela e motor', () => {
  for (const doMotor of WA_AGENT_TOOLS) {
    const naTela = WA_AGENT_TOOLS_DISPLAY.find(t => t.name === doMotor.name);
    assert.ok(naTela, `${doMotor.name} falta na tela`);
    assert.equal(naTela.risk, doMotor.risk, `${doMotor.name}: risco divergente`);
    assert.equal(naTela.implemented, doMotor.implemented, `${doMotor.name}: "implementado" divergente`);
    assert.equal(naTela.mention, doMotor.mention, `${doMotor.name}: menção divergente`);
    assert.equal(naTela.approval, doMotor.approval, `${doMotor.name}: forma de aprovação divergente`);
  }
});

// A tela explica ao administrador o que vai acontecer quando a IA pedir a ação.
// Se um gatilho de risco alto ficar sem essa marca, a tela promete uma coisa e o
// motor faz outra — e o default silencioso (`bloqueia`) esconderia o engano.
test('todo gatilho de risco alto declara COMO a aprovação é cobrada', () => {
  for (const t of WA_AGENT_TOOLS) {
    if (t.risk !== 'alto') continue;
    assert.ok(
      t.approval === 'bloqueia' || t.approval === 'reserva',
      `${t.name} é risco alto e não diz se bloqueia ou reserva`,
    );
  }
});
