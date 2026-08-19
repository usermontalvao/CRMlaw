import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLines, canUseChannel, channelForPhone, defaultLine, displayLine, lineBlockText,
  phoneFromJid, samePhone, sessionPhone,
} from './callLine.ts';
import type { ChannelRow, SessionRow } from './callLine.ts';

// Os dois canais reais do escritório, como estão cadastrados hoje.
const PEDRO: ChannelRow = {
  id: 'canal-pedro', name: 'Pedro', phone: '5565984046375', visibility: 'restricted',
};
const COMERCIAL: ChannelRow = {
  id: 'canal-comercial', name: 'Comercial', phone: '5565992797030', visibility: 'all',
};
const CANAIS = [PEDRO, COMERCIAL];

const sessao = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: 'default', name: 'Jurius', jid: '5565984046375:12@s.whatsapp.net',
  paired: true, state: 'open', ...over,
});

test('o telefone sai do JID, sem o número do aparelho', () => {
  assert.equal(phoneFromJid('5565984046375:12@s.whatsapp.net'), '5565984046375');
  assert.equal(phoneFromJid('5565984046375@s.whatsapp.net'), '5565984046375');
  assert.equal(phoneFromJid(''), '');
});

test('LID não vira telefone — nem aqui', () => {
  // Um apelido interno tem cara de número e não é. Ver `whatsapp-lid-nao-e-telefone`.
  assert.equal(phoneFromJid('209384756473829@lid'), '');
});

test('o que o serviço informa vale mais do que o JID', () => {
  assert.equal(sessionPhone(sessao({ phone: '+55 65 99279-7030' })), '5565992797030');
  assert.equal(sessionPhone(sessao({ phone: null })), '5565984046375');
});

test('a linha encontra o canal mesmo com o cadastro escrito de outro jeito', () => {
  assert.equal(channelForPhone('5565992797030', CANAIS)?.id, 'canal-comercial');
  // Sem o código do país no cadastro do canal.
  assert.equal(channelForPhone('5565992797030', [{ ...COMERCIAL, phone: '65992797030' }])?.id, 'canal-comercial');
  // Com máscara, do jeito que alguém digita.
  assert.equal(channelForPhone('5565992797030', [{ ...COMERCIAL, phone: '(65) 99279-7030' }])?.id, 'canal-comercial');
  assert.equal(channelForPhone('5511999998888', CANAIS), null);
  assert.equal(channelForPhone('', CANAIS), null);
});

test('o nono dígito não separa a linha do canal dela', () => {
  // O CASO REAL, visto na bancada em 19/08/2026: o WhatsApp reporta a conta
  // pareada SEM o nono dígito (`556584046375`) e o canal está cadastrado COM
  // ele (`5565984046375`). Sem as variantes, a linha do escritório não achava
  // o próprio canal — e uma linha "fora do cadastro" é liberada para todos,
  // ou seja, a permissão por canal deixaria de existir sem ninguém notar.
  assert.equal(channelForPhone('556584046375', CANAIS)?.id, 'canal-pedro');
  assert.equal(channelForPhone('5565984046375', CANAIS)?.id, 'canal-pedro');
  assert.ok(samePhone('556584046375', '5565984046375'));
  assert.ok(!samePhone('556584046375', '5565992797030'));
});

test('administrador fala por qualquer linha', () => {
  assert.ok(canUseChannel({ channel: PEDRO, isAdmin: true, memberOf: new Set() }));
});

test('canal aberto é do escritório inteiro', () => {
  assert.ok(canUseChannel({ channel: COMERCIAL, isAdmin: false, memberOf: new Set() }));
});

test('canal restrito exige estar na lista de membros', () => {
  assert.ok(!canUseChannel({ channel: PEDRO, isAdmin: false, memberOf: new Set() }));
  assert.ok(canUseChannel({ channel: PEDRO, isAdmin: false, memberOf: new Set(['canal-pedro']) }));
});

test('ter conversa atribuída NÃO entra na conta — é a diferença para a inbox', () => {
  // A regra da inbox (`wa_can_see_channel`) libera quem tem conversa atribuída
  // no canal. Aqui não existe esse caminho: a regra só olha a lista de membros,
  // e é por isso que ela não recebe conversa nenhuma como parâmetro.
  assert.ok(!canUseChannel({ channel: PEDRO, isAdmin: false, memberOf: new Set(['outro-canal']) }));
});

test('linha fora do cadastro não bloqueia ninguém', () => {
  // Conta pareada cujo número não é canal nenhum: falha de cadastro, não
  // restrição. Bloquear derrubaria o telefone do escritório inteiro.
  assert.ok(canUseChannel({ channel: null, isAdmin: false, memberOf: new Set() }));
});

