import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_MAX_REPLY_PARTS,
  WA_AI_PART_PAUSE_MAX_MS,
  WA_AI_PART_PAUSE_MIN_MS,
  splitWaAiReply,
  waAiContextualizeRepeatedQuestion,
  waAiKeepOneQuestion,
  waAiPartPauseMs,
} from './waAiReplyParts.ts';

// ── O ritmo ─────────────────────────────────────────────────────────────────

test('a duração é o tempo de digitar o bloco, e nunca sai da faixa', () => {
  // O balão de "digitando..." fica de pé exatamente por este tempo, então um
  // valor fora da faixa vira ou atropelo, ou espera constrangedora.
  assert.equal(waAiPartPauseMs(''), WA_AI_PART_PAUSE_MIN_MS);
  assert.ok(waAiPartPauseMs('oi') >= WA_AI_PART_PAUSE_MIN_MS);
  assert.equal(waAiPartPauseMs('x'.repeat(500)), WA_AI_PART_PAUSE_MAX_MS);

  const curto = waAiPartPauseMs('Qual é o seu nome?');
  const longo = waAiPartPauseMs('Qual é o seu nome? E de qual empresa estamos falando aqui?');
  assert.ok(longo > curto, 'bloco maior tem de levar mais tempo para ser digitado');
  assert.ok(curto >= WA_AI_PART_PAUSE_MIN_MS && longo <= WA_AI_PART_PAUSE_MAX_MS);
});

// ── O espelho ───────────────────────────────────────────────────────────────

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiReplyParts.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-reply-parts.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src,
    'wa-ai-reply-parts.ts divergiu de waAiReplyParts.ts — copie o arquivo inteiro');
});

// ── A quebra ────────────────────────────────────────────────────────────────

test('saudação e pergunta viram duas mensagens, com ou sem linha em branco', () => {
  const comBranco = splitWaAiReply(
    'Olá! Tudo bem? Vou fazer algumas perguntas rápidas para entender melhor o seu caso.\n\n'
    + 'Para começar, qual é o seu nome?');
  assert.deepEqual(comBranco, [
    'Olá! Tudo bem? Vou fazer algumas perguntas rápidas para entender melhor o seu caso.',
    'Para começar, qual é o seu nome?',
  ]);

  const semBranco = splitWaAiReply(
    'Olá! Tudo bem? Vou fazer algumas perguntas rápidas para entender melhor o seu caso.  \n'
    + 'Para começar, qual é o seu nome?');
  assert.deepEqual(semBranco, comBranco);
});

test('parágrafo de uma frase só continua sendo uma mensagem', () => {
  assert.deepEqual(splitWaAiReply('Qual é o seu nome?'), ['Qual é o seu nome?']);
  assert.deepEqual(splitWaAiReply('  '), []);
  assert.deepEqual(splitWaAiReply(''), []);
});

test('a frase quebrada no meio não vira duas mensagens', () => {
  assert.deepEqual(
    splitWaAiReply('Preciso confirmar o período do contrato,\nde início e de fim.'),
    ['Preciso confirmar o período do contrato,\nde início e de fim.']);
});

test('a lista fica grudada na frase que a introduz', () => {
  const partes = splitWaAiReply(
    'Perfeito, obrigado!\n\nPara seguir, me envie estes documentos:\n- RG\n- CPF\n- Carteira de trabalho');
  assert.deepEqual(partes, [
    'Perfeito, obrigado!',
    'Para seguir, me envie estes documentos:\n- RG\n- CPF\n- Carteira de trabalho',
  ]);
});

test('lista numerada de frases fechadas também não se desmancha', () => {
  const partes = splitWaAiReply('Anote os passos:\n1. Tire a foto do RG.\n2. Me envie por aqui.');
  assert.deepEqual(partes, ['Anote os passos:\n1. Tire a foto do RG.\n2. Me envie por aqui.']);
});

