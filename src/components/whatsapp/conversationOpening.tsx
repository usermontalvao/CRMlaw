// O QUE SE VÊ ENTRE O CLIQUE E A CONVERSA.
//
// Clicar no botão verde de um cliente dispara duas coisas demoradas ao mesmo
// tempo: o módulo do WhatsApp MONTANDO dentro do widget (a primeira vez custa
// caro — lista, canais, permissões) e uma ida ao banco para descobrir ou criar
// a thread daquele número. Sem nada por cima, o intervalo aparecia como o pior
// tipo de espera: o painel abria vazio, depois piscava a lista de conversas de
// outra pessoa, e só então a conversa certa entrava. Parecia defeito.
//
// Esta camada cobre exatamente esse intervalo, e ela é uma PROMESSA, não um
// disco girando: mostra desde o primeiro quadro com QUEM se vai falar — a
// inicial, o nome, o telefone —, e desenha em cinza o formato do que está
// chegando (as bolhas da conversa, a barra de digitar). Quem olha reconhece a
// tela antes de ela existir, e a espera deixa de ser dúvida.
//
// Detalhes que fazem diferença aqui e custam pouco:
//
//  · o anel do avatar PULSA, devagar, para dizer que há trabalho em curso — é
//    o único movimento contínuo, tudo mais é o brilho do próprio esqueleto;
//  · as bolhas ENTRAM em escada (40ms de diferença), o que dá direção ao
//    desenho em vez de estampar tudo de uma vez;
//  · quem pediu "reduzir movimento" ao sistema recebe a mesma tela parada: o
//    `.skeleton` já respeita isso no CSS global, e a escada vira aparição.
//
// A saída é um fade curto POR CIMA da conversa já pronta (ver `AnimatePresence`
// em quem usa): a última coisa que se vê é o esqueleto virando a coisa real, no
// mesmo lugar — não uma tela trocando por outra.
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { prettyPhone } from './format';

/** Iniciais de quem se vai falar; sem nome, o ícone de conversa basta. */
function iniciais(nome?: string | null): string {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  if (partes.length === 1) return (partes[0][0] || '').toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Larguras das bolhas fantasma — irregulares de propósito, como fala real. */
const BOLHAS: Array<{ minha: boolean; largura: string; altura: number }> = [
  { minha: false, largura: '62%', altura: 38 },
  { minha: true, largura: '48%', altura: 30 },
  { minha: false, largura: '74%', altura: 52 },
  { minha: true, largura: '38%', altura: 30 },
  { minha: false, largura: '56%', altura: 38 },
];

export const ConversationOpening: React.FC<{
  name?: string | null;
  phone?: string | null;
}> = ({ name, phone }) => {
  const semMovimento = useReducedMotion();
  const letras = iniciais(name);
  const telefone = phone ? prettyPhone(phone) : '';

  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col bg-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      role="status"
      aria-live="polite"
      aria-label={`Abrindo conversa${name ? ` com ${name}` : ''}`}
    >
      {/* Cabeçalho — o mesmo lugar onde o cabeçalho de verdade vai aparecer */}
      <div className="flex items-center gap-3 border-b border-slate-900/[0.06] px-4 py-3">
        <div className="relative flex-shrink-0">
          {!semMovimento && (
            <motion.span
              className="absolute -inset-1 rounded-full bg-emerald-400/25"
              animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0, 0.55] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-sm font-semibold text-white">
            {letras || (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white/90">
                <path d="M12 2a10 10 0 0 0-8.7 15l-1.2 4.4 4.5-1.2A10 10 0 1 0 12 2Z" />
              </svg>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-800">
            {name || telefone || 'Nova conversa'}
          </p>
          {name && telefone && (
            <p className="truncate text-[11px] tabular-nums text-slate-400">{telefone}</p>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-600/80">
            <span>Abrindo conversa</span>
            {!semMovimento && (
              <span className="inline-flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <motion.span
                    key={i}
                    className="inline-block h-1 w-1 rounded-full bg-emerald-500"
                    animate={{ opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' }}
                  />
                ))}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Thread fantasma — ancorada EMBAIXO, como uma conversa de verdade: as
          bolhas nascem no rodapé e sobem. Coladas no topo, o painel ficava com
          um vazio branco de meia tela onde a conversa deveria estar. */}
      <div className="flex flex-1 flex-col justify-end space-y-3 overflow-hidden px-4 py-4">
        {BOLHAS.map((b, i) => (
          <motion.div
            key={i}
            className={`flex ${b.minha ? 'justify-end' : 'justify-start'}`}
            initial={semMovimento ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.22, ease: 'easeOut' }}
          >
            <div
              className={`skeleton ${b.minha ? 'rounded-[14px_14px_4px_14px]' : 'rounded-[14px_14px_14px_4px]'}`}
              style={{ width: b.largura, height: b.altura, opacity: 0.85 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Barra de digitar fantasma */}
      <div className="flex items-center gap-2 border-t border-slate-900/[0.06] px-4 py-3">
        <div className="skeleton h-8 flex-1 rounded-full" style={{ opacity: 0.85 }} />
        <div className="skeleton h-8 w-8 rounded-full" style={{ opacity: 0.85 }} />
      </div>
    </motion.div>
  );
};

export default ConversationOpening;
