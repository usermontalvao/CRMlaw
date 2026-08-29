/**
 * Quando uma abertura do documento vira evento no histórico da assinatura.
 *
 * O histórico público mostrava UMA visualização por sessão do navegador e nunca
 * mais: a trava era um `sessionStorage` sem prazo. Quem abria o documento cinco
 * vezes ao longo da tarde aparecia uma vez só, e a trilha de auditoria — que
 * existe justamente para contar quantas vezes o documento foi acessado —
 * mentia por omissão.
 *
 * A janela aqui é a MESMA que o servidor já usava: a RPC
 * `public_mark_signer_viewed` ignora um `viewed` repetido com o mesmo IP e o
 * mesmo aparelho dentro de 5 minutos. Manter as duas pontas no mesmo prazo é o
 * que faz recarregar a página não virar evento e voltar ao documento mais tarde
 * virar.
 *
 * Sem imports, para os testes exercitarem isto sem arrastar o componente.
 */

/** Janela de agrupamento, em milissegundos. Espelha a da RPC. */
export const JANELA_VISUALIZACAO_MS = 5 * 60 * 1000;

/**
 * Decide se esta abertura deve ser registrada.
 *
 * @param ultimaMs  instante da última visualização registrada nesta sessão
 *                  (0, NaN ou nulo = nunca registrada)
 * @param agoraMs   agora
 * @param janelaMs  janela de agrupamento
 */
export const deveRegistrarVisualizacao = (
  ultimaMs: number | null | undefined,
  agoraMs: number,
  janelaMs: number = JANELA_VISUALIZACAO_MS,
): boolean => {
  if (ultimaMs === null || ultimaMs === undefined) return true;
  if (!Number.isFinite(ultimaMs) || ultimaMs <= 0) return true;
  // Relógio do aparelho que andou para trás: registra, em vez de travar para
  // sempre até a sessão acabar.
  if (agoraMs < ultimaMs) return true;
  return agoraMs - ultimaMs >= janelaMs;
};
