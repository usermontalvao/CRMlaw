/**
 * De quem é o comprovante de residência — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiResidenceHolder.ts
 *   supabase/functions/_shared/wa-ai-residence-holder.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiResidenceHolder.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * POR QUE ISTO EXISTE
 * A triagem perguntava "o comprovante está no seu nome, no de familiar, você
 * tem contrato de aluguel ou não tem nenhum?" ANTES de ver documento nenhum. A
 * pessoa responde de memória e erra de boa-fé — o caso real que motivou esta
 * mudança tem um arquivo chamado "COMPROVANTE DE RESIDÊNCIA EM NOME DO PAI".
 * Agora quem responde é o próprio arquivo: a triagem documental lê o titular e
 * estas regras dizem se é o cliente ou outra pessoa.
 *
 * O VIÉS É DELIBERADO. Na dúvida, `indefinido` — nunca `proprio`. Dar por
 * conferido um comprovante de terceiro deixa o processo seguir com documento
 * inválido e ninguém descobre até o protocolo. Já um `terceiro` errado custa
 * UMA pergunta ao cliente, que ele responde em cinco segundos.
 */

export type WaAiHolderVerdict = 'proprio' | 'terceiro' | 'indefinido';

/** Partículas que não identificam ninguém: não entram na comparação. */
const PARTICULAS = [
  'de', 'da', 'do', 'das', 'dos', 'e', 'del', 'della', 'di', 'du', 'la', 'le', 'van', 'von', 'y',
];

/** Sufixos de geração, que são exatamente o que diferencia pai de filho. */
const SUFIXOS = ['filho', 'filha', 'neto', 'neta', 'junior', 'jr', 'sobrinho', 'segundo', 'terceiro'];

function normalizar(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Os pedaços que valem para identificar a pessoa, na ordem em que aparecem. */
function partes(value: string): string[] {
  return normalizar(value)
    .split(' ')
    .filter(Boolean)
    .filter(item => PARTICULAS.indexOf(item.toLowerCase()) === -1);
}

/**
 * Duas formas do mesmo nome, aceitando abreviação.
 *
 * "IGOR" e "I" casam; "IGOR" e "IVAN" não. A abreviação de uma letra é comum em
 * conta de luz, e recusá-la mandaria a IA perguntar de quem é o comprovante do
 * próprio cliente.
 */
function mesmoNome(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1) return b.charAt(0) === a;
  if (b.length === 1) return a.charAt(0) === b;
  return false;
}

/**
 * O titular do comprovante é o próprio cliente?
 *
 * DUAS CONDIÇÕES, e a segunda existe por um motivo concreto: na triagem a
 * pessoa digita o nome curto ("Igor Alvino") e a conta de luz traz o nome legal
 * inteiro ("IGOR ALVINO DOS SANTOS"). Comparar só o último sobrenome acusaria
 * essa pessoa de ter mandado comprovante de outro — e a IA perguntaria o
 * parentesco de alguém que mandou exatamente o documento certo.
 *
 *   1. o PRIMEIRO nome bate — é ele que separa pai de filho no caso brasileiro,
 *      onde "JOSE ALVINO DOS SANTOS" e "IGOR ALVINO DOS SANTOS" dividem
 *      sobrenome e endereço;
 *   2. e os sobrenomes são compatíveis: ou o último bate, ou o nome mais curto
 *      cabe inteiro dentro do mais longo.
 *
 * Sufixo de geração (Filho, Júnior, Neto) é comparado à parte, porque é
 * literalmente o que distingue duas pessoas com o nome idêntico.
 */
