import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_FOLLOWUP_DEFAULTS,
  WA_AI_FOLLOWUP_MESSAGE_MAX,
  buildWaAiAutoMemory,
  buildWaAiFollowupMessage,
  decideAutoFollowup,
  decideFollowup,
  followupIntervalHours,
  isWithinFollowupWindow,
  localPartsInTz,
  nextAllowedSlot,
  nextFollowupAt,
  normalizeWaAiFollowupPolicy,
  waAiFirstName,
  waAiLastQuestion,
  zonedWallTimeToUtc,
  type WaAiAutoFollowupContext,
  type WaAiFollowupPolicy,
  type WaAiFollowupState,
} from './waAiFollowupPolicy.ts';

/** Segunda a sexta, 08:00–18:00, America/Cuiaba (UTC-4, sem horário de verão). */
const POLICY: WaAiFollowupPolicy = {
  ...WA_AI_FOLLOWUP_DEFAULTS,
  enabled: true,
  maxAttempts: 3,
};

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiFollowupPolicy.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-followup.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-followup.ts divergiu de waAiFollowupPolicy.ts — copie o arquivo inteiro');
});

// ── Fuso ────────────────────────────────────────────────────────────────────

test('a hora de parede é a do canal, não a do processo', () => {
  // 2026-08-12T15:00Z = 11:00 em Cuiabá (UTC-4).
  const p = localPartsInTz(new Date('2026-08-12T15:00:00Z'), 'America/Cuiaba');
  assert.equal(p.hour, 11);
  assert.equal(p.day, 12);
  assert.equal(p.dow, 3); // quarta
});

test('zonedWallTimeToUtc volta ao mesmo instante', () => {
  const utc = zonedWallTimeToUtc(2026, 8, 12, 9, 30, 'America/Cuiaba');
  assert.equal(utc.toISOString(), '2026-08-12T13:30:00.000Z');
});

test('fuso inválido cai para UTC em vez de estourar', () => {
  const p = localPartsInTz(new Date('2026-08-12T15:00:00Z'), 'Fuso/Inexistente');
  assert.equal(p.hour, 15);
});

// ── Intervalos ──────────────────────────────────────────────────────────────

test('intervalo fixo repete o mesmo valor', () => {
  const p = { ...POLICY, strategy: 'fixed' as const, intervalHours: 6 };
  assert.deepEqual([1, 2, 3].map(n => followupIntervalHours(p, n)), [6, 6, 6]);
});

test('intervalo progressivo dobra a cada tentativa', () => {
  const p = { ...POLICY, strategy: 'progressive' as const, intervalHours: 4 };
  assert.deepEqual([1, 2, 3, 4].map(n => followupIntervalHours(p, n)), [4, 8, 16, 32]);
});

test('intervalo personalizado usa a lista e repete o último', () => {
  const p = { ...POLICY, strategy: 'custom' as const, customHours: [4, 24, 72] };
  assert.deepEqual([1, 2, 3, 4].map(n => followupIntervalHours(p, n)), [4, 24, 72, 72]);
});

test('intervalo personalizado aceita sequência decrescente', () => {
  const p = { ...POLICY, strategy: 'custom' as const, customHours: [72, 24, 4] };
  assert.deepEqual([1, 2, 3].map(n => followupIntervalHours(p, n)), [72, 24, 4]);
});

test('personalizado sem lista cai no intervalo base', () => {
  const p = { ...POLICY, strategy: 'custom' as const, customHours: [], intervalHours: 10 };
  assert.equal(followupIntervalHours(p, 1), 10);
});

// ── Janela ──────────────────────────────────────────────────────────────────

test('reconhece dentro e fora da janela', () => {
  // Quarta 11:00 em Cuiabá.
  assert.equal(isWithinFollowupWindow(new Date('2026-08-12T15:00:00Z'), POLICY), true);
  // Quarta 06:00 em Cuiabá (antes das 08:00).
  assert.equal(isWithinFollowupWindow(new Date('2026-08-12T10:00:00Z'), POLICY), false);
  // Quarta 19:00 em Cuiabá (depois das 18:00).
  assert.equal(isWithinFollowupWindow(new Date('2026-08-12T23:00:00Z'), POLICY), false);
  // Domingo 11:00 em Cuiabá.
  assert.equal(isWithinFollowupWindow(new Date('2026-08-16T15:00:00Z'), POLICY), false);
});

