import test from 'node:test';
import assert from 'node:assert/strict';

import {
  criarCronometro, formatarDuracao, formatarResumo, resumir,
} from './cronometroDeFases.ts';

/** Um relógio de mentira, que só anda quando mandam. */
function relogio(inicio = 0) {
  let t = inicio;
  return { agora: () => t, avancar: (ms: number) => { t += ms; } };
}

test('a mesma fase repetida SOMA e conta as passagens', () => {
  // Contar as passagens é o que denuncia trabalho repetido — a selfie baixada
  // uma vez por documento aparece como "×6", não como uma fase cara.
  const linhas = resumir([
    { fase: 'selfie', ms: 100 },
    { fase: 'rasterizar', ms: 900 },
    { fase: 'selfie', ms: 120 },
  ], 1200);

  assert.deepEqual(linhas.map((l) => l.fase), ['rasterizar', 'selfie']);
  assert.equal(linhas[1].ms, 220);
  assert.equal(linhas[1].vezes, 2);
  assert.equal(linhas[0].vezes, 1);
});

test('a ordem é do mais caro para o mais barato — não é ordem de execução', () => {
  // Quem lê o relatório quer saber o que atacar; a primeira linha tem de ser a
  // resposta, não o primeiro passo do código.
  const linhas = resumir([
    { fase: 'primeira', ms: 10 },
    { fase: 'segunda', ms: 500 },
    { fase: 'terceira', ms: 50 },
  ], 560);
  assert.deepEqual(linhas.map((l) => l.fase), ['segunda', 'terceira', 'primeira']);
});

test('o NÃO MEDIDO aparece — é a linha que impede a conclusão errada', () => {
  // Um relatório que só soma o instrumentado dá 100% sempre e esconde o
  // gargalo que ninguém cronometrou.
  const texto = formatarResumo([{ fase: 'rede', ms: 200 }], 1000);
  assert.match(texto, /não medido/);
  assert.match(texto, /800 ms/);
  assert.match(texto, /80,0%|80\.0%/);
});

test('sem nada medido, tudo é não medido — e não vira divisão por zero', () => {
  const texto = formatarResumo([], 500);
  assert.match(texto, /não medido/);
  assert.match(texto, /500 ms/);
  // Relógio zerado não pode produzir NaN%
  assert.doesNotMatch(formatarResumo([], 0), /NaN/);
  assert.deepEqual(resumir([{ fase: 'x', ms: 5 }], 0)[0].fatia, 0);
});

test('a fatia é do relógio de PAREDE, não da soma das fases', () => {
  // Se fosse da soma, duas fases dariam 50%/50% mesmo ocupando 10% do tempo
  // real — e o relatório mentiria dizendo que elas são o problema.
  const linhas = resumir([{ fase: 'a', ms: 100 }, { fase: 'b', ms: 100 }], 1000);
  assert.equal(linhas[0].fatia, 0.1);
  assert.equal(linhas[1].fatia, 0.1);
});

test('duração longa sai em segundos, curta em ms', () => {
  assert.equal(formatarDuracao(12345), '12,3 s');
  assert.equal(formatarDuracao(999), '999 ms');
  assert.equal(formatarDuracao(1000), '1,0 s');
});

test('o cronômetro mede o intervalo entre abrir e fechar a fase', () => {
  const r = relogio();
  const c = criarCronometro(r.agora);
  c.comecar();

  const fechar = c.fase('rasterizar');
  r.avancar(800);
  fechar();

  r.avancar(200);
  assert.deepEqual([...c.amostras()], [{ fase: 'rasterizar', ms: 800 }]);
  assert.equal(c.decorrido(), 1000);
});

test('fechar a MESMA fase duas vezes não conta duas vezes', () => {
  // O `finally` de um `medir` aninhado com um fechamento manual chamaria o
  // mesmo fechar duas vezes, e o relatório passaria a somar tempo que não
  // existiu.
  const r = relogio();
  const c = criarCronometro(r.agora);
  c.comecar();
  const fechar = c.fase('upload');
  r.avancar(50);
  fechar();
  r.avancar(50);
  fechar();
  assert.equal(c.amostras().length, 1);
  assert.equal(c.amostras()[0].ms, 50);
});

test('medir() fecha a fase mesmo quando a tarefa estoura', () => {
  // Uma falha no meio da assinatura não pode deixar o relatório sem a fase que
  // falhou — é justamente ela que se quer ver.
  const r = relogio();
  const c = criarCronometro(r.agora);
  c.comecar();

  return c.medir('selfie', async () => { r.avancar(30); throw new Error('storage caiu'); })
    .then(
      () => assert.fail('devia ter propagado o erro'),
      (e) => {
        assert.equal((e as Error).message, 'storage caiu');
        assert.deepEqual([...c.amostras()], [{ fase: 'selfie', ms: 30 }]);
      },
    );
});

test('comecar() zera as amostras da assinatura anterior', () => {
  // Sem isto, assinar dois envelopes na mesma aba somaria os dois relatórios.
  const r = relogio();
  const c = criarCronometro(r.agora);
  c.comecar();
  c.fase('a')();
  assert.equal(c.amostras().length, 1);
  c.comecar();
  assert.equal(c.amostras().length, 0);
});

test('relógio que anda para trás não vira duração negativa', () => {
  // `performance.now()` é monotônico, mas o cronômetro não deve depender disso
  // para não produzir "-3 s" em nenhum aparelho.
  let t = 100;
  const c = criarCronometro(() => t);
  c.comecar();
  const fechar = c.fase('x');
  t = 40;
  fechar();
  assert.equal(c.amostras()[0].ms, 0);
  assert.equal(c.decorrido(), 0);
});
