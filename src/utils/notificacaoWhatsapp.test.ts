import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NOTIF_WA_EVENTOS,
  canalDaNotificacao,
  dentroDoHorarioDeAviso,
  eventoWhatsApp,
  montarMensagemNotificacao,
  normalizarConfigWhatsApp,
  primeiroNome,
  templateDaNotificacao,
} from './notificacaoWhatsapp.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./notificacaoWhatsapp.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/notificacao-whatsapp.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'notificacao-whatsapp.ts divergiu — copie o arquivo inteiro');
});

// ── A trava que impede o primeiro deploy de acordar o escritório ────────────

test('config ausente nasce desligada e sem canal', () => {
  const c = normalizarConfigWhatsApp(undefined);
  assert.equal(c.enabled, false);
  assert.equal(c.default_channel_id, null);
});

test('só um `true` explícito liga — string "true" não conta', () => {
  assert.equal(normalizarConfigWhatsApp({ enabled: 'true' }).enabled, false);
  assert.equal(normalizarConfigWhatsApp({ enabled: 1 }).enabled, false);
  assert.equal(normalizarConfigWhatsApp({ enabled: true }).enabled, true);
});

test('config corrompida não derruba: vira o padrão', () => {
  for (const lixo of [null, 'x', 42, [], { eventos: 'nao-e-objeto' }]) {
    const c = normalizarConfigWhatsApp(lixo);
    assert.equal(c.enabled, false);
    assert.equal(typeof c.eventos, 'object');
  }
});

// ── Canal: exceção do evento ganha do padrão ───────────────────────────────

test('sem padrão e sem exceção, o canal é null — quem chama não inventa', () => {
  const c = normalizarConfigWhatsApp({ enabled: true });
  assert.equal(canalDaNotificacao(c, 'deadline_due'), null);
});

test('o padrão do escritório vale para quem não escolheu', () => {
  const c = normalizarConfigWhatsApp({ enabled: true, default_channel_id: 'canal-geral' });
  assert.equal(canalDaNotificacao(c, 'deadline_due'), 'canal-geral');
});

test('a exceção do evento ganha do padrão', () => {
  const c = normalizarConfigWhatsApp({
    enabled: true,
    default_channel_id: 'canal-geral',
    eventos: { deadline_due: { channel_id: 'canal-interno' } },
  });
  assert.equal(canalDaNotificacao(c, 'deadline_due'), 'canal-interno');
  assert.equal(canalDaNotificacao(c, 'deadline_overdue'), 'canal-geral');
});

test('exceção em branco não é exceção — cai no padrão', () => {
  const c = normalizarConfigWhatsApp({
    enabled: true,
    default_channel_id: 'canal-geral',
    eventos: { deadline_due: { channel_id: '   ' } },
  });
  assert.equal(canalDaNotificacao(c, 'deadline_due'), 'canal-geral');
});

// ── Modelo ─────────────────────────────────────────────────────────────────

test('modelo em branco não substitui o de fábrica', () => {
  const c = normalizarConfigWhatsApp({ eventos: { deadline_due: { template: '   ' } } });
  assert.equal(templateDaNotificacao(c, 'deadline_due'), eventoWhatsApp('deadline_due')!.padrao);
});

test('o modelo do escritório ganha do de fábrica', () => {
  const c = normalizarConfigWhatsApp({ eventos: { deadline_due: { template: 'Oi {primeiro_nome}' } } });
  assert.equal(templateDaNotificacao(c, 'deadline_due'), 'Oi {primeiro_nome}');
});

test('gatilho que não aceita WhatsApp devolve modelo vazio', () => {
  const c = normalizarConfigWhatsApp({});
  assert.equal(templateDaNotificacao(c, 'new_lead'), '');
  assert.equal(eventoWhatsApp('new_lead'), null);
});

test('a perícia não tem modelo aqui — o editor dela é outro', () => {
  const ev = eventoWhatsApp('pericia_reminder')!;
  assert.equal(ev.padrao, null);
  assert.ok(ev.textoEm);
  // E nem salvando um texto ele passa a valer: dois textos não cabem num campo.
  const c = normalizarConfigWhatsApp({ eventos: { pericia_reminder: { template: 'texto único' } } });
  assert.equal(c.eventos.pericia_reminder.template, null);
});

// ── A linha entra inteira ou não entra ─────────────────────────────────────

const DADOS = {
  primeiro_nome: 'Pedro',
  titulo: 'Contestação',
  vencimento: '02/09/2026',
  quando: 'em 3 dias',
  cliente: 'Maria Souza',
  processo: '1002-33.2026.8.11.0041',
  prioridade: 'Alta',
};

test('prazo sem processo não vira "Processo: —"', () => {
  const texto = montarMensagemNotificacao(
    templateDaNotificacao(normalizarConfigWhatsApp({}), 'deadline_due'),
    { ...DADOS, processo: '' },
  );
  assert.ok(!texto.includes('Processo'));
  assert.ok(texto.includes('Maria Souza'));
  assert.ok(texto.includes('Contestação'));
});

test('a linha com campo vazio some INTEIRA, rótulo junto', () => {
  // Era aqui que a versão "esperta" deixava "👤 Cliente:" órfão no telefone.
  assert.equal(montarMensagemNotificacao('A\n👤 Cliente: {cliente}\nB', { cliente: '' }), 'A\nB');
  assert.equal(montarMensagemNotificacao('A\n⚖️ {processo}\nB', { processo: '' }), 'A\nB');
  assert.equal(montarMensagemNotificacao('A\n{processo}\nB', { processo: '' }), 'A\nB');
});

