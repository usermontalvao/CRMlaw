// Renderizador de PDF do visualizador da conversa. Fica em arquivo próprio
// porque importa o react-pdf/pdfjs de forma ESTÁTICA: quem usa carrega este
// módulo por `React.lazy`, então a thread só paga o bundle do pdfjs quando o
// atendente realmente abre um documento.
import React, { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Loader2 } from 'lucide-react';
import { setLocalPdfWorker } from '../../utils/pdfWorker';

setLocalPdfWorker(pdfjs);

/** Largura máxima da folha; acima disso o texto fica largo demais para ler. */
const MAX_PAGE_WIDTH = 900;

/**
 * Todas as páginas em canvas, uma embaixo da outra, com scroll único — o mesmo
 * caminho usado na página pública de assinatura. `<iframe>` não serve: no
 * Android/iOS ele mostra só a 1ª página ou força download.
 */
const WaPdfDocumentView: React.FC<{
  url: string;
  onPages?: (total: number) => void;
  onVisiblePage?: (page: number) => void;
  onError?: () => void;
}> = ({ url, onPages, onVisiblePage, onError }) => {
  const [numPages, setNumPages] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0].contentRect.width)));
    ro.observe(node);
    setWidth(Math.floor(node.offsetWidth));
    return () => ro.disconnect();
  }, []);

  // Página "atual" = a que ocupa o meio da janela de leitura. É só para o
  // contador do cabeçalho; nada depende disso para renderizar.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node || !onVisiblePage || numPages === 0) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const middle = node.scrollTop + node.clientHeight / 2;
        const pages = Array.from(node.querySelectorAll<HTMLElement>('[data-page]'));
        const found = pages.find(el => el.offsetTop <= middle && middle < el.offsetTop + el.offsetHeight);
        if (found) onVisiblePage(Number(found.dataset.page));
      });
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => { node.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [numPages, onVisiblePage]);

  const pageWidth = width > 0 ? Math.min(width - 32, MAX_PAGE_WIDTH) : 0;

  return (
    <div ref={wrapRef} className="h-full w-full overflow-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
      <Document
        file={url}
        onLoadSuccess={({ numPages: total }) => { setNumPages(total); onPages?.(total); }}
        onLoadError={() => onError?.()}
        loading={<div className="flex items-center justify-center gap-2 p-16 text-[13px] text-white/80"><Loader2 size={16} className="animate-spin" /> Carregando documento…</div>}
        error={null}
      >
        {pageWidth > 0 && Array.from({ length: numPages }, (_, i) => (
          <div key={i} data-page={i + 1} className="flex justify-center px-4 pt-4">
            <div className="bg-white shadow-[0_2px_16px_rgba(0,0,0,0.45)] leading-[0]">
              <Page pageNumber={i + 1} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} loading={null} />
            </div>
          </div>
        ))}
        <div className="h-4" />
      </Document>
    </div>
  );
};

export default WaPdfDocumentView;