test('nunca passa do teto de mensagens — o excedente volta para a última', () => {
  const partes = splitWaAiReply('Uma.\n\nDuas.\n\nTrês.\n\nQuatro.\n\nCinco.');
  assert.equal(partes.length, WA_AI_MAX_REPLY_PARTS);
  assert.deepEqual(partes, ['Uma.', 'Duas.', 'Três.\n\nQuatro.\n\nCinco.']);
});

test('bloco sem palavra nenhuma volta a colar no anterior', () => {
  assert.deepEqual(splitWaAiReply('Recebido, obrigado!\n\n👍'), ['Recebido, obrigado!\n👍']);
});

test('nenhuma parte sai vazia ou com sobra de espaço', () => {
  const partes = splitWaAiReply('  Olá!  \n\n\n   Qual é o seu nome?   \n\n  ');
  assert.deepEqual(partes, ['Olá!', 'Qual é o seu nome?']);
  for (const parte of partes) assert.equal(parte, parte.trim());
});

// ── A pausa ─────────────────────────────────────────────────────────────────

test('a pausa cresce com o tamanho da mensagem, dentro dos limites', () => {
  assert.equal(waAiPartPauseMs(''), WA_AI_PART_PAUSE_MIN_MS);
  assert.equal(waAiPartPauseMs('x'.repeat(5000)), WA_AI_PART_PAUSE_MAX_MS);
  const curta = waAiPartPauseMs('Qual é o seu nome?');
  const longa = waAiPartPauseMs('Qual é o seu nome completo e a data de nascimento, por favor?');
  assert.ok(curta > WA_AI_PART_PAUSE_MIN_MS && longa > curta,
    `esperava pausa crescente, veio ${curta} e ${longa}`);
  assert.ok(longa <= WA_AI_PART_PAUSE_MAX_MS);
});

// ── A pergunta final é sempre uma mensagem própria ──────────────────────────

test('confirmação e pergunta viram duas mensagens', () => {
  // O caso real da triagem: numa bolha só, o cliente lê o "obrigado" e responde
  // aquilo — a pergunta fica sem resposta e a conversa trava.
  assert.deepEqual(
    splitWaAiReply('Obrigado, Pedro. Você teve algum outro trabalho sem carteira além desse na Todinho?'),
    ['Obrigado, Pedro.', 'Você teve algum outro trabalho sem carteira além desse na Todinho?'],
  );
});

test('frase única continua sendo uma mensagem só', () => {
  assert.deepEqual(splitWaAiReply('Qual é o seu nome?'), ['Qual é o seu nome?']);
  assert.deepEqual(splitWaAiReply('Obrigado, Pedro.'), ['Obrigado, Pedro.']);
});

test('só a ÚLTIMA frase sai; o resto do contexto fica junto', () => {
  assert.deepEqual(
    splitWaAiReply('Entendi. Isso conta como vínculo. Em que mês você saiu?'),
    ['Entendi. Isso conta como vínculo.', 'Em que mês você saiu?'],
  );
});

test('texto que não termina em pergunta não é dividido', () => {
  const t = 'Obrigado, Pedro. Vou encaminhar para um advogado analisar.';
  assert.deepEqual(splitWaAiReply(t), [t]);
});

test('número com ponto e abreviação não fingem fim de frase', () => {
  assert.deepEqual(
    splitWaAiReply('Você recebia R$ 1.800 por mês. Isso está certo?'),
    ['Você recebia R$ 1.800 por mês.', 'Isso está certo?'],
  );
  assert.deepEqual(
    splitWaAiReply('Falei com o Dr. Pedro sobre o caso. Podemos seguir?'),
    ['Falei com o Dr. Pedro sobre o caso.', 'Podemos seguir?'],
  );
});

test('lista continua grudada na frase que a introduz', () => {
  const t = 'Preciso destes documentos:\n- RG\n- CPF';
  assert.deepEqual(splitWaAiReply(t), [t]);
});

