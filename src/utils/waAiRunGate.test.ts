import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_KNOWN_FACTS_MAX_KEYS,
  WA_AI_PENDING_ITEMS_MAX,
  WA_AI_SUMMARY_MAX_CHARS,
  buildWaAiPromptMessages,
  decideWaAiRun,
  mergeWaAiMemory,
  normalizeWaAiMemory,
  renderWaAiMemoryForPrompt,
  waAiCurrentBundle,
  waAiUnreadBundle,
  waAiUnreadTurn,
  waAiCustomerSaidSomething,
  waAiEmptyMessageMarker,
  waAiFollowupIdempotencyKey,
  waAiIdempotencyKey,
  type WaAiHistoryMessage,
  type WaAiRunGateState,
} from './waAiRunGate.ts';

const CONV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MSG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const BASE: WaAiRunGateState = {
  triggerMessageId: MSG,
  latestInboundMessageId: MSG,
  lastProcessedMessageId: null,
  conversationStatus: 'open',
  conversationBlocked: false,
  aiActive: true,
  channelAiEnabled: true,
  assistantActive: true,
  assignedUserId: null,
  awaitingAccept: false,
  lockedUntilIso: null,
  nowIso: '2026-08-12T15:00:00Z',
};

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiRunGate.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-gate.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-gate.ts divergiu de waAiRunGate.ts — copie o arquivo inteiro');
});

// ── Idempotência ────────────────────────────────────────────────────────────

test('a mesma mensagem gera sempre a mesma chave', () => {
  assert.equal(waAiIdempotencyKey(CONV, MSG), waAiIdempotencyKey(CONV, MSG));
});

test('mensagens diferentes geram chaves diferentes', () => {
  assert.notEqual(waAiIdempotencyKey(CONV, MSG), waAiIdempotencyKey(CONV, 'outra'));
});

test('follow-up e mensagem não colidem no mesmo espaço de chaves', () => {
  assert.notEqual(waAiFollowupIdempotencyKey(MSG), waAiIdempotencyKey(CONV, MSG));
});

// ── Portaria ────────────────────────────────────────────────────────────────

test('estado normal aciona a IA', () => {
  assert.deepEqual(decideWaAiRun(BASE), { run: true });
});

test('reentrega do webhook não gera segunda resposta', () => {
  const d = decideWaAiRun({ ...BASE, lastProcessedMessageId: MSG });
  assert.equal(d.run, false);
  assert.match((d as { reason: string }).reason, /já processada/);
});

test('mensagem mais nova cancela a execução da anterior (debounce)', () => {
  const d = decideWaAiRun({ ...BASE, latestInboundMessageId: 'mais-nova' });
  assert.equal(d.run, false);
  assert.match((d as { reason: string }).reason, /debounce/);
});

test('a execução da mensagem mais nova é a que segue', () => {
  assert.deepEqual(
    decideWaAiRun({ ...BASE, triggerMessageId: 'mais-nova', latestInboundMessageId: 'mais-nova' }),
    { run: true },
  );
});

test('handoff humano interrompe a IA', () => {
  const d = decideWaAiRun({ ...BASE, aiActive: false });
  assert.equal(d.run, false);
  assert.match((d as { reason: string }).reason, /atendimento humano/);
});

test('atendente que assume a conversa interrompe a IA', () => {
  const d = decideWaAiRun({ ...BASE, assignedUserId: 'uuid-do-atendente' });
  assert.equal(d.run, false);
  assert.match((d as { reason: string }).reason, /assumida/);
});

test('transferência aguardando aceite interrompe a IA', () => {
  assert.equal(decideWaAiRun({ ...BASE, awaitingAccept: true }).run, false);
});

test('IA desativada no canal não roda', () => {
  assert.equal(decideWaAiRun({ ...BASE, channelAiEnabled: false }).run, false);
});

test('agente inativo não roda', () => {
  assert.equal(decideWaAiRun({ ...BASE, assistantActive: false }).run, false);
});

test('conversa encerrada ou contato bloqueado não roda', () => {
  assert.equal(decideWaAiRun({ ...BASE, conversationStatus: 'closed' }).run, false);
  assert.equal(decideWaAiRun({ ...BASE, conversationBlocked: true }).run, false);
});

test('trava em vigor impede execução simultânea', () => {
  const d = decideWaAiRun({ ...BASE, lockedUntilIso: '2026-08-12T15:00:30Z' });
  assert.equal(d.run, false);
  assert.match((d as { reason: string }).reason, /em andamento/);
});

