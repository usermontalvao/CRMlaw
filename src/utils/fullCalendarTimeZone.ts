/**
 * Plugin de fuso nomeado para o FullCalendar, feito com `Intl`.
 *
 * Sem um plugin de fuso, a v6 aceita apenas `"local"` e `"UTC"`: passar
 * `timeZone="America/Cuiaba"` faz a grade cair silenciosamente em UTC — uma
 * audiência das 14:00 em Cuiabá aparece às 18:00. Os plugins oficiais
 * (`@fullcalendar/luxon3`, `@fullcalendar/moment-timezone`) resolvem isso
 * arrastando junto a biblioteca de datas inteira; aqui o `Intl` do próprio
 * navegador já tem o banco de fusos, e o contrato do FullCalendar são só dois
 * métodos.
 */
import { createPlugin } from '@fullcalendar/core';
import { NamedTimeZoneImpl } from '@fullcalendar/core/internal';

import { getPartsInTimeZone } from './officeTime';

/** Offset do fuso, em minutos, vigente no instante informado. */
const offsetMinutesAt = (utcMillis: number, timeZone: string): number => {
  const p = getPartsInTimeZone(new Date(utcMillis), timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - utcMillis) / 60000);
};

class IntlNamedTimeZone extends NamedTimeZoneImpl {
  /**
   * Recebe uma HORA DE PAREDE como `[ano, mês(0-based), dia, h, min, s, ms]` e
   * devolve o offset em minutos. A segunda passada corrige o palpite inicial
   * nas viradas de horário de verão (irrelevante em Cuiabá, que é -04:00 fixo
   * desde 2019, mas necessário se o fuso-âncora mudar).
   */
  offsetForArray(a: number[]): number {
    const asIfUtc = Date.UTC(a[0], a[1] || 0, a[2] || 1, a[3] || 0, a[4] || 0, a[5] || 0, a[6] || 0);
    const firstGuess = offsetMinutesAt(asIfUtc, this.timeZoneName);
    return offsetMinutesAt(asIfUtc - firstGuess * 60000, this.timeZoneName);
  }

  /** Instante UTC → hora de parede no fuso, no formato de array do FullCalendar. */
  timestampToArray(ms: number): number[] {
    const p = getPartsInTimeZone(new Date(ms), this.timeZoneName);
    return [
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
      ((ms % 1000) + 1000) % 1000,
    ];
  }
}

// O nome do campo tem um "d" a mais — é assim mesmo na API do FullCalendar.
export const intlTimeZonePlugin = createPlugin({
  name: 'intl-named-time-zone',
  namedTimeZonedImpl: IntlNamedTimeZone,
});
