import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ESPERA_ENTRE_LEMBRETES_EM_HORAS,
  IDADE_MAXIMA_EM_DIAS,
  TOTAL_DE_LEMBRETES,
  comoDestravar,
  descreverParada,
  lerEstadoDaCobranca,
  type DadosDaCobranca,
} from './cobrancaDeAssinatura.ts';

const robo = () => readFileSync(
  new URL('../../supabase/functions/whatsapp-signature-followup/index.ts', import.meta.url), 'utf8');

// ── A cópia dupla ───────────────────────────────────────────────────────────
// A tela promete "próximo lembrete às 14h". Se a cadência daqui andar separada
// da cadência de lá, a tela promete uma hora e o robô manda em outra.

test('a cadência de lembretes é a mesma da Edge Function', () => {
  const achado = robo().match(/const STEP_DELAY_HOURS = \[([^\]]+)\]/);
  assert.ok(achado, 'STEP_DELAY_HOURS sumiu da Edge Function');
  const horas = achado[1].split(',').map((parte) => Function(`"use strict";return (${parte})`)());
  assert.deepEqual(horas, ESPERA_ENTRE_LEMBRETES_EM_HORAS,
    'a cadência divergiu — atualize ESPERA_ENTRE_LEMBRETES_EM_HORAS');
});

test('a janela de idade é a mesma da Edge Function', () => {
  const achado = robo().match(/const MAX_AGE_DAYS = (\d+)/);
  assert.ok(achado, 'MAX_AGE_DAYS sumiu da Edge Function');
  assert.equal(Number(achado[1]), IDADE_MAXIMA_EM_DIAS);
});

test('o robô manda tantos lembretes quantos a tela anuncia', () => {
  const copias = (robo().match(/^\s*\(n[^\n]*=>\s*`/gm) || []).length;
  assert.equal(copias, TOTAL_DE_LEMBRETES,
    'o número de textos de lembrete mudou — TOTAL_DE_LEMBRETES ficou para trás');
});

test('o lembrete enviado entra no histórico do documento', () => {
  const fonte = robo();
  assert.match(fonte, /signature_audit_log/,
    'o robô voltou a cobrar sem registrar nada — a linha do tempo do documento fica mentindo de novo');
  assert.match(fonte, /action: 'reminder_sent'/,
    "a auditoria do lembrete precisa usar a ação 'reminder_sent', que é a que o painel sabe desenhar");
});

// ── Os motivos ──────────────────────────────────────────────────────────────

const agora = new Date('2026-09-03T12:00:00Z');

const base = (extra: Partial<DadosDaCobranca> = {}): DadosDaCobranca => ({
  criadaEm: '2026-09-01T13:17:00Z',
  lembretesEnviados: 0,
  ultimoLembreteEm: null,
  ultimaPresencaEm: null,
  primeiraAberturaEm: null,
  temCliente: true,
  temConversaAberta: true,
  acompanhamentoEncerrado: false,
  bloqueada: false,
  ...extra,
});

test('sem cliente vinculado, o robô não tem por onde falar', () => {
  const estado = lerEstadoDaCobranca(base({ temCliente: false }), agora);
  assert.equal(estado.motivo, 'sem_cliente');
  assert.equal(estado.parada, true);
  assert.equal(estado.proximoLembreteEm, null);
});

test('conversa encerrada para a cobrança — foi o caso da única pendência viva', () => {
  const estado = lerEstadoDaCobranca(base({ temConversaAberta: false, lembretesEnviados: 2 }), agora);
  assert.equal(estado.motivo, 'sem_conversa');
  assert.equal(estado.parada, true);
  assert.equal(descreverParada(estado.motivo), 'conversa encerrada no WhatsApp');
  assert.match(comoDestravar(estado.motivo), /WhatsApp/);
});

test('não saber se há conversa não é o mesmo que não haver', () => {
  const estado = lerEstadoDaCobranca(base({ temConversaAberta: null }), agora);
  assert.equal(estado.motivo, 'ativa');
  assert.equal(estado.parada, false);
});

test('sem confirmar a conversa, a tela não promete hora nenhuma', () => {
  const estado = lerEstadoDaCobranca(base({ temConversaAberta: null, ultimaPresencaEm: '2026-09-03T10:51:00Z' }), agora);
  assert.equal(estado.confirmada, false);
  assert.equal(estado.proximoLembreteEm, null, 'prometer um lembrete que pode não sair é pior que não prometer');
});

test('com a conversa confirmada, a hora é dita', () => {
  const estado = lerEstadoDaCobranca(base({ temConversaAberta: true, ultimaPresencaEm: '2026-09-03T10:51:00Z' }), agora);
  assert.equal(estado.confirmada, true);
  assert.equal(estado.proximoLembreteEm, '2026-09-03T14:51:00.000Z');
});

test('passados 30 dias o robô desiste', () => {
  const estado = lerEstadoDaCobranca(base({ criadaEm: '2026-07-01T10:00:00Z' }), agora);
  assert.equal(estado.motivo, 'antiga');
});

test('depois do quinto lembrete a cobrança é manual', () => {
  const estado = lerEstadoDaCobranca(base({ lembretesEnviados: 5 }), agora);
  assert.equal(estado.motivo, 'limite');
  assert.equal(descreverParada(estado.motivo), 'os 5 lembretes já foram enviados');
});

test('o cliente que pediu para parar não é cobrado de novo', () => {
  assert.equal(lerEstadoDaCobranca(base({ acompanhamentoEncerrado: true }), agora).motivo, 'encerrada');
});

// ── A hora do próximo ───────────────────────────────────────────────────────

test('o primeiro lembrete conta 4 h depois que o cliente saiu da página', () => {
  const estado = lerEstadoDaCobranca(base({ ultimaPresencaEm: '2026-09-03T10:51:00Z' }), agora);
  assert.equal(estado.motivo, 'ativa');
  assert.equal(estado.proximoLembreteEm, '2026-09-03T14:51:00.000Z');
});

test('do segundo em diante, conta a partir do lembrete anterior', () => {
  const estado = lerEstadoDaCobranca(base({
    lembretesEnviados: 1,
    ultimoLembreteEm: '2026-09-02T18:00:00Z',
    ultimaPresencaEm: '2026-09-03T10:51:00Z',
  }), agora);
  assert.equal(estado.proximoLembreteEm, '2026-09-03T18:00:00.000Z');
});

test('quem nunca abriu tem a criação como âncora', () => {
  const estado = lerEstadoDaCobranca(base(), agora);
  assert.equal(estado.proximoLembreteEm, '2026-09-01T17:17:00.000Z');
});

test('uma parada não promete hora nenhuma', () => {
  for (const dados of [
    base({ temCliente: false }),
    base({ temConversaAberta: false }),
    base({ lembretesEnviados: 5 }),
    base({ bloqueada: true }),
  ]) {
    assert.equal(lerEstadoDaCobranca(dados, agora).proximoLembreteEm, null);
  }
});
