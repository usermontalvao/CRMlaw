import React, { useEffect, useRef } from 'react';
import { NC_BORDER, NC_FOCUS_RING, NC_HOVER, NC_SHADOW_LIFTED, NC_SURFACE, NC_TEXT } from './ncTokens';

/**
 * NcMenu — menu suspenso do explorador Nextcloud.
 * -----------------------------------------------------------------------------
 * O explorador abre três menus (Novo, Mais, ações da seleção) e cada um repetia
 * a mesma trinca de detalhes fáceis de esquecer: fechar ao clicar fora, fechar
 * no Escape devolvendo o foco ao botão, e navegar com as setas. Um menu que não
 * fecha no Escape prende o teclado; por isso o comportamento mora aqui, num só
 * lugar, e não copiado em cada chamada.
 *
 * Posicionamento é do chamador: envolva o botão e o menu num elemento
 * `relative` e escolha o alinhamento.
 */

export const NcMenuItem: React.FC<{
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}> = ({ icon, children, onClick, disabled = false, danger = false, hint }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition ${NC_FOCUS_RING} ${
      danger
        ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
        : `${NC_TEXT} ${NC_HOVER}`
    } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
  >
    {icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {hint && <span className="shrink-0 text-[11px] text-slate-400">{hint}</span>}
  </button>
);

export const NcMenuSeparator: React.FC = () => (
  <div className={`my-1 border-t ${NC_BORDER}`} role="separator" />
);

export const NcMenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{children}</p>
);

interface NcMenuProps {
  open: boolean;
  onClose: () => void;
  /** Botão que abre o menu — recebe o foco de volta ao fechar com Escape. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  align?: 'left' | 'right';
  /** Distância vertical a partir do topo do contêiner posicionado. */
  offsetClassName?: string;
  widthClassName?: string;
  label: string;
  children: React.ReactNode;
}

export const NcMenu: React.FC<NcMenuProps> = ({
  open,
  onClose,
  anchorRef,
  align = 'left',
  offsetClassName = 'top-full mt-1.5',
  widthClassName = 'w-60',
  label,
  children,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target ?? null)) return;
      if (anchorRef?.current?.contains(target ?? null)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        anchorRef?.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
      );
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = current < 0 ? (step === 1 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      className={`absolute z-50 ${offsetClassName} ${align === 'right' ? 'right-0' : 'left-0'} ${widthClassName} max-h-[70dvh] overflow-y-auto overscroll-contain rounded-2xl border p-1.5 ${NC_BORDER} ${NC_SURFACE} ${NC_SHADOW_LIFTED}`}
    >
      {children}
    </div>
  );
};

export default NcMenu;
