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
  WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
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

test('o caso real com "marcço de 2023" é cortado pelo relógio do backend, sem ajuda do modelo', () => {
  const conversa = fala([
    ['out', 'Você ainda trabalha lá ou já saiu?'],
    ['in', 'marcço de 2023'],
  ]);
  const antes = {
    nome: 'Pedro', empregador: 'Todimo', tipo_empregador: 'particular', inicio: '01/2020',
  };

  // O modelo não extrai nenhum campo. A conversa, o relógio real e a regra do
  // backend precisam bastar para encerrar a triagem no mesmo turno.
  const estado = turno(antes, resposta('Entendi.', {}), conversa);

  assert.equal(estado.facts.saida, '03/2023');
  assert.equal(estado.facts.ainda_trabalha, 'não');
  assert.equal(estado.cut, 'prazo_2_anos');
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

test('matriz de cortes entende respostas populares mesmo quando o modelo erra', () => {
  const casos: {
    nome: string; antes: Record<string, string>; pergunta: string; respostaCliente: string;
    erroDoModelo: Record<string, string>; corte: string;
  }[] = [
    {
      nome: 'órgão público', antes: { nome: 'Ana', empregador: 'Prefeitura' },
      pergunta: 'Era uma empresa privada ou era da prefeitura/governo?', respostaCliente: 'da prefeitura mesmo',
      erroDoModelo: { tipo_empregador: 'particular' }, corte: 'orgao_publico',
    },
    {
      nome: 'substituição', antes: { nome: 'Ana', empregador: 'Loja', tipo_empregador: 'particular', inicio: '01/2026', ainda_trabalha: 'sim', funcao: 'caixa' },
      pergunta: 'Tinha que ser você ou alguém podia ficar no seu lugar?', respostaCliente: 'meu irmão ia lá por mim',
      erroDoModelo: { pessoalidade: 'sim' }, corte: 'sem_pessoalidade',
    },
    {
      nome: 'sem pagamento', antes: { nome: 'Ana', empregador: 'Loja', tipo_empregador: 'particular', inicio: '01/2026', ainda_trabalha: 'sim', funcao: 'caixa', pessoalidade: 'sim' },
      pergunta: 'Você recebia algum pagamento por isso?', respostaCliente: 'não, era voluntário',
      erroDoModelo: { recebia_pagamento: 'sim' }, corte: 'sem_pagamento',
    },
    {
      nome: 'esporádico', antes: { nome: 'Ana', empregador: 'Loja', tipo_empregador: 'particular', inicio: '01/2026', ainda_trabalha: 'sim', funcao: 'caixa', pessoalidade: 'sim', recebia_pagamento: 'sim', pagamento: '150 por dia' },
      pergunta: 'Era toda semana ou só de vez em quando?', respostaCliente: 'era um bico, só quando chamava',
      erroDoModelo: { trabalho_regular: 'regular' }, corte: 'trabalho_esporadico',
    },
    {
      nome: 'sem direção', antes: { nome: 'Ana', empregador: 'Loja', tipo_empregador: 'particular', inicio: '01/2026', ainda_trabalha: 'sim', funcao: 'caixa', pessoalidade: 'sim', recebia_pagamento: 'sim', pagamento: '150 por dia', trabalho_regular: 'regular', habitualidade: 'segunda a sexta' },
      pergunta: 'Tinha chefe ou alguém que dizia o que fazer?', respostaCliente: 'ninguém mandava, fazia meu próprio horário',
      erroDoModelo: { subordinacao: 'sim' }, corte: 'sem_subordinacao',
    },
    {
      nome: 'sem prova nem testemunha', antes: { nome: 'Ana', empregador: 'Loja', tipo_empregador: 'particular', inicio: '01/2026', ainda_trabalha: 'sim', funcao: 'caixa', pessoalidade: 'sim', recebia_pagamento: 'sim', pagamento: '150 por dia', trabalho_regular: 'regular', habitualidade: 'segunda a sexta', subordinacao: 'sim', tem_prova: 'não' },
      pergunta: 'Tem testemunha ou alguém que trabalhou com você?', respostaCliente: 'ninguém',
      erroDoModelo: { tem_testemunha: 'sim' }, corte: 'sem_prova_nem_testemunha',
    },
  ];

  for (const caso of casos) {
    const estado = turno(
      caso.antes,
      resposta('Entendi.', caso.erroDoModelo),
      fala([['out', caso.pergunta], ['in', caso.respostaCliente]]),
    );
    assert.equal(estado.cut, caso.corte, caso.nome);
    assert.deepEqual(estado.pending, [], caso.nome);
  }
});

test('cliente confuso não é reprovado: o campo continua pendente para reformulação', () => {
  const antes = {
    nome: 'Ana', empregador: 'Loja', tipo_empregador: 'particular', inicio: '01/2026',
    ainda_trabalha: 'sim', funcao: 'caixa', pessoalidade: 'sim', recebia_pagamento: 'sim',
    pagamento: '2000 por mês', trabalho_regular: 'regular', habitualidade: 'segunda a sexta',
  };
  const estado = turno(
    antes,
    resposta('Sem problema, vou perguntar de outro jeito.', {}),
    fala([['out', 'Tinha chefe ou alguém que dizia o que fazer?'], ['in', 'não entendi']]),
  );
  assert.equal(estado.cut, null);
  assert.equal(estado.pending[0], 'se alguém passava as tarefas, cobrava o serviço ou definia o horário');
});

test('fluxo qualificado completo sobrevive a gíria, erro de escrita e respostas curtas', () => {
  const conversa = fala([
    ['out', 'Era empresa privada ou prefeitura?'], ['in', 'privada normal'],
    ['out', 'Quando começou?'], ['in', 'feverero de 2025'],
    ['out', 'Você ainda trabalha lá?'], ['in', 'ainda trabalho'],
    ['out', 'Tinha que ser você ou podia mandar outra pessoa?'], ['in', 'não podia, tinha que ser eu'],
    ['out', 'Você ganhava alguma coisa pelo trabalho?'], ['in', 'uns 2 mil por mês no pix'],
    ['out', 'Com que frequência acontecia?'], ['in', 'cinco vezes por semana'],
    ['out', 'Tinha chefe ou alguém que dizia o que fazer?'], ['in', 'o gerente mandava e cobrava'],
    ['out', 'Ficou alguma prova, comprovante ou conversa?'], ['in', 'tenho conversa no zap e pix'],
    ['out', 'Alguém viu você trabalhando e pode confirmar?'], ['in', 'minha esposa me viu todo dia'],
    ['out', 'Além desse, teve mais algum trabalho assim?'], ['in', 'foi só esse'],
  ]);
  const estado = turno({}, resposta('Pronto, terminei a triagem.', {
    nome: 'Ana', empregador: 'Mercadinho', funcao: 'caixa e reposição',
    pagamento: 'aproximadamente 2 mil por mês via Pix',
    habitualidade: 'cinco vezes por semana, das 8h às 18h',
    provas: 'conversas de WhatsApp e comprovantes de Pix',
  }), conversa);

  assert.equal(estado.cut, null);
  assert.deepEqual(estado.pending, []);
  assert.equal(estado.stage, null);
  assert.equal(estado.facts.inicio, '02/2025');
  assert.equal(estado.facts.pessoalidade, 'sim');
  assert.equal(estado.facts.recebia_pagamento, 'sim');
  assert.equal(estado.facts.trabalho_regular, 'regular');
  assert.equal(estado.facts.subordinacao, 'sim');
  assert.equal(estado.facts.outros_trabalhos, 'não');
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
    ['O que você fazia lá?', { funcao: 'vendedora' }],
    ['Tinha de ser você mesma?', { pessoalidade: 'sim' }],
    ['Você recebia algum pagamento?', { recebia_pagamento: 'sim' }],
    ['Como recebia?', { pagamento: 'Pix, 2000 por mês' }],
    ['Era toda semana ou de vez em quando?', { trabalho_regular: 'regular' }],
    ['Quantos dias por semana?', { habitualidade: 'seg a sex, 8h às 17h' }],
    ['Alguém passava as tarefas?', { subordinacao: 'sim' }],
    ['Tem alguma prova?', { tem_prova: 'sim' }],
    ['Quais provas?', { provas: 'conversas de WhatsApp e comprovantes de Pix' }],
    ['Tem testemunha?', { tem_testemunha: 'sim' }],
    ['Teve outro trabalho sem carteira?', { outros_trabalhos: 'não' }],
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

test('conta: fluxo qualificado completo resiste a erro, gíria e resposta negativa popular', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const turns = fala([
    ['out', 'A conta foi bloqueada ou encerrada de vez?'], ['in', 'bloquearam tudo, não consigo usar'],
    ['out', 'Em que mês e ano isso aconteceu?'], ['in', 'setenbro de 2025'],
    ['out', 'O banco avisou antes?'], ['in', 'foi do nada, só descobri no aplicativo'],
    ['out', 'Tem algum print, e-mail ou tela?'], ['in', 'tenho screenshot da mensagem'],
    ['out', 'Ficou algum saldo preso?'], ['in', 'não ficou nada'],
    ['out', 'Qual comprovante de residência você tem?'], ['in', 'está no nome da minha mãe'],
    ['out', 'Os honorários são 40%. Está de acordo?'], ['in', 'sim, concordo'],
  ]);
  const reconciled = reconcileWaAiTriageState({
    knownFacts: { nome: 'Ana', banco_reu: 'Nubank', titular_comprovante: 'Maria, mãe' },
    pendingItems: [], turns, playbookKeys: waAiPlaybookFieldKeys(playbook),
  });
  const progress = computeWaAiTriageProgress({ playbook, facts: reconciled.knownFacts, now: HOJE, timeZone: TZ });
  assert.equal(progress.cut, null);
  assert.equal(progress.complete, true);
  assert.deepEqual(progress.pending, []);
  assert.equal(reconciled.knownFacts.tipo_ocorrencia, 'bloqueio');
  assert.equal(reconciled.knownFacts.data_ocorrencia, '09/2025');
  assert.equal(reconciled.knownFacts.aviso_previo, 'não');
  assert.equal(reconciled.knownFacts.residencia_tipo, 'familiar');
});

test('conta: saldo retido abre valor; casa de favor abre declaração e documento do declarante', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const base = {
    nome: 'Ana', banco_reu: 'Banco X', tipo_ocorrencia: 'encerramento',
    data_ocorrencia: '01/2026', aviso_previo: 'não', tem_print: 'sim',
    saldo_retido: 'sim', residencia_tipo: 'terceiro_sem_contrato', aceita_honorarios: 'sim',
  };
  const pending = computeWaAiTriageProgress({ playbook, facts: base, now: HOJE, timeZone: TZ });
  assert.ok(pending.missing.includes('valor_saldo'));
  assert.ok(pending.missing.includes('declarante_nome'));
  assert.ok(pending.missing.includes('endereco_residencia'));
  assert.ok(pending.missing.includes('declarante_tem_documento'));

  const done = computeWaAiTriageProgress({
    playbook,
    facts: {
      ...base, valor_saldo: 'R$ 1.200', declarante_nome: 'Carlos Souza',
      endereco_residencia: 'Rua A, 10, Centro, Cuiabá, 78000-000',
      declarante_tem_documento: 'sim',
    },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(done.cut, null);
  assert.equal(done.complete, true);
});

test('conta: cada corte comercial encerra antes de pedir documentos', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const cases: [Record<string, string>, string][] = [
    [{ data_ocorrencia: '02/2024' }, 'prazo_2_anos_conta'],
    [{ aviso_previo: 'sim' }, 'houve_aviso_previo'],
    [{ tem_print: 'não' }, 'sem_print_conta'],
    [{ residencia_tipo: 'terceiro_sem_contrato', declarante_tem_documento: 'não' }, 'declarante_sem_documento'],
    [{ aceita_honorarios: 'não' }, 'honorarios_nao_aceitos'],
  ];
  for (const [facts, cut] of cases) {
    const progress = computeWaAiTriageProgress({ playbook, facts, now: HOJE, timeZone: TZ });
    assert.equal(progress.cut?.id, cut);
    assert.deepEqual(progress.pending, []);
  }
});