test('instante dentro da janela não é adiado', () => {
  const dentro = new Date('2026-08-12T15:00:00Z'); // quarta 11:00
  assert.equal(nextAllowedSlot(dentro, POLICY).toISOString(), dentro.toISOString());
});

test('madrugada é empurrada para a abertura do mesmo dia', () => {
  const madrugada = new Date('2026-08-12T06:00:00Z'); // quarta 02:00 em Cuiabá
  assert.equal(nextAllowedSlot(madrugada, POLICY).toISOString(), '2026-08-12T12:00:00.000Z'); // 08:00
});

test('depois do fechamento vai para a abertura do próximo dia útil', () => {
  const noite = new Date('2026-08-12T23:30:00Z'); // quarta 19:30 em Cuiabá
  assert.equal(nextAllowedSlot(noite, POLICY).toISOString(), '2026-08-13T12:00:00.000Z'); // quinta 08:00
});

test('sexta à noite atravessa o fim de semana até segunda', () => {
  const sextaNoite = new Date('2026-08-14T23:30:00Z'); // sexta 19:30 em Cuiabá
  assert.equal(nextAllowedSlot(sextaNoite, POLICY).toISOString(), '2026-08-17T12:00:00.000Z'); // segunda 08:00
});

test('janela que inclui o fim de semana não pula o sábado', () => {
  const p = { ...POLICY, days: [0, 1, 2, 3, 4, 5, 6] };
  const sextaNoite = new Date('2026-08-14T23:30:00Z');
  assert.equal(nextAllowedSlot(sextaNoite, p).toISOString(), '2026-08-15T12:00:00.000Z'); // sábado 08:00
});

test('a virada de mês é resolvida sem cair no dia 32', () => {
  const p = { ...POLICY, days: [0, 1, 2, 3, 4, 5, 6] };
  const fimDoMes = new Date('2026-08-31T23:30:00Z'); // segunda 19:30 em Cuiabá
  assert.equal(nextAllowedSlot(fimDoMes, p).toISOString(), '2026-09-01T12:00:00.000Z');
});

// ── Agendamento ─────────────────────────────────────────────────────────────

test('a primeira tentativa conta o silêncio de inatividade antes do degrau', () => {
  // Quarta 11:00 + 10min de silêncio + 24h = quinta 11:10, dentro da janela.
  // Os 10 minutos NÃO são uma tentativa: são o que define a pessoa como
  // inativa, e só então o relógio do acompanhamento começa a andar.
  const at = nextFollowupAt(POLICY, 1, '2026-08-12T15:00:00Z');
  assert.equal(at?.toISOString(), '2026-08-13T15:10:00.000Z');
});

test('da segunda tentativa em diante o silêncio já não é somado de novo', () => {
  // A inatividade já está estabelecida: contar outra vez empurraria a escada.
  const at = nextFollowupAt(POLICY, 2, '2026-08-12T15:00:00Z');
  assert.equal(at?.toISOString(), '2026-08-13T15:00:00.000Z');
});

test('sem limiar configurado, a escada começa na hora da última fala', () => {
  const at = nextFollowupAt({ ...POLICY, inactivityMinutes: 0 }, 1, '2026-08-12T15:00:00Z');
  assert.equal(at?.toISOString(), '2026-08-13T15:00:00.000Z');
});

test('intervalo que cai de madrugada é empurrado para a abertura', () => {
  const p = { ...POLICY, intervalHours: 4 };
  // Quarta 17:00 em Cuiabá + 10min + 4h = 21:10 → quinta 08:00.
  const at = nextFollowupAt(p, 1, '2026-08-12T21:00:00Z');
  assert.equal(at?.toISOString(), '2026-08-13T12:00:00.000Z');
});

test('política desligada não agenda', () => {
  assert.equal(nextFollowupAt({ ...POLICY, enabled: false }, 1, '2026-08-12T15:00:00Z'), null);
});

