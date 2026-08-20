// O MOVIMENTO DO PAINEL DE MENSAGENS — num lugar só.
//
// Está fora do widget por um motivo prático: a bancada (`?chatrailpreview=1`)
// precisa mostrar a MESMA abertura que o produto faz, e uma bancada que repete
// os números à mão mente na primeira vez que alguém ajusta a mola de um lado só.
//
// ── AS ESCOLHAS ──────────────────────────────────────────────────────────────
//
// ORIGEM. O painel cresce do canto inferior direito, que é onde a barra está.
// Sem isso ele cresce do próprio meio e a barra vira um botão sem relação com a
// janela que apareceu.
//
// ENTRAR tem mola: é o movimento que a pessoa acompanha com o olho, e a mola dá
// o peso de uma coisa que chega e assenta. A anterior (460/36/massa 0.8) levava
// perto de 380ms para parar — numa superfície grande, tempo de assentamento é
// lido como lentidão. Esta assenta em pouco mais de 200ms.
//
// SAIR não tem mola, e é mais curto: quem fechou já decidiu. Mola na saída é a
// janela discutindo a decisão — e o olho, que já foi embora, só registra que
// "ainda está lá".
//
// PERCURSO CURTO. 12px e 2% de escala. Um salto maior parece mais "animado" em
// vídeo e mais lento no uso: o conteúdo chega distorcido e o olho espera ele
// parar para começar a ler.
//
// E nada disso acontece para quem pediu menos movimento ao sistema — aí o
// painel simplesmente está lá.
import type { Transition, TargetAndTransition } from 'framer-motion';

export interface AnimacaoDoPainel {
  initial: TargetAndTransition | false;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
}

export const animacaoDoPainel = (semMovimento: boolean | null): AnimacaoDoPainel => ({
  initial: semMovimento ? false : { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: semMovimento
    ? { opacity: 0 }
    : { opacity: 0, y: 6, scale: 0.985, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
  transition: semMovimento
    ? { duration: 0 }
    : { type: 'spring', stiffness: 540, damping: 38, mass: 0.6 },
});

/**
 * A chegada do CONTEÚDO dentro da moldura.
 *
 * O corpo do painel entra um quadro depois da moldura (ver `startTransition` no
 * widget). Sem este esmaecimento curto, esse atraso vira um "pop"; com ele,
 * vira uma chegada. Serve também para a troca de canal no trilho.
 */
export const animacaoDoCorpo = (semMovimento: boolean | null) => ({
  initial: semMovimento ? false : ({ opacity: 0 } as TargetAndTransition),
  animate: { opacity: 1 } as TargetAndTransition,
  transition: (semMovimento ? { duration: 0 } : { duration: 0.14, ease: 'easeOut' }) as Transition,
});
