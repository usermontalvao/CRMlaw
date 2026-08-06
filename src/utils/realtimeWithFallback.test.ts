// Cobertura da rede de segurança do Broadcast: quem chama o debounce, quando o
// fallback abre, e o que sobra depois do cleanup.
// Execução: `node --test --import ts-node/esm src/utils/realtimeWithFallback.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AoStatus, OpcoesRealtimeComFallback } from './realtimeWithFallback.ts';
import { ligarRealtimeComFallback } from './realtimeWithFallback.ts';

type Canal = { nome: string };

/**
 * Banco de teste: timers e canais na mão, para o teste não depender de relógio
 * nem de rede. `avancar()` fecha a janela do debounce.
 */
function montarBancada(sobrescreve: Partial<OpcoesRealtimeComFallback<Canal>> = {}) {
  const logs: string[] = [];
  const abertos: Canal[] = [];
  const removidos: Canal[] = [];
  const recargas: number[] = [];
  let pendente: (() => void) | null = null;
  let cancelamentos = 0;

  let dispararEventoBroadcast = () => {};
  let dispararStatusBroadcast: AoStatus = () => {};
  let dispararEventoFallback = () => {};
  let dispararStatusFallback: AoStatus = () => {};

  const opcoes: OpcoesRealtimeComFallback<Canal> = {
    escopo: 'Email',
    atrasoMs: 1200,
    recarregar: () => recargas.push(Date.now()),
    abrirBroadcast: (aoEvento, aoStatus) => {
      dispararEventoBroadcast = aoEvento;
      dispararStatusBroadcast = aoStatus;
      const canal = { nome: 'broadcast' };
      abertos.push(canal);
      return canal;
    },
    abrirFallback: (aoEvento, aoStatus) => {
      dispararEventoFallback = aoEvento;
      dispararStatusFallback = aoStatus;
      const canal = { nome: 'fallback' };
      abertos.push(canal);
      return canal;
    },
    remover: (canal) => removidos.push(canal),
    registrar: (linha) => logs.push(linha),
    avisar: (linha) => logs.push(linha),
    agendar: (fn) => {
      pendente = fn;
      return 1;
    },
    cancelar: () => {
      cancelamentos += 1;
      pendente = null;
    },
    ...sobrescreve,
  };

  const desligar = ligarRealtimeComFallback(opcoes);

  return {
    logs,
    abertos,
    removidos,
    recargas,
    desligar,
    get cancelamentos() {
      return cancelamentos;
    },
    avancar: () => {
      const fn = pendente;
      pendente = null;
      fn?.();
    },
    get temPendente() {
      return pendente !== null;
    },
    eventoBroadcast: () => dispararEventoBroadcast(),
    statusBroadcast: (status: string, erro?: { message?: string }) =>
      dispararStatusBroadcast(status, erro),
    eventoFallback: () => dispararEventoFallback(),
    statusFallback: (status: string) => dispararStatusFallback(status),
  };
}

test('o broadcast entra pelo debounce, e não recarrega direto', () => {
  const b = montarBancada();
  b.eventoBroadcast();
  assert.equal(b.recargas.length, 0, 'a recarga espera a janela fechar');
  b.avancar();
  assert.equal(b.recargas.length, 1);
});

test('o fallback entra pelo mesmo debounce do broadcast', () => {
  const b = montarBancada();
  b.statusBroadcast('CHANNEL_ERROR');
  b.eventoFallback();
  assert.equal(b.recargas.length, 0);
  b.avancar();
  assert.equal(b.recargas.length, 1);
});

test('aviso pelos dois caminhos na mesma janela vira uma recarga só', () => {
  const b = montarBancada();
  b.statusBroadcast('CHANNEL_ERROR');
  b.eventoBroadcast();
  b.eventoFallback();
  b.avancar();
  assert.equal(b.recargas.length, 1, 'o segundo aviso reinicia a janela, não soma recarga');
});

test('avisos seguidos não acumulam janelas pendentes', () => {
  const b = montarBancada();
  b.eventoBroadcast();
  b.eventoBroadcast();
  b.eventoBroadcast();
  b.avancar();
  assert.equal(b.recargas.length, 1);
  assert.equal(b.temPendente, false, 'sem janela órfã depois de disparar');
});

test('o fallback abre uma vez só, mesmo com CHANNEL_ERROR repetido', () => {
  const b = montarBancada();
  b.statusBroadcast('CHANNEL_ERROR');
  b.statusBroadcast('CHANNEL_ERROR');
  b.statusBroadcast('TIMED_OUT');
  assert.equal(b.abertos.filter((c) => c.nome === 'fallback').length, 1);
});

test('o fallback não abre enquanto o broadcast estiver de pé', () => {
  const b = montarBancada();
  b.statusBroadcast('SUBSCRIBED');
  b.statusBroadcast('CLOSED');
  assert.equal(b.abertos.filter((c) => c.nome === 'fallback').length, 0);
});

