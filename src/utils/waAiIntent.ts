/**
 * O que o cliente quis dizer — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiIntent.ts
 *   supabase/functions/_shared/wa-ai-intent.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiIntent.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * Duas leituras da mensagem do cliente, ambas do BACKEND — nenhuma depende de
 * o modelo perceber e chamar uma ferramenta:
 *
 *   1. DESINTERESSE. "não" sozinho não basta: quem não quer mais quase nunca
 *      diz "não", diz "depois eu vejo", "não é o momento", "para de mandar
 *      mensagem". E o contrário também acontece — "não sei o mês exato" é
 *      cliente ENGAJADO respondendo a pergunta. Por isso são três faixas, e a
 *      do meio existe justamente para o sistema PERGUNTAR em vez de adivinhar.
 *
 *   2. HORA MARCADA. "me chama às 14h" é um compromisso; insistir antes disso
 *      é o que faz a pessoa bloquear o número, e ligar depois é perder a hora
 *      que ela mesma escolheu.
 */

// ── Interesse ───────────────────────────────────────────────────────────────

export type WaAiInterestLevel = 'sem_interesse' | 'duvida' | 'engajado';

export interface WaAiInterestReading {
  level: WaAiInterestLevel;
  /** O trecho que decidiu a leitura — vai para a nota interna e para o log. */
  matched: string | null;
}

/**
 * Tira acento e pontuação: a busca compara intenção, não ortografia.
 * Os DOIS-PONTOS ficam — "14:30" é hora, e apagá-los transformaria o
 * compromisso do cliente em dois números soltos.
 */
