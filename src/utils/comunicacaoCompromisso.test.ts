import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANTECEDENCIAS_DA_COMUNICACAO,
  ANTECEDENCIA_PADRAO_MINUTOS,
  MENSAGEM_PADRAO_DA_COMUNICACAO,
  VARIAVEIS_DA_COMUNICACAO,
  momentoDoEnvio,
  montarMensagemDaComunicacao,
  motivoDeNaoEnviar,
  mensagemSugerida,
  nomeApresentavel,
  primeiroNomeApresentavel,
} from './comunicacaoCompromisso.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./comunicacaoCompromisso.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/comunicacao-compromisso.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'comunicacao-compromisso.ts divergiu — copie o arquivo inteiro');
});

// ── O texto ─────────────────────────────────────────────────────────────────

test('as variáveis viram os dados do compromisso', () => {
  const texto = montarMensagemDaComunicacao(
    'Bom dia, {primeiro_nome}. Sua audiência é {data} às {hora}, na {detalhes}.',
    { primeiro_nome: 'Maria', data: '09/09/2026', hora: '14:30', detalhes: 'Vara do Trabalho' },
  );
  assert.equal(texto, 'Bom dia, Maria. Sua audiência é 09/09/2026 às 14:30, na Vara do Trabalho.');
});

test('espaço dentro da chave é tolerado — quem digita à mão põe espaço', () => {
  assert.equal(montarMensagemDaComunicacao('Oi, { primeiro_nome }', { primeiro_nome: 'Ana' }), 'Oi, Ana');
});

test('campo vazio na origem some do texto, sem deixar a chave', () => {
  assert.equal(montarMensagemDaComunicacao('Onde: {detalhes}.', { detalhes: '' }), 'Onde: .');
});

test('{local} é resolvido — a Agenda passou a ter campo de endereço', () => {
  assert.equal(
    montarMensagemDaComunicacao('Compareça em {local}.', { local: '8ª Vara do Trabalho' }),
    'Compareça em 8ª Vara do Trabalho.',
  );
});

test('variável desconhecida fica LITERAL, para o erro aparecer antes do envio', () => {
  // Apagar em silêncio produziria "Seu compromisso é  às " e a advogada só
  // descobriria pela reclamação do cliente.
  const texto = montarMensagemDaComunicacao('Vai ser {dia_da_semana}', { data: '09/09' });
  assert.equal(texto, 'Vai ser {dia_da_semana}');
});

test('a mensagem padrão só usa variáveis que existem', () => {
  const usadas = [...MENSAGEM_PADRAO_DA_COMUNICACAO.matchAll(/\{\s*([a-z_]+)\s*\}/gi)].map(m => m[1]);
  assert.ok(usadas.length > 0, 'a mensagem padrão deveria ter variáveis');
  for (const chave of usadas) {
    assert.ok(
      (VARIAVEIS_DA_COMUNICACAO as string[]).includes(chave),
      `{${chave}} não está no catálogo e sairia literal no WhatsApp do cliente`,
    );
  }
});

// ── A hora ──────────────────────────────────────────────────────────────────

test('o envio é o começo do compromisso menos a antecedência', () => {
  const inicio = new Date('2026-09-09T17:30:00Z');
  assert.equal(momentoDoEnvio(inicio, 60).toISOString(), '2026-09-09T16:30:00.000Z');
  assert.equal(momentoDoEnvio(inicio, 60 * 24).toISOString(), '2026-09-08T17:30:00.000Z');
});

test('as antecedências oferecidas incluem o padrão', () => {
  assert.ok(ANTECEDENCIAS_DA_COMUNICACAO.some(a => a.minutos === ANTECEDENCIA_PADRAO_MINUTOS));
});

// ── Quando NÃO enviar ───────────────────────────────────────────────────────

const base = {
  ligada: true,
  enviadaEm: null,
  clienteId: 'c1',
  mensagem: 'Bom dia',
  inicio: '2026-09-09T17:30:00Z',
  minutosAntes: 60,
};

test('na hora certa, manda', () => {
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T16:30:00Z')), null);
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T17:00:00Z')), null,
    'meia hora depois da hora ainda vale — o cron roda de hora em hora');
});

test('cedo demais espera o cron seguinte', () => {
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T15:00:00Z')), 'ainda_cedo');
});

