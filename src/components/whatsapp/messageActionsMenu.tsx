// O MENU DE UMA MENSAGEM — o painel e os gestos que o abrem.
//
// Um lugar só, porque agora são DOIS os consumidores: a bolha comum
// (`MessageBubble`) e cada miniatura de um álbum de imagens (`ImageAlbum`).
// O álbum ficava sem menu justamente por não haver nada compartilhável aqui —
// tudo morava dentro da bolha.
//
// Três portas abrem o mesmo painel:
//   · a setinha do hover (como sempre foi);
//   · o CLIQUE DIREITO, na posição do ponteiro (é o gesto do WhatsApp Web);
//   · o TOQUE PROLONGADO, em telas de toque.
//
// As regras (o que a mensagem aceita, o que copiar, onde o painel cabe) moram
// em `messageMenu.ts`, puro e testado. Aqui é só tela, foco e gesto.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban, Calendar, Copy, CornerUpLeft, Forward, ListTodo, Pencil, Plus, RotateCcw, Trash2,
} from 'lucide-react';
import {
  buildMessageMenuItems, clampMenuPosition, estimateMenuHeight, messageMenuCapabilities,
  runMessageMenuAction, textoParaCopiar,
  type AncoraDoMenu, type CapacidadesDaMensagem, type MessageMenuActionId, type MessageMenuItem,
} from './messageMenu';
import { REACOES_RAPIDAS } from './emojiData';
import { EmojiPicker } from './emojiPicker';
import { maskSensitive } from './format';
import { stripAgentSignature, waPlainText } from './waRichText';
import { ACTOR_ESCRITORIO, proximaReacao, reacaoDe } from '../../utils/waReactions';
import { LAYER } from '../../styles/layers';
import { useModalLayer } from '../../styles/modalLayer';
import type { WhatsAppDeleteScope, WhatsAppMessage } from '../../types/whatsapp.types';

/** Só um menu de mensagem por vez em toda a thread. */
const WA_MESSAGE_MENU_EVENT = 'wa-message-menu-open';

const MENU_LARGURA = 192;
/** Com a faixa de reações no topo, o painel precisa caber sete botões. */
const MENU_LARGURA_COM_REACOES = 236;
/** Barra de reação rápida solta (a do botão SmilePlus): seis emojis + o catálogo. */
export const WA_REACT_BAR_WIDTH = 268;
const WA_REACT_PICKER_WIDTH = 300;
const WA_REACT_PICKER_HEIGHT = 320;

/**
 * Quanto tempo o dedo precisa ficar parado. Abaixo de meio segundo o menu
 * aparecia no meio de uma rolagem; acima de 600 ms o gesto parece travado.
 */
const TOQUE_LONGO_MS = 550;
/** Movimento que denuncia rolagem, e não intenção de abrir o menu. */
const TOQUE_LONGO_TOLERANCIA_PX = 10;
/** Janela em que o clique fantasma do toque ainda pode chegar. */
const CLIQUE_FANTASMA_MS = 700;

const ICONE: Record<MessageMenuActionId, React.ReactNode> = {
  reply: <CornerUpLeft size={15} />,
  copy: <Copy size={15} />,
  forward: <Forward size={15} />,
  edit: <Pencil size={15} />,
  resend: <RotateCcw size={15} />,
  deadline: <Calendar size={15} />,
  task: <ListTodo size={15} />,
  'delete-everyone': <Ban size={15} />,
  'delete-local': <Trash2 size={15} />,
};

/**
 * O que o host sabe fazer com a mensagem. É o MESMO contrato da bolha — a
 * ausência de um callback é o que apaga o item do menu, e não um sinalizador
 * separado que poderia divergir dele.
 */