function normalizar(text: string): string {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.!?,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recusa explícita. Cada uma destas é uma frase que ninguém escreve por acaso
 * no meio de um atendimento que está indo bem.
 */
const SEM_INTERESSE = [
  'nao tenho interesse', 'nao tenho mais interesse', 'sem interesse',
  'nao quero mais', 'nao quero nada', 'nao quero continuar', 'nao quero prosseguir',
  'nao desejo continuar', 'nao pretendo continuar',
  'nao me interessa', 'nao me interessou', 'perdi o interesse',
  'para de mandar', 'pare de mandar', 'parem de mandar', 'nao manda mais',
  'nao mande mais', 'nao envie mais', 'nao me envie mais', 'nao me mande mais',
  'me tira da lista', 'me tire da lista', 'sai da minha lista', 'me remove',
  'me descadastra', 'descadastrar', 'cancelar inscricao',
  'nao me procure', 'nao me procura', 'nao me liga', 'nao me ligue',
  'nao precisa mais', 'nao preciso mais', 'nao precisa nao',
  'desisti', 'desistir do processo', 'nao vou dar continuidade',
  'ja resolvi', 'ja resolvido', 'ja contratei', 'ja tenho advogado',
  'ja estou com outro advogado', 'contratei outro',
  'me deixa em paz', 'para com isso', 'chega de mensagem', 'chega disso',
  'nao era eu', 'numero errado', 'pessoa errada', 'engano',
];

/** Recusa em uma palavra só. Só vale em mensagem curta — ver `classify`. */
const SEM_INTERESSE_CURTO = ['nao', 'para', 'pare', 'parar', 'chega', 'cancela', 'cancelar', 'sair', 'stop'];

/**
 * A faixa do meio: adiamento, evasiva, resposta que não responde.
 *
 * Não é recusa — e tratar como recusa perderia cliente. Também não é
 * engajamento: seguir com a próxima pergunta do roteiro depois de um "depois eu
 * vejo" é o comportamento que faz a pessoa parar de responder de vez.
 */
const DUVIDA = [
  'depois eu vejo', 'depois eu falo', 'depois eu respondo', 'depois eu te falo',
  'depois a gente ve', 'depois a gente conversa', 'vejo depois', 'te falo depois',
  'agora nao', 'agora nao posso', 'nao posso agora', 'nao da agora',
  'estou ocupado', 'to ocupado', 'estou trabalhando', 'to trabalhando',
  'mais tarde', 'outro dia', 'outra hora', 'qualquer dia',
  'vou ver', 'vou pensar', 'vou analisar', 'preciso pensar', 'deixa eu pensar',
  'talvez', 'quem sabe', 'nao sei se vou', 'nao sei se quero',
  'deixa pra la', 'deixa pra depois', 'esquece', 'tanto faz',
  'nao tenho tempo', 'sem tempo',
];

/**
 * Perguntas ABERTAS que a IA acabou de fazer viram respostas curtas legítimas.
 * "Não" para "você ainda trabalha lá?" é informação, não recusa — e sem esta
 * ressalva o atendimento morreria exatamente no meio da triagem.
 */
export interface WaAiInterestInput {
  text: string | null | undefined;
  /** A última pergunta da IA. Se for pergunta fechada, "não" é RESPOSTA. */
  lastQuestion?: string | null;
}

/** Uma pergunta que aceita "sim/não" como resposta de conteúdo. */
function perguntaFechada(question: string | null | undefined): boolean {
  const q = normalizar(question || '');
  if (!q) return false;
  return /^(voce |vc |tu |ja |tem |teve |trabalha|trabalhou|recebe|recebeu|possui|esta|estava|foi|era|houve|existe|tinha|chegou|consegue|conseguiu|sabe|lembra|quer que|posso|podemos)/.test(q)
    || / ou nao\b/.test(q)
    || /\bja (tem|teve|fez|foi|recebeu|trabalhou)\b/.test(q);
}

/**
 * Em que pé está o interesse do cliente.
 *
 * A ordem importa: a recusa explícita ganha da evasiva, e as duas ganham do
 * silêncio. A palavra solta só decide quando a mensagem é curta — num texto
 * longo, "não" quase sempre está no meio de uma explicação.
 */
export function classifyWaAiInterest(input: WaAiInterestInput): WaAiInterestReading {
  const texto = normalizar(input.text || '');
  if (!texto) return { level: 'engajado', matched: null };

  for (const frase of SEM_INTERESSE) {
    if (texto.includes(frase)) return { level: 'sem_interesse', matched: frase };
  }

  const palavras = texto.split(' ');
  if (palavras.length <= 2) {
    const achou = palavras.find(p => SEM_INTERESSE_CURTO.indexOf(p) !== -1);
    if (achou === 'nao') {
      // "Não" SOZINHO pode ser recusa. Com qualquer outra palavra junto é
      // conteúdo — "não sei", "não lembro", "não tenho" são o cliente
      // RESPONDENDO, e desligar o atendimento neles seria o pior erro possível.
      const sozinho = palavras.length === 1;
      // E mesmo sozinho: logo depois de uma pergunta fechada, é a resposta dela.
      if (sozinho && !perguntaFechada(input.lastQuestion)) {
        return { level: 'sem_interesse', matched: achou };
      }
      return { level: 'engajado', matched: null };
    }
    if (achou) return { level: 'sem_interesse', matched: achou };
  }

  for (const frase of DUVIDA) {
    if (texto.includes(frase)) return { level: 'duvida', matched: frase };
  }

  return { level: 'engajado', matched: null };
}

// ── Hora marcada ────────────────────────────────────────────────────────────

export interface WaAiRequestedTime {
  /** Hora de parede pedida, no fuso do canal. */
  hour: number;
  minute: number;
  /** Dias à frente: 0 = hoje, 1 = amanhã, … */
  dayOffset: number;
  /** Dia da semana pedido (0=dom), quando a pessoa nomeou um. */
  weekday: number | null;
  /** O trecho reconhecido, para a confirmação e o log. */
  matched: string;
}

const DIAS_SEMANA: { re: RegExp; dow: number }[] = [
  { re: /\b(segunda|segunda-feira|seg)\b/, dow: 1 },
  { re: /\b(terca|terca-feira|ter)\b/, dow: 2 },
  { re: /\b(quarta|quarta-feira|qua)\b/, dow: 3 },
  { re: /\b(quinta|quinta-feira|qui)\b/, dow: 4 },
  { re: /\b(sexta|sexta-feira|sex)\b/, dow: 5 },
  { re: /\b(sabado|sab)\b/, dow: 6 },
  { re: /\b(domingo|dom)\b/, dow: 0 },
];

/** Períodos do dia viram uma hora só quando não há relógio na frase. */
// Cada alternativa fechada em \b: sem isso "manha" casaria DENTRO de "amanha",
// e todo "amanhã" viraria "amanhã às 9".
const PERIODOS: { re: RegExp; hour: number }[] = [
  { re: /\b(?:final do dia|fim do dia|fim da tarde)\b/, hour: 17 },
  { re: /\b(?:de manha|pela manha|manha)\b/, hour: 9 },
  { re: /\b(?:a tarde|de tarde|pela tarde|tarde)\b/, hour: 14 },
];

/**
 * Frases que transformam um horário em PEDIDO DE CONTATO.
 *
 * Sem uma delas, um horário no texto é só conteúdo. Isto não é rigor teórico:
 * em 12/08/2026 o cliente respondeu "trabalhava de segunda a sexta, das oito às
 * dezoito" — descrevendo a jornada dele — e o agente marcou um compromisso para
 * segunda-feira e se despediu no meio da triagem. Errar para o lado de NÃO
 * agendar custa nada; errar para este lado encerra um atendimento vivo.
 */
const PEDIDO_DE_CONTATO = [
  'me chama', 'me chame', 'me liga', 'me ligue', 'me manda', 'me mande',
  'me envia', 'me envie', 'me procura', 'me procure', 'me avisa', 'me avise',
  'me retorna', 'me retorne', 'me chamar', 'me ligar',
  'entra em contato', 'entre em contato', 'entrar em contato',
  'fala comigo', 'falar comigo', 'falamos', 'conversamos', 'nos falamos',
  'pode ser', 'prefiro', 'so consigo', 'consigo falar', 'consigo responder',
  'estarei', 'estou disponivel', 'to disponivel', 'fico disponivel',
  'a partir das', 'marca', 'marcar', 'agenda', 'agendar', 'agende',
  'volta depois', 'retorna depois', 'chama depois', 'me chama de volta',
];

/**
 * Frases que dizem "isto é a MINHA rotina", não "me procure a esta hora".
 *
 * Vence o pedido quando as duas aparecem: descrição de jornada com um verbo no
 * passado é resposta de triagem, e nenhuma resposta de triagem deve virar
 * compromisso.
 */
const DESCREVE_ROTINA = [
  'trabalhava', 'trabalhei', 'trabalhavamos', 'trabalhava das', 'eu trabalho das',
  'era das', 'eram das', 'recebia', 'recebi', 'ganhava', 'entrava as', 'saia as',
  'batia ponto', 'horario de trabalho', 'jornada', 'expediente da empresa',
  'meu horario era', 'o horario era', 'plantao',
];

/**
 * "Me chama às 14h", "amanhã de manhã", "segunda às 10:30".
 *
 * Duas exigências, as duas necessárias:
 *   1. uma frase de PEDIDO DE CONTATO — senão qualquer hora citada na conversa
 *      viraria compromisso;
 *   2. marca de relógio (`h`, `:`, "horas") ou palavra de período.
 *
 * Devolve a hora de PAREDE — converter para UTC é trabalho de quem conhece o
 * fuso do canal. `hour = -1` quer dizer "deu o dia, não deu a hora": aí o certo
 * é PERGUNTAR a hora, não arbitrar uma.
 */
export function parseWaAiRequestedTime(text: string | null | undefined): WaAiRequestedTime | null {
  const t = normalizar(text || '');
  if (!t) return null;

  if (DESCREVE_ROTINA.some(frase => t.includes(frase))) return null;
  if (!PEDIDO_DE_CONTATO.some(frase => t.includes(frase))) return null;

  // "amanhã" e "depois de amanhã" antes do dia da semana: "amanhã de manhã"
  // não é segunda-feira coisa nenhuma.
  let dayOffset = 0;
  if (/\bdepois de amanha\b/.test(t)) dayOffset = 2;
  else if (/\bamanha\b/.test(t)) dayOffset = 1;

  let weekday: number | null = null;
  if (dayOffset === 0) {
    for (const dia of DIAS_SEMANA) {
      if (dia.re.test(t)) { weekday = dia.dow; break; }
    }
  }

  // Relógio: "14h", "14:30", "14 horas", "as 9".
  const relogio = t.match(/(?:\b(?:as|às|as|pras|para as|por volta das|umas|depois das|apos as)\s*)?(\d{1,2})\s*(?::|h|hs|horas?)\s*(\d{2})?/);
  if (relogio) {
    let hour = Number(relogio[1]);
    const minute = Number(relogio[2] || 0);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      // "as 2 da tarde" → 14h. Sem essa correção o retorno seria de madrugada.
      if (hour <= 11 && /\bda tarde|a tarde|de tarde\b/.test(t)) hour += 12;
      if (hour <= 11 && /\bda noite|a noite|de noite\b/.test(t)) hour += 12;
      return { hour, minute, dayOffset, weekday, matched: relogio[0].trim() };
    }
  }

  for (const periodo of PERIODOS) {
    const m = t.match(periodo.re);
    if (m) return { hour: periodo.hour, minute: 0, dayOffset, weekday, matched: m[0] };
  }

  // "amanhã" sozinho é um dia, não uma hora: quem decide a hora é a janela do
  // canal, então devolvemos o começo do expediente marcado com hora inválida.
  if (dayOffset > 0 || weekday !== null) {
    return { hour: -1, minute: 0, dayOffset, weekday, matched: dayOffset > 0 ? 'amanha' : 'dia da semana' };
  }

  return null;
}

/** "amanhã às 14:00" — a confirmação que a IA repete para o cliente. */
export function describeWaAiRequestedTime(req: WaAiRequestedTime): string {
  const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dia = req.weekday !== null ? NOMES[req.weekday]
    : req.dayOffset === 0 ? 'hoje'
      : req.dayOffset === 1 ? 'amanhã'
        : `em ${req.dayOffset} dias`;
  if (req.hour < 0) return dia;
  return `${dia} às ${String(req.hour).padStart(2, '0')}:${String(req.minute).padStart(2, '0')}`;
}