test('compromisso que JÁ COMEÇOU não recebe mais nada', () => {
  // A trava que impede o pior caso: o cron perde a janela das 13h e às 15h
  // manda "sua audiência é às 14h" para uma audiência que já aconteceu.
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T18:00:00Z')), 'compromisso_passou');
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T17:30:00Z')), 'compromisso_passou',
    'no minuto exato do início já é tarde');
});

test('desligada, já enviada, sem cliente e sem texto não saem', () => {
  const agora = new Date('2026-09-09T16:30:00Z');
  assert.equal(motivoDeNaoEnviar({ ...base, ligada: false }, agora), 'desligada');
  assert.equal(motivoDeNaoEnviar({ ...base, enviadaEm: '2026-09-08T10:00:00Z' }, agora), 'ja_enviada');
  assert.equal(motivoDeNaoEnviar({ ...base, clienteId: null }, agora), 'sem_cliente');
  assert.equal(motivoDeNaoEnviar({ ...base, mensagem: '   ' }, agora), 'sem_mensagem');
});

test('a ordem das travas: desligada ganha de tudo', () => {
  // Desligar o interruptor é o cancelamento. Ele não pode ser vencido por uma
  // trava posterior que o log explicaria de outro jeito.
  const agora = new Date('2026-09-09T16:30:00Z');
  assert.equal(
    motivoDeNaoEnviar({ ...base, ligada: false, clienteId: null, mensagem: '' }, agora),
    'desligada',
  );
});

test('sem antecedência escolhida, usa o padrão de um dia', () => {
  const semEscolha = { ...base, minutosAntes: null };
  assert.equal(motivoDeNaoEnviar(semEscolha, new Date('2026-09-08T17:30:00Z')), null);
  assert.equal(motivoDeNaoEnviar(semEscolha, new Date('2026-09-08T16:00:00Z')), 'ainda_cedo');
});

test('antecedência zero ou negativa cai no padrão, não em "manda já"', () => {
  // Zero significaria "avisar no instante do compromisso", que é inútil, e
  // negativo significaria avisar DEPOIS. Os dois viram o padrão.
  const zero = { ...base, minutosAntes: 0 };
  // Com o padrão de um dia, a janela abre em 08/09 17:30 — antes disso, espera.
  assert.equal(motivoDeNaoEnviar(zero, new Date('2026-09-08T12:00:00Z')), 'ainda_cedo');
  assert.equal(motivoDeNaoEnviar(zero, new Date('2026-09-08T17:30:00Z')), null);
  // E não é "manda já": no instante em que o zero foi salvo, ainda faltava um dia.
  assert.equal(motivoDeNaoEnviar({ ...base, minutosAntes: -60 }, new Date('2026-09-07T09:00:00Z')), 'ainda_cedo');
});

test('data de início ilegível não vira envio às cegas', () => {
  assert.equal(
    motivoDeNaoEnviar({ ...base, inicio: 'não é data' }, new Date('2026-09-09T16:30:00Z')),
    'compromisso_passou',
  );
});

// ── A mensagem segue o contexto ─────────────────────────────────────────────

test('audiência presencial COM endereço manda comparecer no lugar certo', () => {
  const t = mensagemSugerida('hearing', 'presencial', true);
  assert.ok(t.includes('Sua audiência'), 'diz que é audiência, não "seu compromisso"');
  assert.ok(t.includes('{local}'), 'cita o endereço');
  assert.ok(t.includes('documento oficial com foto'));
  assert.ok(t.includes('30 minutos'));
});

test('presencial SEM endereço não sugere "Compareça em ." ', () => {
  // A frase inteira some. Esta mensagem sai sozinha, sem ninguém reler antes —
  // um "Compareça em ." chegaria ao cliente exatamente assim.
  const t = mensagemSugerida('hearing', 'presencial', false);
  assert.ok(!t.includes('{local}'));
  assert.ok(!t.includes('Compareça em'));
  // Mas o que não depende do endereço continua valendo.
  assert.ok(t.includes('documento oficial com foto'));
});

test('audiência online fala em videoconferência e link, nunca em comparecer', () => {
  const t = mensagemSugerida('hearing', 'online');
  assert.ok(t.includes('videoconferência'));
  assert.ok(t.includes('link'));
  assert.ok(!t.includes('Compareça'));
  assert.ok(!t.includes('{local}'), 'online não tem endereço para citar');
});

