// O discador está aberto? minimizado? com o quê escrito? — o estado, fora do React.
//
// Mesmo padrão do `callStore` e do `muteStore`: singleton com
// `subscribe`/`getSnapshot` para `useSyncExternalStore`. Aqui o motivo é ainda
// mais direto do que lá — a janela do discador é montada UMA vez, na raiz do
// app (ver `WaCallsHost`), e quem a abre está do outro lado do CRM: o botão da
// barra do topo, o atalho de teclado, um resultado da pesquisa global. Nenhum
// desses lugares é ancestral da janela, então não há contexto React que os
// ligue sem envolver o app inteiro num provider.
//
// O QUE NÃO MORA AQUI: a posição na tela. Ela é do `useDraggablePosition`
// (`callModals.tsx`), que já guarda a dela no localStorage e conhece as regras
// de nunca deixar a peça sair da janela. Guardar posição em dois lugares foi
// exatamente o que fez, num primeiro rascunho, o painel voltar para o canto ao
// ser minimizado e restaurado.

export interface DialerSnapshot {
  /** A janela existe na tela? */
  open: boolean;
  /** Encolhida na barra fina (mas viva, com o número guardado). */
  minimized: boolean;
  /** O que está escrito no campo — número ou nome, cru como foi digitado. */
  draft: string;
  /** Nome de quem foi escolhido na lista, para a barra minimizada dizer quem é. */
  label: string | null;
}

let state: DialerSnapshot = { open: false, minimized: false, draft: '', label: null };

const listeners = new Set<() => void>();

function emit(next: Partial<DialerSnapshot>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export const dialerStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  getSnapshot(): DialerSnapshot {
    return state;
  },

  /**
   * Abre o discador. Com `prefill`, já entra com o número escrito — é o caminho
   * de quem clicou em "Ligar" num resultado da pesquisa global e não quer
   * redigitar nada.
   *
   * Abrir o que já está aberto NÃO limpa o campo: o mesmo atalho apertado duas
   * vezes por reflexo apagaria o número que a pessoa acabou de digitar.
   */
  open(prefill?: { phone?: string; label?: string | null }): void {
    emit({
      open: true,
      minimized: false,
      draft: prefill?.phone ?? state.draft,
      label: prefill?.phone ? (prefill.label ?? null) : state.label,
    });
  },

  /** Fecha e esquece o que estava escrito. É o ✕ — o Esc apenas minimiza. */
  close(): void {
    emit({ open: false, minimized: false, draft: '', label: null });
  },

  minimize(): void {
    if (state.open) emit({ minimized: true });
  },

  restore(): void {
    if (state.open) emit({ minimized: false });
  },

  /** O atalho de teclado: abre, ou traz de volta o que estava minimizado. */
  toggle(): void {
    if (!state.open) { this.open(); return; }
    if (state.minimized) { this.restore(); return; }
    this.minimize();
  },

  setDraft(draft: string, label: string | null = null): void {
    emit({ draft, label });
  },
};

export default dialerStore;
