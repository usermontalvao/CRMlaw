import React, { useMemo } from 'react';
import { segmentWhatsAppSpellcheckText, type WhatsAppComposerSpellIssue } from './composerSpellcheck';

interface ComposerSpellcheckOverlayProps {
  text: string;
  issues: WhatsAppComposerSpellIssue[];
  scrollTop?: number;
  scrollbarWidth?: number;
}

/** Desenha só o ondulado vermelho; o texto e o cursor continuam no textarea. */
export const ComposerSpellcheckOverlay: React.FC<ComposerSpellcheckOverlayProps> = ({
  text,
  issues,
  scrollTop = 0,
  scrollbarWidth = 0,
}) => {
  const segments = useMemo(() => segmentWhatsAppSpellcheckText(text, issues), [issues, text]);
  if (issues.length === 0) return null;

  return (
    <div aria-hidden="true" data-testid="wa-composer-spellcheck-overlay"
      className="pointer-events-none absolute inset-y-0 left-0 z-10 box-border overflow-hidden rounded-xl border border-transparent px-3.5 py-2.5 text-[13.5px] leading-5 text-transparent"
      style={{ right: scrollbarWidth }}>
      <div className="whitespace-pre-wrap break-words" style={{ transform: `translateY(-${scrollTop}px)` }}>
        {segments.map((segment, index) => (
          <span key={`${index}:${segment.text}`} className={segment.misspelled
            ? 'underline decoration-rose-500 decoration-wavy decoration-1 underline-offset-2'
            : undefined}>
            {segment.text}
          </span>
        ))}
      </div>
    </div>
  );
};

export default ComposerSpellcheckOverlay;
