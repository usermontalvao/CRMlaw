/**
 * O MENU DA MENSAGEM, sem tela.
 *
 * Aqui moram as três decisões que o clique direito (e o toque prolongado, e a
 * setinha do hover) precisam tomar antes de qualquer pixel aparecer:
 *
 *  1. **O que esta mensagem sabe fazer** (`messageMenuCapabilities`) — as regras
 *     já existiam espalhadas dentro da bolha; o álbum não as enxergava e por
 *     isso ficava sem menu. Trazidas para cá, a bolha e a miniatura do álbum
 *     respondem a MESMA pergunta sobre a MESMA mensagem.
 *  2. **O que copiar** (`textoParaCopiar`) — o conteúdo VISÍVEL, e só ele: sem a
 *     assinatura que a bolha esconde, sem as marcas do WhatsApp e, no modo
 *     privado, mascarado como está na tela.
 *  3. **Onde o menu cabe** (`clampMenuPosition`) — a mesma conta para a âncora
 *     do botão e para o ponto do ponteiro, porque nos dois casos o problema é o
 *     mesmo: a mensagem no rodapé da conversa, ou colada na borda direita.
 *
 * Sem imports de propósito: `npm test` roda via ts-node e qualquer import
 * relativo sem extensão na cadeia derruba a suíte inteira. O que este módulo
 * precisa de fora (tirar marcas, tirar assinatura, mascarar) entra por
 * parâmetro — ver `TextoVisivelDeps`.
 */

// ── Entrada mínima ───────────────────────────────────────────────────────────
// Não é a `WhatsAppMessage`: é só o pedaço dela de que as regras dependem.
// Estrutural de propósito — mantém o módulo sem imports e deixa o teste montar
// uma mensagem de duas linhas em vez de trinta campos nulos.
export interface MensagemDoMenu {
  id?: string;
  type: string;
  direction: 'in' | 'out';
  content?: string | null;
  evolution_message_id?: string | null;
  storage_path?: string | null;
  transcription_status?: string | null;
  transcription_text?: string | null;
  deleted_at?: string | null;
  /** Estado de entrega vindo do servidor; `'failed'` também marca falha. */
  status?: string | null;
  /** Marca de mensagem ainda em voo (id temporário do otimismo local). */
  _tempId?: string | null;
  _local?: string | null;
}

/** O que o HOST oferece. Ausente = o recurso não existe nesta tela. */
export interface RecursosDoHost {
  temEncaminhar: boolean;
  temApagar: boolean;
  /** Copiar o conteúdo visível para a área de transferência. */
  temCopiar: boolean;
  temReagir: boolean;
  /** "Criar prazo"/"Criar tarefa" — só o módulo cheio oferece. */
  temAcompanhamentos: boolean;
  /** Editar mensagem enviada. */
  temEditar: boolean;
  /** Reenviar arquivo já entregue. */
  temReenviar: boolean;
}

export interface CapacidadesDaMensagem {
  responder: boolean;
  copiar: boolean;
  encaminhar: boolean;
  editar: boolean;
  reenviar: boolean;
  acompanhamentos: boolean;
  apagarAqui: boolean;
  apagarParaTodos: boolean;
  reagir: boolean;
}

const emVoo = (m: MensagemDoMenu): boolean => m._local === 'uploading' || m._local === 'sending';
// Falha tem duas origens: a fila local (`_local`) e o que o servidor gravou.
// A bolha já lia as duas — ler só uma aqui reabriria ações numa mensagem que
// não saiu.
const falhou = (m: MensagemDoMenu): boolean => m._local === 'failed' || m.status === 'failed';

/**
 * O que esta mensagem aceita agora.
 *
 * As regras são as MESMAS que a bolha já aplicava — nada foi afrouxado. O que
 * mudou é que elas agora respondem para quem perguntar: a bolha, a miniatura do
 * álbum e o menu do clique direito.
 */
