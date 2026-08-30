/**
 * Como os dados da ficha do cliente entram no texto de um documento.
 *
 * O banco guarda o dado CRU: o CPF é `04544803193`, o telefone é
 * `65984046375`. Isso é certo para buscar e comparar, e errado para imprimir —
 * um contrato que sai com "inscrito no CPF sob o nº 04544803193" parece
 * rascunho, e o cliente percebe antes de nós.
 *
 * Estas funções são a camada de vestir: só aparência, sem validação. Quando o
 * valor não tem o formato esperado (CPF com 9 dígitos, telefone com 12), elas
 * devolvem o que receberam em vez de inventar máscara — documento com dado
 * errado é pior que documento sem máscara.
 *
 * Este módulo NÃO IMPORTA NADA de propósito: é o que permite testá-lo com o
 * `node --test` do projeto sem arrastar a árvore de componentes junto.
 */

/** Só os dígitos, para decidir a máscara pelo tamanho. */
const digitsOf = (value: string) => value.replace(/\D/g, '');

/**
 * CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00), decidido pelo tamanho.
 * A mesma coluna `cpf_cnpj` guarda os dois, então quem imprime não precisa
 * saber de antemão qual dos dois veio.
 */
export const formatCpfCnpjForDocument = (value?: string | null): string => {
  if (!value) return '';
  const digits = digitsOf(value);
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value;
};

/** CEP no formato 00000-000. */
export const formatCepForDocument = (value?: string | null): string => {
  if (!value) return '';
  const digits = digitsOf(value);
  if (digits.length === 8) return digits.replace(/(\d{5})(\d{3})/, '$1-$2');
  return value;
};

/**
 * Telefone brasileiro: (00) 00000-0000 no celular, (00) 0000-0000 no fixo.
 * O 55 do país é descartado quando vem junto — o número chega assim de quem
 * foi cadastrado pelo WhatsApp, e "(55) 65984-0463" não é telefone nenhum.
 */
export const formatPhoneForDocument = (value?: string | null): string => {
  if (!value) return '';
  let digits = digitsOf(value);
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
};

/**
 * Nacionalidade, estado civil e profissão vão em MINÚSCULA no meio da frase:
 * "brasileiro, casado, advogado" é a forma corrente da qualificação. Em
 * maiúscula no meio do parágrafo, cada um deles vira um solavanco na leitura.
 */
export const formatQualificationTerm = (value?: string | null): string => {
  if (!value) return '';
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
};

/** UF sempre em duas letras maiúsculas. */
export const formatUfForDocument = (value?: string | null): string => {
  if (!value) return '';
  return value.trim().toLocaleUpperCase('pt-BR');
};

/**
 * Nome próprio (cidade, bairro, logradouro) em Caixa Alta Inicial, com as
 * preposições em minúscula: "Cuiabá", "Várzea Grande", "Santo Antônio do
 * Leverger". Serve tanto para o dado digitado todo em maiúscula quanto para o
 * digitado todo em minúscula.
 */
export const formatProperNamePtBr = (value?: string | null): string => {
  if (!value) return '';

  const connectors = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  const words = value.trim().replace(/\s+/g, ' ').split(' ');

  const titleWord = (word: string, isFirst: boolean) => {
    if (!word) return '';
    const lower = word.toLocaleLowerCase('pt-BR');
    if (!isFirst && connectors.has(lower)) return lower;
    return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
  };

  return words
    .map((word, idx) => word.split('-').map((part) => titleWord(part, idx === 0)).join('-'))
    .join(' ');
};
