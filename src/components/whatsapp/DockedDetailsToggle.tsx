import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DockedDetailsToggleProps {
  collapsed: boolean;
  onToggle: () => void;
}

/** Alça lateral do painel 360º: fecha para a direita e reabre para a esquerda. */
export const DockedDetailsToggle: React.FC<DockedDetailsToggleProps> = ({ collapsed, onToggle }) => (
  <button
    type="button"
    onPointerDown={event => event.stopPropagation()}
    onClick={onToggle}
    title={collapsed ? 'Mostrar painel de detalhes' : 'Ocultar painel de detalhes'}
    aria-label={collapsed ? 'Mostrar painel de detalhes' : 'Ocultar painel de detalhes'}
    aria-expanded={!collapsed}
    data-testid={collapsed ? 'whatsapp-details-expand' : 'whatsapp-details-collapse'}
    className={collapsed
      ? 'absolute right-0 top-1/2 z-30 flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-[#dedbd4] bg-white text-[#667781] shadow-[-3px_2px_10px_rgba(11,20,26,0.12)] transition hover:border-[#00a884]/30 hover:bg-[#f0f2f5] hover:text-[#008069] active:w-8'
      : 'absolute left-1/2 top-1/2 z-20 flex h-14 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg border border-[#dedbd4] bg-white text-[#667781] shadow-md transition hover:border-[#00a884]/30 hover:bg-[#f0f2f5] hover:text-[#008069] active:scale-95'}
  >
    {collapsed
      ? <ChevronLeft size={17} strokeWidth={2.2} />
      : <ChevronRight size={17} strokeWidth={2.2} />}
  </button>
);

DockedDetailsToggle.displayName = 'DockedDetailsToggle';
