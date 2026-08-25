import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MENU_MARGIN,
  buildMessageMenuItems,
  clampMenuPosition,
  estimateMenuHeight,
  fonteDoTextoCopiavel,
  messageMenuCapabilities,
  runMessageMenuAction,
  temTextoCopiavel,
  textoParaCopiar,
  type MensagemDoMenu,
  type RecursosDoHost,
  type TextoVisivelDeps,
} from './messageMenu.ts';
// As funções REAIS de leitura do texto do WhatsApp: copiar tem de produzir o
// que a bolha desenha, e comparar com uma imitação não provaria nada.
import { stripAgentSignature, waPlainText } from './waRichText.ts';
import { proximaReacao } from '../../utils/waReactions.ts';

// `maskSensitive` mora em `format.ts`, que importa outros módulos — a cadeia
// não sobrevive ao ts-node do `npm test` (ver `testes-ts-node-imports`). Aqui
// ela entra como espião: o que este arquivo vigia é que o modo privado PASSE
// por ela e que o conteúdo cru nunca escape, não a máscara em si (essa tem
// teste próprio junto de `format.ts`).
function depsComEspiao() {
  const vistos: string[] = [];
  const deps: TextoVisivelDeps = {
    semMarcas: waPlainText,
    semAssinatura: stripAgentSignature,
    mascarar: (texto) => { vistos.push(texto); return texto.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '***.***.***-**'); },
  };
  return { deps, vistos };
}

const DEPS = depsComEspiao().deps;

const HOST_COMPLETO: RecursosDoHost = {
  temEncaminhar: true, temApagar: true, temReagir: true, temCopiar: true,
  temAcompanhamentos: true, temEditar: true, temReenviar: true,
};

const msg = (o: Partial<MensagemDoMenu> & Pick<MensagemDoMenu, 'type' | 'direction'>): MensagemDoMenu => ({
  id: o.id ?? 'm1',
  evolution_message_id: 'evo-1',
  ...o,
});

// ── Texto para copiar ────────────────────────────────────────────────────────

test('copia o texto sem as marcas do WhatsApp', () => {
  const m = msg({ type: 'text', direction: 'in', content: 'Bom dia, *doutor*! ~Já~ _enviei_ o documento.' });
  assert.equal(textoParaCopiar(m, {}, DEPS), 'Bom dia, doutor! Já enviei o documento.');
});

test('a assinatura escondida na bolha não vai junto', () => {
  const m = msg({ type: 'text', direction: 'out', content: '*Dr. Pedro:*\nSegue o andamento do processo.' });
  assert.equal(textoParaCopiar(m, {}, DEPS), 'Segue o andamento do processo.');
});

test('a assinatura só sai do texto nosso — na legenda de mídia ela está à vista', () => {
  const legenda = msg({ type: 'image', direction: 'out', content: '*Dr. Pedro:*\nSegue a foto.', storage_path: 'x.jpg' });
  assert.equal(textoParaCopiar(legenda, {}, DEPS), 'Dr. Pedro:\nSegue a foto.');

  const recebida = msg({ type: 'text', direction: 'in', content: '*Cliente:*\nBom dia.' });
  assert.equal(textoParaCopiar(recebida, {}, DEPS), 'Cliente:\nBom dia.');
});

test('modo privado copia o texto MASCARADO, nunca o real', () => {
  const { deps, vistos } = depsComEspiao();
  const cru = 'Meu CPF é *123.456.789-00*, doutor.';
  const m = msg({ type: 'text', direction: 'in', content: cru });

  const copiado = textoParaCopiar(m, { privateMode: true }, deps)!;
  assert.ok(!copiado.includes('123.456.789-00'), 'o CPF real não pode chegar à área de transferência');
  // O que se copia é, caractere por caractere, o que a bolha DESENHA — máscara
  // primeiro, leitura das marcas depois. Comparar com o texto mascarado cru
  // seria comparar com algo que ninguém vê na tela.
  assert.equal(copiado, waPlainText(deps.mascarar(cru)));
  // A máscara recebeu o texto CRU (com as marcas): mascarar depois de limpá-las
  // deixaria passar um documento escrito entre asteriscos.
  assert.deepEqual(vistos.slice(0, 1), [cru]);
});

