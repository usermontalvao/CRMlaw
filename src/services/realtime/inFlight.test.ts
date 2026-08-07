// Cobertura do compartilhamento de consultas em voo: duas telas pedindo o mesmo
// dado ao mesmo tempo devem virar UMA ida ao servidor. Ver inFlight.ts.
//
// Execução: `node --test --import ts-node/esm src/services/realtime/inFlight.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarCompartilhadorDeConsultas, chaveDeConsulta } from './inFlight.ts';

/** Consulta controlada: só resolve quando o teste mandar. */
function consultaAdiada<T>() {
  let resolver: (v: T) => void = () => {};
  let rejeitar: (e: unknown) => void = () => {};
  const promessa = new Promise<T>((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver: (v: T) => resolver(v), rejeitar: (e: unknown) => rejeitar(e) };
}

// ── Chaves ───────────────────────────────────────────────────

test('a mesma lista em outra ordem é a MESMA consulta', () => {
  assert.equal(
    chaveDeConsulta('docs', { clientIds: ['b', 'a', 'c'] }),
    chaveDeConsulta('docs', { clientIds: ['a', 'c', 'b'] }),
  );
});

test('filtros diferentes são consultas diferentes', () => {
  assert.notEqual(
    chaveDeConsulta('docs', { clientIds: ['a'] }),
    chaveDeConsulta('docs', { clientIds: ['a', 'b'] }),
  );
  // O recurso faz parte da chave: sem isso duas tabelas com o mesmo filtro
  // receberiam a resposta uma da outra.
  assert.notEqual(
    chaveDeConsulta('docs', { clientIds: ['a'] }),
    chaveDeConsulta('assinaturas', { clientIds: ['a'] }),
  );
});

test('a ordem em que os filtros foram montados não conta', () => {
  assert.equal(
    chaveDeConsulta('docs', { status: 'pending', clientId: 'a' }),
    chaveDeConsulta('docs', { clientId: 'a', status: 'pending' }),
  );
});

// ── Compartilhamento ─────────────────────────────────────────

test('duas consultas idênticas concorrentes viram UMA ida ao servidor', async () => {
  const compartilhador = criarCompartilhadorDeConsultas();
  const adiada = consultaAdiada<string[]>();
  let idas = 0;
  const consulta = () => { idas += 1; return adiada.promessa; };

  const a = compartilhador.compartilhar('docs?clientIds=1.2', consulta);
  const b = compartilhador.compartilhar('docs?clientIds=1.2', consulta);
  const c = compartilhador.compartilhar('docs?clientIds=1.2', consulta);

  assert.equal(idas, 1, 'a rajada de consumidores não vira rajada de requisições');
  adiada.resolver(['ok']);

  assert.deepEqual(await a, ['ok']);
  assert.deepEqual(await b, ['ok'], 'quem chegou depois recebe a mesma resposta');
  assert.deepEqual(await c, ['ok']);
});

test('chaves diferentes continuam independentes', async () => {
  const compartilhador = criarCompartilhadorDeConsultas();
  let idas = 0;
  const consulta = () => { idas += 1; return Promise.resolve('x'); };

  await Promise.all([
    compartilhador.compartilhar('docs?clientIds=1', consulta),
    compartilhador.compartilhar('docs?clientIds=2', consulta),
  ]);

  assert.equal(idas, 2);
});

test('a consulta sai do mapa depois de dar certo — nada de dado velho', async () => {
  const compartilhador = criarCompartilhadorDeConsultas();
  let idas = 0;
  const consulta = () => { idas += 1; return Promise.resolve(idas); };

  assert.equal(await compartilhador.compartilhar('k', consulta), 1);
  assert.equal(compartilhador.emVoo(), 0);
  // Não é cache: a chamada seguinte vai ao servidor de novo.
  assert.equal(await compartilhador.compartilhar('k', consulta), 2);
});

test('a consulta sai do mapa depois de FALHAR', async () => {
  const compartilhador = criarCompartilhadorDeConsultas();
  const adiada = consultaAdiada<string>();
  const primeira = compartilhador.compartilhar('k', () => adiada.promessa);
  adiada.rejeitar(new Error('rede fora'));
  await assert.rejects(primeira, /rede fora/);

  assert.equal(compartilhador.emVoo(), 0, 'um erro preso travaria a tela para sempre');
  assert.equal(await compartilhador.compartilhar('k', () => Promise.resolve('agora vai')), 'agora vai');
});

test('quem compartilha uma consulta que falha recebe o mesmo erro', async () => {
  const compartilhador = criarCompartilhadorDeConsultas();
  const adiada = consultaAdiada<string>();
  const consulta = () => adiada.promessa;

  const a = compartilhador.compartilhar('k', consulta);
  const b = compartilhador.compartilhar('k', consulta);
  adiada.rejeitar(new Error('rede fora'));

  await assert.rejects(a, /rede fora/);
  await assert.rejects(b, /rede fora/);
});

test('erro SÍNCRONO não deixa a chave presa', async () => {
  const compartilhador = criarCompartilhadorDeConsultas();
  const explode = () => { throw new Error('filtro inválido'); };

  await assert.rejects(compartilhador.compartilhar('k', explode as never), /filtro inválido/);
  assert.equal(compartilhador.emVoo(), 0);
  assert.equal(await compartilhador.compartilhar('k', () => Promise.resolve('ok')), 'ok');
});

test('o log diz quando reaproveitou, sem carregar dado', async () => {
  const logs: string[] = [];
  const compartilhador = criarCompartilhadorDeConsultas({ registrar: (l) => logs.push(l) });
  const adiada = consultaAdiada<string>();
  const consulta = () => adiada.promessa;

  const a = compartilhador.compartilhar('docs?clientIds=1', consulta);
  const b = compartilhador.compartilhar('docs?clientIds=1', consulta);
  adiada.resolver('ok');
  await Promise.all([a, b]);

  assert.deepEqual(logs, [
    '[Jurius Fetch][docs?clientIds=1] START',
    '[Jurius Fetch][docs?clientIds=1] REUSE_IN_FLIGHT',
  ]);
});