test('tentativa acima do máximo não agenda', () => {
  assert.equal(nextFollowupAt(POLICY, 4, '2026-08-12T15:00:00Z'), null);
});

test('data de origem inválida não agenda', () => {
  assert.equal(nextFollowupAt(POLICY, 1, 'não é data'), null);
});

// ── Normalização ────────────────────────────────────────────────────────────

test('normalização apara dias repetidos, fora de faixa e desordenados', () => {
  const p = normalizeWaAiFollowupPolicy({ days: [5, 1, 1, 9, -2, 3] });
  assert.deepEqual(p.days, [1, 3, 5]);
});

test('sem dia nenhum válido, volta ao padrão de dias úteis', () => {
  assert.deepEqual(normalizeWaAiFollowupPolicy({ days: [42] }).days, [1, 2, 3, 4, 5]);
});

test('janela invertida volta ao padrão', () => {
  const p = normalizeWaAiFollowupPolicy({ startMinute: 1200, endMinute: 400 });
  assert.equal(p.startMinute, 480);
  assert.equal(p.endMinute, 1080);
});

test('intervalos personalizados negativos ou absurdos são descartados', () => {
  const p = normalizeWaAiFollowupPolicy({ customHours: [4, -1, 0, 24, 5000, 72] });
  assert.deepEqual(p.customHours, [4, 24, 72]);
});

test('máximo de tentativas fica entre 1 e 10', () => {
  assert.equal(normalizeWaAiFollowupPolicy({ maxAttempts: 99 }).maxAttempts, 10);
  assert.equal(normalizeWaAiFollowupPolicy({ maxAttempts: 0 }).maxAttempts, 1);
});

// ── Parada ──────────────────────────────────────────────────────────────────

const BASE: WaAiFollowupState = {
  attempt: 1,
  createdAtIso: '2026-08-12T12:00:00Z',
  lastCustomerMessageAtIso: null,
  conversationStatus: 'open',
  aiActive: true,
  assistantActive: true,
  channelAiEnabled: true,
  followupEnabled: true,
  maxAttempts: 3,
};

test('estado normal envia', () => {
  assert.deepEqual(decideFollowup(BASE), { send: true });
});

test('para quando o cliente respondeu depois do agendamento', () => {
  const d = decideFollowup({ ...BASE, lastCustomerMessageAtIso: '2026-08-12T13:00:00Z' });
  assert.equal(d.send, false);
  assert.equal((d as { reason: string }).reason, 'Cliente respondeu.');
});

test('resposta ANTERIOR ao agendamento não impede o envio', () => {
  assert.deepEqual(decideFollowup({ ...BASE, lastCustomerMessageAtIso: '2026-08-12T11:00:00Z' }), { send: true });
});

test('para quando a conversa foi encerrada', () => {
  assert.equal(decideFollowup({ ...BASE, conversationStatus: 'closed' }).send, false);
});

test('para no handoff humano', () => {
  const d = decideFollowup({ ...BASE, aiActive: false });
  assert.match((d as { reason: string }).reason, /atendimento humano/);
});

test('para quando a IA é desativada no canal', () => {
  assert.equal(decideFollowup({ ...BASE, channelAiEnabled: false }).send, false);
});

test('para quando o agente é desativado', () => {
  assert.equal(decideFollowup({ ...BASE, assistantActive: false }).send, false);
});

test('para quando o follow-up é desligado no agente', () => {
  assert.equal(decideFollowup({ ...BASE, followupEnabled: false }).send, false);
});

test('para quando o objetivo já foi concluído', () => {
  const d = decideFollowup({ ...BASE, goalCompleted: true });
  assert.match((d as { reason: string }).reason, /Objetivo/);
});

test('para no máximo de tentativas', () => {
  const d = decideFollowup({ ...BASE, attempt: 4 });
  assert.match((d as { reason: string }).reason, /máximo de tentativas/);
});

// ── Piloto automático: quando o BACKEND garante a retomada ──────────────────

/**
 * A campanha real "Sem registro na carteira": 8 tentativas em 2h, 4h, 8h, 24h,
 * 48h, 7 dias, 10 dias e 14 dias, de segunda a sexta, das 08:00 às 18:00.
 */