test('a pausa é sentida, mas não faz o cliente esperar', () => {
  // "envia uma, segura, envia a outra" — ritmo de gente digitando, sem que a
  // soma das três partes vire meio minuto de espera.
  const pausa = waAiPartPauseMs('Você teve algum outro trabalho sem carteira além desse na Todinho?');
  assert.ok(pausa >= 1000 && pausa <= WA_AI_PART_PAUSE_MAX_MS, `pausa fora do esperado: ${pausa}`);
  // Mensagem curta chega perto do piso, nunca abaixo dele.
  const curta = waAiPartPauseMs('Oi');
  assert.ok(curta >= WA_AI_PART_PAUSE_MIN_MS && curta < WA_AI_PART_PAUSE_MIN_MS + 200, `piso furado: ${curta}`);

  // O teto do turno inteiro: três blocos longos, o pior caso possível.
  assert.ok(WA_AI_PART_PAUSE_MAX_MS * 3 <= 7000, 'a resposta inteira não pode passar de alguns segundos');
});

// ── Uma pergunta por rodada ─────────────────────────────────────────────────

test('a segunda pergunta da rodada é cortada, mesmo no mesmo parágrafo', () => {
  // Caso real de 12/08/2026: o modelo emendou as duas no mesmo bloco, e o
  // cliente recebeu as duas antes de responder qualquer coisa.
  const bruto = 'Obrigado, Carlos.\n\nPara qual empresa ou pessoa você trabalhou sem registro? '
    + 'Foi uma empresa particular ou um órgão público?';
  const limpo = waAiKeepOneQuestion(bruto);
  assert.match(limpo, /Para qual empresa ou pessoa você trabalhou sem registro\?/);
  assert.doesNotMatch(limpo, /órgão público/);
  assert.match(limpo, /^Obrigado, Carlos\./);
});

test('"Tudo bem?" não gasta a cota da rodada', () => {
  const saudacao = 'Olá! Tudo bem? Vou fazer algumas perguntas rápidas.\n\nPara começar, qual é o seu nome?';
  const limpo = waAiKeepOneQuestion(saudacao);
  assert.match(limpo, /Tudo bem\?/);
  assert.match(limpo, /qual é o seu nome\?/);
});

test('o que vem depois da pergunta sem ser pergunta continua', () => {
  const comExemplos = 'Você tem alguma prova desse trabalho? Pode ser Pix, conversa de WhatsApp ou foto.';
  assert.equal(waAiKeepOneQuestion(comExemplos), comExemplos);
});

test('itens de lista passam inteiros', () => {
  const lista = 'Vou precisar destes documentos:\n- Documento com foto\n- CTPS Digital\n\nPode mandar por aqui?';
  const limpo = waAiKeepOneQuestion(lista);
  assert.match(limpo, /- Documento com foto/);
  assert.match(limpo, /- CTPS Digital/);
  assert.match(limpo, /Pode mandar por aqui\?/);
});

test('resposta sem pergunta nenhuma sai intacta', () => {
  const aviso = 'Certo. Vou passar seu caso para a equipe agora.';
  assert.equal(waAiKeepOneQuestion(aviso), aviso);
});

test('linha que vira vazia não deixa bolha fantasma', () => {
  const bruto = 'Qual é o seu nome?\nVocê trabalhou quanto tempo nessa empresa?';
  const limpo = waAiKeepOneQuestion(bruto);
  assert.equal(limpo, 'Qual é o seu nome?');
  assert.equal(splitWaAiReply(limpo).length, 1);
});

test('pergunta idêntica volta com contexto, não como robô travado', () => {
  const pergunta = 'E quando você saiu de lá? Mês e ano, se lembrar.';
  const resposta = waAiContextualizeRepeatedQuestion(pergunta, pergunta);
  assert.match(resposta, /Não consegui ligar sua resposta/i);
  assert.equal((resposta.match(/\?/g) || []).length, 1);
  assert.equal(splitWaAiReply(resposta).length, 2);
});

test('pergunta nova não recebe justificativa artificial', () => {
  assert.equal(
    waAiContextualizeRepeatedQuestion('Qual era sua função?', 'Quando você começou?'),
    'Qual era sua função?',
  );
});
