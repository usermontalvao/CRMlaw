/**
 * A data de hoje, escrita para dentro do prompt do agente.
 *
 * O modelo não sabe que dia é hoje. O treinamento dele terminou num ponto do
 * passado, e quando precisa de "hoje" ele chuta a época em que foi treinado —
 * sem avisar, e com toda a convicção. Numa triagem em que a lei conta prazo
 * ("saiu há mais de dois anos"), isso não é imprecisão: é a resposta errada.
 *
 * Por que aqui e não uma ferramenta: ferramenta depende de o modelo decidir
 * chamá-la, e este modelo já demonstrou não chamar. Data no prompt chega sempre,
 * custa nada e não tem como ser pulada.
 *
 * As datas de referência vêm prontas de propósito. Perguntar a um modelo pequeno
 * se abril/2024 é "mais de dois anos" antes de agosto/2026 é pedir uma conta que
 * ele erra; perguntar se abril/2024 vem antes de 12/08/2024 é uma comparação que
 * ele acerta. A conta é feita aqui, onde é determinística.
 *
 * Arquivo puro: sem imports, para poder rodar dentro da Edge Function e ser
 * testado sob node:test.
 */

export const WA_AI_OFFICE_TIME_ZONE = 'America/Cuiaba';

/** As janelas que a triagem costuma medir. Prescrição trabalhista usa 2 e 5. */
export const WA_AI_ANOS_DE_REFERENCIA = [1, 2, 5] as const;

type Ymd = { ano: number; mes: number; dia: number };

/** O dia no fuso do escritório, não no do servidor (que roda em UTC). */
function ymdNoFuso(instante: Date, timeZone: string): Ymd {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instante);
  const [ano, mes, dia] = partes.split('-').map(Number);
  return { ano, mes, dia };
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function formatarBR({ ano, mes, dia }: Ymd): string {
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
}

/** 29/02 menos um ano não existe: cai para o último dia do mês, não para 01/03. */
function anosAtras(base: Ymd, anos: number): Ymd {
  const ano = base.ano - anos;
  return { ano, mes: base.mes, dia: Math.min(base.dia, diasNoMes(ano, base.mes)) };
}

/**
 * O bloco de data que entra no prompt. Recebe o instante para poder ser testado
 * com uma data fixa, em vez de depender do relógio de quem roda o teste.
 */
export function waAiDateBlock(
  agora: Date = new Date(),
  timeZone: string = WA_AI_OFFICE_TIME_ZONE,
): string {
  const hoje = ymdNoFuso(agora, timeZone);
  const diaDaSemana = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long' }).format(agora);

  const referencias = WA_AI_ANOS_DE_REFERENCIA
    .map(anos => `- ${anos} ${anos === 1 ? 'ano' : 'anos'} atrás: ${formatarBR(anosAtras(hoje, anos))}`)
    .join('\n');

  return [
    '# Data de hoje',
    `Hoje é ${diaDaSemana}, ${formatarBR(hoje)}.`,
    'Esta é a data real, e ela vale acima de qualquer data que você suponha. Seu treinamento '
      + 'terminou antes de hoje, então o ano que você "lembra" como atual está errado. Sempre que '
      + 'precisar saber há quanto tempo algo aconteceu, conte a partir da data acima.',
    '',
    'Datas já calculadas, para você comparar em vez de fazer conta:',
    referencias,
    'Um acontecimento em data ANTERIOR a essas está a mais tempo do que a janela; em data igual ou '
      + 'posterior, está dentro dela. Quando o cliente informar só mês e ano, use o mês inteiro: '
      + 'considere fora da janela apenas se o mês inteiro já ficou para trás.',
  ].join('\n');
}

// ─── Idade das datas que o cliente informou ──────────────────────────────────

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const NOME_DOS_MESES = Object.keys(MESES).join('|');

/** Distância em meses cheios entre duas datas de calendário. */
function mesesEntre(de: Ymd, ate: Ymd): number {
  let meses = (ate.ano - de.ano) * 12 + (ate.mes - de.mes);
  if (ate.dia < de.dia) meses -= 1;
  return meses;
}

function porExtenso(meses: number): string {
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = anos > 0 ? `${anos} ${anos === 1 ? 'ano' : 'anos'}` : '';
  const parteMeses = resto > 0 ? `${resto} ${resto === 1 ? 'mês' : 'meses'}` : '';
  if (parteAnos && parteMeses) return `${parteAnos} e ${parteMeses}`;
  return parteAnos || parteMeses || 'menos de um mês';
}

/**
 * Escreve, ao lado de cada data que o cliente informou, há quanto tempo ela foi
 * e em quais janelas ela já não cabe.
 *
 * Existe porque prompt não segura conta. O agente tem um corte de dois anos, o
 * cliente disse "saí em janeiro de 2024", e o modelo seguiu a triagem como se
 * estivesse dentro do prazo — duas vezes, mesmo com a data de hoje no prompt.
 * A conta é determinística, então não há motivo para pedi-la a um modelo: aqui
 * ela é feita uma vez, e o que chega até ele é o veredito pronto.
 *
 * Dia ausente conta a favor do cliente: "janeiro de 2024" é lido como o último
 * dia de janeiro, para não descartar ninguém por causa de dias que ele não deu.
 */
export function waAiAnnotateDates(
  texto: string,
  agora: Date = new Date(),
  timeZone: string = WA_AI_OFFICE_TIME_ZONE,
): string {
  const hoje = ymdNoFuso(agora, timeZone);

  const anotar = (achado: Ymd): string => {
    const meses = mesesEntre(achado, hoje);
    if (meses < 0) return ' [data futura]';
    const janelas = WA_AI_ANOS_DE_REFERENCIA.filter(anos => meses >= anos * 12);
    const fora = janelas.length > 0
      ? ` — JÁ PASSOU das janelas de ${janelas.join(' e ')} ano${janelas.length > 1 || janelas[0] > 1 ? 's' : ''}`
      : '';
    return ` [há ${porExtenso(meses)}${fora}]`;
  };

  return String(texto ?? '')
    // dd/mm/aaaa
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b(?!\s*\[)/g, (m, d, mes, ano) => {
      const achado = { ano: +ano, mes: +mes, dia: +d };
      if (achado.mes < 1 || achado.mes > 12 || achado.dia < 1 || achado.dia > 31) return m;
      return m + anotar(achado);
    })
    // mm/aaaa
    .replace(/\b(\d{1,2})\/(\d{4})\b(?!\s*\[)/g, (m, mes, ano) => {
      if (+mes < 1 || +mes > 12) return m;
      return m + anotar({ ano: +ano, mes: +mes, dia: diasNoMes(+ano, +mes) });
    })
    // aaaa-mm-dd
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b(?!\s*\[)/g, (m, ano, mes, d) => {
      if (+mes < 1 || +mes > 12) return m;
      return m + anotar({ ano: +ano, mes: +mes, dia: +d });
    })
    // "janeiro de 2024"
    .replace(new RegExp(`\\b(${NOME_DOS_MESES})\\s+de\\s+(\\d{4})\\b(?!\\s*\\[)`, 'gi'), (m, mes, ano) => {
      const numero = MESES[String(mes).toLowerCase()];
      if (!numero) return m;
      return m + anotar({ ano: +ano, mes: numero, dia: diasNoMes(+ano, numero) });
    });
}
