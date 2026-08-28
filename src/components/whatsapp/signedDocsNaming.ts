// COMO CHAMAR UM ARQUIVO ASSINADO na tela e no ZIP.
//
// O que o banco guarda em `signature_request_documents.display_name` nem sempre
// é um nome: no envelope montado a partir de um kit, ele é o NOME DO ARQUIVO NO
// ARMAZENAMENTO — `4585e82c-57b3-4799-a7b2-91e68dc25e5b.docx`. Mostrar isso ao
// advogado é mostrar um identificador de banco de dados; ele não distingue um
// documento do outro e não diz nada sobre o que está ali dentro.
//
// PURO DE PROPÓSITO: só texto entra e só texto sai. É o que permite testar
// "uuid vira Documento 1" sem tocar em Storage nem em React.

/** Extensão do caminho no bucket ("…/x.docx" → "docx"), ou vazio. */
export function extensaoDoCaminho(path: string | null | undefined): string {
  if (!path) return '';
  const arquivo = path.split('/').pop() || '';
  const ponto = arquivo.lastIndexOf('.');
  if (ponto <= 0 || ponto === arquivo.length - 1) return '';
  const ext = arquivo.slice(ponto + 1).toLowerCase();
  // Extensão de verdade é curta e alfanumérica: um "nome.2026-08-27" não tem
  // extensão nenhuma, tem uma data no fim.
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O nome guardado é identificador de máquina?
 *
 * Além do UUID cru, entram aqui os nomes que são só um blocão de letras e
 * números sem espaço nenhum — carimbos de tempo e hashes que o gerador de
 * arquivo inventou. Um nome escrito por gente quase sempre tem espaço ou
 * acentuação; na dúvida, o nome do humano ganha.
 */
export function ehNomeDeArmazenamento(nome: string | null | undefined): boolean {
  const limpo = (nome ?? '').trim();
  if (!limpo) return true;
  const ponto = limpo.lastIndexOf('.');
  const base = ponto > 0 ? limpo.slice(0, ponto) : limpo;
  if (UUID.test(base)) return true;
  if (/^[0-9a-f]{16,}$/i.test(base)) return true;
  if (/^\d{10,}$/.test(base)) return true;
  return false;
}

export interface SignedDocLabelInput {
  /** `display_name` do documento do envelope (pode ser o nome do arquivo). */
  displayName?: string | null;
  /** Caminho no bucket — de onde sai a extensão. */
  path?: string | null;
  /** Posição do arquivo dentro do envelope (0-based). */
  index: number;
  /** Quantos arquivos o envelope tem. */
  total: number;
}

/**
 * O rótulo do botão de download.
 *
 * Com nome de gente, é o nome de gente. Sem ele, o arquivo é numerado dentro do
 * envelope ("Documento 1 de 2") — o envelope já está escrito no título logo
 * acima, então repeti-lo aqui só ocuparia a linha. A extensão fica no fim
 * porque baixar um .docx e um .pdf não é a mesma coisa para quem vai abrir.
 */
export function signedDocLabel(input: SignedDocLabelInput): string {
  const ext = extensaoDoCaminho(input.path) || extensaoDoCaminho(input.displayName);
  const bruto = (input.displayName ?? '').trim();
  let base: string;
  if (ehNomeDeArmazenamento(bruto)) {
    base = input.total > 1 ? `Documento ${input.index + 1} de ${input.total}` : 'Documento assinado';
  } else {
    const ponto = bruto.lastIndexOf('.');
    base = ponto > 0 && extensaoDoCaminho(bruto) ? bruto.slice(0, ponto) : bruto;
  }
  return ext ? `${base}.${ext}` : base;
}

/** Tira do nome o que o sistema de arquivos recusa. */
export function nomeDeArquivoSeguro(valor: string, reserva: string): string {
  const limpo = (valor || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  return limpo || reserva;
}

/**
 * Nomes repetidos dentro do MESMO zip.
 *
 * Dois arquivos "Documento assinado.docx" no mesmo pacote fariam um sobrescrever
 * o outro em silêncio — e o advogado abriria um zip com metade do envelope.
 */
export function nomeUnicoNoZip(nome: string, usados: Set<string>): string {
  const ponto = nome.lastIndexOf('.');
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const ext = ponto > 0 ? nome.slice(ponto) : '';
  let candidato = nome;
  let n = 2;
  while (usados.has(candidato)) {
    candidato = `${base} (${n})${ext}`;
    n += 1;
  }
  usados.add(candidato);
  return candidato;
}
