import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canOfferBirthdayInvite,
  canStartBirthdaySplash,
  getBirthdayOccurrence,
  formatDayAndMonth,
  getAge,
  getBirthdaySessionKey,
  getFirstName,
  getInitials,
  getLocalDateKey,
  isBirthdayReplayRequested,
  isBirthdayToday,
  parseIsoCalendarDate,
  validateBirthDate,
} from './birthday.ts';

test('interpreta datas ISO sem deslocamento de fuso horário', () => {
  assert.deepEqual(parseIsoCalendarDate('1992-07-30'), { year: 1992, month: 7, day: 30 });
  assert.equal(parseIsoCalendarDate('1992-02-30'), null);
  assert.equal(parseIsoCalendarDate('30/07/1992'), null);
});

test('valida datas ausentes, futuras e anteriores ao limite', () => {
  const today = new Date(2026, 6, 30, 10, 0, 0);
  assert.equal(validateBirthDate('', today), 'Informe sua data de nascimento para continuar.');
  assert.equal(validateBirthDate('2026-07-31', today), 'A data de nascimento não pode estar no futuro.');
  assert.equal(
    validateBirthDate('1899-12-31', today),
    'A data de nascimento deve ser posterior a 01/01/1900.',
  );
  assert.equal(validateBirthDate('1992-07-30', today), null);
});

test('aniversário compara somente dia e mês no calendário local', () => {
  const today = new Date(2026, 6, 30, 23, 55, 0);
  assert.equal(isBirthdayToday('1992-07-30', today), true);
  assert.equal(isBirthdayToday('1992-07-29', today), false);
  assert.equal(isBirthdayToday(null, today), false);
});

test('splash espera o cadastro do PIN e nunca aparece sobre o modal de segurança', () => {
  assert.equal(canStartBirthdaySplash({
    birthdayToday: true,
    pinSetupResolved: false,
    pinModalOpen: false,
  }), false);
  assert.equal(canStartBirthdaySplash({
    birthdayToday: true,
    pinSetupResolved: true,
    pinModalOpen: true,
  }), false);
  assert.equal(canStartBirthdaySplash({
    birthdayToday: true,
    pinSetupResolved: true,
    pinModalOpen: false,
  }), true);
});

test('a celebração é oferecida uma única vez por ano', () => {
  const occurrence = { daysSince: 0, occurrenceYear: 2026 };
  const base = { occurrence, pinSetupResolved: true, pinModalOpen: false, isActive: true };

  assert.equal(canOfferBirthdayInvite({ ...base, celebratedYear: null }), true);
  assert.equal(canOfferBirthdayInvite({ ...base, celebratedYear: 2025 }), true);
  // Já assistiu neste ano: não volta a aparecer, em nenhuma sessão.
  assert.equal(canOfferBirthdayInvite({ ...base, celebratedYear: 2026 }), false);
  // Fora da janela, nunca aparece.
  assert.equal(canOfferBirthdayInvite({ ...base, occurrence: null, celebratedYear: null }), false);
});

test('calcula a idade completa considerando o dia do aniversário', () => {
  assert.equal(getAge('1992-07-30', new Date(2026, 6, 30)), 34);
  assert.equal(getAge('1992-07-30', new Date(2026, 6, 29)), 33);
  assert.equal(getAge('1992-12-31', new Date(2026, 6, 30)), 33);
  assert.equal(getAge(null, new Date(2026, 6, 30)), null);
});

test('formata dia e mês por extenso para as legendas', () => {
  assert.equal(formatDayAndMonth('1992-07-30'), '30 de julho');
  assert.equal(formatDayAndMonth('1990-03-01'), '1 de março');
  assert.equal(formatDayAndMonth(''), '');
});

test('gera chave diária por usuário, primeiro nome e iniciais', () => {
  const today = new Date(2026, 6, 30);
  assert.equal(getLocalDateKey(today), '2026-07-30');
  assert.equal(
    getBirthdaySessionKey('user-1', today),
    'crm-birthday-celebrated:user-1:2026-07-30',
  );
  assert.equal(getFirstName('  Ana Beatriz Souza  '), 'Ana');
  assert.equal(getFirstName(''), 'você');
  assert.equal(getInitials('Ana Beatriz Souza'), 'AS');
  assert.equal(getInitials('Pedro'), 'PE');
  assert.equal(getInitials(''), '?');
});

