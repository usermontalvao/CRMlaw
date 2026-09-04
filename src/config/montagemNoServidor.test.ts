/**
 * O interruptor da montagem no servidor — as regras que, se quebrarem, quebram
 * calado.
 *
 * Ver `src/config/montagemNoServidor.ts` e
 * `docs/assinatura-montagem-no-servidor.md`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { decidirMontagem, lerParametro } from './montagemNoServidor.ts';

test('sem configuração, a montagem fica no servidor', () => {
  // A fila durável já foi validada em produção; ausência fecha a migração.
  assert.deepEqual(decidirMontagem({}), { noServidor: true, origem: 'padrao' });
  assert.deepEqual(
    decidirMontagem({ busca: '', hash: '', armazenado: null, doBuild: null }),
    { noServidor: true, origem: 'padrao' },
  );
});

test('o parâmetro é lido no HASH, não só na busca', () => {
  // A página de assinatura vive atrás de um hash router. Um link com
  // `?montagem=servidor` no fim cai dentro do fragmento e NUNCA aparece em
  // `location.search` — ler só a busca faria o interruptor não responder
  // justamente no link que ele existe para testar.
  assert.equal(lerParametro('', '#/assinar/tok-123?montagem=servidor'), 'servidor');
  assert.equal(lerParametro('?montagem=servidor', ''), 'servidor');
  assert.equal(
    lerParametro('', '#/assinar/tok-123?ref=whatsapp&montagem=servidor'),
    'servidor',
  );
});

test('hash sem parâmetro nenhum não vira leitura falsa', () => {
  assert.equal(lerParametro('', '#/assinar/tok-123'), null);
  assert.equal(lerParametro('', '#/verificar/771ac0f37b61269c'), null);
  assert.equal(lerParametro(null, null), null);
});

test('os três degraus ligam, e cada um diz de onde veio', () => {
  assert.deepEqual(
    decidirMontagem({ hash: '#/assinar/x?montagem=servidor' }),
    { noServidor: true, origem: 'url' },
  );
  assert.deepEqual(
    decidirMontagem({ armazenado: 'servidor' }),
    { noServidor: true, origem: 'aparelho' },
  );
  assert.deepEqual(
    decidirMontagem({ doBuild: 'true' }),
    { noServidor: true, origem: 'build' },
  );
});

test('a URL vence o aparelho, e o aparelho vence o build', () => {
  // Só importa na direção de LIGAR: os três degraus são degraus de ligar.
  assert.equal(decidirMontagem({ hash: '#/x?montagem=servidor', armazenado: null, doBuild: null }).origem, 'url');
  assert.equal(decidirMontagem({ armazenado: 'servidor', doBuild: 'true' }).origem, 'aparelho');
});

test('NÃO existe forma de DESLIGAR por link — a direção é única', () => {
  // Esta é a regra de segurança do interruptor. O caminho do servidor é o mais
  // rigoroso (o SHA-256 sai dos bytes que o próprio servidor leu). Se
  // `?montagem=cliente` desligasse, quem abre o link de assinatura poderia
  // escolher o caminho mais frouxo — devolvendo por outra porta exatamente o
  // poder que a migração tira do navegador.
  for (const tentativa of ['cliente', 'navegador', 'false', '0', 'off', 'nao']) {
    assert.equal(
      decidirMontagem({ hash: `#/x?montagem=${tentativa}`, doBuild: 'true' }).noServidor,
      true,
      `"${tentativa}" na URL não pode desligar o que o build ligou`,
    );
    assert.equal(
      decidirMontagem({ hash: `#/x?montagem=${tentativa}`, armazenado: 'servidor' }).noServidor,
      true,
      `"${tentativa}" na URL não pode desligar o que o aparelho ligou`,
    );
  }
});

test('valor parecido não é uma fonte explícita — prevalece o padrão servidor', () => {
  // "servidorzinho" ou "servidor2" ligando seria um interruptor que responde a
  // erro de digitação num fluxo que produz prova.
  for (const quase of ['servidorzinho', 'servidor2', 'servido', 'ervidor', '']) {
    assert.equal(decidirMontagem({ hash: `#/x?montagem=${quase}` }).noServidor, true, quase);
  }
  // Maiúsculas, sim: o link é digitado por gente.
  assert.equal(decidirMontagem({ hash: '#/x?montagem=SERVIDOR' }).noServidor, true);
  assert.equal(decidirMontagem({ armazenado: ' Servidor ' }).noServidor, true);
});

test('o build liga com true e só false faz rollback', () => {
  assert.equal(decidirMontagem({ doBuild: 'true' }).noServidor, true);
  assert.equal(decidirMontagem({ doBuild: 'TRUE' }).noServidor, true);
  assert.deepEqual(
    decidirMontagem({ doBuild: 'false' }),
    { noServidor: false, origem: 'build' },
  );
  // Valor desconhecido não desliga um caminho mais rigoroso.
  for (const valor of ['', '1', 'sim', 'servidor', undefined, null]) {
    assert.equal(decidirMontagem({ doBuild: valor as string | null }).noServidor, true, String(valor));
  }
});