const CAMPANHA: WaAiFollowupPolicy = {
  ...POLICY,
  strategy: 'custom',
  customHours: [2, 4, 8, 24, 48, 168, 240, 336],
  maxAttempts: 8,
};

const TURNO_OK: WaAiAutoFollowupContext = {
  mode: 'auto',
  replySent: true,
  policyEnabled: true,
  maxAttempts: 8,
  attemptsDone: 0,
  assistantActive: true,
  channelAiEnabled: true,
  aiActive: true,
  sessionStatus: 'active',
  conversationStatus: 'open',
  conversationBlocked: false,
  assignedUserId: null,
  awaitingAccept: false,
  handedOff: false,
};

test('a resposta normal da IA manda agendar a primeira tentativa', () => {
  assert.deepEqual(decideAutoFollowup(TURNO_OK), { schedule: true, attempt: 1 });
});

test('a escada continua de onde parou: o contador só anda quando um sai', () => {
  // DECISÃO DO PROJETO, e é a que este teste fixa: a resposta do cliente
  // CANCELA o pendente, mas NÃO reinicia a escada. `followup_attempts` conta
  // acompanhamentos ENVIADOS, então a retomada seguinte é a próxima da lista —
  // e o teto de 8 vale para a conversa inteira, não para cada silêncio. Reiniciar
  // daria, a um cliente que responde e some várias vezes, retomadas sem fim.
  assert.deepEqual(decideAutoFollowup({ ...TURNO_OK, attemptsDone: 2 }), { schedule: true, attempt: 3 });
});

test('nada é agendado em modo de teste', () => {
  const d = decideAutoFollowup({ ...TURNO_OK, mode: 'test' });
  assert.equal(d.schedule, false);
  assert.match(d.schedule === false ? d.reason : '', /modo de teste/i);
});

test('turno sem mensagem entregue não agenda retomada', () => {
  // Falha de envio, resposta vazia, modo de teste: não há o que retomar.
  assert.equal(decideAutoFollowup({ ...TURNO_OK, replySent: false }).schedule, false);
});

test('handoff não cria follow-up', () => {
  assert.equal(decideAutoFollowup({ ...TURNO_OK, handedOff: true }).schedule, false);
  assert.equal(decideAutoFollowup({ ...TURNO_OK, aiActive: false }).schedule, false);
  assert.equal(decideAutoFollowup({ ...TURNO_OK, sessionStatus: 'handed_off' }).schedule, false);
});

test('conversa assumida por atendente não cria follow-up', () => {
  const d = decideAutoFollowup({ ...TURNO_OK, assignedUserId: 'u-1' });
  assert.equal(d.schedule, false);
  assert.match(d.schedule === false ? d.reason : '', /assumida/i);
  assert.equal(decideAutoFollowup({ ...TURNO_OK, awaitingAccept: true }).schedule, false);
});

test('as demais paradas: política, agente, canal, conversa e bloqueio', () => {
  const parado = (patch: Partial<WaAiAutoFollowupContext>) =>
    decideAutoFollowup({ ...TURNO_OK, ...patch }).schedule === false;
  assert.ok(parado({ policyEnabled: false }));
  assert.ok(parado({ assistantActive: false }));
  assert.ok(parado({ channelAiEnabled: false }));
  assert.ok(parado({ conversationStatus: 'closed' }));
  assert.ok(parado({ conversationBlocked: true }));
  assert.ok(parado({ goalCompleted: true }));
  assert.ok(parado({ followupCancelled: true }));
});

test('o assistente que cancelou o acompanhamento não é desmentido no fim do turno', () => {
  const d = decideAutoFollowup({ ...TURNO_OK, followupCancelled: true });
  assert.match(d.schedule === false ? d.reason : '', /cancelou/i);
});

test('a tentativa 8 é a última: não nasce uma nona', () => {
  assert.deepEqual(decideAutoFollowup({ ...TURNO_OK, attemptsDone: 7 }), { schedule: true, attempt: 8 });
  const nona = decideAutoFollowup({ ...TURNO_OK, attemptsDone: 8 });
  assert.equal(nona.schedule, false);
  assert.match(nona.schedule === false ? nona.reason : '', /máximo de tentativas/i);
});