export function compareWaAiResidenceHolder(
  clientName: string | string[] | null | undefined,
  holderName: string | null | undefined,
): WaAiHolderVerdict {
  // O cliente pode ser conhecido por mais de um nome — o que ele digitou na
  // triagem e o que está no cadastro. Basta UM deles bater com o documento.
  if (Array.isArray(clientName)) {
    const vereditos = clientName
      .filter(Boolean)
      .map(nome => compareWaAiResidenceHolder(nome, holderName));
    if (vereditos.indexOf('proprio') !== -1) return 'proprio';
    if (vereditos.indexOf('terceiro') !== -1) return 'terceiro';
    return 'indefinido';
  }

  const cliente = partes(String(clientName || ''));
  const titular = partes(String(holderName || ''));
  // Nome ilegível, ausente ou de uma palavra só não decide nada: o documento
  // pode estar torto, escuro ou cortado, e chutar aqui é pior do que esperar.
  if (cliente.length < 2 || titular.length < 2) return 'indefinido';

  const sufixoDe = (nome: string[]) => {
    const ultimo = nome[nome.length - 1].toLowerCase();
    return SUFIXOS.indexOf(ultimo) === -1 ? '' : ultimo;
  };
  const semSufixo = (nome: string[]) => (sufixoDe(nome) ? nome.slice(0, -1) : nome);

  // "IGOR ALVINO DOS SANTOS FILHO" não é "IGOR ALVINO DOS SANTOS".
  if (sufixoDe(cliente) !== sufixoDe(titular)) return 'terceiro';

  const c = semSufixo(cliente);
  const t = semSufixo(titular);
  if (c.length < 2 || t.length < 2) return 'indefinido';

  if (!mesmoNome(c[0], t[0])) return 'terceiro';

  if (mesmoNome(c[c.length - 1], t[t.length - 1])) return 'proprio';

  // O nome curto cabe dentro do longo? "IGOR ALVINO" dentro de "IGOR ALVINO DOS
  // SANTOS" é a mesma pessoa; "IGOR ALVINO" dentro de "IGOR IVAN DA COSTA
  // LEITE" não é, porque ALVINO não aparece lá.
  const [curto, longo] = c.length <= t.length ? [c, t] : [t, c];
  const cabe = curto.every(parte => longo.some(outra => mesmoNome(parte, outra)));
  return cabe ? 'proprio' : 'terceiro';
}

/**
 * O titular do comprovante é pai ou mãe do cliente?
 *
 * O RG brasileiro traz a FILIAÇÃO impressa, e o cliente manda o RG na mesma
 * leva do comprovante. Confrontar os dois responde sozinho a pergunta que a IA
 * ia fazer: "essa pessoa é sua esposa, esposo, pai ou mãe?". Quando o nome do
 * comprovante é um dos pais, a rota é `familiar` e ninguém precisa perguntar
 * nada — o cliente mandou os documentos e o atendimento simplesmente segue.
 *
 * Devolve o nome do parente como está no RG, ou null quando não há confronto
 * possível: aí a pergunta continua valendo, porque pode ser cônjuge, sogro ou
 * um terceiro qualquer, e nada disso está escrito no documento.
 */
export function matchWaAiResidenceHolderToParent(
  holderName: string | null | undefined,
  parentNames: (string | null | undefined)[] | null | undefined,
): string | null {
  const titular = partes(String(holderName || ''));
  if (titular.length < 2) return null;
  for (const parente of parentNames || []) {
    const nome = String(parente || '');
    if (partes(nome).length < 2) continue;
    if (compareWaAiResidenceHolder(nome, holderName) === 'proprio') return nome.trim();
  }
  return null;
}

/**
 * Este item pedido é o comprovante de residência?
 *
 * Compara o RÓTULO da solicitação, que é escrito pelo backend em
 * `accountDocuments`. Contrato de aluguel e declaração ficam de fora de
 * propósito: nesses casos a titularidade já foi resolvida e conferir de novo
 * reabriria uma pergunta que o cliente já respondeu.
 */
export function isWaAiResidenceProofLabel(label: string | null | undefined): boolean {
  const texto = normalizar(label);
  if (!texto) return false;
  if (texto.indexOf('CONTRATO') !== -1) return false;
  if (texto.indexOf('DECLARANTE') !== -1) return false;
  if (texto.indexOf('DECLARACAO') !== -1) return false;
  return texto.indexOf('COMPROVANTE DE RESIDENCIA') !== -1;
}
