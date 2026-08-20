// "ESTOU DENTRO DO WIDGET?" — a pergunta que decide a camada de um modal.
//
// O widget flutuante de conversas vive ACIMA dos modais (`LAYER.WIDGET`), e
// tem de viver: quase todo clique que traz uma conversa para ele parte de uma
// ficha ABERTA. Antes disso o painel subia atrás do modal que o chamou — a
// conversa abria de verdade, e ninguém via.
//
// Só que o widget embute o módulo do WhatsApp inteiro, e de lá de dentro se
// abre prazo, processo, requerimento, compromisso, ficha do cliente — os
// MESMOS modais dos módulos, que moram na faixa MODAL (70). Aberta de dentro
// do widget, cada uma dessas caixas ficaria atrás do widget que a abriu: o
// mesmo defeito, invertido.
//
// A saída é esta: o widget marca o território, e quem desenha um modal pergunta
// em que faixa deve entrar em vez de fixar o número. O modal compartilhado não
// sabe (nem precisa saber) onde está sendo renderizado — o portal do React
// carrega o contexto junto, mesmo quando o DOM sai para o `body`.
import React, { createContext, useContext } from 'react';
import { LAYER } from './layers';

const DentroDoWidget = createContext(false);

/** Tudo que for renderizado aqui dentro desenha na faixa do widget. */
export const ModalLayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DentroDoWidget.Provider value={true}>{children}</DentroDoWidget.Provider>
);

/**
 * A camada em que este modal deve entrar.
 *
 * Fora do widget devolve o que foi pedido, sem mexer. Dentro dele, traduz a
 * faixa dos modais para a faixa do widget PRESERVANDO A ORDEM entre irmãos:
 * MODAL vira o primeiro degrau, MODAL_NESTED o segundo, POPOVER o terceiro —
 * um modal aberto de dentro de outro continua na frente dele.
 *
 * O que já é mais alto que um aviso (chamada, PIN, tela de bloqueio) passa
 * intacto: aquilo tem de ficar acima do widget de qualquer maneira.
 */
export function useModalLayer(base: number = LAYER.MODAL): number {
  const dentro = useContext(DentroDoWidget);
  if (!dentro || base >= LAYER.NOTICE) return base;
  const degrau = Math.max(0, Math.round((base - LAYER.MODAL) / 10));
  return Math.min(LAYER.WIDGET_NESTED + degrau, LAYER.WIDGET_NESTED + 4);
}

export default useModalLayer;
