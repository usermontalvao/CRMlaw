// ── Sala de controle dos áudios da thread ───────────────────────────────────
//
// Cada bolha de áudio é um componente isolado e não enxerga as vizinhas; sem um
// ponto comum, dois áudios tocavam ao mesmo tempo (bastava clicar no segundo sem
// pausar o primeiro) e nada emendava um no outro. Este registro é esse ponto:
// cada player se anuncia pelo id da mensagem e oferece "toque" e "pause".
//
// Mora em módulo próprio (e não dentro de `messageBubble`) porque o compositor
// também precisa silenciar a thread — ao começar uma gravação, o áudio que
// estava tocando tem de parar, senão ele entra no microfone.
export interface ControleDeAudio {
  tocar: () => void;
  pausar: () => void;
}

export const audiosDaThread = new Map<string, ControleDeAudio>();

/** Silencia todos os outros áudios. Um por vez, como no WhatsApp. */
export function pausarOsOutrosAudios(idQueVaiTocar: string): void {
  audiosDaThread.forEach((controle, id) => { if (id !== idQueVaiTocar) controle.pausar(); });
}

/** Silencia a thread inteira — usado quando a gravação começa. */
export function pausarTodosOsAudios(): void {
  audiosDaThread.forEach(controle => controle.pausar());
}