test('a escada da campanha é 2h, 4h, 8h, 24h, 48h, 7 dias, 10 dias e 14 dias', () => {
  const escada = [1, 2, 3, 4, 5, 6, 7, 8].map(n => followupIntervalHours(CAMPANHA, n));
  assert.deepEqual(escada, [2, 4, 8, 24, 48, 168, 240, 336]);
  // A primeira soma o silêncio de inatividade (10min); as seguintes, não.
  const primeira = nextFollowupAt(CAMPANHA, 1, '2026-08-12T15:29:28.000Z');
  assert.equal(primeira?.toISOString(), '2026-08-12T17:39:00.000Z');
  const segunda = nextFollowupAt(CAMPANHA, 2, primeira!);
  assert.equal(segunda?.toISOString(), '2026-08-12T21:39:00.000Z');
  // A nona não existe nem no cálculo.
  assert.equal(nextFollowupAt(CAMPANHA, 9, '2026-08-12T15:29:28.000Z'), null);
});

// ── O texto da retomada ─────────────────────────────────────────────────────

test('o primeiro nome sai do contato — e número não vira nome', () => {
  assert.equal(waAiFirstName('PEDRO RODRIGUES MONTALVAO NETO'), 'PEDRO');
  assert.equal(waAiFirstName('pedro'), 'Pedro');
  assert.equal(waAiFirstName('556699998888'), null);
  assert.equal(waAiFirstName('  '), null);
  assert.equal(waAiFirstName(null), null);
});

test('a última pergunta da IA é extraída da resposta que ela enviou', () => {
  assert.equal(
    waAiLastQuestion('Certo! Pode me dizer quando você saiu, Pedro? Mês e ano, por favor.'),
    'Pode me dizer quando você saiu, Pedro?');
  assert.equal(waAiLastQuestion('Tudo certo, obrigado.'), null);
  assert.equal(waAiLastQuestion(''), null);
});

test('a retomada nomeia o que ficou faltando, nunca "ainda tem interesse?"', () => {
  const texto = buildWaAiFollowupMessage({
    firstName: 'Pedro',
    lastQuestion: 'Pode me dizer quando você saiu, Pedro?',
    pendingItems: ['você me dizer o mês e o ano em que saiu da empresa'],
    attempt: 1,
  });
  assert.equal(texto,
    'Oi, Pedro! Podemos continuar? Ficou faltando você me dizer o mês e o ano em que saiu da empresa.');
  assert.doesNotMatch(texto, /ainda tem interesse/i);
});

test('sem pendência anotada, a retomada repete a pergunta que ficou no ar', () => {
  const texto = buildWaAiFollowupMessage({
    firstName: 'Pedro',
    lastQuestion: 'Pode me dizer quando você saiu, Pedro?',
    pendingItems: [],
    attempt: 1,
  });
  assert.match(texto, /Ficou faltando você me responder: "Pode me dizer quando você saiu, Pedro\?"/);
});

test('o texto muda entre as tentativas para não parecer robô travado', () => {
  const textos = [1, 2, 3, 4].map(attempt => buildWaAiFollowupMessage({
    firstName: 'Pedro', lastQuestion: null, pendingItems: ['o mês e o ano da saída'], attempt,
  }));
  assert.equal(new Set(textos).size, 4);
  for (const t of textos) assert.match(t, /o mês e o ano da saída/);
});

test('sem nome e sem pendência a retomada ainda é uma frase inteira', () => {
  const texto = buildWaAiFollowupMessage({
    firstName: null, lastQuestion: null, pendingItems: [], attempt: 1,
  });
  assert.equal(texto, 'Oi! Podemos continuar? Se ainda fizer sentido, é só me responder por aqui que eu sigo com o seu atendimento.');
});

test('a retomada respeita o teto de 1200 caracteres da tabela', () => {
  const texto = buildWaAiFollowupMessage({
    firstName: 'Pedro', lastQuestion: 'x'.repeat(2000), pendingItems: [], attempt: 1,
  });
  assert.equal(texto.length, WA_AI_FOLLOWUP_MESSAGE_MAX);
});

