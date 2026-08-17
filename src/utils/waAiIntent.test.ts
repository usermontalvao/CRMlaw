import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  classifyWaAiObjection,
  classifyWaAiInterest,
  describeWaAiRequestedTime,
  parseWaAiRequestedTime,
} from './waAiIntent.ts';
import {
  WA_AI_FOLLOWUP_DEFAULTS,
  requestedSlotToUtc,
  type WaAiFollowupPolicy,
} from './waAiFollowupPolicy.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiIntent.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-intent.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-intent.ts divergiu de waAiIntent.ts — copie o arquivo inteiro');
});

// ── Desinteresse ────────────────────────────────────────────────────────────

const nivel = (text: string, lastQuestion?: string) =>
  classifyWaAiInterest({ text, lastQuestion }).level;

test('a recusa explícita é reconhecida sem depender da palavra "não"', () => {
  assert.equal(nivel('não tenho interesse'), 'sem_interesse');
  assert.equal(nivel('Para de mandar mensagem por favor'), 'sem_interesse');
  assert.equal(nivel('me tira da lista'), 'sem_interesse');
  assert.equal(nivel('já contratei outro advogado, obrigado'), 'sem_interesse');
  assert.equal(nivel('desisti'), 'sem_interesse');
  assert.equal(nivel('número errado'), 'sem_interesse');
  assert.equal(nivel('ME DEIXA EM PAZ'), 'sem_interesse');
});

test('"não" curto é recusa — mas é RESPOSTA quando a pergunta era fechada', () => {
  assert.equal(nivel('não'), 'sem_interesse');
  // O caso que não pode quebrar a triagem: a IA perguntou algo de sim/não.
  assert.equal(nivel('não', 'Você ainda trabalha nessa empresa?'), 'engajado');
  assert.equal(nivel('não', 'Já teve carteira assinada alguma vez?'), 'engajado');
  // Pergunta aberta: "não" ali é recusa mesmo.
  assert.equal(nivel('não', 'Em que mês e ano você saiu?'), 'sem_interesse');
});

test('"não sei" e companhia são RESPOSTA, nunca recusa', () => {
  // O erro mais caro possível: desligar o atendimento de quem está
  // respondendo. "não" só é recusa quando vem sozinho.
  assert.equal(nivel('não sei', 'Em que mês e ano você saiu?'), 'engajado');
  assert.equal(nivel('não lembro'), 'engajado');
  assert.equal(nivel('não tenho'), 'engajado');
  assert.equal(nivel('não recebi'), 'engajado');
});

// ── A regressão de 14/08/2026 ───────────────────────────────────────────────
//
// Duas vezes na mesma triagem de conta bloqueada um "Não" respondendo à
// pergunta do roteiro foi lido como recusa: o backend gravou `followup_opt_out`,
// cancelou as retomadas e anotou na conversa que o cliente tinha desistido — 
// enquanto ele seguia respondendo tudo até o fim. `perguntaFechada` só
// reconhecia "Você...", "Já...", e esta campanha pergunta "O banco...",
// "Ficou...", "A conta...". A correção não é ampliar a lista de prefixos: é o
// backend dizer que havia pergunta pendente.

const respondendo = (text: string, lastQuestion?: string) =>
  classifyWaAiInterest({ text, lastQuestion, pendingQuestion: true }).level;

test('"não" respondendo pergunta pendente do roteiro é RESPOSTA, não recusa', () => {
  assert.equal(
    respondendo('Não', 'O banco enviou algum e-mail, SMS, notificação ou outra mensagem sobre o bloqueio ou encerramento?'),
    'engajado');
  assert.equal(respondendo('Não', 'Ficou algum dinheiro ou saldo preso nessa conta?'), 'engajado');
  // Sem o sinal do backend, é exatamente o caso que quebrou em produção.
  assert.equal(nivel('Não', 'O banco enviou algum e-mail, SMS ou notificação?'), 'sem_interesse');
});

test('responder uma pergunta não protege quem recusa de verdade', () => {
  assert.equal(respondendo('para de mandar mensagem'), 'sem_interesse');
  assert.equal(respondendo('não tenho interesse'), 'sem_interesse');
  assert.equal(respondendo('já contratei outro advogado'), 'sem_interesse');
  assert.equal(respondendo('me deixa em paz'), 'sem_interesse');
});

