/**
 * CONGELAR O ORIGINAL — a etapa que tira a montagem do aparelho de quem assina.
 *
 * Hoje 241 dos 291 envelopes nascem de um `.docx`, e é por isso que o PDF
 * assinado é montado no navegador: alguém precisa DESENHAR o Word, e nenhum
 * runtime de JavaScript (Node ou Deno) sabe fazer isso. O servidor Syncfusion
 * também não converte — o `Export` devolve `application/msword` mesmo quando se
 * pede PDF, porque não tem `DocIORenderer` (medido em 30/07/2026).
 *
 * A saída é mover a conversão para a CRIAÇÃO do envelope. O `.docx` vira PDF
 * uma única vez, no navegador de quem cria — que está autenticado, e cujo
 * resultado o servidor confere logo em seguida —, e a partir daí o arquivo está
 * CONGELADO: quem assina recebe exatamente aquele PDF, e a montagem passa a ser
 * sempre PDF→PDF, que o servidor faz sozinho.
 *
 * Este módulo é só a régua: o que precisa ser convertido, como o arquivo
 * congelado se chama, e se o que voltou é mesmo um PDF. Quem converte é o
 * `docxToPdf.ts`; quem grava é o módulo de assinaturas.
 *
 * Sem imports, de propósito: `npm test` roda por ts-node e quebra com import
 * relativo sem extensão em qualquer ponto da cadeia.
 */

/** O que o Word produz e nós aceitamos como entrada de envelope. */
const EXTENSOES_WORD = ['.docx', '.doc'] as const;

const extensaoDe = (nomeOuCaminho: string): string => {
  const limpo = String(nomeOuCaminho ?? '').trim().toLowerCase();
  const semQuery = limpo.split('?')[0].split('#')[0];
  const ponto = semQuery.lastIndexOf('.');
  return ponto >= 0 ? semQuery.slice(ponto) : '';
};

/** `true` para o que precisa passar pela conversão antes de virar envelope. */
export function ehArquivoWord(nomeOuCaminho: string): boolean {
  return (EXTENSOES_WORD as readonly string[]).includes(extensaoDe(nomeOuCaminho));
}

/** `true` só para quem já é PDF — nome, não conteúdo (para isso, `pareceUmPdf`). */
export function ehArquivoPdf(nomeOuCaminho: string): boolean {
  return extensaoDe(nomeOuCaminho) === '.pdf';
}

/**
 * O nome do arquivo depois de congelado.
 *
 * Troca a extensão em vez de acrescentar: `contrato.docx` vira `contrato.pdf`,
 * nunca `contrato.docx.pdf` — o nome aparece no cabeçalho do laudo e no e-mail
 * que o cliente recebe, e "contrato.docx.pdf" denuncia encanamento a quem só
 * queria assinar um contrato.
 */
export function nomeDoOriginalCongelado(nome: string): string {
  const bruto = String(nome ?? '').trim();
  if (!bruto) return 'documento.pdf';
  const ext = extensaoDe(bruto);
  if (!ext) return `${bruto}.pdf`;
  return `${bruto.slice(0, bruto.length - ext.length)}.pdf`;
}

/**
 * A CONFERÊNCIA MAIS BARATA QUE EXISTE: isto é mesmo um PDF?
 *
 * O `%PDF-` não precisa estar no byte zero. A norma (ISO 32000-1, §7.5.2) manda
 * o cabeçalho estar no COMEÇO do arquivo, mas leitores toleram lixo antes dele
 * e arquivos reais nascem assim — com BOM, com bytes de encaminhamento de
 * e-mail. Por isso a busca varre o primeiro quilobyte em vez de exigir o
 * offset 0: recusar um PDF que o Adobe abre seria pior do que aceitar um byte
 * de sujeira na frente.
 *
 * Isto NÃO prova que o conteúdo é o documento certo — prova só que o arquivo é
 * do tipo que dizemos que é. É o piso, não o teto.
 */
