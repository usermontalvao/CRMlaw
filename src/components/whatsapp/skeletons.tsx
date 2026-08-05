// Esqueletos de carregamento do módulo WhatsApp.
//
// O que havia antes era um spinner centralizado, na lista e na conversa: a área
// ficava vazia, o spinner girava e então tudo aparecia de uma vez. Dois
// problemas — a tela salta quando o conteúdo chega, e o spinner não diz o que
// está vindo, então a espera parece mais longa do que é.
//
// Estes esqueletos ocupam a MESMA forma do conteúdo real (linha de conversa com
// avatar e etiqueta; balões alternando os dois lados, com larguras diferentes).
// A chegada dos dados vira uma troca de conteúdo no lugar de um salto de layout.
// Nada aqui tem estado: são apenas formas, marcadas com `aria-hidden` para o
// leitor de tela não anunciar caixas vazias.
import React from 'react';

/** Esqueleto de uma lista de conversas (8 linhas). */
export const ConversationListSkeleton: React.FC = () => (
  <div aria-hidden="true">
    {Array.from({ length: 8 }, (_, i) => (
      <div key={i} className="wa-skel-row flex items-center gap-3 border-b border-[#f1f0ec] px-4 py-3"
        style={{ animationDelay: `${i * 55}ms` }}>
        <div className="wa-skel h-10 w-10 flex-shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {/* Larguras alternadas: uma coluna de blocos idênticos parece uma
                tabela quebrada, não uma lista carregando. */}
            <div className="wa-skel h-3 rounded" style={{ width: `${42 + (i % 3) * 14}%` }} />
            <div className="wa-skel h-2.5 w-8 rounded" />
          </div>
          <div className="wa-skel mt-2 h-2.5 rounded" style={{ width: `${58 + (i % 4) * 10}%` }} />
          <div className="wa-skel mt-2 h-3 w-16 rounded" />
        </div>
      </div>
    ))}
  </div>
);

// Balões plausíveis: alternam lado e largura como uma conversa de verdade. A
// sequência é fixa (e não aleatória) para o esqueleto não "dançar" a cada
// render enquanto o histórico carrega.
const BUBBLES: Array<{ out: boolean; w: number; h: number }> = [
  { out: false, w: 58, h: 38 },
  { out: true, w: 44, h: 22 },
  { out: true, w: 66, h: 38 },
  { out: false, w: 38, h: 22 },
  { out: false, w: 72, h: 54 },
  { out: true, w: 50, h: 22 },
];

/** Esqueleto da janela de mensagens. */
export const ThreadSkeleton: React.FC = () => (
  <div aria-hidden="true" className="px-4 py-4">
    {BUBBLES.map((b, i) => (
      <div key={i} className={`wa-skel-row mb-2 flex ${b.out ? 'justify-end' : 'justify-start'}`}
        style={{ animationDelay: `${i * 60}ms` }}>
        <div
          className={`wa-skel rounded-[7.5px] ${b.out ? 'wa-skel-out' : ''}`}
          style={{ width: `min(${b.w}%, 420px)`, height: b.h }}
        />
      </div>
    ))}
  </div>
);
