import React, { useCallback, useRef, useState } from 'react';
import { Send, SpellCheck2 } from 'lucide-react';
import ComposerSpellcheckOverlay from '../components/whatsapp/ComposerSpellcheckOverlay';
import ComposerSpellcheckContextMenu, { type ComposerSpellcheckMenuState } from '../components/whatsapp/ComposerSpellcheckContextMenu';
import { findWhatsAppSpellIssueAtOffset, type WhatsAppSpellcheckHit } from '../components/whatsapp/composerSpellcheck';
import { useWaComposerSpellcheck } from '../components/whatsapp/useWaComposerSpellcheck';

const START_TEXT = 'Oieee tudo bem amigo como vocee esta';

export default function WhatsAppSpellcheckPreview() {
  const [draft, setDraft] = useState(START_TEXT);
  const [menu, setMenu] = useState<ComposerSpellcheckMenuState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const spellcheck = useWaComposerSpellcheck(draft);
  const openMenu = useCallback((event: React.MouseEvent<HTMLTextAreaElement>) => {
    const hit = findWhatsAppSpellIssueAtOffset(draft, spellcheck.issues, event.currentTarget.selectionStart);
    if (!hit) return;
    event.preventDefault();
    event.currentTarget.setSelectionRange(hit.start, hit.end);
    setMenu({ ...hit, x: event.clientX, y: event.clientY });
  }, [draft, spellcheck.issues]);
  const replaceWord = useCallback((hit: WhatsAppSpellcheckHit, replacement: string) => {
    setDraft(current => current.slice(0, hit.start) + replacement + current.slice(hit.end));
    setMenu(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  return (
    <main className="flex min-h-screen items-end justify-center bg-[#efeae2] p-8">
      <section className="w-full max-w-4xl rounded-2xl border border-[#e7e5df] bg-white p-5 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <SpellCheck2 size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800">Corretor do WhatsApp</h1>
            <p className="text-xs text-slate-500">As palavras suspeitas aparecem sublinhadas no próprio texto.</p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <ComposerSpellcheckOverlay text={draft} issues={spellcheck.issues} />
            <textarea ref={textareaRef} value={draft} onChange={event => setDraft(event.target.value)}
              onContextMenu={openMenu}
              spellCheck lang="pt-BR" autoCorrect="on" autoCapitalize="sentences"
              data-testid="whatsapp-message-input" rows={2}
              className="relative z-0 w-full resize-none rounded-xl border border-amber-300 bg-[#f3f2ef] px-3.5 py-2.5 text-[13.5px] leading-5 text-slate-800 outline-none focus:bg-white" />
            <ComposerSpellcheckContextMenu menu={menu} onReplace={replaceWord} onClose={() => setMenu(null)} />
          </div>
          <button type="button" title="Enviar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white">
            <Send size={16} />
          </button>
        </div>
      </section>
    </main>
  );
}