export function pareceUmPdf(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 5) return false;
  const janela = bytes.subarray(0, Math.min(bytes.length, 1024));
  const assinatura = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  for (let i = 0; i + assinatura.length <= janela.length; i++) {
    let bate = true;
    for (let j = 0; j < assinatura.length; j++) {
      if (janela[i + j] !== assinatura[j]) { bate = false; break; }
    }
    if (bate) return true;
  }
  return false;
}

/**
 * A CHAVE DE CADA ARQUIVO DO ENVELOPE.
 *
 * `main` para o principal e `attachment-<i>` para cada anexo, com `i` contado a
 * partir de ZERO no vetor de anexos. Não é convenção nova: é exatamente o que
 * `signature_fields.document_id` já usa para dizer em qual arquivo o campo de
 * assinatura foi marcado, e o que `signature_request_documents.document_key`
 * guarda. Inventar uma segunda numeração aqui desalinharia o campo do arquivo.
 */
export function chaveDoDocumento(indiceNoEnvelope: number): string {
  return indiceNoEnvelope <= 0 ? 'main' : `attachment-${indiceNoEnvelope - 1}`;
}

/** Um arquivo que o usuário escolheu para o envelope, antes de qualquer conversão. */
export interface ArquivoDeEntrada {
  /** Nome exibido (com extensão). */
  nome: string;
  /** Caminho no Storage, quando o arquivo já está lá (documento gerado/selecionado). */
  caminho?: string | null;
}

/** O que fazer com cada arquivo antes de o envelope existir. */
export interface PassoDoCongelamento {
  /** `main` | `attachment-<i>` */
  chave: string;
  /** Posição no envelope: 0 = principal. */
  indice: number;
  nomeOriginal: string;
  caminhoOriginal: string | null;
  /** `true` quando o arquivo precisa ser convertido para PDF antes de congelar. */
  converter: boolean;
  /** Nome que o arquivo terá depois de congelado. */
  nomeFinal: string;
  /**
   * `true` quando o arquivo não é nem PDF nem Word. Não bloqueia sozinho — quem
   * chama decide —, mas nunca deve seguir calado: um `.png` virando "documento
   * assinado" é defeito, e o silêncio é que o deixaria passar.
   */
  formatoDesconhecido: boolean;
}

/**
 * O plano de congelamento do envelope inteiro, na ordem em que os arquivos
 * aparecem: o principal primeiro, os anexos depois.
 */
export function planoDeCongelamento(arquivos: ArquivoDeEntrada[]): PassoDoCongelamento[] {
  return (arquivos ?? []).map((arquivo, indice) => {
    const nome = String(arquivo?.nome ?? '').trim() || `documento-${indice + 1}`;
    const word = ehArquivoWord(nome);
    const pdf = ehArquivoPdf(nome);
    return {
      chave: chaveDoDocumento(indice),
      indice,
      nomeOriginal: nome,
      caminhoOriginal: arquivo?.caminho ?? null,
      converter: word,
      nomeFinal: word ? nomeDoOriginalCongelado(nome) : nome,
      formatoDesconhecido: !word && !pdf,
    };
  });
}

/** Quantos arquivos do plano ainda precisam passar pela conversão. */
export function quantosConverter(plano: PassoDoCongelamento[]): number {
  return (plano ?? []).filter((p) => p.converter).length;
}

/**
 * A frase que o usuário lê enquanto espera.
 *
 * Converter um kit de três documentos leva segundos de verdade, e uma tela
 * parada durante segundos é indistinguível de uma tela travada. Dizer QUAL
 * arquivo está sendo convertido, e de quantos, é o que separa "está pensando"
 * de "morreu".
 */
export function frasePreparandoDocumento(atual: number, total: number, nome?: string | null): string {
  if (total <= 0) return 'Preparando o documento…';
  const alvo = String(nome ?? '').trim();
  const posicao = total > 1 ? ` (${Math.min(Math.max(atual, 1), total)} de ${total})` : '';
  return alvo
    ? `Convertendo "${alvo}" para PDF${posicao}…`
    : `Convertendo os documentos para PDF${posicao}…`;
}