export function messageMenuCapabilities(
  m: MensagemDoMenu,
  host: RecursosDoHost,
): CapacidadesDaMensagem {
  const apagada = !!m.deleted_at;
  const ocupada = emVoo(m);
  const erro = falhou(m);
  const temporaria = !!m._tempId;

  if (apagada) {
    // Mensagem apagada não tem conteúdo — e um menu sobre o vazio só ofereceria
    // ações que não têm sobre o que agir.
    return {
      responder: false, copiar: false, encaminhar: false, editar: false, reenviar: false,
      acompanhamentos: false, apagarAqui: false, apagarParaTodos: false, reagir: false,
    };
  }

  const saiu = m.direction === 'out';
  const apagarAqui = host.temApagar && !ocupada && !temporaria;
  const apagarParaTodos = apagarAqui && saiu && !erro && !!m.evolution_message_id;

  return {
    responder: true,
    copiar: host.temCopiar && temTextoCopiavel(m),
    encaminhar: host.temEncaminhar && !ocupada && !erro
      && (m.type === 'text' || m.type === 'contact' ? !!m.content : !!m.storage_path),
    editar: host.temEditar && saiu && m.type === 'text' && !!m.evolution_message_id && !ocupada && !erro,
    reenviar: host.temReenviar && saiu && !ocupada && !erro && m.type !== 'text' && !!m.storage_path,
    acompanhamentos: host.temAcompanhamentos && !temporaria,
    apagarAqui,
    apagarParaTodos,
    reagir: host.temReagir && !ocupada && !erro && !temporaria && !!m.evolution_message_id,
  };
}

// ── Itens do menu ────────────────────────────────────────────────────────────

export type MessageMenuActionId =
  | 'reply' | 'copy' | 'forward' | 'edit' | 'resend'
  | 'deadline' | 'task' | 'delete-everyone' | 'delete-local';

export interface MessageMenuItem {
  id: MessageMenuActionId;
  label: string;
  /** Ação irreversível: sai em vermelho, como no WhatsApp. */
  danger?: boolean;
  /** Um fio separando do item anterior. */
  separaAntes?: boolean;
}

/**
 * A lista, na ordem em que aparece. Apagar por último e separado: é a única
 * ação irreversível, e no WhatsApp ela também mora no fim, em vermelho.
 */
export function buildMessageMenuItems(caps: CapacidadesDaMensagem): MessageMenuItem[] {
  const itens: MessageMenuItem[] = [];
  if (caps.responder) itens.push({ id: 'reply', label: 'Responder' });
  if (caps.copiar) itens.push({ id: 'copy', label: 'Copiar' });
  if (caps.encaminhar) itens.push({ id: 'forward', label: 'Encaminhar' });
  if (caps.editar) itens.push({ id: 'edit', label: 'Editar mensagem' });
  if (caps.reenviar) itens.push({ id: 'resend', label: 'Reenviar arquivo' });
  if (caps.acompanhamentos) {
    itens.push({ id: 'deadline', label: 'Criar prazo', separaAntes: itens.length > 0 });
    itens.push({ id: 'task', label: 'Criar tarefa' });
  }
  if (caps.apagarParaTodos) {
    itens.push({ id: 'delete-everyone', label: 'Apagar para todos', danger: true, separaAntes: itens.length > 0 });
  }
  if (caps.apagarAqui) {
    itens.push({
      id: 'delete-local', label: 'Apagar só aqui', danger: true,
      separaAntes: itens.length > 0 && !caps.apagarParaTodos,
    });
  }
  return itens;
}

/** O que cada ação do menu chama. Ausente = o host não oferece aquilo. */
export interface MessageMenuHandlers<M> {
  reply?: (m: M) => void;
  copy?: (m: M) => void;
  forward?: (m: M) => void;
  edit?: (m: M) => void;
  resend?: (m: M) => void;
  deadline?: (m: M) => void;
  task?: (m: M) => void;
  remove?: (m: M, scope: 'me' | 'everyone') => void;
}