test('trava vencida não impede', () => {
  assert.deepEqual(decideWaAiRun({ ...BASE, lockedUntilIso: '2026-08-12T14:59:00Z' }), { run: true });
});

test('o desligamento do operador aparece antes da idempotência no motivo', () => {
  const d = decideWaAiRun({ ...BASE, aiActive: false, lastProcessedMessageId: MSG });
  assert.match((d as { reason: string }).reason, /atendimento humano/);
});

// ── Memória ─────────────────────────────────────────────────────────────────

test('memória vazia não quebra', () => {
  const m = normalizeWaAiMemory(null);
  assert.deepEqual(m, { summary: '', knownFacts: {}, pendingItems: [], lastAction: null });
});

test('aceita as duas grafias das chaves (camelCase e snake_case do banco)', () => {
  const m = normalizeWaAiMemory({ known_facts: { nome: 'Ana' }, pending_items: ['RG'], last_action: 'x' });
  assert.deepEqual(m.knownFacts, { nome: 'Ana' });
  assert.deepEqual(m.pendingItems, ['RG']);
  assert.equal(m.lastAction, 'x');
});

test('resumo gigante é cortado', () => {
  const m = normalizeWaAiMemory({ summary: 'a'.repeat(5000) });
  assert.equal(m.summary.length, WA_AI_SUMMARY_MAX_CHARS);
});

test('o número de fatos tem teto', () => {
  const facts: Record<string, string> = {};
  for (let i = 0; i < 100; i++) facts[`k${i}`] = 'v';
  assert.equal(Object.keys(normalizeWaAiMemory({ knownFacts: facts }).knownFacts).length, WA_AI_KNOWN_FACTS_MAX_KEYS);
});

test('fato com valor não escalar é descartado', () => {
  const m = normalizeWaAiMemory({ knownFacts: { ok: 'sim', ruim: { a: 1 }, vazio: '' } });
  assert.deepEqual(m.knownFacts, { ok: 'sim' });
});

test('false e zero são fatos, não ausência', () => {
  const m = normalizeWaAiMemory({ knownFacts: { tem_testemunha: false, dias_por_semana: 0 } });
  assert.deepEqual(m.knownFacts, { tem_testemunha: false, dias_por_semana: 0 });
});

test('pendências deduplicam e têm teto', () => {
  const items = ['RG', 'RG', ...Array.from({ length: 40 }, (_, i) => `item ${i}`)];
  const m = normalizeWaAiMemory({ pendingItems: items });
  assert.equal(m.pendingItems.length, WA_AI_PENDING_ITEMS_MAX);
  assert.equal(m.pendingItems[0], 'RG');
});

test('mesclar preserva o que o turno atual não mencionou', () => {
  const antes = normalizeWaAiMemory({ summary: 'Caso trabalhista.', knownFacts: { nome: 'Ana' } });
  const depois = mergeWaAiMemory(antes, { knownFacts: { cpf: '000' } });
  assert.deepEqual(depois.knownFacts, { nome: 'Ana', cpf: '000' });
  assert.equal(depois.summary, 'Caso trabalhista.');
});

test('mesclar sobrescreve o fato que mudou', () => {
  const antes = normalizeWaAiMemory({ knownFacts: { telefone: '111' } });
  assert.equal(mergeWaAiMemory(antes, { knownFacts: { telefone: '222' } }).knownFacts.telefone, '222');
});

test('pendências são substituídas quando o turno as informa', () => {
  const antes = normalizeWaAiMemory({ pendingItems: ['RG', 'CPF'] });
  assert.deepEqual(mergeWaAiMemory(antes, { pendingItems: ['CPF'] }).pendingItems, ['CPF']);
});

test('pendências são mantidas quando o turno não as menciona', () => {
  const antes = normalizeWaAiMemory({ pendingItems: ['RG'] });
  assert.deepEqual(mergeWaAiMemory(antes, { summary: 'novo resumo' }).pendingItems, ['RG']);
});

test('turno que zera as pendências limpa a lista', () => {
  const antes = normalizeWaAiMemory({ pendingItems: ['RG'] });
  assert.deepEqual(mergeWaAiMemory(antes, { pendingItems: [] }).pendingItems, []);
});

