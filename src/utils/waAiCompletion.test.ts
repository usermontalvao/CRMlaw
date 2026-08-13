import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWaAiCompletionPlans } from './waAiCompletion.ts';

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
    'Documento de identificação com foto', 'CTPS Digital',
    'Provas informadas: WhatsApp e comprovantes de Pix',
  ]);
  assert.equal(plans[1].ref?.target_id, 'setor-1');
  assert.equal(plans[1].args.destino, 'Atendimento');
  assert.match(String(plans[1].args.resumo), /nome: Ana/);
  assert.match(String(plans[1].args.resumo), /Sem pendências/);
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

const accountPlaybook = {
  id: 'bloqueio_encerramento_conta',
  bindings: [
    { key: 'modelo_kit_consumidor', action: 'enviar_documento', targetLabel: 'KIT CONSUMIDOR' },
    { key: 'destino_declaracao_residencia', action: 'transferir_atendimento', targetLabel: 'Atendimento' },
    { key: 'destino_pos_assinatura', action: 'transferir_atendimento', targetLabel: 'Atendimento' },
  ],
};
const kitRef = {
  action: 'enviar_documento', target_type: 'document_template' as const,
  target_id: 'kit-1', target_label: 'KIT CONSUMIDOR', raw: 'ação=enviar_documento(KIT CONSUMIDOR)',
};
const accountAssistant = {
  allowed_actions: ['solicitar_documentos', 'enviar_documento', 'transferir_atendimento'],
  action_refs: [ref, kitRef],
};
const accountMemory = {
  knownFacts: {
    nome: 'Ana', banco_reu: 'Banco X', residencia_tipo: 'proprio', saldo_retido: 'não',
    aceita_honorarios: 'sim',
  },
  pendingItems: [] as string[],
};

test('campanha de conta obedece documentos → KIT → assinatura → transferência', () => {
  const docs = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'none', kit: 'none' });
  assert.deepEqual(docs.map(item => item.action), ['solicitar_documentos']);
  assert.equal(docs[0].args.titulo, 'Documentos essenciais — conta bloqueada ou encerrada');
  assert.deepEqual(docs[0].args.documentos, [
    'Documento de identificação com foto do cliente',
    'Print, e-mail ou tela mostrando o bloqueio ou encerramento da conta',
    'Comprovante de residência em nome próprio ou de esposa, esposo, pai ou mãe',
  ]);

  assert.deepEqual(buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'pending', kit: 'none' }), []);

  const kit = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'complete', kit: 'none' });
  assert.deepEqual(kit.map(item => item.action), ['enviar_documento']);
  assert.equal(kit[0].ref?.target_id, 'kit-1');
  assert.match(String(kit[0].args.mensagem), /campo Réu/);
  assert.match(String(kit[0].args.mensagem), /nome do banco/);

  assert.deepEqual(buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'complete', kit: 'pending' }), []);

  const signed = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'complete', kit: 'signed' });
  assert.deepEqual(signed.map(item => item.action), ['transferir_atendimento']);
  assert.equal(signed[0].ref?.target_id, 'setor-1');
});

test('rota de aluguel pede contrato; rota de terceiro pede documento do declarante e operador', () => {
  const rental = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, {
    ...accountMemory, knownFacts: { ...accountMemory.knownFacts, residencia_tipo: 'aluguel_com_contrato' },
  }, { documents: 'none', kit: 'none' });
  assert.ok((rental[0].args.documentos as string[]).includes('Contrato de aluguel'));

  const thirdMemory = {
    ...accountMemory,
    knownFacts: { ...accountMemory.knownFacts, residencia_tipo: 'terceiro_sem_contrato' },
  };
  const thirdDocs = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, thirdMemory,
    { documents: 'none', kit: 'none' });
  assert.ok((thirdDocs[0].args.documentos as string[])
    .includes('Documento de identificação com foto do declarante'));
  const handoff = buildWaAiCompletionPlans(accountAssistant, accountPlaybook, thirdMemory,
    { documents: 'complete', kit: 'none' });
  assert.deepEqual(handoff.map(item => item.action), ['transferir_atendimento']);
  assert.match(String(handoff[0].args.motivo), /declaração de residência/);
});

test('KIT recusado nunca é tratado como assinado nem causa transferência', () => {
  assert.deepEqual(buildWaAiCompletionPlans(accountAssistant, accountPlaybook, accountMemory,
    { documents: 'complete', kit: 'refused' }), []);
});