/**
 * Despacha o item clicado para o handler, SEMPRE com a mensagem recebida.
 *
 * É por aqui que o álbum deixa de ser um problema: a miniatura passa o item de
 * verdade que foi clicado, e nenhuma parte do caminho tem chance de trocá-lo
 * pela primeira imagem do grupo.
 */
export function runMessageMenuAction<M>(
  id: MessageMenuActionId,
  m: M,
  handlers: MessageMenuHandlers<M>,
): void {
  switch (id) {
    case 'reply': handlers.reply?.(m); return;
    case 'copy': handlers.copy?.(m); return;
    case 'forward': handlers.forward?.(m); return;
    case 'edit': handlers.edit?.(m); return;
    case 'resend': handlers.resend?.(m); return;
    case 'deadline': handlers.deadline?.(m); return;
    case 'task': handlers.task?.(m); return;
    case 'delete-everyone': handlers.remove?.(m, 'everyone'); return;
    case 'delete-local': handlers.remove?.(m, 'me'); return;
  }
}

// ── Copiar ───────────────────────────────────────────────────────────────────

/**
 * As funções de texto que a bolha usa para DESENHAR. Entram por parâmetro
 * porque este módulo não importa nada (ver o cabeçalho): o que se copia tem de
 * ser exatamente o que está na tela, e a única forma honesta de garantir isso é
 * passar pelas mesmas funções.
 */
export interface TextoVisivelDeps {
  /** `waPlainText` — tira `*negrito*`, `_itálico_`, ```` ```mono``` ````. */
  semMarcas: (texto: string) => string;
  /** `stripAgentSignature` — tira o `*Dr. Pedro:*` da primeira linha. */
  semAssinatura: (texto: string) => string;
  /** `maskSensitive` — CPF e telefone viram `***`. Só no modo privado. */
  mascarar: (texto: string) => string;
}

/**
 * O texto CRU que esta mensagem tem para copiar, antes de qualquer tratamento.
 * `null` = não há o que copiar, e a ação nem aparece no menu.
 */
export function fonteDoTextoCopiavel(m: MensagemDoMenu): string | null {
  if (m.deleted_at) return null;
  const conteudo = (m.content || '').trim() ? m.content! : null;
  if (conteudo) return conteudo;
  // Áudio sem legenda: o que está escrito na bolha é a transcrição, e é ela que
  // o atendente quer colar no prazo, na tarefa, no e-mail.
  if (m.type === 'audio' && m.transcription_status === 'done' && (m.transcription_text || '').trim()) {
    return m.transcription_text!;
  }
  return null;
}

/** Tem algo para copiar? (Mesma pergunta, sem montar o texto.) */
export function temTextoCopiavel(m: MensagemDoMenu): boolean {
  return fonteDoTextoCopiavel(m) !== null;
}

/**
 * O texto que vai para a área de transferência.
 *
 * A ordem repete a da bolha, e isso não é detalhe: ela mascara o conteúdo CRU e
 * só depois lê as marcas (ver `MessageBubble` + `WaRichText`). Mascarar depois
 * de tirar as marcas deixaria passar um CPF escrito `*123.456.789-00*`.
 *
 * A assinatura só sai de mensagem NOSSA de texto — que é exatamente onde a
 * bolha a esconde. Na legenda de uma mídia ela aparece na tela, então é copiada.
 */
export function textoParaCopiar(
  m: MensagemDoMenu,
  opcoes: { privateMode?: boolean },
  deps: TextoVisivelDeps,
): string | null {
  const cru = fonteDoTextoCopiavel(m);
  if (cru === null) return null;
  const visivel = opcoes.privateMode ? deps.mascarar(cru) : cru;
  const escondeAssinatura = m.direction === 'out' && m.type === 'text';
  return deps.semMarcas(escondeAssinatura ? deps.semAssinatura(visivel) : visivel);
}

