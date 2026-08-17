/**
 * A mensagem de "o que chegou e o que falta" — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiDocumentStatus.ts
 *   supabase/functions/_shared/wa-ai-document-status.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiDocumentStatus.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * POR QUE ISTO EXISTE
 * Redigir esta mensagem nunca foi trabalho de modelo: é uma lista de estados
 * que o banco conhece com exatidão. Enquanto ela ficou por conta do gpt-4.1-mini
 * saiu isto, em produção, duas vezes na mesma conversa:
 *
 *   "Recebemos seu documento de identificação e o comprovante de residência.
 *    Por favor, envie agora apenas o documento de identificação com foto do
 *    cliente, se ainda não enviou."
 *
 * Ele agradece e cobra o MESMO documento na frase seguinte. Não é falta de
 * instrução — é que transformar uma lista de situações em texto corrido é
 * justamente onde um modelo pequeno troca os itens. O backend sabe a resposta;
 * então o backend escreve.
 */

export interface WaAiDocumentItem {
  label: string;
  /** `pending` é o único estado que ainda cobra alguma coisa do cliente. */
  status: string;
}

/** Estados em que o documento JÁ está com o escritório. */
const RECEBIDOS = ['uploaded', 'approved', 'reviewed', 'complete'];

function limpo(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * O texto que vai ao cliente sobre a situação dos documentos.
 *
 * `aguardandoTriagem` manda ignorar a lista inteira, e essa precedência é o
 * ponto: quando a pessoa acabou de enviar arquivos que a conferência ainda não
 * leu, QUALQUER lista está velha — dizer "ainda falta o comprovante" para quem
 * mandou o comprovante trinta segundos atrás é pior do que não dizer nada.
 */
export function renderWaAiDocumentStatus(input: {
  items: WaAiDocumentItem[];
  aguardandoTriagem?: boolean;
}): string {
  if (input.aguardandoTriagem) {
    return 'Recebi seus arquivos e já estou conferindo. Assim que terminar, eu te aviso por aqui.';
  }

  const itens = (input.items || []).filter(item => limpo(item?.label));
  if (itens.length === 0) return '';

  const faltando = itens.filter(item => !RECEBIDOS.includes(String(item.status || '').toLowerCase()));
  const recebidos = itens.length - faltando.length;

  if (faltando.length === 0) {
    return 'Recebi todos os documentos. Vou dar sequência e te aviso o próximo passo.';
  }

  const lista = faltando.map(item => `• ${limpo(item.label)}`).join('\n');
  // Sem nada recebido a mensagem não pode começar por "recebi": é a primeira
  // cobrança, e agradecer um envio que não houve soa automático e desatento.
  const abertura = recebidos === 0
    ? 'Para seguir, ainda preciso destes documentos:'
    : (faltando.length === 1
      ? 'Recebi, obrigado! Ainda falta este aqui:'
      : 'Recebi, obrigado! Ainda faltam estes:');

  return `${abertura}\n${lista}\n\nPode mandar um de cada vez por aqui mesmo.`;
}