test('a memória renderizada é legível e cobre as quatro partes', () => {
  const texto = renderWaAiMemoryForPrompt(normalizeWaAiMemory({
    summary: 'Rescisão sem justa causa.',
    knownFacts: { nome: 'Ana' },
    pendingItems: ['Carteira de trabalho'],
    lastAction: 'solicitar_documentos',
  }));
  assert.match(texto, /Rescisão sem justa causa/);
  assert.match(texto, /"nome": "Ana"/);
  assert.match(texto, /- Carteira de trabalho/);
  assert.match(texto, /solicitar_documentos/);
});

test('memória vazia não vira bloco de texto no prompt', () => {
  assert.equal(renderWaAiMemoryForPrompt(normalizeWaAiMemory({})), '');
});

// ── Janela de histórico ─────────────────────────────────────────────────────

function msg(id: string, direction: 'in' | 'out', content: string | null, minute: number, type = 'text'): WaAiHistoryMessage {
  return { id, direction, type, content, waTimestamp: `2026-08-12T15:${String(minute).padStart(2, '0')}:00Z` };
}

test('o histórico sai em ordem cronológica e no papel certo', () => {
  const out = buildWaAiPromptMessages([
    msg('2', 'out', 'Olá, como posso ajudar?', 2),
    msg('1', 'in', 'Bom dia', 1),
  ], 10);
  assert.deepEqual(out, [
    { role: 'user', content: 'Bom dia' },
    { role: 'assistant', content: 'Olá, como posso ajudar?' },
  ]);
});

test('só as últimas mensagens entram na janela', () => {
  const todas = Array.from({ length: 30 }, (_, i) => msg(String(i), 'in', `m${i}`, i));
  const out = buildWaAiPromptMessages(todas, 5);
  assert.equal(out.length, 5);
  assert.equal(out[0].content, 'm25');
  assert.equal(out[4].content, 'm29');
});

test('mídia sem texto vira marcador em vez de sumir', () => {
  const out = buildWaAiPromptMessages([msg('1', 'in', null, 1, 'audio')], 10);
  assert.equal(out[0].content, '[áudio]');
});

test('transcrição pronta do áudio entra no prompt como fala do cliente', () => {
  const audio = {
    ...msg('1', 'in', null, 1, 'audio'),
    transcriptionText: 'Eu trabalhei na empresa Todimo.',
  };
  const out = buildWaAiPromptMessages([audio], 10);
  assert.deepEqual(out, [{ role: 'user', content: 'Eu trabalhei na empresa Todimo.' }]);
});

test('legenda escrita tem prioridade sobre a transcrição', () => {
  const audio = {
    ...msg('1', 'in', 'Veja este complemento', 1, 'audio'),
    transcriptionText: 'Texto transcrito',
  };
  const out = buildWaAiPromptMessages([audio], 10);
  assert.equal(out[0].content, 'Veja este complemento');
});

test('mensagem gigante é cortada', () => {
  const out = buildWaAiPromptMessages([msg('1', 'in', 'x'.repeat(5000), 1)], 10);
  assert.equal(out[0].content.length, 1200);
});

test('limite inválido cai no padrão em vez de esvaziar o histórico', () => {
  const todas = Array.from({ length: 20 }, (_, i) => msg(String(i), 'in', `m${i}`, i));
  assert.equal(buildWaAiPromptMessages(todas, 0).length, 12);
  assert.equal(buildWaAiPromptMessages(todas, 999).length, 20);
});

// ── Mídia não é fala ────────────────────────────────────────────────────────

test('marcador cobre cada tipo sem texto, e o desconhecido tem o seu', () => {
  assert.equal(waAiEmptyMessageMarker('image'), '[imagem]');
  assert.equal(waAiEmptyMessageMarker('audio'), '[áudio]');
  assert.equal(waAiEmptyMessageMarker('video'), '[vídeo]');
  assert.equal(waAiEmptyMessageMarker('document'), '[documento]');
  assert.equal(waAiEmptyMessageMarker('sticker'), '[figurinha]');
  assert.equal(waAiEmptyMessageMarker('location'), '[mensagem sem texto]');
});

test('só a foto: o cliente não disse nada — é o caso que inventou a triagem', () => {
  const out = buildWaAiPromptMessages([msg('1', 'in', null, 1, 'image')], 10);
  assert.equal(out[0].content, '[imagem]');
  assert.equal(waAiCustomerSaidSomething(out), false);
});

test('legenda na foto é fala', () => {
  const out = buildWaAiPromptMessages([msg('1', 'in', 'Trabalhei 3 anos sem registro', 1, 'image')], 10);
  assert.equal(waAiCustomerSaidSomething(out), true);
});

