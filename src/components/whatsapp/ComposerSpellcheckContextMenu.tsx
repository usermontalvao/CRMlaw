import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, SpellCheck2, X } from 'lucide-react';
import type { WhatsAppSpellcheckHit } from './composerSpellcheck';
import { LAYER } from '../../styles/layers';
import { useModalLayer } from '../../styles/modalLayer';

export interface ComposerSpellcheckMenuState extends WhatsAppSpellcheckHit {
  x: number;
  y: number;
}

interface ComposerSpellcheckContextMenuProps {
  menu: ComposerSpellcheckMenuState | null;
  onReplace: (hit: WhatsAppSpellcheckHit, replacement: string) => void;
  onClose: () => void;
}

export const ComposerSpellcheckContextMenu: React.FC<ComposerSpellcheckContextMenuProps> = ({
  menu,
  onReplace,
  onClose,
}) => {
  // Portal para o `body`: dentro do widget o menu precisa da faixa dele.
  const camada = useModalLayer(LAYER.POPOVER);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => { setActiveIndex(0); }, [menu?.issue.word]);

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowDown') {
        if (menu.issue.suggestions.length === 0) return;
        event.preventDefault();
        setActiveIndex(current => Math.min(current + 1, menu.issue.suggestions.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        if (menu.issue.suggestions.length === 0) return;
        event.preventDefault();
        setActiveIndex(current => Math.max(current - 1, 0));
        return;
      }
      if (event.key === 'Enter' && menu.issue.suggestions[activeIndex]) {
        event.preventDefault();
        onReplace(menu, menu.issue.suggestions[activeIndex]);
      }
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', handleKey);
    };
  }, [activeIndex, menu, onClose, onReplace]);

  if (!menu) return null;
  const suggestions = menu.issue.suggestions.slice(0, 3);
  const menuWidth = 224;
  const estimatedHeight = 84 + Math.max(1, suggestions.length) * 38;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - menuWidth - 8));
  const opensUp = menu.y + estimatedHeight + 8 > window.innerHeight;
  const top = Math.max(8, opensUp ? menu.y - estimatedHeight - 6 : menu.y + 6);

  return createPortal(
    <div role="menu" aria-label={`Correções para ${menu.issue.word}`}
      data-testid="wa-spellcheck-context-menu"
      onPointerDown={event => event.stopPropagation()}
      className="fixed w-56 overflow-hidden rounded-xl border border-[#e5e1d8] bg-white/98 shadow-[0_18px_45px_-8px_rgba(15,23,42,0.28)] backdrop-blur-sm"
      style={{ left, top, zIndex: camada }}>
      <div className="flex items-start gap-2.5 border-b border-[#eeeae2] bg-[#faf9f6] px-3 py-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
          <SpellCheck2 size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Ortografia</p>
          <p className="truncate text-[12px] font-semibold text-slate-700">
            Substituir <span className="underline decoration-rose-500 decoration-wavy underline-offset-2">{menu.issue.word}</span>
          </p>
        </div>
        <button type="button" aria-label="Fechar correções" onClick={onClose}
          className="rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500">
          <X size={13} />
        </button>
      </div>
      <div className="p-1.5">
        {suggestions.length > 0 ? suggestions.map((suggestion, index) => (
          <button key={suggestion} type="button" role="menuitem" aria-current={index === activeIndex ? 'true' : undefined}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={event => event.preventDefault()}
            onClick={() => onReplace(menu, suggestion)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${index === activeIndex
              ? 'bg-amber-50 text-amber-900'
              : 'text-slate-700 hover:bg-slate-50'}`}>
            <ArrowRight size={13} className={index === activeIndex ? 'text-amber-600' : 'text-slate-300'} />
            <span className="flex-1 text-[13px] font-semibold">{suggestion}</span>
            {index === 0 && <kbd className="rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[8px] font-semibold text-amber-600">ENTER</kbd>}
          </button>
        )) : (
          <p className="px-2.5 py-2 text-[11.5px] text-slate-400">Nenhuma correção segura encontrada.</p>
        )}
      </div>
      {suggestions.length > 1 && (
        <div className="border-t border-[#f0ede7] px-3 py-1.5 text-[9px] font-medium text-slate-400">
          ↑↓ para navegar · Enter para aplicar
        </div>
      )}
    </div>,
    document.body,
  );
};

export default ComposerSpellcheckContextMenu;
