import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_ACCOUNT_ROUTE_DOCS_TITLE,
  buildWaAiCompletionPlans,
  renderWaAiHandoffSummary,
} from './waAiCompletion.ts';

test('wa-ai-completion.ts é cópia byte a byte de waAiCompletion.ts', () => {
  const src = readFileSync(new URL('./waAiCompletion.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-completion.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src);
});

const ref = {
  action: 'transferir_atendimento', target_type: 'department' as const,
  target_id: 'setor-1', target_label: 'Atendimento', raw: 'ação=transferir(Atendimento)',
};
const playbook = {
  id: 'sem_registro_carteira',
  bindings: [{
    key: 'destino_triagem_concluida', action: 'transferir_atendimento', targetLabel: 'Atendimento',
  }],
};
const memory = {
  knownFacts: { nome: 'Ana', empregador: 'Todimo', provas: 'WhatsApp e comprovantes de Pix' },
  pendingItems: [] as string[],
};

test('fim qualificado pede documentos citados e encaminha para o destino configurado', () => {
  const plans = buildWaAiCompletionPlans({
    allowed_actions: ['solicitar_documentos', 'transferir_atendimento'], action_refs: [ref],
  }, playbook, memory);
  assert.deepEqual(plans.map(plan => plan.action), ['solicitar_documentos', 'transferir_atendimento']);
  assert.deepEqual(plans[0].args.documentos, [
    'Provas informadas: WhatsApp e comprovantes de Pix',
  ]);
  assert.equal(plans[1].ref?.target_id, 'setor-1');
  assert.equal(plans[1].args.destino, 'Atendimento');
  assert.match(String(plans[1].args.resumo), /nome: Ana/);
  assert.match(String(plans[1].args.resumo), /Sem pendências/);
});

test('o fechamento não pede documento pessoal, e sem prova citada não pede nada', () => {
  const plans = buildWaAiCompletionPlans({
    allowed_actions: ['solicitar_documentos', 'transferir_atendimento'], action_refs: [ref],
  }, playbook, memory);
  const pedido = JSON.stringify(plans[0].args);
  assert.doesNotMatch(pedido, /CTPS/i);
  assert.doesNotMatch(pedido, /identifica/i);

  // Quem qualificou só por testemunha não tem prova para mandar: pedir um
  // documento vago aqui só criaria pendência que nunca fecha.
  const semProva = buildWaAiCompletionPlans({
    allowed_actions: ['solicitar_documentos', 'transferir_atendimento'], action_refs: [ref],
  }, playbook, { knownFacts: { nome: 'Ana', tem_prova: 'não' }, pendingItems: [] });
  assert.deepEqual(semProva.map(plan => plan.action), ['transferir_atendimento']);
});

test('destino ausente falha seguro para fila humana, quando essa ação foi autorizada', () => {
  const plans = buildWaAiCompletionPlans({
    allowed_actions: ['solicitar_documentos', 'transferir_atendimento', 'transferir_para_humano'],
    action_refs: [],
  }, playbook, memory);
  assert.deepEqual(plans.map(plan => plan.action), ['solicitar_documentos', 'transferir_para_humano']);
});

test('outro roteiro e ação não autorizada não ganham efeitos escondidos', () => {
  assert.deepEqual(buildWaAiCompletionPlans(
    { allowed_actions: [], action_refs: [ref] }, playbook, memory,
  ), []);
  assert.deepEqual(buildWaAiCompletionPlans(
    { allowed_actions: ['solicitar_documentos'], action_refs: [ref] }, { id: 'outra_campanha' }, memory,
  ), []);
});

// ── Campanha de conta: a ESCADA documental ──────────────────────────────────
//
// Um degrau por chamada, e o degrau vem do estado externo — não da memória da
// conversa nem da vontade do modelo. É o que permite a mesma função ser
// chamada por turno normal e pelos ganchos de ciclo de vida.

const kitRef = {
  action: 'enviar_documento', target_type: 'document_template' as const,
  target_id: 'tpl-kit', target_label: 'KIT CONSUMIDOR', raw: 'ação=enviar_documento(KIT CONSUMIDOR)',
};
const declaracaoRef = {
  action: 'transferir_atendimento', target_type: 'department' as const,
  target_id: 'setor-decl', target_label: 'Atendimento', raw: 'ação=transferir(Atendimento)',
};
const posAssinaturaRef = {
  action: 'transferir_atendimento', target_type: 'user' as const,
  target_id: 'user-1', target_label: 'Robiane Aguiar', raw: 'ação=transferir(Robiane Aguiar)',
};
const accountPlaybook = {
  id: 'bloqueio_encerramento_conta',
  bindings: [
    { key: 'modelo_kit_consumidor', action: 'enviar_documento', targetLabel: 'KIT CONSUMIDOR' },
    { key: 'destino_declaracao_residencia', action: 'transferir_atendimento', targetLabel: 'Atendimento' },
    { key: 'destino_pos_assinatura', action: 'transferir_atendimento', targetLabel: 'Robiane Aguiar' },
  ],
};
const accountAssistant = {
  allowed_actions: [
    'solicitar_documentos', 'consultar_documentos', 'enviar_documento',
    'consultar_assinatura', 'transferir_atendimento', 'transferir_para_humano',
  ],
  action_refs: [kitRef, declaracaoRef, posAssinaturaRef],
};
// A memória do caso NORMAL não tem `residencia_tipo`: na primeira volta a rota
// ainda não existe, porque quem a define é o arquivo que a pessoa vai enviar.
const accountMemory = {
  knownFacts: {
    nome: 'Ana', tipo_atendimento: 'conta_bloqueada_ou_encerrada',
    banco_reu: 'Banco X', saldo_retido: 'não',
    aceita_honorarios: 'sim',
  },
  pendingItems: [] as string[],
};
const memoriaComRota = (residencia_tipo: string) => ({
  knownFacts: { ...accountMemory.knownFacts, residencia_tipo },
  pendingItems: [] as string[],
});

test('o aceite dos honorários abre a coleta documental, com o comprovante genérico', () => {
  // Sem rota definida a lista NÃO chuta titularidade: pede o comprovante que a
  // pessoa tiver. Quem descobre de quem ele é depois é o próprio arquivo.
  const plans = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'none', kit: 'none' });
  assert.deepEqual(plans.map(item => item.action), ['solicitar_documentos']);
  assert.equal(plans[0].args.titulo, 'Documentos essenciais — conta bloqueada ou encerrada');
  assert.deepEqual(plans[0].args.documentos, [
    'Documento de identificação com foto do cliente',
    'Print, e-mail ou tela mostrando o bloqueio ou encerramento da conta',
    'Comprovante de residência (conta de luz, água, telefone ou internet)',
  ]);
});

