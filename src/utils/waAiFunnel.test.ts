import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pickWaAiFunnelStage,
  shouldMoveWaAiFunnel,
  waAiFunnelLabelFor,
  type WaAiFunnelStage,
} from './waAiFunnel.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiFunnel.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-funnel.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-funnel.ts divergiu — copie o arquivo inteiro');
});

// Os dois funis REAIS de produção, com as chaves como estão hoje.
const COMERCIAL: WaAiFunnelStage[] = [
  { stageKey: 'novo', label: 'Novo', labels: ['Novo'], position: 0, isActive: true },
  { stageKey: 'qualificando', label: 'Qualificando', labels: ['Qualificando'], position: 1, isActive: true },
  { stageKey: 'qualificado', label: 'Qualificado', labels: ['Qualificado'], position: 2, isActive: true },
  { stageKey: 'aguardando_documentos', label: 'Aguardando Documentos', labels: ['Aguardando Documentos'], position: 3, isActive: true },
  { stageKey: 'nao_qualificado', label: 'Não Qualificado', labels: ['Não Qualificado'], position: 4, isActive: true },
];
const PEDRO: WaAiFunnelStage[] = [
  { stageKey: 'novo', label: 'Novo', labels: ['Novo'], position: 0, isActive: true },
  { stageKey: 'nao_qualificado', label: 'Em atendimento', labels: ['Atendimento'], position: 1, isActive: true },
  { stageKey: 'nova_etapa_3', label: 'Aguardando documentos', labels: ['Aguardando docs'], position: 2, isActive: true },
  { stageKey: 'nova_etapa_4', label: 'Finalizado', labels: ['Finalizado'], position: 3, isActive: true },
];

test('casa por rótulo, e por isso funciona nos dois canais apesar das chaves', () => {
  // "Comercial" tem chave legível; "Pedro" tem nova_etapa_3. O rótulo é o que vale.
  assert.equal(pickWaAiFunnelStage('documentos_solicitados', COMERCIAL)?.stageKey, 'aguardando_documentos');
  assert.equal(pickWaAiFunnelStage('documentos_solicitados', PEDRO)?.stageKey, 'nova_etapa_3');
  assert.equal(waAiFunnelLabelFor(pickWaAiFunnelStage('documentos_solicitados', PEDRO)!), 'Aguardando docs');
});

test('degrau sem etapa correspondente não move nada', () => {
  // Nenhum dos dois funis tem etapa de "aguardando assinatura".
  assert.equal(pickWaAiFunnelStage('kit_enviado', COMERCIAL), null);
  assert.equal(pickWaAiFunnelStage('kit_enviado', PEDRO), null);
  assert.equal(
    shouldMoveWaAiFunnel({ milestone: 'kit_enviado', target: null, stages: COMERCIAL, currentLabels: ['Novo'] }),
    false,
  );
});

test('nunca anda para trás', () => {
  const alvo = pickWaAiFunnelStage('documentos_solicitados', PEDRO)!;   // posição 2
  assert.equal(
    shouldMoveWaAiFunnel({ milestone: 'documentos_solicitados', target: alvo, stages: PEDRO, currentLabels: ['Finalizado'] }),
    false,
    'conversa em Finalizado (3) não pode voltar para Aguardando docs (2)',
  );
  assert.equal(
    shouldMoveWaAiFunnel({ milestone: 'documentos_solicitados', target: alvo, stages: PEDRO, currentLabels: ['Novo'] }),
    true,
  );
});

test('não repete a etapa em que já está', () => {
  const alvo = pickWaAiFunnelStage('documentos_solicitados', COMERCIAL)!;
  assert.equal(
    shouldMoveWaAiFunnel({ milestone: 'documentos_solicitados', target: alvo, stages: COMERCIAL, currentLabels: ['Aguardando Documentos'] }),
    false,
  );
});

test('conversa com dono humano não é movida — exceto pela própria transferência', () => {
  const docs = pickWaAiFunnelStage('documentos_solicitados', COMERCIAL)!;
  assert.equal(
    shouldMoveWaAiFunnel({ milestone: 'documentos_solicitados', target: docs, stages: COMERCIAL, currentLabels: ['Novo'], hasHumanOwner: true }),
    false,
  );
  const atendimento = pickWaAiFunnelStage('transferido', PEDRO)!;
  assert.equal(
    shouldMoveWaAiFunnel({ milestone: 'transferido', target: atendimento, stages: PEDRO, currentLabels: ['Novo'], hasHumanOwner: true }),
    true,
    'a transferência é quem PÕE o dono; ela mesma precisa poder mover',
  );
});

test('etiqueta posta à mão, que não é etapa nenhuma, não trava a escada', () => {
  const alvo = pickWaAiFunnelStage('documentos_solicitados', COMERCIAL)!;
  assert.equal(
    shouldMoveWaAiFunnel({ milestone: 'documentos_solicitados', target: alvo, stages: COMERCIAL, currentLabels: ['Urgente'] }),
    true,
  );
});

test('etapa inativa é ignorada na escolha', () => {
  const semDocs = COMERCIAL.map(s => s.stageKey === 'aguardando_documentos' ? { ...s, isActive: false } : s);
  assert.equal(pickWaAiFunnelStage('documentos_solicitados', semDocs), null);
});

test('o corte da triagem acha "Não Qualificado" onde ele existe', () => {
  assert.equal(pickWaAiFunnelStage('desqualificado', COMERCIAL)?.stageKey, 'nao_qualificado');
  assert.equal(pickWaAiFunnelStage('desqualificado', PEDRO), null);
  // Cuidado: no canal "Pedro" a chave nao_qualificado tem RÓTULO "Em atendimento".
  // É o rótulo que manda, e por isso ela não é escolhida para desqualificação.
  assert.equal(pickWaAiFunnelStage('transferido', PEDRO)?.label, 'Em atendimento');
});
