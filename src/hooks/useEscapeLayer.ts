// O ESC DESCE UMA CAMADA POR VEZ — e a pilha é UMA SÓ para o CRM inteiro.
//
// Cada caixa do sistema escutava o Esc por conta própria, no `window`. Com duas
// abertas (a ficha do cliente e, por cima dela, o formulário de edição; a
// conversa e, por cima, o modal de lançamento), um único toque fechava todas ao
// mesmo tempo — e às vezes levava junto a tela de trás, porque o teclado da
// inbox também estava ouvindo. Quem apertou Esc pediu para voltar UM passo.
//
// Por que uma pilha global e não uma por família de modal: as camadas se
// misturam de verdade. Um `WaDialog` abre de dentro de um `Modal`, que abriu de
// dentro de um `WaOverlay`. Pilhas separadas voltariam a fechar duas de uma vez,
// só que agora entre famílias diferentes — o mesmo defeito, mais difícil de ver.
//
// Quem NÃO usa isto: quem não é camada. A inbox (`inboxKeyboard`) continua com a
// escada dela e já se cala sozinha enquanto existe um `[role="dialog"]` na tela.
import { useEffect, useRef } from 'react';

/** Ids das camadas abertas, da mais antiga à mais recente. */
const stack: string[] = [];

/** Quantas camadas estão abertas agora (para quem precisa decidir com isso). */
export function escapeLayerCount(): number {
  return stack.length;
}

/**
 * Registra esta camada na pilha do Esc.
 *
 * @param ativa  `false` desregistra (modal fechado, sem desmontar o componente).
 * @param onEscape  chamado SÓ quando esta camada é a do topo.
 */
export function useEscapeLayer(ativa: boolean, onEscape: () => void): void {
  // O callback muda a cada render de quem chama; o ouvinte não pode ser
  // recriado por isso (recriar move a camada para o topo da pilha).
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!ativa) return;
    const id = `esc-${Math.random().toString(36).slice(2)}`;
    stack.push(id);
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (stack[stack.length - 1] !== id) return;
      // Impede que a camada de baixo (e o teclado da inbox) veja o mesmo toque.
      event.stopPropagation();
      onEscapeRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [ativa]);
}

export default useEscapeLayer;