test('áudio sem legenda copia a transcrição concluída — e só ela', () => {
  const pronto = msg({
    type: 'audio', direction: 'in',
    transcription_status: 'done', transcription_text: 'O senhor consegue verificar para mim?',
  });
  assert.equal(textoParaCopiar(pronto, {}, DEPS), 'O senhor consegue verificar para mim?');

  const transcrevendo = msg({ type: 'audio', direction: 'in', transcription_status: 'pending' });
  assert.equal(textoParaCopiar(transcrevendo, {}, DEPS), null);

  const falhou = msg({ type: 'audio', direction: 'in', transcription_status: 'failed', transcription_text: null });
  assert.equal(textoParaCopiar(falhou, {}, DEPS), null);
});

test('legenda ganha da transcrição: é o que está escrito na bolha', () => {
  const m = msg({
    type: 'audio', direction: 'in', content: 'Escute quando puder',
    transcription_status: 'done', transcription_text: 'transcrição longa',
  });
  assert.equal(fonteDoTextoCopiavel(m), 'Escute quando puder');
});

test('o que dá para copiar, por tipo de mensagem', () => {
  const copiaveis: MensagemDoMenu[] = [
    msg({ type: 'text', direction: 'in', content: 'oi' }),
    msg({ type: 'image', direction: 'in', content: 'legenda da foto', storage_path: 'a.jpg' }),
    msg({ type: 'contact', direction: 'in', content: 'Dra. Helena\n+5565999887766' }),
    msg({ type: 'location', direction: 'in', content: 'Fórum de Cuiabá\n-15.6, -56.09' }),
    msg({ type: 'poll', direction: 'in', content: 'Qual horário?\n• Terça' }),
    msg({ type: 'interactive', direction: 'in', content: 'Escolha uma opção\n1) Segunda via' }),
  ];
  for (const m of copiaveis) assert.equal(temTextoCopiavel(m), true, `${m.type} deveria ter o que copiar`);

  const semTexto: MensagemDoMenu[] = [
    msg({ type: 'image', direction: 'in', storage_path: 'a.jpg' }),
    msg({ type: 'sticker', direction: 'in', storage_path: 's.webp' }),
    msg({ type: 'video', direction: 'in', storage_path: 'v.mp4' }),
    msg({ type: 'document', direction: 'in', storage_path: 'd.pdf' }),
    msg({ type: 'text', direction: 'in', content: '   ' }),
    msg({ type: 'text', direction: 'in', content: null }),
  ];
  for (const m of semTexto) assert.equal(temTextoCopiavel(m), false, `${m.type} não deveria oferecer copiar`);
});

test('mensagem apagada não copia nada', () => {
  const m = msg({ type: 'text', direction: 'out', content: 'o que foi dito', deleted_at: '2026-08-24T12:00:00.000Z' });
  assert.equal(textoParaCopiar(m, {}, DEPS), null);
  assert.equal(buildMessageMenuItems(messageMenuCapabilities(m, HOST_COMPLETO)).length, 0);
});

// ── Capacidades e itens ──────────────────────────────────────────────────────

test('mensagem nossa entregue oferece o menu inteiro', () => {
  const caps = messageMenuCapabilities(msg({ type: 'text', direction: 'out', content: 'oi' }), HOST_COMPLETO);
  assert.equal(caps.editar, true);
  assert.equal(caps.apagarParaTodos, true);
  assert.equal(caps.apagarAqui, true);
  assert.equal(caps.reagir, true);
  assert.equal(caps.copiar, true);
});

test('mensagem em voo ou falhada não ganha ação inválida', () => {
  const enviando = messageMenuCapabilities(
    msg({ type: 'image', direction: 'out', _local: 'uploading', _tempId: 't1', evolution_message_id: null, storage_path: 'a.jpg' }),
    HOST_COMPLETO);
  assert.deepEqual(
    [enviando.reagir, enviando.apagarAqui, enviando.apagarParaTodos, enviando.encaminhar, enviando.reenviar],
    [false, false, false, false, false]);

  const falhada = messageMenuCapabilities(
    msg({ type: 'text', direction: 'out', content: 'oi', _local: 'failed', _tempId: 't2', evolution_message_id: null }),
    HOST_COMPLETO);
  assert.deepEqual([falhada.reagir, falhada.encaminhar, falhada.editar, falhada.apagarAqui], [false, false, false, false]);
  // Copiar continua: o texto está na tela, e é justamente o que se quer salvar
  // antes de descartar a mensagem que não saiu.
  assert.equal(falhada.copiar, true);
});

