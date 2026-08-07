import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizarBroadcast, type WaMessageEvent } from './waMessageEvent.ts';
import { criarFanOutDeMensagens } from './waMessageFanOut.ts';

test('broadcast: mensagem nova manda reler a thread', () => {
  const e = normalizarBroadcast({
    op: 'INSERT', id: 'm1', conversation_id: 'c1',
    direction: 'in', type: 'audio', status: 'delivered', content: '', refresh: true,
  });
  assert.equal(e?.op, 'INSERT');
  assert.equal(e?.conversation_id, 'c1');
  assert.equal(e?.direction, 'in');
  assert.equal(e?.refresh, true);
});

test('broadcast: mudança só de status mescla no lugar', () => {
  const e = normalizarBroadcast({
    op: 'UPDATE', id: 'm1', conversation_id: 'c1', status: 'read', refresh: false,
  });
  assert.equal(e?.refresh, false);
  assert.equal(e?.status, 'read');
});

test('broadcast: transcrição pronta manda reler — o que o postgres_changes não conseguia', () => {
  // O gatilho no banco marca refresh=true porque transcription_text mudou.
  const e = normalizarBroadcast({
    op: 'UPDATE', id: 'm1', conversation_id: 'c1', status: 'read', refresh: true,
  });
  assert.equal(e?.refresh, true);
});

test('broadcast: refresh ausente conta como "precisa reler"', () => {
  // Errar para o lado de uma requisição a mais é barato; não atualizar a tela
  // devolveria o bug de "sair da conversa e entrar de novo".
  const e = normalizarBroadcast({ op: 'UPDATE', id: 'm1', conversation_id: 'c1' });
  assert.equal(e?.refresh, true);
});

test('broadcast: DELETE carrega só a chave', () => {
  const e = normalizarBroadcast({ op: 'DELETE', id: 'm9', conversation_id: 'c1' });
  assert.equal(e?.op, 'DELETE');
  assert.equal(e?.id, 'm9');
});

test('broadcast: payload sem op ou sem id é descartado', () => {
  assert.equal(normalizarBroadcast({ id: 'm1' }), null);
  assert.equal(normalizarBroadcast({ op: 'INSERT' }), null);
  assert.equal(normalizarBroadcast({ op: 'TRUNCATE', id: 'm1' }), null);
  assert.equal(normalizarBroadcast(null), null);
});

// ── Payload mínimo do gatilho ────────────────────────────────────────────────
// Os três testes abaixo travam o CONTRATO com
// supabase/migrations/20260806234746_whatsapp_broadcast_hardening.sql: se o
// gatilho voltar a mandar `content` no UPDATE, ou parar de mandar no INSERT, é
// aqui que quebra.

test('broadcast: UPDATE não carrega content — a thread não lê texto no UPDATE', () => {
  // Forma exata que o gatilho emite hoje para "status mudou".
  const e = normalizarBroadcast({
    op: 'UPDATE', id: 'm1', conversation_id: 'c1', status: 'delivered', refresh: false,
  });
  assert.equal(e?.content, null);
  assert.equal(e?.direction, null);
  assert.equal(e?.type, null);
  // O que o merge cirúrgico de useWaRealtime precisa continua chegando.
  assert.equal(e?.status, 'delivered');
  assert.equal(e?.refresh, false);
  assert.equal(e?.conversation_id, 'c1');
});

test('broadcast: INSERT preserva o que o notificador usa de verdade', () => {
  // `direction` filtra 'in' e `content`/`type` montam o preview do cartão —
  // ver previewOf em src/hooks/useWhatsAppNotifications.ts.
  const e = normalizarBroadcast({
    op: 'INSERT', id: 'm1', conversation_id: 'c1',
    direction: 'in', type: 'image', status: 'delivered', content: 'oi', refresh: true,
  });
  assert.equal(e?.direction, 'in');
  assert.equal(e?.type, 'image');
  assert.equal(e?.content, 'oi');
  assert.equal(e?.refresh, true);
});

test('broadcast: UPDATE de edição relê, e o texto novo NÃO vem no aviso', () => {
  // Mensagem editada: o gatilho marca refresh=true porque content/edited_at
  // mudaram, mas o texto em si a tela pega no refreshMessages.
  const e = normalizarBroadcast({
    op: 'UPDATE', id: 'm1', conversation_id: 'c1', status: 'read', refresh: true,
  });
  assert.equal(e?.refresh, true);
  assert.equal(e?.content, null);
});

// ── O par INSERT+UPDATE que o banco produz em toda mensagem ──
//
// Toda mensagem recebida grava DUAS linhas em `realtime.messages`: o INSERT e,
// menos de um segundo depois, o UPDATE de status. Em produção o par observado
// foi 02:12:20.661 INSERT / 02:12:21.452 UPDATE, mesma mensagem. Isso não é
// duplicidade — mas só não vira bolha repetida por causa do que se testa aqui:
// o INSERT manda RELER a thread e o UPDATE manda MESCLAR no lugar.

test('o par INSERT+UPDATE da mesma mensagem dá um reload e um merge — nunca duas bolhas', () => {
  const fanOut = criarFanOutDeMensagens();
  const recebidos: WaMessageEvent[] = [];
  fanOut.assinar((e) => recebidos.push(e));

  // Exatamente o que o gatilho `broadcast_whatsapp_message_changed` publica.
  fanOut.emitir(
    normalizarBroadcast({
      op: 'INSERT', id: 'm-par', conversation_id: 'c1',
      direction: 'in', type: 'text', status: 'received', content: 'x', refresh: true,
    }),
    1_000,
  );
  fanOut.emitir(
    normalizarBroadcast({
      op: 'UPDATE', id: 'm-par', conversation_id: 'c1', status: 'read', refresh: false,
    }),
    1_791, // os ~0,8s reais entre as duas linhas: dentro da janela de repetição
  );

  assert.equal(recebidos.length, 2, 'os dois fatos chegam — o filtro não pode comer o UPDATE');
  // O que decide a bolha: só o primeiro manda buscar mensagem no servidor.
  assert.deepEqual(
    recebidos.map((e) => e.refresh),
    [true, false],
  );
  assert.equal(recebidos.filter((e) => e.refresh).length, 1, 'UM reload para o par inteiro');
  assert.equal(recebidos[1].status, 'read', 'o merge no lugar precisa do status novo');
});

test('o mesmo INSERT entregue duas vezes ainda é um reload só', () => {
  // Com o broadcast como fonte única, a cópia não vem mais de um segundo canal —
  // vem do próprio: uma reconexão no meio da rajada reentrega o trecho. Se ela
  // passasse, o INSERT dispararia dois refetch da thread e dois toques de aviso.
  const fanOut = criarFanOutDeMensagens();
  const recebidos: WaMessageEvent[] = [];
  fanOut.assinar((e) => recebidos.push(e));

  const carga = {
    op: 'INSERT', id: 'm-dup', conversation_id: 'c1',
    direction: 'in', type: 'text', status: 'received', content: 'x', refresh: true,
  };

  fanOut.emitir(normalizarBroadcast(carga), 1_000);
  fanOut.emitir(normalizarBroadcast(carga), 1_050);

  assert.equal(recebidos.length, 1, 'duas entregas, um fato, um consumo');
  assert.equal(recebidos[0].refresh, true);
});
