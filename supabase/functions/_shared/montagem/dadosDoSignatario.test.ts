import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ehEmailInternoDePlaceholder,
  formatarDataHoraDoEscritorio,
  interpretarAgenteDeUsuario,
  interpretarGeolocalizacao,
  paraData,
} from './dadosDoSignatario.ts';

// ── Agente de usuário ───────────────────────────────────────────────────────

test('Edge é lido como Edge, não como Chrome', () => {
  // A cadeia do Edge contém "Chrome". Invertida a ordem dos testes, TODO Edge
  // do mundo viraria "Google Chrome" no laudo — e ninguém notaria.
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
  const lido = interpretarAgenteDeUsuario(ua);
  assert.equal(lido.navegador, 'Microsoft Edge');
  assert.equal(lido.sistema, 'Windows');
  assert.equal(lido.aparelho, 'Desktop');
});

test('iPhone dá aparelho, navegador e sistema — e o sistema sai "macOS"', () => {
  // ISTO NÃO É ENGANO DO PORTE, É O COMPORTAMENTO DO CLIENTE, congelado aqui de
  // propósito. A cadeia do iPhone contém "like Mac OS X", e o teste de
  // `Mac OS X` vem ANTES do de `iPhone` — então todo iPhone é rotulado macOS
  // nos laudos emitidos até hoje.
  //
  // Corrigir durante o porte faria a bancada acusar divergência entre o
  // documento antigo e o novo, e a diferença seria MINHA, não do motor. A
  // correção é uma mudança de conteúdo do laudo: entra depois, sozinha, com o
  // antes e o depois no olho de quem aprova.
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
  assert.deepEqual(interpretarAgenteDeUsuario(ua), {
    aparelho: 'iPhone', navegador: 'Safari', sistema: 'macOS',
  });
});

test('Android é Android, e aí a cadeia não tem "Mac OS X" para atrapalhar', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';
  assert.deepEqual(interpretarAgenteDeUsuario(ua), {
    aparelho: 'Celular', navegador: 'Google Chrome', sistema: 'Android',
  });
});

test('sem agente de usuário não se afirma nada', () => {
  assert.deepEqual(interpretarAgenteDeUsuario(null), {});
  assert.deepEqual(interpretarAgenteDeUsuario(''), {});
});

// ── Geolocalização ──────────────────────────────────────────────────────────

test('coordenada e endereço saem separados', () => {
  assert.deepEqual(
    interpretarGeolocalizacao('-15.601234, -56.097654|Cuiabá - MT'),
    { coordenadas: '-15.601234, -56.097654', endereco: 'Cuiabá - MT' },
  );
});

test('sem barra o valor inteiro é a COORDENADA, nunca o endereço', () => {
  // Ao contrário, o laudo escreveria "localizado em Cuiabá - MT" a partir de um
  // par de números — e perderia a única informação que pode ser conferida.
  assert.deepEqual(
    interpretarGeolocalizacao('-15.601234, -56.097654'),
    { coordenadas: '-15.601234, -56.097654', endereco: undefined },
  );
});

// ── E-mail interno ──────────────────────────────────────────────────────────

test('o e-mail inventado pelo fluxo público não é contato de ninguém', () => {
  assert.equal(ehEmailInternoDePlaceholder('public+abc123@crm.local'), true);
  assert.equal(ehEmailInternoDePlaceholder('PUBLIC+ABC@CRM.LOCAL'), true);
  assert.equal(ehEmailInternoDePlaceholder('pedro@escritorio.adv.br'), false);
  assert.equal(ehEmailInternoDePlaceholder(''), false);
  assert.equal(ehEmailInternoDePlaceholder(null), false);
});

// ── Data e hora ─────────────────────────────────────────────────────────────

test('a hora sai no fuso do escritório, não no de quem abre o arquivo', () => {
  // 02:30 UTC é ainda o dia anterior em Cuiabá (UTC-4).
  const texto = formatarDataHoraDoEscritorio('2026-09-03T02:30:00.000Z');
  assert.equal(texto, '02/09/2026, 22:30');
});

test('com segundos, porque termos e assinatura caem no mesmo minuto', () => {
  const texto = formatarDataHoraDoEscritorio('2026-09-03T02:30:07.000Z', { comSegundos: true });
  assert.equal(texto, '02/09/2026, 22:30:07');
});

test('valor ausente ou inválido não vira "Invalid Date" no documento', () => {
  assert.equal(formatarDataHoraDoEscritorio(null), 'Nao informado');
  assert.equal(formatarDataHoraDoEscritorio('nem data isso é'), 'Nao informado');
  assert.equal(paraData('nem data isso é'), null);
});
