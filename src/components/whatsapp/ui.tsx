// Primitivas de UI compartilhadas dos modais do módulo WhatsApp: o diálogo base
// (`WaDialog`/`WaDialogBody`/`WaField`) e os tokens de classe reutilizados pelos
// formulários. Extraídos de WhatsAppModule.tsx para permitir mover os modais para
// arquivos próprios sem duplicar estilo.
//
// Linguagem visual: a mesma do módulo — neutros quentes (#faf9f7/#e7e5df) e
// âmbar como cor de ação. O verde do WhatsApp fica reservado às bolhas da
// conversa, onde ele significa "mensagem enviada"; usá-lo também nos botões dos
// modais só competia com o resto da tela.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { LAYER } from '../../styles/layers';
import { useModalLayer } from '../../styles/modalLayer';

/** Tom do diálogo: colore o emblema do cabeçalho e a faixa superior. */
export type WaDialogTone = 'default' | 'danger' | 'success' | 'info';

const TONE: Record<WaDialogTone, { chip: string; bar: string }> = {
  default: { chip: 'bg-amber-50 text-amber-700 ring-amber-100', bar: 'bg-amber-500' },
  danger:  { chip: 'bg-red-50 text-red-600 ring-red-100',       bar: 'bg-red-500' },
  success: { chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100', bar: 'bg-emerald-500' },
  info:    { chip: 'bg-slate-100 text-slate-600 ring-slate-200', bar: 'bg-slate-400' },
};

// ── Tokens de formulário ─────────────────────────────────────────────
// Campo em repouso tem borda visível (antes era `border-transparent` sobre
// cinza, o que apagava o limite do campo e deixava o formulário "solto").
const FIELD_BASE = 'w-full rounded-lg border border-[#e2e0d9] bg-white px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';
export const waInput = FIELD_BASE;
export const waTextarea = `${FIELD_BASE} resize-none leading-relaxed`;
/** Select nativo com seta própria — o padrão do sistema destoa dos inputs. */
export const waSelect = `${FIELD_BASE} appearance-none bg-no-repeat pr-9 cursor-pointer`;
export const waSelectStyle: React.CSSProperties = {
  backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundPosition: 'right 0.65rem center',
  backgroundSize: '16px',
};
export const waLabel = 'block text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5';
export const waHint = 'mt-1.5 text-[11.5px] leading-snug text-slate-400';

const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
export const waBtnPrimary = `${BTN_BASE} bg-amber-600 text-white shadow-sm hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-amber-200`;
export const waBtnGhost = `${BTN_BASE} border border-[#e2e0d9] bg-white text-slate-600 hover:bg-[#faf9f7] hover:text-slate-800`;
export const waBtnDanger = `${BTN_BASE} bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-200`;

const WA_DIALOG_WIDTH: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  // `sm` cresceu: com a largura antiga (max-w-sm) um formulário de dois selects
  // e um textarea ficava espremido numa coluna estreita.
  sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl',
};

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Campos de digitação — o que um diálogo de formulário quer sob o cursor assim
 * que abre. Deliberadamente SEM botões: o primeiro focável do diálogo em ordem
 * de DOM é o X do cabeçalho, e começar ali é o pior lugar possível (Enter
 * fecharia o diálogo que o usuário acabou de abrir). Caixas de marcar e o input
 * escondido do anexo também ficam de fora: a primeira não é onde se começa a
 * preencher, o segundo nem existe na tela.
 */
const FIELDS = 'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea:not([disabled]),select:not([disabled]),[contenteditable="true"]';

/** Está de fato na tela? `focus()` num elemento escondido não faz nada. */
const visivel = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;

/**
 * Onde o foco deve cair quando o diálogo abre, em ordem de preferência:
 *
 *   1. Nada — se o foco JÁ está dentro do painel. Os efeitos do React sobem de
 *      baixo para cima, então o `autoFocus` de um campo filho já rodou quando
 *      chegamos aqui; ele sabe melhor que nós qual campo importa. Era
 *      exatamente isto que estava quebrado: o diálogo focava o primeiro focável
 *      do DOM (o X de fechar) e desfazia o `autoFocus` de todo formulário —
 *      abrir "Nova conversa" e ter de clicar na busca com o mouse era este bug.
 *   2. `[data-autofocus]`, para quem quer escolher o campo explicitamente.
 *   3. O primeiro campo de digitação, só no ponteiro fino. No celular o foco
 *      automático sobe o teclado por cima do diálogo antes de dar para ler o
 *      que ele pergunta.
 *   4. O próprio painel: o diálogo fica operável por teclado (Esc, Tab preso
 *      dentro dele) sem armar nenhum botão no Enter.
 */
function initialFocus(panel: HTMLElement): HTMLElement | null {
  if (panel.contains(document.activeElement)) return null;
  const marcado = panel.querySelector<HTMLElement>('[data-autofocus]');
  if (marcado) return marcado;
  const fino = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
  const campo = fino ? [...panel.querySelectorAll<HTMLElement>(FIELDS)].find(visivel) : null;
  return campo ?? panel;
}

