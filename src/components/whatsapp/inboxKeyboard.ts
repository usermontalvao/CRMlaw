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
  | { kind: 'blurSearch' }
  | { kind: 'cancelRecording' }
  | { kind: 'closeOverlay' }
  | { kind: 'cancelCompose' }
  | { kind: 'closeConversation' };

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
  /** Gravando áudio agora. */
  recording?: boolean;
  /** Menu flutuante aberto no compositor (anexos, emoji, GIF, modelos). */
  overlayOpen?: boolean;
  /** Compondo em cima de outra mensagem: editando ou respondendo. */
  composing?: boolean;
  /** Há rascunho escrito no compositor. */
  hasDraft?: boolean;
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
 * O Esc de aplicativo: DESFAZ UMA COISA POR VEZ, da mais recente para a mais
 * antiga, e nunca duas de uma vez.
 *
 * É assim que todo programa de mesa se comporta, e a ordem não é arbitrária —
 * ela é a pilha do que o usuário abriu. Cada Esc tira o item do topo; apertar
 * várias vezes desfaz a pilha inteira, um passo de cada vez, e cada passo é
 * previsível porque desfaz exatamente o que foi feito por último.
 *
 *   1. Gravando        → descarta a gravação. Fica no topo por ser o único
 *                        estado que continua CONSUMINDO algo (o microfone
 *                        aberto) e o único cujo acidente sai do CRM e chega ao
 *                        cliente. Quem aperta Esc gravando quer parar agora.
 *   2. Menu aberto     → fecha o menu (anexos, emoji, GIF, modelos).
 *   3. Editando/       → sai do modo, devolvendo o compositor ao normal.
 *      respondendo
 *   4. Busca           → limpa o texto; já vazia, devolve o foco à lista.
 *   5. Rascunho escrito→ NADA. É a exceção deliberada da cadeia: apagar
 *                        parágrafos digitados com uma tecla, sem desfazer, é
 *                        perder trabalho — o oposto do que o Esc promete. Quem
 *                        quer limpar seleciona e apaga.
 *   6. Conversa aberta → fecha a conversa e volta à lista. Só no fim, quando não
 *                        há mais nada por cima; é o "voltar" da tela.
 */
function escapeAction(ctx: InboxKeyContext): InboxKeyAction | null {
  if (ctx.recording) return { kind: 'cancelRecording' };
  if (ctx.overlayOpen) return { kind: 'closeOverlay' };
  if (ctx.composing) return { kind: 'cancelCompose' };
  if (ctx.inSearch) return ctx.hasSearch ? { kind: 'clearSearch' } : { kind: 'blurSearch' };
  if (ctx.hasDraft) return null;
  if (ctx.selectedId) return { kind: 'closeConversation' };
  return null;
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

  if (event.key === 'Escape') return escapeAction(ctx);

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
