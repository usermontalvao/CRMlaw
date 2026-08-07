// Cobertura do fan-out: um canal, muitos consumidores, nenhuma mensagem repetida
// e nada acumulado entre remontagens do módulo.
//
// Execução: `node --test --import ts-node/esm src/services/whatsapp/waMessageFanOut.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarFanOutDeMensagens, JANELA_DE_REPETICAO_MS } from './waMessageFanOut.ts';
import type { WaMessageEvent } from './waMessageEvent.ts';

const chegou = (over: Partial<WaMessageEvent> = {}): WaMessageEvent => ({
  op: 'INSERT',
  id: 'msg-1',
  conversation_id: 'conv-1',
  status: 'received',
  refresh: true,
  ...over,
});

test('todo ouvinte recebe o evento', () => {
  const fan = criarFanOutDeMensagens();
  const a: WaMessageEvent[] = [];
  const b: WaMessageEvent[] = [];
  fan.assinar((e) => a.push(e));
  fan.assinar((e) => b.push(e));

  fan.emitir(chegou());

  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(fan.quantidade(), 2);
});

test('evento nulo não chega a ninguém', () => {
  const fan = criarFanOutDeMensagens();
  let vezes = 0;
  fan.assinar(() => { vezes += 1; });

  fan.emitir(null);

  assert.equal(vezes, 0);
});

// ── Repetição: broadcast e rede descrevendo o mesmo fato ─────

test('o mesmo fato pelos dois caminhos entrega UMA vez', () => {
  const fan = criarFanOutDeMensagens();
  const recebidos: WaMessageEvent[] = [];
  fan.assinar((e) => recebidos.push(e));

  // O broadcast manda o conteúdo cortado em 120; a rede manda a linha inteira.
  // É o mesmo fato, e um toque de notificação só.
  fan.emitir(chegou({ content: 'bom dia, doutor' }), 1_000);
  fan.emitir(chegou({ content: 'bom dia, doutor — segue o documento em anexo' }), 1_040);

  assert.equal(recebidos.length, 1);
});

test('sent → delivered → read são fatos DIFERENTES da mesma mensagem', () => {
  const fan = criarFanOutDeMensagens();
  const recebidos: WaMessageEvent[] = [];
  fan.assinar((e) => recebidos.push(e));

  fan.emitir(chegou({ op: 'UPDATE', status: 'sent', refresh: false }), 1_000);
  fan.emitir(chegou({ op: 'UPDATE', status: 'delivered', refresh: false }), 1_100);
  fan.emitir(chegou({ op: 'UPDATE', status: 'read', refresh: false }), 1_200);

  assert.equal(recebidos.length, 3, 'o status faz parte da identidade do fato');
});

test('o mesmo fato de novo depois da janela volta a passar', () => {
  const fan = criarFanOutDeMensagens();
  const recebidos: WaMessageEvent[] = [];
  fan.assinar((e) => recebidos.push(e));

  fan.emitir(chegou(), 1_000);
  fan.emitir(chegou(), 1_000 + JANELA_DE_REPETICAO_MS + 1);

  assert.equal(recebidos.length, 2);
});

test('mensagens diferentes nunca se confundem', () => {
  const fan = criarFanOutDeMensagens();
  const recebidos: WaMessageEvent[] = [];
  fan.assinar((e) => recebidos.push(e));

  fan.emitir(chegou({ id: 'msg-1' }), 1_000);
  fan.emitir(chegou({ id: 'msg-2' }), 1_001);

  assert.equal(recebidos.length, 2);
});

// ── Remontagem ───────────────────────────────────────────────

test('remontar não acumula ouvinte — a mensagem não é processada duas vezes', () => {
  const fan = criarFanOutDeMensagens();
  let vezes = 0;
  const ouvinte = () => { vezes += 1; };

  // Entrar e sair do módulo três vezes.
  for (let i = 0; i < 3; i += 1) fan.assinar(ouvinte)();
  const cancelar = fan.assinar(ouvinte);

  assert.equal(fan.quantidade(), 1);
  fan.emitir(chegou());
  assert.equal(vezes, 1);

  cancelar();
  assert.equal(fan.quantidade(), 0);
});

test('cancelar duas vezes não remove a inscrição de outro (StrictMode)', () => {
  const fan = criarFanOutDeMensagens();
  const cancelarA = fan.assinar(() => {});
  fan.assinar(() => {});

  cancelarA();
  cancelarA();

  assert.equal(fan.quantidade(), 1);
});

test('quem sai durante a própria entrega não quebra a rodada', () => {
  const fan = criarFanOutDeMensagens();
  const vistos: string[] = [];
  const cancelar = fan.assinar(() => {
    vistos.push('primeiro');
    cancelar();
  });
  fan.assinar(() => vistos.push('segundo'));

  fan.emitir(chegou());

  assert.deepEqual(vistos, ['primeiro', 'segundo']);
  assert.equal(fan.quantidade(), 1);
});

test('um consumidor que estoura não derruba os outros nem o canal', () => {
  const erros: string[] = [];
  const fan = criarFanOutDeMensagens({ aoErroDeOuvinte: (m) => erros.push(m) });
  fan.assinar(() => { throw new Error('falha no notificador'); });
  let chegouNoSegundo = false;
  fan.assinar(() => { chegouNoSegundo = true; });

  fan.emitir(chegou());

  assert.ok(chegouNoSegundo);
  assert.deepEqual(erros, ['falha no notificador']);
});

test('a memória de repetição tem teto — rajada de importação não vaza', () => {
  const fan = criarFanOutDeMensagens();
  const recebidos: WaMessageEvent[] = [];
  fan.assinar((e) => recebidos.push(e));

  for (let i = 0; i < 2_000; i += 1) fan.emitir(chegou({ id: `msg-${i}` }), 1_000);

  assert.equal(recebidos.length, 2_000);
  // A mais recente ainda é reconhecida como repetição; a mais antiga já saiu.
  fan.emitir(chegou({ id: 'msg-1999' }), 1_001);
  assert.equal(recebidos.length, 2_000);
  fan.emitir(chegou({ id: 'msg-0' }), 1_001);
  assert.equal(recebidos.length, 2_001);
});
