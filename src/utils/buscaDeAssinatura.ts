/**
 * O QUE FOI COLADO NA BUSCA DO PAINEL DE ASSINATURAS.
 *
 * Quando um link de assinatura quebra, a página pública mostra um código e
 * manda a pessoa procurar o escritório com ele. Só que o painel procurava
 * apenas por NOME DO DOCUMENTO e NOME DO CLIENTE — colar aquele código não
 * achava nada. O código existia e não servia para nada: quem ligava ditava
 * trinta e seis caracteres e ouvia "não encontrei".
 *
 * Este módulo é o tradutor. Ele olha o texto colado e diz o que ele é, para o
 * filtro saber onde procurar:
 *
 *   · o LINK inteiro do WhatsApp  → o token de dentro dele;
 *   · o token solto (UUID)        → ele mesmo;
 *   · só dígitos                  → CPF ou telefone;
 *   · qualquer outra coisa        → texto (nome, documento, e-mail).
 *
 * Aceitar o link inteiro não é luxo: é o que a pessoa tem em mãos. Ela
 * encaminha a mensagem do WhatsApp, e quem atende cola o que chegou.
 *
 * SEM IMPORTS de propósito — o `npm test` deste repositório roda com ts-node e
 * quebra em qualquer import relativo sem extensão na cadeia. Lógica pura, sem
 * dependência, é o que mantém este arquivo testável.
 */

/** Um UUID como o `public_token` do signatário e o `id` da solicitação. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TipoDeBusca = 'token' | 'digitos' | 'texto' | 'vazio';

export interface BuscaDeAssinatura {
  tipo: TipoDeBusca;
  /** Token em minúsculas quando `tipo === 'token'`. */
  token: string | null;
  /** Só os dígitos quando `tipo === 'digitos'` (CPF, telefone). */
  digitos: string | null;
  /** O termo cru, para a busca por texto de sempre. */
  texto: string;
}

/** Só os dígitos — CPF vem digitado com e sem pontuação. */
export const somenteDigitos = (valor?: string | null): string =>
  String(valor || '').replace(/\D/g, '');

/**
 * Extrai o token de um link de assinatura, ou aceita o token já solto.
 *
 * Cobre as formas que realmente chegam: o link completo com `#`, o link sem
 * hash, o link com parâmetros depois do token, e o token copiado da tela de
 * erro (que já vem limpo).
 */
export const extrairTokenDeAssinatura = (termo: string): string | null => {
  const bruto = String(termo || '').trim();
  if (!bruto) return null;

  const noLink = bruto.match(/\/assinar\/([^/?#\s]+)/i);
  const candidato = (noLink ? noLink[1] : bruto).trim();

  return UUID.test(candidato) ? candidato.toLowerCase() : null;
};

/**
 * Classifica o termo digitado.
 *
 * O piso de 6 dígitos para `digitos` é o que impede "12" de virar busca por
 * CPF e sequestrar uma busca de texto legítima ("Contrato 12").
 */
export const lerBuscaDeAssinatura = (termo: string): BuscaDeAssinatura => {
  const texto = String(termo || '').trim();
  if (!texto) return { tipo: 'vazio', token: null, digitos: null, texto: '' };

  const token = extrairTokenDeAssinatura(texto);
  if (token) return { tipo: 'token', token, digitos: null, texto };

  const digitos = somenteDigitos(texto);
  const soDigitosOuPontuacao = digitos.length > 0 && !/[a-zA-Z]/.test(texto);
  if (soDigitosOuPontuacao && digitos.length >= 6) {
    return { tipo: 'digitos', token: null, digitos, texto };
  }

  return { tipo: 'texto', token: null, digitos: null, texto };
};