test('os essenciais são sempre os mesmos três, seja qual for a rota', () => {
  // A rota não muda a primeira lista: ela nem existe ainda quando os
  // essenciais são pedidos. O que a rota traz vem depois, em pedido próprio.
  for (const rota of ['proprio', 'pai_ou_mae', 'conjuge', 'companheiro', 'aluguel_com_contrato', '']) {
    const docs = buildWaAiCompletionPlans(
      accountAssistant, accountPlaybook, memoriaComRota(rota), { documents: 'none', kit: 'none' },
    )[0].args.documentos as string[];
    assert.equal(docs.length, 3);
    assert.equal(docs[2], 'Comprovante de residência (conta de luz, água, telefone ou internet)');
  }
});

test('cada vínculo exige o documento que o prova — e pai ou mãe não exige nenhum', () => {
  const pedido = (rota: string) => buildWaAiCompletionPlans(
    accountAssistant, accountPlaybook, memoriaComRota(rota),
    { documents: 'complete', routeDocuments: 'none', kit: 'none' },
  );
  // Casamento se prova com certidão.
  assert.deepEqual(pedido('conjuge')[0].args.documentos, ['Certidão de casamento']);
  assert.equal(pedido('conjuge')[0].args.titulo, WA_AI_ACCOUNT_ROUTE_DOCS_TITLE);
  // União estável não tem certidão: vai pela declaração, com o documento do
  // declarante.
  assert.deepEqual(pedido('companheiro')[0].args.documentos,
    ['Documento de identificação com foto do declarante']);
  assert.deepEqual(pedido('aluguel_com_contrato')[0].args.documentos, ['Contrato de aluguel']);
  assert.deepEqual(pedido('terceiro_sem_contrato')[0].args.documentos,
    ['Documento de identificação com foto do declarante']);
  // Pai ou mãe já está provado pela filiação do próprio RG do cliente: nada a
  // pedir, então a escada segue direto para o KIT.
  assert.deepEqual(pedido('pai_ou_mae').map(item => item.action), ['enviar_documento']);
  assert.deepEqual(pedido('proprio').map(item => item.action), ['enviar_documento']);
});

