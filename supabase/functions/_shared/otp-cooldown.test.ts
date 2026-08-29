import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESCADA_DE_ESPERA_SEGUNDOS,
  esperaEntrePedidos,
  segundosParaOProximoPedido,
  textoDaEspera,
} from './otp-cooldown.ts';

const AGORA = new Date('2026-08-28T12:00:00Z').getTime();
const hAtras = (segundos: number) => new Date(AGORA - segundos * 1000).toISOString();

test('o primeiro código não espera nada', () => {
  assert.equal(esperaEntrePedidos(0), 0);
  assert.equal(
    segundosParaOProximoPedido({ ultimoEnvioIso: null, enviadosNaJanela: 0, agoraMs: AGORA }),
    0,
  );
});

test('a escada sobe a cada pedido e para no topo', () => {
  assert.equal(esperaEntrePedidos(1), 60);
  assert.equal(esperaEntrePedidos(2), 120);
  assert.equal(esperaEntrePedidos(3), 300);
  assert.equal(esperaEntrePedidos(4), 600);
  // Insistir mais não faz o castigo crescer sem fim.
  assert.equal(esperaEntrePedidos(9), 600);
  assert.equal(esperaEntrePedidos(50), ESCADA_DE_ESPERA_SEGUNDOS[ESCADA_DE_ESPERA_SEGUNDOS.length - 1]);
});

test('quem já esperou o bastante pode pedir de novo', () => {
  // Um envio, 61 segundos atrás: liberado.
  assert.equal(
    segundosParaOProximoPedido({ ultimoEnvioIso: hAtras(61), enviadosNaJanela: 1, agoraMs: AGORA }),
    0,
  );
  // Mesmo caso, 20 segundos atrás: faltam 40.
  assert.equal(
    segundosParaOProximoPedido({ ultimoEnvioIso: hAtras(20), enviadosNaJanela: 1, agoraMs: AGORA }),
    40,
  );
});

test('o terceiro pedido cobra cinco minutos, não um', () => {
  // Dois já enviados; o último há 90s. Com espera fixa de 60s isto passaria.
  assert.equal(
    segundosParaOProximoPedido({ ultimoEnvioIso: hAtras(90), enviadosNaJanela: 2, agoraMs: AGORA }),
    30,
  );
  assert.equal(
    segundosParaOProximoPedido({ ultimoEnvioIso: hAtras(90), enviadosNaJanela: 3, agoraMs: AGORA }),
    210,
  );
});

test('carimbo ilegível não tranca ninguém para fora', () => {
  assert.equal(
    segundosParaOProximoPedido({ ultimoEnvioIso: 'ontem à tarde', enviadosNaJanela: 3, agoraMs: AGORA }),
    0,
  );
});

test('o aviso vira minutos quando a espera passa de um minuto', () => {
  assert.match(textoDaEspera(40), /40 segundos/);
  assert.match(textoDaEspera(210), /4 minutos/);
  assert.match(textoDaEspera(600), /10 minutos/);
});