test('reconhece o pedido de rever a celebração pela URL', () => {
  assert.equal(isBirthdayReplayRequested('?aniversariodenovo=1'), true);
  assert.equal(isBirthdayReplayRequested('?aniversariodenovo'), true);
  assert.equal(isBirthdayReplayRequested('?outracoisa=1'), false);
  assert.equal(isBirthdayReplayRequested(''), false);
});

test('colaborador desligado nunca é homenageado', () => {
  const base = {
    occurrence: { daysSince: 0, occurrenceYear: 2026 },
    pinSetupResolved: true,
    pinModalOpen: false,
    celebratedYear: null,
  };

  assert.equal(canOfferBirthdayInvite({ ...base, isActive: true }), true);
  assert.equal(canOfferBirthdayInvite({ ...base, isActive: false }), false);
});

test('nascidos em 29/02 são homenageados em 28/02 nos anos comuns', () => {
  // 2028 é bissexto: a data existe e vale o dia certo.
  assert.equal(isBirthdayToday('2000-02-29', new Date(2028, 1, 29)), true);
  assert.equal(isBirthdayToday('2000-02-29', new Date(2028, 1, 28)), false);

  // 2027 é comum: sem este caso a pessoa só seria lembrada de 4 em 4 anos.
  assert.equal(isBirthdayToday('2000-02-29', new Date(2027, 1, 28)), true);

  // 1900 não é bissexto (divisível por 100 e não por 400).
  assert.equal(isBirthdayToday('2000-02-29', new Date(1900, 1, 28)), true);

  // Quem nasceu em 28/02 não é afetado.
  assert.equal(isBirthdayToday('1990-02-28', new Date(2027, 1, 28)), true);
  assert.equal(isBirthdayToday('1990-02-28', new Date(2028, 1, 29)), false);
});

test('janela de recuperação alcança quem não logou no dia', () => {
  const aniversario = '1990-07-31';

  assert.deepEqual(getBirthdayOccurrence(aniversario, new Date(2026, 6, 31)), {
    daysSince: 0,
    occurrenceYear: 2026,
  });
  // Aniversário na sexta, primeiro login na segunda.
  assert.deepEqual(getBirthdayOccurrence(aniversario, new Date(2026, 7, 3)), {
    daysSince: 3,
    occurrenceYear: 2026,
  });
  // Sétimo dia ainda vale; o oitavo não.
  assert.equal(getBirthdayOccurrence(aniversario, new Date(2026, 7, 7))?.daysSince, 7);
  assert.equal(getBirthdayOccurrence(aniversario, new Date(2026, 7, 8)), null);
  // Antes do aniversário do ano, nada.
  assert.equal(getBirthdayOccurrence(aniversario, new Date(2026, 6, 30)), null);
});

test('recuperação na virada do ano credita o aniversário ao ano CERTO', () => {
  // Nasceu em 30/12; só entra no sistema em 03/01 do ano seguinte.
  const occurrence = getBirthdayOccurrence('1990-12-30', new Date(2027, 0, 3));
  assert.deepEqual(occurrence, { daysSince: 4, occurrenceYear: 2026 });

  // Gravar 2027 aqui bloquearia o aniversário de dezembro/2027. Com o ano
  // correto (2026), o de 2027 continua liberado.
  assert.equal(
    canOfferBirthdayInvite({
      occurrence,
      pinSetupResolved: true,
      pinModalOpen: false,
      isActive: true,
      celebratedYear: 2026,
    }),
    false,
  );
  assert.equal(
    canOfferBirthdayInvite({
      occurrence: getBirthdayOccurrence('1990-12-30', new Date(2027, 11, 30)),
      pinSetupResolved: true,
      pinModalOpen: false,
      isActive: true,
      celebratedYear: 2026,
    }),
    true,
  );
});

test('29/02 dentro da janela usa 28/02 como data efetiva no ano comum', () => {
  assert.deepEqual(getBirthdayOccurrence('2000-02-29', new Date(2027, 2, 2)), {
    daysSince: 2,
    occurrenceYear: 2027,
  });
});
