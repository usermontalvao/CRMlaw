/**
 * Onde o painel da chamada fica na tela — a conta pura por trás do arrasto.
 *
 * O painel virou uma janelinha flutuante (antes era um modal com scrim, que
 * impedia o operador de fazer qualquer outra coisa enquanto falava). Como ele
 * agora é arrastável e sobrevive à troca de tela, três regras precisam valer
 * sempre e são testáveis sem navegador:
 *
 *   1. nasce num canto previsível (inferior direito, acima do launcher do chat);
 *   2. nunca some para fora da janela — nem ao arrastar, nem quando a janela é
 *      redimensionada depois (o caso que deixaria o botão "encerrar"
 *      inalcançável, com a ligação de pé);
 *   3. a posição guardada no localStorage é lida com desconfiança: qualquer
 *      coisa que não seja um par de números vira "usa o padrão".
 *
 * Sem imports de propósito: `npm test` roda via ts-node e qualquer import
 * relativo sem extensão na cadeia derruba a suíte inteira.
 */

export interface CallWidgetPoint { x: number; y: number }
export interface CallWidgetBox { width: number; height: number }

/** Respiro mínimo entre o painel e a borda da janela. */
export const CALL_WIDGET_MARGIN = 16;

/** Espaço reservado no canto inferior direito para o launcher do chat da equipe. */
const CHAT_LAUNCHER_CLEARANCE = 84;

/** Canto inferior direito, logo acima do launcher do chat. */
export function defaultCallWidgetPosition(viewport: CallWidgetBox, size: CallWidgetBox): CallWidgetPoint {
  return clampCallWidgetPosition(
    {
      x: viewport.width - size.width - CALL_WIDGET_MARGIN,
      y: viewport.height - size.height - CHAT_LAUNCHER_CLEARANCE,
    },
    viewport,
    size,
  );
}

/**
 * Puxa o ponto para dentro da janela.
 *
 * Numa janela menor que o próprio painel (celular deitado, CRM em meia tela) o
 * limite inferior passa a ser maior que o superior; nesse caso vence a margem
 * de cima e à esquerda, porque é onde estão o rosto e o cronômetro — o que a
 * pessoa precisa ver mesmo sem caber tudo.
 */
export function clampCallWidgetPosition(
  point: CallWidgetPoint,
  viewport: CallWidgetBox,
  size: CallWidgetBox,
): CallWidgetPoint {
  const maxX = viewport.width - size.width - CALL_WIDGET_MARGIN;
  const maxY = viewport.height - size.height - CALL_WIDGET_MARGIN;
  return {
    x: Math.round(Math.max(CALL_WIDGET_MARGIN, Math.min(point.x, Math.max(CALL_WIDGET_MARGIN, maxX)))),
    y: Math.round(Math.max(CALL_WIDGET_MARGIN, Math.min(point.y, Math.max(CALL_WIDGET_MARGIN, maxY)))),
  };
}

/**
 * Alto e ao centro — onde nasce o convite de chamada recebida.
 *
 * É o único lugar do alto que não briga com a coluna de avisos de mensagem
 * nova (canto superior direito), e é para lá que os olhos vão quando algo
 * aparece de repente.
 */
export function topCenterPosition(viewport: CallWidgetBox, size: CallWidgetBox): CallWidgetPoint {
  return clampCallWidgetPosition(
    { x: (viewport.width - size.width) / 2, y: CALL_WIDGET_MARGIN },
    viewport,
    size,
  );
}

/** Lê a posição guardada. Devolve `null` para qualquer coisa suspeita. */
export function parseStoredPosition(raw: string | null): CallWidgetPoint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { x, y } = parsed as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}