test('áudio transcrito é fala', () => {
  const audio = { ...msg('1', 'in', null, 1, 'audio'), transcriptionText: 'Comecei em 2020' };
  assert.equal(waAiCustomerSaidSomething(buildWaAiPromptMessages([audio], 10)), true);
});

test('o que o AGENTE escreveu não conta como fala do cliente', () => {
  assert.equal(waAiCustomerSaidSomething([{ role: 'assistant', content: 'Qual é o seu nome?' }]), false);
});

test('a rodada atual é o que veio depois da última fala do agente', () => {
  const bundle = waAiCurrentBundle([
    { role: 'user', content: 'Olá' },
    { role: 'assistant', content: 'Para começar, qual é o seu nome?' },
    { role: 'user', content: '[imagem]' },
    { role: 'user', content: '[imagem]' },
  ]);
  assert.equal(bundle.length, 2);
  assert.equal(waAiCustomerSaidSomething(bundle), false);
});

test('fala antiga não faz a rodada de agora virar fala', () => {
  const historico = [
    { role: 'user' as const, content: 'Edvania' },
    { role: 'assistant' as const, content: 'Para qual empresa você trabalhou?' },
    { role: 'user' as const, content: '[figurinha]' },
  ];
  assert.equal(waAiCustomerSaidSomething(historico), true);
  assert.equal(waAiCustomerSaidSomething(waAiCurrentBundle(historico)), false);
});

// ── A fronteira da rodada é o que já foi LIDO ───────────────────────────────

/** A corrida real de 26/08/2026, na ordem exata em que as mensagens gravaram. */
const CORRIDA = [
  { id: 'm1', direction: 'in' as const, type: 'text', content: 'Todos os dias',
    waTimestamp: '2026-08-26T17:07:23.000Z' },
  { id: 'm2', direction: 'in' as const, type: 'text', content: 'Segunda a sexta-feira',
    waTimestamp: '2026-08-26T17:07:36.000Z' },
  { id: 'm3', direction: 'out' as const, type: 'text',
    content: 'Tinha alguém que passava o que você precisava fazer ou cobrava o serviço?',
    waTimestamp: '2026-08-26T17:07:38.000Z' },
];

test('mensagem que chegou enquanto o agente pensava continua sendo rodada', () => {
  // A fronteira antiga — a última fala do agente — deixa "Segunda a sexta-feira"
  // do lado de fora, e o turno reenvia a mesma pergunta sem nunca ler a
  // resposta. Foi assim que a Marcia recebeu a pergunta duas vezes.
  assert.equal(waAiCurrentBundle(buildWaAiPromptMessages(CORRIDA, 12)).length, 0);
  // A fronteira certa é a última mensagem PROCESSADA: 'm1' já foi lida no turno
  // anterior, 'm2' não.
  const rodada = waAiUnreadBundle(CORRIDA, 12, 'm1');
  assert.deepEqual(rodada.map(m => m.content), ['Segunda a sexta-feira']);
  assert.equal(waAiCustomerSaidSomething(rodada), true);
});

test('a rodada guarda o id da última entrada que realmente consumiu', () => {
  const rodada = waAiUnreadTurn(CORRIDA, 12, 'm1');
  assert.equal(rodada.lastInboundMessageId, 'm2');
});

test('a extração recebe a pergunta anterior à primeira entrada não lida', () => {
  const historico = [
    { id: 'q1', direction: 'out' as const, type: 'text', content: 'Você ia quais dias?',
      waTimestamp: '2026-08-26T17:07:10.000Z' },
    ...CORRIDA,
  ];
  const rodada = waAiUnreadTurn(historico, 12, 'm1');
  assert.equal(rodada.precedingAssistantMessage?.content, 'Você ia quais dias?');
  assert.deepEqual(rodada.messages.map(m => m.content), ['Segunda a sexta-feira']);
});

test('sem nada de novo depois do que já foi lido, a rodada fica vazia', () => {
  assert.equal(waAiUnreadBundle(CORRIDA, 12, 'm2').length, 0);
});

test('sem mensagem processada, ou com uma fora da janela, vale a fronteira antiga', () => {
  assert.equal(waAiUnreadBundle(CORRIDA, 12, null).length, 0);
  assert.equal(waAiUnreadBundle(CORRIDA, 12, 'apagada-ha-meses').length, 0);
  // E no primeiro turno, quando o agente ainda não falou, a rodada é a abertura.
  const abertura = [CORRIDA[0]];
  assert.deepEqual(waAiUnreadBundle(abertura, 12, null).map(m => m.content), ['Todos os dias']);
});
