import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * O RELÓGIO DA ASSINATURA É UM SÓ — e estes testes são a cerca.
 *
 * O documento assinado é ancorado em Cuiabá do começo ao fim: o carimbo na
 * folha de conteúdo, a ficha do signatário, a trilha e o rodapé todos dizem o
 * fuso. Se uma tela do CRM formatar no relógio de QUEM ABRE, o mesmo ato passa
 * a ter duas horas — e entre 23h e a meia-noite, duas DATAS. Foi o que a
 * auditoria de 04/09/2026 encontrou em três lugares (a escada de assinatura, o
 * "hoje às" da fila e o "Excluído em" da lixeira).
 *
 * A segunda cerca é o ESPELHO: `pdfSignature.service.ts` é o plano B da
 * montagem, e enquanto puder produzir um documento assinado ele tem de produzir
 * o MESMO documento. O laudo do servidor passou a rotular o fuso; o do cliente
 * tinha ficado para trás, escrevendo "19:47:53" sem dizer de onde.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf8');

/** Onde uma hora de assinatura pode ser escrita na tela. */
const SUPERFICIE = [
  '../components/SignatureModule.tsx',
  '../components/PublicSigningPage.tsx',
  '../components/EscadaDeAssinatura.tsx',
  '../services/pdfSignature.service.ts',
  '../services/signature.service.ts',
];

/**
 * A ÚNICA dispensa, e ela tem razão: `expiresAt` é uma data pura vinda de um
 * `<input type="date">`, e a leitura ao meio-dia local existe justamente para
 * que nenhum fuso do mundo mude o dia mostrado. Não há instante para ancorar.
 */
const DISPENSADAS = [/new Date\(`\$\{settings\.expiresAt\}T12:00:00`\)/];

test('nenhuma hora da assinatura é escrita no fuso de quem abre a tela', () => {
  const faltando: string[] = [];

  for (const caminho of SUPERFICIE) {
    const linhas = ler(caminho).split('\n');
    linhas.forEach((linha, i) => {
      if (!/toLocaleDateString|toLocaleTimeString|toLocaleString|new Intl\.DateTimeFormat/.test(linha)) return;
      if (DISPENSADAS.some((re) => re.test(linha))) return;
      // As opções podem cair nas linhas seguintes — é como o arquivo escreve.
      const janela = linhas.slice(i, i + 7).join('\n');
      if (!janela.includes('timeZone')) {
        faltando.push(`${caminho}:${i + 1} → ${linha.trim().slice(0, 90)}`);
      }
    });
  }

  assert.deepEqual(faltando, [],
    'formatação de data/hora sem `timeZone` na superfície da assinatura:\n' + faltando.join('\n'));
});

test('o laudo do plano B rotula o fuso igual ao do servidor', () => {
  const cliente = ler('../services/pdfSignature.service.ts');
  const servidorFuso = ler('../../supabase/functions/_shared/montagem/dadosDoSignatario.ts');
  const servidorTrilha = ler('../../supabase/functions/_shared/montagem/laudoTrilha.ts');

  // 1. "Assinado em" nos DOIS relógios, dos dois lados.
  assert.ok(servidorFuso.includes('(Cuiabá) · ${ladoDeBrasilia} (Brasília)'),
    'o servidor deixou de escrever o instante nos dois fusos');
  assert.ok(cliente.includes('(Cuiabá) · ${ladoDeBrasilia} (Brasília)'),
    'o laudo do navegador voltou a escrever a hora sem dizer o fuso');
  assert.ok(cliente.includes('private formatDateTimeBothZones('),
    'o espelho dos dois fusos sumiu do plano B');
  assert.equal(cliente.includes('this.formatCuiabaDateTime(item.signed_at'), false,
    'o "Assinado em" do plano B voltou ao formatador de um fuso só');

  // 2. A regra da virada do dia — a mesma dos dois lados.
  for (const [nome, fonte] of [['servidor', servidorFuso], ['cliente', cliente]] as const) {
    assert.ok(fonte.includes('brasilia.data === cuiaba.data'),
      `${nome}: a data de Brasília deixou de ser repetida quando ela difere — `
      + 'entre 23h e a meia-noite o laudo passa a datar o ato no dia anterior');
  }

  // 3. A nota do rodapé da trilha, palavra por palavra.
  const NOTA = 'Datas em horário de Cuiabá (UTC-04:00); em Brasília (UTC-03:00), uma hora mais tarde.';
  assert.ok(servidorTrilha.includes(NOTA), 'a nota de fuso mudou no laudo do servidor');
  assert.ok(cliente.includes(NOTA), 'a nota de fuso do plano B ficou diferente da do servidor');
});

test('a hora impressa nas folhas de conteúdo diz de onde é', () => {
  const cliente = ler('../services/pdfSignature.service.ts');
  const servidor = ler('../../supabase/functions/montar-documento-assinado/index.ts');

  // É a única marca de hora fora do laudo: a folha solta que alguém fotografa
  // não leva a nota do rodapé junto.
  assert.ok(servidor.includes('(Cuiabá)'),
    'o carimbo da folha de conteúdo voltou a sair sem fuso no servidor');
  assert.ok(cliente.includes('(CUIABÁ)'),
    'o carimbo da folha de conteúdo voltou a sair sem fuso no plano B');

  // E a hora de emissão, que aparece na capa e no alto de TODAS as folhas.
  assert.ok(servidor.includes('${formatarDataHoraDoEscritorio(new Date())} (Cuiabá)'),
    'o "Emitido em" do servidor voltou a sair sem fuso');
  assert.ok(cliente.includes('${this.formatCuiabaDateTime(new Date())} (Cuiabá)'),
    'o "Emitido em" do plano B voltou a sair sem fuso');
});