test('o cleanup cancela o timer pendente e não deixa recarga escapar', () => {
  const b = montarBancada();
  b.eventoBroadcast();
  b.desligar();
  assert.ok(b.cancelamentos > 0, 'o timer pendente foi cancelado');
  b.avancar();
  assert.equal(b.recargas.length, 0);
});

test('o cleanup remove os dois canais quando o fallback chegou a abrir', () => {
  const b = montarBancada();
  b.statusBroadcast('CHANNEL_ERROR');
  b.desligar();
  const nomes = b.removidos.map((c) => c.nome).sort();
  assert.deepEqual(nomes, ['broadcast', 'fallback']);
});

test('cada canal é removido uma vez só, mesmo com cleanup chamado duas vezes', () => {
  const b = montarBancada();
  b.statusBroadcast('CHANNEL_ERROR');
  b.desligar();
  b.desligar();
  assert.equal(b.removidos.length, 2);
});

test('CHANNEL_ERROR depois do cleanup não abre canal órfão', () => {
  const b = montarBancada();
  b.desligar();
  b.statusBroadcast('CHANNEL_ERROR');
  assert.equal(b.abertos.filter((c) => c.nome === 'fallback').length, 0);
  assert.equal(b.removidos.length, 1, 'só o broadcast tinha sido aberto');
});

test('broadcast que explode ao abrir ainda deixa o fallback subir', () => {
  const b = montarBancada({
    abrirBroadcast: () => {
      throw new Error('join recusado');
    },
  });
  assert.equal(b.abertos.filter((c) => c.nome === 'fallback').length, 1);
  b.eventoFallback();
  b.avancar();
  assert.equal(b.recargas.length, 1);
});

test('fallback que explode ao abrir não derruba o cleanup do broadcast', () => {
  const b = montarBancada({
    abrirFallback: () => {
      throw new Error('sem publicação');
    },
  });
  b.statusBroadcast('CHANNEL_ERROR');
  b.desligar();
  assert.deepEqual(
    b.removidos.map((c) => c.nome),
    ['broadcast'],
  );
});

test('ligar de novo depois do cleanup não herda canal da montagem anterior', () => {
  const primeira = montarBancada();
  primeira.statusBroadcast('CHANNEL_ERROR');
  primeira.desligar();

  const segunda = montarBancada();
  assert.equal(segunda.abertos.length, 1, 'a remontagem começa só com o broadcast');
  assert.equal(segunda.abertos[0].nome, 'broadcast');
});

test('os logs seguem o formato combinado e distinguem os três casos', () => {
  const b = montarBancada();
  b.statusBroadcast('SUBSCRIBED');
  b.eventoBroadcast();
  b.statusBroadcast('CHANNEL_ERROR');
  b.statusFallback('SUBSCRIBED');
  b.eventoFallback();

  assert.ok(b.logs.includes('[Jurius Realtime][Email][Broadcast] SUBSCRIBED'));
  assert.ok(b.logs.includes('[Jurius Realtime][Email][Broadcast] EVENT_RECEIVED'));
  assert.ok(b.logs.some((l) => l.startsWith('[Jurius Realtime][Email][Broadcast] CHANNEL_ERROR')));
  assert.ok(b.logs.includes('[Jurius Realtime][Email][PostgresFallback] SUBSCRIBED'));
  assert.ok(b.logs.includes('[Jurius Realtime][Email][PostgresFallback] EVENT_RECEIVED'));
  assert.ok(b.logs.includes('[Jurius Realtime][Email] RELOAD_SCHEDULED'));
});

test('o escopo separa e-mail de petições no log', () => {
  const b = montarBancada({ escopo: 'Petitions' });
  b.statusBroadcast('SUBSCRIBED');
  assert.ok(b.logs.includes('[Jurius Realtime][Petitions][Broadcast] SUBSCRIBED'));
});

test('nada do payload chega ao log: só marca, caminho e estado', () => {
  const b = montarBancada();
  // O evento carrega o que o servidor mandar; o módulo recebe um handler sem
  // argumento justamente para não ter como registrar conteúdo.
  b.statusBroadcast('SUBSCRIBED');
  b.eventoBroadcast();
  b.statusBroadcast('CHANNEL_ERROR', { message: 'Unauthorized' });
  b.eventoFallback();

  const permitido = /^\[Jurius Realtime\]\[(Email|Petitions)\](\[(Broadcast|PostgresFallback)\])? (SUBSCRIBED|EVENT_RECEIVED|RELOAD_SCHEDULED|CHANNEL_ERROR)/;
  for (const linha of b.logs) {
    assert.ok(permitido.test(linha), `linha fora do formato: ${linha}`);
  }
  // O texto do erro do canal é técnico e entra; qualquer coisa maior, não.
  for (const linha of b.logs) {
    assert.ok(linha.length < 120, `linha longa demais para ser só estado: ${linha}`);
  }
});