test('a frase ambígua é motivo enquanto o roteiro espera, e recusa quando chega solta', () => {
  // "O banco informou algum motivo?" → "foi um engano deles" é o MOTIVO.
  assert.equal(respondendo('disseram que foi um engano'), 'engajado');
  // "A conta continua bloqueada?" → "já resolvi" é a SITUAÇÃO ATUAL.
  assert.equal(respondendo('já resolvi com eles'), 'engajado');
  assert.equal(respondendo('não preciso mais desse dinheiro'), 'engajado');
  // Fora de pergunta, as mesmas frases continuam encerrando a conversa.
  assert.equal(nivel('foi engano'), 'sem_interesse');
  assert.equal(nivel('já resolvi'), 'sem_interesse');
  assert.equal(nivel('não precisa mais'), 'sem_interesse');
});

test('"não" no meio de uma explicação não é recusa', () => {
  assert.equal(nivel('não sei o mês exato, foi por volta de janeiro'), 'engajado');
  assert.equal(nivel('trabalhei lá mas não tinha carteira assinada'), 'engajado');
});

test('a evasiva cai na faixa do meio, para o sistema perguntar em vez de adivinhar', () => {
  assert.equal(nivel('depois eu vejo'), 'duvida');
  assert.equal(nivel('agora não posso, estou trabalhando'), 'duvida');
  assert.equal(nivel('vou pensar e te falo'), 'duvida');
  assert.equal(nivel('mais tarde'), 'duvida');
  assert.equal(nivel('deixa pra lá'), 'duvida');
});

test('a recusa explícita ganha da evasiva quando as duas aparecem', () => {
  const r = classifyWaAiInterest({ text: 'vou pensar mas não tenho interesse' });
  assert.equal(r.level, 'sem_interesse');
  assert.equal(r.matched, 'nao tenho interesse');
});

test('conversa normal continua engajada', () => {
  assert.equal(nivel('Todinho'), 'engajado');
  assert.equal(nivel('Janeiro de 2025'), 'engajado');
  assert.equal(nivel('sim, saí em março'), 'engajado');
  assert.equal(nivel(''), 'engajado');
});

test('objeções são classificadas sem virar desinteresse', () => {
  assert.equal(classifyWaAiObjection('40% é muito alto')?.kind, 'honorarios');
  assert.equal(classifyWaAiObjection('como eu sei que isso não é golpe?')?.kind, 'confianca_privacidade');
  assert.equal(classifyWaAiObjection('tenho medo de mandar meus documentos')?.kind, 'envio_documentos');
  assert.equal(classifyWaAiObjection('vocês garantem que eu vou ganhar?')?.kind, 'prazo_resultado');
  assert.equal(classifyWaAiObjection('quanto tempo isso demora?')?.kind, 'prazo_resultado');
  assert.equal(nivel('40% é muito alto'), 'engajado');
  assert.equal(nivel('tenho medo de mandar meus documentos'), 'engajado');
});

test('resposta comum da triagem não é confundida com objeção', () => {
  assert.equal(classifyWaAiObjection('não tenho o número da conta'), null);
  assert.equal(classifyWaAiObjection('tenho o print do aplicativo'), null);
  assert.equal(classifyWaAiObjection('o banco encerrou em julho'), null);
});

// ── Hora marcada ────────────────────────────────────────────────────────────

const CUIABA: WaAiFollowupPolicy = { ...WA_AI_FOLLOWUP_DEFAULTS, enabled: true };
/** Quarta-feira, 11:29 em Cuiabá. */
const AGORA = '2026-08-12T15:29:00.000Z';

test('a hora pedida pelo cliente é reconhecida em várias formas', () => {
  assert.deepEqual(parseWaAiRequestedTime('me chama às 14h'), {
    hour: 14, minute: 0, dayOffset: 0, weekday: null, matched: 'as 14h',
  });
  assert.equal(parseWaAiRequestedTime('pode ser 14:30')?.hour, 14);
  assert.equal(parseWaAiRequestedTime('pode ser 14:30')?.minute, 30);
  assert.equal(parseWaAiRequestedTime('me chama depois das 15 horas')?.hour, 15);
  assert.equal(parseWaAiRequestedTime('me liga as 2 da tarde')?.hour, 14);
  assert.equal(parseWaAiRequestedTime('me chama amanhã de manhã')?.dayOffset, 1);
  assert.equal(parseWaAiRequestedTime('me chama amanhã de manhã')?.hour, 9);
  assert.equal(parseWaAiRequestedTime('me liga segunda às 10')?.weekday, 1);
});