test('recebida não apaga para todos e não edita', () => {
  const caps = messageMenuCapabilities(msg({ type: 'text', direction: 'in', content: 'oi' }), HOST_COMPLETO);
  assert.equal(caps.apagarParaTodos, false);
  assert.equal(caps.apagarAqui, true);
  assert.equal(caps.editar, false);
});

test('host sem o recurso não mostra o item, mesmo que a mensagem aceitasse', () => {
  const caps = messageMenuCapabilities(
    msg({ type: 'text', direction: 'out', content: 'oi' }),
    { ...HOST_COMPLETO, temApagar: false, temEncaminhar: false, temReagir: false, temAcompanhamentos: false });
  const ids = buildMessageMenuItems(caps).map(i => i.id);
  assert.deepEqual(ids, ['reply', 'copy', 'edit']);
});

test('sem evolution_message_id não há reação nem revogação', () => {
  const caps = messageMenuCapabilities(
    msg({ type: 'text', direction: 'out', content: 'oi', evolution_message_id: null }), HOST_COMPLETO);
  assert.equal(caps.reagir, false);
  assert.equal(caps.apagarParaTodos, false);
  assert.equal(caps.apagarAqui, true);
});

test('os fios separam blocos, nunca abrem o menu', () => {
  const itens = buildMessageMenuItems(messageMenuCapabilities(
    msg({ type: 'text', direction: 'out', content: 'oi' }), HOST_COMPLETO));
  assert.equal(itens[0].separaAntes, undefined);
  assert.deepEqual(itens.map(i => i.id),
    ['reply', 'copy', 'forward', 'edit', 'deadline', 'task', 'delete-everyone', 'delete-local']);
  assert.equal(itens.find(i => i.id === 'deadline')!.separaAntes, true);
  assert.equal(itens.find(i => i.id === 'delete-everyone')!.separaAntes, true);
  // "Apagar só aqui" vem logo abaixo de "Apagar para todos": mesmo bloco.
  assert.equal(itens.find(i => i.id === 'delete-local')!.separaAntes, false);
});

// ── Álbum: a ação tem de pegar o item clicado ────────────────────────────────

test('no álbum, a ação recebe a imagem clicada — não a primeira do grupo', () => {
  const album = [
    msg({ id: 'foto-1', type: 'image', direction: 'out', storage_path: '1.jpg' }),
    msg({ id: 'foto-2', type: 'image', direction: 'out', storage_path: '2.jpg' }),
    msg({ id: 'foto-3', type: 'image', direction: 'out', storage_path: '3.jpg' }),
  ];
  const recebidas: string[] = [];
  const apagadas: Array<[string, string]> = [];
  const handlers = {
    reply: (m: MensagemDoMenu) => recebidas.push(m.id!),
    forward: (m: MensagemDoMenu) => recebidas.push(m.id!),
    remove: (m: MensagemDoMenu, scope: 'me' | 'everyone') => apagadas.push([m.id!, scope]),
  };

  runMessageMenuAction('reply', album[1], handlers);
  runMessageMenuAction('forward', album[2], handlers);
  runMessageMenuAction('delete-everyone', album[1], handlers);
  runMessageMenuAction('delete-local', album[0], handlers);

  assert.deepEqual(recebidas, ['foto-2', 'foto-3']);
  assert.deepEqual(apagadas, [['foto-2', 'everyone'], ['foto-1', 'me']]);
});

test('ação sem handler no host não estoura', () => {
  assert.doesNotThrow(() => runMessageMenuAction('copy', album1(), {}));
  function album1(): MensagemDoMenu { return msg({ type: 'image', direction: 'in' }); }
});

// ── Reação: trocar e remover ─────────────────────────────────────────────────

test('clicar na reação atual remove; em outra, troca', () => {
  assert.equal(proximaReacao('👍', '👍'), '');
  assert.equal(proximaReacao('👍', '❤️'), '❤️');
  assert.equal(proximaReacao(null, '❤️'), '❤️');
});

// ── Posição do menu ──────────────────────────────────────────────────────────

