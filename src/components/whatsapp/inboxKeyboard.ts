// Atalhos de teclado da inbox.
//
// Atender pelo mouse custa uma viagem de ida e volta por conversa: achar a linha
// na lista, mirar, clicar, voltar para o teclado para responder. Quem atende
// dezenas de conversas por dia faz isso centenas de vezes. Aqui a inbox ganha o
// que todo cliente de e-mail sério tem há décadas — andar pela fila sem tirar as
// mãos do teclado.
//
// PURO DE PROPÓSITO: nenhum import, nenhum acesso ao DOM. Recebe a descrição do
// que aconteceu e devolve a AÇÃO a executar; quem chama é que mexe no React e no
// DOM. É o que permite testar "seta para baixo na última conversa" sem montar a
// aplicação inteira.

/** O que o módulo deve fazer em resposta à tecla. `null` = deixar passar. */
export type InboxKeyAction =
  | { kind: 'select'; conversationId: string }
  | { kind: 'focusSearch' }
  | { kind: 'clearSearch' }
  | { kind: 'blurSearch' };

export interface InboxKeyContext {
  /** Ids das conversas na ordem em que estão na tela (já filtradas). */
  visibleIds: string[];
  /** Conversa aberta agora. */
  selectedId: string | null;
  /** O foco está num campo de texto (composer, busca, modal…). */
  typing: boolean;
  /** O foco está especificamente no campo de busca da lista. */
  inSearch: boolean;
  /** Há busca digitada. */
  hasSearch: boolean;
  /** Há um modal/diálogo aberto — o teclado é dele, não nosso. */
  dialogOpen: boolean;
}

export interface InboxKeyEvent {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Vizinho na lista visível. Passo +1 desce, -1 sobe.
 *
 * Sem conversa aberta (ou com uma que sumiu do filtro), entra pela ponta
 * correspondente ao sentido: descer começa na primeira, subir na última. Nas
 * extremidades não circula — dar a volta faz quem está varrendo a fila voltar ao
 * começo sem perceber que chegou ao fim.
 */
export function neighbourId(visibleIds: string[], selectedId: string | null, step: 1 | -1): string | null {
  if (visibleIds.length === 0) return null;
  const current = selectedId ? visibleIds.indexOf(selectedId) : -1;
  if (current < 0) return step === 1 ? visibleIds[0] : visibleIds[visibleIds.length - 1];
  const next = current + step;
  if (next < 0 || next >= visibleIds.length) return null;
  return visibleIds[next];
}

/**
 * Traduz uma tecla na ação da inbox. `null` quando a tecla não é nossa — e a
 * regra mais importante deste módulo é justamente devolver `null` com folga:
 * roubar uma tecla de dentro do compositor (ou de um modal) estraga o que o
 * atendente está digitando, e um atalho que atrapalha é pior que atalho nenhum.
 */
export function resolveInboxKey(event: InboxKeyEvent, ctx: InboxKeyContext): InboxKeyAction | null {
  if (ctx.dialogOpen) return null;
  // Combinações do sistema/navegador (Ctrl+A, Cmd+C…) passam direto. A exceção
  // é o Ctrl/Cmd+K, tratado logo abaixo.
  const comando = event.ctrlKey || event.metaKey;

  if (comando && (event.key === 'k' || event.key === 'K')) return { kind: 'focusSearch' };

  if (event.key === 'Escape') {
    if (ctx.inSearch) return ctx.hasSearch ? { kind: 'clearSearch' } : { kind: 'blurSearch' };
    return null; // fora da busca, o Esc é do compositor/modal
  }

  if (comando && !event.altKey) return null;

  const desce = event.key === 'ArrowDown';
  const sobe = event.key === 'ArrowUp';
  if (!desce && !sobe) return null;

  // Digitando: só com Alt. Sem isso, as setas do compositor moveriam o cursor E
  // trocariam de conversa ao mesmo tempo.
  if (ctx.typing && !event.altKey) return null;

  const id = neighbourId(ctx.visibleIds, ctx.selectedId, desce ? 1 : -1);
  return id ? { kind: 'select', conversationId: id } : null;
}

/** Nomes de elementos que capturam digitação. */
const CAMPOS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * O elemento em foco recebe digitação? Vive aqui (e não no componente) porque a
 * decisão anda junto das regras acima, mas é a única função do módulo que
 * conhece o DOM — por isso recebe o elemento em vez de ir buscá-lo.
 */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (CAMPOS.has(el.tagName)) return true;
  return (el as HTMLElement).isContentEditable === true;
}