test('perícia pede exames; audiência não', () => {
  assert.ok(mensagemSugerida('pericia', 'presencial', true).toLowerCase().includes('exames'));
  assert.ok(!mensagemSugerida('hearing', 'presencial', true).toLowerCase().includes('exames'));
});

test('reunião não manda levar documento com foto', () => {
  // É reunião com o próprio advogado, não ato processual.
  const t = mensagemSugerida('meeting', 'presencial', true);
  assert.ok(!t.includes('documento oficial com foto'));
  assert.ok(t.includes('{local}'));
});

test('tipo desconhecido cai no genérico, sem inventar recado', () => {
  // A Agenda permite criar tipos em Configurações; não dá para adivinhar o
  // recado de um tipo que o escritório inventou ontem.
  assert.equal(mensagemSugerida('confraternizacao', 'presencial', true), MENSAGEM_PADRAO_DA_COMUNICACAO);
  assert.equal(mensagemSugerida(null, null), MENSAGEM_PADRAO_DA_COMUNICACAO);
});

test('toda mensagem sugerida só usa variáveis do catálogo', () => {
  // A rede que impede uma sugestão nova de sair literal no WhatsApp do cliente.
  const combinacoes: [string | null, string | null, boolean][] = [
    ['hearing', 'presencial', true], ['hearing', 'presencial', false], ['hearing', 'online', false],
    ['pericia', 'presencial', true], ['pericia', 'online', false],
    ['meeting', 'presencial', true], ['meeting', 'online', false],
    ['personal', null, false], [null, null, false],
  ];
  for (const [tipo, modo, temLocal] of combinacoes) {
    const texto = mensagemSugerida(tipo, modo, temLocal);
    for (const m of texto.matchAll(/\{\s*([a-z_]+)\s*\}/gi)) {
      assert.ok(
        (VARIAVEIS_DA_COMUNICACAO as string[]).includes(m[1]),
        `{${m[1]}} (tipo=${tipo}, modo=${modo}) não está no catálogo e sairia literal`,
      );
    }
  }
});

test('as antecedências vão de horas a um mês, em ordem crescente', () => {
  const min = ANTECEDENCIAS_DA_COMUNICACAO.map(a => a.minutos);
  assert.deepEqual([...min], [...min].sort((a, b) => a - b), 'a escada tem de subir');
  assert.equal(min[0], 60, 'a menor é uma hora');
  assert.equal(min[min.length - 1], 60 * 24 * 30, 'a maior é trinta dias');
  assert.equal(new Set(min).size, min.length, 'sem duplicatas');
});

// ── O nome como se escreve numa mensagem ────────────────────────────────────

test('cliente em CAIXA ALTA vira nome apresentável', () => {
  // É assim que o cadastro guarda. "Bom dia, HELEN." se lê como grito.
  assert.equal(nomeApresentavel('HELEN CRISTINA DE ALMEIDA SILVA'), 'Helen Cristina de Almeida Silva');
  assert.equal(primeiroNomeApresentavel('HELEN CRISTINA DE ALMEIDA SILVA'), 'Helen');
});

test('as partículas ficam minúsculas, menos quando abrem o nome', () => {
  assert.equal(nomeApresentavel('MARIA DAS DORES DOS SANTOS'), 'Maria das Dores dos Santos');
  assert.equal(nomeApresentavel('DA SILVA JUNIOR'), 'Da Silva Junior', 'a primeira palavra sempre sobe');
});

test('nome em caixa MISTA é devolvido intacto', () => {
  // Quem digitou "McDonald" ou "d'Ávila" sabe melhor que esta função.
  assert.equal(nomeApresentavel("Ronald McDonald"), 'Ronald McDonald');
  assert.equal(nomeApresentavel("Ana d'Ávila"), "Ana d'Ávila");
});

test('minúsculo também é corrigido', () => {
  assert.equal(nomeApresentavel('joão pedro de souza'), 'João Pedro de Souza');
});

test('vazio e nulo não viram texto estranho', () => {
  for (const v of ['', '   ', null, undefined]) {
    assert.equal(nomeApresentavel(v), '');
    assert.equal(primeiroNomeApresentavel(v), '');
  }
});
