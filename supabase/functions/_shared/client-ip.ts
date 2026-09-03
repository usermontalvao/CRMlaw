/**
 * O IP REAL DE QUEM CHAMOU — e por que o caminho óbvio não serve.
 *
 * O IP gravado numa assinatura é evidência: é o que o dossiê exibe e o que a
 * defesa cita. Até aqui ele vinha do NAVEGADOR, que o buscava na api.ipify.org
 * e o mandava no corpo da requisição. Qualquer pessoa que montasse a chamada à
 * mão escolhia o próprio IP — e a trilha registrava a escolha como fato.
 *
 * A partir daqui o IP sai dos CABEÇALHOS, e a ordem abaixo não é preferência
 * estética: foi medida contra a infraestrutura real deste projeto.
 *
 *   Mandando `X-Forwarded-For: 203.0.113.99` de fora, o Postgres recebeu
 *     x-forwarded-for = 203.0.113.99,201.71.166.196   ← o forjado vem PRIMEIRO
 *     cf-connecting-ip = 201.71.166.196               ← o real, reescrito pela CDN
 *
 * Daí as duas regras que este módulo existe para não deixar ninguém esquecer:
 *
 *  1. `cf-connecting-ip` é a fonte boa. A Cloudflare a REESCREVE em toda
 *     requisição; o que o cliente mandar nesse nome é descartado antes de
 *     chegar aqui.
 *  2. Em `x-forwarded-for` vale o ÚLTIMO item, nunca o primeiro. Cada proxy
 *     ANEXA à direita, então a ponta esquerda é justamente a parte que o
 *     cliente escreveu. Ler o primeiro — que é o que quase toda biblioteca faz
 *     por padrão — é ler exatamente o valor forjado.
 *
 * Sem nenhum cabeçalho, devolve `null`. Cair de volta no valor que o cliente
 * mandou desfaria o conserto inteiro: bastaria omitir os cabeçalhos para voltar
 * a escolher o próprio IP.
 *
 * Recebe um leitor de cabeçalho em vez de um `Request` para poder ser testado
 * sem Deno, e não importa nada de propósito.
 */

/** Um `(nome) => valor`; na prática, `(n) => req.headers.get(n)`. */
export type LeitorDeCabecalho = (nome: string) => string | null | undefined;

/** Cabeçalhos de IP único, em ordem de confiança. */
const CABECALHOS_DIRETOS = ['cf-connecting-ip', 'x-real-ip', 'x-client-ip', 'fly-client-ip'];

const limpar = (v: string | null | undefined): string | null => {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : null;
};

export function ipRealDoCliente(ler: LeitorDeCabecalho): string | null {
  for (const nome of CABECALHOS_DIRETOS) {
    const valor = limpar(ler(nome));
    // Estes chegam com UM endereço. Se algum proxy exótico mandar lista, o
    // último continua sendo o salto mais próximo de nós.
    if (valor) return valor.split(',').map((p) => p.trim()).filter(Boolean).pop() ?? null;
  }

  const encadeado = limpar(ler('x-forwarded-for'));
  if (!encadeado) return null;

  const saltos = encadeado.split(',').map((p) => p.trim()).filter(Boolean);
  return saltos.length > 0 ? saltos[saltos.length - 1] : null;
}

/** Açúcar para o uso normal: `ipDaRequisicao(req)`. */
export function ipDaRequisicao(req: { headers: { get(nome: string): string | null } }): string | null {
  return ipRealDoCliente((nome) => req.headers.get(nome));
}
