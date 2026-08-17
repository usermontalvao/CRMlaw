import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendQueue } from './sendQueue.ts';

const espera = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

test('a saída respeita a ordem do gesto, mesmo com preparos de durações diferentes', async () => {
  const fila = createSendQueue();
  const saida: string[] = [];

  // "A" é uma imagem grande (upload lento), "B" e "C" são texto (preparo zero).
  // Sem fila, B e C sairiam na frente de A; é exatamente o que não pode.
  const envio = (nome: string, preparoMs: number) => {
    const vez = fila.take(); // reservado no gesto, de forma síncrona
    return (async () => {
      try {
        await espera(preparoMs);
        await vez.wait;
        saida.push(nome);
      } finally { vez.release(); }
    })();
  };

  const a = envio('A', 30);
  const b = envio('B', 0);
  const c = envio('C', 0);
  await Promise.all([a, b, c]);

  assert.deepEqual(saida, ['A', 'B', 'C']);
  assert.equal(fila.size(), 0);
});

test('preparos correm em paralelo — o lento não adia o começo do próximo', async () => {
  const fila = createSendQueue();
  const comecou: string[] = [];

  const envio = (nome: string, preparoMs: number) => {
    const vez = fila.take();
    return (async () => {
      try {
        comecou.push(nome);
        await espera(preparoMs);
        await vez.wait;
      } finally { vez.release(); }
    })();
  };

  const todos = [envio('A', 40), envio('B', 0)];
  // No mesmo tick os dois já começaram: B não esperou o upload de A.
  assert.deepEqual(comecou, ['A', 'B']);
  await Promise.all(todos);
});

test('um envio que falha não trava a fila', async () => {
  const fila = createSendQueue();
  const saida: string[] = [];

  const vezA = fila.take();
  const a = (async () => {
    try { await vezA.wait; throw new Error('canal fora do ar'); }
    finally { vezA.release(); }
  })();

  const vezB = fila.take();
  const b = (async () => {
    try { await vezB.wait; saida.push('B'); }
    finally { vezB.release(); }
  })();

  await assert.rejects(a);
  await b;
  assert.deepEqual(saida, ['B']);
  assert.equal(fila.size(), 0);
});

test('o aviso de fila vazia só chega quando a rajada inteira termina', async () => {
  let drenagens = 0;
  const fila = createSendQueue(() => { drenagens += 1; });

  const vez1 = fila.take();
  const vez2 = fila.take();
  assert.equal(fila.size(), 2);

  vez1.release();
  assert.equal(drenagens, 0); // ainda há mensagem em voo
  vez2.release();
  assert.equal(drenagens, 1);

  // Idempotente: liberar de novo (o `finally` de um caminho de erro) não conta.
  vez2.release();
  assert.equal(drenagens, 1);
  assert.equal(fila.size(), 0);
});
