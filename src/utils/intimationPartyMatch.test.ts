import assert from 'node:assert/strict';
import test from 'node:test';

import {
  casarCliente,
  casarProcesso,
  extrairNomesDePartes,
  extrairNumeroCnj,
  normalizarNome,
  resolverVinculoDaIntimacao,
} from './intimationPartyMatch.ts';

// Texto REAL da intimação que chegou sem cliente e sem processo (id 54016ea3…),
// copiado do banco como está: 925 caracteres numa linha só, sem nenhum \n, com
// os campos separados por espaço duplo. É essa forma que quebrava o extrator —
// um teste com quebras de linha bonitinhas passaria e não provaria nada.
const TEXTO_TRABALHISTA =
  'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  PJE - PROCESSO JUDICIAL ELETRÔNICO - 23ª REGIÃO  ' +
  '6ª VARA DO TRABALHO DE CUIABÁ  ATSum 0000280-78.2026.5.23.0006  ' +
  'RECLAMANTE: VANDERLEY DA SILVA SAMPAIO  ' +
  'RECLAMADO: DOLP ENGENHARIA LTDA E OUTROS (1)  ' +
  'INTIMAÇÃO  Fica V. Sa. intimado para tomar ciência da Decisão ID 8a34137 proferida nos autos.  ' +
  'DECISÃO 1. Recebo o recurso ordinário interposto pela reclamada, uma vez que presentes os ' +
  'pressupostos objetivos e subjetivos de admissibilidade recursal;  ' +
  '2. Intime-se o reclamante para, querendo, apresentar contrarrazões, no prazo legal;  ' +
  'CUIABA/MT, 04 de agosto de 2026.  IVAN JOSE TESSARO  Juiz(a) do Trabalho Titular';

const CLIENTES = [
  { id: 'cli-vanderley', full_name: 'VANDERLEY DA SILVA SAMPAIO' },
  { id: 'cli-outro', full_name: 'Maria Fabíola de Souza' },
];

test('reconhece RECLAMANTE — o vocabulário trabalhista que faltava', () => {
  const nomes = extrairNomesDePartes(TEXTO_TRABALHISTA);
  assert.ok(nomes.includes('VANDERLEY DA SILVA SAMPAIO'));
});

test('para no espaço duplo: sem \\n, o nome não pode engolir a publicação inteira', () => {
  assert.equal(TEXTO_TRABALHISTA.includes('\n'), false);
  const nomes = extrairNomesDePartes(TEXTO_TRABALHISTA);
  assert.deepEqual(nomes, ['VANDERLEY DA SILVA SAMPAIO', 'DOLP ENGENHARIA LTDA']);
});

test('corta o "E OUTROS (n)" que o PJe cola no nome', () => {
  const nomes = extrairNomesDePartes(TEXTO_TRABALHISTA);
  assert.ok(nomes.includes('DOLP ENGENHARIA LTDA'));
  assert.ok(!nomes.some((n) => /OUTROS/i.test(n)));
});

test('o vocabulário antigo continua valendo', () => {
  const nomes = extrairNomesDePartes('REQUERENTE: JOAO DA SILVA\nEXECUTADO: BANCO XPTO S/A');
  assert.deepEqual(nomes, ['JOAO DA SILVA', 'BANCO XPTO S/A']);
});

test('casa o cliente do texto mesmo sem o processo cadastrado', () => {
  const vinculo = resolverVinculoDaIntimacao(
    { numero_processo: '00002807820265230006', texto: TEXTO_TRABALHISTA },
    { processos: [], clientes: CLIENTES },
  );
  assert.deepEqual(vinculo, { process_id: null, client_id: 'cli-vanderley' });
});

test('havendo processo cadastrado, ele manda e traz o cliente junto', () => {
  const vinculo = resolverVinculoDaIntimacao(
    { numero_processo: '0000280-78.2026.5.23.0006', texto: TEXTO_TRABALHISTA },
    {
      processos: [{ id: 'proc-1', client_id: 'cli-do-processo', process_code: '00002807820265230006' }],
      clientes: CLIENTES,
    },
  );
  assert.deepEqual(vinculo, { process_id: 'proc-1', client_id: 'cli-do-processo' });
});

test('processo cadastrado sem cliente: fica o processo, e o cliente vem do texto', () => {
  const vinculo = resolverVinculoDaIntimacao(
    { numero_processo: '00002807820265230006', texto: TEXTO_TRABALHISTA },
    {
      processos: [{ id: 'proc-1', client_id: null, process_code: '0000280-78.2026.5.23.0006' }],
      clientes: CLIENTES,
    },
  );
  assert.deepEqual(vinculo, { process_id: 'proc-1', client_id: 'cli-vanderley' });
});

test('destinatário do DJEN tem prioridade sobre o nome extraído do texto', () => {
  const vinculo = resolverVinculoDaIntimacao(
    { numero_processo: null, texto: TEXTO_TRABALHISTA, destinatarios: ['Maria Fabiola de Souza'] },
    { processos: [], clientes: CLIENTES },
  );
  assert.equal(vinculo.client_id, 'cli-outro');
});

test('o número do processo é achado no texto quando não vem no campo', () => {
  assert.equal(extrairNumeroCnj(TEXTO_TRABALHISTA), '0000280-78.2026.5.23.0006');
});

test('número de processo compara só por dígitos', () => {
  const processos = [{ id: 'p', client_id: 'c', process_code: '0000280-78.2026.5.23.0006' }];
  assert.deepEqual(casarProcesso('00002807820265230006', processos), {
    processId: 'p',
    clientId: 'c',
  });
  assert.equal(casarProcesso('00000000000000000000', processos), null);
});

test('acento não atrapalha o casamento de nome', () => {
  assert.equal(normalizarNome('Maria Fabíola de Souza'), 'MARIA FABIOLA DE SOUZA');
  assert.equal(casarCliente(['MARIA FABIOLA DE SOUZA'], CLIENTES), 'cli-outro');
});

test('o nome que casa inteiro ganha do que só está contido', () => {
  const clientes = [
    { id: 'cli-longo', full_name: 'ANA PAULA RODRIGUES LIMA' },
    { id: 'cli-exato', full_name: 'ANA PAULA RODRIGUES' },
  ];
  assert.equal(casarCliente(['ANA PAULA RODRIGUES'], clientes), 'cli-exato');
});

test('nome curto demais não casa por conter — homônimo parcial é pior que nada', () => {
  assert.equal(casarCliente(['SILVA'], CLIENTES), null);
});

test('sem nome nenhum não inventa cliente', () => {
  assert.equal(casarCliente([], CLIENTES), null);
  assert.equal(casarCliente(['JOSE DAS COUVES'], CLIENTES), null);
});

test('texto sem rótulo de parte não devolve nada', () => {
  assert.deepEqual(extrairNomesDePartes('INTIMAÇÃO. Fica V. Sa. intimado.'), []);
  assert.deepEqual(extrairNomesDePartes(null), []);
});
