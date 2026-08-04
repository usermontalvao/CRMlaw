import test from 'node:test';
import assert from 'node:assert/strict';
import { isOnFunnelBoard, resolveStageTarget, normalizeStageKey } from './funnel.ts';

const CANAL = 'canal-pedro';

const conversa = (patch: Partial<Parameters<typeof isOnFunnelBoard>[0]> = {}) => ({
  instance_id: CANAL,
  status: 'open',
  is_blocked: false,
  last_message_at: '2026-08-04T09:41:00Z',
  ...patch,
});

// ── Quem entra no quadro ──────────────────────────────────────────────
test('conversa ativa do canal aparece no quadro', () => {
  assert.equal(isOnFunnelBoard(conversa(), CANAL), true);
});

test('conversa encerrada sai do quadro', () => {
  assert.equal(isOnFunnelBoard(conversa({ status: 'closed' }), CANAL), false);
});

test('contato bloqueado sai do quadro', () => {
  assert.equal(isOnFunnelBoard(conversa({ is_blocked: true }), CANAL), false);
});

test('rascunho sem nenhuma mensagem não polui o quadro', () => {
  assert.equal(isOnFunnelBoard(conversa({ last_message_at: null }), CANAL), false);
});

test('conversa de outro canal não aparece no funil selecionado', () => {
  assert.equal(isOnFunnelBoard(conversa({ instance_id: 'outro' }), CANAL), false);
});

test('sem canal escolhido o recorte por status continua valendo', () => {
  assert.equal(isOnFunnelBoard(conversa({ instance_id: 'outro' }), ''), true);
  assert.equal(isOnFunnelBoard(conversa({ instance_id: 'outro', status: 'closed' }), ''), false);
});

// ── Automação que pede uma etapa por chave canônica ───────────────────
const etiqueta = (stageKey: string, stageLabel: string, key: string) => ({
  key, stageKey, stageLabel, color: '#f59e0b', bg: '#f59e0b22',
});

test('etapa é encontrada pela chave quando o canal usa o funil-base', () => {
  const funil = [
    etiqueta('novo', 'Novo', 'Novo lead'),
    etiqueta('aguardando_documentos', 'Aguardando Documentos', 'Documentação pendente'),
  ];
  assert.equal(resolveStageTarget(funil, 'aguardando_documentos')?.key, 'Documentação pendente');
});

test('etapa criada à mão no canal é encontrada pelo nome', () => {
  const funil = [
    etiqueta('nova_etapa_1', 'Em atendimento', 'Em atendimento'),
    etiqueta('nova_etapa_2', 'Aguardando Documentos', 'Aguardando docs'),
  ];
  assert.equal(resolveStageTarget(funil, 'aguardando_documentos')?.key, 'Aguardando docs');
});

test('funil sem etapa equivalente vira no-op em vez de escolher outra etapa', () => {
  const funil = [etiqueta('novo', 'Novo', 'Novo lead')];
  assert.equal(resolveStageTarget(funil, 'aguardando_documentos'), null);
});

test('acento e caixa não atrapalham a comparação por nome', () => {
  assert.equal(normalizeStageKey('Não Qualificado'), 'nao_qualificado');
  assert.equal(normalizeStageKey('  Aguardando   Documentos '), 'aguardando_documentos');
});