test('enquanto o documento do vínculo não chega, a escada não anda', () => {
  assert.deepEqual(buildWaAiCompletionPlans(
    accountAssistant, accountPlaybook, memoriaComRota('conjuge'),
    { documents: 'complete', routeDocuments: 'pending', kit: 'none' },
  ), []);
});

test('com a certidão entregue, o cônjuge segue para o KIT como qualquer um', () => {
  const plans = buildWaAiCompletionPlans(
    accountAssistant, accountPlaybook, memoriaComRota('conjuge'),
    { documents: 'complete', routeDocuments: 'complete', kit: 'none' },
  );
  assert.deepEqual(plans.map(item => item.action), ['enviar_documento']);
});

test('enquanto a solicitação está aberta, o fechamento não faz nada', () => {
  // A cobrança dos documentos é do acompanhamento próprio da solicitação.
  // Empilhar outra ação aqui seria pedir duas vezes a mesma coisa.
  assert.deepEqual(buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'pending', kit: 'none' }), []);
});

test('documentos completos mandam o KIT CONSUMIDOR com a orientação do Réu', () => {
  const plans = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'complete', kit: 'none' });
  assert.deepEqual(plans.map(item => item.action), ['enviar_documento']);
  assert.equal(plans[0].ref?.target_id, 'tpl-kit');
  assert.equal(plans[0].args.documento, 'KIT CONSUMIDOR');
  assert.match(String(plans[0].args.mensagem), /campo Réu/);
});

test('o KIT enviado e ainda não assinado não empurra a conversa', () => {
  for (const kit of ['pending', 'refused'] as const) {
    assert.deepEqual(buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
      { documents: 'complete', kit }), []);
  }
});

test('só a assinatura confirmada transfere, e para o destino configurado', () => {
  const plans = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'complete', kit: 'signed' });
  assert.deepEqual(plans.map(item => item.action), ['transferir_atendimento']);
  assert.equal(plans[0].ref?.target_id, 'user-1');
  assert.equal(plans[0].args.destino, 'Robiane Aguiar');
  assert.match(String(plans[0].args.motivo), /KIT CONSUMIDOR assinado/);
});

test('as duas rotas sem certidão transferem para a declaração, sem KIT', () => {
  for (const rota of ['terceiro_sem_contrato', 'companheiro']) {
    const plans = buildWaAiCompletionPlans(accountAssistant, accountPlaybook,
      memoriaComRota(rota), { documents: 'complete', routeDocuments: 'complete', kit: 'none' });
    assert.deepEqual(plans.map(item => item.action), ['transferir_atendimento']);
    assert.equal(plans[0].ref?.target_id, 'setor-decl');
    assert.match(String(plans[0].args.motivo), /declaração de residência/);
  }
});

test('destino não configurado cai na fila humana em vez de travar a escada', () => {
  const semRefs = { allowed_actions: accountAssistant.allowed_actions, action_refs: [] };
  const plans = buildWaAiCompletionPlans(semRefs, accountPlaybook, accountMemory,
    { documents: 'complete', kit: 'signed' });
  assert.deepEqual(plans.map(item => item.action), ['transferir_para_humano']);
});

test('campanha de conta não executa degrau que não foi autorizado', () => {
  assert.deepEqual(buildWaAiCompletionPlans(
    { allowed_actions: ['transferir_para_humano'], action_refs: [] },
    accountPlaybook, accountMemory, { documents: 'none', kit: 'none' },
  ), []);
  assert.deepEqual(buildWaAiCompletionPlans(
    { allowed_actions: ['solicitar_documentos'], action_refs: [kitRef] },
    accountPlaybook, accountMemory, { documents: 'complete', kit: 'none' },
  ), []);
});