/**
 * Pilha de diálogos abertos. Só o do topo responde ao Esc — antes cada diálogo
 * escutava a tecla no window e um Esc fechava também o que estava por baixo.
 */
const dialogStack: string[] = [];

export const WaDialog: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  zIndex?: number;
  headerActions?: React.ReactNode;
  tone?: WaDialogTone;
  /** Header escuro (para previews de mídia). Padrão: cabeçalho claro do módulo. */
  headerClassName?: string;
}> = ({
  title, subtitle, icon, onClose, children, footer, size = 'md', zIndex: zIndexProp,
  headerActions, tone = 'default', headerClassName,
}) => {
  // A camada vem do contexto: o MESMO diálogo abre na faixa dos modais quando o
  // módulo está em tela cheia e na faixa do widget quando o módulo está embutido
  // nele — senão ficaria atrás do próprio widget. Ver `styles/modalLayer`.
  const zIndex = useModalLayer(zIndexProp ?? LAYER.MODAL);
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`wa-dialog-${Math.random().toString(36).slice(2)}`);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = idRef.current;
    dialogStack.push(id);
    const restoreFocus = document.activeElement as HTMLElement | null;
    // Foco inicial: ver `initialFocus`. O diálogo já abre operável pelo teclado,
    // e sem passar por cima do campo que o formulário escolheu.
    const panel = panelRef.current;
    if (panel) initialFocus(panel)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id) return; // só o diálogo do topo
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // Prende o Tab dentro do diálogo: sem isso o foco escapa para a inbox atrás.
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    };
    window.addEventListener('keydown', onKey);

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = dialogStack.indexOf(id);
      if (at >= 0) dialogStack.splice(at, 1);
      // Só devolve a rolagem quando nenhum diálogo continua aberto.
      if (dialogStack.length === 0) document.body.style.overflow = prev;
      restoreFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  const toneCls = TONE[tone];
  const darkHeader = !!headerClassName;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      style={{ zIndex }}
      onClick={onClose}
    >
      <motion.div
        ref={panelRef}
        role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className={`flex w-full ${WA_DIALOG_WIDTH[size]} max-h-[94dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none ring-1 ring-black/5 sm:rounded-2xl`}
      >
        {/* Puxador do bottom-sheet: só no celular, onde o diálogo sobe de baixo. */}
        {!darkHeader && <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-slate-200 sm:hidden" />}

        <div className={darkHeader
          ? `flex shrink-0 items-center gap-3 px-4 py-3 text-white ${headerClassName}`
          : 'flex shrink-0 items-start gap-3 border-b border-[#efece5] px-4 py-3.5 sm:px-5'}>
          {icon && (
            <div className={darkHeader
              ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15'
              : `flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${toneCls.chip}`}>
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className={`truncate text-[15px] font-semibold leading-tight ${darkHeader ? '' : 'text-slate-900'}`}>{title}</h3>
            {subtitle && (typeof subtitle === 'string'
              ? <p className={`truncate text-[12px] ${darkHeader ? 'text-white/80' : 'text-slate-500'}`}>{subtitle}</p>
              : <div className={`text-[12px] ${darkHeader ? 'text-white/80' : 'text-slate-500'}`}>{subtitle}</div>)}
          </div>
          {headerActions}
          <button
            type="button" onClick={onClose} aria-label="Fechar"
            className={`shrink-0 rounded-lg p-1.5 transition ${darkHeader
              ? 'text-white/80 hover:bg-white/15 hover:text-white'
              : 'text-slate-400 hover:bg-[#f3f2ef] hover:text-slate-700'}`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white">{children}</div>

        {footer && (
          // No celular os botões ocupam a largura toda (alvo de toque decente);
          // no desktop voltam a ficar alinhados à direita.
          <div className="shrink-0 border-t border-[#efece5] bg-[#faf9f7] px-4 py-3 sm:px-5 [&_button]:w-full sm:[&_button]:w-auto">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
};

export const WaDialogBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['p-4 sm:p-5', className].filter(Boolean).join(' ')} {...props}>{children}</div>
);

/** Rodapé padrão: ações à direita no desktop, empilhadas no celular. */
export const WaDialogActions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);

/**
 * Campo de formulário: rótulo, controle e dica sempre no mesmo ritmo vertical.
 * Antes cada modal repetia `<label>` + `mb-3` na mão, e o espaçamento variava de
 * um para o outro.
 */
export const WaField: React.FC<{
  label: string;
  /** Texto miúdo ao lado do rótulo, para "(opcional)" e afins. */
  optional?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ label, optional, hint, htmlFor, children, className = '' }) => (
  <div className={className}>
    <label htmlFor={htmlFor} className={waLabel}>
      {label}
      {optional && <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">{optional}</span>}
    </label>
    {children}
    {hint && <p className={waHint}>{hint}</p>}
  </div>
);

/** Empilha campos com respiro uniforme dentro do corpo do diálogo. */
export const WaFieldStack: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['space-y-4', className].filter(Boolean).join(' ')} {...props}>{children}</div>
);