export interface MessageMenuActions {
  onReply?: (m: WhatsAppMessage) => void;
  onEdit?: (m: WhatsAppMessage) => void;
  onForward?: (m: WhatsAppMessage) => void;
  onResend?: (m: WhatsAppMessage) => void;
  onCreateDeadline?: (m: WhatsAppMessage) => void;
  onCreateTask?: (m: WhatsAppMessage) => void;
  onDelete?: (m: WhatsAppMessage, scope: WhatsAppDeleteScope) => void;
  onReact?: (m: WhatsAppMessage, emoji: string) => void;
  /**
   * Copiar. Recebe o TEXTO JÁ PRONTO — o que está na tela, sem marcas, sem a
   * assinatura escondida e, no modo privado, mascarado. A bolha não fala com o
   * toast: quem anuncia sucesso ou falha é o host (ver `bubbleHandlers`).
   */
  onCopy?: (m: WhatsAppMessage, texto: string) => void;
}

export interface UseMessageMenuOptions {
  m: WhatsAppMessage;
  /** Mensagem do escritório: o painel abre alinhado pela direita. */
  out: boolean;
  privateMode?: boolean;
  canCreateFollowups?: boolean;
  actions: MessageMenuActions;
}

type ModoDoPainel = 'menu' | 'reacoes' | 'catalogo';

interface EstadoDoPainel {
  modo: ModoDoPainel;
  ancora: AncoraDoMenu;
  /** Abriu pelo teclado: o foco entra no menu. */
  foco: boolean;
}

/** O elemento clicado é um controle interno que tem o próprio comportamento? */
function ehControleInterno(alvo: EventTarget | null): boolean {
  const el = alvo instanceof Element ? alvo : null;
  if (!el) return false;
  return !!el.closest('a[href], audio, video, input, textarea, select, [role="slider"], [data-wa-controle]');
}

/**
 * Toda a máquina do menu de uma mensagem: estado, posição, gestos e o painel.
 *
 * Devolve conjuntos de props prontos para espalhar — `surfaceProps` na área
 * clicável da mensagem, `triggerProps` na setinha. Assim a bolha e a miniatura
 * do álbum ganham exatamente o mesmo comportamento sem copiar uma linha.
 */