test('pendência gigante é descartada, não truncada — meia instrução não vira frase', () => {
  const texto = buildWaAiFollowupMessage({
    firstName: 'Pedro', lastQuestion: null, pendingItems: ['x'.repeat(2000)], attempt: 1,
  });
  assert.doesNotMatch(texto, /x{10}/);
  assert.match(texto, /Se ainda fizer sentido/);
});

// ── A memória que o backend garante ─────────────────────────────────────────

test('sem anotação do modelo, o resumo é derivado das falas — sem inventar nada', () => {
  const m = buildWaAiAutoMemory({
    lastCustomerText: 'trabalhei uns 3 anos lá',
    lastQuestion: 'Pode me dizer quando você saiu, Pedro?',
  });
  assert.equal(m.summary,
    'Resumo automático — o agente não registrou o dele. Última mensagem do cliente: "trabalhei uns 3 anos lá".');
  assert.deepEqual(m.pendingItems, ['responder: "Pode me dizer quando você saiu, Pedro?"']);
  // A pergunta aparece uma vez só: no resumo ela seria a mesma linha da pendência.
  assert.doesNotMatch(m.summary, /quando você saiu/);
});

test('sem cliente e sem pergunta o resumo ainda diz de onde veio', () => {
  const m = buildWaAiAutoMemory({ lastCustomerText: null, lastQuestion: null });
  assert.equal(m.summary, 'Resumo automático — o agente não registrou o dele.');
  assert.deepEqual(m.pendingItems, []);
});

test('a fala longa do cliente é cortada sem partir palavra ao meio', () => {
  const m = buildWaAiAutoMemory({ lastCustomerText: `${'palavra '.repeat(60)}fim`, lastQuestion: null });
  assert.ok(m.summary.length < 320);
  assert.match(m.summary, /…"\.$/);
});

// ── Quem pediu para parar, para ─────────────────────────────────────────────

test('o pedido do cliente para parar vem antes de qualquer política', () => {
  const d = decideAutoFollowup({ ...TURNO_OK, optedOut: true });
  assert.equal(d.schedule, false);
  assert.match(d.schedule === false ? d.reason : '', /não receber mais/i);

  const envio = decideFollowup({
    attempt: 1,
    createdAtIso: '2026-08-12T15:00:00.000Z',
    lastCustomerMessageAtIso: null,
    conversationStatus: 'open',
    aiActive: true,
    assistantActive: true,
    channelAiEnabled: true,
    followupEnabled: true,
    maxAttempts: 8,
    optedOut: true,
  });
  assert.equal(envio.send, false);
  assert.match(envio.send === false ? envio.reason : '', /não receber mais/i);
});

test('pendência que é manual do atendente não vai para o cliente', () => {
  // O `ask` real do roteiro de rescisão indireta em produção: 577 caracteres de
  // instrução ramificada. Ele orienta o modelo, mas não é frase de WhatsApp.
  const manual = 'se possui a prova mais adequada ao que relatou. Se for FGTS, pergunte de modo '
    + 'natural se consultou o extrato do FGTS e quais meses aparecem sem depósito. Se for salário, '
    + 'pergunte por holerite, extrato bancário ou mensagens.';
  const texto = buildWaAiFollowupMessage({
    firstName: 'Rita', lastQuestion: 'Você tem alguma coisa que ajude a mostrar isso?',
    pendingItems: [manual], attempt: 1,
  });
  assert.doesNotMatch(texto, /Se for FGTS/);
  // Sem pendência legível, a retomada repete a pergunta — nunca fica genérica.
  assert.match(texto, /Você tem alguma coisa que ajude a mostrar isso\?/);
});

test('pendência curta continua sendo nomeada', () => {
  const texto = buildWaAiFollowupMessage({
    firstName: 'Rita', lastQuestion: 'Qual é o seu nome?',
    pendingItems: ['o seu nome', 'para quem você trabalhou (empresa ou pessoa)'], attempt: 1,
  });
  assert.match(texto, /Ficou faltando o seu nome e para quem você trabalhou/);
});
