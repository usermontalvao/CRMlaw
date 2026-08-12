/**
 * O TURNO INTEIRO, na ordem em que o `executeTurn` o executa.
 *
 * Os testes vizinhos cobrem cada peça sozinha. Este cobre a costura, que é onde
 * o defeito de 12/08/2026 morava: nenhuma função estava errada — o dado é que
 * nunca chegava de uma para a outra. A ordem verificada aqui é exatamente a da
 * Edge Function:
 *
 *   resposta do modelo → leitura (`parseWaAiTriageReply`)
 *   → atualizações por cima da memória, normalizadas pelo tipo do campo
 *   → rede de baixo (`reconcileWaAiTriageState`, que lê a conversa)
 *   → veredito (`computeWaAiTriageProgress`: pendências, etapa e corte).
 *
 * Nada aqui fala com o banco nem com o provedor: o que entra no lugar do modelo
 * é a string que ele devolveria.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WA_AI_PLAYBOOK_SEM_REGISTRO,
  computeWaAiTriageProgress,
  normalizeWaAiPlaybookValue,
  waAiPlaybookField,
  waAiPlaybookFieldKeys,
} from './waAiPlaybook.ts';
import { parseWaAiTriageReply } from './waAiTriageReply.ts';
import { reconcileWaAiTriageState, type WaAiTriageTurn } from './waAiTriageFacts.ts';

const ROTEIRO = WA_AI_PLAYBOOK_SEM_REGISTRO;
const CHAVES = waAiPlaybookFieldKeys(ROTEIRO);
const HOJE = new Date('2026-08-12T15:00:00Z');
const TZ = 'America/Cuiaba';

interface Estado {
  facts: Record<string, string>;
  pending: string[];
  reply: string;
  degraded: boolean;
  cut: string | null;
  stage: string | null;
}

/** Um turno, do jeito que o backend o executa. */
function turno(
  anterior: Record<string, string>,
  respostaDoModelo: string,
  conversa: WaAiTriageTurn[],
): Estado {
  const leitura = parseWaAiTriageReply(respostaDoModelo, CHAVES);

  const facts: Record<string, string> = { ...anterior };
  for (const [chave, valor] of Object.entries(leitura.updates)) {
    const field = waAiPlaybookField(ROTEIRO, chave);
    if (!field) continue;
    facts[field.key] = normalizeWaAiPlaybookValue(field, valor) || String(valor);
  }

  const estado = reconcileWaAiTriageState({
    knownFacts: facts,
    pendingItems: [],
    turns: conversa,
    playbookKeys: CHAVES,
  });

  const progresso = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: estado.knownFacts, now: HOJE, timeZone: TZ,
  });

  return {
    facts: estado.knownFacts,
    pending: progresso.pending,
    reply: leitura.message,
    degraded: leitura.degraded,
    cut: progresso.cut?.id ?? null,
    stage: progresso.stage,
  };
}

const fala = (pares: ['in' | 'out', string][]): WaAiTriageTurn[] =>
  pares.map(([direction, text], i) => ({
    direction, text, at: new Date(Date.UTC(2026, 7, 12, 14, i)).toISOString(),
  }));

const resposta = (mensagem: string, atualizacoes: Record<string, string>, campoAlvo = '') =>
  JSON.stringify({ mensagem_cliente: mensagem, campo_alvo: campoAlvo, atualizacoes });

// ── A conversa que quebrou ──────────────────────────────────────────────────

test('a conversa de 12/08/2026 chega ao fim com o período gravado', () => {
  const conversa = fala([
    ['out', 'Olá! Para começar, qual é o seu nome?'],
    ['in', 'Neto'],
    ['out', 'Prazer, Neto! Para qual empresa você trabalhou sem registro?'],
    ['in', 'Todimo'],
    ['out', 'Esse trabalho era para uma empresa particular ou para um órgão público?'],
    ['in', 'Particular'],
    ['out', 'Pode me dizer qual mês e ano foi o início do seu trabalho na Todimo?'],
    ['in', 'Janeiro de 2020'],
    ['out', 'Você ainda trabalha na Todimo ou já saiu de lá?'],
    ['in', 'Já saí'],
    ['out', 'Pode me informar em que mês e ano você saiu da Todimo?'],
    ['in', 'Agosto de 2026'],
  ]);

  const estado = turno({}, resposta('Entendi, Neto. E como era o seu pagamento?', {
    nome: 'Neto', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2020', ainda_trabalha: 'não', saida: '08/2026',
  }), conversa);

  assert.equal(estado.facts.inicio, '01/2020');
  assert.equal(estado.facts.saida, '08/2026');
  assert.equal(estado.facts.ainda_trabalha, 'não');
  assert.equal(estado.stage, 'vinculo');
  // A pendência que voltava sozinha para a fila.
  assert.equal(estado.pending.indexOf('mês e ano de início'), -1);
  assert.equal(estado.pending.indexOf('mês e ano da saída'), -1);
});

test('o modelo esquece de preencher e a conversa salva o período mesmo assim', () => {
  // O caso exato do log: `atualizacoes` vazio nos turnos em que as datas foram
  // ditas. Com o schema isso ficou improvável, não impossível — e a rede de
  // baixo continua embaixo justamente para o dia em que acontecer.
  const conversa = fala([
    ['out', 'Pode me dizer qual mês e ano foi o início do seu trabalho na Todimo?'],
    ['in', 'Janeiro de 2020'],
    ['out', 'Você ainda trabalha na Todimo ou já saiu de lá?'],
    ['in', 'Já saí'],
  ]);

  const estado = turno(
    { nome: 'Neto', empregador: 'Todimo', tipo_empregador: 'particular' },
    resposta('Certo! E em que mês e ano você saiu?', {}),
    conversa);

  assert.equal(estado.facts.inicio, '01/2020');
  assert.equal(estado.facts.ainda_trabalha, 'não');
  assert.equal(estado.pending[0], 'mês e ano da saída');
});

