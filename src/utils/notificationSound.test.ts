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