export function useMessageMenu({ m, out, privateMode, canCreateFollowups, actions }: UseMessageMenuOptions) {
  // O painel sai em portal para o `body`: fora do widget é a camada dos menus;
  // dentro dele, a faixa do widget (`styles/modalLayer`).
  const camada = useModalLayer(LAYER.POPOVER);
  const [painel, setPainel] = useState<EstadoDoPainel | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const reactTriggerRef = useRef<HTMLButtonElement | null>(null);
  const itensRef = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = m._tempId || m.id;

  const caps: CapacidadesDaMensagem = useMemo(() => messageMenuCapabilities(m, {
    temEncaminhar: !!actions.onForward,
    temApagar: !!actions.onDelete,
    temCopiar: !!actions.onCopy,
    temReagir: !!actions.onReact,
    temAcompanhamentos: !!canCreateFollowups,
    temEditar: !!actions.onEdit,
    temReenviar: !!actions.onResend,
  }), [m, actions, canCreateFollowups]);

  const itens = useMemo(() => buildMessageMenuItems(caps), [caps]);
  const minhaReacao = reacaoDe(m.reactions, ACTOR_ESCRITORIO);
  const mostrarReacoes = caps.reagir;

  // ── Abrir e fechar ─────────────────────────────────────────────────────────

  const fechar = useCallback((devolverFoco = false) => {
    setPainel(null);
    if (devolverFoco) triggerRef.current?.focus();
  }, []);

  const abrir = useCallback((modo: ModoDoPainel, ancora: AncoraDoMenu, foco = false) => {
    window.dispatchEvent(new CustomEvent(WA_MESSAGE_MENU_EVENT, { detail: menuId }));
    setPainel({ modo, ancora, foco });
  }, [menuId]);

  // Cada bolha é um componente isolado; sem este aviso, dois menus ficavam
  // abertos ao mesmo tempo em mensagens diferentes.
  useEffect(() => {
    const fecharOsOutros = (evento: Event) => {
      if ((evento as CustomEvent<string>).detail === menuId) return;
      setPainel(null);
    };
    window.addEventListener(WA_MESSAGE_MENU_EVENT, fecharOsOutros);
    return () => window.removeEventListener(WA_MESSAGE_MENU_EVENT, fecharOsOutros);
  }, [menuId]);

  // O painel usa coordenadas da viewport e fecha quando a âncora deixa de ser
  // confiável — rolar a thread ou redimensionar a janela move a bolha embaixo dele.
  useEffect(() => {
    if (!painel) return;
    const sair = () => setPainel(null);
    // Escape em CAPTURA: aberto pelo ponteiro, o foco não está dentro do menu —
    // um `onKeyDown` no painel nunca receberia a tecla. E parar a propagação
    // impede que o mesmo Escape feche a conversa atrás dele.
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      evento.stopPropagation();
      fechar(true);
    };
    window.addEventListener('resize', sair);
    window.addEventListener('scroll', sair, true);
    window.addEventListener('keydown', aoTeclar, true);
    return () => {
      window.removeEventListener('resize', sair);
      window.removeEventListener('scroll', sair, true);
      window.removeEventListener('keydown', aoTeclar, true);
    };
  }, [painel, fechar]);

  // ── Posição ────────────────────────────────────────────────────────────────

  const tamanho = useMemo(() => {
    if (!painel) return { width: 0, height: 0 };
    if (painel.modo === 'catalogo') return { width: WA_REACT_PICKER_WIDTH, height: WA_REACT_PICKER_HEIGHT };
    if (painel.modo === 'reacoes') return { width: WA_REACT_BAR_WIDTH, height: 48 };
    return {
      width: mostrarReacoes ? MENU_LARGURA_COM_REACOES : MENU_LARGURA,
      height: estimateMenuHeight(itens, mostrarReacoes),
    };
  }, [painel, itens, mostrarReacoes]);

  const posicao = useMemo(() => {
    if (!painel || typeof window === 'undefined') return { top: 0, left: 0 };
    return clampMenuPosition({
      ancora: painel.ancora,
      tamanho,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      alinharDireita: out,
    });
  }, [painel, tamanho, out]);

  // ── Gestos ─────────────────────────────────────────────────────────────────

  /** Âncora a partir de um elemento — usada pelo teclado e pela setinha. */
  const ancoraDoElemento = (el: Element | null): AncoraDoMenu | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { tipo: 'retangulo', rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } };
  };

  /** A setinha do hover: abre ancorada nela, e fecha se já estava aberta. */
  const alternarPeloBotao = (evento: React.MouseEvent<HTMLButtonElement>) => {
    evento.stopPropagation();
    if (painel?.modo === 'menu') { fechar(); return; }
    const ancora = ancoraDoElemento(evento.currentTarget);
    if (!ancora) return;
    // `detail === 0` = veio do teclado (Enter/Espaço no botão): aí o foco tem
    // de entrar no menu, senão ele abre e a pessoa fica sem para onde ir.
    abrir('menu', ancora, evento.detail === 0);
  };

  /** Clique direito sobre a mensagem. */
  const aoClicarComBotaoDireito = (evento: React.MouseEvent) => {
    if (ehControleInterno(evento.target)) return;   // link, player: menu do navegador
    evento.preventDefault();
    evento.stopPropagation();
    if (itens.length === 0) return;
    // Tecla de menu de contexto (Shift+F10): não há ponteiro, então o painel
    // se ancora no próprio elemento e o foco entra nele.
    const semPonteiro = evento.button === -1 || (evento.clientX === 0 && evento.clientY === 0);
    if (semPonteiro) {
      const ancora = ancoraDoElemento(evento.currentTarget as Element);
      if (ancora) abrir('menu', ancora, true);
      return;
    }
    abrir('menu', { tipo: 'ponteiro', x: evento.clientX, y: evento.clientY });
  };

  // Toque prolongado. `pressao` guarda o relógio e o ponto de partida; qualquer
  // movimento maior que a tolerância (ou o começo de uma rolagem) desiste.
  const pressao = useRef<{ timer: number; x: number; y: number } | null>(null);
  const fantasma = useRef<number>(0);

  const desistirDoToque = useCallback(() => {
    if (!pressao.current) return;
    window.clearTimeout(pressao.current.timer);
    pressao.current = null;
    window.removeEventListener('scroll', desistirDoToque, true);
  }, []);

  useEffect(() => () => desistirDoToque(), [desistirDoToque]);

  const aoEncostar = (evento: React.PointerEvent) => {
    // Só toque e caneta: no desktop o botão esquerdo parado é SELEÇÃO DE TEXTO,
    // e roubá-la para abrir menu seria tirar da pessoa o gesto de copiar à mão.
    if (evento.pointerType !== 'touch' && evento.pointerType !== 'pen') return;
    if (ehControleInterno(evento.target)) return;
    if (itens.length === 0) return;
    desistirDoToque();
    const { clientX: x, clientY: y } = evento;
    const timer = window.setTimeout(() => {
      pressao.current = null;
      window.removeEventListener('scroll', desistirDoToque, true);
      // O clique fantasma vem logo depois do dedo sair; sem esta marca ele
      // abriria a imagem por baixo do menu que acabou de aparecer.
      fantasma.current = Date.now();
      abrir('menu', { tipo: 'ponteiro', x, y });
    }, TOQUE_LONGO_MS);
    pressao.current = { timer, x, y };
    window.addEventListener('scroll', desistirDoToque, true);
  };

  const aoArrastar = (evento: React.PointerEvent) => {
    const p = pressao.current;
    if (!p) return;
    if (Math.hypot(evento.clientX - p.x, evento.clientY - p.y) > TOQUE_LONGO_TOLERANCIA_PX) desistirDoToque();
  };

  const aoSoltar = () => desistirDoToque();

  const engolirCliqueFantasma = (evento: React.MouseEvent) => {
    if (!fantasma.current) return;
    if (Date.now() - fantasma.current > CLIQUE_FANTASMA_MS) { fantasma.current = 0; return; }
    fantasma.current = 0;
    evento.preventDefault();
    evento.stopPropagation();
  };

  // ── Ações ──────────────────────────────────────────────────────────────────

  const reagir = useCallback((emoji: string) => {
    setPainel(null);
    actions.onReact?.(m, proximaReacao(minhaReacao, emoji));
  }, [actions, m, minhaReacao]);

  const executar = (id: MessageMenuActionId) => {
    setPainel(null);
    runMessageMenuAction(id, m, {
      reply: actions.onReply,
      forward: actions.onForward,
      edit: actions.onEdit,
      resend: actions.onResend,
      deadline: actions.onCreateDeadline,
      task: actions.onCreateTask,
      remove: actions.onDelete,
      copy: (msg) => {
        // O texto sai daqui pronto — as MESMAS funções que a bolha usa para
        // desenhar. No modo privado é o mascarado que viaja; o conteúdo real
        // não passa nem por aqui.
        const texto = textoParaCopiar(msg, { privateMode }, {
          semMarcas: waPlainText, semAssinatura: stripAgentSignature, mascarar: maskSensitive,
        });
        if (texto !== null) actions.onCopy?.(msg, texto);
      },
    });
  };

  /** A barra rápida solta, do botão SmilePlus — o gesto de um toque só. */
  const abrirReacoesSoltas = (comCatalogo: boolean) => {
    const ancora = ancoraDoElemento(reactTriggerRef.current);
    if (!ancora) return;
    abrir(comCatalogo ? 'catalogo' : 'reacoes', ancora);
  };

  // ── Teclado ────────────────────────────────────────────────────────────────

  const focarItem = (indice: number) => {
    const alvos = itensRef.current.filter(Boolean) as HTMLButtonElement[];
    if (alvos.length === 0) return;
    const i = ((indice % alvos.length) + alvos.length) % alvos.length;
    alvos[i]?.focus();
  };

  useEffect(() => {
    if (painel?.modo === 'menu' && painel.foco) focarItem(0);
  }, [painel]);

  const navegarPeloTeclado = (evento: React.KeyboardEvent) => {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      fechar(true);
      return;
    }
    const alvos = itensRef.current.filter(Boolean) as HTMLButtonElement[];
    const atual = alvos.findIndex(el => el === document.activeElement);
    if (evento.key === 'ArrowDown') { evento.preventDefault(); focarItem(atual + 1); return; }
    if (evento.key === 'ArrowUp') { evento.preventDefault(); focarItem(atual <= 0 ? alvos.length - 1 : atual - 1); return; }
    if (evento.key === 'Home') { evento.preventDefault(); focarItem(0); return; }
    if (evento.key === 'End') { evento.preventDefault(); focarItem(alvos.length - 1); }
    // Enter e Espaço não precisam de tratamento: cada item é um <button>, e o
    // navegador já os aciona — reimplementar aqui só criaria um caminho a mais
    // para divergir do clique.
  };

  // ── Painel ─────────────────────────────────────────────────────────────────

  const painelId = `wa-menu-${menuId}`;
  itensRef.current = [];

  const conteudo = painel && (
    painel.modo === 'catalogo' ? (
      <EmojiPicker compacto className="w-[300px]" onPick={reagir} onClose={() => fechar(true)} />
    ) : painel.modo === 'reacoes' ? (
      <BarraDeReacoes minhaReacao={minhaReacao} onReagir={reagir}
        onCatalogo={() => setPainel(p => (p ? { ...p, modo: 'catalogo' } : p))}
        largura={WA_REACT_BAR_WIDTH} />
    ) : (
      <div style={{ width: tamanho.width }}
        className="overflow-hidden rounded-xl bg-white shadow-[0_12px_38px_rgba(15,23,42,0.24)] ring-1 ring-black/[0.08]">
        {/* A faixa de reações no TOPO do menu é o que o WhatsApp Web mostra no
            clique direito. Some quando a mensagem não aceita reação (em voo,
            falhada, sem chave da Evolution). */}
        {mostrarReacoes && (
          <div className="flex items-center justify-between gap-0.5 border-b border-slate-100 px-1.5 py-1">
            {REACOES_RAPIDAS.map(emoji => (
              <button key={emoji} type="button" onClick={() => reagir(emoji)}
                title={minhaReacao === emoji ? 'Remover reação' : `Reagir com ${emoji}`}
                aria-label={minhaReacao === emoji ? `Remover a reação ${emoji}` : `Reagir com ${emoji}`}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[19px] leading-none transition hover:scale-125 active:scale-95 ${
                  minhaReacao === emoji ? 'bg-[#f0f2f5]' : ''}`}>
                {emoji}
              </button>
            ))}
            <button type="button" onClick={() => setPainel(p => (p ? { ...p, modo: 'catalogo' } : p))}
              title="Mais emojis" aria-label="Mais emojis"
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-[#f0f2f5]">
              <Plus size={16} />
            </button>
          </div>
        )}
        <div role="menu" aria-label="Ações da mensagem" onKeyDown={navegarPeloTeclado} className="py-1.5">
          {itens.map((item, i) => (
            <ItemDoMenu key={item.id} item={item}
              ref={el => { itensRef.current[i] = el; }}
              onClick={() => executar(item.id)} />
          ))}
        </div>
      </div>
    )
  );

  const portal = painel && typeof document !== 'undefined' && createPortal(
    <>
      {/* Fecha no PONTEIRO, e não no clique: depois de um toque prolongado o
          clique fantasma cai exatamente aqui e fecharia o menu recém-aberto. */}
      <button
        type="button"
        aria-label="Fechar ações da mensagem"
        className="fixed inset-0 cursor-default bg-transparent"
        style={{ zIndex: camada }}
        onPointerDown={() => fechar()}
        onContextMenu={evento => { evento.preventDefault(); fechar(); }}
      />
      {/* Um fio acima do próprio fundo: os dois são irmãos no mesmo portal, e
          empatados a ordem passaria a depender do JSX. */}
      <div id={painelId} style={{ top: posicao.top, left: posicao.left, zIndex: camada + 1 }}
        className="fixed" onKeyDown={evento => { if (evento.key === 'Escape') { evento.stopPropagation(); fechar(true); } }}>
        {conteudo}
      </div>
    </>,
    document.body,
  );

  return {
    caps,
    itens,
    minhaReacao,
    /** Reagir (ou desfazer) direto — é o que a pastilha na bolha usa. */
    reagir,
    /** O menu de ações está aberto nesta mensagem? */
    menuAberto: painel?.modo === 'menu',
    /** A barra de reação solta (SmilePlus) está aberta? */
    reacoesAbertas: painel?.modo === 'reacoes' || painel?.modo === 'catalogo',
    abrirReacoesSoltas,
    /** Vai na superfície clicável da mensagem. */
    surfaceProps: {
      onContextMenu: aoClicarComBotaoDireito,
      onPointerDown: aoEncostar,
      onPointerMove: aoArrastar,
      onPointerUp: aoSoltar,
      onPointerCancel: aoSoltar,
      onClickCapture: engolirCliqueFantasma,
    },
    /** Vai na setinha de ações. */
    triggerProps: {
      ref: triggerRef,
      // `data-wa-controle`: o toque prolongado sobre a própria setinha não abre
      // o menu duas vezes, e o clique direito nela cai no menu do navegador.
      'data-wa-controle': '',
      onClick: alternarPeloBotao,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': painel?.modo === 'menu',
      'aria-controls': painel?.modo === 'menu' ? painelId : undefined,
    },
    reactTriggerRef,
    portal,
  };
}

/** A barra rápida solta — a que o botão SmilePlus abre, de um toque só. */
const BarraDeReacoes: React.FC<{
  minhaReacao: string | null; largura: number;
  onReagir: (emoji: string) => void; onCatalogo: () => void;
}> = ({ minhaReacao, largura, onReagir, onCatalogo }) => (
  <div role="menu" aria-label="Reagir à mensagem" style={{ width: largura }}
    className="flex items-center gap-0.5 rounded-full bg-white p-1 shadow-[0_12px_38px_rgba(15,23,42,0.24)] ring-1 ring-black/[0.08]">
    {REACOES_RAPIDAS.map(emoji => (
      <button key={emoji} type="button" role="menuitem" onClick={() => onReagir(emoji)}
        title={minhaReacao === emoji ? 'Remover reação' : `Reagir com ${emoji}`}
        aria-label={minhaReacao === emoji ? `Remover a reação ${emoji}` : `Reagir com ${emoji}`}
        className={`flex h-9 w-9 items-center justify-center rounded-full text-[21px] leading-none transition hover:scale-125 active:scale-95 ${
          minhaReacao === emoji ? 'bg-[#f0f2f5]' : ''}`}>
        {emoji}
      </button>
    ))}
    {/* O catálogo inteiro entra por aqui — o mesmo painel da barra de mensagem,
        em modo compacto. */}
    <button type="button" role="menuitem" onClick={onCatalogo} title="Mais emojis" aria-label="Mais emojis"
      className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-[#f0f2f5]">
      <Plus size={17} />
    </button>
  </div>
);

const ItemDoMenu = React.forwardRef<HTMLButtonElement, { item: MessageMenuItem; onClick: () => void }>(
  ({ item, onClick }, ref) => (
    <>
      {item.separaAntes && <div role="separator" className="my-1 border-t border-slate-100" />}
      <button ref={ref} type="button" role="menuitem" tabIndex={-1} onClick={onClick}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition ${
          item.danger
            ? 'text-red-600 hover:bg-red-50 focus:bg-red-50'
            : 'text-slate-700 hover:bg-[#f0f2f5] focus:bg-[#f0f2f5]'} focus:outline-none`}>
        <span className={item.danger ? 'text-red-500' : 'text-slate-500'}>{ICONE[item.id]}</span>
        <span>{item.label}</span>
      </button>
    </>
  ),
);
ItemDoMenu.displayName = 'ItemDoMenu';
