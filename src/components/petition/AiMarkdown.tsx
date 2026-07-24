// Renderer de markdown LEVE para as respostas do assistente de petições.
// Cobre exatamente o subset permitido no prompt (headings ##/###, **negrito**,
// *itálico*, `código`, listas -/1., > citação, ---) gerando elementos React —
// sem dependência externa e sem dangerouslySetInnerHTML (zero XSS).

import React from 'react';

// ── Inline: **bold**, *italic*, `code` ───────────────────────────────────────

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="px-1 py-0.5 rounded bg-[var(--ai-surface-2)] border border-[var(--ai-border)] text-[0.92em] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part ? <React.Fragment key={key}>{part}</React.Fragment> : null;
  });
};

// ── Blocos ───────────────────────────────────────────────────────────────────

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' };

const parseBlocks = (markdown: string): Block[] => {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'p', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      continue;
    }

    const ulItem = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (ulItem) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ul') last.items.push(ulItem[1]);
      else blocks.push({ kind: 'ul', items: [ulItem[1]] });
      continue;
    }

    const olItem = /^\d{1,2}[.)]\s+(.*)$/.exec(trimmed);
    if (olItem) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'ol') last.items.push(olItem[1]);
      else blocks.push({ kind: 'ol', items: [olItem[1]] });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'quote') last.text += `\n${quote[1]}`;
      else blocks.push({ kind: 'quote', text: quote[1] });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
};

interface AiMarkdownProps {
  content: string;
  /** Caret pulsante no fim do último bloco (resposta sendo streamada). */
  streaming?: boolean;
}

const Caret: React.FC = () => (
  <span className="inline-block w-[2px] h-[1em] align-middle bg-[var(--ai-accent)] ml-0.5 animate-pulse" />
);

const AiMarkdown: React.FC<AiMarkdownProps> = ({ content, streaming = false }) => {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1;
        const caret = streaming && isLast ? <Caret /> : null;
        const key = `b-${i}`;

        switch (block.kind) {
          case 'h':
            return (
              <div key={key} className={`font-semibold text-[var(--ai-text)] ${block.level <= 2 ? 'text-[13.5px]' : 'text-[13px]'} mt-1`}>
                {renderInline(block.text, key)}{caret}
              </div>
            );
          case 'ul':
            return (
              <ul key={key} className="space-y-1 pl-1">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`} className="flex gap-2">
                    <span className="shrink-0 mt-[7px] w-1 h-1 rounded-full bg-[var(--ai-text-2)]" />
                    <span className="min-w-0">
                      {renderInline(item, `${key}-${j}`)}
                      {caret && j === block.items.length - 1 ? caret : null}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="space-y-1 pl-1">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`} className="flex gap-2">
                    <span className="shrink-0 text-[var(--ai-text-2)] tabular-nums">{j + 1}.</span>
                    <span className="min-w-0">
                      {renderInline(item, `${key}-${j}`)}
                      {caret && j === block.items.length - 1 ? caret : null}
                    </span>
                  </li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 border-[var(--ai-border)] pl-2.5 text-[var(--ai-text-2)] whitespace-pre-wrap">
                {renderInline(block.text, key)}{caret}
              </blockquote>
            );
          case 'hr':
            return <hr key={key} className="border-[var(--ai-border)]" />;
          default:
            return (
              <p key={key} className="whitespace-pre-wrap break-words">
                {renderInline(block.text, key)}{caret}
              </p>
            );
        }
      })}
      {blocks.length === 0 && streaming && <Caret />}
    </div>
  );
};

export default AiMarkdown;
