/**
 * QUEM PODE REFAZER O DOCUMENTO ASSINADO — e quem tem de receber o que já existe.
 *
 * "O artefato assinado nasce uma vez" é requisito, e a leitura ingênua dele é
 * uma armadilha: *se o ponteiro existe, devolva o arquivo e não desenhe nada*.
 * Num envelope de UM signatário isso está certo. Em um de dois, produz o pior
 * defeito que este módulo poderia ter:
 *
 *   o primeiro assina e o artefato nasce com a rubrica dele. O segundo assina,
 *   a função vê o ponteiro, devolve o arquivo do PRIMEIRO — e o envelope fecha
 *   com um documento em que a assinatura do segundo simplesmente não está.
 *   Nada falha, ninguém erra, e o que fica arquivado é um documento incompleto
 *   que se apresenta como assinado.
 *
 * A regra certa é POR SIGNATÁRIO, e é a mesma que o banco já aplica: a RPC
 * `public_attach_signed_document` só troca a linha quando quem chega assinou
 * DEPOIS de quem está lá (`last-signer-wins`). Esta função existe para que os
 * dois lados não possam divergir — e para que a regra tenha teste, porque ela
 * erra em silêncio nos dois sentidos: refazendo de menos (some uma assinatura)
 * ou refazendo demais (um arquivo órfão no bucket a cada clique).
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */

export type PonteiroDoArtefato = {
  /** Quem produziu o artefato que está registrado. `null` = registro antigo. */
  donoAtual: string | null;
  /** Quem está pedindo a montagem agora. */
  quemPede: string;
  /** Instante da assinatura de cada signatário, em milissegundos. */
  assinouEm: (signerId: string | null) => number;
};

export type DecisaoDoArtefato =
  | { montar: false; motivo: 'ja-e-meu' | 'dono-assinou-depois' | 'dono-desconhecido' }
  | { montar: true; motivo: 'dono-assinou-antes' };

/**
 * O artefato registrado vale, ou eu monto a minha versão?
 *
 * Os três "não":
 *
 * · **`ja-e-meu`** — segundo clique do mesmo signatário. É o caso que a regra
 *   "uma vez só" existe para cobrir: o documento não é redesenhado, e o hash
 *   gravado continua sendo o dos bytes que existem;
 * · **`dono-assinou-depois`** — chegada fora de ordem (uma repetição atrasada,
 *   uma aba que ficou aberta). A RPC recusaria a minha versão de qualquer
 *   forma; montar só deixaria um PDF órfão no bucket;
 * · **`dono-desconhecido`** — registro sem `signer_id` (anterior ao modelo
 *   `per_document`). Sem saber de quem é, o seguro é NÃO sobrescrever: o que
 *   está lá foi produzido por uma assinatura de verdade.
 *
 * O único "sim" é `dono-assinou-antes` — e aí a versão nova traz as rubricas de
 * todos os que já assinaram, não só a minha.
 */
export function decidirSeMonta(ponteiro: PonteiroDoArtefato): DecisaoDoArtefato {
  const { donoAtual, quemPede, assinouEm } = ponteiro;

  if (!donoAtual) return { montar: false, motivo: 'dono-desconhecido' };
  if (donoAtual === quemPede) return { montar: false, motivo: 'ja-e-meu' };

  // O empate conta como "depois" de propósito: dois instantes iguais não provam
  // que a minha versão é a mais nova, e na dúvida o que está gravado fica.
  if (assinouEm(donoAtual) >= assinouEm(quemPede)) {
    return { montar: false, motivo: 'dono-assinou-depois' };
  }

  return { montar: true, motivo: 'dono-assinou-antes' };
}

/**
 * Lê um `signed_at` do banco como número comparável.
 *
 * Valor ausente ou ilegível vira 0 — o passado mais remoto. A consequência é
 * deliberada: um dono cuja data não se lê perde para qualquer signatário com
 * data válida, e o documento é refeito. Refazer a mais custa um arquivo no
 * bucket; refazer a menos custa uma assinatura que não aparece.
 */
export function instanteDaAssinatura(valor: unknown): number {
  const t = valor ? Date.parse(String(valor)) : NaN;
  return Number.isFinite(t) ? t : 0;
}
