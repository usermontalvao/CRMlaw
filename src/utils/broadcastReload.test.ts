// Cobertura da janela de recarga do e-mail e das petições: rajada vira uma
// recarga só, e o cleanup não deixa recarga escapar para componente desmontado.
//
// Execução: `node --test --import ts-node/esm src/utils/broadcastReload.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpcoesRecargaAgrupada } from './broadcastReload.ts';
import { criarRecargaAgrupada } from './broadcastReload.ts';

/** Timer na mão: o teste não depende de relógio. `avancar()` fecha a janela. */
function montarBancada(sobrescreve: Partial<OpcoesRecargaAgrupada> = {}) {
  const logs: string[] = [];
  let recargas = 0;
  let pendente: (() => void) | null = null;
  let cancelamentos = 0;

  const recarga = criarRecargaAgrupada({
    escopo: 'Email',
    atrasoMs: 1200,
    recarregar: () => {
      recargas += 1;
    },
    registrar: (linha) => logs.push(linha),
    agendar: (fn) => {
      pendente = fn;
      return 1;
    },
    cancelar: () => {
      cancelamentos += 1;
      pendente = null;
    },
    ...sobrescreve,
  });

  return {
    recarga,
    logs,
    get recargas() {
      return recargas;
    },
    get cancelamentos() {
      return cancelamentos;
    },
    get temPendente() {
      return pendente !== null;
    },
    avancar: () => {
      const fn = pendente;
      pendente = null;
      fn?.();
    },
  };
}

test('o aviso entra pela janela, e não recarrega direto', () => {
  const b = montarBancada();
  b.recarga.aoEvento();
  assert.equal(b.recargas, 0, 'a recarga espera a janela fechar');
  b.avancar();
  assert.equal(b.recargas, 1);
});

test('avisos seguidos viram uma recarga só', () => {
  const b = montarBancada();
  b.recarga.aoEvento();
  b.recarga.aoEvento();
  b.recarga.aoEvento();
  b.avancar();
  assert.equal(b.recargas, 1, 'o aviso seguinte reinicia a janela, não soma recarga');
  assert.equal(b.temPendente, false, 'sem janela órfã depois de disparar');
});

test('uma rajada nova depois da recarga abre janela nova', () => {
  const b = montarBancada();
  b.recarga.aoEvento();
  b.avancar();
  b.recarga.aoEvento();
  b.avancar();
  assert.equal(b.recargas, 2);
});

test('o cleanup cancela a janela pendente e não deixa recarga escapar', () => {
  const b = montarBancada();
  b.recarga.aoEvento();
  b.recarga.encerrar();
  assert.ok(b.cancelamentos > 0, 'a janela pendente foi cancelada');
  b.avancar();
  assert.equal(b.recargas, 0);
});

test('evento que chega depois do cleanup não agenda nada', () => {
  const b = montarBancada();
  b.recarga.encerrar();
  b.recarga.aoEvento();
  assert.equal(b.temPendente, false);
  b.avancar();
  assert.equal(b.recargas, 0);
});

test('cleanup chamado duas vezes não cancela timer que não existe', () => {
  const b = montarBancada();
  b.recarga.aoEvento();
  b.recarga.encerrar();
  b.recarga.encerrar();
  assert.equal(b.cancelamentos, 1);
});

test('o escopo separa e-mail de petições no log', () => {
  const email = montarBancada();
  email.recarga.aoEvento();
  assert.deepEqual(email.logs, ['[Jurius Realtime][Email] RELOAD_SCHEDULED']);

  const peticoes = montarBancada({ escopo: 'Petitions' });
  peticoes.recarga.aoEvento();
  assert.deepEqual(peticoes.logs, ['[Jurius Realtime][Petitions] RELOAD_SCHEDULED']);
});

test('nada do payload chega ao log: só marca e estado', () => {
  const b = montarBancada();
  // O handler não recebe argumento justamente para não ter como registrar
  // conteúdo — corpo de e-mail e .docx de petição não passam por aqui.
  b.recarga.aoEvento();
  b.avancar();
  for (const linha of b.logs) {
    assert.match(linha, /^\[Jurius Realtime\]\[(Email|Petitions)\] RELOAD_SCHEDULED$/);
  }
});
