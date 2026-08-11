// Desenha o texto do WhatsApp já formatado (negrito/itálico/riscado/mono).
// A leitura das marcas mora em waRichText.ts (pura, testada); aqui é só pintura.
import React, { useMemo } from 'react';
import { parseWaRich, stripAgentSignature, type WaTextNode } from './waRichText';

const classeDo = (n: WaTextNode): string => [
  n.bold ? 'font-semibold' : '',
  n.italic ? 'italic' : '',
  n.strike ? 'line-through' : '',
  n.mono ? 'font-mono text-[0.92em] bg-black/[0.06] rounded px-1 py-px' : '',
].filter(Boolean).join(' ');

export const WaRichText: React.FC<{
  text: string;
  /** Tira a linha `*Nome:*` do atendente — só faz sentido no que saiu daqui. */
  stripSignature?: boolean;
  className?: string;
}> = ({ text, stripSignature, className }) => {
  const nodes = useMemo(
    () => parseWaRich(stripSignature ? stripAgentSignature(text) : text),
    [text, stripSignature],
  );
  return (
    <span className={className}>
      {nodes.map((n, i) => {
        const cls = classeDo(n);
        if (n.link) {
          // Sempre em aba/janela externa: a conversa não pode ser substituída
          // pelo site — o atendente perderia o atendimento no meio. `noopener`
          // impede que a página aberta alcance esta pela `window.opener`.
          //
          // `stopPropagation` porque a bolha inteira é clicável (responder,
          // menu, seleção): sem isto, abrir o link disparava a ação da bolha junto.
          return (
            <a
              key={i}
              href={n.link}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              title={n.link}
              className={`${cls} text-[#027eb5] underline underline-offset-2 break-all hover:text-[#01608a]`}
            >
              {n.text}
            </a>
          );
        }
        return cls
          ? <span key={i} className={cls}>{n.text}</span>
          : <React.Fragment key={i}>{n.text}</React.Fragment>;
      })}
    </span>
  );
};
