import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';

/**
 * Lightbox/galeria de mídia da thread. Renderiza num portal para `document.body`
 * para escapar do containing block do widget embutido (o painel usa transform +
 * overflow-hidden, que prenderiam o `fixed` dentro da thread). Fecha por clique
 * fora, X e ESC.
 *
 * O ÍNDICE DA GALERIA MORA AQUI. Antes cada ‹ › escrevia estado no
 * WhatsAppModule: trocar de foto re-renderizava o orquestrador inteiro — lista
 * de conversas, remontagem dos álbuns/bolhas da thread e painel de detalhes —
 * e o listener de teclado saía e voltava do `window` a cada passo. Era esse
 * trabalho, não a imagem, que fazia a navegação engasgar. Agora o módulo só
 * re-renderiza ao ABRIR e ao FECHAR; entre uma foto e outra nada acima daqui
 * sabe que houve troca.
 */
export const WaLightbox: React.FC<{
  /** Imagem clicada — define só a posição inicial da galeria. */
  image: string;
  images: string[];
  onClose: () => void;
}> = React.memo(({ image, images, onClose }) => {
  const [current, setCurrent] = useState(image);
  // A imagem QUE ESTÁ NA TELA anda um passo atrás da escolhida: ela só troca
  // depois que a próxima terminou de decodificar. Trocar o `src` direto deixa
  // um quadro vazio no meio (o <img> fica "indisponível" até carregar) — era o
  // piscar preto que parecia travamento.
  const [shown, setShown] = useState(image);
  // Reabriu por outra foto: reposiciona a galeria sem esperar um efeito.
  const [openedWith, setOpenedWith] = useState(image);
  if (openedWith !== image) { setOpenedWith(image); setCurrent(image); setShown(image); }

  const idx = images.indexOf(current);
  const hasGallery = idx >= 0 && images.length > 1;

  // Navegação lida por ref: o listener de teclado é registrado UMA vez por
  // abertura, em vez de a cada troca de imagem.
  const navRef = useRef({ idx, images });
  navRef.current = { idx, images };
  const go = useCallback((delta: number) => {
    const { idx: i, images: list } = navRef.current;
    if (i < 0) return;
    const next = list[Math.min(Math.max(i + delta, 0), list.length - 1)];
    if (next) setCurrent(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose]);

  // Decodifica fora da tela e só então promove: com a vizinha já pré-carregada
  // isto resolve no mesmo quadro e a troca fica instantânea.
  useEffect(() => {
    if (shown === current) return;
    let alive = true;
    const img = new Image();
    img.decoding = 'async';
    img.src = current;
    const promote = () => { if (alive) setShown(current); };
    img.decode().then(promote, promote);
    return () => { alive = false; };
  }, [current, shown]);

  // Vizinhas entram no cache do navegador ANTES do clique — sem isso cada passo
  // pagava rede + decode na hora. Sem cleanup de propósito: abortar o download
  // ao andar rápido derrubaria justamente o pré-carregamento que se quer.
  const preloadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (idx < 0) return;
    for (const src of [images[idx + 1], images[idx - 1]]) {
      if (!src || preloadedRef.current.has(src)) continue;
      preloadedRef.current.add(src);
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }, [idx, images]);

  return createPortal(
    // Sem `backdrop-filter`: desfocar a viewport inteira obriga o navegador a
    // reprocessar todo o CRM que está atrás a cada repaint da galeria, e sob 92%
    // de preto o efeito nem aparecia.
    <div className="fixed inset-0 z-[100000] bg-black/92 flex items-center justify-center p-6" onClick={onClose}>
      <img
        src={shown}
        alt=""
        decoding="async"
        draggable={false}
        className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl select-none"
        onClick={e => e.stopPropagation()}
      />
      {shown !== current && (
        <span className="absolute bottom-8 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 text-white text-[12px] font-semibold ring-1 ring-white/20">
          <Loader2 size={14} className="animate-spin" /> Carregando…
        </span>
      )}
      <button onClick={onClose} className="absolute top-5 right-5 h-10 w-10 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center ring-1 ring-white/20 transition" title="Fechar"><X size={22} /></button>
      {hasGallery && (
        <>
          <button
            onClick={e => { e.stopPropagation(); go(-1); }}
            disabled={idx === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default"
            title="Imagem anterior">
            <ChevronLeft size={28} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); go(1); }}
            disabled={idx === images.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default"
            title="Próxima imagem">
            <ChevronRight size={28} />
          </button>
          <span className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-[12px] font-semibold ring-1 ring-white/20">
            {idx + 1} / {images.length}
          </span>
        </>
      )}
    </div>,
    document.body,
  );
});
WaLightbox.displayName = 'WaLightbox';

/**
 * Vídeo em tela cheia, na frente da conversa. Mesmo portal do lightbox de
 * imagem (o widget flutuante usa transform + overflow-hidden, que prenderiam um
 * `fixed` dentro da thread). Fecha no X, no clique fora e no ESC.
 */
export const WaVideoLightbox: React.FC<{
  src: string;
  name: string;
  onClose: () => void;
}> = ({ src, name, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex flex-col bg-black/90" style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="flex flex-shrink-0 items-center gap-3 px-4 py-2.5 text-white" onClick={e => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{name}</span>
        <a href={src} download={name} title="Baixar vídeo"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"><Download size={18} /></a>
        <button type="button" onClick={onClose} title="Fechar"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"><X size={20} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={onClose}>
        {/* `autoPlay` sem `muted`: o clique do atendente para abrir já conta
            como gesto do usuário, então o navegador libera o som. */}
        <video src={src} controls autoPlay playsInline onClick={e => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg shadow-2xl outline-none" />
      </div>
    </div>,
    document.body,
  );
};
