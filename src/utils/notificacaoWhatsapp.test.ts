import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NOTIF_WA_EVENTOS,
  canalDaNotificacao,
  dentroDoHorarioDeAviso,
  eventoWhatsApp,
  montarMensagemNotificacao,
  linkCobrancaWhatsApp,
  normalizarConfigWhatsApp,
  primeiroNome,
  telefoneInternacional,
  telefoneLegivel,
  templateDaNotificacao,
  deveLembrarDoPrazo,
  deveCobrarPrazoVencido,
  DIAS_DE_COBRANCA_DO_VENCIDO,
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

test('sábado e domingo RECEBEM aviso de prazo, dentro do horário', () => {
  // 05/09/2026 é sábado; 06/09/2026 é domingo. Meio-dia de Brasília nos dois.
  //
  // Até 29/08/2026 esta trava barrava o fim de semana, e o resultado era um
  // aviso de PRAZO VENCIDO que saía por push e por e-mail no sábado e era
  // engolido justamente no canal que a pessoa olha fora do expediente. Prazo
  // não espera segunda-feira — decisão do escritório.
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-05T15:00:00Z')), true);
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-06T15:00:00Z')), true);
});

test('o piso de horário vale igual no fim de semana', () => {
  // A madrugada continua barrada: a razão do piso é não acordar ninguém às 3h,
  // e isso não muda por ser domingo. Sábado 05/09, 04:00 de Brasília.
  assert.equal(dentroDoHorarioDeAviso(emBrasilia('2026-09-05T07:00:00Z')), false);
  // Segunda 07/09, 00:30 UTC = domingo 06/09, 21:30 em Brasília: tarde demais.
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

// ── O telefone do responsável, no aviso à administração ────────────────────

test('telefone brasileiro sem país ganha o 55', () => {
  assert.equal(telefoneInternacional('65999998888'), '5565999998888');
  assert.equal(telefoneInternacional('(65) 99999-8888'), '5565999998888');
  // Fixo de 10 dígitos também é telefone.
  assert.equal(telefoneInternacional('6533334444'), '556533334444');
});

test('telefone que já veio completo não ganha 55 duas vezes', () => {
  assert.equal(telefoneInternacional('5565999998888'), '5565999998888');
  assert.equal(telefoneInternacional('+55 65 99999-8888'), '5565999998888');
});

test('o que não dá para reconhecer vira vazio, nunca um palpite', () => {
  // Link errado abre conversa com OUTRA pessoa, e sem dar erro. Vazio some.
  for (const lixo of ['', '999', '12345678901234', '4499999888', null, undefined]) {
    if (lixo === '4499999888') continue; // 10 dígitos é válido; conferido acima
    assert.equal(telefoneInternacional(lixo as any), '', `${lixo} não deveria virar telefone`);
  }
});

test('telefone legível não mostra o 55 ao humano', () => {
  assert.equal(telefoneLegivel('5565999998888'), '(65) 99999-8888');
  assert.equal(telefoneLegivel('65999998888'), '(65) 99999-8888');
  assert.equal(telefoneLegivel('556533334444'), '(65) 3333-4444');
});

test('o link do wa.me já leva a cobrança escrita', () => {
  const link = linkCobrancaWhatsApp('65999998888', 'Prazo "Contestação" venceu. Pode dar retorno?');
  assert.ok(link.startsWith('https://wa.me/5565999998888?text='));
  // Aspas e acentos precisam sobreviver à URL, senão o WhatsApp corta o texto.
  assert.ok(link.includes(encodeURIComponent('Contestação')));
  assert.ok(!link.includes(' '));
});

test('sem telefone reconhecível não há link — e a linha some', () => {
  assert.equal(linkCobrancaWhatsApp('', 'oi'), '');
  assert.equal(linkCobrancaWhatsApp(null, 'oi'), '');
  const texto = montarMensagemNotificacao(
    templateDaNotificacao(normalizarConfigWhatsApp({}), 'deadline_overdue_admin'),
    { primeiro_nome: 'Ana', responsavel: 'Pedro', telefone_responsavel: '', link_cobranca: '',
      titulo: 'Contestação', vencimento: '27/08/2026', quando: 'ontem', cliente: 'Maria', processo: '' },
  );
  assert.ok(!texto.includes('Falar agora'));
  assert.ok(!texto.includes('📞'));
  // O essencial continua: qual prazo, de quem é, e quando venceu.
  assert.ok(texto.includes('Contestação'));
  assert.ok(texto.includes('Pedro'));
  assert.ok(texto.includes('ontem'));
});

test('o aviso à administração diz de quem é o prazo; o do responsável não precisa', () => {
  const padrao = normalizarConfigWhatsApp({});
  const doAdmin = templateDaNotificacao(padrao, 'deadline_overdue_admin');
  const doResponsavel = templateDaNotificacao(padrao, 'deadline_overdue');
  assert.ok(doAdmin.includes('{responsavel}'), 'o admin precisa saber de quem é o prazo');
  assert.ok(doAdmin.includes('{link_cobranca}'));
  assert.ok(!doResponsavel.includes('{link_cobranca}'), 'ninguém precisa de link para si mesmo');
});

// ── A cadência: o que fez 12 avisos virarem 2 ───────────────────────────────

test('o lembrete sai UMA vez, no dia exato — não todo dia até vencer', () => {
  // "Avisar 2 dias antes" é a configuração de todos os prazos do escritório
  // hoje. Antes, D−2, D−1 e D−0 disparavam; agora só D−2.
  assert.equal(deveLembrarDoPrazo(2, 2), true, 'D−2 é o dia pedido');
  assert.equal(deveLembrarDoPrazo(1, 2), false, 'D−1 já foi avisado ontem');
  assert.equal(deveLembrarDoPrazo(0, 2), false, 'no dia do vencimento não se repete');
  assert.equal(deveLembrarDoPrazo(3, 2), false, 'ainda cedo demais');
});

test('"avisar 0 dias antes" continua avisando no dia — e só nele', () => {
  assert.equal(deveLembrarDoPrazo(0, 0), true);
  assert.equal(deveLembrarDoPrazo(1, 0), false);
});

test('sem "quantos dias antes" não há dia certo, e nada sai', () => {
  assert.equal(deveLembrarDoPrazo(2, null), false);
  assert.equal(deveLembrarDoPrazo(2, undefined), false);
  assert.equal(deveLembrarDoPrazo(2, -1), false, 'negativo é configuração inválida');
  assert.equal(deveLembrarDoPrazo(2, Number.NaN), false);
});

test('prazo já vencido não entra pelo lembrete', () => {
  // Quem cobra vencido é deveCobrarPrazoVencido; os dois nunca falam juntos.
  assert.equal(deveLembrarDoPrazo(-1, 2), false);
});

test('o vencido cobra no dia e mais uma vez três dias depois — e para', () => {
  assert.equal(deveCobrarPrazoVencido(0), true, 'o dia do vencimento');
  assert.equal(deveCobrarPrazoVencido(1), false);
  assert.equal(deveCobrarPrazoVencido(2), false);
  assert.equal(deveCobrarPrazoVencido(3), true, 'a insistência única');
  // O 4º dia é o que separava o aviso útil da cobrança diária eterna: era aqui
  // que o prazo CONTRAMINUTA seguia gritando pela quarta vez.
  assert.equal(deveCobrarPrazoVencido(4), false);
  assert.equal(deveCobrarPrazoVencido(30), false);
});

test('prazo que ainda não venceu nunca é cobrado', () => {
  assert.equal(deveCobrarPrazoVencido(-1), false);
});

test('a cobrança do vencido soma dois dias, e ninguém mais', () => {
  // Trava contra alguém "só acrescentar mais um" sem discutir: a lista é a
  // decisão, e mudá-la tem de quebrar este teste.
  assert.deepEqual([...DIAS_DE_COBRANCA_DO_VENCIDO], [0, 3]);
});

test('a conta do prazo real: seis dias de disparo viram três', () => {
  // CONTRAMINUTA AO A.I, avisar 2 dias antes, venceu em 27/08. Os seis dias
  // medidos no banco, um por linha, com os dois canais que existiam então.
  const dias = [
    { faltam: 2,  vencido: -1 }, // 25/08
    { faltam: 1,  vencido: -1 }, // 26/08
    { faltam: -1, vencido: 0 },  // 27/08 — venceu
    { faltam: -1, vencido: 1 },  // 28/08
    { faltam: -1, vencido: 2 },  // 29/08
    { faltam: -1, vencido: 3 },  // 30/08
  ];
  const disparos = dias.filter(
    (d) => deveLembrarDoPrazo(d.faltam, 2) || deveCobrarPrazoVencido(d.vencido),
  );
  // 25/08 (lembrete), 27/08 (venceu) e 30/08 (a insistência).
  assert.equal(disparos.length, 3);
  // A janela medida SUBESTIMA o ganho: ela para no 3º dia de atraso, que é
  // justamente onde a regra nova cala. Um prazo esquecido por trinta dias
  // rendia sessenta avisos e passa a render os mesmos três disparos.
  const trintaDias = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(trintaDias.filter(deveCobrarPrazoVencido).length, 2);
});
