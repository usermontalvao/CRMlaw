// Cobertura do controle de presença: o que NÃO sobe é o ponto.
//
// O caso real: cada tecla do chat interno chamava `track()`, e o Realtime passou
// a responder `ClientPresenceRateLimitReached`. Ver presenceTrack.ts.
//
// Execução: `node --test --import ts-node/esm src/services/realtime/presenceTrack.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criarControleDePresenca,
  assinaturaDePayload,
  INTERVALO_PRESENCA_MS,
} from './presenceTrack.ts';

type Payload = Record<string, unknown>;

function montarBancada(intervaloMs = INTERVALO_PRESENCA_MS) {
  const enviados: Payload[] = [];
  const logs: string[] = [];
  let pendente: (() => void) | null = null;
  let esperaAgendada: number | null = null;
  let cancelamentos = 0;

  const controle = criarControleDePresenca<Payload>({
    intervaloMs,
    enviar: (p) => { enviados.push(p); },
    agendar: (fn, ms) => { pendente = fn; esperaAgendada = ms; return { id: 1 }; },
    cancelar: () => { cancelamentos += 1; pendente = null; esperaAgendada = null; },
    registrar: (linha) => logs.push(linha),
  });

  return {
    controle,
    enviados,
    logs,
    cancelamentos: () => cancelamentos,
    esperaAgendada: () => esperaAgendada,
    temPendente: () => pendente !== null,
    disparar: () => { const fn = pendente; pendente = null; esperaAgendada = null; fn?.(); },
  };
}

// ── Assinatura estável ───────────────────────────────────────

test('a ordem das chaves não muda a assinatura', () => {
  assert.equal(
    assinaturaDePayload({ a: 1, b: 'x', c: true }),
    assinaturaDePayload({ c: true, b: 'x', a: 1 }),
  );
});

test('valor diferente muda a assinatura', () => {
  assert.notEqual(assinaturaDePayload({ typing: true }), assinaturaDePayload({ typing: false }));
});

test('undefined não conta, mas null conta', () => {
  assert.equal(assinaturaDePayload({ a: 1, b: undefined }), assinaturaDePayload({ a: 1 }));
  assert.notEqual(assinaturaDePayload({ a: 1, b: null }), assinaturaDePayload({ a: 1 }));
});

// ── Deduplicação: o coração da correção ──────────────────────

test('digitar quinze teclas manda UMA presença', () => {
  const b = montarBancada();
  const digitando = { user_id: 'u1', name: 'Atendente', typing: true };

  // "bom dia, doutor" — o payload é idêntico tecla após tecla, porque o texto da
  // mensagem não entra na presença. Era isto que estourava o limite do Realtime.
  for (let i = 0; i < 15; i += 1) b.controle.publicar({ ...digitando }, 1_000 + i * 120);

  assert.equal(b.enviados.length, 1);
  assert.ok(b.logs.some((l) => l.endsWith('TRACK_SKIPPED_DUPLICATE')));
});

test('uma referência nova com o mesmo conteúdo não é mudança', () => {
  const b = montarBancada();
  b.controle.publicar({ status: 'online', user_id: 'u1' }, 1_000);
  b.controle.publicar({ user_id: 'u1', status: 'online' }, 5_000);

  assert.equal(b.enviados.length, 1);
});

test('o "parou de digitar" passa, porque é outro estado', () => {
  const b = montarBancada();
  const eu = { user_id: 'u1', name: 'Atendente' };
  b.controle.publicar({ ...eu, typing: true }, 1_000);
  b.controle.publicar({ ...eu, typing: false }, 4_000);

  assert.equal(b.enviados.length, 2);
  assert.equal(b.enviados[1].typing, false);
});

// ── Throttle: rajada de estados que mudam de verdade ─────────

test('a primeira publicação sobe na hora — presença atrasada é presença errada', () => {
  const b = montarBancada(1_500);
  b.controle.publicar({ conv: 'a' }, 1_000);

  assert.equal(b.enviados.length, 1);
  assert.ok(!b.temPendente());
});

