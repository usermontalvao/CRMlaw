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
  computeWaAiTriageNextAction,
  computeWaAiTriageProgress,
  normalizeWaAiPlaybookValue,
  waAiPlaybookField,
  waAiPlaybookFieldKeys,
} from './waAiPlaybook.ts';
import { buildWaAiCompletionPlans } from './waAiCompletion.ts';
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
  assert.equal(estado.pending.indexOf('quando você saiu'), -1);
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
  assert.equal(estado.pending[0], 'quando você saiu');
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
    ['out', 'E quando você saiu de lá?'],
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
  const conversa = fala([['out', 'E quando você saiu de lá?'], ['in', 'Agosto de 2024']]);
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
  assert.equal(estado.pending[0], 'se alguém mandava no serviço');
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
    ['out', 'Consegue mandar essas provas por aqui?'], ['in', 'mando sim'],
    ['out', 'Os honorários são 40% sobre o êxito, incluindo FGTS e seguro-desemprego. De acordo?'],
    ['in', 'de acordo'],
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
  assert.equal(estado.facts.envio_provas, 'sim');
  assert.equal(estado.facts.aceita_honorarios, 'sim');
});

// ── A queda ─────────────────────────────────────────────────────────────────

test('resposta fora do formato ainda fala com o cliente, mas fica marcada', () => {
  const estado = turno({ nome: 'Ana' }, 'Certo, Ana! E para quem você trabalhou?', []);
  assert.equal(estado.reply, 'Certo, Ana! E para quem você trabalhou?');
  assert.equal(estado.degraded, true);
  // O que ela não trouxe continua pendente — a queda não inventa dado.
  assert.equal(estado.pending[0], 'para quem você trabalhava');
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
  assert.equal(estado.pending[0], 'para quem você trabalhava');
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
    ['Consegue enviar essas provas por aqui?', { envio_provas: 'sim' }],
    ['Os honorários são 40% sobre o êxito. De acordo?', { aceita_honorarios: 'sim' }],
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

test('as provas vêm antes dos honorários, e a transferência só depois do "sim"', () => {
  const base: Record<string, string> = {
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular', inicio: '03/2025',
    ainda_trabalha: 'sim', funcao: 'vendedora', pessoalidade: 'sim', recebia_pagamento: 'sim',
    pagamento: 'Pix, 2000 por mês', trabalho_regular: 'regular',
    habitualidade: 'seg a sex, 8h às 17h', subordinacao: 'sim', tem_prova: 'sim',
    provas: 'conversas de WhatsApp', tem_testemunha: 'sim', outros_trabalhos: 'não',
  };

  // Qualificada, ela ainda não ouviu falar em honorários: o que falta é mandar
  // as provas.
  const provas = computeWaAiTriageProgress({ playbook: ROTEIRO, facts: base, now: HOJE, timeZone: TZ });
  assert.equal(provas.nextField, 'envio_provas');
  assert.equal(provas.complete, false);

  // Só então os 40% — e antes disso a triagem não fecha nem transfere.
  const honorarios = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: { ...base, envio_provas: 'sim' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(honorarios.nextField, 'aceita_honorarios');
  assert.equal(honorarios.complete, false);
  const pergunta = computeWaAiTriageNextAction(ROTEIRO, honorarios);
  assert.equal(pergunta.type, 'ask_field');
  assert.match(String((pergunta as { question: string }).question), /40%/);
  assert.match(String((pergunta as { question: string }).question), /FGTS/);
  assert.match(String((pergunta as { question: string }).question), /seguro-desemprego/);

  const fim = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: { ...base, envio_provas: 'sim', aceita_honorarios: 'sim' },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(fim.cut, null);
  assert.equal(fim.complete, true);

  // Recusou: encerra sem transferência e sem pedir documento nenhum.
  const recusa = computeWaAiTriageProgress({
    playbook: ROTEIRO, facts: { ...base, envio_provas: 'sim', aceita_honorarios: 'não' },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(recusa.cut?.id, 'honorarios_nao_aceitos');
  assert.equal(recusa.cut?.effect, 'disqualify');
  assert.deepEqual(recusa.pending, []);
});

test('conta: fluxo qualificado completo resiste a erro, gíria e resposta negativa popular', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const turns = fala([
    ['out', 'A conta foi bloqueada ou encerrada de vez?'], ['in', 'bloquearam tudo, não consigo usar'],
    ['out', 'Em que mês e ano isso aconteceu?'], ['in', 'setenbro de 2025'],
    ['out', 'O banco enviou algum e-mail, SMS ou notificação?'], ['in', 'foi do nada, só descobri no aplicativo'],
    ['out', 'Tem algum print, e-mail ou tela?'], ['in', 'tenho screenshot da mensagem'],
    ['out', 'Ficou algum saldo preso?'], ['in', 'não ficou nada'],
    ['out', 'Os honorários são 40%. Está de acordo?'], ['in', 'sim, concordo'],
  ]);
  const reconciled = reconcileWaAiTriageState({
    knownFacts: {
      nome: 'Ana', tipo_atendimento: 'conta_bloqueada_ou_encerrada',
      banco_reu: 'Nubank',
      motivo_informado: 'não informou', situacao_atual: 'continua bloqueada',
      agencia: 'não informado', conta: 'não informado',
    },
    pendingItems: [], turns, playbookKeys: waAiPlaybookFieldKeys(playbook),
  });
  const progress = computeWaAiTriageProgress({ playbook, facts: reconciled.knownFacts, now: HOJE, timeZone: TZ });
  assert.equal(progress.cut, null);
  // O "sim" dos honorários fecha a coleta: a rota do comprovante não é mais
  // perguntada aqui — ela nasce do arquivo que a pessoa enviar.
  assert.equal(progress.complete, true);
  assert.deepEqual(progress.pending, []);
  assert.equal(reconciled.knownFacts.tipo_ocorrencia, 'bloqueio');
  assert.equal(reconciled.knownFacts.data_ocorrencia, '09/2025');
  assert.equal(reconciled.knownFacts.aviso_previo, 'não');
  assert.equal(reconciled.knownFacts.aceita_honorarios, 'sim');
});

test('conta: “Oi” não vira nome e “foi agora, em 2026” não repete a data', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const turns = fala([
    ['in', 'Oi'],
    ['out', 'Qual é o nome do banco que bloqueou ou encerrou sua conta?'], ['in', 'Neon'],
    ['out', 'A conta foi bloqueada ou foi encerrada de vez?'], ['in', 'Encerrada'],
    ['out', 'Em que mês e ano isso aconteceu?'],
    ['in', 'Olha, o mês eu não me recordo, mas foi agora, em 2026.'],
  ]);
  const reconciled = reconcileWaAiTriageState({
    // Reproduz também uma sessão já contaminada pela versão anterior.
    knownFacts: {
      nome: 'Oi', tipo_atendimento: 'conta_bloqueada_ou_encerrada',
      banco_reu: 'Neon', tipo_ocorrencia: 'encerramento',
    },
    pendingItems: [], turns, playbookKeys: waAiPlaybookFieldKeys(playbook),
  });
  assert.equal(reconciled.knownFacts.data_ocorrencia, '2026');

  const beforeName = computeWaAiTriageProgress({
    playbook, facts: reconciled.knownFacts, now: HOJE, timeZone: TZ,
  });
  assert.equal(beforeName.nextField, 'nome');
  const askName = computeWaAiTriageNextAction(playbook, beforeName, turns.at(-1)?.text);
  assert.equal(askName.type === 'ask_field' ? askName.question : '', 'Para começar, qual é o seu nome?');

  const afterName = computeWaAiTriageProgress({
    playbook, facts: { ...reconciled.knownFacts, nome: 'Igor' }, now: HOJE, timeZone: TZ,
  });
  const next = computeWaAiTriageNextAction(playbook, afterName, 'Igor');
  assert.equal(afterName.nextField, 'recebeu_comunicacao');
  assert.equal(next.type === 'ask_field' ? next.field : '', 'recebeu_comunicacao');
  assert.doesNotMatch(next.type === 'ask_field' ? next.question : '', /mês e ano/i);
});

test('conta: a triagem inteira, pergunta a pergunta, até abrir a coleta documental', () => {
  // O teste que o roteiro precisava ter: em vez de conferir um estado final
  // montado à mão, ele ANDA o fluxo — a cada resposta, pergunta ao motor qual é
  // a próxima e responde exatamente aquela. Se alguma pergunta sumir, voltar,
  // repetir ou vier fora de ordem, é aqui que aparece.
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const respostas: Record<string, string> = {
    nome: 'Igor',
    banco_reu: 'Nubank',
    tipo_ocorrencia: 'encerramento',
    data_ocorrencia: '01/2026',
    recebeu_comunicacao: 'sim',
    tipo_comunicacao: 'notificação do aplicativo',
    momento_comunicacao: 'posterior',
    motivo_informado: 'disseram que foi questão de segurança',
    situacao_atual: 'continua encerrada',
    saldo_retido: 'sim',
    valor_saldo: 'R$ 3.400',
    agencia: 'não informado',
    conta: 'não informado',
    tem_print: 'sim',
    aceita_honorarios: 'sim',
  };

  const facts: Record<string, string> = {};
  const perguntadas: string[] = [];
  for (let volta = 0; volta < 40; volta++) {
    const progress = computeWaAiTriageProgress({ playbook, facts, now: HOJE, timeZone: TZ });
    assert.equal(progress.cut, null, `corte inesperado em ${JSON.stringify(facts)}`);
    if (progress.complete) break;
    const action = computeWaAiTriageNextAction(playbook, progress);
    assert.equal(action.type, 'ask_field');
    const campo = action.type === 'ask_field' ? action.field : '';
    assert.equal(perguntadas.includes(campo), false, `${campo} foi perguntado duas vezes`);
    assert.ok(respostas[campo] !== undefined, `roteiro pediu ${campo}, que a conversa não previu`);
    // A pergunta que sai ao cliente é a do roteiro, e não uma invenção do turno.
    assert.ok((action.type === 'ask_field' ? action.question : '').length > 0);
    perguntadas.push(campo);
    facts[campo] = respostas[campo];
  }

  // A ordem exata: identificação, ocorrência, conta, honorários e só então a
  // residência. Os honorários vêm depois de tudo o que qualifica o caso.
  // `tipo_atendimento` NÃO aparece: a campanha é direcionada, então a rota
  // bancária é a premissa e o campo só é preenchido se a pessoa, por conta
  // própria, trouxer outro assunto.
  assert.deepEqual(perguntadas, [
    'nome', 'banco_reu',
    'tipo_ocorrencia', 'data_ocorrencia', 'recebeu_comunicacao', 'tipo_comunicacao',
    'momento_comunicacao', 'motivo_informado', 'situacao_atual',
    'saldo_retido', 'valor_saldo', 'agencia', 'conta', 'tem_print',
    'aceita_honorarios',
  ]);

  const fim = computeWaAiTriageProgress({ playbook, facts, now: HOJE, timeZone: TZ });
  assert.equal(fim.complete, true);
  assert.deepEqual(fim.pending, []);
  // Terminar a coleta é o gatilho do fechamento, e o fechamento desta campanha
  // começa pedindo os documentos.
  const acao = computeWaAiTriageNextAction(playbook, fim);
  assert.equal(acao.type, 'complete');
  const plans = buildWaAiCompletionPlans({
    allowed_actions: ['solicitar_documentos', 'enviar_documento', 'transferir_atendimento'],
    action_refs: [],
  }, { id: playbook.id, bindings: playbook.bindings }, { knownFacts: facts, pendingItems: [] });
  assert.deepEqual(plans.map(item => item.action), ['solicitar_documentos']);
});

test('conta: comprovante em outro nome reabre a conversa e leva à declaração', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  // O estado logo depois de o sistema ler o comprovante e ver outro nome nele.
  const base = {
    nome: 'Ana', tipo_atendimento: 'conta_bloqueada_ou_encerrada',
    banco_reu: 'Banco X', tipo_ocorrencia: 'encerramento',
    data_ocorrencia: '01/2026', recebeu_comunicacao: 'não',
    motivo_informado: 'não informou', situacao_atual: 'encerrada',
    agencia: 'não informado', conta: 'não informado', tem_print: 'sim',
    saldo_retido: 'não', aceita_honorarios: 'sim',
    comprovante_titularidade: 'terceiro',
    residencia_tipo: 'terceiro_sem_contrato',
  };
  const semDeclarante = computeWaAiTriageProgress({ playbook, facts: base, now: HOJE, timeZone: TZ });
  assert.deepEqual(semDeclarante.missing,
    ['declarante_nome', 'endereco_residencia', 'declarante_tem_documento']);

  const facts = {
    ...base, declarante_nome: 'José Silva',
    endereco_residencia: 'Rua A, 10, Centro, Cuiabá, 78000-000',
    declarante_tem_documento: 'sim',
  };
  const fim = computeWaAiTriageProgress({ playbook, facts, now: HOJE, timeZone: TZ });
  assert.equal(fim.complete, true);

  // Nesta rota o KIT não é enviado: a pasta vai para quem prepara a declaração.
  const assistente = {
    allowed_actions: ['solicitar_documentos', 'enviar_documento', 'transferir_atendimento'],
    action_refs: [{
      action: 'transferir_atendimento', target_type: 'department' as const, target_id: 'setor-1',
      target_label: 'Atendimento', raw: 'ação=transferir(Atendimento)',
    }],
  };
  const pb = { id: playbook.id, bindings: playbook.bindings };
  const mem = { knownFacts: facts, pendingItems: [] as string[] };

  // Primeiro o sistema pede o documento que ESTA rota exige — o do declarante,
  // porque não há certidão que prove morar em imóvel de terceiro.
  const pedido = buildWaAiCompletionPlans(assistente, pb, mem,
    { documents: 'complete', routeDocuments: 'none', kit: 'none' });
  assert.deepEqual(pedido.map(item => item.action), ['solicitar_documentos']);
  assert.deepEqual(pedido[0].args.documentos, ['Documento de identificação com foto do declarante']);

  // E só com ele entregue a pasta vai para quem prepara a declaração.
  const plans = buildWaAiCompletionPlans(assistente, pb, mem,
    { documents: 'complete', routeDocuments: 'complete', kit: 'none' });
  assert.deepEqual(plans.map(item => item.action), ['transferir_atendimento']);
  assert.match(String(plans[0].args.motivo), /declaração de residência/);
});

test('conta: cada corte comercial encerra a triagem', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const cases: [Record<string, string>, string][] = [
    [{ instituicao_liquidada: 'sim' }, 'instituicao_em_liquidacao'],
    [{ data_ocorrencia: '02/2024' }, 'prazo_2_anos_conta'],
    [{ recebeu_comunicacao: 'sim', momento_comunicacao: 'anterior_com_acesso_normal' }, 'houve_aviso_previo'],
    [{ tem_print: 'não' }, 'sem_print_conta'],
    [{ aceita_honorarios: 'não' }, 'honorarios_nao_aceitos'],
  ];
  for (const [facts, cut] of cases) {
    const progress = computeWaAiTriageProgress({ playbook, facts, now: HOJE, timeZone: TZ });
    assert.equal(progress.cut?.id, cut);
    assert.deepEqual(progress.pending, []);
  }
});