test('a lista é dos CANAIS: o que não tem voz aparece dizendo que não tem', () => {
  // A pergunta do escritório em 19/08 — "cadê a opção de trocar de canal?" — só
  // tem resposta se o canal sem voz aparecer. Uma lista feita das contas
  // pareadas mostraria uma linha só e esconderia o que falta fazer.
  const linhas = buildLines({
    sessions: [sessao({ jid: '556584046375@s.whatsapp.net', phone: '556584046375' })],
    channels: CANAIS, isAdmin: true, memberOf: new Set(),
  });
  assert.deepEqual(linhas.map(l => l.label), ['Pedro', 'Comercial']);

  const [pedro, comercial] = linhas;
  // A que tem voz: discável, com o número do CADASTRO (com o nono dígito).
  assert.equal(pedro.sessionId, 'default');
  assert.equal(pedro.phone, '5565984046375');
  assert.equal(pedro.block, null);
  // A que não tem: aparece, nomeada, e não é escolhível.
  assert.equal(comercial.sessionId, null);
  assert.equal(comercial.block, 'no-voice');
  assert.ok(comercial.authorized);
  assert.match(lineBlockText(comercial.block, comercial.label), /ainda não tem voz/);
});

test('conta pareada fora do cadastro entra como linha do escritório', () => {
  const linhas = buildLines({
    sessions: [sessao({ jid: '5511999998888@s.whatsapp.net', name: 'Recepção' })],
    channels: CANAIS, isAdmin: false, memberOf: new Set(),
  });
  const solta = linhas.find(l => l.channelId === null)!;
  assert.equal(solta.label, 'Recepção');
  assert.ok(solta.authorized);
  assert.equal(solta.sessionId, 'default');
});

test('as usáveis vêm na frente, e a padrão é a primeira que está de pé', () => {
  const linhas = buildLines({
    sessions: [
      sessao({ id: 'pedro' }),
      sessao({ id: 'comercial', jid: '5565992797030@s.whatsapp.net' }),
    ],
    channels: CANAIS,
    isAdmin: false,
    memberOf: new Set(),
  });
  // Não sendo membro do canal restrito, sobra o Comercial — e é ele o padrão.
  assert.equal(defaultLine(linhas)?.channelId, 'canal-comercial');
  assert.equal(linhas[0].channelId, 'canal-comercial');
  assert.equal(linhas[linhas.length - 1].block, 'not-member');
});

test('linha pareada mas desconectada não vira a padrão', () => {
  const linhas = buildLines({
    sessions: [sessao({ state: 'connecting' })],
    channels: CANAIS, isAdmin: true, memberOf: new Set(),
  });
  assert.equal(linhas.find(l => l.channelId === 'canal-pedro')?.block, 'offline');
  assert.equal(defaultLine(linhas), null);
});

test('sem nenhuma linha discável, a faixa ainda nomeia um canal', () => {
  // O DEFEITO de 19/08: com a conta de voz fora do ar, a faixa caía em "Linha
  // do escritório", sem número e sem motivo. Agora ela mostra o canal e diz
  // o que falta nele.
  const linhas = buildLines({
    sessions: [], channels: CANAIS, isAdmin: true, memberOf: new Set(),
  });
  assert.equal(defaultLine(linhas), null);
  const mostrada = displayLine(linhas, null);
  assert.ok(mostrada);
  assert.equal(mostrada!.block, 'no-voice');
  assert.ok(mostrada!.label === 'Pedro' || mostrada!.label === 'Comercial');
});

test('a escolha manual manda na faixa enquanto for válida', () => {
  const linhas = buildLines({
    sessions: [
      sessao({ id: 'pedro' }),
      sessao({ id: 'comercial', jid: '5565992797030@s.whatsapp.net' }),
    ],
    channels: CANAIS, isAdmin: true, memberOf: new Set(),
  });
  assert.equal(displayLine(linhas, 'pedro')?.channelId, 'canal-pedro');
  assert.equal(displayLine(linhas, 'comercial')?.channelId, 'canal-comercial');
  // Escolha que não existe mais: cai na padrão, não em texto genérico.
  assert.ok(displayLine(linhas, 'sumiu'));
});

test('a estrela decide por qual linha o discador abre', () => {
  const linhas = buildLines({
    sessions: [
      sessao({ id: 'pedro' }),
      sessao({ id: 'comercial', jid: '5565992797030@s.whatsapp.net' }),
    ],
    channels: CANAIS, isAdmin: true, memberOf: new Set(),
  });
  // Sem estrela, vale a ordem de utilidade (a primeira usável).
  const semEstrela = defaultLine(linhas)!;
  assert.ok(semEstrela.sessionId);
  // Com estrela no Comercial, é ele quem abre — mesmo não sendo o primeiro.
  assert.equal(defaultLine(linhas, 'canal-comercial')?.channelId, 'canal-comercial');
  assert.equal(defaultLine(linhas, 'canal-pedro')?.channelId, 'canal-pedro');
});

test('estrela numa linha que não dá para usar não trava o discador', () => {
  // O Comercial está marcado, mas não tem voz. Abrir "preferindo" uma linha que
  // não liga seria transformar a estrela numa armadilha: cai na usável.
  const linhas = buildLines({
    sessions: [sessao({ id: 'pedro' })],
    channels: CANAIS, isAdmin: true, memberOf: new Set(),
  });
  assert.equal(defaultLine(linhas, 'canal-comercial')?.channelId, 'canal-pedro');
});

test('sem nada discável, a faixa mostra a preferida e explica', () => {
  const linhas = buildLines({ sessions: [], channels: CANAIS, isAdmin: true, memberOf: new Set() });
  const mostrada = displayLine(linhas, null, 'canal-comercial');
  assert.equal(mostrada?.channelId, 'canal-comercial');
  assert.equal(mostrada?.block, 'no-voice');
});
