/**
 * Decisão de REABERTURA de uma conversa encerrada do WhatsApp.
 *
 * Vive fora do webhook porque é a regra que decide se um atendimento volta ou
 * não para a fila — e isso precisa de teste, não de tentativa em produção.
 * Aqui só entra o que é puro (texto + tempo); banco e IA continuam no webhook.
 *
 * A regra que manda é a de SESSÃO: passadas algumas horas de silêncio depois do
 * encerramento, qualquer mensagem do cliente é um contato NOVO e reabre — sem
 * consultar IA e sem perguntar nada a ele. Perder uma conversa porque a pessoa
 * escreveu só "oi" custa muito mais caro do que reabrir um atendimento à toa.
 * A única exceção é a cortesia inequívoca ("obrigado", "tá bom"), que continua
 * mantendo a conversa encerrada por mais tarde que chegue.
 */

export type DecisaoReabertura =
  /** Nova demanda: volta para a fila. */
  | 'reopen'
  /** Cortesia/despedida: continua encerrada. */
  | 'keep'
  /** Só o texto não decide — quem chamou tenta a IA. */
  | 'ia';

/**
 * Silêncio (em horas) a partir do qual a próxima mensagem do cliente já conta
 * como um contato NOVO, qualquer que seja o conteúdo.
 */
export const HORAS_NOVA_SESSAO = 6;

/**
 * Um "oi" logo depois do encerramento ainda é a despedida da conversa que
 * acabou; passados estes minutos, já é alguém puxando assunto de novo.
 */
export const MINUTOS_CUMPRIMENTO_NOVO = 10;

/** Palavras de agradecimento/confirmação — mensagem curta só com elas = fim. */
const CORTESIA = new Set([
  'obrigado', 'obrigada', 'obg', 'obgd', 'vlw', 'valeu', 'ok', 'okay', 'blz',
  'beleza', 'isso', 'entendi', 'entendido', 'certo', 'combinado', 'perfeito',
  'otimo', 'otima', 'show', 'joia', 'grato', 'grata', 'tchau', 'agradecido',
  'agradecida', 'disponha', 'sim', 'uhum', 'aham', 'top', 'maravilha', 'gratidao',
]);

/** Despedidas/confirmações fechadas (casam com o texto inteiro). */
const CORTESIA_FRASES = new Set([
  'ta bom', 'ta otimo', 'ta certo', 'tudo bem', 'tudo certo', 'tudo otimo',
  'de nada', 'muito obrigado', 'muito obrigada', 'isso mesmo', 'era so isso',
  'so isso', 'nada nao', 'por nada', 'ate mais', 'ate logo', 'ate breve',
  'muito obrigado mesmo', 'obrigado mesmo', 'ok obrigado', 'ta bom obrigado',
]);

/**
 * Palavras de cumprimento. Como as letras repetidas são achatadas antes da
 * comparação ("oiii" → "oi", "oieee" → "oie"), a lista fica curta e ainda assim
 * cobre o jeito real de escrever no WhatsApp. "oie" morava fora dela e foi
 * justamente o caso que virou pergunta automática em vez de reabertura.
 */
const CUMPRIMENTO = new Set([
  'oi', 'oie', 'ola', 'alo', 'opa', 'eai', 'eae', 'salve',
  'hey', 'hi', 'ei', 'bom', 'boa', 'dia', 'tarde', 'noite',
  // "e aí" / "e ae" chegam quebrados em dois pedaços depois da normalização.
  'e', 'ai', 'ae',
]);

/** Frases que anunciam demanda nova sem margem para dúvida. */
const DEMANDA_EXPLICITA = [
  /^eu tenho (outra )?duvida$/,
  /^tenho (outra )?duvida$/,
  /^estou com (uma )?duvida$/,
  /^preciso de ajuda$/,
  /^quero tirar (uma )?duvida$/,
  /^posso tirar (uma )?duvida$/,
  /^tenho uma pergunta$/,
  /^preciso falar com voces$/,
];

/**
 * Minúsculas, sem acento e sem pontuação. O bloco dos acentos combinantes vai
 * escapado (\u0300-\u036f) porque os caracteres crus são INVISÍVEIS no editor:
 * a classe vira dois colchetes com um traço no meio e qualquer cópia pelo
 * caminho pode comê-los sem deixar rastro.
 */
export function normalizarTexto(texto: string): string {
  return texto.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Achata letras repetidas: "oiiii" → "oi", "olaaa" → "ola". */
function achatarLetrasRepetidas(norm: string): string {
  return norm.replace(/(.)\1+/g, '$1');
}

/** Só cumprimento, ainda que composto ("oi bom dia", "oiee boa tarde"). */
export function ehCumprimento(norm: string): boolean {
  const palavras = achatarLetrasRepetidas(norm).split(' ').filter(Boolean);
  if (palavras.length === 0 || palavras.length > 4) return false;
  return palavras.every((p) => CUMPRIMENTO.has(p));
}

/** Só cortesia/despedida — o que mantém a conversa encerrada. */
export function ehCortesia(norm: string): boolean {
  if (CORTESIA_FRASES.has(norm)) return true;
  const palavras = norm.split(' ').filter(Boolean);
  return palavras.length > 0 && palavras.length <= 4 && palavras.every((p) => CORTESIA.has(p));
}

export type EntradaReabertura = {
  /** Texto da mensagem recebida (legenda, no caso de mídia). */
  texto: string | null;
  /** Tipo da mensagem no CRM ('text', 'image', 'audio', ...). */
  tipo: string;
  /**
   * Minutos entre a mensagem nova e a última atividade da conversa — o mais
   * recente entre o encerramento e as mensagens que vieram depois dele.
   * `null` quando não dá para saber (conversa encerrada sem `closed_at`).
   */
  minutosDeSilencio: number | null;
};

/**
 * Classifica a mensagem recebida numa conversa ENCERRADA.
 * A ordem importa: cortesia clara vence o relógio, e o relógio vence a IA.
 */
export function classificarReabertura(entrada: EntradaReabertura): DecisaoReabertura {
  const bruto = (entrada.texto || '').trim();

  // Mídia sem legenda (foto/áudio/documento) tende a ser demanda nova.
  if (!bruto) return entrada.tipo !== 'text' ? 'reopen' : 'keep';

  const norm = normalizarTexto(bruto);
  const silencio = entrada.minutosDeSilencio;

  // Cortesia inequívoca mantém encerrada por mais tarde que chegue: um
  // "obrigada" no dia seguinte continua sendo o fim da conversa anterior.
  if (ehCortesia(norm)) return 'keep';

  if (DEMANDA_EXPLICITA.some((re) => re.test(norm))) return 'reopen';

  // Pergunta explícita → quase sempre demanda nova.
  if (bruto.includes('?')) return 'reopen';

  // Cumprimento depois de um intervalo real é retomada de contato.
  if (ehCumprimento(norm) && silencio !== null && silencio >= MINUTOS_CUMPRIMENTO_NOVO) {
    return 'reopen';
  }

  // Passadas as horas de silêncio, é conversa nova — não interessa mais
  // adivinhar a intenção da frase.
  if (silencio !== null && silencio >= HORAS_NOVA_SESSAO * 60) return 'reopen';

  return 'ia';
}
