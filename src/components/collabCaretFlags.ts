/**
 * collabCaretFlags
 * -----------------------------------------------------------------------------
 * A plaquinha com FOTO + NOME em cima do cursor de quem está editando junto —
 * como no Google Docs. O Syncfusion já desenha um cursor colorido por pessoa
 * (`div.e-de-blink-cursor`, reposicionado a cada operação); aqui nós penduramos
 * a identificação NELE, então a plaquinha acompanha o cursor sozinha, sem
 * cálculo de posição nosso.
 *
 * Comportamento:
 *  - enquanto a pessoa está DIGITANDO, a plaquinha fica visível;
 *  - parada, ela some e volta ao passar o mouse sobre o cursor;
 *  - a cor de fundo é a MESMA que o Syncfusion deu ao cursor da pessoa.
 *
 * Usado pelo SyncfusionEditor (produção) e pelo harness E2E — mudou aqui,
 * mudou nos dois.
 */

export interface CaretFlagPeer {
  /** Id da conexão na sala — é a chave do `userMap` do Syncfusion. */
  connectionId: string;
  userName: string;
  avatarUrl: string | null;
  typing: boolean;
}

const STYLE_ID = 'jurius-caret-flag-styles';
const FLAG_CLASS = 'jurius-caret-flag';

const STYLES = `
.e-de-blink-cursor { overflow: visible; }
.${FLAG_CLASS} {
  position: absolute;
  bottom: 100%;
  left: -2px;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px 2px 3px;
  border-radius: 10px 10px 10px 3px;
  color: #fff;
  font: 600 10px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
  z-index: 6;
}
.${FLAG_CLASS}.is-typing,
.e-de-blink-cursor:hover .${FLAG_CLASS} {
  opacity: 1;
  transform: translateY(0);
}
.${FLAG_CLASS} .jurius-caret-flag-avatar {
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.25);
  font-size: 8px;
  font-weight: 700;
  flex: none;
}
`;

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.appendChild(style);
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** O que interessa do `userMap` do CollaborativeEditingHandler. */
interface CaretInfoLike {
  caret?: HTMLElement;
  color?: string;
}

/**
 * Ajusta as plaquinhas de TODOS os cursores remotos para refletir `peers`.
 * Idempotente: pode (e deve) ser chamada a cada mudança da lista da sala.
 * Cursor removido pelo Syncfusion leva a plaquinha junto — nada a limpar.
 */
export function syncCollabCaretFlags(handler: unknown, peers: CaretFlagPeer[]): void {
  const userMap = (handler as { userMap?: Record<string, CaretInfoLike> } | null)?.userMap;
  if (!userMap) return;

  for (const peer of peers) {
    const info = userMap[peer.connectionId];
    const caret = info?.caret;
    if (!caret || !caret.ownerDocument) continue;

    ensureStyles(caret.ownerDocument);

    let flag = caret.querySelector<HTMLElement>(`:scope > .${FLAG_CLASS}`);
    if (!flag) {
      flag = caret.ownerDocument.createElement('div');
      flag.className = FLAG_CLASS;
      caret.appendChild(flag);
    }

    flag.style.background = info?.color || '#2563eb';
    flag.classList.toggle('is-typing', peer.typing);

    // Conteúdo só é reconstruído quando a pessoa/foto muda — reposicionamento
    // do cursor não mexe aqui.
    const signature = `${peer.userName}|${peer.avatarUrl || ''}`;
    if (flag.dataset.signature !== signature) {
      flag.dataset.signature = signature;
      flag.textContent = '';

      if (peer.avatarUrl) {
        const img = caret.ownerDocument.createElement('img');
        img.className = 'jurius-caret-flag-avatar';
        img.src = peer.avatarUrl;
        img.alt = '';
        img.onerror = () => {
          img.replaceWith(makeInitials(caret.ownerDocument, peer.userName));
        };
        flag.appendChild(img);
      } else {
        flag.appendChild(makeInitials(caret.ownerDocument, peer.userName));
      }

      const label = caret.ownerDocument.createElement('span');
      label.textContent = firstName(peer.userName);
      flag.appendChild(label);
      flag.setAttribute('aria-hidden', 'true');
      caret.title = peer.userName;
    }
  }
}

function makeInitials(doc: Document, userName: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = 'jurius-caret-flag-avatar';
  el.textContent = initials(userName);
  return el;
}