test('a regra é a mesma da perícia: nome em branco leva a saudação junto', () => {
  const texto = montarMensagemNotificacao('Olá, *{primeiro_nome}*!\nLembrete de prazo.', { primeiro_nome: '' });
  assert.equal(texto, 'Lembrete de prazo.');
});

test('campo preenchido mantém a linha', () => {
  assert.equal(montarMensagemNotificacao('⚖️ {processo}', { processo: '123' }), '⚖️ 123');
});

test('não sobram três quebras seguidas nem espaço no fim da linha', () => {
  const texto = montarMensagemNotificacao('A\n\n👤 Cliente: {cliente}\n\n\nB ', { cliente: '' });
  assert.ok(!texto.includes('\n\n\n'));
  assert.ok(!/ \n/.test(texto));
  assert.equal(texto, 'A\n\nB');
});

test('todos os campos declarados existem no modelo de fábrica', () => {
  for (const ev of NOTIF_WA_EVENTOS) {
    if (!ev.padrao) continue;
    for (const campo of ev.campos) {
      // `{responsavel}` é alternativa a `{primeiro_nome}`: basta um dos dois.
      if (campo === '{responsavel}') continue;
      assert.ok(ev.padrao.includes(campo), `${ev.key} não usa ${campo}`);
    }
  }
});

test('nenhum modelo de fábrica deixa campo desconhecido pelo scheduler', () => {
  for (const ev of NOTIF_WA_EVENTOS) {
    if (!ev.padrao) continue;
    const usados = ev.padrao.match(/{[a-z_]+}/g) ?? [];
    for (const campo of usados) {
      assert.ok(ev.campos.includes(campo), `${ev.key} usa ${campo}, que não está na ajuda`);
    }
  }
});

// ── Primeiro nome ──────────────────────────────────────────────────────────

test('primeiro nome não inventa tratamento quando não há nome', () => {
  assert.equal(primeiroNome('Pedro Rodrigues Montalvão'), 'Pedro');
  assert.equal(primeiroNome('  Ana  '), 'Ana');
  assert.equal(primeiroNome(''), '');
  assert.equal(primeiroNome(null), '');
  assert.equal(primeiroNome(undefined), '');
});

// ── O piso de horário ──────────────────────────────────────────────────────

/** Instante em Brasília (UTC-3), montado a partir do UTC correspondente. */
const emBrasilia = (iso: string) => new Date(iso);

test('madrugada não manda WhatsApp, mesmo com o cron rodando', () => {
  // 03:00 em Brasília = 06:00 UTC, numa terça-feira.
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-01T06:00:00Z')), false);
});

test('08:00 em Brasília já vale; 07:59 ainda não', () => {
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-01T11:00:00Z')), true);
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-01T10:59:00Z')), false);
});

test('18:00 em Brasília já é tarde demais', () => {
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-01T20:59:00Z')), true);
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-01T21:00:00Z')), false);
});

test('sábado e domingo não recebem aviso de prazo', () => {
  // 05/09/2026 é sábado; 06/09/2026 é domingo. Meio-dia de Brasília nos dois.
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-05T15:00:00Z')), false);
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-06T15:00:00Z')), false);
});

test('a virada de dia pelo fuso não conta domingo como segunda', () => {
  // Segunda 07/09, 00:30 UTC = domingo 06/09, 21:30 em Brasília.
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-07T00:30:00Z')), false);
});

// ── As duas pontas do gatilho ──────────────────────────────────────────────

/**
 * Um evento aqui com chave que não existe em `NOTIFICATION_TRIGGERS` seria
 * invisível do pior jeito: a coluna WhatsApp apareceria acesa na tela de
 * Configurações, o escritório marcaria o evento, e o scheduler nunca chamaria
 * aquele gatilho — sem erro, sem log, sem aviso.
 *
 * O catálogo mora em `settings.service.ts`, que importa o cliente do Supabase e
 * por isso não carrega no `node --test`. Lê-lo como TEXTO é feio e resolve: o
 * que importa é a chave existir dos dois lados.
 */
test('todo evento de WhatsApp existe no catálogo de gatilhos', () => {
  const catalogo = readFileSync(
    new URL('../services/settings.service.ts', import.meta.url), 'utf8');
  for (const ev of NOTIF_WA_EVENTOS) {
    assert.ok(
      catalogo.includes(`key: '${ev.key}'`),
      `${ev.key} não está em NOTIFICATION_TRIGGERS — a tela mostraria um evento que nunca dispara`,
    );
  }
});

/** E o scheduler precisa saber despachar cada um deles. */
test('todo evento de WhatsApp é despachado pelo notification-scheduler', () => {
  const scheduler = readFileSync(
    new URL('../../supabase/functions/notification-scheduler/index.ts', import.meta.url), 'utf8');
  for (const ev of NOTIF_WA_EVENTOS) {
    // A perícia não passa pelo scheduler: ela é agendada na fila do WhatsApp,
    // no momento em que a perícia é marcada. Só o canal dela vem da central.
    if (ev.key === 'pericia_reminder') continue;
    assert.ok(
      scheduler.includes(`trigger: "${ev.key}"`),
      `${ev.key} não tem envio por WhatsApp no scheduler`,
    );
  }
});