// ── Posição do menu ──────────────────────────────────────────────────────────

/** Folga mínima entre o menu e qualquer borda da janela. */
export const MENU_MARGIN = 8;
/** Respiro entre o menu e a âncora que o abriu. */
export const MENU_GAP = 6;
/** Altura de um item; a conta da altura estimada sai daqui. */
export const MENU_ITEM_HEIGHT = 42;

export interface Retangulo { top: number; bottom: number; left: number; right: number }
export interface Tamanho { width: number; height: number }
export interface Viewport { width: number; height: number }

/**
 * De onde o menu nasce.
 *
 * `ponteiro` é o clique direito e o toque prolongado (o menu encosta no dedo);
 * `retangulo` é a setinha do hover (o menu pende do botão). Duas formas, uma
 * conta só — as bordas da janela não sabem qual gesto abriu o menu.
 */
export type AncoraDoMenu =
  | { tipo: 'ponteiro'; x: number; y: number }
  | { tipo: 'retangulo'; rect: Retangulo };

/**
 * Onde desenhar o menu para ele caber inteiro na janela.
 *
 * Não cabendo abaixo, ele vira para cima — e é isso que salva a última mensagem
 * da conversa, aquela colada no compositor. `alinharDireita` reflete o lado da
 * bolha: o que sai do escritório abre com a borda direita na âncora, como no
 * WhatsApp.
 */
export function clampMenuPosition(entrada: {
  ancora: AncoraDoMenu;
  tamanho: Tamanho;
  viewport: Viewport;
  alinharDireita?: boolean;
}): { top: number; left: number } {
  const { ancora, tamanho, viewport, alinharDireita = false } = entrada;
  const { width, height } = tamanho;

  let topoPreferido: number;
  let topoAlternativo: number;
  let esquerdaPreferida: number;
  if (ancora.tipo === 'ponteiro') {
    topoPreferido = ancora.y;
    topoAlternativo = ancora.y - height;
    esquerdaPreferida = alinharDireita ? ancora.x - width : ancora.x;
  } else {
    topoPreferido = ancora.rect.bottom + MENU_GAP;
    topoAlternativo = ancora.rect.top - height - MENU_GAP;
    esquerdaPreferida = alinharDireita ? ancora.rect.right - width : ancora.rect.left;
  }

  const cabeAbaixo = topoPreferido + height <= viewport.height - MENU_MARGIN;
  const top = cabeAbaixo
    ? Math.max(MENU_MARGIN, topoPreferido)
    // Virando para cima, o menu ainda pode ser mais alto que a janela inteira
    // (catálogo de emoji em tela curta): a margem de cima ganha, e o resto
    // sangra para baixo — melhor perder o pé do que o cabeçalho.
    : Math.max(MENU_MARGIN, Math.min(topoAlternativo, viewport.height - height - MENU_MARGIN));

  const left = Math.min(
    Math.max(MENU_MARGIN, viewport.width - width - MENU_MARGIN),
    Math.max(MENU_MARGIN, esquerdaPreferida),
  );

  return { top, left };
}

/**
 * Altura estimada do menu, do jeito que ele é desenhado: os itens, os fios
 * entre os blocos, o respiro de cima e de baixo e — quando o menu do clique
 * direito mostra as reações — a faixa de emojis no topo.
 *
 * Estimativa, e não medição, porque a decisão de virar para cima precisa ser
 * tomada ANTES de o menu existir no DOM. Errar por alguns pixels é inofensivo;
 * medir depois faria o menu piscar de lugar.
 */
export function estimateMenuHeight(itens: MessageMenuItem[], comFaixaDeReacoes = false): number {
  const fios = itens.filter(i => i.separaAntes).length;
  return itens.length * MENU_ITEM_HEIGHT + fios * 9 + 12 + (comFaixaDeReacoes ? 41 : 0);
}
