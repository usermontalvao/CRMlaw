// NOME DE GENTE, ESCRITO COMO GENTE ESCREVE.
//
// Metade dos contatos do escritório entra no banco em caixa alta: vem do
// documento (CNH, RG), da planilha da campanha ou do cadastro antigo. A lista
// de conversas mostrava exatamente o que estava guardado, e o resultado era
// uma coluna inteira gritando — "LISLIANDRA CERQUEIRA INOCENCIO", "PAULO
// HENRIQUE GARCIA BARBOSA" —, com o texto ocupando mais largura, cortando mais
// cedo e dando ao painel a cara de um sistema de protocolo dos anos 90.
//
// Este módulo NÃO corrige o dado: o cadastro continua como está, porque é dele
// que saem documentos e petições. Ele corrige a EXIBIÇÃO, e só onde o nome
// está evidentemente gritado.
//
// Fica num arquivo sem nenhum import de propósito: é o que permite testá-lo
// com `node --test` (ver `testes-ts-node-imports` — import relativo sem
// extensão na cadeia derruba a suíte inteira).

/** Partículas que ficam minúsculas no meio do nome — nunca na primeira palavra. */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'della', 'van', 'von', 'y', 'la', 'le']);

/** Siglas que continuam em caixa alta mesmo dentro de um nome composto. */
const SIGLAS = new Set(['inss', 'ltda', 'me', 'epp', 'sa', 'oab', 'cef', 'bb', 'tj', 'trf', 'jf']);

const capitalizarPalavra = (p: string): string => {
  if (!p) return p;
  if (SIGLAS.has(p)) return p.toUpperCase();
  // Nomes com hífen ou apóstrofo têm DUAS iniciais: "ana-maria", "d'almeida".
  return p.replace(/(^|[-'’])([a-zà-ÿ])/g, (_m, antes, letra) => antes + letra.toUpperCase());
};

/**
 * Devolve o nome pronto para a tela.
 *
 * Só mexe quando o texto está TODO em caixa alta: se quem cadastrou escreveu
 * "Maria de Souza", ou "Dra. ANA", a escolha é dele e fica de pé. Uma palavra
 * sozinha também fica — "INSS" e "TJMT" não são nomes gritados, são siglas.
 */
export const nomeProprio = (bruto: string | null | undefined): string => {
  const s = (bruto || '').trim();
  if (!s) return '';
  // Sem nenhuma letra (telefone formatado, por exemplo): nada a fazer.
  if (!/[a-zà-ÿ]/i.test(s)) return s;
  // Já tem minúscula: foi escolha de quem escreveu.
  if (/[a-zà-ÿ]/.test(s)) return s;
  // Uma palavra só: sigla, apelido, marca. Fica como está.
  if (!/\s/.test(s)) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((palavra, i) => (i > 0 && PARTICULAS.has(palavra) ? palavra : capitalizarPalavra(palavra)))
    .join(' ');
};
