import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleNotificationTone, type NotifyTone } from './notificationSound.ts';

// Contexto de áudio de mentira: registra o que foi agendado. Basta para provar o
// contrato dos três toques — quantas notas, em que altura e com que volume —
// sem depender de ouvir nada.
interface Agendado { freqs: number[]; picos: number[]; fim: number }

function render(tone: NotifyTone): Agendado {
  const freqs: number[] = [];
  const picos: number[] = [];
  let fim = 0;

  const connectable = () => ({ connect() {} });
  // Só o pico da rampa exponencial interessa; os demais métodos existem para o
  // código sob teste poder encadear as chamadas.
  const rampa = (registro?: (v: number) => void) => ({
    value: 0,
    setValueAtTime() { return this; },
    exponentialRampToValueAtTime(v: number) { registro?.(v); return this; },
    setTargetAtTime() { return this; },
  });

  const ac = {
    currentTime: 0,
    createGain: () => ({ ...connectable(), gain: rampa(v => picos.push(v)) }),
    createBiquadFilter: () => ({ ...connectable(), type: '', Q: { value: 0 }, frequency: rampa() }),
    createStereoPanner: () => ({ ...connectable(), pan: { value: 0 } }),
    createOscillator: () => ({
      ...connectable(),
      type: '',
      frequency: { set value(v: number) { freqs.push(v); }, get value() { return 0; } },
      start() {},
      stop(t: number) { fim = Math.max(fim, t); },
    }),
  } as unknown as BaseAudioContext;

  scheduleNotificationTone(ac, connectable() as unknown as AudioNode, tone);
  return { freqs, picos, fim };
}

test('o toque global tem duas notas — a quinta ascendente', () => {
  const { freqs } = render('global');
  // 3 parciais por nota: 6 osciladores = 2 notas.
  assert.equal(freqs.length, 6);
  assert.ok(freqs.includes(880), 'fundamental da 1ª nota');
  assert.ok(freqs.includes(1318.51), 'fundamental da 2ª nota');
});

test('os toques de dentro do módulo têm uma nota só', () => {
  assert.equal(render('inbox').freqs.length, 3);
  assert.equal(render('in-chat').freqs.length, 3);
});

test('cada camada é mais curta e mais baixa que a anterior', () => {
  const global = render('global');
  const inbox = render('inbox');
  const inChat = render('in-chat');

  // Duração: o toque da conversa aberta não pode arrastar sobre a leitura.
  assert.ok(inChat.fim < inbox.fim, 'in-chat mais curto que inbox');
  assert.ok(inbox.fim < global.fim, 'inbox mais curto que global');

  // Volume: o pico da fundamental cai de camada em camada.
  const pico = (a: { picos: number[] }) => Math.max(...a.picos);
  assert.ok(pico(inChat) < pico(inbox), 'in-chat mais baixo que inbox');
  assert.ok(pico(inbox) < pico(global), 'inbox mais baixo que global');
});

test('as três camadas soam em alturas diferentes', () => {
  const fundamental = (tone: NotifyTone) => render(tone).freqs[0];
  const alturas = new Set([fundamental('global'), fundamental('inbox'), fundamental('in-chat')]);
  assert.equal(alturas.size, 3);
});

// ── As duas espécies que não são mensagem ────────────────────────────────
// O contrato aqui não é musical, é de reconhecimento: quem atende o dia inteiro
// precisa saber pelo OUVIDO se ganhou trabalho ou se alguma coisa caiu, sem
// olhar para a tela. Por isso o que se testa é a DIREÇÃO do intervalo e a
// distância em relação ao toque de mensagem.

test('o toque de tarefa sobe, e o de falha desce', () => {
  const tarefa = render('task').freqs;
  const falha = render('alert').freqs;
  // 3 parciais por nota: as duas espécies têm duas notas, como o toque global.
  assert.equal(tarefa.length, 6);
  assert.equal(falha.length, 6);
  // freqs[0] é a fundamental da 1ª nota; freqs[3], a da 2ª.
  assert.ok(tarefa[3] > tarefa[0], 'tarefa resolve para cima');
  assert.ok(falha[3] < falha[0], 'falha resolve para baixo');
});

test('tarefa e falha são mais graves que o toque de mensagem', () => {
  const mensagem = render('global').freqs[0];
  assert.ok(render('task').freqs[0] < mensagem, 'tarefa abaixo da mensagem');
  assert.ok(render('alert').freqs[0] < mensagem, 'falha abaixo da tarefa e da mensagem');
  assert.ok(render('alert').freqs[0] < render('task').freqs[0], 'falha é a mais grave');
});

test('nenhuma das cinco espécies soa na mesma altura de outra', () => {
  const fundamental = (tone: NotifyTone) => render(tone).freqs[0];
  const alturas = new Set<number>([
    fundamental('global'), fundamental('inbox'), fundamental('in-chat'),
    fundamental('task'), fundamental('alert'),
  ]);
  assert.equal(alturas.size, 5);
});

test('a falha informa sem virar alarme: mais curta que o toque de mensagem', () => {
  assert.ok(render('alert').fim < render('global').fim);
});