test('o que o modelo anota errado perde para o que o cliente disse', () => {
  // Ele gravou 01/2025 para quem falou 2020. Aqui isso acontece de novo, e a
  // leitura da conversa desfaz.
  const conversa = fala([
    ['out', 'Em que mês e ano você começou a trabalhar lá?'],
    ['in', 'Janeiro de 2020'],
  ]);
  const estado = turno({}, resposta('Anotado!', { inicio: '01/2025' }), conversa);
  assert.equal(estado.facts.inicio, '01/2020');
});

// ── Os cortes, turno a turno ────────────────────────────────────────────────

test('o corte de dois anos dispara no turno em que a data chega', () => {
  const conversa = fala([
    ['out', 'Em que mês e ano você saiu?'],
    ['in', 'Julho de 2024'],
  ]);
  const antes = { nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular', inicio: '01/2020' };

  const estado = turno(antes, resposta('Entendi.', { ainda_trabalha: 'não', saida: '07/2024' }), conversa);

  assert.equal(estado.cut, 'prazo_2_anos');
  // Nada mais é perguntado, e a lista de espera fica vazia: é ela que o
  // acompanhamento leria para cobrar o cliente amanhã de manhã.
  assert.deepEqual(estado.pending, []);
});

test('um mês depois do corte o caso continua de pé', () => {
  const conversa = fala([['out', 'Em que mês e ano você saiu?'], ['in', 'Agosto de 2024']]);
  const estado = turno(
    { nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular', inicio: '01/2020' },
    resposta('Entendi.', { ainda_trabalha: 'não', saida: '08/2024' }), conversa);

  assert.equal(estado.cut, null);
  assert.equal(estado.stage, 'vinculo');
});

test('órgão público sai da triagem já na terceira pergunta', () => {
  const conversa = fala([
    ['out', 'Era para uma empresa particular ou para um órgão público?'],
    ['in', 'Era para a prefeitura'],
  ]);
  const estado = turno(
    { nome: 'Ana', empregador: 'Prefeitura de Cuiabá' },
    resposta('Entendi.', { tipo_empregador: 'publico' }), conversa);

  assert.equal(estado.cut, 'orgao_publico');
  assert.deepEqual(estado.pending, []);
});

// ── A queda ─────────────────────────────────────────────────────────────────

test('resposta fora do formato ainda fala com o cliente, mas fica marcada', () => {
  const estado = turno({ nome: 'Ana' }, 'Certo, Ana! E para quem você trabalhou?', []);
  assert.equal(estado.reply, 'Certo, Ana! E para quem você trabalhou?');
  assert.equal(estado.degraded, true);
  // O que ela não trouxe continua pendente — a queda não inventa dado.
  assert.equal(estado.pending[0], 'para quem trabalhou (empresa ou pessoa)');
});

test('JSON quebrado não vira mensagem: nada sai, e o estado sobrevive', () => {
  const estado = turno(
    { nome: 'Ana', empregador: 'Todimo' },
    '{"atualizacoes":{"tipo_empregador":"partic',
    []);
  assert.equal(estado.reply, '');
  assert.equal(estado.degraded, true);
  assert.equal(estado.facts.nome, 'Ana');
  assert.equal(estado.facts.empregador, 'Todimo');
});

// ── A deriva de nomes, na origem ────────────────────────────────────────────

test('o modelo não consegue mais inventar nome de campo', () => {
  const estado = turno({}, resposta('Certo!', {
    empresa: 'Todimo', data_inicio: '01/2020', nome_do_cliente: 'Ana', nome: 'Ana',
  } as Record<string, string>), []);

  // `empresa`, `data_inicio` e `nome_do_cliente` não existem no roteiro: a
  // leitura as descarta antes de qualquer mesclagem. Só `nome` entra.
  assert.deepEqual(Object.keys(estado.facts), ['nome']);
  assert.equal(estado.pending[0], 'para quem trabalhou (empresa ou pessoa)');
});

test('a triagem inteira, do começo ao fim, sem sobra e sem pendência', () => {
  let facts: Record<string, string> = {};
  const passos: [string, Record<string, string>][] = [
    ['Qual é o seu nome?', { nome: 'Ana' }],
    ['Para quem você trabalhou?', { empregador: 'Todimo' }],
    ['Era particular ou público?', { tipo_empregador: 'particular' }],
    ['Quando começou?', { inicio: '03/2025' }],
    ['Ainda trabalha lá?', { ainda_trabalha: 'sim' }],
    ['Tinha de ser você mesma?', { pessoalidade: 'sim' }],
    ['Como recebia?', { pagamento: 'Pix, 2000 por mês' }],
    ['Quantos dias por semana?', { habitualidade: 'seg a sex, 8h às 17h' }],
    ['Alguém passava as tarefas?', { subordinacao: 'sim' }],
    ['Tem alguma prova?', { tem_prova: 'sim' }],
    ['Quais provas?', { provas: 'conversas de WhatsApp e comprovantes de Pix' }],
    ['Tem testemunha?', { tem_testemunha: 'sim' }],
  ];

  let estado: Estado | null = null;
  for (const [mensagem, atualizacoes] of passos) {
    estado = turno(facts, resposta(mensagem, atualizacoes), []);
    facts = estado.facts;
    assert.equal(estado.cut, null, `nenhum corte deveria disparar em "${mensagem}"`);
  }

  assert.deepEqual(estado!.pending, []);
  assert.equal(estado!.stage, null);
  assert.equal(estado!.facts.saida, undefined, 'quem não saiu não tem data de saída');
});