test('outro assunto jurídico transfere com contexto e nunca pede documentos da conta', () => {
  const legalMemory = {
    knownFacts: {
      nome: 'Igor', tipo_atendimento: 'outro_assunto_juridico',
      assunto_juridico_relato: 'Fui demitido e não recebi as verbas.',
      assunto_juridico_periodo: 'Julho de 2026',
      assunto_juridico_envolvidos: 'Empresa Exemplo Ltda.',
      assunto_juridico_objetivo: 'Cobrar os valores pendentes.',
    },
    pendingItems: [] as string[],
  };
  // Quem trocou de assunto nunca entra na escada documental: mesmo com o
  // estado externo zerado, o fechamento é a transferência, não o pedido.
  const plans = buildWaAiCompletionPlans({
    allowed_actions: accountAssistant.allowed_actions,
    action_refs: accountAssistant.action_refs,
  }, accountPlaybook, legalMemory, { documents: 'none', kit: 'none' });
  assert.deepEqual(plans.map(item => item.action), ['transferir_para_humano']);
  assert.match(String(plans[0].args.motivo), /possível relevância jurídica/);
  assert.match(String(plans[0].args.resumo), /Empresa Exemplo/);
});

// ── O resumo que quem assume a conversa vai ler ─────────────────────────────
//
// O que saía em produção em 14/08/2026, numa linha só:
//
//   "Fatos informados: nome: Pedro · conta: não informado · agencia: não
//    informado · filiacao: WILSON... · banco_reu: Nubank · tem_print: sim ·
//    aviso_previo: não · saldo_retido: não · situacao_atual: continua ..."
//
// Chave interna no lugar de rótulo e três "não informado" disputando espaço
// com os fatos do caso.

const CAMPOS = [
  { key: 'nome', label: 'Nome' },
  { key: 'banco_reu', label: 'Banco (réu)' },
  { key: 'agencia', label: 'Agência' },
  { key: 'conta', label: 'Conta' },
  { key: 'tem_print', label: 'Tem prova mínima' },
];

test('o resumo usa rótulo do roteiro, não a chave interna', () => {
  const texto = renderWaAiHandoffSummary({
    motivo: 'Triagem concluída.',
    facts: { nome: 'Pedro', banco_reu: 'Nubank', tem_print: 'sim' },
    fields: CAMPOS,
  });
  assert.ok(texto.includes('• Banco (réu): Nubank'));
  assert.ok(texto.includes('• Tem prova mínima: sim'));
  assert.equal(texto.includes('banco_reu'), false, 'chave interna vazou para o resumo');
  assert.equal(texto.includes('tem_print'), false);
});

test('o que o cliente não soube sai da lista e vira uma linha só', () => {
  const texto = renderWaAiHandoffSummary({
    motivo: 'Triagem concluída.',
    facts: { nome: 'Pedro', agencia: 'não informado', conta: 'não sei', banco_reu: 'Nubank' },
    fields: CAMPOS,
  });
  assert.ok(texto.includes('Não informado: agência, conta.'));
  // Não pode aparecer como se fosse fato do caso.
  assert.equal(texto.includes('• Agência'), false);
  assert.equal(texto.includes('• Conta'), false);
  assert.ok(texto.includes('• Nome: Pedro'));
});

test('a ordem é a do roteiro, e o que veio de fora dele entra no fim', () => {
  const texto = renderWaAiHandoffSummary({
    motivo: 'Triagem concluída.',
    // de propósito fora de ordem, e com um fato que não é campo do roteiro
    facts: { comprovante_titular: 'JOSE ALVINO', banco_reu: 'Nubank', nome: 'Pedro' },
    fields: CAMPOS,
  });
  const linhas = texto.split('\n').filter(l => l.startsWith('• '));
  assert.deepEqual(linhas, [
    '• Nome: Pedro',
    '• Banco (réu): Nubank',
    '• comprovante_titular: JOSE ALVINO',
  ]);
});

test('pendência do roteiro aparece; sem ela, diz que não há', () => {
  const comPendencia = renderWaAiHandoffSummary({
    motivo: 'Corte.', facts: { nome: 'Pedro' }, pendingItems: ['o mês da saída'], fields: CAMPOS,
  });
  assert.ok(comPendencia.includes('Ainda falta: o mês da saída.'));
  const semPendencia = renderWaAiHandoffSummary({
    motivo: 'Corte.', facts: { nome: 'Pedro' }, fields: CAMPOS,
  });
  assert.ok(semPendencia.includes('Sem pendências do roteiro.'));
});

test('sem fato nenhum o resumo continua legível e não estoura o limite', () => {
  const vazio = renderWaAiHandoffSummary({ motivo: 'Corte.', facts: {} });
  assert.ok(vazio.includes('Ainda não há fatos estruturados.'));
  const gigante = renderWaAiHandoffSummary({
    motivo: 'x', facts: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`c${i}`, 'valor'])),
  });
  assert.ok(gigante.length <= 800);
});
