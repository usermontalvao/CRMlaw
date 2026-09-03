import test from 'node:test';
import assert from 'node:assert/strict';
import { trechoDoAchado, ocorrenciasNoTexto, semAssinaturaDoAgente, textoBuscavel } from './threadSearchText.ts';
// A outra redação da mesma regra de assinatura. O teste existe para as duas
// nunca divergirem — ver o comentário em `semAssinaturaDoAgente`.
import { stripAgentSignature } from './waRichText.ts';

test('acha a palavra ignorando acento, mas devolve o texto como foi escrito', () => {
  const t = trechoDoAchado('Marquei a perícia para quinta.', 'pericia');
  assert.ok(t);
  assert.equal(t.achado, 'perícia');
});

test('acha o texto acentuado quando quem procura digitou com acento', () => {
  const t = trechoDoAchado('Preciso da procuração assinada', 'procuração');
  assert.ok(t);
  assert.equal(t.achado, 'procuração');
});

test('a janela mostra a frase EM VOLTA da palavra, não o começo da mensagem', () => {
  const longo = `${'a'.repeat(300)} o valor combinado foi 40% ${'b'.repeat(300)}`;
  const t = trechoDoAchado(longo, 'valor', 20);
  assert.ok(t);
  assert.equal(t.achado, 'valor');
  assert.ok(t.cortadoAntes, 'houve corte à esquerda');
  assert.ok(t.cortadoDepois, 'houve corte à direita');
  assert.ok(t.antes.length <= 20 && t.depois.length <= 20);
});

test('sem corte quando a mensagem inteira cabe na janela', () => {
  const t = trechoDoAchado('bom dia', 'dia', 40);
  assert.ok(t);
  assert.equal(t.cortadoAntes, false);
  assert.equal(t.cortadoDepois, false);
  assert.equal(t.antes, 'bom ');
});

test('quebra de linha e espaço repetido viram um espaço só', () => {
  const t = trechoDoAchado('bom   dia\n\n  doutor', 'doutor');
  assert.ok(t);
  assert.equal(t.antes, 'bom dia ');
});

test('sem ocorrência devolve null — a mensagem não vira resultado', () => {
  assert.equal(trechoDoAchado('bom dia', 'audiência'), null);
});

test('texto vazio ou termo vazio nunca viram achado', () => {
  assert.equal(trechoDoAchado('', 'dia'), null);
  assert.equal(trechoDoAchado('bom dia', '   '), null);
});

test('o cedilha casa com o c e o recorte não perde letra', () => {
  const t = trechoDoAchado('Enviei o orçamento ontem', 'orcamento');
  assert.ok(t);
  assert.equal(t.achado, 'orçamento');
  assert.equal(t.depois, ' ontem');
});

test('as duas redações da regra de assinatura concordam', () => {
  const casos = [
    '*Pedro Montalvão:*\nbom dia',
    '*Dra. Ana:*\nsegue o documento',
    '*bom dia*',
    'sem assinatura nenhuma',
    '*Pedro:* na mesma linha, sem quebra',
  ];
  for (const caso of casos) {
    assert.equal(semAssinaturaDoAgente(caso), stripAgentSignature(caso), caso);
  }
});

test('textoBuscavel tira a assinatura do que saiu daqui, e não do que chegou', () => {
  assert.equal(textoBuscavel({ direction: 'out', content: '*Dr. Pedro:*\nvamos marcar' }), 'vamos marcar');
  assert.equal(textoBuscavel({ direction: 'in', content: '*Dr. Pedro:*\nvamos marcar' }), '*Dr. Pedro:*\nvamos marcar');
});

test('sem texto, o áudio vale pelo que foi DITO; sem isso, pelo nome do arquivo', () => {
  assert.equal(textoBuscavel({ direction: 'in', content: '', transcription_text: 'o valor ficou em 40%' }), 'o valor ficou em 40%');
  assert.equal(textoBuscavel({ direction: 'in', content: null, transcription_text: null, file_name: 'procuracao.pdf' }), 'procuracao.pdf');
  assert.equal(textoBuscavel({ direction: 'in' }), '');
});

// ── As posições que acendem a palavra dentro da bolha ──────────────

test('devolve TODAS as ocorrências, e nos índices do texto original', () => {
  const t = 'perícia hoje, perícia amanhã';
  const oc = ocorrenciasNoTexto(t, 'pericia');
  assert.equal(oc.length, 2);
  assert.equal(t.slice(oc[0].ini, oc[0].fim), 'perícia');
  assert.equal(t.slice(oc[1].ini, oc[1].fim), 'perícia');
});

test('o acento do original não desloca a posição das ocorrências seguintes', () => {
  const t = 'ação, ação e orçamento';
  const oc = ocorrenciasNoTexto(t, 'orcamento');
  assert.equal(oc.length, 1);
  assert.equal(t.slice(oc[0].ini, oc[0].fim), 'orçamento');
});

test('casamentos não se sobrepõem', () => {
  const oc = ocorrenciasNoTexto('aaaa', 'aa');
  assert.equal(oc.length, 2);
  assert.deepEqual(oc, [{ ini: 0, fim: 2 }, { ini: 2, fim: 4 }]);
});

test('sem ocorrência, sem termo ou sem texto devolve lista vazia', () => {
  assert.deepEqual(ocorrenciasNoTexto('bom dia', 'audiencia'), []);
  assert.deepEqual(ocorrenciasNoTexto('bom dia', '  '), []);
  assert.deepEqual(ocorrenciasNoTexto(null, 'dia'), []);
});

test('o teto impede que uma transcrição enorme vire milhares de destaques', () => {
  assert.equal(ocorrenciasNoTexto('a '.repeat(500), 'a', 10).length, 10);
});