const VIEWPORT = { width: 1280, height: 800 };
const TAMANHO = { width: 192, height: 260 };

test('clique direito abre no ponteiro quando há espaço', () => {
  const p = clampMenuPosition({ ancora: { tipo: 'ponteiro', x: 400, y: 200 }, tamanho: TAMANHO, viewport: VIEWPORT });
  assert.deepEqual(p, { top: 200, left: 400 });
});

test('perto do rodapé, o menu vira para cima e cabe inteiro', () => {
  const p = clampMenuPosition({ ancora: { tipo: 'ponteiro', x: 400, y: 780 }, tamanho: TAMANHO, viewport: VIEWPORT });
  assert.equal(p.top, 780 - TAMANHO.height);
  assert.ok(p.top + TAMANHO.height <= VIEWPORT.height - MENU_MARGIN);
});

test('perto da borda direita, o menu não sai da tela', () => {
  const p = clampMenuPosition({ ancora: { tipo: 'ponteiro', x: 1275, y: 100 }, tamanho: TAMANHO, viewport: VIEWPORT });
  assert.equal(p.left, VIEWPORT.width - TAMANHO.width - MENU_MARGIN);
  assert.ok(p.left >= MENU_MARGIN);
});

test('mensagem nossa abre alinhada à direita do ponteiro, sem estourar a esquerda', () => {
  const folgado = clampMenuPosition({
    ancora: { tipo: 'ponteiro', x: 900, y: 100 }, tamanho: TAMANHO, viewport: VIEWPORT, alinharDireita: true });
  assert.equal(folgado.left, 900 - TAMANHO.width);

  const apertado = clampMenuPosition({
    ancora: { tipo: 'ponteiro', x: 20, y: 100 }, tamanho: TAMANHO, viewport: VIEWPORT, alinharDireita: true });
  assert.equal(apertado.left, MENU_MARGIN);
});

test('menu mais alto que a janela encosta no topo em vez de sumir', () => {
  const p = clampMenuPosition({
    ancora: { tipo: 'ponteiro', x: 100, y: 300 }, tamanho: { width: 192, height: 900 }, viewport: VIEWPORT });
  assert.equal(p.top, MENU_MARGIN);
});

test('janela mais estreita que o menu: a margem da esquerda ganha', () => {
  const p = clampMenuPosition({
    ancora: { tipo: 'ponteiro', x: 100, y: 100 }, tamanho: TAMANHO, viewport: { width: 150, height: 800 } });
  assert.equal(p.left, MENU_MARGIN);
});

test('a setinha do hover pende do botão e vira para cima quando não cabe', () => {
  const rect = { top: 120, bottom: 144, left: 500, right: 524 };
  const abaixo = clampMenuPosition({ ancora: { tipo: 'retangulo', rect }, tamanho: TAMANHO, viewport: VIEWPORT });
  assert.deepEqual(abaixo, { top: 150, left: 500 });

  const rodape = { top: 700, bottom: 724, left: 500, right: 524 };
  const acima = clampMenuPosition({ ancora: { tipo: 'retangulo', rect: rodape }, tamanho: TAMANHO, viewport: VIEWPORT });
  assert.equal(acima.top, 700 - TAMANHO.height - 6);
});

test('mensagem nossa: a setinha alinha a borda direita do menu ao botão', () => {
  const rect = { top: 120, bottom: 144, left: 900, right: 924 };
  const p = clampMenuPosition({ ancora: { tipo: 'retangulo', rect }, tamanho: TAMANHO, viewport: VIEWPORT, alinharDireita: true });
  assert.equal(p.left, 924 - TAMANHO.width);
});

test('a altura estimada cresce com itens, fios e a faixa de reações', () => {
  const curto = buildMessageMenuItems({
    responder: true, copiar: true, encaminhar: false, editar: false, reenviar: false,
    acompanhamentos: false, apagarAqui: false, apagarParaTodos: false, reagir: false,
  });
  const longo = buildMessageMenuItems(messageMenuCapabilities(
    msg({ type: 'text', direction: 'out', content: 'oi' }), HOST_COMPLETO));

  assert.ok(estimateMenuHeight(longo) > estimateMenuHeight(curto));
  assert.ok(estimateMenuHeight(longo, true) > estimateMenuHeight(longo));
});
