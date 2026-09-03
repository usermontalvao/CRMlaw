import assert from 'node:assert/strict';
import test from 'node:test';

import { ipRealDoCliente } from './client-ip.ts';

/** Monta um leitor a partir de um objeto de cabeçalhos. */
const ler = (h: Record<string, string>) => (nome: string) => h[nome] ?? null;

test('cf-connecting-ip ganha de tudo — é o que a CDN reescreve', () => {
  assert.equal(
    ipRealDoCliente(ler({
      'cf-connecting-ip': '201.71.166.196',
      'x-forwarded-for': '203.0.113.99,201.71.166.196',
      'x-real-ip': '10.0.0.1',
    })),
    '201.71.166.196',
  );
});

test('o IP forjado na ponta esquerda do x-forwarded-for é descartado', () => {
  // Este é o caso medido contra a infraestrutura real: mandando o cabeçalho de
  // fora, o valor do atacante entra PRIMEIRO e o real fica por último.
  assert.equal(
    ipRealDoCliente(ler({ 'x-forwarded-for': '203.0.113.99,201.71.166.196' })),
    '201.71.166.196',
  );
});

test('cadeia com vários proxies: vale o último salto', () => {
  assert.equal(
    ipRealDoCliente(ler({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' })),
    '3.3.3.3',
  );
});

test('um único endereço no x-forwarded-for é ele mesmo', () => {
  assert.equal(ipRealDoCliente(ler({ 'x-forwarded-for': '198.51.100.7' })), '198.51.100.7');
});

test('sem cabeçalho nenhum devolve null — nunca cai no que o cliente mandou', () => {
  assert.equal(ipRealDoCliente(ler({})), null);
});

test('cabeçalho vazio ou só espaços não vira IP', () => {
  assert.equal(ipRealDoCliente(ler({ 'cf-connecting-ip': '   ', 'x-forwarded-for': '' })), null);
});

test('vazio no cf-connecting-ip cai para o próximo da ordem, não para null', () => {
  assert.equal(
    ipRealDoCliente(ler({ 'cf-connecting-ip': '', 'x-real-ip': '198.51.100.9' })),
    '198.51.100.9',
  );
});

test('x-real-ip é usado quando a CDN não está na frente', () => {
  assert.equal(
    ipRealDoCliente(ler({ 'x-real-ip': '198.51.100.4', 'x-forwarded-for': '203.0.113.1,198.51.100.4' })),
    '198.51.100.4',
  );
});

test('lista com vírgulas soltas não produz string vazia', () => {
  assert.equal(ipRealDoCliente(ler({ 'x-forwarded-for': '1.1.1.1,,  ,2.2.2.2,' })), '2.2.2.2');
});
