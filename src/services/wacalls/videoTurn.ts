/**
 * Os quartos de volta da nossa câmera nas chamadas de vídeo.
 *
 * Duas contas moram aqui, e as duas dependem de um FATO MEDIDO: o aparelho do
 * contato não desenha a nossa imagem como ela chega — ele acrescenta um giro
 * por conta própria. Isso foi medido em 19/08/2026, numa ligação de verdade com
 * um Android: mandando a webcam como ela é (giro 0), o operador aparecia
 * deitado no celular, com o chão do escritório na LATERAL da tela; um único
 * clique no botão "Girar" (um quarto de volta no sentido horário, aplicado nos
 * nossos pixels antes do encoder) endireitou a imagem lá.
 *
 * Um quarto de volta nosso cancelando o giro dele significa que ele acrescenta
 * três quartos — daí `PEER_ADDED_TURN`. Não é escolha de projeto: é o que o
 * aplicativo faz, e o que estas constantes registram para que ninguém precise
 * redescobrir de novo com o cliente na linha.
 *
 * Sem imports de propósito: `npm test` roda via ts-node e qualquer import
 * relativo sem extensão na cadeia derruba a suíte inteira.
 */

/** Quartos de volta, sempre dentro de 0..3. Valor estranho vira 0. */
export function normalizeTurn(quarters: number): number {
  if (!Number.isFinite(quarters)) return 0;
  return ((Math.round(quarters) % 4) + 4) % 4;
}

/**
 * Quantos quartos de volta o aparelho do contato ACRESCENTA à nossa imagem.
 *
 * Medido, não escolhido (ver o cabeçalho). Vale para o Android testado; se
 * algum aparelho se comportar diferente, o botão "Girar" continua sendo a
 * palavra final — ele é que decide, este número só define de onde se parte.
 */
export const PEER_ADDED_TURN = 3;

/**
 * O giro que a webcam da mesa precisa para chegar EM PÉ do outro lado.
 *
 * É o padrão de fábrica: sem ele, todo atendente descobria a imagem torta na
 * frente do primeiro cliente e tinha de clicar até acertar.
 */
export const DEFAULT_CAMERA_TURN = normalizeTurn(-PEER_ADDED_TURN);

/**
 * O que o contato REALMENTE vê, dado o giro que aplicamos aqui.
 *
 * É por esta conta que a miniatura da própria câmera é desenhada. Mostrar nela
 * apenas o nosso giro seria mostrar o que SAI daqui, não o que chega lá — e,
 * com o padrão de fábrica, a miniatura apareceria deitada enquanto o cliente vê
 * o operador em pé. Foi exatamente o que aconteceu no teste de 19/08/2026:
 * "resolveu no celular, mas na tela do CRM ficou torto".
 */
export function selfViewTurn(cameraTurn: number): number {
  return normalizeTurn(normalizeTurn(cameraTurn) + PEER_ADDED_TURN);
}
