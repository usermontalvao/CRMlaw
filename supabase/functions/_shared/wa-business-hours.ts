// "O canal está aberto agora?" — a pergunta que a varredura de encerramento faz
// antes de mandar a despedida.
//
// A conta é a mesma que o `evolution-webhook` já faz para o aviso de ausência,
// só que aqui ela mora num módulo puro para poder ser testada: a versão do
// webhook é uma função privada dentro de um arquivo de 984 linhas e não tem
// como ser exercitada sem subir a função inteira.
//
// A leitura do relógio (`Intl`) fica separada da REGRA de propósito — quem
// decide recebe dia e minuto já prontos, então o teste não depende de que horas
// são quando ele roda.

/** Uma linha de `whatsapp_business_hours`. */
export interface WaBusinessHourRow {
  day_of_week: number;      // 0=Dom … 6=Sáb
  start_time: string;       // 'HH:MM' ou 'HH:MM:SS'
  end_time: string;
  is_active: boolean;
}

/** {dow, curMins} no timezone IANA informado. Cai para UTC se o fuso for inválido. */
export function localTimeInTz(timezone: string, now: Date = new Date()): { dow: number; curMins: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
    const hour = +(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
    const minute = +(parts.find(p => p.type === 'minute')?.value ?? '0');
    return { dow: dayMap[weekday] ?? 0, curMins: hour * 60 + minute };
  } catch {
    return { dow: now.getUTCDay(), curMins: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

/**
 * 'HH:MM[:SS]' → minutos desde a meia-noite. Devolve null no que não for hora.
 *
 * 24:00 (= 1440) é hora VÁLIDA aqui: é assim que o canal de plantão diz "vou até
 * o fim do dia" sem deixar o minuto das 23:59 de fora, e o `TIME` do Postgres a
 * guarda tal e qual. Enquanto ela era recusada, a linha inteira caía do filtro
 * abaixo e o canal 24h passava a ser lido como "canal sem agenda" — que dá
 * aberto pelo motivo errado, e desmoronaria no primeiro dia com jornada mista.
 */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/**
 * O canal está dentro do expediente neste instante?
 *
 * Canal SEM agenda cadastrada é considerado ABERTO. É a escolha conservadora
 * para quem usa isto: sem linha nenhuma, "fechado" significaria uma varredura
 * que nunca encerra nada e ninguém entenderia por quê — o silêncio pareceria
 * defeito. Um dia marcado como inativo, esse sim, é fechado.
 */
export function isWithinBusinessHours(
  rows: readonly WaBusinessHourRow[] | null | undefined,
  at: { dow: number; curMins: number },
): boolean {
  const agenda = (rows || []).filter(r => toMinutes(r.start_time) !== null && toMinutes(r.end_time) !== null);
  if (agenda.length === 0) return true;

  const hoje = agenda.find(r => r.day_of_week === at.dow);
  if (!hoje || !hoje.is_active) return false;

  const inicio = toMinutes(hoje.start_time)!;
  const fim = toMinutes(hoje.end_time)!;
  // Janela invertida (ex.: 22:00 às 02:00) atravessa a meia-noite.
  if (fim <= inicio) return at.curMins >= inicio || at.curMins < fim;
  return at.curMins >= inicio && at.curMins < fim;
}
