import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularYDaAssinatura } from './posicionamentoDeAssinatura.ts';

test('a assinatura automática fica ancorada no marcador, sem subir 40 pontos', () => {
  const baseDaFatia = 84;
  const alturaDaFatia = 729.89;
  const yDoCampoAPartirDoTopo = 500;
  const alturaDoCampo = 32;

  const y = calcularYDaAssinatura({
    baseDaFatia,
    alturaDaFatia,
    yDoCampoAPartirDoTopo,
    alturaDoCampo,
  });

  assert.equal(y, 281.89);
  assert.equal(
    y + alturaDoCampo,
    baseDaFatia + alturaDaFatia - yDoCampoAPartirDoTopo,
    'a base da assinatura deve coincidir com a base do campo do template',
  );
  assert.notEqual(y, 321.89, 'a compensação antiga de +40 pt não pode voltar');
});

test('a conversão respeita a origem da fatia ao paginar um DOCX alto', () => {
  assert.equal(
    calcularYDaAssinatura({
      baseDaFatia: 100,
      alturaDaFatia: 600,
      yDoCampoAPartirDoTopo: 450,
      alturaDoCampo: 50,
    }),
    200,
  );
});