test('número que não é hora não vira compromisso', () => {
  assert.equal(parseWaAiRequestedTime('trabalhei 3 anos lá'), null);
  assert.equal(parseWaAiRequestedTime('saí em 2019'), null);
  assert.equal(parseWaAiRequestedTime('Janeiro de 2025'), null);
  assert.equal(parseWaAiRequestedTime('Todinho'), null);
});

test('HORÁRIO SEM PEDIDO não vira compromisso — o caso que encerrou uma triagem', () => {
  // 12/08/2026: a IA leu a jornada de trabalho do cliente como um pedido de
  // agendamento, marcou segunda-feira e se despediu no meio da triagem.
  assert.equal(parseWaAiRequestedTime('geralmente eu trabalhava de segunda a sexta, os horários eram das oito às dezoito'), null);
  assert.equal(parseWaAiRequestedTime('das 8 às 18'), null);
  assert.equal(parseWaAiRequestedTime('de segunda a sexta'), null);
  assert.equal(parseWaAiRequestedTime('eu entrava as 7h e saia as 17h'), null);
  assert.equal(parseWaAiRequestedTime('recebia 2 mil por mês, às vezes às 5h da tarde'), null);
});

test('descrever a rotina vence o pedido quando as duas coisas aparecem', () => {
  // "pode ser" está lá, mas a frase é resposta de triagem, não compromisso.
  assert.equal(parseWaAiRequestedTime('pode ser que eu trabalhava das 8h às 18h'), null);
});

test('a hora pedida vira instante no fuso do canal', () => {
  const req = parseWaAiRequestedTime('me chama às 14h')!;
  // 14:00 em Cuiabá = 18:00Z, ainda hoje.
  assert.equal(requestedSlotToUtc(req, AGORA, CUIABA)?.toISOString(), '2026-08-12T18:00:00.000Z');
});

test('hora que já passou hoje é a de amanhã', () => {
  const req = parseWaAiRequestedTime('me chama às 9h')!;
  // São 11:29; 09:00 de hoje já foi. Quinta, 09:00 em Cuiabá = 13:00Z.
  assert.equal(requestedSlotToUtc(req, AGORA, CUIABA)?.toISOString(), '2026-08-13T13:00:00.000Z');
});

test('hora fora do expediente é empurrada para a abertura seguinte', () => {
  const req = parseWaAiRequestedTime('me chama às 22h')!;
  // 22:00 não existe na janela 08:00–18:00: cai na quinta, 08:00 (12:00Z).
  assert.equal(requestedSlotToUtc(req, AGORA, CUIABA)?.toISOString(), '2026-08-13T12:00:00.000Z');
});

test('o fim de semana pedido espera a segunda-feira útil', () => {
  const req = parseWaAiRequestedTime('me chama sábado às 10h')!;
  // Sábado não está nos dias do canal: vai para segunda, 08:00 (12:00Z).
  assert.equal(requestedSlotToUtc(req, AGORA, CUIABA)?.toISOString(), '2026-08-17T12:00:00.000Z');
});

test('"amanhã" sem hora usa a abertura do expediente', () => {
  const req = parseWaAiRequestedTime('me chama amanhã')!;
  assert.equal(req.hour, -1);
  assert.equal(requestedSlotToUtc(req, AGORA, CUIABA)?.toISOString(), '2026-08-13T12:00:00.000Z');
});

test('a confirmação repete para o cliente o que foi entendido', () => {
  assert.equal(describeWaAiRequestedTime(parseWaAiRequestedTime('me chama às 14h')!), 'hoje às 14:00');
  assert.equal(describeWaAiRequestedTime(parseWaAiRequestedTime('me chama amanhã às 9h')!), 'amanhã às 09:00');
  assert.equal(describeWaAiRequestedTime(parseWaAiRequestedTime('me liga segunda às 10h')!), 'segunda às 10:00');
});
