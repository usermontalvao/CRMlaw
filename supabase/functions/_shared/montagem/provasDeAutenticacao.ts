/**
 * A lista de provas que o laudo afirma sobre uma assinatura.
 *
 * Cada linha aqui é uma AFIRMAÇÃO num documento que pode ser levado a juízo. O
 * risco não é estético: dizer "autenticação por WhatsApp" quando o servidor só
 * sabe que houve um código enviado a um número é afirmar mais do que se provou.
 * Por isso a regra de inclusão vive separada do desenho, com teste.
 *
 * O módulo NÃO decide como a identidade foi confirmada — isso vem pronto, em
 * `fraseDeIdentidade`, de `src/utils/identidadeConfirmada.ts`. Aqui se decide o
 * que ENTRA na lista, em que ORDEM, e o que fica de fora.
 *
 * Porte de `buildAuthPoints` (`pdfSignature.service.ts`).
 */

export type EntradaDeProvas = {
  /**
   * A frase da identidade confirmada pelo servidor, quando existe. Nula em
   * assinatura antiga (anterior às colunas de confirmação) — e aí a lista
   * simplesmente não afirma nada sobre o canal.
   */
  fraseDeIdentidade?: string | null;
  /** Identificador do Google, quando a confirmação veio por lá. */
  googleId?: string | null;
  ip?: string | null;
  coordenadas?: string | null;
  temSelfie?: boolean;
  /** "iPhone - Safari - iOS", já montado. */
  dispositivo?: string | null;
};

/**
 * A primeira linha é sempre esta, e é a única que não depende de nada: o ato de
 * assinar aconteceu. Todo o resto é evidência EM VOLTA do ato.
 */
export const PROVA_BASE = 'Assinatura manuscrita digital';

/**
 * Monta a lista, na ordem em que ela aparece no laudo.
 *
 * A ordem não é arbitrária — vai do mais forte ao mais circunstancial:
 *
 *   1. o ato (assinatura manuscrita digital);
 *   2. quem foi confirmado, e como;
 *   3. o identificador externo (Google), quando há;
 *   4. de onde (IP, coordenadas);
 *   5. a selfie;
 *   6. o aparelho.
 *
 * Quem lê de cima para baixo encontra primeiro o que sustenta a assinatura e
 * depois o contexto. Invertido, o laudo abriria com "Dispositivo: iPhone", que
 * não prova nada sozinho.
 */
export function provasDeAutenticacao(entrada: EntradaDeProvas): string[] {
  const provas: string[] = [PROVA_BASE];

  const frase = entrada.fraseDeIdentidade?.trim();
  if (frase) provas.push(frase);

  const googleId = entrada.googleId?.trim();
  if (googleId) provas.push(`Google ID: ${googleId}`);

  const ip = entrada.ip?.trim();
  if (ip) provas.push(`Endereço IP: ${ip}`);

  const coords = entrada.coordenadas?.trim();
  if (coords) provas.push(`Geolocalização: ${coords}`);

  if (entrada.temSelfie) provas.push('Verificação facial (selfie)');

  // Resumo curto, e não a cadeia completa do agente de usuário: o cartão do
  // laudo tem altura fixa e uma linha por item. A cadeia inteira vive na trilha
  // de auditoria, que quebra linha e pagina sozinha.
  const dispositivo = entrada.dispositivo?.trim();
  if (dispositivo) provas.push(`Dispositivo: ${dispositivo}`);

  return provas;
}

/**
 * Junta as partes do aparelho descartando as vazias.
 *
 * Separado porque o erro fácil é `[device, browser, os].join(' - ')` com algum
 * campo indefinido, que imprime "iPhone -  - " no laudo.
 */
export function resumoDoDispositivo(
  partes: Array<string | null | undefined>,
): string | null {
  const limpas = partes.map((p) => p?.trim()).filter((p): p is string => !!p);
  return limpas.length > 0 ? limpas.join(' - ') : null;
}