test('rajada dentro da janela vira UM envio, com o estado final', () => {
  const b = montarBancada(1_500);
  b.controle.publicar({ conv: 'a' }, 1_000);
  // Trocar de conversa com o teclado: três estados diferentes em meio segundo.
  b.controle.publicar({ conv: 'b' }, 1_100);
  b.controle.publicar({ conv: 'c' }, 1_200);
  b.controle.publicar({ conv: 'd' }, 1_300);

  assert.equal(b.enviados.length, 1, 'os intermediários não sobem');
  b.disparar();
  assert.equal(b.enviados.length, 2);
  assert.deepEqual(b.enviados[1], { conv: 'd' }, 'o que sobe é o estado FINAL');
});

test('a espera agendada fecha a janela, não recomeça do zero', () => {
  const b = montarBancada(1_500);
  b.controle.publicar({ conv: 'a' }, 1_000);
  b.controle.publicar({ conv: 'b' }, 1_400);

  assert.equal(b.esperaAgendada(), 1_100);
});

test('um só timer para a rajada inteira', () => {
  const b = montarBancada(1_500);
  b.controle.publicar({ conv: 'a' }, 1_000);
  b.controle.publicar({ conv: 'b' }, 1_100);
  b.controle.publicar({ conv: 'c' }, 1_200);

  assert.equal(b.cancelamentos(), 0, 'não se cancela e reagenda a cada publicação');
});

test('voltar ao estado já publicado durante a janela cancela o envio adiado', () => {
  const b = montarBancada(1_500);
  b.controle.publicar({ conv: 'a' }, 1_000);
  b.controle.publicar({ conv: 'b' }, 1_100);
  assert.ok(b.temPendente());

  b.controle.publicar({ conv: 'a' }, 1_200); // desistiu e voltou

  assert.ok(!b.temPendente(), 'não há nada de novo a anunciar');
  assert.equal(b.enviados.length, 1);
});

test('passada a janela, o próximo estado sobe na hora de novo', () => {
  const b = montarBancada(1_500);
  b.controle.publicar({ conv: 'a' }, 1_000);
  b.controle.publicar({ conv: 'b' }, 3_000);

  assert.equal(b.enviados.length, 2);
  assert.ok(!b.temPendente());
});

// ── Reconexão e cleanup ──────────────────────────────────────

test('esquecer faz o mesmo estado subir de novo — o servidor não lembra mais', () => {
  const b = montarBancada();
  const eu = { user_id: 'u1', status: 'online' };
  b.controle.publicar({ ...eu }, 1_000);
  b.controle.publicar({ ...eu }, 2_000);
  assert.equal(b.enviados.length, 1);

  // Reconexão: sem isto a pessoa ficaria invisível para os colegas.
  b.controle.esquecer();
  b.controle.publicar({ ...eu }, 3_000);

  assert.equal(b.enviados.length, 2);
});

test('o cleanup mata o envio adiado', () => {
  const b = montarBancada(1_500);
  b.controle.publicar({ conv: 'a' }, 1_000);
  b.controle.publicar({ conv: 'b' }, 1_100);
  assert.ok(b.temPendente());

  b.controle.encerrar();

  assert.ok(!b.temPendente(), 'um timer vivo dispararia sobre um canal já removido');
  assert.equal(b.enviados.length, 1);
  assert.ok(b.logs.some((l) => l.endsWith('CLEANUP')));
});

test('depois do cleanup o mesmo estado volta a subir (canal novo, servidor limpo)', () => {
  const b = montarBancada();
  b.controle.publicar({ conv: 'a' }, 1_000);
  b.controle.encerrar();
  b.controle.publicar({ conv: 'a' }, 1_100);

  assert.equal(b.enviados.length, 2);
});

test('nenhum log carrega conteúdo do payload', () => {
  const b = montarBancada();
  b.controle.publicar({ user_id: 'u1', name: 'Fulano de Tal', typing: true }, 1_000);
  b.controle.publicar({ user_id: 'u1', name: 'Fulano de Tal', typing: true }, 1_100);
  b.controle.encerrar();

  const permitido = /^\[Jurius Realtime\]\[Presence\] (TRACK|TRACK_SKIPPED_DUPLICATE|CLEANUP)$/;
  for (const linha of b.logs) {
    assert.ok(permitido.test(linha), `log fora do formato: ${linha}`);
    assert.ok(!linha.includes('Fulano'), `nome vazou no log: ${linha}`);
  }
});
