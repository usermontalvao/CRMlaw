// "Este canal pode falar com o cliente AGORA?" — para as cobranças automáticas.
//
// As três varreduras de cobrança (documentos, assinatura, preenchimento) tinham
// o expediente cravado no código: `BIZ_START = 8`, `BIZ_END = 18` e
// `America/Cuiaba`, iguais nos três arquivos. Duas consequências:
//   • o canal de plantão 24h — que existe, e cuja agenda cheia está cadastrada —
//     ficava mudo das 18h às 8h por uma constante, não por uma decisão;
//   • qualquer mudança de expediente no painel não valia aqui, e ninguém tinha
//     como descobrir isso a não ser reparando que a cobrança não saiu.
// O expediente já está no banco, por canal, e é o mesmo que a inbox, o aviso de
// ausência e o encerramento automático leem. Este módulo o traz para cá.
//
// O FALLBACK É PROPOSITALMENTE CONSERVADOR, e diferente do relógio de SLA.
// Medir tempo sem saber o expediente pede relógio de parede (senão o contador
// congela); FALAR com o cliente sem saber o expediente pede o horário do
// escritório, porque o erro do outro lado é uma cobrança às 3h da manhã.
import { isWithinBusinessHours, localTimeInTz, type WaBusinessHourRow } from './wa-business-hours.ts';

export const FUSO_PADRAO_ESCRITORIO = 'America/Cuiaba';

/** Seg–sex, 08h–18h: o mesmo que as três varreduras traziam escrito no código. */
export const EXPEDIENTE_PADRAO_ESCRITORIO: WaBusinessHourRow[] = [1, 2, 3, 4, 5].map(day_of_week => ({
  day_of_week, start_time: '08:00', end_time: '18:00', is_active: true,
}));

interface Expediente { tz: string; rows: WaBusinessHourRow[] }

async function carregar(admin: any, instanceId: string | null | undefined): Promise<Expediente> {
  if (!instanceId) return { tz: FUSO_PADRAO_ESCRITORIO, rows: EXPEDIENTE_PADRAO_ESCRITORIO };
  const { data: canal } = await admin.from('whatsapp_instances')
    .select('timezone').eq('id', instanceId).maybeSingle();
  const { data: linhas } = await admin.from('whatsapp_business_hours')
    .select('day_of_week, start_time, end_time, is_active').eq('instance_id', instanceId);
  const rows = (linhas || []) as WaBusinessHourRow[];
  return {
    tz: String(canal?.timezone || '').trim() || FUSO_PADRAO_ESCRITORIO,
    // Canal sem agenda cadastrada: horário do escritório, não "sempre aberto".
    // `isWithinBusinessHours` devolve true para lista vazia, o que é o certo
    // para a pergunta "o escritório está fechado?" e o errado para "posso
    // mandar uma cobrança?".
    rows: rows.length > 0 ? rows : EXPEDIENTE_PADRAO_ESCRITORIO,
  };
}

/**
 * Portão de expediente com cache por canal.
 *
 * Uma varredura de cobrança percorre dezenas de solicitações que caem em dois ou
 * três canais; sem o cache, seriam duas consultas por linha para responder
 * sempre a mesma coisa.
 */
export function criarPortaoDeExpediente(admin: any) {
  const cache = new Map<string, Expediente>();
  return async function canalPodeFalarAgora(
    instanceId: string | null | undefined,
    agora: Date = new Date(),
  ): Promise<boolean> {
    const chave = instanceId || '';
    let cfg = cache.get(chave);
    if (!cfg) {
      cfg = await carregar(admin, instanceId);
      cache.set(chave, cfg);
    }
    return isWithinBusinessHours(cfg.rows, localTimeInTz(cfg.tz, agora));
  };
}
